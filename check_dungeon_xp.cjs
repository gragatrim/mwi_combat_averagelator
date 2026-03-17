const fs = require("fs");
const gd = JSON.parse(fs.readFileSync("public/init_client_data.json", "utf-8"));

const zone = gd.actionDetailMap["/actions/combat/pirate_cove"];
const dungeonInfo = zone.combatZoneInfo.dungeonInfo;
const randomSpawnInfoMap = dungeonInfo.randomSpawnInfoMap;
const fixedSpawnsMap = dungeonInfo.fixedSpawnsMap;
const maxWaves = dungeonInfo.maxWaves;

const EXP_MULT_PER_TIER = 0.5;
const EXP_BONUS_PER_TIER = 5;
const zoneTier = 0; // T1 in UI = difficulty 0

function scaledXp(baseXp, diffTier) {
  const totalTier = diffTier + zoneTier;
  const mult = 1 + EXP_MULT_PER_TIER * totalTier;
  const bonus = EXP_BONUS_PER_TIER * totalTier;
  return mult * (baseXp + bonus);
}

// Enumerate all compositions for a given phase's spawn info
function enumerateCompositions(spawnInfo) {
  if (!spawnInfo.spawns || spawnInfo.spawns.length === 0) {
    return [{ monsters: [], probability: 1.0 }];
  }

  const totalRate = spawnInfo.spawns.reduce((s, sp) => s + sp.rate, 0);
  if (totalRate === 0) return [{ monsters: [], probability: 1.0 }];

  const results = new Map();

  function fillSlot(slot, currentStrength, monsters, prob) {
    if (slot >= spawnInfo.maxSpawnCount) {
      merge(monsters, prob);
      return;
    }

    for (const spawn of spawnInfo.spawns) {
      const pickProb = spawn.rate / totalRate;
      const newStrength = currentStrength + spawn.strength;

      if (newStrength > spawnInfo.maxTotalStrength) {
        merge(monsters, prob * pickProb);
      } else {
        fillSlot(slot + 1, newStrength, [...monsters, spawn], prob * pickProb);
      }
    }
  }

  function merge(monsters, prob) {
    if (prob <= 0) return;
    const key = monsters.map(m => m.combatMonsterHrid + ":" + m.difficultyTier).sort().join("|");
    const existing = results.get(key);
    if (existing) {
      existing.probability += prob;
    } else {
      results.set(key, { monsters: [...monsters], probability: prob });
    }
  }

  fillSlot(0, 0, [], 1.0);
  return Array.from(results.values());
}

// Compute weighted average XP for a set of compositions
function weightedAvgXp(compositions) {
  let totalWeightedXp = 0;
  for (const comp of compositions) {
    let compXp = 0;
    for (const mon of comp.monsters) {
      const monData = gd.combatMonsterDetailMap[mon.combatMonsterHrid];
      if (monData) {
        compXp += scaledXp(monData.experience, mon.difficultyTier);
      }
    }
    totalWeightedXp += compXp * comp.probability;
  }
  return totalWeightedXp;
}

// Compute most-probable XP
function mostProbableXp(compositions) {
  let bestProb = 0;
  let bestXp = 0;
  for (const comp of compositions) {
    if (comp.probability > bestProb) {
      bestProb = comp.probability;
      let compXp = 0;
      for (const mon of comp.monsters) {
        const monData = gd.combatMonsterDetailMap[mon.combatMonsterHrid];
        if (monData) {
          compXp += scaledXp(monData.experience, mon.difficultyTier);
        }
      }
      bestXp = compXp;
    }
  }
  return bestXp;
}

// Compute expected (schedule-like) XP
function scheduleAvgXp(compositions, wavesInPhase) {
  // Build schedule similar to buildEncounterSchedule
  const CYCLE_LENGTH = 100;
  const sorted = [...compositions].sort((a, b) => b.probability - a.probability);
  const totalProb = sorted.reduce((s, e) => s + e.probability, 0);

  const schedule = [];
  let remaining = CYCLE_LENGTH;
  for (let i = 0; i < sorted.length; i++) {
    const enc = sorted[i];
    const count = i === sorted.length - 1
      ? remaining
      : Math.max(1, Math.round((enc.probability / totalProb) * CYCLE_LENGTH));
    for (let j = 0; j < count && remaining > 0; j++) {
      schedule.push(enc);
      remaining--;
    }
  }

  // Compute XP from the first wavesInPhase elements of the schedule
  let totalXp = 0;
  for (let w = 0; w < wavesInPhase; w++) {
    const comp = schedule[w % schedule.length];
    let compXp = 0;
    for (const mon of comp.monsters) {
      const monData = gd.combatMonsterDetailMap[mon.combatMonsterHrid];
      if (monData) {
        compXp += scaledXp(monData.experience, mon.difficultyTier);
      }
    }
    totalXp += compXp;
  }
  return totalXp;
}

// Walk through all 65 waves
let totalWeightedXp = 0;
let totalMostProbXp = 0;
let totalScheduleXp = 0;
let totalFixedXp = 0;

const phaseWaveCounts = { "0": 0, "20": 0, "40": 0 };
const waveKeys = Object.keys(randomSpawnInfoMap).map(Number).sort((a, b) => a - b);

console.log("=== Wave-by-Wave Analysis (with tier scaling) ===");

// Track waves per phase
let dungeonWaveIndex = 0;
for (let wave = 1; wave <= maxWaves; wave++) {
  const waveStr = wave.toString();

  if (fixedSpawnsMap && fixedSpawnsMap[waveStr]) {
    // Fixed wave
    const fixedMons = fixedSpawnsMap[waveStr];
    let waveXp = 0;
    for (const mon of fixedMons) {
      const monData = gd.combatMonsterDetailMap[mon.combatMonsterHrid];
      if (monData) {
        waveXp += scaledXp(monData.experience, mon.difficultyTier);
      }
    }
    totalFixedXp += waveXp;
    totalWeightedXp += waveXp;
    totalMostProbXp += waveXp;
    totalScheduleXp += waveXp;
    if (wave <= 5 || wave % 10 === 0 || wave >= 60)
      console.log(`Wave ${wave} (fixed): ${waveXp.toFixed(0)} XP`);
  } else {
    // Random wave - find the phase
    let phaseKey = waveKeys[0];
    for (const key of waveKeys) {
      if (wave >= key) phaseKey = key;
    }

    const spawnInfo = randomSpawnInfoMap[phaseKey];
    const comps = enumerateCompositions(spawnInfo);

    const wAvg = weightedAvgXp(comps);
    const mProb = mostProbableXp(comps);

    totalWeightedXp += wAvg;
    totalMostProbXp += mProb;

    // For schedule: compute which composition the schedule would pick
    // (approximate by tracking index per phase)
    phaseWaveCounts[phaseKey] = (phaseWaveCounts[phaseKey] || 0) + 1;

    if (wave <= 5 || wave % 10 === 0 || wave >= 60)
      console.log(`Wave ${wave} (random, phase ${phaseKey}): wAvg=${wAvg.toFixed(0)} mostProb=${mProb.toFixed(0)} comps=${comps.length}`);
  }
}

// Compute schedule XP per phase
for (const [phase, count] of Object.entries(phaseWaveCounts)) {
  const spawnInfo = randomSpawnInfoMap[phase];
  const comps = enumerateCompositions(spawnInfo);
  totalScheduleXp += scheduleAvgXp(comps, count);
}

console.log("\n=== Total Dungeon XP (with tier scaling) ===");
console.log("Weighted average: " + totalWeightedXp.toFixed(0));
console.log("Most probable:    " + totalMostProbXp.toFixed(0));
console.log("Schedule (100):   " + totalScheduleXp.toFixed(0));
console.log("Fixed waves only: " + totalFixedXp.toFixed(0));

// Now compute expected XP per dungeon from user data
// gragatrim: 937,900 XP/hr, combatExpBonus=1.8475, magicExp=0.196
// XP/hr = (totalMonsterXP / 5) * combatExpBonus * (1 + skillExp) * experienceRate_avg * dungeons/hr
const dungeonsPerHr = 4.57;
const combatExpBonusGrag = 1.8475;
const magicExpGrag = 0.196;
const expectedXpHrGrag = 937900;

// XP per dungeon for gragatrim = XP/hr / dungeons/hr
const xpPerDungeonGrag = expectedXpHrGrag / dungeonsPerHr;
console.log("\n=== Expected Values (gragatrim) ===");
console.log("XP per dungeon: " + xpPerDungeonGrag.toFixed(0));

// Work backwards: raw monster XP per dungeon
// xpPerDungeon = (rawMonsterXP / 5) * combatExpBonus * (1 + magicExp) * avgExperienceRate
// Assume avgExperienceRate ≈ 1.067 (12s avg kill / 180s enrage)
const avgExpRate = 1.067;
const rawMonsterXpExpected = xpPerDungeonGrag * 5 / (combatExpBonusGrag * (1 + magicExpGrag) * avgExpRate);
console.log("Implied raw monster XP per dungeon: " + rawMonsterXpExpected.toFixed(0));
console.log("Our weighted avg: " + totalWeightedXp.toFixed(0));
console.log("Ratio (ours/expected): " + (totalWeightedXp / rawMonsterXpExpected).toFixed(3));

// Also try with different experience rates
for (const er of [1.0, 1.05, 1.067, 1.1]) {
  const raw = xpPerDungeonGrag * 5 / (combatExpBonusGrag * (1 + magicExpGrag) * er);
  console.log(`  At experienceRate=${er}: implied raw=${raw.toFixed(0)}, ratio=${(totalWeightedXp / raw).toFixed(3)}`);
}
