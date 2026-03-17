// =============================================================================
// MWI Combat Averagelator - Game Constants
// =============================================================================
// All timing values are in nanoseconds, matching the MWI game server convention.
// 1 second = 1e9 nanoseconds.

// ---------------------------------------------------------------------------
// Fundamental time unit
// ---------------------------------------------------------------------------

/** One second in nanoseconds. */
export const ONE_SECOND = 1e9;

// ---------------------------------------------------------------------------
// Combat tick intervals
// ---------------------------------------------------------------------------

/** Heal-over-time (HoT) ticks occur every 5 seconds. */
export const HOT_TICK_INTERVAL = 5 * ONE_SECOND;

/** Damage-over-time (DoT) ticks occur every 3 seconds. */
export const DOT_TICK_INTERVAL = 3 * ONE_SECOND;

/** HP/MP natural regeneration ticks every 10 seconds. */
export const REGEN_TICK_INTERVAL = 10 * ONE_SECOND;

/** Enrage stacks are applied every 60 seconds after enrage triggers. */
export const ENRAGE_TICK_INTERVAL = 60 * ONE_SECOND;

// ---------------------------------------------------------------------------
// Respawn & restart intervals
// ---------------------------------------------------------------------------

/** Time before a new enemy group spawns after the previous one dies (regular zones). */
export const ENEMY_RESPAWN_INTERVAL = 3 * ONE_SECOND;

/** Time between dungeon waves (same 3s as regular zone respawn). */
export const DUNGEON_WAVE_RESPAWN_INTERVAL = 3 * ONE_SECOND;

/** Time before a player respawns after dying. */
export const PLAYER_RESPAWN_INTERVAL = 150 * ONE_SECOND;

/** Time before a dungeon restarts after a wipe or completion. */
export const RESTART_INTERVAL = 3 * ONE_SECOND;

/**
 * Default encounter transition delay for regular (non-dungeon) zones.
 * Can be used to model unaccounted overhead between encounters.
 * Set via DeterministicSimConfig.encounterTransitionDelay to calibrate
 * per-zone if needed. Default is 0 (no extra delay beyond respawn).
 */
export const DEFAULT_ENCOUNTER_TRANSITION_DELAY = 0;

// ---------------------------------------------------------------------------
// Zone / encounter constants
// ---------------------------------------------------------------------------

/** Number of normal battles between boss spawns (when a zone has bosses). */
export const BATTLES_PER_BOSS = 10;

// ---------------------------------------------------------------------------
// Default combat values
// ---------------------------------------------------------------------------

/** Default unarmed attack interval in nanoseconds (3 seconds). */
export const DEFAULT_ATTACK_INTERVAL = 3 * ONE_SECOND;

/** Default unarmed combat style hrid. */
export const DEFAULT_COMBAT_STYLE_HRID = "/combat_styles/smash";

/** Default unarmed damage type hrid. */
export const DEFAULT_DAMAGE_TYPE_HRID = "/damage_types/physical";

/** Default unarmed primary training skill hrid. */
export const DEFAULT_PRIMARY_TRAINING = "/skills/melee";

/** Base HP regen ratio per 10 seconds (applies to players only). */
export const BASE_REGEN_PER_10 = 0.01;

/** Base threat value for all combat units. */
export const BASE_THREAT = 100;

// ---------------------------------------------------------------------------
// Level scaling constants (monsters)
// ---------------------------------------------------------------------------

/** Per-difficulty-tier multiplier applied to offensive monster levels. */
export const MONSTER_LEVEL_MULTIPLIER_PER_TIER = 0.25;

/** Per-difficulty-tier multiplier applied to monster defense level. */
export const MONSTER_DEF_LEVEL_MULTIPLIER_PER_TIER = 0.15;

/** Flat level bonus added per difficulty tier before multiplication. */
export const MONSTER_LEVEL_BONUS_PER_TIER = 20;

/** Per-difficulty-tier multiplier applied to monster experience. */
export const MONSTER_EXP_MULTIPLIER_PER_TIER = 0.5;

/** Flat experience bonus added per difficulty tier before multiplication. */
export const MONSTER_EXP_BONUS_PER_TIER = 5;

// ---------------------------------------------------------------------------
// Player ability / equipment slot counts
// ---------------------------------------------------------------------------

/** Maximum number of ability slots a player can equip. */
export const MAX_ABILITY_SLOTS = 4;

/** Maximum number of food slots (base, before pouch bonuses). */
export const BASE_FOOD_SLOTS = 1;

/** Maximum number of drink slots (base, before pouch bonuses). */
export const BASE_DRINK_SLOTS = 1;

/** Number of food slot entries in player configuration. */
export const FOOD_SLOT_COUNT = 3;

/** Number of drink slot entries in player configuration. */
export const DRINK_SLOT_COUNT = 3;

// ---------------------------------------------------------------------------
// Party size
// ---------------------------------------------------------------------------

/** Maximum number of players in a party. */
export const MAX_PARTY_SIZE = 5;

// ---------------------------------------------------------------------------
// Combat equipment slot hrids
// ---------------------------------------------------------------------------

export const EQUIPMENT_SLOTS = [
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
] as const;

// ---------------------------------------------------------------------------
// All combat stat keys that are summed from equipment
// ---------------------------------------------------------------------------

export const EQUIPMENT_COMBAT_STAT_KEYS = [
  "stabAccuracy",
  "slashAccuracy",
  "smashAccuracy",
  "rangedAccuracy",
  "magicAccuracy",
  "stabDamage",
  "slashDamage",
  "smashDamage",
  "rangedDamage",
  "magicDamage",
  "defensiveDamage",
  "physicalAmplify",
  "waterAmplify",
  "natureAmplify",
  "fireAmplify",
  "healingAmplify",
  "stabEvasion",
  "slashEvasion",
  "smashEvasion",
  "rangedEvasion",
  "magicEvasion",
  "armor",
  "waterResistance",
  "natureResistance",
  "fireResistance",
  "maxHitpoints",
  "maxManapoints",
  "maxHitpointsRatio",
  "maxManapointsRatio",
  "lifeSteal",
  "hpRegenPer10",
  "mpRegenPer10",
  "physicalThorns",
  "elementalThorns",
  "combatDropRate",
  "combatRareFind",
  "combatDropQuantity",
  "combatExperience",
  "criticalRate",
  "criticalDamage",
  "armorPenetration",
  "waterPenetration",
  "naturePenetration",
  "firePenetration",
  "abilityHaste",
  "tenacity",
  "manaLeech",
  "castSpeed",
  "threat",
  "parry",
  "mayhem",
  "pierce",
  "curse",
  "fury",
  "weaken",
  "ripple",
  "bloom",
  "blaze",
  "attackSpeed",
  "foodHaste",
  "drinkConcentration",
  "autoAttackDamage",
  "abilityDamage",
  "staminaExperience",
  "intelligenceExperience",
  "attackExperience",
  "defenseExperience",
  "meleeExperience",
  "rangedExperience",
  "magicExperience",
  "retaliation",
] as const;

// ---------------------------------------------------------------------------
// Monster combat stat keys that are defaulted to 0 when absent
// ---------------------------------------------------------------------------

export const MONSTER_COMBAT_STAT_KEYS = [
  "stabAccuracy",
  "slashAccuracy",
  "smashAccuracy",
  "rangedAccuracy",
  "magicAccuracy",
  "stabDamage",
  "slashDamage",
  "smashDamage",
  "rangedDamage",
  "magicDamage",
  "defensiveDamage",
  "physicalAmplify",
  "waterAmplify",
  "natureAmplify",
  "fireAmplify",
  "healingAmplify",
  "stabEvasion",
  "slashEvasion",
  "smashEvasion",
  "rangedEvasion",
  "magicEvasion",
  "armor",
  "waterResistance",
  "natureResistance",
  "fireResistance",
  "maxHitpoints",
  "maxManapoints",
  "maxHitpointsRatio",
  "maxManapointsRatio",
  "lifeSteal",
  "hpRegenPer10",
  "mpRegenPer10",
  "physicalThorns",
  "elementalThorns",
  "combatDropRate",
  "combatRareFind",
  "combatDropQuantity",
  "combatExperience",
  "criticalRate",
  "criticalDamage",
  "armorPenetration",
  "waterPenetration",
  "naturePenetration",
  "firePenetration",
  "abilityHaste",
  "tenacity",
  "manaLeech",
  "castSpeed",
  "threat",
  "parry",
  "mayhem",
  "pierce",
  "curse",
  "fury",
  "weaken",
  "ripple",
  "bloom",
  "blaze",
  "attackSpeed",
  "foodHaste",
  "drinkConcentration",
  "autoAttackDamage",
  "abilityDamage",
  "retaliation",
] as const;

// ---------------------------------------------------------------------------
// Skill level stat names used in updateCombatDetails level boost loop
// ---------------------------------------------------------------------------

export const LEVEL_STATS = [
  "stamina",
  "intelligence",
  "attack",
  "melee",
  "defense",
  "ranged",
  "magic",
] as const;

// ---------------------------------------------------------------------------
// Melee combat styles (used for the stab/slash/smash loop)
// ---------------------------------------------------------------------------

export const MELEE_STYLES = ["stab", "slash", "smash"] as const;

// ---------------------------------------------------------------------------
// Experience skill types for SimResult tracking
// ---------------------------------------------------------------------------

export const EXPERIENCE_SKILLS = [
  "stamina",
  "intelligence",
  "attack",
  "melee",
  "defense",
  "ranged",
  "magic",
] as const;

// ---------------------------------------------------------------------------
// Defense scaling factor for base armor / resistance calculations
// ---------------------------------------------------------------------------

/** Armor/resistance base scaling per defense level. */
export const DEFENSE_SCALING_FACTOR = 0.2;

// ---------------------------------------------------------------------------
// Attack speed scaling divisor
// ---------------------------------------------------------------------------

/** Attack level divisor for attack speed scaling. */
export const ATTACK_SPEED_LEVEL_DIVISOR = 2000;
