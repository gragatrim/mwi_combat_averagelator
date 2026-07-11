// =============================================================================
// Equipment - A single equipped item with enhancement-level stat lookups
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/equipment.js
// All logic preserved exactly; typed with interfaces from types.ts.
// Data imports replaced with GameData dependency injection.

import type { GameData, ItemData, EquipmentDTO, CombatStyleHrid, DamageTypeHrid } from "./types";

class Equipment {
  hrid: string;
  gameItem: ItemData;
  enhancementLevel: number;

  private gameData: GameData;

  constructor(gameData: GameData, hrid: string, enhancementLevel: number) {
    this.gameData = gameData;
    this.hrid = hrid;

    const gameItem = gameData.itemDetailMap[this.hrid];
    if (!gameItem) {
      throw new Error("No equipment found for hrid: " + this.hrid);
    }
    this.gameItem = gameItem;
    this.enhancementLevel = enhancementLevel;
  }

  static createFromDTO(gameData: GameData, dto: EquipmentDTO): Equipment {
    const equipment = new Equipment(gameData, dto.hrid, dto.enhancementLevel);
    return equipment;
  }

  getCombatStat(combatStat: string): number {
    const multiplier =
      this.gameData.enhancementLevelTotalBonusMultiplierTable[this.enhancementLevel];

    const combatStats = this.gameItem.equipmentDetail!.combatStats;
    const statValue = combatStats[combatStat];

    if (statValue) {
      const enhancementBonuses = this.gameItem.equipmentDetail!.combatEnhancementBonuses;
      const enhancementBonus = enhancementBonuses[combatStat] || 0;
      const stat = (statValue as number) + multiplier * enhancementBonus;
      return stat;
    }
    return 0;
  }

  getCombatStyle(): CombatStyleHrid | string {
    return this.gameItem.equipmentDetail!.combatStats.combatStyleHrids![0];
  }

  getDamageType(): DamageTypeHrid | string {
    return this.gameItem.equipmentDetail!.combatStats.damageType!;
  }

  getPrimaryTraining(): string {
    return this.gameItem.equipmentDetail!.combatStats.primaryTraining!;
  }

  getFocusTraining(): string {
    // Current item data may omit focusTraining. Such items do not select a
    // focus-training skill.
    return this.gameItem.equipmentDetail?.combatStats.focusTraining ?? "";
  }
}

export default Equipment;
