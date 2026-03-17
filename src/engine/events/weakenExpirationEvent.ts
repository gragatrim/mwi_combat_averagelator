// =============================================================================
// WeakenExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/weakenExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class WeakenExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.WeakenExpiration;
  static readonly maxWeakenStacks = 5;

  public readonly weakenAmount: number;
  public readonly source: CombatUnit;

  constructor(time: number, weakenAmount: number, source: CombatUnit) {
    super(WeakenExpirationEvent.type, time);
    this.weakenAmount = Math.min(
      weakenAmount + 1,
      WeakenExpirationEvent.maxWeakenStacks
    );
    this.source = source;
  }
}
