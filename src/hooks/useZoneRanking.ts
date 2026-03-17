// =============================================================================
// useZoneRanking - React hook for ranking all combat zones by XP/hr
// =============================================================================

import { useState, useCallback, useRef } from "react";
import type { GameData, PlayerConfig, ActionData } from "../engine/types";
import type { SummaryRates } from "../engine/simResult";
import Player from "../engine/player";
import Zone from "../engine/zone";
import Equipment from "../engine/equipment";
import Consumable from "../engine/consumable";
import Ability from "../engine/ability";
import Buff from "../engine/buff";
import DeterministicSimulator from "../engine/deterministicSimulator";
import type { XpBonusSettings } from "./useSimulation";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Result for a single zone in the ranking. */
export interface ZoneRankingEntry {
  zoneHrid: string;
  zoneName: string;
  difficultyTier: number;
  summary: SummaryRates;
  /** Deaths per hour for primary player. */
  deathsPerHour: number;
  /** Whether sim errored for this zone. */
  error: string | null;
}

/** Progress info for the UI. */
export interface ZoneRankingProgress {
  current: number;
  total: number;
  currentZoneName: string;
}

export interface UseZoneRankingReturn {
  results: ZoneRankingEntry[] | null;
  isRunning: boolean;
  error: string | null;
  progress: ZoneRankingProgress | null;
  runRanking: (
    playerConfigs: PlayerConfig[],
    difficultyTier: number,
    xpBonuses: XpBonusSettings,
    gameData: GameData
  ) => void;
  cancelRanking: () => void;
  clearResults: () => void;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function buildPlayerDeps(gameData: GameData) {
  return {
    Equipment: {
      createFromDTO: (
        dto: { hrid: string; enhancementLevel: number },
        _gd: GameData
      ) => Equipment.createFromDTO(gameData, dto),
    },
    Consumable: {
      createFromDTO: (
        dto: { hrid: string; triggers: any[] },
        _gd: GameData
      ) => Consumable.createFromDTO(gameData, dto),
    },
    Ability: {
      createFromDTO: (
        dto: { hrid: string; level: number; triggers: any[] },
        _gd: GameData
      ) => Ability.createFromDTO(gameData, dto),
    },
  };
}

/** Get all regular (non-dungeon) combat zones from game data. */
function getRegularCombatZones(gameData: GameData): { hrid: string; name: string; maxDifficulty: number; sortIndex: number }[] {
  const zones: { hrid: string; name: string; maxDifficulty: number; sortIndex: number }[] = [];

  for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
    const a = action as ActionData;
    if (
      a.combatZoneInfo &&
      !a.combatZoneInfo.isDungeon &&
      (a.type === "/action_types/combat" ||
        a.function === "/action_functions/combat")
    ) {
      zones.push({
        hrid,
        name: a.name,
        maxDifficulty: a.maxDifficulty ?? 0,
        sortIndex: a.sortIndex ?? 0,
      });
    }
  }

  zones.sort((a, b) => a.sortIndex - b.sortIndex);
  return zones;
}

function makeSealBuff(typeHrid: string, flatBoost: number, ratioBoost: number): Buff {
  return new Buff({
    uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
    typeHrid,
    flatBoost,
    flatBoostLevelBonus: 0,
    ratioBoost,
    ratioBoostLevelBonus: 0,
    startTime: 0,
    duration: 1800e9,
  });
}

/** Create players with XP bonuses applied (same logic as useSimulation). */
function buildPlayers(
  playerConfigs: PlayerConfig[],
  xpBonuses: XpBonusSettings,
  gameData: GameData
): Player[] {
  const deps = buildPlayerDeps(gameData);
  const players = playerConfigs.map((cfg) =>
    Player.createFromDTO(cfg, gameData, deps)
  );

  const communityWisdom =
    xpBonuses.communityBuffLevel > 0
      ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
      : 0;

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const pb = xpBonuses.playerBonuses[i];

    let playerWisdom = communityWisdom;
    let playerAdditionalMult = 1.0;
    if (pb) {
      if (pb.mooPass) playerWisdom += 0.05;
      if (pb.seals?.wisdom) playerWisdom += 0.20;
      if (pb.additionalXpPercent > 0) {
        playerAdditionalMult += pb.additionalXpPercent / 100;
      }

      const sealBuffs: Buff[] = [];
      if (pb.seals?.attackSpeed)
        sealBuffs.push(makeSealBuff("/buff_types/attack_speed", 0, 0.15));
      if (pb.seals?.castSpeed)
        sealBuffs.push(makeSealBuff("/buff_types/cast_speed", 0.15, 0));
      if (pb.seals?.damage)
        sealBuffs.push(makeSealBuff("/buff_types/damage", 0, 0.08));
      if (pb.seals?.criticalRate)
        sealBuffs.push(makeSealBuff("/buff_types/critical_rate", 0.10, 0));
      if (pb.seals?.combatDrop)
        sealBuffs.push(makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0));
      if (sealBuffs.length > 0) {
        player.extraBuffs = [...player.extraBuffs, ...sealBuffs];
      }
    }

    player.wisdomBuffBonus = playerWisdom;
    player.additionalXpMultiplier = playerAdditionalMult;
  }

  return players;
}

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

export function useZoneRanking(): UseZoneRankingReturn {
  const [results, setResults] = useState<ZoneRankingEntry[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ZoneRankingProgress | null>(null);
  const cancelledRef = useRef(false);

  const runRanking = useCallback(
    (
      playerConfigs: PlayerConfig[],
      difficultyTier: number,
      xpBonuses: XpBonusSettings,
      gameData: GameData
    ) => {
      setIsRunning(true);
      setError(null);
      setResults(null);
      setProgress(null);
      cancelledRef.current = false;

      const allZones = getRegularCombatZones(gameData);
      const isAllTiers = difficultyTier === -1;

      // Build work items: each is a (zone, tier) pair to simulate
      const workItems: { zone: typeof allZones[number]; tier: number }[] = [];
      if (isAllTiers) {
        for (const zone of allZones) {
          for (let t = 0; t <= zone.maxDifficulty; t++) {
            workItems.push({ zone, tier: t });
          }
        }
      } else {
        for (const zone of allZones) {
          if (zone.maxDifficulty >= difficultyTier) {
            workItems.push({ zone, tier: difficultyTier });
          }
        }
      }

      const entries: ZoneRankingEntry[] = [];
      let idx = 0;

      function processNext() {
        if (cancelledRef.current) {
          setIsRunning(false);
          setProgress(null);
          return;
        }

        if (idx >= workItems.length) {
          setResults(entries);
          setIsRunning(false);
          setProgress(null);
          return;
        }

        const { zone, tier } = workItems[idx];
        setProgress({
          current: idx + 1,
          total: workItems.length,
          currentZoneName: isAllTiers ? `${zone.name} T${tier}` : zone.name,
        });

        try {
          // Build fresh players for each zone (sim mutates player state)
          const players = buildPlayers(playerConfigs, xpBonuses, gameData);
          const primaryHrid = playerConfigs[0].hrid;

          const zoneInstance = new Zone(zone.hrid, tier, gameData);
          const simulator = new DeterministicSimulator(
            players,
            zoneInstance,
            gameData
          );
          const simResult = simulator.simulate();
          const summary = simResult.computeSummary(primaryHrid);

          const playerStats = simResult.playerStats[primaryHrid];
          const hoursElapsed = simResult.totalSimTimeNs / 3.6e12;
          const deathsPerHour =
            playerStats && hoursElapsed > 0
              ? playerStats.deaths / hoursElapsed
              : 0;

          entries.push({
            zoneHrid: zone.hrid,
            zoneName: zone.name,
            difficultyTier: tier,
            summary,
            deathsPerHour,
            error: null,
          });
        } catch (e) {
          entries.push({
            zoneHrid: zone.hrid,
            zoneName: zone.name,
            difficultyTier: tier,
            summary: {
              xpPerHour: { stamina: 0, intelligence: 0, attack: 0, melee: 0, defense: 0, ranged: 0, magic: 0 },
              totalXpPerHour: 0,
              killsPerHour: 0,
              dps: 0,
              preClampDps: 0,
              hps: 0,
              manaPerSecond: 0,
              manaSustainable: true,
              avgKillTimeSec: 0,
              uptimeRatio: 1.0,
            },
            deathsPerHour: 0,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }

        idx++;
        // Yield to UI via setTimeout
        setTimeout(processNext, 0);
      }

      // Kick off the first zone after a short delay for UI update
      setTimeout(processNext, 10);
    },
    []
  );

  const cancelRanking = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
    setProgress(null);
  }, []);

  return { results, isRunning, error, progress, runRanking, cancelRanking, clearResults };
}
