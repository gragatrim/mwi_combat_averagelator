// =============================================================================
// Buff - Runtime buff instance with level-scaled values
// =============================================================================
// Ported from: MWICombatSimulatorTest/src/combatsimulator/buff.js
// All logic preserved exactly; typed with interfaces from types.ts.

import type { BuffData } from "./types";

class Buff {
  uniqueHrid: string;
  typeHrid: string;
  ratioBoost: number;
  flatBoost: number;
  duration: number;
  startTime: number;
  multiplierForSkillHrid: string;
  multiplierPerSkillLevel: number;

  constructor(buff: BuffData, level: number = 1) {
    this.uniqueHrid = buff.uniqueHrid;
    this.typeHrid = buff.typeHrid;
    this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
    this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
    this.duration = buff.duration;
    this.startTime = 0;
    this.multiplierForSkillHrid = buff.multiplierForSkillHrid ?? "";
    this.multiplierPerSkillLevel = buff.multiplierPerSkillLevel ?? 0;
  }
}

export default Buff;
