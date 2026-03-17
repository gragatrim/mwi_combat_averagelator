// =============================================================================
// AbilityCastEndEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/abilityCastEndEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit and Ability types will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ability = any;

export class AbilityCastEndEvent extends CombatEvent {
  static readonly type = CombatEventType.AbilityCastEnd;

  public readonly source: CombatUnit;
  public readonly ability: Ability;

  constructor(time: number, source: CombatUnit, ability: Ability) {
    super(AbilityCastEndEvent.type, time);
    this.source = source;
    this.ability = ability;
  }
}
