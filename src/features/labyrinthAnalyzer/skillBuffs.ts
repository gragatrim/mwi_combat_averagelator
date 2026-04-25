// =============================================================================
// Skill buff extraction from raw character data — ported from labyrinth_analyzer.py
// =============================================================================

import type { GameData } from "../../engine/types";
import type { SkillBuffs } from "./types";
import {
  DEFAULT_CRATE_LEVEL_BOOST,
  GATHERING_SKILLS,
} from "./constants";

// Raw character data types (not the parsed FullCharacterData)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawCharData = Record<string, any>;

/** Extract base skill levels from characterSkills array */
export function getBaseSkillLevels(charData: RawCharData): Record<string, number> {
  const skills: Record<string, number> = {};
  const arr = charData.characterSkills;
  if (!Array.isArray(arr)) return skills;
  for (const s of arr) {
    if (s?.skillHrid) {
      skills[s.skillHrid] = s.level ?? 0;
    }
  }
  return skills;
}

/** Get character name */
export function getCharacterName(charData: RawCharData): string {
  return charData.character?.name ?? "unknown";
}

/** Get data timestamp */
export function getDataTimestamp(charData: RawCharData): string {
  const ts = charData.currentTimestamp;
  if (ts) {
    try {
      const dt = new Date(ts);
      return dt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    } catch { /* ignore */ }
  }
  return new Date().toISOString().slice(0, 10);
}

/** Parse labyrinthSkip* from characterSetting */
export function parseLabyrinthSkip(charData: RawCharData): {
  skillRooms: [string, string, number][] | null;
  combatRooms: [string, string, string, number][] | null;
} {
  const setting = charData.characterSetting;
  if (!setting || typeof setting !== "object") return { skillRooms: null, combatRooms: null };

  const LABYRINTH_SKILL_NAMES_SET = new Set([
    "Milking", "Foraging", "Woodcutting", "Cheesesmithing",
    "Crafting", "Tailoring", "Cooking", "Brewing", "Alchemy", "Enhancing",
  ]);

  const COMBAT_MONSTER_SKILL: Record<string, string> = {
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

  const skillRooms: [string, string, number][] = [];
  const combatRooms: [string, string, string, number][] = [];

  for (const [key, value] of Object.entries(setting).sort()) {
    if (!key.startsWith("labyrinthSkip") || value == null) continue;
    const suffix = key.slice("labyrinthSkip".length);
    const threshold = Number(value);
    const snake = pascalToSnake(suffix);
    const display = pascalToDisplay(suffix);

    if (LABYRINTH_SKILL_NAMES_SET.has(suffix)) {
      skillRooms.push([display, `/skills/${snake}`, threshold]);
    } else {
      const combatSkill = COMBAT_MONSTER_SKILL[snake] ?? "/skills/magic";
      const loadout = combatSkill.split("/").pop()!;
      combatRooms.push([display, loadout, combatSkill, threshold]);
    }
  }

  return {
    skillRooms: skillRooms.length > 0 ? skillRooms : null,
    combatRooms: combatRooms.length > 0 ? combatRooms : null,
  };
}

/** Get labyrinth loadout for a skill */
function getLabyrinthLoadout(skillName: string, charData: RawCharData): Record<string, unknown> | null {
  const settings = charData.characterSetting ?? {};
  const key = `labyrinthLoadout${skillName}`;
  const loadoutId = settings[key];
  if (!loadoutId) return null;

  const loadoutMap = charData.characterLoadoutMap ?? {};
  for (const loadout of Object.values(loadoutMap) as Record<string, unknown>[]) {
    if (String(loadout.id) === String(loadoutId)) return loadout;
  }
  return null;
}

/** Compute noncombat equipment buffs from a labyrinth loadout */
function computeLoadoutEquipmentBuffs(
  loadout: Record<string, unknown>,
  skillName: string,
  gameData: GameData
): { actionSpeed: number; efficiency: number; gathering: number; enhancingSuccess: number } {
  const totals = { actionSpeed: 0, efficiency: 0, gathering: 0, enhancingSuccess: 0 };
  const wearableMap = (loadout.wearableMap ?? {}) as Record<string, string>;

  for (const value of Object.values(wearableMap)) {
    if (!value) continue;
    const parts = value.split("::");
    if (parts.length < 4) continue;
    const itemHrid = parts[2];
    const enhLevel = parseInt(parts[3], 10) || 0;

    const itemDetail = gameData.itemDetailMap[itemHrid];
    if (!itemDetail) continue;
    const equipDetail = itemDetail.equipmentDetail;
    if (!equipDetail) continue;
    const baseStats = equipDetail.noncombatStats ?? {};
    const enhBonuses = equipDetail.noncombatEnhancementBonuses ?? {};

    for (const [statName, baseValue] of Object.entries(baseStats)) {
      const totalValue = (baseValue as number) + ((enhBonuses[statName] as number) ?? 0) * enhLevel;

      if (statName === `${skillName}Speed` || statName === "skillingSpeed") {
        totals.actionSpeed += totalValue;
      } else if (statName === `${skillName}Efficiency` || statName === "skillingEfficiency") {
        totals.efficiency += totalValue;
      } else if (statName === "gatheringQuantity" && GATHERING_SKILLS.has(skillName)) {
        totals.gathering += totalValue;
      } else if (statName === "enhancingSuccess" && skillName === "enhancing") {
        totals.enhancingSuccess += totalValue;
      }
    }
  }

  return totals;
}

/** Get crate buffs from character data + game data */
function getCrateBuffs(
  charData: RawCharData,
  gameData: GameData
): { efficiency: number; successRate: number; doubleProgress: number; levelBoosts: Record<string, number> } {
  const result = { efficiency: 0, successRate: 0, doubleProgress: 0, levelBoosts: {} as Record<string, number> };

  const lab = charData.labyrinth ?? {};
  let crateHrid = lab.teaCrateItemHrid;
  if (!crateHrid) {
    const settings = charData.characterSetting ?? {};
    crateHrid = settings.labyrinthTeaCrateHrid ?? settings.labyrinthCoffeeCrateHrid;
  }
  if (!crateHrid) return result;

  const crateDetailMap = gameData.labyrinthCrateDetailMap ?? {};
  const crateBuffs = crateDetailMap[crateHrid];
  if (!Array.isArray(crateBuffs)) return result;

  for (const buff of crateBuffs) {
    const typeHrid = buff.typeHrid ?? "";
    if (typeHrid.includes("_level") && typeHrid.startsWith("/buff_types/")) {
      const skill = typeHrid.replace("/buff_types/", "").replace("_level", "");
      result.levelBoosts[skill] = buff.flatBoost ?? 0;
    } else if (typeHrid === "/buff_types/efficiency") {
      result.efficiency = buff.ratioBoost ?? 0;
    } else if (typeHrid === "/buff_types/success_rate") {
      result.successRate = buff.ratioBoost ?? 0;
    } else if (typeHrid === "/buff_types/labyrinth_double_progress") {
      result.doubleProgress = buff.flatBoost ?? 0;
    }
  }
  return result;
}

/** Aggregate all buffs for a skill */
export function computeSkillBuffs(
  skillName: string,
  charData: RawCharData,
  gameData: GameData
): SkillBuffs {
  const actionType = `/action_types/${skillName}`;
  const buffs: SkillBuffs = {
    efficiency: 0,
    actionSpeed: 0,
    srBoost: 0,
    dpChance: 0,
    levelBoost: DEFAULT_CRATE_LEVEL_BOOST,
  };

  // Permanent labyrinth skilling upgrades (purchased with tokens; apply in-lab only).
  const upgrades = getLabyrinthUpgradeLevels(charData);
  buffs.actionSpeed += 0.01  * upgrades.skillSpeed;
  buffs.efficiency  += 0.01  * upgrades.skillEfficiency;
  buffs.srBoost     += 0.005 * upgrades.skillSuccess;
  buffs.dpChance    += 0.01  * upgrades.skillDoubleProgress;

  // 1. Equipment buffs from labyrinth loadout
  const titleName = skillName.charAt(0).toUpperCase() + skillName.slice(1);
  const loadout = getLabyrinthLoadout(titleName, charData);
  if (loadout) {
    const equip = computeLoadoutEquipmentBuffs(loadout, skillName, gameData);
    buffs.efficiency += equip.efficiency;
    buffs.actionSpeed += equip.actionSpeed;
    if (GATHERING_SKILLS.has(skillName)) {
      buffs.dpChance += equip.gathering;
    }
    if (skillName === "enhancing") {
      buffs.srBoost += equip.enhancingSuccess;
    }
  }

  // 2-4. House, community, achievement buffs
  const buffMapKeys = [
    "houseActionTypeBuffsMap",
    "communityActionTypeBuffsMap",
    "achievementActionTypeBuffsMap",
  ];
  for (const mapKey of buffMapKeys) {
    const buffList = (charData[mapKey] ?? {})[actionType] ?? [];
    if (!Array.isArray(buffList)) continue;
    for (const b of buffList) {
      const typeHrid = b.typeHrid ?? "";
      const flat = b.flatBoost ?? 0;
      if (typeHrid === "/buff_types/efficiency") {
        buffs.efficiency += flat;
      } else if (typeHrid === "/buff_types/gathering" && GATHERING_SKILLS.has(skillName)) {
        buffs.dpChance += flat;
      }
    }
  }

  // 5. Crate buffs
  const crate = getCrateBuffs(charData, gameData);
  buffs.efficiency += crate.efficiency;
  buffs.srBoost += crate.successRate;
  buffs.dpChance += crate.doubleProgress;
  buffs.levelBoost = crate.levelBoosts[skillName] ?? DEFAULT_CRATE_LEVEL_BOOST;

  return buffs;
}

/** Get labyrinth upgrade levels from characterInfo */
export function getLabyrinthUpgradeLevels(charData: RawCharData): {
  torch: number; shroud: number; beacon: number; cooldown: number;
  fullAuto: number; skillSpeed: number; skillEfficiency: number; skillSuccess: number;
  skillDoubleProgress: number; combatDamage: number; attackSpeed: number; castSpeed: number;
  criticalRate: number; experience: number; points: number;
} {
  const ci = charData.characterInfo ?? {};

  // Capacity upgrades stored as caps (derive level from cap delta vs base)
  const capBases: Record<string, number> = { torch: 100, shroud: 4, beacon: 5, cooldown: 72 };
  const capPerLevel: Record<string, number> = { torch: 20, shroud: 1, beacon: 1, cooldown: -4 };
  const levels: Record<string, number> = {};
  for (const utype of Object.keys(capBases)) {
    let cap: number;
    if (utype === "cooldown") {
      cap = ci.labyrinthCooldownHours ?? capBases[utype];
    } else {
      const key = `labyrinth${utype.charAt(0).toUpperCase() + utype.slice(1)}Cap`;
      cap = ci[key] ?? capBases[utype];
    }
    const per = capPerLevel[utype];
    levels[utype] = per !== 0 ? Math.round((cap - capBases[utype]) / per) : 0;
  }

  // Stat-style upgrades stored directly as level fields.
  const lv = (k: string) => Math.max(0, Number(ci[k]) || 0);
  const fullAuto             = lv("labyrinthFullAutoLevel");
  const skillSpeed           = lv("labyrinthSkillActionSpeedLevel");
  const skillEfficiency      = lv("labyrinthSkillingEfficiencyLevel");
  const skillSuccess         = lv("labyrinthSkillingSuccessLevel");
  const skillDoubleProgress  = lv("labyrinthSkillingDoubleProgressLevel");
  const combatDamage         = lv("labyrinthCombatDamageLevel");
  const attackSpeed          = lv("labyrinthAttackSpeedLevel");
  const castSpeed            = lv("labyrinthCastSpeedLevel");
  const criticalRate         = lv("labyrinthCriticalRateLevel");
  const experience           = lv("labyrinthExperienceLevel");

  // Unspent token count comes from the labyrinth_token inventory item.
  // characterInfo.labyrinthPoints is lifetime/cumulative, not spendable.
  let points = 0;
  const items = charData.characterItems;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item?.itemHrid === "/items/labyrinth_token") {
        points = item.count ?? 0;
        break;
      }
    }
  }

  return {
    torch: levels.torch ?? 0,
    shroud: levels.shroud ?? 0,
    beacon: levels.beacon ?? 0,
    cooldown: levels.cooldown ?? 0,
    fullAuto,
    skillSpeed,
    skillEfficiency,
    skillSuccess,
    skillDoubleProgress,
    combatDamage,
    attackSpeed,
    castSpeed,
    criticalRate,
    experience,
    points,
  };
}

/** Get the player's highest achieved labyrinth floor from characterInfo */
export function getHighestAchievedFloor(charData: RawCharData): number {
  return charData.characterInfo?.labyrinthHighestFloor ?? 0;
}

// --- Helpers ---

function pascalToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
}

function pascalToDisplay(s: string): string {
  return s.replace(/([A-Z])/g, " $1").trim();
}
