// =============================================================================
// Game Data Loader - Fetches and parses init_client_data.json
// =============================================================================
// Loads the MWI game data JSON from the public/ directory (served as a static
// asset by Vite). Caches in memory after the first successful load. Supports
// user-uploaded custom game data files for testing with different game versions.

import type { GameData } from "../engine/types";

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

let cachedGameData: GameData | null = null;

// ---------------------------------------------------------------------------
// Required top-level keys (combat-critical maps that the engine needs)
// ---------------------------------------------------------------------------

const REQUIRED_KEYS: (keyof GameData)[] = [
  "type",
  "gameVersion",
  "levelExperienceTable",
  "abilityDetailMap",
  "abilitySlotsLevelRequirementList",
  "itemDetailMap",
  "equipmentTypeDetailMap",
  "combatStyleDetailMap",
  "damageTypeDetailMap",
  "combatMonsterDetailMap",
  "combatTriggerDependencyDetailMap",
  "combatTriggerConditionDetailMap",
  "combatTriggerComparatorDetailMap",
  "enhancementLevelSuccessRateTable",
  "enhancementLevelTotalBonusMultiplierTable",
  "actionDetailMap",
  "buffTypeDetailMap",
  "houseRoomDetailMap",
  "achievementDetailMap",
  "achievementTierDetailMap",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the game data, either from a user-uploaded file or from the default
 * static asset at `/init_client_data.json`.
 *
 * The result is cached in memory. Subsequent calls return the cached value
 * unless a new custom file is provided (which replaces the cache) or
 * `clearGameDataCache()` is called first.
 *
 * @param customFile - Optional File object (from an `<input type="file">`)
 *                     containing a full init_client_data.json.
 * @returns A typed GameData object ready for use by the combat engine.
 * @throws {GameDataError} if the JSON is malformed or missing required fields.
 */
export async function loadGameData(customFile?: File): Promise<GameData> {
  if (customFile) {
    const text = await customFile.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new GameDataError(
        `Failed to parse uploaded game data file: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    cachedGameData = parseGameData(raw);
    return cachedGameData;
  }

  if (cachedGameData) return cachedGameData;

  const response = await fetch(`${import.meta.env.BASE_URL}init_client_data.json`);
  if (!response.ok) {
    throw new GameDataError(
      `Failed to fetch game data: HTTP ${response.status} ${response.statusText}`
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (e) {
    throw new GameDataError(
      `Failed to parse game data JSON from server: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  cachedGameData = parseGameData(raw);
  return cachedGameData;
}

/**
 * Clear the in-memory game data cache, forcing the next `loadGameData()` call
 * to re-fetch and re-parse the data.
 */
export function clearGameDataCache(): void {
  cachedGameData = null;
}

/**
 * Returns the currently cached GameData, or null if not yet loaded.
 * This is a synchronous accessor for use after initial loading is complete.
 */
export function getCachedGameData(): GameData | null {
  return cachedGameData;
}

// ---------------------------------------------------------------------------
// Custom Error
// ---------------------------------------------------------------------------

export class GameDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameDataError";
  }
}

// ---------------------------------------------------------------------------
// Parser / Validator
// ---------------------------------------------------------------------------

/**
 * Validate and cast raw JSON data to the GameData type.
 *
 * This does structural validation (checks that required top-level keys exist
 * and are the expected types) but does NOT deep-validate every entry in every
 * map. The engine classes handle per-entry validation when they access data.
 */
function parseGameData(raw: unknown): GameData {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    throw new GameDataError(
      "Game data must be a non-null JSON object."
    );
  }

  const data = raw as Record<string, unknown>;

  // Verify the type field matches expected value
  if (data.type !== "init_client_data") {
    throw new GameDataError(
      `Unexpected game data type: "${String(data.type)}". ` +
        `Expected "init_client_data". Make sure you are uploading the correct file.`
    );
  }

  // Check all required keys exist
  const missingKeys: string[] = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in data) || data[key] === undefined || data[key] === null) {
      missingKeys.push(key);
    }
  }
  if (missingKeys.length > 0) {
    throw new GameDataError(
      `Game data is missing required fields: ${missingKeys.join(", ")}. ` +
        `The file may be from an incompatible game version.`
    );
  }

  // Validate types of critical fields
  validateArray(data, "levelExperienceTable");
  validateArray(data, "abilitySlotsLevelRequirementList");
  validateArray(data, "enhancementLevelSuccessRateTable");
  validateArray(data, "enhancementLevelTotalBonusMultiplierTable");

  validateObject(data, "abilityDetailMap");
  validateObject(data, "itemDetailMap");
  validateObject(data, "equipmentTypeDetailMap");
  validateObject(data, "combatStyleDetailMap");
  validateObject(data, "damageTypeDetailMap");
  validateObject(data, "combatMonsterDetailMap");
  validateObject(data, "combatTriggerDependencyDetailMap");
  validateObject(data, "combatTriggerConditionDetailMap");
  validateObject(data, "combatTriggerComparatorDetailMap");
  validateObject(data, "actionDetailMap");
  validateObject(data, "buffTypeDetailMap");
  validateObject(data, "houseRoomDetailMap");
  validateObject(data, "achievementDetailMap");
  validateObject(data, "achievementTierDetailMap");

  // Validate string fields
  if (typeof data.gameVersion !== "string") {
    throw new GameDataError(
      `Expected "gameVersion" to be a string, got ${typeof data.gameVersion}.`
    );
  }

  // Spot-check a few critical sub-maps to catch corrupted data early
  validateMapEntries(data, "abilityDetailMap", ["hrid", "abilityEffects"]);
  validateMapEntries(data, "itemDetailMap", ["hrid", "name"]);
  validateMapEntries(data, "combatMonsterDetailMap", ["hrid", "combatDetails"]);
  validateMapEntries(data, "actionDetailMap", ["hrid"]);

  // The structure passes validation. Cast to GameData.
  // Fill in optional keys with safe defaults if absent.
  const gameData = data as unknown as GameData;

  // Ensure keys array exists (used by some API endpoints)
  if (!Array.isArray(gameData.keys)) {
    (gameData as unknown as Record<string, unknown>).keys = [];
  }

  return gameData;
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

function validateArray(data: Record<string, unknown>, key: string): void {
  if (!Array.isArray(data[key])) {
    throw new GameDataError(
      `Expected "${key}" to be an array, got ${typeof data[key]}.`
    );
  }
}

function validateObject(data: Record<string, unknown>, key: string): void {
  if (typeof data[key] !== "object" || Array.isArray(data[key])) {
    throw new GameDataError(
      `Expected "${key}" to be an object map, got ${Array.isArray(data[key]) ? "array" : typeof data[key]}.`
    );
  }
}

/**
 * Spot-check that the first few entries in a detail map have expected fields.
 * Only checks up to 3 entries to keep validation fast.
 */
function validateMapEntries(
  data: Record<string, unknown>,
  mapKey: string,
  requiredEntryFields: string[]
): void {
  const map = data[mapKey] as Record<string, unknown>;
  const entries = Object.values(map);
  const checkCount = Math.min(entries.length, 3);

  for (let i = 0; i < checkCount; i++) {
    const entry = entries[i] as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null) {
      throw new GameDataError(
        `Expected entries in "${mapKey}" to be objects, but entry ${i} is ${typeof entry}.`
      );
    }
    for (const field of requiredEntryFields) {
      if (!(field in entry)) {
        throw new GameDataError(
          `Entry in "${mapKey}" is missing required field "${field}". ` +
            `Found keys: [${Object.keys(entry).slice(0, 10).join(", ")}].`
        );
      }
    }
  }
}
