// Diagnostic script to understand XP calculation gaps
// Usage: npx tsx test_xp_diag.ts

import { readFileSync } from "fs";
import { parsePlayerData } from "./src/data/playerData";
import type { GameData, PlayerConfig } from "./src/engine/types";
import Player from "./src/engine/player";
import Zone from "./src/engine/zone";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";
import DeterministicSimulator from "./src/engine/deterministicSimulator";
import Buff from "./src/engine/buff";

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

const deps = buildPlayerDeps(gameData);
const players = playerConfigs.map((cfg) =>
  Player.createFromDTO(cfg, gameData, deps)
);

// Apply per-player bonuses (same as test)
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

const communityBuffLevel = 10;
const communityWisdom = 0.2 + 0.005 * (communityBuffLevel - 1);

for (const player of players) {
  let wisdom = communityWisdom + 0.05; // MooPass 5%
  if (player.hrid === "gragatrim") {
    wisdom += 0.20; // Seal of Wisdom 20%
    player.extraBuffs = [
      makeSealBuff("/buff_types/cast_speed", 0.15, 0),
      makeSealBuff("/buff_types/damage", 0, 0.08),
      makeSealBuff("/buff_types/critical_rate", 0.10, 0),
      makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0),
    ];
  }
  player.wisdomBuffBonus = wisdom;
}

const zone = new Zone("/actions/combat/pirate_cove", 0, gameData);
const simulator = new DeterministicSimulator(players, zone, gameData);
const simResult = simulator.simulate();

// ── Diagnostic: Per-player XP multiplier breakdown ──────────────────────────
console.log("=== Per-Player XP Multiplier Breakdown ===\n");

for (const player of players) {
  const cs = player.combatDetails.combatStats;
  const wisdomBonus = player.wisdomBuffBonus;

  // This is the combatExpBonus as calculated in distributeExperience
  const combatExpBonus = 1 + cs.combatExperience + wisdomBonus;

  console.log(`${player.hrid}:`);
  console.log(`  combatExperience (from equipment+buffs): ${cs.combatExperience.toFixed(4)}`);
  console.log(`  wisdomBuffBonus (moopass+community+seal): ${wisdomBonus.toFixed(4)}`);
  console.log(`  combatExpBonus (1+above): ${combatExpBonus.toFixed(4)}`);
  console.log(`  attackExperience: ${(cs.attackExperience || 0).toFixed(4)}`);
  console.log(`  magicExperience: ${(cs.magicExperience || 0).toFixed(4)}`);
  console.log(`  rangedExperience: ${(cs.rangedExperience || 0).toFixed(4)}`);
  console.log(`  meleeExperience: ${(cs.meleeExperience || 0).toFixed(4)}`);
  console.log(`  defenseExperience: ${(cs.defenseExperience || 0).toFixed(4)}`);
  console.log(`  staminaExperience: ${(cs.staminaExperience || 0).toFixed(4)}`);
  console.log(`  intelligenceExperience: ${(cs.intelligenceExperience || 0).toFixed(4)}`);
  console.log(`  combatStyleHrid: ${cs.combatStyleHrid}`);
  console.log(`  primaryTraining: ${cs.primaryTraining}`);
  console.log(`  focusTraining: ${cs.focusTraining}`);
  console.log(`  attackInterval: ${(cs.attackInterval / 1e9).toFixed(3)}s`);

  // Check what the combat style's skillExpMap contains
  const styleDetail = gameData.combatStyleDetailMap[cs.combatStyleHrid];
  console.log(`  skillExpMap: ${JSON.stringify(styleDetail?.skillExpMap)}`);
  console.log();
}

// ── Diagnostic: Total XP breakdown ────────────────────────────────────────
const rawSimTime = simResult.totalSimTimeNs;
const hours = rawSimTime / 3.6e12;
const encounters = simResult.encounters;
const dungeonsCompleted = simResult.dungeonsCompleted;

console.log("=== Simulation Summary ===");
console.log(`Sim time: ${hours.toFixed(4)} hrs (${(rawSimTime/1e9).toFixed(0)}s)`);
console.log(`Encounters: ${encounters}`);
console.log(`Dungeons completed: ${dungeonsCompleted}`);
console.log(`Encounters per hour: ${(encounters/hours).toFixed(1)}`);
console.log(`Dungeons per hour: ${(dungeonsCompleted/hours).toFixed(2)}`);
console.log(`Avg encounter time: ${((rawSimTime/1e9)/encounters).toFixed(2)}s`);
console.log(`Time per dungeon: ${((rawSimTime/1e9)/dungeonsCompleted).toFixed(1)}s`);

// Expected values
const expected: Record<string, { total: number; skills: Record<string, number> }> = {
  gragatrim: { total: 937900, skills: { magic: 937900 } },
  Lisie:     { total: 869100, skills: { magic: 869100 } },
  qu:        { total: 788000, skills: { ranged: 788000 } },
  Skumbus:   { total: 785000, skills: { attack: 567300, magic: 217700 } },
  Sollin:    { total: 831600, skills: { magic: 831600 } },
};

console.log("\n=== Per-Player XP Comparison ===");
for (const player of players) {
  const summary = simResult.computeSummary(player.hrid);
  const exp = expected[player.hrid];
  const pct = exp ? ((summary.totalXpPerHour / exp.total - 1) * 100).toFixed(1) : "N/A";

  // Raw XP total accumulated
  const stats = simResult.playerStats[player.hrid];
  const totalRawXp = stats ? Object.values(stats.experienceGained).reduce((a, b) => a + b, 0) : 0;
  const xpPerEncounter = encounters > 0 ? totalRawXp / encounters : 0;

  console.log(`\n${player.hrid}: ${Math.round(summary.totalXpPerHour).toLocaleString()} XP/hr (expected: ${exp?.total.toLocaleString() ?? "?"}, diff: ${pct}%)`);
  console.log(`  Total raw XP: ${Math.round(totalRawXp).toLocaleString()}`);
  console.log(`  XP per encounter: ${xpPerEncounter.toFixed(1)}`);
  if (exp) {
    const expectedXpPerEnc = exp.total / (encounters / hours);
    console.log(`  Expected XP per encounter: ${expectedXpPerEnc.toFixed(1)}`);
    console.log(`  XP/encounter gap: ${((xpPerEncounter / expectedXpPerEnc - 1) * 100).toFixed(1)}%`);
  }
}

// ── Diagnostic: Theoretical XP calculation for first encounter ───────────
// Calculate what XP SHOULD be for a given encounter, manually
console.log("\n=== Theoretical XP Check ===");
// Average monster base XP across all wave compositions at tier 0
// For tier 0: multiplier = 1.0, bonus = 0
// experienceRate = 1 + aliveDuration / enrageTime

// Get encounter log stats
if (simResult.encounterLog.length > 0) {
  const avgKillTime = simResult.encounterLog.reduce((s, e) => s + e.killTimeNs, 0) / simResult.encounterLog.length;
  console.log(`Average kill time: ${(avgKillTime / 1e9).toFixed(2)}s`);

  // Check first few encounter kill times
  console.log("\nFirst 10 encounter kill times:");
  for (let i = 0; i < Math.min(10, simResult.encounterLog.length); i++) {
    const e = simResult.encounterLog[i];
    console.log(`  Wave ${i+1}: ${(e.killTimeNs / 1e9).toFixed(2)}s`);
  }
}

// Check a typical encounter: assume avg 4 regular monsters with avg 220 XP each
// at tier 0 (mult=1, bonus=0)
// experienceRate = 1 + killTime/180
// For 12s kill time: 1.067
// perPlayer = 4 * 220 * 1.067 / 5 = 187.7
// For gragatrim: adjustedXp = 187.7 * combatExpBonus * 1.0
// = 187.7 * 1.848 = 346.9
// With magicExperience: 346.9 * (1 + magicExp) = 346.9 * 1.X

// Calculate expected theoretical XP for gragatrim
const grag = players.find(p => p.hrid === "gragatrim")!;
const gragCS = grag.combatDetails.combatStats;
const gragWisdom = grag.wisdomBuffBonus;
const gragCombatExpBonus = 1 + gragCS.combatExperience + gragWisdom;
const gragMagicBonus = 1 + (gragCS.magicExperience || 0);

console.log(`\ngragatrim theoretical check:`);
console.log(`  combatExpBonus: ${gragCombatExpBonus.toFixed(4)}`);
console.log(`  magicExperience bonus: ${gragMagicBonus.toFixed(4)}`);
console.log(`  For a 4-monster wave with avg 220 base XP, 12s kill time:`);
const baseXp4 = 4 * 220 * (1 + 12/180);
console.log(`    Total monster XP: ${baseXp4.toFixed(1)}`);
const perPlayer = baseXp4 / 5;
console.log(`    Per-player (div by 5): ${perPlayer.toFixed(1)}`);
const adjusted = perPlayer * gragCombatExpBonus;
console.log(`    After combatExpBonus: ${adjusted.toFixed(1)}`);
const final = adjusted * gragMagicBonus;
console.log(`    After magic skill bonus: ${final.toFixed(1)}`);
console.log(`    Per hour (if 283 enc/hr): ${(final * 283).toFixed(0)}`);
