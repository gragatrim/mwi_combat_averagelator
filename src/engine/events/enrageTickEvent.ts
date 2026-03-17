// =============================================================================
// EnrageTickEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/enrageTickEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class EnrageTickEvent extends CombatEvent {
  static readonly type = CombatEventType.EnrageTick;

  public readonly encounterTime: number;

  constructor(time: number, encounterTime: number) {
    super(EnrageTickEvent.type, time);
    this.encounterTime = encounterTime;
  }
}
