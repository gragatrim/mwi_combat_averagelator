#!/usr/bin/env tsx
// =============================================================================
// Labyrinth Income Optimizer
// =============================================================================
// Computes optimal floor target + torch allocation to maximize gold/hour.
//
// Usage: npx tsx scripts/labyrinth_income.ts live_data/gragatrim_full_char_data.json

import { readFileSync } from "fs";

// Redirect simulator diagnostics to stderr
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
  BASE_SKILL_ACTION_TIME_MS,
  GRID_DIM,
  TREASURE_ROOM_COUNT,
  LAB_UPGRADE_BASES,
  LAB_UPGRADE_PER_LEVEL,
} from "../src/features/labyrinthAnalyzer/constants";
import { getLabyrinthUpgradeLevels, getBaseSkillLevels } from "../src/features/labyrinthAnalyzer/skillBuffs";
import Buff from "../src/engine/buff";

// =============================================================================
// Chest values (from user input - current market prices)
// =============================================================================
const COMBAT_CHEST_VALUE = 1_300_000;
const SKILLING_CHEST_VALUE = 61_700;
const REFINEMENT_CHEST_VALUE = 2_210_000;
const TOKEN_VALUE = 0; // tokens have value via upgrades but we'll track them separately

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
// Detect crate tiers & build buffs
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

// =============================================================================
// Build per-monster loadout map
// =============================================================================
const loadoutById = new Map<string, CombatLoadout>();
for (const loadout of charData.combatLoadouts) {
  loadoutById.set(loadout.id, loadout);
}

const monsterLoadoutMap: Record<string, PlayerConfig> = {};
for (const [monsterHrid, loadoutId] of Object.entries(charData.labyrinthMonsterLoadouts)) {
  const loadout = loadoutById.get(loadoutId);
  if (loadout) monsterLoadoutMap[monsterHrid] = loadout.config;
}

const defaultConfig = charData.combatLoadouts[0]?.config;
if (!defaultConfig) { console.error("No combat loadouts found"); process.exit(1); }

// =============================================================================
// Get upgrade levels
// =============================================================================
const upgradeLevels = getLabyrinthUpgradeLevels(rawCharData);
const torchCap = LAB_UPGRADE_BASES.torch + upgradeLevels.torch * LAB_UPGRADE_PER_LEVEL.torch;
const shroudCap = LAB_UPGRADE_BASES.shroud + upgradeLevels.shroud * LAB_UPGRADE_PER_LEVEL.shroud;
const beaconCap = LAB_UPGRADE_BASES.beacon + upgradeLevels.beacon * LAB_UPGRADE_PER_LEVEL.beacon;
const cooldownHours = LAB_UPGRADE_BASES.cooldown + upgradeLevels.cooldown * LAB_UPGRADE_PER_LEVEL.cooldown;

console.error(`\nUpgrade levels: torch=${upgradeLevels.torch} (${torchCap}), shroud=${upgradeLevels.shroud} (${shroudCap}), beacon=${upgradeLevels.beacon} (${beaconCap}), cooldown=${upgradeLevels.cooldown} (${cooldownHours}h)`);
console.error(`Unspent tokens: ${upgradeLevels.points}`);

// =============================================================================
// Run full floor analysis to get clearability
// =============================================================================
console.error("\nRunning floor clearability analysis...");
const analysis = generateAnalysis(rawCharData, null, gameData, false);

console.error(`Max floor (no shrouds): ${analysis.maxFloorNoShrouds}`);
console.error(`Target floor: ${analysis.targetFloor}`);

// =============================================================================
// Simulate combat kill times for all labyrinth monsters at various levels
// =============================================================================
console.error("\nSimulating combat kill times...");

const labMonsters = getLabyrinthMonsters(gameData);

// For each monster, get kill times at the midpoint level of each floor
interface MonsterKillTimeData {
  monsterHrid: string;
  killTimesByLevel: Map<number, number>; // level -> kill time in seconds
  maxClearableLevel: number;
}

const monsterData: MonsterKillTimeData[] = [];

for (const monsterHrid of labMonsters) {
  const config = monsterLoadoutMap[monsterHrid] ?? defaultConfig;
  const name = monsterHrid.split("/").pop()!;
  const killTimesByLevel = new Map<number, number>();
  
  // Test levels from 20 to 420 in steps of 10
  let maxClearable = 0;
  for (let level = 20; level <= 420; level += 10) {
    process.stderr.write(`  ${name}: testing level ${level}\r`);
    const result = simulateLabyrinthFight(
      config, monsterHrid, level, crateBuffs, [], 0, gameData
    );
    if (result.success) {
      killTimesByLevel.set(level, result.killTimeNs / 1e9);
      maxClearable = level;
    } else {
      // Interpolate: this level fails, so max is between last success and here
      killTimesByLevel.set(level, 120); // cap at time limit
      break;
    }
  }
  
  process.stderr.write(`  ${name}: max clearable ~${maxClearable}, tested ${killTimesByLevel.size} levels\n`);
  monsterData.push({ monsterHrid, killTimesByLevel, maxClearableLevel: maxClearable });
}

// =============================================================================
// Model per-floor time & rewards
// =============================================================================

// Average combat kill time for a given level (average across all monsters that can be encountered)
function avgCombatTimeAtLevel(level: number): number {
  let totalTime = 0;
  let count = 0;
  for (const md of monsterData) {
    // Find closest level we tested
    const closest = Math.round(level / 10) * 10;
    const kt = md.killTimesByLevel.get(closest);
    if (kt !== undefined) {
      totalTime += kt;
      count++;
    }
  }
  return count > 0 ? totalTime / count : 120;
}

// Skill room time: ~10s base, affected by action speed but in the lab it's simpler
const SKILL_ROOM_TIME_S = 10; // approximate average

interface FloorTimeReward {
  floor: number;
  rushRooms: number;
  rushTimeS: number;        // time just for rush path
  exploreTimeS: number;     // additional time for exploration rooms
  totalTimeS: number;       // rush + explore
  rushTorches: number;
  exploreTorches: number;
  exitTokens: number;
  exitCombatChests: number;
  exitRefinementChests: number;
  exploreCombatChests: number;
  exploreSkillingChests: number;
  exploreTokens: number;
  clearRate: number;
}

function computeFloorData(targetFloor: number, exploreBudgetTorches: number): FloorTimeReward[] {
  const preservation = EXPERT_TORCH_PRESERVATION;
  const floors: FloorTimeReward[] = [];
  
  // Allocate exploration torches: prioritize highest floors (most value per room)
  // First, compute rush costs
  let totalRushTorches = 0;
  const rushTorchesByFloor: number[] = [];
  for (let f = 1; f <= targetFloor; f++) {
    const rush = RUSH_TORCH_EVENTS[f] ?? 14;
    const rushT = rush * RUSH_OVERHEAD_FACTOR * (1 - preservation);
    rushTorchesByFloor.push(rushT);
    totalRushTorches += rushT;
  }
  
  let remainingExplore = Math.max(0, exploreBudgetTorches);
  const exploreAllocByFloor = new Array(targetFloor).fill(0);
  
  // Allocate from top floor down
  for (let f = targetFloor; f >= 1; f--) {
    const idx = f - 1;
    const floorResult = analysis.floorResults.find(fr => fr.floor === f);
    const clearRate = floorResult?.overall ?? 1;
    if (clearRate < 0.15 && f !== targetFloor) continue;
    
    const dim = GRID_DIM[f] ?? 8;
    const gridRooms = dim * dim;
    const rushRooms = RUSH_TORCH_EVENTS[f] ?? 14;
    const available = Math.max(0, gridRooms - rushRooms);
    const clearable = Math.floor(available * clearRate);
    const reachable = Math.max(1, Math.floor(clearable * clearRate));
    const torchesNeeded = reachable * (1 - preservation);
    
    const alloc = Math.min(torchesNeeded, remainingExplore);
    exploreAllocByFloor[idx] = alloc;
    remainingExplore -= alloc;
  }
  
  for (let f = 1; f <= targetFloor; f++) {
    const idx = f - 1;
    const floorDef = FLOORS.find(([fn]) => fn === f);
    if (!floorDef) continue;
    const [, fmin, fmax] = floorDef;
    const midLevel = (fmin + fmax) / 2;
    
    const rushRooms = RUSH_TORCH_EVENTS[f] ?? 14;
    const rushTorches = rushTorchesByFloor[idx];
    const exploreTorches = exploreAllocByFloor[idx];
    
    // Estimate time per room: mix of skill and combat
    // Labyrinth is roughly 50/50 skill vs combat rooms
    const avgCombatTime = avgCombatTimeAtLevel(midLevel);
    const avgRoomTime = (SKILL_ROOM_TIME_S + avgCombatTime) / 2;
    
    const rushTimeS = rushRooms * avgRoomTime;
    
    // Exploration rooms
    const exploreEvents = exploreTorches / (1 - preservation);
    const exploreTimeS = exploreEvents * avgRoomTime;
    
    // Exit rewards
    const exitRewards = FLOOR_EXIT_REWARDS[f] ?? [0, 0, 0];
    const [exitTokens, exitCombatChests, exitRefinementChests] = exitRewards;
    
    // Exploration rewards (treasure rooms + regular rooms)
    const dim = GRID_DIM[f] ?? 8;
    const gridRooms = dim * dim;
    const floorResult = analysis.floorResults.find(fr => fr.floor === f);
    const clearRate = floorResult?.overall ?? 1;
    
    // Treasure rooms found during exploration
    const treasureCount = TREASURE_ROOM_COUNT[f] ?? 6;
    const rushRevealed = rushRooms * 2.5; // RUSH_PATH_REVEAL_FACTOR
    const exploreRevealed = exploreEvents * 1.5;
    const totalRevealed = Math.min(gridRooms, rushRevealed + exploreRevealed);
    const visibleFrac = Math.min(1, totalRevealed / gridRooms);
    const treasureFound = treasureCount * visibleFrac;
    const treasureReached = Math.min(treasureFound, exploreEvents);
    const regularCleared = Math.max(0, exploreEvents - treasureReached) * clearRate;
    
    // Treasure rooms give tokens + boxes (boxes = skilling/combat chests)
    const treasureTokenRate = Math.min(f, 10);
    const treasureBoxRate = Math.min(f * 0.05, 0.50);
    const regularTokenRate = Math.min(f * 0.05, 0.50);
    const regularBoxRate = Math.min(f * 0.01, 0.10);
    
    const exploreTokens = treasureReached * treasureTokenRate + regularCleared * regularTokenRate;
    // Treasure rooms give 2x box rate
    const exploreTotalBoxes = treasureReached * treasureBoxRate * 2 + regularCleared * regularBoxRate;
    
    // Exploration boxes are split between combat and skilling chests
    // (roughly 50/50 based on room types)
    const exploreCombatChests = exploreTotalBoxes * 0.5;
    const exploreSkillingChests = exploreTotalBoxes * 0.5;
    
    floors.push({
      floor: f,
      rushRooms,
      rushTimeS,
      exploreTimeS,
      totalTimeS: rushTimeS + exploreTimeS,
      rushTorches,
      exploreTorches,
      exitTokens,
      exitCombatChests,
      exitRefinementChests,
      exploreCombatChests,
      exploreSkillingChests,
      exploreTokens,
      clearRate,
    });
  }
  
  return floors;
}

// =============================================================================
// Compute income/hour for different strategies
// =============================================================================

interface StrategyResult {
  targetFloor: number;
  totalTimeMinutes: number;
  cycleTimeHours: number;     // including cooldown
  runsPerDay: number;
  totalTorchesUsed: number;
  torchBalance: number;
  // Per-run rewards
  combatChests: number;
  skillingChests: number;
  refinementChests: number;
  tokens: number;
  // Gold values
  goldPerRun: number;
  goldPerHour: number;
  // Breakdown
  floorDetails: FloorTimeReward[];
}

function evaluateStrategy(targetFloor: number, exploreMultiplier: number = 0): StrategyResult {
  // How many torches for rush to target floor?
  let totalRushTorches = 0;
  for (let f = 1; f <= targetFloor; f++) {
    const rush = RUSH_TORCH_EVENTS[f] ?? 14;
    totalRushTorches += rush * RUSH_OVERHEAD_FACTOR * (1 - EXPERT_TORCH_PRESERVATION);
  }
  
  // Exploration budget: remaining torches after rush
  const exploreBudget = Math.max(0, (torchCap - totalRushTorches) * exploreMultiplier);
  
  const floorDetails = computeFloorData(targetFloor, exploreBudget);
  
  const totalTorchesUsed = floorDetails.reduce((s, f) => s + f.rushTorches + f.exploreTorches, 0);
  const torchBalance = torchCap - totalTorchesUsed;
  
  // Total time for the run
  const totalTimeS = floorDetails.reduce((s, f) => s + f.totalTimeS, 0);
  // Add transition time between floors (~5s each)
  const transitionTime = targetFloor * 5;
  const totalRunTimeS = totalTimeS + transitionTime;
  const totalTimeMinutes = totalRunTimeS / 60;
  
  // Cycle time = run time + cooldown
  const cycleTimeHours = totalRunTimeS / 3600 + cooldownHours;
  const runsPerDay = 24 / cycleTimeHours;
  
  // Aggregate rewards
  const combatChests = floorDetails.reduce((s, f) => s + f.exitCombatChests + f.exploreCombatChests, 0);
  const refinementChests = floorDetails.reduce((s, f) => s + f.exitRefinementChests, 0);
  const skillingChests = floorDetails.reduce((s, f) => s + f.exploreSkillingChests, 0);
  const tokens = floorDetails.reduce((s, f) => s + f.exitTokens + f.exploreTokens, 0);
  
  const goldPerRun = 
    combatChests * COMBAT_CHEST_VALUE +
    skillingChests * SKILLING_CHEST_VALUE +
    refinementChests * REFINEMENT_CHEST_VALUE;
  
  const goldPerHour = goldPerRun / cycleTimeHours;
  
  return {
    targetFloor,
    totalTimeMinutes,
    cycleTimeHours,
    runsPerDay,
    totalTorchesUsed,
    torchBalance,
    combatChests,
    skillingChests,
    refinementChests,
    tokens,
    goldPerRun,
    goldPerHour,
    floorDetails,
  };
}

// =============================================================================
// Find optimal strategy
// =============================================================================
console.error("\n==========================================");
console.error("LABYRINTH INCOME OPTIMIZATION");
console.error("==========================================\n");

console.error("Chest values used:");
console.error(`  Combat chest:     ${(COMBAT_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error(`  Skilling chest:   ${(SKILLING_CHEST_VALUE / 1e3).toFixed(1)}k`);
console.error(`  Refinement chest: ${(REFINEMENT_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error("");

// Print combat kill times by floor
console.error("Average combat kill times by floor level:");
for (const [floorNum, fmin, fmax] of FLOORS) {
  const midLevel = (fmin + fmax) / 2;
  const avgTime = avgCombatTimeAtLevel(midLevel);
  const avgRoomTime = (SKILL_ROOM_TIME_S + avgTime) / 2;
  console.error(`  Floor ${String(floorNum).padStart(2)}: levels ${fmin}-${fmax}, avg combat=${avgTime.toFixed(1)}s, avg room=${avgRoomTime.toFixed(1)}s`);
  if (avgTime >= 120) break; // No point showing floors we can't clear
}
console.error("");

// Evaluate all possible target floors
const maxTestFloor = Math.min(20, analysis.targetFloor + 2);
const results: StrategyResult[] = [];

console.error("Strategy comparison (rush-only, no exploration):");
console.error("─".repeat(110));
console.error(
  "Floor".padStart(5) + " │ " +
  "RunTime".padStart(8) + " │ " +
  "Cycle".padStart(6) + " │ " +
  "Runs/d".padStart(6) + " │ " +
  "Torches".padStart(7) + " │ " +
  "Combat".padStart(7) + " │ " +
  "Refine".padStart(7) + " │ " +
  "Tokens".padStart(7) + " │ " +
  "Gold/Run".padStart(10) + " │ " +
  "Gold/Hour".padStart(12) + " │ " +
  "Balance".padStart(7)
);
console.error("─".repeat(110));

for (let targetFloor = 1; targetFloor <= maxTestFloor; targetFloor++) {
  const strat = evaluateStrategy(targetFloor, 0); // rush only
  results.push(strat);
  
  const timeFmt = `${strat.totalTimeMinutes.toFixed(1)}m`;
  const cycleFmt = `${strat.cycleTimeHours.toFixed(1)}h`;
  
  console.error(
    `F${String(targetFloor).padStart(3)} │ ` +
    `${timeFmt.padStart(8)} │ ` +
    `${cycleFmt.padStart(6)} │ ` +
    `${strat.runsPerDay.toFixed(2).padStart(6)} │ ` +
    `${strat.totalTorchesUsed.toFixed(0).padStart(7)} │ ` +
    `${strat.combatChests.toFixed(1).padStart(7)} │ ` +
    `${strat.refinementChests.toFixed(1).padStart(7)} │ ` +
    `${strat.tokens.toFixed(0).padStart(7)} │ ` +
    `${(strat.goldPerRun / 1e6).toFixed(2).padStart(9)}m │ ` +
    `${(strat.goldPerHour / 1e6).toFixed(2).padStart(11)}m │ ` +
    `${strat.torchBalance.toFixed(0).padStart(7)}`
  );
}

// Find best rush-only
const bestRushOnly = results.reduce((a, b) => a.goldPerHour > b.goldPerHour ? a : b);
console.error(`\n★ Best rush-only: Floor ${bestRushOnly.targetFloor} → ${(bestRushOnly.goldPerHour / 1e6).toFixed(2)}m gold/hr`);

// Now evaluate with exploration for the top floors
console.error("\n\nStrategy comparison WITH exploration (using surplus torches):");
console.error("─".repeat(110));
console.error(
  "Floor".padStart(5) + " │ " +
  "RunTime".padStart(8) + " │ " +
  "Cycle".padStart(6) + " │ " +
  "Runs/d".padStart(6) + " │ " +
  "Torches".padStart(7) + " │ " +
  "Combat".padStart(7) + " │ " +
  "Refine".padStart(7) + " │ " +
  "Skill".padStart(7) + " │ " +
  "Tokens".padStart(7) + " │ " +
  "Gold/Run".padStart(10) + " │ " +
  "Gold/Hour".padStart(12)
);
console.error("─".repeat(110));

const exploreResults: StrategyResult[] = [];
for (let targetFloor = Math.max(1, bestRushOnly.targetFloor - 3); targetFloor <= maxTestFloor; targetFloor++) {
  const strat = evaluateStrategy(targetFloor, 1.0); // full exploration
  exploreResults.push(strat);
  
  console.error(
    `F${String(targetFloor).padStart(3)} │ ` +
    `${(strat.totalTimeMinutes.toFixed(1) + "m").padStart(8)} │ ` +
    `${(strat.cycleTimeHours.toFixed(1) + "h").padStart(6)} │ ` +
    `${strat.runsPerDay.toFixed(2).padStart(6)} │ ` +
    `${strat.totalTorchesUsed.toFixed(0).padStart(7)} │ ` +
    `${strat.combatChests.toFixed(1).padStart(7)} │ ` +
    `${strat.refinementChests.toFixed(1).padStart(7)} │ ` +
    `${strat.skillingChests.toFixed(1).padStart(7)} │ ` +
    `${strat.tokens.toFixed(0).padStart(7)} │ ` +
    `${(strat.goldPerRun / 1e6).toFixed(2).padStart(9)}m │ ` +
    `${(strat.goldPerHour / 1e6).toFixed(2).padStart(11)}m`
  );
}

const bestExplore = exploreResults.reduce((a, b) => a.goldPerHour > b.goldPerHour ? a : b);
console.error(`\n★ Best with exploration: Floor ${bestExplore.targetFloor} → ${(bestExplore.goldPerHour / 1e6).toFixed(2)}m gold/hr`);

// =============================================================================
// Detailed breakdown of the best strategy
// =============================================================================
const best = bestExplore.goldPerHour > bestRushOnly.goldPerHour ? bestExplore : bestRushOnly;
const isExplore = best === bestExplore;

console.error("\n==========================================");
console.error(`RECOMMENDED: Floor ${best.targetFloor} (${isExplore ? "with exploration" : "rush only"})`);
console.error("==========================================");
console.error("");
console.error("Per-floor breakdown:");
console.error("─".repeat(100));
console.error(
  "Floor".padStart(5) + " │ " +
  "Rooms".padStart(5) + " │ " +
  "RushTime".padStart(8) + " │ " +
  "ExplTime".padStart(8) + " │ " +
  "Total".padStart(7) + " │ " +
  "Torches".padStart(7) + " │ " +
  "CombatC".padStart(7) + " │ " +
  "RefineC".padStart(7) + " │ " +
  "Tokens".padStart(7) + " │ " +
  "GoldVal".padStart(10)
);
console.error("─".repeat(100));

for (const fd of best.floorDetails) {
  const floorGold = 
    (fd.exitCombatChests + fd.exploreCombatChests) * COMBAT_CHEST_VALUE +
    fd.exitRefinementChests * REFINEMENT_CHEST_VALUE +
    fd.exploreSkillingChests * SKILLING_CHEST_VALUE;
  
  console.error(
    `F${String(fd.floor).padStart(3)} │ ` +
    `${String(fd.rushRooms).padStart(5)} │ ` +
    `${(fd.rushTimeS.toFixed(0) + "s").padStart(8)} │ ` +
    `${(fd.exploreTimeS.toFixed(0) + "s").padStart(8)} │ ` +
    `${(fd.totalTimeS.toFixed(0) + "s").padStart(7)} │ ` +
    `${(fd.rushTorches + fd.exploreTorches).toFixed(1).padStart(7)} │ ` +
    `${(fd.exitCombatChests + fd.exploreCombatChests).toFixed(1).padStart(7)} │ ` +
    `${fd.exitRefinementChests.toFixed(1).padStart(7)} │ ` +
    `${(fd.exitTokens + fd.exploreTokens).toFixed(0).padStart(7)} │ ` +
    `${(floorGold / 1e6).toFixed(2).padStart(9)}m`
  );
}

console.error("─".repeat(100));
console.error("");
console.error("Summary:");
console.error(`  Run time:          ${best.totalTimeMinutes.toFixed(1)} minutes`);
console.error(`  Cooldown:          ${cooldownHours} hours`);
console.error(`  Cycle time:        ${best.cycleTimeHours.toFixed(1)} hours`);
console.error(`  Runs per day:      ${best.runsPerDay.toFixed(2)}`);
console.error(`  Torches used:      ${best.totalTorchesUsed.toFixed(0)} / ${torchCap}`);
console.error(`  Torch balance:     ${best.torchBalance.toFixed(0)}`);
console.error("");
console.error(`  Combat chests:     ${best.combatChests.toFixed(1)} × ${(COMBAT_CHEST_VALUE/1e6).toFixed(2)}m = ${(best.combatChests * COMBAT_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error(`  Refinement chests: ${best.refinementChests.toFixed(1)} × ${(REFINEMENT_CHEST_VALUE/1e6).toFixed(2)}m = ${(best.refinementChests * REFINEMENT_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error(`  Skilling chests:   ${best.skillingChests.toFixed(1)} × ${(SKILLING_CHEST_VALUE/1e3).toFixed(1)}k = ${(best.skillingChests * SKILLING_CHEST_VALUE / 1e6).toFixed(2)}m`);
console.error(`  Tokens earned:     ${best.tokens.toFixed(0)}`);
console.error("");
console.error(`  Gold per run:      ${(best.goldPerRun / 1e6).toFixed(2)}m`);
console.error(`  Gold per hour:     ${(best.goldPerHour / 1e6).toFixed(2)}m`);
console.error(`  Gold per day:      ${(best.goldPerHour * 24 / 1e6).toFixed(2)}m`);

// =============================================================================
// Sensitivity: What if you rush to a lower floor faster?
// =============================================================================
console.error("\n==========================================");
console.error("TIME EFFICIENCY ANALYSIS");
console.error("==========================================\n");

console.error("Gold earned per minute of active play time (excluding cooldown):");
for (let f = Math.max(1, bestRushOnly.targetFloor - 5); f <= maxTestFloor; f++) {
  const rushStrat = evaluateStrategy(f, 0);
  const explStrat = evaluateStrategy(f, 1.0);
  const rushGoldPerMin = rushStrat.goldPerRun / rushStrat.totalTimeMinutes;
  const explGoldPerMin = explStrat.goldPerRun / explStrat.totalTimeMinutes;
  console.error(
    `  F${String(f).padStart(2)}: Rush=${(rushGoldPerMin / 1e6).toFixed(3)}m/min (${rushStrat.totalTimeMinutes.toFixed(1)}min), ` +
    `Explore=${(explGoldPerMin / 1e6).toFixed(3)}m/min (${explStrat.totalTimeMinutes.toFixed(1)}min)`
  );
}
