const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

// Get house room details from game data
console.log("=== House Room Details with Wisdom Buffs ===");
const houseRooms = data.houseRooms; // map of hrid -> level
let totalWisdom = 0;

for (const [hrid, level] of Object.entries(houseRooms)) {
  const roomDetail = gd.houseRoomDetailMap ? gd.houseRoomDetailMap[hrid] : null;
  if (!roomDetail) {
    console.log(`${hrid.split("/").pop()} lv${level}: no detail found`);
    continue;
  }
  
  // Check buffs
  if (roomDetail.buffs) {
    for (const buff of roomDetail.buffs) {
      if (buff.typeHrid === "/buff_types/wisdom") {
        const flatAtLevel = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        console.log(`${hrid.split("/").pop()} lv${level}: wisdom flat=${buff.flatBoost} + ${level-1}*${buff.flatBoostLevelBonus} = ${flatAtLevel.toFixed(4)}`);
        totalWisdom += flatAtLevel;
      }
    }
  }
}
console.log(`\nTotal house room wisdom: ${totalWisdom.toFixed(4)}`);
console.log(`Zone wisdom: 0.2000`);
console.log(`Combined: ${(totalWisdom + 0.2).toFixed(4)}`);
console.log(`Expected (from debug): 0.2790`);

// Also check what game data key for house rooms exists
console.log("\n=== Game data keys containing 'house' ===");
for (const key of Object.keys(gd).sort()) {
  if (key.toLowerCase().includes("house")) {
    console.log(`  ${key}`);
  }
}
