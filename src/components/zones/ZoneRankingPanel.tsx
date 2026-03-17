// =============================================================================
// ZoneRankingPanel - Left panel controls for zone ranking mode
// =============================================================================

import { useState, useCallback } from "react";
import type { GameData } from "../../engine/types";
import type { ZoneRankingProgress } from "../../hooks/useZoneRanking";

interface ZoneRankingPanelProps {
  gameData: GameData;
  onRun: (difficultyTier: number) => void;
  onCancel: () => void;
  isRunning: boolean;
  progress: ZoneRankingProgress | null;
  canRun: boolean;
}

const MAX_DIFFICULTY = 5;
const ALL_TIERS = -1;

export default function ZoneRankingPanel({
  onRun,
  onCancel,
  isRunning,
  progress,
  canRun,
}: ZoneRankingPanelProps) {
  const [difficultyTier, setDifficultyTier] = useState<number>(0);

  const handleRun = useCallback(() => {
    onRun(difficultyTier);
  }, [onRun, difficultyTier]);

  const difficultyOptions = Array.from({ length: MAX_DIFFICULTY + 1 }, (_, i) => i);

  return (
    <div className="space-y-4">
      {/* Difficulty Tier Selector */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-3">
          Difficulty Tier
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={difficultyTier}
            onChange={(e) => setDifficultyTier(Number(e.target.value))}
            disabled={isRunning}
            className="bg-gray-900 text-gray-200 text-sm border border-gray-600 rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 cursor-pointer"
          >
            <option value={ALL_TIERS}>All Tiers</option>
            {difficultyOptions.map((tier) => (
              <option key={tier} value={tier}>
                Tier {tier}
              </option>
            ))}
          </select>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setDifficultyTier(ALL_TIERS)}
              disabled={isRunning}
              className={`px-2 h-8 text-xs rounded border transition-colors cursor-pointer ${
                difficultyTier === ALL_TIERS
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
              } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              All
            </button>
            {difficultyOptions.map((tier) => (
              <button
                key={tier}
                onClick={() => setDifficultyTier(tier)}
                disabled={isRunning}
                className={`w-8 h-8 text-xs rounded border transition-colors cursor-pointer ${
                  tier === difficultyTier
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          {difficultyTier === ALL_TIERS
            ? "Every zone will be tested at all supported tiers."
            : "Only zones supporting this tier will be tested."}
        </div>
      </div>

      {/* Run / Cancel Button */}
      {isRunning ? (
        <button
          onClick={onCancel}
          className="w-full py-3 rounded-lg text-sm font-semibold transition-all bg-red-600 hover:bg-red-500 text-white cursor-pointer"
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={handleRun}
          disabled={!canRun}
          className={`w-full py-3 rounded-lg text-sm font-semibold transition-all ${
            canRun
              ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer shadow-lg shadow-blue-600/20"
              : "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
          }`}
        >
          Rank All Zones
        </button>
      )}

      {/* Progress */}
      {isRunning && progress && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-xs text-gray-300">
              Simulating{" "}
              <span className="text-gray-200 font-medium">
                {progress.currentZoneName}
              </span>{" "}
              <span className="text-gray-500">
                ({progress.current}/{progress.total})
              </span>
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
