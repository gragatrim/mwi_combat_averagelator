const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Search ALL top-level keys for anything XP/experience/premium/battle/star related
console.log("=== XP-related game data keys ===");
for (const key of Object.keys(gd).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("exp") || kl.includes("xp") || kl.includes("premium") || 
      kl.includes("battle") || kl.includes("star") || kl.includes("moo") ||
      kl.includes("pass") || kl.includes("bonus") || kl.includes("multiplier") ||
      kl.includes("boost") || kl.includes("wisdom")) {
    const val = gd[key];
    const type = val === null ? "null" : Array.isArray(val) ? `array[${val.length}]` : typeof val;
    console.log(`  ${key}: ${type}`);
    if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") {
      console.log(`    = ${JSON.stringify(val)}`);
    } else if (type.startsWith("array") && val.length <= 3) {
      console.log(`    = ${JSON.stringify(val)}`);
    }
  }
}

// Check player data for any XP-related fields we're missing
console.log("\n=== Player data XP-related fields ===");
const pd = JSON.parse(fs.readFileSync("live_data/gragatrim.json", "utf-8"));
const data = pd.initCharacterData || pd;
for (const key of Object.keys(data).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("exp") || kl.includes("xp") || kl.includes("premium") || 
      kl.includes("battle") || kl.includes("star") || kl.includes("moo") ||
      kl.includes("pass") || kl.includes("bonus") || kl.includes("multi") ||
      kl.includes("boost") || kl.includes("wisdom")) {
    console.log(`  ${key}: ${JSON.stringify(data[key]).substring(0, 200)}`);
  }
}

// Check the player object itself
console.log("\n=== Player object keys ===");
for (const key of Object.keys(data.player).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("exp") || kl.includes("xp") || kl.includes("bonus") || kl.includes("mult")) {
    console.log(`  ${key}: ${JSON.stringify(data.player[key])}`);
  }
}

// Check community buff types
console.log("\n=== Community buff experience type ===");
const cbt = gd.communityBuffTypeDetailMap;
if (cbt) {
  for (const [k, v] of Object.entries(cbt)) {
    if (k.includes("experience") || k.includes("wisdom")) {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
}
