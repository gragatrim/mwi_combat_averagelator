// =============================================================================
// Constants ported from labyrinth_analyzer.py
// =============================================================================

export const DEFAULT_CRATE_LEVEL_BOOST = 15;

export const GATHERING_SKILLS = new Set(["milking", "foraging", "woodcutting"]);
export const PROCESSING_SKILLS = new Set([
  "cheesesmithing", "crafting", "tailoring", "cooking", "brewing", "alchemy",
]);

export const BASE_SKILL_ACTION_TIME_MS = 10000;
export const BASE_ENHANCING_ACTION_TIME_MS = 8000;
export const TIME_LIMIT_MS = 120000;

export const LAB_UPGRADE_BASES: Record<string, number> = {
  torch: 100, shroud: 4, beacon: 5, cooldown: 72, fullAuto: 0,
  skillSpeed: 0, skillEfficiency: 0, skillSuccess: 0, skillDoubleProgress: 0,
  combatDamage: 0, attackSpeed: 0, castSpeed: 0, criticalRate: 0, experience: 0,
};
export const LAB_UPGRADE_PER_LEVEL: Record<string, number> = {
  torch: 20, shroud: 1, beacon: 1, cooldown: -4, fullAuto: 1,
  skillSpeed: 0.01, skillEfficiency: 0.01, skillSuccess: 0.005, skillDoubleProgress: 0.01,
  combatDamage: 0.01, attackSpeed: 0.01, castSpeed: 0.01, criticalRate: 0.01, experience: 0.01,
};
export const LAB_UPGRADE_MAX_LEVEL: Record<string, number> = {
  torch: 15, shroud: 8, beacon: 10, cooldown: 6, fullAuto: 15,
  skillSpeed: 12, skillEfficiency: 12, skillSuccess: 12, skillDoubleProgress: 12,
  combatDamage: 12, attackSpeed: 12, castSpeed: 12, criticalRate: 12, experience: 12,
};
// Linear coefficient: cost(n) = base * n. Cooldown is non-linear, see getUpgradeCost.
const LAB_UPGRADE_LINEAR_BASE: Record<string, number> = {
  torch: 100, shroud: 80, beacon: 60, fullAuto: 30,
  skillSpeed: 40, skillEfficiency: 40, skillSuccess: 40, skillDoubleProgress: 40,
  combatDamage: 40, attackSpeed: 40, castSpeed: 40, criticalRate: 40, experience: 80,
};

// Verified from in-game upgrade panel. Cooldown follows quadratic 100n² + 100n + 600
// (800, 1200, 1800, 2600, 3600, 4800); all others are linear base * n.
export function getUpgradeCost(type: string, nextLevel: number): number {
  if (type === "cooldown") return 100 * nextLevel * nextLevel + 100 * nextLevel + 600;
  return (LAB_UPGRADE_LINEAR_BASE[type] ?? 0) * nextLevel;
}

export const LAB_UPGRADE_DISPLAY: Record<string, { name: string; category: "capacity" | "skill" | "combat" | "qol"; unit: string }> = {
  torch:               { name: "Torch Capacity",         category: "capacity", unit: "T"   },
  shroud:              { name: "Shroud Capacity",        category: "capacity", unit: "S"   },
  beacon:              { name: "Beacon Capacity",        category: "capacity", unit: "B"   },
  cooldown:            { name: "Cooldown Reduction",     category: "capacity", unit: "h"   },
  fullAuto:            { name: "Full-Auto Floor",        category: "qol",      unit: "fl"  },
  skillSpeed:          { name: "Skilling Speed",         category: "skill",    unit: "%"   },
  skillEfficiency:     { name: "Skilling Efficiency",    category: "skill",    unit: "%"   },
  skillSuccess:        { name: "Skilling Success Rate",  category: "skill",    unit: "%"   },
  skillDoubleProgress: { name: "Skilling Double Progress",category: "skill",   unit: "%"   },
  combatDamage:        { name: "Combat Damage",          category: "combat",   unit: "%"   },
  attackSpeed:         { name: "Attack Speed",           category: "combat",   unit: "%"   },
  castSpeed:           { name: "Cast Speed",             category: "combat",   unit: "%"   },
  criticalRate:        { name: "Critical Rate",          category: "combat",   unit: "%"   },
  experience:          { name: "Experience",             category: "qol",      unit: "%"   },
};

/** Floor definitions: [floorNum, minLevel, maxLevel, gridStr] */
export const FLOORS: [number, number, number, string][] = [
  [1, 20, 40, "4×4"],
  [2, 40, 60, "5×5"],
  [3, 60, 80, "6×6"],
  [4, 80, 100, "7×7"],
  [5, 100, 120, "8×8"],
  [6, 120, 140, "8×8"],
  [7, 140, 160, "8×8"],
  [8, 160, 180, "8×8"],
  [9, 180, 200, "8×8"],
  [10, 200, 220, "8×8"],
  [11, 220, 240, "8×8"],
  [12, 240, 260, "8×8"],
  [13, 260, 280, "8×8"],
  [14, 280, 300, "8×8"],
  [15, 300, 320, "8×8"],
  [16, 320, 340, "8×8"],
  [17, 340, 360, "8×8"],
  [18, 360, 380, "8×8"],
  [19, 380, 400, "8×8"],
  [20, 400, 420, "8×8"],
];

export const PERCOLATION_THRESHOLD = 0.59;
export const MIN_EXPLORE_CLEAR_RATE = 0.15;

export const RUSH_TORCH_EVENTS: Record<number, number> = { 1: 6, 2: 8, 3: 10, 4: 12 };
export const EXPERT_TORCH_PRESERVATION = 0.20;
export const RUSH_OVERHEAD_FACTOR = 1.02;

export const GRID_DIM: Record<number, number> = { 1: 4, 2: 5, 3: 6, 4: 7 };
export const RUSH_PATH_REVEAL_FACTOR = 2.5;
export const BEACON_OVERLAP_FACTOR = 0.6;

export const FLOOR_EXIT_REWARDS: Record<number, [number, number, number]> = {
  1: [5, 0, 0], 2: [10, 0, 0], 3: [15, 0, 0],
  4: [20, 0.5, 0], 5: [25, 1.0, 0], 6: [30, 1.5, 1.0],
  7: [35, 2.0, 1.5], 8: [40, 2.5, 2.0], 9: [45, 3.0, 2.5],
  10: [50, 3.5, 3.0], 11: [55, 4.0, 3.5], 12: [60, 4.5, 4.0],
  13: [65, 5.0, 4.5], 14: [70, 5.5, 5.0], 15: [75, 6.0, 5.5],
  16: [80, 6.5, 6.0], 17: [85, 7.0, 6.5], 18: [90, 7.5, 7.0],
  19: [95, 8.0, 7.5], 20: [100, 8.5, 8.0],
};

export const TREASURE_ROOM_COUNT: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

export const LABYRINTH_SKILL_NAMES = [
  "Milking", "Foraging", "Woodcutting", "Cheesesmithing",
  "Crafting", "Tailoring", "Cooking", "Brewing", "Alchemy", "Enhancing",
];

// Canonical labyrinth combat monster order — matches the in-game labyrinth
// menu listing. Used to sort every UI section that lists monsters/skills.
export const LABYRINTH_MONSTER_NAMES = [
  "Shadow Archer", "Pyre Hunter", "Frost Sniper", "Siren", "Salamander",
  "Dryad", "Giant Scorpion", "Giant Mantis", "Cyclops", "Mimic",
];

export const LABYRINTH_MONSTER_HRIDS = LABYRINTH_MONSTER_NAMES.map(
  (n) => `/monsters/${n.toLowerCase().replace(/ /g, "_")}`
);

export function labSkillOrder(name: string): number {
  const i = LABYRINTH_SKILL_NAMES.indexOf(name);
  return i === -1 ? 999 : i;
}
export function labMonsterOrderByName(name: string): number {
  const i = LABYRINTH_MONSTER_NAMES.indexOf(name);
  return i === -1 ? 999 : i;
}
export function labMonsterOrderByHrid(hrid: string): number {
  const i = LABYRINTH_MONSTER_HRIDS.indexOf(hrid);
  return i === -1 ? 999 : i;
}

export const COMBAT_MONSTER_SKILL: Record<string, string> = {
  shadow_archer: "/skills/magic",
  pyre_hunter: "/skills/magic",
  frost_sniper: "/skills/magic",
  siren: "/skills/ranged",
  salamander: "/skills/ranged",
  dryad: "/skills/magic",
  giant_scorpion: "/skills/magic",
  giant_mantis: "/skills/magic",
  cyclops: "/skills/magic",
  mimic: "/skills/magic",
};

export const FALLBACK_SKILL_ROOMS: [string, string, number][] = [
  ["Milking",        "/skills/milking",        50],
  ["Foraging",       "/skills/foraging",       50],
  ["Woodcutting",    "/skills/woodcutting",     50],
  ["Cheesesmithing", "/skills/cheesesmithing",  70],
  ["Crafting",       "/skills/crafting",        70],
  ["Tailoring",      "/skills/tailoring",       80],
  ["Cooking",        "/skills/cooking",         60],
  ["Brewing",        "/skills/brewing",         50],
  ["Alchemy",        "/skills/alchemy",         70],
  ["Enhancing",      "/skills/enhancing",       50],
];

export const FALLBACK_COMBAT_ROOMS: [string, string, string, number][] = [
  ["Shadow Archer",  "magic",  "/skills/magic",  -60],
  ["Pyre Hunter",    "magic",  "/skills/magic",  -30],
  ["Frost Sniper",   "magic",  "/skills/magic",  -60],
  ["Siren",          "ranged", "/skills/ranged",   60],
  ["Salamander",     "ranged", "/skills/ranged",   60],
  ["Dryad",          "magic",  "/skills/magic",    65],
  ["Giant Scorpion", "magic",  "/skills/magic",   153],
  ["Giant Mantis",   "magic",  "/skills/magic",   146],
  ["Cyclops",        "magic",  "/skills/magic",   141],
  ["Mimic",          "magic",  "/skills/magic",   -70],
];
