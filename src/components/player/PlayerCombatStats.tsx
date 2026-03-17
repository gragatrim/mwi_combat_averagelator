// =============================================================================
// PlayerCombatStats - Displays computed combat stats matching the in-game panel
// =============================================================================

import { useMemo, useState } from "react";
import type { GameData, PlayerConfig, CombatDetails, CombatStats } from "../../engine/types";
import type { XpBonusSettings } from "../../hooks/useSimulation";
import Player from "../../engine/player";
import Equipment from "../../engine/equipment";
import Consumable from "../../engine/consumable";
import Ability from "../../engine/ability";
import Buff from "../../engine/buff";

interface PlayerCombatStatsProps {
  playerConfig: PlayerConfig;
  xpBonuses: XpBonusSettings;
  gameData: GameData;
}

interface ComputedStats {
  combatDetails: CombatDetails;
  combatStats: CombatStats;
  wisdomBuffBonus: number;
}

function computeStats(
  config: PlayerConfig,
  xpBonuses: XpBonusSettings,
  gameData: GameData
): ComputedStats {
  const deps = {
    Equipment: {
      createFromDTO: (dto: { hrid: string; enhancementLevel: number }) =>
        Equipment.createFromDTO(gameData, dto),
    },
    Consumable: {
      createFromDTO: (dto: { hrid: string; triggers: any[] }) =>
        Consumable.createFromDTO(gameData, dto),
    },
    Ability: {
      createFromDTO: (dto: { hrid: string; level: number; triggers: any[] }) =>
        Ability.createFromDTO(gameData, dto),
    },
  };

  const player = Player.createFromDTO(config, gameData, deps);

  // Apply XP bonuses (same logic as useSimulation)
  const pb = xpBonuses.playerBonuses[0];
  const communityWisdom =
    xpBonuses.communityBuffLevel > 0
      ? 0.2 + 0.005 * (xpBonuses.communityBuffLevel - 1)
      : 0;

  let wisdomBuffBonus = communityWisdom;
  const sealBuffs: Buff[] = [];

  const makeSealBuff = (
    typeHrid: string,
    flatBoost: number,
    ratioBoost: number
  ) =>
    new Buff({
      uniqueHrid: `/seals/${typeHrid.split("/").pop()}`,
      typeHrid,
      flatBoost,
      flatBoostLevelBonus: 0,
      ratioBoost,
      ratioBoostLevelBonus: 0,
      startTime: 0,
      duration: 1800e9,
    });

  if (pb) {
    if (pb.mooPass) wisdomBuffBonus += 0.05;
    if (pb.seals?.wisdom) wisdomBuffBonus += 0.2;
    if (pb.seals?.attackSpeed)
      sealBuffs.push(makeSealBuff("/buff_types/attack_speed", 0, 0.15));
    if (pb.seals?.castSpeed)
      sealBuffs.push(makeSealBuff("/buff_types/cast_speed", 0.15, 0));
    if (pb.seals?.damage)
      sealBuffs.push(makeSealBuff("/buff_types/damage", 0, 0.08));
    if (pb.seals?.criticalRate)
      sealBuffs.push(makeSealBuff("/buff_types/critical_rate", 0.1, 0));
    if (pb.seals?.combatDrop)
      sealBuffs.push(
        makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0)
      );
  }

  if (sealBuffs.length > 0) {
    player.extraBuffs = [...player.extraBuffs, ...sealBuffs];
  }
  player.wisdomBuffBonus = wisdomBuffBonus;

  // Initialize like the sim does at combat start
  player.generatePermanentBuffs();
  player.reset(0);

  return {
    combatDetails: player.combatDetails,
    combatStats: player.combatDetails.combatStats,
    wisdomBuffBonus,
  };
}

// Formatting helpers
function formatHrid(hrid: string): string {
  const name = hrid.split("/").pop() || hrid;
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pct(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

function signedPct(value: number, decimals = 2): string {
  const formatted = (value * 100).toFixed(decimals);
  return value >= 0 ? `+${formatted}%` : `${formatted}%`;
}

function num(value: number, decimals = 0): string {
  return decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
}

// Stat row component
function StatRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className={`text-xs font-mono ${muted ? "text-gray-500" : "text-gray-200"}`}>
        {value}
      </span>
    </div>
  );
}

// Section header
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mt-3 mb-1 border-b border-gray-800 pb-0.5">
      {title}
    </div>
  );
}

export default function PlayerCombatStats({
  playerConfig,
  xpBonuses,
  gameData,
}: PlayerCombatStatsProps) {
  const [isOpen, setIsOpen] = useState(true);

  const stats = useMemo(
    () => computeStats(playerConfig, xpBonuses, gameData),
    [playerConfig, xpBonuses, gameData]
  );

  const { combatDetails: cd, combatStats: cs, wisdomBuffBonus } = stats;

  // Determine primary combat style
  const styleKey = cs.combatStyleHrid.split("/").pop() || "smash";
  const isMagic = styleKey === "magic";
  const isRanged = styleKey === "ranged";

  // Get the primary accuracy rating and max damage based on combat style
  let primaryAccLabel: string;
  let primaryAccValue: number;
  let primaryDmgLabel: string;
  let primaryDmgValue: number;

  if (isMagic) {
    primaryAccLabel = "Magic Accuracy";
    primaryAccValue = cd.magicAccuracyRating;
    primaryDmgLabel = "Magic Damage";
    primaryDmgValue = cd.magicMaxDamage;
  } else if (isRanged) {
    primaryAccLabel = "Ranged Accuracy";
    primaryAccValue = cd.rangedAccuracyRating;
    primaryDmgLabel = "Ranged Damage";
    primaryDmgValue = cd.rangedMaxDamage;
  } else {
    // Melee: stab/slash/smash
    const styleName = formatHrid(cs.combatStyleHrid);
    primaryAccLabel = `${styleName} Accuracy`;
    primaryAccValue = (cd as any)[`${styleKey}AccuracyRating`];
    primaryDmgLabel = `${styleName} Damage`;
    primaryDmgValue = (cd as any)[`${styleKey}MaxDamage`];
  }

  const attackIntervalSec = cs.attackInterval / 1e9;

  // Total combat experience (equipment/buffs + wisdom bonus)
  const totalCombatExp = cs.combatExperience + wisdomBuffBonus;

  // Per-skill experience entries (only show non-zero)
  const skillExpEntries: [string, number][] = [
    ["Stamina", cs.staminaExperience],
    ["Intelligence", cs.intelligenceExperience],
    ["Attack", cs.attackExperience],
    ["Defense", cs.defenseExperience],
    ["Melee", cs.meleeExperience],
    ["Ranged", cs.rangedExperience],
    ["Magic", cs.magicExperience],
  ].filter(([, v]) => (v as number) !== 0) as [string, number][];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/50 transition-colors cursor-pointer"
      >
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Combat Stats
        </h3>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="px-4 pb-3">
          {/* Combat Style & Timing */}
          <SectionHeader title="Combat" />
          <StatRow label="Combat Style" value={formatHrid(cs.combatStyleHrid)} />
          <StatRow label="Damage Type" value={formatHrid(cs.damageType)} />
          <StatRow label="Attack Interval" value={`${attackIntervalSec.toFixed(2)}s`} />
          <StatRow label="Auto Attack Damage" value={signedPct(cs.autoAttackDamage)} />
          <StatRow label="Ability Damage" value={signedPct(cs.abilityDamage)} />
          <StatRow label="Cast Speed" value={pct(cs.castSpeed)} />
          <StatRow label="Ability Haste" value={num(cs.abilityHaste)} />
          <StatRow label="Critical Rate" value={pct(cs.criticalRate)} />
          <StatRow label="Critical Damage" value={pct(cs.criticalDamage)} />

          {/* Offense */}
          <SectionHeader title="Offense" />
          <StatRow label={primaryAccLabel} value={num(primaryAccValue)} />
          <StatRow label={primaryDmgLabel} value={num(primaryDmgValue)} />
          <StatRow
            label="Defensive Damage"
            value={num(cd.defensiveMaxDamage)}
            muted={cd.defensiveMaxDamage === 0}
          />
          <StatRow label="Task Damage" value={signedPct(cs.taskDamage)} />

          {/* Amplify & Penetration */}
          <SectionHeader title="Amplify & Penetration" />
          <StatRow label="Water Amplify" value={pct(cs.waterAmplify)} />
          <StatRow label="Nature Amplify" value={pct(cs.natureAmplify)} />
          <StatRow label="Fire Amplify" value={pct(cs.fireAmplify)} />
          <StatRow label="Physical Amplify" value={pct(cs.physicalAmplify)} muted={cs.physicalAmplify === 0} />
          <StatRow label="Healing Amplify" value={pct(cs.healingAmplify)} />
          <StatRow label="Water Penetration" value={pct(cs.waterPenetration)} />
          <StatRow label="Nature Penetration" value={pct(cs.naturePenetration)} />
          <StatRow label="Fire Penetration" value={pct(cs.firePenetration)} />
          <StatRow label="Armor Penetration" value={pct(cs.armorPenetration)} muted={cs.armorPenetration === 0} />

          {/* HP & MP */}
          <SectionHeader title="Health & Mana" />
          <StatRow label="Max HP" value={num(cd.maxHitpoints)} />
          <StatRow label="Max MP" value={num(cd.maxManapoints)} />
          <StatRow label="HP Regen" value={pct(cs.hpRegenPer10)} />
          <StatRow label="MP Regen" value={pct(cs.mpRegenPer10)} />
          <StatRow label="Life Steal" value={pct(cs.lifeSteal)} muted={cs.lifeSteal === 0} />
          <StatRow label="Mana Leech" value={pct(cs.manaLeech)} muted={cs.manaLeech === 0} />

          {/* Defense */}
          <SectionHeader title="Defense" />
          <StatRow label="Stab Evasion" value={num(cd.stabEvasionRating)} />
          <StatRow label="Slash Evasion" value={num(cd.slashEvasionRating)} />
          <StatRow label="Smash Evasion" value={num(cd.smashEvasionRating)} />
          <StatRow label="Ranged Evasion" value={num(cd.rangedEvasionRating)} />
          <StatRow label="Magic Evasion" value={num(cd.magicEvasionRating)} />
          <StatRow label="Armor" value={num(cd.totalArmor)} />
          <StatRow label="Water Resistance" value={num(cd.totalWaterResistance)} />
          <StatRow label="Nature Resistance" value={num(cd.totalNatureResistance)} />
          <StatRow label="Fire Resistance" value={num(cd.totalFireResistance)} />

          {/* Utility */}
          <SectionHeader title="Utility" />
          <StatRow label="Tenacity" value={num(cs.tenacity)} />
          <StatRow label="Threat" value={num(cs.threat)} />
          <StatRow label="Drink Concentration" value={signedPct(cs.drinkConcentration)} muted={cs.drinkConcentration === 0} />
          <StatRow label="Food Haste" value={signedPct(cs.foodHaste)} muted={cs.foodHaste === 0} />
          <StatRow label="Combat Drop Quantity" value={signedPct(cs.combatDropQuantity)} />
          <StatRow label="Combat Rare Find" value={signedPct(cs.combatRareFind)} />
          <StatRow label="Combat Drop Rate" value={signedPct(cs.combatDropRate)} muted={cs.combatDropRate === 0} />

          {/* Training & Experience */}
          <SectionHeader title="Training & Experience" />
          <StatRow label="Primary Training" value={formatHrid(cs.primaryTraining)} />
          <StatRow
            label="Focus Training"
            value={cs.focusTraining ? formatHrid(cs.focusTraining) : "None"}
            muted={!cs.focusTraining}
          />
          <StatRow label="Combat Experience" value={signedPct(totalCombatExp)} />
          {wisdomBuffBonus > 0 && (
            <StatRow
              label="  (Gear + Buffs)"
              value={`${signedPct(cs.combatExperience)} + ${signedPct(wisdomBuffBonus)}`}
              muted
            />
          )}
          {skillExpEntries.map(([skill, value]) => (
            <StatRow
              key={skill}
              label={`${skill} Experience`}
              value={signedPct(value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
