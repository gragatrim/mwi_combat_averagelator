// =============================================================================
// CombatUtilities - Deterministic (expected-value) combat calculations
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/combatUtilities.js
// Every stochastic element (Math.random, randomInt) is replaced with the
// mathematical expected value so that a single deterministic pass converges
// to the long-run average of the original Monte Carlo simulator.

import type { AbilityEffect, CombatStyleHrid, DamageTypeHrid } from "./types";
import CombatUnit from "./combatUnit";

// =============================================================================
// Result Interfaces
// =============================================================================

/**
 * Comprehensive result of a single deterministic attack.
 *
 * All values are expected (average) values.  CC durations are the expected
 * time-delay a target would experience *per attack*, accounting for proc
 * chance and tenacity.  The caller (DeterministicSimulator) uses these to
 * apply fractional delays to the target's attack timeline.
 */
export interface AttackResult {
  /** Expected HP removed from the target (after resistance, hit chance). */
  damageDone: number;
  /** The computed hit probability (for reference / pierce calculations). */
  hitChance: number;

  // --- Thorns ---
  /** Expected thorn damage reflected back to the attacker. */
  thornDamageDone: number;
  /** Which thorn type applied ("physicalThorns" | "elementalThorns" | undefined). */
  thornType: string | undefined;

  // --- Retaliation ---
  /** Expected retaliation damage dealt back to the attacker. */
  retaliationDamageDone: number;

  // --- Sustain ---
  /** Expected HP healed via life steal. */
  lifeStealHealed: number;
  /** Expected HP drained via hpDrainRatio (ability effect). */
  hpDrained: number;
  /** Expected MP gained via mana leech. */
  manaLeechGained: number;

  // --- CC (fractional expected durations in nanoseconds) ---
  /** Expected stun duration this attack inflicts on target. */
  expectedStunDuration: number;
  /** Expected blind duration this attack inflicts on target. */
  expectedBlindDuration: number;
  /** Expected silence duration this attack inflicts on target. */
  expectedSilenceDuration: number;

  // --- CC effective chances (for mid-action interruption penalty) ---
  /** Effective stun chance = hitChance * stunChance * tenacityFactor. */
  effectiveStunChance: number;
  /** Effective silence chance = hitChance * silenceChance * tenacityFactor. */
  effectiveSilenceChance: number;

  // --- Curse / Weaken / Fury ---
  /**
   * Expected curse damageTaken flatBoost this attack contributes.
   * Curse stacks additively with each hit; this is the per-hit expected
   * contribution = hitChance * curseChance * source.curse.
   * curseChance = 100 / (100 + targetTenacity) for auto-attacks, or
   * 100 / (100 + targetTenacity) for abilities (both gated by didHit).
   */
  expectedCurseApplied: number;
  /**
   * Expected weaken damage-ratio debuff applied to the attacker by the
   * *target's* weaken stat.  Per-hit contribution = target.weaken *
   * (probability the weaken stacks by 1).
   */
  expectedWeakenApplied: number;
  /**
   * Expected fury accuracy/damage ratio boost gained by the source per
   * attack.  The deterministic sim uses this to maintain a running
   * average fury stack.
   */
  expectedFuryGained: number;

  // --- Damage over time ---
  damageOverTime: {
    damage: number;
    totalTicks: number;
    combatStyleHrid: string;
  } | null;

  // --- Pre-mitigation expected damage (used for pierce chain references) ---
  expectedPreMitigationDamage: number;

  /** Whether this was a crit-weighted calculation (always true in deterministic). */
  isCrit: false;
}

/** Result of a deterministic heal calculation. */
export interface HealResult {
  amountHealed: number;
}

// =============================================================================
// CombatUtilities
// =============================================================================

class CombatUtilities {
  // ---------------------------------------------------------------------------
  // getTarget - find the first living enemy
  // ---------------------------------------------------------------------------

  static getTarget(enemies: CombatUnit[] | null): CombatUnit | null {
    if (!enemies) {
      return null;
    }
    const target = enemies.find(
      (enemy) => enemy.combatDetails.currentHitpoints > 0
    );
    return target ?? null;
  }

  // ---------------------------------------------------------------------------
  // randomInt - deterministic replacement: returns (min + max) / 2
  // ---------------------------------------------------------------------------

  /**
   * Deterministic replacement for the stochastic randomInt.
   * Returns the exact expected value of the original distribution.
   */
  static randomInt(min: number, max: number): number {
    return (min + max) / 2;
  }

  // ---------------------------------------------------------------------------
  // processAttack - deterministic expected-value attack
  // ---------------------------------------------------------------------------

  static processAttack(
    source: CombatUnit,
    target: CombatUnit,
    abilityEffect: AbilityEffect | null = null
  ): AttackResult {
    // -----------------------------------------------------------------------
    // 1. Determine combat style & damage type
    // -----------------------------------------------------------------------
    const combatStyle: CombatStyleHrid | string = abilityEffect
      ? abilityEffect.combatStyleHrid
      : source.combatDetails.combatStats.combatStyleHrid;

    const damageType: DamageTypeHrid | string = abilityEffect
      ? abilityEffect.damageType
      : source.combatDetails.combatStats.damageType;

    // -----------------------------------------------------------------------
    // 2. Look up per-style accuracy, max damage, evasion
    // -----------------------------------------------------------------------
    let sourceAccuracyRating = 1;
    let sourceAutoAttackMaxDamage = 1;
    let targetEvasionRating = 1;

    switch (combatStyle) {
      case "/combat_styles/stab":
        sourceAccuracyRating = source.combatDetails.stabAccuracyRating;
        sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;
        targetEvasionRating = target.combatDetails.stabEvasionRating;
        break;
      case "/combat_styles/slash":
        sourceAccuracyRating = source.combatDetails.slashAccuracyRating;
        sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;
        targetEvasionRating = target.combatDetails.slashEvasionRating;
        break;
      case "/combat_styles/smash":
        sourceAccuracyRating = source.combatDetails.smashAccuracyRating;
        sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;
        targetEvasionRating = target.combatDetails.smashEvasionRating;
        break;
      case "/combat_styles/ranged":
        sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;
        sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;
        targetEvasionRating = target.combatDetails.rangedEvasionRating;
        break;
      case "/combat_styles/magic":
        sourceAccuracyRating = source.combatDetails.magicAccuracyRating;
        sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;
        targetEvasionRating = target.combatDetails.magicEvasionRating;
        break;
      default:
        throw new Error("Unknown combat style: " + combatStyle);
    }

    // -----------------------------------------------------------------------
    // 3. Look up per-damage-type amplify, resistance, penetration, thorns
    // -----------------------------------------------------------------------
    let sourceDamageMultiplier = 1;
    let sourceResistance = 0;
    let sourcePenetration = 0;
    let targetResistance = 0;
    let targetThornPower = 0;
    let targetPenetration = 0;
    let thornType: string | undefined;

    switch (damageType) {
      case "/damage_types/physical":
        sourceDamageMultiplier =
          1 + source.combatDetails.combatStats.physicalAmplify;
        sourceResistance = source.combatDetails.totalArmor;
        sourcePenetration =
          source.combatDetails.combatStats.armorPenetration;
        targetResistance = target.combatDetails.totalArmor;
        targetThornPower =
          target.combatDetails.combatStats.physicalThorns;
        targetPenetration =
          target.combatDetails.combatStats.armorPenetration;
        thornType = "physicalThorns";
        break;
      case "/damage_types/water":
        sourceDamageMultiplier =
          1 + source.combatDetails.combatStats.waterAmplify;
        sourceResistance = source.combatDetails.totalWaterResistance;
        sourcePenetration =
          source.combatDetails.combatStats.waterPenetration;
        targetResistance = target.combatDetails.totalWaterResistance;
        targetThornPower =
          target.combatDetails.combatStats.elementalThorns;
        targetPenetration =
          target.combatDetails.combatStats.waterPenetration;
        thornType = "elementalThorns";
        break;
      case "/damage_types/nature":
        sourceDamageMultiplier =
          1 + source.combatDetails.combatStats.natureAmplify;
        sourceResistance = source.combatDetails.totalNatureResistance;
        sourcePenetration =
          source.combatDetails.combatStats.naturePenetration;
        targetResistance = target.combatDetails.totalNatureResistance;
        targetThornPower =
          target.combatDetails.combatStats.elementalThorns;
        targetPenetration =
          target.combatDetails.combatStats.naturePenetration;
        thornType = "elementalThorns";
        break;
      case "/damage_types/fire":
        sourceDamageMultiplier =
          1 + source.combatDetails.combatStats.fireAmplify;
        sourceResistance = source.combatDetails.totalFireResistance;
        sourcePenetration =
          source.combatDetails.combatStats.firePenetration;
        targetResistance = target.combatDetails.totalFireResistance;
        targetThornPower =
          target.combatDetails.combatStats.elementalThorns;
        targetPenetration =
          target.combatDetails.combatStats.firePenetration;
        thornType = "elementalThorns";
        break;
      default:
        throw new Error("Unknown damage type: " + damageType);
    }

    // -----------------------------------------------------------------------
    // 4. Hit chance & crit chance
    // -----------------------------------------------------------------------
    const bonusCritChance = source.combatDetails.combatStats.criticalRate;
    const bonusCritDamage = source.combatDetails.combatStats.criticalDamage;

    if (abilityEffect) {
      sourceAccuracyRating *= 1 + abilityEffect.bonusAccuracyRatio;
    }

    // NOTE: In the original sim, isWeakened/weakenPercentage is set at
    // runtime by the combat loop.  In the deterministic model, weaken is
    // handled via the buff system (negative "/buff_types/damage" ratioBoost)
    // which already affects the source's accuracy/damage ratings through
    // updateCombatDetails().  No separate isWeakened check is needed here.

    const hitChance =
      Math.pow(sourceAccuracyRating, 1.4) /
      (Math.pow(sourceAccuracyRating, 1.4) +
        Math.pow(targetEvasionRating, 1.4));

    let critChance = 0;
    if (combatStyle === "/combat_styles/ranged") {
      critChance = 0.3 * hitChance;
    }
    critChance += bonusCritChance;

    // -----------------------------------------------------------------------
    // 5. Base damage range
    // -----------------------------------------------------------------------
    const baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
    const baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;

    const armorDamageRatioFlat = abilityEffect
      ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor
      : 0;

    const sourceMinDamage =
      sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
    const sourceMaxDamage =
      sourceDamageMultiplier *
      (baseDamageRatio * sourceAutoAttackMaxDamage +
        baseDamageFlat +
        armorDamageRatioFlat);

    // -----------------------------------------------------------------------
    // 6. Expected damage incorporating crit (replaces stochastic crit roll)
    // -----------------------------------------------------------------------
    // Original stochastic logic:
    //   if (random < critChance) { maxDamage *= (1 + critDmg); minDamage = maxDamage; }
    //   damageRoll = randomInt(minDamage, maxDamage)
    //
    // Deterministic expected value:
    //   E[damage] = (1 - critChance) * avgNonCrit + critChance * critDamage
    //   where avgNonCrit = (min + max) / 2
    //         critDamage = max * (1 + bonusCritDamage)

    const avgNonCritDamage = (sourceMinDamage + sourceMaxDamage) / 2;
    const critDamage = sourceMaxDamage * (1 + bonusCritDamage);

    const effectiveCritChance = Math.min(critChance, 1);
    let damageRoll =
      (1 - effectiveCritChance) * avgNonCritDamage +
      effectiveCritChance * critDamage;

    // -----------------------------------------------------------------------
    // 7. Apply damage multipliers (task damage, damage taken, auto/ability)
    // -----------------------------------------------------------------------
    damageRoll *= 1 + source.combatDetails.combatStats.taskDamage;
    damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;

    if (!abilityEffect) {
      damageRoll +=
        damageRoll * source.combatDetails.combatStats.autoAttackDamage;
    } else {
      damageRoll *= 1 + source.combatDetails.combatStats.abilityDamage;
    }

    // Store pre-mitigation damage for pierce chain / retaliation reference
    const expectedPreMitigationDamage = damageRoll;

    // -----------------------------------------------------------------------
    // 8. Parry reduction (deterministic blend replaces stochastic parry roll)
    // -----------------------------------------------------------------------
    // Parry is handled at the simulator level (checkParry swaps source/target).
    // However, we could model a fractional parry reduction here if the caller
    // doesn't handle parry separately.  For now, parry is NOT applied inside
    // processAttack -- the DeterministicSimulator handles it externally, just
    // as the original sim does.  This keeps the function signature compatible.

    // -----------------------------------------------------------------------
    // 9. Resistance mitigation & expected damage done
    // -----------------------------------------------------------------------
    // Instead of branching on hit/miss, we always compute damage and scale
    // the result by hitChance.

    let penetratedTargetResistance = targetResistance;
    if (sourcePenetration > 0 && targetResistance > 0) {
      penetratedTargetResistance = targetResistance / (1 + sourcePenetration);
    }

    let targetDamageTakenRatio =
      100 / (100 + penetratedTargetResistance);
    if (penetratedTargetResistance < 0) {
      targetDamageTakenRatio =
        (100 - penetratedTargetResistance) / 100;
    }

    // Expected damage = hitChance * ceil(mitigated damage)
    // The game applies Math.ceil after mitigation, so we do the same.
    const mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);
    let damageDone = hitChance * mitigatedDamage;

    // No HP clamp here — the simulator clamps at the damage-application point
    // (deterministicSimulator.ts). Clamping here would undercount life steal,
    // mana leech, HP drain, and DoT when expected damage exceeds current HP.
    if (damageDone < 0) damageDone = 0;

    // -----------------------------------------------------------------------
    // 10. Thorns (deterministic)
    // -----------------------------------------------------------------------
    // Thorns trigger regardless of hit/miss in the original.  The damage
    // itself uses randomInt which we replace with the average.
    let thornDamageDone = 0;

    if (targetThornPower > 0.0 && targetResistance > -99.0) {
      let penetratedSourceResistance = sourceResistance;
      if (sourceResistance > 0) {
        penetratedSourceResistance =
          sourceResistance / (1 + targetPenetration);
      }

      let sourceDamageTakenRatio =
        100.0 / (100 + penetratedSourceResistance);
      if (penetratedSourceResistance < 0) {
        sourceDamageTakenRatio =
          (100 - penetratedSourceResistance) / 100;
      }

      const targetTaskDamageMultiplier =
        1.0 + target.combatDetails.combatStats.taskDamage;
      const sourceDamageTakenMultiplier =
        1.0 + source.combatDetails.combatStats.damageTaken;
      const targetDamageMultiplier =
        targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

      const thornMaxDamage =
        targetDamageMultiplier *
        target.combatDetails.defensiveMaxDamage *
        (1.0 + targetResistance / 100.0) *
        targetThornPower;

      // randomInt(1, thornMaxDamage) -> (1 + thornMaxDamage) / 2
      const thornsDamageRoll = CombatUtilities.randomInt(1, thornMaxDamage);
      const mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);

      thornDamageDone = Math.min(
        mitigatedThornsDamage,
        source.combatDetails.currentHitpoints
      );
      if (thornDamageDone < 0) thornDamageDone = 0;
    }

    // -----------------------------------------------------------------------
    // 11. Retaliation (deterministic)
    // -----------------------------------------------------------------------
    let retaliationDamageDone = 0;

    if (target.combatDetails.combatStats.retaliation > 0) {
      const retaliationHitChance =
        Math.pow(target.combatDetails.smashAccuracyRating, 1.4) /
        (Math.pow(target.combatDetails.smashAccuracyRating, 1.4) +
          Math.pow(source.combatDetails.smashEvasionRating, 1.4));

      // In the original, retaliation only fires on hit.  Deterministic:
      // scale by retaliationHitChance.
      let sourceEffectiveArmor = source.combatDetails.totalArmor;
      if (sourceEffectiveArmor > 0) {
        sourceEffectiveArmor =
          sourceEffectiveArmor /
          (1.0 + target.combatDetails.combatStats.armorPenetration);
      }

      let sourceDamageTakenRatioRet =
        100.0 / (100.0 + sourceEffectiveArmor);
      if (sourceEffectiveArmor < 0) {
        sourceDamageTakenRatioRet =
          (100.0 - sourceEffectiveArmor) / 100.0;
      }

      const targetTaskDamageMultiplierRet =
        1.0 + target.combatDetails.combatStats.taskDamage;
      const sourceDamageTakenMultiplierRet =
        1.0 + source.combatDetails.combatStats.damageTaken;
      const retaliationDamageMultiplier =
        targetTaskDamageMultiplierRet * sourceDamageTakenMultiplierRet;

      // premitigatedDamage is the raw damageRoll, capped at defensiveMaxDamage * 5
      let premitigatedDamage = damageRoll;
      premitigatedDamage = Math.min(
        premitigatedDamage,
        target.combatDetails.defensiveMaxDamage * 5
      );

      const retaliationMinDamage =
        retaliationDamageMultiplier *
        target.combatDetails.combatStats.retaliation *
        premitigatedDamage;
      const retaliationMaxDamage =
        retaliationDamageMultiplier *
        target.combatDetails.combatStats.retaliation *
        (target.combatDetails.defensiveMaxDamage + premitigatedDamage);

      // randomInt(min, max) -> (min + max) / 2, then scale by hit chance
      const retaliationDamageRoll = CombatUtilities.randomInt(
        retaliationMinDamage,
        retaliationMaxDamage
      );
      const mitigatedRetaliationDamage =
        sourceDamageTakenRatioRet * retaliationDamageRoll;

      retaliationDamageDone =
        retaliationHitChance *
        Math.min(
          mitigatedRetaliationDamage,
          source.combatDetails.currentHitpoints
        );
      if (retaliationDamageDone < 0) retaliationDamageDone = 0;
    }

    // -----------------------------------------------------------------------
    // 12. Life steal (deterministic)
    // -----------------------------------------------------------------------
    // Original: triggers on hit for auto-attacks only.
    // Deterministic: expectedLifeSteal = hitChance * lifeSteal * damageDone
    // (damageDone already incorporates hitChance, so we use damageDone directly
    //  because damageDone = hitChance * mitigatedDamage, and lifeSteal is
    //  applied to the actual damage dealt.)
    let lifeStealHealed = 0;
    if (
      !abilityEffect &&
      source.combatDetails.combatStats.lifeSteal > 0
    ) {
      lifeStealHealed =
        source.combatDetails.combatStats.lifeSteal * damageDone;
    }

    // -----------------------------------------------------------------------
    // 13. HP drain (ability effect, deterministic)
    // -----------------------------------------------------------------------
    let hpDrained = 0;
    if (abilityEffect && abilityEffect.hpDrainRatio > 0) {
      const healingAmplify =
        1 + source.combatDetails.combatStats.healingAmplify;
      hpDrained = abilityEffect.hpDrainRatio * damageDone * healingAmplify;
    }

    // -----------------------------------------------------------------------
    // 14. Mana leech (deterministic)
    // -----------------------------------------------------------------------
    // Original: triggers on hit for auto-attacks only.
    let manaLeechGained = 0;
    if (
      !abilityEffect &&
      source.combatDetails.combatStats.manaLeech > 0
    ) {
      manaLeechGained =
        source.combatDetails.combatStats.manaLeech * damageDone;
    }

    // -----------------------------------------------------------------------
    // 15. CC procs (expected durations)
    // -----------------------------------------------------------------------
    // In the original, CC procs fire on ability hits with a chance reduced
    // by tenacity: effectiveChance = baseChance * 100 / (100 + tenacity).
    // Deterministic: expectedDuration = hitChance * effectiveChance * duration.
    const targetTenacity = target.combatDetails.combatStats?.tenacity ?? 0;
    const tenacityFactor = 100 / (100 + targetTenacity);

    let expectedStunDuration = 0;
    let expectedBlindDuration = 0;
    let expectedSilenceDuration = 0;
    let effectiveStunChance = 0;
    let effectiveSilenceChance = 0;

    if (abilityEffect) {
      if (abilityEffect.stunChance > 0 && abilityEffect.stunDuration > 0) {
        effectiveStunChance =
          hitChance * abilityEffect.stunChance * tenacityFactor;
        expectedStunDuration =
          effectiveStunChance * abilityEffect.stunDuration;
      }
      if (abilityEffect.blindChance > 0 && abilityEffect.blindDuration > 0) {
        expectedBlindDuration =
          hitChance *
          abilityEffect.blindChance *
          tenacityFactor *
          abilityEffect.blindDuration;
      }
      if (
        abilityEffect.silenceChance > 0 &&
        abilityEffect.silenceDuration > 0
      ) {
        effectiveSilenceChance =
          hitChance * abilityEffect.silenceChance * tenacityFactor;
        expectedSilenceDuration =
          effectiveSilenceChance * abilityEffect.silenceDuration;
      }
    }

    // -----------------------------------------------------------------------
    // 16. Curse (expected damageTaken contribution per attack)
    // -----------------------------------------------------------------------
    // Curse is applied on every hit (auto-attack and ability) if source has
    // curse stat > 0. Unlike stun, blind and silence, it is not reduced by
    // tenacity in the authoritative simulator.
    // Each proc adds +1 to the curse stack counter, and the buff applies
    // source.curse * stackCount as a flatBoost to damageTaken.
    //
    // For deterministic purposes, we return the expected per-hit contribution
    // to the curse damageTaken buff: hitChance * procChance * source.curse.
    let expectedCurseApplied = 0;
    if (source.combatDetails.combatStats.curse > 0) {
      expectedCurseApplied =
        hitChance * source.combatDetails.combatStats.curse;
    }

    // -----------------------------------------------------------------------
    // 17. Weaken (expected per-attack contribution)
    // -----------------------------------------------------------------------
    // Weaken is applied by the *target's* weaken stat against the attacker.
    // In the original, every attack (hit or miss) triggers weaken stack +1.
    // The buff applies -target.weaken * stackCount as ratioBoost to damage.
    //
    // For deterministic: every attack contributes target.weaken to the
    // weaken debuff on the source.  No hit check is required (original
    // code doesn't gate weaken on didHit for auto-attacks; for abilities
    // it also always applies).
    let expectedWeakenApplied = 0;
    if (target.combatDetails.combatStats.weaken > 0) {
      expectedWeakenApplied = target.combatDetails.combatStats.weaken;
    }

    // -----------------------------------------------------------------------
    // 18. Fury (expected per-attack stack change)
    // -----------------------------------------------------------------------
    // Fury: on hit -> stack +1 (max 5), on miss -> stack = floor(stack/2).
    // Each stack gives source.fury as ratio boost to accuracy & damage.
    //
    // For deterministic model, we compute the expected steady-state fury
    // contribution per attack.  The exact steady state for the Markov chain
    // with hitChance p is complex.  We approximate:
    //   E[stack_steady] approx = hitChance * maxStack * furyFraction
    // where furyFraction converges based on hit rate.
    //
    // A simpler and accurate approach: return hitChance * source.fury so the
    // sim can accumulate into a running average.  The sim is responsible for
    // computing the effective steady-state fury stacks.
    let expectedFuryGained = 0;
    if (source.combatDetails.combatStats.fury > 0) {
      expectedFuryGained =
        hitChance * source.combatDetails.combatStats.fury;
    }

    // -----------------------------------------------------------------------
    // 19. Damage over time (DOT)
    // -----------------------------------------------------------------------
    let damageOverTime: AttackResult["damageOverTime"] = null;
    if (
      abilityEffect &&
      abilityEffect.damageOverTimeRatio > 0 &&
      abilityEffect.damageOverTimeDuration > 0
    ) {
      const DOT_TICK_INTERVAL = 3e9; // 3 seconds in nanoseconds
      const totalTicks = abilityEffect.damageOverTimeDuration / DOT_TICK_INTERVAL;
      // DOT damage is based on the actual damage done (post-mitigation),
      // scaled by hitChance (since DOT only applies on hit)
      damageOverTime = {
        damage: damageDone * abilityEffect.damageOverTimeRatio,
        totalTicks,
        combatStyleHrid: abilityEffect.combatStyleHrid as string,
      };
    }

    // -----------------------------------------------------------------------
    // Build and return the result
    // -----------------------------------------------------------------------
    return {
      damageDone,
      hitChance,
      thornDamageDone,
      thornType,
      retaliationDamageDone,
      lifeStealHealed,
      hpDrained,
      manaLeechGained,
      expectedStunDuration,
      expectedBlindDuration,
      expectedSilenceDuration,
      effectiveStunChance,
      effectiveSilenceChance,
      expectedCurseApplied,
      expectedWeakenApplied,
      expectedFuryGained,
      damageOverTime,
      expectedPreMitigationDamage: expectedPreMitigationDamage,
      isCrit: false as const,
    };
  }

  // ---------------------------------------------------------------------------
  // processHeal - deterministic expected-value heal
  // ---------------------------------------------------------------------------

  static processHeal(
    source: CombatUnit,
    abilityEffect: AbilityEffect,
    target: CombatUnit,
    probability: number = 1
  ): number {
    if (abilityEffect.combatStyleHrid !== "/combat_styles/magic") {
      throw new Error(
        "Heal ability effect not supported for combat style: " +
          abilityEffect.combatStyleHrid
      );
    }

    const healingAmplify =
      1 + source.combatDetails.combatStats.healingAmplify;
    const magicMaxDamage = source.combatDetails.magicMaxDamage;

    const baseHealFlat = abilityEffect.damageFlat;
    const baseHealRatio = abilityEffect.damageRatio;

    const minHeal = healingAmplify * (1 + baseHealFlat);
    const maxHeal =
      healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

    // Deterministic: average of min and max.  Proc abilities (Bloom) only
    // occur with `probability`; scale before adding so the target's HP is not
    // accidentally healed by the full amount while only accounting a fraction.
    const heal = CombatUtilities.randomInt(minHeal, maxHeal) * probability;
    const amountHealed = target.addHitpoints(heal);

    return amountHealed;
  }

  // ---------------------------------------------------------------------------
  // processRevive - deterministic expected-value revive
  // ---------------------------------------------------------------------------

  static processRevive(
    source: CombatUnit,
    abilityEffect: AbilityEffect,
    target: CombatUnit
  ): number {
    if (abilityEffect.combatStyleHrid !== "/combat_styles/magic") {
      throw new Error(
        "Heal ability effect not supported for combat style: " +
          abilityEffect.combatStyleHrid
      );
    }

    const healingAmplify =
      1 + source.combatDetails.combatStats.healingAmplify;
    const magicMaxDamage = source.combatDetails.magicMaxDamage;

    const baseHealFlat = abilityEffect.damageFlat;
    const baseHealRatio = abilityEffect.damageRatio;

    const minHeal = healingAmplify * (1 + baseHealFlat);
    const maxHeal =
      healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

    const heal = CombatUtilities.randomInt(minHeal, maxHeal);
    const amountHealed = target.addHitpoints(heal);

    // Revive also restores full mana and clears CCs
    target.combatDetails.currentManapoints =
      target.combatDetails.maxManapoints;
    target.clearCCs();

    return amountHealed;
  }

  // ---------------------------------------------------------------------------
  // processSpendHp - spend a ratio of current HP (unchanged, already deterministic)
  // ---------------------------------------------------------------------------

  static processSpendHp(
    source: CombatUnit,
    abilityEffect: AbilityEffect
  ): number {
    const currentHp = source.combatDetails.currentHitpoints;
    const spendHpRatio = abilityEffect.spendHpRatio;

    const spentHp = Math.floor(currentHp * spendHpRatio);
    source.combatDetails.currentHitpoints -= spentHp;

    return spentHp;
  }

  // ---------------------------------------------------------------------------
  // calculateTickValue - distribute a total value across ticks evenly
  // ---------------------------------------------------------------------------
  // This is already deterministic in the original.

  static calculateTickValue(
    totalValue: number,
    totalTicks: number,
    currentTick: number
  ): number {
    const currentSum = Math.floor(
      (currentTick * totalValue) / totalTicks
    );
    const previousSum = Math.floor(
      ((currentTick - 1) * totalValue) / totalTicks
    );
    return currentSum - previousSum;
  }

  // ---------------------------------------------------------------------------
  // Deterministic helper: expected pierce multiplier
  // ---------------------------------------------------------------------------
  /**
   * Computes the expected number of targets hit by a pierce chain.
   * Pierce chains to the next target with probability `pierceChance` after
   * each hit.  This forms a geometric series:
   *   E[targets] = 1 + p + p^2 + ... = 1 / (1 - p)  (for p < 1)
   *
   * Capped at maxTargets (number of alive enemies).
   *
   * @param pierceChance - The probability of chaining to the next target per hit.
   * @param hitChance - The probability the initial attack hits (pierce only chains on hit).
   * @param maxTargets - Maximum number of targets available.
   * @returns Expected number of total targets hit (including the first).
   */
  static expectedPierceTargets(
    pierceChance: number,
    hitChance: number,
    maxTargets: number
  ): number {
    if (pierceChance <= 0 || hitChance <= 0 || maxTargets <= 1) {
      return 1;
    }
    if (pierceChance >= 1) {
      return maxTargets;
    }

    // Expected targets from geometric series, but capped at maxTargets.
    // E[targets] = sum_{k=0}^{N-1} p^k = (1 - p^N) / (1 - p)
    // where N = maxTargets and p = hitChance * pierceChance
    // (pierce only chains if the attack hit)
    const p = hitChance * pierceChance;
    if (p >= 1) return maxTargets;

    const expectedTargets =
      (1 - Math.pow(p, maxTargets)) / (1 - p);
    return expectedTargets;
  }

  // ---------------------------------------------------------------------------
  // Deterministic helper: expected mayhem multiplier
  // ---------------------------------------------------------------------------
  /**
   * Computes the expected number of targets attempted by Mayhem.  Mayhem is
   * rolled once; on a proc, each miss advances to the next target and a hit
   * ends the chain.
   *
   * @param mayhemChance - The probability of mayhem activating.
   * @param numAliveTargets - Number of alive enemy targets.
   * @returns Expected number of targets attacked.
   */
  static expectedMayhemTargets(
    mayhemChance: number,
    numAliveTargets: number,
    hitChance: number = 0
  ): number {
    if (mayhemChance <= 0 || numAliveTargets <= 1) return 1;

    // Mayhem is a single proc per attack.  It advances only after misses, so
    // retry k is reached with P(mayhem) × P(miss)^k.
    const missChance = Math.max(0, Math.min(1, 1 - hitChance));
    if (missChance === 1) return 1 + mayhemChance * (numAliveTargets - 1);
    return (
      1 +
      mayhemChance *
        (missChance * (1 - Math.pow(missChance, numAliveTargets - 1))) /
          (1 - missChance)
    );
  }

  // ---------------------------------------------------------------------------
  // Deterministic helper: expected parry damage reduction
  // ---------------------------------------------------------------------------
  /**
   * Computes the expected damage multiplier after accounting for parry.
   *
   * In the original sim, parry causes the attack to be redirected: a random
   * unit with parry > 0 intercepts the attack, and the roles are swapped
   * (the parrying unit becomes the "source" attacking the original attacker).
   * This means the original attack effectively does 0 damage to its intended
   * target when parry triggers, and instead the parry unit deals damage to
   * the original attacker.
   *
   * For deterministic modeling, parry is best handled at the simulator level
   * (since it changes both source and target), not inside processAttack.
   * This helper computes the probability that at least one unit parries.
   *
   * @param parryUnits - Array of CombatUnits on the defending side that have parry > 0.
   * @returns The probability that any parry triggers.
   */
  static expectedParryChance(parryUnits: CombatUnit[]): number {
    const aliveParryUnits = parryUnits.filter(
      (u) =>
        u.combatDetails.currentHitpoints > 0 &&
        u.combatDetails.combatStats.parry > 0
    );
    if (aliveParryUnits.length === 0) return 0;

    // In the original, a random parry unit is picked, then checked against
    // its parry chance.  The probability of a parry triggering is:
    // sum over all parry units of (1/N * parryChance_i) = avg(parryChance_i)
    const totalParryChance = aliveParryUnits.reduce(
      (sum, u) => sum + u.combatDetails.combatStats.parry,
      0
    );
    return totalParryChance / aliveParryUnits.length;
  }

  // ---------------------------------------------------------------------------
  // Deterministic helper: compute hit chance independently
  // ---------------------------------------------------------------------------
  /**
   * Compute the hit chance for a given accuracy vs evasion rating.
   * This is extracted as a standalone utility for use by the simulator
   * when it needs hit chance without running a full processAttack.
   */
  static computeHitChance(
    accuracyRating: number,
    evasionRating: number
  ): number {
    return (
      Math.pow(accuracyRating, 1.4) /
      (Math.pow(accuracyRating, 1.4) + Math.pow(evasionRating, 1.4))
    );
  }
}

export default CombatUtilities;
