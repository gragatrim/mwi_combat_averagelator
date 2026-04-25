#!/usr/bin/env tsx
// Compare sim vs game logs for alchtest vs Pyre Hunter at level 159
import { readFileSync } from "fs";
import type { GameData } from "../src/engine/types";
import { parseFullCharacterData, type CombatLoadout } from "../src/data/fullCharacterData";
import { buildCrateBuffs, simulateLabyrinthFight, type CrateTier } from "../src/features/labyrinthSimulator";
import Player from "../src/engine/player";
import Monster from "../src/engine/monster";
import Equipment from "../src/engine/equipment";
import Consumable from "../src/engine/consumable";
import Ability from "../src/engine/ability";
import Buff from "../src/engine/buff";
import CombatUtilities from "../src/engine/combatUtilities";

const gameData = JSON.parse(readFileSync("public/init_client_data.json", "utf-8")) as GameData;
const charJson = readFileSync("live_data/alchtest.json", "utf-8");
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

// Find pyre_hunter loadout
const loadoutById = new Map<string, CombatLoadout>();
for (const loadout of charData.combatLoadouts) loadoutById.set(loadout.id, loadout);

const pyreLoadoutId = charData.labyrinthMonsterLoadouts["/monsters/pyre_hunter"];
const pyreLoadout = pyreLoadoutId ? loadoutById.get(pyreLoadoutId) : null;
const defaultConfig = charData.combatLoadouts[0]?.config;

// Test both WITH and WITHOUT invincible
// Need to find which loadouts were used in the logs
console.log("Available combat loadouts:");
for (const lo of charData.combatLoadouts) {
  const abilities = lo.config.abilities.filter(a => a).map(a => (a as any).hrid.split("/").pop());
  console.log(`  ${lo.name} (${lo.id}): ${abilities.join(", ")}`);
}
console.log(`Pyre Hunter loadout ID: ${pyreLoadoutId}`);

const playerConfig = pyreLoadout?.config ?? defaultConfig!;
console.log(`\nUsing loadout: ${pyreLoadout?.name ?? "default"}`);
const abilities = playerConfig.abilities.filter(a => a).map(a => (a as any).hrid.split("/").pop());
console.log(`Abilities: ${abilities.join(", ")}`);

// Monkey-patch to track damage sources
const origProcessAttack = CombatUtilities.processAttack;
let attackLog: any[] = [];

CombatUtilities.processAttack = function(source: any, target: any, abilityEffect?: any) {
  const result = origProcessAttack.call(this, source, target, abilityEffect);
  const sourceIsPlayer = source.isPlayer;
  if (!sourceIsPlayer) {
    attackLog.push({
      thornDmg: result.thornDamageDone,
      retaliationDmg: result.retaliationDamageDone,
      playerArmor: target.combatDetails.totalArmor,
      playerPhysicalThorns: target.combatDetails.combatStats.physicalThorns,
      monsterHP: source.combatDetails.currentHitpoints,
    });
  } else {
    attackLog.push({
      playerDmg: result.damageDone,
      hitChance: result.hitChance,
      isAbility: !!abilityEffect,
    });
  }
  return result;
};

// Run sim at level 159 (matching the game logs)
const LEVEL = 159;
const TIME_LIMIT = 30e9; // 30s to match game fight durations

for (const label of ["WITH_INV", "NO_INV"]) {
  attackLog = [];
  
  // For NO_INV, we'd need to modify the loadout to remove invincible
  // But we'll run both with the actual loadout first, then analyze
  const result = simulateLabyrinthFight(
    playerConfig,
    "/monsters/pyre_hunter",
    LEVEL,
    crateBuffs,
    0,
    gameData,
    label === "WITH_INV" ? 120e9 : 120e9  // full fight
  );
  
  // Aggregate
  let thornsTotal = 0, retTotal = 0, playerAutoTotal = 0, playerAbilityTotal = 0;
  let mimicAttacks = 0;
  const armorValues: number[] = [];
  const thornsPerAttack: number[] = [];
  
  for (const e of attackLog) {
    if (e.thornDmg !== undefined) {
      mimicAttacks++;
      thornsTotal += e.thornDmg;
      retTotal += e.retaliationDmg;
      armorValues.push(e.playerArmor);
      thornsPerAttack.push(e.thornDmg);
    } else if (e.playerDmg !== undefined) {
      if (e.isAbility) playerAbilityTotal += e.playerDmg;
      else playerAutoTotal += e.playerDmg;
    }
  }
  
  const total = thornsTotal + retTotal + playerAutoTotal + playerAbilityTotal;
  const simSec = result.killTimeNs / 1e9;
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== Sim: Pyre Hunter Level ${LEVEL} (${result.success ? "KILL" : "FAIL"} in ${simSec.toFixed(1)}s) ===`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Thorns:       ${thornsTotal.toFixed(0)} (${(thornsTotal/total*100).toFixed(1)}%)`);
  console.log(`  Retaliation:  ${retTotal.toFixed(0)} (${(retTotal/total*100).toFixed(1)}%)`);
  console.log(`  Auto-attack:  ${playerAutoTotal.toFixed(0)} (${(playerAutoTotal/total*100).toFixed(1)}%)`);
  console.log(`  Abilities:    ${playerAbilityTotal.toFixed(0)} (${(playerAbilityTotal/total*100).toFixed(1)}%)`);
  console.log(`  TOTAL:        ${total.toFixed(0)}`);
  console.log(`  DPS:          ${(total/simSec).toFixed(1)}`);
  console.log(`  Monster HP:   6760`);
  console.log(`  Mimic attacks: ${mimicAttacks}`);
  
  if (armorValues.length > 0) {
    const highArmor = armorValues.filter(a => a > 1000);
    const lowArmor = armorValues.filter(a => a <= 1000);
    console.log(`\n  Armor phases:`);
    console.log(`    High armor (invincible): ${highArmor.length} attacks, avg armor=${highArmor.length > 0 ? (highArmor.reduce((a,b)=>a+b,0)/highArmor.length).toFixed(0) : 'N/A'}`);
    console.log(`    Normal armor:            ${lowArmor.length} attacks, avg armor=${lowArmor.length > 0 ? (lowArmor.reduce((a,b)=>a+b,0)/lowArmor.length).toFixed(0) : 'N/A'}`);
    
    // Thorns during each phase
    const highThorns = attackLog.filter(e => e.thornDmg !== undefined && e.playerArmor > 1000);
    const lowThorns = attackLog.filter(e => e.thornDmg !== undefined && e.playerArmor <= 1000);
    const highThornsTotal = highThorns.reduce((s: number, e: any) => s + e.thornDmg, 0);
    const lowThornsTotal = lowThorns.reduce((s: number, e: any) => s + e.thornDmg, 0);
    
    if (highThorns.length > 0) {
      console.log(`    Invincible thorns: ${highThornsTotal.toFixed(0)} from ${highThorns.length} attacks (avg ${(highThornsTotal/highThorns.length).toFixed(1)}/attack)`);
    }
    if (lowThorns.length > 0) {
      console.log(`    Normal thorns:     ${lowThornsTotal.toFixed(0)} from ${lowThorns.length} attacks (avg ${(lowThornsTotal/lowThorns.length).toFixed(1)}/attack)`);
    }
  }
  
  // Compare to game data
  console.log(`\n  Game comparison:`);
  console.log(`    Game avg DPS (with inv): 110.6`);
  console.log(`    Game avg DPS (no inv):   78.3`);
  console.log(`    Sim DPS:                 ${(total/simSec).toFixed(1)}`);
  
  // Only run once since we're using the same loadout
  break;
}

// Now analyze what the game's per-hit numbers should be
console.log(`\n${"=".repeat(60)}`);
console.log(`=== Expected Per-Hit Damage Analysis ===`);
console.log(`${"=".repeat(60)}`);

// Create player and monster to inspect stats
const deps = {
  Equipment: { createFromDTO: (dto: any, _gd: GameData) => Equipment.createFromDTO(gameData, dto) },
  Consumable: { createFromDTO: (dto: any, _gd: GameData) => Consumable.createFromDTO(gameData, dto) },
  Ability: { createFromDTO: (dto: any, _gd: GameData) => Ability.createFromDTO(gameData, dto) },
};

const player = Player.createFromDTO(playerConfig, gameData, deps);
player.extraBuffs = [...crateBuffs];
player.food = [null, null, null];
player.drinks = [null, null, null];

class MonsterAbility extends Ability {
  constructor(hrid: string, gd: GameData, level: number = 1) { super(gd, hrid, level); }
}
const monster = new Monster("/monsters/pyre_hunter", gameData, 0, { Ability: MonsterAbility as any });
monster.setLabyrinthTargetLevel(LEVEL);
monster.updateCombatDetails();
player.updateCombatDetails();

console.log(`  Player smashMaxDamage: ${player.combatDetails.smashMaxDamage.toFixed(1)}`);
console.log(`  Player defensiveMaxDamage: ${player.combatDetails.defensiveMaxDamage.toFixed(1)}`);
console.log(`  Player totalArmor (base): ${player.combatDetails.totalArmor.toFixed(1)}`);
console.log(`  Player critRate: ${player.combatDetails.combatStats.criticalRate.toFixed(4)}`);
console.log(`  Player critDamage: ${player.combatDetails.combatStats.criticalDamage}`);
console.log(`  Monster totalArmor: ${monster.combatDetails.totalArmor.toFixed(1)}`);
console.log(`  Monster smashEvasionRating: ${monster.combatDetails.smashEvasionRating.toFixed(1)}`);

const hitChance = Math.pow(player.combatDetails.smashAccuracyRating, 1.4) / 
  (Math.pow(player.combatDetails.smashAccuracyRating, 1.4) + Math.pow(monster.combatDetails.smashEvasionRating, 1.4));
console.log(`  Hit chance: ${(hitChance*100).toFixed(1)}%`);

// Auto-attack crit damage (should match the 322 in game)
const maxDmg = player.combatDetails.smashMaxDamage;
const critDmg = maxDmg * (1 + player.combatDetails.combatStats.criticalDamage);
const monsterArmor = monster.combatDetails.totalArmor;
const mitigationRatio = 100 / (100 + monsterArmor);
const critMitigated = Math.ceil(critDmg * mitigationRatio);
console.log(`\n  Auto-attack crit: ${maxDmg.toFixed(1)} × ${(1+player.combatDetails.combatStats.criticalDamage)} × ${mitigationRatio.toFixed(4)} = ${critMitigated}`);
console.log(`  Game crit: always 322`);
console.log(`  Match: ${critMitigated === 322 ? 'YES ✓' : 'NO ✗ (off by ' + (critMitigated - 322) + ')'}`);
