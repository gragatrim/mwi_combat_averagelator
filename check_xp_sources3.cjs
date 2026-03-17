const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check monster hrid format in combatMonsterDetailMap
const monKeys = Object.keys(gd.combatMonsterDetailMap);
console.log("=== Monster HRID format ===");
console.log("Total monsters:", monKeys.length);
console.log("Sample keys:", monKeys.slice(0, 10));

// Check if /monsters/eye exists
console.log("\n/monsters/eye:", gd.combatMonsterDetailMap["/monsters/eye"] ? "exists" : "not found");
console.log("/combat_monsters/eye:", gd.combatMonsterDetailMap["/combat_monsters/eye"] ? "exists" : "not found");

// Find eye monster
const eyeKey = monKeys.find(k => k.includes("eye") && !k.includes("veyes"));
if (eyeKey) {
  console.log("\nFound eye at:", eyeKey);
  const eye = gd.combatMonsterDetailMap[eyeKey];
  console.log("  experience:", eye.experience);
  console.log("  hp:", eye.combatDetails.maxHitpoints);
  console.log("  combatLevel:", eye.combatDetails.combatLevel);
}

// Check all the dungeon random spawn monsters
const dungeonMons = [
  "/monsters/eye", "/monsters/eyes", "/monsters/veyes",
  "/monsters/zombie", "/monsters/magnetic_golem", "/monsters/abyssal_imp",
  "/monsters/vampire", "/monsters/stalactite_golem", "/monsters/soul_hunter",
  "/monsters/squawker", "/monsters/werewolf", "/monsters/granite_golem",
  "/monsters/dark_knight", "/monsters/grim_reaper",
  "/monsters/anchor_shark", "/monsters/brine_marksman", "/monsters/tidal_conjuror",
  "/monsters/captain_fishhook", "/monsters/the_kraken",
  "/monsters/pirate_parrot", "/monsters/siren"
];

console.log("\n=== Dungeon Monster Lookup ===");
for (const hrid of dungeonMons) {
  const mon = gd.combatMonsterDetailMap[hrid];
  if (mon) {
    console.log(hrid.split("/").pop() + ": xp=" + mon.experience + " hp=" + mon.combatDetails.maxHitpoints);
  } else {
    console.log(hrid.split("/").pop() + ": NOT FOUND in combatMonsterDetailMap");
  }
}

// Check how zone.ts uses the hrid
// The spawn info uses "combatMonsterHrid" field - check if this maps directly
console.log("\n=== Checking spawn monster hrids in detail map ===");
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
const randomSpawnInfoMap = zone.combatZoneInfo.dungeonInfo.randomSpawnInfoMap;
const phase0 = randomSpawnInfoMap["0"];
if (phase0 && phase0.spawns) {
  for (const spawn of phase0.spawns) {
    const mon = gd.combatMonsterDetailMap[spawn.combatMonsterHrid];
    console.log(spawn.combatMonsterHrid + ": " + (mon ? "xp=" + mon.experience + " hp=" + mon.combatDetails.maxHitpoints : "NOT FOUND"));
  }
}

// Try with /combat_monsters/ prefix
console.log("\n=== Try /combat_monsters/ prefix ===");
if (phase0 && phase0.spawns) {
  for (const spawn of phase0.spawns) {
    const altHrid = spawn.combatMonsterHrid.replace("/monsters/", "/combat_monsters/");
    const mon = gd.combatMonsterDetailMap[altHrid];
    console.log(altHrid + ": " + (mon ? "xp=" + mon.experience + " hp=" + mon.combatDetails.maxHitpoints : "NOT FOUND"));
  }
}

// The dungeon spawn tier affects monster scaling
// Check what tier the fixed bosses and random monsters are at
console.log("\n=== Spawn DifficultyTier Analysis ===");
// Phase 0 random spawns all have difficultyTier: 4
// Fixed bosses have difficultyTier: 0
// This means the MONSTERS in random waves are already at tier 4!
// Monster XP at tier 4 = baseXP * (1 + 0.5 * 4) + 5 * 4 = baseXP * 3 + 20
// This is HUGE

// What's the actual XP of an eye at tier 4?
const eyeMon = gd.combatMonsterDetailMap["/monsters/eye"];
if (eyeMon) {
  console.log("\neye base XP:", eyeMon.experience);
  for (let tier = 0; tier <= 4; tier++) {
    const mult = 1 + 0.5 * tier;
    const bonus = 5 * tier;
    const tierXp = eyeMon.experience * mult + bonus;
    console.log("  at tier " + tier + ": " + tierXp + " (mult=" + mult + " bonus=" + bonus + ")");
  }
}

// Now check what tier scaling is ACTUALLY applied in our zone.ts / monster.ts
// The key question: does the zone difficulty tier STACK with the spawn's difficultyTier?
// Or is spawn.difficultyTier THE tier used for that monster?
