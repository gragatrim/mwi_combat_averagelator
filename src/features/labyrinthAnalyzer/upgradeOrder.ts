// =============================================================================
// Upgrade priority ranking — ported from labyrinth_analyzer.py
// =============================================================================

import type { FloorResult, UpgradePriorityEntry, UpgradeLevels } from "./types";
import {
  LAB_UPGRADE_BASES,
  LAB_UPGRADE_PER_LEVEL,
  LAB_UPGRADE_MAX_LEVEL,
  LAB_UPGRADE_COST_PER_LEVEL,
  FLOOR_EXIT_REWARDS,
} from "./constants";
import { computeTorchBudget } from "./torchBudget";

function computeResourceCounts(levels: UpgradeLevels): Record<string, number> {
  const result: Record<string, number> = {};
  for (const utype of Object.keys(LAB_UPGRADE_BASES)) {
    result[utype] = LAB_UPGRADE_BASES[utype] + (levels[utype as keyof UpgradeLevels] as number ?? 0) * LAB_UPGRADE_PER_LEVEL[utype];
  }
  return result;
}

function computeTargetFloor(maxFloorNoShrouds: number, shroudCount: number): number {
  const base = maxFloorNoShrouds;
  if (shroudCount >= 8) return Math.min(13, base + 3);
  if (shroudCount >= 5) return Math.min(13, base + 2);
  return Math.min(13, base + 1);
}

function computeBoxesPerRun(
  targetFloor: number,
  floorResults: FloorResult[],
  torchCount: number,
  beaconCount: number
): number {
  const budget = computeTorchBudget(torchCount, targetFloor, floorResults, beaconCount);
  const exitBoxes = Array.from({ length: targetFloor }, (_, i) => i + 1)
    .filter(f => f >= 4)
    .reduce((s, f) => s + (FLOOR_EXIT_REWARDS[f]?.[1] ?? 0), 0);
  const detourBoxes = budget.reduce((s, b) => s + b.expectedBoxes, 0);
  return Math.round((exitBoxes + detourBoxes) * 10) / 10;
}

function marginalValueTorch(
  levels: UpgradeLevels,
  targetFloor: number,
  floorResults: FloorResult[],
  runsPerMonth: number,
  beaconCount: number
): UpgradePriorityEntry | null {
  if (levels.torch >= LAB_UPGRADE_MAX_LEVEL.torch) return null;
  const resources = computeResourceCounts(levels);
  const oldTorches = resources.torch;
  const newTorches = oldTorches + LAB_UPGRADE_PER_LEVEL.torch;

  const oldBudget = computeTorchBudget(oldTorches, targetFloor, floorResults, beaconCount);
  const newBudget = computeTorchBudget(newTorches, targetFloor, floorResults, beaconCount);
  const oldDetour = oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  const newDetour = newBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  const deltaBoxesRun = newDetour - oldDetour;
  const deltaBoxesMonth = deltaBoxesRun * runsPerMonth;

  const nextLevel = levels.torch + 1;
  const cost = LAB_UPGRADE_COST_PER_LEVEL.torch * nextLevel;
  return {
    type: "torch", level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description: `${newTorches}T. +${deltaBoxesRun.toFixed(1)} boxes/run.`,
  };
}

function marginalValueCooldown(levels: UpgradeLevels, boxesPerRun: number): UpgradePriorityEntry | null {
  if (levels.cooldown >= LAB_UPGRADE_MAX_LEVEL.cooldown) return null;
  const resources = computeResourceCounts(levels);
  const oldCd = resources.cooldown;
  const newCd = oldCd + LAB_UPGRADE_PER_LEVEL.cooldown;
  const oldRuns = 30 * 24 / oldCd;
  const newRuns = 30 * 24 / newCd;
  const deltaRuns = newRuns - oldRuns;
  const deltaBoxesMonth = deltaRuns * boxesPerRun;

  const nextLevel = levels.cooldown + 1;
  const cost = LAB_UPGRADE_COST_PER_LEVEL.cooldown * nextLevel;
  return {
    type: "cooldown", level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description: `${newCd}h. +${deltaRuns.toFixed(1)} runs/mo.`,
  };
}

function marginalValueShroud(
  levels: UpgradeLevels,
  targetFloor: number | null,
  floorResults: FloorResult[],
  runsPerMonth: number,
  maxFloorNoShrouds: number,
  beaconCount: number
): UpgradePriorityEntry | null {
  if (levels.shroud >= LAB_UPGRADE_MAX_LEVEL.shroud) return null;
  const resources = computeResourceCounts(levels);
  const oldShrouds = resources.shroud;
  const newShrouds = oldShrouds + LAB_UPGRADE_PER_LEVEL.shroud;
  const torchCount = resources.torch;

  const oldTarget = targetFloor ?? computeTargetFloor(maxFloorNoShrouds, oldShrouds);
  const newTarget = targetFloor ?? computeTargetFloor(maxFloorNoShrouds, newShrouds);

  let deltaBoxesMonth: number;
  let desc: string;

  if (newTarget !== oldTarget) {
    const oldBoxes = computeBoxesPerRun(oldTarget, floorResults, torchCount, beaconCount);
    const newBoxes = computeBoxesPerRun(newTarget, floorResults, torchCount, beaconCount);
    deltaBoxesMonth = (newBoxes - oldBoxes) * runsPerMonth;
    desc = `${newShrouds}S. Unlocks F${newTarget}!`;
  } else {
    const currentBoxes = computeBoxesPerRun(oldTarget, floorResults, torchCount, beaconCount);
    deltaBoxesMonth = 0.05 * currentBoxes * runsPerMonth;
    desc = `${newShrouds}S. More reliable F${oldTarget}.`;
  }

  const nextLevel = levels.shroud + 1;
  const cost = LAB_UPGRADE_COST_PER_LEVEL.shroud * nextLevel;
  return {
    type: "shroud", level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description: desc,
  };
}

function marginalValueBeacon(
  levels: UpgradeLevels,
  targetFloor: number,
  floorResults: FloorResult[],
  runsPerMonth: number,
  beaconCount: number
): UpgradePriorityEntry | null {
  if (levels.beacon >= LAB_UPGRADE_MAX_LEVEL.beacon) return null;
  const resources = computeResourceCounts(levels);
  const torchCount = resources.torch;
  const newBeacons = beaconCount + LAB_UPGRADE_PER_LEVEL.beacon;

  const oldBudget = computeTorchBudget(torchCount, targetFloor, floorResults, beaconCount);
  const newBudget = computeTorchBudget(torchCount, targetFloor, floorResults, newBeacons);
  const oldBoxes = oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  const newBoxes = newBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  const deltaBoxesRun = newBoxes - oldBoxes;
  const deltaBoxesMonth = deltaBoxesRun * runsPerMonth;

  const nextLevel = levels.beacon + 1;
  const cost = LAB_UPGRADE_COST_PER_LEVEL.beacon * nextLevel;
  return {
    type: "beacon", level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description: `${newBeacons}B. +${deltaBoxesRun.toFixed(1)} boxes/run.`,
  };
}

/**
 * Greedy sequential optimizer: rank all unpurchased upgrades by boxes/month per token.
 */
export function computeUpgradeOrder(
  upgradeLevels: UpgradeLevels,
  targetFloorOverride: number | null,
  floorResults: FloorResult[],
  maxFloorNoShrouds: number
): UpgradePriorityEntry[] {
  const simLevels = { ...upgradeLevels };
  const order: UpgradePriorityEntry[] = [];

  for (let i = 0; i < 29; i++) {
    const resources = computeResourceCounts(simLevels);
    const shroudCount = resources.shroud;
    const torchCount = resources.torch;
    const beaconCt = resources.beacon;
    const cdHours = resources.cooldown;

    const target = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, shroudCount);
    const runsPerMonth = 30 * 24 / cdHours;
    const currentBoxes = computeBoxesPerRun(target, floorResults, torchCount, beaconCt);

    const candidates: UpgradePriorityEntry[] = [];

    const mv1 = marginalValueTorch(simLevels, target, floorResults, runsPerMonth, beaconCt);
    if (mv1) candidates.push(mv1);

    const mv2 = marginalValueCooldown(simLevels, currentBoxes);
    if (mv2) {
      // Compounding adjustment
      const remaining = ["torch", "beacon", "shroud"].reduce(
        (s, t) => s + LAB_UPGRADE_MAX_LEVEL[t] - (simLevels[t as keyof UpgradeLevels] as number ?? 0), 0
      );
      const total = ["torch", "beacon", "shroud"].reduce((s, t) => s + LAB_UPGRADE_MAX_LEVEL[t], 0);
      if (total > 0) {
        const mult = 1 + 0.10 * (remaining / total);
        mv2.deltaBoxesMonth = Math.round(mv2.deltaBoxesMonth * mult * 100) / 100;
      }
      candidates.push(mv2);
    }

    const mv3 = marginalValueShroud(simLevels, targetFloorOverride, floorResults, runsPerMonth, maxFloorNoShrouds, beaconCt);
    if (mv3) candidates.push(mv3);

    const mv4 = marginalValueBeacon(simLevels, target, floorResults, runsPerMonth, beaconCt);
    if (mv4) candidates.push(mv4);

    if (candidates.length === 0) break;

    for (const c of candidates) {
      c.valuePerToken = c.cost > 0 ? Math.round(c.deltaBoxesMonth / c.cost * 1000 * 100) / 100 : 0;
    }

    const best = candidates.reduce((a, b) => a.valuePerToken > b.valuePerToken ? a : b);
    order.push(best);
    (simLevels as Record<string, number>)[best.type] = best.level;
  }

  return order;
}
