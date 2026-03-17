// =============================================================================
// DamageOverTimeEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/damageOverTimeEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class DamageOverTimeEvent extends CombatEvent {
  static readonly type = CombatEventType.DamageOverTime;

  // Calling it 'sourceRef' (not 'source') so that clearEventsForUnit does NOT
  // cancel Damage-Over-Time ticks when the original caster dies.
  public readonly sourceRef: CombatUnit;
  public readonly target: CombatUnit;
  public readonly damage: number;
  public readonly totalTicks: number;
  public readonly currentTick: number;
  public readonly combatStyleHrid: string;

  constructor(
    time: number,
    sourceRef: CombatUnit,
    target: CombatUnit,
    damage: number,
    totalTicks: number,
    currentTick: number,
    combatStyleHrid: string
  ) {
    super(DamageOverTimeEvent.type, time);
    this.sourceRef = sourceRef;
    this.target = target;
    this.damage = damage;
    this.totalTicks = totalTicks;
    this.currentTick = currentTick;
    this.combatStyleHrid = combatStyleHrid;
  }
}
