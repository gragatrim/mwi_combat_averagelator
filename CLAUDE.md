# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Deterministic combat simulator for Milky Way Idle (MWI). Replaces all RNG with expected values (hit chance * avg damage) so one simulation run converges to the long-run average. Ported from a stochastic Monte Carlo simulator.

## Commands

```bash
npm run dev       # Vite dev server with HMR
npm run build     # tsc -b && vite build
npm run lint      # ESLint on all TS/TSX files
npx vitest run    # Run all tests
npx vitest run test_xp_gap  # Run a single test file
```

## Tech Stack

React 19 + TypeScript 5.9 + Vite 7 + Tailwind CSS 4 (via `@tailwindcss/vite` plugin). Event queue uses `heap-js`. Tests use Vitest. Base path is `/mwi_combat_averagelator/`.

## Architecture

### Engine (`src/engine/`)

Event-based simulation loop. All time values are **nanoseconds** (1s = 1e9 ns).

- **`deterministicSimulator.ts`** (~2300 lines) — Main loop: pops events from `EventQueue` (min-heap), processes them, queues follow-ups. Handles encounter transitions, dungeon waves, cycle detection.
- **`combatUtilities.ts`** — `processAttack()` returns expected-value `AttackResult` (damage, CC durations, thorns, life steal). This is what makes it deterministic.
- **`zone.ts`** — `getAllEncounterCompositions()` enumerates all possible enemy compositions via DFS. Each composition has a probability weight. Zone-level results are weighted averages.
- **`cycleDetector.ts`** — HP/MP fingerprinting (bucketed to nearest 5) detects steady-state loops to terminate simulation.
- **`eventQueue.ts`** — Min-heap priority queue for simulation events.
- **`events/`** — 20+ event classes (AutoAttack, AbilityCastEnd, RegenTick, DamageOverTime, CC expirations, Respawn, etc.).
- **`combatUnit.ts`** → `player.ts`, `monster.ts` — Base class and unit-specific subclasses. `Player.createFromDTO()` uses dependency injection for Equipment/Consumable/Ability factories.
- **`simResult.ts`** — Aggregates XP, kills, DPS, HPS, mana sustainability. `computeSummary(playerHrid)` produces per-player `SummaryRates`.
- **`types.ts`** — Comprehensive interfaces: `GameData`, `PlayerConfig`, `TriggerData`, `AbilityData`, `MonsterData`, `CombatStats`, etc. All hrid union types defined here.

### Data Flow

1. User imports character JSON → `PlayerImport` parses into `PlayerConfig[]`
2. `useGameData` loads `init_client_data.json` (full game data) into `GameData`
3. `useSimulation` hook calls `executeSimulation()` from `useSimulation.utils.ts`:
   - Creates `Player` instances via `Player.createFromDTO(config, gameData, deps)`
   - Creates `Zone` with encounter enumeration
   - Applies XP bonuses (wisdom buffs, seals, community buff) to player instances
   - Runs `DeterministicSimulator.simulate()`
4. Results displayed via `ResultsSummary` / `ResultsDetail`

### App Modes

`App.tsx` switches between three modes: `"combat"` (single zone sim), `"labyrinth"` (find max levels), `"zoneRanking"` (rank all zones by XP/hr).

### Hooks (`src/hooks/`)

- **`useSimulation.ts`** — React state wrapper around `executeSimulation()`. Runs sim in `setTimeout` to avoid blocking UI.
- **`useSimulation.utils.ts`** — Extracted sim execution logic shared by the hook and trigger optimizer.
- **`useGameData.ts`** — Loads/caches game data JSON, handles custom uploads.

### Optimizer (`src/optimizer/`)

- **`triggerOptimizer.ts`** — Greedy hill-climbing over trigger threshold values. Sweeps all players' value-based triggers (`>=`/`<=` comparators) to maximize primary player XP/hr.

## Key Game Mechanics in Code

- **Boss cycle**: 9 regular encounters + 1 boss (`BATTLES_PER_BOSS = 10`)
- **Dungeon key tier** adds to ALL monster tiers (both random and fixed/boss mobs)
- **XP formula**: `(1 + combatExperience + wisdomBonus) * additionalXpMult * (1 + skillExperience)`. Wisdom buffs (MooPass, community buff, seal) are **additive** to `combatExperience`, not a separate multiplier.
- **Respawn timers**: Enemy 3s, Player 150s, Dungeon wave 3s, Dungeon restart 15s
- **Mayhem**: "retry on miss" mechanic (not "hit all targets")

## Known Deterministic Biases

Total gap vs game: ~5-7% lower XP/hr (structural limitation of expected-value simulation).

- **Killing blow penalty** (~5%): Each kill wastes overkill damage; with ~8 hits/kill, ~12% of last hit is wasted. CORRECTED via post-hoc overkill time correction — tracks pre-clamp vs post-clamp damage per encounter and subtracts the proportional wasted time from reported sim time.
- **Deterministic variance bias** (~2-3%): E[time_to_kill] ≠ HP/E[DPS] due to variance interactions in multi-player combat, crit distributions, and CC timing.
- **Death variance** (~1%): Can't model variance-driven deaths
- **Life steal on low-HP targets** (<1%): Inner HP clamp in processAttack overestimates
