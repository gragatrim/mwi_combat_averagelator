const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

console.log("=== Combat Style Detail Map ===");
for (const [hrid, style] of Object.entries(gd.combatStyleDetailMap)) {
  console.log(`\n${hrid}:`);
  console.log(JSON.stringify(style, null, 2));
}

// Check if there are any XP formula constants in game data
console.log("\n=== Looking for XP formula constants ===");
for (const key of Object.keys(gd).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("xp") || kl.includes("formula") || kl.includes("constant") || 
      kl.includes("scaling") || kl.includes("config")) {
    console.log(`${key}: ${JSON.stringify(gd[key]).substring(0, 200)}`);
  }
}
