#!/usr/bin/env tsx
/**
 * Labyrinth Income Optimizer
 *
 * Calculates optimal floor to exit the labyrinth to maximize gold/hour.
 * All floors are treated as reachable (player brute-forces low-clearability
 * floors by attempting rooms, failing, rerouting). Time model accounts for
 * failed room attempts on floors with < 100% clearability.
 *
 * Calibrated against real player data: ~7h for a full F15 run.
 *
 * Usage: npx tsx scripts/labyrinth_income.ts [character_data.json]
 */

import { readFileSync } from "fs";

const origLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && (first.startsWith("[DIAG]") || first.startsWith("  "))) return;
  origLog(...args);
};

import type { GameData, PlayerConfig } from "../src/engine/types";
import { parseFullCharacterData, type CombatLoadout } from "../src/data/fullCharacterData";
import { buildCrateBuffs, simulateLabyrinthFight, getLabyrinthMonsters, type CrateTier } from "../src/features/labyrinthSimulator";
import { generateAnalysis } from "../src/features/labyrinthAnalyzer/index";
import {
  FLOORS, FLOOR_EXIT_REWARDS, RUSH_TORCH_EVENTS, EXPERT_TORCH_PRESERVATION,
  RUSH_OVERHEAD_FACTOR, BASE_SKILL_ACTION_TIME_MS, GRID_DIM, TREASURE_ROOM_COUNT,
  LAB_UPGRADE_BASES, LAB_UPGRADE_PER_LEVEL, PERCOLATION_THRESHOLD,
} from "../src/features/labyrinthAnalyzer/constants";
import { getLabyrinthUpgradeLevels } from "../src/features/labyrinthAnalyzer/skillBuffs";
import Buff from "../src/engine/buff";

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
// Setup
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

// =============================================================================
// Floor clearability
// =============================================================================
console.error("\nRunning floor clearability analysis...");
const analysis = generateAnalysis(rawCharData, null, gameData, false);

// =============================================================================
// Combat kill times
// =============================================================================
console.error("Simulating combat kill times...");
const labMonsters = getLabyrinthMonsters(gameData);
const avgKillTimeCache = new Map<number, number>();

function getAvgCombatTime(level: number): number {
  const rounded = Math.round(level / 10) * 10;
  if (avgKillTimeCache.has(rounded)) return avgKillTimeCache.get(rounded)!;
  let totalTime = 0, count = 0;
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

for (const [, fmin, fmax] of FLOORS) {
  const mid = Math.round((fmin + fmax) / 2 / 10) * 10;
  if (mid <= 400) { process.stderr.write(`  Level ${mid}...\r`); getAvgCombatTime(mid); }
}
console.error("  Done.                    ");

// =============================================================================
// REALISTIC TIME MODEL
// =============================================================================
// On a floor with clearRate p:
// - The rush path needs ~rushRooms "successful" rooms to traverse
// - But with clearRate < 1, some rooms you attempt will fail
// - Failed combat rooms waste up to 120s, failed skill rooms waste ~10-120s
// - You also need to reroute around failures, trying alternative paths
// - On an 8×8 grid with 14-room rush path and clearRate p:
//   Expected rooms attempted ≈ rushRooms / p (need 1/p attempts per success)
//   But routing helps — you don't blindly try, you pick likely paths
//   Adjustment: attempts ≈ rushRooms × (1 + (1-p)/p × routingEfficiency)
//   where routingEfficiency ≈ 0.5 (you can route around ~50% of failures)
//
// For failed rooms: combat fails cost ~120s, skill fails cost ~60-120s
// Average failed room time ≈ 90s (mix of quick skill fails and full combat timeouts)

const SKILL_ROOM_TIME_S = 10;
const FAILED_ROOM_AVG_TIME_S = 90; // average time wasted on a room you can't clear
const ROUTING_EFFICIENCY = 0.5;    // fraction of failures avoided by smart routing
const FLOOR_TRANSITION_S = 5;

function estimateFloorTimeS(floorNum: number): number {
  const floorDef = FLOORS.find(([f]) => f === floorNum);
  if (!floorDef) return 0;
  const [, fmin, fmax] = floorDef;
  const midLevel = (fmin + fmax) / 2;

  const fr = analysis.floorResults.find(f => f.floor === floorNum);
  const clearRate = Math.max(0.05, fr?.overall ?? 1); // floor is minimum 5% if reachable

  const rushRooms = RUSH_TORCH_EVENTS[floorNum] ?? 14;
  const avgCombatTime = getAvgCombatTime(midLevel);
  const avgSuccessRoomTime = (SKILL_ROOM_TIME_S + avgCombatTime) / 2;

  if (clearRate >= 0.95) {
    // Nearly all rooms clearable — just rush through
    return rushRooms * avgSuccessRoomTime + FLOOR_TRANSITION_S;
  }

  // Rooms attempted = successful rooms + failed attempts
  // For each room on the path, probability of clearing = clearRate
  // Expected failed attempts before finding a clearable room ≈ (1-p)/p
  // But routing lets you avoid some failures (try promising rooms first)
  const failsPerSuccess = (1 - clearRate) / clearRate;
  const effectiveFails = failsPerSuccess * (1 - ROUTING_EFFICIENCY);

  const successTime = rushRooms * avgSuccessRoomTime;
  const failTime = rushRooms * effectiveFails * FAILED_ROOM_AVG_TIME_S;

  // Additional overhead: decision-making, map scanning, dead ends
  const overheadFactor = 1.1;

  return (successTime + failTime) * overheadFactor + FLOOR_TRANSITION_S;
}

// =============================================================================
// Calibration check against user's reported ~7h for F15
// =============================================================================
let cumulativeTimeS = 0;
const floorTimes: { floor: number; timeS: number; cumTimeS: number; cumTimeMin: number }[] = [];
for (let f = 1; f <= 15; f++) {
  const timeS = estimateFloorTimeS(f);
  cumulativeTimeS += timeS;
  floorTimes.push({ floor: f, timeS, cumTimeS: cumulativeTimeS, cumTimeMin: cumulativeTimeS / 60 });
}

console.error("\nEstimated time per floor:");
for (const ft of floorTimes) {
  const fr = analysis.floorResults.find(f => f.floor === ft.floor);
  const clearPct = ((fr?.overall ?? 1) * 100).toFixed(0);
  console.error(
    `  F${String(ft.floor).padStart(2)}: ` +
    `${(ft.timeS / 60).toFixed(1).padStart(5)}min ` +
    `(cumulative: ${ft.cumTimeMin.toFixed(0).padStart(4)}min) ` +
    `clear=${clearPct.padStart(3)}%`
  );
}
console.error(`\nEstimated F15 total: ${(cumulativeTimeS / 60).toFixed(0)} minutes (${(cumulativeTimeS / 3600).toFixed(1)}h)`);
console.error(`User reported: ~420 minutes (7h)`);

// Apply calibration factor
const REPORTED_F15_TIME_MIN = 420;
const estimatedF15Min = cumulativeTimeS / 60;
const calibrationFactor = REPORTED_F15_TIME_MIN / estimatedF15Min;
console.error(`Calibration factor: ${calibrationFactor.toFixed(2)}x`);

function calibratedFloorTimeMin(floorNum: number): number {
  return (estimateFloorTimeS(floorNum) / 60) * calibrationFactor;
}

// =============================================================================
// Exploration model — forward pass (can't go back to previous floors)
// =============================================================================
const preservation = EXPERT_TORCH_PRESERVATION;

interface FloorExploreStats {
  floor: number;
  clearRate: number;
  roomsExplorable: number;
  torchesForFull: number;
  goldPerTorch: number;
  timePerRoomS: number;
}

function getFloorExploreStats(floorNum: number): FloorExploreStats {
  const fr = analysis.floorResults.find(f => f.floor === floorNum);
  const clearRate = fr?.overall ?? 0;
  const floorDef = FLOORS.find(([f]) => f === floorNum);
  if (!floorDef || clearRate < 0.10) {
    return { floor: floorNum, clearRate, roomsExplorable: 0, torchesForFull: 0, goldPerTorch: 0, timePerRoomS: 0 };
  }
  const [, fmin, fmax] = floorDef;
  const midLevel = (fmin + fmax) / 2;
  const dim = GRID_DIM[floorNum] ?? 8;
  const gridRooms = dim * dim;
  const rushRooms = RUSH_TORCH_EVENTS[floorNum] ?? 14;
  const available = Math.max(0, gridRooms - rushRooms);
  const clearable = Math.floor(available * clearRate);
  const reachable = Math.max(1, Math.floor(clearable * clearRate));
  const treasureCount = TREASURE_ROOM_COUNT[floorNum] ?? 6;
  const treasureBoxRate = Math.min(floorNum * 0.05, 0.50);
  const regularBoxRate = Math.min(floorNum * 0.01, 0.10);
  const treasureFrac = Math.min(1, treasureCount / Math.max(1, reachable));
  const boxesPerRoom = treasureFrac * treasureBoxRate * 2 + (1 - treasureFrac) * regularBoxRate * clearRate;
  const torchesPerRoom = 1 - preservation;
  const boxesPerTorch = boxesPerRoom / torchesPerRoom;
  const goldPerBox = (COMBAT_CHEST_VALUE + SKILLING_CHEST_VALUE) / 2;
  const avgCombatTime = getAvgCombatTime(midLevel);
  const timePerRoom = (SKILL_ROOM_TIME_S + avgCombatTime) / 2;

  return {
    floor: floorNum, clearRate, roomsExplorable: reachable,
    torchesForFull: reachable * torchesPerRoom,
    goldPerTorch: boxesPerTorch * goldPerBox,
    timePerRoomS: timePerRoom,
  };
}

// =============================================================================
// Evaluate a strategy: rush + explore to target floor, with forward-pass torches
// =============================================================================

interface FloorDetail {
  floor: number;
  clearRate: number;
  rushTimeMin: number;
  exploreTimeMin: number;
  totalTimeMin: number;
  cumulativeTimeMin: number;
  rushTorches: number;
  exploreTorches: number;
  torchBudgetAfter: number;
  exitTokens: number;
  exitCombatChests: number;
  exitRefinementChests: number;
  exitGold: number;
  exploreGold: number;
  totalGold: number;
  cumulativeGold: number;
  goldPerTorch: number;
  marginalGoldPerMin: number; // gold added by this floor / time added by this floor
}

interface StrategyResult {
  targetFloor: number;
  floors: FloorDetail[];
  totalTimeMin: number;
  totalGold: number;
  cycleTimeHrs: number;
  goldPerHour: number;
  goldPerDay: number;
  goldPerActiveMin: number;
  totalCombatChests: number;
  totalRefinementChests: number;
  totalTokens: number;
  torchesUsed: number;
}

function evaluateStrategy(targetFloor: number): StrategyResult {
  const floors: FloorDetail[] = [];
  let torchBudget = torchCap;
  let cumTimeMin = 0;
  let cumGold = 0;
  let totalCombat = 0, totalRefine = 0, totalTokens = 0;

  // Pre-compute rush torch costs and future reserves
  const rushTorchCost: number[] = [];
  for (let f = 1; f <= 20; f++) {
    rushTorchCost[f] = (RUSH_TORCH_EVENTS[f] ?? 14) * RUSH_OVERHEAD_FACTOR * (1 - preservation);
  }

  // Pre-compute explore stats for all floors
  const exploreStats: FloorExploreStats[] = [];
  for (let f = 1; f <= targetFloor; f++) {
    exploreStats[f] = getFloorExploreStats(f);
  }

  // Forward-pass: compute best future gold/torch for save-vs-spend decisions
  const bestFutureGPT: number[] = new Array(targetFloor + 2).fill(0);
  for (let f = targetFloor; f >= 1; f--) {
    bestFutureGPT[f] = Math.max(exploreStats[f]?.goldPerTorch ?? 0, bestFutureGPT[f + 1] ?? 0);
  }

  for (let f = 1; f <= targetFloor; f++) {
    const rushTime = calibratedFloorTimeMin(f);
    const rushT = rushTorchCost[f];
    torchBudget -= rushT;

    // Explore allocation (forward-pass, can't go back)
    const es = exploreStats[f];
    const futureRushReserve = Array.from({ length: targetFloor - f }, (_, i) => rushTorchCost[f + 1 + i]).reduce((a, b) => a + b, 0);
    const availableForExplore = Math.max(0, torchBudget - futureRushReserve);

    let exploreTorches = 0;
    if (es.roomsExplorable > 0 && es.goldPerTorch > 0) {
      const futureGPT = bestFutureGPT[f + 1] ?? 0;
      if (es.goldPerTorch >= futureGPT) {
        // This floor is best or equal — explore fully
        exploreTorches = Math.min(availableForExplore, es.torchesForFull);
      } else {
        // Future is better — compute future capacity and save for it
        let futureCapacity = 0;
        for (let ff = f + 1; ff <= targetFloor; ff++) {
          if ((exploreStats[ff]?.goldPerTorch ?? 0) > es.goldPerTorch) {
            futureCapacity += exploreStats[ff]?.torchesForFull ?? 0;
          }
        }
        const saveForFuture = Math.min(availableForExplore, futureCapacity);
        exploreTorches = Math.min(Math.max(0, availableForExplore - saveForFuture), es.torchesForFull);
      }
    }

    torchBudget -= exploreTorches;

    const exploreRooms = exploreTorches / (1 - preservation);
    const exploreTimeMin = (exploreRooms * es.timePerRoomS / 60) * calibrationFactor;
    const exploreGold = exploreTorches * es.goldPerTorch;

    const exitRewards = FLOOR_EXIT_REWARDS[f] ?? [0, 0, 0];
    const [exitTokens, exitCombatChests, exitRefinementChests] = exitRewards;
    const exitGold = exitCombatChests * COMBAT_CHEST_VALUE + exitRefinementChests * REFINEMENT_CHEST_VALUE;

    const totalFloorTime = rushTime + exploreTimeMin;
    cumTimeMin += totalFloorTime;
    const totalFloorGold = exitGold + exploreGold;
    cumGold += totalFloorGold;
    totalCombat += exitCombatChests;
    totalRefine += exitRefinementChests;
    totalTokens += exitTokens;

    const marginalGPM = totalFloorTime > 0 ? totalFloorGold / totalFloorTime : 0;

    floors.push({
      floor: f, clearRate: es.clearRate,
      rushTimeMin: rushTime, exploreTimeMin, totalTimeMin: totalFloorTime,
      cumulativeTimeMin: cumTimeMin,
      rushTorches: rushT, exploreTorches, torchBudgetAfter: torchBudget,
      exitTokens, exitCombatChests, exitRefinementChests, exitGold,
      exploreGold, totalGold: totalFloorGold, cumulativeGold: cumGold,
      goldPerTorch: es.goldPerTorch, marginalGoldPerMin: marginalGPM,
    });
  }

  const cycleTimeHrs = cumTimeMin / 60 + cooldownHours;
  return {
    targetFloor, floors,
    totalTimeMin: cumTimeMin, totalGold: cumGold,
    cycleTimeHrs, goldPerHour: cumGold / cycleTimeHrs,
    goldPerDay: (cumGold / cycleTimeHrs) * 24,
    goldPerActiveMin: cumTimeMin > 0 ? cumGold / cumTimeMin : 0,
    totalCombatChests: totalCombat, totalRefinementChests: totalRefine,
    totalTokens, torchesUsed: torchCap - torchBudget,
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
console.error(`\nResources: Torches=${torchCap} Shrouds=${shroudCap} Beacons=${beaconCap} Cooldown=${cooldownHours}h`);

// Floor clearability
console.error("\nFloor clearability:");
for (const fr of analysis.floorResults) {
  if (fr.floor > 15) break;
  console.error(
    `  F${String(fr.floor).padStart(2)}: ` +
    `overall=${(fr.overall * 100).toFixed(0).padStart(3)}% ` +
    `skill=${(fr.skill * 100).toFixed(0).padStart(3)}% ` +
    `combat=${(fr.combat * 100).toFixed(0).padStart(3)}%`
  );
}

// =============================================================================
// Main comparison: exit at each floor
// =============================================================================
console.error("\n==========================================");
console.error("EXIT FLOOR COMPARISON (rush + explore on the way up)");
console.error("==========================================\n");

console.error(
  "Exit".padStart(4) + " │ " +
  "RunTime".padStart(8) + " │ " +
  "Cycle".padStart(6) + " │ " +
  "Combat♦".padStart(7) + " │ " +
  "Refine♦".padStart(7) + " │ " +
  "Tokens".padStart(6) + " │ " +
  "Gold/Run".padStart(10) + " │ " +
  "Gold/Hr".padStart(9) + " │ " +
  "Gold/Day".padStart(9) + " │ " +
  "G/ActMin".padStart(9) + " │ " +
  "Torches".padStart(7)
);
console.error("─".repeat(110));

const strategies: StrategyResult[] = [];
let bestGPH: StrategyResult | null = null;
let bestGPM: StrategyResult | null = null;

for (let exitFloor = 5; exitFloor <= 15; exitFloor++) {
  const s = evaluateStrategy(exitFloor);
  strategies.push(s);
  if (!bestGPH || s.goldPerHour > bestGPH.goldPerHour) bestGPH = s;
  if (!bestGPM || s.goldPerActiveMin > bestGPM.goldPerActiveMin) bestGPM = s;

  const marker = s === bestGPH ? " ★GPH" : "";
  console.error(
    `F${String(exitFloor).padStart(2)} │ ` +
    `${(s.totalTimeMin.toFixed(0) + "m").padStart(8)} │ ` +
    `${(s.cycleTimeHrs.toFixed(1) + "h").padStart(6)} │ ` +
    `${s.totalCombatChests.toFixed(1).padStart(7)} │ ` +
    `${s.totalRefinementChests.toFixed(1).padStart(7)} │ ` +
    `${s.totalTokens.toFixed(0).padStart(6)} │ ` +
    `${(s.totalGold / 1e6).toFixed(2).padStart(8)}m │ ` +
    `${(s.goldPerHour / 1e6).toFixed(2).padStart(7)}m │ ` +
    `${(s.goldPerDay / 1e6).toFixed(1).padStart(7)}m │ ` +
    `${(s.goldPerActiveMin / 1e6).toFixed(3).padStart(7)}m │ ` +
    `${s.torchesUsed.toFixed(0).padStart(4)}/${torchCap}` +
    marker
  );
}

// =============================================================================
// Detailed breakdown of best gold/hour and marginal analysis
// =============================================================================
if (bestGPH) {
  const best = bestGPH;
  console.error(`\n★ Best Gold/Hour: Exit at F${best.targetFloor} → ${(best.goldPerHour / 1e6).toFixed(2)}m/hr, ${(best.goldPerDay / 1e6).toFixed(1)}m/day`);
}
if (bestGPM && bestGPM !== bestGPH) {
  console.error(`★ Best Gold/Active Minute: Exit at F${bestGPM.targetFloor} → ${(bestGPM.goldPerActiveMin / 1e6).toFixed(3)}m/min`);
}

// Marginal analysis: show the gold and time added by each floor
console.error("\n==========================================");
console.error("MARGINAL ANALYSIS: Is each extra floor worth it?");
console.error("==========================================\n");

const fullRun = evaluateStrategy(15);
console.error(
  "Floor".padStart(5) + " │ " +
  "Clear%".padStart(6) + " │ " +
  "FloorTime".padStart(9) + " │ " +
  "CumTime".padStart(8) + " │ " +
  "FloorGold".padStart(10) + " │ " +
  "CumGold".padStart(10) + " │ " +
  "Marginal G/m".padStart(12) + " │ " +
  "CumG/hr".padStart(8) + " │ " +
  "Decision"
);
console.error("─".repeat(105));

for (const fd of fullRun.floors) {
  // Compare: gold/hour if we stop HERE vs gold/hour if we stop at previous floor
  const stopHere = evaluateStrategy(fd.floor);
  const stopPrev = fd.floor > 1 ? evaluateStrategy(fd.floor - 1) : null;
  const marginalGPH = stopPrev
    ? (stopHere.totalGold - stopPrev.totalGold) / (stopHere.cycleTimeHrs - stopPrev.cycleTimeHrs)
    : stopHere.goldPerHour;

  // Is it worth continuing? Compare marginal gold/hr to overall gold/hr
  let decision = "";
  if (fd.floor <= 7) decision = "✓ Fast clear";
  else if (fd.marginalGoldPerMin * 60 > stopHere.goldPerHour * 0.8) decision = "✓ Worth it";
  else if (fd.marginalGoldPerMin * 60 > stopHere.goldPerHour * 0.4) decision = "~ Marginal";
  else decision = "✗ Diminishing returns";

  console.error(
    `F${String(fd.floor).padStart(3)} │ ` +
    `${(fd.clearRate * 100).toFixed(0).padStart(5)}% │ ` +
    `${(fd.totalTimeMin.toFixed(0) + "m").padStart(9)} │ ` +
    `${(fd.cumulativeTimeMin.toFixed(0) + "m").padStart(8)} │ ` +
    `${(fd.totalGold / 1e6).toFixed(2).padStart(8)}m │ ` +
    `${(fd.cumulativeGold / 1e6).toFixed(2).padStart(8)}m │ ` +
    `${(fd.marginalGoldPerMin / 1e6).toFixed(3).padStart(10)}m │ ` +
    `${(stopHere.goldPerHour / 1e6).toFixed(2).padStart(6)}m │ ` +
    decision
  );
}

// =============================================================================
// Exploration plan for the optimal strategy
// =============================================================================
if (bestGPH) {
  const best = bestGPH;
  console.error(`\n==========================================`);
  console.error(`DETAILED PLAN: Exit at Floor ${best.targetFloor}`);
  console.error(`==========================================\n`);

  console.error("Floor-by-floor (explore as you ascend — no going back):");
  console.error(
    "Floor".padStart(5) + " │ " +
    "Budget".padStart(6) + " │ " +
    "Rush".padStart(5) + " │ " +
    "Explore".padStart(7) + " │ " +
    "RushTime".padStart(8) + " │ " +
    "ExplTime".padStart(8) + " │ " +
    "ExitGold".padStart(9) + " │ " +
    "ExplGold".padStart(9) + " │ " +
    "CumGold".padStart(9) + " │ " +
    "CumTime".padStart(8)
  );
  console.error("─".repeat(100));

  for (const fd of best.floors) {
    console.error(
      `F${String(fd.floor).padStart(3)} │ ` +
      `${(fd.torchBudgetAfter + fd.rushTorches + fd.exploreTorches).toFixed(0).padStart(6)} │ ` +
      `${fd.rushTorches.toFixed(0).padStart(5)} │ ` +
      `${fd.exploreTorches.toFixed(0).padStart(7)} │ ` +
      `${(fd.rushTimeMin.toFixed(1) + "m").padStart(8)} │ ` +
      `${(fd.exploreTimeMin > 0.1 ? fd.exploreTimeMin.toFixed(1) + "m" : "-").padStart(8)} │ ` +
      `${(fd.exitGold / 1e6).toFixed(2).padStart(7)}m │ ` +
      `${(fd.exploreGold > 0 ? (fd.exploreGold / 1e6).toFixed(2) + "m" : "-").padStart(9)} │ ` +
      `${(fd.cumulativeGold / 1e6).toFixed(2).padStart(7)}m │ ` +
      `${(fd.cumulativeTimeMin.toFixed(0) + "m").padStart(8)}`
    );
  }

  console.error(`\nSummary:`);
  console.error(`  Run time:            ${best.totalTimeMin.toFixed(0)} minutes (${(best.totalTimeMin / 60).toFixed(1)}h)`);
  console.error(`  Cooldown:            ${cooldownHours}h`);
  console.error(`  Cycle time:          ${best.cycleTimeHrs.toFixed(1)}h`);
  console.error(`  Torches used:        ${best.torchesUsed.toFixed(0)} / ${torchCap}`);
  console.error(`  Combat chests:       ${best.totalCombatChests.toFixed(1)} → ${(best.totalCombatChests * COMBAT_CHEST_VALUE / 1e6).toFixed(2)}m`);
  console.error(`  Refinement chests:   ${best.totalRefinementChests.toFixed(1)} → ${(best.totalRefinementChests * REFINEMENT_CHEST_VALUE / 1e6).toFixed(2)}m`);
  console.error(`  Tokens:              ${best.totalTokens}`);
  console.error(`  Gold per run:        ${(best.totalGold / 1e6).toFixed(2)}m`);
  console.error(`  Gold per hour:       ${(best.goldPerHour / 1e6).toFixed(2)}m`);
  console.error(`  Gold per day:        ${(best.goldPerDay / 1e6).toFixed(1)}m`);
  console.error(`  Gold per active min: ${(best.goldPerActiveMin / 1e6).toFixed(3)}m`);
}

// =============================================================================
// The user's key question: short vs long runs
// =============================================================================
console.error("\n==========================================");
console.error("SHORT RUN vs LONG RUN COMPARISON");
console.error("==========================================\n");

const scenarios = [
  { name: "Quick: Exit F8", floor: 8 },
  { name: "Medium: Exit F10", floor: 10 },
  { name: "Optimal GPH", floor: bestGPH?.targetFloor ?? 11 },
  { name: "Deep: Exit F15", floor: 15 },
];

for (const sc of scenarios) {
  const s = evaluateStrategy(sc.floor);
  const isBest = s.targetFloor === bestGPH?.targetFloor;
  console.error(`${isBest ? "★ " : "  "}${sc.name} (F${sc.floor}):`);
  console.error(`    Time: ${s.totalTimeMin.toFixed(0)} min (${(s.totalTimeMin / 60).toFixed(1)}h) | Gold/run: ${(s.totalGold / 1e6).toFixed(2)}m | Gold/hr: ${(s.goldPerHour / 1e6).toFixed(2)}m | Gold/day: ${(s.goldPerDay / 1e6).toFixed(1)}m | G/active-min: ${(s.goldPerActiveMin / 1e6).toFixed(3)}m`);
}

console.error("\nKey insight: With a " + cooldownHours + "h cooldown, the cycle time barely changes between strategies.");
console.error("The question is whether the EXTRA HOURS of play for deeper floors generate enough gold to justify the time.");
