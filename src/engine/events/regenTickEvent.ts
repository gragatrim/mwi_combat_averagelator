// =============================================================================
// RegenTickEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/regenTickEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class RegenTickEvent extends CombatEvent {
  static readonly type = CombatEventType.RegenTick;

  constructor(time: number) {
    super(RegenTickEvent.type, time);
  }
}
