// =============================================================================
// triggerOptimizer.worker - Web Worker wrapper for trigger optimization
// =============================================================================
// Runs optimizeTriggers() off the main thread so the UI stays responsive.
// Communicates via postMessage: receives start request, posts progress + result.

import { optimizeTriggers } from "./triggerOptimizer";
import type { OptimizationResult } from "./triggerOptimizer";
import type { GameData, PlayerConfig } from "../engine/types";
import type { XpBonusSettings } from "../hooks/useSimulation";

// -- Message types --

export interface WorkerStartMessage {
  type: "start";
  playerConfigs: PlayerConfig[];
  zoneHrid: string;
  difficultyTier: number;
  xpBonuses: XpBonusSettings;
  gameData: GameData;
}

export interface WorkerProgressMessage {
  type: "progress";
  current: number;
  total: number;
}

export interface WorkerResultMessage {
  type: "result";
  result: OptimizationResult;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
}

export type WorkerOutMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

// -- Worker entry point --

self.onmessage = (event: MessageEvent<WorkerStartMessage>) => {
  const { playerConfigs, zoneHrid, difficultyTier, xpBonuses, gameData } =
    event.data;

  try {
    const result = optimizeTriggers(
      playerConfigs,
      zoneHrid,
      difficultyTier,
      xpBonuses,
      gameData,
      (current, total) => {
        self.postMessage({ type: "progress", current, total } satisfies WorkerProgressMessage);
      }
    );

    self.postMessage({ type: "result", result } satisfies WorkerResultMessage);
  } catch (e) {
    self.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : "Optimization failed",
    } satisfies WorkerErrorMessage);
  }
};
