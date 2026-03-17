// =============================================================================
// EnemyRespawnEvent
// Ported from MWICombatSimulatorTest/src/combatsimulator/events/enemyRespawnEvent.js
// =============================================================================

import { CombatEvent, CombatEventType } from "./combatEvent";

export class EnemyRespawnEvent extends CombatEvent {
  static readonly type = CombatEventType.EnemyRespawn;

  constructor(time: number) {
    super(EnemyRespawnEvent.type, time);
  }
}
