const fs = require("fs");
const data = JSON.parse(fs.readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"));

// Check guild for any buffs
console.log("=== Guild info ===");
if (data.guild) {
  console.log("Guild:", JSON.stringify(data.guild).substring(0, 300));
}

// Check characterInfo for bonuses
console.log("\n=== characterInfo ===");
if (data.characterInfo) {
  for (const [k, v] of Object.entries(data.characterInfo).sort()) {
    console.log(`  ${k}: ${JSON.stringify(v).substring(0, 100)}`);
  }
}

// Check user info for premium/supporter bonuses
console.log("\n=== userInfo ===");
if (data.userInfo) {
  console.log(JSON.stringify(data.userInfo, null, 2));
}

// Check character fields
console.log("\n=== character ===");
if (data.character) {
  for (const [k, v] of Object.entries(data.character).sort()) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
}

// Check combatUnit for debuffOnLevelGap
console.log("\n=== combatUnit debuffOnLevelGap ===");
const cu = data.combatUnit;
if (cu) {
  console.log("debuffOnLevelGap:", cu.debuffOnLevelGap);
  console.log("experienceRate:", cu.experienceRate);
  console.log("experience:", cu.experience);
  // Check all keys on combatUnit
  for (const key of Object.keys(cu).sort()) {
    const val = cu[key];
    if (typeof val !== "object" || val === null) {
      console.log(`  ${key}: ${JSON.stringify(val)}`);
    }
  }
}

// Check for any "bonus" or "multiplier" in the top-level data
console.log("\n=== Looking for bonus/multiplier keys ===");
for (const key of Object.keys(data).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("bonus") || kl.includes("multi") || kl.includes("guild") || kl.includes("referral")) {
    console.log(`  ${key}: ${JSON.stringify(data[key]).substring(0, 200)}`);
  }
}
