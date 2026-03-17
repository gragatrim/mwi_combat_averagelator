const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));
const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
const di = zone.combatZoneInfo.dungeonInfo;

// Helper: compute monster XP with tier scaling
function monsterXP(hrid, tier) {
  const mon = gd.combatMonsterDetailMap[hrid];
  if (!mon) return 0;
  const expMultiplier = 1.0 + 0.5 * tier;
  const expBonus = 5.0 * tier;
  return expMultiplier * (mon.experience + expBonus);
}

// Enumerate all compositions for a phase (same DFS as zone.ts)
function enumeratePhase(phaseKey) {
  const rsi = di.randomSpawnInfoMap[phaseKey];
  if (!rsi) return [];
  const totalRate = rsi.spawns.reduce((s, sp) => s + sp.rate, 0);
  const results = new Map();
  
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
        enumerate(slot + 1, newStr, 
          [...monsters, { hrid: spawn.combatMonsterHrid, tier: spawn.difficultyTier }], 
          prob * pickProb);
      }
    }
  }
  
  function merge(monsters, prob) {
    if (prob <= 0 || monsters.length === 0) return;
    const key = monsters.map(m => m.hrid + ":" + m.tier).sort().join("|");
    const existing = results.get(key);
    if (existing) {
      existing.prob += prob;
    } else {
      results.set(key, { monsters: [...monsters], prob });
    }
  }
  
  enumerate(0, 0, [], 1.0);
  return Array.from(results.values());
}

// Compute expected XP per random wave for each phase
console.log("=== Expected XP per random wave by phase ===");
const phaseExpectedXP = {};
for (const phaseKey of Object.keys(di.randomSpawnInfoMap)) {
  const compositions = enumeratePhase(phaseKey);
  let expectedXP = 0;
  let totalProb = 0;
  for (const comp of compositions) {
    const compXP = comp.monsters.reduce((s, m) => s + monsterXP(m.hrid, m.tier), 0);
    expectedXP += compXP * comp.prob;
    totalProb += comp.prob;
  }
  // Account for empty compositions (all spawns exceed strength)
  console.log(`Phase ${phaseKey}: expectedXP=${expectedXP.toFixed(1)} per wave (${compositions.length} compositions, totalProb=${totalProb.toFixed(4)})`);
  phaseExpectedXP[phaseKey] = expectedXP;
}

// Map out all 65 waves
console.log("\n=== Per-wave XP breakdown ===");
const waveKeys = Object.keys(di.randomSpawnInfoMap).map(Number).sort((a, b) => a - b);
const fixedKeys = Object.keys(di.fixedSpawnsMap).map(Number).sort((a, b) => a - b);

let totalDungeonXP = 0;
for (let wave = 1; wave <= 65; wave++) {
  let waveXP;
  let waveType;
  
  if (fixedKeys.includes(wave)) {
    // Fixed spawn
    const spawns = di.fixedSpawnsMap[wave.toString()];
    waveXP = spawns.reduce((s, spawn) => s + monsterXP(spawn.combatMonsterHrid, spawn.difficultyTier), 0);
    waveType = "fixed";
  } else {
    // Random spawn - determine phase
    let phase = waveKeys[0];
    if (wave > waveKeys[waveKeys.length - 1]) {
      phase = waveKeys[waveKeys.length - 1];
    } else {
      for (let i = 0; i < waveKeys.length - 1; i++) {
        if (wave >= waveKeys[i] && wave <= waveKeys[i + 1]) {
          phase = waveKeys[i];
          break;
        }
      }
    }
    waveXP = phaseExpectedXP[phase];
    waveType = `random(phase${phase})`;
  }
  
  totalDungeonXP += waveXP;
  if (wave <= 5 || wave >= 61 || fixedKeys.includes(wave)) {
    console.log(`Wave ${wave}: ${waveXP.toFixed(0)} XP [${waveType}]`);
  }
}

console.log(`\n=== Total raw monster XP per dungeon: ${totalDungeonXP.toFixed(0)} ===`);
console.log(`Per-player (5 players): ${(totalDungeonXP / 5).toFixed(0)}`);

// Now estimate with experience rate
// Average kill time: ~11s for regular waves, ~20s for boss waves
// Enrage: 180s regular, 600s boss
const avgExpRateRegular = 1 + 11 / 180;  // ~1.061
const avgExpRateBoss = 1 + 20 / 600;      // ~1.033
console.log(`\nWith experience rate (estimated):`);

let totalWithRate = 0;
for (let wave = 1; wave <= 65; wave++) {
  let waveXP;
  let isBoss = fixedKeys.includes(wave);
  
  if (isBoss) {
    const spawns = di.fixedSpawnsMap[wave.toString()];
    waveXP = spawns.reduce((s, spawn) => s + monsterXP(spawn.combatMonsterHrid, spawn.difficultyTier), 0);
    totalWithRate += waveXP * avgExpRateBoss;
  } else {
    let phase = waveKeys[0];
    if (wave > waveKeys[waveKeys.length - 1]) phase = waveKeys[waveKeys.length - 1];
    else for (let i = 0; i < waveKeys.length - 1; i++) {
      if (wave >= waveKeys[i] && wave <= waveKeys[i + 1]) { phase = waveKeys[i]; break; }
    }
    waveXP = phaseExpectedXP[phase];
    totalWithRate += waveXP * avgExpRateRegular;
  }
}
console.log(`Total with rate: ${totalWithRate.toFixed(0)}`);
console.log(`Per-player: ${(totalWithRate / 5).toFixed(0)}`);

// Now apply gragatrim's multipliers
const combatExpBonus = 1.8475;
const magicBonus = 1.196;
const gragXpPerDungeon = (totalWithRate / 5) * combatExpBonus * magicBonus;
console.log(`\nGragatrim XP per dungeon (estimated): ${gragXpPerDungeon.toFixed(0)}`);
console.log(`At 4.57 dungeons/hr: ${(gragXpPerDungeon * 4.57).toFixed(0)} XP/hr`);
console.log(`At 4.66 dungeons/hr: ${(gragXpPerDungeon * 4.66).toFixed(0)} XP/hr`);
console.log(`Expected from game: 937,900 XP/hr`);
