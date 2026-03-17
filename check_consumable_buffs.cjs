const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check what critical_coffee and other consumables provide
const consumables = [
  "/items/critical_coffee", "/items/ultra_attack_coffee", 
  "/items/ultra_magic_coffee", "/items/ultra_ranged_coffee",
  "/items/wisdom_coffee", "/items/super_attack_coffee",
  "/items/super_magic_coffee", "/items/super_ranged_coffee"
];

for (const hrid of consumables) {
  const item = gd.itemDetailMap[hrid];
  if (!item) continue;
  console.log(`=== ${hrid.split("/").pop()} ===`);
  if (item.consumableDetail) {
    const cd = item.consumableDetail;
    console.log("  buffs:", JSON.stringify(cd.buffs));
    if (cd.usableInActionTypeMap) {
      console.log("  usableIn:", JSON.stringify(cd.usableInActionTypeMap));
    }
  }
}

// Check what the players actually have equipped
console.log("\n=== Player drinks/food ===");
const players = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
for (const name of players) {
  const pd = JSON.parse(fs.readFileSync(`live_data/${name}.json`, "utf-8"));
  const data = pd.initCharacterData || pd;
  console.log(`\n${name}:`);
  if (data.drinks) {
    console.log("  drinks:", JSON.stringify(data.drinks));
  }
  if (data.food) {
    console.log("  food:", JSON.stringify(data.food));
  }
}

// Check ALL items that provide wisdom buffs
console.log("\n=== Items with wisdom buffs ===");
for (const [hrid, item] of Object.entries(gd.itemDetailMap)) {
  if (!item.consumableDetail || !item.consumableDetail.buffs) continue;
  for (const buff of item.consumableDetail.buffs) {
    if (buff.typeHrid === "/buff_types/wisdom") {
      console.log(`${hrid.split("/").pop()}: wisdom flat=${buff.flatBoost} ratio=${buff.ratioBoost}`);
    }
  }
}
