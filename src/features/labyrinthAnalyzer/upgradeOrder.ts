// =============================================================================
// Upgrade priority ranking
// =============================================================================
// Greedy: each iteration we pick the next upgrade with the highest expected
// boxes-per-month-per-token. Capacity upgrades (torch/shroud/beacon/cooldown)
// have direct effects on the torch budget. Skill upgrades recompute every
// per-skill maxClearable via the same Markov chain used for the headline
// thresholds, so the marginal value reflects the actual change in floor
// clear rate. Combat upgrades use a coarse effective-level approximation
// because re-running the combat simulator per candidate is too expensive
// (see COMBAT_LEVEL_BOOST_PER_UPGRADE for derivations).

import type {
  FloorResult,
  SkillRoomData,
  CombatRoomData,
  UpgradePriorityEntry,
  UpgradeLevels,
  UpgradeType,
} from "./types";
import type { CombatLoadoutProfile } from "./skillBuffs";
import {
  LAB_UPGRADE_PER_LEVEL,
  LAB_UPGRADE_MAX_LEVEL,
  getUpgradeCost,
  LAB_UPGRADE_DISPLAY,
  FLOORS,
  FLOOR_EXIT_REWARDS,
} from "./constants";
import { computeTorchBudget } from "./torchBudget";
import { floorClearFraction } from "./floorAnalysis";

// =============================================================================
// Combat upgrade approximation (per-room, build-aware)
// =============================================================================
// We cannot re-run the combat sim per candidate, so we approximate each
// upgrade's effective-level boost. The approximation is BUILD-AWARE: cast
// speed and attack speed depend on whether the player's loadout for that
// monster relies on damage spells or auto-attacks.
//
//   • combatDamage  +1%/lv ≈ +1 enemy level survivable for every room (monster
//                             HP scales ~linearly with level).
//   • criticalRate  +1%/lv ≈ +0.5 for every room (1% crit ≈ 0.5% DPS at a
//                             typical 1.5× crit multiplier).
//   • attackSpeed   +1%/lv ≈ +autoDpsShare (auto-attacks always run, but a
//                             loadout heavy in damage spells spends less of
//                             the cycle auto-attacking).
//   • castSpeed     +1%/lv ≈ +spellDpsShare (only valuable for loadouts that
//                             actually cast damage spells; ZERO for buff-only
//                             rotations even on a magic loadout).
//
// spellDpsShare = min(0.7, 0.15 × damageAbilityCount). 0 dmg abs → 0,
// 5 dmg abs → 0.7. autoDpsShare = 1 − spellDpsShare.
function combatBoostPerRoom(
  type: UpgradeType,
  profile: CombatLoadoutProfile | null
): number {
  const dmgAbs = profile?.damageAbilityCount ?? 0;
  const spellDpsShare = Math.min(0.7, 0.15 * dmgAbs);
  const autoDpsShare = 1 - spellDpsShare;
  switch (type) {
    case "combatDamage": return 1.0;
    case "criticalRate": return 0.5;
    case "attackSpeed":  return autoDpsShare;
    case "castSpeed":    return spellDpsShare;
    default: return 0;
  }
}

/** Convert a combat room display name (e.g. "Frost Sniper") to a monster hrid. */
function combatRoomNameToHrid(displayName: string): string {
  const snake = displayName.toLowerCase().replace(/\s+/g, "_");
  return `/monsters/${snake}`;
}

// =============================================================================
// Helpers
// =============================================================================

function computeTargetFloor(maxFloorNoShrouds: number, shroudCount: number): number {
  const base = maxFloorNoShrouds;
  if (shroudCount >= 8) return base + 3;
  if (shroudCount >= 5) return base + 2;
  return base + 1;
}

function exitBoxesUpTo(floor: number): number {
  let s = 0;
  for (let f = 4; f <= floor; f++) s += FLOOR_EXIT_REWARDS[f]?.[1] ?? 0;
  return s;
}

function buildFloorResults(
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  combatLevelBoost: number | number[] = 0,
): FloorResult[] {
  const perRoom: number[] = Array.isArray(combatLevelBoost)
    ? combatLevelBoost
    : combatData.map(() => combatLevelBoost);
  const out: FloorResult[] = [];
  for (const [floorNum, fmin, fmax, grid] of FLOORS) {
    const skillFracs = skillData.map(s => floorClearFraction(s.maxClearable, fmin, fmax));
    const combatFracs = combatData.map((c, i) =>
      floorClearFraction(c.maxClearable + (perRoom[i] ?? 0), fmin, fmax)
    );
    const skillAvg = skillFracs.reduce((a, b) => a + b, 0) / Math.max(1, skillFracs.length);
    const combatAvg = combatFracs.reduce((a, b) => a + b, 0) / Math.max(1, combatFracs.length);
    const overall = (skillAvg + combatAvg) / 2;
    out.push({
      floor: floorNum, min: fmin, max: fmax, grid,
      skill: skillAvg, combat: combatAvg,
      overall, blocked: 1 - overall,
      skillFracs, combatFracs,
    });
  }
  return out;
}

function computeBoxesPerRun(
  targetFloor: number,
  floorResults: FloorResult[],
  torchCount: number,
  beaconCount: number,
): number {
  const budget = computeTorchBudget(torchCount, targetFloor, floorResults, beaconCount);
  const exitBoxes = exitBoxesUpTo(targetFloor);
  const detourBoxes = budget.reduce((s, b) => s + b.expectedBoxes, 0);
  return exitBoxes + detourBoxes;
}

function makeEntry(
  type: UpgradeType,
  nextLevel: number,
  deltaBoxesMonth: number,
  description: string,
): UpgradePriorityEntry {
  const cost = getUpgradeCost(type, nextLevel);
  const category = LAB_UPGRADE_DISPLAY[type].category;
  return {
    type, level: nextLevel, cost,
    deltaBoxesMonth: Math.round(deltaBoxesMonth * 100) / 100,
    valuePerToken: 0,
    description,
    category,
  };
}

// =============================================================================
// Skill data recompute callback
// =============================================================================
// Caller supplies a function that returns the skillData (one entry per
// labyrinth skill, with a fresh maxClearable for each) given a hypothetical
// set of skill-upgrade levels. The caller owns charData/gameData; we only
// need the four skill upgrade level overrides.

export interface SkillUpgradeOverrideLevels {
  skillSpeed: number;
  skillEfficiency: number;
  skillSuccess: number;
  skillDoubleProgress: number;
}

export type RecomputeSkillData = (overrides: SkillUpgradeOverrideLevels) => SkillRoomData[];

// =============================================================================
// Marginal value functions
// =============================================================================

function mvTorch(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloor: number,
  runsPerMonth: number,
  beaconCount: number,
): UpgradePriorityEntry | null {
  if (simLevels.torch >= LAB_UPGRADE_MAX_LEVEL.torch) return null;
  const oldT = 100 + simLevels.torch * LAB_UPGRADE_PER_LEVEL.torch;
  const newT = oldT + LAB_UPGRADE_PER_LEVEL.torch;
  const oldBudget = computeTorchBudget(oldT, targetFloor, baselineFloorResults, beaconCount);
  const newBudget = computeTorchBudget(newT, targetFloor, baselineFloorResults, beaconCount);
  const deltaBoxesRun = newBudget.reduce((s, b) => s + b.expectedBoxes, 0)
                      - oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  return makeEntry("torch", simLevels.torch + 1, deltaBoxesRun * runsPerMonth, `${newT}T. +${deltaBoxesRun.toFixed(1)} boxes/run.`);
}

function mvCooldown(
  simLevels: UpgradeLevels,
  boxesPerRun: number,
): UpgradePriorityEntry | null {
  if (simLevels.cooldown >= LAB_UPGRADE_MAX_LEVEL.cooldown) return null;
  const oldCd = 72 + simLevels.cooldown * LAB_UPGRADE_PER_LEVEL.cooldown;
  const newCd = oldCd + LAB_UPGRADE_PER_LEVEL.cooldown;
  const oldRuns = (30 * 24) / oldCd;
  const newRuns = (30 * 24) / newCd;
  const deltaRuns = newRuns - oldRuns;
  const dbm = deltaRuns * boxesPerRun;
  return makeEntry("cooldown", simLevels.cooldown + 1, dbm, `${newCd}h. +${deltaRuns.toFixed(1)} runs/mo.`);
}

function mvShroud(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloorOverride: number | null,
  maxFloorNoShrouds: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
): UpgradePriorityEntry | null {
  if (simLevels.shroud >= LAB_UPGRADE_MAX_LEVEL.shroud) return null;
  const oldS = 4 + simLevels.shroud * LAB_UPGRADE_PER_LEVEL.shroud;
  const newS = oldS + LAB_UPGRADE_PER_LEVEL.shroud;
  const oldTarget = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, oldS);
  const newTarget = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, newS);

  let dbm: number;
  let desc: string;
  if (newTarget !== oldTarget) {
    const oldBoxes = computeBoxesPerRun(oldTarget, baselineFloorResults, torchCount, beaconCount);
    const newBoxes = computeBoxesPerRun(newTarget, baselineFloorResults, torchCount, beaconCount);
    dbm = (newBoxes - oldBoxes) * runsPerMonth;
    desc = `${newS}S. Unlocks F${newTarget}!`;
  } else {
    // Reroll-blocker model: each shroud rerolls one blocked room. With S
    // shrouds and per-floor blocked fraction b, expected blocked rooms after
    // rerolls drop ~geometrically. The marginal effect of +1 shroud on the
    // average clear rate is approximately b * (1 - b) / floorsBlocked, applied
    // to the floors closest to the percolation cliff. We compute the implied
    // clearRate boost on the bottleneck floor (the one with overall closest
    // to but below 0.59) and rerun the budget on those modified floor results.
    const bottleneck = baselineFloorResults
      .filter(f => f.floor <= oldTarget && f.overall < 0.95)
      .sort((a, b) => Math.abs(0.59 - a.overall) - Math.abs(0.59 - b.overall))[0];
    if (!bottleneck) {
      // No room to improve — set marginal value tiny but nonzero so it still ranks.
      dbm = 0;
      desc = `${newS}S. (All floors near-saturated.)`;
    } else {
      const blocked = bottleneck.blocked;
      // Marginal clear-rate gain from +1 shroud: roughly 10% * blocked, capped.
      const clearGain = Math.min(0.20, 0.10 * blocked);
      const modified = baselineFloorResults.map(f => {
        if (f.floor !== bottleneck.floor) return f;
        const newOverall = Math.min(0.99, f.overall + clearGain);
        return { ...f, overall: newOverall, blocked: 1 - newOverall };
      });
      const oldBoxes = computeBoxesPerRun(oldTarget, baselineFloorResults, torchCount, beaconCount);
      const newBoxes = computeBoxesPerRun(oldTarget, modified, torchCount, beaconCount);
      dbm = (newBoxes - oldBoxes) * runsPerMonth;
      desc = `${newS}S. F${bottleneck.floor} +${(clearGain * 100).toFixed(1)}% clear.`;
    }
  }
  return makeEntry("shroud", simLevels.shroud + 1, dbm, desc);
}

function mvBeacon(
  simLevels: UpgradeLevels,
  baselineFloorResults: FloorResult[],
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
): UpgradePriorityEntry | null {
  if (simLevels.beacon >= LAB_UPGRADE_MAX_LEVEL.beacon) return null;
  const oldBudget = computeTorchBudget(torchCount, targetFloor, baselineFloorResults, beaconCount);
  const newBudget = computeTorchBudget(torchCount, targetFloor, baselineFloorResults, beaconCount + LAB_UPGRADE_PER_LEVEL.beacon);
  const deltaBoxesRun = newBudget.reduce((s, b) => s + b.expectedBoxes, 0)
                      - oldBudget.reduce((s, b) => s + b.expectedBoxes, 0);
  return makeEntry("beacon", simLevels.beacon + 1, deltaBoxesRun * runsPerMonth, `${beaconCount + 1}B. +${deltaBoxesRun.toFixed(1)} boxes/run.`);
}

/**
 * Evaluate a hypothetical skill-upgrade state. Returns the dbm and the
 * hybrid score for "buying levels from cur+1 up to targetLevel" of `type`.
 *
 * Tier evaluation matters because SR / DP are step-function: a single +0.5%
 * SR rarely flips any skill room's maxClearable, but +3% (6 levels) often
 * does. Single-level greedy thus underrates SR/DP relative to efficiency
 * (which gives +1% workpower per level — smoother). Tier scoring lets us
 * see the cumulative effect and pick the type whose long-tail is worth the
 * total token cost, even when its first level looks like noise.
 */
function evalSkillTier(
  type: UpgradeType,
  targetLevel: number,
  simLevels: UpgradeLevels,
  combatData: CombatRoomData[],
  recomputeSkillData: RecomputeSkillData,
  baselineSkillData: SkillRoomData[],
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
  baselineBoxesPerRun: number,
  skillDataCache: Map<string, SkillRoomData[]>,
): { dbm: number; cost: number; levels: number } {
  const overrides: SkillUpgradeOverrideLevels = {
    skillSpeed: simLevels.skillSpeed,
    skillEfficiency: simLevels.skillEfficiency,
    skillSuccess: simLevels.skillSuccess,
    skillDoubleProgress: simLevels.skillDoubleProgress,
  };
  (overrides as unknown as Record<string, number>)[type] = targetLevel;

  const cacheKey = `${overrides.skillSpeed},${overrides.skillEfficiency},${overrides.skillSuccess},${overrides.skillDoubleProgress}`;
  let newSkillData = skillDataCache.get(cacheKey);
  if (!newSkillData) {
    newSkillData = recomputeSkillData(overrides);
    skillDataCache.set(cacheKey, newSkillData);
  }

  const skillForFloor = newSkillData.length > 0 ? newSkillData : baselineSkillData;
  const newFr = buildFloorResults(skillForFloor, combatData, 0);
  const newBoxes = computeBoxesPerRun(targetFloor, newFr, torchCount, beaconCount);
  const dbm = Math.max(0, (newBoxes - baselineBoxesPerRun) * runsPerMonth);

  const curLevel = (simLevels as unknown as Record<string, number>)[type] ?? 0;
  let cost = 0;
  for (let lv = curLevel + 1; lv <= targetLevel; lv++) cost += getUpgradeCost(type, lv);
  return { dbm, cost, levels: targetLevel - curLevel };
}

/**
 * Skill upgrade marginal value with TIER LOOKAHEAD.
 *
 * We evaluate buying +1, half-way to max, and full-way to max for the type.
 * The hybrid score is the maximum of (dbm × √(1000/cost)) across these
 * lookahead depths — so a type whose first level is noise but whose full
 * tier is a big shift gets its long-tail credit. The emitted entry is always
 * the next single level (we still commit one level at a time so the user
 * can re-evaluate after each purchase), but the description tells them this
 * level is part of a tier-justified investment.
 */
function mvSkill(
  type: UpgradeType,
  simLevels: UpgradeLevels,
  combatData: CombatRoomData[],
  recomputeSkillData: RecomputeSkillData | null,
  baselineSkillData: SkillRoomData[],
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
  baselineBoxesPerRun: number,
  skillDataCache: Map<string, SkillRoomData[]>,
): { entry: UpgradePriorityEntry; tierScore: number } | null {
  const lv = (simLevels as unknown as Record<string, number>)[type] ?? 0;
  if (lv >= LAB_UPGRADE_MAX_LEVEL[type]) return null;
  if (!recomputeSkillData) return null;

  const maxLv = LAB_UPGRADE_MAX_LEVEL[type];
  const remaining = maxLv - lv;
  const lookaheads = remaining >= 4 ? [lv + 1, lv + Math.ceil(remaining / 2), maxLv]
                  : remaining >= 2 ? [lv + 1, maxLv]
                  : [maxLv];

  let bestTierScore = 0;
  let bestTierDbm = 0;
  let bestTierLevels = 0;
  let bestTierCost = 0;
  let singleDbm = 0;
  for (const target of lookaheads) {
    const { dbm, cost, levels } = evalSkillTier(
      type, target, simLevels, combatData, recomputeSkillData,
      baselineSkillData, targetFloor, torchCount, beaconCount,
      runsPerMonth, baselineBoxesPerRun, skillDataCache,
    );
    if (target === lv + 1) singleDbm = dbm;
    const score = cost > 0 ? dbm * Math.sqrt(1000 / cost) : 0;
    if (score > bestTierScore) {
      bestTierScore = score;
      bestTierDbm = dbm;
      bestTierCost = cost;
      bestTierLevels = levels;
    }
  }

  // The entry we emit is for the NEXT single level only. We commit one level
  // at a time and re-evaluate so cross-type interactions get exercised.
  const singleCost = getUpgradeCost(type, lv + 1);
  const display = LAB_UPGRADE_DISPLAY[type];
  const newPct = (lv + 1) * (LAB_UPGRADE_PER_LEVEL[type] * 100);
  const newPctStr = type === "skillSuccess" ? newPct.toFixed(1) : Math.round(newPct).toString();
  let desc = `${display.name} +${newPctStr}%.`;
  if (bestTierLevels > 1 && bestTierDbm > singleDbm * 1.5) {
    desc += ` (tier +${bestTierLevels} → ${bestTierDbm.toFixed(1)} dbm @ ${bestTierCost}T)`;
  }
  const entry = makeEntry(type, lv + 1, singleDbm, desc);
  // Override valuePerToken using single cost; tierScore is what greedy uses.
  entry.cost = singleCost;
  return { entry, tierScore: bestTierScore };
}

/**
 * Evaluate combat upgrade impact at a hypothetical level. Per-room boost is
 * proportional to the level delta, so this reduces to scaling perRoomBoost
 * by `levels`. Returns dbm, cost, and the perRoomBoost vector at the +1 step
 * (unscaled).
 */
function evalCombatTier(
  type: UpgradeType,
  targetLevel: number,
  simLevels: UpgradeLevels,
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  combatLoadoutProfiles: Map<string, CombatLoadoutProfile> | null,
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
  baselineBoxesPerRun: number,
): { dbm: number; cost: number; levels: number; perRoomBoostUnit: number[] } {
  const curLv = (simLevels as unknown as Record<string, number>)[type] ?? 0;
  const levels = targetLevel - curLv;
  const perRoomBoostUnit = combatData.map(c => {
    const profile = combatLoadoutProfiles?.get(combatRoomNameToHrid(c.name)) ?? null;
    return combatBoostPerRoom(type, profile);
  });
  const perRoomBoost = perRoomBoostUnit.map(b => b * levels);
  const newFr = buildFloorResults(skillData, combatData, perRoomBoost);
  const newBoxes = computeBoxesPerRun(targetFloor, newFr, torchCount, beaconCount);
  const dbm = Math.max(0, (newBoxes - baselineBoxesPerRun) * runsPerMonth);
  let cost = 0;
  for (let lv = curLv + 1; lv <= targetLevel; lv++) cost += getUpgradeCost(type, lv);
  return { dbm, cost, levels, perRoomBoostUnit };
}

/**
 * Combat upgrade marginal value with TIER LOOKAHEAD (analogous to mvSkill).
 * Combat boost scales linearly with level (no Markov-chain step function),
 * so tier vs single value differs less than for skill upgrades — but we use
 * the same machinery for consistency and for cases where the +1 level
 * happens to land on a percolation cliff.
 */
function mvCombat(
  type: UpgradeType,
  simLevels: UpgradeLevels,
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  combatLoadoutProfiles: Map<string, CombatLoadoutProfile> | null,
  targetFloor: number,
  torchCount: number,
  beaconCount: number,
  runsPerMonth: number,
  baselineBoxesPerRun: number,
): { entry: UpgradePriorityEntry; tierScore: number } | null {
  const lv = (simLevels as unknown as Record<string, number>)[type] ?? 0;
  if (lv >= LAB_UPGRADE_MAX_LEVEL[type]) return null;

  const maxLv = LAB_UPGRADE_MAX_LEVEL[type];
  const remaining = maxLv - lv;
  const lookaheads = remaining >= 4 ? [lv + 1, lv + Math.ceil(remaining / 2), maxLv]
                  : remaining >= 2 ? [lv + 1, maxLv]
                  : [maxLv];

  let bestTierScore = 0;
  let bestTierDbm = 0;
  let bestTierLevels = 0;
  let bestTierCost = 0;
  let singleDbm = 0;
  let perRoomUnit: number[] = [];
  for (const target of lookaheads) {
    const { dbm, cost, levels, perRoomBoostUnit } = evalCombatTier(
      type, target, simLevels, skillData, combatData, combatLoadoutProfiles,
      targetFloor, torchCount, beaconCount, runsPerMonth, baselineBoxesPerRun,
    );
    if (target === lv + 1) singleDbm = dbm;
    perRoomUnit = perRoomBoostUnit;
    const score = cost > 0 ? dbm * Math.sqrt(1000 / cost) : 0;
    if (score > bestTierScore) {
      bestTierScore = score;
      bestTierDbm = dbm;
      bestTierCost = cost;
      bestTierLevels = levels;
    }
  }

  // Skip if every room has zero boost — upgrade is structurally worthless
  // for this build (e.g. castSpeed with no damage abilities anywhere).
  if (perRoomUnit.every(b => b === 0)) return null;

  const display = LAB_UPGRADE_DISPLAY[type];
  const newPct = (lv + 1) * (LAB_UPGRADE_PER_LEVEL[type] * 100);
  const avgBoost = perRoomUnit.reduce((a, b) => a + b, 0) / perRoomUnit.length;
  let desc = `${display.name} +${Math.round(newPct)}% (avg ${avgBoost.toFixed(2)} lv/room).`;
  if (bestTierLevels > 1 && bestTierDbm > singleDbm * 1.5) {
    desc += ` (tier +${bestTierLevels} → ${bestTierDbm.toFixed(1)} dbm @ ${bestTierCost}T)`;
  }
  const entry = makeEntry(type, lv + 1, singleDbm, desc);
  return { entry, tierScore: bestTierScore };
}

function mvFullAuto(simLevels: UpgradeLevels): UpgradePriorityEntry | null {
  if (simLevels.fullAuto >= LAB_UPGRADE_MAX_LEVEL.fullAuto) return null;
  const newLv = simLevels.fullAuto + 1;
  return makeEntry("fullAuto", newLv, 0, `Auto-completes ${newLv} floors. Time saver, no box gain.`);
}

function mvExperience(simLevels: UpgradeLevels): UpgradePriorityEntry | null {
  if (simLevels.experience >= LAB_UPGRADE_MAX_LEVEL.experience) return null;
  const newLv = simLevels.experience + 1;
  return makeEntry("experience", newLv, 0, `+${newLv}% combat XP in lab. No box gain.`);
}

// =============================================================================
// Public API
// =============================================================================

export function computeUpgradeOrder(
  upgradeLevels: UpgradeLevels,
  targetFloorOverride: number | null,
  baselineFloorResults: FloorResult[],
  maxFloorNoShrouds: number,
  baselineSkillData: SkillRoomData[],
  baselineCombatData: CombatRoomData[],
  recomputeSkillData?: RecomputeSkillData | null,
  combatLoadoutProfiles?: Map<string, CombatLoadoutProfile> | null,
): UpgradePriorityEntry[] {
  const simLevels: UpgradeLevels = { ...upgradeLevels };
  const order: UpgradePriorityEntry[] = [];

  // Cache skill data recomputes by the 4-skill-level signature. Across the
  // greedy loop we reuse a result for any candidate that probes the same
  // override combination.
  const skillDataCache = new Map<string, SkillRoomData[]>();

  // Per-iteration we also cache the latest skillData and floorResults so that
  // capacity, cooldown, beacon, shroud, and combat candidates all see the same
  // up-to-date baseline.
  let currentSkillData = baselineSkillData;
  let currentFloorResults = baselineFloorResults;
  let lastSkillSig = `${simLevels.skillSpeed},${simLevels.skillEfficiency},${simLevels.skillSuccess},${simLevels.skillDoubleProgress}`;

  const maxIterations = Object.keys(LAB_UPGRADE_DISPLAY).reduce(
    (s, t) => s + LAB_UPGRADE_MAX_LEVEL[t], 0,
  );

  for (let i = 0; i < maxIterations; i++) {
    // Refresh skillData/floorResults if any skill upgrade changed since last iter.
    const sig = `${simLevels.skillSpeed},${simLevels.skillEfficiency},${simLevels.skillSuccess},${simLevels.skillDoubleProgress}`;
    if (sig !== lastSkillSig) {
      if (recomputeSkillData) {
        let cached = skillDataCache.get(sig);
        if (!cached) {
          cached = recomputeSkillData({
            skillSpeed: simLevels.skillSpeed,
            skillEfficiency: simLevels.skillEfficiency,
            skillSuccess: simLevels.skillSuccess,
            skillDoubleProgress: simLevels.skillDoubleProgress,
          });
          skillDataCache.set(sig, cached);
        }
        if (cached.length > 0) currentSkillData = cached;
      }
      currentFloorResults = buildFloorResults(currentSkillData, baselineCombatData, 0);
      lastSkillSig = sig;
    }

    const torchCount = 100 + simLevels.torch * LAB_UPGRADE_PER_LEVEL.torch;
    const beaconCount = 5 + simLevels.beacon * LAB_UPGRADE_PER_LEVEL.beacon;
    const cdHours = 72 + simLevels.cooldown * LAB_UPGRADE_PER_LEVEL.cooldown;
    const shroudCount = 4 + simLevels.shroud * LAB_UPGRADE_PER_LEVEL.shroud;
    const target = targetFloorOverride ?? computeTargetFloor(maxFloorNoShrouds, shroudCount);
    const runsPerMonth = (30 * 24) / Math.max(1, cdHours);

    const baselineBoxes = computeBoxesPerRun(target, currentFloorResults, torchCount, beaconCount);

    // Build candidate list. Each candidate has an entry plus a `tierScore`
    // that drives selection. For capacity upgrades the tierScore equals the
    // single-level hybrid score (no useful lookahead since each level is
    // independent). For skill / combat upgrades the tierScore is the BEST
    // hybrid across {+1, half-tier, full-tier} — this captures the case
    // where +1 level looks like noise but a multi-level investment moves
    // the needle (SR / DP especially).
    interface Candidate { entry: UpgradePriorityEntry; tierScore: number }
    const candidates: Candidate[] = [];
    const singleHybrid = (e: UpgradePriorityEntry) =>
      e.cost > 0 ? e.deltaBoxesMonth * Math.sqrt(1000 / e.cost) : 0;
    const pushSingle = (e: UpgradePriorityEntry | null) => {
      if (e) candidates.push({ entry: e, tierScore: singleHybrid(e) });
    };
    const pushTier = (r: { entry: UpgradePriorityEntry; tierScore: number } | null) => {
      if (r) candidates.push(r);
    };

    pushSingle(mvTorch(simLevels, currentFloorResults, target, runsPerMonth, beaconCount));
    pushSingle(mvCooldown(simLevels, baselineBoxes));
    pushSingle(mvShroud(simLevels, currentFloorResults, targetFloorOverride, maxFloorNoShrouds, torchCount, beaconCount, runsPerMonth));
    pushSingle(mvBeacon(simLevels, currentFloorResults, target, torchCount, beaconCount, runsPerMonth));

    for (const t of ["skillSpeed", "skillEfficiency", "skillSuccess", "skillDoubleProgress"] as UpgradeType[]) {
      pushTier(mvSkill(
        t, simLevels, baselineCombatData, recomputeSkillData ?? null,
        currentSkillData, target, torchCount, beaconCount, runsPerMonth,
        baselineBoxes, skillDataCache,
      ));
    }
    for (const t of ["combatDamage", "attackSpeed", "castSpeed", "criticalRate"] as UpgradeType[]) {
      pushTier(mvCombat(
        t, simLevels, currentSkillData, baselineCombatData,
        combatLoadoutProfiles ?? null, target,
        torchCount, beaconCount, runsPerMonth, baselineBoxes,
      ));
    }
    pushSingle(mvFullAuto(simLevels));
    pushSingle(mvExperience(simLevels));

    if (candidates.length === 0) break;

    for (const c of candidates) {
      c.entry.valuePerToken = c.entry.cost > 0
        ? Math.round((c.entry.deltaBoxesMonth / c.entry.cost) * 1000 * 100) / 100
        : 0;
    }

    // Pick by tierScore. Tied tierScores fall back to single-level dbm, then
    // lower cost. We do NOT filter near-zero candidates here — a skill
    // upgrade whose +1 level dbm is zero may still have a nonzero tierScore
    // (e.g. SR +7 alone does nothing but SR +7..+12 moves rooms). The tier
    // score reflects that.
    const significant = candidates.filter(c => c.tierScore > 0);
    if (significant.length === 0) {
      const fallback = candidates.reduce((a, b) =>
        b.entry.deltaBoxesMonth > a.entry.deltaBoxesMonth ? b : a
      );
      order.push(fallback.entry);
      (simLevels as unknown as Record<string, number>)[fallback.entry.type] = fallback.entry.level;
      continue;
    }

    const best = significant.reduce((a, b) => {
      if (b.tierScore !== a.tierScore) return b.tierScore > a.tierScore ? b : a;
      if (b.entry.deltaBoxesMonth !== a.entry.deltaBoxesMonth) return b.entry.deltaBoxesMonth > a.entry.deltaBoxesMonth ? b : a;
      return b.entry.cost < a.entry.cost ? b : a;
    });

    order.push(best.entry);
    (simLevels as unknown as Record<string, number>)[best.entry.type] = best.entry.level;
  }

  return order;
}
