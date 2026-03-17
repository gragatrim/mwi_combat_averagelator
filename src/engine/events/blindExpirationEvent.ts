// =============================================================================
// BlindExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/blindExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class BlindExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.BlindExpiration;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(BlindExpirationEvent.type, time);
    this.source = source;
  }
}
