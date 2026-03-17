// =============================================================================
// PlayerRespawnEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/playerRespawnEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class PlayerRespawnEvent extends CombatEvent {
  static readonly type = CombatEventType.PlayerRespawn;

  public readonly hrid: string;

  constructor(time: number, hrid: string) {
    super(PlayerRespawnEvent.type, time);
    this.hrid = hrid;
  }
}
