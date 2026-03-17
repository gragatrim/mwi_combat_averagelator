// =============================================================================
// ConsumableTickEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/consumableTickEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit and Consumable types will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consumable = any;

export class ConsumableTickEvent extends CombatEvent {
  static readonly type = CombatEventType.ConsumableTick;

  public readonly source: CombatUnit;
  public readonly consumable: Consumable;
  public readonly totalTicks: number;
  public readonly currentTick: number;

  constructor(
    time: number,
    source: CombatUnit,
    consumable: Consumable,
    totalTicks: number,
    currentTick: number
  ) {
    super(ConsumableTickEvent.type, time);
    this.source = source;
    this.consumable = consumable;
    this.totalTicks = totalTicks;
    this.currentTick = currentTick;
  }
}
