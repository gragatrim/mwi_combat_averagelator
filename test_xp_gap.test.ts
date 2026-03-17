// Quick vitest to compare weighted-average XP vs most-probable XP per dungeon wave
import { describe, it } from "vitest";
import { readFileSync } from "fs";
import type { GameData } from "./src/engine/types";
import Zone from "./src/engine/zone";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

describe("XP gap analysis", () => {
  it("compares weighted avg XP vs most-probable XP per wave", () => {
    const zone = new Zone("/actions/combat/pirate_cove", 0, gameData);

    let totalWeightedXp = 0;
    let totalMostProbXp = 0;
    let totalWeightedHp = 0;
    let totalClosestHp = 0;

    for (let wave = 1; wave <= 65; wave++) {
      const compositions = zone.getNextWave();
      if (!compositions || compositions.length === 0) {
        console.log(`Wave ${wave}: no compositions`);
        continue;
      }

      // Weighted average XP
      let weightedXp = 0;
      let bestProb = 0;
      let bestXp = 0;

      for (const comp of compositions) {
        // Calculate total XP for this composition
        let compXp = 0;
        for (const monRef of comp.monsters) {
          const monData = gameData.combatMonsterDetailMap[monRef.hrid];
          if (monData) {
            // At tier 0: experience = base experience (no scaling)
            compXp += monData.experience;
          }
        }
        weightedXp += compXp * comp.probability;

        if (comp.probability > bestProb) {
          bestProb = comp.probability;
          bestXp = compXp;
        }
      }

      totalWeightedXp += weightedXp;
      totalMostProbXp += bestXp;

      if (wave <= 5 || wave % 10 === 0 || wave >= 60) {
        // Also compute weighted average HP
      let weightedHp = 0;
      let bestHp = 0;
      for (let i = 0; i < compositions.length; i++) {
        let compHp = 0;
        for (const monRef of compositions[i].monsters) {
          const monData = gameData.combatMonsterDetailMap[monRef.hrid];
          if (monData) compHp += monData.combatDetails.maxHitpoints;
        }
        weightedHp += compHp * compositions[i].probability;
        if (compositions[i].probability === bestProb) bestHp = compHp;
      }

      // Find closest-HP composition
      let closestHp = 0;
      let closestDiff = Infinity;
      for (const comp of compositions) {
        let compHp = 0;
        for (const monRef of comp.monsters) {
          const monData = gameData.combatMonsterDetailMap[monRef.hrid];
          if (monData) compHp += monData.combatDetails.maxHitpoints;
        }
        const diff = Math.abs(compHp - weightedHp);
        if (diff < closestDiff) { closestDiff = diff; closestHp = compHp; }
      }

      totalWeightedHp += weightedHp;
      totalClosestHp += closestHp;

      const gap = bestXp > 0 ? ((bestXp / weightedXp - 1) * 100).toFixed(1) : "N/A";
        console.log(`Wave ${wave}: wXP=${weightedXp.toFixed(0)} wHP=${weightedHp.toFixed(0)} closestHP=${closestHp} mostProbHP=${bestHp} comps=${compositions.length} gap=${gap}%`);
      }
    }

    const totalGap = ((totalMostProbXp / totalWeightedXp - 1) * 100).toFixed(1);
    console.log(`\nTotal dungeon XP:`);
    console.log(`  Weighted average: ${totalWeightedXp.toFixed(0)}`);
    console.log(`  Most probable:    ${totalMostProbXp}`);
    console.log(`  Gap: ${totalGap}%`);
    console.log(`  Per player (div 5): weighted=${(totalWeightedXp/5).toFixed(0)}, mostProb=${(totalMostProbXp/5).toFixed(0)}`);
    console.log(`\nTotal HP: weighted=${totalWeightedHp.toFixed(0)}, closestHp=${totalClosestHp}`);
    console.log(`  HP gap (closest vs weighted): ${((totalClosestHp / totalWeightedHp - 1) * 100).toFixed(1)}%`);
  });
});
