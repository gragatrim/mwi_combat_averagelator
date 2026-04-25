// Vitest test: parse full character data and run labyrinth with per-monster loadouts
// Usage: npx vitest run test_full_char_lab.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type { GameData, PlayerConfig } from "./src/engine/types";
import { parseFullCharacterData } from "./src/data/fullCharacterData";
import {
  buildCrateBuffs,
  findAllLabyrinthLevels,
  getLabyrinthMonsters,
  findMaxLabyrinthLevel,
} from "./src/features/labyrinthSimulator";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const fullCharJson = readFileSync(
  "live_data/gragatrim_full_char_data.json",
  "utf-8"
);

describe("Full Character Data + Labyrinth", () => {
  it("should parse full character data with combat loadouts", () => {
    const parsed = parseFullCharacterData(fullCharJson, gameData);

    expect(parsed.hrid).toBe("gragatrim");
    expect(parsed.combatLoadouts.length).toBe(10);

    // Check that each loadout has a valid PlayerConfig
    for (const loadout of parsed.combatLoadouts) {
      expect(loadout.id).toBeTruthy();
      expect(loadout.name).toBeTruthy();
      expect(loadout.config.hrid).toBe("gragatrim");
      expect(loadout.config.staminaLevel).toBeGreaterThan(1);
      expect(loadout.config.equipment).toBeDefined();
      expect(loadout.config.abilities).toBeDefined();
    }

    // Check labyrinth crate detection
    expect(parsed.labyrinthCrates.coffeeCrate).toBe(
      "/items/expert_coffee_crate"
    );
    expect(parsed.labyrinthCrates.foodCrate).toBe("/items/expert_food_crate");
  });

  it("should find labyrinth-specific loadouts by name", () => {
    const parsed = parseFullCharacterData(fullCharJson, gameData);
    const labLoadouts = parsed.combatLoadouts.filter((l) =>
      l.name.toLowerCase().includes("lab")
    );

    console.log(
      "Lab loadouts:",
      labLoadouts.map((l) => l.name)
    );
    expect(labLoadouts.length).toBeGreaterThanOrEqual(4);
  });

  it("should parse labyrinth per-monster loadout assignments", () => {
    const parsed = parseFullCharacterData(fullCharJson, gameData);
    const monsterLoadouts = parsed.labyrinthMonsterLoadouts;

    console.log("Labyrinth monster loadouts:", monsterLoadouts);

    // Should have assignments for labyrinth monsters
    const labMonsters = getLabyrinthMonsters(gameData);
    const assignedMonsters = Object.keys(monsterLoadouts);

    // Every assigned monster should be a valid labyrinth monster
    for (const monsterHrid of assignedMonsters) {
      expect(labMonsters).toContain(monsterHrid);
    }

    // All assignments should reference valid combat loadouts
    const loadoutIds = new Set(parsed.combatLoadouts.map((l) => l.id));
    for (const [monsterHrid, loadoutId] of Object.entries(monsterLoadouts)) {
      expect(loadoutIds.has(loadoutId)).toBe(true);
      const loadout = parsed.combatLoadouts.find((l) => l.id === loadoutId);
      console.log(
        `  ${monsterHrid.split("/").pop()} -> ${loadout?.name} (${loadoutId})`
      );
    }

    // Should have at least some assignments
    expect(assignedMonsters.length).toBeGreaterThan(0);
  });

  it("should run labyrinth with a single loadout", { timeout: 30_000 }, () => {
    const parsed = parseFullCharacterData(fullCharJson, gameData);
    const rangedLab = parsed.combatLoadouts.find((l) =>
      l.name.toLowerCase().includes("ranged lab")
    );
    expect(rangedLab).toBeTruthy();

    const crateBuffs = buildCrateBuffs("expert", "expert");
    const result = findMaxLabyrinthLevel(
      rangedLab!.config,
      "/monsters/cyclops",
      crateBuffs,
      0,
      gameData,
      300
    );

    console.log("Ranged lab vs cyclops:", result);
    expect(result.maxLevel).toBeGreaterThan(0);
  });

  it(
    "should run labyrinth with per-monster loadouts",
    { timeout: 120_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);
      const loadouts = parsed.combatLoadouts;
      const crateBuffs = buildCrateBuffs("expert", "expert");

      // Use first loadout as default
      const defaultConfig = loadouts[0].config;

      // Assign specific loadouts for some monsters
      const monsterLoadoutMap: Record<string, PlayerConfig> = {};
      const rangedLab = loadouts.find((l) =>
        l.name.toLowerCase().includes("ranged lab")
      );
      const fireLab = loadouts.find((l) =>
        l.name.toLowerCase().includes("fire lab")
      );

      if (rangedLab) {
        monsterLoadoutMap["/monsters/cyclops"] = rangedLab.config;
        monsterLoadoutMap["/monsters/giant_scorpion"] = rangedLab.config;
      }
      if (fireLab) {
        monsterLoadoutMap["/monsters/salamander"] = fireLab.config;
      }

      const results = findAllLabyrinthLevels(
        defaultConfig,
        crateBuffs,
        0,
        gameData,
        300,
        (p) =>
          process.stdout.write(
            `  ${p.monsterHrid.split("/").pop()}: level ${p.currentLevel}   \r`
          ),
        monsterLoadoutMap
      );

      console.log("\n\n=== Per-Monster Loadout Results ===");
      for (const r of results.sort((a, b) => b.maxLevel - a.maxLevel)) {
        const name = r.monsterHrid.split("/").pop();
        const killSec = (r.killTimeNs / 1e9).toFixed(1);
        const loadoutUsed = monsterLoadoutMap[r.monsterHrid]
          ? "override"
          : "default";
        console.log(
          `  ${name}: level ${r.maxLevel}, kill ${killSec}s (${loadoutUsed})`
        );
      }

      expect(results.length).toBe(10);
      const total = results.reduce((s, r) => s + r.maxLevel, 0);
      console.log(`  Total: ${total}`);
      expect(total).toBeGreaterThan(0);
    }
  );
});
