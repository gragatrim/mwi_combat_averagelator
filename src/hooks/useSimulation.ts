// =============================================================================
// useSimulation - React hook for running the deterministic combat simulation
// =============================================================================

import { useState, useCallback } from "react";
import type { GameData, PlayerConfig } from "../engine/types";
import type SimResult from "../engine/simResult";
import type { SummaryRates } from "../engine/simResult";
import { calculateExpectedDrops, type ExpectedDrop } from "../engine/dropCalculator";
import { executeSimulation } from "./useSimulation.utils";

/** Seal toggle state. */
export interface SealSettings {
  attackSpeed: boolean;
  castSpeed: boolean;
  damage: boolean;
  criticalRate: boolean;
  combatDrop: boolean;
  wisdom: boolean;
}

/** Per-player bonus settings (MooPass, seals, additional XP are individual). */
export interface PlayerBonusSettings {
  mooPass: boolean;
  seals: SealSettings;
  additionalXpPercent: number;
}

/** Default per-player bonus settings. */
export function defaultPlayerBonus(): PlayerBonusSettings {
  return {
    mooPass: false,
    seals: {
      attackSpeed: false,
      castSpeed: false,
      damage: false,
      criticalRate: false,
      combatDrop: false,
      wisdom: false,
    },
    additionalXpPercent: 0,
  };
}

/** External XP bonuses. Community buff is shared; everything else is per-player. */
export interface XpBonusSettings {
  /** Community XP buff level (0 = off, 1-20). Shared across all players. */
  communityBuffLevel: number;
  /** Per-player bonus settings (indexed by player position). */
  playerBonuses: PlayerBonusSettings[];
}

export interface SimulationInput {
  playerConfigs: PlayerConfig[];
  zoneHrid: string;
  difficultyTier: number;
  xpBonuses?: XpBonusSettings;
}

/** Snapshot of XP-relevant combat stats for display/debugging. */
export interface XpBonusStats {
  combatExperience: number;
  staminaExperience: number;
  intelligenceExperience: number;
  attackExperience: number;
  defenseExperience: number;
  meleeExperience: number;
  rangedExperience: number;
  magicExperience: number;
}

/** Per-player summary for party display. */
export interface PlayerSummaryEntry {
  hrid: string;
  summary: SummaryRates;
}

export interface SimulationOutput {
  simResult: SimResult;
  summary: SummaryRates;
  playerHrid: string;
  /** Per-player summaries for all party members. */
  allPlayerSummaries: PlayerSummaryEntry[];
  /** Player's computed XP bonus stats (from gear/buffs). */
  xpBonusStats: XpBonusStats;
  /** Wisdom buff bonus (MooPass + community buff) added to combatExperience. */
  wisdomBuffBonus: number;
  /** Additional XP multiplier (separate from combatExperience). */
  additionalXpMultiplier: number;
  /** House room wisdom contribution (already included in combatExperience). */
  houseWisdom: number;
  /** Expected drops per hour from monster drop tables. */
  expectedDrops: ExpectedDrop[];
}

export interface UseSimulationReturn {
  /** The simulation results, or null if not yet run. */
  result: SimulationOutput | null;
  /** True while the simulation is running. */
  isRunning: boolean;
  /** Error message if the simulation failed. */
  error: string | null;
  /** Run the simulation with the given inputs. */
  runSimulation: (input: SimulationInput, gameData: GameData) => void;
  /** Clear the current results. */
  clearResults: () => void;
}

export function useSimulation(): UseSimulationReturn {
  const [result, setResult] = useState<SimulationOutput | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = useCallback(
    (input: SimulationInput, gameData: GameData) => {
      setIsRunning(true);
      setError(null);
      setResult(null);

      // Use setTimeout to allow the UI to update with "running" state
      // before the synchronous simulation blocks the thread.
      setTimeout(() => {
        try {
          const primaryConfig = input.playerConfigs[0];

          // Run the shared simulation execution logic
          const { simResult, players, primarySummary } = executeSimulation(
            input,
            gameData
          );
          const primaryPlayer = players[0];

          // Compute summary rates for all players
          const allPlayerSummaries: PlayerSummaryEntry[] = input.playerConfigs.map(
            (cfg) => ({ hrid: cfg.hrid, summary: simResult.computeSummary(cfg.hrid) })
          );

          // Compute house wisdom contribution from house room buffs
          let houseWisdom = 0;
          for (const room of primaryPlayer.houseRooms) {
            for (const buff of room.buffs) {
              if (buff.typeHrid === "/buff_types/wisdom") {
                houseWisdom += buff.flatBoost;
              }
            }
          }

          // Compute expected drops per hour
          const primaryStats = simResult.playerStats[primaryConfig.hrid];
          const expectedDrops = primaryStats
            ? calculateExpectedDrops({
                gameData,
                zoneHrid: input.zoneHrid,
                difficultyTier: input.difficultyTier,
                killsPerHour: primarySummary.killsPerHour,
                dropRateMultiplier: primaryStats.dropRateMultiplier,
                rareFindMultiplier: primaryStats.rareFindMultiplier,
                combatDropQuantity: primaryStats.combatDropQuantity,
              })
            : [];

          const cs = primaryPlayer.combatDetails.combatStats;
          setResult({
            simResult,
            summary: primarySummary,
            playerHrid: primaryConfig.hrid,
            allPlayerSummaries,
            xpBonusStats: {
              combatExperience: cs.combatExperience,
              staminaExperience: cs.staminaExperience,
              intelligenceExperience: cs.intelligenceExperience,
              attackExperience: cs.attackExperience,
              defenseExperience: cs.defenseExperience,
              meleeExperience: cs.meleeExperience,
              rangedExperience: cs.rangedExperience,
              magicExperience: cs.magicExperience,
            },
            wisdomBuffBonus: primaryPlayer.wisdomBuffBonus,
            additionalXpMultiplier: primaryPlayer.additionalXpMultiplier,
            houseWisdom,
            expectedDrops,
          });
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Simulation failed with an unknown error"
          );
        } finally {
          setIsRunning(false);
        }
      }, 10);
    },
    []
  );

  const clearResults = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isRunning, error, runSimulation, clearResults };
}
