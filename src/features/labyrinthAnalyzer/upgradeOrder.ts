// =============================================================================
// Upgrade priority ranking
// =============================================================================
// Greedy: each iteration we pick the next upgrade with the highest expected
// boxes-per-month-per-token. Capacity upgrades (torch/shroud/beacon/cooldown)
// have direct effects on the torch budget. Skill and combat upgrades change
// the floor clearability, which in turn changes the torch budget — we
// recompute it on a hypothetical floorResults to get the marginal value.
// XP and full-automation upgrades are listed for completeness with a
// non-box value (they don't directly raise boxes/run).

import type {
  FloorResult,
  SkillRoomData,
  CombatRoomData,
  UpgradePriorityEntry,
  UpgradeLevels,
  UpgradeType,
} from "./types";
import {
  LAB_UPGRADE_BASES,
  LAB_UPGRADE_PER_LEVEL,
  LAB_UPGRADE_MAX_LEVEL,
  LAB_UPGRADE_COST_PER_LEVEL,
  LAB_UPGRADE_DISPLAY,
  FLOORS,
  FLOOR_EXIT_REWARDS,
} from "./constants";
import { computeTorchBudget } from "./torchBudget";
import { floorClearFraction } from "./floorAnalysis";

// =============================================================================
// Heuristic level deltas per upgrade level
// =============================================================================
// Each level of these upgrades gives ~1% boost in some stat. We approximate
// the impact as an additive boost to the effective room level for analytics.
// These are deliberately rough — combat power vs. effective level mapping is
// noisy, so they're meant to give a useful ordering rather than precise values.

const SKILL_LEVEL_BOOST_PER_UPGRADE: Partial<Record<UpgradeType, number>> = {
  skillSpeed: 1.0,
  skillEfficiency: 1.0,
  skillSuccess: 0.5,
  skillDoubleProgress: 0.5,
};

const COMBAT_LEVEL_BOOST_PER_UPGRADE: Partial<Record<UpgradeType, number>> = {
  combatDamage: 1.0,
  attackSpeed: 1.0,
  castSpeed: 0.5,
  criticalRate: 0.7,
};

// =============================================================================
// Helpers
// =============================================================================

function computeResourceCounts(levels: UpgradeLevels): Record<string, number> {
  const result: Record<string, number> = {};
  for (const utype of Object.keys(LAB_UPGRADE_BASES)) {
    const base = LAB_UPGRADE_BASES[utype];
    const per = LAB_UPGRADE_PER_LEVEL[utype];
    const lv = (levels as unknown as Record<string, number>)[utype] ?? 0;
    result[utype] = base + lv * per;
  }
  return result;
}

function computeTargetFloor(maxFloorNoShrouds: number, shroudCount: number): number {
  const base = maxFloorNoShrouds;
  if (shroudCount >= 8) return base + 3;
  if (shroudCount >= 5) return base + 2;
  return base + 1;
}

function exitBoxesUpTo(floor: number): number {
  let s = 0;
  for (let f = 4; f <= floor; f++) s += FLOOR_EXIT_REWARDS[f]?.[1] ?? 0;
  return s;
}

function recomputeFloorResultsWithBoost(
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  skillBoost: number,
  combatBoost: number,
): FloorResult[] {
  const out: FloorResult[] = [];
  for (const [floorNum, fmin, fmax, grid] of FLOORS) {
    const skillFracs = skillData.map(s => floorClearFraction(s.maxClearable + skillBoost, fmin, fmax));
    const combatFracs = combatData.map(c => floorClearFraction(c.maxClearable + combatBoost, fmin, fmax));
    const skillAvg = skillFracs.reduce((a, b) => a + b, 0) / Math.max(1, skillFracs.length);
    const combatAvg = combatFracs.reduce((a, b) => a + b, 0) / Math.max(1, combatFracs.length);
    const overall = (skillAvg + combatAvg) / 2;
    out.push({
      floor: floorNum, min: fmin, max: fmax, grid,
      skill: skillAvg, combat: combatAvg,
      overall, blocked: 1 - overall,
      skillFracs, combatFracs,
    });
  }
  return out;
}

function computeBoxesPerRun(
  targetFloor: number,
  floorResults: FloorResult[],
  torchCount: number,
  beaconCount: number,
): number {
  const budget = computeTorchBudget(torchCount, targetFloor, floorResults, beaconCount);
  const exitBoxes = exitBoxesUpTo(targetFloor);
  const detourBoxes = budget.reduce((s, b) => s + b.expectedBoxes, 0);
  return exitBoxes + detourBoxes;
}

function compoundFactor(
  remainingType: UpgradeType,
  simLevels: UpgradeLevels,
): number {
  // For cooldown upgrades, factor in the future runs that benefit from any
  // currently-unowned capacity upgrade. Apply a modest scaling so cooldown
  // is preferred earlier in the upgrade chain.
  const remainingTypes: UpgradeType[] = ["torch", "beacon", "shroud"];
  const remaining = remainingTypes.reduce(
    (s, t) => s + (LAB_UPGRADE_MAX_LEVEL[t] - ((simLevels as unknown as Record<string, number>)[t] ?? 0)),
    0,
  );
  const total = remainingTypes.reduce((s, t) => s + LAB_UPGRADE_MAX_LEVEL[t], 0);
  if (total <= 0) return 1;
  if (remainingType === "cooldown") return 1 + 0.10 * (remaining / total);
  return 1;
}

function makeEntry(
  type: UpgradeType,
  nextLevel: number,
  deltaBoxesMonth: number,
  description: string,
): UpgradePriorityEntry {
  const cost = LAB_UPGRADE_COST_PER_LEVEL[type] * nextLevel;
  const category = LAB_UPGRADE_DISPLAY[type].category;
  return {
    type, level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description,
    category,
  };
}

// =============================================================================
// Marginal value functions
// =============================================================================

function mvTorch(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloor: number,
  runsPerMonth: number,
  beaconCount: number,
): UpgradePriorityEntry | null {
  if (simLevels.torch >= LAB_UPGRADE_MAX_LEVEL.torch) return null;
  const oldT = LAB_UPGRADE_BASES.torch + simLevels.torch * LAB_UPGRADE_PER_LEVEL.torch;
  const newT = oldT + LAB_UPGRADE_PER_LEVEL.torch;
  const oldBudget = computeTorchBudget(oldT, targetFloor, baselineFloorResults, beaconCount);
  const newBudget = computeTorchBudget(newT, targetFloor, baselineFloorResults, beaconCount);
  const deltaBoxesRun = newBudget.reduce((s, b) => s + b.expectedBoxes, 0)
                      - oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  return makeEntry("torch", simLevels.torch + 1, deltaBoxesRun * runsPerMonth, `${newT}T. +${deltaBoxesRun.toFixed(1)} boxes/run.`);
}

function mvCooldown(
  simLevels: UpgradeLevels,
  boxesPerRun: number,
): UpgradePriorityEntry | null {
  if (simLevels.cooldown >= LAB_UPGRADE_MAX_LEVEL.cooldown) return null;
  const oldCd = LAB_UPGRADE_BASES.cooldown + simLevels.cooldown * LAB_UPGRADE_PER_LEVEL.cooldown;
  const newCd = oldCd + LAB_UPGRADE_PER_LEVEL.cooldown;
  const oldRuns = (30 * 24) / oldCd;
  const newRuns = (30 * 24) / newCd;
  const deltaRuns = newRuns - oldRuns;
  let dbm = deltaRuns * boxesPerRun;
  dbm *= compoundFactor("cooldown", simLevels);
  return makeEntry("cooldown", simLevels.cooldown + 1, dbm, `${newCd}h. +${deltaRuns.toFixed(1)} runs/mo.`);
}

function mvShroud(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloorOverride: number | null,
  maxFloorNoShrouds: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
): UpgradePriorityEntry | null {
  if (simLevels.shroud >= LAB_UPGRADE_MAX_LEVEL.shroud) return null;
  const oldS = LAB_UPGRADE_BASES.shroud + simLevels.shroud * LAB_UPGRADE_PER_LEVEL.shroud;
  const newS = oldS + LAB_UPGRADE_PER_LEVEL.shroud;
  const oldTarget = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, oldS);
  const newTarget = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, newS);

  let dbm: number;
  let desc: string;
  if (newTarget !== oldTarget) {
    const oldBoxes = computeBoxesPerRun(oldTarget, baselineFloorResults, torchCount, beaconCount);
    const newBoxes = computeBoxesPerRun(newTarget, baselineFloorResults, torchCount, beaconCount);
    dbm = (newBoxes - oldBoxes) * runsPerMonth;
    desc = `${newS}S. Unlocks F${newTarget}!`;
  } else {
    const currentBoxes = computeBoxesPerRun(oldTarget, baselineFloorResults, torchCount, beaconCount);
    dbm = 0.05 * currentBoxes * runsPerMonth;
    desc = `${newS}S. More reliable F${oldTarget}.`;
  }
  return makeEntry("shroud", simLevels.shroud + 1, dbm, desc);
}

function mvBeacon(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
): UpgradePriorityEntry | null {
  if (simLevels.beacon >= LAB_UPGRADE_MAX_LEVEL.beacon) return null;
  const oldBudget = computeTorchBudget(torchCount, targetFloor, baselineFloorResults, beaconCount);
  const newBudget = computeTorchBudget(torchCount, targetFloor, baselineFloorResults, beaconCount + LAB_UPGRADE_PER_LEVEL.beacon);
  const deltaBoxesRun = newBudget.reduce((s, b) => s + b.expectedBoxes, 0)
                      - oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  return makeEntry("beacon", simLevels.beacon + 1, deltaBoxesRun * runsPerMonth, `${beaconCount + 1}B. +${deltaBoxesRun.toFixed(1)} boxes/run.`);
}

function mvSkillOrCombat(
  type: UpgradeType,
  simLevels: UpgradeLevels,
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
  baselineBoxesPerRun: number,
): UpgradePriorityEntry | null {
  const lv = (simLevels as unknown as Record<string, number>)[type] ?? 0;
  if (lv >= LAB_UPGRADE_MAX_LEVEL[type]) return null;
  const skillDelta = SKILL_LEVEL_BOOST_PER_UPGRADE[type] ?? 0;
  const combatDelta = COMBAT_LEVEL_BOOST_PER_UPGRADE[type] ?? 0;
  const newFr = recomputeFloorResultsWithBoost(skillData, combatData, skillDelta, combatDelta);
  const newBoxes = computeBoxesPerRun(targetFloor, newFr, torchCount, beaconCount);
  const dbm = (newBoxes - baselineBoxesPerRun) * runsPerMonth;
  const display = LAB_UPGRADE_DISPLAY[type];
  const newPct = (lv + 1) * (LAB_UPGRADE_PER_LEVEL[type] * 100);
  const newPctStr = type === "skillSuccess"
    ? newPct.toFixed(1)
    : Math.round(newPct).toString();
  const desc = `${display.name} +${newPctStr}%.`;
  return makeEntry(type, lv + 1, dbm, desc);
}

function mvFullAuto(simLevels: UpgradeLevels): UpgradePriorityEntry | null {
  if (simLevels.fullAuto >= LAB_UPGRADE_MAX_LEVEL.fullAuto) return null;
  const newLv = simLevels.fullAuto + 1;
  return makeEntry("fullAuto", newLv, 0, `Auto-completes ${newLv} floors. Time saver, no box gain.`);
}

function mvExperience(simLevels: UpgradeLevels): UpgradePriorityEntry | null {
  if (simLevels.experience >= LAB_UPGRADE_MAX_LEVEL.experience) return null;
  const newLv = simLevels.experience + 1;
  return makeEntry("experience", newLv, 0, `+${newLv}% combat XP in lab. No box gain.`);
}

// =============================================================================
// Public API
// =============================================================================

export function computeUpgradeOrder(
  upgradeLevels: UpgradeLevels,
  targetFloorOverride: number | null,
  floorResults: FloorResult[],
  maxFloorNoShrouds: number,
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
): UpgradePriorityEntry[] {
  const simLevels: UpgradeLevels = { ...upgradeLevels };
  const order: UpgradePriorityEntry[] = [];

  const maxIterations = Object.keys(LAB_UPGRADE_DISPLAY).reduce(
    (s, t) => s + LAB_UPGRADE_MAX_LEVEL[t], 0,
  );

  for (let i = 0; i < maxIterations; i++) {
    const resources = computeResourceCounts(simLevels);
    const torchCount = resources.torch;
    const beaconCount = resources.beacon;
    const cdHours = resources.cooldown;
    const shroudCount = resources.shroud;
    const target = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, shroudCount);
    const runsPerMonth = (30 * 24) / Math.max(1, cdHours);

    const baselineBoxes = computeBoxesPerRun(target, floorResults, torchCount, beaconCount);

    const candidates: UpgradePriorityEntry[] = [];

    const push = (e: UpgradePriorityEntry | null) => { if (e) candidates.push(e); };

    push(mvTorch(simLevels, floorResults, target, runsPerMonth, beaconCount));
    push(mvCooldown(simLevels, baselineBoxes));
    push(mvShroud(simLevels, floorResults, targetFloorOverride, maxFloorNoShrouds, torchCount, beaconCount, runsPerMonth));
    push(mvBeacon(simLevels, floorResults, target, torchCount, beaconCount, runsPerMonth));

    for (const t of ["skillSpeed", "skillEfficiency", "skillSuccess", "skillDoubleProgress",
                      "combatDamage", "attackSpeed", "castSpeed", "criticalRate"] as UpgradeType[]) {
      push(mvSkillOrCombat(t, simLevels, skillData, combatData, target, torchCount, beaconCount, runsPerMonth, baselineBoxes));
    }
    push(mvFullAuto(simLevels));
    push(mvExperience(simLevels));

    if (candidates.length === 0) break;

    for (const c of candidates) {
      c.valuePerToken = c.cost > 0
        ? Math.round((c.deltaBoxesMonth / c.cost) * 1000 * 100) / 100
        : 0;
    }

    // Best by value-per-token; ties broken by raw deltaBoxesMonth, then by lower cost.
    const best = candidates.reduce((a, b) => {
      if (b.valuePerToken !== a.valuePerToken) return b.valuePerToken > a.valuePerToken ? b : a;
      if (b.deltaBoxesMonth !== a.deltaBoxesMonth) return b.deltaBoxesMonth > a.deltaBoxesMonth ? b : a;
      return b.cost < a.cost ? b : a;
    });

    order.push(best);
    (simLevels as unknown as Record<string, number>)[best.type] = best.level;
  }

  return order;
}
