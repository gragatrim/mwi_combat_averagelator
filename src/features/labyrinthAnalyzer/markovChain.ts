// =============================================================================
// Markov chain probability calculators — ported from labyrinth_analyzer.py
// =============================================================================

import { TIME_LIMIT_MS } from "./constants";

/**
 * Calculate probability of clearing a skill room using Markov chain DP.
 * On fail: stay at current progress. On success: advance 1 unit.
 * On double: advance 2 units.
 */
export function calcSkillRoomProb(
  totalNeeded: number,
  workPower: number,
  workTimeMs: number,
  sr: number,
  dp: number,
  timeLimitMs: number = TIME_LIMIT_MS
): number {
  if (workPower <= 0) return 0;
  const actions = Math.floor(timeLimitMs / workTimeMs);
  const unitsNeeded = Math.ceil(totalNeeded / workPower);

  if (unitsNeeded <= 0) return 1;
  if (actions <= 0) return 0;

  const pFail = 1 - sr;
  const pSingle = sr * (1 - dp);
  const pDouble = sr * dp;

  const cap = unitsNeeded;
  let prev = new Float64Array(cap + 1);
  prev[0] = 1;
  let cleared = 0;

  for (let a = 0; a < actions; a++) {
    const nxt = new Float64Array(cap + 1);
    for (let u = 0; u < cap; u++) {
      const p = prev[u];
      if (p === 0) continue;
      nxt[u] += p * pFail;
      if (u + 1 >= cap) {
        cleared += p * pSingle;
      } else {
        nxt[u + 1] += p * pSingle;
      }
      if (u + 2 >= cap) {
        cleared += p * pDouble;
      } else {
        nxt[u + 2] += p * pDouble;
      }
    }
    prev = nxt;
  }

  return cleared;
}

/**
 * Calculate probability of reaching target enhancement level.
 * On fail: downgrade 1 level (min 0). On success: advance 1 level.
 * On double: advance 2 levels.
 */
export function calcEnhancingRoomProb(
  targetLevel: number,
  workTimeMs: number,
  sr: number,
  dp: number,
  timeLimitMs: number = TIME_LIMIT_MS
): number {
  const actions = Math.floor(timeLimitMs / workTimeMs);
  if (targetLevel <= 0) return 1;
  if (actions <= 0) return 0;

  const pFail = 1 - sr;
  const pSingle = sr * (1 - dp);
  const pDouble = sr * dp;

  const numStates = targetLevel;
  let prev = new Float64Array(numStates);
  prev[0] = 1;
  let cleared = 0;

  for (let a = 0; a < actions; a++) {
    const nxt = new Float64Array(numStates);
    for (let lv = 0; lv < numStates; lv++) {
      const p = prev[lv];
      if (p === 0) continue;
      nxt[Math.max(0, lv - 1)] += p * pFail;
      if (lv + 1 >= numStates) {
        cleared += p * pSingle;
      } else {
        nxt[lv + 1] += p * pSingle;
      }
      if (lv + 2 >= numStates) {
        cleared += p * pDouble;
      } else {
        nxt[lv + 2] += p * pDouble;
      }
    }
    prev = nxt;
  }

  return cleared;
}

/**
 * Compute success rate with asymmetric level bonus.
 * -1% per level below room level, +0.5% per level above.
 */
export function estimateSuccessRate(effLevel: number, roomLevel: number, srBoost: number = 0): number {
  const diff = effLevel - roomLevel;
  const levelBonus = diff >= 0 ? diff * 0.005 : diff * 0.01;
  const sr = 0.80 * (1 + levelBonus + srBoost);
  return Math.max(0, Math.min(1, sr));
}
