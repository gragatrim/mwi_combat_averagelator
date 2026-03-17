// =============================================================================
// StunExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/stunExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class StunExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.StunExpiration;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(StunExpirationEvent.type, time);
    this.source = source;
  }
}
