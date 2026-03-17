const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check enhancement level bonus multiplier table
console.log("=== Enhancement Level Bonus Multipliers ===");
console.log(gd.enhancementLevelTotalBonusMultiplierTable);

// Check a specific item's combatExperience at different enhancement levels
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;

console.log("\n=== Gragatrim Equipment CombatExperience Detail ===");
let totalCombatExp = 0;
for (const equip of Object.values(data.player.equipment)) {
  if (!equip || !equip.itemHrid) continue;
  const item = gd.itemDetailMap[equip.itemHrid];
  if (!item || !item.equipmentDetail) continue;
  const cs = item.equipmentDetail.combatStats;
  const enhLevel = equip.enhancementLevel || 0;

  // Enhancement bonus multiplier
  const enhMultiplier = gd.enhancementLevelTotalBonusMultiplierTable[enhLevel] || 0;

  // Check if combatExperience exists at base level
  const baseCombatExp = cs.combatExperience || 0;

  // Check combatEnhancementBonuses for combatExperience
  const enhBonuses = item.equipmentDetail.combatEnhancementBonuses || {};
  const enhCombatExp = enhBonuses.combatExperience || 0;

  // Total combat exp for this item = base + enhancement bonus * multiplier
  const totalForItem = baseCombatExp + enhCombatExp * enhMultiplier;

  if (baseCombatExp > 0 || enhCombatExp > 0) {
    console.log(equip.itemHrid.split("/").pop() + " +" + enhLevel + ":");
    console.log("  base combatExp: " + baseCombatExp);
    console.log("  enh combatExp bonus: " + enhCombatExp);
    console.log("  enh multiplier: " + enhMultiplier);
    console.log("  total: " + totalForItem);
  }
  totalCombatExp += totalForItem;
}
console.log("\nTotal equipment combatExperience: " + totalCombatExp.toFixed(4));
console.log("Sim reports: 0.0735");

// Also check what our Equipment class computes
console.log("\n=== Checking all equipment stats for gragatrim ===");
let totalAll = 0;
for (const equip of Object.values(data.player.equipment)) {
  if (!equip || !equip.itemHrid) continue;
  const item = gd.itemDetailMap[equip.itemHrid];
  if (!item || !item.equipmentDetail) continue;
  const cs = item.equipmentDetail.combatStats;
  const enhLevel = equip.enhancementLevel || 0;
  const enhMultiplier = gd.enhancementLevelTotalBonusMultiplierTable[enhLevel] || 0;
  const enhBonuses = item.equipmentDetail.combatEnhancementBonuses || {};

  const ce = (cs.combatExperience || 0) + (enhBonuses.combatExperience || 0) * enhMultiplier;
  if (ce > 0) {
    totalAll += ce;
    console.log(equip.itemHrid.split("/").pop() + ": " + ce.toFixed(4));
  }
}
console.log("Sum: " + totalAll.toFixed(4));
