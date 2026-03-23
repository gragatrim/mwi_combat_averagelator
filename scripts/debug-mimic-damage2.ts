#!/usr/bin/env tsx
// Detailed mimic fight instrumentation - track all damage sources
import { readFileSync } from "fs";
import type { GameData, PlayerConfig } from "../src/engine/types";
import { parseFullCharacterData, type CombatLoadout } from "../src/data/fullCharacterData";
import { buildCrateBuffs, type CrateTier } from "../src/features/labyrinthSimulator";
import Player from "../src/engine/player";
import Monster from "../src/engine/monster";
import Zone from "../src/engine/zone";
import Equipment from "../src/engine/equipment";
import Consumable from "../src/engine/consumable";
import Ability from "../src/engine/ability";
import Buff from "../src/engine/buff";
import DeterministicSimulator from "../src/engine/deterministicSimulator";
import CombatUtilities from "../src/engine/combatUtilities";

const gameData = JSON.parse(readFileSync("public/init_client_data.json", "utf-8")) as GameData;
const charJson = readFileSync("live_data/gragatrim_full_char_data.json", "utf-8");
const charData = parseFullCharacterData(charJson, gameData);

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

// Build seal buffs (user has all seals)
const makeSealBuff = (typeHrid: string, flatBoost: number, ratioBoost: number) =>
  new Buff({
    uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
    typeHrid, flatBoost, flatBoostLevelBonus: 0,
    ratioBoost, ratioBoostLevelBonus: 0, startTime: 0, duration: 1800e9,
  });
const sealBuffs = [
  makeSealBuff("/buff_types/attack_speed", 0, 0.15),
  makeSealBuff("/buff_types/cast_speed", 0.15, 0),
  makeSealBuff("/buff_types/damage", 0, 0.08),
  makeSealBuff("/buff_types/critical_rate", 0.1, 0),
];

// Find mimic loadout
const loadoutById = new Map<string, CombatLoadout>();
for (const loadout of charData.combatLoadouts) loadoutById.set(loadout.id, loadout);
const mimicLoadoutId = charData.labyrinthMonsterLoadouts["/monsters/mimic"];
const mimicLoadout = mimicLoadoutId ? loadoutById.get(mimicLoadoutId) : null;
const playerConfig = mimicLoadout?.config ?? charData.combatLoadouts[0]?.config!;

console.log(`Loadout: ${mimicLoadout?.name}`);
console.log(`Abilities: ${playerConfig.abilities.filter(a => a).map(a => (a as any).hrid.split("/").pop()).join(", ")}`);

// Monkey-patch processAttack to track damage sources
const origProcessAttack = CombatUtilities.processAttack;
let attackLog: any[] = [];

CombatUtilities.processAttack = function(source: any, target: any, abilityEffect?: any) {
  const result = origProcessAttack.call(this, source, target, abilityEffect);
  
  const sourceIsPlayer = source.isPlayer;
  const entry: any = {
    sourceIsPlayer,
    sourceName: source.hrid?.split("/").pop() || source.hrid,
    targetName: target.hrid?.split("/").pop() || target.hrid,
    isAbility: !!abilityEffect,
    damageDone: result.damageDone,
    thornDamageDone: result.thornDamageDone,
    retaliationDamageDone: result.retaliationDamageDone,
    hitChance: result.hitChance,
  };
  
  // Track player armor for thorns scaling analysis
  if (!sourceIsPlayer) {
    entry.playerArmor = target.combatDetails.totalArmor;
    entry.playerDefMaxDmg = target.combatDetails.defensiveMaxDamage;
    entry.playerPhysicalThorns = target.combatDetails.combatStats.physicalThorns;
    entry.playerRetaliation = target.combatDetails.combatStats.retaliation;
    entry.playerSmashAccRating = target.combatDetails.smashAccuracyRating;
    entry.mimicSmashEvasion = source.combatDetails.smashEvasionRating;
    entry.mimicHP = source.combatDetails.currentHitpoints;
  }
  
  attackLog.push(entry);
  return result;
};

// Run fight at level 278 with seals
for (const level of [278]) {
  attackLog = [];
  
  const deps = {
    Equipment: { createFromDTO: (dto: any, _gd: GameData) => Equipment.createFromDTO(gameData, dto) },
    Consumable: { createFromDTO: (dto: any, _gd: GameData) => Consumable.createFromDTO(gameData, dto) },
    Ability: { createFromDTO: (dto: any, _gd: GameData) => Ability.createFromDTO(gameData, dto) },
  };
  
  const player = Player.createFromDTO(playerConfig, gameData, deps);
  player.extraBuffs = [...crateBuffs, ...sealBuffs];
  player.food = [null, null, null];
  player.drinks = [null, null, null];
  
  const zone = Zone.createLabyrinthZone("/monsters/mimic");
  const simulator = new DeterministicSimulator([player], zone, gameData, {
    stopAfterFirstEncounter: true,
    labyrinthTargetLevel: level,
    maxSimTimeNs: 120e9,
  });
  const simResult = simulator.simulate();
  
  console.log(`\n${"=".repeat(70)}`);
  console.log(`=== Level ${level} Fight Analysis (with seals) ===`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Result: ${simResult.encounters > 0 ? "KILL" : "FAIL"}, simTime: ${(simResult.totalSimTimeNs/1e9).toFixed(1)}s`);
  
  // Aggregate damage by source
  let playerAutoAttackDmg = 0, playerAbilityDmg = 0;
  let thornsTotalDmg = 0, retaliationTotalDmg = 0;
  let mimicAutoAttackDmg = 0, mimicAbilityDmg = 0;
  let mimicAttackCount = 0;
  
  // Track thorns/ret per mimic attack for variance analysis
  const thornsPerAttack: number[] = [];
  const retPerAttack: number[] = [];
  const armorPerAttack: number[] = [];
  const thornsRetalHitChances: number[] = [];
  
  for (const e of attackLog) {
    if (e.sourceIsPlayer) {
      if (e.isAbility) playerAbilityDmg += e.damageDone;
      else playerAutoAttackDmg += e.damageDone;
    } else {
      mimicAttackCount++;
      if (e.isAbility) mimicAbilityDmg += e.damageDone;
      else mimicAutoAttackDmg += e.damageDone;
      thornsTotalDmg += e.thornDamageDone;
      retaliationTotalDmg += e.retaliationDamageDone;
      thornsPerAttack.push(e.thornDamageDone);
      retPerAttack.push(e.retaliationDamageDone);
      armorPerAttack.push(e.playerArmor);
      
      // Log first few attacks for detail
      if (mimicAttackCount <= 5 || mimicAttackCount % 10 === 0) {
        console.log(`\n  Mimic attack #${mimicAttackCount}:`);
        console.log(`    playerArmor=${e.playerArmor?.toFixed(0)} defMaxDmg=${e.playerDefMaxDmg?.toFixed(0)} thorns=${e.playerPhysicalThorns?.toFixed(3)} retaliation=${e.playerRetaliation?.toFixed(3)}`);
        console.log(`    player smashAccRating=${e.playerSmashAccRating?.toFixed(0)} vs mimic smashEvRating=${e.mimicSmashEvasion?.toFixed(0)}`);
        console.log(`    mimicDmgToPlayer=${e.damageDone?.toFixed(1)} thornsDmgToMimic=${e.thornDamageDone?.toFixed(1)} retaliationDmg=${e.retaliationDamageDone?.toFixed(1)}`);
        console.log(`    mimicHP remaining=${e.mimicHP?.toFixed(0)}`);
      }
    }
  }
  
  const totalPlayerDmg = playerAutoAttackDmg + playerAbilityDmg + thornsTotalDmg + retaliationTotalDmg;
  const simSec = simResult.totalSimTimeNs / 1e9;
  
  console.log(`\n${"=".repeat(70)}`);
  console.log(`=== Damage Breakdown ===`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  Player auto-attacks:  ${playerAutoAttackDmg.toFixed(0)} (${(playerAutoAttackDmg/totalPlayerDmg*100).toFixed(1)}%)`);
  console.log(`  Player abilities:     ${playerAbilityDmg.toFixed(0)} (${(playerAbilityDmg/totalPlayerDmg*100).toFixed(1)}%)`);
  console.log(`  Thorns (spike_shell): ${thornsTotalDmg.toFixed(0)} (${(thornsTotalDmg/totalPlayerDmg*100).toFixed(1)}%)`);
  console.log(`  Retaliation:          ${retaliationTotalDmg.toFixed(0)} (${(retaliationTotalDmg/totalPlayerDmg*100).toFixed(1)}%)`);
  console.log(`  TOTAL dealt to mimic: ${totalPlayerDmg.toFixed(0)}`);
  console.log(`  Effective DPS:        ${(totalPlayerDmg/simSec).toFixed(1)}`);
  console.log(`  Mimic attacks:        ${mimicAttackCount}`);
  console.log(`  Avg thorns/attack:    ${(thornsTotalDmg/mimicAttackCount).toFixed(1)}`);
  console.log(`  Avg retal/attack:     ${(retaliationTotalDmg/mimicAttackCount).toFixed(1)}`);
  console.log(`  Mimic dmg to player:  ${(mimicAutoAttackDmg+mimicAbilityDmg).toFixed(0)} (auto=${mimicAutoAttackDmg.toFixed(0)}, ability=${mimicAbilityDmg.toFixed(0)})`);
  
  // Armor analysis
  const maxArmor = Math.max(...armorPerAttack);
  const minArmor = Math.min(...armorPerAttack);
  const avgArmor = armorPerAttack.reduce((a,b) => a+b, 0) / armorPerAttack.length;
  console.log(`\n  Player armor range: min=${minArmor.toFixed(0)} avg=${avgArmor.toFixed(0)} max=${maxArmor.toFixed(0)}`);
  console.log(`  (max is during invincible - thorns scale with armor via (1+armor/100))`);
  console.log(`  Thorns multiplier range: min=${(1+minArmor/100).toFixed(2)}x avg=${(1+avgArmor/100).toFixed(2)}x max=${(1+maxArmor/100).toFixed(2)}x`);
  
  // Check if thorns during invincible are disproportionate
  const highArmorAttacks = attackLog.filter(e => !e.sourceIsPlayer && e.playerArmor > avgArmor * 1.5);
  const lowArmorAttacks = attackLog.filter(e => !e.sourceIsPlayer && e.playerArmor <= avgArmor * 1.5);
  const highThorns = highArmorAttacks.reduce((s: number, e: any) => s + e.thornDamageDone, 0);
  const lowThorns = lowArmorAttacks.reduce((s: number, e: any) => s + e.thornDamageDone, 0);
  console.log(`\n  Thorns during invincible (high armor): ${highThorns.toFixed(0)} from ${highArmorAttacks.length} attacks`);
  console.log(`  Thorns during normal:                   ${lowThorns.toFixed(0)} from ${lowArmorAttacks.length} attacks`);
  if (highArmorAttacks.length > 0 && lowArmorAttacks.length > 0) {
    console.log(`  Avg thorns/attack during invincible:    ${(highThorns/highArmorAttacks.length).toFixed(1)}`);
    console.log(`  Avg thorns/attack during normal:        ${(lowThorns/lowArmorAttacks.length).toFixed(1)}`);
    console.log(`  Invincible thorns multiplier:           ${((highThorns/highArmorAttacks.length)/(lowThorns/lowArmorAttacks.length)).toFixed(1)}x`);
  }
}
