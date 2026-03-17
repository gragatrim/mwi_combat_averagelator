const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("=== House Room Wisdom from globalBuffs ===");
const houseRooms = data.houseRooms;
let totalWisdom = 0;
for (const [hrid, level] of Object.entries(houseRooms)) {
  const room = gd.houseRoomDetailMap[hrid];
  if (!room) continue;
  
  // Check globalBuffs for wisdom
  if (room.globalBuffs) {
    for (const buff of room.globalBuffs) {
      if (buff.typeHrid === "/buff_types/wisdom") {
        const flat = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        console.log(`  ${hrid.split("/").pop()} lv${level}: flat=${buff.flatBoost} + ${level-1}*${buff.flatBoostLevelBonus} = ${flat.toFixed(4)}`);
        totalWisdom += flat;
      }
    }
  }
  
  // Also check actionBuffs for wisdom
  if (room.actionBuffs) {
    for (const buff of room.actionBuffs) {
      if (buff.typeHrid === "/buff_types/wisdom") {
        const flat = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        console.log(`  ${hrid.split("/").pop()} lv${level} (action): flat=${buff.flatBoost} + ${level-1}*${buff.flatBoostLevelBonus} = ${flat.toFixed(4)}`);
        totalWisdom += flat;
      }
    }
  }
}

console.log(`Total house room wisdom: ${totalWisdom.toFixed(4)}`);
console.log(`Zone wisdom: 0.2000`);
console.log(`Combined: ${(totalWisdom + 0.2).toFixed(4)}`);
console.log(`Expected (from debug): 0.2790`);

// BUT wait - the house rooms use usableInActionTypeMap to determine which buffs are used in combat
console.log("\n=== Rooms usable in combat ===");
for (const [hrid, room] of Object.entries(gd.houseRoomDetailMap)) {
  const usable = room.usableInActionTypeMap && room.usableInActionTypeMap["/action_types/combat"];
  if (usable) {
    console.log(`  ${hrid.split("/").pop()}: usable in combat`);
    if (room.actionBuffs) {
      for (const buff of room.actionBuffs) {
        const level = houseRooms[hrid] || 0;
        if (level > 0) {
          const flat = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
          const ratio = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
          console.log(`    actionBuff: ${buff.typeHrid} flat=${flat.toFixed(4)} ratio=${ratio.toFixed(4)}`);
        }
      }
    }
  }
}
