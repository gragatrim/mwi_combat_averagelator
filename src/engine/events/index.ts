// =============================================================================
// Barrel export for all combat events
// =============================================================================

// Base class and enum (defined in separate file to avoid circular deps)
export { CombatEvent, CombatEventType } from "./combatEvent";

// Re-export every concrete event for convenience
export { AutoAttackEvent } from "./autoAttackEvent";
export { AbilityCastEndEvent } from "./abilityCastEndEvent";
export { RegenTickEvent } from "./regenTickEvent";
export { ConsumableTickEvent } from "./consumableTickEvent";
export { DamageOverTimeEvent } from "./damageOverTimeEvent";
export { StunExpirationEvent } from "./stunExpirationEvent";
export { BlindExpirationEvent } from "./blindExpirationEvent";
export { SilenceExpirationEvent } from "./silenceExpirationEvent";
export { CurseExpirationEvent } from "./curseExpirationEvent";
export { WeakenExpirationEvent } from "./weakenExpirationEvent";
export { FuryExpirationEvent } from "./furyExpirationEvent";
export { EnrageTickEvent } from "./enrageTickEvent";
export { EnemyRespawnEvent } from "./enemyRespawnEvent";
export { PlayerRespawnEvent } from "./playerRespawnEvent";
export { CombatStartEvent } from "./combatStartEvent";
export { CooldownReadyEvent } from "./cooldownReadyEvent";
export { AwaitCooldownEvent } from "./awaitCooldownEvent";
export { CheckBuffExpirationEvent } from "./checkBuffExpirationEvent";
