// =============================================================================
// Types for the labyrinth floor clearability analyzer
// =============================================================================

/** Per-skill room analysis data */
export interface SkillRoomData {
  name: string;
  hrid: string;
  base: number;
  effective: number;
  threshold: number;
  maxClearable: number;
  source: "calculated" | "in-game" | "hardcoded";
  buffs?: SkillBuffs;
  /** In-game threshold for comparison (when source is "calculated") */
  igThreshold?: number;
  igMaxClearable?: number;
}

/** Per-combat room analysis data */
export interface CombatRoomData {
  name: string;
  loadout: string;
  skill: string;
  base: number;
  effective: number;
  threshold: number;
  maxClearable: number;
  source: "simulated" | "in-game" | "hardcoded";
}

/** Per-floor analysis result */
export interface FloorResult {
  floor: number;
  min: number;
  max: number;
  grid: string;
  skill: number;
  combat: number;
  overall: number;
  blocked: number;
  skillFracs: number[];
  combatFracs: number[];
}

/** Shroud requirement estimate */
export type ShroudEstimate = string | number;

/** Bottleneck analysis */
export interface BottleneckData {
  frontierFloor: number;
  frontierMin: number;
  frontierMax: number;
  frontierOverall: number;
  skillAvg: number;
  combatAvg: number;
  bottleneckCategory: "skill" | "combat";
  weakRooms: WeakRoom[];
  impactEstimate: number | null;
  nFixed: number;
}

export interface WeakRoom {
  name: string;
  maxClearable: number;
  frac: number;
  gapNeeded: number;
}

/** Torch budget per floor */
export interface TorchBudgetEntry {
  floor: number;
  rushEvents: number;
  rushTorches: number;
  exploreTorches: number;
  totalSpend: number;
  torchesToFinish: number;
  clearRate: number;
  expectedTokens: number;
  expectedBoxes: number;
  torchBalance: number;
  beaconsUsed: number;
  advice: string;
}

/** Labyrinth upgrade type identifier (matches keys in LAB_UPGRADE_* maps). */
export type UpgradeType =
  | "torch" | "shroud" | "beacon" | "cooldown" | "fullAuto"
  | "skillSpeed" | "skillEfficiency" | "skillSuccess" | "skillDoubleProgress"
  | "combatDamage" | "attackSpeed" | "castSpeed" | "criticalRate" | "experience";

export type UpgradeCategory = "capacity" | "skill" | "combat" | "qol";

/** Upgrade priority entry */
export interface UpgradePriorityEntry {
  type: UpgradeType;
  level: number;
  cost: number;
  deltaBoxesMonth: number;
  valuePerToken: number;
  description: string;
  category: UpgradeCategory;
}

/** Labyrinth upgrade levels */
export interface UpgradeLevels {
  torch: number;
  shroud: number;
  beacon: number;
  cooldown: number;
  fullAuto: number;
  skillSpeed: number;
  skillEfficiency: number;
  skillSuccess: number;
  skillDoubleProgress: number;
  combatDamage: number;
  attackSpeed: number;
  castSpeed: number;
  criticalRate: number;
  experience: number;
  points: number;
}

/** Auto-skip recommendation */
export interface SkipRecommendation {
  name: string;
  category: "skill" | "combat";
  currentThreshold: number;
  recommendedThreshold: number;
  delta: number;
  maxClearable: number;
  currentMaxClearable: number | string;
}

/** Aggregated skill buffs for a single skill */
export interface SkillBuffs {
  efficiency: number;
  actionSpeed: number;
  srBoost: number;
  dpChance: number;
  levelBoost: number;
}

/** Complete analysis result from the analyzer */
export interface AnalysisResult {
  skillData: SkillRoomData[];
  combatData: CombatRoomData[];
  floorResults: FloorResult[];
  maxFloorNoShrouds: number;
  shroudEstimates: ShroudEstimate[];
  bottleneck: BottleneckData | null;
  upgradeLevels: UpgradeLevels | null;
  torchBudget: TorchBudgetEntry[] | null;
  upgradePriority: UpgradePriorityEntry[] | null;
  skipRecommendations: SkipRecommendation[];
  charName: string;
  timestamp: string;
  targetFloor: number;
}
