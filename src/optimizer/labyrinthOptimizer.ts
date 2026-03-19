// =============================================================================
// Labyrinth Loadout Optimizer - Per-monster greedy optimization of abilities
// and gear to maximize labyrinth levels
// =============================================================================
// For each monster, tries each weapon in the player's gear pool, then
// greedily optimizes ability slots and equipment slots. Pure logic, no React.

import type {
  GameData,
  PlayerConfig,
  AbilityDTO,
  EquipmentDTO,
  AbilityEffectData,
  EquipmentSlotHrid,
} from "../engine/types";
import type { FullCharacterData, CombatLoadout } from "../data/fullCharacterData";
import Buff from "../engine/buff";
import {
  simulateLabyrinthFight,
  findMaxLabyrinthLevel,
  getLabyrinthMonsters,
} from "../features/labyrinthSimulator";
import { FLOORS } from "../features/labyrinthAnalyzer/constants";

// =============================================================================
// Types
// =============================================================================

export type BestGearMode = "owned" | "best7" | "best10R";

export interface LoadoutChange {
  slotType: "equipment" | "ability" | "specialAbility";
  slotName: string;
  originalHrid: string | null;
  optimizedHrid: string | null;
}

export interface MonsterOptResult {
  monsterHrid: string;
  baselineLevel: number;
  optimizedLevel: number;
  levelDelta: number;
  optimizedConfig: PlayerConfig;
  weaponHrid: string | null;
  changes: LoadoutChange[];
  killTimeNs: number;
}

export interface LabyrinthOptResult {
  monsterResults: MonsterOptResult[];
  baselineTotalLevels: number;
  optimizedTotalLevels: number;
  totalSimRuns: number;
}

export interface LabyrinthOptProgress {
  phase: "baseline" | "optimizing";
  monsterHrid: string;
  monstersCompleted: number;
  monstersTotal: number;
  simRunsSoFar: number;
  detail?: string;
}

// =============================================================================
// Constants
// =============================================================================

const WEAPON_SLOTS: string[] = [
  "/equipment_types/main_hand",
  "/equipment_types/two_hand",
];

const NON_WEAPON_EQUIPMENT_SLOTS: string[] = [
  "/equipment_types/head",
  "/equipment_types/body",
  "/equipment_types/legs",
  "/equipment_types/feet",
  "/equipment_types/hands",
  "/equipment_types/off_hand",
  "/equipment_types/pouch",
  "/equipment_types/back",
];

const ABILITY_SLOT_COUNT = 4;

/** Equipment slots to skip optimization for in "best10R" mode. */
const BEST10R_SKIP_SLOTS = new Set([
  "/equipment_types/back",
  "/equipment_types/feet",
]);

/** Default ability levels when useBestAbilities is enabled. */
const BEST_REGULAR_ABILITY_LEVEL = 70;
const BEST_SPECIAL_ABILITY_LEVEL = 40;

const MELEE_COMBAT_STYLES = new Set([
  "/combat_styles/stab",
  "/combat_styles/slash",
  "/combat_styles/smash",
]);

const TANKY_BODY_LEGS_COMBOS = [
  {
    bodyHrid: "/items/anchorbound_plate_body_refined",
    legsHrid: "/items/anchorbound_plate_legs_refined",
    meleeOnly: false,
  },
  {
    bodyHrid: "/items/maelstrom_plate_body_refined",
    legsHrid: "/items/maelstrom_plate_legs_refined",
    meleeOnly: true,
  },
];

// =============================================================================
// Helpers
// =============================================================================

function cloneConfig(config: PlayerConfig): PlayerConfig {
  return JSON.parse(JSON.stringify(config));
}

/** Get the combat style hrid for a weapon from game data. */
function getWeaponCombatStyle(
  weaponHrid: string,
  gameData: GameData
): string | null {
  const item = gameData.itemDetailMap[weaponHrid];
  const styles = item?.equipmentDetail?.combatStats?.combatStyleHrids;
  if (styles && styles.length > 0) return styles[0];
  return null;
}

/** Get the equipment slot type for an item from game data. */
function getItemSlotType(
  itemHrid: string,
  gameData: GameData
): string | null {
  return gameData.itemDetailMap[itemHrid]?.equipmentDetail?.type ?? null;
}

/**
 * Check if an ability is compatible with a weapon's combat style.
 * An ability is compatible if:
 * - It has no damage effects with a specific combatStyleHrid (style-agnostic: heals, buffs)
 * - OR any of its damage effects match the weapon's combat style
 */
function isAbilityCompatible(
  abilityHrid: string,
  weaponCombatStyle: string | null,
  gameData: GameData
): boolean {
  const ability = gameData.abilityDetailMap[abilityHrid];
  if (!ability) return false;

  const damageEffects = ability.abilityEffects.filter(
    (e: AbilityEffectData) => e.effectType === "/ability_effect_types/damage"
  );

  // No damage effects = style-agnostic (heal, buff, revive)
  if (damageEffects.length === 0) return true;

  // If no weapon style, only style-agnostic abilities work
  if (!weaponCombatStyle) return false;

  // Check if any damage effect matches the weapon style
  return damageEffects.some(
    (e: AbilityEffectData) =>
      !e.combatStyleHrid || e.combatStyleHrid === weaponCombatStyle
  );
}

/**
 * Build an AbilityDTO for an ability from game data and character ability levels.
 * When useBestAbilities is true, uses boosted levels (60 for regular, 40 for special)
 * or the player's current level if higher.
 */
function buildAbilityDTO(
  abilityHrid: string,
  abilityLevels: Map<string, number>,
  gameData: GameData,
  useBestAbilities: boolean = false
): AbilityDTO {
  const abilityData = gameData.abilityDetailMap[abilityHrid];
  const ownedLevel = abilityLevels.get(abilityHrid) ?? 1;
  let level = ownedLevel;
  if (useBestAbilities) {
    const boostTarget = abilityData?.isSpecialAbility
      ? BEST_SPECIAL_ABILITY_LEVEL
      : BEST_REGULAR_ABILITY_LEVEL;
    level = Math.max(ownedLevel, boostTarget);
  }
  return {
    hrid: abilityHrid,
    level,
    triggers: abilityData?.defaultCombatTriggers ?? [],
  };
}

/** Collect unique weapons from gear pool across main_hand and two_hand slots. */
function collectWeaponPool(
  gearPool: Map<string, EquipmentDTO[]>
): EquipmentDTO[] {
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

/**
 * Build a gear pool from ALL equipment in gameData that the player meets
 * level requirements for.
 * - "best7": Each item uses the better of +7 or the player's owned enhancement.
 *   Skips unowned refined items.
 * - "best10R": All items at +10, preferring refined versions when available.
 *   Does NOT skip unowned refined items.
 */
function buildAllGearPool(
  playerConfig: PlayerConfig,
  gameData: GameData,
  ownedGearPool: Map<string, EquipmentDTO[]>,
  mode: BestGearMode = "best7"
): Map<string, EquipmentDTO[]> {
  // Build lookup: item hrid → highest owned enhancement level
  const ownedEnhancement = new Map<string, number>();
  for (const items of ownedGearPool.values()) {
    for (const item of items) {
      const existing = ownedEnhancement.get(item.hrid) ?? 0;
      if (item.enhancementLevel > existing) {
        ownedEnhancement.set(item.hrid, item.enhancementLevel);
      }
    }
  }

  // For "best10R": build a map from base hrid → refined hrid
  const refinedLookup = new Map<string, string>();
  if (mode === "best10R") {
    for (const hrid of Object.keys(gameData.itemDetailMap)) {
      if (hrid.endsWith("_refined")) {
        const baseHrid = hrid.slice(0, -"_refined".length);
        refinedLookup.set(baseHrid, hrid);
      }
    }
  }

  const pool = new Map<string, EquipmentDTO[]>();
  const playerSkills: Record<string, number> = {
    "/skills/stamina": playerConfig.staminaLevel,
    "/skills/intelligence": playerConfig.intelligenceLevel,
    "/skills/attack": playerConfig.attackLevel,
    "/skills/melee": playerConfig.meleeLevel,
    "/skills/defense": playerConfig.defenseLevel,
    "/skills/ranged": playerConfig.rangedLevel,
    "/skills/magic": playerConfig.magicLevel,
  };

  for (const item of Object.values(gameData.itemDetailMap)) {
    const ed = item.equipmentDetail;
    if (!ed) continue;

    const slot = ed.type;
    // Only include combat equipment slots
    if (
      !WEAPON_SLOTS.includes(slot) &&
      !NON_WEAPON_EQUIPMENT_SLOTS.includes(slot)
    )
      continue;

    // Check level requirements
    if (!meetsLevelReqs(ed.levelRequirements, playerSkills)) continue;

    const isRefined = item.hrid.endsWith("_refined");
    const isOwned = ownedEnhancement.has(item.hrid);

    if (mode === "best10R") {
      // Skip base items that have a refined counterpart (we'll add the refined one)
      if (!isRefined && refinedLookup.has(item.hrid)) continue;
      // Include ALL refined items (even unowned)
      const owned = ownedEnhancement.get(item.hrid) ?? 0;
      const enhancementLevel = Math.max(10, owned);
      if (!pool.has(slot)) pool.set(slot, []);
      pool.get(slot)!.push({ hrid: item.hrid, enhancementLevel });
    } else {
      // "best7" behavior: skip refined items the player doesn't own
      if (isRefined && !isOwned) continue;
      const owned = ownedEnhancement.get(item.hrid) ?? 0;
      const enhancementLevel = isOwned ? Math.max(7, owned) : 7;
      if (!pool.has(slot)) pool.set(slot, []);
      pool.get(slot)!.push({ hrid: item.hrid, enhancementLevel });
    }
  }

  return pool;
}

/** Check if a player's skill levels meet all equipment level requirements. */
function meetsLevelReqs(
  requirements: Array<{ skillHrid: string; level: number }> | undefined | null,
  playerSkills: Record<string, number>
): boolean {
  if (!requirements || requirements.length === 0) return true;
  for (const req of requirements) {
    if ((playerSkills[req.skillHrid] ?? 1) < req.level) return false;
  }
  return true;
}

/**
 * Find the loadout that originally uses this weapon.
 * Returns the first loadout where main_hand or two_hand matches.
 */
function findLoadoutForWeapon(
  weapon: EquipmentDTO,
  combatLoadouts: CombatLoadout[]
): CombatLoadout | null {
  // Exact match: same hrid and enhancement level
  for (const loadout of combatLoadouts) {
    const eq = loadout.config.equipment;
    for (const slot of WEAPON_SLOTS) {
      const item = eq[slot as EquipmentSlotHrid];
      if (
        item &&
        item.hrid === weapon.hrid &&
        item.enhancementLevel === weapon.enhancementLevel
      ) {
        return loadout;
      }
    }
  }

  // Fuzzy match: strip _refined suffix, ignore enhancement level.
  // In best10R mode, pool weapons are refined (+10) but loadouts have base versions (+7).
  const weaponBase = weapon.hrid.endsWith("_refined")
    ? weapon.hrid.slice(0, -"_refined".length)
    : weapon.hrid;
  for (const loadout of combatLoadouts) {
    const eq = loadout.config.equipment;
    for (const slot of WEAPON_SLOTS) {
      const item = eq[slot as EquipmentSlotHrid];
      if (!item) continue;
      const itemBase = item.hrid.endsWith("_refined")
        ? item.hrid.slice(0, -"_refined".length)
        : item.hrid;
      if (itemBase === weaponBase) return loadout;
    }
  }

  return combatLoadouts[0] ?? null;
}

/**
 * Set a weapon on a config, handling two-hand / main-hand / off-hand conflicts.
 */
function setWeaponOnConfig(
  config: PlayerConfig,
  weapon: EquipmentDTO,
  gameData: GameData
): void {
  const slotType = getItemSlotType(weapon.hrid, gameData);

  if (slotType === "/equipment_types/two_hand") {
    config.equipment["/equipment_types/two_hand"] = weapon;
    config.equipment["/equipment_types/main_hand"] = null;
    config.equipment["/equipment_types/off_hand"] = null;
  } else if (slotType === "/equipment_types/main_hand") {
    config.equipment["/equipment_types/main_hand"] = weapon;
    config.equipment["/equipment_types/two_hand"] = null;
    // Keep off_hand as-is
  }
}

/**
 * When using best7/best10R mode, initialize non-weapon equipment slots
 * from the gear pool. For each slot, finds the pool version of the
 * currently equipped item (preferring refined variant), or keeps the
 * original if no match exists.
 */
function initializeGearFromPool(
  config: PlayerConfig,
  gearPool: Map<string, EquipmentDTO[]>,
  skipSlots?: Set<string>,
): void {
  for (const slot of NON_WEAPON_EQUIPMENT_SLOTS) {
    if (skipSlots?.has(slot)) continue;
    const currentItem = config.equipment[slot as EquipmentSlotHrid];
    if (!currentItem?.hrid) continue;

    const poolItems = gearPool.get(slot);
    if (!poolItems || poolItems.length === 0) continue;

    // Try: 1) refined version of current item, 2) same hrid in pool
    const refinedHrid = currentItem.hrid.endsWith("_refined")
      ? currentItem.hrid
      : currentItem.hrid + "_refined";
    const match =
      poolItems.find((p) => p.hrid === refinedHrid) ??
      poolItems.find((p) => p.hrid === currentItem.hrid);

    if (match) {
      config.equipment[slot as EquipmentSlotHrid] = { ...match };
    }
  }
}

/** Check if config currently has a two-handed weapon equipped. */
function hasTwoHandWeapon(config: PlayerConfig): boolean {
  return !!config.equipment["/equipment_types/two_hand"]?.hrid;
}

/** Get the currently equipped weapon hrid from config. */
function getEquippedWeaponHrid(config: PlayerConfig): string | null {
  return (
    config.equipment["/equipment_types/two_hand"]?.hrid ??
    config.equipment["/equipment_types/main_hand"]?.hrid ??
    null
  );
}

// =============================================================================
// Main Optimizer
// =============================================================================

export function optimizeLabyrinthLoadouts(
  charData: FullCharacterData,
  defaultLoadoutId: string,
  monsterOverrides: Record<string, string>,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number,
  gameData: GameData,
  successRate: number,
  onProgress?: (progress: LabyrinthOptProgress) => void,
  bestGearMode: BestGearMode = "owned",
  useBestAbilities: boolean = false
): LabyrinthOptResult {
  const monsters = getLabyrinthMonsters(gameData);
  const { abilityLevels, combatLoadouts } = charData;

  const defaultLoadout =
    combatLoadouts.find((l) => l.id === defaultLoadoutId) ?? combatLoadouts[0];

  // When bestGearMode is not "owned", build a pool from ALL equippable items
  const gearPool = bestGearMode !== "owned"
    ? buildAllGearPool(defaultLoadout.config, gameData, charData.gearPool, bestGearMode)
    : charData.gearPool;

  // Collect weapon pool
  const weaponPool = collectWeaponPool(gearPool);
  if (weaponPool.length === 0) {
    // No weapons at all — treat unarmed as the only option
    weaponPool.push({ hrid: "", enhancementLevel: 0 });
  }

  // Partition abilities into regular and special.
  // When useBestAbilities is enabled, include ALL abilities from game data.
  const allAbilityHrids = useBestAbilities
    ? Object.keys(gameData.abilityDetailMap)
    : Array.from(abilityLevels.keys());
  const regularAbilities = allAbilityHrids.filter(
    (h) => !gameData.abilityDetailMap[h]?.isSpecialAbility
  );
  const specialAbilities = allAbilityHrids.filter(
    (h) => gameData.abilityDetailMap[h]?.isSpecialAbility
  );

  let simRuns = 0;

  const simFight = (
    config: PlayerConfig,
    monsterHrid: string,
    level: number
  ): { success: boolean; killTimeNs: number } => {
    simRuns++;
    return simulateLabyrinthFight(
      config,
      monsterHrid,
      level,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData
    );
  };

  const findMax = (
    config: PlayerConfig,
    monsterHrid: string
  ): { maxLevel: number; killTimeNs: number } => {
    const res = findMaxLabyrinthLevelCounted(
      config,
      monsterHrid,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData,
      successRate
    );
    simRuns += res.simCount;
    return { maxLevel: res.maxLevel, killTimeNs: res.killTimeNs };
  };

  const monsterResults: MonsterOptResult[] = [];

  // --- Pre-pass: compute all baselines first ---
  // We need all baselines upfront so we can determine which floor is the
  // player's current ceiling and skip monsters that already reach it.
  const baselines: { monsterHrid: string; config: PlayerConfig; maxLevel: number; killTimeNs: number }[] = [];
  for (let mi = 0; mi < monsters.length; mi++) {
    const monsterHrid = monsters[mi];
    const overrideId = monsterOverrides[monsterHrid];
    const baselineLoadout = overrideId
      ? combatLoadouts.find((l) => l.id === overrideId) ?? defaultLoadout
      : defaultLoadout;

    onProgress?.({
      phase: "baseline",
      monsterHrid,
      monstersCompleted: mi,
      monstersTotal: monsters.length,
      simRunsSoFar: simRuns,
      detail: "Finding baseline level",
    });

    const result = findMax(baselineLoadout.config, monsterHrid);
    baselines.push({ monsterHrid, config: baselineLoadout.config, maxLevel: result.maxLevel, killTimeNs: result.killTimeNs });
  }

  // Find the highest floor any monster can reach with current gear.
  // A monster "reaches" a floor if its maxLevel >= that floor's minLevel.
  // Monsters that can already reach this floor don't need optimization —
  // only the ones that can't reach it are bottlenecks worth optimizing.
  const bestBaselineLevel = Math.max(...baselines.map(b => b.maxLevel));
  let bestFloorMin = 0;
  for (const [, fmin] of FLOORS) {
    if (bestBaselineLevel >= fmin) bestFloorMin = fmin;
  }

  for (let mi = 0; mi < monsters.length; mi++) {
    const { monsterHrid, config: baselineConfig, maxLevel: baselineMaxLevel, killTimeNs: baselineKillTime } = baselines[mi];
    const baseline = { maxLevel: baselineMaxLevel, killTimeNs: baselineKillTime };

    onProgress?.({
      phase: "optimizing",
      monsterHrid,
      monstersCompleted: mi,
      monstersTotal: monsters.length,
      simRunsSoFar: simRuns,
      detail: "Trying weapons & abilities",
    });

    // In "best10R" mode, skip optimization for monsters that can already
    // reach the highest floor any monster reaches — they're not the bottleneck.
    if (bestGearMode === "best10R" && baseline.maxLevel >= bestFloorMin) {
      monsterResults.push({
        monsterHrid,
        baselineLevel: baseline.maxLevel,
        optimizedLevel: baseline.maxLevel,
        levelDelta: 0,
        optimizedConfig: baselineConfig,
        weaponHrid: getEquippedWeaponHrid(baselineConfig),
        changes: [],
        killTimeNs: baseline.killTimeNs,
      });
      onProgress?.({
        phase: "optimizing",
        monsterHrid,
        monstersCompleted: mi + 1,
        monstersTotal: monsters.length,
        simRunsSoFar: simRuns,
      });
      continue;
    }

    // Phase 2: Try each weapon candidate
    let bestOverallLevel = baseline.maxLevel;
    let bestOverallKillTime = baseline.killTimeNs;
    let bestOverallConfig = baselineConfig;

    for (const weapon of weaponPool) {
      if (!weapon.hrid) continue; // Skip unarmed placeholder

      // Get weapon's combat style
      const weaponStyle = getWeaponCombatStyle(weapon.hrid, gameData);

      // Start from the loadout that originally uses this weapon
      const sourceLoadout = findLoadoutForWeapon(weapon, combatLoadouts);
      const config = cloneConfig(sourceLoadout?.config ?? baselineConfig);

      // Apply the weapon
      setWeaponOnConfig(config, weapon, gameData);

      // In best7/best10R mode, upgrade non-weapon slots to pool-quality gear
      if (bestGearMode !== "owned") {
        const skipSlots = bestGearMode === "best10R" ? BEST10R_SKIP_SLOTS : undefined;
        initializeGearFromPool(config, gearPool, skipSlots);
      }

      // Filter compatible abilities for this weapon style
      const compatRegular = regularAbilities.filter((h) =>
        isAbilityCompatible(h, weaponStyle, gameData)
      );
      const compatSpecial = specialAbilities.filter((h) =>
        isAbilityCompatible(h, weaponStyle, gameData)
      );

      // Find initial level with this weapon + existing abilities
      let currentResult = findMax(config, monsterHrid);
      let currentLevel = currentResult.maxLevel;

      // --- Optimize ability slots (greedy) ---
      // Track which abilities are already assigned to prevent duplicates
      const usedAbilities = new Set<string>();
      for (let slot = 0; slot < ABILITY_SLOT_COUNT; slot++) {
        const existing = config.abilities[slot];
        if (existing?.hrid) usedAbilities.add(existing.hrid);
      }

      for (let slot = 0; slot < ABILITY_SLOT_COUNT; slot++) {
        const originalAbility = config.abilities[slot];
        let bestLevel = currentLevel;
        let bestKillTime = currentResult.killTimeNs;
        let bestAbility: AbilityDTO | null = originalAbility;

        // Remove current slot's ability from used set so it can be reassigned here
        if (originalAbility?.hrid) usedAbilities.delete(originalAbility.hrid);

        for (const abilityHrid of compatRegular) {
          // Skip abilities already assigned to other slots
          if (usedAbilities.has(abilityHrid)) continue;

          const dto = buildAbilityDTO(abilityHrid, abilityLevels, gameData, useBestAbilities);
          config.abilities[slot] = dto;

          // Quick test at current best level
          const test = simFight(config, monsterHrid, bestLevel);
          if (!test.success) {
            // Strictly worse or equal, skip
            continue;
          }

          // Probe upward
          let probeLevel = bestLevel;
          let probeKillTime = test.killTimeNs;
          for (let delta = 1; delta <= 10; delta++) {
            const next = simFight(config, monsterHrid, bestLevel + delta);
            if (next.success) {
              probeLevel = bestLevel + delta;
              probeKillTime = next.killTimeNs;
            } else {
              break;
            }
          }

          if (
            probeLevel > bestLevel ||
            (probeLevel === bestLevel && probeKillTime < bestKillTime)
          ) {
            bestLevel = probeLevel;
            bestKillTime = probeKillTime;
            bestAbility = dto;
          }
        }

        // Also try empty slot
        config.abilities[slot] = null;
        const emptyTest =
          currentLevel > 0
            ? simFight(config, monsterHrid, currentLevel)
            : { success: false, killTimeNs: 0 };
        if (
          emptyTest.success &&
          currentLevel > bestLevel
        ) {
          // Empty is at least as good at current level, but we already checked others
          // Only pick empty if it beats everything
        }

        // Set best ability for this slot and mark it as used
        config.abilities[slot] = bestAbility;
        if (bestAbility?.hrid) usedAbilities.add(bestAbility.hrid);
        if (bestLevel > currentLevel) {
          currentLevel = bestLevel;
          currentResult = { maxLevel: bestLevel, killTimeNs: bestKillTime };
        }
      }

      // --- Optimize special ability slot ---
      {
        let bestLevel = currentLevel;
        let bestKillTime = currentResult.killTimeNs;
        let bestSpecial: AbilityDTO | null = config.specialAbility;

        for (const abilityHrid of compatSpecial) {
          const dto = buildAbilityDTO(abilityHrid, abilityLevels, gameData, useBestAbilities);
          config.specialAbility = dto;

          const test = simFight(config, monsterHrid, bestLevel);
          if (!test.success) continue;

          let probeLevel = bestLevel;
          let probeKillTime = test.killTimeNs;
          for (let delta = 1; delta <= 10; delta++) {
            const next = simFight(config, monsterHrid, bestLevel + delta);
            if (next.success) {
              probeLevel = bestLevel + delta;
              probeKillTime = next.killTimeNs;
            } else {
              break;
            }
          }

          if (
            probeLevel > bestLevel ||
            (probeLevel === bestLevel && probeKillTime < bestKillTime)
          ) {
            bestLevel = probeLevel;
            bestKillTime = probeKillTime;
            bestSpecial = dto;
          }
        }

        // Also try no special
        config.specialAbility = null;
        const emptyTest =
          currentLevel > 0
            ? simFight(config, monsterHrid, currentLevel)
            : { success: false, killTimeNs: 0 };
        if (emptyTest.success && currentLevel > bestLevel) {
          bestSpecial = null;
          bestLevel = currentLevel;
        }

        config.specialAbility = bestSpecial;
        if (bestLevel > currentLevel) {
          currentLevel = bestLevel;
          currentResult = { maxLevel: bestLevel, killTimeNs: bestKillTime };
        }
      }

      // --- Optimize non-weapon gear (greedy) ---
      const isTwoHand = hasTwoHandWeapon(config);
      const gearSlots = isTwoHand
        ? NON_WEAPON_EQUIPMENT_SLOTS.filter(
            (s) => s !== "/equipment_types/off_hand"
          )
        : NON_WEAPON_EQUIPMENT_SLOTS;

      const effectiveGearSlots = bestGearMode === "best10R"
        ? gearSlots.filter(s => !BEST10R_SKIP_SLOTS.has(s))
        : gearSlots;

      for (const slot of effectiveGearSlots) {
        const candidates = gearPool.get(slot);
        if (!candidates || candidates.length <= 1) continue;

        const originalItem = config.equipment[slot as EquipmentSlotHrid] ?? null;
        let bestLevel = currentLevel;
        let bestKillTime = currentResult.killTimeNs;
        let bestItem: EquipmentDTO | null = originalItem;

        for (const candidate of candidates) {
          config.equipment[slot as EquipmentSlotHrid] = candidate;

          const test =
            bestLevel > 0
              ? simFight(config, monsterHrid, bestLevel)
              : { success: false, killTimeNs: 0 };

          if (bestLevel === 0 || !test.success) {
            // If bestLevel is 0, try finding if this gear lets us beat level 1
            if (bestLevel === 0) {
              const lvl1 = simFight(config, monsterHrid, 1);
              if (lvl1.success) {
                bestLevel = 1;
                bestKillTime = lvl1.killTimeNs;
                bestItem = candidate;
                // Probe upward
                for (let delta = 1; delta <= 10; delta++) {
                  const next = simFight(config, monsterHrid, 1 + delta);
                  if (next.success) {
                    bestLevel = 1 + delta;
                    bestKillTime = next.killTimeNs;
                  } else break;
                }
              }
            }
            continue;
          }

          // Probe upward
          let probeLevel = bestLevel;
          let probeKillTime = test.killTimeNs;
          for (let delta = 1; delta <= 10; delta++) {
            const next = simFight(config, monsterHrid, bestLevel + delta);
            if (next.success) {
              probeLevel = bestLevel + delta;
              probeKillTime = next.killTimeNs;
            } else break;
          }

          if (
            probeLevel > bestLevel ||
            (probeLevel === bestLevel && probeKillTime < bestKillTime)
          ) {
            bestLevel = probeLevel;
            bestKillTime = probeKillTime;
            bestItem = candidate;
          }
        }

        config.equipment[slot as EquipmentSlotHrid] = bestItem;
        if (bestLevel > currentLevel) {
          currentLevel = bestLevel;
          currentResult = { maxLevel: bestLevel, killTimeNs: bestKillTime };
        }
      }

      // Final re-check with full binary search to get accurate max
      const finalResult = findMax(config, monsterHrid);
      let bestWeaponLevel = finalResult.maxLevel;
      let bestWeaponKillTime = finalResult.killTimeNs;
      let bestWeaponConfig = config;

      // Try tanky body+legs combos (best10R only)
      if (bestGearMode === "best10R") {
        const isMelee = MELEE_COMBAT_STYLES.has(weaponStyle ?? "");
        for (const combo of TANKY_BODY_LEGS_COMBOS) {
          if (combo.meleeOnly && !isMelee) continue;
          const bodyItem = gearPool
            .get("/equipment_types/body")
            ?.find((p) => p.hrid === combo.bodyHrid);
          const legsItem = gearPool
            .get("/equipment_types/legs")
            ?.find((p) => p.hrid === combo.legsHrid);
          if (!bodyItem || !legsItem) continue;

          const comboConfig = cloneConfig(config);
          comboConfig.equipment["/equipment_types/body"] = { ...bodyItem };
          comboConfig.equipment["/equipment_types/legs"] = { ...legsItem };

          const comboResult = findMax(comboConfig, monsterHrid);
          if (
            comboResult.maxLevel > bestWeaponLevel ||
            (comboResult.maxLevel === bestWeaponLevel &&
              comboResult.killTimeNs < bestWeaponKillTime)
          ) {
            bestWeaponLevel = comboResult.maxLevel;
            bestWeaponKillTime = comboResult.killTimeNs;
            bestWeaponConfig = comboConfig;
          }
        }
      }

      if (
        bestWeaponLevel > bestOverallLevel ||
        (bestWeaponLevel === bestOverallLevel &&
          bestWeaponKillTime < bestOverallKillTime)
      ) {
        bestOverallLevel = bestWeaponLevel;
        bestOverallKillTime = bestWeaponKillTime;
        bestOverallConfig = cloneConfig(bestWeaponConfig);
      }
    }

    // If no weapon worked (unarmed only), try optimizing with the baseline as-is
    if (weaponPool.length === 1 && !weaponPool[0].hrid) {
      bestOverallLevel = baseline.maxLevel;
      bestOverallKillTime = baseline.killTimeNs;
      bestOverallConfig = baselineConfig;
    }

    // Compute changes
    const changes = computeChanges(baselineConfig, bestOverallConfig);

    monsterResults.push({
      monsterHrid,
      baselineLevel: baseline.maxLevel,
      optimizedLevel: bestOverallLevel,
      levelDelta: bestOverallLevel - baseline.maxLevel,
      optimizedConfig: bestOverallConfig,
      weaponHrid: getEquippedWeaponHrid(bestOverallConfig),
      changes,
      killTimeNs: bestOverallKillTime,
    });

    onProgress?.({
      phase: "optimizing",
      monsterHrid,
      monstersCompleted: mi + 1,
      monstersTotal: monsters.length,
      simRunsSoFar: simRuns,
    });
  }

  const baselineTotalLevels = monsterResults.reduce(
    (s, r) => s + r.baselineLevel,
    0
  );
  const optimizedTotalLevels = monsterResults.reduce(
    (s, r) => s + r.optimizedLevel,
    0
  );

  return {
    monsterResults,
    baselineTotalLevels,
    optimizedTotalLevels,
    totalSimRuns: simRuns,
  };
}

// =============================================================================
// Counted binary search wrapper
// =============================================================================

function findMaxLabyrinthLevelCounted(
  config: PlayerConfig,
  monsterHrid: string,
  crateBuffs: Buff[],
  sealBuffs: Buff[],
  wisdomBuffBonus: number,
  gameData: GameData,
  successRate: number
): { maxLevel: number; killTimeNs: number; simCount: number } {
  let simCount = 0;
  const result = findMaxLabyrinthLevel(
    config,
    monsterHrid,
    crateBuffs,
    sealBuffs,
    wisdomBuffBonus,
    gameData,
    300,
    () => {
      simCount++;
    },
    successRate
  );
  return { ...result, simCount };
}

// =============================================================================
// Change Detection
// =============================================================================

function computeChanges(
  baseline: PlayerConfig,
  optimized: PlayerConfig,
): LoadoutChange[] {
  const changes: LoadoutChange[] = [];

  // Equipment changes
  const allSlots = new Set([
    ...Object.keys(baseline.equipment),
    ...Object.keys(optimized.equipment),
  ]);
  for (const slot of allSlots) {
    const oldEquip = baseline.equipment[slot as EquipmentSlotHrid];
    const newEquip = optimized.equipment[slot as EquipmentSlotHrid];
    const oldKey = oldEquip ? `${oldEquip.hrid}::${oldEquip.enhancementLevel}` : null;
    const newKey = newEquip ? `${newEquip.hrid}::${newEquip.enhancementLevel}` : null;
    if (oldKey !== newKey) {
      changes.push({
        slotType: "equipment",
        slotName: slot,
        originalHrid: oldEquip?.hrid ?? null,
        optimizedHrid: newEquip?.hrid ?? null,
      });
    }
  }

  // Ability changes
  const maxAbilities = Math.max(
    baseline.abilities.length,
    optimized.abilities.length
  );
  for (let i = 0; i < maxAbilities; i++) {
    const oldHrid = baseline.abilities[i]?.hrid ?? null;
    const newHrid = optimized.abilities[i]?.hrid ?? null;
    if (oldHrid !== newHrid) {
      changes.push({
        slotType: "ability",
        slotName: `Ability ${i + 1}`,
        originalHrid: oldHrid,
        optimizedHrid: newHrid,
      });
    }
  }

  // Special ability
  const oldSpecial = baseline.specialAbility?.hrid ?? null;
  const newSpecial = optimized.specialAbility?.hrid ?? null;
  if (oldSpecial !== newSpecial) {
    changes.push({
      slotType: "specialAbility",
      slotName: "Special",
      originalHrid: oldSpecial,
      optimizedHrid: newSpecial,
    });
  }

  return changes;
}
