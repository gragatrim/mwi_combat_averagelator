// =============================================================================
// CurseExpirationEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/curseExpirationEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

// CombatUnit type will be replaced once types.ts is finalized
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CombatUnit = any;

export class CurseExpirationEvent extends CombatEvent {
  static readonly type = CombatEventType.CurseExpiration;
  static readonly maxCurseStacks = 5;

  public readonly curseAmount: number;
  public readonly source: CombatUnit;

  constructor(time: number, curseAmount: number, source: CombatUnit) {
    super(CurseExpirationEvent.type, time);
    this.curseAmount = Math.min(
      curseAmount,
      CurseExpirationEvent.maxCurseStacks
    );
    this.source = source;
  }
}
