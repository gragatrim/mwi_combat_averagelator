// =============================================================================
// labyrinthOptimizer.worker - Web Worker wrapper for labyrinth optimization
// =============================================================================
// Runs optimizeLabyrinthLoadouts() off the main thread.
// Handles Map/Buff serialization since postMessage can't transfer class instances.

import { optimizeLabyrinthLoadouts } from "./labyrinthOptimizer";
import type {
  BestGearMode,
  LabyrinthOptResult,
  LabyrinthOptProgress,
} from "./labyrinthOptimizer";
import type { FullCharacterData } from "../data/fullCharacterData";
import type { GameData, EquipmentDTO, BuffData } from "../engine/types";
import Buff from "../engine/buff";
import { buildCrateBuffs, type CrateTier } from "../features/labyrinthSimulator";

// =============================================================================
// Serialized types (Maps → plain objects for postMessage)
// =============================================================================

/** FullCharacterData with Maps converted to plain objects for transfer. */
interface SerializedCharData {
  hrid: string;
  combatLoadouts: FullCharacterData["combatLoadouts"];
  labyrinthCrates: FullCharacterData["labyrinthCrates"];
  labyrinthMonsterLoadouts: FullCharacterData["labyrinthMonsterLoadouts"];
  abilityLevels: Record<string, number>;
  gearPool: Record<string, EquipmentDTO[]>;
}

// =============================================================================
// Message types
// =============================================================================

export interface LabOptWorkerStartMessage {
  type: "start";
  charData: SerializedCharData;
  defaultLoadoutId: string;
  monsterOverrides: Record<string, string>;
  coffeeCrate: CrateTier;
  foodCrate: CrateTier;
  sealBuffDatas: BuffData[];
  wisdomBuffBonus: number;
  gameData: GameData;
  successRate: number;
  bestGearMode: BestGearMode;
  useBestAbilities: boolean;
}

export interface LabOptWorkerProgressMessage {
  type: "progress";
  progress: LabyrinthOptProgress;
}

export interface LabOptWorkerResultMessage {
  type: "result";
  result: LabyrinthOptResult;
}

export interface LabOptWorkerErrorMessage {
  type: "error";
  message: string;
}

export type LabOptWorkerOutMessage =
  | LabOptWorkerProgressMessage
  | LabOptWorkerResultMessage
  | LabOptWorkerErrorMessage;

// =============================================================================
// Serialization helpers
// =============================================================================

export function serializeCharData(
  charData: FullCharacterData
): SerializedCharData {
  return {
    hrid: charData.hrid,
    combatLoadouts: charData.combatLoadouts,
    labyrinthCrates: charData.labyrinthCrates,
    labyrinthMonsterLoadouts: charData.labyrinthMonsterLoadouts,
    abilityLevels: Object.fromEntries(charData.abilityLevels),
    gearPool: Object.fromEntries(charData.gearPool),
  };
}

function deserializeCharData(raw: SerializedCharData): FullCharacterData {
  return {
    hrid: raw.hrid,
    combatLoadouts: raw.combatLoadouts,
    labyrinthCrates: raw.labyrinthCrates,
    labyrinthMonsterLoadouts: raw.labyrinthMonsterLoadouts,
    abilityLevels: new Map(Object.entries(raw.abilityLevels)),
    gearPool: new Map(Object.entries(raw.gearPool)),
  };
}

// =============================================================================
// Worker entry point
// =============================================================================

self.onmessage = (event: MessageEvent<LabOptWorkerStartMessage>) => {
  const {
    charData: rawCharData,
    defaultLoadoutId,
    monsterOverrides,
    coffeeCrate,
    foodCrate,
    sealBuffDatas,
    wisdomBuffBonus,
    gameData,
    successRate,
    bestGearMode,
    useBestAbilities,
  } = event.data;

  try {
    const charData = deserializeCharData(rawCharData);
    const crateBuffs = buildCrateBuffs(coffeeCrate, foodCrate);
    const sealBuffs = sealBuffDatas.map((bd) => new Buff(bd));

    const result = optimizeLabyrinthLoadouts(
      charData,
      defaultLoadoutId,
      monsterOverrides,
      crateBuffs,
      sealBuffs,
      wisdomBuffBonus,
      gameData,
      successRate,
      (progress) => {
        self.postMessage({
          type: "progress",
          progress,
        } satisfies LabOptWorkerProgressMessage);
      },
      bestGearMode,
      useBestAbilities
    );

    self.postMessage({
      type: "result",
      result,
    } satisfies LabOptWorkerResultMessage);
  } catch (e) {
    self.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : "Labyrinth optimization failed",
    } satisfies LabOptWorkerErrorMessage);
  }
};
