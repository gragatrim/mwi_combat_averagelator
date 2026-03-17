const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check structure of house room detail map
console.log("=== Sample house room detail ===");
const library = gd.houseRoomDetailMap["/house_rooms/library"];
if (library) {
  console.log(JSON.stringify(library, null, 2).substring(0, 1000));
}

const observatory = gd.houseRoomDetailMap["/house_rooms/observatory"];
if (observatory) {
  console.log("\n=== Observatory ===");
  console.log(JSON.stringify(observatory, null, 2).substring(0, 1000));
}

// Check ALL rooms for any buff
console.log("\n=== All rooms with buffs ===");
for (const [hrid, room] of Object.entries(gd.houseRoomDetailMap)) {
  if (room.buffs && room.buffs.length > 0) {
    console.log(`${hrid}: ${JSON.stringify(room.buffs)}`);
  }
}

// Check if ANY room has fields beyond basic
console.log("\n=== Room keys ===");
const sampleRoom = Object.values(gd.houseRoomDetailMap)[0];
console.log(Object.keys(sampleRoom));
