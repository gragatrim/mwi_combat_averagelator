#!/usr/bin/env tsx
// =============================================================================
// Labyrinth CLI - Run labyrinth combat simulation from the command line
// =============================================================================
// Usage: npx tsx scripts/labyrinth_cli.ts <character_data.json> [--success-rate 0.5] [--with-seals]
//
// Outputs JSON to stdout with per-monster max levels.
// Progress info goes to stderr.

import { readFileSync } from "fs";

// Redirect simulator diagnostic output (console.log) to stderr so only our
// JSON result goes to stdout.
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && (first.startsWith("[DIAG]") || first.startsWith("  "))) {
    // Suppress simulator diagnostics entirely (too noisy for CLI)
    return;
  }
  origLog(...args);
};

import type { GameData, PlayerConfig } from "../src/engine/types";
import {
  parseFullCharacterData,
  type CombatLoadout,
} from "../src/data/fullCharacterData";
import {
  buildCrateBuffs,
  findAllLabyrinthLevels,
  computeClearRate,
  type CrateTier,
} from "../src/features/labyrinthSimulator";
import Buff from "../src/engine/buff";

// =============================================================================
// CLI argument parsing
// =============================================================================

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help") {
  console.error(
    "Usage: npx tsx scripts/labyrinth_cli.ts <character_data.json> [--success-rate 0.5] [--with-seals]"
  );
  process.exit(1);
}

const charDataPath = args[0];
let successRate = 0.5;

const srIdx = args.indexOf("--success-rate");
if (srIdx !== -1 && args[srIdx + 1]) {
  successRate = parseFloat(args[srIdx + 1]);
  if (isNaN(successRate) || successRate <= 0 || successRate >= 1) {
    console.error("Error: --success-rate must be between 0 and 1 (exclusive)");
    process.exit(1);
  }
}

const withSeals = args.includes("--with-seals");

// =============================================================================
// Load data
// =============================================================================

console.error("Loading game data...");
const gameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
) as GameData;

console.error(`Loading character data from ${charDataPath}...`);
const charJson = readFileSync(charDataPath, "utf-8");
const charData = parseFullCharacterData(charJson, gameData);

console.error(`Character: ${charData.hrid}`);
console.error(`Combat loadouts: ${charData.combatLoadouts.length}`);

// =============================================================================
// Detect crate tiers
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
for (const [monsterHrid, loadoutId] of Object.entries(
  charData.labyrinthMonsterLoadouts
)) {
  const loadout = loadoutById.get(loadoutId);
  if (loadout) {
    monsterLoadoutMap[monsterHrid] = loadout.config;
    console.error(
      `  ${monsterHrid.split("/").pop()} -> loadout "${loadout.name}" (${loadoutId})`
    );
  }
}

// Use first combat loadout as default
const defaultConfig = charData.combatLoadouts[0]?.config;
if (!defaultConfig) {
  console.error("Error: No combat loadouts found in character data");
  process.exit(1);
}

// =============================================================================
// Build seal buffs (if requested)
// =============================================================================

const sealBuffs: Buff[] = [];
if (withSeals) {
  const makeSealBuff = (typeHrid: string, flatBoost: number, ratioBoost: number) =>
    new Buff({
      uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
      typeHrid,
      flatBoost,
      flatBoostLevelBonus: 0,
      ratioBoost,
      ratioBoostLevelBonus: 0,
      startTime: 0,
      duration: 1800e9,
    });
  sealBuffs.push(makeSealBuff("/buff_types/attack_speed", 0, 0.15));
  sealBuffs.push(makeSealBuff("/buff_types/cast_speed", 0.15, 0));
  sealBuffs.push(makeSealBuff("/buff_types/damage", 0, 0.08));
  sealBuffs.push(makeSealBuff("/buff_types/critical_rate", 0.1, 0));
  console.error("Seal buffs: attack speed +15%, cast speed +0.15, damage +8%, crit rate +10%");
}

// =============================================================================
// Run simulation
// =============================================================================

console.error(`\nRunning labyrinth simulation (success rate: ${successRate})...`);

const results = findAllLabyrinthLevels(
  defaultConfig,
  crateBuffs,
  sealBuffs,
  0, // no wisdom buff bonus in labyrinth
  gameData,
  300,
  (progress) => {
    const name = progress.monsterHrid.split("/").pop();
    process.stderr.write(`  ${name}: testing level ${progress.currentLevel}\r`);
  },
  monsterLoadoutMap,
  successRate
);

// Clear the progress line
process.stderr.write("\n");

// =============================================================================
// Output results
// =============================================================================

const output = {
  character: charData.hrid,
  successRate,
  sealsApplied: withSeals,
  coffeeCrate: coffeeTier,
  foodCrate: foodTier,
  results: results.map((r) => ({
    monsterHrid: r.monsterHrid,
    monsterName: r.monsterHrid
      .split("/")
      .pop()!
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    maxLevel: r.maxLevel,
    rawMaxLevel: r.rawMaxLevel,
    killTimeSeconds: r.killTimeNs / 1e9,
    estimatedClearRate: r.estimatedClearRate,
  })),
};

// Summary to stderr
console.error("\nResults:");
for (const r of output.results) {
  const rawSuffix = r.rawMaxLevel > r.maxLevel ? ` (raw: ${r.rawMaxLevel})` : "";
  console.error(
    `  ${r.monsterName.padEnd(16)} max level: ${String(r.maxLevel).padStart(3)}${rawSuffix}, ` +
      `kill time: ${r.killTimeSeconds.toFixed(1).padStart(5)}s, ` +
      `clear rate: ${(r.estimatedClearRate * 100).toFixed(0)}%`
  );
}

// JSON to stdout
console.log(JSON.stringify(output, null, 2));
