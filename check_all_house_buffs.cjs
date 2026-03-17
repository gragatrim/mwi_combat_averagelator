const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("=== ALL House Room Buffs ===");
const houseRooms = data.houseRooms;
for (const [hrid, level] of Object.entries(houseRooms)) {
  const roomDetail = gd.houseRoomDetailMap[hrid];
  if (!roomDetail) continue;
  if (roomDetail.buffs && roomDetail.buffs.length > 0) {
    for (const buff of roomDetail.buffs) {
      const flat = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
      const ratio = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
      if (flat !== 0 || ratio !== 0) {
        console.log(`  ${hrid.split("/").pop()} lv${level}: ${buff.typeHrid} flat=${flat.toFixed(4)} ratio=${ratio.toFixed(4)}`);
      }
    }
  }
}

// Check ALL achievement buffs
console.log("\n=== ALL Achievement Buffs ===");
for (const [achHrid, achLevel] of Object.entries(data.achievements)) {
  const achDef = gd.achievementDetailMap[achHrid];
  if (!achDef || !achDef.buffs) continue;
  for (const buff of achDef.buffs) {
    const flat = buff.flatBoost + (achLevel - 1) * (buff.flatBoostLevelBonus || 0);
    const ratio = buff.ratioBoost + (achLevel - 1) * (buff.ratioBoostLevelBonus || 0);
    if (flat !== 0 || ratio !== 0) {
      console.log(`  ${achHrid.split("/").pop()} lv${achLevel}: ${buff.typeHrid} flat=${flat.toFixed(4)} ratio=${ratio.toFixed(4)}`);
    }
  }
}

// How the playerData parser creates achievements
console.log("\n=== Achievement data shape ===");
console.log("Keys (first 5):", Object.keys(data.achievements).slice(0, 5));
console.log("Sample value:", Object.values(data.achievements)[0]);
