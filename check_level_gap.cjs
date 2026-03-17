const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Check all player data for debuffOnLevelGap
const players = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
for (const name of players) {
  const pd = JSON.parse(fs.readFileSync(`live_data/${name}.json`, "utf-8"));
  const data = pd.initCharacterData || pd;
  console.log(`${name}: debuffOnLevelGap=${data.debuffOnLevelGap || "N/A"}`);
  
  // Check player levels
  const p = data.player;
  console.log(`  levels: attack=${p.attackLevel} magic=${p.magicLevel} ranged=${p.rangedLevel} melee=${p.meleeLevel} defense=${p.defenseLevel} stamina=${p.staminaLevel} intelligence=${p.intelligenceLevel}`);
}

// Check monster levels/tiers to understand level gap
console.log("\n=== Monster info for level gap ===");
const monsters = [
  "/monsters/zombie", "/monsters/magnetic_golem", "/monsters/abyssal_imp",
  "/monsters/vampire", "/monsters/soul_hunter", "/monsters/werewolf",
  "/monsters/squawker", "/monsters/anchor_shark", "/monsters/the_kraken"
];
for (const hrid of monsters) {
  const mon = gd.combatMonsterDetailMap[hrid];
  if (mon) {
    console.log(`${hrid.split("/").pop()}: level=${mon.level || "N/A"}, requiredLevel=${mon.requiredLevel || "N/A"}`);
  }
}
