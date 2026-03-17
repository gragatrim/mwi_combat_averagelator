const fs = require("fs");

// Check Toolasha export for seal data
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("=== Toolasha export (gragatrim.json) ===");
console.log("Keys:", Object.keys(data).sort().join(", "));

// Check for any seal-related fields
for (const key of Object.keys(data).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("seal") || kl.includes("personal") || kl.includes("buff")) {
    console.log(`  ${key}: ${JSON.stringify(data[key]).substring(0, 300)}`);
  }
}

// Check full char data for combat wisdom computation
const full = JSON.parse(fs.readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"));

// The game pre-computes all buffs. Total wisdom for combat WITHOUT seals = 0.4975
// Zone buff adds 0.20 during combat
// So without seals: (1 + 0.4975 + 0.20) = 1.6975
// With seal wisdom +0.20: (1 + 0.6975 + 0.20) = 1.8975

// Check the combatUnit's buffs
console.log("\n=== combatUnit buffs ===");
const cu = full.combatUnit;
if (cu.combatBuffs) {
  console.log("combatBuffs:", JSON.stringify(cu.combatBuffs).substring(0, 500));
}
if (cu.permanentBuffs) {
  console.log("permanentBuffs:", JSON.stringify(cu.permanentBuffs).substring(0, 500));
}

// The key question: is combatExperience in the pre-computed stats the FULL value or just equipment?
console.log("\n=== combatUnit combatExperience ===");
console.log("combatExperience:", cu.combatDetails?.combatStats?.combatExperience);

// Check the noncombatStats for wisdom
console.log("\n=== Full char data - check ALL XP-related structures ===");
// Check characterSkills for level info
const skills = full.characterSkills;
if (skills) {
  for (const skill of skills) {
    if (skill.skillHrid === "/skills/magic" || skill.skillHrid === "/skills/attack") {
      console.log(`${skill.skillHrid}: level=${skill.level}`);
    }
  }
}

// CRITICAL: Check achievementActionTypeBuffsMap for combat - it includes damage ratio boost!
const achMap = full.achievementActionTypeBuffsMap;
console.log("\n=== Achievement combat buffs ===");
if (achMap && achMap["/action_types/combat"]) {
  for (const buff of achMap["/action_types/combat"]) {
    console.log(`  ${buff.typeHrid}: flat=${buff.flatBoost} ratio=${buff.ratioBoost}`);
  }
}

// Check if there's a "sealActionTypeBuffsMap" or similar
for (const key of Object.keys(full).sort()) {
  if (key.toLowerCase().includes("seal")) {
    console.log(`\nFound: ${key}: ${JSON.stringify(full[key]).substring(0, 300)}`);
  }
}

// Summarize ALL wisdom sources for combat
console.log("\n=== COMPLETE WISDOM BREAKDOWN (without seals, without zone) ===");
const allMaps = {
  "achievements": full.achievementActionTypeBuffsMap?.["/action_types/combat"] || [],
  "community": full.communityActionTypeBuffsMap?.["/action_types/combat"] || [],
  "consumables": full.consumableActionTypeBuffsMap?.["/action_types/combat"] || [],
  "equipment": full.equipmentActionTypeBuffsMap?.["/action_types/combat"] || [],
  "house": full.houseActionTypeBuffsMap?.["/action_types/combat"] || [],
  "mooPass": full.mooPassActionTypeBuffsMap?.["/action_types/combat"] || [],
  "personal": full.personalActionTypeBuffsMap?.["/action_types/combat"] || [],
};

let totalWisdom = 0;
for (const [source, buffs] of Object.entries(allMaps)) {
  for (const buff of buffs) {
    if (buff.typeHrid === "/buff_types/wisdom") {
      console.log(`  ${source}: ${buff.flatBoost.toFixed(4)} wisdom`);
      totalWisdom += buff.flatBoost;
    }
  }
}
console.log(`  TOTAL: ${totalWisdom.toFixed(4)}`);
console.log(`\n  + zone wisdom: 0.2000`);
console.log(`  = total IN COMBAT (no seals): ${(totalWisdom + 0.2).toFixed(4)}`);
console.log(`  combatExpBonus (no seals): ${(1 + totalWisdom + 0.2).toFixed(4)}`);
console.log(`  + seal wisdom: 0.2000`);
console.log(`  = total IN COMBAT (with seals): ${(totalWisdom + 0.4).toFixed(4)}`);
console.log(`  combatExpBonus (with seals): ${(1 + totalWisdom + 0.4).toFixed(4)}`);

// Calculate expected XP ratio
const ceNoSeals = 1 + totalWisdom + 0.2;
const magicExp = 1 + 0.196;
const multNoSeals = ceNoSeals * magicExp;
console.log(`\nWith magicExperience=0.196:`);
console.log(`  Multiplier (no seals): ${multNoSeals.toFixed(4)}`);
console.log(`  Expected XP/hr (no seals): 937,900 → need raw ${(937900 / multNoSeals).toFixed(0)} XP/hr`);
