#!/usr/bin/env tsx
// Check monster stats for a specific zone
import { readFileSync } from "fs";

const gameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

// Check Infernal Abyss zone info
const zoneHrid = "/actions/combat/infernal_abyss";
const zoneData = gameData.actionDetailMap[zoneHrid];
if (zoneData && zoneData.combatZoneInfo) {
  console.log(`Zone: ${zoneData.name}`);
  console.log(`Monsters: ${JSON.stringify(zoneData.combatZoneInfo.fightInfo)}`);
}

// Check all monsters that appear in Infernal Abyss
const monsterHrids = [
  "/monsters/abyssal_imp",
  "/monsters/soul_hunter",
  "/monsters/infernal_warlock",
  "/monsters/infernal_overlord", // possible boss
];

for (const hrid of monsterHrids) {
  const monster = gameData.combatMonsterDetailMap[hrid];
  if (!monster) {
    console.log(`\n${hrid}: NOT FOUND`);
    continue;
  }
  console.log(`\n${hrid}:`);
  console.log(`  name: ${monster.name}`);
  console.log(`  experience: ${monster.experience}`);
  console.log(`  HP: ${monster.combatDetails?.maxHitpoints}`);
  console.log(`  combatStyle: ${monster.combatDetails?.combatStats?.combatStyleHrid}`);
  console.log(`  parry: ${monster.combatDetails?.combatStats?.parry ?? 0}`);
  console.log(`  stun: ${monster.combatDetails?.combatStats?.stun ?? 0}`);
  console.log(`  blind: ${monster.combatDetails?.combatStats?.blind ?? 0}`);
  console.log(`  silence: ${monster.combatDetails?.combatStats?.silence ?? 0}`);
  console.log(`  armor: ${monster.combatDetails?.combatStats?.armor ?? 0}`);
  console.log(`  waterRes: ${monster.combatDetails?.combatStats?.waterResistance ?? 0}`);
  console.log(`  fireRes: ${monster.combatDetails?.combatStats?.fireResistance ?? 0}`);
  console.log(`  natureRes: ${monster.combatDetails?.combatStats?.natureResistance ?? 0}`);
  console.log(`  enrageTime: ${monster.enrageTime}`);

  // Check abilities
  if (monster.abilities) {
    for (const ab of monster.abilities) {
      const abilityDetail = gameData.abilityDetailMap[ab.abilityHrid];
      if (abilityDetail) {
        console.log(`  ability: ${ab.abilityHrid} (${abilityDetail.name})`);
        if (abilityDetail.abilityEffects) {
          for (const eff of abilityDetail.abilityEffects) {
            if (eff.effectType.includes("damage")) {
              console.log(`    dmg: flat=${eff.damageFlat} ratio=${eff.damageRatio} style=${eff.combatStyleHrid} type=${eff.damageType}`);
            }
          }
        }
      }
    }
  }
}

// Also check the combat style detail map for stab
const stabStyle = gameData.combatStyleDetailMap["/combat_styles/stab"];
if (stabStyle) {
  console.log(`\nStab combat style skillExpMap:`);
  console.log(JSON.stringify(stabStyle.skillExpMap));
}
const magicStyle = gameData.combatStyleDetailMap["/combat_styles/magic"];
if (magicStyle) {
  console.log(`\nMagic combat style skillExpMap:`);
  console.log(JSON.stringify(magicStyle.skillExpMap));
}
