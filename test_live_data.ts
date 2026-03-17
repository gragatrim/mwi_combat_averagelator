// Test script: loads 5 live_data player JSONs and runs the dungeon simulation
// Usage: npx tsx test_live_data.ts

import { readFileSync } from "fs";
import { parsePlayerData } from "./src/data/playerData";
import type { GameData, PlayerConfig } from "./src/engine/types";
import Player from "./src/engine/player";
import Zone from "./src/engine/zone";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";
import DeterministicSimulator from "./src/engine/deterministicSimulator";

// ── Load game data ──────────────────────────────────────────────────────────
const gameDataRaw = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);
const gameData: GameData = gameDataRaw;

// ── Load player configs from live_data ──────────────────────────────────────
const playerFiles = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
const playerConfigs: PlayerConfig[] = playerFiles.map((name) => {
  const json = readFileSync(`live_data/${name}.json`, "utf-8");
  const config = parsePlayerData(json, gameData);
  return config;
});

console.log("=== Player HRIDs ===");
for (const cfg of playerConfigs) {
  console.log(`  ${cfg.hrid}: ATK=${cfg.attackLevel} DEF=${cfg.defenseLevel}`);
}

// ── Build player deps ───────────────────────────────────────────────────────
function buildPlayerDeps(gd: GameData) {
  return {
    Equipment: {
      createFromDTO: (
        dto: { hrid: string; enhancementLevel: number },
        _gd: GameData
      ) => Equipment.createFromDTO(gd, dto),
    },
    Consumable: {
      createFromDTO: (
        dto: { hrid: string; triggers: any[] },
        _gd: GameData
      ) => Consumable.createFromDTO(gd, dto),
    },
    Ability: {
      createFromDTO: (
        dto: { hrid: string; level: number; triggers: any[] },
        _gd: GameData
      ) => Ability.createFromDTO(gd, dto),
    },
  };
}

// ── Create Player instances ─────────────────────────────────────────────────
const deps = buildPlayerDeps(gameData);
const players = playerConfigs.map((cfg) =>
  Player.createFromDTO(cfg, gameData, deps)
);

console.log("\n=== Player combat details (after createFromDTO) ===");
for (const p of players) {
  const cs = p.combatDetails.combatStats;
  console.log(`  ${p.hrid}:`);
  console.log(`    weapon: ${cs.combatStyleHrid} / ${cs.damageType}`);
  console.log(`    primaryTraining: ${cs.primaryTraining}`);
  console.log(`    focusTraining: ${cs.focusTraining}`);
  console.log(`    combatExperience: ${(cs.combatExperience * 100).toFixed(1)}%`);
  console.log(`    magicExperience: ${(cs.magicExperience * 100).toFixed(1)}%`);
  console.log(`    rangedExperience: ${(cs.rangedExperience * 100).toFixed(1)}%`);
  console.log(`    attackExperience: ${(cs.attackExperience * 100).toFixed(1)}%`);
}

// ── Create Zone ─────────────────────────────────────────────────────────────
const zoneHrid = "/actions/combat/fly";
const difficultyTier = 0; // T1
const zone = new Zone(zoneHrid, difficultyTier, gameData);
console.log(`\n=== Zone: ${zoneHrid} (tier ${difficultyTier}) ===`);
console.log(`  isDungeon: ${zone.isDungeon}`);

// ── Run Simulation ──────────────────────────────────────────────────────────
const simulator = new DeterministicSimulator(players, zone, gameData);
const simResult = simulator.simulate();

console.log("\n=== Simulation Results ===");
console.log(`  Total sim time: ${(simResult.totalSimTimeNs / 3.6e12).toFixed(2)} hours`);
console.log(`  Encounters: ${simResult.encounters}`);
console.log(`  Dungeons completed: ${simResult.dungeonsCompleted}`);
console.log(`  Dungeons failed: ${simResult.dungeonsFailed}`);
console.log(`  Player stats keys: ${Object.keys(simResult.playerStats).join(", ")}`);

// ── Expected XP values from screenshots ─────────────────────────────────────
const expected: Record<string, { total: number; skills: Record<string, number> }> = {
  gragatrim: { total: 937900, skills: { magic: 937900 } },
  Lisie:     { total: 869100, skills: { magic: 869100 } },
  qu:        { total: 788000, skills: { ranged: 788000 } },
  Skumbus:   { total: 785000, skills: { attack: 567300, magic: 217700 } },
  Sollin:    { total: 831600, skills: { magic: 831600 } },
};

console.log("\n=== Per-Player XP/hr Comparison ===");
for (const cfg of playerConfigs) {
  const summary = simResult.computeSummary(cfg.hrid);
  const exp = expected[cfg.hrid];
  const pct = exp ? ((summary.totalXpPerHour / exp.total - 1) * 100).toFixed(1) : "N/A";

  console.log(`\n  ${cfg.hrid}:`);
  console.log(`    Total XP/hr: ${Math.round(summary.totalXpPerHour).toLocaleString()} (expected: ${exp?.total.toLocaleString() ?? "?"}, diff: ${pct}%)`);

  const skillNames = ["stamina", "intelligence", "attack", "defense", "melee", "ranged", "magic"] as const;
  for (const skill of skillNames) {
    const val = summary.xpPerHour[skill];
    if (val > 0) {
      const expVal = exp?.skills[skill];
      const skillPct = expVal ? ((val / expVal - 1) * 100).toFixed(1) : "";
      console.log(`    ${skill}: ${Math.round(val).toLocaleString()}${expVal ? ` (expected: ${expVal.toLocaleString()}, diff: ${skillPct}%)` : ""}`);
    }
  }

  console.log(`    DPS: ${summary.dps.toFixed(1)}, HPS: ${summary.hps.toFixed(1)}, Kills/hr: ${summary.killsPerHour.toFixed(1)}`);
}
