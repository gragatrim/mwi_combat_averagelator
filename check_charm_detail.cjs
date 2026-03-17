const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

// Find the charm/earring equipment
console.log("=== All equipment ===");
const equip = data.player.equipment;
for (const [slot, item] of Object.entries(equip)) {
  if (!item) continue;
  console.log(`${slot.split("/").pop()}: ${item.itemHrid.split("/").pop()} +${item.enhancementLevel || 0}`);
}

// Check the charm in detail
console.log("\n=== Looking for charm/earring slot ===");
for (const [slot, item] of Object.entries(equip)) {
  if (!item) continue;
  const detail = gd.itemDetailMap[item.itemHrid];
  if (!detail || !detail.equipmentDetail) continue;
  
  const ed = detail.equipmentDetail;
  if (ed.type === "/equipment_types/earrings" || slot.includes("earring")) {
    console.log(`\nCharm: ${item.itemHrid.split("/").pop()} +${item.enhancementLevel}`);
    console.log("  type:", ed.type);
    console.log("  combatStats:", JSON.stringify(ed.combatStats));
    console.log("  enhBonuses:", JSON.stringify(ed.combatEnhancementBonuses));
    
    const enhMultiplier = gd.enhancementLevelTotalBonusMultiplierTable[item.enhancementLevel || 0] || 0;
    console.log("  enhMultiplier:", enhMultiplier);
    
    // Show all non-zero stats
    console.log("\n  Non-zero stats:");
    for (const [k, v] of Object.entries(ed.combatStats)) {
      const enhV = ed.combatEnhancementBonuses?.[k] || 0;
      const total = v + enhV * enhMultiplier;
      if (total !== 0) {
        console.log(`    ${k}: base=${v} + enh=${enhV}*${enhMultiplier.toFixed(1)} = ${total.toFixed(4)}`);
      }
    }
  }
}

// Check ALL equipment for non-zero combatExperience
console.log("\n=== All equipment combatExperience and skill Experience ===");
const stats = ["combatExperience", "attackExperience", "magicExperience", "rangedExperience", 
               "meleeExperience", "defenseExperience", "staminaExperience", "intelligenceExperience"];
for (const [slot, item] of Object.entries(equip)) {
  if (!item) continue;
  const detail = gd.itemDetailMap[item.itemHrid];
  if (!detail || !detail.equipmentDetail) continue;
  const cs = detail.equipmentDetail.combatStats;
  const enh = detail.equipmentDetail.combatEnhancementBonuses || {};
  const enhMult = gd.enhancementLevelTotalBonusMultiplierTable[item.enhancementLevel || 0] || 0;
  
  for (const stat of stats) {
    const base = cs[stat] || 0;
    const enhV = enh[stat] || 0;
    const total = base + enhV * enhMult;
    if (total > 0) {
      console.log(`  ${item.itemHrid.split("/").pop()} +${item.enhancementLevel}: ${stat} = ${total.toFixed(4)}`);
    }
  }
}
