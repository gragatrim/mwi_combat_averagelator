// =============================================================================
// Player - Player combat unit with equipment, house rooms, and achievements
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/player.js
// All logic preserved exactly; typed with interfaces from types.ts.
// Data imports replaced with dependency injection via GameData parameter.

import CombatUnit from "./combatUnit";
import type {
  PlayerConfig,
  GameData,
  EquipmentSlotHrid,
  BuffData,
  HouseRoomData,
  AchievementData,
} from "./types";
import {
  EQUIPMENT_SLOTS,
  EQUIPMENT_COMBAT_STAT_KEYS,
  DEFAULT_COMBAT_STYLE_HRID,
  DEFAULT_DAMAGE_TYPE_HRID,
  DEFAULT_ATTACK_INTERVAL,
  DEFAULT_PRIMARY_TRAINING,
} from "./constants";

import type Ability from "./ability";
import type Consumable from "./consumable";
import type Equipment from "./equipment";
import Buff from "./buff";

// -----------------------------------------------------------------------------
// Player
// -----------------------------------------------------------------------------

class Player extends CombatUnit {
  /** Per-player wisdom buff bonus (MooPass + community + seal wisdom). Set before sim. */
  wisdomBuffBonus: number = 0;
  /** Per-player additional XP multiplier. Set before sim. */
  additionalXpMultiplier: number = 1.0;

  override equipment: Record<EquipmentSlotHrid | string, Equipment | null> = {
    "/equipment_types/head": null,
    "/equipment_types/body": null,
    "/equipment_types/legs": null,
    "/equipment_types/feet": null,
    "/equipment_types/hands": null,
    "/equipment_types/main_hand": null,
    "/equipment_types/two_hand": null,
    "/equipment_types/off_hand": null,
    "/equipment_types/pouch": null,
    "/equipment_types/back": null,
  };

  constructor() {
    super();
    this.isPlayer = true;
    this.hrid = "player";
  }

  /**
   * Factory method: creates a Player from a PlayerConfig DTO.
   *
   * Because the original JS imports game data JSON at module scope, we use
   * dependency injection here: `gameData` provides all lookup maps, and the
   * Equipment / Ability / Consumable classes are passed in to avoid circular
   * imports and keep the data layer swappable.
   */
  static createFromDTO(
    dto: PlayerConfig,
    gameData: GameData,
    deps: {
      Equipment: {
        createFromDTO: (
          equipDto: { hrid: string; enhancementLevel: number },
          gameData: GameData
        ) => Equipment;
      };
      Consumable: {
        createFromDTO: (
          consumDto: { hrid: string; triggers: any[] },
          gameData: GameData
        ) => Consumable;
      };
      Ability: {
        createFromDTO: (
          abilDto: { hrid: string; level: number; triggers: any[] },
          gameData: GameData
        ) => Ability;
      };
    }
  ): Player {
    const player = new Player();

    player.staminaLevel = dto.staminaLevel;
    player.intelligenceLevel = dto.intelligenceLevel;
    player.attackLevel = dto.attackLevel;
    player.meleeLevel = dto.meleeLevel;
    player.defenseLevel = dto.defenseLevel;
    player.rangedLevel = dto.rangedLevel;
    player.magicLevel = dto.magicLevel;

    player.hrid = dto.hrid;

    // Equipment
    for (const [key, value] of Object.entries(dto.equipment)) {
      player.equipment[key] = value
        ? deps.Equipment.createFromDTO(value, gameData)
        : null;
    }

    // Consumables
    player.food = dto.food.map((food) =>
      food ? deps.Consumable.createFromDTO(food, gameData) : null
    );
    player.drinks = dto.drinks.map((drink) =>
      drink ? deps.Consumable.createFromDTO(drink, gameData) : null
    );

    // Abilities (regular + special)
    player.abilities = dto.abilities.map((ability) =>
      ability ? deps.Ability.createFromDTO(ability, gameData) : null
    );
    if (dto.specialAbility) {
      player.abilities.push(
        deps.Ability.createFromDTO(dto.specialAbility, gameData)
      );
    }

    // House rooms: iterate entries, create buff lists from game data
    Object.entries(dto.houseRooms).forEach(([hrid, level]) => {
      if (level > 0) {
        const gameHouseRoom: HouseRoomData | undefined =
          gameData.houseRoomDetailMap[hrid];
        if (!gameHouseRoom) {
          throw new Error("No house room found for hrid: " + hrid);
        }
        const buffs: Buff[] = [];
        if (gameHouseRoom.actionBuffs) {
          for (const actionBuff of gameHouseRoom.actionBuffs) {
            buffs.push(new Buff(actionBuff, level));
          }
        }
        if (gameHouseRoom.globalBuffs) {
          for (const globalBuff of gameHouseRoom.globalBuffs) {
            buffs.push(new Buff(globalBuff, level));
          }
        }
        player.houseRooms.push({ hrid, level, buffs });
      }
    });

    // Achievements: determine which tier buffs have been fully earned
    const achievementBuffs: Buff[] = [];
    for (const tier of Object.values(
      gameData.achievementTierDetailMap as Record<
        string,
        { hrid: string; buff: BuffData }
      >
    )) {
      let isGetAll = true;
      const detailMap = Object.values(gameData.achievementDetailMap).filter(
        (detail: AchievementData) => detail.tierHrid === tier.hrid
      );
      for (const achievement of detailMap) {
        if (
          !dto.achievements[achievement.hrid] ||
          dto.achievements[achievement.hrid] === 0
        ) {
          isGetAll = false;
          break;
        }
      }
      if (isGetAll) {
        achievementBuffs.push(new Buff(tier.buff));
      }
    }
    player.achievements = { buffs: achievementBuffs };

    player.debuffOnLevelGap = dto.debuffOnLevelGap;

    return player;
  }

  // ---------------------------------------------------------------------------
  // updateCombatDetails - Player override
  // ---------------------------------------------------------------------------

  override updateCombatDetails(): void {
    // Determine weapon stats from main_hand or two_hand or defaults
    if (this.equipment["/equipment_types/main_hand"]) {
      const weapon = this.equipment["/equipment_types/main_hand"]!;
      this.combatDetails.combatStats.combatStyleHrid = weapon.getCombatStyle();
      this.combatDetails.combatStats.damageType = weapon.getDamageType();
      this.combatDetails.combatStats.attackInterval =
        weapon.getCombatStat("attackInterval");
      this.combatDetails.combatStats.primaryTraining =
        weapon.getPrimaryTraining();
    } else if (this.equipment["/equipment_types/two_hand"]) {
      const weapon = this.equipment["/equipment_types/two_hand"]!;
      this.combatDetails.combatStats.combatStyleHrid = weapon.getCombatStyle();
      this.combatDetails.combatStats.damageType = weapon.getDamageType();
      this.combatDetails.combatStats.attackInterval =
        weapon.getCombatStat("attackInterval");
      this.combatDetails.combatStats.primaryTraining =
        weapon.getPrimaryTraining();
    } else {
      this.combatDetails.combatStats.combatStyleHrid =
        DEFAULT_COMBAT_STYLE_HRID;
      this.combatDetails.combatStats.damageType = DEFAULT_DAMAGE_TYPE_HRID;
      this.combatDetails.combatStats.attackInterval = DEFAULT_ATTACK_INTERVAL;
      this.combatDetails.combatStats.primaryTraining = DEFAULT_PRIMARY_TRAINING;
    }

    // Focus training from charm
    if (this.equipment["/equipment_types/charm" as EquipmentSlotHrid]) {
      this.combatDetails.combatStats.focusTraining =
        this.equipment["/equipment_types/charm" as EquipmentSlotHrid]!.getFocusTraining();
    } else {
      this.combatDetails.combatStats.focusTraining = "";
    }

    // Aggregate all combat stats from all equipped items
    for (const stat of EQUIPMENT_COMBAT_STAT_KEYS) {
      (this.combatDetails.combatStats as any)[stat] = Object.values(
        this.equipment
      )
        .filter((equipment): equipment is Equipment => equipment != null)
        .map((equipment) => equipment.getCombatStat(stat))
        .reduce((prev, cur) => prev + cur, 0);
    }

    // Food / drink slots from pouch
    if (this.equipment["/equipment_types/pouch"]) {
      this.combatDetails.combatStats.foodSlots =
        1 +
        this.equipment["/equipment_types/pouch"]!.getCombatStat("foodSlots");
      this.combatDetails.combatStats.drinkSlots =
        1 +
        this.equipment["/equipment_types/pouch"]!.getCombatStat("drinkSlots");
    } else {
      this.combatDetails.combatStats.foodSlots = 1;
      this.combatDetails.combatStats.drinkSlots = 1;
    }

    // Delegate to base class for buff aggregation, derived ratings, etc.
    super.updateCombatDetails();
  }
}

export default Player;
