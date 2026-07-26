// =============================================================================
// LabyrinthPanel - Full character data import, loadout assignment, crate
// selection, loadout optimizer, and results for labyrinth simulations
// =============================================================================

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { GameData, PlayerConfig } from "../../engine/types";
import type {
  CrateTier,
  LabyrinthProgress,
} from "../../features/labyrinthSimulator";
import { getLabyrinthMonsters, computeAdjustedLevel, DEFAULT_LEVEL_CV } from "../../features/labyrinthSimulator";
import {
  parseFullCharacterData,
  type FullCharacterData,
  type LabyrinthUpgradeState,
} from "../../data/fullCharacterData";
import { hridToName } from "../../utils/formatting";
import type {
  BestGearMode,
  LabyrinthOptResult,
  LabyrinthOptProgress,
  MonsterOptResult,
} from "../../optimizer/labyrinthOptimizer";
import { EQUIPMENT_SLOTS } from "../../engine/constants";
import type {
  LabOptWorkerStartMessage,
  LabOptWorkerOutMessage,
} from "../../optimizer/labyrinthOptimizer.worker";
import { serializeCharData } from "../../optimizer/labyrinthOptimizer.worker";
import type { XpBonusSettings } from "../../hooks/useSimulation";
import { saveLabJson, loadLabJson } from "../../hooks/usePersistedCharData";
import { labMonsterOrderByHrid } from "../../features/labyrinthAnalyzer/constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LabyrinthPanelProps {
  gameData: GameData;
  onRun: (
    defaultConfig: PlayerConfig,
    coffeeCrate: CrateTier,
    foodCrate: CrateTier,
    monsterLoadoutMap: Record<string, PlayerConfig>,
    successRate: number,
    loadoutNameMap: Record<string, string>,
    defaultLoadoutName: string,
    labUpgrades: LabyrinthUpgradeState | null
  ) => void;
  isRunning: boolean;
  progress?: LabyrinthProgress | null;
  xpBonuses: XpBonusSettings;
  /** Callback to expose raw character JSON data for floor analysis */
  onRawCharData?: (rawData: Record<string, unknown> | null) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COFFEE_OPTIONS: { value: CrateTier; label: string; desc: string }[] = [
  { value: "none", label: "None", desc: "" },
  { value: "basic", label: "Basic", desc: "+5 levels" },
  { value: "advanced", label: "Advanced", desc: "+10 levels" },
  { value: "expert", label: "Expert", desc: "+15 levels" },
];

const FOOD_OPTIONS: { value: CrateTier; label: string; desc: string }[] = [
  { value: "none", label: "None", desc: "" },
  { value: "basic", label: "Basic", desc: "+2% regen" },
  { value: "advanced", label: "Advanced", desc: "+4% regen" },
  { value: "expert", label: "Expert", desc: "+6% regen" },
];

const EMPTY_LAB_UPGRADES: LabyrinthUpgradeState = {
  combatDamage: 0,
  attackSpeed: 0,
  castSpeed: 0,
  criticalRate: 0,
  experience: 0,
  skillSpeed: 0,
  skillEfficiency: 0,
  skillSuccess: 0,
  skillDoubleProgress: 0,
};

const CLEAR_RATE_OPTIONS: { value: number; label: string; desc: string }[] = [
  { value: 0.1, label: "10%", desc: "~7% higher" },
  { value: 0.33, label: "33%", desc: "~2% higher" },
  { value: 0.5, label: "50%", desc: "no reduction" },
  { value: 0.75, label: "75%", desc: "~3% lower" },
  { value: 0.9, label: "90%", desc: "~6% lower" },
  { value: 0.95, label: "95%", desc: "~8% lower" },
  { value: 0.99, label: "99%", desc: "~10% lower" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectCrateTier(itemHrid: string): CrateTier {
  if (!itemHrid) return "none";
  const name = itemHrid.split("/").pop() ?? "";
  if (name.startsWith("expert_")) return "expert";
  if (name.startsWith("advanced_")) return "advanced";
  if (name.startsWith("basic_")) return "basic";
  return "none";
}

function computeWisdomBuffBonus(xpBonuses: XpBonusSettings): number {
  const communityWisdom =
    xpBonuses.communityBuffLevel > 0
      ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
      : 0;
  let bonus = communityWisdom;
  const pb = xpBonuses.playerBonuses[0];
  if (pb?.mooPass) bonus += 0.05;
  return bonus;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LabyrinthPanel({
  gameData,
  onRun,
  isRunning,
  progress,
  xpBonuses,
  onRawCharData,
}: LabyrinthPanelProps) {
  // --- Character data state ---
  const [jsonText, setJsonText] = useState(() => loadLabJson() ?? "");
  const hasAutoRestored = useRef(false);
  const [parseStatus, setParseStatus] = useState<{
    type: "idle" | "success" | "error";
    message: string;
  }>({ type: "idle", message: "" });
  const [charData, setCharData] = useState<FullCharacterData | null>(null);
  const [labUpgrades, setLabUpgrades] = useState<LabyrinthUpgradeState>(
    EMPTY_LAB_UPGRADES
  );
  const [showImport, setShowImport] = useState(true);

  // --- Crate state ---
  const [coffeeCrate, setCoffeeCrate] = useState<CrateTier>("none");
  const [foodCrate, setFoodCrate] = useState<CrateTier>("none");

  // --- Clear rate state ---
  const [successRate, setSuccessRate] = useState(0.5);

  // --- Loadout assignment ---
  const [defaultLoadoutId, setDefaultLoadoutId] = useState("");
  const [monsterOverrides, setMonsterOverrides] = useState<
    Record<string, string>
  >({});
  const [showOverrides, setShowOverrides] = useState(false);

  // --- Optimizer state ---
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [optRunning, setOptRunning] = useState(false);
  const [optProgress, setOptProgress] = useState<LabyrinthOptProgress | null>(null);
  const [optResult, setOptResult] = useState<LabyrinthOptResult | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [bestGearMode, setBestGearMode] = useState<BestGearMode>("owned");
  const [useBestAbilities, setUseBestAbilities] = useState(false);
  const [singleMonsterHrid, setSingleMonsterHrid] = useState<string | null>(null);
  const [ownedBackOnly, setOwnedBackOnly] = useState(false);
  const optWorkerRef = useRef<Worker | null>(null);

  // --- Derived data ---
  const labMonsters = useMemo(
    () =>
      [...getLabyrinthMonsters(gameData)].sort(
        (a, b) => labMonsterOrderByHrid(a) - labMonsterOrderByHrid(b)
      ),
    [gameData]
  );
  const loadouts = charData?.combatLoadouts ?? [];
  const defaultLoadout =
    loadouts.find((l) => l.id === defaultLoadoutId) ?? null;

  const monsterOptions = useMemo(() => {
    return [...getLabyrinthMonsters(gameData)]
      .sort((a, b) => labMonsterOrderByHrid(a) - labMonsterOrderByHrid(b))
      .map((hrid) => ({ value: hrid, label: hridToName(hrid) }));
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
      setLabUpgrades(parsed.labyrinthUpgrades);

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
  }, [jsonText, gameData]);

  // Auto-parse restored JSON on first mount
  useEffect(() => {
    if (hasAutoRestored.current) return;
    hasAutoRestored.current = true;
    if (jsonText.trim()) {
      handleParse();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist lab JSON whenever it changes
  useEffect(() => {
    saveLabJson(jsonText);
  }, [jsonText]);

  // --- Run handler ---
  const handleRun = useCallback(() => {
    if (!defaultLoadout) return;

    const loadoutMap: Record<string, PlayerConfig> = {};
    const loadoutNameMap: Record<string, string> = {};
    for (const [monsterHrid, loadoutId] of Object.entries(monsterOverrides)) {
      if (loadoutId) {
        const loadout = loadouts.find((l) => l.id === loadoutId);
        if (loadout) {
          loadoutMap[monsterHrid] = loadout.config;
          loadoutNameMap[monsterHrid] = loadout.name;
        }
      }
    }

    onRun(defaultLoadout.config, coffeeCrate, foodCrate, loadoutMap, successRate, loadoutNameMap, defaultLoadout.name, labUpgrades);
  }, [defaultLoadout, monsterOverrides, loadouts, coffeeCrate, foodCrate, successRate, onRun, labUpgrades]);

  // --- Optimizer handlers ---
  const handleOptimize = useCallback(() => {
    if (!charData || !defaultLoadout) return;

    setOptRunning(true);
    setOptResult(null);
    setOptError(null);
    setOptProgress(null);

    const worker = new Worker(
      new URL(
        "../../optimizer/labyrinthOptimizer.worker.ts",
        import.meta.url
      ),
      { type: "module" }
    );
    optWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LabOptWorkerOutMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "progress":
          setOptProgress(msg.progress);
          break;
        case "result":
          setOptResult(msg.result);
          setOptRunning(false);
          setOptProgress(null);
          worker.terminate();
          optWorkerRef.current = null;
          break;
        case "error":
          setOptError(msg.message);
          setOptRunning(false);
          setOptProgress(null);
          worker.terminate();
          optWorkerRef.current = null;
          break;
      }
    };

    worker.onerror = (e) => {
      setOptError(e.message || "Optimizer worker error");
      setOptRunning(false);
      setOptProgress(null);
      worker.terminate();
      optWorkerRef.current = null;
    };

    const startMsg: LabOptWorkerStartMessage = {
      type: "start",
      charData: serializeCharData(charData),
      defaultLoadoutId,
      monsterOverrides,
      coffeeCrate,
      foodCrate,
      labUpgrades,
      wisdomBuffBonus: computeWisdomBuffBonus(xpBonuses),
      gameData,
      successRate,
      bestGearMode,
      useBestAbilities,
      singleMonsterHrid,
      ownedBackOnly,
    };
    worker.postMessage(startMsg);
  }, [charData, defaultLoadout, defaultLoadoutId, monsterOverrides, coffeeCrate, foodCrate, labUpgrades, xpBonuses, gameData, successRate, bestGearMode, useBestAbilities, singleMonsterHrid, ownedBackOnly]);

  const handleCancelOptimize = useCallback(() => {
    if (optWorkerRef.current) {
      optWorkerRef.current.terminate();
      optWorkerRef.current = null;
    }
    setOptRunning(false);
    setOptProgress(null);
  }, []);

  const handleApplyOptResult = useCallback(() => {
    if (!optResult || !defaultLoadout) return;

    const loadoutMap: Record<string, PlayerConfig> = {};
    const loadoutNameMap: Record<string, string> = {};
    for (const mr of optResult.monsterResults) {
      loadoutMap[mr.monsterHrid] = mr.optimizedConfig;
      loadoutNameMap[mr.monsterHrid] = "Optimized";
    }

    onRun(
      defaultLoadout.config,
      coffeeCrate,
      foodCrate,
      loadoutMap,
      successRate,
      loadoutNameMap,
      defaultLoadout.name,
      labUpgrades
    );
  }, [optResult, defaultLoadout, coffeeCrate, foodCrate, successRate, onRun, labUpgrades]);

  const canRun = !!defaultLoadout && !isRunning && !optRunning;
  const canOptimize = !!charData && !!defaultLoadout && !isRunning && !optRunning;

  return (
    <div className="space-y-4">
      {/* ================================================================= */}
      {/* Character Data Import                                             */}
      {/* ================================================================= */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
            Character Data
          </h2>
          {charData && !showImport && (
            <button
              onClick={() => setShowImport(true)}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              Re-import
            </button>
          )}
        </div>

        {showImport ? (
          <>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleParse();
                }
              }}
              placeholder="Paste your full character data JSON (init_character_data)..."
              className="w-full h-24 bg-gray-900 text-gray-300 text-xs font-mono border border-gray-600 rounded-md p-3 resize-y placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
              spellCheck={false}
            />
            <div className="flex items-center justify-between mt-1.5">
              <button
                onClick={handleParse}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1 rounded transition-colors cursor-pointer"
              >
                Parse
              </button>
              <span className="text-[10px] text-gray-500">Ctrl+Enter</span>
            </div>
            {parseStatus.type === "error" && (
              <div className="mt-1.5 text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">
                {parseStatus.message}
              </div>
            )}
          </>
        ) : charData ? (
          <div className="text-xs text-green-400 bg-green-900/20 border border-green-800 rounded px-3 py-2">
            {parseStatus.message}
          </div>
        ) : null}
      </div>

      {/* ================================================================= */}
      {/* Loadout Assignment                                                */}
      {/* ================================================================= */}
      {charData && loadouts.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
            Loadout Assignment
          </h2>

          {/* Default loadout */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Default Loadout
            </label>
            <select
              value={defaultLoadoutId}
              onChange={(e) => setDefaultLoadoutId(e.target.value)}
              className="w-full bg-gray-900 text-gray-300 text-xs border border-gray-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {loadouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Per-monster overrides toggle */}
          <div>
            <button
              onClick={() => setShowOverrides(!showOverrides)}
              className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 cursor-pointer"
            >
              <span
                className={`inline-block transition-transform ${showOverrides ? "rotate-90" : ""}`}
              >
                &#9654;
              </span>
              Per-monster loadouts
              {Object.values(monsterOverrides).filter(Boolean).length > 0 && (
                <span className="text-blue-400 ml-1">
                  ({Object.values(monsterOverrides).filter(Boolean).length}{" "}
                  override
                  {Object.values(monsterOverrides).filter(Boolean).length !== 1
                    ? "s"
                    : ""}
                  )
                </span>
              )}
            </button>

            {showOverrides && (
              <div className="mt-2 space-y-1.5">
                {labMonsters.map((monsterHrid) => (
                  <div key={monsterHrid} className="flex items-center gap-2">
                    <span
                      className="text-xs text-gray-300 w-28 truncate shrink-0"
                      title={hridToName(monsterHrid)}
                    >
                      {hridToName(monsterHrid)}
                    </span>
                    <select
                      value={monsterOverrides[monsterHrid] ?? ""}
                      onChange={(e) =>
                        setMonsterOverrides((prev) => ({
                          ...prev,
                          [monsterHrid]: e.target.value,
                        }))
                      }
                      className="flex-1 min-w-0 bg-gray-900 text-gray-300 text-xs border border-gray-600 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">
                        Default ({defaultLoadout?.name})
                      </option>
                      {loadouts.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Crate Selection                                                   */}
      {/* ================================================================= */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          Labyrinth Crates
        </h2>

        {/* Coffee Crate */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Coffee Crate
          </label>
          <div className="flex gap-1">
            {COFFEE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCoffeeCrate(opt.value)}
                disabled={isRunning}
                className={`flex-1 text-xs px-2 py-1.5 rounded border transition-colors cursor-pointer ${
                  coffeeCrate === opt.value
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div>{opt.label}</div>
                {opt.desc && (
                  <div className="text-[10px] opacity-70">{opt.desc}</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Food Crate */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Food Crate
          </label>
          <div className="flex gap-1">
            {FOOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFoodCrate(opt.value)}
                disabled={isRunning}
                className={`flex-1 text-xs px-2 py-1.5 rounded border transition-colors cursor-pointer ${
                  foodCrate === opt.value
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div>{opt.label}</div>
                {opt.desc && (
                  <div className="text-[10px] opacity-70">{opt.desc}</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Target Clear Rate */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Target Clear Rate
          </label>
          <div className="flex gap-1">
            {CLEAR_RATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSuccessRate(opt.value)}
                disabled={isRunning}
                className={`flex-1 text-xs px-2 py-1.5 rounded border transition-colors cursor-pointer ${
                  successRate === opt.value
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300"
                } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div>{opt.label}</div>
                <div className="text-[10px] opacity-70">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* Active Buff Levels                                                */}
      {/* ================================================================= */}
      <ActiveBuffsPanel
        charData={charData}
        upgrades={labUpgrades}
        onUpgradesChange={setLabUpgrades}
        coffeeCrate={coffeeCrate}
        foodCrate={foodCrate}
        xpBonuses={xpBonuses}
      />

      {/* ================================================================= */}
      {/* Run Button                                                        */}
      {/* ================================================================= */}
      <button
        onClick={handleRun}
        disabled={!canRun}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
          !canRun
            ? "bg-gray-700 text-gray-500 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-500 text-white"
        }`}
      >
        {isRunning ? "Running..." : "Find Max Levels"}
      </button>

      {/* ================================================================= */}
      {/* Progress                                                          */}
      {/* ================================================================= */}
      {isRunning && progress && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-xs text-gray-300">
              Testing{" "}
              <span className="text-gray-200 font-medium">
                {hridToName(progress.monsterHrid)}
              </span>{" "}
              at level{" "}
              <span className="text-blue-400 font-medium">
                {progress.currentLevel}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Loadout Optimizer                                                 */}
      {/* ================================================================= */}
      {charData && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg">
          <button
            onClick={() => setShowOptimizer(!showOptimizer)}
            className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 transition-transform ${showOptimizer ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="text-sm font-semibold text-gray-300">
                Loadout Optimizer
              </span>
            </div>
          </button>

          {showOptimizer && (
            <div className="px-4 pb-4 space-y-3">
              <div className="text-xs text-gray-500">
                Tries different weapons, abilities, and gear from your loadouts
                to find the best setup for each monster. Runs in a background
                worker so the UI stays responsive.
              </div>

              {/* Best gear mode */}
              <div>
                <div className="text-xs text-gray-300 mb-1">Gear pool</div>
                <select
                  value={bestGearMode}
                  onChange={(e) => setBestGearMode(e.target.value as BestGearMode)}
                  disabled={optRunning}
                  className="w-full bg-gray-900 text-gray-300 text-xs border border-gray-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
                >
                  <option value="owned">Owned gear only</option>
                  <option value="best7">Best gear +7 (non-refined)</option>
                  <option value="best10R">Best gear +10R (all refined)</option>
                </select>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {bestGearMode === "owned" && "Uses only gear from your loadouts"}
                  {bestGearMode === "best7" && "All equippable non-refined items at +7 (owned refined/higher kept)"}
                  {bestGearMode === "best10R" && "All equippable items at +10, preferring refined versions"}
                </div>
              </div>

              {/* Owned back items only checkbox */}
              {bestGearMode !== "owned" && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ownedBackOnly}
                    onChange={(e) => setOwnedBackOnly(e.target.checked)}
                    disabled={optRunning}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <div>
                    <div className="text-xs text-gray-300">Owned back items only</div>
                    <div className="text-[10px] text-gray-500">
                      Restrict back slot to items from your gear pool
                    </div>
                  </div>
                </label>
              )}

              {/* Best abilities checkbox */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useBestAbilities}
                  onChange={(e) => setUseBestAbilities(e.target.checked)}
                  disabled={optRunning}
                  className="mt-0.5 accent-emerald-500"
                />
                <div>
                  <div className="text-xs text-gray-300">Use best possible abilities</div>
                  <div className="text-[10px] text-gray-500">
                    Test all abilities at lv70 (specials lv40), or current level if higher
                  </div>
                </div>
              </label>

              {/* Single monster mode */}
              <div>
                <div className="text-xs text-gray-300 mb-1">Target monster</div>
                <select
                  value={singleMonsterHrid ?? "all"}
                  onChange={(e) => setSingleMonsterHrid(e.target.value === "all" ? null : e.target.value)}
                  disabled={optRunning}
                  className="w-full bg-gray-900 text-gray-300 text-xs border border-gray-600 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All monsters</option>
                  {monsterOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {singleMonsterHrid 
                    ? "Optimize for one monster only (tests all gear slots)"
                    : "Optimize for all monsters (best10R skips back/feet)"
                  }
                </div>
              </div>

              {/* Optimize / Cancel buttons */}
              {!optRunning ? (
                <button
                  onClick={handleOptimize}
                  disabled={!canOptimize}
                  className={`w-full py-2 rounded text-sm font-medium cursor-pointer transition-all ${
                    !canOptimize
                      ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                      : "bg-emerald-700 hover:bg-emerald-600 text-white"
                  }`}
                >
                  Optimize Loadouts
                </button>
              ) : (
                <button
                  onClick={handleCancelOptimize}
                  className="w-full py-2 rounded text-sm font-medium bg-red-800 hover:bg-red-700 text-white cursor-pointer transition-all"
                >
                  Cancel
                </button>
              )}

              {/* Progress */}
              {optRunning && optProgress && (
                <div>
                  <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                    <span>
                      {optProgress.monstersCompleted} / {optProgress.monstersTotal} monsters
                    </span>
                    <span>
                      {optProgress.simRunsSoFar} sims
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all"
                      style={{
                        width: `${optProgress.monstersTotal > 0
                          ? (optProgress.monstersCompleted / optProgress.monstersTotal) * 100
                          : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] text-gray-400">
                      {hridToName(optProgress.monsterHrid)}
                      {optProgress.detail ? ` — ${optProgress.detail}` : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Error */}
              {optError && (
                <div className="bg-red-900/20 border border-red-800 rounded p-2 text-xs text-red-400">
                  {optError}
                </div>
              )}

              {/* Results */}
              {optResult && (
                <LabyrinthOptResults
                  result={optResult}
                  gameData={gameData}
                  onApply={handleApplyOptResult}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Hint when no data loaded */}
      {!charData && !isRunning && (
        <div className="text-xs text-gray-500 text-center py-2">
          Paste your full character data to run labyrinth simulations.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Optimizer Results Sub-component
// ---------------------------------------------------------------------------

function LabyrinthOptResults({
  result,
  gameData,
  onApply,
}: {
  result: LabyrinthOptResult;
  gameData: GameData;
  onApply: () => void;
}) {
  const levelDelta = result.optimizedTotalLevels - result.baselineTotalLevels;
  const sortedResults = [...result.monsterResults].sort(
    (a, b) => labMonsterOrderByHrid(a.monsterHrid) - labMonsterOrderByHrid(b.monsterHrid)
  );

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div
        className={`rounded border p-3 ${
          levelDelta > 0
            ? "bg-emerald-900/20 border-emerald-800/50"
            : "bg-gray-800 border-gray-700"
        }`}
      >
        <div className="flex justify-between items-center">
          <div className="text-xs text-gray-400">Baseline Total</div>
          <div className="text-sm text-gray-300">
            {result.baselineTotalLevels}
          </div>
        </div>
        <div className="flex justify-between items-center mt-1">
          <div className="text-xs text-gray-400">Optimized Total</div>
          <div className="text-sm font-semibold text-white">
            {result.optimizedTotalLevels}
          </div>
        </div>
        {levelDelta > 0 && (
          <div className="flex justify-between items-center mt-1">
            <div className="text-xs text-gray-400">Improvement</div>
            <div className="text-sm font-semibold text-emerald-400">
              +{levelDelta} levels
            </div>
          </div>
        )}
        <div className="text-[10px] text-gray-600 mt-1">
          {result.totalSimRuns} simulations run
        </div>
      </div>

      {/* Per-monster cards */}
      <div className="space-y-1">
        {sortedResults.map((mr) => (
          <MonsterOptCard key={mr.monsterHrid} mr={mr} gameData={gameData} />
        ))}
      </div>

      {/* Apply button */}
      <button
        onClick={onApply}
        className="w-full py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors"
      >
        Apply & Re-Run
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-monster expandable card
// ---------------------------------------------------------------------------

function MonsterOptCard({
  mr,
  gameData,
}: {
  mr: MonsterOptResult;
  gameData: GameData;
}) {
  const [expanded, setExpanded] = useState(false);

  const weaponName = mr.weaponHrid
    ? gameData.itemDetailMap[mr.weaponHrid]?.name ?? hridToName(mr.weaponHrid)
    : "None";

  const changeCount = mr.changes.length;

  return (
    <div className="bg-gray-800/50 rounded border border-gray-700">
      {/* Summary row — click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-gray-700/30 transition-colors"
      >
        <svg
          className={`w-3 h-3 shrink-0 transition-transform text-gray-500 ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <span className="text-[11px] text-gray-200 w-24 truncate shrink-0" title={hridToName(mr.monsterHrid)}>
          {hridToName(mr.monsterHrid)}
        </span>

        <span className="text-[11px] text-gray-500 w-8 text-right shrink-0">
          {mr.baselineLevel}
        </span>
        <span className="text-[11px] text-gray-500 shrink-0">{"\u2192"}</span>
        <span className="text-[11px] font-medium text-gray-200 w-8 text-right shrink-0">
          {mr.optimizedLevel}
        </span>

        <span
          className={`text-[11px] font-medium w-10 text-right shrink-0 ${
            mr.levelDelta > 0
              ? "text-emerald-400"
              : mr.levelDelta < 0
                ? "text-red-400"
                : "text-gray-600"
          }`}
        >
          {mr.levelDelta > 0 ? "+" : ""}{mr.levelDelta}
        </span>

        <span className="text-[10px] text-gray-500 truncate min-w-0" title={weaponName}>
          {weaponName}
        </span>

        {changeCount > 0 && (
          <span className="text-[10px] bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded shrink-0">
            {changeCount} change{changeCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-1">
          {mr.optimizedLevel > 0 && mr.rawOptimizedLevel > 0 && (
            <div className="text-[10px] text-gray-500 mb-2">
              Estimated range: <span className="text-gray-300">
                {computeAdjustedLevel(mr.rawOptimizedLevel, 0.9, DEFAULT_LEVEL_CV)}&ndash;{computeAdjustedLevel(mr.rawOptimizedLevel, 0.1, DEFAULT_LEVEL_CV)}
              </span>
            </div>
          )}
          <OptimizedLoadoutDetail
            config={mr.optimizedConfig}
            changes={mr.changes}
            gameData={gameData}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full loadout detail view (shows all equipped gear + abilities, highlights changes)
// ---------------------------------------------------------------------------

function OptimizedLoadoutDetail({
  config,
  changes,
  gameData,
}: {
  config: PlayerConfig;
  changes: MonsterOptResult["changes"];
  gameData: GameData;
}) {
  // Build a set of changed slot keys for highlighting
  const changedSlots = new Set(
    changes.map((c) => {
      if (c.slotType === "equipment") return `eq:${c.slotName}`;
      if (c.slotType === "ability") return `ab:${c.slotName}`;
      return `sp:${c.slotName}`;
    })
  );

  const equippedSlots = EQUIPMENT_SLOTS.filter(
    (slot) => config.equipment[slot]?.hrid
  );
  const abilities = config.abilities.filter(
    (a): a is NonNullable<typeof a> => a !== null && !!a.hrid
  );

  return (
    <div className="space-y-2">
      {/* Equipment */}
      {equippedSlots.length > 0 && (
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Equipment
          </div>
          <div className="grid grid-cols-2 gap-1">
            {equippedSlots.map((slot) => {
              const eq = config.equipment[slot]!;
              const itemName =
                gameData.itemDetailMap[eq.hrid]?.name ?? hridToName(eq.hrid);
              const slotName =
                gameData.equipmentTypeDetailMap[slot]?.name ?? hridToName(slot);
              const isChanged = changedSlots.has(`eq:${slot}`);
              return (
                <div
                  key={slot}
                  className={`rounded px-2 py-1 text-[11px] ${
                    isChanged
                      ? "bg-emerald-900/30 border border-emerald-800/50"
                      : "bg-gray-900/60"
                  }`}
                >
                  <span className="text-gray-500">{slotName}: </span>
                  <span className={isChanged ? "text-emerald-300" : "text-gray-300"}>
                    {itemName}
                  </span>
                  {eq.enhancementLevel > 0 && (
                    <span className="text-blue-400"> +{eq.enhancementLevel}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Abilities */}
      {abilities.length > 0 && (
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Abilities
          </div>
          <div className="space-y-1">
            {abilities.map((ab, i) => {
              const name =
                gameData.abilityDetailMap[ab.hrid]?.name ?? hridToName(ab.hrid);
              const isChanged = changedSlots.has(`ab:Ability ${i + 1}`);
              return (
                <div
                  key={i}
                  className={`rounded px-2 py-1 text-[11px] ${
                    isChanged
                      ? "bg-emerald-900/30 border border-emerald-800/50"
                      : "bg-gray-900/60"
                  }`}
                >
                  <span className={isChanged ? "text-emerald-300" : "text-gray-300"}>
                    {name}{" "}
                    <span className="text-gray-500">Lv{ab.level}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Special Ability */}
      {config.specialAbility && config.specialAbility.hrid && (
        <div>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
            Special Ability
          </div>
          {(() => {
            const isChanged = changedSlots.has("sp:Special");
            return (
              <div
                className={`rounded px-2 py-1 text-[11px] ${
                  isChanged
                    ? "bg-emerald-900/30 border border-emerald-800/50"
                    : "bg-gray-900/60"
                }`}
              >
                <span className={isChanged ? "text-emerald-300" : "text-gray-300"}>
                  {gameData.abilityDetailMap[config.specialAbility.hrid]?.name ??
                    hridToName(config.specialAbility.hrid)}{" "}
                  <span className="text-gray-500">
                    Lv{config.specialAbility.level}
                  </span>
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Show "no changes" hint when nothing was modified */}
      {changes.length === 0 && (
        <div className="text-[10px] text-gray-600 italic">
          No changes from baseline loadout.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Buffs Panel — shows what's actually applied to the lab simulation
// ---------------------------------------------------------------------------

const COFFEE_LEVEL_BOOST: Record<CrateTier, number> = {
  none: 0, basic: 5, advanced: 10, expert: 15,
};

const COFFEE_COMBAT_BUFFS: Record<CrateTier, { atkSpd: number; castSpd: number; critRate: number; critDmg: number }> = {
  none:     { atkSpd: 0,    castSpd: 0,    critRate: 0,    critDmg: 0    },
  basic:    { atkSpd: 0.05, castSpd: 0.05, critRate: 0,    critDmg: 0    },
  advanced: { atkSpd: 0.10, castSpd: 0.10, critRate: 0.03, critDmg: 0.05 },
  expert:   { atkSpd: 0.15, castSpd: 0.15, critRate: 0.06, critDmg: 0.10 },
};

const FOOD_REGEN: Record<CrateTier, number> = {
  none: 0, basic: 0.02, advanced: 0.04, expert: 0.06,
};

function pct(v: number): string {
  return `+${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`;
}

function BuffRow({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-gray-400">{label}</span>
      <span className={dim ? "text-gray-600" : "text-gray-200 tabular-nums"}>{value}</span>
    </div>
  );
}

function UpgradeRow({
  label,
  upgradeKey,
  levels,
  onChange,
  perLevel = 0.01,
}: {
  label: string;
  upgradeKey: keyof LabyrinthUpgradeState;
  levels: LabyrinthUpgradeState;
  onChange: (levels: LabyrinthUpgradeState) => void;
  perLevel?: number;
}) {
  const level = levels[upgradeKey];
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-gray-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={level > 0 ? "text-gray-300 tabular-nums" : "text-gray-600"}>
          {level > 0 ? pct(perLevel * level) : "—"}
        </span>
        <input
          type="number"
          min={0}
          step={1}
          value={level}
          aria-label={`${label} labyrinth upgrade level`}
          onChange={(event) =>
            onChange({
              ...levels,
              [upgradeKey]: Math.max(0, Math.floor(Number(event.target.value) || 0)),
            })
          }
          className="w-12 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-center text-[11px] text-gray-200 focus:border-blue-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

function ActiveBuffsPanel({
  charData,
  upgrades,
  onUpgradesChange,
  coffeeCrate,
  foodCrate,
  xpBonuses,
}: {
  charData: FullCharacterData | null;
  upgrades: LabyrinthUpgradeState;
  onUpgradesChange: (levels: LabyrinthUpgradeState) => void;
  coffeeCrate: CrateTier;
  foodCrate: CrateTier;
  xpBonuses: XpBonusSettings;
}) {
  const coffeeBoost = COFFEE_LEVEL_BOOST[coffeeCrate];
  const coffeeBuffs = COFFEE_COMBAT_BUFFS[coffeeCrate];
  const foodRegen = FOOD_REGEN[foodCrate];

  const communityWisdom =
    xpBonuses.communityBuffLevel > 0
      ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
      : 0;
  const mooPass = xpBonuses.playerBonuses[0]?.mooPass ? 0.05 : 0;
  const additionalXp = (xpBonuses.playerBonuses[0]?.additionalXpPercent ?? 0) / 100;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
        Active Buffs (Lab)
      </h2>

      {charData && !charData.hasLabyrinthUpgradeData && (
        <div className="rounded border border-amber-800/60 bg-amber-950/30 p-2 text-[10px] leading-relaxed text-amber-300">
          This privacy-filtered export does not include labyrinth upgrade levels.
          Enter the levels below; leaving them at 0 would omit those buffs.
        </div>
      )}

      {/* Permanent labyrinth upgrades from char data, or manual values when omitted. */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
          Combat Upgrades {charData ? "" : "(import char data)"}
        </div>
        <div className="space-y-1">
          <UpgradeRow label="Combat Damage" upgradeKey="combatDamage" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Attack Speed" upgradeKey="attackSpeed" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Cast Speed" upgradeKey="castSpeed" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Critical Rate" upgradeKey="criticalRate" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Combat XP" upgradeKey="experience" levels={upgrades} onChange={onUpgradesChange} />
        </div>
      </div>

      {/* Skill upgrades */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
          Skilling Upgrades {charData ? "" : "(import char data)"}
        </div>
        <div className="space-y-1">
          <UpgradeRow label="Action Speed" upgradeKey="skillSpeed" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Efficiency" upgradeKey="skillEfficiency" levels={upgrades} onChange={onUpgradesChange} />
          <UpgradeRow label="Success Rate" upgradeKey="skillSuccess" levels={upgrades} onChange={onUpgradesChange} perLevel={0.005} />
          <UpgradeRow label="Double Progress" upgradeKey="skillDoubleProgress" levels={upgrades} onChange={onUpgradesChange} />
        </div>
      </div>

      {/* Coffee crate */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          Coffee Crate ({coffeeCrate === "none" ? "none" : coffeeCrate})
        </div>
        <div className="space-y-0.5">
          <BuffRow label="Level Boost (all combat skills)" value={coffeeBoost > 0 ? `+${coffeeBoost}` : "—"} dim={coffeeBoost === 0} />
          <BuffRow label="Attack Speed"    value={coffeeBuffs.atkSpd  > 0 ? pct(coffeeBuffs.atkSpd)  : "—"} dim={coffeeBuffs.atkSpd  === 0} />
          <BuffRow label="Cast Speed"      value={coffeeBuffs.castSpd > 0 ? pct(coffeeBuffs.castSpd) : "—"} dim={coffeeBuffs.castSpd === 0} />
          <BuffRow label="Critical Rate"   value={coffeeBuffs.critRate > 0 ? pct(coffeeBuffs.critRate) : "—"} dim={coffeeBuffs.critRate === 0} />
          <BuffRow label="Critical Damage" value={coffeeBuffs.critDmg  > 0 ? pct(coffeeBuffs.critDmg)  : "—"} dim={coffeeBuffs.critDmg  === 0} />
        </div>
      </div>

      {/* Food crate */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          Food Crate ({foodCrate === "none" ? "none" : foodCrate})
        </div>
        <BuffRow label="HP/MP Regen" value={foodRegen > 0 ? pct(foodRegen) : "—"} dim={foodRegen === 0} />
      </div>

      {/* XP-only buffs (do not affect kill outcomes, only XP gained) */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
          XP Multipliers
        </div>
        <div className="space-y-0.5">
          <BuffRow label={`Community Wisdom (lv ${xpBonuses.communityBuffLevel || "off"})`} value={communityWisdom > 0 ? pct(communityWisdom) : "—"} dim={communityWisdom === 0} />
          <BuffRow label="MooPass" value={mooPass > 0 ? pct(mooPass) : "—"} dim={mooPass === 0} />
          <BuffRow label="Other XP" value={additionalXp > 0 ? pct(additionalXp) : "—"} dim={additionalXp === 0} />
        </div>
      </div>

      <div className="text-[10px] text-gray-600 leading-relaxed">
        Scrolls (atk spd / cast spd / damage / crit / wisdom) have no effect in labyrinth and are not applied.
      </div>
    </div>
  );
}
