// =============================================================================
// ZoneSelector - Dropdown to select a combat zone and difficulty tier
// =============================================================================

import { useMemo } from "react";
import type { GameData, ActionData } from "../../engine/types";

interface ZoneSelectorProps {
  gameData: GameData;
  selectedZone: string;
  selectedDifficulty: number;
  onZoneChange: (zoneHrid: string) => void;
  onDifficultyChange: (tier: number) => void;
}

interface ZoneOption {
  hrid: string;
  name: string;
  maxDifficulty: number;
  isDungeon: boolean;
  sortIndex: number;
}

interface ZoneGroup {
  label: string;
  zones: ZoneOption[];
}

export default function ZoneSelector({
  gameData,
  selectedZone,
  selectedDifficulty,
  onZoneChange,
  onDifficultyChange,
}: ZoneSelectorProps) {
  // Build grouped zone list from game data
  const zoneGroups = useMemo(() => {
    const combatZones: ZoneOption[] = [];

    for (const [hrid, action] of Object.entries(gameData.actionDetailMap)) {
      const a = action as ActionData;
      if (
        a.combatZoneInfo &&
        (a.type === "/action_types/combat" ||
          a.function === "/action_functions/combat")
      ) {
        combatZones.push({
          hrid,
          name: a.name,
          maxDifficulty: a.maxDifficulty ?? 0,
          isDungeon: a.combatZoneInfo.isDungeon,
          sortIndex: a.sortIndex ?? 0,
        });
      }
    }

    // Sort by sortIndex
    combatZones.sort((a, b) => a.sortIndex - b.sortIndex);

    // Group into regular zones and dungeons
    const regularZones = combatZones.filter((z) => !z.isDungeon);
    const dungeonZones = combatZones.filter((z) => z.isDungeon);

    const groups: ZoneGroup[] = [];
    if (regularZones.length > 0) {
      groups.push({ label: "Combat Zones", zones: regularZones });
    }
    if (dungeonZones.length > 0) {
      groups.push({ label: "Dungeons", zones: dungeonZones });
    }

    return groups;
  }, [gameData]);

  // Get the max difficulty for the currently selected zone
  const maxDifficulty = useMemo(() => {
    for (const group of zoneGroups) {
      for (const zone of group.zones) {
        if (zone.hrid === selectedZone) {
          return zone.maxDifficulty;
        }
      }
    }
    return 0;
  }, [zoneGroups, selectedZone]);

  // Build difficulty options
  const difficultyOptions = useMemo(() => {
    const options = [];
    for (let i = 0; i <= maxDifficulty; i++) {
      options.push(i);
    }
    return options;
  }, [maxDifficulty]);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-3">
        Zone Selection
      </h2>

      {/* Zone dropdown */}
      <div className="mb-3">
        <label
          htmlFor="zone-select"
          className="block text-xs text-gray-400 mb-1"
        >
          Combat Zone
        </label>
        <select
          id="zone-select"
          value={selectedZone}
          onChange={(e) => {
            onZoneChange(e.target.value);
            // Reset difficulty when zone changes
            onDifficultyChange(0);
          }}
          className="w-full bg-gray-900 text-gray-200 text-sm border border-gray-600 rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 cursor-pointer"
        >
          <option value="">-- Select a zone --</option>
          {zoneGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.zones.map((zone) => (
                <option key={zone.hrid} value={zone.hrid}>
                  {zone.name}
                  {zone.isDungeon ? " (Dungeon)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Difficulty tier */}
      {selectedZone && maxDifficulty > 0 && (
        <div>
          <label
            htmlFor="difficulty-select"
            className="block text-xs text-gray-400 mb-1"
          >
            Difficulty Tier
          </label>
          <div className="flex items-center gap-2">
            <select
              id="difficulty-select"
              value={selectedDifficulty}
              onChange={(e) => onDifficultyChange(Number(e.target.value))}
              className="bg-gray-900 text-gray-200 text-sm border border-gray-600 rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 cursor-pointer"
            >
              {difficultyOptions.map((tier) => (
                <option key={tier} value={tier}>
                  Tier {tier}
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              {difficultyOptions.map((tier) => (
                <button
                  key={tier}
                  onClick={() => onDifficultyChange(tier)}
                  className={`w-8 h-8 text-xs rounded border transition-colors cursor-pointer ${
                    tier === selectedDifficulty
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedZone && maxDifficulty === 0 && (
        <div className="text-xs text-gray-500">
          This zone has no difficulty tiers.
        </div>
      )}
    </div>
  );
}
