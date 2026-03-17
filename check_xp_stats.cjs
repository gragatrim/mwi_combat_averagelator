const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

const players = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
for (const name of players) {
  const pd = JSON.parse(fs.readFileSync("live_data/" + name + ".json", "utf-8"));
  const data = pd.initCharacterData || pd;

  console.log("\n=== " + name + " ===");

  // Check all stat-like fields
  for (const key of Object.keys(data)) {
    const kl = key.toLowerCase();
    if (kl.includes("exp") || kl.includes("wisdom") || kl.includes("xp") || kl.includes("bonus") || kl.includes("multiplier") || kl.includes("star") || kl.includes("moo") || kl.includes("pass") || kl.includes("achievement")) {
      const val = JSON.stringify(data[key]);
      if (val.length < 500) {
        console.log("  " + key + ": " + val);
      } else {
        console.log("  " + key + ": [" + val.length + " chars]");
      }
    }
  }

  // Also check equipment combat stats for any XP-related ones
  if (data.equipmentMap) {
    let combatExpFromEquip = 0;
    let magicExpFromEquip = 0;
    let attackExpFromEquip = 0;
    let rangedExpFromEquip = 0;
    for (const [slot, equip] of Object.entries(data.equipmentMap)) {
      if (equip && equip.itemHrid) {
        const item = gd.itemDetailMap[equip.itemHrid];
        if (item && item.equipmentDetail && item.equipmentDetail.combatStats) {
          const cs = item.equipmentDetail.combatStats;
          if (cs.combatExperience) combatExpFromEquip += cs.combatExperience;
          if (cs.magicExperience) magicExpFromEquip += cs.magicExperience;
          if (cs.attackExperience) attackExpFromEquip += cs.attackExperience;
          if (cs.rangedExperience) rangedExpFromEquip += cs.rangedExperience;
        }
      }
    }
    console.log("  Equipment combatExperience: " + combatExpFromEquip.toFixed(4));
    console.log("  Equipment magicExperience: " + magicExpFromEquip.toFixed(4));
    console.log("  Equipment attackExperience: " + attackExpFromEquip.toFixed(4));
    console.log("  Equipment rangedExperience: " + rangedExpFromEquip.toFixed(4));
  }

  // Check house room wisdom
  if (data.houseRoomMap) {
    let totalHouseWisdom = 0;
    for (const [roomHrid, room] of Object.entries(data.houseRoomMap)) {
      if (room && room.level > 0) {
        const roomDef = gd.houseRoomDetailMap[roomHrid];
        if (roomDef && roomDef.buffs) {
          for (const buff of roomDef.buffs) {
            if (buff.typeHrid === "/buff_types/wisdom") {
              const value = buff.flatBoost + (room.level - 1) * buff.flatBoostLevelBonus;
              totalHouseWisdom += value;
            }
          }
        }
      }
    }
    console.log("  House room wisdom: " + totalHouseWisdom.toFixed(4));
  }
}
