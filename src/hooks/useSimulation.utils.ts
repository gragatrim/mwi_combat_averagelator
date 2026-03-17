// =============================================================================
// useSimulation.utils - Shared simulation execution logic
// =============================================================================
// Extracted from useSimulation.ts so both the hook and the trigger optimizer
// can run a simulation without duplicating player creation / bonus application.

import type { GameData, PlayerConfig } from "../engine/types";
import type SimResult from "../engine/simResult";
import type { SummaryRates } from "../engine/simResult";
import Player from "../engine/player";
import Zone from "../engine/zone";
import Equipment from "../engine/equipment";
import Consumable from "../engine/consumable";
import Ability from "../engine/ability";
import Buff from "../engine/buff";
import DeterministicSimulator from "../engine/deterministicSimulator";
import type { XpBonusSettings } from "./useSimulation";

export interface SimulationInput {
  playerConfigs: PlayerConfig[];
  zoneHrid: string;
  difficultyTier: number;
  xpBonuses?: XpBonusSettings;
}

export interface SimExecutionResult {
  simResult: SimResult;
  players: Player[];
  primarySummary: SummaryRates;
}

/**
 * Build the deps object that Player.createFromDTO expects.
 */
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

/**
 * Run a full simulation and return the result + player instances.
 * This is the core logic extracted from useSimulation so it can be
 * reused by the trigger optimizer.
 */
export function executeSimulation(
  input: SimulationInput,
  gameData: GameData
): SimExecutionResult {
  // 1. Create Player instances from all config DTOs
  const deps = buildPlayerDeps(gameData);
  const players = input.playerConfigs.map((cfg) =>
    Player.createFromDTO(cfg, gameData, deps)
  );

  // 2. Create Zone instance
  const zone = new Zone(input.zoneHrid, input.difficultyTier, gameData);

  // 3. Compute per-player XP bonuses and seal buffs
  const communityWisdom =
    input.xpBonuses && input.xpBonuses.communityBuffLevel > 0
      ? 0.2 + 0.005 * (input.xpBonuses.communityBuffLevel - 1)
      : 0;

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

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const pb = input.xpBonuses?.playerBonuses[i];

    let playerWisdom = communityWisdom;
    let playerAdditionalMult = 1.0;
    if (pb) {
      if (pb.mooPass) playerWisdom += 0.05;
      if (pb.seals?.wisdom) playerWisdom += 0.2;
      if (pb.additionalXpPercent > 0) {
        playerAdditionalMult += pb.additionalXpPercent / 100;
      }

      const sealBuffs: Buff[] = [];
      if (pb.seals?.attackSpeed)
        sealBuffs.push(
          makeSealBuff("/buff_types/attack_speed", 0, 0.15)
        );
      if (pb.seals?.castSpeed)
        sealBuffs.push(
          makeSealBuff("/buff_types/cast_speed", 0.15, 0)
        );
      if (pb.seals?.damage)
        sealBuffs.push(makeSealBuff("/buff_types/damage", 0, 0.08));
      if (pb.seals?.criticalRate)
        sealBuffs.push(
          makeSealBuff("/buff_types/critical_rate", 0.1, 0)
        );
      if (pb.seals?.combatDrop)
        sealBuffs.push(
          makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0)
        );
      if (sealBuffs.length > 0) {
        player.extraBuffs = [...player.extraBuffs, ...sealBuffs];
      }
    }

    player.wisdomBuffBonus = playerWisdom;
    player.additionalXpMultiplier = playerAdditionalMult;
  }

  // 4. Create and run the simulator
  const simulator = new DeterministicSimulator(players, zone, gameData);
  const simResult = simulator.simulate();

  // 5. Compute primary player summary
  const primarySummary = simResult.computeSummary(
    input.playerConfigs[0].hrid
  );

  return { simResult, players, primarySummary };
}
