// =============================================================================
// PlayerImport - Party-aware import: paste JSON for up to 5 players
// =============================================================================
// Supports two formats:
// 1. Toolasha / combat-sim export (single loadout per paste)
// 2. Full character data (init_character_data) with multiple combat loadouts

import { useState, useCallback, useEffect, useRef } from "react";
import type { GameData, PlayerConfig } from "../../engine/types";
import { parsePlayerData, PlayerDataError } from "../../data/playerData";
import {
  parseFullCharacterData,
  type FullCharacterData,
} from "../../data/fullCharacterData";
import { hridToName } from "../../utils/formatting";
import { saveCombatSlots, loadCombatSlots } from "../../hooks/usePersistedCharData";

const MAX_PARTY_SIZE = 5;

interface PlayerImportProps {
  gameData: GameData;
  playerConfigs: PlayerConfig[];
  onPartyUpdate: (configs: PlayerConfig[]) => void;
}

interface SlotState {
  jsonText: string;
  status: { type: "idle" | "success" | "error"; message: string };
  // Full character data fields (null when using Toolasha format)
  fullCharData: FullCharacterData | null;
  selectedLoadoutId: string;
}

function makeEmptySlot(): SlotState {
  return {
    jsonText: "",
    status: { type: "idle", message: "" },
    fullCharData: null,
    selectedLoadoutId: "",
  };
}

export default function PlayerImport({
  gameData,
  playerConfigs,
  onPartyUpdate,
}: PlayerImportProps) {
  const [slots, setSlots] = useState<SlotState[]>(() => {
    const saved = loadCombatSlots();
    if (saved && saved.length > 0) {
      return saved.map((text) => ({ ...makeEmptySlot(), jsonText: text }));
    }
    return [makeEmptySlot()];
  });

  // Auto-parse restored slots on first mount
  const hasAutoRestored = useRef(false);

  /** Apply a PlayerConfig at a given slot index */
  const applyConfig = useCallback(
    (index: number, config: PlayerConfig) => {
      const newConfigs: (PlayerConfig | undefined)[] = [];
      const maxLen = Math.max(playerConfigs.length, index + 1);
      for (let i = 0; i < maxLen; i++) {
        newConfigs[i] = i === index ? config : playerConfigs[i];
      }
      onPartyUpdate(newConfigs.filter((c): c is PlayerConfig => c != null));
    },
    [playerConfigs, onPartyUpdate]
  );

  const handleParse = useCallback(
    (index: number) => {
      const slot = slots[index];
      if (!slot.jsonText.trim()) {
        setSlots((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            status: { type: "error", message: "Please paste your character JSON first." },
          };
          return next;
        });
        return;
      }

      try {
        // Auto-detect format
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(slot.jsonText);
        } catch (e) {
          throw new Error(
            `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
          );
        }

        if (
          parsed &&
          typeof parsed === "object" &&
          "characterLoadoutMap" in parsed
        ) {
          // --- Full character data format ---
          const fullData = parseFullCharacterData(slot.jsonText, gameData);

          if (fullData.combatLoadouts.length === 0) {
            throw new Error("No combat loadouts found in character data.");
          }

          const firstLoadout = fullData.combatLoadouts[0];
          setSlots((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              fullCharData: fullData,
              selectedLoadoutId: firstLoadout.id,
              status: {
                type: "success",
                message: `Loaded ${fullData.hrid} — ${fullData.combatLoadouts.length} combat loadout${fullData.combatLoadouts.length !== 1 ? "s" : ""}`,
              },
            };
            return next;
          });

          applyConfig(index, firstLoadout.config);
        } else {
          // --- Toolasha / combat-sim format ---
          const config = parsePlayerData(slot.jsonText, gameData);
          setSlots((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              fullCharData: null,
              selectedLoadoutId: "",
              status: {
                type: "success",
                message: `Loaded ${hridToName(config.hrid)} - Lv ${config.attackLevel} ATK / ${config.defenseLevel} DEF`,
              },
            };
            return next;
          });
          applyConfig(index, config);
        }
      } catch (e) {
        const message =
          e instanceof PlayerDataError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Failed to parse player data";
        setSlots((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            fullCharData: null,
            selectedLoadoutId: "",
            status: { type: "error", message },
          };
          return next;
        });
      }
    },
    [slots, gameData, applyConfig]
  );

  const handleLoadoutChange = useCallback(
    (index: number, loadoutId: string) => {
      const slot = slots[index];
      if (!slot.fullCharData) return;

      const loadout = slot.fullCharData.combatLoadouts.find(
        (l) => l.id === loadoutId
      );
      if (!loadout) return;

      setSlots((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], selectedLoadoutId: loadoutId };
        return next;
      });

      applyConfig(index, loadout.config);
    },
    [slots, applyConfig]
  );

  // Auto-parse restored slots on first mount
  useEffect(() => {
    if (hasAutoRestored.current) return;
    hasAutoRestored.current = true;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].jsonText.trim()) {
        handleParse(i);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist slot JSON text whenever it changes
  useEffect(() => {
    saveCombatSlots(slots.map((s) => s.jsonText));
  }, [slots]);

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleParse(index);
    }
  };

  const addSlot = () => {
    if (slots.length >= MAX_PARTY_SIZE) return;
    setSlots((prev) => [...prev, makeEmptySlot()]);
  };

  const removeSlot = (index: number) => {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((_, i) => i !== index));
    const newConfigs = playerConfigs.filter((_, i) => i !== index);
    onPartyUpdate(newConfigs);
  };

  const setJsonText = (index: number, text: string) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], jsonText: text };
      return next;
    });
  };

  const partySize = playerConfigs.length;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          {slots.length > 1 ? "Party Import" : "Player Import"}
        </h2>
        <div className="flex items-center gap-2">
          {partySize > 0 && (
            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded">
              {partySize} player{partySize > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {slots.map((slot, index) => (
          <div key={index}>
            {/* Slot header */}
            {slots.length > 1 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500 uppercase">
                  {index === 0 ? "Primary Player" : `Party Member ${index + 1}`}
                </span>
                {index > 0 && (
                  <button
                    onClick={() => removeSlot(index)}
                    className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            <textarea
              value={slot.jsonText}
              onChange={(e) => setJsonText(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              placeholder={
                index === 0
                  ? "Paste character JSON (Toolasha export, combat-sim format, or full character data)..."
                  : "Paste party member JSON..."
              }
              className="w-full h-24 bg-gray-900 text-gray-300 text-xs font-mono border border-gray-600 rounded-md p-3 resize-y placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
              spellCheck={false}
            />

            <div className="flex items-center justify-between mt-1.5">
              <button
                onClick={() => handleParse(index)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1 rounded transition-colors cursor-pointer"
              >
                Parse
              </button>
              <span className="text-[10px] text-gray-500">Ctrl+Enter</span>
            </div>

            {slot.status.type !== "idle" && (
              <div
                className={`mt-1.5 text-xs px-3 py-2 rounded ${
                  slot.status.type === "success"
                    ? "bg-green-900/30 text-green-400 border border-green-800"
                    : "bg-red-900/30 text-red-400 border border-red-800"
                }`}
              >
                {slot.status.message}
              </div>
            )}

            {/* Loadout picker (full char data only) */}
            {slot.fullCharData &&
              slot.fullCharData.combatLoadouts.length > 1 && (
                <div className="mt-1.5">
                  <label className="block text-[10px] text-gray-500 uppercase mb-0.5">
                    Combat Loadout
                  </label>
                  <select
                    value={slot.selectedLoadoutId}
                    onChange={(e) =>
                      handleLoadoutChange(index, e.target.value)
                    }
                    className="w-full bg-gray-900 text-gray-300 text-xs border border-gray-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
                  >
                    {slot.fullCharData.combatLoadouts.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

            {/* Compact stat summary for loaded player */}
            {playerConfigs[index] && (
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-xs">
                <StatBadge label="STA" value={playerConfigs[index].staminaLevel} />
                <StatBadge label="INT" value={playerConfigs[index].intelligenceLevel} />
                <StatBadge label="ATK" value={playerConfigs[index].attackLevel} />
                <StatBadge label="DEF" value={playerConfigs[index].defenseLevel} />
                <StatBadge label="MEL" value={playerConfigs[index].meleeLevel} />
                <StatBadge label="RNG" value={playerConfigs[index].rangedLevel} />
                <StatBadge label="MAG" value={playerConfigs[index].magicLevel} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add party member button */}
      {slots.length < MAX_PARTY_SIZE && (
        <button
          onClick={addSlot}
          className="mt-3 w-full py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-dashed border-gray-600 hover:border-gray-500 rounded transition-colors cursor-pointer"
        >
          + Add Party Member ({slots.length}/{MAX_PARTY_SIZE})
        </button>
      )}
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 rounded px-2 py-1 text-center">
      <div className="text-gray-500 text-[10px] uppercase">{label}</div>
      <div className="text-gray-200 font-medium">{value}</div>
    </div>
  );
}
