#!/usr/bin/env tsx
import { readFileSync } from "fs";
import type { GameData } from "../src/engine/types";
import { parseFullCharacterData } from "../src/data/fullCharacterData";
import { optimizeLabyrinthLoadouts } from "../src/optimizer/labyrinthOptimizer";
import { buildCrateBuffs } from "../src/features/labyrinthSimulator";

const gameData = JSON.parse(readFileSync("public/init_client_data.json", "utf-8")) as GameData;
const charData = parseFullCharacterData(readFileSync("live_data/houston.json", "utf-8"), gameData);

console.log("Character:", charData.hrid);

// Check owned special abilities
const specials = [...charData.abilityLevels.entries()].filter(([h]) => 
  gameData.abilityDetailMap[h]?.isSpecialAbility
);
console.log("Special abilities owned:", specials.map(([h, l]) => h.split("/").pop() + " Lv" + l).join(", ") || "NONE");

const crateBuffs = buildCrateBuffs("expert", "expert");
const monsterOverrides: Record<string, string> = {};
for (const [mh, lid] of Object.entries(charData.labyrinthMonsterLoadouts)) {
  monsterOverrides[mh] = lid;
}

console.log("\nRunning optimizer: owned gear, best abilities, Giant Scorpion...\n");

const result = optimizeLabyrinthLoadouts(
  charData,
  charData.combatLoadouts[0].id,
  monsterOverrides,
  crateBuffs,
  [], 0, gameData, 0.5,
  (p) => {
    if (p.detail) process.stderr.write(`  ${p.monsterHrid.split("/").pop()}: ${p.detail}\r\n`);
  },
  "owned",
  true,  // useBestAbilities
  "/monsters/giant_scorpion"
);

console.log("\n=== RESULT ===");
for (const entry of result.monsterResults) {
  if (entry.monsterHrid !== "/monsters/giant_scorpion") continue;
  console.log(`Monster: ${entry.monsterHrid}`);
  console.log(`Baseline: ${entry.baselineLevel}, Optimized: ${entry.optimizedLevel}`);
  if (entry.optimizedConfig) {
    const abilities = entry.optimizedConfig.abilities.filter((a: any) => a).map((a: any) => a.hrid.split("/").pop() + " Lv" + a.level);
    console.log(`Abilities: ${abilities.join(", ")}`);
    console.log(`Special: ${entry.optimizedConfig.specialAbility?.hrid?.split("/").pop() ?? "*** NONE ***"} ${entry.optimizedConfig.specialAbility ? "Lv" + entry.optimizedConfig.specialAbility.level : ""}`);
    const w = entry.optimizedConfig.equipment["/equipment_types/main_hand"] || entry.optimizedConfig.equipment["/equipment_types/two_hand"];
    console.log(`Weapon: ${w?.hrid?.split("/").pop()}`);
  }
}
console.log(`Sim runs: ${result.totalSimRuns}`);
