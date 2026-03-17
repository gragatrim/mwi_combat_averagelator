// =============================================================================
// SilenceExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/silenceExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class SilenceExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.SilenceExpiration;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(SilenceExpirationEvent.type, time);
    this.source = source;
  }
}
