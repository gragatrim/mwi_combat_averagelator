// =============================================================================
// SimResult - Deterministic simulation result tracking
// =============================================================================
// Simplified from: MWICombatSimulatorTest/src/combatsimulator/simResult.js
// This version is tailored for the deterministic "averagelator" approach:
// no histograms or variance tracking, just clean aggregation of XP, time,
// kills, deaths, DPS, HPS, and mana sustainability.

import type { ExperienceBreakdown } from "./types";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Per-encounter statistics snapshot. */
export interface EncounterStats {
  /** Time to kill the encounter in nanoseconds. */
  killTimeNs: number;
  /** Experience earned during this encounter. */
  experienceGained: ExperienceBreakdown;
  /** Total damage dealt to enemies during this encounter. */
  damageDealt: number;
  /** Total healing done to allies during this encounter. */
  healingDone: number;
  /** Total mana consumed during this encounter. */
  manaUsed: number;
  /** Player HP at end of encounter. */
  playerHpAtEnd: number;
  /** Player MP at end of encounter. */
  playerMpAtEnd: number;
}

/** Death cycle tracking: one entry per death event. */
export interface DeathCycle {
  /** Time the player was alive before dying (nanoseconds). */
  timeAliveNs: number;
  /** Total respawn penalty (nanoseconds). */
  respawnTimeNs: number;
}

/** Per-player statistics aggregation. */
export interface PlayerStats {
  /** Cumulative experience per skill. */
  experienceGained: ExperienceBreakdown;
  /** Total damage dealt to enemies. */
  totalDamageDealt: number;
  /** Total healing received (from all sources). */
  totalHealingReceived: number;
  /** Healing received keyed by source name. */
  healingBySource: Record<string, number>;
  /** Total mana consumed. */
  totalManaUsed: number;
  /** Mana consumed keyed by ability hrid. */
  manaByAbility: Record<string, number>;
  /** Number of deaths. */
  deaths: number;
  /** Death cycle log. */
  deathCycles: DeathCycle[];
  /** Total time spent dead (nanoseconds). */
  totalDeadTimeNs: number;
  /** Consumables used: consumable hrid -> count. */
  consumablesUsed: Record<string, number>;
  /** Whether this player ran out of mana at any point. */
  ranOutOfMana: boolean;
  /** Total time spent out of mana (nanoseconds). */
  outOfManaTimeNs: number;
  /** HP spent by abilities: ability name -> amount. */
  hitpointsSpent: Record<string, number>;
  /** Total pre-clamp damage dealt (includes overkill). */
  totalPreClampDamageDealt: number;
  /** Drop rate multiplier for this player. */
  dropRateMultiplier: number;
  /** Rare find multiplier for this player. */
  rareFindMultiplier: number;
  /** Combat drop quantity bonus for this player. */
  combatDropQuantity: number;
  /** Debuff-on-level-gap multiplier. */
  debuffOnLevelGap: number;
}

/** Computed summary rates (derived from aggregated totals). */
export interface SummaryRates {
  /** Experience per hour keyed by skill name. */
  xpPerHour: ExperienceBreakdown;
  /** Total combined XP per hour (all skills). */
  totalXpPerHour: number;
  /** Encounters killed per hour. */
  killsPerHour: number;
  /** Average damage per second dealt to enemies (post-clamp, excludes overkill). */
  dps: number;
  /** Average damage per second including overkill (matches game DPS tracker). */
  preClampDps: number;
  /** Average healing per second done to allies. */
  hps: number;
  /** Average mana consumed per second. */
  manaPerSecond: number;
  /** Whether mana is sustainable (regen >= consumption over steady state). */
  manaSustainable: boolean;
  /** Average kill time per encounter in seconds. */
  avgKillTimeSec: number;
  /** Fraction of time spent alive (0-1). */
  uptimeRatio: number;
}

// -----------------------------------------------------------------------------
// Helper: create empty experience breakdown
// -----------------------------------------------------------------------------

function emptyExperience(): ExperienceBreakdown {
  return {
    stamina: 0,
    intelligence: 0,
    attack: 0,
    melee: 0,
    defense: 0,
    ranged: 0,
    magic: 0,
  };
}

function addExperience(
  target: ExperienceBreakdown,
  source: ExperienceBreakdown
): void {
  target.stamina += source.stamina;
  target.intelligence += source.intelligence;
  target.attack += source.attack;
  target.melee += source.melee;
  target.defense += source.defense;
  target.ranged += source.ranged;
  target.magic += source.magic;
}

function totalExperience(exp: ExperienceBreakdown): number {
  return (
    exp.stamina +
    exp.intelligence +
    exp.attack +
    exp.melee +
    exp.defense +
    exp.ranged +
    exp.magic
  );
}

function scaleExperience(
  exp: ExperienceBreakdown,
  factor: number
): ExperienceBreakdown {
  return {
    stamina: exp.stamina * factor,
    intelligence: exp.intelligence * factor,
    attack: exp.attack * factor,
    melee: exp.melee * factor,
    defense: exp.defense * factor,
    ranged: exp.ranged * factor,
    magic: exp.magic * factor,
  };
}

// -----------------------------------------------------------------------------
// SimResult
// -----------------------------------------------------------------------------

/** One nanosecond in seconds for rate conversions. */
const NS_PER_SECOND = 1e9;
const NS_PER_HOUR = 3.6e12;

class SimResult {
  /** Zone hrid being simulated. */
  readonly zoneName: string;
  /** Difficulty tier. */
  readonly difficultyTier: number;
  /** Whether this is a dungeon zone. */
  readonly isDungeon: boolean;
  /** Number of players. */
  readonly numberOfPlayers: number;

  /** Total simulation time elapsed in nanoseconds. */
  totalSimTimeNs: number = 0;
  /** Number of completed encounters. */
  encounters: number = 0;

  /** Per-player stats keyed by player hrid. */
  playerStats: Record<string, PlayerStats> = {};

  /** Per-encounter stats log (for cycle detection). */
  encounterLog: EncounterStats[] = [];

  /** Dungeon tracking. */
  dungeonsCompleted: number = 0;
  dungeonsFailed: number = 0;
  maxWaveReached: number = 0;

  constructor(
    zoneName: string,
    difficultyTier: number,
    isDungeon: boolean,
    numberOfPlayers: number
  ) {
    this.zoneName = zoneName;
    this.difficultyTier = difficultyTier;
    this.isDungeon = isDungeon;
    this.numberOfPlayers = numberOfPlayers;
  }

  // ---------------------------------------------------------------------------
  // Player initialization
  // ---------------------------------------------------------------------------

  /** Ensures a PlayerStats entry exists for the given player hrid. */
  initPlayer(playerHrid: string): void {
    if (!this.playerStats[playerHrid]) {
      this.playerStats[playerHrid] = {
        experienceGained: emptyExperience(),
        totalDamageDealt: 0,
        totalHealingReceived: 0,
        healingBySource: {},
        totalManaUsed: 0,
        manaByAbility: {},
        deaths: 0,
        deathCycles: [],
        totalDeadTimeNs: 0,
        consumablesUsed: {},
        ranOutOfMana: false,
        outOfManaTimeNs: 0,
        hitpointsSpent: {},
        totalPreClampDamageDealt: 0,
        dropRateMultiplier: 1.0,
        rareFindMultiplier: 1.0,
        combatDropQuantity: 0,
        debuffOnLevelGap: 0,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Recording methods
  // ---------------------------------------------------------------------------

  /** Records the completion of an encounter. */
  addEncounterEnd(): void {
    this.encounters++;
  }

  /** Records experience gained for a player. */
  addExperienceGain(playerHrid: string, experience: ExperienceBreakdown): void {
    this.initPlayer(playerHrid);
    addExperience(this.playerStats[playerHrid].experienceGained, experience);
  }

  /** Records damage dealt by a player. */
  addDamageDealt(playerHrid: string, amount: number): void {
    this.initPlayer(playerHrid);
    this.playerStats[playerHrid].totalDamageDealt += amount;
  }

  /** Records pre-clamp damage dealt by a player (includes overkill). */
  addPreClampDamageDealt(playerHrid: string, amount: number): void {
    this.initPlayer(playerHrid);
    this.playerStats[playerHrid].totalPreClampDamageDealt += amount;
  }

  /** Records healing received by a player from a source. */
  addHealingReceived(
    playerHrid: string,
    sourceName: string,
    amount: number
  ): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.totalHealingReceived += amount;
    stats.healingBySource[sourceName] =
      (stats.healingBySource[sourceName] || 0) + amount;
  }

  /** Records mana consumed by a player for an ability. */
  addManaUsed(
    playerHrid: string,
    abilityHrid: string,
    amount: number
  ): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.totalManaUsed += amount;
    stats.manaByAbility[abilityHrid] =
      (stats.manaByAbility[abilityHrid] || 0) + amount;
  }

  /** Records a player death with timing. */
  addDeath(
    playerHrid: string,
    timeAliveNs: number,
    respawnTimeNs: number
  ): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.deaths++;
    stats.deathCycles.push({ timeAliveNs, respawnTimeNs });
    stats.totalDeadTimeNs += respawnTimeNs;
  }

  /** Records consumable use. */
  addConsumableUse(playerHrid: string, consumableHrid: string): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.consumablesUsed[consumableHrid] =
      (stats.consumablesUsed[consumableHrid] || 0) + 1;
  }

  /** Records HP spent by an ability. */
  addHitpointsSpent(
    playerHrid: string,
    abilityName: string,
    amount: number
  ): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.hitpointsSpent[abilityName] =
      (stats.hitpointsSpent[abilityName] || 0) + amount;
  }

  /** Sets the out-of-mana flag for a player. */
  setOutOfMana(playerHrid: string, outOfManaTimeNs: number): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.ranOutOfMana = true;
    stats.outOfManaTimeNs += outOfManaTimeNs;
  }

  /** Sets loot multipliers for a player. */
  setLootMultipliers(
    playerHrid: string,
    dropRate: number,
    rareFind: number,
    dropQuantity: number,
    debuffOnLevelGap: number
  ): void {
    this.initPlayer(playerHrid);
    const stats = this.playerStats[playerHrid];
    stats.dropRateMultiplier = dropRate;
    stats.rareFindMultiplier = rareFind;
    stats.combatDropQuantity = dropQuantity;
    stats.debuffOnLevelGap = debuffOnLevelGap;
  }

  /** Logs a per-encounter stats snapshot (for cycle detection). */
  logEncounter(stats: EncounterStats): void {
    this.encounterLog.push(stats);
  }

  // ---------------------------------------------------------------------------
  // Summary computation
  // ---------------------------------------------------------------------------

  /**
   * Computes summary rates for a specific player.
   * If totalSimTimeNs is 0, returns all zeros.
   */
  computeSummary(playerHrid: string): SummaryRates {
    const stats = this.playerStats[playerHrid];
    if (!stats || this.totalSimTimeNs <= 0) {
      return {
        xpPerHour: emptyExperience(),
        totalXpPerHour: 0,
        killsPerHour: 0,
        dps: 0,
        preClampDps: 0,
        hps: 0,
        manaPerSecond: 0,
        manaSustainable: true,
        avgKillTimeSec: 0,
        uptimeRatio: 1.0,
      };
    }

    const hoursElapsed = this.totalSimTimeNs / NS_PER_HOUR;
    const secondsElapsed = this.totalSimTimeNs / NS_PER_SECOND;
    const aliveTimeNs = this.totalSimTimeNs - stats.totalDeadTimeNs;
    const aliveSeconds = aliveTimeNs / NS_PER_SECOND;

    const xpPerHour = scaleExperience(
      stats.experienceGained,
      1.0 / hoursElapsed
    );

    const avgKillTimeSec =
      this.encounters > 0
        ? this.encounterLog.reduce((sum, e) => sum + e.killTimeNs, 0) /
          this.encounters /
          NS_PER_SECOND
        : 0;

    const manaPerSecond =
      aliveSeconds > 0 ? stats.totalManaUsed / aliveSeconds : 0;

    return {
      xpPerHour,
      totalXpPerHour: totalExperience(xpPerHour),
      killsPerHour: this.encounters / hoursElapsed,
      dps: aliveSeconds > 0 ? stats.totalDamageDealt / aliveSeconds : 0,
      preClampDps: aliveSeconds > 0 ? stats.totalPreClampDamageDealt / aliveSeconds : 0,
      hps: aliveSeconds > 0 ? stats.totalHealingReceived / aliveSeconds : 0,
      manaPerSecond,
      manaSustainable: !stats.ranOutOfMana,
      avgKillTimeSec,
      uptimeRatio: this.totalSimTimeNs > 0
        ? aliveTimeNs / this.totalSimTimeNs
        : 1.0,
    };
  }

  /**
   * Creates a new SimResult from a subset of encounter logs (for cycle-based
   * extraction). Scales all aggregated values proportionally.
   */
  static fromCycleSlice(
    source: SimResult,
    cycleStart: number,
    cycleEnd: number
  ): SimResult {
    const slicedEncounters = source.encounterLog.slice(cycleStart, cycleEnd);
    const cycleCount = slicedEncounters.length;

    if (cycleCount === 0) return source;

    const result = new SimResult(
      source.zoneName,
      source.difficultyTier,
      source.isDungeon,
      source.numberOfPlayers
    );

    result.encounters = cycleCount;
    result.encounterLog = slicedEncounters;

    // Sum cycle time from encounter logs
    result.totalSimTimeNs = slicedEncounters.reduce(
      (sum, e) => sum + e.killTimeNs,
      0
    );

    // Reconstruct per-player stats from encounter logs
    for (const [playerHrid, playerStats] of Object.entries(
      source.playerStats
    )) {
      result.initPlayer(playerHrid);
      const destStats = result.playerStats[playerHrid];

      // Scale experience proportionally based on encounter count ratio
      const ratio = cycleCount / source.encounters;
      destStats.experienceGained = scaleExperience(
        playerStats.experienceGained,
        ratio
      );
      destStats.totalDamageDealt = playerStats.totalDamageDealt * ratio;
      destStats.totalPreClampDamageDealt = playerStats.totalPreClampDamageDealt * ratio;
      destStats.totalHealingReceived =
        playerStats.totalHealingReceived * ratio;
      destStats.totalManaUsed = playerStats.totalManaUsed * ratio;

      // Copy loot multipliers (these don't scale)
      destStats.dropRateMultiplier = playerStats.dropRateMultiplier;
      destStats.rareFindMultiplier = playerStats.rareFindMultiplier;
      destStats.combatDropQuantity = playerStats.combatDropQuantity;
      destStats.debuffOnLevelGap = playerStats.debuffOnLevelGap;
      destStats.ranOutOfMana = playerStats.ranOutOfMana;
    }

    return result;
  }
}

export default SimResult;
export {
  emptyExperience,
  addExperience,
  totalExperience,
  scaleExperience,
};
