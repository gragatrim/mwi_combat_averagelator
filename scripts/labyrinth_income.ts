#!/usr/bin/env tsx
/**
 * Labyrinth Income Optimizer
 *
 * Calculates optimal floor target to maximize gold/hour for a given character.
 * Factors in: floor clearability (skill + combat), shroud consumption, torch
 * budget, exploration value, cooldown time, and per-floor kill times from the
 * deterministic combat simulator.
 *
 * Usage: npx tsx scripts/labyrinth_income.ts [character_data.json]
 *
 * Default: loads live_data/gragatrim_full_char_data.json
 * Outputs: Per-floor analysis with gold/hour calculations and optimal strategy
 *          recommendation, including surplus torch exploration allocation.
 */
// =============================================================================
// Labyrinth Income Optimizer — properly models floor clearability + shroud usage
// =============================================================================

import { readFileSync } from "fs";

// Suppress simulator diagnostics
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && (first.startsWith("[DIAG]") || first.startsWith("  "))) return;
  origLog(...args);
};

import type { GameData, PlayerConfig } from "../src/engine/types";
import {
  parseFullCharacterData,
  type CombatLoadout,
} from "../src/data/fullCharacterData";
import {
  buildCrateBuffs,
  simulateLabyrinthFight,
  getLabyrinthMonsters,
  type CrateTier,
} from "../src/features/labyrinthSimulator";
import { generateAnalysis } from "../src/features/labyrinthAnalyzer/index";
import {
  FLOORS,
  FLOOR_EXIT_REWARDS,
  RUSH_TORCH_EVENTS,
  EXPERT_TORCH_PRESERVATION,
  RUSH_OVERHEAD_FACTOR,
  GRID_DIM,
  TREASURE_ROOM_COUNT,
  LAB_UPGRADE_BASES,
  LAB_UPGRADE_PER_LEVEL,
  PERCOLATION_THRESHOLD,
} from "../src/features/labyrinthAnalyzer/constants";
import { getLabyrinthUpgradeLevels } from "../src/features/labyrinthAnalyzer/skillBuffs";

// =============================================================================
// Chest values (current market prices)
// =============================================================================
const COMBAT_CHEST_VALUE = 1_300_000;
const SKILLING_CHEST_VALUE = 61_700;
const REFINEMENT_CHEST_VALUE = 2_210_000;

// =============================================================================
// Load data
// =============================================================================
const charDataPath = process.argv[2] || "live_data/gragatrim_full_char_data.json";
console.error("Loading game data...");
const gameData = JSON.parse(readFileSync("public/init_client_data.json", "utf-8")) as GameData;

console.error(`Loading character data from ${charDataPath}...`);
const charJson = readFileSync(charDataPath, "utf-8");
const charData = parseFullCharacterData(charJson, gameData);
const rawCharData = JSON.parse(charJson);
console.error(`Character: ${charData.hrid}`);

// =============================================================================
// Setup: crates, loadouts, upgrades
// =============================================================================
function detectCrateTier(itemHrid: string): CrateTier {
  if (!itemHrid) return "none";
  if (itemHrid.includes("expert")) return "expert";
  if (itemHrid.includes("advanced")) return "advanced";
  if (itemHrid.includes("basic")) return "basic";
  return "none";
}

const coffeeTier = detectCrateTier(charData.labyrinthCrates.coffeeCrate);
const foodTier = detectCrateTier(charData.labyrinthCrates.foodCrate);
console.error(`Crates: coffee=${coffeeTier}, food=${foodTier}`);
const crateBuffs = buildCrateBuffs(coffeeTier, foodTier);

const loadoutById = new Map<string, CombatLoadout>();
for (const loadout of charData.combatLoadouts) loadoutById.set(loadout.id, loadout);

const monsterLoadoutMap: Record<string, PlayerConfig> = {};
for (const [monsterHrid, loadoutId] of Object.entries(charData.labyrinthMonsterLoadouts)) {
  const loadout = loadoutById.get(loadoutId);
  if (loadout) monsterLoadoutMap[monsterHrid] = loadout.config;
}
const defaultConfig = charData.combatLoadouts[0]?.config;
if (!defaultConfig) { console.error("No combat loadouts found"); process.exit(1); }

const upgradeLevels = getLabyrinthUpgradeLevels(rawCharData);
const torchCap = LAB_UPGRADE_BASES.torch + upgradeLevels.torch * LAB_UPGRADE_PER_LEVEL.torch;
const shroudCap = LAB_UPGRADE_BASES.shroud + upgradeLevels.shroud * LAB_UPGRADE_PER_LEVEL.shroud;
const beaconCap = LAB_UPGRADE_BASES.beacon + upgradeLevels.beacon * LAB_UPGRADE_PER_LEVEL.beacon;
const cooldownHours = LAB_UPGRADE_BASES.cooldown + upgradeLevels.cooldown * LAB_UPGRADE_PER_LEVEL.cooldown;

console.error(`Upgrades: torch=${upgradeLevels.torch}(${torchCap}), shroud=${upgradeLevels.shroud}(${shroudCap}), beacon=${upgradeLevels.beacon}(${beaconCap}), cooldown=${upgradeLevels.cooldown}(${cooldownHours}h)`);
console.error(`Tokens: ${upgradeLevels.points}`);

// =============================================================================
// Floor clearability analysis
// =============================================================================
console.error("\nRunning floor clearability analysis...");
const analysis = generateAnalysis(rawCharData, null, gameData, false);
console.error(`Max floor (no shrouds): ${analysis.maxFloorNoShrouds}`);

// =============================================================================
// Combat kill times
// =============================================================================
console.error("\nSimulating combat kill times per floor level...");
const labMonsters = getLabyrinthMonsters(gameData);

// Map: level → average kill time across all monsters
const avgKillTimeCache = new Map<number, number>();

function getAvgCombatTime(level: number): number {
  const rounded = Math.round(level / 10) * 10;
  if (avgKillTimeCache.has(rounded)) return avgKillTimeCache.get(rounded)!;

  let totalTime = 0;
  let count = 0;
  for (const monsterHrid of labMonsters) {
    const config = monsterLoadoutMap[monsterHrid] ?? defaultConfig;
    const result = simulateLabyrinthFight(config, monsterHrid, rounded, crateBuffs, [], 0, gameData);
    totalTime += result.success ? result.killTimeNs / 1e9 : 120;
    count++;
  }
  const avg = count > 0 ? totalTime / count : 120;
  avgKillTimeCache.set(rounded, avg);
  return avg;
}

// Pre-compute for all relevant floor levels
for (const [, fmin, fmax] of FLOORS) {
  const mid = Math.round((fmin + fmax) / 2 / 10) * 10;
  if (mid <= 300) { // Don't waste time on floors we clearly can't reach
    process.stderr.write(`  Level ${mid}...\r`);
    getAvgCombatTime(mid);
  }
}
console.error("  Done.                    ");

// =============================================================================
// Shroud model: estimate shrouds needed per floor
// =============================================================================
// On an 8×8 grid, a path from one side to the other needs ~8 steps minimum.
// With clearRate p, the expected blocked cells on a shortest-ish path is roughly:
//   blocked = pathLength * (1 - p)
// But the grid allows routing around blocked cells, so shrouds are only needed
// when you MUST go through a blocked cell (no alternative path exists).
//
// The percolation model: at p > 0.59, paths almost always exist.
// Below 0.59, you need shrouds proportional to how far below threshold you are.
//
// Empirical model from the Python analyzer's shroud estimates:
//   p >= 0.95: 0 shrouds    p >= 0.80: 0-1    p >= 0.65: 1-2
//   p >= 0.55: 2-4          p >= 0.45: 3-5    p >= 0.35: 4-7    below: 6-9

function expectedShroudsForFloor(clearRate: number): number {
  if (clearRate >= 0.95) return 0;
  if (clearRate >= 0.80) return 0.5;
  if (clearRate >= 0.65) return 1.5;
  if (clearRate >= 0.55) return 3;
  if (clearRate >= 0.45) return 4;
  if (clearRate >= 0.35) return 5.5;
  if (clearRate >= 0.20) return 7.5;
  if (clearRate >= 0.10) return 9;
  return 12; // basically impossible
}

// Probability of completing a floor given clearRate and shrouds available
// If clearRate > percolation threshold: ~100% (paths exist without shrouds)
// Otherwise: need shrouds. If we don't have enough, floor fails.
function floorCompletionProb(clearRate: number, shroudsAvailable: number): number {
  if (clearRate >= PERCOLATION_THRESHOLD) return 1.0;
  const needed = expectedShroudsForFloor(clearRate);
  if (shroudsAvailable >= needed * 1.5) return 0.95; // comfortable margin
  if (shroudsAvailable >= needed) return 0.75;
  if (shroudsAvailable >= needed * 0.7) return 0.40;
  if (shroudsAvailable >= needed * 0.4) return 0.15;
  return 0.0;
}

// =============================================================================
// Time model per floor
// =============================================================================
const SKILL_ROOM_TIME_S = 10;
const FLOOR_TRANSITION_TIME_S = 5;

// Time for a failed combat room (you attempt it, can't kill within 120s)

function rushTimeForFloor(floorNum: number, clearRate: number): number {
  const rushRooms = RUSH_TORCH_EVENTS[floorNum] ?? 14;
  const floorDef = FLOORS.find(([f]) => f === floorNum);
  if (!floorDef) return 0;
  const [, fmin, fmax] = floorDef;
  const midLevel = (fmin + fmax) / 2;

  const avgCombatTime = getAvgCombatTime(midLevel);

  // On the rush path: ~50% skill rooms, ~50% combat rooms
  // BUT some rooms may be blocked (unclearable). Blocked rooms cost time too
  // (you discover they're blocked by attempting them, or you use a shroud).
  // Shrouded rooms are "free" (instant bypass), but there's decision overhead.
  const clearableRoomTime = (SKILL_ROOM_TIME_S + avgCombatTime) / 2;

  // For rooms we CAN clear: clearRate fraction of rooms are clearable
  // For blocked rooms on the path: we either shroud (fast) or reroute (costs extra rooms)
  // On average the rush path involves rushRooms clearable rooms + some wasted attempts
  const blockedFrac = 1 - clearRate;

  // If clearRate >= percolation: almost all rooms on rush path are clearable
  // (we can route around blocked ones). A few extra rooms for rerouting.
  // If clearRate < percolation: we're using shrouds, which are instant.
  let effectiveRooms: number;
  if (clearRate >= PERCOLATION_THRESHOLD) {
    // Good path exists, but may need minor detours around blocked rooms
    const detourPenalty = 1 + blockedFrac * 0.3; // ~30% extra rooms for routing
    effectiveRooms = rushRooms * detourPenalty;
  } else {
    // Using shrouds — shrouded rooms are instant, remaining rooms are cleared normally
    effectiveRooms = rushRooms; // shrouds handle the blocked ones
  }

  return effectiveRooms * clearableRoomTime + FLOOR_TRANSITION_TIME_S;
}

// =============================================================================
// Per-floor reward model
// =============================================================================

interface FloorEval {
  floor: number;
  clearRate: number;
  shroudsNeeded: number;
  completionProb: number;
  rushTimeS: number;
  rushTorches: number;
  exitTokens: number;
  exitCombatChests: number;
  exitRefinementChests: number;
  goldFromExit: number;
}

function evaluateFloor(floorNum: number, shroudsAvailable: number): FloorEval {
  const fr = analysis.floorResults.find(f => f.floor === floorNum);
  const clearRate = fr?.overall ?? 0;
  const shroudsNeeded = expectedShroudsForFloor(clearRate);
  const completionProb = floorCompletionProb(clearRate, shroudsAvailable);

  const rushRooms = RUSH_TORCH_EVENTS[floorNum] ?? 14;
  const rushTorches = rushRooms * RUSH_OVERHEAD_FACTOR * (1 - EXPERT_TORCH_PRESERVATION);
  const rushTimeS = rushTimeForFloor(floorNum, clearRate);

  const exitRewards = FLOOR_EXIT_REWARDS[floorNum] ?? [0, 0, 0];
  const [exitTokens, exitCombatChests, exitRefinementChests] = exitRewards;

  const goldFromExit =
    exitCombatChests * COMBAT_CHEST_VALUE +
    exitRefinementChests * REFINEMENT_CHEST_VALUE;

  return {
    floor: floorNum,
    clearRate,
    shroudsNeeded,
    completionProb,
    rushTimeS,
    rushTorches,
    exitTokens,
    exitCombatChests,
    exitRefinementChests,
    goldFromExit,
  };
}

// =============================================================================
// Strategy evaluation: given a target floor, compute expected gold/hr
// =============================================================================

interface StrategyResult {
  targetFloor: number;
  floorData: FloorEval[];
  // Probability of reaching each floor
  reachProbs: number[];
  // Expected values (weighted by reach probability)
  expectedTimeMinutes: number;
  expectedTorchesUsed: number;
  expectedCombatChests: number;
  expectedRefinementChests: number;
  expectedTokens: number;
  expectedGoldPerRun: number;
  // Cycle & rate
  cycleTimeHours: number;
  goldPerHour: number;
  goldPerActiveMinute: number;
  // Shroud tracking
  shroudUsage: number[];
  totalShroudsExpected: number;
  shroudsSufficient: boolean;
}

function evaluateStrategy(targetFloor: number): StrategyResult {
  const floorData: FloorEval[] = [];
  const reachProbs: number[] = [];
  const shroudUsage: number[] = [];

  let shroudsRemaining = shroudCap;
  let torchesRemaining = torchCap;
  let cumulativeReachProb = 1.0;

  let expectedTimeS = 0;
  let expectedTorches = 0;
  let expectedCombatChests = 0;
  let expectedRefinementChests = 0;
  let expectedTokens = 0;
  let expectedGold = 0;
  let totalShroudsExpected = 0;

  for (let f = 1; f <= targetFloor; f++) {
    const fe = evaluateFloor(f, shroudsRemaining);
    floorData.push(fe);

    // Can we even afford the torches?
    if (torchesRemaining < fe.rushTorches) {
      // Out of torches — can't even rush this floor
      reachProbs.push(0);
      shroudUsage.push(0);
      cumulativeReachProb = 0;
      continue;
    }

    // Probability of reaching AND completing this floor
    const floorProb = cumulativeReachProb * fe.completionProb;
    reachProbs.push(floorProb);

    // Expected contributions from this floor
    // The exit rewards are only earned if we complete all floors up to AND including this one
    expectedTimeS += cumulativeReachProb * fe.rushTimeS; // we spend time even if we fail here
    expectedTorches += cumulativeReachProb * fe.rushTorches;
    expectedCombatChests += floorProb * fe.exitCombatChests;
    expectedRefinementChests += floorProb * fe.exitRefinementChests;
    expectedTokens += floorProb * fe.exitTokens;
    expectedGold += floorProb * fe.goldFromExit;

    // Shroud consumption
    const shroudsUsedThisFloor = Math.min(fe.shroudsNeeded, shroudsRemaining);
    shroudUsage.push(shroudsUsedThisFloor);
    totalShroudsExpected += cumulativeReachProb * shroudsUsedThisFloor;
    shroudsRemaining = Math.max(0, shroudsRemaining - shroudsUsedThisFloor);
    torchesRemaining -= fe.rushTorches;

    // Update cumulative reach prob
    cumulativeReachProb = floorProb;
  }

  const expectedTimeMinutes = expectedTimeS / 60;
  const cycleTimeHours = expectedTimeS / 3600 + cooldownHours;
  const goldPerHour = cycleTimeHours > 0 ? expectedGold / cycleTimeHours : 0;
  const goldPerActiveMinute = expectedTimeMinutes > 0 ? expectedGold / expectedTimeMinutes : 0;

  return {
    targetFloor,
    floorData,
    reachProbs,
    expectedTimeMinutes,
    expectedTorchesUsed: expectedTorches,
    expectedCombatChests,
    expectedRefinementChests,
    expectedTokens,
    expectedGoldPerRun: expectedGold,
    cycleTimeHours,
    goldPerHour,
    goldPerActiveMinute,
    shroudUsage,
    totalShroudsExpected,
    shroudsSufficient: totalShroudsExpected <= shroudCap,
  };
}

// =============================================================================
// Output
// =============================================================================
console.error("\n==========================================");
console.error("LABYRINTH INCOME OPTIMIZATION");
console.error("==========================================\n");

console.error("Market prices:");
console.error(`  Combat chest:     ${(COMBAT_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error(`  Skilling chest:   ${(SKILLING_CHEST_VALUE / 1e3).toFixed(1)}k`);
console.error(`  Refinement chest: ${(REFINEMENT_CHEST_VALUE / 1e6).toFixed(2)}m`);

console.error(`\nPlayer resources (per run):`);
console.error(`  Torches: ${torchCap}    Shrouds: ${shroudCap}    Beacons: ${beaconCap}    Cooldown: ${cooldownHours}h`);

// Floor clearability summary
console.error("\nFloor clearability:");
for (const fr of analysis.floorResults) {
  if (fr.floor > 15) break;
  const status = fr.overall >= PERCOLATION_THRESHOLD ? "✓" :
                 fr.overall >= 0.35 ? "~" : "✗";
  const shrouds = expectedShroudsForFloor(fr.overall);
  const shroudStr = shrouds === 0 ? "" : ` (need ~${shrouds.toFixed(0)} shrouds)`;
  console.error(
    `  F${String(fr.floor).padStart(2)} ${status} ` +
    `overall=${(fr.overall * 100).toFixed(0).padStart(3)}% ` +
    `skill=${(fr.skill * 100).toFixed(0).padStart(3)}% ` +
    `combat=${(fr.combat * 100).toFixed(0).padStart(3)}%` +
    shroudStr
  );
}

// Skill bottlenecks
console.error("\nSkill room caps (sorted by max clearable):");
for (const s of [...analysis.skillData].sort((a, b) => a.maxClearable - b.maxClearable)) {
  const floorCap = FLOORS.findIndex(([, , fmax]) => fmax >= s.maxClearable);
  const floorStr = floorCap >= 0 ? `(caps at F${FLOORS[floorCap][0]})` : "";
  console.error(`  ${s.name.padEnd(16)} maxClear=${String(s.maxClearable).padStart(3)} ${floorStr}`);
}

// Combat room summary
console.error("\nCombat room caps:");
for (const c of [...analysis.combatData].sort((a, b) => a.maxClearable - b.maxClearable)) {
  console.error(`  ${c.name.padEnd(16)} maxClear=${String(c.maxClearable).padStart(3)}`);
}

// Average combat times by floor
console.error("\nAvg combat kill time by floor:");
for (const [floorNum, fmin, fmax] of FLOORS) {
  if (floorNum > 14) break;
  const mid = (fmin + fmax) / 2;
  const avgTime = getAvgCombatTime(mid);
  const avgRoom = (SKILL_ROOM_TIME_S + avgTime) / 2;
  console.error(`  F${String(floorNum).padStart(2)}: levels ${fmin}-${fmax}, combat=${avgTime.toFixed(0).padStart(3)}s, avg room=${avgRoom.toFixed(0).padStart(2)}s`);
}

// =============================================================================
// Strategy comparison
// =============================================================================
console.error("\n==========================================");
console.error("STRATEGY COMPARISON");
console.error("==========================================\n");

console.error(
  "Target".padStart(6) + " │ " +
  "Reach%".padStart(6) + " │ " +
  "E[Time]".padStart(8) + " │ " +
  "Shrouds".padStart(7) + " │ " +
  "E[Combat]".padStart(9) + " │ " +
  "E[Refine]".padStart(9) + " │ " +
  "E[Tokens]".padStart(9) + " │ " +
  "E[Gold/run]".padStart(11) + " │ " +
  "Gold/hr".padStart(9) + " │ " +
  "Gold/day".padStart(10)
);
console.error("─".repeat(105));

let bestStrategy: StrategyResult | null = null;

for (let targetFloor = 5; targetFloor <= 15; targetFloor++) {
  const strat = evaluateStrategy(targetFloor);
  const lastReachProb = strat.reachProbs[strat.reachProbs.length - 1] ?? 0;

  if (!bestStrategy || strat.goldPerHour > bestStrategy.goldPerHour) {
    bestStrategy = strat;
  }

  const marker = strat === bestStrategy ? " ★" : "";

  console.error(
    `F${String(targetFloor).padStart(4)} │ ` +
    `${(lastReachProb * 100).toFixed(0).padStart(5)}% │ ` +
    `${(strat.expectedTimeMinutes.toFixed(1) + "m").padStart(8)} │ ` +
    `${strat.totalShroudsExpected.toFixed(1).padStart(4)}/${shroudCap} │ ` +
    `${strat.expectedCombatChests.toFixed(1).padStart(9)} │ ` +
    `${strat.expectedRefinementChests.toFixed(1).padStart(9)} │ ` +
    `${strat.expectedTokens.toFixed(0).padStart(9)} │ ` +
    `${(strat.expectedGoldPerRun / 1e6).toFixed(2).padStart(9)}m │ ` +
    `${(strat.goldPerHour / 1e6).toFixed(2).padStart(7)}m │ ` +
    `${(strat.goldPerHour * 24 / 1e6).toFixed(1).padStart(8)}m` +
    marker
  );
}

// =============================================================================
// Detailed breakdown of best strategy
// =============================================================================
if (bestStrategy) {
  const best = bestStrategy;
  console.error(`\n==========================================`);
  console.error(`RECOMMENDED: Target Floor ${best.targetFloor}`);
  console.error(`==========================================\n`);

  console.error("Per-floor detail:");
  console.error(
    "Floor".padStart(5) + " │ " +
    "Clear%".padStart(6) + " │ " +
    "Reach%".padStart(6) + " │ " +
    "Shrouds".padStart(7) + " │ " +
    "Time".padStart(6) + " │ " +
    "Torches".padStart(7) + " │ " +
    "Combat".padStart(6) + " │ " +
    "Refine".padStart(6) + " │ " +
    "Tokens".padStart(6) + " │ " +
    "E[Gold]".padStart(9)
  );
  console.error("─".repeat(85));

  for (let i = 0; i < best.floorData.length; i++) {
    const fd = best.floorData[i];
    const reachP = best.reachProbs[i] ?? 0;
    const expGold = reachP * fd.goldFromExit;

    console.error(
      `F${String(fd.floor).padStart(3)} │ ` +
      `${(fd.clearRate * 100).toFixed(0).padStart(5)}% │ ` +
      `${(reachP * 100).toFixed(0).padStart(5)}% │ ` +
      `${fd.shroudsNeeded.toFixed(1).padStart(4)}/${best.shroudUsage[i]?.toFixed(1) ?? "0"} │ ` +
      `${(fd.rushTimeS.toFixed(0) + "s").padStart(6)} │ ` +
      `${fd.rushTorches.toFixed(1).padStart(7)} │ ` +
      `${fd.exitCombatChests.toFixed(1).padStart(6)} │ ` +
      `${fd.exitRefinementChests.toFixed(1).padStart(6)} │ ` +
      `${fd.exitTokens.toFixed(0).padStart(6)} │ ` +
      `${(expGold / 1e6).toFixed(2).padStart(8)}m`
    );
  }

  console.error("─".repeat(85));
  console.error(`\nSummary:`);
  console.error(`  Expected run time:     ${best.expectedTimeMinutes.toFixed(1)} minutes`);
  console.error(`  Cooldown:              ${cooldownHours} hours`);
  console.error(`  Cycle time:            ${best.cycleTimeHours.toFixed(1)} hours`);
  console.error(`  Runs per day:          ${(24 / best.cycleTimeHours).toFixed(2)}`);
  console.error(`  Torches used:          ${best.expectedTorchesUsed.toFixed(0)} / ${torchCap}`);
  console.error(`  Shrouds used:          ${best.totalShroudsExpected.toFixed(1)} / ${shroudCap}`);
  console.error(``);
  console.error(`  E[Combat chests]:      ${best.expectedCombatChests.toFixed(1)} → ${(best.expectedCombatChests * COMBAT_CHEST_VALUE / 1e6).toFixed(2)}m`);
  console.error(`  E[Refinement chests]:  ${best.expectedRefinementChests.toFixed(1)} → ${(best.expectedRefinementChests * REFINEMENT_CHEST_VALUE / 1e6).toFixed(2)}m`);
  console.error(`  E[Tokens]:             ${best.expectedTokens.toFixed(0)}`);
  console.error(``);
  console.error(`  Expected gold/run:     ${(best.expectedGoldPerRun / 1e6).toFixed(2)}m`);
  console.error(`  Gold per hour:         ${(best.goldPerHour / 1e6).toFixed(2)}m`);
  console.error(`  Gold per day:          ${(best.goldPerHour * 24 / 1e6).toFixed(1)}m`);
  console.error(`  Gold per active min:   ${(best.goldPerActiveMinute / 1e6).toFixed(3)}m`);

  // =============================================================================
  // Exploration analysis: forward-pass torch allocation
  // CONSTRAINT: You CANNOT return to previous floors. You must explore each
  // floor BEFORE ascending. Torch budget must be planned as a forward pass.
  // =============================================================================
  const surplusTorches = torchCap - best.expectedTorchesUsed;
  if (surplusTorches > 10) {
    console.error(`\n==========================================`);
    console.error(`EXPLORATION WITH ${Math.round(surplusTorches)} SURPLUS TORCHES`);
    console.error(`(You must explore each floor before ascending — no going back!)`);
    console.error(`==========================================\n`);

    const preservation = EXPERT_TORCH_PRESERVATION;

    // Step 1: Compute per-floor exploration stats
    interface ExploreFloorData {
      floor: number;
      clearRate: number;
      reachProb: number;        // probability you actually reach this floor
      roomsExplorable: number;
      torchesForFullExplore: number;
      tokensPerTorch: number;
      boxesPerTorch: number;
      goldPerTorch: number;     // raw gold per torch on this floor
      expectedGoldPerTorch: number; // reachProb-weighted
      timePerRoom: number;
    }

    const floorExploreData: ExploreFloorData[] = [];

    for (let f = 1; f <= best.targetFloor; f++) {
      const fr = analysis.floorResults.find(r => r.floor === f);
      const clearRate = fr?.overall ?? 0;
      const reachProb = best.reachProbs[f - 1] ?? 0;
      // We also get exit reward contribution when we complete a floor,
      // but for exploration: we can only explore rooms we can actually clear
      if (clearRate < 0.15) {
        floorExploreData.push({
          floor: f, clearRate, reachProb, roomsExplorable: 0,
          torchesForFullExplore: 0, tokensPerTorch: 0, boxesPerTorch: 0,
          goldPerTorch: 0, expectedGoldPerTorch: 0, timePerRoom: 0,
        });
        continue;
      }

      const floorDef = FLOORS.find(([fn]) => fn === f);
      if (!floorDef) continue;
      const [, fmin, fmax] = floorDef;
      const midLevel = (fmin + fmax) / 2;

      const dim = GRID_DIM[f] ?? 8;
      const gridRooms = dim * dim;
      const rushRooms = RUSH_TORCH_EVENTS[f] ?? 14;
      const available = Math.max(0, gridRooms - rushRooms);
      const clearable = Math.floor(available * clearRate);
      const reachable = Math.max(1, Math.floor(clearable * clearRate));

      const treasureCount = TREASURE_ROOM_COUNT[f] ?? 6;
      const treasureTokenReward = Math.min(f, 10);
      const treasureBoxRate = Math.min(f * 0.05, 0.50);
      const regularTokenRate = Math.min(f * 0.05, 0.50);
      const regularBoxRate = Math.min(f * 0.01, 0.10);

      const treasureFrac = Math.min(1, treasureCount / Math.max(1, reachable));
      const tokensPerRoom = treasureFrac * treasureTokenReward + (1 - treasureFrac) * regularTokenRate * clearRate;
      const boxesPerRoom = treasureFrac * treasureBoxRate * 2 + (1 - treasureFrac) * regularBoxRate * clearRate;

      const torchesPerRoom = 1 - preservation;
      const torchesForFull = reachable * torchesPerRoom;

      const tokensPerTorch = tokensPerRoom / torchesPerRoom;
      const boxesPerTorch = boxesPerRoom / torchesPerRoom;

      const goldPerBox = (COMBAT_CHEST_VALUE + SKILLING_CHEST_VALUE) / 2;
      const goldPerTorch = boxesPerTorch * goldPerBox;

      const avgCombatTime = getAvgCombatTime(midLevel);
      const timePerRoom = (SKILL_ROOM_TIME_S + avgCombatTime) / 2;

      floorExploreData.push({
        floor: f, clearRate, reachProb, roomsExplorable: reachable,
        torchesForFullExplore: torchesForFull, tokensPerTorch, boxesPerTorch,
        goldPerTorch, expectedGoldPerTorch: goldPerTorch * reachProb,
        timePerRoom,
      });
    }

    // Step 2: Two-pass optimal allocation
    // Pass 1: Compute how many rush torches are needed for floors F+1..target
    //         so we know the minimum reserve at each floor.
    // Pass 2: Forward walk — on each floor, allocate exploration torches
    //         = min(available - future_rush_reserve, floor_capacity)
    //         But we want to allocate MORE to high-value floors.
    //
    // Strategy: Pre-compute each floor's expected gold/torch (reachProb-weighted).
    // Then do a two-pass:
    //   1. Calculate minimum torch reserve needed at each floor (rush for remaining floors)
    //   2. Distribute surplus using priority: for each torch, which floor gives highest
    //      expected gold/torch? But respecting the constraint that floor F's torches
    //      must come from the budget when you're ON floor F.
    //
    // Simplified approach: forward pass with "save for better" logic.
    // At each floor, compare this floor's expected gold/torch vs the best
    // expected gold/torch of any FUTURE floor. If a future floor is better,
    // save torches for it. Otherwise spend here.

    // Compute rush reserve: torches needed to rush from floor F+1 to target
    const rushReserveAtFloor: number[] = [];
    {
      let cumRush = 0;
      for (let f = best.targetFloor; f >= 1; f--) {
        rushReserveAtFloor[f] = cumRush;
        const rushTorches = (RUSH_TORCH_EVENTS[f] ?? 14) * RUSH_OVERHEAD_FACTOR * (1 - preservation);
        cumRush += rushTorches;
      }
    }

    // Compute best future expected gold/torch at each floor (looking forward)
    const bestFutureGoldPerTorch: number[] = new Array(best.targetFloor + 2).fill(0);
    for (let f = best.targetFloor; f >= 1; f--) {
      const thisFloor = floorExploreData.find(d => d.floor === f);
      const thisVal = thisFloor?.expectedGoldPerTorch ?? 0;
      bestFutureGoldPerTorch[f] = Math.max(thisVal, bestFutureGoldPerTorch[f + 1] ?? 0);
    }

    // Forward pass: allocate exploration torches
    interface FloorAllocation {
      floor: number;
      exploreTorches: number;
      exploreRooms: number;
      exploreTimeS: number;
      exploreGold: number;
      exploreBoxes: number;
      exploreTokens: number;
      torchBudgetBefore: number;
      torchBudgetAfter: number;
      goldPerTorch: number;
      decision: string;
    }

    const allocations: FloorAllocation[] = [];
    let torchBudget = torchCap;
    let totalExploreGold = 0;
    let totalExploreTime = 0;
    let totalExploreTokens = 0;
    let totalExploreBoxes = 0;

    for (let f = 1; f <= best.targetFloor; f++) {
      const fd = floorExploreData.find(d => d.floor === f)!;
      const rushTorches = (RUSH_TORCH_EVENTS[f] ?? 14) * RUSH_OVERHEAD_FACTOR * (1 - preservation);
      const budgetBefore = torchBudget;

      // Deduct rush cost for this floor
      torchBudget -= rushTorches;

      // How many torches can we spare? Must keep enough for future rush.
      const futureReserve = rushReserveAtFloor[f] ?? 0;
      const availableForExplore = Math.max(0, torchBudget - futureReserve);

      // How many torches does this floor need for full explore?
      const maxExplore = fd.torchesForFullExplore;

      // Should we explore here or save for a better future floor?
      const bestFuture = bestFutureGoldPerTorch[f + 1] ?? 0;
      const thisVal = fd.expectedGoldPerTorch;

      let exploreTorches = 0;
      let decision = "";

      if (fd.roomsExplorable === 0 || fd.clearRate < 0.15) {
        decision = "Skip (low clear rate)";
      } else if (thisVal >= bestFuture) {
        // This floor is at least as good as anything ahead — explore fully
        exploreTorches = Math.min(availableForExplore, maxExplore);
        decision = exploreTorches >= maxExplore ? "Full explore (best value)" :
                   exploreTorches > 0 ? "Partial (best value, torch-limited)" : "Skip (no budget)";
      } else {
        // A future floor is better. But we may still have excess torches
        // that we can't use later (future floors have limited capacity too).
        // Calculate how many torches future floors can actually absorb.
        let futureCapacity = 0;
        for (let ff = f + 1; ff <= best.targetFloor; ff++) {
          const ffd = floorExploreData.find(d => d.floor === ff);
          if (ffd && ffd.expectedGoldPerTorch > thisVal) {
            futureCapacity += ffd.torchesForFullExplore;
          }
        }
        // Save enough for better future floors, spend the rest here
        const saveForFuture = Math.min(availableForExplore, futureCapacity);
        const spendHere = Math.min(Math.max(0, availableForExplore - saveForFuture), maxExplore);
        exploreTorches = spendHere;
        decision = exploreTorches > 0 ? `Partial (saving ${saveForFuture.toFixed(0)}T for better floors)` : "Save for later";
      }

      torchBudget -= exploreTorches;

      const rooms = exploreTorches / (1 - preservation);
      const gold = exploreTorches * fd.goldPerTorch;
      const boxes = exploreTorches * fd.boxesPerTorch;
      const tokens = exploreTorches * fd.tokensPerTorch;
      const timeS = rooms * fd.timePerRoom;

      totalExploreGold += gold * fd.reachProb; // expected value
      totalExploreTime += timeS * fd.reachProb;
      totalExploreTokens += tokens * fd.reachProb;
      totalExploreBoxes += boxes * fd.reachProb;

      allocations.push({
        floor: f, exploreTorches, exploreRooms: rooms,
        exploreTimeS: timeS, exploreGold: gold,
        exploreBoxes: boxes, exploreTokens: tokens,
        torchBudgetBefore: budgetBefore, torchBudgetAfter: torchBudget,
        goldPerTorch: fd.goldPerTorch, decision,
      });
    }

    // Print floor-by-floor plan IN TRAVERSAL ORDER
    console.error("Floor-by-floor exploration plan (in traversal order):");
    console.error(
      "Floor".padStart(5) + " │ " +
      "Budget".padStart(6) + " │ " +
      "Rush".padStart(5) + " │ " +
      "Explore".padStart(7) + " │ " +
      "Rooms".padStart(5) + " │ " +
      "Time".padStart(7) + " │ " +
      "Gold".padStart(7) + " │ " +
      "G/Torch".padStart(7) + " │ " +
      "Remaining".padStart(9) + " │ " +
      "Decision"
    );
    console.error("─".repeat(115));

    for (const a of allocations) {
      const rushT = (RUSH_TORCH_EVENTS[a.floor] ?? 14) * RUSH_OVERHEAD_FACTOR * (1 - preservation);
      console.error(
        `F${String(a.floor).padStart(3)} │ ` +
        `${a.torchBudgetBefore.toFixed(0).padStart(6)} │ ` +
        `${rushT.toFixed(0).padStart(5)} │ ` +
        `${a.exploreTorches.toFixed(0).padStart(7)} │ ` +
        `${a.exploreRooms.toFixed(0).padStart(5)} │ ` +
        `${(a.exploreTimeS > 0 ? (a.exploreTimeS / 60).toFixed(1) + "m" : "-").padStart(7)} │ ` +
        `${(a.exploreGold > 0 ? (a.exploreGold / 1e6).toFixed(2) + "m" : "-").padStart(7)} │ ` +
        `${(a.goldPerTorch > 0 ? (a.goldPerTorch / 1e3).toFixed(0) + "k" : "-").padStart(7)} │ ` +
        `${a.torchBudgetAfter.toFixed(0).padStart(9)} │ ` +
        a.decision
      );
    }

    const totalGoldWithExplore = best.expectedGoldPerRun + totalExploreGold;
    const totalTimeWithExplore = best.expectedTimeMinutes + totalExploreTime / 60;
    const cycleWithExplore = totalTimeWithExplore / 60 + cooldownHours;
    const gphWithExplore = totalGoldWithExplore / cycleWithExplore;

    console.error(`\nExpected exploration results (probability-weighted):`);
    console.error(`  Extra gold/run:      +${(totalExploreGold / 1e6).toFixed(2)}m (${totalExploreBoxes.toFixed(1)} boxes, ${totalExploreTokens.toFixed(0)} tokens)`);
    console.error(`  Extra time:          +${(totalExploreTime / 60).toFixed(1)} minutes`);
    console.error(`  Total gold/run:      ${(totalGoldWithExplore / 1e6).toFixed(2)}m`);
    console.error(`  Total run time:      ${totalTimeWithExplore.toFixed(1)} minutes`);
    console.error(`  Gold per hour:       ${(gphWithExplore / 1e6).toFixed(2)}m (was ${(best.goldPerHour / 1e6).toFixed(2)}m rush-only)`);
    console.error(`  Gold per day:        ${(gphWithExplore * 24 / 1e6).toFixed(1)}m (was ${(best.goldPerHour * 24 / 1e6).toFixed(1)}m)`);
  }

  // =============================================================================
  // What's limiting you?
  // =============================================================================
  console.error(`\n==========================================`);
  console.error(`WHAT'S LIMITING YOU`);
  console.error(`==========================================\n`);

  if (analysis.bottleneck) {
    const bn = analysis.bottleneck;
    console.error(`Frontier floor: F${bn.frontierFloor} (overall ${(bn.frontierOverall * 100).toFixed(0)}%)`);
    console.error(`Bottleneck category: ${bn.bottleneckCategory.toUpperCase()}`);
    console.error(`  Skill avg: ${(bn.skillAvg * 100).toFixed(0)}%, Combat avg: ${(bn.combatAvg * 100).toFixed(0)}%`);
    console.error(`\nWeakest rooms on frontier floor:`);
    for (const wr of bn.weakRooms) {
      console.error(`  ${wr.name.padEnd(16)} maxClear=${String(wr.maxClearable).padStart(3)}, clearable=${(wr.frac * 100).toFixed(0)}%, need +${wr.gapNeeded} levels`);
    }
  }

  // Impact of each skill improvement
  console.error(`\nSkills holding you back (maxClearable < Floor ${best.targetFloor} max level ${FLOORS[best.targetFloor - 1]?.[2] ?? "?"}):`);
  const targetMax = FLOORS[best.targetFloor - 1]?.[2] ?? 200;
  for (const s of [...analysis.skillData].sort((a, b) => a.maxClearable - b.maxClearable)) {
    if (s.maxClearable < targetMax) {
      const deficit = targetMax - s.maxClearable;
      console.error(`  ${s.name.padEnd(16)} maxClear=${s.maxClearable}, need +${deficit} (base lv ${s.base})`);
    }
  }

  // =============================================================================
  // Sensitivity: with seals
  // =============================================================================
  console.error(`\n==========================================`);
  console.error(`WITH SKILLING SEALS (what-if)`);
  console.error(`==========================================\n`);

  const sealAnalysis = generateAnalysis(rawCharData, null, gameData, true);
  console.error(`Max floor with seals (no shrouds): ${sealAnalysis.maxFloorNoShrouds}`);
  console.error("\nSkill room caps with seals:");
  for (const s of [...sealAnalysis.skillData].sort((a, b) => a.maxClearable - b.maxClearable)) {
    const orig = analysis.skillData.find(o => o.name === s.name);
    const gain = orig ? s.maxClearable - orig.maxClearable : 0;
    console.error(`  ${s.name.padEnd(16)} maxClear=${String(s.maxClearable).padStart(3)} (+${gain})`);
  }

  // Quick strategy eval with seals
  console.error("\nWith seals, floor clearability:");
  for (const fr of sealAnalysis.floorResults) {
    if (fr.floor > 15) break;
    const origFr = analysis.floorResults.find(o => o.floor === fr.floor);
    const delta = origFr ? fr.overall - origFr.overall : 0;
    const status = fr.overall >= PERCOLATION_THRESHOLD ? "✓" :
                   fr.overall >= 0.35 ? "~" : "✗";
    console.error(
      `  F${String(fr.floor).padStart(2)} ${status} ` +
      `overall=${(fr.overall * 100).toFixed(0).padStart(3)}% ` +
      `(${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(0)}%)`
    );
  }
}
