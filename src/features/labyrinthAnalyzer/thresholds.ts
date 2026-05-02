// =============================================================================
// Threshold calculation — ported from labyrinth_analyzer.py
// =============================================================================

import type { GameData } from "../../engine/types";
import type { SkillRoomData, SkillBuffs } from "./types";
import {
  BASE_SKILL_ACTION_TIME_MS,
  BASE_ENHANCING_ACTION_TIME_MS,
  LABYRINTH_SKILL_NAMES,
} from "./constants";
import { calcSkillRoomProb, calcEnhancingRoomProb, estimateSuccessRate } from "./markovChain";
import { computeSkillBuffs, type SkillUpgradeOverride } from "./skillBuffs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCharData = Record<string, any>;

/**
 * Binary search for the highest room level clearable with >= targetProb.
 */
export function computeMaxClearableLevel(
  skillName: string,
  buffs: SkillBuffs,
  baseLevel: number,
  targetProb: number = 0.5
): number {
  const effLevel = baseLevel + buffs.levelBoost;
  const workPower = effLevel * (1 + buffs.efficiency);
  const isEnhancing = skillName === "enhancing";
  const baseTime = isEnhancing ? BASE_ENHANCING_ACTION_TIME_MS : BASE_SKILL_ACTION_TIME_MS;
  const workTimeMs = baseTime / (1 + buffs.actionSpeed);

  let lo = 1, hi = 400, best = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sr = estimateSuccessRate(effLevel, mid, buffs.srBoost);

    let prob: number;
    if (isEnhancing) {
      const targetEnh = 5;
      prob = calcEnhancingRoomProb(targetEnh, workTimeMs, sr, buffs.dpChance);
    } else {
      const targetWork = mid * 10;
      prob = calcSkillRoomProb(targetWork, workPower, workTimeMs, sr, buffs.dpChance);
    }

    if (prob >= targetProb) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

/**
 * Compute calculated max clearable levels for all labyrinth skills.
 * Returns a list of SkillRoomData ready for analyze().
 */
export function computeAllSkillThresholds(
  charData: RawCharData,
  gameData: GameData,
  baseLevels: Record<string, number>,
  skipSkills: [string, string, number][] | null,
  upgradeOverride?: SkillUpgradeOverride
): SkillRoomData[] {
  const results: SkillRoomData[] = [];

  // Build in-game skip map for comparison display
  const igSkipMap = new Map<string, number>();
  if (skipSkills) {
    for (const [, hrid, threshold] of skipSkills) {
      igSkipMap.set(hrid, threshold);
    }
  }

  for (const titleName of [...LABYRINTH_SKILL_NAMES].sort()) {
    const skillName = titleName.toLowerCase();
    const hrid = `/skills/${skillName}`;
    const base = baseLevels[hrid] ?? 0;
    if (base === 0) continue;

    // Seals are intentionally not applied — they have no effect in labyrinth.
    const buffs = computeSkillBuffs(skillName, charData, gameData, upgradeOverride);

    const calcMc = computeMaxClearableLevel(skillName, buffs, base);
    const eff = base + buffs.levelBoost;
    const threshold = calcMc > 0 ? calcMc - eff + 1 : 0;

    const entry: SkillRoomData = {
      name: titleName,
      hrid,
      base,
      effective: eff,
      threshold,
      maxClearable: calcMc,
      source: "calculated",
      buffs,
    };

    // Attach in-game threshold for comparison
    const igThresh = igSkipMap.get(hrid);
    if (igThresh !== undefined) {
      entry.igThreshold = igThresh;
      entry.igMaxClearable = eff + igThresh - 1;
    }

    results.push(entry);
  }

  return results;
}
