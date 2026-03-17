// =============================================================================
// CombatUnit - Base combat entity with full stat aggregation
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/combatUnit.js
// All logic preserved exactly; typed with interfaces from types.ts.

import type {
  CombatDetails,
  CombatStats,
  BuffInstance,
  BuffMap,
  PermanentBuffMap,
  EquipmentSlotHrid,
} from "./types";

import {
  BASE_REGEN_PER_10,
  BASE_THREAT,
  DEFAULT_COMBAT_STYLE_HRID,
  DEFAULT_DAMAGE_TYPE_HRID,
  DEFAULT_ATTACK_INTERVAL,
  DEFENSE_SCALING_FACTOR,
  ATTACK_SPEED_LEVEL_DIVISOR,
  LEVEL_STATS,
  MELEE_STYLES,
} from "./constants";

// Forward-declared class references for types that may be created in parallel.
// These are imported as types only; runtime usage is through subclass composition.
import type Buff from "./buff";
import type Ability from "./ability";
import type Consumable from "./consumable";
import type Equipment from "./equipment";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Creates a fresh default CombatStats object. */
function createDefaultCombatStats(): CombatStats {
  return {
    combatStyleHrid: DEFAULT_COMBAT_STYLE_HRID,
    damageType: DEFAULT_DAMAGE_TYPE_HRID,
    attackInterval: DEFAULT_ATTACK_INTERVAL,
    autoAttackDamage: 0,
    abilityDamage: 0,
    criticalRate: 0,
    criticalDamage: 0,
    stabAccuracy: 0,
    slashAccuracy: 0,
    smashAccuracy: 0,
    rangedAccuracy: 0,
    magicAccuracy: 0,
    stabDamage: 0,
    slashDamage: 0,
    smashDamage: 0,
    rangedDamage: 0,
    magicDamage: 0,
    defensiveDamage: 0,
    taskDamage: 0,
    physicalAmplify: 0,
    waterAmplify: 0,
    natureAmplify: 0,
    fireAmplify: 0,
    healingAmplify: 0,
    physicalThorns: 0,
    elementalThorns: 0,
    maxHitpoints: 0,
    maxManapoints: 0,
    maxHitpointsRatio: 0,
    maxManapointsRatio: 0,
    stabEvasion: 0,
    slashEvasion: 0,
    smashEvasion: 0,
    rangedEvasion: 0,
    magicEvasion: 0,
    armor: 0,
    waterResistance: 0,
    natureResistance: 0,
    fireResistance: 0,
    lifeSteal: 0,
    hpRegenPer10: 0.01,
    mpRegenPer10: 0.01,
    combatDropRate: 0,
    combatDropQuantity: 0,
    combatRareFind: 0,
    combatExperience: 0,
    foodSlots: 1,
    drinkSlots: 1,
    armorPenetration: 0,
    waterPenetration: 0,
    naturePenetration: 0,
    firePenetration: 0,
    manaLeech: 0,
    castSpeed: 0,
    threat: 100,
    parry: 0,
    mayhem: 0,
    pierce: 0,
    curse: 0,
    ripple: 0,
    bloom: 0,
    blaze: 0,
    weaken: 0,
    fury: 0,
    foodHaste: 0,
    drinkConcentration: 0,
    abilityHaste: 0,
    tenacity: 0,
    attackSpeed: 0,
    damageTaken: 0,
    armorDamageRatio: 0,
    hpDrainRatio: 0,
    primaryTraining: "",
    focusTraining: "",
    staminaExperience: 0,
    intelligenceExperience: 0,
    attackExperience: 0,
    defenseExperience: 0,
    meleeExperience: 0,
    rangedExperience: 0,
    magicExperience: 0,
    retaliation: 0,
  };
}

/** Creates a fresh default CombatDetails object. */
function createDefaultCombatDetails(): CombatDetails {
  return {
    staminaLevel: 1,
    intelligenceLevel: 1,
    attackLevel: 1,
    meleeLevel: 1,
    defenseLevel: 1,
    rangedLevel: 1,
    magicLevel: 1,
    maxHitpoints: 110,
    currentHitpoints: 110,
    maxManapoints: 110,
    currentManapoints: 110,
    stabAccuracyRating: 11,
    slashAccuracyRating: 11,
    smashAccuracyRating: 11,
    rangedAccuracyRating: 11,
    magicAccuracyRating: 11,
    stabMaxDamage: 11,
    slashMaxDamage: 11,
    smashMaxDamage: 11,
    rangedMaxDamage: 11,
    magicMaxDamage: 11,
    defensiveMaxDamage: 0,
    stabEvasionRating: 11,
    slashEvasionRating: 11,
    smashEvasionRating: 11,
    rangedEvasionRating: 11,
    magicEvasionRating: 11,
    totalArmor: 0.2,
    totalWaterResistance: 0.4,
    totalNatureResistance: 0.4,
    totalFireResistance: 0.4,
    abilityHaste: 0,
    tenacity: 0,
    totalThreat: 100,
    combatStats: createDefaultCombatStats(),
  };
}

// -----------------------------------------------------------------------------
// Drop entry (simple data class, avoids importing a separate Drops module)
// -----------------------------------------------------------------------------

export interface DropEntry {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
  difficultyTier?: number;
}

// -----------------------------------------------------------------------------
// CombatUnit
// -----------------------------------------------------------------------------

class CombatUnit {
  isPlayer: boolean = false;
  hrid: string = "";

  // CC state
  isStunned: boolean = false;
  stunExpireTime: number | null = null;
  isBlinded: boolean = false;
  blindExpireTime: number | null = null;
  isSilenced: boolean = false;
  silenceExpireTime: number | null = null;

  isOutOfMana: boolean = false;

  // Base levels which don't change after initialization
  staminaLevel: number = 1;
  intelligenceLevel: number = 1;
  attackLevel: number = 1;
  meleeLevel: number = 1;
  defenseLevel: number = 1;
  rangedLevel: number = 1;
  magicLevel: number = 1;

  experience: number = 0;
  experienceRate: number = 0;
  enrageTime: number = 0;

  abilities: (Ability | null)[] = [null, null, null, null];
  food: (Consumable | null)[] = [null, null, null];
  drinks: (Consumable | null)[] = [null, null, null];
  houseRooms: Array<{ hrid: string; level: number; buffs: Buff[] }> = [];
  achievements: { buffs: Buff[] } | null = null;
  dropTable: DropEntry[] = [];
  rareDropTable: DropEntry[] = [];
  abilityManaCosts: Map<string, number> = new Map();

  // Equipment map (populated by Player subclass)
  equipment: Partial<Record<EquipmentSlotHrid | string, Equipment | null>> | null = null;

  // Calculated combat stats including temporary buffs
  combatDetails: CombatDetails = createDefaultCombatDetails();

  // Buff maps keyed by uniqueHrid (combat) or typeHrid (permanent)
  combatBuffs: BuffMap = {};
  permanentBuffs: PermanentBuffMap = {};
  zoneBuffs: Buff[] = [];
  extraBuffs: Buff[] = [];

  // Internal fury event reference (used by combat loop)
  _activeFuryEvent: { cancelled: boolean } | null = null;

  debuffOnLevelGap: number | undefined;

  constructor() {}

  // ---------------------------------------------------------------------------
  // updateCombatDetails - THE critical stat aggregation method
  // ---------------------------------------------------------------------------

  updateCombatDetails(): void {
    // Player-only: ensure base regen floor
    if (this.isPlayer) {
      if (this.combatDetails.combatStats.hpRegenPer10 === 0) {
        this.combatDetails.combatStats.hpRegenPer10 = BASE_REGEN_PER_10;
      } else {
        this.combatDetails.combatStats.hpRegenPer10 =
          BASE_REGEN_PER_10 + this.combatDetails.combatStats.hpRegenPer10;
      }
      if (this.combatDetails.combatStats.mpRegenPer10 === 0) {
        this.combatDetails.combatStats.mpRegenPer10 = BASE_REGEN_PER_10;
      } else {
        this.combatDetails.combatStats.mpRegenPer10 =
          BASE_REGEN_PER_10 + this.combatDetails.combatStats.mpRegenPer10;
      }
    }

    // Apply level buffs for each stat
    for (const stat of LEVEL_STATS) {
      const levelKey = `${stat}Level` as keyof CombatUnit & keyof CombatDetails;
      (this.combatDetails as any)[levelKey] = (this as any)[levelKey] as number;
      const boosts = this.getBuffBoosts(`/buff_types/${stat}_level`);
      for (const buff of boosts) {
        (this.combatDetails as any)[levelKey] +=
          ((this as any)[levelKey] as number) * buff.ratioBoost;
        (this.combatDetails as any)[levelKey] += buff.flatBoost;
      }
    }

    // Max HP / MP
    this.combatDetails.maxHitpoints = Math.floor(
      10 *
        (10 + this.combatDetails.staminaLevel) *
        (1 + this.combatDetails.combatStats.maxHitpointsRatio) +
        this.combatDetails.combatStats.maxHitpoints
    );
    this.combatDetails.maxManapoints = Math.floor(
      10 *
        (10 + this.combatDetails.intelligenceLevel) *
        (1 + this.combatDetails.combatStats.maxManapointsRatio) +
        this.combatDetails.combatStats.maxManapoints
    );

    // Fury boosts
    const accuracyRatioBoostFromFury =
      this.getBuffBoost("/buff_types/fury_accuracy").ratioBoost;
    const damageRatioBoostFromFury =
      this.getBuffBoost("/buff_types/fury_damage").ratioBoost;

    // Generic accuracy/damage boosts
    const accuracyRatioBoost =
      this.getBuffBoost("/buff_types/accuracy").ratioBoost;
    const damageRatioBoost =
      this.getBuffBoost("/buff_types/damage").ratioBoost;

    // Melee styles: stab, slash, smash
    for (const style of MELEE_STYLES) {
      (this.combatDetails as any)[`${style}AccuracyRating`] =
        (10 + this.combatDetails.attackLevel) *
        (1 + (this.combatDetails.combatStats as any)[`${style}Accuracy`]) *
        (1 + accuracyRatioBoost) *
        (1 + accuracyRatioBoostFromFury);
      (this.combatDetails as any)[`${style}MaxDamage`] =
        (10 + this.combatDetails.meleeLevel) *
        (1 + (this.combatDetails.combatStats as any)[`${style}Damage`]) *
        (1 + damageRatioBoost) *
        (1 + damageRatioBoostFromFury);

      const baseEvasion =
        (10 + this.combatDetails.defenseLevel) *
        (1 + (this.combatDetails.combatStats as any)[`${style}Evasion`]);
      (this.combatDetails as any)[`${style}EvasionRating`] = baseEvasion;

      const evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
      for (const boost of evasionBoosts) {
        (this.combatDetails as any)[`${style}EvasionRating`] += boost.flatBoost;
        (this.combatDetails as any)[`${style}EvasionRating`] +=
          baseEvasion * boost.ratioBoost;
      }
    }

    // Defensive max damage
    this.combatDetails.defensiveMaxDamage =
      (10 + this.combatDetails.defenseLevel) *
      (1 + this.combatDetails.combatStats.defensiveDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    // Bulwark bonus: when equipped with bulwark two-hander, add defensive damage to smash
    if (
      this.equipment?.["/equipment_types/two_hand"] &&
      (this.equipment["/equipment_types/two_hand"] as Equipment).hrid.includes(
        "bulwark"
      )
    ) {
      this.combatDetails.smashMaxDamage +=
        this.combatDetails.defensiveMaxDamage;
    }

    // Ranged ratings
    this.combatDetails.rangedAccuracyRating =
      (10 + this.combatDetails.attackLevel) *
      (1 + this.combatDetails.combatStats.rangedAccuracy) *
      (1 + accuracyRatioBoost) *
      (1 + accuracyRatioBoostFromFury);
    this.combatDetails.rangedMaxDamage =
      (10 + this.combatDetails.rangedLevel) *
      (1 + this.combatDetails.combatStats.rangedDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    const baseRangedEvasion =
      (10 + this.combatDetails.defenseLevel) *
      (1 + this.combatDetails.combatStats.rangedEvasion);
    this.combatDetails.rangedEvasionRating = baseRangedEvasion;
    const evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
    for (const boost of evasionBoosts) {
      this.combatDetails.rangedEvasionRating += boost.flatBoost;
      this.combatDetails.rangedEvasionRating +=
        baseRangedEvasion * boost.ratioBoost;
    }

    // Damage taken from buffs
    this.combatDetails.combatStats.damageTaken =
      this.getBuffBoost("/buff_types/damage_taken").flatBoost;

    // Magic ratings
    this.combatDetails.magicAccuracyRating =
      (10 + this.combatDetails.attackLevel) *
      (1 + this.combatDetails.combatStats.magicAccuracy) *
      (1 + accuracyRatioBoost) *
      (1 + accuracyRatioBoostFromFury);
    this.combatDetails.magicMaxDamage =
      (10 + this.combatDetails.magicLevel) *
      (1 + this.combatDetails.combatStats.magicDamage) *
      (1 + damageRatioBoost) *
      (1 + damageRatioBoostFromFury);

    const baseMagicEvasion =
      (10 + this.combatDetails.defenseLevel) *
      (1 + this.combatDetails.combatStats.magicEvasion);
    this.combatDetails.magicEvasionRating = baseMagicEvasion;
    for (const boost of evasionBoosts) {
      this.combatDetails.magicEvasionRating += boost.flatBoost;
      this.combatDetails.magicEvasionRating +=
        baseMagicEvasion * boost.ratioBoost;
    }

    // Elemental amplify buffs
    this.combatDetails.combatStats.physicalAmplify +=
      this.getBuffBoost("/buff_types/physical_amplify").flatBoost;
    this.combatDetails.combatStats.waterAmplify +=
      this.getBuffBoost("/buff_types/water_amplify").flatBoost;
    this.combatDetails.combatStats.natureAmplify +=
      this.getBuffBoost("/buff_types/nature_amplify").flatBoost;
    this.combatDetails.combatStats.fireAmplify +=
      this.getBuffBoost("/buff_types/fire_amplify").flatBoost;
    this.combatDetails.combatStats.healingAmplify +=
      this.getBuffBoost("/buff_types/healing_amplify").flatBoost;

    // Attack interval scaling by attack level
    this.combatDetails.combatStats.attackInterval /=
      1 + this.combatDetails.attackLevel / ATTACK_SPEED_LEVEL_DIVISOR;

    // Attack speed: base equipment stat + buff boosts
    const baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
    this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;
    const attackIntervalBoosts = this.getBuffBoosts("/buff_types/attack_speed");
    const attackIntervalRatioBoost = attackIntervalBoosts
      .map((boost) => boost.ratioBoost)
      .reduce((prev, cur) => prev + cur, 0);
    this.combatDetails.combatStats.attackInterval /=
      1 + attackIntervalRatioBoost;

    // Armor: base from defense level + equipment + buff boosts
    const baseArmor =
      DEFENSE_SCALING_FACTOR * this.combatDetails.defenseLevel +
      this.combatDetails.combatStats.armor;
    this.combatDetails.totalArmor = baseArmor;
    const armorBoosts = this.getBuffBoosts("/buff_types/armor");
    for (const boost of armorBoosts) {
      this.combatDetails.totalArmor += boost.flatBoost;
      this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
    }

    // Water resistance
    const baseWaterResistance =
      DEFENSE_SCALING_FACTOR * this.combatDetails.defenseLevel +
      this.combatDetails.combatStats.waterResistance;
    this.combatDetails.totalWaterResistance = baseWaterResistance;
    const waterResistanceBoosts = this.getBuffBoosts(
      "/buff_types/water_resistance"
    );
    for (const boost of waterResistanceBoosts) {
      this.combatDetails.totalWaterResistance += boost.flatBoost;
      this.combatDetails.totalWaterResistance +=
        baseWaterResistance * boost.ratioBoost;
    }

    // Nature resistance
    const baseNatureResistance =
      DEFENSE_SCALING_FACTOR * this.combatDetails.defenseLevel +
      this.combatDetails.combatStats.natureResistance;
    this.combatDetails.totalNatureResistance = baseNatureResistance;
    const natureResistanceBoosts = this.getBuffBoosts(
      "/buff_types/nature_resistance"
    );
    for (const boost of natureResistanceBoosts) {
      this.combatDetails.totalNatureResistance += boost.flatBoost;
      this.combatDetails.totalNatureResistance +=
        baseNatureResistance * boost.ratioBoost;
    }

    // Fire resistance
    const baseFireResistance =
      DEFENSE_SCALING_FACTOR * this.combatDetails.defenseLevel +
      this.combatDetails.combatStats.fireResistance;
    this.combatDetails.totalFireResistance = baseFireResistance;
    const fireResistanceBoosts = this.getBuffBoosts(
      "/buff_types/fire_resistance"
    );
    for (const boost of fireResistanceBoosts) {
      this.combatDetails.totalFireResistance += boost.flatBoost;
      this.combatDetails.totalFireResistance +=
        baseFireResistance * boost.ratioBoost;
    }

    // HP regen buffs
    const hpRegenBoosts = this.getBuffBoost("/buff_types/hp_regen");
    this.combatDetails.combatStats.hpRegenPer10 +=
      this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
    this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

    // MP regen buffs
    const mpRegenBoosts = this.getBuffBoost("/buff_types/mp_regen");
    this.combatDetails.combatStats.mpRegenPer10 +=
      this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
    this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

    // Single flat-boost buff aggregations
    this.combatDetails.combatStats.lifeSteal +=
      this.getBuffBoost("/buff_types/life_steal").flatBoost;
    this.combatDetails.combatStats.physicalThorns +=
      this.getBuffBoost("/buff_types/physical_thorns").flatBoost;
    this.combatDetails.combatStats.elementalThorns +=
      this.getBuffBoost("/buff_types/elemental_thorns").flatBoost;
    this.combatDetails.combatStats.combatExperience +=
      this.getBuffBoost("/buff_types/wisdom").flatBoost;
    this.combatDetails.combatStats.criticalRate +=
      this.getBuffBoost("/buff_types/critical_rate").flatBoost;
    this.combatDetails.combatStats.criticalDamage +=
      this.getBuffBoost("/buff_types/critical_damage").flatBoost;

    // Cast speed: buff + attack level scaling
    this.combatDetails.combatStats.castSpeed +=
      this.getBuffBoost("/buff_types/cast_speed").flatBoost;
    this.combatDetails.combatStats.castSpeed +=
      this.combatDetails.attackLevel / ATTACK_SPEED_LEVEL_DIVISOR;

    // Drop rate (ratio + flat)
    const combatDropRateBoosts = this.getBuffBoost(
      "/buff_types/combat_drop_rate"
    );
    this.combatDetails.combatStats.combatDropRate +=
      (1 + this.combatDetails.combatStats.combatDropRate) *
      combatDropRateBoosts.ratioBoost;
    this.combatDetails.combatStats.combatDropRate +=
      combatDropRateBoosts.flatBoost;

    // Rare find (ratio + flat)
    const combatRareFindBoosts = this.getBuffBoost("/buff_types/rare_find");
    this.combatDetails.combatStats.combatRareFind +=
      (1 + this.combatDetails.combatStats.combatRareFind) *
      combatRareFindBoosts.ratioBoost;
    this.combatDetails.combatStats.combatRareFind +=
      combatRareFindBoosts.flatBoost;

    // Drop quantity (ratio + flat)
    const combatDropQuantityBoosts = this.getBuffBoost(
      "/buff_types/combat_drop_quantity"
    );
    this.combatDetails.combatStats.combatDropQuantity +=
      (1 + this.combatDetails.combatStats.combatDropQuantity) *
      combatDropQuantityBoosts.ratioBoost;
    this.combatDetails.combatStats.combatDropQuantity +=
      combatDropQuantityBoosts.flatBoost;

    // Threat
    const baseThreat =
      BASE_THREAT + this.combatDetails.combatStats.threat;
    this.combatDetails.totalThreat = baseThreat;
    const threatBoosts = this.getBuffBoost("/buff_types/threat");
    if (threatBoosts.ratioBoost !== 0) {
      this.combatDetails.combatStats.threat +=
        baseThreat * threatBoosts.ratioBoost;
    } else {
      this.combatDetails.combatStats.threat = baseThreat;
    }
    this.combatDetails.combatStats.threat += threatBoosts.flatBoost;

    // Retaliation
    this.combatDetails.combatStats.retaliation +=
      this.getBuffBoost("/buff_types/retaliation").flatBoost;

    // Tenacity (reduces CC durations)
    this.combatDetails.combatStats.tenacity +=
      this.getBuffBoost("/buff_types/tenacity").flatBoost;
  }

  // ---------------------------------------------------------------------------
  // Buff management
  // ---------------------------------------------------------------------------

  addBuff(buff: Buff, currentTime: number): void {
    buff.startTime = currentTime;
    this.combatBuffs[buff.uniqueHrid] = buff;
    this.updateCombatDetails();
  }

  removeBuff(buff: Buff): void {
    if (!this.combatBuffs[buff.uniqueHrid]) {
      return;
    }
    delete this.combatBuffs[buff.uniqueHrid];
    this.updateCombatDetails();
  }

  addPermanentBuff(buff: Buff): void {
    if (this.permanentBuffs[buff.typeHrid]) {
      this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
      this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
    } else {
      // Clone to avoid mutating the source buff object. Without this,
      // shared Buff references (e.g., crate/seal buffs reused across
      // multiple sim runs) accumulate stale values when a later buff
      // of the same typeHrid triggers the if-branch above.
      this.permanentBuffs[buff.typeHrid] = Object.assign(
        Object.create(Object.getPrototypeOf(buff)),
        buff
      );
    }
  }

  generatePermanentBuffs(): void {
    for (let i = 0; i < this.houseRooms.length; i++) {
      const houseRoom = this.houseRooms[i];
      houseRoom.buffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }

    if (this.achievements) {
      this.achievements.buffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
    if (this.zoneBuffs) {
      this.zoneBuffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
    if (this.extraBuffs) {
      this.extraBuffs.forEach((buff) => {
        this.addPermanentBuff(buff);
      });
    }
  }

  removeExpiredBuffs(currentTime: number): void {
    const expiredBuffs = Object.values(this.combatBuffs).filter(
      (buff) =>
        buff.duration > 0 && buff.startTime + buff.duration <= currentTime
    );
    expiredBuffs.forEach((buff) => {
      delete this.combatBuffs[buff.uniqueHrid];
    });
    this.updateCombatDetails();
  }

  clearBuffs(): void {
    this.combatBuffs = structuredClone(this.permanentBuffs) as BuffMap;
    if (this._activeFuryEvent) {
      this._activeFuryEvent.cancelled = true;
      this._activeFuryEvent = null;
    }
    this.updateCombatDetails();
  }

  clearCCs(): void {
    this.isStunned = false;
    this.stunExpireTime = null;
    this.isSilenced = false;
    this.silenceExpireTime = null;
    this.isBlinded = false;
    this.blindExpireTime = null;
    this.combatDetails.combatStats.damageTaken = 0;
  }

  // ---------------------------------------------------------------------------
  // Buff boost aggregation helpers
  // ---------------------------------------------------------------------------

  getBuffBoosts(type: string): { ratioBoost: number; flatBoost: number }[] {
    const boosts: { ratioBoost: number; flatBoost: number }[] = [];
    Object.values(this.combatBuffs)
      .filter((buff) => buff.typeHrid === type)
      .forEach((buff) => {
        boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });
      });
    return boosts;
  }

  getBuffBoost(type: string): { ratioBoost: number; flatBoost: number } {
    const boosts = this.getBuffBoosts(type);
    const boost = { ratioBoost: 0, flatBoost: 0 };
    for (let i = 0; i < boosts.length; i++) {
      boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
      boost.flatBoost += boosts[i]?.flatBoost ?? 0;
    }
    return boost;
  }

  // ---------------------------------------------------------------------------
  // Reset / cooldown management
  // ---------------------------------------------------------------------------

  reset(currentTime: number = 0): void {
    this.clearCCs();
    this.clearBuffs();
    this.updateCombatDetails();
    this.resetCooldowns(currentTime);

    this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
    this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
  }

  resetCooldowns(currentTime: number = 0): void {
    this.food
      .filter((food): food is Consumable => food != null)
      .forEach((food) => {
        food.lastUsed = Number.MIN_SAFE_INTEGER;
      });
    this.drinks
      .filter((drink): drink is Consumable => drink != null)
      .forEach((drink) => {
        drink.lastUsed = Number.MIN_SAFE_INTEGER;
      });

    const haste = this.combatDetails.combatStats.abilityHaste;

    this.abilities
      .filter((ability): ability is Ability => ability != null)
      .forEach((ability) => {
        if (this.isPlayer) {
          ability.lastUsed = Number.MIN_SAFE_INTEGER;
        } else {
          let cooldownDuration = ability.cooldownDuration;
          if (haste > 0) {
            cooldownDuration = (cooldownDuration * 100) / (100 + haste);
          }
          // Deterministic: replace Math.random() with 0.5 (expected value
          // of Uniform(0,1)).  Original range: [cd*0.5, cd*1.0] into the
          // past from currentTime → expected midpoint is 0.75*cd ago.
          ability.lastUsed =
            currentTime -
            Math.floor(cooldownDuration * 0.5) +
            Math.floor(0.5 * cooldownDuration * 0.5);
        }
      });
  }

  // ---------------------------------------------------------------------------
  // HP / MP helpers
  // ---------------------------------------------------------------------------

  addHitpoints(hitpoints: number): number {
    let hitpointsAdded = 0;

    if (
      this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints
    ) {
      return hitpointsAdded;
    }

    const newHitpoints = Math.min(
      this.combatDetails.currentHitpoints + hitpoints,
      this.combatDetails.maxHitpoints
    );
    hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
    this.combatDetails.currentHitpoints = newHitpoints;

    return hitpointsAdded;
  }

  addManapoints(manapoints: number): number {
    let manapointsAdded = 0;

    if (
      this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints
    ) {
      return manapointsAdded;
    }

    const newManapoints = Math.min(
      this.combatDetails.currentManapoints + manapoints,
      this.combatDetails.maxManapoints
    );
    manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
    this.combatDetails.currentManapoints = newManapoints;

    return manapointsAdded;
  }
}

export default CombatUnit;
