// Vitest test: the labyrinth optimizer's ability candidate pool.
// Usage: npx vitest run test_labyrinth_ability_pool.test.ts

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type { GameData } from "./src/engine/types";
import {
  isAbilityCompatible,
  isAbilityUsableSolo,
} from "./src/optimizer/labyrinthOptimizer";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

/** Every combat style / damage type pairing the optimizer can hand a weapon. */
const STYLE_DAMAGE_PAIRS: [string | null, string | null][] = [
  ["/combat_styles/stab", "/damage_types/physical"],
  ["/combat_styles/slash", "/damage_types/physical"],
  ["/combat_styles/smash", "/damage_types/physical"],
  ["/combat_styles/ranged", "/damage_types/physical"],
  ["/combat_styles/magic", "/damage_types/water"],
  ["/combat_styles/magic", "/damage_types/nature"],
  ["/combat_styles/magic", "/damage_types/fire"],
  [null, null], // unarmed
];

describe("labyrinth optimizer ability pool", () => {
  it("rejects Revive: it targets a dead ally, and the labyrinth is 1v1", () => {
    expect(isAbilityUsableSolo("/abilities/revive", gameData)).toBe(false);

    for (const [style, damageType] of STYLE_DAMAGE_PAIRS) {
      expect(
        isAbilityCompatible("/abilities/revive", style, damageType, gameData)
      ).toBe(false);
    }
  });

  it("rejects every ability whose effects all need another unit", () => {
    for (const [hrid, ability] of Object.entries(gameData.abilityDetailMap)) {
      const soloUsable = ability.abilityEffects.some(
        (e) => e.targetType !== "deadAlly"
      );
      expect(isAbilityUsableSolo(hrid, gameData)).toBe(soloUsable);
    }
  });

  it("keeps self- and party-wide abilities that still work solo", () => {
    // Auras and allAllies buffs include the caster; quick_aid heals the
    // lowest-HP ally, which is the player when fighting alone.
    const soloUsable = [
      "/abilities/fierce_aura",
      "/abilities/critical_aura",
      "/abilities/guardian_aura",
      "/abilities/mystic_aura",
      "/abilities/speed_aura",
      "/abilities/invincible",
      "/abilities/insanity",
      "/abilities/promote",
      "/abilities/quick_aid",
      "/abilities/heal",
    ];
    for (const hrid of soloUsable) {
      expect(isAbilityUsableSolo(hrid, gameData)).toBe(true);
    }

    // ...and they stay in the pool for a weapon they amplify. (mystic_aura
    // carries water/nature/fire amplify buffs, so it is correctly gated to a
    // matching damage type — that check predates the solo filter.)
    for (const hrid of soloUsable.filter((h) => h !== "/abilities/mystic_aura")) {
      expect(
        isAbilityCompatible(hrid, "/combat_styles/slash", "/damage_types/physical", gameData)
      ).toBe(true);
    }
    expect(
      isAbilityCompatible("/abilities/mystic_aura", "/combat_styles/magic", "/damage_types/fire", gameData)
    ).toBe(true);
  });

  it("still gates damage abilities on the weapon's combat style", () => {
    expect(
      isAbilityCompatible("/abilities/fireball", "/combat_styles/magic", "/damage_types/fire", gameData)
    ).toBe(true);
    expect(
      isAbilityCompatible("/abilities/fireball", "/combat_styles/slash", "/damage_types/physical", gameData)
    ).toBe(false);
  });
});
