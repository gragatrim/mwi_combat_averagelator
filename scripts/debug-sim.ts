#!/usr/bin/env tsx
// Quick diagnostic script to run the deterministic sim from the command line.
// Usage: npx tsx scripts/debug-sim.ts

import { readFileSync } from "fs";

import type { GameData } from "../src/engine/types";
import Player from "../src/engine/player";
import Zone from "../src/engine/zone";
import Equipment from "../src/engine/equipment";
import Consumable from "../src/engine/consumable";
import Ability from "../src/engine/ability";
import DeterministicSimulator from "../src/engine/deterministicSimulator";
import { parsePlayerData } from "../src/data/playerData";

// Load game data
const gameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
) as GameData;

// Load player data
const playerDataRaw = JSON.parse(
  readFileSync(
    "/home/gragatrim/projects/mwi/mwi_combat_sim/MWICombatSimulatorTest/player_data.json",
    "utf-8"
  )
);

const playerConfig = parsePlayerData(
  JSON.stringify(playerDataRaw),
  gameData
);

console.log("=== Player Config ===");
console.log(`hrid: ${playerConfig.hrid}`);
console.log(`levels: sta=${playerConfig.staminaLevel} int=${playerConfig.intelligenceLevel} atk=${playerConfig.attackLevel} mel=${playerConfig.meleeLevel} def=${playerConfig.defenseLevel} rng=${playerConfig.rangedLevel} mag=${playerConfig.magicLevel}`);
console.log(
  `equipment: ${Object.entries(playerConfig.equipment)
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `${k.split("/").pop()}=${(v as any).hrid.split("/").pop()}+${(v as any).enhancementLevel}`
    )
    .join(", ")}`
);
console.log(`abilities: ${playerConfig.abilities.filter(a => a).map(a => (a as any).hrid.split("/").pop()).join(", ")}`);

// Build player deps
const deps = {
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

const player = Player.createFromDTO(playerConfig, gameData, deps);

// Test zone: Infernal Abyss T1
const zoneHrid = "/actions/combat/infernal_abyss";
const difficultyTier = 1;

console.log(`\n=== Simulation: ${zoneHrid} T${difficultyTier} ===`);

const zone = new Zone(zoneHrid, difficultyTier, gameData);
const simulator = new DeterministicSimulator([player], zone, gameData);
const simResult = simulator.simulate();

const summary = simResult.computeSummary(playerConfig.hrid);

console.log("\n=== Results ===");
console.log(`Total XP/hr: ${Math.round(summary.totalXpPerHour)}`);
console.log(`Kills/hr: ${summary.killsPerHour.toFixed(1)}`);
console.log(`DPS: ${summary.dps.toFixed(1)}`);
console.log(`HPS: ${summary.hps.toFixed(1)}`);
console.log(`Avg kill time: ${summary.avgKillTimeSec.toFixed(2)}s`);
console.log(`Uptime: ${(summary.uptimeRatio * 100).toFixed(1)}%`);
console.log(
  `XP/hr by skill: ${JSON.stringify(
    Object.fromEntries(
      Object.entries(summary.xpPerHour)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => [k, Math.round(v as number)])
    )
  )}`
);

// Check player combat stats
const cs = player.combatDetails.combatStats;
console.log("\n=== Player Combat Stats ===");
console.log(`combatExperience: ${cs.combatExperience.toFixed(4)}`);
console.log(`combatStyleHrid: ${cs.combatStyleHrid}`);
console.log(`primaryTraining: ${cs.primaryTraining}`);
console.log(`focusTraining: ${cs.focusTraining || "(none)"}`);
console.log(`attackInterval: ${cs.attackInterval}ns (${(cs.attackInterval / 1e9).toFixed(3)}s)`);

// Check deaths
const stats = simResult.playerStats[playerConfig.hrid];
if (stats) {
  const hoursElapsed = simResult.totalSimTimeNs / 3.6e12;
  console.log(`\nDeaths: ${stats.deaths}`);
  console.log(`Deaths/hr: ${(stats.deaths / hoursElapsed).toFixed(2)}`);
  console.log(
    `Dead time: ${(stats.totalDeadTimeNs / 1e9).toFixed(0)}s (${((stats.totalDeadTimeNs / simResult.totalSimTimeNs) * 100).toFixed(1)}%)`
  );
}
