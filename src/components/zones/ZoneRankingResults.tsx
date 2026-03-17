// =============================================================================
// ZoneRankingResults - Right panel results table for zone ranking
// =============================================================================

import { useState, useMemo } from "react";
import type { ZoneRankingEntry } from "../../hooks/useZoneRanking";
import { formatNumber, formatCompact } from "../../utils/formatting";

interface ZoneRankingResultsProps {
  results: ZoneRankingEntry[];
}

type SortField = "totalXp" | "tier" | "kills" | "deaths" | "dps" | "killTime";

export default function ZoneRankingResults({
  results,
}: ZoneRankingResultsProps) {
  const [sortField, setSortField] = useState<SortField>("totalXp");

  // Detect whether results span multiple tiers (i.e. "All" mode was used)
  const hasMultipleTiers = useMemo(() => {
    const tiers = new Set(results.map((r) => r.difficultyTier));
    return tiers.size > 1;
  }, [results]);

  const sortedResults = useMemo(() => {
    const filtered = results.filter((r) => !r.error);
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "totalXp":
          return b.summary.totalXpPerHour - a.summary.totalXpPerHour;
        case "tier":
          return a.difficultyTier - b.difficultyTier || a.zoneName.localeCompare(b.zoneName);
        case "kills":
          return b.summary.killsPerHour - a.summary.killsPerHour;
        case "deaths":
          return a.deathsPerHour - b.deathsPerHour;
        case "dps":
          return b.summary.preClampDps - a.summary.preClampDps;
        case "killTime":
          return a.summary.avgKillTimeSec - b.summary.avgKillTimeSec;
      }
    });
  }, [results, sortField]);

  const errorResults = results.filter((r) => r.error);
  const topXp = sortedResults.length > 0 ? sortedResults[0].summary.totalXpPerHour : 0;

  const sortButton = (field: SortField, label: string) => (
    <button
      onClick={() => setSortField(field)}
      className={`cursor-pointer text-right font-medium ${
        sortField === field
          ? "text-blue-400"
          : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {label}
      {sortField === field && " \u25BC"}
    </button>
  );

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Zone Rankings
        </h3>
        <span className="text-xs text-gray-500">
          {sortedResults.length} result{sortedResults.length !== 1 ? "s" : ""}
          {errorResults.length > 0 && (
            <span className="text-red-400 ml-2">
              {errorResults.length} error{errorResults.length !== 1 ? "s" : ""}
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2 text-gray-500 font-medium w-8">
                #
              </th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">
                Zone
              </th>
              <th className="px-4 py-2">
                {sortButton("tier", "Tier")}
              </th>
              <th className="px-4 py-2">
                {sortButton("totalXp", "XP/hr")}
              </th>
              <th className="px-4 py-2">
                {sortButton("kills", "Kills/hr")}
              </th>
              <th className="px-4 py-2">
                {sortButton("deaths", "Deaths/hr")}
              </th>
              <th className="px-4 py-2">
                {sortButton("dps", "DPS")}
              </th>
              <th className="px-4 py-2">
                {sortButton("killTime", "Avg Kill")}
              </th>
              <th className="px-4 py-2 text-right text-gray-500 font-medium">
                Uptime
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((entry, i) => {
              const isTop3 = i < 3 && sortField === "totalXp";
              const xpRatio = topXp > 0 ? entry.summary.totalXpPerHour / topXp : 0;

              return (
                <tr
                  key={`${entry.zoneHrid}-t${entry.difficultyTier}`}
                  className={`border-t border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                    isTop3 ? "bg-green-900/10" : ""
                  }`}
                >
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {i + 1}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-200">
                    {entry.zoneName}
                  </td>
                  <td className="px-4 py-2 text-xs text-center text-gray-400">
                    {entry.difficultyTier}
                  </td>
                  <td className="px-4 py-2 text-sm text-right">
                    <span
                      className={`font-semibold ${
                        isTop3
                          ? "text-green-400"
                          : xpRatio > 0.8
                          ? "text-blue-400"
                          : "text-gray-300"
                      }`}
                    >
                      {formatCompact(entry.summary.totalXpPerHour)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-gray-400">
                    {formatNumber(Math.round(entry.summary.killsPerHour))}
                  </td>
                  <td className="px-4 py-2 text-xs text-right">
                    <span
                      className={
                        entry.deathsPerHour > 0
                          ? "text-red-400"
                          : "text-gray-500"
                      }
                    >
                      {entry.deathsPerHour > 0
                        ? formatNumber(
                            Math.round(entry.deathsPerHour * 10) / 10
                          )
                        : "0"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-gray-400">
                    {formatNumber(Math.round(entry.summary.preClampDps))}
                  </td>
                  <td className="px-4 py-2 text-xs text-right text-gray-400">
                    {entry.summary.avgKillTimeSec > 0
                      ? `${entry.summary.avgKillTimeSec.toFixed(1)}s`
                      : "N/A"}
                  </td>
                  <td className="px-4 py-2 text-xs text-right">
                    <span
                      className={
                        entry.summary.uptimeRatio < 0.95
                          ? "text-yellow-400"
                          : "text-gray-500"
                      }
                    >
                      {(entry.summary.uptimeRatio * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Error zones */}
      {errorResults.length > 0 && (
        <div className="border-t border-gray-700 px-4 py-3">
          <div className="text-xs text-red-400 font-medium mb-1">
            Failed zones:
          </div>
          {errorResults.map((entry) => (
            <div
              key={`${entry.zoneHrid}-t${entry.difficultyTier}`}
              className="text-xs text-red-300/70 ml-2"
            >
              {entry.zoneName} T{entry.difficultyTier}: {entry.error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
