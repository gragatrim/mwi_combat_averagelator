// =============================================================================
// DeterministicSimulator - Main combat simulation loop (deterministic port)
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/combatSimulator.js
//
// Key differences from the stochastic original:
//   1. All randomness replaced with expected values (via CombatUtilities.processAttack)
//   2. CC (stun/blind/silence) applied as fractional delays on target's next action
//   3. Pierce/mayhem/blaze/bloom/ripple handled as expected-value procs
//   4. OOM bug fixed: auto-attacks still scheduled when out of mana
//   5. Cycle detection replaces time-limit termination
//   6. Encounters enumerated from Zone.getAllEncounterCompositions()

import CombatUtilities, { type AttackResult } from "./combatUtilities";
import type CombatUnit from "./combatUnit";
import type Player from "./player";
import Monster from "./monster";
import Ability from "./ability";
import type Consumable from "./consumable";
import Buff from "./buff";
import Zone, {
  type EncounterComposition,
  type EncounterDistribution,
  type EncounterMonsterRef,
} from "./zone";
import SimResult, { emptyExperience, addExperience } from "./simResult";
import CycleDetector, { createCycleSnapshot } from "./cycleDetector";
import { EventQueue } from "./eventQueue";
import type { GameData, ExperienceBreakdown, AbilityEffect } from "./types";

import {
  CombatEvent,
  CombatEventType,
  AutoAttackEvent,
  AbilityCastEndEvent,
  RegenTickEvent,
  ConsumableTickEvent,
  DamageOverTimeEvent,
  StunExpirationEvent,
  BlindExpirationEvent,
  SilenceExpirationEvent,
  CurseExpirationEvent,
  WeakenExpirationEvent,
  FuryExpirationEvent,
  EnrageTickEvent,
  EnemyRespawnEvent,
  PlayerRespawnEvent,
  CombatStartEvent,
  CooldownReadyEvent,
  AwaitCooldownEvent,
  CheckBuffExpirationEvent,
} from "./events/index";

import {
  ONE_SECOND,
  HOT_TICK_INTERVAL,
  DOT_TICK_INTERVAL,
  REGEN_TICK_INTERVAL,
  ENEMY_RESPAWN_INTERVAL,
  DUNGEON_WAVE_RESPAWN_INTERVAL,
  PLAYER_RESPAWN_INTERVAL,
  RESTART_INTERVAL,
  ENRAGE_TICK_INTERVAL,
  BATTLES_PER_BOSS,
  DEFAULT_ENCOUNTER_TRANSITION_DELAY,
} from "./constants";
import type Trigger from "./trigger";

// =============================================================================
// Configuration
// =============================================================================

export interface DeterministicSimConfig {
  /** Stop after the first encounter (for testing). */
  stopAfterFirstEncounter?: boolean;
  /**
   * Wisdom buff bonus (MooPass + community buff) - added to combatExperience.
   * In-game these are `/buff_types/wisdom` buffs with flatBoost values.
   * Default 0.
   */
  wisdomBuffBonus?: number;
  /**
   * Additional XP multiplier for sources that are truly multiplicative
   * (not part of combatExperience). Default 1.0.
   */
  additionalXpMultiplier?: number;
  /**
   * For dungeons: stop after this many completed dungeon runs.
   * Using a fixed count ensures deterministic results across runs.
   * Default 5. The encounter schedule has period 100, so multiples
   * of 100 give the most stable averages.
   */
  maxDungeonRuns?: number;
  /**
   * For labyrinth fights: set the labyrinth target level on all spawned
   * monsters. When set, monsters use proportional scaling (targetLevel/100)
   * instead of tier-based scaling.
   */
  labyrinthTargetLevel?: number;
  /**
   * Hard time limit for the simulation (nanoseconds). Events after this
   * are not processed. Used for labyrinth fights (120s limit).
   * When set, overkill time correction is also skipped since the actual
   * fight duration matters.
   */
  maxSimTimeNs?: number;
  /**
   * Extra delay (in nanoseconds) added between non-dungeon encounters to
   * model unaccounted game overhead (server processing, drink triggers,
   * loot generation, etc.). This delay is added ON TOP of the normal
   * ENEMY_RESPAWN_INTERVAL for regular zone encounters only.
   *
   * Empirical calibration against game data suggests ~5.25 seconds
   * accounts for the gap between simulated and observed encounter rates.
   * Default: DEFAULT_ENCOUNTER_TRANSITION_DELAY (5.25s).
   * Set to 0 to disable.
   */
  encounterTransitionDelay?: number;
  /**
   * When true, zero out taskDamage on all players. Labyrinth monsters
   * are not combat task targets, so the task damage bonus from equipment
   * (e.g. expert_task_badge) should not apply.
   */
  isLabyrinth?: boolean;
}

// =============================================================================
// FuryExpirationEvent augmented with cancelled flag
// =============================================================================

interface CancellableFuryEvent extends FuryExpirationEvent {
  cancelled?: boolean;
}

/**
 * Wrapper class that adapts our Ability constructor signature
 * (gameData, hrid, level, triggers) to match the Monster deps
 * signature (hrid, gameData, level, triggers).
 */
class AbilityAdapter {
  private gameData: GameData;

  constructor(gameData: GameData) {
    this.gameData = gameData;
  }

  /**
   * Returns a constructor function with the signature Monster expects:
   * new (hrid, gameData, level?, triggers?) => Ability
   */
  getConstructor(): new (
    hrid: string,
    gameData: GameData,
    level?: number,
    triggers?: Trigger[] | null
  ) => Ability {
    const gd = this.gameData;
    // Create a class that wraps Ability with the swapped parameter order
    return class extends Ability {
      constructor(
        hrid: string,
        _gameData: GameData,
        level?: number,
        triggers?: Trigger[] | null
      ) {
        super(gd, hrid, level, triggers);
      }
    } as unknown as new (
      hrid: string,
      gameData: GameData,
      level?: number,
      triggers?: Trigger[] | null
    ) => Ability;
  }
}

// =============================================================================
// DeterministicSimulator
// =============================================================================

class DeterministicSimulator {
  private players: Player[];
  private zone: Zone;
  private gameData: GameData;
  private eventQueue: EventQueue;
  private simResult: SimResult;
  private cycleDetector: CycleDetector;

  private simulationTime: number = 0;
  private enemies: CombatUnit[] | null = null;
  private allPlayersDead: boolean = false;
  private enrageBeginTime: number = 0;
  private tempDungeonCount: number = 0;

  /** Track encounter count within the current boss cycle (for non-dungeon zones). */
  private encounterCountInCycle: number = 0;
  /** Total encounters completed across all cycles. */
  private totalEncountersCompleted: number = 0;
  /** XP accumulated in the current cycle (for cycle detection). */
  private cycleXp: number = 0;
  /** Sim time at start of current cycle (for cycle detection). */
  private cycleStartTime: number = 0;
  /** DEBUG: raw monster XP accumulator for the current dungeon run. */
  private dungeonRawXp: number = 0;

  /** The encounter distribution for this zone. */
  private encounterDistribution: EncounterDistribution | null = null;

  /** Pre-built schedule of encounter compositions weighted by probability. */
  private encounterSchedule: EncounterComposition[] = [];
  /** Index into encounterSchedule for regular (non-boss) encounters. */
  private regularEncounterIndex: number = 0;
  /** Index for cycling through dungeon wave compositions. */
  private dungeonWaveIndex: number = 0;
  /** Cached dungeon wave schedules by spawn-phase key. */
  private dungeonWaveScheduleCache: Map<string, EncounterComposition[]> =
    new Map();
  /** Sim time when the current encounter started (for kill time tracking). */
  private encounterStartTime: number = 0;

  /** Overkill tracking: total pre-clamp damage dealt to monsters this encounter. */
  private encounterPreClampDamage: number = 0;
  /** Overkill tracking: total post-clamp damage dealt to monsters this encounter. */
  private encounterPostClampDamage: number = 0;
  /** Cumulative overkill time correction (nanoseconds) across all encounters. */
  private cumulativeOverkillTimeNs: number = 0;

  /** Sim time at the last dungeon completion (for accurate measurement). */
  private lastDungeonCompletionTime: number = 0;
  /** XP snapshot at the last dungeon completion boundary. */
  private xpAtLastDungeonCompletion: Record<string, ExperienceBreakdown> = {};

  private readonly config: DeterministicSimConfig;

  /** Ability adapter for Monster construction. */
  private readonly abilityAdapter: AbilityAdapter;

  // Track CC delays per unit, separated by type so that blind only delays
  // auto-attacks and silence only delays abilities (stun delays both).
  private stunDelayMap: WeakMap<CombatUnit, number> = new WeakMap();
  private blindDelayMap: WeakMap<CombatUnit, number> = new WeakMap();
  private silenceDelayMap: WeakMap<CombatUnit, number> = new WeakMap();

  /**
   * Round-robin targeting counter per monster. Each monster cycles through
   * alive player targets, selecting one per attack. This models the real
   * game's random targeting (which distributes evenly over time) without
   * the artifact of smooth distribution where ALL players take damage
   * simultaneously, inflating healing overhead.
   */
  private monsterTargetCounters: Map<CombatUnit, number> = new Map();

  constructor(
    players: Player[],
    zone: Zone,
    gameData: GameData,
    config: DeterministicSimConfig = {}
  ) {
    this.players = players;
    this.zone = zone;
    this.gameData = gameData;
    this.config = config;
    this.eventQueue = new EventQueue();
    this.simResult = new SimResult(
      zone.hrid,
      zone.difficultyTier,
      zone.isDungeon,
      players.length
    );
    this.cycleDetector = new CycleDetector();
    this.abilityAdapter = new AbilityAdapter(gameData);
  }

  // ===========================================================================
  // Main simulation entry point
  // ===========================================================================

  simulate(): SimResult {
    this.reset();

    // Apply zone buffs to all players (e.g., Pirate Cove +20% wisdom)
    if (this.zone.buffs) {
      for (const player of this.players) {
        player.zoneBuffs = this.zone.buffs.map((bd) => new Buff(bd));
      }
    }

    // In labyrinth mode, suppress taskDamage on all players — labyrinth
    // monsters are not combat task targets, so the task damage bonus from
    // equipment (e.g. expert_task_badge) should not apply.
    if (this.config.isLabyrinth) {
      for (const player of this.players) {
        player.suppressTaskDamage = true;
        // House and achievement action buffs are scoped by the game's root
        // action type. Combat-only buffs do not apply inside labyrinth.
        player.actionTypeHrid = "/action_types/labyrinth";
      }
    }

    // Initialize player stats in SimResult
    for (const player of this.players) {
      this.simResult.initPlayer(player.hrid);
      this.simResult.setLootMultipliers(
        player.hrid,
        1 + player.combatDetails.combatStats.combatDropRate,
        1 + player.combatDetails.combatStats.combatRareFind,
        player.combatDetails.combatStats.combatDropQuantity,
        player.debuffOnLevelGap ?? 0
      );
    }

    // Pre-compute encounter distribution for non-dungeon zones
    if (!this.zone.isDungeon) {
      this.encounterDistribution = this.zone.getAllEncounterCompositions();
      this.encounterSchedule = this.buildEncounterSchedule(
        this.encounterDistribution.randomEncounters
      );
    }

    // Start the simulation
    const combatStartEvent = new CombatStartEvent(0);
    this.eventQueue.addEvent(combatStartEvent);

    // Safety limits to prevent UI freezing
    const MAX_EVENTS = 10_000_000;
    const MAX_WALL_CLOCK_MS = 30_000; // 30 seconds safety fallback
    const MAX_SIM_TIME_NS = 3_600_000_000_000 * 24; // 24 hours sim time max
    const maxDungeonRuns = this.config.maxDungeonRuns ?? 5;
    const wallClockStart = Date.now();
    let eventCount = 0;

    while (!this.cycleDetector.isAtLimit()) {
      const nextEvent = this.eventQueue.getNextEvent();
      if (!nextEvent) break;

      this.simulationTime = nextEvent.time;

      // Hard caller-specified time limit (e.g., labyrinth 120s)
      if (this.config.maxSimTimeNs != null && this.simulationTime > this.config.maxSimTimeNs) {
        break;
      }

      this.processEvent(nextEvent);

      if (
        this.config.stopAfterFirstEncounter &&
        (this.simResult.encounters > 0 || this.allPlayersDead)
      ) {
        break;
      }

      // For dungeons: stop after a fixed number of completed runs
      // so that results are deterministic regardless of CPU speed.
      if (this.zone.isDungeon && this.zone.dungeonsCompleted >= maxDungeonRuns) {
        break;
      }

      eventCount++;

      // Check safety limits periodically (every 10k events to avoid perf hit)
      if (eventCount % 10_000 === 0) {
        if (eventCount >= MAX_EVENTS) break;
        if (Date.now() - wallClockStart > MAX_WALL_CLOCK_MS) break;
      }

      // Hard sim-time limit
      if (this.simulationTime > MAX_SIM_TIME_NS) break;
    }

    // For dungeons with completed runs, use only complete-dungeon data
    // to avoid skewing XP/hr with partial dungeon progress (earlier
    // waves have lower XP than later waves, inflating the rate).
    if (
      this.zone.isDungeon &&
      this.zone.dungeonsCompleted > 0 &&
      this.lastDungeonCompletionTime > 0
    ) {
      // Don't apply overkill correction when a hard time limit is set (labyrinth fights)
      const dungeonOverkillAdj = this.config.maxSimTimeNs != null ? 0 : this.cumulativeOverkillTimeNs;
      this.simResult.totalSimTimeNs = this.lastDungeonCompletionTime - dungeonOverkillAdj;
      // Replace accumulated XP with the snapshot at dungeon completion
      for (const player of this.players) {
        const completionXp = this.xpAtLastDungeonCompletion[player.hrid];
        if (completionXp) {
          const stats = this.simResult.playerStats[player.hrid];
          if (stats) {
            stats.experienceGained = { ...completionXp };
          }
        }
      }
      // Update encounter count to only include complete dungeons
      this.simResult.encounters =
        this.zone.dungeonsCompleted * this.zone.getMaxWaves();
    } else {
      // Don't apply overkill correction when a hard time limit is set (labyrinth fights)
      const overkillAdj = this.config.maxSimTimeNs != null ? 0 : this.cumulativeOverkillTimeNs;
      this.simResult.totalSimTimeNs = this.simulationTime - overkillAdj;
    }

    // Update loot multipliers (may have changed due to buffs during sim)
    for (const player of this.players) {
      this.simResult.setLootMultipliers(
        player.hrid,
        1 + player.combatDetails.combatStats.combatDropRate,
        1 + player.combatDetails.combatStats.combatRareFind,
        player.combatDetails.combatStats.combatDropQuantity,
        player.debuffOnLevelGap ?? 0
      );
    }

    if (this.zone.isDungeon) {
      this.simResult.dungeonsCompleted = this.zone.dungeonsCompleted;
      this.simResult.dungeonsFailed = this.zone.dungeonsFailed;
    }

    // Diagnostic: end-of-sim summary
    {
      const hoursElapsed = this.simResult.totalSimTimeNs / 3.6e12;
      const totalEncounters = this.simResult.encounters;
      console.log(`[DIAG] Simulation complete: zone=${this.zone.hrid} tier=${this.zone.difficultyTier}`);
      console.log(`  simTime=${(this.simResult.totalSimTimeNs / 1e9).toFixed(1)}s (${hoursElapsed.toFixed(3)}hr) encounters=${totalEncounters} kills/hr=${(totalEncounters / hoursElapsed).toFixed(1)}`);
      const rawSimTimeNs = this.zone.isDungeon && this.lastDungeonCompletionTime > 0
        ? this.lastDungeonCompletionTime
        : this.simulationTime;
      const overkillPct = rawSimTimeNs > 0 ? (this.cumulativeOverkillTimeNs / rawSimTimeNs * 100) : 0;
      console.log(`  overkillCorrection=${(this.cumulativeOverkillTimeNs / 1e9).toFixed(1)}s (${overkillPct.toFixed(1)}% of raw sim time)`);
      console.log(`  cycles=${this.cycleDetector.getSnapshotCount()}`);
      for (const player of this.players) {
        const stats = this.simResult.playerStats[player.hrid];
        if (stats) {
          const totalXp = Object.values(stats.experienceGained).reduce((a, b) => a + b, 0);
          const xpPerHour = totalXp / hoursElapsed;
          const deaths = stats.deaths;
          const deadTimeSec = stats.totalDeadTimeNs / 1e9;
          const aliveSeconds = (this.simResult.totalSimTimeNs - stats.totalDeadTimeNs) / 1e9;
          const postClampDps = aliveSeconds > 0 ? stats.totalDamageDealt / aliveSeconds : 0;
          const preClampDps = aliveSeconds > 0 ? stats.totalPreClampDamageDealt / aliveSeconds : 0;
          const overkillPctPlayer = stats.totalPreClampDamageDealt > 0
            ? ((1 - stats.totalDamageDealt / stats.totalPreClampDamageDealt) * 100)
            : 0;
          console.log(`  ${player.hrid}: totalXp=${Math.round(totalXp)} xp/hr=${Math.round(xpPerHour)} deaths=${deaths} deadTime=${deadTimeSec.toFixed(0)}s postClampDps=${postClampDps.toFixed(1)} preClampDps=${preClampDps.toFixed(1)} overkill=${overkillPctPlayer.toFixed(1)}%`);
          console.log(`    xpBreakdown=${JSON.stringify(Object.fromEntries(Object.entries(stats.experienceGained).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)])))}`);
        }
      }
    }

    return this.simResult;
  }

  // ===========================================================================
  // Reset
  // ===========================================================================

  private reset(): void {
    this.tempDungeonCount = 0;
    this.simulationTime = 0;
    this.eventQueue.clear();
    this.simResult = new SimResult(
      this.zone.hrid,
      this.zone.difficultyTier,
      this.zone.isDungeon,
      this.players.length
    );
    this.cycleDetector.reset();
    this.encounterCountInCycle = 0;
    this.totalEncountersCompleted = 0;
    this.cycleXp = 0;
    this.cycleStartTime = 0;
    this.dungeonRawXp = 0;
    this.stunDelayMap = new WeakMap();
    this.blindDelayMap = new WeakMap();
    this.silenceDelayMap = new WeakMap();
    this.encounterSchedule = [];
    this.regularEncounterIndex = 0;
    this.dungeonWaveIndex = 0;
    this.dungeonWaveScheduleCache = new Map();
    this.encounterStartTime = 0;
    this.encounterPreClampDamage = 0;
    this.encounterPostClampDamage = 0;
    this.cumulativeOverkillTimeNs = 0;
    this.lastDungeonCompletionTime = 0;
    this.xpAtLastDungeonCompletion = {};
  }

  // ===========================================================================
  // CC Delay helpers (separated by type)
  // ===========================================================================
  //
  // In the real game:
  //   - Stun: cancels ALL pending actions (auto-attacks AND abilities)
  //   - Blind: cancels only auto-attacks (abilities keep casting)
  //   - Silence: cancels only abilities (auto-attacks keep going)
  //
  // We model this by keeping separate delay accumulators per CC type and
  // consuming only the relevant types when scheduling the next action:
  //   - For abilities: consume stun + silence delays
  //   - For auto-attacks: consume stun + blind delays

  private addStunDelay(unit: CombatUnit, delay: number): void {
    const current = this.stunDelayMap.get(unit) ?? 0;
    this.stunDelayMap.set(unit, current + delay);
  }

  private addBlindDelay(unit: CombatUnit, delay: number): void {
    const current = this.blindDelayMap.get(unit) ?? 0;
    this.blindDelayMap.set(unit, current + delay);
  }

  private addSilenceDelay(unit: CombatUnit, delay: number): void {
    const current = this.silenceDelayMap.get(unit) ?? 0;
    this.silenceDelayMap.set(unit, current + delay);
  }

  /** Consume CC delays relevant to ability casts: stun + silence. */
  private consumeAbilityCcDelay(unit: CombatUnit): number {
    const stun = this.stunDelayMap.get(unit) ?? 0;
    const silence = this.silenceDelayMap.get(unit) ?? 0;
    this.stunDelayMap.set(unit, 0);
    this.silenceDelayMap.set(unit, 0);
    return stun + silence;
  }

  /** Consume CC delays relevant to auto-attacks: stun + blind. */
  private consumeAutoAttackCcDelay(unit: CombatUnit): number {
    const stun = this.stunDelayMap.get(unit) ?? 0;
    const blind = this.blindDelayMap.get(unit) ?? 0;
    this.stunDelayMap.set(unit, 0);
    this.blindDelayMap.set(unit, 0);
    return stun + blind;
  }

  // ===========================================================================
  // Event dispatch
  // ===========================================================================

  private processEvent(event: CombatEvent): void {
    this.simulationTime = event.time;

    switch (event.type) {
      case CombatEventType.CombatStart:
        this.processCombatStartEvent(event as CombatStartEvent);
        break;
      case CombatEventType.PlayerRespawn:
        this.processPlayerRespawnEvent(event as PlayerRespawnEvent);
        break;
      case CombatEventType.EnemyRespawn:
        this.processEnemyRespawnEvent();
        break;
      case CombatEventType.AutoAttack:
        this.processAutoAttackEvent(event as AutoAttackEvent);
        break;
      case CombatEventType.ConsumableTick:
        this.processConsumableTickEvent(event as ConsumableTickEvent);
        break;
      case CombatEventType.DamageOverTime:
        this.processDamageOverTimeTickEvent(event as DamageOverTimeEvent);
        break;
      case CombatEventType.CheckBuffExpiration:
        this.processCheckBuffExpirationEvent(
          event as CheckBuffExpirationEvent
        );
        break;
      case CombatEventType.RegenTick:
        this.processRegenTickEvent();
        break;
      case CombatEventType.StunExpiration:
        this.processStunExpirationEvent(event as StunExpirationEvent);
        break;
      case CombatEventType.BlindExpiration:
        this.processBlindExpirationEvent(event as BlindExpirationEvent);
        break;
      case CombatEventType.SilenceExpiration:
        this.processSilenceExpirationEvent(event as SilenceExpirationEvent);
        break;
      case CombatEventType.CurseExpiration:
        this.processCurseExpirationEvent(event as CurseExpirationEvent);
        break;
      case CombatEventType.WeakenExpiration:
        this.processWeakenExpirationEvent(event as WeakenExpirationEvent);
        break;
      case CombatEventType.FuryExpiration:
        this.processFuryExpirationEvent(event as CancellableFuryEvent);
        break;
      case CombatEventType.EnrageTick:
        this.processEnrageTickEvent(event as EnrageTickEvent);
        break;
      case CombatEventType.AbilityCastEnd: {
        const aceEvent = event as AbilityCastEndEvent;
        this.tryUseAbility(aceEvent.source as CombatUnit, aceEvent.ability as Ability);
        break;
      }
      case CombatEventType.AwaitCooldown: {
        const awEvent = event as AwaitCooldownEvent;
        this.addNextAttackEvent(awEvent.source as CombatUnit);
        break;
      }
      case CombatEventType.CooldownReady:
        // Only used to check triggers
        break;
    }

    this.checkTriggers();
  }

  // ===========================================================================
  // Combat Start
  // ===========================================================================

  private processCombatStartEvent(event: CombatStartEvent): void {
    for (let i = 0; i < this.players.length; i++) {
      if (event.time === 0) {
        this.players[i].generatePermanentBuffs();
      }
      this.players[i].reset(this.simulationTime);
    }

    // Diagnostic: log player stats after full initialization
    if (event.time === 0) {
      for (const player of this.players) {
        const cs = player.combatDetails.combatStats;
        const cd = player.combatDetails;
        console.log(`[DIAG] Player ${player.hrid} stats after init:`);
        console.log(`  maxHP=${cd.maxHitpoints} maxMP=${cd.maxManapoints}`);
        console.log(`  combatExperience=${cs.combatExperience.toFixed(4)} wisdomBuffBonus=${player.wisdomBuffBonus.toFixed(4)} additionalXpMult=${player.additionalXpMultiplier.toFixed(4)}`);
        console.log(`  attackInterval=${cs.attackInterval.toFixed(1)}ns attackSpeed=${cs.attackSpeed.toFixed(4)} castSpeed=${cs.castSpeed.toFixed(4)}`);
        console.log(`  combatStyle=${cs.combatStyleHrid} damageType=${cs.damageType}`);
        console.log(`  primaryTraining=${cs.primaryTraining} focusTraining=${cs.focusTraining}`);
        console.log(`  debuffOnLevelGap=${player.debuffOnLevelGap ?? 'undefined'}`);
        const style = cs.combatStyleHrid.split('/').pop();
        console.log(`  ${style}AccuracyRating=${(cd as any)[style + 'AccuracyRating']?.toFixed(1)} ${style}MaxDamage=${(cd as any)[style + 'MaxDamage']?.toFixed(1)}`);
        console.log(`  totalArmor=${cd.totalArmor.toFixed(1)} critRate=${cs.criticalRate.toFixed(4)} critDamage=${cs.criticalDamage.toFixed(4)}`);
        console.log(`  hpRegen=${cs.hpRegenPer10.toFixed(1)} mpRegen=${cs.mpRegenPer10.toFixed(1)}`);
        console.log(`  lifeSteal=${cs.lifeSteal.toFixed(4)} parry=${cs.parry.toFixed(4)}`);
      }
    }

    const regenTickEvent = new RegenTickEvent(
      this.simulationTime + REGEN_TICK_INTERVAL
    );
    this.eventQueue.addEvent(regenTickEvent);

    this.startNewEncounter();
  }

  // ===========================================================================
  // Player Respawn
  // ===========================================================================

  private processPlayerRespawnEvent(event: PlayerRespawnEvent): void {
    const respawningPlayer = this.players.find(
      (player) => player.hrid === event.hrid
    );
    if (!respawningPlayer) return;

    respawningPlayer.combatDetails.currentHitpoints =
      respawningPlayer.combatDetails.maxHitpoints;
    respawningPlayer.combatDetails.currentManapoints =
      respawningPlayer.combatDetails.maxManapoints;
    respawningPlayer.clearBuffs();
    respawningPlayer.clearCCs();

    if (this.allPlayersDead) {
      this.allPlayersDead = false;
      this.startAttacks();
    } else {
      this.addNextAttackEvent(respawningPlayer);
    }
  }

  // ===========================================================================
  // Enemy Respawn
  // ===========================================================================

  private processEnemyRespawnEvent(): void {
    this.startNewEncounter();
  }

  // ===========================================================================
  // Start New Encounter
  // ===========================================================================

  private startNewEncounter(): void {
    if (this.allPlayersDead) {
      this.allPlayersDead = false;
      this.zone.failWave();
    }

    if (!this.zone.isDungeon) {
      this.enemies = this.spawnEncounterFromDistribution();
    } else {
      this.enemies = this.spawnDungeonWave();

      const currentDungeonCount = this.zone.dungeonsCompleted;
      if (currentDungeonCount > this.tempDungeonCount) {
        // A dungeon just completed. Record the boundary time and XP
        // snapshot for accurate per-dungeon measurement.
        this.lastDungeonCompletionTime = this.simulationTime;
        this.xpAtLastDungeonCompletion = {};
        for (const player of this.players) {
          const stats = this.simResult.playerStats[player.hrid];
          if (stats) {
            this.xpAtLastDungeonCompletion[player.hrid] = {
              ...stats.experienceGained,
            };
          }
        }

        this.tempDungeonCount = currentDungeonCount;

        // Reset players to full HP/MP for the new dungeon
        for (const player of this.players) {
          player.combatDetails.currentHitpoints =
            player.combatDetails.maxHitpoints;
          player.combatDetails.currentManapoints =
            player.combatDetails.maxManapoints;
        }

        // Dungeon cycle detection: after each complete dungeon, take a
        // snapshot. Since players reset to full HP/MP, the fingerprint
        // is always the same → steady state detected after 2nd dungeon.
        const playerStates = this.players.map((p) => ({
          hrid: p.hrid,
          currentHp: p.combatDetails.currentHitpoints,
          currentMp: p.combatDetails.currentManapoints,
        }));
        const cycleTimeNs = this.simulationTime - this.cycleStartTime;
        const snapshot = createCycleSnapshot(
          playerStates,
          this.cycleXp,
          cycleTimeNs
        );
        this.cycleDetector.addSnapshot(snapshot);
        this.cycleXp = 0;
        this.cycleStartTime = this.simulationTime;
      }
    }

    if (this.enemies) {
      for (const enemy of this.enemies) {
        enemy.reset(this.simulationTime);
      }

    }

    this.encounterStartTime = this.simulationTime;
    this.encounterPreClampDamage = 0;
    this.encounterPostClampDamage = 0;
    this.monsterTargetCounters.clear();

    this.eventQueue.clearEventsOfType(CombatEventType.EnrageTick);
    const enrageTickEvent = new EnrageTickEvent(
      this.simulationTime + ENRAGE_TICK_INTERVAL,
      ENRAGE_TICK_INTERVAL
    );
    this.eventQueue.addEvent(enrageTickEvent);
    this.enrageBeginTime = this.simulationTime;

    this.eventQueue.clearEventsOfType(CombatEventType.AbilityCastEnd);

    // Reference startNewEncounter runs trigger evaluation at the encounter
    // boundary, then starts attacks. This is not pre-casting during the
    // respawn gap: any cast begins now, after the delay has elapsed.
    this.checkTriggers();
    this.startAttacks();
  }

  // ===========================================================================
  // Encounter spawning helpers
  // ===========================================================================

  /**
   * Spawns monsters for a non-dungeon encounter.
   *
   * Strategy: Use the most probable encounter composition from the
   * pre-computed distribution. For boss cycles, alternate between
   * BATTLES_PER_BOSS-1 random encounters and 1 boss encounter.
   */
  private spawnEncounterFromDistribution(): CombatUnit[] {
    if (!this.encounterDistribution) {
      return [];
    }

    let composition: EncounterComposition | null = null;

    // Check if this is a boss encounter
    if (
      this.encounterDistribution.bossEncounter &&
      this.encounterCountInCycle >=
        this.encounterDistribution.battlesPerBoss - 1
    ) {
      composition = this.encounterDistribution.bossEncounter;
      this.encounterCountInCycle = 0;
    } else {
      // Cycle through encounter schedule (weighted by probability)
      if (this.encounterSchedule.length > 0) {
        const idx = this.regularEncounterIndex % this.encounterSchedule.length;
        composition = this.encounterSchedule[idx];
        this.regularEncounterIndex++;
      } else {
        composition = this.getMostProbableEncounter(
          this.encounterDistribution.randomEncounters
        );
      }
      this.encounterCountInCycle++;
    }

    if (!composition || composition.monsters.length === 0) {
      return [];
    }

    return this.createMonstersFromComposition(composition.monsters);
  }

  /**
   * Spawns monsters for a dungeon wave.
   *
   * For fixed waves (1 composition, i.e. boss waves), spawns directly.
   * For random waves (multiple compositions), cycles through a
   * pre-built schedule that matches the probability distribution.
   * This avoids the bias of always picking the most probable
   * composition (which tends to have more HP and XP than average).
   */
  private spawnDungeonWave(): CombatUnit[] {
    const waveCompositions = this.zone.getNextWave();

    if (!waveCompositions || waveCompositions.length === 0) {
      return [];
    }

    // Fixed boss waves: exactly one composition, use it directly.
    if (waveCompositions.length === 1) {
      const composition = waveCompositions[0];
      if (composition.monsters.length === 0) return [];
      return this.createMonstersFromComposition(composition.monsters);
    }

    // Random waves: use encounter schedule that distributes
    // compositions according to their probabilities.
    // Cache the schedule per phase (keyed by the composition set).
    const cacheKey = waveCompositions
      .map((c) => c.monsters.map((m) => m.hrid).sort().join(",") + ":" + c.probability.toFixed(4))
      .sort()
      .join("|");

    let schedule = this.dungeonWaveScheduleCache.get(cacheKey);
    if (!schedule) {
      schedule = this.buildEncounterSchedule(waveCompositions);
      this.dungeonWaveScheduleCache.set(cacheKey, schedule);
    }

    const idx = this.dungeonWaveIndex % schedule.length;
    this.dungeonWaveIndex++;
    const composition = schedule[idx];

    if (!composition || composition.monsters.length === 0) {
      return [];
    }

    return this.createMonstersFromComposition(composition.monsters);
  }

  /**
   * Returns the encounter composition with the highest probability.
   */
  private getMostProbableEncounter(
    encounters: EncounterComposition[]
  ): EncounterComposition | null {
    if (encounters.length === 0) return null;

    let best = encounters[0];
    for (let i = 1; i < encounters.length; i++) {
      if (encounters[i].probability > best.probability) {
        best = encounters[i];
      }
    }
    return best;
  }

  /**
   * Builds a deterministic encounter schedule where each composition appears
   * proportionally to its probability. This ensures the sim fights a
   * representative mix of encounters instead of always the most probable one.
   */
  private buildEncounterSchedule(
    encounters: EncounterComposition[]
  ): EncounterComposition[] {
    if (encounters.length === 0) return [];
    if (encounters.length === 1) return [encounters[0]];

    const CYCLE_LENGTH = 100;
    const sorted = [...encounters].sort((a, b) => b.probability - a.probability);
    const totalProb = sorted.reduce((sum, e) => sum + e.probability, 0);

    const schedule: EncounterComposition[] = [];
    let remaining = CYCLE_LENGTH;

    for (let i = 0; i < sorted.length; i++) {
      const enc = sorted[i];
      const count =
        i === sorted.length - 1
          ? remaining // Last composition gets whatever's left
          : Math.max(1, Math.round((enc.probability / totalProb) * CYCLE_LENGTH));

      for (let j = 0; j < count && remaining > 0; j++) {
        schedule.push(enc);
        remaining--;
      }
    }

    return schedule;
  }

  /**
   * Creates Monster instances from encounter monster references.
   */
  private createMonstersFromComposition(
    monsterRefs: EncounterMonsterRef[]
  ): CombatUnit[] {
    const monsters: CombatUnit[] = [];
    for (const ref of monsterRefs) {
      const monster = new Monster(
        ref.hrid,
        this.gameData,
        ref.difficultyTier,
        { Ability: this.abilityAdapter.getConstructor() }
      );
      // Apply labyrinth scaling if configured
      if (this.config.labyrinthTargetLevel != null) {
        monster.setLabyrinthTargetLevel(this.config.labyrinthTargetLevel);
      }
      monsters.push(monster);
    }
    return monsters;
  }

  // ===========================================================================
  // Start Attacks
  // ===========================================================================

  private startAttacks(): void {
    const units: CombatUnit[] = [...this.players];
    if (this.enemies) {
      units.push(...this.enemies);
    }

    for (const unit of units) {
      if (unit.combatDetails.currentHitpoints <= 0) {
        continue;
      }
      this.addNextAttackEvent(unit);
    }
  }
  // ===========================================================================
  // Auto Attack (DETERMINISTIC)
  // ===========================================================================

  private processAutoAttackEvent(event: AutoAttackEvent): void {
    const source: CombatUnit = event.source;

    const targets: CombatUnit[] | null = source.isPlayer
      ? this.enemies
      : this.players;

    if (!targets) return;

    const aliveTargets = targets.filter(
      (unit) => unit && unit.combatDetails.currentHitpoints > 0
    );
    if (aliveTargets.length === 0) return;

    // Monster → multiple players: round-robin targeting
    // Each monster cycles through alive targets, selecting ONE per attack.
    // This preserves single-target dynamics (CC, triggers, food/drink)
    // while distributing damage evenly over time — matching the real game's
    // random targeting without the smooth-distribution artifact that inflates healing.
    let target = aliveTargets[0];
    if (!source.isPlayer && aliveTargets.length > 1) {
      target = this.selectMonsterTarget(source, aliveTargets);
    }

    // Deterministic parry: reduces incoming damage and deals counter-damage.
    // In the game, parry picks a random defending unit with parry > 0; if its
    // parry chance succeeds, the attack is redirected (parrying unit attacks
    // the original attacker instead). Expected parry probability = avg(parry_i).
    const parryChance = CombatUtilities.expectedParryChance(targets);

    // Compute the attack result
    const attackResult = CombatUtilities.processAttack(source, target);

    // Scale damage by (1 - parryChance) since parry negates the attack
    const effectiveDamage = attackResult.damageDone * (1 - parryChance);

    // Apply damage to target
    const actualDamage = Math.min(
      effectiveDamage,
      target.combatDetails.currentHitpoints
    );
    target.combatDetails.currentHitpoints -= actualDamage;

    this.simResult.addDamageDealt(
      source.isPlayer ? source.hrid : "enemy",
      actualDamage
    );

    // Track damage taken by player
    if (target.isPlayer) {
      this.simResult.addDamageTaken(target.hrid, actualDamage);
    }

    // Overkill tracking for monsters
    if (!target.isPlayer) {
      this.encounterPreClampDamage += effectiveDamage;
      this.encounterPostClampDamage += actualDamage;
      if (source.isPlayer) {
        this.simResult.addPreClampDamageDealt(source.hrid, effectiveDamage);
      }
    }

    // Parry counter-damage: when parry triggers, the parrying unit attacks the
    // original attacker. Expected counter-damage per parry unit i =
    // (1/N) * parryChance_i * processAttack(unit_i, source).damageDone
    if (parryChance > 0) {
      const aliveParryUnits = targets.filter(
        (u) =>
          u &&
          u.combatDetails.currentHitpoints > 0 &&
          u.combatDetails.combatStats.parry > 0
      );
      const numParryUnits = aliveParryUnits.length;
      if (numParryUnits > 0) {
        for (const parryUnit of aliveParryUnits) {
          const unitParryChance =
            parryUnit.combatDetails.combatStats.parry / numParryUnits;
          const counterResult = CombatUtilities.processAttack(
            parryUnit,
            source
          );
          const counterDamage = Math.min(
            counterResult.damageDone * unitParryChance,
            source.combatDetails.currentHitpoints
          );
          if (counterDamage > 0) {
            source.combatDetails.currentHitpoints -= counterDamage;
            this.simResult.addDamageDealt(
              parryUnit.isPlayer ? parryUnit.hrid : "enemy",
              counterDamage
            );
          }
        }
      }
    }

    // Mayhem rolls once for this attack.  If it procs, each miss retries the
    // next target; it does *not* reroll mayhem at every hop.  Thus the first
    // retry is mayhem × miss and every later retry gains only another miss.
    const mayhemChance = source.combatDetails.combatStats.mayhem;
    if (mayhemChance > 0 && aliveTargets.length > 1) {
      const missProbability = 1 - attackResult.hitChance;
      let retryMult = mayhemChance * missProbability;
      for (const otherTarget of aliveTargets) {
        if (otherTarget === target) continue;
        if (retryMult < 0.001) break;

        // Every retry is a new attack against its own target. Its accuracy,
        // mitigation and damage can differ from the initial target. The
        // probability of reaching it is the Mayhem proc times the misses of
        // all preceding attempts; processAttack already includes this
        // retry's hit probability in damageDone.
        const retryResult = CombatUtilities.processAttack(source, otherTarget);
        const mayhemDamage =
          retryResult.damageDone * retryMult * (1 - parryChance);
        const actualMayhemDamage = Math.min(
          mayhemDamage,
          otherTarget.combatDetails.currentHitpoints
        );
        otherTarget.combatDetails.currentHitpoints -= actualMayhemDamage;

        this.simResult.addDamageDealt(
          source.isPlayer ? source.hrid : "enemy",
          actualMayhemDamage
        );

        // Track damage taken by player
        if (otherTarget.isPlayer) {
          this.simResult.addDamageTaken(otherTarget.hrid, actualMayhemDamage);
        }

        // Overkill tracking for monsters
        if (!otherTarget.isPlayer) {
          this.encounterPreClampDamage += mayhemDamage;
          this.encounterPostClampDamage += actualMayhemDamage;
          if (source.isPlayer) {
            this.simResult.addPreClampDamageDealt(source.hrid, mayhemDamage);
          }
        }

        if (otherTarget.combatDetails.currentHitpoints <= 0) {
          otherTarget.combatDetails.currentHitpoints = 0;
          this.eventQueue.clearEventsForUnit(otherTarget);
        }
        retryMult *= 1 - retryResult.hitChance;
      }
    }

    // Pierce is a hit-and-pierce chain. The probability of reaching the next
    // target is this attack's hit × pierce; that target still needs its own
    // attack calculation (its evasion and mitigation may differ).
    const pierceChance = source.combatDetails.combatStats.pierce;
    if (pierceChance > 0 && aliveTargets.length > 1) {
      let pierceMult = attackResult.hitChance * pierceChance;
      for (const nextTarget of aliveTargets) {
        if (nextTarget === target) continue;
        if (pierceMult <= 0.001) break;

        const pierceResult = CombatUtilities.processAttack(source, nextTarget);
        const pierceDamage = pierceResult.damageDone * pierceMult;
        const actualPierceDamage = Math.min(
          pierceDamage,
          nextTarget.combatDetails.currentHitpoints
        );
        nextTarget.combatDetails.currentHitpoints -= actualPierceDamage;

        this.simResult.addDamageDealt(
          source.isPlayer ? source.hrid : "enemy",
          actualPierceDamage
        );

        // Track damage taken by player
        if (nextTarget.isPlayer) {
          this.simResult.addDamageTaken(nextTarget.hrid, actualPierceDamage);
        }

        // Overkill tracking for monsters
        if (!nextTarget.isPlayer) {
          this.encounterPreClampDamage += pierceDamage;
          this.encounterPostClampDamage += actualPierceDamage;
          if (source.isPlayer) {
            this.simResult.addPreClampDamageDealt(source.hrid, pierceDamage);
          }
        }

        if (nextTarget.combatDetails.currentHitpoints <= 0) {
          nextTarget.combatDetails.currentHitpoints = 0;
          this.eventQueue.clearEventsForUnit(nextTarget);
        }

        pierceMult *= pierceResult.hitChance * pierceChance;
      }
    }

    // Life steal
    if (attackResult.lifeStealHealed > 0) {
      const healed = source.addHitpoints(
        attackResult.lifeStealHealed * (1 - parryChance)
      );
      this.simResult.addHealingReceived(source.hrid, "lifesteal", healed);
    }

    // Mana leech
    if (attackResult.manaLeechGained > 0) {
      source.addManapoints(attackResult.manaLeechGained * (1 - parryChance));
    }

    // Thorns (applied regardless of hit/miss in original)
    if (attackResult.thornDamageDone > 0) {
      const thornDamage = Math.min(
        attackResult.thornDamageDone,
        source.combatDetails.currentHitpoints
      );
      source.combatDetails.currentHitpoints -= thornDamage;
    }

    // Retaliation
    if (attackResult.retaliationDamageDone > 0) {
      const retDamage = Math.min(
        attackResult.retaliationDamageDone,
        source.combatDetails.currentHitpoints
      );
      source.combatDetails.currentHitpoints -= retDamage;
    }

    // CC as fractional delays (separated by type, with interruption penalty)
    if (attackResult.expectedStunDuration > 0) {
      this.addStunDelay(target, attackResult.expectedStunDuration);
    }
    if (attackResult.expectedBlindDuration > 0) {
      this.addBlindDelay(target, attackResult.expectedBlindDuration);
    }
    if (attackResult.expectedSilenceDuration > 0) {
      this.addSilenceDelay(target, attackResult.expectedSilenceDuration);
    }

    // Curse (deterministic stacking)
    this.applyCurse(source, target, attackResult);

    // Weaken (deterministic)
    this.applyWeaken(source, target, attackResult);

    // Fury (deterministic)
    this.applyFury(source, attackResult);

    // Check for deaths
    if (target.combatDetails.currentHitpoints <= 0) {
      target.combatDetails.currentHitpoints = 0;
      this.eventQueue.clearEventsForUnit(target);
    }

    if (
      source.combatDetails.currentHitpoints <= 0 &&
      (attackResult.thornDamageDone > 0 ||
        attackResult.retaliationDamageDone > 0)
    ) {
      source.combatDetails.currentHitpoints = 0;
      this.eventQueue.clearEventsForUnit(source);
    }

    if (!this.checkEncounterEnd()) {
      this.addNextAttackEvent(source);
    }
  }


  // ===========================================================================
  // Ability Cast End (DETERMINISTIC)
  // ===========================================================================

  private tryUseAbility(source: CombatUnit, ability: Ability): boolean {
    if (!this.canUseAbility(source, ability)) {
      this.addNextAttackEvent(source);
      return false;
    }

    // Track mana cost
    if (source.isPlayer) {
      if (source.abilityManaCosts.has(ability.hrid)) {
        source.abilityManaCosts.set(
          ability.hrid,
          source.abilityManaCosts.get(ability.hrid)! + ability.manaCost
        );
      } else {
        source.abilityManaCosts.set(ability.hrid, ability.manaCost);
      }
      this.simResult.addManaUsed(source.hrid, ability.hrid, ability.manaCost);
    }

    source.combatDetails.currentManapoints -= ability.manaCost;
    ability.lastUsed = this.simulationTime;

    const haste = source.combatDetails.combatStats.abilityHaste;
    let cooldownDuration = ability.cooldownDuration;
    if (haste > 0) {
      cooldownDuration = (cooldownDuration * 100) / (100 + haste);
    }

    // Build list of abilities to process (main + blaze/bloom procs)
    const todoAbilities: Ability[] = [ability];

    // Blaze: deterministic proc
    const blazeChance = source.combatDetails.combatStats.blaze;
    if (blazeChance > 0) {
      // Instead of randomly triggering, we scale blaze damage by blazeChance below
      // We still create the ability so effects are processed, but damage is scaled
      todoAbilities.push(new Ability(this.gameData, "blaze"));
    }

    // Bloom: deterministic proc
    const bloomChance = source.combatDetails.combatStats.bloom;
    if (bloomChance > 0) {
      todoAbilities.push(new Ability(this.gameData, "bloom"));
    }

    for (let abilIdx = 0; abilIdx < todoAbilities.length; abilIdx++) {
      const todoAbility = todoAbilities[abilIdx];
      // Determine proc scaling: main ability = 1.0, blaze/bloom = their chance
      let procScale = 1.0;
      if (abilIdx === 1 && blazeChance > 0) {
        procScale = blazeChance;
      } else if (abilIdx === 2 || (abilIdx === 1 && blazeChance <= 0)) {
        // bloom is 2nd if blaze exists, 1st otherwise
        if (todoAbility.hrid === "/abilities/bloom") {
          procScale = bloomChance;
        }
      }

      for (const abilityEffect of todoAbility.abilityEffects) {
        switch (abilityEffect.effectType) {
          case "/ability_effect_types/buff":
            this.processAbilityBuffEffect(source, todoAbility, abilityEffect);
            break;
          case "/ability_effect_types/damage":
            this.processAbilityDamageEffect(
              source,
              todoAbility,
              abilityEffect,
              procScale
            );
            break;
          case "/ability_effect_types/heal":
            this.processAbilityHealEffect(
              source,
              todoAbility,
              abilityEffect,
              procScale
            );
            break;
          case "/ability_effect_types/spend_hp":
            this.processAbilitySpendHpEffect(source, todoAbility, abilityEffect);
            break;
          case "/ability_effect_types/revive":
            this.processAbilityReviveEffect(source, todoAbility, abilityEffect);
            break;
          case "/ability_effect_types/promote":
            this.eventQueue.clearEventsForUnit(source);
            source = this.processAbilityPromoteEffect(source);
            this.addNextAttackEvent(source);
            break;
          default:
            // Unknown effect type - skip
            break;
        }
      }
    }

    // Ripple: deterministic proc
    const rippleChance = source.combatDetails.combatStats.ripple;
    if (rippleChance > 0) {
      const expectedManaRestore = rippleChance * 10;
      source.addManapoints(expectedManaRestore);

      // Cooldown reduction: expected = rippleChance * 2s per ability
      const expectedCdReduction = rippleChance * ONE_SECOND * 2;
      for (const abil of source.abilities) {
        if (abil && abil.lastUsed) {
          const remainingCooldown =
            abil.lastUsed + abil.cooldownDuration - this.simulationTime;
          if (remainingCooldown > 0) {
            abil.lastUsed = Math.max(
              abil.lastUsed - expectedCdReduction,
              this.simulationTime - abil.cooldownDuration
            );
          }
        }
      }
    }

    this.addNextAttackEvent(source);

    // Check if source died from reflect damage
    if (source.combatDetails.currentHitpoints <= 0) {
      source.combatDetails.currentHitpoints = 0;
      this.eventQueue.clearEventsForUnit(source);
    }

    this.checkEncounterEnd();

    return true;
  }

  // ===========================================================================
  // addNextAttackEvent (OOM BUG FIX)
  // ===========================================================================

  private addNextAttackEvent(source: CombatUnit): void {
    // Don't schedule if there's already a pending attack/cast for this unit
    if (
      this.eventQueue.getMatching(
        (event) =>
          (event.type === CombatEventType.AbilityCastEnd ||
            event.type === CombatEventType.AutoAttack) &&
          (event as CombatEvent & { source?: unknown }).source === source
      )
    ) {
      return;
    }

    let target: CombatUnit | null;
    let friendlies: CombatUnit[];
    let enemies: CombatUnit[] | null;

    if (source.isPlayer) {
      target = CombatUtilities.getTarget(this.enemies);
      friendlies = this.players;
      enemies = this.enemies;
    } else {
      target = CombatUtilities.getTarget(this.players);
      friendlies = this.enemies ?? [];
      enemies = this.players;
    }

    let usedAbility = false;
    let skipNextAbility = false;

    const abilities = source.abilities.filter(
      (ability: Ability | null): ability is Ability => ability != null
    );

    for (const ability of abilities) {
      if (usedAbility || skipNextAbility) break;

      if (
        ability.shouldTrigger(
          this.simulationTime,
          source,
          target,
          friendlies,
          enemies
        )
      ) {
        if (!this.canUseAbility(source, ability)) {
          skipNextAbility = true;
          continue;
        }

        let castDuration = ability.castDuration;
        castDuration /= 1 + source.combatDetails.combatStats.castSpeed;

        // Add CC delays that affect abilities: stun + silence (NOT blind)
        const ccDelay = this.consumeAbilityCcDelay(source);
        castDuration += ccDelay;

        const abilityCastEndEvent = new AbilityCastEndEvent(
          this.simulationTime + castDuration,
          source,
          ability
        );
        this.eventQueue.addEvent(abilityCastEndEvent);
        usedAbility = true;
      }
    }

    if (usedAbility) {
      source.isOutOfMana = false;
      return;
    }

    if (!enemies) {
      return;
    }

    // OOM BUG FIX: Always schedule auto-attack even when OOM.
    // The original skips auto-attack when isBlinded, causing a stall.
    // We still schedule auto-attacks since abilities were skipped.
    if (!source.isBlinded) {
      let attackInterval = source.combatDetails.combatStats.attackInterval;

      // Add CC delays that affect auto-attacks: stun + blind (NOT silence)
      const ccDelay = this.consumeAutoAttackCcDelay(source);
      attackInterval += ccDelay;

      const autoAttackEvent = new AutoAttackEvent(
        this.simulationTime + attackInterval,
        source
      );
      this.eventQueue.addEvent(autoAttackEvent);

      // Track OOM state but don't prevent auto-attacks
      if (skipNextAbility && source.isPlayer) {
        source.isOutOfMana = true;
      }
    } else {
      // Blinded: still schedule the auto-attack after blind expires
      // (the blind expiration event will re-trigger addNextAttackEvent)
      source.isOutOfMana = true;
    }
  }

  // ===========================================================================
  // Hit chance helper (for killing blow penalty)
  // ===========================================================================

  /**
   * Computes the hit chance of source attacking target, using the source's
   * combat style to determine the relevant accuracy and evasion ratings.
   */
  private computeHitChance(source: CombatUnit, target: CombatUnit): number {
    const combatStyle = source.combatDetails.combatStats.combatStyleHrid;
    let sourceAccuracy = 1;
    let targetEvasion = 1;

    switch (combatStyle) {
      case "/combat_styles/stab":
        sourceAccuracy = source.combatDetails.stabAccuracyRating;
        targetEvasion = target.combatDetails.stabEvasionRating;
        break;
      case "/combat_styles/slash":
        sourceAccuracy = source.combatDetails.slashAccuracyRating;
        targetEvasion = target.combatDetails.slashEvasionRating;
        break;
      case "/combat_styles/smash":
        sourceAccuracy = source.combatDetails.smashAccuracyRating;
        targetEvasion = target.combatDetails.smashEvasionRating;
        break;
      case "/combat_styles/ranged":
        sourceAccuracy = source.combatDetails.rangedAccuracyRating;
        targetEvasion = target.combatDetails.rangedEvasionRating;
        break;
      case "/combat_styles/magic":
        sourceAccuracy = source.combatDetails.magicAccuracyRating;
        targetEvasion = target.combatDetails.magicEvasionRating;
        break;
    }

    return (
      Math.pow(sourceAccuracy, 1.4) /
      (Math.pow(sourceAccuracy, 1.4) + Math.pow(targetEvasion, 1.4))
    );
  }

  // ===========================================================================
  // canUseAbility
  // ===========================================================================

  private canUseAbility(source: CombatUnit, ability: Ability): boolean {
    if (source.combatDetails.currentHitpoints <= 0) {
      return false;
    }
    if (source.combatDetails.currentManapoints < ability.manaCost) {
      return false;
    }
    return true;
  }

  // ===========================================================================
  // Consumable Tick
  // ===========================================================================

  private processConsumableTickEvent(event: ConsumableTickEvent): void {
    const consumable: Consumable = event.consumable;
    const source: CombatUnit = event.source;

    if (consumable.hitpointRestore > 0) {
      const tickValue = CombatUtilities.calculateTickValue(
        consumable.hitpointRestore,
        event.totalTicks,
        event.currentTick
      );
      const hitpointsAdded = source.addHitpoints(tickValue);
      this.simResult.addHealingReceived(
        source.hrid,
        consumable.hrid,
        hitpointsAdded
      );
    }

    if (consumable.manapointRestore > 0) {
      const tickValue = CombatUtilities.calculateTickValue(
        consumable.manapointRestore,
        event.totalTicks,
        event.currentTick
      );
      source.addManapoints(tickValue);

      if (source.isOutOfMana) {
        const awaitCooldownEvent = new AwaitCooldownEvent(
          this.simulationTime,
          source
        );
        this.eventQueue.addEvent(awaitCooldownEvent);
      }
    }

    if (event.currentTick < event.totalTicks) {
      const consumableTickEvent = new ConsumableTickEvent(
        this.simulationTime + HOT_TICK_INTERVAL,
        source,
        consumable,
        event.totalTicks,
        event.currentTick + 1
      );
      this.eventQueue.addEvent(consumableTickEvent);
    }
  }

  // ===========================================================================
  // Damage Over Time
  // ===========================================================================

  private processDamageOverTimeTickEvent(event: DamageOverTimeEvent): void {
    const tickDamage = CombatUtilities.calculateTickValue(
      event.damage,
      event.totalTicks,
      event.currentTick
    );
    const damage = Math.min(
      tickDamage,
      event.target.combatDetails.currentHitpoints
    );

    event.target.combatDetails.currentHitpoints -= damage;

    // Track DoT damage
    if (event.sourceRef) {
      this.simResult.addDamageDealt(
        (event.sourceRef as CombatUnit).isPlayer
          ? (event.sourceRef as CombatUnit).hrid
          : "enemy",
        damage
      );
    }

    // Track damage taken by player
    if (event.target.isPlayer) {
      this.simResult.addDamageTaken(event.target.hrid, damage);
    }

    // Overkill tracking for monsters
    if (!event.target.isPlayer) {
      this.encounterPreClampDamage += tickDamage;
      this.encounterPostClampDamage += damage;
      if (event.sourceRef && (event.sourceRef as CombatUnit).isPlayer) {
        this.simResult.addPreClampDamageDealt((event.sourceRef as CombatUnit).hrid, tickDamage);
      }
    }

    if (event.currentTick < event.totalTicks) {
      const dotEvent = new DamageOverTimeEvent(
        this.simulationTime + DOT_TICK_INTERVAL,
        event.sourceRef,
        event.target,
        event.damage,
        event.totalTicks,
        event.currentTick + 1,
        event.combatStyleHrid
      );
      this.eventQueue.addEvent(dotEvent);
    }

    if (event.target.combatDetails.currentHitpoints <= 0) {
      event.target.combatDetails.currentHitpoints = 0;
      this.eventQueue.clearEventsForUnit(event.target);
    }

    this.checkEncounterEnd();
  }

  // ===========================================================================
  // Regen Tick
  // ===========================================================================

  private processRegenTickEvent(): void {
    for (const unit of this.players) {
      if (unit.combatDetails.currentHitpoints <= 0) continue;

      const hitpointRegen = Math.floor(
        unit.combatDetails.maxHitpoints *
          unit.combatDetails.combatStats.hpRegenPer10
      );
      const hitpointsAdded = unit.addHitpoints(hitpointRegen);
      this.simResult.addHealingReceived(unit.hrid, "regen", hitpointsAdded);

      const manapointRegen = Math.floor(
        unit.combatDetails.maxManapoints *
          unit.combatDetails.combatStats.mpRegenPer10
      );
      unit.addManapoints(manapointRegen);

      if (unit.isOutOfMana) {
        const awaitCooldownEvent = new AwaitCooldownEvent(
          this.simulationTime,
          unit
        );
        this.eventQueue.addEvent(awaitCooldownEvent);
      }
    }

    const regenTickEvent = new RegenTickEvent(
      this.simulationTime + REGEN_TICK_INTERVAL
    );
    this.eventQueue.addEvent(regenTickEvent);
  }

  // ===========================================================================
  // Buff / CC Expiration Handlers
  // ===========================================================================

  private processCheckBuffExpirationEvent(
    event: CheckBuffExpirationEvent
  ): void {
    (event.source as CombatUnit).removeExpiredBuffs(this.simulationTime);
  }

  private processStunExpirationEvent(event: StunExpirationEvent): void {
    const unit: CombatUnit = event.source;
    unit.isStunned = false;
    this.addNextAttackEvent(unit);
  }

  private processBlindExpirationEvent(event: BlindExpirationEvent): void {
    const unit: CombatUnit = event.source;
    unit.isBlinded = false;
    this.addNextAttackEvent(unit);
  }

  private processSilenceExpirationEvent(event: SilenceExpirationEvent): void {
    (event.source as CombatUnit).isSilenced = false;
  }

  private processCurseExpirationEvent(event: CurseExpirationEvent): void {
    (event.source as CombatUnit).removeExpiredBuffs(this.simulationTime);
  }

  private processWeakenExpirationEvent(event: WeakenExpirationEvent): void {
    (event.source as CombatUnit).removeExpiredBuffs(this.simulationTime);
  }

  private processFuryExpirationEvent(event: CancellableFuryEvent): void {
    if (event.cancelled) return;
    const unit: CombatUnit = event.source;
    unit._activeFuryEvent = null;
    unit.removeExpiredBuffs(this.simulationTime);
  }

  // ===========================================================================
  // Enrage Tick
  // ===========================================================================

  private processEnrageTickEvent(event: EnrageTickEvent): void {
    if (!this.enemies) return;

    const maxEnrageStack = 10;

    for (const enemy of this.enemies) {
      if (enemy.combatDetails.currentHitpoints <= 0) continue;

      const nowStack = Math.min(
        maxEnrageStack,
        Math.floor(event.encounterTime / enemy.enrageTime)
      );
      if (nowStack <= 0) continue;

      const enrageDamageBuff = new Buff({
        uniqueHrid: "/buff_uniques/enrage_damage",
        typeHrid: "/buff_types/damage",
        ratioBoost: nowStack * 0.1,
        ratioBoostLevelBonus: 0,
        flatBoost: 0,
        flatBoostLevelBonus: 0,
        startTime: "0001-01-01T00:00:00Z",
        duration: ENRAGE_TICK_INTERVAL,
      });

      const enrageAccuracyBuff = new Buff({
        uniqueHrid: "/buff_uniques/enrage_accuracy",
        typeHrid: "/buff_types/accuracy",
        ratioBoost: nowStack * 0.1,
        ratioBoostLevelBonus: 0,
        flatBoost: 0,
        flatBoostLevelBonus: 0,
        startTime: "0001-01-01T00:00:00Z",
        duration: ENRAGE_TICK_INTERVAL,
      });

      enemy.addBuff(enrageDamageBuff, this.simulationTime);
      enemy.addBuff(enrageAccuracyBuff, this.simulationTime);
    }

    const nextEnrageTickEvent = new EnrageTickEvent(
      this.simulationTime + ENRAGE_TICK_INTERVAL,
      event.encounterTime + ENRAGE_TICK_INTERVAL
    );
    this.eventQueue.addEvent(nextEnrageTickEvent);
  }

  // ===========================================================================
  // Check Encounter End
  // ===========================================================================

  private checkEncounterEnd(): boolean {
    // Calculate experience rate for dead enemies
    if (this.enemies) {
      for (const enemy of this.enemies) {
        if (
          enemy.combatDetails.currentHitpoints <= 0 &&
          enemy.experienceRate === 0
        ) {
          let aliveDuration = this.simulationTime - this.enrageBeginTime;
          if (aliveDuration > enemy.enrageTime) {
            aliveDuration = enemy.enrageTime;
          }
          enemy.experienceRate = 1.0 + aliveDuration / enemy.enrageTime;
        }
      }
    }

    let encounterEnded = false;

    // All enemies dead?
    if (
      this.enemies &&
      !this.enemies.some(
        (enemy) => enemy.combatDetails.currentHitpoints > 0
      )
    ) {
      this.eventQueue.clearEventsOfType(CombatEventType.AutoAttack);

      // Calculate experience
      const totalExp = this.enemies.reduce(
        (sum, enemy) => sum + enemy.experience * enemy.experienceRate,
        0
      );
      const perPlayerExp = totalExp / this.players.length;

      // DEBUG: track raw monster XP per dungeon
      this.dungeonRawXp += totalExp;

      // Diagnostic: log first 3 encounters
      if (this.totalEncountersCompleted < 3) {
        const killTimeMs = (this.simulationTime - this.encounterStartTime) / 1e6;
        console.log(`[DIAG] Encounter #${this.totalEncountersCompleted + 1}: killTime=${(killTimeMs / 1000).toFixed(2)}s`);
        console.log(`  enemies: ${this.enemies.map(e => `${e.hrid}(xp=${e.experience} rate=${e.experienceRate.toFixed(3)})`).join(', ')}`);
        console.log(`  totalExp=${totalExp.toFixed(1)} perPlayerExp=${perPlayerExp.toFixed(1)}`);
        const player = this.players[0];
        const wisdomBonus = player.wisdomBuffBonus || (this.config.wisdomBuffBonus ?? 0);
        const additionalMult = player.additionalXpMultiplier !== 1.0
          ? player.additionalXpMultiplier
          : (this.config.additionalXpMultiplier ?? 1.0);
        const combatExpBonus = 1 + player.combatDetails.combatStats.combatExperience + wisdomBonus;
        console.log(`  combatExpBonus=${combatExpBonus.toFixed(4)} additionalMult=${additionalMult.toFixed(4)} debuff=${player.debuffOnLevelGap ?? 0}`);
        const xpBreakdownPreview = this.distributeExperience(player, perPlayerExp);
        const totalDistributed = Object.values(xpBreakdownPreview).reduce((a, b) => a + b, 0);
        console.log(`  distributedXp=${totalDistributed.toFixed(1)} breakdown=${JSON.stringify(Object.fromEntries(Object.entries(xpBreakdownPreview).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)])))}`);
        console.log(`  playerHP=${player.combatDetails.currentHitpoints.toFixed(0)}/${player.combatDetails.maxHitpoints} playerMP=${player.combatDetails.currentManapoints.toFixed(0)}/${player.combatDetails.maxManapoints}`);
      }

      for (const player of this.players) {
        const xpBreakdown = this.distributeExperience(player, perPlayerExp);
        this.simResult.addExperienceGain(player.hrid, xpBreakdown);
        this.cycleXp += Object.values(xpBreakdown).reduce(
          (a, b) => a + b,
          0
        );
      }

      // Overkill time correction: compute wasted time from overkill damage
      const killTimeNs = this.simulationTime - this.encounterStartTime;
      if (this.encounterPreClampDamage > 0) {
        const overkillRatio = 1 - (this.encounterPostClampDamage / this.encounterPreClampDamage);
        this.cumulativeOverkillTimeNs += killTimeNs * overkillRatio;
      }

      // Log encounter stats for kill time tracking
      this.simResult.logEncounter({
        killTimeNs,
        experienceGained: emptyExperience(), // filled per-player above
        damageDealt: 0,
        healingDone: 0,
        manaUsed: 0,
        playerHpAtEnd: this.players[0]?.combatDetails.currentHitpoints ?? 0,
        playerMpAtEnd: this.players[0]?.combatDetails.currentManapoints ?? 0,
      });

      this.enemies = null;
      this.totalEncountersCompleted++;
      this.simResult.addEncounterEnd();

      // Schedule enemy respawn. Dungeon waves transition near-instantly
      // EXCEPT when a dungeon just completed (last wave killed), which
      // uses the same 3s restart delay as a dungeon wipe. Regular zones also
      // have a 3s respawn delay (plus optional deterministic calibration).
      let respawnDelay: number;
      if (this.zone.isDungeon) {
        if (this.zone.getCurrentWave() > this.zone.getMaxWaves()) {
          // Last wave of dungeon just killed - restart delay
          console.log(`[DUNGEON COMPLETE] rawMonsterXP=${this.dungeonRawXp.toFixed(0)} perPlayer=${(this.dungeonRawXp / this.players.length).toFixed(0)} waves=${this.zone.getMaxWaves()}`);
          this.dungeonRawXp = 0;
          respawnDelay = RESTART_INTERVAL;
        } else {
          respawnDelay = DUNGEON_WAVE_RESPAWN_INTERVAL;
        }
      } else {
        respawnDelay =
          ENEMY_RESPAWN_INTERVAL +
          (this.config.encounterTransitionDelay ??
            DEFAULT_ENCOUNTER_TRANSITION_DELAY);
      }

      const enemyRespawnEvent = new EnemyRespawnEvent(
        this.simulationTime + respawnDelay
      );
      this.eventQueue.addEvent(enemyRespawnEvent);

      encounterEnded = true;

      // Cycle detection: check after each full boss cycle for non-dungeon zones
      if (!this.zone.isDungeon) {
        this.checkCycleCompletion();
      }
    }

    // Handle player deaths
    for (const player of this.players) {
      if (
        player.combatDetails.currentHitpoints <= 0 &&
        !this.eventQueue.containsEventOfTypeAndHrid(
          CombatEventType.PlayerRespawn,
          player.hrid
        )
      ) {
        // Track the death in SimResult
        this.simResult.addDeath(
          player.hrid,
          this.simulationTime - this.encounterStartTime,
          PLAYER_RESPAWN_INTERVAL
        );

        if (!this.zone.isDungeon) {
          const playerRespawnEvent = new PlayerRespawnEvent(
            this.simulationTime + PLAYER_RESPAWN_INTERVAL,
            player.hrid
          );
          this.eventQueue.addEvent(playerRespawnEvent);
        }
      }
    }

    // All players dead?
    if (
      !this.players.some(
        (player) => player.combatDetails.currentHitpoints > 0
      )
    ) {
      if (this.zone.isDungeon) {
        // A wipe stops active combat, but cooldown-ready and buff-expiration
        // events continue through the restart delay.  reset(currentTime) then
        // retains non-expired player buffs/CDs, matching combatSimulator.js.
        for (const type of [
          CombatEventType.AutoAttack,
          CombatEventType.AbilityCastEnd,
          CombatEventType.DamageOverTime,
          CombatEventType.ConsumableTick,
          CombatEventType.RegenTick,
          CombatEventType.EnrageTick,
          CombatEventType.StunExpiration,
          CombatEventType.BlindExpiration,
          CombatEventType.SilenceExpiration,
          CombatEventType.AwaitCooldown,
        ]) {
          this.eventQueue.clearEventsOfType(type);
        }
        this.enemies = null;

        const combatStartEvent = new CombatStartEvent(
          this.simulationTime + RESTART_INTERVAL
        );
        this.eventQueue.addEvent(combatStartEvent);
      } else {
        this.eventQueue.clearEventsOfType(CombatEventType.AutoAttack);
        this.eventQueue.clearEventsOfType(CombatEventType.AbilityCastEnd);
      }

      encounterEnded = true;
      this.allPlayersDead = true;
    }

    return encounterEnded;
  }

  // ===========================================================================
  // Cycle detection
  // ===========================================================================

  /**
   * After enough encounters, take a snapshot for cycle detection.
   * For non-dungeon zones: check every BATTLES_PER_BOSS encounters.
   * For dungeons: check after each full dungeon run.
   */
  private checkCycleCompletion(): void {
    const cyclesPerCheck = this.encounterDistribution?.bossEncounter
      ? BATTLES_PER_BOSS
      : 10;

    if (this.totalEncountersCompleted % cyclesPerCheck !== 0) return;

    const playerStates = this.players.map((p) => ({
      hrid: p.hrid,
      currentHp: p.combatDetails.currentHitpoints,
      currentMp: p.combatDetails.currentManapoints,
    }));

    const cycleTimeNs = this.simulationTime - this.cycleStartTime;
    const snapshot = createCycleSnapshot(
      playerStates,
      this.cycleXp,
      cycleTimeNs
    );

    this.cycleDetector.addSnapshot(snapshot);

    // Reset cycle accumulators
    this.cycleXp = 0;
    this.cycleStartTime = this.simulationTime;
  }

  // ===========================================================================
  // Experience Distribution
  // ===========================================================================

  /**
   * Distributes experience across skills based on weapon and charm.
   *
   * MWI XP rules:
   * - If NO charm (no focus training): 100% of XP goes to the weapon's
   *   primary training skill (e.g. melee for a sword).
   * - If charm trains a DIFFERENT skill: 30% to weapon skill, 70% to
   *   charm skill.
   * - If charm trains the SAME skill as weapon: 100% to that skill
   *   (the charm still provides its XP bonus via the aggregated stat).
   * - Per-skill XP bonuses (e.g. meleeExperience, magicExperience from
   *   all equipment) are multiplicative on that skill's share.
   * - The global combatExperience bonus applies to the base XP first.
   * - No other skills (stamina, intelligence, attack, defense) receive
   *   XP from combat kills.
   */
  private distributeExperience(
    player: Player,
    totalXp: number
  ): ExperienceBreakdown {
    const xp = emptyExperience();
    // Per-player wisdom bonus (MooPass + community + seal wisdom) adds
    // ADDITIVELY to combatExperience. Additional XP % is a separate multiplier.
    // Falls back to global config for backwards compatibility.
    const wisdomBonus = player.wisdomBuffBonus || (this.config.wisdomBuffBonus ?? 0);
    const additionalMult = player.additionalXpMultiplier !== 1.0
      ? player.additionalXpMultiplier
      : (this.config.additionalXpMultiplier ?? 1.0);
    const combatExpBonus =
      1 + player.combatDetails.combatStats.combatExperience + wisdomBonus;
    const debuffOnLevelGap = player.debuffOnLevelGap ?? 0;
    const adjustedXp =
      totalXp * combatExpBonus * additionalMult * (1 + debuffOnLevelGap);

    const primaryTraining = player.combatDetails.combatStats.primaryTraining;
    const focusTraining = player.combatDetails.combatStats.focusTraining;
    const combatStyleHrid =
      player.combatDetails.combatStats.combatStyleHrid;

    const primarySkill = this.trainingHridToSkill(primaryTraining);

    if (!primarySkill) return xp;

    const getSkillBonus = (skill: string): number => {
      const expBonusKey =
        `${skill}Experience` as keyof typeof player.combatDetails.combatStats;
      return 1 + ((player.combatDetails.combatStats[expBonusKey] as number) || 0);
    };

    // Look up the combat style's skillExpMap to determine which skills
    // receive XP for this combat style (matches original sim logic).
    const combatStyleDetail =
      this.gameData.combatStyleDetailMap[combatStyleHrid];
    const skillExpMap = combatStyleDetail?.skillExpMap;

    // Check if the charm's focus training is valid for this combat style
    const focusSkill = focusTraining
      ? this.trainingHridToSkill(focusTraining)
      : null;
    const focusInSkillExpMap =
      focusTraining && skillExpMap ? !!skillExpMap[focusTraining] : false;

    if (focusSkill && focusInSkillExpMap) {
      if (focusSkill === primarySkill) {
        // Charm trains same skill as weapon: 100% to that skill
        (xp as unknown as Record<string, number>)[primarySkill] =
          adjustedXp * getSkillBonus(primarySkill);
      } else {
        // Charm trains different skill: 30% weapon, 70% charm
        (xp as unknown as Record<string, number>)[primarySkill] =
          adjustedXp * 0.3 * getSkillBonus(primarySkill);
        (xp as unknown as Record<string, number>)[focusSkill] =
          adjustedXp * 0.7 * getSkillBonus(focusSkill);
      }
    } else {
      // No charm (or charm focus not in skillExpMap):
      // 30% to primary training skill, 70% distributed evenly across
      // all skills in the combat style's skillExpMap.
      const xpRecord = xp as unknown as Record<string, number>;

      // Start with 0.3 for primary
      const rates: Record<string, number> = {};
      rates[primarySkill] = 0.3;

      if (skillExpMap) {
        const skillHrids = Object.keys(skillExpMap);
        const n = skillHrids.length;
        for (const skillHrid of skillHrids) {
          const skill = this.trainingHridToSkill(skillHrid);
          if (!skill) continue;
          rates[skill] = (rates[skill] ?? 0) + 0.7 / n;
        }
      } else {
        // Fallback: if no skillExpMap, give 100% to primary
        rates[primarySkill] = 1.0;
      }

      for (const [skill, rate] of Object.entries(rates)) {
        if (rate <= 0) continue;
        xpRecord[skill] =
          adjustedXp * rate * getSkillBonus(skill);
      }
    }

    return xp;
  }

  /**
   * Converts a training hrid like "/skills/melee" to the skill name "melee".
   */
  private trainingHridToSkill(hrid: string): string | null {
    if (!hrid) return null;
    const parts = hrid.split("/");
    return parts[parts.length - 1] || null;
  }

  // ===========================================================================
  // Trigger checking
  // ===========================================================================

  private checkTriggers(): void {
    let triggeredSomething: boolean;

    do {
      triggeredSomething = false;

      for (const player of this.players) {
        if (player.combatDetails.currentHitpoints <= 0) continue;
        if (
          this.checkTriggersForUnit(player, this.players, this.enemies)
        ) {
          triggeredSomething = true;
        }
      }

      if (this.enemies) {
        for (const enemy of this.enemies) {
          if (enemy.combatDetails.currentHitpoints <= 0) continue;
          if (
            this.checkTriggersForUnit(enemy, this.enemies, this.players)
          ) {
            triggeredSomething = true;
          }
        }
      }
    } while (triggeredSomething);
  }

  private checkTriggersForUnit(
    unit: CombatUnit,
    friendlies: CombatUnit[],
    enemies: CombatUnit[] | null
  ): boolean {
    if (unit.combatDetails.currentHitpoints <= 0) {
      return false;
    }

    let triggeredSomething = false;
    const target = CombatUtilities.getTarget(enemies);

    for (const food of unit.food) {
      if (
        food &&
        food.shouldTrigger(
          this.simulationTime,
          unit as any,
          target as any,
          friendlies as any,
          enemies as any
        )
      ) {
        const result = this.tryUseConsumable(unit, food);
        if (result) {
          triggeredSomething = true;
        }
      }
    }

    for (const drink of unit.drinks) {
      if (
        drink &&
        drink.shouldTrigger(
          this.simulationTime,
          unit as any,
          target as any,
          friendlies as any,
          enemies as any
        )
      ) {
        const result = this.tryUseConsumable(unit, drink);
        if (result) {
          triggeredSomething = true;
        }
      }
    }

    return triggeredSomething;
  }

  // ===========================================================================
  // Consumable usage
  // ===========================================================================

  private tryUseConsumable(
    source: CombatUnit,
    consumable: Consumable
  ): boolean {
    if (source.combatDetails.currentHitpoints <= 0) {
      return false;
    }

    consumable.lastUsed = this.simulationTime;

    let consumeCooldown = consumable.cooldownDuration;
    if (
      source.combatDetails.combatStats.drinkConcentration > 0 &&
      consumable.catagoryHrid.includes("drink")
    ) {
      consumeCooldown /=
        1 + source.combatDetails.combatStats.drinkConcentration;
    } else if (
      source.combatDetails.combatStats.foodHaste > 0 &&
      consumable.catagoryHrid.includes("food")
    ) {
      consumeCooldown /= 1 + source.combatDetails.combatStats.foodHaste;
    }

    const cooldownReadyEvent = new CooldownReadyEvent(
      this.simulationTime + consumeCooldown
    );
    this.eventQueue.addEvent(cooldownReadyEvent);

    this.simResult.addConsumableUse(source.hrid, consumable.hrid);

    if (consumable.recoveryDuration === 0) {
      if (consumable.hitpointRestore > 0) {
        const hitpointsAdded = source.addHitpoints(
          consumable.hitpointRestore
        );
        this.simResult.addHealingReceived(
          source.hrid,
          consumable.hrid,
          hitpointsAdded
        );
      }

      if (consumable.manapointRestore > 0) {
        source.addManapoints(consumable.manapointRestore);

        if (source.isOutOfMana) {
          const awaitCooldownEvent = new AwaitCooldownEvent(
            this.simulationTime,
            source
          );
          this.eventQueue.addEvent(awaitCooldownEvent);
        }
      }
    } else {
      const consumableTickEvent = new ConsumableTickEvent(
        this.simulationTime + HOT_TICK_INTERVAL,
        source,
        consumable,
        consumable.recoveryDuration / HOT_TICK_INTERVAL,
        1
      );
      this.eventQueue.addEvent(consumableTickEvent);
    }

    for (const buff of consumable.buffs) {
      let currentBuff: Buff;
      if (
        source.combatDetails.combatStats.drinkConcentration > 0 &&
        consumable.catagoryHrid.includes("drink")
      ) {
        currentBuff = new Buff({
          uniqueHrid: buff.uniqueHrid,
          typeHrid: buff.typeHrid,
          ratioBoost:
            buff.ratioBoost *
            (1 + source.combatDetails.combatStats.drinkConcentration),
          ratioBoostLevelBonus: 0,
          flatBoost:
            buff.flatBoost *
            (1 + source.combatDetails.combatStats.drinkConcentration),
          flatBoostLevelBonus: 0,
          startTime: "0001-01-01T00:00:00Z",
          duration:
            buff.duration /
            (1 + source.combatDetails.combatStats.drinkConcentration),
        });
      } else {
        currentBuff = new Buff({
          uniqueHrid: buff.uniqueHrid,
          typeHrid: buff.typeHrid,
          ratioBoost: buff.ratioBoost,
          ratioBoostLevelBonus: 0,
          flatBoost: buff.flatBoost,
          flatBoostLevelBonus: 0,
          startTime: "0001-01-01T00:00:00Z",
          duration: buff.duration,
        });
      }

      source.addBuff(currentBuff, this.simulationTime);
      const checkBuffExpirationEvent = new CheckBuffExpirationEvent(
        this.simulationTime + currentBuff.duration,
        source
      );
      this.eventQueue.addEvent(checkBuffExpirationEvent);
    }

    return true;
  }

  // ===========================================================================
  // Ability Effect Handlers
  // ===========================================================================

  private processAbilityBuffEffect(
    source: CombatUnit,
    ability: Ability,
    abilityEffect: AbilityEffect
  ): void {
    if (abilityEffect.targetType === "allAllies") {
      const targets: CombatUnit[] = source.isPlayer
        ? this.players
        : this.enemies ?? [];
      for (const target of targets.filter(
        (unit) => unit && unit.combatDetails.currentHitpoints > 0
      )) {
        for (const buff of abilityEffect.buffs ?? []) {
          if (
            ability.isSpecialAbility &&
            buff.multiplierForSkillHrid &&
            buff.multiplierPerSkillLevel > 0
          ) {
            const skillName =
              buff.multiplierForSkillHrid.split("/")[2] + "Level";
            const multiplier =
              1.0 +
              ((target.combatDetails as unknown as Record<string, number>)[skillName] ??
                0) *
                buff.multiplierPerSkillLevel;
            const scaledBuff = new Buff({
              uniqueHrid: buff.uniqueHrid,
              typeHrid: buff.typeHrid,
              ratioBoost: buff.ratioBoost,
              ratioBoostLevelBonus: 0,
              flatBoost: buff.flatBoost * multiplier,
              flatBoostLevelBonus: 0,
              startTime: "0001-01-01T00:00:00Z",
              duration: buff.duration,
            });
            target.addBuff(scaledBuff, this.simulationTime);
          } else {
            target.addBuff(buff as unknown as Buff, this.simulationTime);
          }
          const checkBuffExpirationEvent = new CheckBuffExpirationEvent(
            this.simulationTime + buff.duration,
            target
          );
          this.eventQueue.addEvent(checkBuffExpirationEvent);
        }
      }
      return;
    }

    if (abilityEffect.targetType !== "self") {
      return;
    }

    for (const buff of abilityEffect.buffs ?? []) {
      source.addBuff(buff as unknown as Buff, this.simulationTime);
      const checkBuffExpirationEvent = new CheckBuffExpirationEvent(
        this.simulationTime + buff.duration,
        source
      );
      this.eventQueue.addEvent(checkBuffExpirationEvent);
    }
  }

  private processAbilityDamageEffect(
    source: CombatUnit,
    ability: Ability,
    abilityEffect: AbilityEffect,
    procScale: number = 1.0
  ): void {
    let targets: CombatUnit[];
    switch (abilityEffect.targetType) {
      case "enemy":
      case "allEnemies":
        targets = source.isPlayer
          ? this.enemies ?? []
          : [...this.players];
        break;
      default:
        return;
    }

    if (targets.length === 0) return;

    const aliveTargets = targets.filter(
      (unit) => unit && unit.combatDetails.currentHitpoints > 0
    );
    if (aliveTargets.length === 0) return;

    // Deterministic parry for abilities: compute once
    const parryChance = CombatUtilities.expectedParryChance(targets);

    // For single-target monster abilities: use round-robin targeting (same as auto-attacks).
    // For AoE or player abilities, use the original logic.
    let processedTargets: CombatUnit[];
    if (abilityEffect.targetType === "allEnemies") {
      processedTargets = [...aliveTargets];
    } else if (!source.isPlayer && aliveTargets.length > 1) {
      // Monster single-target attacks use the same threat-weighted selection
      // as auto attacks.  The old implementation treated any unique maximum
      // threat as a taunt, making e.g. 101 vs 100 threat target one player
      // 100% of the time instead of roughly 50%.
      processedTargets = [this.selectMonsterTarget(source, aliveTargets)];
    } else {
      // Player ability or single alive target
      processedTargets = [aliveTargets[0]];
    }

    for (const target of processedTargets) {
      const attackResult = CombatUtilities.processAttack(
        source,
        target,
        abilityEffect
      );

      // Scale by proc rate (for blaze/bloom procs)
      const scaledDamage = attackResult.damageDone * procScale;

      // Scale by (1 - parryChance) for parry mitigation
      const effectiveDamage = scaledDamage * (1 - parryChance);
      const actualDamage = Math.min(
        effectiveDamage,
        target.combatDetails.currentHitpoints
      );
      target.combatDetails.currentHitpoints -= actualDamage;

      // Track damage dealt
      this.simResult.addDamageDealt(
        source.isPlayer ? source.hrid : "enemy",
        actualDamage
      );

      // Track damage taken by player
      if (target.isPlayer) {
        this.simResult.addDamageTaken(target.hrid, actualDamage);
      }

      // Overkill tracking for monsters
      if (!target.isPlayer) {
        this.encounterPreClampDamage += effectiveDamage;
        this.encounterPostClampDamage += actualDamage;
        if (source.isPlayer) {
          this.simResult.addPreClampDamageDealt(source.hrid, effectiveDamage);
        }
      }

      // HP drain
      if (attackResult.hpDrained > 0) {
        const healAmount = attackResult.hpDrained * procScale * (1 - parryChance);
        source.addHitpoints(healAmount);
        this.simResult.addHealingReceived(
          source.hrid,
          ability.hrid,
          healAmount
        );
      }

      // On-hit buffs are random in the source simulator.  Retaining a full
      // buff whenever its hit probability is non-zero incorrectly makes a
      // 1% hit behave as a permanent 100% debuff. A scaled buff preserves the
      // first moment of the active-buff state.
      if (abilityEffect.buffs && attackResult.hitChance > 0) {
        const applicationProbability = attackResult.hitChance * procScale;
        for (const buff of abilityEffect.buffs) {
          const expectedBuff = Object.assign(
            Object.create(Object.getPrototypeOf(buff)),
            buff,
            {
              ratioBoost: buff.ratioBoost * applicationProbability,
              flatBoost: buff.flatBoost * applicationProbability,
            }
          ) as Buff;
          target.addBuff(expectedBuff, this.simulationTime);
          const checkBuffExpirationEvent = new CheckBuffExpirationEvent(
            this.simulationTime + buff.duration,
            target
          );
          this.eventQueue.addEvent(checkBuffExpirationEvent);
        }
      }

      // DoT (scaled by procScale)
      if (attackResult.damageOverTime && attackResult.damageDone > 0) {
        const dot = attackResult.damageOverTime;
        const dotEvent = new DamageOverTimeEvent(
          this.simulationTime + DOT_TICK_INTERVAL,
          source,
          target,
          dot.damage * procScale,
          dot.totalTicks,
          1,
          dot.combatStyleHrid
        );
        this.eventQueue.addEvent(dotEvent);
      }

      // CC as fractional delays (separated by type, scaled by procScale)
      if (attackResult.expectedStunDuration > 0) {
        this.addStunDelay(
          target,
          attackResult.expectedStunDuration * procScale
        );
      }
      if (attackResult.expectedBlindDuration > 0) {
        this.addBlindDelay(
          target,
          attackResult.expectedBlindDuration * procScale
        );
      }
      if (attackResult.expectedSilenceDuration > 0) {
        this.addSilenceDelay(
          target,
          attackResult.expectedSilenceDuration * procScale
        );
      }

      // Curse (deterministic)
      this.applyCurse(source, target, attackResult, procScale);

      // Weaken (deterministic)
      this.applyWeaken(source, target, attackResult, procScale);

      // Thorns
      if (attackResult.thornDamageDone > 0) {
        const thornDamage = Math.min(
          attackResult.thornDamageDone * procScale,
          source.combatDetails.currentHitpoints
        );
        source.combatDetails.currentHitpoints -= thornDamage;
      }

      // Retaliation
      if (attackResult.retaliationDamageDone > 0) {
        const retDamage = Math.min(
          attackResult.retaliationDamageDone * procScale,
          source.combatDetails.currentHitpoints
        );
        source.combatDetails.currentHitpoints -= retDamage;
      }

      // Pierce for abilities
      if (
        abilityEffect.pierceChance > 0 &&
        abilityEffect.targetType === "enemy"
      ) {
        let pierceMult = attackResult.hitChance * abilityEffect.pierceChance;
        for (const nextTarget of aliveTargets) {
          if (nextTarget === target) continue;
          if (nextTarget.combatDetails.currentHitpoints <= 0) continue;
          if (pierceMult <= 0.001) break;

          const pierceResult = CombatUtilities.processAttack(
            source,
            nextTarget,
            abilityEffect
          );
          const pierceDamage =
            pierceResult.damageDone * pierceMult * procScale * (1 - parryChance);
          const actualPierceDamage = Math.min(
            pierceDamage,
            nextTarget.combatDetails.currentHitpoints
          );
          nextTarget.combatDetails.currentHitpoints -= actualPierceDamage;

          this.simResult.addDamageDealt(
            source.isPlayer ? source.hrid : "enemy",
            actualPierceDamage
          );

          // Track damage taken by player
          if (nextTarget.isPlayer) {
            this.simResult.addDamageTaken(nextTarget.hrid, actualPierceDamage);
          }

          // Overkill tracking for monsters
          if (!nextTarget.isPlayer) {
            this.encounterPreClampDamage += pierceDamage;
            this.encounterPostClampDamage += actualPierceDamage;
            if (source.isPlayer) {
              this.simResult.addPreClampDamageDealt(source.hrid, pierceDamage);
            }
          }

          if (nextTarget.combatDetails.currentHitpoints <= 0) {
            nextTarget.combatDetails.currentHitpoints = 0;
            this.eventQueue.clearEventsForUnit(nextTarget);
          }

          // Reaching the following target requires this chained attack to
          // hit and pierce. Its hit chance is target-specific.
          pierceMult *= pierceResult.hitChance * abilityEffect.pierceChance;
        }
      }

      // Check target death
      if (target.combatDetails.currentHitpoints <= 0) {
        target.combatDetails.currentHitpoints = 0;
        this.eventQueue.clearEventsForUnit(target);
      }
    }
  }

  private processAbilityHealEffect(
    source: CombatUnit,
    ability: Ability,
    abilityEffect: AbilityEffect,
    procScale: number = 1.0
  ): void {
    if (abilityEffect.targetType === "allAllies") {
      const healTargets: CombatUnit[] = source.isPlayer
        ? this.players
        : this.enemies ?? [];
      for (const target of healTargets.filter(
        (unit) => unit && unit.combatDetails.currentHitpoints > 0
      )) {
        const amountHealed = CombatUtilities.processHeal(
          source,
          abilityEffect,
          target,
          procScale
        );
        this.simResult.addHealingReceived(
          target.hrid,
          ability.hrid,
          amountHealed
        );
      }
      return;
    }

    if (abilityEffect.targetType === "lowestHpAlly") {
      const healTargets: CombatUnit[] = source.isPlayer
        ? this.players
        : this.enemies ?? [];
      let healTarget: CombatUnit | null = null;
      for (const target of healTargets.filter(
        (unit) => unit && unit.combatDetails.currentHitpoints > 0
      )) {
        if (
          !healTarget ||
          target.combatDetails.currentHitpoints / target.combatDetails.maxHitpoints <
            healTarget.combatDetails.currentHitpoints / healTarget.combatDetails.maxHitpoints
        ) {
          healTarget = target;
        }
      }

      if (healTarget) {
        const amountHealed = CombatUtilities.processHeal(
          source,
          abilityEffect,
          healTarget,
          procScale
        );
        this.simResult.addHealingReceived(
          healTarget.hrid,
          ability.hrid,
          amountHealed
        );
      }
      return;
    }

    if (abilityEffect.targetType === "self") {
      const amountHealed = CombatUtilities.processHeal(
        source,
        abilityEffect,
        source,
        procScale
      );
      this.simResult.addHealingReceived(
        source.hrid,
        ability.hrid,
        amountHealed
      );
    }
  }

  private processAbilitySpendHpEffect(
    source: CombatUnit,
    ability: Ability,
    abilityEffect: AbilityEffect
  ): void {
    if (abilityEffect.targetType !== "self") return;

    const hpSpent = CombatUtilities.processSpendHp(source, abilityEffect);
    this.simResult.addHitpointsSpent(source.hrid, ability.hrid, hpSpent);
  }

  private processAbilityReviveEffect(
    source: CombatUnit,
    ability: Ability,
    abilityEffect: AbilityEffect
  ): void {
    if (abilityEffect.targetType !== "deadAlly") return;

    const reviveTargets: CombatUnit[] = source.isPlayer
      ? this.players
      : this.enemies ?? [];
    const reviveTarget = reviveTargets.find(
      (unit) => unit && unit.combatDetails.currentHitpoints <= 0
    );

    if (reviveTarget) {
      this.eventQueue.clearMatching(
        (event) =>
          event.type === CombatEventType.PlayerRespawn &&
          (event as PlayerRespawnEvent).hrid === reviveTarget.hrid
      );

      reviveTarget.removeExpiredBuffs(this.simulationTime);

      const amountHealed = CombatUtilities.processRevive(
        source,
        abilityEffect,
        reviveTarget
      );
      this.simResult.addHealingReceived(
        reviveTarget.hrid,
        ability.hrid,
        amountHealed
      );

      this.addNextAttackEvent(reviveTarget);
    }
  }

  /**
   * Promote effect: deterministic version picks the "average" promotion.
   * Since all three promotions (rook, knight, bishop) are equally likely,
   * we just pick the first one. The stats differences between them are
   * relatively minor in aggregate.
   */
  private processAbilityPromoteEffect(source: CombatUnit): CombatUnit {
    const promotionHrids = [
      "/monsters/enchanted_rook",
      "/monsters/enchanted_knight",
      "/monsters/enchanted_bishop",
    ];
    // Deterministic: pick index 1 (middle/knight) as the "average" choice
    const promoted = new Monster(
      promotionHrids[1],
      this.gameData,
      (source as Monster).difficultyTier,
      { Ability: this.abilityAdapter.getConstructor() }
    );

    // Replace the source in the enemies array
    if (this.enemies) {
      const idx = this.enemies.indexOf(source);
      if (idx !== -1) {
        this.enemies[idx] = promoted;
      }
    }

    return promoted;
  }

  // ===========================================================================
  // Curse / Weaken / Fury deterministic application
  // ===========================================================================

  /**
   * Apply curse deterministically.
   * Instead of creating stacking expiration events, we apply the expected
   * curse contribution as a direct buff update.
   */
  private applyCurse(
    source: CombatUnit,
    target: CombatUnit,
    attackResult: AttackResult,
    applicationScale: number = 1
  ): void {
    if (attackResult.expectedCurseApplied <= 0) return;

    const curseExpireTime = 15_000_000_000;
    const curseStatValue = source.combatDetails.combatStats.curse;

    // Curse applies on every hit for auto-attacks and abilities; unlike CC,
    // tenacity does not affect it. expectedCurseApplied is hitChance times
    // the curse stat.
    const curseApplyChance =
      curseStatValue > 0
        ? (attackResult.expectedCurseApplied / curseStatValue) * applicationScale
        : 0;

    // Get current curse state
    const currentCurseEvent = this.eventQueue.getMatching(
      (event) =>
        event.type === CombatEventType.CurseExpiration &&
        (event as CurseExpirationEvent).source === target
    ) as CurseExpirationEvent | null;

    let currentCurseAmount = 0;
    if (currentCurseEvent) {
      currentCurseAmount = currentCurseEvent.curseAmount;
    }

    // Clear old curse events
    this.eventQueue.clearMatching(
      (event) =>
        event.type === CombatEventType.CurseExpiration &&
        (event as CurseExpirationEvent).source === target
    );

    // Expected new stack: fractional increment by apply chance (max 5)
    const newCurseAmount = Math.min(
      currentCurseAmount + curseApplyChance,
      CurseExpirationEvent.maxCurseStacks
    );

    const curseExpirationEvent = new CurseExpirationEvent(
      this.simulationTime + curseExpireTime,
      newCurseAmount,
      target
    );

    const curseBuff = new Buff({
      uniqueHrid: "/buff_uniques/curse",
      typeHrid: "/buff_types/damage_taken",
      ratioBoost: 0,
      ratioBoostLevelBonus: 0,
      flatBoost: curseStatValue * curseExpirationEvent.curseAmount,
      flatBoostLevelBonus: 0,
      startTime: "0001-01-01T00:00:00Z",
      duration: curseExpireTime,
    });

    target.addBuff(curseBuff, this.simulationTime);
    this.eventQueue.addEvent(curseExpirationEvent);
  }

  /**
   * Apply weaken deterministically.
   */
  private applyWeaken(
    source: CombatUnit,
    target: CombatUnit,
    attackResult: AttackResult,
    applicationScale: number = 1
  ): void {
    if (attackResult.expectedWeakenApplied * applicationScale <= 0) return;

    const weakenExpireTime = 15_000_000_000;

    // Get current weaken state
    const currentWeakenEvent = this.eventQueue.getMatching(
      (event) =>
        event.type === CombatEventType.WeakenExpiration &&
        (event as WeakenExpirationEvent).source === source
    ) as WeakenExpirationEvent | null;

    let weakenAmount = 0;
    if (currentWeakenEvent) {
      weakenAmount = currentWeakenEvent.weakenAmount;
    }

    // Clear old weaken events
    this.eventQueue.clearMatching(
      (event) =>
        event.type === CombatEventType.WeakenExpiration &&
        (event as WeakenExpirationEvent).source === source
    );

    // Create new weaken event
    // Weaken is applied once per damage-effect occurrence.  The expiration
    // event increments its input by one, so offset the input to preserve the
    // fractional occurrence probability of Blaze/Bloom proc effects.
    const weakenExpirationEvent = new WeakenExpirationEvent(
      this.simulationTime + weakenExpireTime,
      weakenAmount + applicationScale - 1,
      source
    );

    const weakenBuff = new Buff({
      uniqueHrid: "/buff_uniques/weaken",
      typeHrid: "/buff_types/damage",
      ratioBoost:
        -1 *
        target.combatDetails.combatStats.weaken *
        weakenExpirationEvent.weakenAmount,
      ratioBoostLevelBonus: 0,
      flatBoost: 0,
      flatBoostLevelBonus: 0,
      startTime: "0001-01-01T00:00:00Z",
      duration: weakenExpireTime,
    });

    source.addBuff(weakenBuff, this.simulationTime);
    this.eventQueue.addEvent(weakenExpirationEvent);
  }

  /**
   * Apply fury deterministically.
   * Uses the hit-weighted expected fury gain per attack to maintain
   * a running average fury stack.
   */
  private applyFury(source: CombatUnit, attackResult: AttackResult): void {
    if (source.combatDetails.combatStats.fury <= 0) return;

    const furyExpireTime = 15_000_000_000;
    const maxFuryStack = 5;

    const currentFuryEvent = source._activeFuryEvent as CancellableFuryEvent | null;
    const previousAmount = currentFuryEvent
      ? (currentFuryEvent as unknown as FuryExpirationEvent).furyAmount
      : 0;

    // Deterministic fury: expected new stack
    // On hit (prob = hitChance): stack = min(prev + 1, max)
    // On miss (prob = 1 - hitChance): stack = floor(prev / 2)
    const hitChance = attackResult.hitChance;
    const hitStack = Math.min(previousAmount + 1, maxFuryStack);
    const missStack = Math.floor(previousAmount / 2);
    const expectedStack = hitChance * hitStack + (1 - hitChance) * missStack;
    const furyAmount = Math.round(expectedStack);

    if (furyAmount > 0) {
      // Cancel old event
      if (currentFuryEvent) {
        currentFuryEvent.cancelled = true;
      }

      const furyExpirationEvent = new FuryExpirationEvent(
        this.simulationTime + furyExpireTime,
        furyAmount,
        source
      ) as CancellableFuryEvent;
      furyExpirationEvent.cancelled = false;
      this.eventQueue.addEvent(furyExpirationEvent);
      source._activeFuryEvent = furyExpirationEvent as { cancelled: boolean };

      if (furyAmount !== previousAmount) {
        const furyBoost =
          furyAmount * source.combatDetails.combatStats.fury;
        source.combatBuffs["/buff_uniques/fury_accuracy"] = {
          uniqueHrid: "/buff_uniques/fury_accuracy",
          typeHrid: "/buff_types/fury_accuracy",
          ratioBoost: furyBoost,
          flatBoost: 0,
          duration: furyExpireTime,
          startTime: this.simulationTime,
          multiplierForSkillHrid: "",
          multiplierPerSkillLevel: 0,
        };
        source.combatBuffs["/buff_uniques/fury_damage"] = {
          uniqueHrid: "/buff_uniques/fury_damage",
          typeHrid: "/buff_types/fury_damage",
          ratioBoost: furyBoost,
          flatBoost: 0,
          duration: furyExpireTime,
          startTime: this.simulationTime,
          multiplierForSkillHrid: "",
          multiplierPerSkillLevel: 0,
        };
        source.updateCombatDetails();
      }
    } else {
      // Fury dropped to 0
      if (currentFuryEvent) {
        currentFuryEvent.cancelled = true;
      }
      source._activeFuryEvent = null;
      delete source.combatBuffs["/buff_uniques/fury_accuracy"];
      delete source.combatBuffs["/buff_uniques/fury_damage"];
      source.updateCombatDetails();
    }
  }

  // ===========================================================================
  // Target selection helpers
  // ===========================================================================

  /**
   * Compute threat-weight distribution for alive targets.
   * Returns a Map of target → weight where weights sum to 1.0.
   * Every target receives its share of total threat; equal threat gives 1/N.
   */
  private computeThreatWeights(aliveTargets: CombatUnit[]): Map<CombatUnit, number> {
    const weights = new Map<CombatUnit, number>();
    let totalThreat = 0;
    for (const target of aliveTargets) {
      totalThreat += target.combatDetails.combatStats.threat;
    }
    if (totalThreat <= 0) {
      // Fallback: equal distribution
      const equalWeight = 1 / aliveTargets.length;
      for (const target of aliveTargets) {
        weights.set(target, equalWeight);
      }
    } else {
      for (const target of aliveTargets) {
        weights.set(target, target.combatDetails.combatStats.threat / totalThreat);
      }
    }
    return weights;
  }

  /**
   * Select one player using the game's threat distribution without introducing
   * RNG.  A low-discrepancy sequence gives each target its probability over
   * repeated attacks while retaining a single real target per attack (important
   * for heals, deaths and trigger evaluation).
   */
  private selectMonsterTarget(
    source: CombatUnit,
    aliveTargets: CombatUnit[]
  ): CombatUnit {
    const weights = this.computeThreatWeights(aliveTargets);
    const counter = this.monsterTargetCounters.get(source) ?? 0;
    this.monsterTargetCounters.set(source, counter + 1);

    // Fractional multiples of the golden ratio are equidistributed in [0, 1).
    const point = ((counter + 0.5) * 0.6180339887498949) % 1;
    let cumulative = 0;
    for (const target of aliveTargets) {
      cumulative += weights.get(target) ?? 0;
      if (point < cumulative) return target;
    }
    return aliveTargets[aliveTargets.length - 1];
  }
}

export default DeterministicSimulator;
