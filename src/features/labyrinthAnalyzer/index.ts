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
  getHighestAchievedFloor,
  parseCombatLoadoutProfiles,
  getLabyrinthCombatLoadoutNameMap,
} from "./skillBuffs";
import { computeAllSkillThresholds } from "./thresholds";
import { analyze, computeBottleneck, computeSkipRecommendations, computeLabyrinthTargetFloor } from "./floorAnalysis";
import { computeTorchBudget } from "./torchBudget";
import { computeUpgradeOrder, type RecomputeSkillData } from "./upgradeOrder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCharData = Record<string, any>;

/**
 * Generate a complete labyrinth floor analysis.
 *
 * @param rawCharData Raw character JSON (the full init_character_data)
 * @param simResults Combat sim results from the averagelator (can be null)
 * @param gameData The game data from init_client_data.json
 */
export function generateAnalysis(
  rawCharData: RawCharData,
  simResults: LabyrinthResult[] | null,
  gameData: GameData
): AnalysisResult {
  const charName = getCharacterName(rawCharData);
  const timestamp = getDataTimestamp(rawCharData);
  const baseLevels = getBaseSkillLevels(rawCharData);

  // Parse labyrinthSkip* thresholds from character data
  const { skillRooms: skipSkills, combatRooms: skipCombat } = parseLabyrinthSkip(rawCharData);

  // Compute calculated skill thresholds (Markov chain).
  // Seals are intentionally not applied — they have no effect in labyrinth.
  const calcSkillData = computeAllSkillThresholds(
    rawCharData, gameData, baseLevels, skipSkills
  );

  // Set up skill/combat room data
  const skillRooms = skipSkills ?? FALLBACK_SKILL_ROOMS;
  const loadoutNameByMonster = getLabyrinthCombatLoadoutNameMap(rawCharData);
  const baseCombatRooms = skipCombat ?? FALLBACK_COMBAT_ROOMS;
  const combatRooms: [string, string, string, number][] = baseCombatRooms.map(
    ([name, loadout, skillHrid, threshold]) => {
      const monsterHrid = `/monsters/${name.toLowerCase().replace(/ /g, "_")}`;
      return [name, loadoutNameByMonster[monsterHrid] || loadout, skillHrid, threshold];
    }
  );
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
  // Resource counts only meaningful for capacity-style upgrades.
  const resources: Record<string, number> = {};
  for (const utype of ["torch", "shroud", "beacon", "cooldown"] as const) {
    resources[utype] = LAB_UPGRADE_BASES[utype]
      + ((upgradeLevels[utype as keyof typeof upgradeLevels] as number) ?? 0) * LAB_UPGRADE_PER_LEVEL[utype];
  }

  // Compute target floor: use the higher of the calculated estimate and the
  // player's actual highest achieved floor (from characterInfo.labyrinthHighestFloor).
  // This way the analyzer reflects reality if the player has already proven
  // they can reach a higher floor than the formula predicts.
  const shroudCount = resources.shroud;
  const mf = results.maxFloorNoShrouds;
  const achievedFloor = getHighestAchievedFloor(rawCharData);
  const targetFloor = computeLabyrinthTargetFloor(mf, shroudCount, achievedFloor);

  const bottleneck = computeBottleneck(
    results.skillData, results.combatData, results.floorResults, targetFloor
  );

  // Torch budget
  const torchBudget = computeTorchBudget(
    resources.torch, targetFloor, results.floorResults, resources.beacon
  );

  // Upgrade priority — supply a closure so skill upgrade marginal value is
  // computed by re-deriving real maxClearable thresholds at hypothetical
  // skill-upgrade levels (rather than a fixed effective-level boost).
  const recomputeSkillData: RecomputeSkillData = (overrides) =>
    computeAllSkillThresholds(rawCharData, gameData, baseLevels, skipSkills, overrides);
  // Combat loadout profiles — used by the ranker to make cast/attack speed
  // scoring build-aware. A loadout running only buff abilities gets zero
  // credit for cast speed, etc.
  const combatLoadoutProfiles = parseCombatLoadoutProfiles(rawCharData, gameData);
  const upgradePriority = computeUpgradeOrder(
    upgradeLevels, achievedFloor, results.floorResults, mf,
    results.skillData, results.combatData,
    calcSkillData.length > 0 ? recomputeSkillData : null,
    combatLoadoutProfiles,
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
    upgradePriority,
    skipRecommendations,
    charName,
    timestamp,
    targetFloor,
  };
}
