// =============================================================================
// useLabyrinth - React hook for running labyrinth max-level finder
// =============================================================================

import { useState, useCallback } from "react";
import type { GameData, PlayerConfig } from "../engine/types";
import Buff from "../engine/buff";
import type { XpBonusSettings } from "./useSimulation";
import {
  buildCrateBuffs,
  findAllLabyrinthLevels,
  type CrateTier,
  type LabyrinthResult,
  type LabyrinthProgress,
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
    successRate?: number
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
      successRate: number = 0.5
    ) => {
      setIsRunning(true);
      setError(null);
      setResults(null);
      setProgress(null);

      // Use setTimeout to allow UI to update before blocking sim
      setTimeout(() => {
        try {
          // Build crate buffs
          const crateBuffs = buildCrateBuffs(coffeeCrate, foodCrate);

          // Build seal buffs (same logic as useSimulation)
          const pb = xpBonuses.playerBonuses[0];
          const communityWisdom =
            xpBonuses.communityBuffLevel > 0
              ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
              : 0;

          let wisdomBuffBonus = communityWisdom;
          const sealBuffs: Buff[] = [];

          const makeSealBuff = (
            typeHrid: string,
            flatBoost: number,
            ratioBoost: number
          ) =>
            new Buff({
              uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
              typeHrid,
              flatBoost,
              flatBoostLevelBonus: 0,
              ratioBoost,
              ratioBoostLevelBonus: 0,
              startTime: 0,
              duration: 1800e9,
            });

          if (pb) {
            if (pb.mooPass) wisdomBuffBonus += 0.05;
            if (pb.seals?.wisdom) wisdomBuffBonus += 0.2;
            if (pb.seals?.attackSpeed)
              sealBuffs.push(
                makeSealBuff("/buff_types/attack_speed", 0, 0.15)
              );
            if (pb.seals?.castSpeed)
              sealBuffs.push(
                makeSealBuff("/buff_types/cast_speed", 0.15, 0)
              );
            if (pb.seals?.damage)
              sealBuffs.push(
                makeSealBuff("/buff_types/damage", 0, 0.08)
              );
            if (pb.seals?.criticalRate)
              sealBuffs.push(
                makeSealBuff("/buff_types/critical_rate", 0.1, 0)
              );
            if (pb.seals?.combatDrop)
              sealBuffs.push(
                makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0)
              );
          }

          const labResults = findAllLabyrinthLevels(
            playerConfig,
            crateBuffs,
            sealBuffs,
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
