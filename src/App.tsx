// =============================================================================
// App - MWI Combat Averagelator main application component
// =============================================================================

import { useState, useCallback } from "react";
import type { PlayerConfig } from "./engine/types";
import { useGameData } from "./hooks/useGameData";
import { useSimulation } from "./hooks/useSimulation";
import type { XpBonusSettings } from "./hooks/useSimulation";
import { defaultPlayerBonus } from "./hooks/useSimulation";
import { useLabyrinth } from "./hooks/useLabyrinth";
import { useZoneRanking } from "./hooks/useZoneRanking";
import type { CrateTier } from "./features/labyrinthSimulator";
import Header from "./components/layout/Header";
import PlayerImport from "./components/player/PlayerImport";
import PlayerLoadout from "./components/player/PlayerLoadout";
import ZoneSelector from "./components/simulation/ZoneSelector";
import BonusSettings from "./components/simulation/BonusSettings";
import ResultsSummary from "./components/simulation/ResultsSummary";
import ResultsDetail from "./components/simulation/ResultsDetail";
import PartyLoadoutViewer from "./components/simulation/PartyLoadoutViewer";
import TriggerOptimizer from "./components/simulation/TriggerOptimizer";
import LabyrinthPanel from "./components/labyrinth/LabyrinthPanel";
import LabyrinthResults from "./components/labyrinth/LabyrinthResults";
import ZoneRankingPanel from "./components/zones/ZoneRankingPanel";
import ZoneRankingResults from "./components/zones/ZoneRankingResults";
import PlayerCombatStats from "./components/player/PlayerCombatStats";

type AppMode = "combat" | "labyrinth" | "zoneRanking";

function App() {
  const { gameData, isLoading, error: gameDataError, uploadCustomData } = useGameData();
  const { result, isRunning, error: simError, runSimulation, clearResults } = useSimulation();
  const {
    results: labResults,
    isRunning: labRunning,
    error: labError,
    progress: labProgress,
    runLabyrinth,
    clearResults: clearLabResults,
  } = useLabyrinth();
  const {
    results: zoneRankResults,
    isRunning: zoneRankRunning,
    error: zoneRankError,
    progress: zoneRankProgress,
    runRanking,
    cancelRanking,
    clearResults: clearZoneRankResults,
  } = useZoneRanking();

  const [mode, setMode] = useState<AppMode>("combat");
  const [labLoadoutNameMap, setLabLoadoutNameMap] = useState<Record<string, string>>({});
  const [labDefaultLoadoutName, setLabDefaultLoadoutName] = useState("Default");
  const [labRawCharData, setLabRawCharData] = useState<Record<string, unknown> | null>(null);
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>([]);
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState(0);
  const [xpBonuses, setXpBonuses] = useState<XpBonusSettings>({
    communityBuffLevel: 0,
    playerBonuses: [defaultPlayerBonus()],
  });
  const [labXpBonuses, setLabXpBonuses] = useState<XpBonusSettings>({
    communityBuffLevel: 0,
    playerBonuses: [{
      ...defaultPlayerBonus(),
      seals: {
        attackSpeed: true,
        castSpeed: true,
        damage: true,
        criticalRate: true,
        combatDrop: false,
        wisdom: false,
      },
    }],
  });

  const primaryConfig = playerConfigs[0] ?? null;

  const handlePartyUpdate = useCallback(
    (configs: PlayerConfig[]) => {
      setPlayerConfigs(configs);
      setXpBonuses((prev) => {
        const bonuses = [...prev.playerBonuses];
        while (bonuses.length < configs.length) bonuses.push(defaultPlayerBonus());
        return { ...prev, playerBonuses: bonuses.slice(0, configs.length) };
      });
      clearResults();
      clearLabResults();
      clearZoneRankResults();
    },
    [clearResults, clearLabResults, clearZoneRankResults]
  );

  const handleZoneChange = useCallback(
    (zoneHrid: string) => {
      setSelectedZone(zoneHrid);
      clearResults();
    },
    [clearResults]
  );

  const handleDifficultyChange = useCallback(
    (tier: number) => {
      setSelectedDifficulty(tier);
      clearResults();
    },
    [clearResults]
  );

  const handleRunSimulation = useCallback(() => {
    if (playerConfigs.length === 0 || !selectedZone || !gameData) return;
    runSimulation(
      {
        playerConfigs,
        zoneHrid: selectedZone,
        difficultyTier: selectedDifficulty,
        xpBonuses,
      },
      gameData
    );
  }, [playerConfigs, selectedZone, selectedDifficulty, xpBonuses, gameData, runSimulation]);

  const handleRunLabyrinth = useCallback(
    (
      defaultConfig: PlayerConfig,
      coffeeCrate: CrateTier,
      foodCrate: CrateTier,
      monsterLoadoutMap: Record<string, PlayerConfig>,
      successRate: number,
      loadoutNameMap: Record<string, string>,
      defaultLoadoutName: string
    ) => {
      if (!gameData) return;
      setLabLoadoutNameMap(loadoutNameMap);
      setLabDefaultLoadoutName(defaultLoadoutName);
      runLabyrinth(defaultConfig, coffeeCrate, foodCrate, labXpBonuses, gameData, monsterLoadoutMap, successRate);
    },
    [labXpBonuses, gameData, runLabyrinth]
  );

  const handleRunZoneRanking = useCallback(
    (difficultyTier: number) => {
      if (playerConfigs.length === 0 || !gameData) return;
      runRanking(playerConfigs, difficultyTier, xpBonuses, gameData);
    },
    [playerConfigs, xpBonuses, gameData, runRanking]
  );

  const handleApplyOptimizedTriggers = useCallback(
    (optimizedConfigs: PlayerConfig[]) => {
      setPlayerConfigs(optimizedConfigs);
      // Re-run simulation with optimized configs
      if (selectedZone && gameData) {
        runSimulation(
          {
            playerConfigs: optimizedConfigs,
            zoneHrid: selectedZone,
            difficultyTier: selectedDifficulty,
            xpBonuses,
          },
          gameData
        );
      }
    },
    [selectedZone, selectedDifficulty, xpBonuses, gameData, runSimulation]
  );

  const canRunSimulation = playerConfigs.length > 0 && !!selectedZone && !!gameData && !isRunning;

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <div className="text-gray-400 text-sm">Loading game data...</div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (gameDataError || !gameData) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-6 max-w-lg text-center">
          <div className="text-red-400 text-lg font-semibold mb-2">
            Failed to Load Game Data
          </div>
          <div className="text-red-300 text-sm mb-4">
            {gameDataError || "Game data is unavailable."}
          </div>
          <div className="text-gray-500 text-xs">
            Make sure <code className="text-gray-400">init_client_data.json</code> is
            in the <code className="text-gray-400">public/</code> directory, or upload
            a custom file.
          </div>
          <label className="mt-4 inline-block bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded border border-gray-600 cursor-pointer transition-colors">
            Upload Game Data
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadCustomData(file);
              }}
            />
          </label>
        </div>
      </div>
    );
  }

  // --- Main app ---
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <Header
        gameVersion={gameData.gameVersion}
        onUploadGameData={uploadCustomData}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Mode Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => setMode("combat")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              mode === "combat"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Combat Sim
          </button>
          <button
            onClick={() => setMode("labyrinth")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              mode === "labyrinth"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Labyrinth
          </button>
          <button
            onClick={() => setMode("zoneRanking")}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
              mode === "zoneRanking"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Zone Ranking
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left panel: mode-specific controls */}
          <div className="lg:col-span-4 space-y-4">
            {/* Combat Sim controls */}
            {mode === "combat" && (
              <>
                <PlayerImport
                  gameData={gameData}
                  playerConfigs={playerConfigs}
                  onPartyUpdate={handlePartyUpdate}
                />

                {primaryConfig && (
                  <PlayerLoadout
                    player={primaryConfig}
                    gameData={gameData}
                    onChange={(updated) => {
                      setPlayerConfigs((prev) => [updated, ...prev.slice(1)]);
                      clearResults();
                    }}
                  />
                )}

                <BonusSettings
                  settings={xpBonuses}
                  onChange={setXpBonuses}
                  playerNames={playerConfigs.filter(Boolean).map((c) => c.hrid)}
                />

                <ZoneSelector
                  gameData={gameData}
                  selectedZone={selectedZone}
                  selectedDifficulty={selectedDifficulty}
                  onZoneChange={handleZoneChange}
                  onDifficultyChange={handleDifficultyChange}
                />

                <button
                  onClick={handleRunSimulation}
                  disabled={!canRunSimulation}
                  className={`w-full py-3 rounded-lg text-sm font-semibold transition-all ${
                    canRunSimulation
                      ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer shadow-lg shadow-blue-600/20"
                      : "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700"
                  }`}
                >
                  {isRunning ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Simulating...
                    </span>
                  ) : (
                    "Run Simulation"
                  )}
                </button>

                {!primaryConfig && !selectedZone && (
                  <div className="text-xs text-gray-600 text-center">
                    Paste your character JSON and select a zone to get started.
                  </div>
                )}
                {primaryConfig && !selectedZone && (
                  <div className="text-xs text-gray-600 text-center">
                    Select a zone to simulate.
                  </div>
                )}
                {!primaryConfig && selectedZone && (
                  <div className="text-xs text-gray-600 text-center">
                    Paste your character JSON to simulate.
                  </div>
                )}
              </>
            )}

            {/* Labyrinth controls */}
            {mode === "labyrinth" && (
              <>
                <LabyrinthPanel
                  gameData={gameData}
                  onRun={handleRunLabyrinth}
                  isRunning={labRunning}
                  progress={labProgress}
                  xpBonuses={labXpBonuses}
                  onRawCharData={setLabRawCharData}
                />

                <BonusSettings
                  settings={labXpBonuses}
                  onChange={setLabXpBonuses}
                  playerNames={["Labyrinth Player"]}
                />
              </>
            )}

            {/* Zone Ranking controls */}
            {mode === "zoneRanking" && (
              <>
                <PlayerImport
                  gameData={gameData}
                  playerConfigs={playerConfigs}
                  onPartyUpdate={handlePartyUpdate}
                />

                {primaryConfig && (
                  <PlayerLoadout
                    player={primaryConfig}
                    gameData={gameData}
                    onChange={(updated) => {
                      setPlayerConfigs((prev) => [updated, ...prev.slice(1)]);
                      clearZoneRankResults();
                    }}
                  />
                )}

                <BonusSettings
                  settings={xpBonuses}
                  onChange={setXpBonuses}
                  playerNames={playerConfigs.filter(Boolean).map((c) => c.hrid)}
                />

                <ZoneRankingPanel
                  gameData={gameData}
                  onRun={handleRunZoneRanking}
                  onCancel={cancelRanking}
                  isRunning={zoneRankRunning}
                  progress={zoneRankProgress}
                  canRun={playerConfigs.length > 0 && !zoneRankRunning}
                />

                {!playerConfigs.length && !zoneRankRunning && (
                  <div className="text-xs text-gray-600 text-center">
                    Import your character to rank all combat zones by XP/hr.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right panel: Results */}
          <div className="lg:col-span-8 space-y-4">
            {/* Combat Sim results */}
            {mode === "combat" && (
              <>
                {primaryConfig && (
                  <PlayerCombatStats
                    playerConfig={primaryConfig}
                    xpBonuses={xpBonuses}
                    gameData={gameData}
                  />
                )}

                {simError && (
                  <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                    <div className="text-red-400 text-sm font-medium mb-1">
                      Simulation Error
                    </div>
                    <div className="text-red-300 text-xs">{simError}</div>
                  </div>
                )}

                {result && (
                  <>
                    <ResultsSummary
                      summary={result.summary}
                      simResult={result.simResult}
                      playerHrid={result.playerHrid}
                      allPlayerSummaries={result.allPlayerSummaries}
                      xpBonusStats={result.xpBonusStats}
                      wisdomBuffBonus={result.wisdomBuffBonus}
                      additionalXpMultiplier={result.additionalXpMultiplier}
                      houseWisdom={result.houseWisdom}
                    />
                    {playerConfigs.length > 1 && (
                      <PartyLoadoutViewer
                        playerConfigs={playerConfigs}
                        gameData={gameData}
                      />
                    )}
                    <TriggerOptimizer
                      playerConfigs={playerConfigs}
                      zoneHrid={selectedZone}
                      difficultyTier={selectedDifficulty}
                      xpBonuses={xpBonuses}
                      gameData={gameData}
                      onApply={handleApplyOptimizedTriggers}
                    />
                    <ResultsDetail
                      simResult={result.simResult}
                      playerHrid={result.playerHrid}
                      expectedDrops={result.expectedDrops}
                      gameData={gameData}
                    />
                  </>
                )}

                {!result && !simError && !isRunning && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="text-gray-600 mb-2">
                      <svg
                        className="w-12 h-12 mx-auto"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                    </div>
                    <div className="text-gray-500 text-sm">
                      Simulation results will appear here
                    </div>
                    <div className="text-gray-600 text-xs mt-1">
                      Import your character, select a zone, and click Run Simulation
                    </div>
                  </div>
                )}

                {isRunning && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <div className="text-gray-400 text-sm">
                      Running deterministic simulation...
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Labyrinth results */}
            {mode === "labyrinth" && (
              <>
                {labError && (
                  <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                    <div className="text-red-400 text-sm font-medium mb-1">
                      Labyrinth Error
                    </div>
                    <div className="text-red-300 text-xs">{labError}</div>
                  </div>
                )}

                {labResults && labResults.length > 0 && (
                  <LabyrinthResults
                    results={labResults}
                    loadoutNameMap={labLoadoutNameMap}
                    defaultLoadoutName={labDefaultLoadoutName}
                    rawCharData={labRawCharData}
                    gameData={gameData}
                    withSeals={labXpBonuses.playerBonuses[0]?.seals?.wisdom ?? false}
                  />
                )}

                {!labResults && !labError && !labRunning && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="text-gray-600 mb-2">
                      <svg
                        className="w-12 h-12 mx-auto"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                        />
                      </svg>
                    </div>
                    <div className="text-gray-500 text-sm">
                      Labyrinth results will appear here
                    </div>
                    <div className="text-gray-600 text-xs mt-1">
                      Import your character, select crates, and click Find Max Levels
                    </div>
                  </div>
                )}

                {labRunning && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <div className="text-gray-400 text-sm">
                      Finding max labyrinth levels...
                    </div>
                    {labProgress && (
                      <div className="text-gray-500 text-xs mt-2">
                        Testing level {labProgress.currentLevel}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Zone Ranking results */}
            {mode === "zoneRanking" && (
              <>
                {zoneRankError && (
                  <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                    <div className="text-red-400 text-sm font-medium mb-1">
                      Zone Ranking Error
                    </div>
                    <div className="text-red-300 text-xs">{zoneRankError}</div>
                  </div>
                )}

                {zoneRankResults && zoneRankResults.length > 0 && (
                  <ZoneRankingResults results={zoneRankResults} />
                )}

                {!zoneRankResults && !zoneRankError && !zoneRankRunning && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="text-gray-600 mb-2">
                      <svg
                        className="w-12 h-12 mx-auto"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                        />
                      </svg>
                    </div>
                    <div className="text-gray-500 text-sm">
                      Zone ranking results will appear here
                    </div>
                    <div className="text-gray-600 text-xs mt-1">
                      Import your character and click Rank All Zones
                    </div>
                  </div>
                )}

                {zoneRankRunning && !zoneRankResults && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-12 text-center">
                    <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <div className="text-gray-400 text-sm">
                      Ranking all combat zones...
                    </div>
                    {zoneRankProgress && (
                      <div className="text-gray-500 text-xs mt-2">
                        {zoneRankProgress.currentZoneName} ({zoneRankProgress.current}/{zoneRankProgress.total})
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-8 py-4 text-center text-xs text-gray-600">
        MWI Combat Averagelator - Deterministic combat simulation for Milky Way
        Idle
      </footer>
    </div>
  );
}

export default App;
