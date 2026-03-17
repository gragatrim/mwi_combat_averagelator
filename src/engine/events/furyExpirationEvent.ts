// =============================================================================
// FuryExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/furyExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class FuryExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.FuryExpiration;

  public readonly furyAmount: number;
  public readonly source: CombatUnit;

  constructor(time: number, furyAmount: number, source: CombatUnit) {
    super(FuryExpirationEvent.type, time);
    this.furyAmount = furyAmount;
    this.source = source;
  }
}
