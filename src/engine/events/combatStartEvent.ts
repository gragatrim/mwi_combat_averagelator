// =============================================================================
// CombatStartEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/combatStartEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class CombatStartEvent extends CombatEvent {
  static readonly type = CombatEventType.CombatStart;

  constructor(time: number) {
    super(CombatStartEvent.type, time);
  }
}
