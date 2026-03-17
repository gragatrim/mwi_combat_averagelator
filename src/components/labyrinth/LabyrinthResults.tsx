// =============================================================================
// LabyrinthResults - Results table for labyrinth simulations (right panel)
// =============================================================================

import type { LabyrinthResult } from "../../features/labyrinthSimulator";
import { computeAdjustedLevel, DEFAULT_LEVEL_CV } from "../../features/labyrinthSimulator";
import { hridToName, formatDuration, nsToSeconds } from "../../utils/formatting";

interface LabyrinthResultsProps {
  results: LabyrinthResult[];
  loadoutNameMap: Record<string, string>;
  defaultLoadoutName: string;
}

export default function LabyrinthResults({
  results,
  loadoutNameMap,
  defaultLoadoutName,
}: LabyrinthResultsProps) {
  const sortedResults = [...results].sort((a, b) => b.maxLevel - a.maxLevel);
  const totalLevels = sortedResults.reduce((s, r) => s + r.maxLevel, 0);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Results
        </h3>
        <span className="text-xs text-blue-400 font-semibold">
          Total: {totalLevels}
        </span>
      </div>
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
  );
}
