// =============================================================================
// ResultsSummary - Clean card layout showing simulation summary results
// =============================================================================

import type { SummaryRates } from "../../engine/simResult";
import type SimResult from "../../engine/simResult";
import type { XpBonusStats, PlayerSummaryEntry } from "../../hooks/useSimulation";
import {
  formatXpPerHour,
  formatCompact,
  formatDuration,
  formatPercent,
  formatNumber,
  nsToSeconds,
  nsToHours,
  hridToName,
} from "../../utils/formatting";

interface ResultsSummaryProps {
  summary: SummaryRates;
  simResult: SimResult;
  playerHrid: string;
  allPlayerSummaries: PlayerSummaryEntry[];
  xpBonusStats: XpBonusStats;
  wisdomBuffBonus: number;
  additionalXpMultiplier: number;
  houseWisdom: number;
}

export default function ResultsSummary({
  summary,
  simResult,
  playerHrid,
  allPlayerSummaries,
  xpBonusStats,
  wisdomBuffBonus,
  additionalXpMultiplier,
  houseWisdom,
}: ResultsSummaryProps) {
  const playerStats = simResult.playerStats[playerHrid];
  const simDurationSec = nsToSeconds(simResult.totalSimTimeNs);
  const encounters = simResult.encounters;

  return (
    <div className="space-y-4">
      {/* Hero stat: Total XP/hr */}
      <div className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 rounded-lg border border-blue-700/50 p-5 text-center">
        <div className="text-xs text-blue-400 uppercase tracking-wider mb-1">
          Total XP / Hour
        </div>
        <div className="text-3xl sm:text-4xl font-bold text-white">
          {formatXpPerHour(summary.totalXpPerHour)}
        </div>
        <div className="text-xs text-gray-400 mt-2">
          {formatNumber(encounters)} encounters in{" "}
          {formatDuration(simDurationSec)} sim time
        </div>
      </div>

      {/* XP per skill - per player */}
      {allPlayerSummaries.map((entry, idx) => {
        const pStats = simResult.playerStats[entry.hrid];
        const s = entry.summary;
        const isMulti = allPlayerSummaries.length > 1;
        return (
          <div key={entry.hrid} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {isMulti ? hridToName(entry.hrid) : "XP by Skill"}
              </h3>
              {isMulti && (
                <div className="flex items-center gap-2">
                  {idx === 0 && (
                    <span className="text-[10px] bg-blue-900/40 text-blue-400 px-1.5 py-0.5 rounded">
                      Primary
                    </span>
                  )}
                  <span className="text-sm font-semibold text-gray-200">
                    {formatXpPerHour(s.totalXpPerHour)}
                    <span className="text-[10px] text-gray-500 font-normal"> /hr total</span>
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SkillXpCard skill="Stamina" xphr={s.xpPerHour.stamina} totalXp={pStats?.experienceGained.stamina} color="text-yellow-400" />
              <SkillXpCard skill="Intelligence" xphr={s.xpPerHour.intelligence} totalXp={pStats?.experienceGained.intelligence} color="text-purple-400" />
              <SkillXpCard skill="Attack" xphr={s.xpPerHour.attack} totalXp={pStats?.experienceGained.attack} color="text-red-400" />
              <SkillXpCard skill="Defense" xphr={s.xpPerHour.defense} totalXp={pStats?.experienceGained.defense} color="text-cyan-400" />
              <SkillXpCard skill="Melee" xphr={s.xpPerHour.melee} totalXp={pStats?.experienceGained.melee} color="text-orange-400" />
              <SkillXpCard skill="Ranged" xphr={s.xpPerHour.ranged} totalXp={pStats?.experienceGained.ranged} color="text-green-400" />
              <SkillXpCard skill="Magic" xphr={s.xpPerHour.magic} totalXp={pStats?.experienceGained.magic} color="text-blue-400" />
            </div>
            {isMulti && pStats && (
              <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                <span>DPS: {formatCompact(s.preClampDps)}</span>
                <span>HPS: {formatCompact(s.hps)}</span>
                <span>Deaths: {formatNumber(pStats.deaths)}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Dungeon stats (when applicable) */}
      {simResult.isDungeon && (
        <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/15 rounded-lg border border-purple-700/50 p-4">
          <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
            Dungeon Progress
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <DungeonStatCard
              label="Completed / Hr"
              value={
                simResult.totalSimTimeNs > 0
                  ? formatCompact(
                      simResult.dungeonsCompleted / nsToHours(simResult.totalSimTimeNs)
                    )
                  : "0"
              }
              highlight={simResult.dungeonsCompleted > 0 ? "green" : undefined}
            />
            <DungeonStatCard
              label="Completed"
              value={formatNumber(simResult.dungeonsCompleted)}
              highlight={simResult.dungeonsCompleted > 0 ? "green" : undefined}
            />
            <DungeonStatCard
              label="Failed"
              value={formatNumber(simResult.dungeonsFailed)}
              highlight={simResult.dungeonsFailed > 0 ? "red" : undefined}
            />
            {simResult.dungeonsCompleted + simResult.dungeonsFailed > 0 && (
              <DungeonStatCard
                label="Success Rate"
                value={formatPercent(
                  simResult.dungeonsCompleted /
                    (simResult.dungeonsCompleted + simResult.dungeonsFailed)
                )}
              />
            )}
            {simResult.maxWaveReached > 0 && (
              <DungeonStatCard
                label="Max Wave"
                value={formatNumber(simResult.maxWaveReached)}
              />
            )}
            {simResult.numberOfPlayers > 1 && (
              <DungeonStatCard
                label="Party Size"
                value={formatNumber(simResult.numberOfPlayers)}
              />
            )}
          </div>
        </div>
      )}

      {/* Combat stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          label={simResult.isDungeon ? "Encounters / Hr" : "Kills / Hour"}
          value={formatCompact(summary.killsPerHour)}
        />
        <StatCard
          label="Avg Kill Time"
          value={
            summary.avgKillTimeSec > 0
              ? formatDuration(summary.avgKillTimeSec)
              : "N/A"
          }
        />
        <StatCard
          label="Uptime"
          value={formatPercent(summary.uptimeRatio)}
        />
        <StatCard
          label="DPS"
          value={formatCompact(summary.preClampDps)}
        />
        <StatCard
          label="HPS"
          value={formatCompact(summary.hps)}
        />
        <StatCard
          label="Deaths"
          value={
            playerStats
              ? formatNumber(playerStats.deaths)
              : "0"
          }
          highlight={playerStats && playerStats.deaths > 0 ? "red" : undefined}
        />
      </div>

      {/* Mana sustainability */}
      <div
        className={`rounded-lg border p-4 ${
          summary.manaSustainable
            ? "bg-green-900/20 border-green-800/50"
            : "bg-amber-900/20 border-amber-800/50"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider">
              Mana Sustainability
            </div>
            <div
              className={`text-sm font-medium mt-1 ${
                summary.manaSustainable ? "text-green-400" : "text-amber-400"
              }`}
            >
              {summary.manaSustainable
                ? "Sustainable"
                : "Will run out of mana"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Mana/sec</div>
            <div className="text-sm text-gray-300">
              {formatNumber(summary.manaPerSecond)}
            </div>
          </div>
        </div>
      </div>

      {/* Loot Multipliers */}
      {playerStats && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Drop Rate"
            value={`${formatNumber(playerStats.dropRateMultiplier)}x`}
          />
          <StatCard
            label="Rare Find"
            value={`${formatNumber(playerStats.rareFindMultiplier)}x`}
          />
          <StatCard
            label="Drop Qty"
            value={`+${formatNumber(playerStats.combatDropQuantity * 100)}%`}
          />
        </div>
      )}

      {/* XP Bonus Stats (from gear/buffs) */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          XP Bonuses
        </h3>
        <div className="space-y-1 text-sm">
          <BonusRow
            label="Combat Experience"
            value={xpBonusStats.combatExperience + wisdomBuffBonus}
          />
          {(() => {
            const gearExp = xpBonusStats.combatExperience - houseWisdom;
            const parts: string[] = [];
            if (gearExp > 0.0001) parts.push(`gear ${(gearExp * 100).toFixed(1)}%`);
            if (houseWisdom > 0.0001) parts.push(`house ${(houseWisdom * 100).toFixed(1)}%`);
            if (wisdomBuffBonus > 0.0001) parts.push(`wisdom ${(wisdomBuffBonus * 100).toFixed(1)}%`);
            return parts.length > 1 ? (
              <div className="text-[10px] text-gray-600 pl-2 -mt-0.5">
                {parts.join(" + ")}
              </div>
            ) : null;
          })()}
          {additionalXpMultiplier > 1 && (
            <BonusRow
              label="Additional XP"
              value={additionalXpMultiplier - 1}
            />
          )}
          <BonusRow label="Stamina Experience" value={xpBonusStats.staminaExperience} />
          <BonusRow label="Intelligence Experience" value={xpBonusStats.intelligenceExperience} />
          <BonusRow label="Attack Experience" value={xpBonusStats.attackExperience} />
          <BonusRow label="Defense Experience" value={xpBonusStats.defenseExperience} />
          <BonusRow label="Melee Experience" value={xpBonusStats.meleeExperience} />
          <BonusRow label="Ranged Experience" value={xpBonusStats.rangedExperience} />
          <BonusRow label="Magic Experience" value={xpBonusStats.magicExperience} />
        </div>
      </div>
    </div>
  );
}

function BonusRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  if (value === 0 && !suffix) return null;

  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}:</span>
      <span className="text-gray-200">
        +{(value * 100).toFixed(1)}%{suffix}
      </span>
    </div>
  );
}

function SkillXpCard({
  skill,
  xphr,
  totalXp,
  color,
}: {
  skill: string;
  xphr: number;
  totalXp?: number;
  color: string;
}) {
  if (xphr <= 0) return null;

  return (
    <div className="bg-gray-900/60 rounded px-3 py-2">
      <div className={`text-[10px] uppercase tracking-wider ${color}`}>
        {skill}
      </div>
      <div className="text-sm text-gray-200 font-medium">
        {formatCompact(xphr)}
        <span className="text-[10px] text-gray-500"> /hr</span>
      </div>
      {totalXp != null && totalXp > 0 && (
        <div className="text-[10px] text-gray-500 mt-0.5">
          {formatNumber(Math.round(totalXp))} total
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "green";
}) {
  const valueColor =
    highlight === "red"
      ? "text-red-400"
      : highlight === "green"
        ? "text-green-400"
        : "text-gray-200";

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-lg font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}

function DungeonStatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "green";
}) {
  const valueColor =
    highlight === "red"
      ? "text-red-400"
      : highlight === "green"
        ? "text-green-400"
        : "text-purple-200";

  return (
    <div className="bg-purple-900/20 rounded px-3 py-2">
      <div className="text-[10px] text-purple-400/70 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-sm font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}
