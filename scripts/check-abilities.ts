#!/usr/bin/env tsx
// Check ability details for Infernal Abyss monster abilities
import { readFileSync } from "fs";

const gameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const abilityHrids = [
  "/abilities/quick_aid",
  "/abilities/firestorm",
  "/abilities/fireball",
  "/abilities/critical_aura",
  "/abilities/silencing_shot",
  "/abilities/flame_arrow",
  "/abilities/mystic_aura",
  "/abilities/flame_blast",
  // Player abilities
  "/abilities/elemental_affinity",
  "/abilities/frost_surge",
  "/abilities/mana_spring",
  "/abilities/water_strike",
];

for (const hrid of abilityHrids) {
  const ability = gameData.abilityDetailMap[hrid];
  if (!ability) {
    console.log(`\n${hrid}: NOT FOUND`);
    continue;
  }
  console.log(`\n${hrid} (${ability.name}):`);
  console.log(`  castDuration: ${ability.castDuration}ns (${(ability.castDuration / 1e9).toFixed(2)}s)`);
  console.log(`  cooldownDuration: ${ability.cooldownDuration}ns (${(ability.cooldownDuration / 1e9).toFixed(2)}s)`);
  console.log(`  manaCost: ${ability.manaCost}`);

  if (ability.abilityEffects) {
    for (const eff of ability.abilityEffects) {
      console.log(`  effect: ${eff.effectType}`);
      console.log(`    targetType: ${eff.targetType}`);
      if (eff.effectType.includes("damage")) {
        console.log(`    damageFlat: ${eff.damageFlat}`);
        console.log(`    damageRatio: ${eff.damageRatio}`);
        console.log(`    combatStyle: ${eff.combatStyleHrid}`);
        console.log(`    damageType: ${eff.damageType}`);
        console.log(`    blindChance: ${eff.blindChance ?? 0}`);
        console.log(`    blindDuration: ${eff.blindDuration ?? 0}`);
        console.log(`    stunChance: ${eff.stunChance ?? 0}`);
        console.log(`    stunDuration: ${eff.stunDuration ?? 0}`);
        console.log(`    silenceChance: ${eff.silenceChance ?? 0}`);
        console.log(`    silenceDuration: ${eff.silenceDuration ?? 0}`);
      }
      if (eff.buffs && eff.buffs.length > 0) {
        for (const b of eff.buffs) {
          console.log(`    buff: ${b.typeHrid} flat=${b.flatBoost} ratio=${b.ratioBoost} dur=${(b.duration / 1e9).toFixed(1)}s`);
        }
      }
    }
  }
}
