// =============================================================================
// TriggerOptimizer - UI component for optimizing trigger threshold values
// =============================================================================
// Runs the optimizer in a Web Worker so the UI stays responsive and other
// browser tabs are not blocked.

import { useState, useCallback, useRef } from "react";
import type { GameData, PlayerConfig } from "../../engine/types";
import type { XpBonusSettings } from "../../hooks/useSimulation";
import type {
  OptimizationResult,
  TriggerImprovement,
} from "../../optimizer/triggerOptimizer";
import type {
  WorkerStartMessage,
  WorkerOutMessage,
} from "../../optimizer/triggerOptimizer.worker";
import { formatCompact, hridToName } from "../../utils/formatting";

interface TriggerOptimizerProps {
  playerConfigs: PlayerConfig[];
  zoneHrid: string;
  difficultyTier: number;
  xpBonuses: XpBonusSettings;
  gameData: GameData;
  onApply: (optimizedConfigs: PlayerConfig[]) => void;
}

export default function TriggerOptimizer({
  playerConfigs,
  zoneHrid,
  difficultyTier,
  xpBonuses,
  gameData,
  onApply,
}: TriggerOptimizerProps) {
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const handleOptimize = useCallback(() => {
    setIsRunning(true);
    setResult(null);
    setError(null);
    setProgress({ current: 0, total: 1 });

    // Create a fresh worker for each run (terminated on cancel or completion)
    const worker = new Worker(
      new URL(
        "../../optimizer/triggerOptimizer.worker.ts",
        import.meta.url
      ),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "progress":
          setProgress({ current: msg.current, total: msg.total });
          break;
        case "result":
          setResult(msg.result);
          setIsRunning(false);
          worker.terminate();
          workerRef.current = null;
          break;
        case "error":
          setError(msg.message);
          setIsRunning(false);
          worker.terminate();
          workerRef.current = null;
          break;
      }
    };

    worker.onerror = (e) => {
      setError(e.message || "Worker error");
      setIsRunning(false);
      worker.terminate();
      workerRef.current = null;
    };

    // Send all data to the worker
    const startMsg: WorkerStartMessage = {
      type: "start",
      playerConfigs,
      zoneHrid,
      difficultyTier,
      xpBonuses,
      gameData,
    };
    worker.postMessage(startMsg);
  }, [playerConfigs, zoneHrid, difficultyTier, xpBonuses, gameData]);

  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsRunning(false);
    setProgress(null);
  }, []);

  const handleApply = useCallback(() => {
    if (result) {
      onApply(result.optimizedConfigs);
      setResult(null);
    }
  }, [result, onApply]);

  const totalImprovement = result
    ? result.optimizedXpPerHour - result.baselineXpPerHour
    : 0;

  // Check if there are any value-based triggers to optimize
  const hasOptimizableTriggers = playerConfigs.some((config) => {
    const VALUE_COMPARATORS = new Set([
      "/combat_trigger_comparators/greater_than_equal",
      "/combat_trigger_comparators/less_than_equal",
    ]);
    const checkTriggers = (triggers: { comparatorHrid: string }[]) =>
      triggers.some((t) => VALUE_COMPARATORS.has(t.comparatorHrid));

    for (const food of config.food) {
      if (food && food.hrid && checkTriggers(food.triggers)) return true;
    }
    for (const ab of config.abilities) {
      if (ab && ab.hrid && checkTriggers(ab.triggers)) return true;
    }
    if (
      config.specialAbility &&
      config.specialAbility.hrid &&
      checkTriggers(config.specialAbility.triggers)
    )
      return true;
    return false;
  });

  if (!hasOptimizableTriggers) return null;

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-sm font-semibold text-gray-300">
            Trigger Optimizer
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="text-xs text-gray-500">
            Sweeps trigger threshold values to find the combination that
            maximizes primary player XP/hr. Runs in the background so the UI
            stays responsive.
          </div>

          {/* Optimize / Cancel buttons */}
          {!isRunning ? (
            <button
              onClick={handleOptimize}
              className="w-full py-2 rounded text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white cursor-pointer transition-all"
            >
              Optimize Triggers
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="w-full py-2 rounded text-sm font-medium bg-red-800 hover:bg-red-700 text-white cursor-pointer transition-all"
            >
              Cancel
            </button>
          )}

          {/* Progress bar */}
          {isRunning && progress && progress.total > 0 && (
            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>
                  {progress.current} / {progress.total} sim runs
                </span>
                <span>
                  {Math.round((progress.current / progress.total) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${(progress.current / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded p-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {/* Summary */}
              <div
                className={`rounded border p-3 ${
                  totalImprovement > 0
                    ? "bg-emerald-900/20 border-emerald-800/50"
                    : "bg-gray-800 border-gray-700"
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    Baseline XP/hr
                  </div>
                  <div className="text-sm text-gray-300">
                    {formatCompact(result.baselineXpPerHour)}
                  </div>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <div className="text-xs text-gray-400">
                    Optimized XP/hr
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {formatCompact(result.optimizedXpPerHour)}
                  </div>
                </div>
                {totalImprovement > 0 && (
                  <div className="flex justify-between items-center mt-1">
                    <div className="text-xs text-gray-400">Improvement</div>
                    <div className="text-sm font-semibold text-emerald-400">
                      +{formatCompact(totalImprovement)} (
                      {(
                        (totalImprovement / result.baselineXpPerHour) *
                        100
                      ).toFixed(2)}
                      %)
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-gray-600 mt-1">
                  {result.totalSimRuns} simulations run
                </div>
              </div>

              {/* Per-trigger improvements table */}
              {result.improvements.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-500 text-left">
                        {playerConfigs.length > 1 && <th className="pb-1 pr-2">Player</th>}
                        <th className="pb-1 pr-2">Item</th>
                        <th className="pb-1 pr-2">Condition</th>
                        <th className="pb-1 pr-2 text-right">Old</th>
                        <th className="pb-1 pr-2 text-center"></th>
                        <th className="pb-1 pr-2 text-right">New</th>
                        <th className="pb-1 text-right">XP/hr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.improvements.map((imp, i) => (
                        <ImprovementRow
                          key={i}
                          imp={imp}
                          gameData={gameData}
                          showPlayer={playerConfigs.length > 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Apply button */}
              {totalImprovement > 0 && (
                <button
                  onClick={handleApply}
                  className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors"
                >
                  Apply Optimized Triggers
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImprovementRow({
  imp,
  gameData,
  showPlayer,
}: {
  imp: TriggerImprovement;
  gameData: GameData;
  showPlayer: boolean;
}) {
  const itemName =
    gameData.itemDetailMap[imp.itemHrid]?.name ??
    gameData.abilityDetailMap[imp.itemHrid]?.name ??
    hridToName(imp.itemHrid);

  const changed = imp.originalValue !== imp.optimizedValue;

  return (
    <tr className={changed ? "text-gray-200" : "text-gray-500"}>
      {showPlayer && (
        <td className="py-0.5 pr-2">{hridToName(imp.playerHrid)}</td>
      )}
      <td className="py-0.5 pr-2">{itemName}</td>
      <td className="py-0.5 pr-2">{imp.conditionName}</td>
      <td className="py-0.5 pr-2 text-right">{imp.originalValue}</td>
      <td className="py-0.5 pr-2 text-center text-gray-600">
        {changed ? "\u2192" : "="}
      </td>
      <td className="py-0.5 pr-2 text-right font-medium">
        {imp.optimizedValue}
      </td>
      <td
        className={`py-0.5 text-right ${
          imp.xpPerHourDelta > 0
            ? "text-emerald-400"
            : imp.xpPerHourDelta < 0
              ? "text-red-400"
              : "text-gray-600"
        }`}
      >
        {imp.xpPerHourDelta > 0 ? "+" : ""}
        {formatCompact(imp.xpPerHourDelta)}
      </td>
    </tr>
  );
}
