// =============================================================================
// Labyrinth Floor Clearability Analyzer — main entry point
// =============================================================================

export type { AnalysisResult } from "./types";

import type { GameData } from "../../engine/types";
import type { LabyrinthResult } from "../labyrinthSimulator";
import type { AnalysisResult } from "./types";
import {
  FALLBACK_SKILL_ROOMS,
  FALLBACK_COMBAT_ROOMS,
  LAB_UPGRADE_BASES,
  LAB_UPGRADE_PER_LEVEL,
} from "./constants";
import {
  getBaseSkillLevels,
  getCharacterName,
  getDataTimestamp,
  parseLabyrinthSkip,
  getLabyrinthUpgradeLevels,
} from "./skillBuffs";
import { computeAllSkillThresholds } from "./thresholds";
import { analyze, computeBottleneck, computeSkipRecommendations } from "./floorAnalysis";
import { computeTorchBudget } from "./torchBudget";
import { computeUpgradeOrder } from "./upgradeOrder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCharData = Record<string, any>;

/**
 * Generate a complete labyrinth floor analysis.
 *
 * @param rawCharData Raw character JSON (the full init_character_data)
 * @param simResults Combat sim results from the averagelator (can be null)
 * @param gameData The game data from init_client_data.json
 * @param withSeals Whether to include skilling seal buffs
 */
export function generateAnalysis(
  rawCharData: RawCharData,
  simResults: LabyrinthResult[] | null,
  gameData: GameData,
  withSeals: boolean = false
): AnalysisResult {
  const charName = getCharacterName(rawCharData);
  const timestamp = getDataTimestamp(rawCharData);
  const baseLevels = getBaseSkillLevels(rawCharData);

  // Parse labyrinthSkip* thresholds from character data
  const { skillRooms: skipSkills, combatRooms: skipCombat } = parseLabyrinthSkip(rawCharData);

  // Compute calculated skill thresholds (Markov chain)
  const calcSkillData = computeAllSkillThresholds(
    rawCharData, gameData, baseLevels, skipSkills, withSeals
  );

  // When seals are OFF, compute WITH-seals scenario for comparison
  if (!withSeals) {
    const sealSkillData = computeAllSkillThresholds(
      rawCharData, gameData, baseLevels, skipSkills, true
    );
    // Merge seal maxClearable into calcSkillData as maxClearableWithSeals
    for (let i = 0; i < calcSkillData.length; i++) {
      calcSkillData[i].maxClearableWithSeals = sealSkillData[i].maxClearable;
    }
  }

  // Set up skill/combat room data
  const skillRooms = skipSkills ?? FALLBACK_SKILL_ROOMS;
  const combatRooms = skipCombat ?? FALLBACK_COMBAT_ROOMS;
  const skillSource = skipSkills ? "in-game" : "hardcoded" as const;
  const combatSource = skipCombat ? "in-game" : "hardcoded" as const;

  // Build sim results map (monster snake_name → result)
  let simResultsMap: Map<string, LabyrinthResult> | null = null;
  if (simResults && simResults.length > 0) {
    simResultsMap = new Map();
    for (const r of simResults) {
      const monsterKey = r.monsterHrid.split("/").pop()!;
      simResultsMap.set(monsterKey, r);
    }
  }

  // Run main analysis
  const results = analyze(
    baseLevels, skillRooms, combatRooms,
    skillSource, combatSource, simResultsMap,
    calcSkillData.length > 0 ? calcSkillData : null
  );

  // Bottleneck analysis
  const upgradeLevels = getLabyrinthUpgradeLevels(rawCharData);
  const resources: Record<string, number> = {};
  for (const utype of Object.keys(LAB_UPGRADE_BASES)) {
    resources[utype] = LAB_UPGRADE_BASES[utype] + (upgradeLevels[utype as keyof typeof upgradeLevels] as number ?? 0) * LAB_UPGRADE_PER_LEVEL[utype];
  }

  // Compute target floor
  const shroudCount = resources.shroud;
  const mf = results.maxFloorNoShrouds;
  let targetFloor: number;
  if (shroudCount >= 8) targetFloor = mf + 3;
  else if (shroudCount >= 5) targetFloor = mf + 2;
  else targetFloor = mf + 1;

  const bottleneck = computeBottleneck(
    results.skillData, results.combatData, results.floorResults, targetFloor
  );

  // Torch budget
  const torchBudget = computeTorchBudget(
    resources.torch, targetFloor, results.floorResults, resources.beacon
  );

  // Upgrade priority
  const upgradePriority = computeUpgradeOrder(
    upgradeLevels, null, results.floorResults, mf
  );

  // Skip recommendations
  const skipRecommendations = computeSkipRecommendations(
    results.skillData, results.combatData
  );

  return {
    skillData: results.skillData,
    combatData: results.combatData,
    floorResults: results.floorResults,
    maxFloorNoShrouds: mf,
    shroudEstimates: results.shroudEstimates,
    bottleneck,
    upgradeLevels,
    torchBudget,
    upgradePriority: upgradePriority.slice(0, 10),
    skipRecommendations,
    charName,
    timestamp,
    targetFloor,
  };
}
