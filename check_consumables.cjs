const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

const players = ["gragatrim", "lisie", "qu", "skumbus", "sollin"];
for (const name of players) {
  const pd = JSON.parse(fs.readFileSync("live_data/" + name + ".json", "utf-8"));
  const data = pd.initCharacterData || pd;

  console.log("\n=== " + name + " ===");

  // Print keys containing food, drink, consumable
  for (const key of Object.keys(data)) {
    const kl = key.toLowerCase();
    if (kl.includes("food") || kl.includes("drink") || kl.includes("consumable")) {
      const val = JSON.stringify(data[key]);
      console.log("  " + key + ": " + val.substring(0, 400));
    }
  }
}
