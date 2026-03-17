// =============================================================================
// CooldownReadyEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/cooldownReadyEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class CooldownReadyEvent extends CombatEvent {
  static readonly type = CombatEventType.CooldownReady;

  constructor(time: number) {
    super(CooldownReadyEvent.type, time);
  }
}
