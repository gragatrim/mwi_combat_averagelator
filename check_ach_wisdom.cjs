const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

// Check achievements for wisdom buffs
console.log("=== Achievement Wisdom Buffs ===");
let achWisdom = 0;
if (data.achievements && typeof data.achievements === "object") {
  for (const [achHrid, achLevel] of Object.entries(data.achievements)) {
    const achDef = gd.achievementDetailMap ? gd.achievementDetailMap[achHrid] : null;
    if (!achDef || !achDef.buffs) continue;
    for (const buff of achDef.buffs) {
      if (buff.typeHrid === "/buff_types/wisdom") {
        const flat = buff.flatBoost + (achLevel - 1) * (buff.flatBoostLevelBonus || 0);
        console.log(`  ${achHrid.split("/").pop()} lv${achLevel}: wisdom flat=${buff.flatBoost} + ${achLevel-1}*${buff.flatBoostLevelBonus || 0} = ${flat.toFixed(4)}`);
        achWisdom += flat;
      }
    }
  }
}
console.log(`Total achievement wisdom: ${achWisdom.toFixed(4)}`);
console.log(`Zone wisdom: 0.2000`);
console.log(`Combined: ${(achWisdom + 0.2).toFixed(4)}`);
console.log(`Expected (from debug): 0.2790`);

// Also check how the achievement buffs are loaded in playerData parser
