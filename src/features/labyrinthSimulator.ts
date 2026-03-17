// =============================================================================
// Labyrinth Simulator - Binary search for max labyrinth level per monster
// =============================================================================
// The labyrinth is a 1v1 mode: one player fights one monster at a scaled level.
// Monsters scale proportionally (targetLevel / 100 * baseStats).
// Time limit: 120 seconds per fight. No consumables; only crate buffs.
// Since the sim is deterministic, each level only needs ONE fight.

import type { GameData, PlayerConfig, BuffData } from "../engine/types";
import Player from "../engine/player";
import Monster from "../engine/monster";
import Zone from "../engine/zone";
import Ability from "../engine/ability";
import Equipment from "../engine/equipment";
import Consumable from "../engine/consumable";
import Buff from "../engine/buff";
import DeterministicSimulator from "../engine/deterministicSimulator";

// =============================================================================
// Types
// =============================================================================

export type CrateTier = "none" | "basic" | "advanced" | "expert";

export interface LabyrinthResult {
  monsterHrid: string;
  maxLevel: number;
  rawMaxLevel: number;
  killTimeNs: number;
  estimatedClearRate: number;
}

export interface LabyrinthProgress {
  monsterHrid: string;
  currentLevel: number;
}

export interface LabyrinthFightResult {
  success: boolean;
  killTimeNs: number;
}

// =============================================================================
// Constants
// =============================================================================

const ONE_SECOND = 1e9;
const LABYRINTH_TIME_LIMIT_NS = 120 * ONE_SECOND; // 2 minutes
const DEFAULT_CV = 0.10; // coefficient of variation for kill time distribution
const DEFAULT_LEVEL_CV = 0.05; // coefficient of variation for level-based variance (~5% deterministic bias)

// =============================================================================
// Normal Distribution Utilities
// =============================================================================

/**
 * Standard normal CDF using rational approximation (Abramowitz & Stegun 26.2.17).
 * Accurate to ~1.5e-7.
 */
export function normalCDF(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Inverse standard normal CDF using rational approximation (Peter Acklam).
 * Accurate to ~1.15e-9 for 0 < p < 1.
 */
export function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

/**
 * Compute the adjusted time limit in nanoseconds for a target success rate.
 * Model: kill time ~ Normal(T, CV*T). For success rate p, we need
 * T <= timeLimit / (1 + z_p * CV).
 */
export function computeAdjustedTimeLimit(
  successRate: number,
  cv: number = DEFAULT_CV
): number {
  const z = inverseNormalCDF(successRate);
  return LABYRINTH_TIME_LIMIT_NS / (1 + z * cv);
}

/**
 * Compute the estimated probability of clearing within the time limit,
 * given an expected kill time from the deterministic sim.
 */
export function computeClearRate(
  expectedKillTimeNs: number,
  cv: number = DEFAULT_CV
): number {
  if (expectedKillTimeNs <= 0) return 0;
  const std = cv * expectedKillTimeNs;
  if (std <= 0) return expectedKillTimeNs <= LABYRINTH_TIME_LIMIT_NS ? 1 : 0;
  const z = (LABYRINTH_TIME_LIMIT_NS - expectedKillTimeNs) / std;
  return normalCDF(z);
}

/**
 * Compute adjusted max level for a target success rate.
 * The deterministic max level represents the ~50th percentile outcome.
 * For higher target CRs, reduce the level proportionally:
 *   adjustedLevel = floor(rawMaxLevel / (1 + z * CV))
 * where z = inverseNormalCDF(successRate) and CV = DEFAULT_LEVEL_CV.
 */
export function computeAdjustedLevel(
  rawMaxLevel: number,
  successRate: number,
  cv: number = DEFAULT_LEVEL_CV
): number {
  if (rawMaxLevel <= 0) return 0;
  const z = inverseNormalCDF(successRate);
  const adjusted = Math.floor(rawMaxLevel / (1 + z * cv));
  return Math.max(0, adjusted);
}

/**
 * Compute the estimated clear rate at a given level, based on
 * the raw max level from the deterministic sim.
 * Inverse of computeAdjustedLevel: find the success rate p such that
 *   level = floor(rawMaxLevel / (1 + z_p * CV))
 * Equivalently: z = (rawMaxLevel / level - 1) / CV
 */
export function computeLevelBasedClearRate(
  level: number,
  rawMaxLevel: number,
  cv: number = DEFAULT_LEVEL_CV
): number {
  if (level <= 0 || rawMaxLevel <= 0) return 0;
  // z = (rawMaxLevel/level - 1) / cv; works for both above and below raw max.
  // At rawMax: z=0 → 50%. Below: z>0 → >50%. Above: z<0 → <50%.
  const z = (rawMaxLevel / level - 1) / cv;
  return normalCDF(z);
}

// =============================================================================
// Crate Buff Definitions
// =============================================================================
// Ported from stochastic sim's labyrinthSimulator.js

function makeCrateBuff(
  uniqueSuffix: string,
  typeHrid: string,
  flatBoost: number,
  ratioBoost: number
): BuffData {
  return {
    uniqueHrid: `/buff_uniques/labyrinth_crate_${uniqueSuffix}`,
    typeHrid,
    flatBoost,
    flatBoostLevelBonus: 0,
    ratioBoost,
    ratioBoostLevelBonus: 0,
    startTime: 0,
    duration: 0,
  };
}

function makeLevelBuffs(flatBoost: number): BuffData[] {
  return [
    makeCrateBuff("stamina_level", "/buff_types/stamina_level", flatBoost, 0),
    makeCrateBuff("intelligence_level", "/buff_types/intelligence_level", flatBoost, 0),
    makeCrateBuff("attack_level", "/buff_types/attack_level", flatBoost, 0),
    makeCrateBuff("defense_level", "/buff_types/defense_level", flatBoost, 0),
    makeCrateBuff("melee_level", "/buff_types/melee_level", flatBoost, 0),
    makeCrateBuff("ranged_level", "/buff_types/ranged_level", flatBoost, 0),
    makeCrateBuff("magic_level", "/buff_types/magic_level", flatBoost, 0),
  ];
}

const CRATE_BUFFS: Record<string, Record<string, BuffData[]>> = {
  coffee: {
    basic: [
      ...makeLevelBuffs(5),
      makeCrateBuff("attack_speed", "/buff_types/attack_speed", 0, 0.05),
      makeCrateBuff("cast_speed", "/buff_types/cast_speed", 0.05, 0),
    ],
    advanced: [
      ...makeLevelBuffs(10),
      makeCrateBuff("attack_speed", "/buff_types/attack_speed", 0, 0.10),
      makeCrateBuff("cast_speed", "/buff_types/cast_speed", 0.10, 0),
      makeCrateBuff("critical_rate", "/buff_types/critical_rate", 0.03, 0),
      makeCrateBuff("critical_damage", "/buff_types/critical_damage", 0.05, 0),
    ],
    expert: [
      ...makeLevelBuffs(15),
      makeCrateBuff("attack_speed", "/buff_types/attack_speed", 0, 0.15),
      makeCrateBuff("cast_speed", "/buff_types/cast_speed", 0.15, 0),
      makeCrateBuff("critical_rate", "/buff_types/critical_rate", 0.06, 0),
      makeCrateBuff("critical_damage", "/buff_types/critical_damage", 0.10, 0),
    ],
  },
  food: {
    basic: [
      makeCrateBuff("hp_regen", "/buff_types/hp_regen", 0, 0.02),
      makeCrateBuff("mp_regen", "/buff_types/mp_regen", 0, 0.02),
    ],
    advanced: [
      makeCrateBuff("hp_regen", "/buff_types/hp_regen", 0, 0.04),
      makeCrateBuff("mp_regen", "/buff_types/mp_regen", 0, 0.04),
    ],
    expert: [
      makeCrateBuff("hp_regen", "/buff_types/hp_regen", 0, 0.06),
      makeCrateBuff("mp_regen", "/buff_types/mp_regen", 0, 0.06),
    ],
  },
};

// =============================================================================
// Crate Buff Builder
// =============================================================================

export function buildCrateBuffs(
  coffeeCrate: CrateTier,
  foodCrate: CrateTier
): Buff[] {
  const buffs: Buff[] = [];

  if (coffeeCrate !== "none" && CRATE_BUFFS.coffee[coffeeCrate]) {
    for (const bd of CRATE_BUFFS.coffee[coffeeCrate]) {
      buffs.push(new Buff(bd));
    }
  }

  if (foodCrate !== "none" && CRATE_BUFFS.food[foodCrate]) {
    for (const bd of CRATE_BUFFS.food[foodCrate]) {
      buffs.push(new Buff(bd));
    }
  }

  return buffs;
}

// =============================================================================
// Player Deps Builder (same as useSimulation)
// =============================================================================

function buildPlayerDeps(gameData: GameData) {
  return {
    Equipment: {
      createFromDTO: (
        dto: { hrid: string; enhancementLevel: number },
        _gd: GameData
      ) => Equipment.createFromDTO(gameData, dto),
    },
    Consumable: {
      createFromDTO: (
        dto: { hrid: string; triggers: any[] },
        _gd: GameData
      ) => Consumable.createFromDTO(gameData, dto),
    },
    Ability: {
      createFromDTO: (
        dto: { hrid: string; level: number; triggers: any[] },
        _gd: GameData
      ) => Ability.createFromDTO(gameData, dto),
    },
  };
}

// =============================================================================
// Single Labyrinth Fight
// =============================================================================

/**
 * Simulate a single labyrinth fight at a specific target level.
 * Returns success (monster killed within 120s) and kill time.
 */
export function simulateLabyrinthFight(
  playerConfig: PlayerConfig,
  monsterHrid: string,
  targetLevel: number,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number,
  gameData: GameData,
  timeLimitNs: number = LABYRINTH_TIME_LIMIT_NS
): LabyrinthFightResult {
  // Create fresh player
  const deps = buildPlayerDeps(gameData);
  const player = Player.createFromDTO(playerConfig, gameData, deps);

  // Apply crate buffs + seal buffs as extra buffs
  player.extraBuffs = [...crateBuffs, ...sealBuffs];
  player.wisdomBuffBonus = wisdomBuffBonus;

  // Clear consumables - labyrinth only uses crate buffs
  player.food = [null, null, null];
  player.drinks = [null, null, null];

  // Create a labyrinth zone with the single monster
  const zone = Zone.createLabyrinthZone(monsterHrid);

  // Run the deterministic simulator for a single encounter.
  // labyrinthTargetLevel in the config tells the sim to apply
  // proportional scaling to all spawned monsters.
  const simulator = new DeterministicSimulator([player], zone, gameData, {
    stopAfterFirstEncounter: true,
    labyrinthTargetLevel: targetLevel,
    maxSimTimeNs: timeLimitNs,
  });
  const simResult = simulator.simulate();

  const simTimeNs = simResult.totalSimTimeNs;
  const monsterKilled = simResult.encounters > 0;

  // Log diagnostics for fights that took more than 50% of the time limit or failed
  if (simTimeNs > timeLimitNs * 0.5 || !monsterKilled) {
    const playerKey = Object.keys(simResult.playerStats).find(k => !k.startsWith('/'));
    const ps = playerKey ? simResult.playerStats[playerKey] : null;
    const overkillPct = ps && ps.totalPreClampDamageDealt > 0
      ? ((1 - ps.totalDamageDealt / ps.totalPreClampDamageDealt) * 100).toFixed(1) : '0.0';
    const oom = ps?.ranOutOfMana ? ` OOM=${(ps.outOfManaTimeNs / 1e9).toFixed(0)}s` : '';
    console.error(`[LAB] ${monsterHrid.split('/').pop()} lvl=${targetLevel}: ${monsterKilled ? 'KILL' : 'FAIL'} time=${(simTimeNs / 1e9).toFixed(1)}s overkill=${overkillPct}%${oom} dps=${ps ? (ps.totalDamageDealt / (simTimeNs / 1e9)).toFixed(0) : '?'}`);
  }

  return {
    success: monsterKilled,
    killTimeNs: monsterKilled ? simTimeNs : LABYRINTH_TIME_LIMIT_NS,
  };
}

// =============================================================================
// Binary Search for Max Level
// =============================================================================

/**
 * Find the maximum labyrinth level where the player can kill the monster
 * within 120 seconds using a binary search.
 */
export function findMaxLabyrinthLevel(
  playerConfig: PlayerConfig,
  monsterHrid: string,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number,
  gameData: GameData,
  maxLevel: number = 300,
  onProgress?: (level: number) => void,
  successRate: number = 0.5
): { maxLevel: number; killTimeNs: number; rawMaxLevel: number } {
  // Binary search always uses the full 120s time limit to find the raw max
  let low = 1;
  let high = maxLevel;
  let bestLevel = 0;
  let bestKillTime = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    onProgress?.(mid);

    const result = simulateLabyrinthFight(
      playerConfig,
      monsterHrid,
      mid,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData
    );

    if (result.success) {
      bestLevel = mid;
      bestKillTime = result.killTimeNs;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const rawMaxLevel = bestLevel;

  // Apply level-based variance adjustment for success rates > 50%
  const adjustedLevel = computeAdjustedLevel(rawMaxLevel, successRate);

  // If adjusted level differs, run one more sim to get its kill time
  let finalKillTime = bestKillTime;
  if (adjustedLevel < rawMaxLevel && adjustedLevel > 0) {
    const adjResult = simulateLabyrinthFight(
      playerConfig,
      monsterHrid,
      adjustedLevel,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData
    );
    finalKillTime = adjResult.killTimeNs;
  }

  return { maxLevel: adjustedLevel, killTimeNs: finalKillTime, rawMaxLevel };
}

// =============================================================================
// Run All Monsters
// =============================================================================

/**
 * Get the list of all labyrinth monster hrids from game data.
 */
export function getLabyrinthMonsters(gameData: GameData): string[] {
  return Object.entries(gameData.combatMonsterDetailMap)
    .filter(([, m]) => m.isLabyrinthMonster)
    .map(([hrid]) => hrid);
}

/**
 * Find max level for all labyrinth monsters.
 * Optionally accepts a per-monster loadout map for using different
 * equipment/ability setups against different monsters.
 */
export function findAllLabyrinthLevels(
  defaultPlayerConfig: PlayerConfig,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number,
  gameData: GameData,
  maxLevel: number = 300,
  onProgress?: (progress: LabyrinthProgress) => void,
  monsterLoadoutMap?: Record<string, PlayerConfig>,
  successRate: number = 0.5
): LabyrinthResult[] {
  const monsters = getLabyrinthMonsters(gameData);
  const results: LabyrinthResult[] = [];

  for (const monsterHrid of monsters) {
    const playerConfig = monsterLoadoutMap?.[monsterHrid] ?? defaultPlayerConfig;

    const result = findMaxLabyrinthLevel(
      playerConfig,
      monsterHrid,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData,
      maxLevel,
      (currentLevel) => onProgress?.({ monsterHrid, currentLevel }),
      successRate
    );

    results.push({
      monsterHrid,
      maxLevel: result.maxLevel,
      rawMaxLevel: result.rawMaxLevel,
      killTimeNs: result.killTimeNs,
      estimatedClearRate: result.maxLevel > 0
        ? computeLevelBasedClearRate(result.maxLevel, result.rawMaxLevel)
        : 0,
    });
  }

  return results;
}
