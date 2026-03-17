// =============================================================================
// Monster - Monster combat unit with difficulty tier and labyrinth scaling
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/monster.js
// All logic preserved exactly; typed with interfaces from types.ts.
// Data imports replaced with dependency injection via GameData parameter.

import CombatUnit, { type DropEntry } from "./combatUnit";
import type { GameData, MonsterData, MonsterAbilityRef } from "./types";
import {
  MONSTER_LEVEL_MULTIPLIER_PER_TIER,
  MONSTER_DEF_LEVEL_MULTIPLIER_PER_TIER,
  MONSTER_LEVEL_BONUS_PER_TIER,
  MONSTER_EXP_MULTIPLIER_PER_TIER,
  MONSTER_EXP_BONUS_PER_TIER,
  MONSTER_COMBAT_STAT_KEYS,
} from "./constants";

import type Ability from "./ability";

// -----------------------------------------------------------------------------
// Monster
// -----------------------------------------------------------------------------

class Monster extends CombatUnit {
  difficultyTier: number = 0;
  labyrinthTargetLevel: number | null = null;

  /** Reference to game data for updateCombatDetails lookups. */
  private gameData: GameData;
  /** The raw monster definition from combatMonsterDetailMap. */
  private gameMonster: MonsterData;

  /**
   * @param hrid - Monster hrid (e.g. "/monsters/cow")
   * @param gameData - Full game data (dependency injection replaces JSON import)
   * @param difficultyTier - Difficulty tier (0-5 typically)
   * @param deps.Ability - Ability constructor/factory for creating monster abilities
   */
  constructor(
    hrid: string,
    gameData: GameData,
    difficultyTier: number = 0,
    deps: {
      Ability: new (
        hrid: string,
        gameData: GameData,
        level?: number,
        triggers?: any[] | null
      ) => Ability;
    }
  ) {
    super();

    this.isPlayer = false;
    this.hrid = hrid;
    this.difficultyTier = difficultyTier;
    this.gameData = gameData;

    const gameMonster = gameData.combatMonsterDetailMap[this.hrid];
    if (!gameMonster) {
      throw new Error("No monster found for hrid: " + this.hrid);
    }
    this.gameMonster = gameMonster;

    this.enrageTime = gameMonster.enrageTime;

    // Initialize abilities (filtered by difficulty tier)
    for (let i = 0; i < gameMonster.abilities.length; i++) {
      if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {
        continue;
      }
      this.abilities[i] = new deps.Ability(
        gameMonster.abilities[i].abilityHrid,
        gameData,
        gameMonster.abilities[i].level
      );
    }

    // Drop table
    if (gameMonster.dropTable) {
      for (let i = 0; i < gameMonster.dropTable.length; i++) {
        const dt = gameMonster.dropTable[i];
        this.dropTable[i] = {
          itemHrid: dt.itemHrid,
          dropRate: dt.dropRate,
          minCount: dt.minCount,
          maxCount: dt.maxCount,
          difficultyTier: dt.difficultyTier,
        };
      }
    }

    // Rare drop table
    for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
      const dropTableItem =
        gameMonster.dropTable && i < gameMonster.dropTable.length
          ? gameMonster.dropTable[i]
          : null;
      const rareDifficultyTier =
        dropTableItem?.difficultyTier ??
        gameMonster.rareDropTable[i].minDifficultyTier;

      this.rareDropTable[i] = {
        itemHrid: gameMonster.rareDropTable[i].itemHrid,
        dropRate: gameMonster.rareDropTable[i].dropRate,
        minCount: gameMonster.rareDropTable[i].minCount,
        maxCount: gameMonster.rareDropTable[i].maxCount,
        difficultyTier: rareDifficultyTier,
      };
    }
  }

  /**
   * Set the labyrinth target level for proportional scaling.
   */
  setLabyrinthTargetLevel(targetLevel: number): void {
    this.labyrinthTargetLevel = targetLevel;
  }

  // ---------------------------------------------------------------------------
  // updateCombatDetails - Monster override
  // ---------------------------------------------------------------------------

  override updateCombatDetails(): void {
    const gameMonster = this.gameMonster;

    // Check if this is a labyrinth-scaled monster
    if (this.labyrinthTargetLevel !== null) {
      // Labyrinth scaling: game uses labyrinthLevel / 100 as scale factor
      const scaleFactor = this.labyrinthTargetLevel / 100;

      this.staminaLevel =
        scaleFactor * gameMonster.combatDetails.staminaLevel;
      this.intelligenceLevel =
        scaleFactor * gameMonster.combatDetails.intelligenceLevel;
      this.attackLevel =
        scaleFactor * gameMonster.combatDetails.attackLevel;
      this.meleeLevel =
        scaleFactor * gameMonster.combatDetails.meleeLevel;
      this.defenseLevel =
        scaleFactor * gameMonster.combatDetails.defenseLevel;
      this.rangedLevel =
        scaleFactor * gameMonster.combatDetails.rangedLevel;
      this.magicLevel =
        scaleFactor * gameMonster.combatDetails.magicLevel;

      // Scale ability levels for labyrinth
      const abilityScaleFactor = this.labyrinthTargetLevel / 100;
      for (let i = 0; i < this.abilities.length; i++) {
        if (this.abilities[i]) {
          this.abilities[i]!.level = Math.floor(
            abilityScaleFactor * gameMonster.abilities[i].level
          );
          this.abilities[i]!.rebuildEffects();
        }
      }
    } else {
      // Standard difficulty tier scaling
      const levelMultiplier =
        1.0 + MONSTER_LEVEL_MULTIPLIER_PER_TIER * this.difficultyTier;
      const defLevelMultiplier =
        1.0 + MONSTER_DEF_LEVEL_MULTIPLIER_PER_TIER * this.difficultyTier;
      const levelBonus =
        MONSTER_LEVEL_BONUS_PER_TIER * this.difficultyTier;

      this.staminaLevel =
        levelMultiplier *
        (gameMonster.combatDetails.staminaLevel + levelBonus);
      this.intelligenceLevel =
        levelMultiplier *
        (gameMonster.combatDetails.intelligenceLevel + levelBonus);
      this.attackLevel =
        levelMultiplier *
        (gameMonster.combatDetails.attackLevel + levelBonus);
      this.meleeLevel =
        levelMultiplier *
        (gameMonster.combatDetails.meleeLevel + levelBonus);
      this.defenseLevel =
        defLevelMultiplier *
        (gameMonster.combatDetails.defenseLevel + levelBonus);
      this.rangedLevel =
        levelMultiplier *
        (gameMonster.combatDetails.rangedLevel + levelBonus);
      this.magicLevel =
        levelMultiplier *
        (gameMonster.combatDetails.magicLevel + levelBonus);
    }

    // Experience scaling (always uses standard difficulty tier formula)
    const expMultiplier =
      1.0 + MONSTER_EXP_MULTIPLIER_PER_TIER * this.difficultyTier;
    const expBonus =
      MONSTER_EXP_BONUS_PER_TIER * this.difficultyTier;
    this.experience = expMultiplier * (gameMonster.experience + expBonus);

    // Combat style from game data (first entry in array)
    this.combatDetails.combatStats.combatStyleHrid =
      gameMonster.combatDetails.combatStats.combatStyleHrids[0];

    // Copy all combat stats from game data
    for (const [key, value] of Object.entries(
      gameMonster.combatDetails.combatStats
    )) {
      (this.combatDetails.combatStats as any)[key] = value;
    }

    // Default any missing numeric combat stats to 0
    for (const stat of MONSTER_COMBAT_STAT_KEYS) {
      if (
        (gameMonster.combatDetails.combatStats as any)[stat] == null
      ) {
        (this.combatDetails.combatStats as any)[stat] = 0;
      }
    }

    // Labyrinth scaling: flat additive combat stats (armor, resistances, flat HP/MP)
    // must also be scaled. Ratio-based stats (accuracy, damage, evasion, maxHitpointsRatio)
    // are already amplified by the scaled levels and do NOT need separate scaling.
    if (this.labyrinthTargetLevel !== null) {
      const scaleFactor = this.labyrinthTargetLevel / 100;
      this.combatDetails.combatStats.armor *= scaleFactor;
      this.combatDetails.combatStats.waterResistance *= scaleFactor;
      this.combatDetails.combatStats.natureResistance *= scaleFactor;
      this.combatDetails.combatStats.fireResistance *= scaleFactor;
      this.combatDetails.combatStats.maxHitpoints *= scaleFactor;
      this.combatDetails.combatStats.maxManapoints *= scaleFactor;
    }

    // If attackInterval is 0 in combatStats, use the top-level attackInterval
    if (this.combatDetails.combatStats.attackInterval === 0) {
      this.combatDetails.combatStats.attackInterval =
        gameMonster.combatDetails.attackInterval;
    }

    // Delegate to base class for buff aggregation, derived ratings, etc.
    super.updateCombatDetails();
  }
}

export default Monster;
