// =============================================================================
// Player Data Parser - Parses player character exports into PlayerConfig DTOs
// =============================================================================
// Handles two import formats:
//
// 1. "Toolasha" / init_character_data format (from the MWI combat-sim-export
//    browser extension): Contains characterSkills, characterItems,
//    characterAbilities, characterHouseRoomMap, characterAchievements, and
//    optionally combatUnit and abilityCombatTriggersMap.
//
// 2. "Simplified" / combat-sim internal format (from the existing combat
//    simulator's playerDataMap): Contains player.{levels, equipment},
//    food, drinks, abilities, triggerMap, houseRooms, achievements.
//
// Both formats are parsed into a PlayerConfig object suitable for
// Player.createFromDTO().

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

// ---------------------------------------------------------------------------
// All combat-relevant equipment type hrids
// ---------------------------------------------------------------------------

const COMBAT_EQUIPMENT_TYPES = new Set<string>([
  "/equipment_types/head",
  "/equipment_types/body",
  "/equipment_types/legs",
  "/equipment_types/feet",
  "/equipment_types/hands",
  "/equipment_types/main_hand",
  "/equipment_types/two_hand",
  "/equipment_types/off_hand",
  "/equipment_types/pouch",
  "/equipment_types/back",
  "/equipment_types/neck",
  "/equipment_types/earrings",
  "/equipment_types/ring",
  "/equipment_types/charm",
]);

// ---------------------------------------------------------------------------
// Skill hrid to PlayerConfig property name mapping
// ---------------------------------------------------------------------------

const SKILL_HRID_TO_LEVEL: Record<string, keyof PlayerConfig> = {
  "/skills/stamina": "staminaLevel",
  "/skills/intelligence": "intelligenceLevel",
  "/skills/attack": "attackLevel",
  "/skills/melee": "meleeLevel",
  "/skills/defense": "defenseLevel",
  "/skills/ranged": "rangedLevel",
  "/skills/magic": "magicLevel",
};

// ---------------------------------------------------------------------------
// Equipment slot types (all slots the player DTO supports)
// ---------------------------------------------------------------------------

const ALL_EQUIPMENT_SLOT_TYPES = [
  "head",
  "body",
  "legs",
  "feet",
  "hands",
  "off_hand",
  "pouch",
  "neck",
  "earrings",
  "ring",
  "back",
  "main_hand",
  "two_hand",
  "charm",
] as const;

// ---------------------------------------------------------------------------
// Custom Error
// ---------------------------------------------------------------------------

export class PlayerDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerDataError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string containing player character data into a PlayerConfig DTO.
 *
 * Automatically detects the import format:
 * - If the data has `characterSkills`, it is treated as a Toolasha export
 *   (init_character_data format from the browser extension).
 * - Otherwise, it is treated as the simplified format used by the existing
 *   combat simulator's internal save/load system.
 *
 * @param jsonString - Raw JSON string to parse.
 * @param gameData   - Optional GameData for resolving item details when parsing
 *                     the Toolasha format (needed to determine equipment types
 *                     from item hrids).
 * @param hrid       - Optional player hrid. Defaults to "player".
 * @returns A fully populated PlayerConfig ready for Player.createFromDTO().
 * @throws {PlayerDataError} on malformed data or missing required fields.
 */
export function parsePlayerData(
  jsonString: string,
  gameData?: GameData,
  hrid: string = "player"
): PlayerConfig {
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch (e) {
    throw new PlayerDataError(
      `Failed to parse player data JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (data === null || data === undefined || typeof data !== "object") {
    throw new PlayerDataError("Player data must be a non-null JSON object.");
  }

  const obj = data as Record<string, unknown>;

  // Detect format based on presence of characterSkills (Toolasha export)
  if (obj.characterSkills) {
    return parseToolashaFormat(obj, gameData, hrid);
  }

  // Otherwise treat as the simplified combat-sim internal format
  return parseSimplifiedFormat(obj, hrid, gameData);
}

/**
 * Parse player data from a pre-parsed JavaScript object (already JSON.parse'd).
 *
 * Same logic as parsePlayerData but skips the JSON.parse step.
 */
export function parsePlayerDataFromObject(
  data: Record<string, unknown>,
  gameData?: GameData,
  hrid: string = "player"
): PlayerConfig {
  if (data.characterSkills) {
    return parseToolashaFormat(data, gameData, hrid);
  }
  return parseSimplifiedFormat(data, hrid, gameData);
}

// ---------------------------------------------------------------------------
// Toolasha / init_character_data Format Parser
// ---------------------------------------------------------------------------
// This is the format produced by the Toolasha MWI combat-sim-export browser
// extension. It captures the raw game client WebSocket data containing:
//
//   characterSkills: Array<{ skillHrid, level }>
//   characterItems: Array<{ itemHrid, enhancementLevel, ... }>
//   characterAbilities: Array<{ abilityHrid, level }>
//   abilityCombatTriggersMap: Record<abilityHrid, TriggerData[]>
//   characterHouseRoomMap: Record<roomHrid, { level }>
//   characterAchievements: Array<{ achievementHrid }>
//   combatUnit: { combatAbilities, food, drinks }
//

function parseToolashaFormat(
  data: Record<string, unknown>,
  gameData: GameData | undefined,
  hrid: string
): PlayerConfig {
  // --- Skills ---
  const skills = parseToolashaSkills(data);

  // --- Equipment ---
  const equipment = parseToolashaEquipment(data, gameData, skills);

  // --- Abilities ---
  const { abilities, specialAbility } = parseToolashaAbilities(data, gameData);

  // --- Food & Drinks ---
  const { food, drinks } = parseToolashaConsumables(data);

  // --- House Rooms ---
  const houseRooms = parseToolashaHouseRooms(data);

  // --- Achievements ---
  const achievements = parseToolashaAchievements(data);

  return {
    hrid,
    staminaLevel: skills.staminaLevel,
    intelligenceLevel: skills.intelligenceLevel,
    attackLevel: skills.attackLevel,
    meleeLevel: skills.meleeLevel,
    defenseLevel: skills.defenseLevel,
    rangedLevel: skills.rangedLevel,
    magicLevel: skills.magicLevel,
    equipment,
    food,
    drinks,
    abilities,
    specialAbility,
    houseRooms,
    achievements,
  };
}

function parseToolashaSkills(
  data: Record<string, unknown>
): Record<string, number> {
  const skills: Record<string, number> = {
    staminaLevel: 1,
    intelligenceLevel: 1,
    attackLevel: 1,
    meleeLevel: 1,
    defenseLevel: 1,
    rangedLevel: 1,
    magicLevel: 1,
  };

  const characterSkills = data.characterSkills;
  if (!Array.isArray(characterSkills)) {
    throw new PlayerDataError(
      "Toolasha export is missing or has invalid 'characterSkills' array."
    );
  }

  for (const skill of characterSkills) {
    if (typeof skill !== "object" || skill === null) continue;
    const s = skill as Record<string, unknown>;
    const levelProp = SKILL_HRID_TO_LEVEL[String(s.skillHrid)];
    if (levelProp) {
      skills[levelProp as string] = asPositiveInt(s.level, 1);
    }
  }

  return skills;
}

function parseToolashaEquipment(
  data: Record<string, unknown>,
  gameData: GameData | undefined,
  skills: Record<string, number>
): Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> {
  const equipment: Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> = {};

  // Try combatUnit equipment first (currently equipped items)
  const combatUnit = data.combatUnit as Record<string, unknown> | undefined;
  if (combatUnit && typeof combatUnit === "object") {
    const combatEquipment = combatUnit.equipment as Record<string, unknown> | undefined;
    if (combatEquipment && typeof combatEquipment === "object") {
      for (const [slotHrid, item] of Object.entries(combatEquipment)) {
        if (!COMBAT_EQUIPMENT_TYPES.has(slotHrid)) continue;
        if (item && typeof item === "object") {
          const i = item as Record<string, unknown>;
          if (i.itemHrid && typeof i.itemHrid === "string") {
            equipment[slotHrid] = {
              hrid: i.itemHrid,
              enhancementLevel: asNonNegativeInt(i.enhancementLevel, 0),
            };
          }
        }
      }
    }
  }

  // If we did not get equipment from combatUnit, try characterItems
  // (the full inventory approach, requires gameData to look up equipment types)
  if (Object.keys(equipment).length === 0 && gameData) {
    const characterItems = data.characterItems;
    if (Array.isArray(characterItems)) {
      // Collect all equippable combat items
      const candidates: Array<{
        hrid: string;
        enhancementLevel: number;
        equipmentType: string;
      }> = [];

      for (const item of characterItems) {
        if (typeof item !== "object" || item === null) continue;
        const i = item as Record<string, unknown>;
        const itemHrid = String(i.itemHrid ?? "");
        if (!itemHrid) continue;

        const gameItem = gameData.itemDetailMap[itemHrid];
        if (!gameItem?.equipmentDetail) continue;

        const equipType = gameItem.equipmentDetail.type;
        if (!COMBAT_EQUIPMENT_TYPES.has(equipType)) continue;

        // Check level requirements
        if (!meetsLevelRequirements(gameItem.equipmentDetail.levelRequirements, skills)) {
          continue;
        }

        candidates.push({
          hrid: itemHrid,
          enhancementLevel: asNonNegativeInt(i.enhancementLevel, 0),
          equipmentType: equipType,
        });
      }

      // For each slot, pick the first candidate found (inventory order)
      // This is a best-effort heuristic; the user should use combatUnit
      // format for precise loadouts
      for (const candidate of candidates) {
        if (!equipment[candidate.equipmentType]) {
          equipment[candidate.equipmentType] = {
            hrid: candidate.hrid,
            enhancementLevel: candidate.enhancementLevel,
          };
        }
      }
    }
  }

  return equipment;
}

function parseToolashaAbilities(
  data: Record<string, unknown>,
  gameData: GameData | undefined
): { abilities: (AbilityDTO | null)[]; specialAbility: AbilityDTO | null } {
  const abilities: (AbilityDTO | null)[] = [];
  let specialAbility: AbilityDTO | null = null;

  // Prefer combatUnit.combatAbilities (equipped), fallback to characterAbilities (all learned)
  const combatUnit = data.combatUnit as Record<string, unknown> | undefined;
  const abilitySource: unknown[] =
    (combatUnit?.combatAbilities as unknown[]) ??
    (data.characterAbilities as unknown[]) ??
    [];

  if (!Array.isArray(abilitySource)) return { abilities, specialAbility };

  const triggerMap = data.abilityCombatTriggersMap as Record<string, unknown[]> | undefined;

  // Also check combatUnit.specialAbility
  const rawSpecial = combatUnit?.specialAbility as Record<string, unknown> | undefined;
  if (rawSpecial && typeof rawSpecial === "object" && rawSpecial.abilityHrid) {
    const specialHrid = String(rawSpecial.abilityHrid);
    specialAbility = {
      hrid: specialHrid,
      level: asPositiveInt(rawSpecial.level, 1),
      triggers: parseTriggerArray(triggerMap?.[specialHrid]),
    };
  }

  for (const ab of abilitySource) {
    if (typeof ab !== "object" || ab === null) {
      abilities.push(null);
      continue;
    }
    const a = ab as Record<string, unknown>;
    const abilityHrid = String(a.abilityHrid ?? "");
    if (!abilityHrid) {
      abilities.push(null);
      continue;
    }

    // Skip special abilities from the regular list
    const isSpecial = gameData?.abilityDetailMap[abilityHrid]?.isSpecialAbility;
    if (isSpecial) {
      // If we didn't already find a special from combatUnit.specialAbility, use this one
      if (!specialAbility) {
        specialAbility = {
          hrid: abilityHrid,
          level: asPositiveInt(a.level, 1),
          triggers: parseTriggerArray(triggerMap?.[abilityHrid]),
        };
      }
      continue;
    }

    // Build triggers from the trigger map
    const triggers = parseTriggerArray(triggerMap?.[abilityHrid]);

    abilities.push({
      hrid: abilityHrid,
      level: asPositiveInt(a.level, 1),
      triggers,
    });
  }

  return { abilities, specialAbility };
}

function parseToolashaConsumables(
  data: Record<string, unknown>
): { food: (ConsumableDTO | null)[]; drinks: (ConsumableDTO | null)[] } {
  const food: (ConsumableDTO | null)[] = [];
  const drinks: (ConsumableDTO | null)[] = [];

  // The Toolasha export may have combatUnit.food / combatUnit.drinks
  const combatUnit = data.combatUnit as Record<string, unknown> | undefined;
  const triggerMap = data.abilityCombatTriggersMap as Record<string, unknown[]> | undefined;

  if (combatUnit && typeof combatUnit === "object") {
    // Food
    const rawFood = combatUnit.food as unknown[];
    if (Array.isArray(rawFood)) {
      for (const f of rawFood) {
        food.push(parseConsumableEntry(f, triggerMap));
      }
    }

    // Drinks
    const rawDrinks = combatUnit.drinks as unknown[];
    if (Array.isArray(rawDrinks)) {
      for (const d of rawDrinks) {
        drinks.push(parseConsumableEntry(d, triggerMap));
      }
    }
  }

  return { food, drinks };
}

function parseConsumableEntry(
  raw: unknown,
  triggerMap?: Record<string, unknown[]>
): ConsumableDTO | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const itemHrid = String(entry.itemHrid ?? "");
  if (!itemHrid) return null;

  const triggers: TriggerData[] = [];
  const rawTriggers = triggerMap?.[itemHrid];
  if (Array.isArray(rawTriggers)) {
    for (const t of rawTriggers) {
      if (typeof t === "object" && t !== null) {
        const tr = t as Record<string, unknown>;
        triggers.push({
          dependencyHrid: String(tr.dependencyHrid ?? ""),
          conditionHrid: String(tr.conditionHrid ?? ""),
          comparatorHrid: String(tr.comparatorHrid ?? ""),
          value: Number(tr.value ?? 0),
        });
      }
    }
  }

  return { hrid: itemHrid, triggers };
}

function parseToolashaHouseRooms(
  data: Record<string, unknown>
): HouseRoomLevels {
  const houseRooms: HouseRoomLevels = {};
  const rawMap = data.characterHouseRoomMap as Record<string, unknown> | undefined;

  if (rawMap && typeof rawMap === "object") {
    for (const [roomHrid, roomData] of Object.entries(rawMap)) {
      if (typeof roomData === "object" && roomData !== null) {
        const r = roomData as Record<string, unknown>;
        houseRooms[roomHrid] = asNonNegativeInt(r.level, 0);
      } else if (typeof roomData === "number") {
        houseRooms[roomHrid] = Math.max(0, Math.floor(roomData));
      }
    }
  }

  return houseRooms;
}

function parseToolashaAchievements(
  data: Record<string, unknown>
): AchievementMap {
  const achievements: AchievementMap = {};
  const rawAchievements = data.characterAchievements;

  if (Array.isArray(rawAchievements)) {
    for (const ach of rawAchievements) {
      if (typeof ach === "object" && ach !== null) {
        const a = ach as Record<string, unknown>;
        if (a.achievementHrid && typeof a.achievementHrid === "string") {
          // Store as 1 (earned) or the actual value/points if present
          achievements[a.achievementHrid] =
            typeof a.points === "number" ? a.points : 1;
        }
      }
    }
  }

  return achievements;
}

// ---------------------------------------------------------------------------
// Simplified / Combat-Sim Internal Format Parser
// ---------------------------------------------------------------------------
// This is the format used by the existing combat simulator's save/load system.
// It stores data in a structure like:
//   {
//     player: { attackLevel, ..., equipment: [{ itemLocationHrid, itemHrid, enhancementLevel }] },
//     food: { "/action_types/combat": [{ itemHrid }] },
//     drinks: { "/action_types/combat": [{ itemHrid }] },
//     abilities: [{ abilityHrid, level }],
//     triggerMap: { [hrid]: TriggerData[] },
//     houseRooms: { [roomHrid]: level },
//     achievements: { [achievementHrid]: true/points }
//   }

function parseSimplifiedFormat(
  data: Record<string, unknown>,
  hrid: string,
  gameData?: GameData
): PlayerConfig {
  const player = data.player as Record<string, unknown> | undefined;
  if (!player || typeof player !== "object") {
    throw new PlayerDataError(
      "Simplified format is missing the 'player' object. " +
        "Expected an object with skill levels and equipment."
    );
  }

  // Use the 'name' field from the data as hrid if the caller passed the default
  if (hrid === "player" && typeof data.name === "string" && data.name.trim()) {
    hrid = data.name.trim();
  }

  // --- Skills ---
  const staminaLevel = asPositiveInt(player.staminaLevel, 1);
  const intelligenceLevel = asPositiveInt(player.intelligenceLevel, 1);
  const attackLevel = asPositiveInt(player.attackLevel, 1);
  // Handle legacy 'powerLevel' alias for 'meleeLevel'
  const meleeLevel = asPositiveInt(
    player.meleeLevel ?? player.powerLevel,
    1
  );
  const defenseLevel = asPositiveInt(player.defenseLevel, 1);
  const rangedLevel = asPositiveInt(player.rangedLevel, 1);
  const magicLevel = asPositiveInt(player.magicLevel, 1);

  // --- Equipment ---
  const equipment = parseSimplifiedEquipment(player);

  // --- Trigger map ---
  const triggerMap = (data.triggerMap ?? {}) as Record<string, unknown[]>;

  // --- Food ---
  const food = parseSimplifiedConsumables(data.food, triggerMap);

  // --- Drinks ---
  const drinks = parseSimplifiedConsumables(data.drinks, triggerMap);

  // --- Abilities (separate special from regular) ---
  const { abilities, specialAbility } = parseSimplifiedAbilities(
    data.abilities as unknown[],
    triggerMap,
    gameData
  );

  // --- House Rooms ---
  const houseRooms = parseSimplifiedHouseRooms(data.houseRooms);

  // --- Achievements ---
  const achievements = parseSimplifiedAchievements(data.achievements);

  return {
    hrid,
    staminaLevel,
    intelligenceLevel,
    attackLevel,
    meleeLevel,
    defenseLevel,
    rangedLevel,
    magicLevel,
    equipment,
    food,
    drinks,
    abilities,
    specialAbility,
    houseRooms,
    achievements,
  };
}

function parseSimplifiedEquipment(
  player: Record<string, unknown>
): Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> {
  const equipment: Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>> = {};

  const rawEquipment = player.equipment;

  if (Array.isArray(rawEquipment)) {
    // Array format: [{ itemLocationHrid, itemHrid, enhancementLevel }]
    for (const eq of rawEquipment) {
      if (typeof eq !== "object" || eq === null) continue;
      const e = eq as Record<string, unknown>;
      const itemHrid = String(e.itemHrid ?? "");
      if (!itemHrid) continue;

      // Convert itemLocationHrid -> equipment type hrid
      // e.g., "/item_locations/head" -> "/equipment_types/head"
      const locationHrid = String(e.itemLocationHrid ?? "");
      const equipType = locationHrid.replace("item_locations", "equipment_types");

      for (const slotType of ALL_EQUIPMENT_SLOT_TYPES) {
        if (equipType === `/equipment_types/${slotType}`) {
          equipment[equipType] = {
            hrid: itemHrid,
            enhancementLevel: asNonNegativeInt(e.enhancementLevel, 0),
          };
          break;
        }
      }
    }
  } else if (rawEquipment && typeof rawEquipment === "object") {
    // Object format: { "/equipment_types/head": { hrid, enhancementLevel } }
    for (const [slotHrid, value] of Object.entries(
      rawEquipment as Record<string, unknown>
    )) {
      if (!COMBAT_EQUIPMENT_TYPES.has(slotHrid)) continue;
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        const itemHrid = String(v.hrid ?? v.itemHrid ?? "");
        if (itemHrid) {
          equipment[slotHrid] = {
            hrid: itemHrid,
            enhancementLevel: asNonNegativeInt(v.enhancementLevel, 0),
          };
        }
      }
    }
  }

  return equipment;
}

function parseSimplifiedConsumables(
  rawSection: unknown,
  triggerMap: Record<string, unknown[]>
): (ConsumableDTO | null)[] {
  const result: (ConsumableDTO | null)[] = [];

  if (!rawSection || typeof rawSection !== "object") return result;

  // The simplified format nests consumables under "/action_types/combat"
  let consumableList: unknown[];
  const section = rawSection as Record<string, unknown>;
  if (Array.isArray(section)) {
    consumableList = section;
  } else if (Array.isArray(section["/action_types/combat"])) {
    consumableList = section["/action_types/combat"] as unknown[];
  } else {
    return result;
  }

  for (const entry of consumableList) {
    if (typeof entry !== "object" || entry === null) {
      result.push(null);
      continue;
    }
    const e = entry as Record<string, unknown>;
    const itemHrid = String(e.itemHrid ?? e.hrid ?? "");
    if (!itemHrid) {
      result.push(null);
      continue;
    }

    // Get triggers from the trigger map
    const triggers = parseTriggerArray(triggerMap[itemHrid]);

    result.push({ hrid: itemHrid, triggers });
  }

  return result;
}

function parseSimplifiedAbilities(
  rawAbilities: unknown[] | undefined,
  triggerMap: Record<string, unknown[]>,
  gameData?: GameData
): { abilities: (AbilityDTO | null)[]; specialAbility: AbilityDTO | null } {
  const abilities: (AbilityDTO | null)[] = [];
  let specialAbility: AbilityDTO | null = null;

  if (!Array.isArray(rawAbilities)) return { abilities, specialAbility };

  for (const ab of rawAbilities) {
    if (typeof ab !== "object" || ab === null) {
      abilities.push(null);
      continue;
    }
    const a = ab as Record<string, unknown>;
    const abilityHrid = String(a.abilityHrid ?? a.hrid ?? "");
    if (!abilityHrid) {
      abilities.push(null);
      continue;
    }

    const level = asPositiveInt(a.level, 1);

    // Triggers can come from the ability object itself or from the triggerMap
    let triggers: TriggerData[];
    if (Array.isArray(a.triggers) && a.triggers.length > 0) {
      triggers = parseTriggerArray(a.triggers);
    } else {
      triggers = parseTriggerArray(triggerMap[abilityHrid]);
    }

    // Check if this is a special ability
    const isSpecial = gameData?.abilityDetailMap[abilityHrid]?.isSpecialAbility;
    if (isSpecial) {
      if (!specialAbility) {
        specialAbility = { hrid: abilityHrid, level, triggers };
      }
      continue; // Don't add to regular list
    }

    abilities.push({ hrid: abilityHrid, level, triggers });
  }

  return { abilities, specialAbility };
}

function parseSimplifiedHouseRooms(raw: unknown): HouseRoomLevels {
  const houseRooms: HouseRoomLevels = {};
  if (!raw || typeof raw !== "object") return houseRooms;

  for (const [roomHrid, level] of Object.entries(
    raw as Record<string, unknown>
  )) {
    houseRooms[roomHrid] = asNonNegativeInt(level, 0);
  }

  return houseRooms;
}

function parseSimplifiedAchievements(raw: unknown): AchievementMap {
  const achievements: AchievementMap = {};
  if (!raw || typeof raw !== "object") return achievements;

  for (const [achHrid, value] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (typeof value === "boolean") {
      achievements[achHrid] = value ? 1 : 0;
    } else if (typeof value === "number") {
      achievements[achHrid] = value;
    } else {
      achievements[achHrid] = 1;
    }
  }

  return achievements;
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw trigger array into typed TriggerData objects.
 */
function parseTriggerArray(raw: unknown): TriggerData[] {
  if (!Array.isArray(raw)) return [];

  const triggers: TriggerData[] = [];
  for (const t of raw) {
    if (typeof t !== "object" || t === null) continue;
    const tr = t as Record<string, unknown>;
    triggers.push({
      dependencyHrid: String(tr.dependencyHrid ?? ""),
      conditionHrid: String(tr.conditionHrid ?? ""),
      comparatorHrid: String(tr.comparatorHrid ?? ""),
      value: Number(tr.value ?? 0),
    });
  }
  return triggers;
}

/**
 * Check if a player meets all level requirements for an equipment item.
 */
function meetsLevelRequirements(
  requirements: Array<{ skillHrid: string; level: number }> | undefined | null,
  skills: Record<string, number>
): boolean {
  if (!requirements || requirements.length === 0) return true;

  for (const req of requirements) {
    const levelProp = SKILL_HRID_TO_LEVEL[req.skillHrid];
    if (!levelProp) continue;
    if ((skills[levelProp as string] ?? 1) < req.level) return false;
  }
  return true;
}

/**
 * Coerce a value to a positive integer (>= 1), returning fallback if invalid.
 */
function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Coerce a value to a non-negative integer (>= 0), returning fallback if invalid.
 */
function asNonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
