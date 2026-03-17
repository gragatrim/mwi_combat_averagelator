// =============================================================================
// Drop Calculator - Expected drop rates from encounter distributions
// =============================================================================
// Computes expected item drops per hour based on zone encounter compositions,
// monster drop tables, and player loot multipliers.

import type {
  GameData,
  MonsterData,
  DropTableEntry,
  RareDropTableEntry,
  ZoneAction,
} from "./types";
import Zone, { type EncounterDistribution, type EncounterComposition } from "./zone";
import { BATTLES_PER_BOSS } from "./constants";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A single expected drop with per-hour quantity. */
export interface ExpectedDrop {
  itemHrid: string;
  quantityPerHour: number;
  /** Whether this is from the rare drop table. */
  isRare: boolean;
}

/** Input parameters for the drop calculation. */
export interface DropCalcParams {
  gameData: GameData;
  zoneHrid: string;
  difficultyTier: number;
  killsPerHour: number;
  dropRateMultiplier: number;
  rareFindMultiplier: number;
  combatDropQuantity: number;
}

// -----------------------------------------------------------------------------
// Main calculation
// -----------------------------------------------------------------------------

/**
 * Calculates expected drops per hour for a non-dungeon zone.
 *
 * For each possible encounter composition (weighted by probability),
 * sums up the expected drops from each monster's drop tables, then
 * multiplies by kills per hour.
 *
 * Drop formulas:
 * - Regular drops: dropRate * dropRateMultiplier * avgQty * (1 + combatDropQuantity)
 * - Rare drops: dropRate * dropRateMultiplier * rareFindMultiplier * avgQty * (1 + combatDropQuantity)
 */
export function calculateExpectedDrops(params: DropCalcParams): ExpectedDrop[] {
  const { gameData, zoneHrid, difficultyTier, killsPerHour } = params;
  const { dropRateMultiplier, rareFindMultiplier, combatDropQuantity } = params;

  const gameZone = gameData.actionDetailMap[zoneHrid] as ZoneAction | undefined;
  if (!gameZone?.combatZoneInfo) return [];

  // Don't compute for dungeons (complex wave structure)
  if (gameZone.combatZoneInfo.isDungeon) return [];

  // Build encounter distribution
  const zone = new Zone(zoneHrid, difficultyTier, gameData);
  const distribution = zone.getAllEncounterCompositions();

  // Compute expected drops per encounter (weighted by probability)
  const dropAccumulator = new Map<string, { qty: number; isRare: boolean }>();

  const hasBoss = !!distribution.bossEncounter;
  const bossWeight = hasBoss ? 1 / distribution.battlesPerBoss : 0;
  const regularWeight = hasBoss
    ? (distribution.battlesPerBoss - 1) / distribution.battlesPerBoss
    : 1;

  // Regular encounters
  for (const comp of distribution.randomEncounters) {
    const weight = regularWeight * comp.probability;
    accumulateDropsForComposition(
      comp,
      weight,
      gameData,
      dropRateMultiplier,
      rareFindMultiplier,
      combatDropQuantity,
      difficultyTier,
      dropAccumulator
    );
  }

  // Boss encounter
  if (distribution.bossEncounter) {
    accumulateDropsForComposition(
      distribution.bossEncounter,
      bossWeight,
      gameData,
      dropRateMultiplier,
      rareFindMultiplier,
      combatDropQuantity,
      difficultyTier,
      dropAccumulator
    );
  }

  // Convert to per-hour rates
  const result: ExpectedDrop[] = [];
  for (const [itemHrid, { qty, isRare }] of dropAccumulator) {
    const perHour = qty * killsPerHour;
    if (perHour > 0) {
      result.push({ itemHrid, quantityPerHour: perHour, isRare });
    }
  }

  // Sort: rare drops first, then by quantity descending
  result.sort((a, b) => {
    if (a.isRare !== b.isRare) return a.isRare ? -1 : 1;
    return b.quantityPerHour - a.quantityPerHour;
  });

  return result;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function accumulateDropsForComposition(
  comp: EncounterComposition,
  weight: number,
  gameData: GameData,
  dropRateMultiplier: number,
  rareFindMultiplier: number,
  combatDropQuantity: number,
  zoneDifficultyTier: number,
  accumulator: Map<string, { qty: number; isRare: boolean }>
): void {
  for (const monsterRef of comp.monsters) {
    const monsterData = gameData.combatMonsterDetailMap[monsterRef.hrid];
    if (!monsterData) continue;

    // Regular drops
    if (monsterData.dropTable) {
      for (const drop of monsterData.dropTable) {
        // Filter by difficulty tier
        if (drop.difficultyTier != null && drop.difficultyTier > zoneDifficultyTier) {
          continue;
        }

        const avgQty = (drop.minCount + drop.maxCount) / 2;
        const expectedQty =
          drop.dropRate * dropRateMultiplier * avgQty * (1 + combatDropQuantity);

        addToAccumulator(accumulator, drop.itemHrid, expectedQty * weight, false);
      }
    }

    // Rare drops
    if (monsterData.rareDropTable) {
      for (const drop of monsterData.rareDropTable) {
        // Filter by minimum difficulty tier
        if (
          drop.minDifficultyTier != null &&
          drop.minDifficultyTier > zoneDifficultyTier
        ) {
          continue;
        }

        const avgQty = (drop.minCount + drop.maxCount) / 2;
        const expectedQty =
          drop.dropRate *
          dropRateMultiplier *
          rareFindMultiplier *
          avgQty *
          (1 + combatDropQuantity);

        addToAccumulator(accumulator, drop.itemHrid, expectedQty * weight, true);
      }
    }
  }
}

function addToAccumulator(
  accumulator: Map<string, { qty: number; isRare: boolean }>,
  itemHrid: string,
  qty: number,
  isRare: boolean
): void {
  const existing = accumulator.get(itemHrid);
  if (existing) {
    existing.qty += qty;
    // If the same item appears in both regular and rare tables,
    // mark it as rare (more notable for the user)
    if (isRare) existing.isRare = true;
  } else {
    accumulator.set(itemHrid, { qty, isRare });
  }
}
