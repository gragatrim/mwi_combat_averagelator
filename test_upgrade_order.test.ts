import { describe, expect, it } from "vitest";
import { FLOORS } from "./src/features/labyrinthAnalyzer/constants";
import { computeLabyrinthTargetFloor, floorClearFraction } from "./src/features/labyrinthAnalyzer/floorAnalysis";
import { computeUpgradeOrder, expectedExitBoxes } from "./src/features/labyrinthAnalyzer/upgradeOrder";
import type { CombatRoomData, FloorResult, SkillRoomData, UpgradeLevels } from "./src/features/labyrinthAnalyzer/types";

function floors(skillClear: number, combatClear = skillClear): FloorResult[] {
  return FLOORS.map(([floor, min, max, grid]) => {
    const skill = floorClearFraction(skillClear, min, max);
    const combat = floorClearFraction(combatClear, min, max);
    const overall = (skill + combat) / 2;
    return {
      floor, min, max, grid, skill, combat, overall,
      blocked: 1 - overall, skillFracs: [skill], combatFracs: [combat],
    };
  });
}

const levels: UpgradeLevels = {
  torch: 15, shroud: 8, beacon: 10, cooldown: 6, fullAuto: 15,
  skillSpeed: 12, skillEfficiency: 12, skillSuccess: 12, skillDoubleProgress: 12,
  combatDamage: 0, attackSpeed: 12, castSpeed: 12, criticalRate: 12, experience: 12, points: 0,
};
const skill = (maxClearable: number): SkillRoomData[] => [
  { name: "Skill", hrid: "/skills/test", base: 1, effective: 1, threshold: 1, maxClearable, source: "hardcoded" },
];
const combat = (maxClearable: number, source: CombatRoomData["source"] = "simulated"): CombatRoomData[] => [
  { name: "Test Monster", loadout: "test", skill: "", base: 1, effective: 1, threshold: 1, maxClearable, source },
];

describe("labyrinth upgrade ordering regressions", () => {
  it("uses the dynamic, bounded modeled target", () => {
    expect(computeLabyrinthTargetFloor(10, 4, 12)).toBe(12);
    expect(computeLabyrinthTargetFloor(10, 8, 12)).toBe(13);
    expect(computeLabyrinthTargetFloor(999, 8, 0)).toBe(FLOORS.at(-1)![0]);
    expect(computeLabyrinthTargetFloor(Number.NaN, 4, 0)).toBe(FLOORS[0][0]);
    expect(expectedExitBoxes(999, floors(1))).toBe(expectedExitBoxes(FLOORS.at(-1)![0], floors(1)));
  });

  it("applies achieved-floor and shroud progression while ordering upgrades", () => {
    const onlyShrouds = { ...levels, shroud: 3 };
    // At achieved F6, the fourth upgrade takes the modeled shroud target from
    // F6 to F7. At achieved F7, it is already covered and has no ROI.
    expect(computeUpgradeOrder(onlyShrouds, 6, floors(999), 4, skill(999), combat(999, "hardcoded")))
      .toMatchObject([{ type: "shroud", level: 4 }]);
    expect(computeUpgradeOrder(onlyShrouds, 7, floors(999), 4, skill(999), combat(999, "hardcoded"))).toEqual([]);
  });

  it("weights exit boxes by clearability", () => {
    expect(expectedExitBoxes(5, floors(999))).toBeGreaterThan(expectedExitBoxes(5, floors(110)));
    expect(expectedExitBoxes(5, floors(0))).toBe(0);
  });

  it("evaluates later combat purchases from cumulative combat state", () => {
    const order = computeUpgradeOrder(levels, 5, floors(99), 4, skill(99), combat(99), null, new Map());
    const damage = order.filter(e => e.type === "combatDamage");
    expect(damage.length).toBeGreaterThan(1);
    // The first level completes F4 and starts F5; the next level advances the
    // already-started F5 state. Resetting each evaluation to the original
    // combat state would repeat the first marginal value.
    expect(damage[1].deltaBoxesMonth).toBeLessThan(damage[0].deltaBoxesMonth);
  });

  it("retains selected combat state when a skill-data refresh occurs", () => {
    const withRefresh = { ...levels, skillSpeed: 11 };
    const initialSkill = skill(19);
    const order = computeUpgradeOrder(
      withRefresh, 5, floors(19), 4, initialSkill, combat(19),
      overrides => [{ ...initialSkill[0], maxClearable: overrides.skillSpeed > 11 ? 21 : 19 }],
      new Map(),
    );
    const refreshAt = order.findIndex(e => e.type === "skillSpeed");
    const combatBeforeRefresh = order.slice(0, refreshAt).filter(e => e.type === "combatDamage");
    const combatAfterRefresh = order.slice(refreshAt + 1).find(e => e.type === "combatDamage");
    expect(combatBeforeRefresh.length).toBeGreaterThan(0);
    expect(refreshAt).toBeGreaterThan(0);
    expect(combatAfterRefresh).toBeDefined();
    // The post-refresh marginal value must be based on the combat levels bought
    // before the skill refresh, rather than silently rebuilding from baseline.
    expect(combatAfterRefresh!.deltaBoxesMonth).not.toBe(combatBeforeRefresh[0].deltaBoxesMonth);
    const investmentStep = combatBeforeRefresh.find(e => e.deltaBoxesMonth === 0 && e.projectedTier);
    expect(investmentStep?.description).toContain("Investment step");
  });

  it("does not rank mixed or fallback combat thresholds economically", () => {
    const fallbackCombat = combat(19, "hardcoded");
    expect(computeUpgradeOrder(levels, 5, floors(19), 4, skill(19), fallbackCombat, null, new Map())).toEqual([]);
    const mixedCombat = [...combat(19), ...combat(19, "hardcoded")];
    expect(computeUpgradeOrder(levels, 5, floors(19), 4, skill(19), mixedCombat, null, new Map())).toEqual([]);
  });
});
