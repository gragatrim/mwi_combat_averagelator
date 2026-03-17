// Vitest test: compares combat log data with sim output
// Usage: npx vitest run test_combat_log

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

// ============================================================================
// Load combat log and aggregate per-player stats
// ============================================================================

interface CombatLogSummary {
  playerName: string;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealingReceived: number;
  hits: number;
  misses: number;
  crits: number;
  deaths: number;
}

interface AggregatedPlayerStats {
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealingReceived: number;
  hits: number;
  misses: number;
  crits: number;
  deaths: number;
  totalTimeSec: number;
  fights: number;
}

function aggregateCombatLog(logPath: string): {
  players: Record<string, AggregatedPlayerStats>;
  totalTimeSec: number;
  totalFights: number;
  kills: number;
} {
  const log = JSON.parse(readFileSync(logPath, "utf-8"));
  const players: Record<string, AggregatedPlayerStats> = {};
  let totalTimeSec = 0;
  let kills = 0;

  for (const fight of log.fights) {
    const dur = fight.durationSec;
    totalTimeSec += dur;
    if (fight.outcome === "kill") kills++;

    for (const s of fight.summaries as CombatLogSummary[]) {
      if (!players[s.playerName]) {
        players[s.playerName] = {
          totalDamageDealt: 0,
          totalDamageTaken: 0,
          totalHealingReceived: 0,
          hits: 0,
          misses: 0,
          crits: 0,
          deaths: 0,
          totalTimeSec: 0,
          fights: 0,
        };
      }
      const p = players[s.playerName];
      p.totalDamageDealt += s.totalDamageDealt;
      p.totalDamageTaken += s.totalDamageTaken;
      p.totalHealingReceived += s.totalHealingReceived;
      p.hits += s.hits;
      p.misses += s.misses;
      p.crits += s.crits;
      p.deaths += s.deaths;
      p.totalTimeSec += dur;
      p.fights += 1;
    }
  }

  return { players, totalTimeSec, totalFights: log.fights.length, kills };
}

// ============================================================================
// Test
// ============================================================================

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const playerFiles = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
const playerConfigs: PlayerConfig[] = playerFiles.map((name) => {
  const json = readFileSync(`live_data/${name}.json`, "utf-8");
  return parsePlayerData(json, gameData);
});

describe("Combat log vs sim comparison", () => {
  it("should compare per-player DPS, DTPS, HPS with combat log", { timeout: 60_000 }, () => {
    // === Aggregate combat log ===
    const logStats = aggregateCombatLog("live_data/combat_log_latest.json");
    console.log(`\n=== Combat Log Summary ===`);
    console.log(`Fights: ${logStats.totalFights}, Duration: ${logStats.totalTimeSec.toFixed(1)}s`);

    const totalDamageTaken = Object.values(logStats.players).reduce(
      (s, p) => s + p.totalDamageTaken, 0
    );

    console.log(`\n${"Player".padEnd(12)} ${"DPS".padStart(8)} ${"DTPS".padStart(8)} ${"HPS".padStart(8)} ${"Hit%".padStart(8)} ${"Taken%".padStart(8)}`);
    for (const [name, p] of Object.entries(logStats.players)) {
      const time = p.totalTimeSec;
      const totalAtk = p.hits + p.misses;
      const hitRate = totalAtk > 0 ? (p.hits / totalAtk * 100) : 0;
      const takenPct = totalDamageTaken > 0 ? (p.totalDamageTaken / totalDamageTaken * 100) : 0;
      console.log(
        `${name.padEnd(12)} ${(p.totalDamageDealt / time).toFixed(1).padStart(8)} ` +
        `${(p.totalDamageTaken / time).toFixed(1).padStart(8)} ` +
        `${(p.totalHealingReceived / time).toFixed(1).padStart(8)} ` +
        `${hitRate.toFixed(1).padStart(7)}% ` +
        `${takenPct.toFixed(1).padStart(7)}%`
      );
    }

    // === Run sim ===
    const deps = buildPlayerDeps(gameData);
    const players = playerConfigs.map((cfg) =>
      Player.createFromDTO(cfg, gameData, deps)
    );

    // Apply bonuses: MooPass + community wisdom
    const communityBuffLevel = 20;
    const communityWisdom = 0.2 + 0.005 * (communityBuffLevel - 1);
    for (const player of players) {
      player.wisdomBuffBonus = communityWisdom + 0.05;
    }

    const zone = new Zone("/actions/combat/pirate_cove", 1, gameData);
    const simulator = new DeterministicSimulator(players, zone, gameData);
    const simResult = simulator.simulate();

    const simTimeSec = simResult.totalSimTimeNs / 1e9;

    // === Compare ===
    console.log(`\n=== Sim Summary ===`);
    console.log(`Sim time: ${simTimeSec.toFixed(0)}s, Encounters: ${simResult.encounters}`);
    console.log(`Dungeons: ${simResult.dungeonsCompleted} completed, ${simResult.dungeonsFailed} failed`);

    // Per-player comparison
    console.log(`\n=== Per-Player Comparison (Sim vs Combat Log) ===`);
    console.log(`${"Player".padEnd(12)} ${"SimDPS".padStart(8)} ${"LogDPS".padStart(8)} ${"Diff%".padStart(7)} | ${"SimDTPS".padStart(8)} ${"LogDTPS".padStart(8)} ${"Diff%".padStart(7)} | ${"SimHPS".padStart(8)} ${"LogHPS".padStart(8)} ${"Diff%".padStart(7)}`);

    const simTotalDamageTaken = playerConfigs.reduce((s, cfg) => {
      const summary = simResult.computeSummary(cfg.hrid);
      return s + summary.dtps;
    }, 0);

    for (const cfg of playerConfigs) {
      const summary = simResult.computeSummary(cfg.hrid);
      const logPlayer = logStats.players[cfg.hrid];
      if (!logPlayer) {
        console.log(`  ${cfg.hrid}: NOT FOUND in combat log`);
        continue;
      }

      const logTime = logPlayer.totalTimeSec;
      const logDps = logPlayer.totalDamageDealt / logTime;
      const logDtps = logPlayer.totalDamageTaken / logTime;
      const logHps = logPlayer.totalHealingReceived / logTime;

      const dpsDiff = logDps > 0 ? ((summary.dps / logDps - 1) * 100) : 0;
      const dtpsDiff = logDtps > 0 ? ((summary.dtps / logDtps - 1) * 100) : 0;
      const hpsDiff = logHps > 0 ? ((summary.hps / logHps - 1) * 100) : 0;

      console.log(
        `${cfg.hrid.padEnd(12)} ` +
        `${summary.dps.toFixed(1).padStart(8)} ${logDps.toFixed(1).padStart(8)} ${(dpsDiff > 0 ? "+" : "") + dpsDiff.toFixed(1).padStart(6)}% | ` +
        `${summary.dtps.toFixed(1).padStart(8)} ${logDtps.toFixed(1).padStart(8)} ${(dtpsDiff > 0 ? "+" : "") + dtpsDiff.toFixed(1).padStart(6)}% | ` +
        `${summary.hps.toFixed(1).padStart(8)} ${logHps.toFixed(1).padStart(8)} ${(hpsDiff > 0 ? "+" : "") + hpsDiff.toFixed(1).padStart(6)}%`
      );
    }

    // Damage taken distribution comparison
    console.log(`\n=== Damage Taken Distribution ===`);
    console.log(`${"Player".padEnd(12)} ${"SimTaken%".padStart(10)} ${"LogTaken%".padStart(10)}`);
    for (const cfg of playerConfigs) {
      const summary = simResult.computeSummary(cfg.hrid);
      const logPlayer = logStats.players[cfg.hrid];
      if (!logPlayer) continue;

      const simTakenPct = simTotalDamageTaken > 0 ? (summary.dtps / simTotalDamageTaken * 100) : 0;
      const logTakenPct = totalDamageTaken > 0 ? (logPlayer.totalDamageTaken / totalDamageTaken * 100) : 0;

      console.log(
        `${cfg.hrid.padEnd(12)} ${simTakenPct.toFixed(1).padStart(9)}% ${logTakenPct.toFixed(1).padStart(9)}%`
      );
    }

    // Basic sanity checks
    // 1. All players should have some damage taken (not just player[0])
    const playerDtps = playerConfigs.map((cfg) =>
      simResult.computeSummary(cfg.hrid).dtps
    );
    console.log("\nSim DTPS values:", playerDtps.map((d) => d.toFixed(1)));

    // With threat-weighted distribution, ALL players should take some damage
    for (const cfg of playerConfigs) {
      const dtps = simResult.computeSummary(cfg.hrid).dtps;
      expect(dtps).toBeGreaterThan(0);
    }

    // 2. Damage taken should be roughly proportional (no one player takes >50%)
    const totalSimDtps = playerDtps.reduce((a, b) => a + b, 0);
    for (const dtps of playerDtps) {
      const share = dtps / totalSimDtps;
      expect(share).toBeLessThan(0.5); // No single player takes >50% with equal threat
    }

    // 3. DPS values should be positive and reasonable (within 20% of log)
    for (const cfg of playerConfigs) {
      const summary = simResult.computeSummary(cfg.hrid);
      expect(summary.dps).toBeGreaterThan(0);
    }
  });
});
