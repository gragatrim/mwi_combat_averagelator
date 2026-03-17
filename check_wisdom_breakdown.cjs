const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

// Check house room buffs
console.log("=== House Room Wisdom Buffs ===");
let houseWisdom = 0;
if (data.houseRoomBuffs || data.houseRooms) {
  const rooms = data.houseRoomBuffs || data.houseRooms;
  if (Array.isArray(rooms)) {
    for (const room of rooms) {
      if (room.buffs) {
        for (const buff of room.buffs) {
          if (buff.typeHrid === "/buff_types/wisdom" || (buff.typeHrid && buff.typeHrid.includes("wisdom"))) {
            console.log("  Room buff:", JSON.stringify(buff));
            houseWisdom += buff.flatBoost + (buff.flatBoostLevelBonus || 0) * ((buff.level || 1) - 1);
          }
        }
      }
    }
  }
}
console.log("Total house room wisdom:", houseWisdom);

// Check zone buffs
console.log("\n=== Zone Wisdom Buffs ===");
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
let zoneWisdom = 0;
if (zone.buffs) {
  for (const buff of zone.buffs) {
    console.log("  Zone buff:", JSON.stringify(buff));
    if (buff.typeHrid === "/buff_types/wisdom") {
      zoneWisdom += buff.flatBoost;
      console.log("  -> wisdom flat:", buff.flatBoost);
    }
  }
}
console.log("Total zone wisdom:", zoneWisdom);
console.log("House + Zone wisdom:", houseWisdom + zoneWisdom);

// Check player data structure for house rooms
console.log("\n=== Player Data Keys ===");
for (const key of Object.keys(data).sort()) {
  const val = data[key];
  const type = val === null ? "null" : Array.isArray(val) ? `array[${val.length}]` : typeof val;
  if (type !== "object") console.log(`  ${key}: ${type}`);
  else console.log(`  ${key}: {${Object.keys(val).slice(0, 5).join(", ")}${Object.keys(val).length > 5 ? "..." : ""}}`);
}

// Check houseRoomMap or houseRooms
console.log("\n=== Looking for house room data ===");
for (const key of Object.keys(data)) {
  if (key.toLowerCase().includes("house") || key.toLowerCase().includes("room")) {
    const val = data[key];
    console.log(`${key}: ${JSON.stringify(val).substring(0, 500)}`);
  }
}
