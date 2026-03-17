// =============================================================================
// useGameData - React hook for loading and caching MWI game data
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import type { GameData } from "../engine/types";
import { loadGameData } from "../data/gameData";

export interface UseGameDataReturn {
  /** The loaded game data, or null if still loading / errored. */
  gameData: GameData | null;
  /** True while the initial load or a custom upload is in progress. */
  isLoading: boolean;
  /** Error message if loading failed, null otherwise. */
  error: string | null;
  /** Upload a custom init_client_data.json file to replace the default data. */
  uploadCustomData: (file: File) => Promise<void>;
}

export function useGameData(): UseGameDataReturn {
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial load on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await loadGameData();
        if (!cancelled) {
          setGameData(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load game data"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Upload custom game data file
  const uploadCustomData = useCallback(async (file: File) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await loadGameData(file);
      setGameData(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load custom game data"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { gameData, isLoading, error, uploadCustomData };
}
