// Vitest test: Compare magic vs ranged loadout against salamander at various levels
// Usage: npx vitest run test_salamander_loadout
//
// Context: Labyrinth optimizer recommends water/magic against salamander, but
// salamander has 2052 magic evasion vs 501 ranged evasion (4:1 ratio).
// However, magic gear is +11-15 while ranged is +7 with +0 charm.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type {
  GameData,
  PlayerConfig,
  EquipmentDTO,
  EquipmentSlotHrid,
  AbilityDTO,
  BuffData,
  AbilityEffectData,
} from "./src/engine/types";
import { parseFullCharacterData, type CombatLoadout } from "./src/data/fullCharacterData";
import {
  buildCrateBuffs,
  simulateLabyrinthFight,
  findMaxLabyrinthLevel,
  computeLevelBasedClearRate,
} from "./src/features/labyrinthSimulator";
import Buff from "./src/engine/buff";
import Player from "./src/engine/player";
import Monster from "./src/engine/monster";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const fullCharJson = readFileSync(
  "live_data/gragatrim_full_char_data.json",
  "utf-8"
);

describe("Salamander: Magic vs Ranged Loadout Comparison", () => {
  it(
    "should compare DPS and kill time at multiple levels",
    { timeout: 60_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);

      // Magic loadout: "crit wis mag charm"
      const magicLoadout = parsed.combatLoadouts.find(
        (l) => l.name === "crit wis mag charm"
      );
      expect(magicLoadout, "Magic loadout 'crit wis mag charm' not found").toBeTruthy();

      // Ranged loadout: "salamander"
      const rangedLoadout = parsed.combatLoadouts.find(
        (l) => l.name === "salamander"
      );
      expect(rangedLoadout, "Ranged loadout 'salamander' not found").toBeTruthy();

      const crateBuffs = buildCrateBuffs("expert", "expert");
      const monsterHrid = "/monsters/salamander";
      const levels = [150, 175, 200, 210, 218, 225];

      console.log("\n=== Salamander: Magic vs Ranged Loadout Comparison ===");
      console.log(
        "Level".padStart(6) +
          " | " +
          "Magic".padStart(12) +
          " | " +
          "Ranged".padStart(12) +
          " | " +
          "Winner".padStart(8)
      );
      console.log("-".repeat(50));

      const results: {
        level: number;
        magic: { success: boolean; killTimeNs: number; dps: number };
        ranged: { success: boolean; killTimeNs: number; dps: number };
      }[] = [];

      // Get salamander base HP for DPS calc
      const monsterData = gameData.combatMonsterDetailMap[monsterHrid];
      const baseHp = monsterData?.combatDetails?.maxHitpoints ?? 0;

      for (const level of levels) {
        const scaledHp = (baseHp * level) / 100;

        const magicResult = simulateLabyrinthFight(
          magicLoadout!.config,
          monsterHrid,
          level,
          crateBuffs,
          [],
          0,
          gameData
        );

        const rangedResult = simulateLabyrinthFight(
          rangedLoadout!.config,
          monsterHrid,
          level,
          crateBuffs,
          [],
          0,
          gameData
        );

        const magicTimeSec = magicResult.killTimeNs / 1e9;
        const rangedTimeSec = rangedResult.killTimeNs / 1e9;
        const magicDps = magicResult.success ? scaledHp / magicTimeSec : 0;
        const rangedDps = rangedResult.success ? scaledHp / rangedTimeSec : 0;

        results.push({
          level,
          magic: { ...magicResult, dps: magicDps },
          ranged: { ...rangedResult, dps: rangedDps },
        });

        const magicStr = magicResult.success
          ? `${magicTimeSec.toFixed(1)}s ${magicDps.toFixed(0)}dps`
          : "FAIL";
        const rangedStr = rangedResult.success
          ? `${rangedTimeSec.toFixed(1)}s ${rangedDps.toFixed(0)}dps`
          : "FAIL";

        let winner: string;
        if (!magicResult.success && !rangedResult.success) winner = "BOTH FAIL";
        else if (!magicResult.success) winner = "RANGED";
        else if (!rangedResult.success) winner = "MAGIC";
        else winner = magicTimeSec < rangedTimeSec ? "MAGIC" : "RANGED";

        console.log(
          `${String(level).padStart(6)} | ${magicStr.padStart(12)} | ${rangedStr.padStart(12)} | ${winner.padStart(8)}`
        );
      }

      console.log("\n=== Summary ===");
      console.log(`Magic loadout:  ${magicLoadout!.name}`);
      console.log(`Ranged loadout: ${rangedLoadout!.name}`);
      console.log(
        `Salamander evasions — Magic: ${monsterData?.combatDetails?.magicEvasion ?? "?"}, Ranged: ${monsterData?.combatDetails?.rangedEvasion ?? "?"}`
      );

      // At least one level should produce a result
      expect(results.some((r) => r.magic.success || r.ranged.success)).toBe(true);
    }
  );
});

// =============================================================================
// Helpers that replicate labyrinthOptimizer internals for diagnostic purposes
// =============================================================================

const WEAPON_SLOTS = ["/equipment_types/main_hand", "/equipment_types/two_hand"];

function cloneConfig(config: PlayerConfig): PlayerConfig {
  return JSON.parse(JSON.stringify(config));
}

function getItemSlotType(itemHrid: string): string | null {
  return gameData.itemDetailMap[itemHrid]?.equipmentDetail?.type ?? null;
}

function getWeaponCombatStyle(weaponHrid: string): string | null {
  const item = gameData.itemDetailMap[weaponHrid];
  return item?.equipmentDetail?.combatStats?.combatStyleHrids?.[0] ?? null;
}

function collectWeaponPool(gearPool: Map<string, EquipmentDTO[]>): EquipmentDTO[] {
  const seen = new Set<string>();
  const weapons: EquipmentDTO[] = [];
  for (const slot of WEAPON_SLOTS) {
    const items = gearPool.get(slot);
    if (!items) continue;
    for (const item of items) {
      const key = `${item.hrid}:${item.enhancementLevel}`;
      if (!seen.has(key)) {
        seen.add(key);
        weapons.push(item);
      }
    }
  }
  return weapons;
}

function findLoadoutForWeapon(
  weapon: EquipmentDTO,
  combatLoadouts: CombatLoadout[]
): CombatLoadout | null {
  for (const loadout of combatLoadouts) {
    const eq = loadout.config.equipment;
    for (const slot of WEAPON_SLOTS) {
      const item = eq[slot as EquipmentSlotHrid];
      if (item && item.hrid === weapon.hrid && item.enhancementLevel === weapon.enhancementLevel) {
        return loadout;
      }
    }
  }
  return combatLoadouts[0] ?? null;
}

function setWeaponOnConfig(config: PlayerConfig, weapon: EquipmentDTO): void {
  const slotType = getItemSlotType(weapon.hrid);
  if (slotType === "/equipment_types/two_hand") {
    config.equipment["/equipment_types/two_hand"] = weapon;
    config.equipment["/equipment_types/main_hand"] = null;
    config.equipment["/equipment_types/off_hand"] = null;
  } else if (slotType === "/equipment_types/main_hand") {
    config.equipment["/equipment_types/main_hand"] = weapon;
    config.equipment["/equipment_types/two_hand"] = null;
  }
}

/** Summarize a config's equipment enhancement levels for logging. */
function summarizeGear(config: PlayerConfig): string {
  const parts: string[] = [];
  for (const [slot, item] of Object.entries(config.equipment)) {
    if (!item) continue;
    const shortSlot = slot.split("/").pop()!;
    const shortItem = item.hrid.split("/").pop()!;
    parts.push(`${shortSlot}:${shortItem}+${item.enhancementLevel}`);
  }
  return parts.join(", ");
}

// =============================================================================
// Step 1: Optimizer diagnostic — which weapon does it pick for salamander?
// =============================================================================

describe("Salamander: Optimizer Per-Weapon Diagnostic", () => {
  it(
    "should test every weapon in the gear pool against salamander",
    { timeout: 120_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);
      const crateBuffs = buildCrateBuffs("expert", "expert");
      const monsterHrid = "/monsters/salamander";

      // Show the override loadout for salamander
      const overrideLoadoutId = parsed.labyrinthMonsterLoadouts[monsterHrid];
      const overrideLoadout = overrideLoadoutId
        ? parsed.combatLoadouts.find((l) => l.id === overrideLoadoutId)
        : null;
      const defaultLoadout = parsed.combatLoadouts[0];
      const baselineLoadout = overrideLoadout ?? defaultLoadout;

      console.log("\n=== Salamander Optimizer Diagnostic ===");
      console.log(`Override loadout ID for salamander: ${overrideLoadoutId ?? "NONE"}`);
      console.log(`Baseline loadout: "${baselineLoadout.name}" (id=${baselineLoadout.id})`);

      // Step 1: Find baseline level
      const baseline = findMaxLabyrinthLevel(
        baselineLoadout.config,
        monsterHrid,
        crateBuffs,
        [],
        0,
        gameData,
        300,
        undefined,
        0.5
      );
      console.log(
        `\nBaseline: level ${baseline.maxLevel} (raw=${baseline.rawMaxLevel}), ` +
        `kill time ${(baseline.killTimeNs / 1e9).toFixed(1)}s`
      );
      const baseWeapon =
        baselineLoadout.config.equipment["/equipment_types/two_hand"]?.hrid ??
        baselineLoadout.config.equipment["/equipment_types/main_hand"]?.hrid ??
        "(none)";
      console.log(`Baseline weapon: ${baseWeapon}`);

      // Step 2: Try every weapon in the gear pool
      const weaponPool = collectWeaponPool(parsed.gearPool);
      console.log(`\nWeapon pool (${weaponPool.length} weapons):`);
      for (const w of weaponPool) {
        const style = getWeaponCombatStyle(w.hrid);
        const sourceLoadout = findLoadoutForWeapon(w, parsed.combatLoadouts);
        console.log(
          `  ${w.hrid.split("/").pop()}+${w.enhancementLevel} ` +
          `(${style?.split("/").pop() ?? "?"}) ` +
          `← loadout "${sourceLoadout?.name ?? "?"}"`
        );
      }

      console.log("\n--- Per-weapon max level results ---");
      console.log(
        "Weapon".padEnd(40) +
        " | " + "Style".padEnd(8) +
        " | " + "Source Loadout".padEnd(25) +
        " | " + "Max Lvl".padStart(7) +
        " | " + "Raw Lvl".padStart(7) +
        " | " + "Kill Time".padStart(10)
      );
      console.log("-".repeat(110));

      let bestWeapon: EquipmentDTO | null = null;
      let bestLevel = baseline.maxLevel;
      let bestKillTime = baseline.killTimeNs;
      let bestSource = baselineLoadout.name;

      const results: Array<{
        weapon: string;
        style: string;
        source: string;
        maxLevel: number;
        rawMaxLevel: number;
        killTimeNs: number;
      }> = [];

      for (const weapon of weaponPool) {
        if (!weapon.hrid) continue;

        const style = getWeaponCombatStyle(weapon.hrid)?.split("/").pop() ?? "?";
        const sourceLoadout = findLoadoutForWeapon(weapon, parsed.combatLoadouts);
        const config = cloneConfig(sourceLoadout?.config ?? baselineLoadout.config);
        setWeaponOnConfig(config, weapon);

        // Use source loadout's abilities/gear as-is (no greedy optimization)
        // This mirrors the optimizer's STARTING POINT before greedy optimization
        const result = findMaxLabyrinthLevel(
          config,
          monsterHrid,
          crateBuffs,
          [],
          0,
          gameData,
          300,
          undefined,
          0.5
        );

        const weaponName = `${weapon.hrid.split("/").pop()}+${weapon.enhancementLevel}`;
        const sourceName = sourceLoadout?.name ?? "?";

        results.push({
          weapon: weaponName,
          style,
          source: sourceName,
          maxLevel: result.maxLevel,
          rawMaxLevel: result.rawMaxLevel,
          killTimeNs: result.killTimeNs,
        });

        const killTimeSec = result.maxLevel > 0 ? (result.killTimeNs / 1e9).toFixed(1) + "s" : "N/A";
        console.log(
          weaponName.padEnd(40) +
          " | " + style.padEnd(8) +
          " | " + sourceName.padEnd(25) +
          " | " + String(result.maxLevel).padStart(7) +
          " | " + String(result.rawMaxLevel).padStart(7) +
          " | " + killTimeSec.padStart(10)
        );

        if (
          result.maxLevel > bestLevel ||
          (result.maxLevel === bestLevel && result.killTimeNs < bestKillTime)
        ) {
          bestLevel = result.maxLevel;
          bestKillTime = result.killTimeNs;
          bestWeapon = weapon;
          bestSource = sourceName;
        }
      }

      console.log("-".repeat(110));
      const winnerWeapon = bestWeapon
        ? `${bestWeapon.hrid.split("/").pop()}+${bestWeapon.enhancementLevel}`
        : baseWeapon;
      const winnerStyle = bestWeapon
        ? getWeaponCombatStyle(bestWeapon.hrid)?.split("/").pop() ?? "?"
        : getWeaponCombatStyle(baseWeapon)?.split("/").pop() ?? "?";
      console.log(
        `\nWINNER: ${winnerWeapon} (${winnerStyle}) from "${bestSource}" → level ${bestLevel}`
      );
      console.log(
        `BASELINE: ${baseWeapon.split("/").pop()} from "${baselineLoadout.name}" → level ${baseline.maxLevel}`
      );

      // Show gear summary for top magic and top ranged weapons
      const topMagic = results.filter((r) => r.style === "magic").sort((a, b) => b.maxLevel - a.maxLevel)[0];
      const topRanged = results.filter((r) => r.style === "ranged").sort((a, b) => b.maxLevel - a.maxLevel)[0];
      if (topMagic) {
        console.log(`\nTop magic: ${topMagic.weapon} from "${topMagic.source}" → level ${topMagic.maxLevel}`);
        const magicLoadout = parsed.combatLoadouts.find((l) => l.name === topMagic.source);
        if (magicLoadout) {
          console.log(`  Gear: ${summarizeGear(magicLoadout.config)}`);
        }
      }
      if (topRanged) {
        console.log(`Top ranged: ${topRanged.weapon} from "${topRanged.source}" → level ${topRanged.maxLevel}`);
        const rangedLoadout = parsed.combatLoadouts.find((l) => l.name === topRanged.source);
        if (rangedLoadout) {
          console.log(`  Gear: ${summarizeGear(rangedLoadout.config)}`);
        }
      }

      // The test passes regardless - this is a diagnostic
      expect(results.length).toBeGreaterThan(0);
    }
  );

  it(
    "should show what the greedy gear optimization does for magic vs ranged",
    { timeout: 120_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);
      const crateBuffs = buildCrateBuffs("expert", "expert");
      const monsterHrid = "/monsters/salamander";
      const NON_WEAPON_SLOTS = [
        "/equipment_types/head",
        "/equipment_types/body",
        "/equipment_types/legs",
        "/equipment_types/feet",
        "/equipment_types/hands",
        "/equipment_types/off_hand",
        "/equipment_types/pouch",
        "/equipment_types/back",
      ];

      // Find the best magic weapon and best ranged weapon from gear pool
      const weaponPool = collectWeaponPool(parsed.gearPool);
      const magicWeapons = weaponPool.filter(
        (w) => getWeaponCombatStyle(w.hrid)?.includes("magic")
      );
      const rangedWeapons = weaponPool.filter(
        (w) => getWeaponCombatStyle(w.hrid)?.includes("ranged")
      );

      console.log("\n=== Greedy Gear Optimization: Magic vs Ranged ===");

      for (const { label, weapons } of [
        { label: "MAGIC", weapons: magicWeapons },
        { label: "RANGED", weapons: rangedWeapons },
      ]) {
        if (weapons.length === 0) {
          console.log(`\n--- ${label}: No weapons in pool ---`);
          continue;
        }

        // Pick the weapon that reaches the highest starting level
        let bestStartWeapon: EquipmentDTO | null = null;
        let bestStartLevel = 0;

        for (const weapon of weapons) {
          const sourceLoadout = findLoadoutForWeapon(weapon, parsed.combatLoadouts);
          const config = cloneConfig(sourceLoadout?.config ?? parsed.combatLoadouts[0].config);
          setWeaponOnConfig(config, weapon);
          const result = findMaxLabyrinthLevel(config, monsterHrid, crateBuffs, [], 0, gameData, 300, undefined, 0.5);
          if (result.maxLevel > bestStartLevel) {
            bestStartLevel = result.maxLevel;
            bestStartWeapon = weapon;
          }
        }

        if (!bestStartWeapon) continue;

        const sourceLoadout = findLoadoutForWeapon(bestStartWeapon, parsed.combatLoadouts);
        const config = cloneConfig(sourceLoadout?.config ?? parsed.combatLoadouts[0].config);
        setWeaponOnConfig(config, bestStartWeapon);
        const weaponName = `${bestStartWeapon.hrid.split("/").pop()}+${bestStartWeapon.enhancementLevel}`;

        console.log(`\n--- ${label}: ${weaponName} from "${sourceLoadout?.name}" ---`);
        console.log(`Starting level: ${bestStartLevel}`);
        console.log(`Starting gear: ${summarizeGear(config)}`);

        // Greedy per-slot optimization: try each item in the gear pool for each slot
        const isTwoHand = !!config.equipment["/equipment_types/two_hand"]?.hrid;
        const slotsToOptimize = isTwoHand
          ? NON_WEAPON_SLOTS.filter((s) => s !== "/equipment_types/off_hand")
          : NON_WEAPON_SLOTS;

        let currentLevel = bestStartLevel;

        for (const slot of slotsToOptimize) {
          const candidates = parsed.gearPool.get(slot);
          if (!candidates || candidates.length <= 1) continue;

          const originalItem = config.equipment[slot as EquipmentSlotHrid] ?? null;
          let bestLevel = currentLevel;
          let bestKillTime = Infinity;
          let bestItem: EquipmentDTO | null = originalItem;
          let improved = false;

          for (const candidate of candidates) {
            config.equipment[slot as EquipmentSlotHrid] = candidate;

            const test = simulateLabyrinthFight(config, monsterHrid, bestLevel, crateBuffs, [], 0, gameData);
            if (!test.success) continue;

            // Probe upward
            let probeLevel = bestLevel;
            let probeKillTime = test.killTimeNs;
            for (let delta = 1; delta <= 10; delta++) {
              const next = simulateLabyrinthFight(config, monsterHrid, bestLevel + delta, crateBuffs, [], 0, gameData);
              if (next.success) {
                probeLevel = bestLevel + delta;
                probeKillTime = next.killTimeNs;
              } else break;
            }

            if (probeLevel > bestLevel || (probeLevel === bestLevel && probeKillTime < bestKillTime)) {
              bestLevel = probeLevel;
              bestKillTime = probeKillTime;
              bestItem = candidate;
              improved = true;
            }
          }

          config.equipment[slot as EquipmentSlotHrid] = bestItem;
          if (improved && bestLevel > currentLevel) {
            const slotShort = slot.split("/").pop()!;
            const itemName = bestItem
              ? `${bestItem.hrid.split("/").pop()}+${bestItem.enhancementLevel}`
              : "(empty)";
            console.log(`  ${slotShort}: ${itemName} → level ${bestLevel} (+${bestLevel - currentLevel})`);
            currentLevel = bestLevel;
          }
        }

        // Final findMax for accurate result
        const finalResult = findMaxLabyrinthLevel(config, monsterHrid, crateBuffs, [], 0, gameData, 300, undefined, 0.5);
        console.log(`Final level after gear optimization: ${finalResult.maxLevel} (raw=${finalResult.rawMaxLevel})`);
        console.log(`Final gear: ${summarizeGear(config)}`);
      }

      expect(true).toBe(true);
    }
  );
});

// =============================================================================
// Additional helpers for full optimizer diagnostic (with seals)
// =============================================================================

const ABILITY_SLOT_COUNT = 4;

/** Build seal buffs matching the user's active seals (damage, attack speed, cast speed, crit rate). */
function buildSealBuffs(): Buff[] {
  const makeSealData = (
    typeHrid: string,
    flatBoost: number,
    ratioBoost: number
  ): BuffData => ({
    uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
    typeHrid,
    flatBoost,
    flatBoostLevelBonus: 0,
    ratioBoost,
    ratioBoostLevelBonus: 0,
    startTime: 0,
    duration: 1800e9,
  });

  return [
    new Buff(makeSealData("/buff_types/attack_speed", 0, 0.15)),
    new Buff(makeSealData("/buff_types/cast_speed", 0.15, 0)),
    new Buff(makeSealData("/buff_types/damage", 0, 0.08)),
    new Buff(makeSealData("/buff_types/critical_rate", 0.1, 0)),
  ];
}

/** Wisdom buff bonus: mooPass(0.05) + community buff level 20(0.295) + wisdom seal(0.2). */
function computeWisdomBonus(): number {
  const communityWisdom = 0.2 + 0.005 * (20 - 1); // level 20
  return communityWisdom + 0.05 + 0.2; // mooPass + wisdom seal
}

/** Check if an ability is compatible with a weapon's combat style. */
function isAbilityCompatible(abilityHrid: string, weaponCombatStyle: string | null): boolean {
  const ability = gameData.abilityDetailMap[abilityHrid];
  if (!ability) return false;
  const damageEffects = ability.abilityEffects.filter(
    (e: AbilityEffectData) => e.effectType === "/ability_effect_types/damage"
  );
  if (damageEffects.length === 0) return true;
  if (!weaponCombatStyle) return false;
  return damageEffects.some(
    (e: AbilityEffectData) => !e.combatStyleHrid || e.combatStyleHrid === weaponCombatStyle
  );
}

/** Build an AbilityDTO from game data. */
function buildAbilityDTO(
  abilityHrid: string,
  abilityLevels: Map<string, number>,
): AbilityDTO {
  const abilityData = gameData.abilityDetailMap[abilityHrid];
  const level = abilityLevels.get(abilityHrid) ?? 1;
  return {
    hrid: abilityHrid,
    level,
    triggers: abilityData?.defaultCombatTriggers ?? [],
  };
}

/** Build player deps for creating Player instances (same as labyrinthSimulator). */
function buildPlayerDeps() {
  return {
    Equipment: {
      createFromDTO: (dto: { hrid: string; enhancementLevel: number }) =>
        Equipment.createFromDTO(gameData, dto),
    },
    Consumable: {
      createFromDTO: (dto: { hrid: string; triggers: any[] }) =>
        Consumable.createFromDTO(gameData, dto),
    },
    Ability: {
      createFromDTO: (dto: { hrid: string; level: number; triggers: any[] }) =>
        Ability.createFromDTO(gameData, dto),
    },
  };
}

/** Create a Player from config with buffs applied, for stats inspection. */
function createPlayerWithBuffs(
  config: PlayerConfig,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number
): Player {
  const deps = buildPlayerDeps();
  const player = Player.createFromDTO(config, gameData, deps);
  player.extraBuffs = [...crateBuffs, ...sealBuffs];
  player.wisdomBuffBonus = wisdomBuffBonus;
  player.food = [null, null, null];
  player.drinks = [null, null, null];
  player.generatePermanentBuffs();
  player.reset();
  return player;
}

/** Compute hit chance: sourceAccuracy^1.4 / (sourceAccuracy^1.4 + targetEvasion^1.4) */
function computeHitChance(sourceAccuracy: number, targetEvasion: number): number {
  if (sourceAccuracy <= 0) return 0;
  if (targetEvasion <= 0) return 1;
  return Math.pow(sourceAccuracy, 1.4) / (Math.pow(sourceAccuracy, 1.4) + Math.pow(targetEvasion, 1.4));
}

/** Get the relevant accuracy rating from player for their combat style. */
function getPlayerAccuracy(player: Player): number {
  const style = player.combatDetails.combatStats.combatStyleHrid.split("/").pop();
  return (player.combatDetails as any)[`${style}AccuracyRating`] ?? 0;
}

/** Get the relevant max damage from player for their combat style. */
function getPlayerMaxDamage(player: Player): number {
  const style = player.combatDetails.combatStats.combatStyleHrid.split("/").pop();
  return (player.combatDetails as any)[`${style}MaxDamage`] ?? 0;
}

/** Get the relevant evasion rating from a monster's base stats for a given combat style. */
function getSalamanderEvasion(combatStyle: string, targetLevel: number): number {
  const monsterData = gameData.combatMonsterDetailMap["/monsters/salamander"];
  const cd = monsterData.combatDetails;
  const scaleFactor = targetLevel / 100;

  // Monster evasion rating = (10 + defenseLevel*scale) * (1 + evasionStat)
  const defLvl = cd.defenseLevel * scaleFactor;
  const style = combatStyle.split("/").pop();
  const evasionStat = (cd.combatStats as any)[`${style}Evasion`] ?? 0;
  return (10 + defLvl) * (1 + evasionStat);
}

// =============================================================================
// Step 1: Full optimizer diagnostic WITH seals and ability/gear optimization
// =============================================================================

describe("Salamander: Full Optimizer Diagnostic (with seals)", () => {
  it(
    "should replicate optimizer flow with seals for all weapons",
    { timeout: 600_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);
      const crateBuffs = buildCrateBuffs("expert", "expert");
      const sealBuffs = buildSealBuffs();
      const wisdomBuffBonus = computeWisdomBonus();
      const monsterHrid = "/monsters/salamander";

      const { abilityLevels, combatLoadouts } = parsed;

      // All ability hrids from the player's trained abilities
      const allAbilityHrids = Array.from(abilityLevels.keys());
      const regularAbilities = allAbilityHrids.filter(
        (h) => !gameData.abilityDetailMap[h]?.isSpecialAbility
      );
      const specialAbilities = allAbilityHrids.filter(
        (h) => gameData.abilityDetailMap[h]?.isSpecialAbility
      );

      console.log("\n" + "=".repeat(80));
      console.log("  SALAMANDER: Full Optimizer Diagnostic WITH Seals");
      console.log("=".repeat(80));
      console.log(`Seal buffs: attack speed +15%, cast speed +0.15, damage +8%, crit rate +0.1`);
      console.log(`Wisdom bonus: ${wisdomBuffBonus.toFixed(3)}`);
      console.log(`Trained abilities: ${allAbilityHrids.length} (${regularAbilities.length} regular, ${specialAbilities.length} special)`);

      const NON_WEAPON_SLOTS = [
        "/equipment_types/head",
        "/equipment_types/body",
        "/equipment_types/legs",
        "/equipment_types/feet",
        "/equipment_types/hands",
        "/equipment_types/off_hand",
        "/equipment_types/pouch",
        "/equipment_types/back",
      ];

      // Baseline
      const overrideLoadoutId = parsed.labyrinthMonsterLoadouts[monsterHrid];
      const overrideLoadout = overrideLoadoutId
        ? combatLoadouts.find((l) => l.id === overrideLoadoutId)
        : null;
      const defaultLoadout = combatLoadouts[0];
      const baselineLoadout = overrideLoadout ?? defaultLoadout;

      const baseline = findMaxLabyrinthLevel(
        baselineLoadout.config, monsterHrid, crateBuffs, sealBuffs,
        wisdomBuffBonus, gameData, 300, undefined, 0.5
      );
      console.log(`\nBaseline: "${baselineLoadout.name}" → level ${baseline.maxLevel} (raw=${baseline.rawMaxLevel})`);

      // Try each weapon
      const weaponPool = collectWeaponPool(parsed.gearPool);

      interface WeaponResult {
        weapon: string;
        weaponDto: EquipmentDTO;
        style: string;
        source: string;
        preOptLevel: number;
        postAbilityLevel: number;
        postGearLevel: number;
        finalLevel: number;
        rawMaxLevel: number;
        killTimeNs: number;
        finalConfig: PlayerConfig;
        selectedAbilities: string[];
        selectedSpecial: string | null;
        gearChanges: string[];
      }

      const results: WeaponResult[] = [];

      console.log("\n--- Per-weapon optimization results ---");

      for (const weapon of weaponPool) {
        if (!weapon.hrid) continue;

        const style = getWeaponCombatStyle(weapon.hrid)?.split("/").pop() ?? "?";
        const weaponStyle = getWeaponCombatStyle(weapon.hrid);
        const sourceLoadout = findLoadoutForWeapon(weapon, combatLoadouts);
        const config = cloneConfig(sourceLoadout?.config ?? baselineLoadout.config);
        setWeaponOnConfig(config, weapon);

        const weaponName = `${weapon.hrid.split("/").pop()}+${weapon.enhancementLevel}`;
        const sourceName = sourceLoadout?.name ?? "?";

        // Pre-optimization level (weapon + source loadout abilities/gear, WITH seals)
        const preOpt = findMaxLabyrinthLevel(
          config, monsterHrid, crateBuffs, sealBuffs,
          wisdomBuffBonus, gameData, 300, undefined, 0.5
        );

        // --- Greedy ability optimization ---
        const compatRegular = regularAbilities.filter((h) =>
          isAbilityCompatible(h, weaponStyle)
        );
        const compatSpecial = specialAbilities.filter((h) =>
          isAbilityCompatible(h, weaponStyle)
        );

        let currentLevel = preOpt.maxLevel;
        let currentKillTime = preOpt.killTimeNs;

        const usedAbilities = new Set<string>();
        for (let slot = 0; slot < ABILITY_SLOT_COUNT; slot++) {
          const existing = config.abilities[slot];
          if (existing?.hrid) usedAbilities.add(existing.hrid);
        }

        for (let slot = 0; slot < ABILITY_SLOT_COUNT; slot++) {
          const originalAbility = config.abilities[slot];
          let bestLevel = currentLevel;
          let bestKillTime = currentKillTime;
          let bestAbility: AbilityDTO | null = originalAbility;

          if (originalAbility?.hrid) usedAbilities.delete(originalAbility.hrid);

          for (const abilityHrid of compatRegular) {
            if (usedAbilities.has(abilityHrid)) continue;

            const dto = buildAbilityDTO(abilityHrid, abilityLevels);
            config.abilities[slot] = dto;

            const test = simulateLabyrinthFight(
              config, monsterHrid, bestLevel, crateBuffs, sealBuffs,
              wisdomBuffBonus, gameData
            );
            if (!test.success) continue;

            let probeLevel = bestLevel;
            let probeKillTime = test.killTimeNs;
            for (let delta = 1; delta <= 10; delta++) {
              const next = simulateLabyrinthFight(
                config, monsterHrid, bestLevel + delta, crateBuffs, sealBuffs,
                wisdomBuffBonus, gameData
              );
              if (next.success) {
                probeLevel = bestLevel + delta;
                probeKillTime = next.killTimeNs;
              } else break;
            }

            if (probeLevel > bestLevel || (probeLevel === bestLevel && probeKillTime < bestKillTime)) {
              bestLevel = probeLevel;
              bestKillTime = probeKillTime;
              bestAbility = dto;
            }
          }

          config.abilities[slot] = bestAbility;
          if (bestAbility?.hrid) usedAbilities.add(bestAbility.hrid);
          if (bestLevel > currentLevel) {
            currentLevel = bestLevel;
            currentKillTime = bestKillTime;
          }
        }

        // Special ability optimization
        {
          let bestLevel = currentLevel;
          let bestKillTime = currentKillTime;
          let bestSpecial: AbilityDTO | null = config.specialAbility;

          for (const abilityHrid of compatSpecial) {
            const dto = buildAbilityDTO(abilityHrid, abilityLevels);
            config.specialAbility = dto;

            const test = simulateLabyrinthFight(
              config, monsterHrid, bestLevel, crateBuffs, sealBuffs,
              wisdomBuffBonus, gameData
            );
            if (!test.success) continue;

            let probeLevel = bestLevel;
            let probeKillTime = test.killTimeNs;
            for (let delta = 1; delta <= 10; delta++) {
              const next = simulateLabyrinthFight(
                config, monsterHrid, bestLevel + delta, crateBuffs, sealBuffs,
                wisdomBuffBonus, gameData
              );
              if (next.success) {
                probeLevel = bestLevel + delta;
                probeKillTime = next.killTimeNs;
              } else break;
            }

            if (probeLevel > bestLevel || (probeLevel === bestLevel && probeKillTime < bestKillTime)) {
              bestLevel = probeLevel;
              bestKillTime = probeKillTime;
              bestSpecial = dto;
            }
          }

          config.specialAbility = bestSpecial;
          if (bestLevel > currentLevel) {
            currentLevel = bestLevel;
            currentKillTime = bestKillTime;
          }
        }

        const postAbilityLevel = currentLevel;

        // --- Greedy gear optimization ---
        const isTwoHand = !!config.equipment["/equipment_types/two_hand"]?.hrid;
        const gearSlots = isTwoHand
          ? NON_WEAPON_SLOTS.filter((s) => s !== "/equipment_types/off_hand")
          : NON_WEAPON_SLOTS;

        const gearChanges: string[] = [];

        for (const slot of gearSlots) {
          const candidates = parsed.gearPool.get(slot);
          if (!candidates || candidates.length <= 1) continue;

          const originalItem = config.equipment[slot as EquipmentSlotHrid] ?? null;
          let bestLevel = currentLevel;
          let bestKillTime = currentKillTime;
          let bestItem: EquipmentDTO | null = originalItem;

          for (const candidate of candidates) {
            config.equipment[slot as EquipmentSlotHrid] = candidate;

            const test = bestLevel > 0
              ? simulateLabyrinthFight(
                  config, monsterHrid, bestLevel, crateBuffs, sealBuffs,
                  wisdomBuffBonus, gameData
                )
              : { success: false, killTimeNs: 0 };

            if (bestLevel === 0 || !test.success) {
              if (bestLevel === 0) {
                const lvl1 = simulateLabyrinthFight(
                  config, monsterHrid, 1, crateBuffs, sealBuffs,
                  wisdomBuffBonus, gameData
                );
                if (lvl1.success) {
                  bestLevel = 1;
                  bestKillTime = lvl1.killTimeNs;
                  bestItem = candidate;
                  for (let delta = 1; delta <= 10; delta++) {
                    const next = simulateLabyrinthFight(
                      config, monsterHrid, 1 + delta, crateBuffs, sealBuffs,
                      wisdomBuffBonus, gameData
                    );
                    if (next.success) {
                      bestLevel = 1 + delta;
                      bestKillTime = next.killTimeNs;
                    } else break;
                  }
                }
              }
              continue;
            }

            let probeLevel = bestLevel;
            let probeKillTime = test.killTimeNs;
            for (let delta = 1; delta <= 10; delta++) {
              const next = simulateLabyrinthFight(
                config, monsterHrid, bestLevel + delta, crateBuffs, sealBuffs,
                wisdomBuffBonus, gameData
              );
              if (next.success) {
                probeLevel = bestLevel + delta;
                probeKillTime = next.killTimeNs;
              } else break;
            }

            if (probeLevel > bestLevel || (probeLevel === bestLevel && probeKillTime < bestKillTime)) {
              bestLevel = probeLevel;
              bestKillTime = probeKillTime;
              bestItem = candidate;
            }
          }

          config.equipment[slot as EquipmentSlotHrid] = bestItem;
          if (bestLevel > currentLevel) {
            const slotShort = slot.split("/").pop()!;
            const itemName = bestItem
              ? `${bestItem.hrid.split("/").pop()}+${bestItem.enhancementLevel}`
              : "(empty)";
            gearChanges.push(`${slotShort}: ${itemName} (+${bestLevel - currentLevel})`);
            currentLevel = bestLevel;
            currentKillTime = bestKillTime;
          }
        }

        // Final findMax for accurate result
        const finalResult = findMaxLabyrinthLevel(
          config, monsterHrid, crateBuffs, sealBuffs,
          wisdomBuffBonus, gameData, 300, undefined, 0.5
        );

        const selectedAbilities = config.abilities
          .filter((a): a is AbilityDTO => a != null)
          .map((a) => a.hrid.split("/").pop()!);
        const selectedSpecial = config.specialAbility?.hrid.split("/").pop() ?? null;

        results.push({
          weapon: weaponName,
          weaponDto: weapon,
          style,
          source: sourceName,
          preOptLevel: preOpt.maxLevel,
          postAbilityLevel,
          postGearLevel: currentLevel,
          finalLevel: finalResult.maxLevel,
          rawMaxLevel: finalResult.rawMaxLevel,
          killTimeNs: finalResult.killTimeNs,
          finalConfig: cloneConfig(config),
          selectedAbilities,
          selectedSpecial,
          gearChanges,
        });

        console.log(
          `\n  ${weaponName} (${style}) from "${sourceName}":` +
          `\n    Pre-opt: ${preOpt.maxLevel} → +abilities: ${postAbilityLevel} → +gear: ${currentLevel} → final: ${finalResult.maxLevel} (raw=${finalResult.rawMaxLevel})` +
          `\n    Abilities: [${selectedAbilities.join(", ")}] special: ${selectedSpecial ?? "none"}` +
          (gearChanges.length > 0 ? `\n    Gear swaps: ${gearChanges.join(", ")}` : "") +
          `\n    Kill time: ${(finalResult.killTimeNs / 1e9).toFixed(1)}s`
        );
      }

      // Summary table
      console.log("\n\n--- SUMMARY TABLE (sorted by final level) ---");
      const sorted = [...results].sort((a, b) => b.finalLevel - a.finalLevel || a.killTimeNs - b.killTimeNs);
      console.log(
        "Weapon".padEnd(35) +
        " Style".padEnd(8) +
        " | " + "Pre-Opt".padStart(7) +
        " | " + "+Abil".padStart(6) +
        " | " + "+Gear".padStart(6) +
        " | " + "Final".padStart(6) +
        " | " + "Raw".padStart(4) +
        " | " + "Kill(s)".padStart(8)
      );
      console.log("-".repeat(90));
      for (const r of sorted) {
        console.log(
          r.weapon.padEnd(35) +
          ` ${r.style}`.padEnd(8) +
          " | " + String(r.preOptLevel).padStart(7) +
          " | " + String(r.postAbilityLevel).padStart(6) +
          " | " + String(r.postGearLevel).padStart(6) +
          " | " + String(r.finalLevel).padStart(6) +
          " | " + String(r.rawMaxLevel).padStart(4) +
          " | " + (r.killTimeNs / 1e9).toFixed(1).padStart(8)
        );
      }

      // === Step 2: Detailed stats comparison for top magic vs top ranged ===
      const topMagic = sorted.find((r) => r.style === "magic");
      const topRanged = sorted.find((r) => r.style === "ranged");

      if (topMagic && topRanged) {
        console.log("\n\n" + "=".repeat(80));
        console.log("  SURVIVAL vs DPS TRADEOFF: Top Magic vs Top Ranged");
        console.log("=".repeat(80));

        const levels = [
          topRanged.finalLevel,
          topMagic.finalLevel,
          Math.max(topMagic.finalLevel, topRanged.finalLevel),
        ].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);

        for (const targetLevel of levels) {
          console.log(`\n--- At level ${targetLevel} ---`);

          for (const { label, result } of [
            { label: "MAGIC", result: topMagic },
            { label: "RANGED", result: topRanged },
          ]) {
            const player = createPlayerWithBuffs(
              result.finalConfig, crateBuffs, sealBuffs, wisdomBuffBonus
            );

            const cd = player.combatDetails;
            const cs = cd.combatStats;
            const style = cs.combatStyleHrid.split("/").pop()!;
            const accuracy = getPlayerAccuracy(player);
            const maxDmg = getPlayerMaxDamage(player);
            const monsterEvasion = getSalamanderEvasion(cs.combatStyleHrid, targetLevel);
            const hitChance = computeHitChance(accuracy, monsterEvasion);

            // Run the actual fight at this level
            const fightResult = simulateLabyrinthFight(
              result.finalConfig, monsterHrid, targetLevel, crateBuffs, sealBuffs,
              wisdomBuffBonus, gameData
            );

            const monsterData = gameData.combatMonsterDetailMap[monsterHrid];
            const scaledHp = (monsterData.combatDetails.maxHitpoints ?? 0) * targetLevel / 100;
            // Scale flat HP too
            const scaledMaxHp = Math.floor(
              10 * (10 + monsterData.combatDetails.staminaLevel * targetLevel / 100) *
              (1 + (monsterData.combatDetails.combatStats.maxHitpointsRatio ?? 0)) +
              (monsterData.combatDetails.combatStats.maxHitpoints ?? 0) * targetLevel / 100
            );

            const effectiveDps = fightResult.success
              ? scaledMaxHp / (fightResult.killTimeNs / 1e9)
              : 0;

            console.log(`  ${label} (${result.weapon}):` +
              `\n    Player: HP=${cd.maxHitpoints} Armor=${cd.totalArmor.toFixed(0)} ` +
              `WaterRes=${cd.totalWaterResistance.toFixed(0)} NatureRes=${cd.totalNatureResistance.toFixed(0)} FireRes=${cd.totalFireResistance.toFixed(0)}` +
              `\n    Offense: ${style}Acc=${accuracy.toFixed(0)} ${style}MaxDmg=${maxDmg.toFixed(0)} ` +
              `CritRate=${cs.criticalRate.toFixed(3)} CritDmg=${cs.criticalDamage.toFixed(3)} ` +
              `AtkSpd=${cs.attackSpeed.toFixed(3)} CastSpd=${cs.castSpeed.toFixed(3)}` +
              `\n    Hit chance vs salamander (lvl ${targetLevel}): ${(hitChance * 100).toFixed(1)}% ` +
              `(acc=${accuracy.toFixed(0)} vs evasion=${monsterEvasion.toFixed(0)})` +
              `\n    Sustain: HP regen=${cs.hpRegenPer10.toFixed(1)}/10s MP regen=${cs.mpRegenPer10.toFixed(1)}/10s ` +
              `LifeSteal=${cs.lifeSteal.toFixed(3)} Parry=${cs.parry.toFixed(3)}` +
              `\n    Fight: ${fightResult.success ? "KILL" : "FAIL"} ` +
              `time=${(fightResult.killTimeNs / 1e9).toFixed(1)}s ` +
              `effDPS=${effectiveDps.toFixed(0)} ` +
              `(monster HP≈${scaledMaxHp})`
            );
          }
        }
      }

      // Final winner announcement
      const winner = sorted[0];
      console.log(`\n\n${"=".repeat(80)}`);
      console.log(`  WINNER: ${winner.weapon} (${winner.style}) → level ${winner.finalLevel}`);
      if (topMagic && topRanged) {
        const gap = topMagic.finalLevel - topRanged.finalLevel;
        console.log(`  Magic vs Ranged gap: ${gap > 0 ? "+" : ""}${gap} levels (magic=${topMagic.finalLevel}, ranged=${topRanged.finalLevel})`);
      }
      console.log("=".repeat(80));

      expect(results.length).toBeGreaterThan(0);
    }
  );
});

// =============================================================================
// Frost Sniper Level 228 Diagnostic
// =============================================================================
// Context: User fails 6+ times at frost sniper level 228 in labyrinth despite
// expecting "almost 100% chance of winning." Investigate whether the sim has a
// bug or the user's expectations are wrong.
//
// Key finding from plan: sim-computed monster damage is ~15% HIGHER than game
// (sim 499.8 vs game 424 ranged damage, sim 238 vs game 202 defensive damage).
// All other stats (evasion, accuracy, HP, armor) match. This means the sim is
// MORE conservative than the game for monster damage.

describe("Frost Sniper: Level 228 Diagnostic", () => {
  it(
    "should diagnose frost sniper fight at level 228",
    { timeout: 120_000 },
    () => {
      const parsed = parseFullCharacterData(fullCharJson, gameData);
      const crateBuffs = buildCrateBuffs("expert", "expert");
      const sealBuffs = buildSealBuffs();
      const wisdomBuffBonus = computeWisdomBonus();
      const monsterHrid = "/monsters/frost_sniper";
      const TARGET_LEVEL = 228;

      // -----------------------------------------------------------------------
      // 1. Create frost sniper at level 228 and log all computed stats
      // -----------------------------------------------------------------------
      console.log("\n" + "=".repeat(80));
      console.log("  FROST SNIPER LEVEL 228 DIAGNOSTIC");
      console.log("=".repeat(80));

      // Monster deps expect Ability constructor with (hrid, gameData, level, triggers)
      // but our Ability class takes (gameData, hrid, level, triggers) — need adapter
      const MonsterAbility = class extends Ability {
        constructor(hrid: string, _gd: GameData, level?: number, triggers?: any) {
          super(gameData, hrid, level, triggers);
        }
      } as any;
      const monster = new Monster(monsterHrid, gameData, 0, { Ability: MonsterAbility });
      monster.setLabyrinthTargetLevel(TARGET_LEVEL);
      monster.reset();

      const md = monster.combatDetails;
      const mcs = md.combatStats;

      console.log("\n--- Monster Stats at Level 228 (Sim vs Game Screenshot) ---");
      console.log("Stat".padEnd(25) + "Sim".padStart(10) + "Game".padStart(10) + "Match?".padStart(10));
      console.log("-".repeat(55));

      const statComparisons: [string, number, number][] = [
        ["Stab Evasion", md.stabEvasionRating, 714],
        ["Slash Evasion", md.slashEvasionRating, 3808],
        ["Smash Evasion", md.smashEvasionRating, 476],
        ["Ranged Evasion", md.rangedEvasionRating, 7378],
        ["Magic Evasion", md.magicEvasionRating, 3808],
        ["Ranged Accuracy", md.rangedAccuracyRating, 499],
        ["Max HP", md.maxHitpoints, 9519],
        ["Armor", md.totalArmor, 364],
        ["Water Resistance", md.totalWaterResistance, 2781],
        ["Ranged Damage", md.rangedMaxDamage, 424],
        ["Defensive Damage", md.defensiveMaxDamage, 202],
      ];

      for (const [name, sim, game] of statComparisons) {
        const ratio = sim / game;
        const match = Math.abs(ratio - 1) < 0.02 ? "YES" :
                      Math.abs(ratio - 1) < 0.05 ? "~close" : `NO (${ratio.toFixed(3)}x)`;
        console.log(
          name.padEnd(25) +
          sim.toFixed(1).padStart(10) +
          game.toFixed(0).padStart(10) +
          match.padStart(10)
        );
      }

      // Show raw levels
      console.log("\n--- Monster Scaled Levels ---");
      console.log(`staminaLevel: ${md.staminaLevel.toFixed(1)}`);
      console.log(`intelligenceLevel: ${md.intelligenceLevel.toFixed(1)}`);
      console.log(`attackLevel: ${md.attackLevel.toFixed(1)}`);
      console.log(`defenseLevel: ${md.defenseLevel.toFixed(1)}`);
      console.log(`meleeLevel: ${md.meleeLevel.toFixed(1)}`);
      console.log(`rangedLevel: ${md.rangedLevel.toFixed(1)}`);
      console.log(`magicLevel: ${md.magicLevel.toFixed(1)}`);

      // Show combat stats (ratios)
      console.log("\n--- Monster Combat Stats (base ratios) ---");
      console.log(`rangedAccuracy: ${mcs.rangedAccuracy}`);
      console.log(`rangedDamage: ${mcs.rangedDamage}`);
      console.log(`defensiveDamage: ${mcs.defensiveDamage}`);
      console.log(`maxHitpointsRatio: ${mcs.maxHitpointsRatio}`);
      console.log(`smashEvasion: ${mcs.smashEvasion}`);
      console.log(`damageType: ${mcs.damageType}`);
      console.log(`attackInterval: ${(mcs.attackInterval / 1e9).toFixed(2)}s`);
      console.log(`armor: ${mcs.armor} (flat)`);
      console.log(`waterResistance: ${mcs.waterResistance} (flat)`);

      // Reverse-engineer what effective damage level the game uses
      const gameRangedDmg = 424;
      const rangedDmgStat = mcs.rangedDamage;
      const effectiveRangedLevel = gameRangedDmg / (1 + rangedDmgStat) - 10;
      console.log(`\nReverse-engineered effective ranged level for damage: ${effectiveRangedLevel.toFixed(1)} (expected: ${TARGET_LEVEL})`);

      const gameDefDmg = 202;
      const defDmgStat = mcs.defensiveDamage;
      const effectiveDefLevel = gameDefDmg / (1 + defDmgStat) - 10;
      console.log(`Reverse-engineered effective defense level for damage: ${effectiveDefLevel.toFixed(1)} (expected: ${TARGET_LEVEL})`);

      // -----------------------------------------------------------------------
      // 2. Create user's player with frost sniper loadout
      // -----------------------------------------------------------------------
      const overrideLoadoutId = parsed.labyrinthMonsterLoadouts[monsterHrid];
      const overrideLoadout = overrideLoadoutId
        ? parsed.combatLoadouts.find((l) => l.id === overrideLoadoutId)
        : null;
      const defaultLoadout = parsed.combatLoadouts[0];
      const loadout = overrideLoadout ?? defaultLoadout;

      console.log(`\n--- Player Loadout ---`);
      console.log(`Using loadout: "${loadout.name}" (id=${loadout.id})`);
      console.log(`Override for frost_sniper: ${overrideLoadoutId ?? "NONE (using default)"}`);
      console.log(`Gear: ${summarizeGear(loadout.config)}`);

      // Show abilities
      const abilities = loadout.config.abilities
        .filter((a) => a !== null)
        .map((a) => `${a!.hrid.split("/").pop()} lvl=${a!.level}`);
      console.log(`Abilities: ${abilities.join(", ")}`);

      // Create player for stat inspection
      const player = createPlayerWithBuffs(
        loadout.config,
        crateBuffs,
        sealBuffs,
        wisdomBuffBonus
      );
      const pd = player.combatDetails;
      const pcs = pd.combatStats;

      console.log(`\n--- Player Combat Stats ---`);
      console.log(`Combat style: ${pcs.combatStyleHrid}`);
      const playerStyle = pcs.combatStyleHrid.split("/").pop()!;
      const playerAccuracy = (pd as any)[`${playerStyle}AccuracyRating`] ?? 0;
      const playerDamage = (pd as any)[`${playerStyle}MaxDamage`] ?? 0;
      console.log(`${playerStyle} accuracy: ${playerAccuracy.toFixed(1)}`);
      console.log(`${playerStyle} max damage: ${playerDamage.toFixed(1)}`);
      console.log(`Defensive max damage: ${pd.defensiveMaxDamage.toFixed(1)}`);
      console.log(`Max HP: ${pd.maxHitpoints}`);
      console.log(`Armor: ${pd.totalArmor.toFixed(1)}`);
      console.log(`Water resistance: ${pd.totalWaterResistance.toFixed(1)}`);
      console.log(`Attack interval: ${(pcs.attackInterval / 1e9).toFixed(2)}s`);
      console.log(`Crit rate: ${pcs.criticalRate.toFixed(4)}`);
      console.log(`Crit damage: ${pcs.criticalDamage.toFixed(4)}`);

      // Hit chance calculation
      const monsterSmashEvasion = md.smashEvasionRating;
      const hitChance = computeHitChance(playerAccuracy, monsterSmashEvasion);
      console.log(`\n--- Hit Chance (player → monster) ---`);
      console.log(`Player ${playerStyle} accuracy: ${playerAccuracy.toFixed(1)}`);
      console.log(`Monster smash evasion: ${monsterSmashEvasion.toFixed(1)}`);
      console.log(`Hit chance: ${(hitChance * 100).toFixed(1)}%`);

      // Monster hit chance on player
      const monsterAccuracy = md.rangedAccuracyRating;
      const playerRangedEvasion = pd.rangedEvasionRating;
      const monsterHitChance = computeHitChance(monsterAccuracy, playerRangedEvasion);
      console.log(`\n--- Hit Chance (monster → player) ---`);
      console.log(`Monster ranged accuracy: ${monsterAccuracy.toFixed(1)}`);
      console.log(`Player ranged evasion: ${playerRangedEvasion.toFixed(1)}`);
      console.log(`Monster hit chance: ${(monsterHitChance * 100).toFixed(1)}%`);

      // -----------------------------------------------------------------------
      // 3. Run simulateLabyrinthFight at level 228
      // -----------------------------------------------------------------------
      console.log("\n--- Labyrinth Fight at Level 228 ---");
      const fightResult = simulateLabyrinthFight(
        loadout.config,
        monsterHrid,
        TARGET_LEVEL,
        crateBuffs,
        sealBuffs,
        wisdomBuffBonus,
        gameData
      );

      const killTimeSec = fightResult.killTimeNs / 1e9;
      console.log(`Result: ${fightResult.success ? "KILL" : "FAIL"}`);
      console.log(`Kill time: ${killTimeSec.toFixed(1)}s (limit: 120s)`);
      console.log(`Time margin: ${(120 - killTimeSec).toFixed(1)}s`);

      // -----------------------------------------------------------------------
      // 4. Find raw max labyrinth level for frost sniper
      // -----------------------------------------------------------------------
      console.log("\n--- Binary Search for Max Level ---");
      const maxResult = findMaxLabyrinthLevel(
        loadout.config,
        monsterHrid,
        crateBuffs,
        sealBuffs,
        wisdomBuffBonus,
        gameData,
        350  // search up to 350
      );

      console.log(`Raw max level: ${maxResult.rawMaxLevel}`);
      console.log(`Adjusted max level (50% CR): ${maxResult.maxLevel}`);
      console.log(`Kill time at raw max: ${(maxResult.killTimeNs / 1e9).toFixed(1)}s`);

      // -----------------------------------------------------------------------
      // 5. Compute clear rate at level 228
      // -----------------------------------------------------------------------
      const clearRate228 = computeLevelBasedClearRate(
        TARGET_LEVEL,
        maxResult.rawMaxLevel
      );
      console.log(`\n--- Clear Rate Analysis ---`);
      console.log(`Clear rate at level 228: ${(clearRate228 * 100).toFixed(1)}%`);
      console.log(`Raw max: ${maxResult.rawMaxLevel}, target: ${TARGET_LEVEL}`);
      console.log(`Levels of margin: ${maxResult.rawMaxLevel - TARGET_LEVEL}`);

      // Show clear rates at nearby levels
      console.log("\nClear rates at nearby levels:");
      for (const lvl of [220, 225, 228, 230, 235, 240, 245, 250]) {
        const cr = computeLevelBasedClearRate(lvl, maxResult.rawMaxLevel);
        const fight = simulateLabyrinthFight(
          loadout.config,
          monsterHrid,
          lvl,
          crateBuffs,
          sealBuffs,
          wisdomBuffBonus,
          gameData
        );
        const t = fight.killTimeNs / 1e9;
        console.log(
          `  Level ${lvl}: CR=${(cr * 100).toFixed(1)}%, ` +
          `${fight.success ? `kill=${t.toFixed(1)}s` : "FAIL"}`
        );
      }

      // -----------------------------------------------------------------------
      // 6. Diagnosis summary
      // -----------------------------------------------------------------------
      console.log("\n" + "=".repeat(80));
      console.log("  DIAGNOSIS");
      console.log("=".repeat(80));

      if (maxResult.rawMaxLevel <= TARGET_LEVEL) {
        console.log(
          `Raw max (${maxResult.rawMaxLevel}) <= target (${TARGET_LEVEL}).` +
          `\nThe sim says you CAN'T reliably beat level ${TARGET_LEVEL}.` +
          `\nClear rate: ${(clearRate228 * 100).toFixed(1)}%` +
          `\nFailing 6/6 is EXPECTED at this clear rate.`
        );
      } else if (maxResult.rawMaxLevel - TARGET_LEVEL <= 20) {
        const failProb = Math.pow(1 - clearRate228, 6);
        console.log(
          `Raw max (${maxResult.rawMaxLevel}) is close to target (${TARGET_LEVEL}).` +
          `\nClear rate: ${(clearRate228 * 100).toFixed(1)}%` +
          `\nProbability of failing 6/6: ${(failProb * 100).toFixed(2)}%` +
          `\nThe fight is NOT "almost 100%". Expectation was wrong.`
        );
      } else {
        console.log(
          `Raw max (${maxResult.rawMaxLevel}) >> target (${TARGET_LEVEL}).` +
          `\nClear rate: ${(clearRate228 * 100).toFixed(1)}%` +
          `\nSim says you should win easily. Investigate sim DPS overestimate.`
        );
      }

      // Note about the damage discrepancy
      console.log(
        `\nNOTE: Sim overestimates monster damage by ~15% (ranged: ${md.rangedMaxDamage.toFixed(0)} sim vs ${gameRangedDmg} game).` +
        `\nThis makes the sim MORE conservative (harder fights), so this doesn't explain in-game failures.` +
        `\nThe discrepancy suggests the game uses a non-linear damage scaling formula in labyrinth.`
      );

      expect(true).toBe(true);
    }
  );
});
