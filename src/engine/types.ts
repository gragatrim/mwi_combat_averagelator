// =============================================================================
// MWI Combat Averagelator - TypeScript Type Definitions
// =============================================================================
// Comprehensive interfaces covering every data structure used in the MWI combat
// system: game data JSON shapes, combat engine internals, player configuration,
// and simulation results.

import type { EQUIPMENT_COMBAT_STAT_KEYS, EQUIPMENT_SLOTS } from "./constants";

// =============================================================================
// String Literal Union Types
// =============================================================================

/** Combat style hrids used throughout the game. */
export type CombatStyleHrid =
  | "/combat_styles/stab"
  | "/combat_styles/slash"
  | "/combat_styles/smash"
  | "/combat_styles/ranged"
  | "/combat_styles/magic"
  | "/combat_styles/heal";

/** Damage type hrids. */
export type DamageTypeHrid =
  | "/damage_types/physical"
  | "/damage_types/water"
  | "/damage_types/nature"
  | "/damage_types/fire";

/** Equipment slot hrids (combat-relevant). */
export type EquipmentSlotHrid = (typeof EQUIPMENT_SLOTS)[number];

/** Ability effect type hrids. */
export type AbilityEffectTypeHrid =
  | "/ability_effect_types/damage"
  | "/ability_effect_types/heal"
  | "/ability_effect_types/buff"
  | "/ability_effect_types/revive";

/** Ability target types (from ability effect definitions). */
export type AbilityTargetType =
  | "enemy"
  | "allEnemies"
  | "self"
  | "selfAndAlly"
  | "lowestHpAlly"
  | "allAllies"
  | "deadAlly";

/** Combat trigger dependency hrids. */
export type TriggerDependencyHrid =
  | "/combat_trigger_dependencies/self"
  | "/combat_trigger_dependencies/targeted_enemy"
  | "/combat_trigger_dependencies/all_allies"
  | "/combat_trigger_dependencies/all_enemies";

/** Combat trigger comparator hrids. */
export type TriggerComparatorHrid =
  | "/combat_trigger_comparators/greater_than_equal"
  | "/combat_trigger_comparators/less_than_equal"
  | "/combat_trigger_comparators/is_active"
  | "/combat_trigger_comparators/is_inactive";

/** Combat trigger condition hrids (exhaustive list from trigger.js). */
export type TriggerConditionHrid =
  | "/combat_trigger_conditions/current_hp"
  | "/combat_trigger_conditions/current_mp"
  | "/combat_trigger_conditions/missing_hp"
  | "/combat_trigger_conditions/missing_mp"
  | "/combat_trigger_conditions/stun_status"
  | "/combat_trigger_conditions/blind_status"
  | "/combat_trigger_conditions/silence_status"
  | "/combat_trigger_conditions/number_of_active_units"
  | "/combat_trigger_conditions/number_of_dead_units"
  | "/combat_trigger_conditions/lowest_hp_percentage"
  | "/combat_trigger_conditions/berserk"
  | "/combat_trigger_conditions/frenzy"
  | "/combat_trigger_conditions/precision"
  | "/combat_trigger_conditions/vampirism"
  | "/combat_trigger_conditions/attack_coffee"
  | "/combat_trigger_conditions/defense_coffee"
  | "/combat_trigger_conditions/lucky_coffee"
  | "/combat_trigger_conditions/magic_coffee"
  | "/combat_trigger_conditions/melee_coffee"
  | "/combat_trigger_conditions/ranged_coffee"
  | "/combat_trigger_conditions/swiftness_coffee"
  | "/combat_trigger_conditions/wisdom_coffee"
  | "/combat_trigger_conditions/channeling_coffee"
  | "/combat_trigger_conditions/ice_spear"
  | "/combat_trigger_conditions/puncture"
  | "/combat_trigger_conditions/frost_surge"
  | "/combat_trigger_conditions/elusiveness"
  | "/combat_trigger_conditions/fierce_aura"
  | "/combat_trigger_conditions/invincible_armor"
  | "/combat_trigger_conditions/invincible_fire_resistance"
  | "/combat_trigger_conditions/invincible_nature_resistance"
  | "/combat_trigger_conditions/invincible_water_resistance"
  | "/combat_trigger_conditions/provoke"
  | "/combat_trigger_conditions/taunt"
  | "/combat_trigger_conditions/crippling_slash"
  | "/combat_trigger_conditions/mana_spring"
  | "/combat_trigger_conditions/retribution"
  | "/combat_trigger_conditions/fracturing_impact"
  | "/combat_trigger_conditions/maim"
  | "/combat_trigger_conditions/curse"
  | "/combat_trigger_conditions/weaken"
  | "/combat_trigger_conditions/critical_aura"
  | "/combat_trigger_conditions/critical_coffee"
  | "/combat_trigger_conditions/intelligence_coffee"
  | "/combat_trigger_conditions/stamina_coffee"
  | "/combat_trigger_conditions/elemental_affinity"
  | "/combat_trigger_conditions/fury"
  | "/combat_trigger_conditions/guardian_aura"
  | "/combat_trigger_conditions/insanity"
  | "/combat_trigger_conditions/spike_shell"
  | "/combat_trigger_conditions/toxic_pollen"
  | "/combat_trigger_conditions/invincible"
  | "/combat_trigger_conditions/mystic_aura"
  | "/combat_trigger_conditions/pestilent_shot"
  | "/combat_trigger_conditions/smoke_burst"
  | "/combat_trigger_conditions/speed_aura"
  | "/combat_trigger_conditions/toughness"
  | "/combat_trigger_conditions/enrage"
  | (string & {}); // allow unknown future conditions

/** Buff type hrids. */
export type BuffTypeHrid =
  | "/buff_types/accuracy"
  | "/buff_types/damage"
  | "/buff_types/fury_accuracy"
  | "/buff_types/fury_damage"
  | "/buff_types/evasion"
  | "/buff_types/armor"
  | "/buff_types/water_resistance"
  | "/buff_types/nature_resistance"
  | "/buff_types/fire_resistance"
  | "/buff_types/hp_regen"
  | "/buff_types/mp_regen"
  | "/buff_types/life_steal"
  | "/buff_types/physical_thorns"
  | "/buff_types/elemental_thorns"
  | "/buff_types/wisdom"
  | "/buff_types/critical_rate"
  | "/buff_types/critical_damage"
  | "/buff_types/cast_speed"
  | "/buff_types/combat_drop_rate"
  | "/buff_types/rare_find"
  | "/buff_types/combat_drop_quantity"
  | "/buff_types/threat"
  | "/buff_types/attack_speed"
  | "/buff_types/damage_taken"
  | "/buff_types/physical_amplify"
  | "/buff_types/water_amplify"
  | "/buff_types/nature_amplify"
  | "/buff_types/fire_amplify"
  | "/buff_types/retaliation"
  | "/buff_types/healing_amplify"
  | "/buff_types/tenacity"
  | "/buff_types/stamina_level"
  | "/buff_types/intelligence_level"
  | "/buff_types/attack_level"
  | "/buff_types/melee_level"
  | "/buff_types/defense_level"
  | "/buff_types/ranged_level"
  | "/buff_types/magic_level"
  | (string & {}); // allow unknown future buff types

// =============================================================================
// Combat Stats (the inner stats object from combatUnit.combatDetails.combatStats)
// =============================================================================

/**
 * All numeric combat stats that can appear on equipment, monsters, and buffs.
 * This is the complete set from combatUnit.js lines 70-151.
 */
export interface CombatStats {
  // --- Style & type ---
  combatStyleHrid: CombatStyleHrid | string;
  damageType: DamageTypeHrid | string;

  // --- Timing ---
  attackInterval: number; // nanoseconds

  // --- Flat / ratio damage modifiers ---
  autoAttackDamage: number;
  abilityDamage: number;
  criticalRate: number;
  criticalDamage: number;

  // --- Per-style accuracy ---
  stabAccuracy: number;
  slashAccuracy: number;
  smashAccuracy: number;
  rangedAccuracy: number;
  magicAccuracy: number;

  // --- Per-style damage ---
  stabDamage: number;
  slashDamage: number;
  smashDamage: number;
  rangedDamage: number;
  magicDamage: number;
  defensiveDamage: number;
  taskDamage: number;

  // --- Elemental amplify ---
  physicalAmplify: number;
  waterAmplify: number;
  natureAmplify: number;
  fireAmplify: number;
  healingAmplify: number;

  // --- Thorns ---
  physicalThorns: number;
  elementalThorns: number;

  // --- HP / MP pools ---
  maxHitpoints: number;
  maxManapoints: number;
  maxHitpointsRatio: number;
  maxManapointsRatio: number;

  // --- Per-style evasion ---
  stabEvasion: number;
  slashEvasion: number;
  smashEvasion: number;
  rangedEvasion: number;
  magicEvasion: number;

  // --- Defenses ---
  armor: number;
  waterResistance: number;
  natureResistance: number;
  fireResistance: number;

  // --- Sustain ---
  lifeSteal: number;
  hpRegenPer10: number;
  mpRegenPer10: number;

  // --- Loot ---
  combatDropRate: number;
  combatDropQuantity: number;
  combatRareFind: number;
  combatExperience: number;

  // --- Consumable slots ---
  foodSlots: number;
  drinkSlots: number;

  // --- Penetration ---
  armorPenetration: number;
  waterPenetration: number;
  naturePenetration: number;
  firePenetration: number;

  // --- Utility ---
  manaLeech: number;
  castSpeed: number;
  threat: number;
  parry: number;
  mayhem: number;
  pierce: number;
  curse: number;
  ripple: number;
  bloom: number;
  blaze: number;
  weaken: number;
  fury: number;
  foodHaste: number;
  drinkConcentration: number;
  abilityHaste: number;
  tenacity: number;
  attackSpeed: number;
  damageTaken: number;

  // --- Armor-based damage ---
  armorDamageRatio: number;
  hpDrainRatio: number;

  // --- Training ---
  primaryTraining: string;
  focusTraining: string;

  // --- Per-skill experience bonuses ---
  staminaExperience: number;
  intelligenceExperience: number;
  attackExperience: number;
  defenseExperience: number;
  meleeExperience: number;
  rangedExperience: number;
  magicExperience: number;

  // --- Retaliation ---
  retaliation: number;
}

// =============================================================================
// Combat Details (the outer combatDetails object on a CombatUnit)
// =============================================================================

/**
 * The full derived combat details for a unit, including effective levels,
 * derived ratings, and the inner CombatStats. This mirrors the
 * combatUnit.combatDetails structure from combatUnit.js lines 35-152.
 */
export interface CombatDetails {
  // --- Effective levels (base + buff boosts) ---
  staminaLevel: number;
  intelligenceLevel: number;
  attackLevel: number;
  meleeLevel: number;
  defenseLevel: number;
  rangedLevel: number;
  magicLevel: number;

  // --- HP / MP ---
  maxHitpoints: number;
  currentHitpoints: number;
  maxManapoints: number;
  currentManapoints: number;

  // --- Derived accuracy ratings ---
  stabAccuracyRating: number;
  slashAccuracyRating: number;
  smashAccuracyRating: number;
  rangedAccuracyRating: number;
  magicAccuracyRating: number;

  // --- Derived max damage values ---
  stabMaxDamage: number;
  slashMaxDamage: number;
  smashMaxDamage: number;
  rangedMaxDamage: number;
  magicMaxDamage: number;
  defensiveMaxDamage: number;

  // --- Derived evasion ratings ---
  stabEvasionRating: number;
  slashEvasionRating: number;
  smashEvasionRating: number;
  rangedEvasionRating: number;
  magicEvasionRating: number;

  // --- Derived total defenses ---
  totalArmor: number;
  totalWaterResistance: number;
  totalNatureResistance: number;
  totalFireResistance: number;

  // --- Ability haste (stored at this level for convenience) ---
  abilityHaste: number;

  // --- Tenacity ---
  tenacity: number;

  // --- Threat ---
  totalThreat: number;

  // --- Inner stats ---
  combatStats: CombatStats;
}

// =============================================================================
// Buff Data (from buff.js and game data JSON)
// =============================================================================

/** Raw buff data as it appears in the game data JSON (ability buffs, consumable buffs, house room buffs). */
export interface BuffData {
  uniqueHrid: string;
  typeHrid: BuffTypeHrid | string;
  ratioBoost: number;
  ratioBoostLevelBonus: number;
  flatBoost: number;
  flatBoostLevelBonus: number;
  startTime: string | number; // JSON uses ISO string "0001-01-01T00:00:00Z"; runtime uses number
  duration: number; // nanoseconds
  multiplierForSkillHrid?: string;
  multiplierPerSkillLevel?: number;
}

/** Runtime buff instance (after level scaling has been applied). */
export interface BuffInstance {
  uniqueHrid: string;
  typeHrid: BuffTypeHrid | string;
  ratioBoost: number;
  flatBoost: number;
  duration: number;
  startTime: number;
  multiplierForSkillHrid: string;
  multiplierPerSkillLevel: number;
}

// =============================================================================
// Ability Data (from ability.js and game data JSON)
// =============================================================================

/** A single ability effect as defined in the game data JSON (abilityDetailMap). */
export interface AbilityEffectData {
  targetType: AbilityTargetType | string;
  effectType: AbilityEffectTypeHrid | string;
  combatStyleHrid: CombatStyleHrid | string;
  damageType: DamageTypeHrid | string;
  baseDamageFlat: number;
  baseDamageFlatLevelBonus: number;
  baseDamageRatio: number;
  baseDamageRatioLevelBonus: number;
  bonusAccuracyRatio: number;
  bonusAccuracyRatioLevelBonus: number;
  damageOverTimeRatio: number;
  damageOverTimeDuration: number; // nanoseconds
  armorDamageRatio: number;
  armorDamageRatioLevelBonus: number;
  hpDrainRatio: number;
  pierceChance: number;
  blindChance: number;
  blindDuration: number; // nanoseconds
  silenceChance: number;
  silenceDuration: number; // nanoseconds
  stunChance: number;
  stunDuration: number; // nanoseconds
  spendHpRatio: number;
  buffs: BuffData[] | null;
}

/** A resolved ability effect (after level-based scaling). Used at runtime. */
export interface AbilityEffect {
  targetType: AbilityTargetType | string;
  effectType: AbilityEffectTypeHrid | string;
  combatStyleHrid: CombatStyleHrid | string;
  damageType: DamageTypeHrid | string;
  damageFlat: number;
  damageRatio: number;
  bonusAccuracyRatio: number;
  damageOverTimeRatio: number;
  damageOverTimeDuration: number;
  armorDamageRatio: number;
  hpDrainRatio: number;
  pierceChance: number;
  blindChance: number;
  blindDuration: number;
  silenceChance: number;
  silenceDuration: number;
  stunChance: number;
  stunDuration: number;
  spendHpRatio: number;
  buffs: BuffInstance[] | null;
}

/** Game data JSON shape for a single ability (from abilityDetailMap). */
export interface AbilityData {
  hrid: string;
  name: string;
  description: string;
  isSpecialAbility: boolean;
  manaCost: number;
  cooldownDuration: number; // nanoseconds
  castDuration: number; // nanoseconds
  abilityEffects: AbilityEffectData[];
  defaultCombatTriggers: TriggerData[];
  sortIndex: number;
}

// =============================================================================
// Trigger Data (from trigger.js and game data JSON)
// =============================================================================

/** A combat trigger condition as stored in game data and player config. */
export interface TriggerData {
  dependencyHrid: TriggerDependencyHrid | string;
  conditionHrid: TriggerConditionHrid | string;
  comparatorHrid: TriggerComparatorHrid | string;
  value: number;
}

// =============================================================================
// Equipment Data (from equipment.js and game data JSON itemDetailMap)
// =============================================================================

/** Combat stats on an equipment item (from itemDetailMap[].equipmentDetail.combatStats). */
export interface EquipmentCombatStats {
  combatStyleHrids?: CombatStyleHrid[] | string[];
  damageType?: DamageTypeHrid | string;
  attackInterval?: number;
  primaryTraining?: string;
  focusTraining?: string;
  [statKey: string]: unknown; // all other numeric combat stats
}

/** Enhancement bonuses on equipment (from itemDetailMap[].equipmentDetail.combatEnhancementBonuses). */
export interface EquipmentEnhancementBonuses {
  [statKey: string]: number;
}

/** Level requirement for equipping an item. */
export interface LevelRequirement {
  skillHrid: string;
  level: number;
}

/** The equipmentDetail sub-object on an item in the game data JSON. */
export interface EquipmentDetail {
  type: EquipmentSlotHrid | string;
  levelRequirements: LevelRequirement[];
  combatStats: EquipmentCombatStats;
  noncombatStats: Record<string, number>;
  combatEnhancementBonuses: EquipmentEnhancementBonuses;
  noncombatEnhancementBonuses: Record<string, number>;
}

/** A reference to an equipped item with its enhancement level (player config DTO). */
export interface EquipmentDTO {
  hrid: string;
  enhancementLevel: number;
}

// =============================================================================
// Consumable Data (from consumable.js and game data JSON itemDetailMap)
// =============================================================================

/** The consumableDetail sub-object on a consumable item in the game data JSON. */
export interface ConsumableDetail {
  cooldownDuration: number; // nanoseconds
  usableInActionTypeMap: Record<string, boolean>;
  hitpointRestore: number;
  manapointRestore: number;
  recoveryDuration: number; // nanoseconds
  buffs: BuffData[] | null;
  defaultCombatTriggers: TriggerData[] | null;
}

/** A reference to an equipped consumable in player config DTO. */
export interface ConsumableDTO {
  hrid: string;
  triggers: TriggerData[];
}

// =============================================================================
// Item Data (top-level item from itemDetailMap)
// =============================================================================

/** Drop table entry for alchemy transmutation. */
export interface AlchemyDropTableEntry {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
}

/** Alchemy detail on an item. */
export interface AlchemyDetail {
  bulkMultiplier: number;
  isCoinifiable: boolean;
  decomposeItems: Array<{ itemHrid: string; count: number }> | null;
  transmuteSuccessRate: number;
  transmuteDropTable: AlchemyDropTableEntry[] | null;
}

/** A full item record from the game data JSON itemDetailMap. */
export interface ItemData {
  hrid: string;
  name: string;
  description: string;
  categoryHrid: string;
  sellPrice: number;
  isTradable: boolean;
  itemLevel: number;
  enhancementCosts?: Array<{ itemHrid: string; count: number }>;
  alchemyDetail?: AlchemyDetail;
  equipmentDetail?: EquipmentDetail;
  consumableDetail?: ConsumableDetail;
  sortIndex: number;
}

// =============================================================================
// Monster Data (from combatMonsterDetailMap in the game data JSON)
// =============================================================================

/** A monster's ability reference in game data (includes level and minimum difficulty tier). */
export interface MonsterAbilityRef {
  abilityHrid: string;
  level: number;
  minDifficultyTier: number;
}

/** Drop table entry for monster drops. */
export interface DropTableEntry {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
  difficultyTier?: number;
}

/** Rare drop table entry for monster drops. */
export interface RareDropTableEntry {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
  minDifficultyTier?: number;
}

/** Monster combat details as they appear in the game data JSON. */
export interface MonsterCombatDetailsData {
  currentHitpoints: number;
  maxHitpoints: number;
  currentManapoints: number;
  maxManapoints: number;
  attackInterval: number;
  totalCastSpeed: number;
  stabAccuracyRating: number;
  slashAccuracyRating: number;
  smashAccuracyRating: number;
  rangedAccuracyRating: number;
  magicAccuracyRating: number;
  defensiveMaxDamage: number;
  stabMaxDamage: number;
  slashMaxDamage: number;
  smashMaxDamage: number;
  rangedMaxDamage: number;
  magicMaxDamage: number;
  stabEvasionRating: number;
  slashEvasionRating: number;
  smashEvasionRating: number;
  rangedEvasionRating: number;
  magicEvasionRating: number;
  totalArmor: number;
  totalWaterResistance: number;
  totalNatureResistance: number;
  totalFireResistance: number;
  totalThreat: number;
  combatLevel: number;
  staminaLevel: number;
  intelligenceLevel: number;
  attackLevel: number;
  meleeLevel: number;
  defenseLevel: number;
  rangedLevel: number;
  magicLevel: number;
  combatStats: MonsterCombatStatsData;
}

/** The inner combatStats on a monster in game data. Note: uses combatStyleHrids (array) not combatStyleHrid. */
export interface MonsterCombatStatsData {
  combatStyleHrids: string[];
  damageType: DamageTypeHrid | string;
  attackInterval: number;
  [statKey: string]: unknown; // all other numeric stats are sparse
}

/** A full monster record from combatMonsterDetailMap. */
export interface MonsterData {
  hrid: string;
  name: string;
  isLabyrinthMonster: boolean;
  enrageTime: number; // nanoseconds
  experience: number;
  combatDetails: MonsterCombatDetailsData;
  abilities: MonsterAbilityRef[];
  dropTable: DropTableEntry[] | null;
  rareDropTable: RareDropTableEntry[];
}

// =============================================================================
// Action / Zone / Dungeon Data (from actionDetailMap in the game data JSON)
// =============================================================================

/** A single spawn entry within a zone's random or fixed spawn info. */
export interface SpawnEntry {
  combatMonsterHrid: string;
  difficultyTier: number;
  rate: number;
  strength: number;
}

/** Random spawn configuration for a zone fight wave. */
export interface RandomSpawnInfo {
  maxSpawnCount: number;
  maxTotalStrength: number;
  spawns: SpawnEntry[] | null;
}

/** Boss spawn entry. */
export interface BossSpawn {
  combatMonsterHrid: string;
  difficultyTier: number;
  rate: number;
  strength: number;
}

/** Fight info for a non-dungeon zone. */
export interface FightInfo {
  randomSpawnInfo: RandomSpawnInfo;
  bossSpawns: BossSpawn[] | null;
  battlesPerBoss: number;
}

/** Dungeon reward drop table entry (can have negative base dropRate with per-tier scaling). */
export interface DungeonRewardDropEntry {
  itemHrid: string;
  dropRate: number;
  dropRatePerDifficultyTier?: number;
  minCount: number;
  maxCount: number;
}

/** Dungeon-specific configuration. */
export interface DungeonInfo {
  keyItemHrid: string;
  rewardDropTable: DungeonRewardDropEntry[] | null;
  maxWaves: number;
  /** Map from wave number (as string key) to RandomSpawnInfo for that wave range. */
  randomSpawnInfoMap: Record<string, RandomSpawnInfo> | null;
  /** Map from wave number (as string key) to an array of fixed spawn entries (boss waves). */
  fixedSpawnsMap: Record<string, SpawnEntry[]> | null;
}

/** The combatZoneInfo sub-object on a combat action. */
export interface CombatZoneInfo {
  isDungeon: boolean;
  fightInfo: FightInfo;
  dungeonInfo: DungeonInfo;
}

/** A full action record from actionDetailMap (combat actions only are relevant here). */
export interface ActionData {
  hrid: string;
  function: string;
  type: string;
  category: string;
  name: string;
  maxDifficulty: number;
  levelRequirement: LevelRequirement;
  baseTimeCost: number;
  experienceGain: { skillHrid: string; value: number };
  dropTable: DropTableEntry[] | null;
  essenceDropTable: DropTableEntry[] | null;
  rareDropTable: RareDropTableEntry[] | null;
  upgradeItemHrid: string;
  retainAllEnhancement: boolean;
  inputItems: Array<{ itemHrid: string; count: number }> | null;
  outputItems: Array<{ itemHrid: string; count: number }> | null;
  combatZoneInfo: CombatZoneInfo | null;
  maxPartySize: number;
  buffs: BuffData[] | null;
  sortIndex: number;
}

/** Convenience type: a zone is an ActionData that has combatZoneInfo != null. */
export type ZoneAction = ActionData & { combatZoneInfo: CombatZoneInfo };

// =============================================================================
// Combat Style Detail (from combatStyleDetailMap)
// =============================================================================

export interface CombatStyleDetail {
  hrid: string;
  name: string;
  skillExpMap: Record<string, boolean> | null;
  sortIndex: number;
}

// =============================================================================
// Combat Trigger Dependency Detail (from combatTriggerDependencyDetailMap)
// =============================================================================

export interface CombatTriggerDependencyDetail {
  hrid: string;
  name: string;
  isSingleTarget: boolean;
  isMultiTarget: boolean;
  sortIndex: number;
}

// =============================================================================
// Combat Trigger Condition Detail (from combatTriggerConditionDetailMap)
// =============================================================================

export interface CombatTriggerConditionDetail {
  hrid: string;
  name: string;
  sortIndex: number;
}

// =============================================================================
// Combat Trigger Comparator Detail (from combatTriggerComparatorDetailMap)
// =============================================================================

export interface CombatTriggerComparatorDetail {
  hrid: string;
  name: string;
  allowValue: boolean;
  sortIndex: number;
}

// =============================================================================
// Damage Type Detail (from damageTypeDetailMap)
// =============================================================================

export interface DamageTypeDetail {
  hrid: string;
  name: string;
  sortIndex: number;
}

// =============================================================================
// Buff Type Detail (from buffTypeDetailMap)
// =============================================================================

export interface BuffTypeDetail {
  hrid: string;
  isCombat: boolean;
  name: string;
  description: string;
  debuffDescription: string;
  sortIndex: number;
}

// =============================================================================
// Equipment Type Detail (from equipmentTypeDetailMap)
// =============================================================================

export interface EquipmentTypeDetail {
  hrid: string;
  name: string;
  sortIndex: number;
}

// =============================================================================
// House Room Data (from houseRoomDetailMap)
// =============================================================================

export interface HouseRoomData {
  hrid: string;
  name: string;
  skillHrid: string;
  usableInActionTypeMap: Record<string, boolean>;
  actionBuffs: BuffData[];
  globalBuffs: BuffData[];
}

// =============================================================================
// Achievement Data (from achievementDetailMap)
// =============================================================================

export interface AchievementData {
  hrid: string;
  name: string;
  description: string;
  tierHrid: string;
  sortIndex: number;
  steamAchievementId: string;
  target: number;
}

// =============================================================================
// Skill Detail (from skillDetailMap)
// =============================================================================

export interface SkillDetail {
  hrid: string;
  name: string;
  sortIndex: number;
}

// =============================================================================
// Item Category Detail (from itemCategoryDetailMap)
// =============================================================================

export interface ItemCategoryDetail {
  hrid: string;
  name: string;
  sortIndex: number;
}

// =============================================================================
// Labyrinth Data
// =============================================================================

export interface LabyrinthCrateDetail {
  [itemHrid: string]: unknown;
}

export interface LabyrinthShopItemDetail {
  [itemHrid: string]: unknown;
}

// =============================================================================
// Player Configuration (for import from MWI client data or user input)
// =============================================================================

/** A single ability in the player DTO. */
export interface AbilityDTO {
  hrid: string;
  level: number;
  triggers: TriggerData[];
}

/** House room levels keyed by house room hrid. */
export type HouseRoomLevels = Record<string, number>;

/** Achievement tier map (hrid -> points). */
export type AchievementMap = Record<string, number>;

/**
 * Player configuration DTO - this is the shape used to import a player setup
 * into the simulator (matches the format produced by Player.createFromDTO).
 */
export interface PlayerConfig {
  hrid: string;
  staminaLevel: number;
  intelligenceLevel: number;
  attackLevel: number;
  meleeLevel: number;
  defenseLevel: number;
  rangedLevel: number;
  magicLevel: number;
  equipment: Partial<Record<EquipmentSlotHrid | string, EquipmentDTO | null>>;
  food: (ConsumableDTO | null)[];
  drinks: (ConsumableDTO | null)[];
  abilities: (AbilityDTO | null)[];
  /** The special ability (5th slot, e.g. Revive, Insanity, auras). */
  specialAbility: AbilityDTO | null;
  houseRooms: HouseRoomLevels;
  achievements: AchievementMap;
  debuffOnLevelGap?: number;
}

// =============================================================================
// Simulation Configuration
// =============================================================================

/** Configuration for a simulation run. */
export interface SimulationConfig {
  /** The combat action hrid to simulate. */
  actionHrid: string;
  /** Difficulty tier (0-5 for zones, 0-2 for dungeons typically). */
  difficultyTier: number;
  /** Player configurations (1-5 players). */
  players: PlayerConfig[];
  /** Whether to stop after a single encounter (for testing). */
  stopAfterFirstEncounter?: boolean;
  /** Simulation time limit in nanoseconds. */
  simulationDuration?: number;
}

// =============================================================================
// Simulation Result (from simResult.js)
// =============================================================================

/** Per-skill experience breakdown. */
export interface ExperienceBreakdown {
  stamina: number;
  intelligence: number;
  attack: number;
  melee: number;
  defense: number;
  ranged: number;
  magic: number;
}

/** Out-of-mana tracking for a player. */
export interface OutOfManaTime {
  isOutOfMana: boolean;
  startTimeForOutOfMana: number;
  totalTimeForOutOfMana: number;
}

/** Time-spent-alive tracking entry. */
export interface TimeSpentAliveEntry {
  name: string;
  timeSpentAlive: number;
  spawnedAt: number;
  alive: boolean;
  count: number;
}

/** Wipe event log entry. */
export interface WipeEvent {
  simulationTime: number;
  logs: unknown[];
  wave: number;
  timestamp: string;
}

/** Boss spawn tracking entry. */
export interface BossSpawnEntry {
  time: number;
  monsterHrid: string;
}

/**
 * Complete simulation result. Mirrors the SimResult class from simResult.js.
 */
export interface SimulationResult {
  /** Death counts keyed by unit hrid. */
  deaths: Record<string, number>;
  /** Experience gained keyed by player hrid -> ExperienceBreakdown. */
  experienceGained: Record<string, ExperienceBreakdown>;
  /** Total number of completed encounters. */
  encounters: number;
  /** Attack counts: source hrid -> target hrid -> ability name -> damage value -> count. */
  attacks: Record<string, Record<string, Record<string, Record<string, number>>>>;
  /** Consumables used: unit hrid -> consumable hrid -> count. */
  consumablesUsed: Record<string, Record<string, number>>;
  /** Hitpoints gained: unit hrid -> source name -> amount. */
  hitpointsGained: Record<string, Record<string, number>>;
  /** Manapoints gained: unit hrid -> source name -> amount. */
  manapointsGained: Record<string, Record<string, number>>;
  /** Debuff-on-level-gap multiplier per player hrid. */
  debuffOnLevelGap: Record<string, number>;
  /** Drop rate multiplier per player hrid. */
  dropRateMultiplier: Record<string, number>;
  /** Rare find multiplier per player hrid. */
  rareFindMultiplier: Record<string, number>;
  /** Combat drop quantity bonus per player hrid. */
  combatDropQuantity: Record<string, number>;
  /** Whether each player ran out of mana at any point. */
  playerRanOutOfMana: Record<string, boolean>;
  /** Detailed out-of-mana time tracking per player hrid. */
  playerRanOutOfManaTime: Record<string, OutOfManaTime>;
  /** Mana used: player hrid -> ability hrid -> total mana cost. */
  manaUsed: Record<string, Record<string, number>>;
  /** Time-spent-alive entries. */
  timeSpentAlive: TimeSpentAliveEntry[];
  /** Boss spawn tracking. */
  bossSpawns: BossSpawnEntry[];
  /** HP spent by abilities: unit hrid -> ability name -> amount. */
  hitpointsSpent: Record<string, Record<string, number>>;
  /** Zone name (action hrid). */
  zoneName: string;
  /** Difficulty tier. */
  difficultyTier: number;
  /** Whether this is a dungeon zone. */
  isDungeon: boolean;
  /** Number of completed dungeon runs. */
  dungeonsCompleted: number;
  /** Number of failed dungeon runs. */
  dungeonsFailed: number;
  /** Highest dungeon wave reached. */
  maxWaveReached: number;
  /** Number of players in the party. */
  numberOfPlayers: number;
  /** Maximum enrage stacks reached. */
  maxEnrageStack: number;
  /** Wipe event logs. */
  wipeEvents: WipeEvent[];
  /** Total simulation time elapsed in nanoseconds. */
  simulationTime: number;
}

// =============================================================================
// Game Data (the full init_client_data.json top-level structure)
// =============================================================================

/**
 * The complete game data structure as loaded from init_client_data.json.
 * Only the maps relevant to combat simulation are fully typed; others are
 * included as generic record types for future use.
 */
export interface GameData {
  type: string;
  gameVersion: string;
  versionTimestamp: string;
  currentTimestamp: string;

  /** Experience required per level (index = level). */
  levelExperienceTable: number[];

  /** Game mode details (e.g. "ironcow"). */
  gameModeDetailMap: Record<string, unknown>;

  /** Skill details keyed by skill hrid. */
  skillDetailMap: Record<string, SkillDetail>;

  // --- Combat-critical maps ---

  /** All abilities keyed by ability hrid. */
  abilityDetailMap: Record<string, AbilityData>;

  /** Ability slot unlock level requirements. */
  abilitySlotsLevelRequirementList: number[];

  /** All items keyed by item hrid (equipment, consumables, materials, etc.). */
  itemDetailMap: Record<string, ItemData>;

  /** Item categories keyed by category hrid. */
  itemCategoryDetailMap: Record<string, ItemCategoryDetail>;

  /** Item locations keyed by location hrid. */
  itemLocationDetailMap: Record<string, unknown>;

  /** Equipment types keyed by equipment type hrid. */
  equipmentTypeDetailMap: Record<string, EquipmentTypeDetail>;

  /** Combat styles keyed by style hrid. */
  combatStyleDetailMap: Record<string, CombatStyleDetail>;

  /** Damage types keyed by damage type hrid. */
  damageTypeDetailMap: Record<string, DamageTypeDetail>;

  /** All combat monsters keyed by monster hrid. */
  combatMonsterDetailMap: Record<string, MonsterData>;

  /** Combat trigger dependencies keyed by dependency hrid. */
  combatTriggerDependencyDetailMap: Record<string, CombatTriggerDependencyDetail>;

  /** Combat trigger conditions keyed by condition hrid. */
  combatTriggerConditionDetailMap: Record<string, CombatTriggerConditionDetail>;

  /** Combat trigger comparators keyed by comparator hrid. */
  combatTriggerComparatorDetailMap: Record<string, CombatTriggerComparatorDetail>;

  /** Enhancement level success rates (index = enhancement level). */
  enhancementLevelSuccessRateTable: number[];

  /** Enhancement level total bonus multipliers (index = enhancement level). */
  enhancementLevelTotalBonusMultiplierTable: number[];

  // --- Non-combat maps (typed generically for now) ---

  randomTaskTypeDetailMap: Record<string, unknown>;
  taskShopItemDetailMap: Record<string, unknown>;
  shopCategoryDetailMap: Record<string, unknown>;
  shopItemDetailMap: Record<string, unknown>;

  /** All actions (combat + non-combat) keyed by action hrid. */
  actionDetailMap: Record<string, ActionData>;

  actionTypeDetailMap: Record<string, unknown>;
  actionCategoryDetailMap: Record<string, unknown>;

  /** Buff types keyed by buff type hrid. */
  buffTypeDetailMap: Record<string, BuffTypeDetail>;

  /** Openable loot drop tables keyed by item hrid. */
  openableLootDropMap: Record<string, unknown>;

  /** House rooms keyed by house room hrid. */
  houseRoomDetailMap: Record<string, HouseRoomData>;

  purchaseBundleDetailMap: Record<string, unknown>;
  buyableUpgradeDetailMap: Record<string, unknown>;
  chatIconDetailMap: Record<string, unknown>;
  nameColorDetailMap: Record<string, unknown>;
  avatarDetailMap: Record<string, unknown>;
  avatarOutfitDetailMap: Record<string, unknown>;
  communityBuffTypeDetailMap: Record<string, unknown>;
  chatChannelTypeDetailMap: Record<string, unknown>;
  guildCharacterRoleDetailMap: Record<string, unknown>;
  leaderboardTypeDetailMap: Record<string, unknown>;
  leaderboardCategoryDetailMap: Record<string, unknown>;

  /** Achievements keyed by achievement hrid. */
  achievementDetailMap: Record<string, AchievementData>;

  achievementTierDetailMap: Record<string, unknown>;

  /** Labyrinth crate details keyed by item hrid. */
  labyrinthCrateDetailMap: Record<string, unknown>;

  /** Labyrinth shop items keyed by shop item hrid. */
  labyrinthShopItemDetailMap: Record<string, unknown>;

  /** API endpoint keys. */
  keys: string[];
}

// =============================================================================
// Derived Type Utilities
// =============================================================================

/** All equipment combat stat key names (as a type). */
export type EquipmentCombatStatKey = (typeof EQUIPMENT_COMBAT_STAT_KEYS)[number];

/** A record mapping equipment slot hrids to optional equipment DTOs. */
export type EquipmentLoadout = Partial<Record<EquipmentSlotHrid, EquipmentDTO | null>>;

/** A map of buff uniqueHrid -> BuffInstance (used for combatBuffs / permanentBuffs). */
export type BuffMap = Record<string, BuffInstance>;

/** A map of buff typeHrid -> BuffInstance (used for permanentBuffs keyed by type). */
export type PermanentBuffMap = Record<string, BuffInstance>;
