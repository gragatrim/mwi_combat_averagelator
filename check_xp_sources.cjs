const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];

// Check experienceGain on the zone
console.log("=== Zone experienceGain ===");
console.log(JSON.stringify(zone.experienceGain));

// Check dungeon info fields
const di = zone.combatZoneInfo.dungeonInfo;
console.log("\n=== All dungeonInfo fields ===");
for (const [key, val] of Object.entries(di)) {
  if (key === "randomSpawnInfoMap" || key === "fixedSpawnsMap" || key === "rewardDropTable") {
    console.log(key + ": [complex]");
  } else {
    console.log(key + ": " + JSON.stringify(val));
  }
}

// Check monster base XP and enrage times
console.log("\n=== Monster stats for ALL pirate_cove monsters ===");
const monsterHrids = new Set();
// Phase 0, 20, 40 random spawns
for (const phaseKey of Object.keys(di.randomSpawnInfoMap)) {
  const phase = di.randomSpawnInfoMap[phaseKey];
  for (const spawn of phase.spawns) {
    monsterHrids.add(spawn.combatMonsterHrid);
  }
}
// Fixed spawn monsters
for (const key of Object.keys(di.fixedSpawnsMap)) {
  for (const spawn of di.fixedSpawnsMap[key]) {
    monsterHrids.add(spawn.combatMonsterHrid);
  }
}

for (const hrid of monsterHrids) {
  const mon = gd.combatMonsterDetailMap[hrid];
  if (mon) {
    console.log(hrid.split("/").pop() + ": baseXP=" + mon.experience + ", enrageTime=" + (mon.enrageTime/1e9) + "s, hp=" + mon.combatDetails.totalHitpoints);
  }
}

// Check fixed spawn XP with tier scaling
console.log("\n=== Fixed spawn waves XP ===");
for (const key of Object.keys(di.fixedSpawnsMap).sort((a, b) => Number(a) - Number(b))) {
  const spawns = di.fixedSpawnsMap[key];
  let totalXP = 0;
  const details = [];
  for (const spawn of spawns) {
    const mon = gd.combatMonsterDetailMap[spawn.combatMonsterHrid];
    if (mon) {
      const tier = spawn.difficultyTier;
      const xp = (1 + 0.5 * tier) * (mon.experience + 5 * tier);
      totalXP += xp;
      details.push(spawn.combatMonsterHrid.split("/").pop() + " tier" + tier + " xp=" + xp.toFixed(0));
    }
  }
  console.log("Wave " + key + ": totalXP=" + totalXP.toFixed(0) + " [" + details.join(", ") + "]");
}

// Check phase random spawn XP
console.log("\n=== Random spawn XP by phase ===");
for (const phaseKey of Object.keys(di.randomSpawnInfoMap).sort((a, b) => Number(a) - Number(b))) {
  const phase = di.randomSpawnInfoMap[phaseKey];
  console.log("Phase " + phaseKey + ":");
  for (const spawn of phase.spawns) {
    const mon = gd.combatMonsterDetailMap[spawn.combatMonsterHrid];
    if (mon) {
      const tier = spawn.difficultyTier;
      const xp = (1 + 0.5 * tier) * (mon.experience + 5 * tier);
      console.log("  " + spawn.combatMonsterHrid.split("/").pop() + " tier" + tier + ": xp=" + xp.toFixed(0) + " (base=" + mon.experience + ") rate=" + spawn.rate + " str=" + spawn.strength);
    }
  }
}

// experienceGain for comparison
console.log("\n=== experienceGain ===");
console.log(JSON.stringify(zone.experienceGain));
