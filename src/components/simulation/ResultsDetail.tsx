// =============================================================================
// ResultsDetail - Expandable detail section with combat breakdown
// =============================================================================

import { useState } from "react";
import type SimResult from "../../engine/simResult";
import type { ExpectedDrop } from "../../engine/dropCalculator";
import type { GameData } from "../../engine/types";
import {
  formatNumber,
  formatCompact,
  formatDuration,
  hridToName,
  nsToSeconds,
} from "../../utils/formatting";

interface ResultsDetailProps {
  simResult: SimResult;
  playerHrid: string;
  expectedDrops: ExpectedDrop[];
  gameData: GameData;
}

export default function ResultsDetail({
  simResult,
  playerHrid,
  expectedDrops,
  gameData,
}: ResultsDetailProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const playerStats = simResult.playerStats[playerHrid];

  if (!playerStats) return null;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left cursor-pointer hover:bg-gray-750"
      >
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Detailed Breakdown
        </h3>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-gray-700 p-4 space-y-4">
          {/* Healing Breakdown */}
          {Object.keys(playerStats.healingBySource).length > 0 && (
            <DetailSection title="Healing Sources">
              <div className="space-y-1">
                {Object.entries(playerStats.healingBySource)
                  .sort(([, a], [, b]) => b - a)
                  .map(([source, amount]) => (
                    <DetailRow
                      key={source}
                      label={hridToName(source)}
                      value={formatCompact(amount)}
                    />
                  ))}
                <DetailRow
                  label="Total"
                  value={formatCompact(playerStats.totalHealingReceived)}
                  bold
                />
              </div>
            </DetailSection>
          )}

          {/* Mana Breakdown */}
          {Object.keys(playerStats.manaByAbility).length > 0 && (
            <DetailSection title="Mana Usage by Ability">
              <div className="space-y-1">
                {Object.entries(playerStats.manaByAbility)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ability, amount]) => (
                    <DetailRow
                      key={ability}
                      label={hridToName(ability)}
                      value={formatNumber(amount)}
                    />
                  ))}
                <DetailRow
                  label="Total"
                  value={formatNumber(playerStats.totalManaUsed)}
                  bold
                />
              </div>
            </DetailSection>
          )}

          {/* Consumable Usage */}
          {Object.keys(playerStats.consumablesUsed).length > 0 && (
            <DetailSection title="Consumable Usage">
              <div className="space-y-1">
                {Object.entries(playerStats.consumablesUsed)
                  .sort(([, a], [, b]) => b - a)
                  .map(([consumable, count]) => (
                    <DetailRow
                      key={consumable}
                      label={hridToName(consumable)}
                      value={`${formatNumber(count)}x`}
                    />
                  ))}
              </div>
            </DetailSection>
          )}

          {/* HP Spent by Abilities */}
          {Object.keys(playerStats.hitpointsSpent).length > 0 && (
            <DetailSection title="HP Spent by Abilities">
              <div className="space-y-1">
                {Object.entries(playerStats.hitpointsSpent)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ability, amount]) => (
                    <DetailRow
                      key={ability}
                      label={hridToName(ability)}
                      value={formatCompact(amount)}
                    />
                  ))}
              </div>
            </DetailSection>
          )}

          {/* Loot Multipliers */}
          <DetailSection title="Loot Multipliers">
            <div className="space-y-1">
              <DetailRow
                label="Drop Rate"
                value={`${formatNumber(playerStats.dropRateMultiplier)}x`}
              />
              <DetailRow
                label="Rare Find"
                value={`${formatNumber(playerStats.rareFindMultiplier)}x`}
              />
              <DetailRow
                label="Drop Quantity"
                value={`+${formatNumber(playerStats.combatDropQuantity)}`}
              />
              {playerStats.debuffOnLevelGap > 0 && (
                <DetailRow
                  label="Level Gap Debuff"
                  value={`-${formatNumber(playerStats.debuffOnLevelGap * 100)}%`}
                />
              )}
            </div>
          </DetailSection>

          {/* Dungeon Info (if applicable) */}
          {simResult.isDungeon && (
            <DetailSection title="Dungeon Stats">
              <div className="space-y-1">
                <DetailRow
                  label="Completed"
                  value={formatNumber(simResult.dungeonsCompleted)}
                />
                <DetailRow
                  label="Failed"
                  value={formatNumber(simResult.dungeonsFailed)}
                />
                {simResult.maxWaveReached > 0 && (
                  <DetailRow
                    label="Max Wave Reached"
                    value={formatNumber(simResult.maxWaveReached)}
                  />
                )}
                {simResult.numberOfPlayers > 1 && (
                  <DetailRow
                    label="Party Size"
                    value={formatNumber(simResult.numberOfPlayers)}
                  />
                )}
              </div>
            </DetailSection>
          )}

          {/* Expected Drops */}
          <DetailSection title="Expected Drops / Hour">
            {expectedDrops.length > 0 ? (
              <div className="space-y-1">
                {expectedDrops.map((drop) => {
                  const itemData = gameData.itemDetailMap[drop.itemHrid];
                  const displayName = itemData?.name ?? hridToName(drop.itemHrid);
                  return (
                    <div
                      key={drop.itemHrid}
                      className="flex items-center justify-between text-xs"
                    >
                      <span
                        className={
                          drop.isRare
                            ? "text-amber-400"
                            : "text-gray-400"
                        }
                      >
                        {displayName}
                        {drop.isRare && (
                          <span className="text-[10px] text-amber-600 ml-1">
                            rare
                          </span>
                        )}
                      </span>
                      <span className="text-gray-300">
                        {formatCompact(drop.quantityPerHour)}
                        <span className="text-[10px] text-gray-500"> /hr</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : simResult.isDungeon ? (
              <div className="text-xs text-gray-500 italic">
                Dungeon drop calculations not yet supported.
              </div>
            ) : (
              <div className="text-xs text-gray-500 italic">
                No drop data available for this zone.
              </div>
            )}
          </DetailSection>

          {/* Debug / Raw Simulation Data */}
          <DetailSection title="Debug: Raw Simulation Data">
            <div className="space-y-1">
              <DetailRow
                label="Total Sim Time"
                value={formatDuration(nsToSeconds(simResult.totalSimTimeNs))}
              />
              <DetailRow
                label="Total Sim Time (ns)"
                value={formatNumber(simResult.totalSimTimeNs)}
              />
              <DetailRow
                label="Total Encounters"
                value={formatNumber(simResult.encounters)}
              />
              <DetailRow
                label="Raw Stamina XP"
                value={formatNumber(playerStats.experienceGained.stamina)}
              />
              <DetailRow
                label="Raw Intelligence XP"
                value={formatNumber(playerStats.experienceGained.intelligence)}
              />
              <DetailRow
                label="Raw Attack XP"
                value={formatNumber(playerStats.experienceGained.attack)}
              />
              <DetailRow
                label="Raw Defense XP"
                value={formatNumber(playerStats.experienceGained.defense)}
              />
              <DetailRow
                label="Raw Melee XP"
                value={formatNumber(playerStats.experienceGained.melee)}
              />
              <DetailRow
                label="Raw Ranged XP"
                value={formatNumber(playerStats.experienceGained.ranged)}
              />
              <DetailRow
                label="Raw Magic XP"
                value={formatNumber(playerStats.experienceGained.magic)}
              />
              <DetailRow
                label="Total Raw XP"
                value={formatNumber(
                  playerStats.experienceGained.stamina +
                  playerStats.experienceGained.intelligence +
                  playerStats.experienceGained.attack +
                  playerStats.experienceGained.defense +
                  playerStats.experienceGained.melee +
                  playerStats.experienceGained.ranged +
                  playerStats.experienceGained.magic
                )}
              />
              <DetailRow
                label="Total Damage Dealt"
                value={formatNumber(playerStats.totalDamageDealt)}
              />
              <DetailRow
                label="Deaths"
                value={formatNumber(playerStats.deaths)}
              />
              <DetailRow
                label="Time Dead (s)"
                value={formatDuration(nsToSeconds(playerStats.totalDeadTimeNs))}
              />
              <DetailRow
                label="Encounter Log Length"
                value={formatNumber(simResult.encounterLog.length)}
              />
            </div>
          </DetailSection>
        </div>
      )}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function DetailRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span
        className={bold ? "text-gray-200 font-medium" : "text-gray-400"}
      >
        {label}
      </span>
      <span
        className={bold ? "text-gray-200 font-medium" : "text-gray-300"}
      >
        {value}
      </span>
    </div>
  );
}
