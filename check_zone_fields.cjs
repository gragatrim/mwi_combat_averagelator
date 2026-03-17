const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];

// Dump ALL fields of the zone (excluding large maps)
console.log("=== Zone fields ===");
for (const [key, val] of Object.entries(zone)) {
  if (typeof val !== "object" || val === null) {
    console.log(key + ": " + JSON.stringify(val));
  } else if (Array.isArray(val)) {
    console.log(key + ": array[" + val.length + "]");
    if (val.length <= 5) console.log("  " + JSON.stringify(val));
  } else {
    console.log(key + ": {" + Object.keys(val).join(", ") + "}");
  }
}

// Check combatZoneInfo for any XP multiplier
console.log("\n=== combatZoneInfo ===");
const czi = zone.combatZoneInfo;
for (const [key, val] of Object.entries(czi)) {
  if (typeof val !== "object" || val === null) {
    console.log(key + ": " + JSON.stringify(val));
  } else {
    console.log(key + ": {" + Object.keys(val).join(", ") + "}");
  }
}

// Check dungeonInfo
console.log("\n=== dungeonInfo ===");
const di = czi.dungeonInfo;
for (const [key, val] of Object.entries(di)) {
  if (key === "randomSpawnInfoMap" || key === "fixedSpawnsMap" || key === "rewardDropTable") {
    console.log(key + ": [complex]");
  } else {
    console.log(key + ": " + JSON.stringify(val));
  }
}

// Check buffs array
console.log("\n=== Zone buffs ===");
if (zone.buffs) {
  for (const buff of zone.buffs) {
    console.log(JSON.stringify(buff));
  }
}

// Check experienceGain
console.log("\n=== experienceGain ===");
console.log(JSON.stringify(zone.experienceGain));

// Compare with a non-dungeon zone
console.log("\n=== Non-dungeon zone (fly) for comparison ===");
const fly = gd.actionDetailMap["/actions/combat/fly"];
if (fly) {
  console.log("experienceGain: " + JSON.stringify(fly.experienceGain));
  console.log("buffs: " + JSON.stringify(fly.buffs));
  if (fly.combatZoneInfo && fly.combatZoneInfo.fightInfo) {
    console.log("fightInfo: " + JSON.stringify(fly.combatZoneInfo.fightInfo).substring(0, 200));
  }
}
