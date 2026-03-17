const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("=== Achievement Tier Buffs ===");
for (const [tierHrid, tier] of Object.entries(gd.achievementTierDetailMap)) {
  const detailMap = Object.values(gd.achievementDetailMap).filter(d => d.tierHrid === tierHrid);
  let isGetAll = true;
  for (const ach of detailMap) {
    if (!data.achievements[ach.hrid]) {
      isGetAll = false;
      break;
    }
  }
  console.log(`${tierHrid}: ${isGetAll ? "EARNED" : "not earned"} (${detailMap.length} achievements)`);
  if (isGetAll && tier.buff) {
    const flat = tier.buff.flatBoost;
    const ratio = tier.buff.ratioBoost;
    console.log(`  Buff: ${tier.buff.typeHrid} flat=${flat} ratio=${ratio}`);
  }
}
