// =============================================================================
// BonusSettings - Per-player XP bonus toggles + shared community buff
// =============================================================================

import type { XpBonusSettings, PlayerBonusSettings, SealSettings } from "../../hooks/useSimulation";
import { hridToName } from "../../utils/formatting";

interface BonusSettingsProps {
  settings: XpBonusSettings;
  onChange: (updated: XpBonusSettings) => void;
  playerNames: string[];
}

const SEAL_DEFS = [
  ["attackSpeed", "Atk Spd", "+15%"],
  ["castSpeed", "Cast Spd", "+15%"],
  ["damage", "Damage", "+8%"],
  ["criticalRate", "Crit Rate", "+10%"],
  ["combatDrop", "Drop Qty", "+15%"],
  ["wisdom", "Wisdom", "+20%"],
] as const;

export default function BonusSettings({
  settings,
  onChange,
  playerNames,
}: BonusSettingsProps) {
  const communityBonus =
    settings.communityBuffLevel > 0
      ? (0.2 + 0.005 * (settings.communityBuffLevel - 1)) * 100
      : 0;

  const updatePlayerBonus = (idx: number, update: Partial<PlayerBonusSettings>) => {
    const bonuses = [...settings.playerBonuses];
    bonuses[idx] = { ...bonuses[idx], ...update };
    onChange({ ...settings, playerBonuses: bonuses });
  };

  const updatePlayerSeals = (idx: number, sealKey: string, value: boolean) => {
    const bonuses = [...settings.playerBonuses];
    bonuses[idx] = {
      ...bonuses[idx],
      seals: { ...bonuses[idx].seals, [sealKey]: value },
    };
    onChange({ ...settings, playerBonuses: bonuses });
  };

  const isMultiPlayer = playerNames.length > 1;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
      {/* Shared: Community XP Buff */}
      <div>
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-2">
          Shared Bonuses
        </h2>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-300">Community XP</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">
              {communityBonus > 0 ? `+${communityBonus.toFixed(1)}%` : "Off"}
            </span>
            <select
              value={settings.communityBuffLevel}
              onChange={(e) =>
                onChange({
                  ...settings,
                  communityBuffLevel: parseInt(e.target.value),
                })
              }
              className="text-xs bg-gray-900 border border-gray-600 rounded px-2 py-0.5 text-gray-200 cursor-pointer focus:outline-none focus:border-blue-500"
            >
              <option value={0}>Off</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((lv) => (
                <option key={lv} value={lv}>
                  Lv {lv}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Per-player bonuses */}
      {settings.playerBonuses.map((pb, idx) => (
        <PlayerBonusSection
          key={idx}
          label={isMultiPlayer ? hridToName(playerNames[idx] ?? `player_${idx + 1}`) : undefined}
          playerIndex={idx}
          isPrimary={idx === 0 && isMultiPlayer}
          bonus={pb}
          onMooPassChange={(v) => updatePlayerBonus(idx, { mooPass: v })}
          onAdditionalXpChange={(v) => updatePlayerBonus(idx, { additionalXpPercent: v })}
          onSealChange={(key, v) => updatePlayerSeals(idx, key, v)}
        />
      ))}
    </div>
  );
}

function PlayerBonusSection({
  label,
  playerIndex: _playerIndex,
  isPrimary,
  bonus,
  onMooPassChange,
  onAdditionalXpChange,
  onSealChange,
}: {
  label?: string;
  playerIndex: number;
  isPrimary: boolean;
  bonus: PlayerBonusSettings;
  onMooPassChange: (v: boolean) => void;
  onAdditionalXpChange: (v: number) => void;
  onSealChange: (key: string, v: boolean) => void;
}) {
  return (
    <div className={label ? "border-t border-gray-700 pt-3" : ""}>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {label ? `${label}` : "Player Bonuses"}
        </h3>
        {isPrimary && (
          <span className="text-[10px] bg-blue-900/40 text-blue-400 px-1.5 py-0.5 rounded">
            Primary
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* MooPass */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs text-gray-400">MooPass</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">+5%</span>
            <input
              type="checkbox"
              checked={bonus.mooPass}
              onChange={(e) => onMooPassChange(e.target.checked)}
              className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
            />
          </div>
        </label>

        {/* Additional XP */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Other XP</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">+</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={bonus.additionalXpPercent}
              onChange={(e) =>
                onAdditionalXpChange(Math.max(0, parseFloat(e.target.value) || 0))
              }
              className="w-12 text-xs text-center bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-gray-500">%</span>
          </div>
        </div>

        {/* Seals - compact row */}
        <div>
          <div className="text-[10px] text-gray-500 mb-1">Seals</div>
          <div className="flex flex-wrap gap-1">
            {SEAL_DEFS.map(([key, label, desc]) => (
              <label
                key={key}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded cursor-pointer border transition-colors ${
                  bonus.seals[key as keyof SealSettings]
                    ? "bg-blue-900/30 border-blue-700/50 text-blue-300"
                    : "bg-gray-900/50 border-gray-700/50 text-gray-500 hover:text-gray-400"
                }`}
              >
                <input
                  type="checkbox"
                  checked={bonus.seals[key as keyof SealSettings]}
                  onChange={(e) => onSealChange(key, e.target.checked)}
                  className="hidden"
                />
                <span>{label}</span>
                <span className="text-gray-600">{desc}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
