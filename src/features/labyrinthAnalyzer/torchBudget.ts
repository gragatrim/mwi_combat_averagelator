// =============================================================================
// Torch budget allocation — ported from labyrinth_analyzer.py
// =============================================================================

import type { FloorResult } from "./types";
import type { TorchBudgetEntry } from "./types";
import {
  RUSH_TORCH_EVENTS,
  EXPERT_TORCH_PRESERVATION,
  RUSH_OVERHEAD_FACTOR,
  GRID_DIM,
  RUSH_PATH_REVEAL_FACTOR,
  BEACON_OVERLAP_FACTOR,
  TREASURE_ROOM_COUNT,
  MIN_EXPLORE_CLEAR_RATE,
} from "./constants";

function rushEventsForFloor(floorNum: number): number {
  return RUSH_TORCH_EVENTS[floorNum] ?? 14;
}

function gridDimension(floorNum: number): number {
  return GRID_DIM[floorNum] ?? 8;
}

function totalGridRooms(floorNum: number): number {
  const dim = gridDimension(floorNum);
  return dim * dim;
}

function treasureTokenReward(floor: number): number {
  return Math.min(floor, 10);
}

function treasureBoxRate(floor: number): number {
  return Math.min(floor * 0.05, 0.50);
}

function regularTokenRate(floor: number): number {
  return Math.min(floor * 0.05, 0.50);
}

function regularBoxRate(floor: number): number {
  return Math.min(floor * 0.01, 0.10);
}

function allocateBeacons(
  beaconCount: number,
  targetFloor: number,
  floorResults: FloorResult[] | null
): Record<number, number> {
  const alloc: Record<number, number> = {};
  for (let f = 1; f <= targetFloor; f++) alloc[f] = 0;
  if (beaconCount <= 0) return alloc;

  const blockedByFloor: Record<number, number> = {};
  if (floorResults) {
    for (const f of floorResults) blockedByFloor[f.floor] = f.blocked;
  }

  const lastReserve = Math.min(2, beaconCount);
  const remaining = beaconCount - lastReserve;

  const exploreFloors = [];
  for (let f = 5; f < targetFloor; f++) exploreFloors.push(f);

  if (exploreFloors.length > 0 && remaining > 0) {
    const weights = exploreFloors.map(f => blockedByFloor[f] ?? 0.30);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
      for (let i = 0; i < exploreFloors.length; i++) {
        alloc[exploreFloors[i]] = Math.floor(remaining * weights[i] / totalWeight);
      }
      const allocated = exploreFloors.reduce((s, f) => s + alloc[f], 0);
      let leftover = remaining - allocated;
      const ranked = [...exploreFloors].sort((a, b) => (blockedByFloor[b] ?? 0.30) - (blockedByFloor[a] ?? 0.30));
      for (const f of ranked) {
        if (leftover <= 0) break;
        alloc[f]++;
        leftover--;
      }
    }
  }

  const exploreAllocated = exploreFloors.reduce((s, f) => s + alloc[f], 0);
  alloc[targetFloor] = lastReserve + Math.max(0, remaining - exploreAllocated);

  // Verify total
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  if (total > beaconCount) {
    alloc[targetFloor] = Math.max(0, alloc[targetFloor] - (total - beaconCount));
  }

  return alloc;
}

function floorExplorationEv(
  floorNum: number,
  clearRate: number,
  exploreTorches: number,
  beaconsUsed: number
): [number, number, number] {
  if (exploreTorches <= 0) return [0, 0, 0];

  const preservation = EXPERT_TORCH_PRESERVATION;
  const exploreEvents = exploreTorches / (1 - preservation);
  let roomsExplored = exploreEvents;

  const dim = gridDimension(floorNum);
  const gridRooms = dim * dim;
  const rushRooms = rushEventsForFloor(floorNum);
  const availableRooms = Math.max(1, gridRooms - rushRooms);
  // Use fractional values throughout so marginal-value calculations are
  // smooth. Discrete-room rounding here causes step functions in the
  // upgrade-priority scoring (Torch+N giving wildly different deltas as
  // an integer threshold is crossed).
  const clearableRooms = availableRooms * clearRate;
  const reachable = clearableRooms * clearRate;
  if (reachable <= 0) return [0, 0, 0];
  roomsExplored = Math.min(roomsExplored, reachable);

  const rushRevealed = rushRooms * RUSH_PATH_REVEAL_FACTOR;
  const exploreRevealed = roomsExplored * 1.5;
  const beaconRevealed = beaconsUsed * 13 * BEACON_OVERLAP_FACTOR;
  const totalRevealed = Math.min(gridRooms, rushRevealed + exploreRevealed + beaconRevealed);

  const visibleFrac = Math.min(1, totalRevealed / gridRooms);
  const treasureCount = TREASURE_ROOM_COUNT[floorNum] ?? 6;
  const treasureFound = treasureCount * visibleFrac;
  const treasureReached = Math.min(treasureFound, roomsExplored);
  const regularCleared = Math.max(0, roomsExplored - treasureReached) * clearRate;

  const tTokens = treasureReached * treasureTokenReward(floorNum);
  const tBoxes = treasureReached * treasureBoxRate(floorNum) * 2;
  const rTokens = regularCleared * regularTokenRate(floorNum);
  const rBoxes = regularCleared * regularBoxRate(floorNum);

  return [tTokens + rTokens, tBoxes + rBoxes, roomsExplored];
}

/**
 * Compute per-floor torch budget with exploration-aware greedy allocation.
 */
export function computeTorchBudget(
  torchCount: number,
  targetFloor: number,
  floorResults: FloorResult[] | null,
  beaconCount: number = 0
): TorchBudgetEntry[] {
  const preservation = EXPERT_TORCH_PRESERVATION;
  const clearRateByFloor: Record<number, number> = {};
  if (floorResults) {
    for (const f of floorResults) clearRateByFloor[f.floor] = f.overall;
  }

  // Phase 1: Rush costs
  const rushTorchesPerFloor: Record<number, number> = {};
  let totalRushTorches = 0;
  for (let f = 1; f <= targetFloor; f++) {
    const rush = rushEventsForFloor(f);
    const rushT = rush * RUSH_OVERHEAD_FACTOR * (1 - preservation);
    rushTorchesPerFloor[f] = rushT;
    totalRushTorches += rushT;
  }

  // Phase 2: Beacon allocation
  const beaconAlloc = allocateBeacons(beaconCount, targetFloor, floorResults);

  // Phase 3: Top-down waterfall
  // Budget = total torches − rush spend on every floor − safety reserve.
  // We previously subtracted only the lower-floor rush, then capped target
  // floor exploration to (reserve − targetRush), which collapsed to 0 for any
  // F5+ target (target rush ≈ 11.4 > reserve = 10). That structurally
  // suppressed exploration on the most box-rich floor. Now target rush is
  // included in the up-front budget and the target floor is allocated like
  // any other floor in the waterfall.
  const torchReserve = 10;
  const targetRush = rushTorchesPerFloor[targetFloor];
  const rushLower = totalRushTorches - targetRush;
  let explorationBudget = Math.max(0, torchCount - rushLower - targetRush - torchReserve);

  const exploreAlloc: Record<number, number> = {};
  for (let f = 1; f <= targetFloor; f++) exploreAlloc[f] = 0;

  for (let f = targetFloor; f >= 1; f--) {
    if (explorationBudget <= 0) break;
    const clearRate = clearRateByFloor[f] ?? 1;

    if (f !== targetFloor && clearRate < MIN_EXPLORE_CLEAR_RATE) continue;

    const gridRooms = totalGridRooms(f);
    const rushRooms = rushEventsForFloor(f);
    const availableRooms = Math.max(0, gridRooms - rushRooms);
    // Fractional rooms — keep the marginal value smooth across torch upgrades.
    const clearableRooms = availableRooms * clearRate;
    if (clearableRooms <= 0) continue;

    const reachable = clearableRooms * clearRate;
    const torchesNeeded = reachable * (1 - preservation);

    const alloc = Math.min(torchesNeeded, explorationBudget);
    exploreAlloc[f] = alloc;
    explorationBudget -= alloc;
  }

  // Pre-compute torches-to-finish
  const torchesToFinish: Record<number, number> = {};
  for (let f = 1; f <= targetFloor; f++) {
    let t = 0;
    for (let ff = f; ff <= targetFloor; ff++) t += rushTorchesPerFloor[ff];
    torchesToFinish[f] = Math.ceil(t);
  }

  // Build budget entries
  const budget: TorchBudgetEntry[] = [];
  let runningBalance = torchCount;
  const TORCH_CHUNK = 2;

  for (let f = 1; f <= targetFloor; f++) {
    const rush = rushEventsForFloor(f);
    const rushT = rushTorchesPerFloor[f];
    const exploreT = exploreAlloc[f];
    const totalSpend = rushT + exploreT;
    const clearRate = clearRateByFloor[f] ?? 1;
    const [expTok, expBox, roomsExplored] = floorExplorationEv(f, clearRate, exploreT, beaconAlloc[f]);

    runningBalance -= totalSpend;

    let advice: string;
    if (f === targetFloor) {
      if (exploreT < TORCH_CHUNK) {
        advice = "Target floor (rush only)";
      } else {
        const bStr = beaconAlloc[f] > 0 ? `${beaconAlloc[f]}B, ` : "";
        advice = `Target floor (${bStr}~${Math.round(roomsExplored)} rooms)`;
      }
    } else if (exploreT < TORCH_CHUNK) {
      advice = clearRate < MIN_EXPLORE_CLEAR_RATE ? "Rush (low clear%)" : "Rush";
    } else {
      const gridRooms = totalGridRooms(f);
      const rushRooms = rushEventsForFloor(f);
      const available = Math.max(1, gridRooms - rushRooms);
      const clearable = Math.floor(available * clearRate);
      const reachable = Math.max(1, Math.floor(clearable * clearRate));
      const bStr = beaconAlloc[f] > 0 ? `${beaconAlloc[f]}B, ` : "";
      advice = reachable > 0 && roomsExplored >= reachable * 0.95
        ? `Full clear (${bStr}~${Math.round(roomsExplored)} rooms)`
        : `Partial (${bStr}~${Math.round(roomsExplored)} rooms)`;
    }

    budget.push({
      floor: f,
      rushEvents: rush,
      rushTorches: rushT,
      exploreTorches: exploreT,
      totalSpend,
      torchesToFinish: torchesToFinish[f],
      clearRate,
      expectedTokens: expTok,
      expectedBoxes: expBox,
      torchBalance: runningBalance,
      beaconsUsed: beaconAlloc[f],
      advice,
    });
  }

  return budget;
}
