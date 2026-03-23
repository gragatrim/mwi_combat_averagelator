#!/usr/bin/env tsx
// =============================================================================
// Debug script: Mimic damage calculation analysis
// =============================================================================
// Usage: npx tsx scripts/debug-mimic-damage.ts

import { readFileSync } from "fs";
import type { GameData, PlayerConfig } from "../src/engine/types";
import {
  parseFullCharacterData,
  type CombatLoadout,
} from "../src/data/fullCharacterData";
import {
  buildCrateBuffs,
  simulateLabyrinthFight,
  type CrateTier,
} from "../src/features/labyrinthSimulator";
import Player from "../src/engine/player";
import Monster from "../src/engine/monster";
import Equipment from "../src/engine/equipment";
import Consumable from "../src/engine/consumable";
import Ability from "../src/engine/ability";
import Buff from "../src/engine/buff";
import { processAttack } from "../src/engine/combatUtilities";
import { DEFENSE_SCALING_FACTOR } from "../src/engine/constants";

// Load game data
const gameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
) as GameData;

// Load character data
const charJson = readFileSync("live_data/gragatrim_full_char_data.json", "utf-8");
const charData = parseFullCharacterData(charJson, gameData);

// Detect crate tiers
function detectCrateTier(itemHrid: string): CrateTier {
  if (!itemHrid) return "none";
  if (itemHrid.includes("expert")) return "expert";
  if (itemHrid.includes("advanced")) return "advanced";
  if (itemHrid.includes("basic")) return "basic";
  return "none";
}

const coffeeTier = detectCrateTier(charData.labyrinthCrates.coffeeCrate);
const foodTier = detectCrateTier(charData.labyrinthCrates.foodCrate);
const crateBuffs = buildCrateBuffs(coffeeTier, foodTier);

// Find mimic loadout
const loadoutById = new Map<string, CombatLoadout>();
for (const loadout of charData.combatLoadouts) {
  loadoutById.set(loadout.id, loadout);
}

const mimicLoadoutId = charData.labyrinthMonsterLoadouts["/monsters/mimic"];
const mimicLoadout = mimicLoadoutId ? loadoutById.get(mimicLoadoutId) : null;
const playerConfig = mimicLoadout?.config ?? charData.combatLoadouts[0]?.config;

if (!playerConfig) {
  console.error("No player config found!");
  process.exit(1);
}

console.log(`Using loadout: ${mimicLoadout?.name ?? "default"} (id: ${mimicLoadoutId})`);
console.log(`Crates: coffee=${coffeeTier}, food=${foodTier}`);

// =============================================================================
// Detailed monster stats analysis
// =============================================================================

const MONSTER_HRID = "/monsters/mimic";
const TARGET_LEVEL = 278;

const gameMonster = gameData.combatMonsterDetailMap[MONSTER_HRID];
const scaleFactor = TARGET_LEVEL / 100;

console.log(`\n${"=".repeat(60)}`);
console.log(`=== Level ${TARGET_LEVEL} Mimic Debug ===`);
console.log(`${"=".repeat(60)}`);

console.log(`\nBase Stats (from game data):`);
console.log(`  defenseLevel: ${gameMonster.combatDetails.defenseLevel}`);
console.log(`  attackLevel: ${gameMonster.combatDetails.attackLevel}`);
console.log(`  staminaLevel: ${gameMonster.combatDetails.staminaLevel}`);
console.log(`  armor: ${gameMonster.combatDetails.combatStats.armor}`);
console.log(`  waterResistance: ${gameMonster.combatDetails.combatStats.waterResistance}`);
console.log(`  natureResistance: ${gameMonster.combatDetails.combatStats.natureResistance}`);
console.log(`  fireResistance: ${gameMonster.combatDetails.combatStats.fireResistance}`);
console.log(`  maxHitpointsRatio: ${gameMonster.combatDetails.combatStats.maxHitpointsRatio}`);
console.log(`  smashEvasion: ${gameMonster.combatDetails.combatStats.smashEvasion}`);
console.log(`  stabEvasion: ${gameMonster.combatDetails.combatStats.stabEvasion}`);
console.log(`  slashEvasion: ${gameMonster.combatDetails.combatStats.slashEvasion}`);

console.log(`\nScaled Stats (scaleFactor = ${scaleFactor}):`);
const scaledDefenseLevel = gameMonster.combatDetails.defenseLevel * scaleFactor;
const scaledArmor = (gameMonster.combatDetails.combatStats.armor ?? 0) * scaleFactor;
const totalArmor = DEFENSE_SCALING_FACTOR * scaledDefenseLevel + scaledArmor;
console.log(`  defenseLevel: ${gameMonster.combatDetails.defenseLevel} × ${scaleFactor} = ${scaledDefenseLevel}`);
console.log(`  armor: ${gameMonster.combatDetails.combatStats.armor} × ${scaleFactor} = ${scaledArmor.toFixed(1)}`);
console.log(`  totalArmor = ${DEFENSE_SCALING_FACTOR} × ${scaledDefenseLevel} + ${scaledArmor.toFixed(1)} = ${totalArmor.toFixed(1)}`);
console.log(`  damageReduction (physical) = 100/(100+${totalArmor.toFixed(1)}) = ${(100/(100+totalArmor)*100).toFixed(1)}%`);

const scaledWater = (gameMonster.combatDetails.combatStats.waterResistance ?? 0) * scaleFactor;
const totalWater = DEFENSE_SCALING_FACTOR * scaledDefenseLevel + scaledWater;
console.log(`  waterResistance: ${gameMonster.combatDetails.combatStats.waterResistance} × ${scaleFactor} = ${scaledWater.toFixed(1)}`);
console.log(`  totalWaterResistance = ${DEFENSE_SCALING_FACTOR} × ${scaledDefenseLevel} + ${scaledWater.toFixed(1)} = ${totalWater.toFixed(1)}`);
console.log(`  damageReduction (water) = 100/(100+${totalWater.toFixed(1)}) = ${(100/(100+totalWater)*100).toFixed(1)}%`);

// Monster abilities at scaled levels
console.log(`\nMonster Abilities (scaled):`);
for (const abilityRef of gameMonster.abilities) {
  const scaledLevel = Math.floor(scaleFactor * abilityRef.level);
  const abilityData = gameData.abilityDetailMap[abilityRef.abilityHrid];
  let desc = "";
  if (abilityData?.abilityEffects) {
    for (const eff of abilityData.abilityEffects) {
      if (eff.buffs) {
        for (const buff of eff.buffs) {
          const totalRatio = buff.ratioBoost + buff.ratioBoostLevelBonus * scaledLevel;
          const totalFlat = buff.flatBoost + buff.flatBoostLevelBonus * scaledLevel;
          desc += ` ${buff.typeHrid.split("/").pop()}: ratio=${totalRatio.toFixed(3)} flat=${totalFlat.toFixed(1)}`;
          desc += ` dur=${(buff.duration as number)/1e9}s`;
        }
      }
    }
  }
  console.log(`  ${abilityRef.abilityHrid.split("/").pop()} lvl=${scaledLevel} (base ${abilityRef.level})${desc}`);
}

// =============================================================================
// Create actual player + monster and inspect post-updateCombatDetails stats
// =============================================================================

const deps = {
  Equipment: {
    createFromDTO: (dto: { hrid: string; enhancementLevel: number }, _gd: GameData) =>
      Equipment.createFromDTO(gameData, dto),
  },
  Consumable: {
    createFromDTO: (dto: { hrid: string; triggers: any[] }, _gd: GameData) =>
      Consumable.createFromDTO(gameData, dto),
  },
  Ability: {
    createFromDTO: (dto: { hrid: string; level: number; triggers: any[] }, _gd: GameData) =>
      Ability.createFromDTO(gameData, dto),
  },
};

const player = Player.createFromDTO(playerConfig, gameData, deps);
player.extraBuffs = [...crateBuffs];
player.food = [null, null, null];
player.drinks = [null, null, null];

// Create a wrapper class that adapts Ability's constructor signature
// Monster calls: new deps.Ability(hrid, gameData, level)
// But Ability constructor is: new Ability(gameData, hrid, level)
class MonsterAbility extends Ability {
  constructor(hrid: string, gd: GameData, level: number = 1) {
    super(gd, hrid, level);
  }
}

// Create monster at target level
const monster = new Monster(MONSTER_HRID, gameData, 0, { Ability: MonsterAbility as any });
monster.setLabyrinthTargetLevel(TARGET_LEVEL);
monster.updateCombatDetails();

// Also create player fresh and update
player.updateCombatDetails();

console.log(`\n${"=".repeat(60)}`);
console.log(`=== Post-updateCombatDetails Monster Stats ===`);
console.log(`${"=".repeat(60)}`);
console.log(`  defenseLevel: ${monster.defenseLevel}`);
console.log(`  totalArmor: ${monster.combatDetails.totalArmor.toFixed(1)}`);
console.log(`  totalWaterResistance: ${monster.combatDetails.totalWaterResistance.toFixed(1)}`);
console.log(`  totalNatureResistance: ${monster.combatDetails.totalNatureResistance.toFixed(1)}`);
console.log(`  totalFireResistance: ${monster.combatDetails.totalFireResistance.toFixed(1)}`);
console.log(`  maxHP: ${monster.combatDetails.maxHitpoints.toFixed(0)}`);
console.log(`  smashEvasionRating: ${monster.combatDetails.smashEvasionRating.toFixed(1)}`);
console.log(`  stabEvasionRating: ${monster.combatDetails.stabEvasionRating.toFixed(1)}`);
console.log(`  magicEvasionRating: ${monster.combatDetails.magicEvasionRating.toFixed(1)}`);
console.log(`  rangedEvasionRating: ${monster.combatDetails.rangedEvasionRating.toFixed(1)}`);

console.log(`\n${"=".repeat(60)}`);
console.log(`=== Post-updateCombatDetails Player Stats ===`);
console.log(`${"=".repeat(60)}`);
console.log(`  combatStyle: ${player.combatDetails.combatStats.combatStyleHrid}`);
console.log(`  damageType: ${player.combatDetails.combatStats.damageType}`);
console.log(`  attackLevel: ${player.attackLevel}`);
console.log(`  defenseLevel: ${player.defenseLevel}`);
console.log(`  meleeLevel: ${player.meleeLevel}`);
console.log(`  magicLevel: ${player.magicLevel}`);
console.log(`  smashAccuracyRating: ${player.combatDetails.smashAccuracyRating?.toFixed(1)}`);
console.log(`  smashMaxDamage: ${player.combatDetails.smashMaxDamage?.toFixed(1)}`);
console.log(`  totalArmor: ${player.combatDetails.totalArmor.toFixed(1)}`);
console.log(`  armorPenetration: ${player.combatDetails.combatStats.armorPenetration}`);
console.log(`  physicalAmplify: ${player.combatDetails.combatStats.physicalAmplify}`);
console.log(`  criticalRate: ${player.combatDetails.combatStats.criticalRate}`);
console.log(`  criticalDamage: ${player.combatDetails.combatStats.criticalDamage}`);
console.log(`  attackInterval: ${player.combatDetails.combatStats.attackInterval}`);
console.log(`  maxHP: ${player.combatDetails.maxHitpoints.toFixed(0)}`);

// =============================================================================
// Process a single auto-attack to see detailed damage
// =============================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`=== Auto-Attack Damage Calculation ===`);
console.log(`${"=".repeat(60)}`);

const combatStyle = player.combatDetails.combatStats.combatStyleHrid;
const damageType = player.combatDetails.combatStats.damageType;

// Figure out accuracy and evasion
let accuracyRating = 0;
let maxDamage = 0;
let evasionRating = 0;

switch (combatStyle) {
  case "/combat_styles/smash":
    accuracyRating = player.combatDetails.smashAccuracyRating;
    maxDamage = player.combatDetails.smashMaxDamage;
    evasionRating = monster.combatDetails.smashEvasionRating;
    break;
  case "/combat_styles/stab":
    accuracyRating = player.combatDetails.stabAccuracyRating;
    maxDamage = player.combatDetails.stabMaxDamage;
    evasionRating = monster.combatDetails.stabEvasionRating;
    break;
  case "/combat_styles/slash":
    accuracyRating = player.combatDetails.slashAccuracyRating;
    maxDamage = player.combatDetails.slashMaxDamage;
    evasionRating = monster.combatDetails.slashEvasionRating;
    break;
}

const hitChance =
  Math.pow(accuracyRating, 1.4) /
  (Math.pow(accuracyRating, 1.4) + Math.pow(evasionRating, 1.4));

let targetResistance = 0;
switch (damageType) {
  case "/damage_types/physical":
    targetResistance = monster.combatDetails.totalArmor;
    break;
  case "/damage_types/water":
    targetResistance = monster.combatDetails.totalWaterResistance;
    break;
}

const sourcePen = player.combatDetails.combatStats.armorPenetration ?? 0;
const penRes = sourcePen > 0 && targetResistance > 0
  ? targetResistance / (1 + sourcePen)
  : targetResistance;
const dmgRatio = 100 / (100 + penRes);

const avgDamage = (1 + maxDamage) / 2;
const mitigatedAvg = avgDamage * dmgRatio;
const expectedDps = hitChance * mitigatedAvg / (player.combatDetails.combatStats.attackInterval / 1e9);

console.log(`  combatStyle: ${combatStyle}`);
console.log(`  damageType: ${damageType}`);
console.log(`  accuracyRating: ${accuracyRating.toFixed(1)}`);
console.log(`  evasionRating: ${evasionRating.toFixed(1)}`);
console.log(`  hitChance: ${(hitChance * 100).toFixed(1)}%`);
console.log(`  maxAutoAttackDamage: ${maxDamage.toFixed(1)}`);
console.log(`  avgAutoAttackDamage: ${avgDamage.toFixed(1)}`);
console.log(`  targetResistance (${damageType.split("/").pop()}): ${targetResistance.toFixed(1)}`);
console.log(`  armorPenetration: ${sourcePen}`);
console.log(`  penetratedResistance: ${penRes.toFixed(1)}`);
console.log(`  damageRatio: ${(dmgRatio * 100).toFixed(1)}%`);
console.log(`  mitigatedAvgDamage: ${mitigatedAvg.toFixed(1)}`);
console.log(`  attackInterval: ${(player.combatDetails.combatStats.attackInterval / 1e9).toFixed(2)}s`);
console.log(`  expectedAutoAttackDPS: ${expectedDps.toFixed(1)}`);
console.log(`  monsterHP: ${monster.combatDetails.maxHitpoints.toFixed(0)}`);
console.log(`  time to kill (auto only): ${(monster.combatDetails.maxHitpoints / expectedDps).toFixed(1)}s`);

// =============================================================================
// Run actual sim at level 278
// =============================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`=== Sim Results ===`);
console.log(`${"=".repeat(60)}`);

for (const level of [278, 287]) {
  const result = simulateLabyrinthFight(
    playerConfig,
    MONSTER_HRID,
    level,
    crateBuffs,
    [],  // no seal buffs
    0,   // no wisdom bonus
    gameData
  );
  console.log(`\n  Level ${level}: ${result.success ? "KILL" : "FAIL"} in ${(result.killTimeNs / 1e9).toFixed(1)}s`);
}

// =============================================================================
// Compare: run sim against a different monster at similar level
// =============================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`=== Comparison: Skeleton at same levels ===`);
console.log(`${"=".repeat(60)}`);

const COMPARE_MONSTER = "/monsters/giant_scorpion";
const compareLoadoutId = charData.labyrinthMonsterLoadouts[COMPARE_MONSTER];
const compareLoadout = compareLoadoutId ? loadoutById.get(compareLoadoutId) : null;
const compareConfig = compareLoadout?.config ?? playerConfig;

for (const level of [278, 287]) {
  const result = simulateLabyrinthFight(
    compareConfig,
    COMPARE_MONSTER,
    level,
    crateBuffs,
    [],
    0,
    gameData
  );
  console.log(`  Level ${level}: ${result.success ? "KILL" : "FAIL"} in ${(result.killTimeNs / 1e9).toFixed(1)}s`);
}

// =============================================================================
// Check: Is the mimic's elusiveness being applied? What's the effective uptime?
// =============================================================================
console.log(`\n${"=".repeat(60)}`);
console.log(`=== Elusiveness Uptime Analysis ===`);
console.log(`${"=".repeat(60)}`);
// Elusiveness: 30s cooldown, 20s duration = 66.7% uptime
// At level 166: ratioBoost = 0.2 + 0.002*166 = 0.532
// This is a 53.2% evasion ratio boost
const elusiveLevel = Math.floor(scaleFactor * 60);
const elusiveRatio = 0.2 + 0.002 * elusiveLevel;
const elusiveUptime = 20 / 30; // 20s duration / 30s cooldown
const effectiveEvasionBoost = elusiveRatio * elusiveUptime;
console.log(`  Elusiveness level: ${elusiveLevel}`);
console.log(`  Evasion ratio boost: ${(elusiveRatio * 100).toFixed(1)}%`);
console.log(`  Duration: 20s, Cooldown: 30s, Uptime: ${(elusiveUptime * 100).toFixed(1)}%`);
console.log(`  Effective avg evasion boost: ${(effectiveEvasionBoost * 100).toFixed(1)}%`);
console.log(`  Base smash evasion rating: ${monster.combatDetails.smashEvasionRating.toFixed(1)} (without elusiveness active)`);
console.log(`  With elusiveness: ${(monster.combatDetails.smashEvasionRating * (1 + elusiveRatio)).toFixed(1)}`);

// Frenzy: 30s cooldown, 20s duration = 66.7% uptime
const frenzyLevel = Math.floor(scaleFactor * 60);
const frenzyRatio = 0.24 + 0.0024 * frenzyLevel;
console.log(`\n  Frenzy level: ${frenzyLevel}`);
console.log(`  Attack speed ratio boost: ${(frenzyRatio * 100).toFixed(1)}%`);
console.log(`  Duration: 20s, Cooldown: 30s, Uptime: ${(elusiveUptime * 100).toFixed(1)}%`);
console.log(`  => Mimic attacks ${(frenzyRatio * 100).toFixed(0)}% faster during frenzy`);
