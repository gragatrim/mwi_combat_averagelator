const fs = require("fs");
const data = JSON.parse(fs.readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"));

// Top-level keys
console.log("=== Top-level keys ===");
for (const key of Object.keys(data).sort()) {
  const val = data[key];
  const type = val === null ? "null" : Array.isArray(val) ? `array[${val.length}]` : typeof val;
  if (type === "object") {
    const subKeys = Object.keys(val);
    console.log(`  ${key}: object{${subKeys.length} keys} [${subKeys.slice(0, 5).join(", ")}${subKeys.length > 5 ? "..." : ""}]`);
  } else {
    console.log(`  ${key}: ${type} = ${JSON.stringify(val).substring(0, 100)}`);
  }
}

// Look for XP-related fields
console.log("\n=== XP/Wisdom/Buff-related fields ===");
for (const key of Object.keys(data).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("exp") || kl.includes("wisdom") || kl.includes("buff") || 
      kl.includes("bonus") || kl.includes("multi") || kl.includes("premium") ||
      kl.includes("battle") || kl.includes("star") || kl.includes("moo") ||
      kl.includes("community") || kl.includes("seal")) {
    console.log(`  ${key}: ${JSON.stringify(data[key]).substring(0, 500)}`);
  }
}

// Check for active buffs
console.log("\n=== Looking for active combat buffs ===");
for (const key of Object.keys(data).sort()) {
  const kl = key.toLowerCase();
  if (kl.includes("active") || kl.includes("combat") || kl.includes("buff") || kl.includes("effect")) {
    const val = data[key];
    console.log(`  ${key}: ${JSON.stringify(val).substring(0, 300)}`);
  }
}

// Check character combat details
console.log("\n=== Character combat details (if present) ===");
if (data.character) {
  for (const key of Object.keys(data.character).sort()) {
    const kl = key.toLowerCase();
    if (kl.includes("combat") || kl.includes("buff") || kl.includes("exp") || kl.includes("stat")) {
      console.log(`  character.${key}: ${JSON.stringify(data.character[key]).substring(0, 300)}`);
    }
  }
}
