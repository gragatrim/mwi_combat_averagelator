// Vitest test: loads 5 live_data player JSONs and runs the dungeon simulation
// Usage: npx vitest run test_live_data.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parsePlayerData } from "./src/data/playerData";
import type { GameData, PlayerConfig } from "./src/engine/types";
import Player from "./src/engine/player";
import Zone from "./src/engine/zone";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";
import DeterministicSimulator from "./src/engine/deterministicSimulator";

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

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const playerFiles = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
const playerConfigs: PlayerConfig[] = playerFiles.map((name) => {
  const json = readFileSync(`live_data/${name}.json`, "utf-8");
  return parsePlayerData(json, gameData);
});

// Expected XP values from screenshots
const expected: Record<string, { total: number; skills: Record<string, number> }> = {
  gragatrim: { total: 814500, skills: { magic: 814500 } },
  Lisie:     { total: 844900, skills: { magic: 844900 } },
  qu:        { total: 767000, skills: { ranged: 767000 } },
  Skumbus:   { total: 738500, skills: { attack: 533700, magic: 204800 } },
  Sollin:    { total: 808200, skills: { magic: 808200 } },
};

describe("Live data validation", () => {
  it("should parse unique player HRIDs from name field", () => {
    const hrids = playerConfigs.map((c) => c.hrid);
    console.log("Player HRIDs:", hrids);
    expect(hrids).toEqual(["gragatrim", "Lisie", "qu", "Skumbus", "Sollin"]);
  });

  it("should simulate the party and produce per-player XP", { timeout: 60_000 }, () => {
    const deps = buildPlayerDeps(gameData);
    const players = playerConfigs.map((cfg) =>
      Player.createFromDTO(cfg, gameData, deps)
    );

    // Log player combat details
    for (const p of players) {
      const cs = p.combatDetails.combatStats;
      console.log(`${p.hrid}: weapon=${cs.combatStyleHrid}, primary=${cs.primaryTraining}, focus=${cs.focusTraining}, combatExp=${(cs.combatExperience * 100).toFixed(1)}%`);
    }

    // Apply per-player bonuses: MooPass + community wisdom for everyone
    const communityBuffLevel = 20; // Confirmed from full char data: all community buffs at level 20
    const communityWisdom = 0.2 + 0.005 * (communityBuffLevel - 1); // 29.5%

    for (const player of players) {
      // MooPass + community for everyone, no seals
      player.wisdomBuffBonus = communityWisdom + 0.05; // MooPass 5%
    }

    const zone = new Zone("/actions/combat/pirate_cove", 1, gameData);
    console.log(`Zone isDungeon: ${zone.isDungeon}`);

    const simulator = new DeterministicSimulator(players, zone, gameData);
    const simResult = simulator.simulate();

    // Log post-sim XP multiplier breakdown for each player
    console.log("\nPost-sim XP multiplier breakdown:");
    for (const p of players) {
      const cs = p.combatDetails.combatStats;
      const wb = p.wisdomBuffBonus;
      const combatExpBonus = 1 + cs.combatExperience + wb;
      console.log(`  ${p.hrid}: combatExp=${cs.combatExperience.toFixed(4)} wisdom=${wb.toFixed(4)} combatExpBonus=${combatExpBonus.toFixed(4)}`);
      console.log(`    attackExp=${(cs.attackExperience||0).toFixed(4)} magicExp=${(cs.magicExperience||0).toFixed(4)} rangedExp=${(cs.rangedExperience||0).toFixed(4)} meleeExp=${(cs.meleeExperience||0).toFixed(4)}`);
      console.log(`    style=${cs.combatStyleHrid} primary=${cs.primaryTraining} focus=${cs.focusTraining} atkInterval=${(cs.attackInterval/1e9).toFixed(3)}s`);
    }

    const rawSimTime = simResult.totalSimTimeNs;
    console.log(`Sim time: ${(rawSimTime / 3.6e12).toFixed(2)} hrs (${(rawSimTime / 1e9).toFixed(0)}s)`);
    console.log(`Expected dungeon rate: ~4.5/hr, Sim rate: ${(simResult.dungeonsCompleted / (rawSimTime / 3.6e12)).toFixed(2)}/hr`);
    console.log(`Time per dungeon: ${((rawSimTime / 1e9) / simResult.dungeonsCompleted).toFixed(0)}s (expected: ~800s)`);

    // Log player attack intervals
    for (const p of players) {
      const cs = p.combatDetails.combatStats;
      console.log(`  ${p.hrid}: attackInterval=${(cs.attackInterval / 1e9).toFixed(2)}s`);
    }
    console.log(`Encounters: ${simResult.encounters}`);
    console.log(`Dungeons completed: ${simResult.dungeonsCompleted}, failed: ${simResult.dungeonsFailed}`);
    console.log(`Player stats keys: ${Object.keys(simResult.playerStats).join(", ")}`);

    // Verify we have separate stats for each player (may also include monster entries)
    const statKeys = Object.keys(simResult.playerStats);
    console.log(`All stat keys (${statKeys.length}): ${statKeys.join(", ")}`);
    expect(statKeys).toContain("gragatrim");
    expect(statKeys).toContain("Lisie");
    expect(statKeys).toContain("qu");
    expect(statKeys).toContain("Skumbus");
    expect(statKeys).toContain("Sollin");

    // Per-encounter XP check
    const hours = rawSimTime / 3.6e12;
    const encPerHr = simResult.encounters / hours;
    console.log(`\nEncounters/hr: ${encPerHr.toFixed(1)}`);

    // Average kill time from encounter log
    if (simResult.encounterLog.length > 0) {
      const avgKillTime = simResult.encounterLog.reduce((s, e) => s + e.killTimeNs, 0) / simResult.encounterLog.length;
      console.log(`Avg kill time: ${(avgKillTime / 1e9).toFixed(2)}s`);

      // First 5 and last 5 encounter kill times
      const n = simResult.encounterLog.length;
      console.log("First 5 kill times: " + simResult.encounterLog.slice(0, 5).map(e => (e.killTimeNs/1e9).toFixed(1) + "s").join(", "));
      if (n > 5) console.log("Last 5 kill times: " + simResult.encounterLog.slice(n-5).map(e => (e.killTimeNs/1e9).toFixed(1) + "s").join(", "));
    }

    // Print per-player XP comparison
    console.log("\n=== Per-Player XP/hr Comparison ===");
    for (const cfg of playerConfigs) {
      const summary = simResult.computeSummary(cfg.hrid);
      const exp = expected[cfg.hrid];
      const pct = exp ? ((summary.totalXpPerHour / exp.total - 1) * 100).toFixed(1) : "N/A";

      // Raw XP per encounter
      const stats = simResult.playerStats[cfg.hrid];
      const totalRawXp = stats ? Object.values(stats.experienceGained).reduce((a: number, b: number) => a + b, 0) : 0;
      const xpPerEnc = simResult.encounters > 0 ? totalRawXp / simResult.encounters : 0;

      console.log(`\n  ${cfg.hrid}:`);
      console.log(`    Total XP/hr: ${Math.round(summary.totalXpPerHour).toLocaleString()} (expected: ${exp?.total.toLocaleString() ?? "?"}, diff: ${pct}%)`);
      console.log(`    XP/encounter: ${xpPerEnc.toFixed(1)}`);

      const skillNames = ["stamina", "intelligence", "attack", "defense", "melee", "ranged", "magic"] as const;
      for (const skill of skillNames) {
        const val = summary.xpPerHour[skill];
        if (val > 0) {
          const expVal = exp?.skills[skill];
          const skillPct = expVal ? ((val / expVal - 1) * 100).toFixed(1) : "";
          console.log(`    ${skill}: ${Math.round(val).toLocaleString()}${expVal ? ` (expected: ${expVal.toLocaleString()}, diff: ${skillPct}%)` : ""}`);
        }
      }
      const overkillPct = stats && stats.totalPreClampDamageDealt > 0
        ? ((1 - stats.totalDamageDealt / stats.totalPreClampDamageDealt) * 100).toFixed(1)
        : "0.0";
      console.log(`    DPS(postClamp): ${summary.dps.toFixed(1)}, DPS(preClamp): ${summary.preClampDps.toFixed(1)}, overkill: ${overkillPct}%, HPS: ${summary.hps.toFixed(1)}, Kills/hr: ${summary.killsPerHour.toFixed(1)}`);
    }

    // Verify all players have different XP (the main bug fix)
    const totalXps = playerConfigs.map((cfg) =>
      simResult.computeSummary(cfg.hrid).totalXpPerHour
    );
    console.log("\nTotal XP/hr values:", totalXps.map(Math.round));

    // Not all the same (the bug was that they were all identical)
    const uniqueXps = new Set(totalXps.map((x) => Math.round(x)));
    expect(uniqueXps.size).toBeGreaterThan(1);
  });
});
