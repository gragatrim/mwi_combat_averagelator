// Vitest test: validate labyrinth simulator with live player data
// Usage: npx vitest run test_labyrinth.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parsePlayerData } from "./src/data/playerData";
import type { GameData } from "./src/engine/types";
import {
  buildCrateBuffs,
  simulateLabyrinthFight,
  findMaxLabyrinthLevel,
  getLabyrinthMonsters,
  findAllLabyrinthLevels,
  normalCDF,
  inverseNormalCDF,
  computeAdjustedTimeLimit,
  computeClearRate,
  computeAdjustedLevel,
  computeLevelBasedClearRate,
} from "./src/features/labyrinthSimulator";
import Buff from "./src/engine/buff";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const playerJson = readFileSync("live_data/gragatrim.json", "utf-8");
const playerConfig = parsePlayerData(playerJson, gameData);

describe("Labyrinth Simulator", () => {
  it("should list all labyrinth monsters", () => {
    const monsters = getLabyrinthMonsters(gameData);
    console.log("Labyrinth monsters:", monsters.map((m) => m.split("/").pop()));
    expect(monsters.length).toBe(10);
    expect(monsters).toContain("/monsters/cyclops");
    expect(monsters).toContain("/monsters/mimic");
  });

  it("should build crate buffs correctly", () => {
    const none = buildCrateBuffs("none", "none");
    expect(none.length).toBe(0);

    const basicCoffee = buildCrateBuffs("basic", "none");
    expect(basicCoffee.length).toBe(9); // 7 level buffs + attack speed + cast speed
    const staminaBuff = basicCoffee.find(
      (b) => b.typeHrid === "/buff_types/stamina_level"
    );
    expect(staminaBuff?.flatBoost).toBe(5);

    const expertBoth = buildCrateBuffs("expert", "expert");
    expect(expertBoth.length).toBe(13); // 11 coffee + 2 food

    const foodBasic = buildCrateBuffs("none", "basic");
    expect(foodBasic.length).toBe(2);
    const hpRegen = foodBasic.find(
      (b) => b.typeHrid === "/buff_types/hp_regen"
    );
    expect(hpRegen?.flatBoost).toBe(0.02);
  });

  it("should win a fight at level 1", () => {
    const result = simulateLabyrinthFight(
      playerConfig,
      "/monsters/cyclops",
      1,
      [],
      [],
      0,
      gameData
    );
    console.log("Level 1 cyclops:", result);
    expect(result.success).toBe(true);
    expect(result.killTimeNs).toBeGreaterThan(0);
    expect(result.killTimeNs).toBeLessThan(120e9);
  });

  it("should lose a fight at level 999", () => {
    const result = simulateLabyrinthFight(
      playerConfig,
      "/monsters/cyclops",
      999,
      [],
      [],
      0,
      gameData
    );
    console.log("Level 999 cyclops:", result);
    expect(result.success).toBe(false);
  });

  it("should find max level for a single monster via binary search", { timeout: 60_000 }, () => {
    const result = findMaxLabyrinthLevel(
      playerConfig,
      "/monsters/cyclops",
      [],
      [],
      0,
      gameData,
      300,
      (level) => process.stdout.write(`  cyclops: testing level ${level}\r`)
    );
    console.log("\nMax cyclops level:", result);
    expect(result.maxLevel).toBeGreaterThan(0);
    expect(result.maxLevel).toBeLessThanOrEqual(300);
    expect(result.killTimeNs).toBeGreaterThan(0);
  });

  it("should find max levels for all monsters", { timeout: 300_000 }, () => {
    // Use expert coffee crate for a reasonable test
    const crateBuffs = buildCrateBuffs("expert", "expert");

    const results = findAllLabyrinthLevels(
      playerConfig,
      crateBuffs,
      [],
      0,
      gameData,
      300,
      (p) => process.stdout.write(`  ${p.monsterHrid.split("/").pop()}: level ${p.currentLevel}   \r`)
    );

    console.log("\n\n=== All Labyrinth Results (Expert Crates) ===");
    for (const r of results.sort((a, b) => b.maxLevel - a.maxLevel)) {
      const name = r.monsterHrid.split("/").pop();
      const killSec = (r.killTimeNs / 1e9).toFixed(1);
      console.log(`  ${name}: level ${r.maxLevel}, kill time ${killSec}s`);
    }

    expect(results.length).toBe(10);
    for (const r of results) {
      expect(r.maxLevel).toBeGreaterThanOrEqual(0);
      expect(r.estimatedClearRate).toBeGreaterThanOrEqual(0);
      expect(r.estimatedClearRate).toBeLessThanOrEqual(1);
    }
  });

  it("should compute normal distribution utilities correctly", () => {
    // normalCDF at z=0 should be 0.5
    expect(normalCDF(0)).toBeCloseTo(0.5, 5);
    // normalCDF at z=-8 should be ~0
    expect(normalCDF(-8)).toBeCloseTo(0, 5);
    // normalCDF at z=8 should be ~1
    expect(normalCDF(8)).toBeCloseTo(1, 5);
    // normalCDF(1.282) ≈ 0.9
    expect(normalCDF(1.282)).toBeCloseTo(0.9, 2);
    // normalCDF(1.645) ≈ 0.95
    expect(normalCDF(1.645)).toBeCloseTo(0.95, 2);

    // inverseNormalCDF should round-trip with normalCDF
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
      const z = inverseNormalCDF(p);
      expect(normalCDF(z)).toBeCloseTo(p, 4);
    }

    // computeAdjustedTimeLimit at 50% should equal 120s (z=0)
    expect(computeAdjustedTimeLimit(0.5)).toBeCloseTo(120e9, -6);
    // At 90%, effective limit should be ~106.4s
    expect(computeAdjustedTimeLimit(0.9) / 1e9).toBeCloseTo(106.4, 0);
    // At 95%, effective limit should be ~103.0s
    expect(computeAdjustedTimeLimit(0.95) / 1e9).toBeCloseTo(103.0, 0);
  });

  it("should compute clear rate from kill time", () => {
    // Kill time exactly at 120s → 50% clear rate
    expect(computeClearRate(120e9)).toBeCloseTo(0.5, 2);
    // Kill time well under limit → high clear rate
    expect(computeClearRate(60e9)).toBeGreaterThan(0.99);
    // Kill time over limit → low clear rate (150s, z=-2 → ~2.3%)
    expect(computeClearRate(150e9)).toBeLessThan(0.05);
    // Zero kill time → 0% (monster not killed)
    expect(computeClearRate(0)).toBe(0);
  });

  it("should find lower max levels at higher success rates", { timeout: 120_000 }, () => {
    const crateBuffs = buildCrateBuffs("expert", "expert");

    const result50 = findMaxLabyrinthLevel(
      playerConfig,
      "/monsters/cyclops",
      crateBuffs,
      [],
      0,
      gameData,
      300,
      undefined,
      0.5
    );

    const result90 = findMaxLabyrinthLevel(
      playerConfig,
      "/monsters/cyclops",
      crateBuffs,
      [],
      0,
      gameData,
      300,
      undefined,
      0.9
    );

    console.log(`Cyclops at 50% clear rate: level ${result50.maxLevel} (raw: ${result50.rawMaxLevel}), kill ${(result50.killTimeNs / 1e9).toFixed(1)}s`);
    console.log(`Cyclops at 90% clear rate: level ${result90.maxLevel} (raw: ${result90.rawMaxLevel}), kill ${(result90.killTimeNs / 1e9).toFixed(1)}s`);

    // Both should have the same raw max level (binary search uses full 120s)
    expect(result50.rawMaxLevel).toBe(result90.rawMaxLevel);

    // 90% target should produce a meaningfully lower adjusted level than 50%
    expect(result90.maxLevel).toBeLessThan(result50.maxLevel);

    // The difference should be roughly ~6% of the raw max
    const expectedDiff = Math.floor(result50.rawMaxLevel * 0.05);
    expect(result50.maxLevel - result90.maxLevel).toBeGreaterThanOrEqual(expectedDiff);
  });

  it("should compute adjusted level correctly", () => {
    // At 50% success rate, adjusted level equals raw max (z=0)
    expect(computeAdjustedLevel(200, 0.5)).toBe(200);

    // At higher success rates, level should be lower
    expect(computeAdjustedLevel(200, 0.75)).toBeLessThan(200);
    expect(computeAdjustedLevel(200, 0.9)).toBeLessThan(computeAdjustedLevel(200, 0.75));
    expect(computeAdjustedLevel(200, 0.95)).toBeLessThan(computeAdjustedLevel(200, 0.9));
    expect(computeAdjustedLevel(200, 0.99)).toBeLessThan(computeAdjustedLevel(200, 0.95));

    // Specific expected values with CV=0.05:
    // 75%: floor(200 / (1 + 0.6745*0.05)) = floor(200/1.0337) = 193
    // 90%: floor(200 / (1 + 1.2816*0.05)) = floor(200/1.0641) = 187
    // 95%: floor(200 / (1 + 1.6449*0.05)) = floor(200/1.0822) = 184
    // 99%: floor(200 / (1 + 2.3263*0.05)) = floor(200/1.1163) = 179
    expect(computeAdjustedLevel(200, 0.75)).toBeCloseTo(193, 0);
    expect(computeAdjustedLevel(200, 0.9)).toBeCloseTo(187, 0);
    expect(computeAdjustedLevel(200, 0.95)).toBeCloseTo(184, 0);
    expect(computeAdjustedLevel(200, 0.99)).toBeCloseTo(179, 0);

    // Zero/negative levels
    expect(computeAdjustedLevel(0, 0.9)).toBe(0);
  });

  it("should compute level-based clear rate correctly", () => {
    // At the raw max level, clear rate should be 50%
    expect(computeLevelBasedClearRate(200, 200)).toBeCloseTo(0.5, 2);

    // Below raw max, clear rate should be > 50%
    expect(computeLevelBasedClearRate(190, 200)).toBeGreaterThan(0.5);

    // Well below raw max, clear rate should approach 1
    expect(computeLevelBasedClearRate(150, 200)).toBeGreaterThan(0.99);

    // Zero levels
    expect(computeLevelBasedClearRate(0, 200)).toBe(0);
  });
});
