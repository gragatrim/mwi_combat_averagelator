const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

// Look for community buff in game data
console.log("=== Searching for community/moopass/external buffs ===");

// Check if there's a communityBuffDetailMap or similar
for (const key of Object.keys(gd)) {
  const kl = key.toLowerCase();
  if (kl.includes("community") || kl.includes("moo") || kl.includes("battle") || kl.includes("premium") || kl.includes("star")) {
    console.log("Found key: " + key);
    const val = JSON.stringify(gd[key]);
    console.log("  Value: " + val.substring(0, 500));
  }
}

// Check for any buff type that mentions XP or experience
console.log("\n=== All buff types in game data ===");
for (const key of Object.keys(gd)) {
  if (key.includes("buff") || key.includes("Buff")) {
    console.log("Found: " + key + " (" + (Array.isArray(gd[key]) ? gd[key].length : typeof gd[key]) + ")");
  }
}

// Look for community buff in combatZoneInfo or other maps
console.log("\n=== Top-level game data keys ===");
for (const key of Object.keys(gd).sort()) {
  const val = gd[key];
  const type = Array.isArray(val) ? "array[" + val.length + "]" : typeof val;
  console.log("  " + key + ": " + type);
}

// Check the communityBuffLevelMap or similar
if (gd.communityBuffTypeDetailMap) {
  console.log("\n=== communityBuffTypeDetailMap ===");
  for (const [k, v] of Object.entries(gd.communityBuffTypeDetailMap)) {
    if (k.includes("wisdom") || k.includes("combat")) {
      console.log(k + ": " + JSON.stringify(v).substring(0, 300));
    }
  }
}
