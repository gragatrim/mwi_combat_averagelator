// =============================================================================
// Consumable - A food or drink item with cooldown, restore, buffs, and triggers
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/consumable.js
// All logic preserved exactly; typed with interfaces from types.ts.
// Data imports replaced with GameData dependency injection.

import Buff from "./buff";
import Trigger, { type TriggerCombatUnit } from "./trigger";
import type { GameData, ConsumableDTO, TriggerData } from "./types";

class Consumable {
  hrid: string;
  cooldownDuration: number;
  hitpointRestore: number;
  manapointRestore: number;
  recoveryDuration: number;
  catagoryHrid: string;
  buffs: Buff[];
  triggers: Trigger[];
  lastUsed: number;

  private gameData: GameData;

  constructor(gameData: GameData, hrid: string, triggers: Trigger[] | null = null) {
    this.gameData = gameData;
    this.hrid = hrid;

    const gameConsumable = gameData.itemDetailMap[this.hrid];
    if (!gameConsumable) {
      throw new Error("No consumable found for hrid: " + this.hrid);
    }

    const detail = gameConsumable.consumableDetail!;

    this.cooldownDuration = detail.cooldownDuration;
    this.hitpointRestore = detail.hitpointRestore;
    this.manapointRestore = detail.manapointRestore;
    this.recoveryDuration = detail.recoveryDuration;
    this.catagoryHrid = gameConsumable.categoryHrid;

    this.buffs = [];
    if (detail.buffs) {
      for (const consumableBuff of detail.buffs) {
        const buff = new Buff(consumableBuff);
        this.buffs.push(buff);
      }
    }

    if (triggers) {
      this.triggers = triggers;
    } else {
      this.triggers = [];
      if (detail.defaultCombatTriggers) {
        for (const defaultTrigger of detail.defaultCombatTriggers) {
          const trigger = new Trigger(
            gameData,
            defaultTrigger.dependencyHrid,
            defaultTrigger.conditionHrid,
            defaultTrigger.comparatorHrid,
            defaultTrigger.value
          );
          this.triggers.push(trigger);
        }
      }
    }

    this.lastUsed = Number.MIN_SAFE_INTEGER;
  }

  static createFromDTO(gameData: GameData, dto: ConsumableDTO): Consumable {
    const triggers = dto.triggers.map((trigger: TriggerData) =>
      Trigger.createFromDTO(gameData, trigger)
    );
    const consumable = new Consumable(gameData, dto.hrid, triggers);
    return consumable;
  }

  shouldTrigger(
    currentTime: number,
    source: TriggerCombatUnit,
    target: TriggerCombatUnit | null,
    friendlies: TriggerCombatUnit[],
    enemies: TriggerCombatUnit[]
  ): boolean {
    if (source.isStunned) {
      return false;
    }

    let consumableHaste: number;
    if (this.catagoryHrid.includes("food")) {
      consumableHaste = source.combatDetails.combatStats.foodHaste;
    } else {
      consumableHaste = source.combatDetails.combatStats.drinkConcentration;
    }

    let cooldownDuration = this.cooldownDuration;
    if (consumableHaste > 0) {
      cooldownDuration = cooldownDuration / (1 + consumableHaste);
    }

    if (this.lastUsed + cooldownDuration > currentTime) {
      return false;
    }

    if (this.triggers.length === 0) {
      return true;
    }

    let shouldTrigger = true;
    for (const trigger of this.triggers) {
      if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
        shouldTrigger = false;
      }
    }

    return shouldTrigger;
  }
}

export default Consumable;
