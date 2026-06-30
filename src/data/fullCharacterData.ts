// =============================================================================
// Full Character Data Parser - Parses the complete MWI character export
// =============================================================================
// Handles the full character data format (from WebSocket init_character_data)
// which includes multiple combat loadouts, skill levels, house rooms,
// achievements, and labyrinth state.
//
// Key difference from Toolasha export: contains characterLoadoutMap with
// multiple named loadouts, each with their own equipment, abilities,
// consumables, and triggers.

import type {
  PlayerConfig,
  EquipmentDTO,
  ConsumableDTO,
  AbilityDTO,
  TriggerData,
  HouseRoomLevels,
  AchievementMap,
  EquipmentSlotHrid,
  GameData,
} from "../engine/types";

// =============================================================================
// Types
// =============================================================================

/** A named combat loadout extracted from full character data. */
export interface CombatLoadout {
  id: string;
  name: string;
  /** Full PlayerConfig for this loadout (ready for simulation). */
  config: PlayerConfig;
}

/** Permanent labyrinth upgrades that buff the player only inside the lab. */
export interface LabyrinthUpgradeState {
  combatDamage: number;
  attackSpeed: number;
  castSpeed: number;
  criticalRate: number;
  experience: number;
  skillSpeed: number;
  skillEfficiency: number;
  skillSuccess: number;
  skillDoubleProgress: number;
}

/** Parsed result from full character data. */
export interface FullCharacterData {
  /** Player name/hrid. */
  hrid: string;
  /** Combat loadouts (different equipment/ability setups). */
  combatLoadouts: CombatLoadout[];
  /** Labyrinth crate selections from the character's current labyrinth state. */
  labyrinthCrates: {
    coffeeCrate: string;
    foodCrate: string;
    teaCrate: string;
  };
  /** Labyrinth per-monster loadout assignments (monster hrid → loadout id). */
  labyrinthMonsterLoadouts: Record<string, string>;
  /** Permanent labyrinth combat upgrade levels (token-purchased). */
  labyrinthUpgrades: LabyrinthUpgradeState;
  /** All trained ability hrids → levels (from characterAbilities). */
  abilityLevels: Map<string, number>;
  /** Equipment slot → unique items across all combat loadouts. */
  gearPool: Map<string, EquipmentDTO[]>;
}

// =============================================================================
// Skill hrid to level property mapping
// =============================================================================

const SKILL_HRID_TO_LEVEL: Record<string, keyof PlayerConfig> = {
  "/skills/stamina": "staminaLevel",
  "/skills/intelligence": "intelligenceLevel",
  "/skills/attack": "attackLevel",
  "/skills/melee": "meleeLevel",
  "/skills/defense": "defenseLevel",
  "/skills/ranged": "rangedLevel",
  "/skills/magic": "magicLevel",
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse full character data JSON into structured combat loadouts.
 * Returns all combat loadouts, each as a complete PlayerConfig.
 */
/**
 * Build max enhancement level lookup from all owned items.
 * Scans both characterItems (inventory) and items equipped in combat loadouts,
 * since equipped items might not always be present in characterItems.
 */
function buildMaxEnhancementMap(data: Record<string, unknown>): Map<string, number> {
  const maxEnhByItem = new Map<string, number>();

  // Source 1: All items from characterItems (inventory, bank, etc.)
  const characterItems = data.characterItems;
  if (Array.isArray(characterItems)) {
    for (const item of characterItems as Record<string, unknown>[]) {
      const itemHrid = item?.itemHrid as string | undefined;
      const enhancementLevel = (item?.enhancementLevel as number) ?? 0;
      if (itemHrid) {
        const current = maxEnhByItem.get(itemHrid) ?? 0;
        if (enhancementLevel > current) {
          maxEnhByItem.set(itemHrid, enhancementLevel);
        }
      }
    }
  }

  // Source 2: Items equipped in combat loadouts (may not be in characterItems)
  const loadoutMap = data.characterLoadoutMap as Record<string, any>;
  if (loadoutMap) {
    for (const loadout of Object.values(loadoutMap)) {
      if (loadout?.actionTypeHrid !== "/action_types/combat") continue;
      const wearableMap = loadout.wearableMap as Record<string, any>;
      if (wearableMap) {
        for (const item of Object.values(wearableMap) as Record<string, any>[]) {
          const itemHrid = item?.itemHrid as string | undefined;
          const enhancementLevel = (item?.enhancementLevel as number) ?? 0;
          if (itemHrid) {
            const current = maxEnhByItem.get(itemHrid) ?? 0;
            if (enhancementLevel > current) {
              maxEnhByItem.set(itemHrid, enhancementLevel);
            }
          }
        }
      }
    }
  }

  return maxEnhByItem;
}

export function parseFullCharacterData(
  jsonString: string,
  gameData: GameData
): FullCharacterData {
  let data: Record<string, any>;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(
      `Failed to parse character data JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (!data || typeof data !== "object") {
    throw new Error("Character data must be a non-null JSON object.");
  }

  // Validate it's full char data (has characterLoadoutMap)
  if (!data.characterLoadoutMap) {
    throw new Error(
      "This doesn't look like full character data. Missing characterLoadoutMap. " +
        "Please paste the full character data export, not the Toolasha/combat-sim export."
    );
  }

  // --- Player name ---
  const hrid = data.character?.name ?? "player";

  // --- Shared player data ---
  const skills = parseSkills(data.characterSkills);
  const houseRooms = parseHouseRooms(data.characterHouseRoomMap);
  const achievements = parseAchievements(data.characterAchievements);

  // Build ability level lookup from characterAbilities
  const abilityLevels = new Map<string, number>();
  if (Array.isArray(data.characterAbilities)) {
    for (const ab of data.characterAbilities) {
      if (ab?.abilityHrid) {
        abilityLevels.set(ab.abilityHrid, ab.level ?? 1);
      }
    }
  }

  // --- Build max enhancement level lookup from all owned items ---
  // When useExactEnhancement is false (the default), the game uses the highest
  // enhanced version of each item the player owns, not the level stored in the loadout.
  // This scans both characterItems (inventory/bank) and items equipped in loadouts,
  // since equipped items might not always be in characterItems (as noted in buildGearPool).
  const maxEnhByItem = buildMaxEnhancementMap(data);

  // --- Parse combat loadouts ---
  const combatLoadouts: CombatLoadout[] = [];
  const loadoutMap = data.characterLoadoutMap as Record<string, any>;

  for (const [id, loadout] of Object.entries(loadoutMap)) {
    if (loadout.actionTypeHrid !== "/action_types/combat") continue;

    const config = parseLoadoutToConfig(
      loadout,
      hrid,
      skills,
      houseRooms,
      achievements,
      abilityLevels,
      gameData
    );

    // When useExactEnhancement is false (default), upgrade each equipped item
    // to the highest enhancement level the player owns for that item hrid.
    if (!loadout.useExactEnhancement) {
      for (const [slot, item] of Object.entries(config.equipment)) {
        if (!item?.hrid) continue;
        const maxEnh = maxEnhByItem.get(item.hrid);
        if (maxEnh != null && maxEnh > item.enhancementLevel) {
          config.equipment[slot as EquipmentSlotHrid] = {
            hrid: item.hrid,
            enhancementLevel: maxEnh,
          };
        }
      }
    }

    combatLoadouts.push({
      id,
      name: loadout.name ?? `Loadout ${id}`,
      config,
    });
  }

  // --- Labyrinth crate state ---
  const lab = data.labyrinth ?? {};
  const labyrinthCrates = {
    coffeeCrate: lab.coffeeCrateItemHrid ?? "",
    foodCrate: lab.foodCrateItemHrid ?? "",
    teaCrate: lab.teaCrateItemHrid ?? "",
  };

  // --- Labyrinth per-monster loadout assignments ---
  const labyrinthMonsterLoadouts = parseLabyrinthMonsterLoadouts(
    data.characterSetting,
    combatLoadouts
  );

  // --- Build gear pool from all owned equipment (inventory + loadouts) ---
  const gearPool = buildGearPool(data, combatLoadouts, gameData);

  // --- Permanent labyrinth combat upgrades ---
  const ci = (data.characterInfo ?? {}) as Record<string, unknown>;
  const num = (k: string): number => Math.max(0, Number(ci[k]) || 0);
  const labyrinthUpgrades: LabyrinthUpgradeState = {
    combatDamage:        num("labyrinthCombatDamageLevel"),
    attackSpeed:         num("labyrinthAttackSpeedLevel"),
    castSpeed:           num("labyrinthCastSpeedLevel"),
    criticalRate:        num("labyrinthCriticalRateLevel"),
    experience:          num("labyrinthExperienceLevel"),
    skillSpeed:          num("labyrinthSkillActionSpeedLevel"),
    skillEfficiency:     num("labyrinthSkillingEfficiencyLevel"),
    skillSuccess:        num("labyrinthSkillingSuccessLevel"),
    skillDoubleProgress: num("labyrinthSkillingDoubleProgressLevel"),
  };

  return { hrid, combatLoadouts, labyrinthCrates, labyrinthMonsterLoadouts, labyrinthUpgrades, abilityLevels, gearPool };
}

// =============================================================================
// Loadout → PlayerConfig
// =============================================================================

function parseLoadoutToConfig(
  loadout: any,
  hrid: string,
  skills: Record<string, number>,
  houseRooms: HouseRoomLevels,
  achievements: AchievementMap,
  abilityLevels: Map<string, number>,
  gameData: GameData
): PlayerConfig {
  // --- Equipment from wearableMap ---
  const equipment = parseWearableMap(loadout.wearableMap);

  // --- Food & Drinks ---
  const food = parseConsumableHrids(
    loadout.foodItemHrids,
    loadout.consumableCombatTriggersMap
  );
  const drinks = parseConsumableHrids(
    loadout.drinkItemHrids,
    loadout.consumableCombatTriggersMap
  );

  // --- Abilities from abilityMap ---
  const { abilities, specialAbility } = parseAbilityMap(
    loadout.abilityMap,
    loadout.abilityCombatTriggersMap,
    abilityLevels,
    gameData
  );

  return {
    hrid,
    staminaLevel: skills.staminaLevel ?? 1,
    intelligenceLevel: skills.intelligenceLevel ?? 1,
    attackLevel: skills.attackLevel ?? 1,
    meleeLevel: skills.meleeLevel ?? 1,
    defenseLevel: skills.defenseLevel ?? 1,
    rangedLevel: skills.rangedLevel ?? 1,
    magicLevel: skills.magicLevel ?? 1,
    equipment,
    food,
    drinks,
    abilities,
    specialAbility,
    houseRooms,
    achievements,
  };
}

// =============================================================================
// Wearable Map Parser
// =============================================================================

/**
 * Parse wearableMap entries like:
 * "/item_locations/back" => "77022::/item_locations/inventory::/items/enchanted_cloak_refined::11"
 */
function parseWearableMap(
  wearableMap: Record<string, string> | undefined
): Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> {
  const equipment: Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> = {};
  if (!wearableMap) return equipment;

  for (const [locationHrid, value] of Object.entries(wearableMap)) {
    if (!value) continue;

    // Parse "charId::location::itemHrid::enhancementLevel"
    const parts = value.split("::");
    if (parts.length < 4) continue;

    const itemHrid = parts[2]; // e.g., "/items/enchanted_cloak_refined"
    const enhancementLevel = parseInt(parts[3], 10) || 0;

    if (!itemHrid || !itemHrid.startsWith("/items/")) continue;

    // Convert /item_locations/back -> /equipment_types/back
    const equipSlot = locationHrid.replace("item_locations", "equipment_types");

    equipment[equipSlot] = { hrid: itemHrid, enhancementLevel };
  }

  return equipment;
}

// =============================================================================
// Consumable Parser
// =============================================================================

function parseConsumableHrids(
  itemHrids: string[] | undefined,
  triggerMap: Record<string, any[]> | undefined
): (ConsumableDTO | null)[] {
  if (!Array.isArray(itemHrids)) return [];

  return itemHrids.map((hrid) => {
    if (!hrid) return null;

    const triggers: TriggerData[] = [];
    const rawTriggers = triggerMap?.[hrid];
    if (Array.isArray(rawTriggers)) {
      for (const t of rawTriggers) {
        if (t && typeof t === "object") {
          triggers.push({
            dependencyHrid: String(t.dependencyHrid ?? ""),
            conditionHrid: String(t.conditionHrid ?? ""),
            comparatorHrid: String(t.comparatorHrid ?? ""),
            value: Number(t.value ?? 0),
          });
        }
      }
    }

    return { hrid, triggers };
  });
}

// =============================================================================
// Ability Map Parser
// =============================================================================

/**
 * Parse loadout abilityMap (slot → abilityHrid) with levels from characterAbilities.
 */
function parseAbilityMap(
  abilityMap: Record<string, string> | undefined,
  triggerMap: Record<string, any[] | null> | undefined,
  abilityLevels: Map<string, number>,
  gameData: GameData
): { abilities: (AbilityDTO | null)[]; specialAbility: AbilityDTO | null } {
  const abilities: (AbilityDTO | null)[] = [];
  let specialAbility: AbilityDTO | null = null;

  if (!abilityMap) return { abilities, specialAbility };

  // Sort by slot number to maintain order
  const sortedSlots = Object.keys(abilityMap)
    .map(Number)
    .sort((a, b) => a - b);

  for (const slot of sortedSlots) {
    const abilityHrid = abilityMap[slot.toString()];
    if (!abilityHrid) {
      abilities.push(null);
      continue;
    }

    const level = abilityLevels.get(abilityHrid) ?? 1;
    const triggers = parseTriggerArray(triggerMap?.[abilityHrid]);

    // Check if special ability
    const isSpecial = gameData.abilityDetailMap[abilityHrid]?.isSpecialAbility;
    if (isSpecial) {
      if (!specialAbility) {
        specialAbility = { hrid: abilityHrid, level, triggers };
      }
      continue;
    }

    abilities.push({ hrid: abilityHrid, level, triggers });
  }

  return { abilities, specialAbility };
}

// =============================================================================
// Shared Helpers
// =============================================================================

function parseSkills(characterSkills: any[]): Record<string, number> {
  const skills: Record<string, number> = {
    staminaLevel: 1,
    intelligenceLevel: 1,
    attackLevel: 1,
    meleeLevel: 1,
    defenseLevel: 1,
    rangedLevel: 1,
    magicLevel: 1,
  };

  if (!Array.isArray(characterSkills)) return skills;

  for (const skill of characterSkills) {
    if (!skill?.skillHrid) continue;
    const levelProp = SKILL_HRID_TO_LEVEL[skill.skillHrid];
    if (levelProp) {
      skills[levelProp as string] = Math.max(1, Math.floor(Number(skill.level) || 1));
    }
  }

  return skills;
}

function parseHouseRooms(
  roomMap: Record<string, any> | undefined
): HouseRoomLevels {
  const rooms: HouseRoomLevels = {};
  if (!roomMap || typeof roomMap !== "object") return rooms;

  for (const [hrid, data] of Object.entries(roomMap)) {
    if (typeof data === "object" && data !== null) {
      rooms[hrid] = Math.max(0, Math.floor(Number(data.level) || 0));
    } else if (typeof data === "number") {
      rooms[hrid] = Math.max(0, Math.floor(data));
    }
  }

  return rooms;
}

function parseAchievements(rawAchievements: any[]): AchievementMap {
  const achievements: AchievementMap = {};
  if (!Array.isArray(rawAchievements)) return achievements;

  for (const ach of rawAchievements) {
    if (ach?.achievementHrid) {
      achievements[ach.achievementHrid] = typeof ach.points === "number" ? ach.points : 1;
    }
  }

  return achievements;
}

/**
 * Build a gear pool from all combat loadouts: slot → unique items.
 * Deduplicates by hrid:enhancementLevel within each slot.
 */
/**
 * Build gear pool from ALL owned equipment: inventory items + equipped loadout items.
 * For each item hrid, only the highest enhancement level is kept (it's always best).
 * Items are grouped by their equipment slot type from game data.
 */
function buildGearPool(
  rawData: Record<string, unknown>,
  combatLoadouts: CombatLoadout[],
  gameData: GameData
): Map<string, EquipmentDTO[]> {
  // Track best enhancement level per (slot, hrid) pair
  const bestBySlotHrid = new Map<string, { slot: string; hrid: string; enhancementLevel: number }>();

  const addItem = (slot: string, hrid: string, enhancementLevel: number) => {
    const key = `${slot}::${hrid}`;
    const existing = bestBySlotHrid.get(key);
    if (!existing || enhancementLevel > existing.enhancementLevel) {
      bestBySlotHrid.set(key, { slot, hrid, enhancementLevel });
    }
  };

  // Source 1: All items from characterItems (inventory + bank + everywhere)
  const characterItems = rawData.characterItems;
  if (Array.isArray(characterItems)) {
    for (const item of characterItems) {
      const hrid = item?.itemHrid as string | undefined;
      if (!hrid) continue;
      const itemDetail = gameData.itemDetailMap[hrid];
      if (!itemDetail?.equipmentDetail) continue;
      const slot = itemDetail.equipmentDetail.type;
      if (!slot) continue;
      const enhLevel = (item.enhancementLevel as number) ?? 0;
      addItem(slot, hrid, enhLevel);
    }
  }

  // Source 2: Items equipped in combat loadouts (may not be in characterItems)
  for (const loadout of combatLoadouts) {
    for (const [slot, item] of Object.entries(loadout.config.equipment)) {
      if (!item?.hrid) continue;
      addItem(slot, item.hrid, item.enhancementLevel);
    }
  }

  // Group by slot
  const pool = new Map<string, EquipmentDTO[]>();
  for (const { slot, hrid, enhancementLevel } of bestBySlotHrid.values()) {
    if (!pool.has(slot)) pool.set(slot, []);
    pool.get(slot)!.push({ hrid, enhancementLevel });
  }

  return pool;
}

/**
 * Parse labyrinthLoadout* settings from characterSetting.
 * Keys like "labyrinthLoadoutFrostSniper" map to loadout IDs (numbers).
 * Converts PascalCase suffix to snake_case monster hrid.
 * Only includes entries whose loadout ID exists in combatLoadouts.
 */
function parseLabyrinthMonsterLoadouts(
  characterSetting: Record<string, any> | undefined,
  combatLoadouts: CombatLoadout[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const combatLoadoutIds = new Set(combatLoadouts.map((l) => l.id));
  const prefix = "labyrinthLoadout";

  // Preferred source: the game's explicit labyrinthLoadout* settings. Older
  // exports included characterSetting; privacy-filtered exports may not.
  if (characterSetting && typeof characterSetting === "object") {
    for (const [key, value] of Object.entries(characterSetting)) {
      if (!key.startsWith(prefix) || value == null) continue;

      const suffix = key.slice(prefix.length);
      // Convert PascalCase to snake_case: "FrostSniper" -> "frost_sniper"
      const snakeCase = suffix
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .slice(1); // remove leading underscore
      const monsterHrid = `/monsters/${snakeCase}`;
      const loadoutId = String(value);

      // Only include if this loadout is a combat loadout
      if (combatLoadoutIds.has(loadoutId)) {
        result[monsterHrid] = loadoutId;
      }
    }
  }

  // Fallback for privacy-filtered exports: infer assignments from combat
  // loadout names. This preserves the common in-game setup where labyrinth
  // loadouts are named after their monster, e.g. "frost sniper" or "mimic".
  const inferred = inferLabyrinthMonsterLoadoutsByName(combatLoadouts);
  for (const [monsterHrid, loadoutId] of Object.entries(inferred)) {
    if (!result[monsterHrid]) result[monsterHrid] = loadoutId;
  }

  return result;
}

const LABYRINTH_MONSTER_NAMES = [
  "Shadow Archer", "Pyre Hunter", "Frost Sniper", "Siren", "Salamander",
  "Dryad", "Giant Scorpion", "Giant Mantis", "Cyclops", "Mimic",
];

function monsterNameToHrid(name: string): string {
  return `/monsters/${name.toLowerCase().replace(/ /g, "_")}`;
}

function normalizeLoadoutName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferLabyrinthMonsterLoadoutsByName(
  combatLoadouts: CombatLoadout[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const normalizedLoadouts = combatLoadouts.map((l) => ({
    loadout: l,
    normalizedName: normalizeLoadoutName(l.name),
  }));

  for (const monsterName of LABYRINTH_MONSTER_NAMES) {
    const normalizedMonster = normalizeLoadoutName(monsterName);

    // Exact normalized name match first.
    let match = normalizedLoadouts.find((l) => l.normalizedName === normalizedMonster);

    // If there is no exact match, allow a unique containing match. This covers
    // names like "lab frost sniper" without accidentally picking ambiguous ones.
    if (!match) {
      const containing = normalizedLoadouts.filter((l) =>
        l.normalizedName.split(" ").includes(normalizedMonster) ||
        l.normalizedName.includes(` ${normalizedMonster} `) ||
        l.normalizedName.startsWith(`${normalizedMonster} `) ||
        l.normalizedName.endsWith(` ${normalizedMonster}`)
      );
      if (containing.length === 1) match = containing[0];
    }

    if (match) {
      result[monsterNameToHrid(monsterName)] = match.loadout.id;
    }
  }

  return result;
}

function parseTriggerArray(raw: any[] | null | undefined): TriggerData[] {
  if (!Array.isArray(raw)) return [];

  const triggers: TriggerData[] = [];
  for (const t of raw) {
    if (t && typeof t === "object") {
      triggers.push({
        dependencyHrid: String(t.dependencyHrid ?? ""),
        conditionHrid: String(t.conditionHrid ?? ""),
        comparatorHrid: String(t.comparatorHrid ?? ""),
        value: Number(t.value ?? 0),
      });
    }
  }
  return triggers;
}
