// =============================================================================
// PlayerImport — Party member import UI
// Supports:
// 1. Toolasha / combat-sim export (single loadout per paste)
// 2. Full character data (init_character_data) with multiple combat loadouts

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { GameData, PlayerConfig } from "../../engine/types";
import { parsePlayerData, PlayerDataError } from "../../data/playerData";
import {
  parseFullCharacterData,
  type FullCharacterData,
} from "../../data/fullCharacterData";
import { hridToName } from "../../utils/formatting";
import { saveCombatSlots, loadCombatSlots } from "../../hooks/charDataPersistence";

const MAX_PARTY_SIZE = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlotState {
  jsonText: string;
  parseStatus: "idle" | "parsing" | "error" | "success";
  errorMessage?: string;
  data?: PlayerConfig | FullCharacterData;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlayerImportProps {
  gameData: GameData;
  playerConfigs: PlayerConfig[];
  onPartyUpdate: (party: PlayerConfig[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptySlot(): SlotState {
  return {
    jsonText: "",
    parseStatus: "idle",
    errorMessage: undefined,
    data: undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
      setSlots((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          parseStatus: "success",
          data: config,
        };
        return updated;
      });
    },
    []
  );

  /** Parse data at a specific slot. Handles both combat-sim and full character data. */
  const handleParse = useCallback(
    (index: number) => {
      const slot = slots[index];
      if (!slot.jsonText.trim()) {
        setSlots((prev) => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            parseStatus: "error",
            errorMessage: "Empty JSON",
          };
          return updated;
        });
        return;
      }

      setSlots((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], parseStatus: "parsing" };
        return updated;
      });

      // Defer parsing to next tick to show "parsing" status
      setTimeout(() => {
        try {
          // Try parsing as full character data (multi-loadout) first
          try {
            const fullCharData = parseFullCharacterData(
              slot.jsonText,
              gameData
            );
            setSlots((prev) => {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                parseStatus: "success",
                data: fullCharData,
              };
              return updated;
            });
            return;
          } catch {
            // Fall through to single player parse
          }

          // Try parsing as single combat-sim export
          const config = parsePlayerData(slot.jsonText, gameData);
          applyConfig(index, config);
        } catch (err) {
          const message =
            err instanceof PlayerDataError
              ? err.message
              : "Failed to parse JSON. Paste combat-sim export or full character data.";
          setSlots((prev) => {
            const updated = [...prev];
            updated[index] = {
              ...updated[index],
              parseStatus: "error",
              errorMessage: message,
            };
            return updated;
          });
        }
      }, 0);
    },
    [slots, gameData, applyConfig]
  );

  /** Get all valid players from all slots */
  const allPlayers = useMemo(() => {
    const players: PlayerConfig[] = [];
    for (const slot of slots) {
      if (slot.parseStatus === "success" && slot.data) {
        if ("playerHrid" in slot.data) {
          // Single PlayerConfig
          players.push(slot.data);
        } else {
          // FullCharacterData — extract combatLoadouts -> PlayerConfigs
          const fullChar = slot.data as FullCharacterData;
          for (const loadout of fullChar.combatLoadouts) {
            players.push({
              playerHrid: fullChar.hrid,
              playerName: fullChar.name,
              level: loadout.level,
              xp: loadout.xp,
              abilitySlots: loadout.abilities,
              equipmentSlots: loadout.equipment,
              consumableSlots: loadout.consumables,
            });
          }
        }
      }
    }
    return players;
  }, [slots]);

  /** Sync party to parent whenever allPlayers changes */
  useEffect(() => {
    onPartyUpdate(allPlayers.slice(0, MAX_PARTY_SIZE));
  }, [allPlayers, onPartyUpdate]);

  // Auto-parse restored slots on first mount
  useEffect(() => {
    if (hasAutoRestored.current) return;
    hasAutoRestored.current = true;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].jsonText.trim()) {
        handleParse(i);
      }
    }
  }, []);

  // Persist slot JSON text whenever it changes
  useEffect(() => {
    saveCombatSlots(slots.map((s) => s.jsonText));
  }, [slots]);

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    // Ctrl+Enter / Cmd+Enter to parse
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleParse(index);
    }
  };

  const handleAddSlot = () => {
    if (slots.length < MAX_PARTY_SIZE) {
      setSlots([...slots, makeEmptySlot()]);
    }
  };

  const handleRemoveSlot = (index: number) => {
    if (slots.length > 1) {
      setSlots(slots.filter((_, i) => i !== index));
    }
  };

  return (
    <div className="space-y-4">
      {/* Slot grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">
                Slot {i + 1}
              </span>
              {slots.length > 1 && (
                <button
                  onClick={() => handleRemoveSlot(i)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* JSON input */}
            <textarea
              value={slot.jsonText}
              onChange={(e) => {
                setSlots((prev) => {
                  const updated = [...prev];
                  updated[i] = { ...updated[i], jsonText: e.target.value };
                  return updated;
                });
              }}
              onKeyDown={(e) => handleKeyDown(i, e)}
              placeholder="Paste JSON here (Ctrl+Enter to parse)"
              className="min-h-32 w-full resize-none rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />

            {/* Parse button */}
            <button
              onClick={() => handleParse(i)}
              disabled={slot.parseStatus === "parsing"}
              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
            >
              {slot.parseStatus === "parsing" ? "Parsing..." : "Parse"}
            </button>

            {/* Status message */}
            {slot.parseStatus === "success" && slot.data && (
              <div className="rounded bg-green-50 p-2 text-xs text-green-700">
                ✓{" "}
                {("playerHrid" in slot.data
                  ? slot.data.playerName ?? slot.data.playerHrid
                  : (slot.data as FullCharacterData).name) || "Loaded"}
              </div>
            )}
            {slot.parseStatus === "error" && (
              <div className="rounded bg-red-50 p-2 text-xs text-red-700">
                ✕ {slot.errorMessage || "Parse failed"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add slot button */}
      {slots.length < MAX_PARTY_SIZE && (
        <button
          onClick={handleAddSlot}
          className="rounded border-2 border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-blue-500 hover:text-blue-600"
        >
          + Add Slot
        </button>
      )}

      {/* Party summary */}
      {allPlayers.length > 0 && (
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-900">
            Party: {allPlayers.length} player{allPlayers.length !== 1 ? "s" : ""}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-blue-800">
            {allPlayers.slice(0, MAX_PARTY_SIZE).map((p, i) => (
              <li key={i}>
                • {p.playerName ?? hridToName(p.playerHrid)} (Lvl{" "}
                {p.level})
              </li>
            ))}
          </ul>
          {allPlayers.length > MAX_PARTY_SIZE && (
            <p className="mt-2 text-xs text-blue-700">
              (Showing first {MAX_PARTY_SIZE}; {allPlayers.length - MAX_PARTY_SIZE} more)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
