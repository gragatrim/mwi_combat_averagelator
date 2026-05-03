// =============================================================================
// LabyrinthResults - Results table + floor analysis for labyrinth simulations
// =============================================================================

import { useState, useCallback } from "react";
import type { GameData } from "../../engine/types";
import type { LabyrinthResult } from "../../features/labyrinthSimulator";
import { computeAdjustedLevel, DEFAULT_LEVEL_CV } from "../../features/labyrinthSimulator";
import { hridToName, formatDuration, nsToSeconds } from "../../utils/formatting";
import { generateAnalysis, type AnalysisResult } from "../../features/labyrinthAnalyzer";
import { labMonsterOrderByHrid } from "../../features/labyrinthAnalyzer/constants";
import LabyrinthAnalysis from "./analysis/LabyrinthAnalysis";

type Tab = "maxLevels" | "analysis";

interface LabyrinthResultsProps {
  results: LabyrinthResult[];
  loadoutNameMap: Record<string, string>;
  defaultLoadoutName: string;
  /** Raw character JSON for floor analysis (null if not available) */
  rawCharData: Record<string, unknown> | null;
  /** Game data needed for floor analysis */
  gameData: GameData;
}

export default function LabyrinthResults({
  results,
  loadoutNameMap,
  defaultLoadoutName,
  rawCharData,
  gameData,
}: LabyrinthResultsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("maxLevels");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const sortedResults = [...results].sort(
    (a, b) => labMonsterOrderByHrid(a.monsterHrid) - labMonsterOrderByHrid(b.monsterHrid)
  );
  const totalLevels = sortedResults.reduce((s, r) => s + r.maxLevel, 0);

  const handleGenerateAnalysis = useCallback(() => {
    if (!rawCharData) return;
    setIsAnalyzing(true);
    setAnalysisError(null);

    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const result = generateAnalysis(rawCharData, results, gameData);
        setAnalysis(result);
        setActiveTab("analysis");
      } catch (e) {
        setAnalysisError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setIsAnalyzing(false);
      }
    }, 10);
  }, [rawCharData, results, gameData]);

  return (
    <div className="space-y-3">
      {/* Tab bar + Generate button */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-2.5 flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("maxLevels")}
            className={`text-xs px-3 py-1.5 rounded transition-colors cursor-pointer ${
              activeTab === "maxLevels"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-400 hover:text-gray-200"
            }`}
          >
            Max Levels
          </button>
          <button
            onClick={() => setActiveTab("analysis")}
            disabled={!analysis}
            className={`text-xs px-3 py-1.5 rounded transition-colors cursor-pointer ${
              activeTab === "analysis"
                ? "bg-blue-600 text-white"
                : analysis
                  ? "bg-gray-700 text-gray-400 hover:text-gray-200"
                  : "bg-gray-700 text-gray-600 cursor-not-allowed"
            }`}
          >
            Floor Analysis
          </button>
        </div>

        <div className="flex items-center gap-2">
          {rawCharData && (
            <button
              onClick={handleGenerateAnalysis}
              disabled={isAnalyzing}
              className={`text-xs px-3 py-1.5 rounded transition-colors cursor-pointer ${
                isAnalyzing
                  ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                  : "bg-emerald-700 hover:bg-emerald-600 text-white"
              }`}
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  Analyzing...
                </span>
              ) : analysis ? (
                "Re-analyze"
              ) : (
                "Generate Floor Analysis"
              )}
            </button>
          )}
          <span className="text-xs text-blue-400 font-semibold">
            Total: {totalLevels}
          </span>
        </div>
      </div>

      {/* Error */}
      {analysisError && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 text-xs text-red-400">
          Analysis error: {analysisError}
        </div>
      )}

      {/* Max Levels tab */}
      {activeTab === "maxLevels" && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">Monster</th>
                <th className="text-left px-4 py-2 font-medium">Loadout</th>
                <th className="text-right px-4 py-2 font-medium">Max Level</th>
                <th className="text-right px-4 py-2 font-medium">Kill Time</th>
                <th className="text-right px-4 py-2 font-medium">Clear Rate</th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((r) => (
                <tr
                  key={r.monsterHrid}
                  className="border-t border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                >
                  <td className="px-4 py-2 text-sm text-gray-200">
                    {hridToName(r.monsterHrid)}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">
                    {loadoutNameMap[r.monsterHrid] ?? defaultLoadoutName}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    <span
                      className={`font-semibold ${
                        r.maxLevel > 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {r.maxLevel}
                    </span>
                    {r.maxLevel > 0 && (() => {
                      const effectiveCv = DEFAULT_LEVEL_CV + (r.ccBonusCv ?? 0);
                      const lo = computeAdjustedLevel(r.rawMaxLevel, 0.9, effectiveCv);
                      const hi = computeAdjustedLevel(r.rawMaxLevel, 0.1, effectiveCv);
                      const hasCc = (r.ccBonusCv ?? 0) > 0.01;
                      return (
                        <span
                          className={`text-xs ml-1 ${hasCc ? "text-amber-400" : "text-gray-500"}`}
                          title={
                            hasCc
                              ? "This monster has CC abilities (blind/stun/silence) that increase fight variance. Actual results may differ more from the predicted level."
                              : `~90% clear at ${lo}, ~10% clear at ${hi}`
                          }
                        >
                          ({lo}&ndash;{hi}){hasCc && " ⚡"}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-gray-400">
                    {r.killTimeNs > 0
                      ? formatDuration(nsToSeconds(r.killTimeNs))
                      : "N/A"}
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-gray-400">
                    {r.killTimeNs > 0
                      ? `${(r.estimatedClearRate * 100).toFixed(0)}%`
                      : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Floor Analysis tab */}
      {activeTab === "analysis" && analysis && (
        <LabyrinthAnalysis analysis={analysis} />
      )}
    </div>
  );
}
