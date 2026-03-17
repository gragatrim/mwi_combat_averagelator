const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
const di = zone.combatZoneInfo.dungeonInfo;

console.log("=== Dungeon Info ===");
console.log("maxWaves:", di.maxWaves);

// Fixed spawns
console.log("\n=== Fixed Spawns Map ===");
const fixedKeys = Object.keys(di.fixedSpawnsMap).map(Number).sort((a, b) => a - b);
console.log("Fixed wave numbers:", fixedKeys);
for (const key of fixedKeys) {
  const spawns = di.fixedSpawnsMap[key];
  const totalStr = spawns.reduce((s, m) => {
    const mon = gd.combatMonsterDetailMap[m.combatMonsterHrid];
    return s + (mon ? mon.strength || 0 : 0);
  }, 0);
  console.log(`Wave ${key}: [${spawns.map(s => s.combatMonsterHrid.split("/").pop() + " tier=" + s.difficultyTier).join(", ")}]`);
}

// Random spawn info map
console.log("\n=== Random Spawn Info Map ===");
const randomKeys = Object.keys(di.randomSpawnInfoMap).map(Number).sort((a, b) => a - b);
console.log("Phase keys:", randomKeys);
for (const key of randomKeys) {
  const rsi = di.randomSpawnInfoMap[key];
  console.log(`\nPhase ${key}: maxSpawnCount=${rsi.maxSpawnCount}, maxTotalStrength=${rsi.maxTotalStrength}`);
  for (const spawn of rsi.spawns) {
    console.log(`  ${spawn.combatMonsterHrid.split("/").pop()}: rate=${spawn.rate}, strength=${spawn.strength}, tier=${spawn.difficultyTier}`);
  }

  // Enumerate valid compositions for this phase
  const totalRate = rsi.spawns.reduce((s, sp) => s + sp.rate, 0);
  const compositions = new Map();

  function enumerate(slot, currentStr, monsters, prob) {
    if (slot >= rsi.maxSpawnCount) {
      merge(monsters, prob);
      return;
    }
    for (const spawn of rsi.spawns) {
      const pickProb = spawn.rate / totalRate;
      const newStr = currentStr + spawn.strength;
      if (newStr > rsi.maxTotalStrength) {
        merge(monsters, prob * pickProb);
      } else {
        enumerate(slot + 1, newStr, [...monsters, spawn.combatMonsterHrid.split("/").pop() + "(s=" + spawn.strength + ")"], prob * pickProb);
      }
    }
  }

  function merge(monsters, prob) {
    if (prob <= 0) return;
    const key = [...monsters].sort().join("|");
    const existing = compositions.get(key);
    if (existing) {
      existing.prob += prob;
    } else {
      compositions.set(key, { monsters: [...monsters], prob });
    }
  }

  enumerate(0, 0, [], 1.0);

  console.log(`  Valid compositions (${compositions.size}):`);
  let totalProb = 0;
  for (const [key, comp] of [...compositions.entries()].sort((a, b) => b[1].prob - a[1].prob)) {
    const totalStr = comp.monsters.reduce((s, m) => {
      const match = m.match(/\(s=(\d+)\)/);
      return s + (match ? parseInt(match[1]) : 0);
    }, 0);
    console.log(`    [${comp.monsters.join(", ")}] str=${totalStr} prob=${(comp.prob * 100).toFixed(2)}%`);
    totalProb += comp.prob;
  }
  console.log(`  Total probability: ${(totalProb * 100).toFixed(2)}%`);
}
