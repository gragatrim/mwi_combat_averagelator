// =============================================================================
// useLabyrinth - React hook for running labyrinth max-level finder
// =============================================================================

import { useState, useCallback } from "react";
import type { GameData, PlayerConfig } from "../engine/types";
import type { XpBonusSettings } from "./useSimulation";
import {
  buildCrateBuffs,
  buildLabyrinthUpgradeBuffs,
  findAllLabyrinthLevels,
  type CrateTier,
  type LabyrinthResult,
  type LabyrinthProgress,
  type LabyrinthUpgradeLevels,
} from "../features/labyrinthSimulator";

export interface UseLabyrinthReturn {
  results: LabyrinthResult[] | null;
  isRunning: boolean;
  error: string | null;
  progress: LabyrinthProgress | null;
  runLabyrinth: (
    playerConfig: PlayerConfig,
    coffeeCrate: CrateTier,
    foodCrate: CrateTier,
    xpBonuses: XpBonusSettings,
    gameData: GameData,
    monsterLoadoutMap?: Record<string, PlayerConfig>,
    successRate?: number,
    labUpgrades?: LabyrinthUpgradeLevels | null
  ) => void;
  clearResults: () => void;
}

export function useLabyrinth(): UseLabyrinthReturn {
  const [results, setResults] = useState<LabyrinthResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LabyrinthProgress | null>(null);

  const runLabyrinth = useCallback(
    (
      playerConfig: PlayerConfig,
      coffeeCrate: CrateTier,
      foodCrate: CrateTier,
      xpBonuses: XpBonusSettings,
      gameData: GameData,
      monsterLoadoutMap?: Record<string, PlayerConfig>,
      successRate: number = 0.5,
      labUpgrades: LabyrinthUpgradeLevels | null = null
    ) => {
      setIsRunning(true);
      setError(null);
      setResults(null);
      setProgress(null);

      // Use setTimeout to allow UI to update before blocking sim
      setTimeout(() => {
        try {
          // Build crate buffs + permanent labyrinth upgrade buffs.
          // Seals are intentionally not applied — they have no effect in labyrinth.
          const crateBuffs = [
            ...buildCrateBuffs(coffeeCrate, foodCrate),
            ...buildLabyrinthUpgradeBuffs(labUpgrades),
          ];

          const pb = xpBonuses.playerBonuses[0];
          const communityWisdom =
            xpBonuses.communityBuffLevel > 0
              ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
              : 0;
          let wisdomBuffBonus = communityWisdom;
          if (pb?.mooPass) wisdomBuffBonus += 0.05;

          const labResults = findAllLabyrinthLevels(
            playerConfig,
            crateBuffs,
            wisdomBuffBonus,
            gameData,
            360,
            (p) => setProgress(p),
            monsterLoadoutMap,
            successRate
          );

          setResults(labResults);
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Labyrinth simulation failed with an unknown error"
          );
        } finally {
          setIsRunning(false);
          setProgress(null);
        }
      }, 10);
    },
    []
  );

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
    setProgress(null);
  }, []);

  return { results, isRunning, error, progress, runLabyrinth, clearResults };
}
