const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check what achievements provide
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("=== Achievement buffs ===");
console.log("Type of achievements:", typeof data.achievements);
if (data.achievements && typeof data.achievements === "object") {
  const achEntries = Array.isArray(data.achievements) ? data.achievements : Object.values(data.achievements);
  for (const ach of achEntries) {
    const achHrid = ach.hrid || ach.achievementHrid || ach;
    const achDef = gd.achievementDetailMap ? gd.achievementDetailMap[achHrid] : null;
    if (achDef && achDef.buffs) {
      for (const buff of achDef.buffs) {
        if (buff.typeHrid === "/buff_types/wisdom" || buff.typeHrid.includes("experience")) {
          console.log(achHrid + ": " + buff.typeHrid + " flat=" + buff.flatBoost + " ratio=" + buff.ratioBoost);
        }
      }
    }
  }
}

// Check all possible buff types in game data for anything XP-related
console.log("\n=== All buff types containing 'exp' or 'wisdom' ===");
if (gd.buffDetailMap) {
  for (const [hrid, buff] of Object.entries(gd.buffDetailMap)) {
    if (hrid.includes("exp") || hrid.includes("wisdom")) {
      console.log(hrid + ": " + JSON.stringify(buff).substring(0, 200));
    }
  }
}

// Check combatStyleDetailMap for XP info
console.log("\n=== Combat style detail for magic ===");
const magicStyle = gd.combatStyleDetailMap["/combat_styles/magic"];
if (magicStyle) {
  console.log(JSON.stringify(magicStyle, null, 2));
}

// Check if there's an "additionalXP" or "xpMultiplier" in zone info
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
console.log("\n=== Zone XP fields ===");
console.log("experienceGain:", zone.experienceGain);
console.log("combatZoneInfo keys:", Object.keys(zone.combatZoneInfo));
console.log("dungeonInfo keys:", Object.keys(zone.combatZoneInfo.dungeonInfo));

// Check enhancement levels on equipment
console.log("\n=== Equipment enhancement levels (gragatrim) ===");
if (data.equipmentMap) {
  for (const [slot, equip] of Object.entries(data.equipmentMap)) {
    if (equip) {
      console.log(slot.split("/").pop() + ": " + equip.itemHrid.split("/").pop() + " lv" + (equip.enhancementLevel || 0));
    }
  }
}

// Check if enhancement provides extra combatExperience
console.log("\n=== Enhancement bonus stats ===");
const sampleItem = gd.itemDetailMap["/items/celestial_brush"];
if (sampleItem && sampleItem.equipmentDetail) {
  const ed = sampleItem.equipmentDetail;
  console.log("celestial_brush base combatStats:", JSON.stringify(ed.combatStats));
  if (ed.combatEnhancementBonuses) {
    console.log("enhancement bonuses:", JSON.stringify(ed.combatEnhancementBonuses));
  }
}
