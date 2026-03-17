const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

// Check equipment for per-skill experience stats
console.log("=== Equipment per-skill experience ===");
const expStats = ["attackExperience", "magicExperience", "rangedExperience", "meleeExperience", 
                  "defenseExperience", "staminaExperience", "intelligenceExperience"];

for (const equip of Object.values(data.player.equipment || {})) {
  if (!equip || !equip.itemHrid) continue;
  const item = gd.itemDetailMap[equip.itemHrid];
  if (!item || !item.equipmentDetail) continue;
  const cs = item.equipmentDetail.combatStats;
  const enhLevel = equip.enhancementLevel || 0;
  const enhMultiplier = gd.enhancementLevelTotalBonusMultiplierTable[enhLevel] || 0;
  const enhBonuses = item.equipmentDetail.combatEnhancementBonuses || {};

  for (const stat of expStats) {
    const base = cs[stat] || 0;
    const enhBonus = enhBonuses[stat] || 0;
    const total = base + enhBonus * enhMultiplier;
    if (total > 0) {
      console.log(`  ${equip.itemHrid.split("/").pop()} +${enhLevel}: ${stat} = ${base} + ${enhBonus} * ${enhMultiplier.toFixed(2)} = ${total.toFixed(4)}`);
    }
  }
}

// Also check charms specifically
console.log("\n=== Charm equipment detail ===");
const charmSlot = data.player.equipment["/equipment_types/earrings"];
if (charmSlot) {
  const charm = gd.itemDetailMap[charmSlot.itemHrid];
  if (charm && charm.equipmentDetail) {
    console.log("Charm:", charmSlot.itemHrid.split("/").pop(), "+"+charmSlot.enhancementLevel);
    console.log("  combatStats:", JSON.stringify(charm.equipmentDetail.combatStats));
    console.log("  enhBonuses:", JSON.stringify(charm.equipmentDetail.combatEnhancementBonuses));
  }
}

// Check full char data for the actual computed magicExperience
const full = JSON.parse(fs.readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"));
console.log("\n=== Full char data combatStats.magicExperience ===");
console.log("magicExperience:", full.combatUnit?.combatDetails?.combatStats?.magicExperience);

// Check ALL buff maps for any magic_experience or skill experience buffs
console.log("\n=== Looking for skill experience buffs in all maps ===");
const maps = [
  "achievementActionTypeBuffsMap", "communityActionTypeBuffsMap",
  "consumableActionTypeBuffsMap", "equipmentActionTypeBuffsMap",
  "houseActionTypeBuffsMap", "mooPassActionTypeBuffsMap",
  "personalActionTypeBuffsMap"
];

for (const mapName of maps) {
  const map = full[mapName];
  if (!map) continue;
  const combatBuffs = map["/action_types/combat"];
  if (!combatBuffs) continue;
  for (const buff of combatBuffs) {
    if (buff.typeHrid.includes("experience") && buff.typeHrid !== "/buff_types/wisdom") {
      console.log(`  ${mapName}: ${buff.typeHrid} flat=${buff.flatBoost} ratio=${buff.ratioBoost}`);
    }
  }
}
