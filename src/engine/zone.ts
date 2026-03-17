// =============================================================================
// Zone - Combat zone with deterministic encounter enumeration
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/zone.js
// Key change: replaces getRandomEncounter() with getAllEncounterCompositions()
// that returns every possible spawn composition with its probability.
// Data imports replaced with dependency injection via GameData parameter.

import type {
  GameData,
  ActionData,
  ZoneAction,
  CombatZoneInfo,
  FightInfo,
  DungeonInfo,
  RandomSpawnInfo,
  SpawnEntry,
  BossSpawn,
  BuffData,
} from "./types";
import { BATTLES_PER_BOSS } from "./constants";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A single monster reference within an encounter composition. */
export interface EncounterMonsterRef {
  hrid: string;
  difficultyTier: number;
}

/** A single possible encounter composition with its probability. */
export interface EncounterComposition {
  monsters: EncounterMonsterRef[];
  probability: number;
}

/** The full encounter distribution for a zone, including boss encounters. */
export interface EncounterDistribution {
  /** All possible random (non-boss) encounter compositions with probabilities. */
  randomEncounters: EncounterComposition[];
  /** Boss encounter (if the zone has bosses). Appears every BATTLES_PER_BOSS fights. */
  bossEncounter: EncounterComposition | null;
  /** Number of random encounters between each boss spawn. */
  battlesPerBoss: number;
}

// -----------------------------------------------------------------------------
// Zone
// -----------------------------------------------------------------------------

class Zone {
  readonly hrid: string;
  readonly difficultyTier: number;
  readonly isDungeon: boolean;
  readonly buffs: BuffData[] | null;

  /** Fight info for non-dungeon zones. */
  private readonly fightInfo: FightInfo;
  /** Dungeon info (null for non-dungeon zones). */
  private readonly dungeonInfo: DungeonInfo;
  /** Current encounter counter (1-based, used for dungeon wave tracking). */
  private encountersKilled: number = 1;
  /** Number of completed dungeon runs. */
  dungeonsCompleted: number = 0;
  /** Number of failed dungeon runs. */
  dungeonsFailed: number = 0;

  private readonly gameData: GameData;

  constructor(hrid: string, difficultyTier: number, gameData: GameData) {
    this.hrid = hrid;
    this.difficultyTier = difficultyTier;
    this.gameData = gameData;

    const gameZone = gameData.actionDetailMap[this.hrid] as ZoneAction;
    if (!gameZone || !gameZone.combatZoneInfo) {
      throw new Error(`No combat zone found for hrid: ${this.hrid}`);
    }

    this.fightInfo = gameZone.combatZoneInfo.fightInfo;
    this.dungeonInfo = gameZone.combatZoneInfo.dungeonInfo;
    this.isDungeon = gameZone.combatZoneInfo.isDungeon;
    this.buffs = gameZone.buffs;
  }

  // ---------------------------------------------------------------------------
  // Encounter Enumeration (replaces getRandomEncounter)
  // ---------------------------------------------------------------------------

  /**
   * Returns all possible encounter compositions for this zone with their
   * probabilities, plus the boss encounter if applicable.
   *
   * For the deterministic simulator, the caller can simulate each composition
   * separately and take the weighted average of the results.
   */
  getAllEncounterCompositions(): EncounterDistribution {
    const randomEncounters = this.enumerateRandomSpawns(
      this.fightInfo.randomSpawnInfo
    );

    let bossEncounter: EncounterComposition | null = null;
    if (this.fightInfo.bossSpawns && this.fightInfo.bossSpawns.length > 0) {
      bossEncounter = {
        monsters: this.fightInfo.bossSpawns.map((boss) => ({
          hrid: boss.combatMonsterHrid,
          difficultyTier: boss.difficultyTier + this.difficultyTier,
        })),
        probability: 1.0,
      };
    }

    return {
      randomEncounters,
      bossEncounter,
      battlesPerBoss: BATTLES_PER_BOSS,
    };
  }

  /**
   * Enumerates all valid encounter compositions from a RandomSpawnInfo.
   *
   * Algorithm:
   * 1. At each slot (up to maxSpawnCount), pick one of the available spawns
   *    weighted by rate.
   * 2. If adding the picked monster would exceed maxTotalStrength, stop filling
   *    (the encounter ends with fewer monsters).
   * 3. Track the probability as the product of (rate / totalRate) at each pick.
   * 4. Merge duplicate compositions (same multiset of monsters regardless of
   *    pick order) and sum their probabilities.
   */
  private enumerateRandomSpawns(
    spawnInfo: RandomSpawnInfo
  ): EncounterComposition[] {
    if (!spawnInfo.spawns || spawnInfo.spawns.length === 0) {
      return [{ monsters: [], probability: 1.0 }];
    }

    const totalRate = spawnInfo.spawns.reduce((sum, s) => sum + s.rate, 0);
    if (totalRate === 0) {
      return [{ monsters: [], probability: 1.0 }];
    }

    // Accumulator: maps a canonical composition key to its aggregated probability
    // and the monster list.
    const results = new Map<string, EncounterComposition>();

    // Recursive enumeration
    this.enumerateSlots(
      spawnInfo.spawns,
      totalRate,
      spawnInfo.maxSpawnCount,
      spawnInfo.maxTotalStrength,
      0, // current slot
      0, // current total strength
      [], // monsters picked so far
      1.0, // accumulated probability
      results
    );

    return Array.from(results.values());
  }

  /**
   * Recursive helper that fills one slot at a time.
   *
   * At each slot we branch into N paths (one per spawn entry). If a spawn
   * would exceed maxTotalStrength, that branch terminates with the current
   * composition (the encounter is "full" by strength). If we reach
   * maxSpawnCount, all branches terminate.
   */
  private enumerateSlots(
    spawns: SpawnEntry[],
    totalRate: number,
    maxSlots: number,
    maxStrength: number,
    currentSlot: number,
    currentStrength: number,
    currentMonsters: EncounterMonsterRef[],
    currentProb: number,
    results: Map<string, EncounterComposition>
  ): void {
    // Base case: all slots filled
    if (currentSlot >= maxSlots) {
      this.mergeComposition(results, currentMonsters, currentProb);
      return;
    }

    // Try each possible spawn for this slot
    for (const spawn of spawns) {
      const pickProb = spawn.rate / totalRate;
      const newStrength = currentStrength + spawn.strength;

      if (newStrength > maxStrength) {
        // This pick would exceed strength limit -> encounter stops here
        // (the monster is NOT added; the encounter ends with current monsters)
        this.mergeComposition(
          results,
          currentMonsters,
          currentProb * pickProb
        );
      } else {
        // Monster fits: add it and continue to next slot
        const newMonsters = [
          ...currentMonsters,
          {
            hrid: spawn.combatMonsterHrid,
            difficultyTier: spawn.difficultyTier + this.difficultyTier,
          },
        ];
        this.enumerateSlots(
          spawns,
          totalRate,
          maxSlots,
          maxStrength,
          currentSlot + 1,
          newStrength,
          newMonsters,
          currentProb * pickProb,
          results
        );
      }
    }
  }

  /**
   * Merges a composition into the results map. Compositions with the same
   * multiset of monsters (regardless of pick order) are combined by summing
   * their probabilities.
   *
   * The canonical key is the sorted list of "hrid:difficultyTier" strings.
   */
  private mergeComposition(
    results: Map<string, EncounterComposition>,
    monsters: EncounterMonsterRef[],
    probability: number
  ): void {
    if (probability <= 0) return;

    const key = this.compositionKey(monsters);
    const existing = results.get(key);

    if (existing) {
      existing.probability += probability;
    } else {
      results.set(key, {
        monsters: [...monsters],
        probability,
      });
    }
  }

  /**
   * Creates a canonical string key for a multiset of monsters.
   * Sorted so that [A, B] and [B, A] produce the same key.
   */
  private compositionKey(monsters: EncounterMonsterRef[]): string {
    if (monsters.length === 0) return "empty";
    return monsters
      .map((m) => `${m.hrid}:${m.difficultyTier}`)
      .sort()
      .join("|");
  }

  // ---------------------------------------------------------------------------
  // Dungeon Wave Support (kept from original)
  // ---------------------------------------------------------------------------

  /**
   * Returns the next dungeon wave encounter.
   * For fixed waves, returns the fixed spawn. For random waves, enumerates
   * all possible compositions (same algorithm as getAllEncounterCompositions).
   */
  getNextWave(): EncounterComposition[] {
    if (this.encountersKilled > this.dungeonInfo.maxWaves) {
      this.dungeonsCompleted++;
      this.encountersKilled = 1;
    }

    const waveNum = this.encountersKilled.toString();

    // Check for fixed spawns first
    if (
      this.dungeonInfo.fixedSpawnsMap &&
      this.dungeonInfo.fixedSpawnsMap.hasOwnProperty(waveNum)
    ) {
      const fixedMonsters = this.dungeonInfo.fixedSpawnsMap[waveNum];
      this.encountersKilled++;
      return [
        {
          monsters: fixedMonsters.map((m) => ({
            hrid: m.combatMonsterHrid,
            difficultyTier: m.difficultyTier + this.difficultyTier,
          })),
          probability: 1.0,
        },
      ];
    }

    // Random wave spawns
    const monsterSpawns = this.getRandomSpawnInfoForWave(this.encountersKilled);
    this.encountersKilled++;

    if (!monsterSpawns) {
      return [{ monsters: [], probability: 1.0 }];
    }

    return this.enumerateRandomSpawns(monsterSpawns);
  }

  /**
   * Finds the RandomSpawnInfo applicable to a given dungeon wave number.
   * Wave ranges are determined by the sorted numeric keys of randomSpawnInfoMap.
   */
  private getRandomSpawnInfoForWave(
    waveNumber: number
  ): RandomSpawnInfo | null {
    if (!this.dungeonInfo.randomSpawnInfoMap) return null;

    const waveKeys = Object.keys(this.dungeonInfo.randomSpawnInfoMap)
      .map(Number)
      .sort((a, b) => a - b);

    if (waveKeys.length === 0) return null;

    // If wave exceeds all keys, use the last one
    if (waveNumber > waveKeys[waveKeys.length - 1]) {
      return this.dungeonInfo.randomSpawnInfoMap[
        waveKeys[waveKeys.length - 1]
      ];
    }

    // Find the range bracket
    for (let i = 0; i < waveKeys.length - 1; i++) {
      if (waveNumber >= waveKeys[i] && waveNumber <= waveKeys[i + 1]) {
        return this.dungeonInfo.randomSpawnInfoMap[waveKeys[i]];
      }
    }

    // Fallback to first key
    return this.dungeonInfo.randomSpawnInfoMap[waveKeys[0]];
  }

  /**
   * Called when a dungeon wave is failed (party wipe).
   * Resets the encounter counter and increments the failure count.
   */
  failWave(): void {
    this.dungeonsFailed++;
    this.encountersKilled = 1;
  }

  /**
   * Returns the maximum number of dungeon waves.
   */
  getMaxWaves(): number {
    return this.dungeonInfo.maxWaves;
  }

  /**
   * Returns the current wave number (1-based).
   */
  getCurrentWave(): number {
    return this.encountersKilled;
  }

  /**
   * Resets the encounter counter (for starting a new cycle).
   */
  resetEncounterCounter(): void {
    this.encountersKilled = 1;
  }

  // ---------------------------------------------------------------------------
  // Labyrinth Zone Factory
  // ---------------------------------------------------------------------------

  /**
   * Creates a minimal Zone for a labyrinth 1v1 fight.
   * The zone has a single encounter with one monster at the given difficulty tier.
   * Not a dungeon; no boss cycle; no buffs.
   */
  static createLabyrinthZone(
    monsterHrid: string,
    difficultyTier: number = 0
  ): Zone {
    // Use Object.create to bypass the constructor (which requires gameData lookup)
    const zone = Object.create(Zone.prototype) as Zone;

    // Set all readonly fields via assignment (bypassing TS readonly for init)
    (zone as any).hrid = `/labyrinth/${monsterHrid.split("/").pop()}`;
    (zone as any).difficultyTier = difficultyTier;
    (zone as any).isDungeon = false;
    (zone as any).buffs = null;
    (zone as any).fightInfo = {
      randomSpawnInfo: {
        maxSpawnCount: 1,
        maxTotalStrength: 999,
        spawns: [
          {
            combatMonsterHrid: monsterHrid,
            rate: 1,
            strength: 1,
            difficultyTier: 0,
          },
        ],
      },
      bossSpawns: null,
    };
    (zone as any).dungeonInfo = {
      keyItemHrid: "",
      rewardDropTable: null,
      maxWaves: 0,
      randomSpawnInfoMap: null,
      fixedSpawnsMap: null,
    };
    (zone as any).gameData = null;
    (zone as any).encountersKilled = 1;
    zone.dungeonsCompleted = 0;
    zone.dungeonsFailed = 0;

    return zone;
  }
}

export default Zone;
