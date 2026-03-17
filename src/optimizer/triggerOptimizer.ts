// =============================================================================
// triggerOptimizer - Trigger threshold optimizer using golden-section search
// =============================================================================
// For each tunable trigger parameter:
//   1. Probe phase: test one alternative value to check sensitivity (1 sim)
//   2. If insensitive (< 0.1% XP/hr change), skip entirely
//   3. If sensitive, golden-section search to find the optimum (~10 sims)
// This is dramatically faster than a full sweep for dungeon parties where
// most triggers on non-primary players have no impact on XP/hr.

import type { GameData, PlayerConfig, TriggerData } from "../engine/types";
import type { XpBonusSettings } from "../hooks/useSimulation";
import { executeSimulation } from "../hooks/useSimulation.utils";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TriggerImprovement {
  playerHrid: string;
  playerIndex: number;
  itemHrid: string;
  triggerPath: string;
  triggerIndex: number;
  conditionName: string;
  originalValue: number;
  optimizedValue: number;
  xpPerHourDelta: number;
}

export interface OptimizationResult {
  optimizedConfigs: PlayerConfig[];
  improvements: TriggerImprovement[];
  baselineXpPerHour: number;
  optimizedXpPerHour: number;
  totalSimRuns: number;
}

/** A single tunable trigger parameter identified during the scan phase. */
interface TriggerParam {
  playerIndex: number;
  playerHrid: string;
  category: "food" | "abilities" | "specialAbility";
  slotIndex: number;
  triggerIndex: number;
  itemHrid: string;
  originalValue: number;
  range: [number, number];
  conditionName: string;
  path: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VALUE_COMPARATORS = new Set([
  "/combat_trigger_comparators/greater_than_equal",
  "/combat_trigger_comparators/less_than_equal",
]);

const HP_CONDITIONS = new Set([
  "/combat_trigger_conditions/current_hp",
  "/combat_trigger_conditions/missing_hp",
]);
const MP_CONDITIONS = new Set([
  "/combat_trigger_conditions/current_mp",
  "/combat_trigger_conditions/missing_mp",
]);
const UNIT_COUNT_CONDITIONS = new Set([
  "/combat_trigger_conditions/number_of_active_units",
  "/combat_trigger_conditions/number_of_dead_units",
]);

/** Skip param if probe delta < 0.1% of baseline XP/hr. */
const SENSITIVITY_RATIO = 0.001;

/** Stop golden-section search when range narrows to this. */
const SEARCH_TOLERANCE = 25;

/** Brute-force ranges this small or smaller. */
const BRUTE_FORCE_THRESHOLD = 10;

/** Golden ratio constants. */
const GOLDEN_RESPHI = 2 - (1 + Math.sqrt(5)) / 2; // ~0.382

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function estimateMaxHp(staminaLevel: number): number {
  return Math.max(500, staminaLevel * 12);
}

function estimateMaxMp(intelligenceLevel: number): number {
  return Math.max(200, intelligenceLevel * 8);
}

function estimateRange(
  conditionHrid: string,
  staminaLevel: number,
  intelligenceLevel: number
): [number, number] {
  if (HP_CONDITIONS.has(conditionHrid))
    return [0, estimateMaxHp(staminaLevel)];
  if (MP_CONDITIONS.has(conditionHrid))
    return [0, estimateMaxMp(intelligenceLevel)];
  if (UNIT_COUNT_CONDITIONS.has(conditionHrid)) return [0, 5];
  if (conditionHrid === "/combat_trigger_conditions/lowest_hp_percentage")
    return [0, 100];
  return [0, 1000];
}

function cloneConfigs(configs: PlayerConfig[]): PlayerConfig[] {
  return JSON.parse(JSON.stringify(configs));
}

function getTriggerValue(
  configs: PlayerConfig[],
  param: TriggerParam
): number {
  const player = configs[param.playerIndex];
  if (param.category === "specialAbility") {
    return player.specialAbility!.triggers[param.triggerIndex].value;
  }
  return (player[param.category] as any[])[param.slotIndex].triggers[
    param.triggerIndex
  ].value;
}

function setTriggerValue(
  configs: PlayerConfig[],
  param: TriggerParam,
  value: number
): void {
  const player = configs[param.playerIndex];
  if (param.category === "specialAbility") {
    player.specialAbility!.triggers[param.triggerIndex].value = value;
  } else {
    (player[param.category] as any[])[param.slotIndex].triggers[
      param.triggerIndex
    ].value = value;
  }
}

function simXpPerHour(
  configs: PlayerConfig[],
  zoneHrid: string,
  difficultyTier: number,
  xpBonuses: XpBonusSettings,
  gameData: GameData
): number {
  return executeSimulation(
    { playerConfigs: configs, zoneHrid, difficultyTier, xpBonuses },
    gameData
  ).primarySummary.totalXpPerHour;
}

// -----------------------------------------------------------------------------
// Scan phase
// -----------------------------------------------------------------------------

function scanTriggerParams(
  configs: PlayerConfig[],
  gameData: GameData
): TriggerParam[] {
  const params: TriggerParam[] = [];

  for (let pi = 0; pi < configs.length; pi++) {
    const player = configs[pi];

    const scan = (
      triggers: TriggerData[],
      category: TriggerParam["category"],
      slotIndex: number,
      itemHrid: string,
      pathPrefix: string
    ) => {
      for (let ti = 0; ti < triggers.length; ti++) {
        const trigger = triggers[ti];
        if (!VALUE_COMPARATORS.has(trigger.comparatorHrid)) continue;
        params.push({
          playerIndex: pi,
          playerHrid: player.hrid,
          category,
          slotIndex,
          triggerIndex: ti,
          itemHrid,
          originalValue: trigger.value,
          range: estimateRange(
            trigger.conditionHrid,
            player.staminaLevel,
            player.intelligenceLevel
          ),
          conditionName:
            gameData.combatTriggerConditionDetailMap[trigger.conditionHrid]
              ?.name ?? trigger.conditionHrid,
          path: `${pathPrefix}.triggers[${ti}]`,
        });
      }
    };

    for (let si = 0; si < player.food.length; si++) {
      const slot = player.food[si];
      if (slot?.hrid) scan(slot.triggers, "food", si, slot.hrid, `food[${si}]`);
    }
    for (let si = 0; si < player.abilities.length; si++) {
      const slot = player.abilities[si];
      if (slot?.hrid)
        scan(slot.triggers, "abilities", si, slot.hrid, `abilities[${si}]`);
    }
    if (player.specialAbility?.hrid) {
      scan(
        player.specialAbility.triggers,
        "specialAbility",
        0,
        player.specialAbility.hrid,
        "specialAbility"
      );
    }
  }

  return params;
}

// -----------------------------------------------------------------------------
// Golden-section search (maximizes a unimodal function on integers)
// -----------------------------------------------------------------------------

/**
 * Find the integer value in [lo, hi] that maximizes `evaluate`.
 * Uses golden-section search — each iteration costs 1 sim and shrinks
 * the interval by factor ~0.618. Tracks the overall best across all
 * evaluations to handle slightly non-unimodal landscapes.
 */
function goldenSectionMax(
  lo: number,
  hi: number,
  tolerance: number,
  evaluate: (value: number) => number
): { bestValue: number; bestXp: number } {
  let bestValue = lo;
  let bestXp = -Infinity;

  const eval_ = (v: number) => {
    const xp = evaluate(v);
    if (xp > bestXp) {
      bestXp = xp;
      bestValue = v;
    }
    return xp;
  };

  let x1 = Math.round(lo + GOLDEN_RESPHI * (hi - lo));
  let x2 = Math.round(hi - GOLDEN_RESPHI * (hi - lo));
  let f1 = eval_(x1);
  let f2 = eval_(x2);

  while (hi - lo > tolerance) {
    if (x1 === x2) break; // interval too small for distinct integers

    if (f1 < f2) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = Math.round(hi - GOLDEN_RESPHI * (hi - lo));
      if (x2 === x1) break;
      f2 = eval_(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = Math.round(lo + GOLDEN_RESPHI * (hi - lo));
      if (x1 === x2) break;
      f1 = eval_(x1);
    }
  }

  return { bestValue, bestXp };
}

// -----------------------------------------------------------------------------
// Main optimizer
// -----------------------------------------------------------------------------

export function optimizeTriggers(
  playerConfigs: PlayerConfig[],
  zoneHrid: string,
  difficultyTier: number,
  xpBonuses: XpBonusSettings,
  gameData: GameData,
  onProgress?: (current: number, total: number) => void
): OptimizationResult {
  const configs = cloneConfigs(playerConfigs);
  const params = scanTriggerParams(configs, gameData);

  let simCount = 0;
  // Pessimistic estimate: 1 baseline + 1 probe per param + 10 search per param
  // Actual count will be lower because insensitive params are skipped.
  let estimatedTotal = 1 + params.length * 11;

  const runSim = () => {
    simCount++;
    onProgress?.(simCount, estimatedTotal);
    return simXpPerHour(configs, zoneHrid, difficultyTier, xpBonuses, gameData);
  };

  // ---- Phase 1: Baseline ----
  const baselineXpPerHour = runSim();
  const epsilon = baselineXpPerHour * SENSITIVITY_RATIO;

  if (params.length === 0) {
    return {
      optimizedConfigs: configs,
      improvements: [],
      baselineXpPerHour,
      optimizedXpPerHour: baselineXpPerHour,
      totalSimRuns: simCount,
    };
  }

  // ---- Phase 2: Probe each param for sensitivity (1 sim each) ----
  interface ProbeResult {
    param: TriggerParam;
    probeValue: number;
    probeXp: number;
    sensitive: boolean;
  }

  const probes: ProbeResult[] = [];

  for (const param of params) {
    const currentVal = getTriggerValue(configs, param);
    const [lo, hi] = param.range;
    const mid = Math.round((lo + hi) / 2);

    // Probe at the point most different from current
    const probeValue =
      currentVal <= mid
        ? Math.round(lo + (hi - lo) * 0.75)
        : Math.round(lo + (hi - lo) * 0.25);

    setTriggerValue(configs, param, probeValue);
    const probeXp = runSim();
    setTriggerValue(configs, param, currentVal); // restore

    probes.push({
      param,
      probeValue,
      probeXp,
      sensitive: Math.abs(probeXp - baselineXpPerHour) > epsilon,
    });
  }

  // Revise estimate now that we know sensitivity
  const sensitiveCount = probes.filter((p) => p.sensitive).length;
  estimatedTotal = simCount + sensitiveCount * 10;

  // ---- Phase 3: Optimize sensitive params ----
  let currentBestXp = baselineXpPerHour;
  const improvements: TriggerImprovement[] = [];

  for (const { param, probeValue, probeXp, sensitive } of probes) {
    if (!sensitive) {
      // Insensitive — keep original value, record no change
      improvements.push({
        playerHrid: param.playerHrid,
        playerIndex: param.playerIndex,
        itemHrid: param.itemHrid,
        triggerPath: param.path,
        triggerIndex: param.triggerIndex,
        conditionName: param.conditionName,
        originalValue: param.originalValue,
        optimizedValue: param.originalValue,
        xpPerHourDelta: 0,
      });
      continue;
    }

    const [lo, hi] = param.range;
    const rangeSize = hi - lo;
    let bestValue = getTriggerValue(configs, param);
    let bestXp = currentBestXp;

    // Incorporate the probe result
    if (probeXp > bestXp) {
      bestXp = probeXp;
      bestValue = probeValue;
    }

    if (rangeSize <= BRUTE_FORCE_THRESHOLD) {
      // Tiny range — just test every integer value
      for (let v = lo; v <= hi; v++) {
        setTriggerValue(configs, param, v);
        const xp = runSim();
        if (xp > bestXp) {
          bestXp = xp;
          bestValue = v;
        }
      }
    } else {
      // Golden-section search
      const evaluate = (v: number) => {
        setTriggerValue(configs, param, v);
        return runSim();
      };

      const result = goldenSectionMax(lo, hi, SEARCH_TOLERANCE, evaluate);
      if (result.bestXp > bestXp) {
        bestXp = result.bestXp;
        bestValue = result.bestValue;
      }
    }

    setTriggerValue(configs, param, bestValue);
    const delta = bestXp - currentBestXp;
    currentBestXp = bestXp;

    improvements.push({
      playerHrid: param.playerHrid,
      playerIndex: param.playerIndex,
      itemHrid: param.itemHrid,
      triggerPath: param.path,
      triggerIndex: param.triggerIndex,
      conditionName: param.conditionName,
      originalValue: param.originalValue,
      optimizedValue: bestValue,
      xpPerHourDelta: delta,
    });
  }

  return {
    optimizedConfigs: configs,
    improvements,
    baselineXpPerHour,
    optimizedXpPerHour: currentBestXp,
    totalSimRuns: simCount,
  };
}
