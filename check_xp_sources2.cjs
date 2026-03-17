const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];

// Full combatZoneInfo
console.log("=== Full combatZoneInfo ===");
console.log(JSON.stringify(zone.combatZoneInfo, null, 2));

// Zone buffs
console.log("\n=== Zone Buffs ===");
console.log(JSON.stringify(zone.buffs, null, 2));

// Dungeon waves - check all wave definitions
const dungeonInfo = zone.combatZoneInfo.dungeonInfo;
if (dungeonInfo) {
  console.log("\n=== Dungeon Waves ===");
  console.log("Number of waves:", dungeonInfo.waves ? dungeonInfo.waves.length : 0);

  // Summarize XP per phase
  if (dungeonInfo.waves) {
    let totalFixedXp = 0;
    let randomWaveCount = 0;
    let fixedWaveCount = 0;

    for (let i = 0; i < dungeonInfo.waves.length; i++) {
      const wave = dungeonInfo.waves[i];
      if (wave.fixedSpawnsMap) {
        fixedWaveCount++;
        let waveXp = 0;
        for (const [monHrid, info] of Object.entries(wave.fixedSpawnsMap)) {
          const mon = gd.combatMonsterDetailMap[monHrid];
          if (mon) {
            waveXp += mon.experience * info.count;
          }
        }
        totalFixedXp += waveXp;
        if (i < 5 || i >= dungeonInfo.waves.length - 5) {
          console.log("Wave " + (i+1) + " (fixed): XP=" + waveXp);
        }
      } else if (wave.randomSpawnInfoMap) {
        randomWaveCount++;
        // For random waves, compute weighted average XP
        for (const [phase, spawnInfo] of Object.entries(wave.randomSpawnInfoMap)) {
          // We just want to know which phases exist
          if (i < 5 || i >= dungeonInfo.waves.length - 5) {
            console.log("Wave " + (i+1) + " (random, phase=" + phase + "): maxSpawn=" + spawnInfo.maxSpawnCount + " maxStrength=" + spawnInfo.maxTotalStrength);
          }
        }
      }
    }
    console.log("\nFixed waves: " + fixedWaveCount + " (total XP: " + totalFixedXp + ")");
    console.log("Random waves: " + randomWaveCount);
  }
}

// Check all random spawn phases and their monster pools
console.log("\n=== Random Spawn Phase Monster Pools ===");
const phases = {};
if (dungeonInfo && dungeonInfo.waves) {
  for (const wave of dungeonInfo.waves) {
    if (wave.randomSpawnInfoMap) {
      for (const [phase, spawnInfo] of Object.entries(wave.randomSpawnInfoMap)) {
        if (!phases[phase]) {
          phases[phase] = spawnInfo;
          console.log("\nPhase " + phase + ":");
          console.log("  maxSpawnCount:", spawnInfo.maxSpawnCount);
          console.log("  maxTotalStrength:", spawnInfo.maxTotalStrength);
          if (spawnInfo.spawns) {
            for (const spawn of spawnInfo.spawns) {
              const mon = gd.combatMonsterDetailMap[spawn.combatMonsterHrid];
              console.log("  " + spawn.combatMonsterHrid.split("/").pop() +
                ": rate=" + spawn.rate +
                " strength=" + spawn.strength +
                " xp=" + (mon ? mon.experience : "?") +
                " hp=" + (mon ? mon.combatDetails.maxHitpoints : "?"));
            }
          }
        }
      }
    }
  }
}

// Calculate weighted average XP for all random waves combined
console.log("\n=== Total Dungeon XP Calculation ===");
let totalXp = 0;
let totalWaves = 0;
if (dungeonInfo && dungeonInfo.waves) {
  for (let i = 0; i < dungeonInfo.waves.length; i++) {
    const wave = dungeonInfo.waves[i];
    totalWaves++;

    if (wave.fixedSpawnsMap) {
      let waveXp = 0;
      for (const [monHrid, info] of Object.entries(wave.fixedSpawnsMap)) {
        const mon = gd.combatMonsterDetailMap[monHrid];
        if (mon) waveXp += mon.experience * info.count;
      }
      totalXp += waveXp;
    }
  }
}
console.log("Total waves: " + totalWaves);
console.log("Total fixed wave XP: " + totalXp);

// Now check: what is tier 1 experience multiplier?
// From constants: MONSTER_EXP_MULTIPLIER_PER_TIER = 0.5, MONSTER_EXP_BONUS_PER_TIER = 5
// At tier 1: expMultiplier = 1 + 0.5 * 1 = 1.5
//            expBonus = 5 * 1 = 5
// Monster XP at tier 1 = baseXP * 1.5 + 5
console.log("\n=== Tier 1 XP Scaling ===");
console.log("expMultiplier at tier 1: 1.5");
console.log("expBonus at tier 1: 5");
console.log("anchor_shark at tier 0: " + gd.combatMonsterDetailMap["/combat_monsters/anchor_shark"].experience);
console.log("anchor_shark at tier 1: " + (gd.combatMonsterDetailMap["/combat_monsters/anchor_shark"].experience * 1.5 + 5));

// WAIT - what tier are we running? The test says tier 0, but user said tier 1!
console.log("\n=== IMPORTANT: Tier Check ===");
console.log("Zone maxDifficulty:", zone.maxDifficulty);
console.log("If running tier 1 (difficulty 1), XP is multiplied by 1.5 + flat 5 per monster");
