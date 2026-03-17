const fs = require("fs");
const data = JSON.parse(fs.readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"));

// Extract ALL combat-specific buffs from each buff map
const maps = [
  "achievementActionTypeBuffsMap",
  "communityActionTypeBuffsMap",
  "consumableActionTypeBuffsMap",
  "equipmentActionTypeBuffsMap",
  "houseActionTypeBuffsMap",
  "mooPassActionTypeBuffsMap",
  "personalActionTypeBuffsMap"
];

let totalWisdom = 0;
for (const mapName of maps) {
  const map = data[mapName];
  if (!map) continue;
  const combatBuffs = map["/action_types/combat"];
  if (!combatBuffs || combatBuffs.length === 0) {
    console.log(`${mapName}: (no combat buffs)`);
    continue;
  }
  console.log(`=== ${mapName} [combat] ===`);
  for (const buff of combatBuffs) {
    console.log(`  ${buff.typeHrid}: flat=${buff.flatBoost} ratio=${buff.ratioBoost} dur=${buff.duration}`);
    if (buff.typeHrid === "/buff_types/wisdom") {
      totalWisdom += buff.flatBoost;
    }
  }
}

console.log(`\n=== Total wisdom from all buff maps: ${totalWisdom.toFixed(4)} ===`);
console.log(`Expected combatExpBonus = 1 + equipment_combatExperience + ${totalWisdom.toFixed(4)}`);

// Check combatUnit for the pre-computed combat details
console.log("\n=== combatUnit details ===");
const cu = data.combatUnit;
if (cu) {
  console.log("isActive:", cu.isActive);
  console.log("experience:", cu.experience);
  console.log("hrid:", cu.hrid);
  
  if (cu.combatDetails) {
    const cs = cu.combatDetails.combatStats;
    if (cs) {
      console.log("\n=== Pre-computed combatStats ===");
      console.log("combatExperience:", cs.combatExperience);
      console.log("attackExperience:", cs.attackExperience);
      console.log("magicExperience:", cs.magicExperience);
      console.log("rangedExperience:", cs.rangedExperience);
      console.log("combatStyleHrid:", cs.combatStyleHrid);
      console.log("primaryTraining:", cs.primaryTraining);
      console.log("focusTraining:", cs.focusTraining);
      console.log("attackInterval:", cs.attackInterval);
      console.log("maxHitpoints:", cu.combatDetails.maxHitpoints);
      console.log("maxManapoints:", cu.combatDetails.maxManapoints);
      
      // All stats
      console.log("\n=== Full combatStats ===");
      for (const [k, v] of Object.entries(cs).sort()) {
        if (v !== 0 && v !== "" && v !== "/skills/none" && v !== "/none") {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
  }
}

// Community buff levels
console.log("\n=== Community Buffs ===");
for (const buff of data.communityBuffs) {
  console.log(`${buff.hrid}: level=${buff.level}`);
}

// Check noncombatStats for any combat-related field
console.log("\n=== noncombatStats (wisdom) ===");
const ncs = data.noncombatStats;
if (ncs) {
  for (const [k, v] of Object.entries(ncs).sort()) {
    if (k.includes("wisdom") || k.includes("exp") || k.includes("combat")) {
      console.log(`  ${k}: ${v}`);
    }
  }
}
