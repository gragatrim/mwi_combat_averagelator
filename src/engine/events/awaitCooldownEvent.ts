// =============================================================================
// AwaitCooldownEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/awaitCooldownEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class AwaitCooldownEvent extends CombatEvent {
  static readonly type = CombatEventType.AwaitCooldown;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(AwaitCooldownEvent.type, time);
    this.source = source;
  }
}
