// =============================================================================
// LabyrinthPanel — UI for selecting player, monster overrides, crate tiers,
// selection, loadout optimizer, and results for labyrinth simulations
// =============================================================================

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { GameData, PlayerConfig, BuffData } from "../../engine/types";
import type {
  CrateTier,
  LabyrinthResult,
  LabyrinthLoadout,
  MonsterLoadout,
} from "../../features/labyrinthSimulator";
import {
  createLabyrinthLoadout,
  simulateLabyrinth,
} from "../../features/labyrinthSimulator";
import { getLabyrinthMonsters, detectCrateTier } from "../../data/labyrinthData";
import {
  parseFullCharacterData,
  type FullCharacterData,
} from "../../data/fullCharacterData";
import { hridToName } from "../../utils/formatting";
import LabyrinthPlayerSelect from "./LabyrinthPlayerSelect";
import LabyrinthLoadoutOptimizer from "./LabyrinthLoadoutOptimizer";
import LabyrinthMonsterOverrides from "./LabyrinthMonsterOverrides";
import LabyrinthResultsPanel from "./LabyrinthResultsPanel";
import LabyrinthJsonImport from "./LabyrinthJsonImport";
import type {
  OptimizeLabyrinthRequest,
  OptimizeLabyrinthResult,
  OptimizeLabyrinthError,
} from "../../optimizer/labyrinthOptimizer.worker";
import { serializeCharData } from "../../optimizer/labyrinthOptimizer.worker";
import type { XpBonusSettings } from "../../hooks/useSimulation";
import { saveLabJson, loadLabJson } from "../../hooks/charDataPersistence";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LabyrinthPanelProps {
  gameData: GameData;
  playerConfigs: PlayerConfig[];
  onRawCharData?: (raw: unknown) => void;
}

// ---------------------------------------------------------------------------
// Labyrinth Panel
// ---------------------------------------------------------------------------

export default function LabyrinthPanel({
  gameData,
  playerConfigs,
  onRawCharData,
}: LabyrinthPanelProps) {
  // --- Character data state ---
  const [jsonText, setJsonText] = useState(() => loadLabJson() ?? "");
  const hasAutoRestored = useRef(false);
  const [parseStatus, setParseStatus] = useState<{
    type: "idle" | "success" | "error";
    message: string;
  }>({
    type: "idle",
    message: "",
  });

  // --- Parsed data state ---
  const [charData, setCharData] = useState<FullCharacterData | null>(null);

  // --- Loadout state ---
  const [defaultLoadoutId, setDefaultLoadoutId] = useState<string | null>(null);

  // --- UI state ---
  const [showImport, setShowImport] = useState(true);

  // --- Crate configuration ---
  const [coffeeCrate, setCoffeeCrate] = useState<CrateTier>("bronze");
  const [foodCrate, setFoodCrate] = useState<CrateTier>("bronze");

  // --- Monster overrides ---
  const [monsterOverrides, setMonsterOverrides] = useState<MonsterLoadout[]>(
    []
  );

  // --- Optimization ---
  const optimizerWorker = useRef<Worker | null>(null);
  const [optResult, setOptResult] = useState<OptimizeLabyrinthResult | null>(
    null
  );
  const [isOptimizing, setIsOptimizing] = useState(false);

  // --- Results ---
  const [results, setResults] = useState<LabyrinthResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // --- XP Bonus settings ---
  const [xpBonusSettings, setXpBonusSettings] = useState<XpBonusSettings>({
    wisdom: 0,
    seal: 0,
    communityBuff: false,
  });

  // --- Load default loadout ---
  const defaultLoadout = useMemo(() => {
    if (!charData || !defaultLoadoutId) return null;
    return charData.combatLoadouts.find((l) => l.id === defaultLoadoutId) ?? null;
  }, [charData, defaultLoadoutId]);

  // --- Gather available players ---
  const availablePlayers = useMemo(() => {
    if (!defaultLoadout) return [];
    const partyLookup = new Map(defaultLoadout.party.map((p) => [p.hrid, p]));
    return playerConfigs
      .filter((p) => partyLookup.has(p.playerHrid))
      .map((p) => {
        const partySlot = partyLookup.get(p.playerHrid)!;
        return { player: p, slot: partySlot };
      });
  }, [defaultLoadout, playerConfigs]);

  // --- Monster options ---
  const monsterOptions = useMemo(() => {
    const monsters = getLabyrinthMonsters(gameData);
    return monsters
      .map(hrid => ({ value: hrid, label: hridToName(hrid) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gameData]);

  // --- Parse handler ---
  const handleParse = useCallback(() => {
    if (!jsonText.trim()) {
      setParseStatus({
        type: "error",
        message: "Paste your full character data JSON first.",
      });
      return;
    }
    try {
      const parsed = parseFullCharacterData(jsonText, gameData);
      setCharData(parsed);

      // Also expose raw JSON for floor analysis
      try {
        const rawJson = JSON.parse(jsonText);
        onRawCharData?.(rawJson);
      } catch { /* ignore parse error for raw data */ }

      if (parsed.combatLoadouts.length > 0) {
        setDefaultLoadoutId(parsed.combatLoadouts[0].id);
      }

      setCoffeeCrate(detectCrateTier(parsed.labyrinthCrates.coffeeCrate));
      setFoodCrate(detectCrateTier(parsed.labyrinthCrates.foodCrate));
      setMonsterOverrides(parsed.labyrinthMonsterLoadouts);
      setShowImport(false);
      setOptResult(null);
      setParseStatus({
        type: "success",
        message: `Loaded ${parsed.hrid} \u2014 ${parsed.combatLoadouts.length} combat loadouts`,
      });
    } catch (e) {
      setParseStatus({
        type: "error",
        message:
          e instanceof Error ? e.message : "Failed to parse character data",
      });
    }
  }, [jsonText, gameData, onRawCharData]);

  // Auto-parse restored JSON on first mount
  useEffect(() => {
    if (hasAutoRestored.current) return;
    hasAutoRestored.current = true;
    if (jsonText.trim()) {
      handleParse();
    }
  }, [handleParse]);

  // Persist lab JSON whenever it changes
  useEffect(() => {
    saveLabJson(jsonText);
  }, [jsonText]);

  // --- Run handler ---
  const handleRun = useCallback(() => {
    if (!defaultLoadout) return;

    setIsRunning(true);
    setResults(null);

    setTimeout(() => {
      try {
        const results: LabyrinthResult[] = [];
        for (const ap of availablePlayers) {
          const loadout = createLabyrinthLoadout(
            ap.player,
            defaultLoadout,
            gameData
          );
          const result = simulateLabyrinth(
            loadout,
            coffeeCrate,
            foodCrate,
            monsterOverrides
          );
          results.push({
            playerName: ap.player.playerName ?? ap.player.playerHrid,
            result,
          });
        }
        setResults(results);
      } catch (e) {
        console.error("Labyrinth run failed:", e);
      } finally {
        setIsRunning(false);
      }
    }, 0);
  }, [defaultLoadout, availablePlayers, gameData, coffeeCrate, foodCrate, monsterOverrides]);

  // --- Optimizer handler ---
  const handleOptimize = useCallback(() => {
    if (!defaultLoadout) return;

    setIsOptimizing(true);
    setOptResult(null);

    // Serialize the loadout for the worker
    const serialized = serializeCharData(defaultLoadout, gameData);

    if (!optimizerWorker.current) {
      optimizerWorker.current = new Worker(
        new URL(
          "../../optimizer/labyrinthOptimizer.worker.ts",
          import.meta.url
        ),
        { type: "module" }
      );
    }

    const handler = (event: MessageEvent) => {
      const { result, error } = event.data as
        | { result: OptimizeLabyrinthResult; error?: undefined }
        | { error: OptimizeLabyrinthError; result?: undefined };

      optimizerWorker.current!.removeEventListener("message", handler);
      optimizerWorker.current!.removeEventListener("error", errorHandler);

      if (error) {
        console.error("Optimizer error:", error);
        setOptResult(null);
      } else {
        setOptResult(result);
      }

      setIsOptimizing(false);
    };

    const errorHandler = (event: ErrorEvent) => {
      console.error("Worker error:", event);
      optimizerWorker.current!.removeEventListener("message", handler);
      optimizerWorker.current!.removeEventListener("error", errorHandler);
      setOptResult(null);
      setIsOptimizing(false);
    };

    optimizerWorker.current.addEventListener("message", handler);
    optimizerWorker.current.addEventListener("error", errorHandler);

    const request: OptimizeLabyrinthRequest = {
      serialized,
      coffeeTier: coffeeCrate,
      foodTier: foodCrate,
      gameData,
    };

    optimizerWorker.current.postMessage(request);
  }, [defaultLoadout, gameData, coffeeCrate, foodCrate]);

  if (!playerConfigs || playerConfigs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900">
            No player data loaded
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Import a character or paste full character data to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-white p-4">
      {/* Character import panel */}
      {showImport && (
        <LabyrinthJsonImport
          jsonText={jsonText}
          onJsonChange={setJsonText}
          onParse={handleParse}
          status={parseStatus}
        />
      )}

      {/* Main content */}
      {charData && (
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Left side: configuration */}
          <div className="flex w-80 flex-col gap-4 overflow-y-auto border-r border-slate-200 pr-4">
            <LabyrinthPlayerSelect
              loadouts={charData.combatLoadouts}
              players={availablePlayers}
              selectedLoadoutId={defaultLoadoutId}
              onLoadoutChange={setDefaultLoadoutId}
            />

            {defaultLoadout && (
              <>
                <LabyrinthMonsterOverrides
                  monsters={monsterOptions}
                  overrides={monsterOverrides}
                  onOverridesChange={setMonsterOverrides}
                />

                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    Coffee Crate
                  </label>
                  <select
                    value={coffeeCrate}
                    onChange={(e) =>
                      setCoffeeCrate(e.target.value as CrateTier)
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="bronze">Bronze</option>
                    <option value="silver">Silver</option>
                    <option value="gold">Gold</option>
                    <option value="diamond">Diamond</option>
                  </select>

                  <label className="mt-2 block text-xs font-semibold text-slate-700">
                    Food Crate
                  </label>
                  <select
                    value={foodCrate}
                    onChange={(e) =>
                      setFoodCrate(e.target.value as CrateTier)
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="bronze">Bronze</option>
                    <option value="silver">Silver</option>
                    <option value="gold">Gold</option>
                    <option value="diamond">Diamond</option>
                  </select>
                </div>

                {/* Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleRun}
                    disabled={isRunning}
                    className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
                  >
                    {isRunning ? "Running..." : "Run"}
                  </button>
                  <button
                    onClick={handleOptimize}
                    disabled={isOptimizing}
                    className="flex-1 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:bg-slate-400"
                  >
                    {isOptimizing ? "Optimizing..." : "Optimize"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right side: results */}
          <div className="flex-1 overflow-y-auto">
            {results && <LabyrinthResultsPanel results={results} />}
            {optResult && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-semibold text-slate-900">
                  Optimization Results
                </h3>
                <pre className="mt-2 text-xs overflow-auto max-h-96">
                  {JSON.stringify(optResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
