// =============================================================================
// MWI Combat Averagelator - Ability
// =============================================================================
// Ported from mwi_combat_sim ability.js. All data lookups use injected GameData
// instead of importing JSON directly.

import type {
  GameData,
  AbilityData,
  AbilityEffect,
  AbilityDTO,
  BuffInstance,
  BuffData,
} from "./types";
import Trigger, { type TriggerCombatUnit } from "./trigger";

// ---------------------------------------------------------------------------
// Static lookup: abilities derived from combat stats (blaze, bloom)
// These are special abilities that don't exist in abilityDetailMap but are
// created from equipment combat stats.
// ---------------------------------------------------------------------------

const abilityFromCombatStat: Record<string, AbilityData> = {
  blaze: {
    hrid: "/abilities/blaze",
    name: "Blaze",
    description: "",
    isSpecialAbility: false,
    manaCost: 0,
    cooldownDuration: 0,
    castDuration: 0,
    sortIndex: 0,
    abilityEffects: [
      {
        targetType: "allEnemies",
        effectType: "/ability_effect_types/damage",
        combatStyleHrid: "/combat_styles/magic",
        damageType: "/damage_types/fire",
        baseDamageFlat: 0,
        baseDamageFlatLevelBonus: 0.0,
        baseDamageRatio: 0.3,
        baseDamageRatioLevelBonus: 0,
        bonusAccuracyRatio: 0,
        bonusAccuracyRatioLevelBonus: 0,
        damageOverTimeRatio: 0,
        damageOverTimeDuration: 0,
        armorDamageRatio: 0,
        armorDamageRatioLevelBonus: 0,
        hpDrainRatio: 0,
        pierceChance: 0,
        blindChance: 0,
        blindDuration: 0,
        silenceChance: 0,
        silenceDuration: 0,
        stunChance: 0,
        stunDuration: 0,
        spendHpRatio: 0,
        buffs: null,
      },
    ],
    defaultCombatTriggers: [
      {
        dependencyHrid: "/combat_trigger_dependencies/all_enemies",
        conditionHrid: "/combat_trigger_conditions/number_of_active_units",
        comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
        value: 1,
      },
      {
        dependencyHrid: "/combat_trigger_dependencies/all_enemies",
        conditionHrid: "/combat_trigger_conditions/current_hp",
        comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
        value: 1,
      },
    ],
  },
  bloom: {
    hrid: "/abilities/bloom",
    name: "Bloom",
    description: "",
    isSpecialAbility: false,
    manaCost: 0,
    cooldownDuration: 0,
    castDuration: 0,
    sortIndex: 0,
    abilityEffects: [
      {
        targetType: "lowestHpAlly",
        effectType: "/ability_effect_types/heal",
        combatStyleHrid: "/combat_styles/magic",
        damageType: "",
        baseDamageFlat: 10,
        baseDamageFlatLevelBonus: 0,
        baseDamageRatio: 0.15,
        baseDamageRatioLevelBonus: 0,
        bonusAccuracyRatio: 0,
        bonusAccuracyRatioLevelBonus: 0,
        damageOverTimeRatio: 0,
        damageOverTimeDuration: 0,
        armorDamageRatio: 0,
        armorDamageRatioLevelBonus: 0,
        hpDrainRatio: 0,
        pierceChance: 0,
        blindChance: 0,
        blindDuration: 0,
        silenceChance: 0,
        silenceDuration: 0,
        stunChance: 0,
        stunDuration: 0,
        spendHpRatio: 0,
        buffs: null,
      },
    ],
    defaultCombatTriggers: [
      {
        dependencyHrid: "/combat_trigger_dependencies/all_allies",
        conditionHrid: "/combat_trigger_conditions/lowest_hp_percentage",
        comparatorHrid: "/combat_trigger_comparators/less_than_equal",
        value: 100,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helper: create a BuffInstance from raw BuffData + ability level
// Mirrors the Buff constructor from buff.js
// ---------------------------------------------------------------------------

function createBuffInstance(buff: BuffData, level: number): BuffInstance {
  return {
    uniqueHrid: buff.uniqueHrid,
    typeHrid: buff.typeHrid,
    ratioBoost: buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus,
    flatBoost: buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus,
    duration: buff.duration,
    startTime: 0,
    multiplierForSkillHrid: buff.multiplierForSkillHrid ?? "",
    multiplierPerSkillLevel: buff.multiplierPerSkillLevel ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Ability class
// ---------------------------------------------------------------------------

class Ability {
  public hrid: string;
  public level: number;
  public manaCost: number;
  public cooldownDuration: number;
  public castDuration: number;
  public isSpecialAbility: boolean;
  public abilityEffects: AbilityEffect[];
  public triggers: Trigger[];
  public lastUsed: number;

  private gameData: GameData;

  constructor(
    gameData: GameData,
    hrid: string,
    level: number = 1,
    triggers: Trigger[] | null = null,
  ) {
    this.gameData = gameData;
    this.hrid = hrid;
    this.level = level;

    let gameAbility: AbilityData | undefined =
      gameData.abilityDetailMap[hrid];
    if (!gameAbility) {
      gameAbility = abilityFromCombatStat[hrid];
    }
    if (!gameAbility) {
      throw new Error("No ability found for hrid: " + this.hrid);
    }

    this.manaCost = gameAbility.manaCost;
    this.cooldownDuration = gameAbility.cooldownDuration;
    this.castDuration = gameAbility.castDuration;
    this.isSpecialAbility = gameAbility.isSpecialAbility;

    this.abilityEffects = [];
    this.rebuildEffects();

    if (triggers) {
      this.triggers = triggers;
    } else {
      this.triggers = [];
      for (const defaultTrigger of gameAbility.defaultCombatTriggers) {
        const trigger = new Trigger(
          gameData,
          defaultTrigger.dependencyHrid,
          defaultTrigger.conditionHrid,
          defaultTrigger.comparatorHrid,
          defaultTrigger.value,
        );
        this.triggers.push(trigger);
      }
    }

    this.lastUsed = Number.MIN_SAFE_INTEGER;
  }

  /** Rebuild abilityEffects for the current level. Called from constructor and after labyrinth rescaling. */
  rebuildEffects(): void {
    let gameAbility: AbilityData | undefined =
      this.gameData.abilityDetailMap[this.hrid];
    if (!gameAbility) {
      gameAbility = abilityFromCombatStat[this.hrid];
    }
    if (!gameAbility) return;

    this.abilityEffects = [];

    for (const effect of gameAbility.abilityEffects) {
      const abilityEffect: AbilityEffect = {
        targetType: effect.targetType,
        effectType: effect.effectType,
        combatStyleHrid: effect.combatStyleHrid,
        damageType: effect.damageType,
        damageFlat:
          effect.baseDamageFlat +
          (this.level - 1) * effect.baseDamageFlatLevelBonus,
        damageRatio:
          effect.baseDamageRatio +
          (this.level - 1) * effect.baseDamageRatioLevelBonus,
        bonusAccuracyRatio:
          effect.bonusAccuracyRatio +
          (this.level - 1) * effect.bonusAccuracyRatioLevelBonus,
        damageOverTimeRatio: effect.damageOverTimeRatio,
        damageOverTimeDuration: effect.damageOverTimeDuration,
        armorDamageRatio:
          effect.armorDamageRatio +
          (this.level - 1) * effect.armorDamageRatioLevelBonus,
        hpDrainRatio: effect.hpDrainRatio,
        pierceChance: effect.pierceChance,
        blindChance: effect.blindChance,
        blindDuration: effect.blindDuration,
        silenceChance: effect.silenceChance,
        silenceDuration: effect.silenceDuration,
        stunChance: effect.stunChance,
        stunDuration: effect.stunDuration,
        spendHpRatio: effect.spendHpRatio,
        buffs: null,
      };

      if (effect.buffs) {
        abilityEffect.buffs = [];
        for (const buff of effect.buffs) {
          abilityEffect.buffs.push(createBuffInstance(buff, this.level));
        }
      }

      this.abilityEffects.push(abilityEffect);
    }
  }

  static createFromDTO(gameData: GameData, dto: AbilityDTO): Ability {
    const triggers = dto.triggers.map((trigger) =>
      Trigger.createFromDTO(gameData, trigger),
    );
    const ability = new Ability(gameData, dto.hrid, dto.level, triggers);
    return ability;
  }

  shouldTrigger(
    currentTime: number,
    source: TriggerCombatUnit,
    target: TriggerCombatUnit | null,
    friendlies: TriggerCombatUnit[],
    enemies: TriggerCombatUnit[] | null,
  ): boolean {
    if (source.isStunned) {
      return false;
    }

    if (source.isSilenced) {
      return false;
    }

    const haste = source.combatDetails.combatStats.abilityHaste;
    let cooldownDuration = this.cooldownDuration;
    if (haste > 0) {
      cooldownDuration = (cooldownDuration * 100) / (100 + haste);
    }

    if (this.lastUsed + cooldownDuration > currentTime) {
      return false;
    }

    if (this.triggers.length === 0) {
      return true;
    }

    let shouldTrigger = true;
    for (const trigger of this.triggers) {
      if (
        !trigger.isActive(source, target, friendlies, enemies, currentTime)
      ) {
        shouldTrigger = false;
      }
    }

    return shouldTrigger;
  }
}

export default Ability;
