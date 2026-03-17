// =============================================================================
// CheckBuffExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/checkBuffExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class CheckBuffExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.CheckBuffExpiration;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(CheckBuffExpirationEvent.type, time);
    this.source = source;
  }
}
