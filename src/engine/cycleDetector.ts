// =============================================================================
// CycleDetector - Detects steady state in deterministic simulation
// =============================================================================
// New file (no original in mwi_combat_sim). Monitors player state snapshots
// after each full cycle (e.g. 10 encounters for regular zones) and detects
// when the simulation reaches a repeating pattern, indicating steady state.
//
// The deterministic simulator produces identical outcomes for identical
// starting states, so once we see a repeated state, we know the sim will
// loop forever. We can then extract one full cycle and extrapolate rates.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * A snapshot of the simulation state at the end of a cycle.
 * HP and mana are rounded to the nearest integer for comparison purposes
 * since floating point drift should not prevent cycle detection.
 */
export interface CycleSnapshot {
  /** Player HP values rounded to nearest integer, keyed by player hrid. */
  playerHp: Record<string, number>;
  /** Player mana values rounded to nearest integer, keyed by player hrid. */
  playerMp: Record<string, number>;
  /** Total XP earned during this cycle (all skills, all players). */
  cycleXp: number;
  /** Total time elapsed during this cycle in nanoseconds. */
  cycleTimeNs: number;
}

/** Result of cycle detection when a steady state is found. */
export interface SteadyStateResult {
  /**
   * Index of the first snapshot in the repeating cycle (inclusive).
   * This is the earlier snapshot that matches the later one.
   */
  cycleStart: number;
  /**
   * Index of the snapshot that matched cycleStart (exclusive end).
   * The repeating cycle is snapshots[cycleStart..cycleEnd).
   */
  cycleEnd: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Maximum number of cycles to track before giving up on cycle detection. */
const MAX_CYCLES = 50;

/** Number of most recent cycles to average when falling back. */
const FALLBACK_CYCLE_COUNT = 10;

// -----------------------------------------------------------------------------
// CycleDetector
// -----------------------------------------------------------------------------

class CycleDetector {
  /** All recorded snapshots in chronological order. */
  private snapshots: CycleSnapshot[] = [];

  /**
   * Map from snapshot fingerprint to the index in the snapshots array.
   * Used for O(1) lookup when checking for repeated states.
   */
  private fingerprintMap: Map<string, number> = new Map();

  /** Whether a steady state has already been detected. */
  private steadyStateFound: boolean = false;

  /** The detected steady state result, if any. */
  private detectedResult: SteadyStateResult | null = null;

  /**
   * Records a new snapshot at the end of a cycle.
   * Snapshots should be added in chronological order.
   */
  addSnapshot(snapshot: CycleSnapshot): void {
    if (this.steadyStateFound) return;

    const index = this.snapshots.length;
    this.snapshots.push(snapshot);

    const fingerprint = this.computeFingerprint(snapshot);
    const previousIndex = this.fingerprintMap.get(fingerprint);

    if (previousIndex !== undefined) {
      // Found a match - steady state detected
      this.steadyStateFound = true;
      this.detectedResult = {
        cycleStart: previousIndex,
        cycleEnd: index,
      };
    } else {
      this.fingerprintMap.set(fingerprint, index);
    }
  }

  /**
   * Checks if a steady state has been detected.
   *
   * Returns the cycle boundaries if found, or null if not yet detected.
   * If the maximum number of cycles has been reached without finding a
   * cycle, falls back to using the last FALLBACK_CYCLE_COUNT cycles.
   */
  detectSteadyState(): SteadyStateResult | null {
    if (this.detectedResult) {
      return this.detectedResult;
    }

    // Safety fallback: if we've recorded too many cycles without finding
    // a repeat, assume the last N cycles represent steady state.
    if (this.snapshots.length >= MAX_CYCLES) {
      const fallbackStart = Math.max(
        0,
        this.snapshots.length - FALLBACK_CYCLE_COUNT
      );
      return {
        cycleStart: fallbackStart,
        cycleEnd: this.snapshots.length,
      };
    }

    return null;
  }

  /**
   * Returns the number of snapshots recorded so far.
   */
  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  /**
   * Returns all recorded snapshots.
   */
  getSnapshots(): ReadonlyArray<CycleSnapshot> {
    return this.snapshots;
  }

  /**
   * Returns whether the maximum cycle limit has been reached.
   */
  isAtLimit(): boolean {
    return this.snapshots.length >= MAX_CYCLES;
  }

  /**
   * Resets the detector, clearing all snapshots and state.
   */
  reset(): void {
    this.snapshots = [];
    this.fingerprintMap.clear();
    this.steadyStateFound = false;
    this.detectedResult = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Computes a string fingerprint for a snapshot.
   *
   * Only player HP and mana are used for comparison - XP and time are
   * expected to vary slightly cycle-to-cycle (especially in the first few
   * cycles as buffs settle). The key insight is that if player HP/MP at
   * the end of a cycle match a previous cycle-end state, the deterministic
   * sim will produce identical results going forward.
   *
   * HP/MP are rounded to the nearest BUCKET_SIZE to tolerate floating
   * point drift from the deterministic averaging approach.
   */
  private computeFingerprint(snapshot: CycleSnapshot): string {
    const BUCKET_SIZE = 5; // round HP/MP to nearest 5
    const parts: string[] = [];

    // Sort player hrids for deterministic ordering
    const playerHrids = Object.keys(snapshot.playerHp).sort();

    for (const hrid of playerHrids) {
      const hp = Math.round((snapshot.playerHp[hrid] ?? 0) / BUCKET_SIZE) * BUCKET_SIZE;
      const mp = Math.round((snapshot.playerMp[hrid] ?? 0) / BUCKET_SIZE) * BUCKET_SIZE;
      parts.push(`${hrid}:${hp}:${mp}`);
    }

    return parts.join("|");
  }
}

/**
 * Creates a CycleSnapshot from the current simulation state.
 * Convenience factory that rounds HP/MP to integers.
 */
export function createCycleSnapshot(
  playerStates: Array<{ hrid: string; currentHp: number; currentMp: number }>,
  cycleXp: number,
  cycleTimeNs: number
): CycleSnapshot {
  const playerHp: Record<string, number> = {};
  const playerMp: Record<string, number> = {};

  for (const player of playerStates) {
    playerHp[player.hrid] = Math.round(player.currentHp);
    playerMp[player.hrid] = Math.round(player.currentMp);
  }

  return {
    playerHp,
    playerMp,
    cycleXp: Math.round(cycleXp),
    cycleTimeNs,
  };
}

export default CycleDetector;
