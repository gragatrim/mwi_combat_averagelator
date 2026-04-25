// =============================================================================
// Labyrinth Diagnostic Test - Detailed combat analysis at specific levels
// =============================================================================
// Usage: npx vitest run test_lab_diagnostic
//
// Purpose: Investigate why sim predicts significantly lower max levels than
// what the user clears in-game (e.g., salamander sim=189 vs user=217).
// Logs detailed per-fight stats: player DPS, monster DPS, HP/MP margins,
// ability usage, mana sustainability, etc.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type { GameData, PlayerConfig } from "./src/engine/types";
import {
  parseFullCharacterData,
  type FullCharacterData,
} from "./src/data/fullCharacterData";
import {
  buildCrateBuffs,
  findMaxLabyrinthLevel,
} from "./src/features/labyrinthSimulator";
import Buff from "./src/engine/buff";
import Player from "./src/engine/player";
import Monster from "./src/engine/monster";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";
import Zone from "./src/engine/zone";
import DeterministicSimulator from "./src/engine/deterministicSimulator";
import CombatUtilities from "./src/engine/combatUtilities";
import type Trigger from "./src/engine/trigger";

// =============================================================================
// Setup
// =============================================================================

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const fullCharJson = readFileSync(
  "live_data/gragatrim_full_char_data.json",
  "utf-8"
);

const parsed = parseFullCharacterData(fullCharJson, gameData);

// Expert crates (user confirmed)
const crateBuffs = buildCrateBuffs("expert", "expert");

// All seals enabled (user confirmed)
function buildAllSealBuffs(): Buff[] {
  const makeSealBuff = (
    typeHrid: string,
    flatBoost: number,
    ratioBoost: number
  ): Buff =>
    new Buff({
      uniqueHrid: `/buff_uniques/seal_${typeHrid.split("/").pop()}`,
      typeHrid,
      flatBoost,
      flatBoostLevelBonus: 0,
      ratioBoost,
      ratioBoostLevelBonus: 0,
      startTime: 0,
      duration: 0,
    });

  return [
    makeSealBuff("/buff_types/attack_speed", 0, 0.15),
    makeSealBuff("/buff_types/cast_speed", 0.15, 0),
    makeSealBuff("/buff_types/damage", 0, 0.08),
    makeSealBuff("/buff_types/critical_rate", 0.1, 0),
    makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0),
  ];
}

const sealBuffs = buildAllSealBuffs();

// Wisdom bonus: community buff (level 20) + mooPass + seal
// Community: 0.2 + 0.005 * 19 = 0.295
// MooPass: 0.05
// Seal wisdom: 0.2
const wisdomBuffBonus = 0.295 + 0.05 + 0.2;

// =============================================================================
// Player dependency builder (same as labyrinthSimulator.ts)
// =============================================================================

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

// =============================================================================
// Ability adapter for Monster construction (matches deterministicSimulator.ts)
// =============================================================================

class AbilityAdapter {
  private gameData: GameData;
  constructor(gd: GameData) {
    this.gameData = gd;
  }
  getConstructor(): new (
    hrid: string,
    gameData: GameData,
    level?: number,
    triggers?: Trigger[] | null
  ) => Ability {
    const gd = this.gameData;
    return class extends Ability {
      constructor(
        hrid: string,
        _gameData: GameData,
        level?: number,
        triggers?: Trigger[] | null
      ) {
        super(gd, hrid, level, triggers);
      }
    } as unknown as new (
      hrid: string,
      gameData: GameData,
      level?: number,
      triggers?: Trigger[] | null
    ) => Ability;
  }
}

// =============================================================================
// Diagnostic fight runner
// =============================================================================

interface DiagnosticResult {
  level: number;
  success: boolean;
  fightTimeSec: number;
  // Player stats
  playerMaxHp: number;
  playerMaxMp: number;
  playerHpRegen: number;
  playerMpRegen: number;
  playerAttackInterval: number;
  playerDamageType: string;
  playerAccuracy: number;
  playerMaxDamage: number;
  playerCritRate: number;
  playerCritDamage: number;
  playerArmor: number;
  playerFireRes: number;
  playerWaterRes: number;
  playerNatureRes: number;
  playerLifeSteal: number;
  playerManaLeech: number;
  playerCastSpeed: number;
  playerAttackSpeed: number;
  playerParry: number;
  playerTenacity: number;
  // Monster stats
  monsterMaxHp: number;
  monsterDamageType: string;
  monsterCombatStyle: string;
  monsterAccuracy: number;
  monsterMaxDamage: number;
  monsterArmor: number;
  monsterFireRes: number;
  monsterWaterRes: number;
  monsterNatureRes: number;
  monsterEvasionVsPlayer: number;
  monsterAbilities: string[];
  // Fight results
  playerEffectiveDps: number;
  totalDamageTaken: number;
  monsterEffectiveDps: number;
  totalDamageDealt: number;
  totalHealingReceived: number;
  totalManaUsed: number;
  ranOutOfMana: boolean;
  outOfManaTimeSec: number;
  playerDeaths: number;
  playerHpAtEnd: number;
  playerMpAtEnd: number;
  // Hit chance
  playerHitChance: number;
  monsterHitChanceVsPlayer: number;
  // Abilities
  abilities: string[];
  manaByAbility: Record<string, number>;
  healingBySource: Record<string, number>;
}

function runDiagnosticFight(
  playerConfig: PlayerConfig,
  monsterHrid: string,
  targetLevel: number
): DiagnosticResult {
  const deps = buildPlayerDeps(gameData);
  const player = Player.createFromDTO(playerConfig, gameData, deps);

  // Apply crate + seal buffs
  player.extraBuffs = [...crateBuffs, ...sealBuffs];
  player.wisdomBuffBonus = wisdomBuffBonus;

  // Clear consumables (labyrinth has no consumables)
  player.food = [null, null, null];
  player.drinks = [null, null, null];

  // Properly apply all buffs through the full chain:
  // generatePermanentBuffs() folds house/achievement/zone/extra buffs into permanentBuffs
  // clearBuffs() clones permanentBuffs → combatBuffs and calls updateCombatDetails()
  player.generatePermanentBuffs();
  player.clearBuffs();

  // Create monster at target level
  const abilityAdapter = new AbilityAdapter(gameData);
  const monsterData = gameData.combatMonsterDetailMap[monsterHrid];
  const monster = new Monster(monsterHrid, gameData, 0, {
    Ability: abilityAdapter.getConstructor(),
  });
  monster.setLabyrinthTargetLevel(targetLevel);
  monster.updateCombatDetails();

  // Capture player stats before fight
  const pd = player.combatDetails;
  const md = monster.combatDetails;

  // Determine damage type alignment
  const playerDamageType = pd.combatStats.damageType;
  const monsterDamageType = md.combatStats.damageType;

  // Get player accuracy and damage based on combat style
  const style = pd.combatStats.combatStyleHrid;
  let playerAccuracy = 0;
  let playerMaxDamage = 0;
  let monsterEvasionVsPlayer = 0;

  if (style?.includes("ranged")) {
    playerAccuracy = pd.rangedAccuracyRating;
    playerMaxDamage = pd.rangedMaxDamage;
    monsterEvasionVsPlayer = md.rangedEvasionRating;
  } else if (style?.includes("magic")) {
    playerAccuracy = pd.magicAccuracyRating;
    playerMaxDamage = pd.magicMaxDamage;
    monsterEvasionVsPlayer = md.magicEvasionRating;
  } else if (style?.includes("stab")) {
    playerAccuracy = pd.stabAccuracyRating;
    playerMaxDamage = pd.stabMaxDamage;
    monsterEvasionVsPlayer = md.stabEvasionRating;
  } else if (style?.includes("slash")) {
    playerAccuracy = pd.slashAccuracyRating;
    playerMaxDamage = pd.slashMaxDamage;
    monsterEvasionVsPlayer = md.slashEvasionRating;
  } else if (style?.includes("smash")) {
    playerAccuracy = pd.smashAccuracyRating;
    playerMaxDamage = pd.smashMaxDamage;
    monsterEvasionVsPlayer = md.smashEvasionRating;
  }

  // Get monster accuracy and player evasion
  const monsterStyle = md.combatStats.combatStyleHrid;
  let monsterAccuracy = 0;
  let playerEvasionVsMonster = 0;

  if (monsterStyle?.includes("ranged")) {
    monsterAccuracy = md.rangedAccuracyRating;
    playerEvasionVsMonster = pd.rangedEvasionRating;
  } else if (monsterStyle?.includes("magic")) {
    monsterAccuracy = md.magicAccuracyRating;
    playerEvasionVsMonster = pd.magicEvasionRating;
  } else if (monsterStyle?.includes("stab")) {
    monsterAccuracy = md.stabAccuracyRating;
    playerEvasionVsMonster = pd.stabEvasionRating;
  } else if (monsterStyle?.includes("slash")) {
    monsterAccuracy = md.slashAccuracyRating;
    playerEvasionVsMonster = pd.slashEvasionRating;
  } else if (monsterStyle?.includes("smash")) {
    monsterAccuracy = md.smashAccuracyRating;
    playerEvasionVsMonster = pd.smashEvasionRating;
  }

  // Compute hit chances (accuracy^1.4 / (accuracy^1.4 + evasion^1.4))
  const playerHitChance = Math.min(
    1,
    Math.max(
      0,
      Math.pow(playerAccuracy, 1.4) /
        (Math.pow(playerAccuracy, 1.4) +
          Math.pow(monsterEvasionVsPlayer, 1.4))
    )
  );
  const monsterHitChanceVsPlayer = Math.min(
    1,
    Math.max(
      0,
      Math.pow(monsterAccuracy, 1.4) /
        (Math.pow(monsterAccuracy, 1.4) +
          Math.pow(playerEvasionVsMonster, 1.4))
    )
  );

  // List abilities
  const abilities = player.abilities
    .filter((a): a is Ability => a !== null)
    .map((a) => `${a.hrid.split("/").pop()} (lvl ${a.level})`);

  // --- Run the actual fight ---
  const zone = Zone.createLabyrinthZone(monsterHrid);
  const fightPlayer = Player.createFromDTO(playerConfig, gameData, deps);
  fightPlayer.extraBuffs = [...crateBuffs, ...sealBuffs];
  fightPlayer.wisdomBuffBonus = wisdomBuffBonus;
  fightPlayer.food = [null, null, null];
  fightPlayer.drinks = [null, null, null];

  const timeLimitNs = 120e9;
  const simulator = new DeterministicSimulator([fightPlayer], zone, gameData, {
    stopAfterFirstEncounter: true,
    labyrinthTargetLevel: targetLevel,
    maxSimTimeNs: timeLimitNs,
  });
  const simResult = simulator.simulate();

  const simTimeNs = simResult.totalSimTimeNs;
  const monsterKilled = simResult.encounters > 0;
  const fightTimeSec = simTimeNs / 1e9;

  // Extract player stats from SimResult
  const playerKey = Object.keys(simResult.playerStats).find(
    (k) => !k.startsWith("/")
  );
  const ps = playerKey ? simResult.playerStats[playerKey] : null;

  const totalDamageDealt = ps?.totalDamageDealt ?? 0;
  const totalHealingReceived = ps?.totalHealingReceived ?? 0;
  const totalManaUsed = ps?.totalManaUsed ?? 0;

  // Get player's HP/MP at end of fight
  const fightPd = fightPlayer.combatDetails;
  const playerHpAtEnd = fightPd.currentHitpoints;
  const playerMpAtEnd = fightPd.currentManapoints;
  const playerMaxHpFight = fightPd.maxHitpoints;

  // Compute total damage taken: startHP - endHP + healing received
  // If player died, endHP = 0 and we know the damage exceeded maxHP
  const totalDamageTaken =
    playerMaxHpFight - playerHpAtEnd + totalHealingReceived;

  return {
    level: targetLevel,
    success: monsterKilled,
    fightTimeSec,
    // Player stats (with all buffs applied)
    playerMaxHp: pd.maxHitpoints,
    playerMaxMp: pd.maxManapoints,
    playerHpRegen: pd.combatStats.hpRegenPer10,
    playerMpRegen: pd.combatStats.mpRegenPer10,
    playerAttackInterval: pd.combatStats.attackInterval,
    playerDamageType: playerDamageType,
    playerAccuracy,
    playerMaxDamage,
    playerCritRate: pd.combatStats.criticalRate,
    playerCritDamage: pd.combatStats.criticalDamage,
    playerArmor: pd.totalArmor,
    playerFireRes: pd.totalFireResistance,
    playerWaterRes: pd.totalWaterResistance,
    playerNatureRes: pd.totalNatureResistance,
    playerLifeSteal: pd.combatStats.lifeSteal,
    playerManaLeech: pd.combatStats.manaLeech,
    playerCastSpeed: pd.combatStats.castSpeed,
    playerAttackSpeed: pd.combatStats.attackSpeed,
    playerParry: pd.combatStats.parry,
    playerTenacity: pd.combatStats.tenacity,
    // Monster stats
    monsterMaxHp: md.maxHitpoints,
    monsterDamageType: monsterDamageType,
    monsterCombatStyle: md.combatStats.combatStyleHrid,
    monsterAccuracy,
    monsterMaxDamage: Math.max(
      md.stabMaxDamage,
      md.slashMaxDamage,
      md.smashMaxDamage,
      md.rangedMaxDamage,
      md.magicMaxDamage
    ),
    monsterArmor: md.totalArmor,
    monsterFireRes: md.totalFireResistance,
    monsterWaterRes: md.totalWaterResistance,
    monsterNatureRes: md.totalNatureResistance,
    monsterEvasionVsPlayer,
    monsterAbilities: monster.abilities
      .filter((a): a is Ability => a !== null)
      .map((a) => `${a.hrid.split("/").pop()} (lvl ${a.level})`),
    // Fight results
    playerEffectiveDps: fightTimeSec > 0 ? totalDamageDealt / fightTimeSec : 0,
    totalDamageTaken,
    monsterEffectiveDps:
      fightTimeSec > 0 ? totalDamageTaken / fightTimeSec : 0,
    totalDamageDealt,
    totalHealingReceived,
    totalManaUsed,
    ranOutOfMana: ps?.ranOutOfMana ?? false,
    outOfManaTimeSec: (ps?.outOfManaTimeNs ?? 0) / 1e9,
    playerDeaths: ps?.deaths ?? 0,
    playerHpAtEnd,
    playerMpAtEnd,
    // Hit chance
    playerHitChance,
    monsterHitChanceVsPlayer,
    // Abilities
    abilities,
    manaByAbility: ps?.manaByAbility ?? {},
    healingBySource: ps?.healingBySource ?? {},
  };
}

// =============================================================================
// Pretty printer
// =============================================================================

function printDiagnostic(monsterName: string, r: DiagnosticResult): void {
  console.log(
    `\n--- ${monsterName} Level ${r.level}: ${r.success ? "KILL" : "FAIL"} ---`
  );
  console.log(`  Fight time: ${r.fightTimeSec.toFixed(1)}s / 120s`);
  console.log(`  Time remaining: ${(120 - r.fightTimeSec).toFixed(1)}s`);

  console.log(`\n  Player stats:`);
  console.log(`    HP: ${r.playerMaxHp}  MP: ${r.playerMaxMp}`);
  console.log(
    `    HP regen/10: ${r.playerHpRegen.toFixed(3)}  MP regen/10: ${r.playerMpRegen.toFixed(3)}`
  );
  console.log(
    `    Attack interval: ${r.playerAttackInterval.toFixed(0)}ns (${(r.playerAttackInterval / 1e9).toFixed(2)}s)`
  );
  console.log(`    Combat style: ${r.playerDamageType}`);
  console.log(
    `    Accuracy: ${r.playerAccuracy.toFixed(0)}  Max damage: ${r.playerMaxDamage.toFixed(0)}`
  );
  console.log(
    `    Crit: ${(r.playerCritRate * 100).toFixed(1)}% rate, ${(r.playerCritDamage * 100).toFixed(0)}% bonus`
  );
  console.log(
    `    Armor: ${r.playerArmor.toFixed(1)}  FireRes: ${r.playerFireRes.toFixed(1)}  WaterRes: ${r.playerWaterRes.toFixed(1)}  NatureRes: ${r.playerNatureRes.toFixed(1)}`
  );
  console.log(
    `    LifeSteal: ${(r.playerLifeSteal * 100).toFixed(1)}%  ManaLeech: ${(r.playerManaLeech * 100).toFixed(1)}%  Parry: ${(r.playerParry * 100).toFixed(1)}%  Tenacity: ${r.playerTenacity.toFixed(0)}`
  );
  console.log(
    `    Attack speed: ${(r.playerAttackSpeed * 100).toFixed(1)}%  Cast speed: ${(r.playerCastSpeed * 100).toFixed(1)}%`
  );
  console.log(`    Abilities: ${r.abilities.join(", ") || "none"}`);
  console.log(`    Hit chance vs monster: ${(r.playerHitChance * 100).toFixed(1)}%`);

  console.log(`\n  Monster stats:`);
  console.log(`    HP: ${r.monsterMaxHp}  Style: ${r.monsterCombatStyle}  DmgType: ${r.monsterDamageType}`);
  console.log(
    `    Accuracy: ${r.monsterAccuracy.toFixed(0)}  Max damage: ${r.monsterMaxDamage.toFixed(0)}`
  );
  console.log(`    Armor: ${r.monsterArmor.toFixed(1)}  FireRes: ${r.monsterFireRes.toFixed(1)}  WaterRes: ${r.monsterWaterRes.toFixed(1)}  NatureRes: ${r.monsterNatureRes.toFixed(1)}`);
  console.log(
    `    Evasion vs player: ${r.monsterEvasionVsPlayer.toFixed(0)}`
  );
  console.log(
    `    Hit chance vs player: ${(r.monsterHitChanceVsPlayer * 100).toFixed(1)}%`
  );
  console.log(`    Abilities: ${r.monsterAbilities.join(", ") || "none"}`);

  // Show damage reduction from player's resistance vs monster's damage type
  const dmgType = r.monsterDamageType.split("/").pop();
  let playerResistance = r.playerArmor;
  if (dmgType === "fire") playerResistance = r.playerFireRes;
  else if (dmgType === "water") playerResistance = r.playerWaterRes;
  else if (dmgType === "nature") playerResistance = r.playerNatureRes;
  console.log(
    `    Player ${dmgType} defense: ${playerResistance.toFixed(1)} → damage reduction: ${(playerResistance / (playerResistance + 100) * 100).toFixed(1)}%`
  );

  console.log(`\n  Fight results:`);
  console.log(`    Player HP at end: ${r.playerHpAtEnd}/${r.playerMaxHp}`);
  console.log(`    Player MP at end: ${r.playerMpAtEnd}/${r.playerMaxMp}`);
  console.log(`    Player effective DPS: ${r.playerEffectiveDps.toFixed(1)}`);
  console.log(`    Total damage dealt: ${r.totalDamageDealt.toFixed(0)}`);
  console.log(`    Total damage taken: ${r.totalDamageTaken.toFixed(0)}`);
  console.log(`    Total healing received: ${r.totalHealingReceived.toFixed(0)}`);
  console.log(`    Net HP deficit: ${(r.playerMaxHp - r.playerHpAtEnd).toFixed(0)} (${((r.playerMaxHp - r.playerHpAtEnd) / r.playerMaxHp * 100).toFixed(0)}% of max HP)`);
  console.log(`    Total mana used: ${r.totalManaUsed.toFixed(0)}`);
  console.log(`    OOM: ${r.ranOutOfMana ? `YES (${r.outOfManaTimeSec.toFixed(1)}s)` : "no"}`);
  console.log(`    Deaths: ${r.playerDeaths}`);

  if (Object.keys(r.manaByAbility).length > 0) {
    console.log(`    Mana by ability:`);
    for (const [ability, mana] of Object.entries(r.manaByAbility)) {
      console.log(`      ${ability.split("/").pop()}: ${mana.toFixed(0)}`);
    }
  }

  if (Object.keys(r.healingBySource).length > 0) {
    console.log(`    Healing by source:`);
    for (const [source, amount] of Object.entries(r.healingBySource)) {
      console.log(`      ${source}: ${amount.toFixed(0)}`);
    }
  }

  // DPS analysis
  const dpsNeeded = r.monsterMaxHp / 120;
  console.log(`\n  DPS analysis:`);
  console.log(`    Monster HP: ${r.monsterMaxHp}`);
  console.log(`    DPS needed (120s): ${dpsNeeded.toFixed(0)}`);
  console.log(`    Player effective DPS: ${r.playerEffectiveDps.toFixed(0)}`);
  console.log(`    DPS margin: ${((r.playerEffectiveDps / dpsNeeded - 1) * 100).toFixed(1)}%`);

  // Survivability analysis
  const hpRegenPerSec = r.playerMaxHp * r.playerHpRegen / 10;
  console.log(`\n  Survivability:`);
  console.log(`    HP regen/sec: ${hpRegenPerSec.toFixed(1)}`);
  console.log(`    Monster effective DPS: ${r.monsterEffectiveDps.toFixed(1)}`);
  console.log(`    Damage taken / HP pool: ${(r.totalDamageTaken / r.playerMaxHp * 100).toFixed(0)}%`);
  console.log(`    HP margin at kill: ${r.success ? `${r.playerHpAtEnd} HP (${(r.playerHpAtEnd / r.playerMaxHp * 100).toFixed(1)}%)` : "DEAD"}`);
}

// =============================================================================
// Helper: resolve loadout for a monster
// =============================================================================

function getMonsterLoadout(
  monsterHrid: string,
  parsed: FullCharacterData
): PlayerConfig {
  const loadoutId = parsed.labyrinthMonsterLoadouts[monsterHrid];
  if (loadoutId) {
    const loadout = parsed.combatLoadouts.find((l) => l.id === loadoutId);
    if (loadout) return loadout.config;
  }
  // Fall back to first combat loadout
  return parsed.combatLoadouts[0].config;
}

// =============================================================================
// Tests
// =============================================================================

describe("Labyrinth Diagnostic", () => {
  it("should list available loadouts and monster assignments", () => {
    console.log("\n=== Available Loadouts ===");
    for (const l of parsed.combatLoadouts) {
      const weapon =
        l.config.equipment["/equipment_types/main_hand" as any]?.hrid ??
        l.config.equipment["/equipment_types/two_hand" as any]?.hrid ??
        "no weapon";
      console.log(
        `  [${l.id}] "${l.name}" — ${weapon.split("/").pop()}`
      );
    }

    console.log("\n=== Labyrinth Monster Loadout Assignments ===");
    for (const [monster, loadoutId] of Object.entries(
      parsed.labyrinthMonsterLoadouts
    )) {
      const loadout = parsed.combatLoadouts.find((l) => l.id === loadoutId);
      console.log(
        `  ${monster.split("/").pop()} → "${loadout?.name ?? "?"}" [${loadoutId}]`
      );
    }

    console.log("\n=== Labyrinth Crate Selections ===");
    console.log(`  Coffee: ${parsed.labyrinthCrates.coffeeCrate || "none"}`);
    console.log(`  Food: ${parsed.labyrinthCrates.foodCrate || "none"}`);
    console.log(`  Tea: ${parsed.labyrinthCrates.teaCrate || "none"}`);

    expect(parsed.combatLoadouts.length).toBeGreaterThan(0);
  });

  it(
    "should find raw max levels for salamander and siren",
    { timeout: 120_000 },
    () => {
      const monsters = ["/monsters/salamander", "/monsters/siren"];

      console.log("\n=== Binary Search Max Levels ===");
      for (const monsterHrid of monsters) {
        const config = getMonsterLoadout(monsterHrid, parsed);
        const result = findMaxLabyrinthLevel(
          config,
          monsterHrid,
          crateBuffs,
          wisdomBuffBonus,
          gameData,
          300,
          undefined,
          0.5
        );
        const name = monsterHrid.split("/").pop();
        console.log(
          `  ${name}: rawMax=${result.rawMaxLevel} adjusted=${result.maxLevel} killTime=${(result.killTimeNs / 1e9).toFixed(1)}s`
        );
      }
    }
  );

  it(
    "should run detailed diagnostic for salamander at key levels",
    { timeout: 120_000 },
    () => {
      const monsterHrid = "/monsters/salamander";
      const config = getMonsterLoadout(monsterHrid, parsed);
      const monsterName = "Salamander";

      // First find the raw max
      const maxResult = findMaxLabyrinthLevel(
        config,
        monsterHrid,
        crateBuffs,
        wisdomBuffBonus,
        gameData,
        300,
        undefined,
        0.5
      );
      console.log(
        `\n=== ${monsterName} Diagnostic (rawMax=${maxResult.rawMaxLevel}) ===`
      );
      console.log(
        `User cleared: 217 | Sim rawMax: ${maxResult.rawMaxLevel} | Gap: ${217 - maxResult.rawMaxLevel}`
      );

      // Test at key levels
      const levels = [
        maxResult.rawMaxLevel,
        200,
        210,
        217, // user cleared this
        225,
      ].filter((l, i, arr) => arr.indexOf(l) === i).sort((a, b) => a - b);

      for (const level of levels) {
        const result = runDiagnosticFight(config, monsterHrid, level);
        printDiagnostic(monsterName, result);
      }

      // At least the rawMax level should succeed
      const rawMaxResult = runDiagnosticFight(
        config,
        monsterHrid,
        maxResult.rawMaxLevel
      );
      expect(rawMaxResult.success).toBe(true);
    }
  );

  it(
    "should run detailed diagnostic for siren at key levels",
    { timeout: 120_000 },
    () => {
      const monsterHrid = "/monsters/siren";
      const config = getMonsterLoadout(monsterHrid, parsed);
      const monsterName = "Siren";

      const maxResult = findMaxLabyrinthLevel(
        config,
        monsterHrid,
        crateBuffs,
        wisdomBuffBonus,
        gameData,
        300,
        undefined,
        0.5
      );
      console.log(
        `\n=== ${monsterName} Diagnostic (rawMax=${maxResult.rawMaxLevel}) ===`
      );
      console.log(
        `User cleared: 215 | Sim rawMax: ${maxResult.rawMaxLevel} | Gap: ${215 - maxResult.rawMaxLevel}`
      );

      const levels = [
        maxResult.rawMaxLevel,
        200,
        210,
        215, // user cleared this
        220,
      ].filter((l, i, arr) => arr.indexOf(l) === i).sort((a, b) => a - b);

      for (const level of levels) {
        const result = runDiagnosticFight(config, monsterHrid, level);
        printDiagnostic(monsterName, result);
      }

      const rawMaxResult = runDiagnosticFight(
        config,
        monsterHrid,
        maxResult.rawMaxLevel
      );
      expect(rawMaxResult.success).toBe(true);
    }
  );

  it(
    "should verify frost sniper player stats against in-game screenshot",
    { timeout: 30_000 },
    () => {
      const monsterHrid = "/monsters/frost_sniper";
      const config = getMonsterLoadout(monsterHrid, parsed);
      const deps = buildPlayerDeps(gameData);
      const player = Player.createFromDTO(config, gameData, deps);

      // Apply crate + seal buffs (same as labyrinth)
      player.extraBuffs = [...crateBuffs, ...sealBuffs];
      player.wisdomBuffBonus = wisdomBuffBonus;
      player.food = [null, null, null];
      player.drinks = [null, null, null];
      player.generatePermanentBuffs();
      player.clearBuffs();

      const pd = player.combatDetails;

      // --- Base stats (equipment + house + crate + seal, NO ability buffs) ---
      console.log("\n=== Frost Sniper Loadout - Base Stats (no ability buffs) ===");
      console.log(`  Combat style: ${pd.combatStats.combatStyleHrid}`);
      console.log(`  Damage type: ${pd.combatStats.damageType}`);
      console.log(`  Smash Accuracy: ${pd.smashAccuracyRating.toFixed(1)}`);
      console.log(`  Smash Max Damage: ${pd.smashMaxDamage.toFixed(1)}`);
      console.log(`  Defensive Max Damage: ${pd.defensiveMaxDamage.toFixed(1)}`);
      console.log(`  Crit Rate: ${(pd.combatStats.criticalRate * 100).toFixed(2)}%`);
      console.log(`  Crit Damage: ${(pd.combatStats.criticalDamage * 100).toFixed(1)}%`);
      console.log(`  Physical Amplify: ${(pd.combatStats.physicalAmplify * 100).toFixed(2)}%`);
      console.log(`  Retaliation: ${(pd.combatStats.retaliation * 100).toFixed(2)}%`);
      console.log(`  Max HP: ${pd.maxHitpoints}`);
      console.log(`  Max MP: ${pd.maxManapoints}`);
      console.log(`  Armor: ${pd.totalArmor.toFixed(1)}`);
      console.log(`  Water Res: ${pd.totalWaterResistance.toFixed(1)}`);
      console.log(`  Fire Res: ${pd.totalFireResistance.toFixed(1)}`);
      console.log(`  Nature Res: ${pd.totalNatureResistance.toFixed(1)}`);
      console.log(`  HP Regen/10: ${(pd.combatStats.hpRegenPer10 * 100).toFixed(2)}%`);
      console.log(`  MP Regen/10: ${(pd.combatStats.mpRegenPer10 * 100).toFixed(2)}%`);
      console.log(`  Attack Interval: ${(pd.combatStats.attackInterval / 1e9).toFixed(3)}s`);
      console.log(`  Attack Speed: ${(pd.combatStats.attackSpeed * 100).toFixed(1)}%`);
      console.log(`  Cast Speed: ${(pd.combatStats.castSpeed * 100).toFixed(1)}%`);
      console.log(`  Tenacity: ${pd.combatStats.tenacity.toFixed(0)}`);
      console.log(`  Weaken: ${(pd.combatStats.weaken * 100).toFixed(1)}%`);
      console.log(`  Task Damage: ${(pd.combatStats.taskDamage * 100).toFixed(1)}%`);
      console.log(`  Life Steal: ${(pd.combatStats.lifeSteal * 100).toFixed(1)}%`);
      console.log(`  Parry: ${(pd.combatStats.parry * 100).toFixed(1)}%`);

      // Abilities
      const abilities = player.abilities
        .filter((a): a is Ability => a !== null)
        .map((a) => `${a.hrid.split("/").pop()} (lvl ${a.level})`);
      console.log(`  Abilities: ${abilities.join(", ")}`);

      // --- In-game screenshot stats (with Berserk + Retribution active) ---
      // Screenshot shows: Smash Accuracy=1112, Smash Damage=608, Defensive Damage=429
      //   CritRate=29.05%, CritDmg=10%, PhysAmplify=35.82%, Retaliation=41.25%
      //   MaxHP=2656, MaxMP=2006, Armor=299, WaterRes=192, FireRes=192, NatureRes=153
      //   HP Regen=8.31%, MP Regen=8.07%, Attack Interval=1.76s, CastSpeed=49.7%
      //   Tenacity=140, Weaken=3%, TaskDamage=+15%
      //   Abilities: Lv.42, Lv.100, Lv.90, Lv.66, Lv.74

      console.log("\n=== Comparison with In-Game Screenshot (abilities active) ===");
      console.log("NOTE: Screenshot has Berserk + Retribution active (possibly others).");
      console.log("Stats like physicalAmplify and retaliation will differ from base.");

      // Stats that should match WITHOUT ability buffs:
      // Max HP, Max MP, Armor, Resistances, Tenacity (these aren't modified by Berserk/Retribution/etc)
      const staticChecks: [string, number, number][] = [
        ["Max HP", pd.maxHitpoints, 2656],
        ["Max MP", pd.maxManapoints, 2006],
        ["Armor", pd.totalArmor, 299],
        ["Water Res", pd.totalWaterResistance, 192],
        ["Fire Res", pd.totalFireResistance, 192],
        ["Nature Res", pd.totalNatureResistance, 153],
        ["Tenacity", pd.combatStats.tenacity, 140],
      ];

      console.log("\n  Static stats (not affected by ability buffs):");
      let anyMismatch = false;
      for (const [name, simVal, gameVal] of staticChecks) {
        const pctDiff = gameVal !== 0
          ? ((simVal - gameVal) / gameVal * 100).toFixed(1)
          : simVal === 0 ? "0.0" : "INF";
        const match = Math.abs(simVal - gameVal) <= Math.max(1, gameVal * 0.01);
        const marker = match ? "OK" : "MISMATCH";
        if (!match) anyMismatch = true;
        console.log(`    ${name}: sim=${typeof simVal === 'number' && simVal % 1 !== 0 ? simVal.toFixed(1) : simVal} game=${gameVal} (${pctDiff}%) [${marker}]`);
      }

      // Stats that are modified by abilities (screenshot has buffs active):
      // We log both base and screenshot so user can manually verify the buff contributions
      console.log("\n  Dynamic stats (ability buffs affect these):");
      console.log(`    Smash Accuracy: base=${pd.smashAccuracyRating.toFixed(1)} screenshot=1112`);
      console.log(`    Smash MaxDamage: base=${pd.smashMaxDamage.toFixed(1)} screenshot=608`);
      console.log(`    Defensive MaxDamage: base=${pd.defensiveMaxDamage.toFixed(1)} screenshot=429`);
      console.log(`    Crit Rate: base=${(pd.combatStats.criticalRate * 100).toFixed(2)}% screenshot=29.05%`);
      console.log(`    Crit Damage: base=${(pd.combatStats.criticalDamage * 100).toFixed(1)}% screenshot=10%`);
      console.log(`    Physical Amplify: base=${(pd.combatStats.physicalAmplify * 100).toFixed(2)}% screenshot=35.82%`);
      console.log(`    Retaliation: base=${(pd.combatStats.retaliation * 100).toFixed(2)}% screenshot=41.25%`);
      console.log(`    HP Regen: base=${(pd.combatStats.hpRegenPer10 * 100).toFixed(2)}% screenshot=8.31%`);
      console.log(`    MP Regen: base=${(pd.combatStats.mpRegenPer10 * 100).toFixed(2)}% screenshot=8.07%`);
      console.log(`    Attack Interval: base=${(pd.combatStats.attackInterval / 1e9).toFixed(3)}s screenshot=1.76s`);
      console.log(`    Cast Speed: base=${(pd.combatStats.castSpeed * 100).toFixed(1)}% screenshot=49.7%`);
      console.log(`    Weaken: base=${(pd.combatStats.weaken * 100).toFixed(1)}% screenshot=3%`);
      console.log(`    Task Damage: base=${(pd.combatStats.taskDamage * 100).toFixed(1)}% screenshot=15%`);

      if (anyMismatch) {
        console.log("\n  WARNING: Static stat mismatches detected! These should match exactly.");
      } else {
        console.log("\n  All static stats match within 1%.");
      }

      // This test always passes - it's for diagnostic output
      expect(true).toBe(true);
    }
  );

  it(
    "should run detailed diagnostic for frost sniper at key levels",
    { timeout: 120_000 },
    () => {
      const monsterHrid = "/monsters/frost_sniper";
      const config = getMonsterLoadout(monsterHrid, parsed);
      const monsterName = "Frost Sniper";

      // Find the raw max
      const maxResult = findMaxLabyrinthLevel(
        config,
        monsterHrid,
        crateBuffs,
        wisdomBuffBonus,
        gameData,
        300,
        undefined,
        0.5
      );
      console.log(
        `\n=== ${monsterName} Diagnostic (rawMax=${maxResult.rawMaxLevel}) ===`
      );
      console.log(
        `User cleared: 221 | Sim rawMax: ${maxResult.rawMaxLevel} | Gap: ${221 - maxResult.rawMaxLevel}`
      );

      // Test at key levels: rawMax, 215 (UI result), 218, 221 (user cleared), 225
      const levels = [
        maxResult.rawMaxLevel,
        215,
        218,
        221, // user cleared this easily
        225,
      ]
        .filter((l, i, arr) => arr.indexOf(l) === i)
        .sort((a, b) => a - b);

      for (const level of levels) {
        const result = runDiagnosticFight(config, monsterHrid, level);
        printDiagnostic(monsterName, result);
      }

      // At least the rawMax level should succeed
      const rawMaxResult = runDiagnosticFight(
        config,
        monsterHrid,
        maxResult.rawMaxLevel
      );
      expect(rawMaxResult.success).toBe(true);
    }
  );

  it(
    "should run diagnostic for all labyrinth monsters at their max levels",
    { timeout: 300_000 },
    () => {
      const labMonsters = Object.entries(
        gameData.combatMonsterDetailMap
      )
        .filter(([, m]) => m.isLabyrinthMonster)
        .map(([hrid]) => hrid);

      console.log("\n=== All Monsters: Max Level Summary ===");
      console.log(
        "Monster".padEnd(20) +
          "Max".padStart(5) +
          "Kill(s)".padStart(9) +
          "DPS".padStart(8) +
          "Hit%".padStart(7) +
          "MHP".padStart(8) +
          "OOM".padStart(5) +
          "Deaths".padStart(7)
      );
      console.log("-".repeat(69));

      for (const monsterHrid of labMonsters) {
        const config = getMonsterLoadout(monsterHrid, parsed);
        const maxResult = findMaxLabyrinthLevel(
          config,
          monsterHrid,
          crateBuffs,
          wisdomBuffBonus,
          gameData,
          300,
          undefined,
          0.5
        );

        if (maxResult.rawMaxLevel <= 0) {
          const name = monsterHrid.split("/").pop()!;
          console.log(`${name.padEnd(20)}  CANNOT CLEAR`);
          continue;
        }

        const diag = runDiagnosticFight(
          config,
          monsterHrid,
          maxResult.rawMaxLevel
        );
        const name = monsterHrid.split("/").pop()!;
        console.log(
          `${name.padEnd(20)}` +
            `${maxResult.rawMaxLevel.toString().padStart(5)}` +
            `${diag.fightTimeSec.toFixed(1).padStart(9)}` +
            `${diag.playerEffectiveDps.toFixed(0).padStart(8)}` +
            `${(diag.playerHitChance * 100).toFixed(0).padStart(6)}%` +
            `${diag.monsterMaxHp.toString().padStart(8)}` +
            `${(diag.ranOutOfMana ? "YES" : " no").padStart(5)}` +
            `${diag.playerDeaths.toString().padStart(7)}`
        );
      }
    }
  );
});
