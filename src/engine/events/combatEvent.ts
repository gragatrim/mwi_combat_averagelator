// =============================================================================
// CombatEvent base class and CombatEventType enum
// =============================================================================

/**
 * Discriminated union tag for all combat event types.
 * String values match the original JS static `type` properties exactly.
 */
export enum CombatEventType {
  AutoAttack = "autoAttack",
  AbilityCastEnd = "abilityCastEndEvent",
  RegenTick = "regenTick",
  ConsumableTick = "consumableTick",
  DamageOverTime = "damageOverTime",
  StunExpiration = "stunExpiration",
  BlindExpiration = "blindExpiration",
  SilenceExpiration = "silenceExpiration",
  CurseExpiration = "curseExpiration",
  WeakenExpiration = "weakenExpiration",
  FuryExpiration = "furyExpiration",
  EnrageTick = "enrageTick",
  EnemyRespawn = "enemyRespawn",
  PlayerRespawn = "playerRespawn",
  CombatStart = "combatStart",
  CooldownReady = "cooldownReady",
  AwaitCooldown = "awaitCooldownEvent",
  CheckBuffExpiration = "checkBuffExpiration",
}

/**
 * Base class for every event that flows through the EventQueue.
 *
 * `time` is in **nanoseconds** (bigint-safe integers stored as `number`).
 * Subclasses add domain-specific fields (source, target, etc.).
 */
export class CombatEvent {
  public readonly type: CombatEventType;
  public time: number;

  constructor(type: CombatEventType, time: number) {
    this.type = type;
    this.time = time;
  }
}
