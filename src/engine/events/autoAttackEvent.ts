// =============================================================================
// AutoAttackEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/autoAttackEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class AutoAttackEvent extends CombatEvent {
  static readonly type = CombatEventType.AutoAttack;

  public readonly source: CombatUnit;

  constructor(time: number, source: CombatUnit) {
    super(AutoAttackEvent.type, time);
    this.source = source;
  }
}
