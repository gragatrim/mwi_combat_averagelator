// =============================================================================
// Main floor analysis engine — ported from labyrinth_analyzer.py
// =============================================================================

import type { LabyrinthResult } from "../labyrinthSimulator";
import type {
  SkillRoomData,
  CombatRoomData,
  FloorResult,
  ShroudEstimate,
  BottleneckData,
  WeakRoom,
  SkipRecommendation,
} from "./types";
import { FLOORS, PERCOLATION_THRESHOLD, DEFAULT_CRATE_LEVEL_BOOST } from "./constants";
import { computeCombatLevel } from "./skillBuffs";

function maxClearable(effLevel: number, threshold: number): number {
  return effLevel + threshold - 1;
}

function effectiveLevel(base: number, crateBoost: number = DEFAULT_CRATE_LEVEL_BOOST): number {
  return base + crateBoost;
}

/** Clamp a requested target to the floors represented by this model. */
export function clampTargetFloor(floor: number): number {
  const minFloor = FLOORS[0][0];
  const maxFloor = FLOORS[FLOORS.length - 1][0];
  // A malformed imported value must not make downstream budget loops NaN.
  if (Number.isNaN(floor)) return minFloor;
  return Math.max(minFloor, Math.min(maxFloor, floor));
}

/** Dynamic progression target for a particular simulated shroud state. */
export function computeLabyrinthTargetFloor(
  maxFloorNoShrouds: number,
  shroudCount: number,
  highestAchievedFloor: number = 0,
): number {
  const shroudTarget = maxFloorNoShrouds + (shroudCount >= 8 ? 3 : shroudCount >= 5 ? 2 : 1);
  return clampTargetFloor(Math.max(highestAchievedFloor, shroudTarget));
}

export function floorClearFraction(maxClear: number, floorMin: number, floorMax: number): number {
  const rangeSize = floorMax - floorMin + 1;
  const clearable = Math.max(0, Math.min(floorMax, maxClear) - floorMin + 1);
  return Math.max(0, Math.min(1, clearable / rangeSize));
}

function pascalToSnake(name: string): string {
  return name.replace(/ /g, "").replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

/**
 * Main analysis function — computes floor-by-floor clearability.
 */
export function analyze(
  baseLevels: Record<string, number>,
  skillRooms: [string, string, number][],
  combatRooms: [string, string, string, number][],
  skillSource: "in-game" | "hardcoded" = "hardcoded",
  combatSource: "in-game" | "hardcoded" = "hardcoded",
  simResults: Map<string, LabyrinthResult> | null = null,
  calcSkillData: SkillRoomData[] | null = null
): {
  skillData: SkillRoomData[];
  combatData: CombatRoomData[];
  floorResults: FloorResult[];
  maxFloorNoShrouds: number;
  shroudEstimates: ShroudEstimate[];
} {
  // Build skill data
  let skillData: SkillRoomData[];
  if (calcSkillData) {
    skillData = calcSkillData;
  } else {
    skillData = skillRooms.map(([name, hrid, threshold]) => {
      const base = baseLevels[hrid] ?? 0;
      const eff = effectiveLevel(base);
      return {
        name, hrid, base, effective: eff, threshold,
        maxClearable: maxClearable(eff, threshold),
        source: skillSource as "in-game" | "hardcoded",
      };
    });
  }

  // Build combat data. The in-game labyrinth auto-skip threshold for combat
  // rooms is relative to the player's *combat level*, not the per-monster
  // combat skill level. Compute it once and apply uniformly.
  const combatLevel = Math.round(computeCombatLevel(baseLevels));
  const combatData: CombatRoomData[] = combatRooms.map(([name, loadout, skillHrid, threshold]) => {
    const base = combatLevel;
    const eff = effectiveLevel(base);
    let mc = maxClearable(eff, threshold);
    let source: CombatRoomData["source"] = combatSource;

    // Override with sim results if available
    const monsterKey = pascalToSnake(name);
    if (simResults) {
      const simResult = simResults.get(monsterKey);
      if (simResult) {
        mc = simResult.maxLevel;
        source = "simulated";
      }
    }

    return {
      name, loadout, skill: skillHrid, base, effective: eff,
      threshold, maxClearable: mc, source,
    };
  });

  // Floor-by-floor analysis
  const floorResults: FloorResult[] = [];
  for (const [floorNum, fmin, fmax, grid] of FLOORS) {
    const skillFracs = skillData.map(s => floorClearFraction(s.maxClearable, fmin, fmax));
    const combatFracs = combatData.map(c => floorClearFraction(c.maxClearable, fmin, fmax));

    const skillAvg = skillFracs.reduce((a, b) => a + b, 0) / skillFracs.length;
    const combatAvg = combatFracs.reduce((a, b) => a + b, 0) / combatFracs.length;
    const overall = (skillAvg + combatAvg) / 2;

    floorResults.push({
      floor: floorNum, min: fmin, max: fmax, grid,
      skill: skillAvg, combat: combatAvg,
      overall, blocked: 1 - overall,
      skillFracs, combatFracs,
    });
  }

  // Expected max floor (no shrouds)
  let maxFloorNoShrouds = 0;
  for (const fr of floorResults) {
    if (fr.overall >= PERCOLATION_THRESHOLD) {
      maxFloorNoShrouds = fr.floor;
    }
  }

  // Shroud estimation per floor
  const shroudEstimates: ShroudEstimate[] = floorResults.map(fr => {
    const p = fr.overall;
    if (p >= 0.95) return 0;
    if (p >= 0.80) return "0-1";
    if (p >= 0.65) return "1-2";
    if (p >= 0.55) return "2-4";
    if (p >= 0.45) return "3-5";
    if (p >= 0.35) return "4-7";
    return "6-9";
  });

  return { skillData, combatData, floorResults, maxFloorNoShrouds, shroudEstimates };
}

/**
 * Identify the progression frontier and weakest rooms.
 */
export function computeBottleneck(
  skillData: SkillRoomData[],
  combatData: CombatRoomData[],
  floorResults: FloorResult[],
  targetFloor?: number
): BottleneckData | null {
  let frontier: FloorResult | null = null;

  if (targetFloor != null) {
    frontier = floorResults.find(f => f.floor === targetFloor) ?? null;
  } else {
    frontier = floorResults.find(f => f.overall < PERCOLATION_THRESHOLD) ?? null;
  }

  if (!frontier) return null;

  const skillAvg = frontier.skill;
  const combatAvg = frontier.combat;

  let bottleneckCat: "skill" | "combat";
  if (skillAvg < combatAvg - 0.05) bottleneckCat = "skill";
  else if (combatAvg < skillAvg - 0.05) bottleneckCat = "combat";
  else bottleneckCat = skillAvg <= combatAvg ? "skill" : "combat";

  const fmin = frontier.min;
  const fmax = frontier.max;

  const roomData: WeakRoom[] = (bottleneckCat === "skill" ? skillData : combatData).map(r => ({
    name: r.name,
    maxClearable: r.maxClearable,
    frac: floorClearFraction(r.maxClearable, fmin, fmax),
    gapNeeded: Math.max(0, fmax - r.maxClearable),
  }));

  roomData.sort((a, b) => a.frac - b.frac || a.maxClearable - b.maxClearable);
  const weakRooms = roomData.slice(0, 5);

  // Estimate impact of fixing weakest rooms
  const fixedSkillFracs = [...frontier.skillFracs];
  const fixedCombatFracs = [...frontier.combatFracs];
  const nFix = Math.min(3, weakRooms.length);

  if (bottleneckCat === "skill") {
    const nameToIdx = new Map(skillData.map((s, i) => [s.name, i]));
    for (const wr of weakRooms.slice(0, nFix)) {
      const idx = nameToIdx.get(wr.name);
      if (idx != null) fixedSkillFracs[idx] = 1;
    }
  } else {
    const nameToIdx = new Map(combatData.map((c, i) => [c.name, i]));
    for (const wr of weakRooms.slice(0, nFix)) {
      const idx = nameToIdx.get(wr.name);
      if (idx != null) fixedCombatFracs[idx] = 1;
    }
  }

  const newSkillAvg = fixedSkillFracs.reduce((a, b) => a + b, 0) / fixedSkillFracs.length;
  const newCombatAvg = fixedCombatFracs.reduce((a, b) => a + b, 0) / fixedCombatFracs.length;

  return {
    frontierFloor: frontier.floor,
    frontierMin: fmin,
    frontierMax: fmax,
    frontierOverall: frontier.overall,
    skillAvg, combatAvg,
    bottleneckCategory: bottleneckCat,
    weakRooms,
    impactEstimate: (newSkillAvg + newCombatAvg) / 2,
    nFixed: nFix,
  };
}

/**
 * Compute recommended auto-skip settings.
 */
export function computeSkipRecommendations(
  skillData: SkillRoomData[],
  combatData: CombatRoomData[]
): SkipRecommendation[] {
  const recommendations: SkipRecommendation[] = [];

  for (const s of skillData) {
    if (s.source !== "calculated") continue;
    const rec = s.threshold;
    const cur = s.igThreshold;
    if (cur != null && rec !== cur) {
      recommendations.push({
        name: s.name,
        category: "skill",
        currentThreshold: cur,
        recommendedThreshold: rec,
        delta: rec - cur,
        maxClearable: s.maxClearable,
        currentMaxClearable: s.igMaxClearable ?? "?",
      });
    }
  }

  for (const c of combatData) {
    if (c.source !== "simulated") continue;
    const rec = c.maxClearable - c.effective + 1;
    const cur = c.threshold;
    if (rec !== cur) {
      const curMc = c.effective + cur - 1;
      recommendations.push({
        name: c.name,
        category: "combat",
        currentThreshold: cur,
        recommendedThreshold: rec,
        delta: rec - cur,
        maxClearable: c.maxClearable,
        currentMaxClearable: curMc,
      });
    }
  }

  return recommendations;
}
