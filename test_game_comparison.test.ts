// =============================================================================
// Game Comparison Test — Compare captured combat log vs sim predictions
// =============================================================================
// Usage: npx vitest run test_game_comparison
//
// Reads combat log from live_data/combat_log_latest.json (exported by
// scripts/mwi_combat_logger.user.js) and compares per-fight stats against
// what the deterministic sim predicts.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import type { GameData, PlayerConfig } from "./src/engine/types";
import {
  parseFullCharacterData,
  type FullCharacterData,
} from "./src/data/fullCharacterData";
import {
  buildCrateBuffs,
  findMaxLabyrinthLevel,
} from "./src/features/labyrinthSimulator";
import Buff from "./src/engine/buff";
import Player from "./src/engine/player";
import Monster from "./src/engine/monster";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";
import Zone from "./src/engine/zone";
import DeterministicSimulator from "./src/engine/deterministicSimulator";
import CombatUtilities from "./src/engine/combatUtilities";
import type Trigger from "./src/engine/trigger";

// =============================================================================
// Setup — same as test_lab_diagnostic.test.ts
// =============================================================================

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const COMBAT_LOG_PATH = "live_data/combat_log_latest.json";

// Only load character data if it exists (test will skip if no log)
let parsed: FullCharacterData | null = null;
try {
  const fullCharJson = readFileSync(
    "live_data/gragatrim_full_char_data.json",
    "utf-8"
  );
  parsed = parseFullCharacterData(fullCharJson, gameData);
} catch {
  // Character data not available
}

const crateBuffs = buildCrateBuffs("expert", "expert");

function buildAllSealBuffs(): Buff[] {
  const makeSealBuff = (
    typeHrid: string,
    flatBoost: number,
    ratioBoost: number
  ): Buff =>
    new Buff({
      uniqueHrid: `/buff_uniques/seal_${typeHrid.split("/").pop()}`,
      typeHrid,
      flatBoost,
      flatBoostLevelBonus: 0,
      ratioBoost,
      ratioBoostLevelBonus: 0,
      startTime: 0,
      duration: 0,
    });

  return [
    makeSealBuff("/buff_types/attack_speed", 0, 0.15),
    makeSealBuff("/buff_types/cast_speed", 0.15, 0),
    makeSealBuff("/buff_types/damage", 0, 0.08),
    makeSealBuff("/buff_types/critical_rate", 0.1, 0),
    makeSealBuff("/buff_types/combat_drop_quantity", 0.15, 0),
  ];
}

const sealBuffs = buildAllSealBuffs();
const wisdomBuffBonus = 0.295 + 0.05 + 0.2;

// =============================================================================
// Player/Monster builders
// =============================================================================

function buildPlayerDeps(gd: GameData) {
  return {
    Equipment: {
      createFromDTO: (
        dto: { hrid: string; enhancementLevel: number },
        _gd: GameData
      ) => Equipment.createFromDTO(gd, dto),
    },
    Consumable: {
      createFromDTO: (
        dto: { hrid: string; triggers: any[] },
        _gd: GameData
      ) => Consumable.createFromDTO(gd, dto),
    },
    Ability: {
      createFromDTO: (
        dto: { hrid: string; level: number; triggers: any[] },
        _gd: GameData
      ) => Ability.createFromDTO(gd, dto),
    },
  };
}

class AbilityAdapter {
  private gameData: GameData;
  constructor(gd: GameData) {
    this.gameData = gd;
  }
  getConstructor(): new (
    hrid: string,
    gameData: GameData,
    level?: number,
    triggers?: Trigger[] | null
  ) => Ability {
    const gd = this.gameData;
    return class extends Ability {
      constructor(
        hrid: string,
        _gameData: GameData,
        level?: number,
        triggers?: Trigger[] | null
      ) {
        super(gd, hrid, level, triggers);
      }
    } as unknown as new (
      hrid: string,
      gameData: GameData,
      level?: number,
      triggers?: Trigger[] | null
    ) => Ability;
  }
}

function getMonsterLoadout(
  monsterHrid: string,
  parsed: FullCharacterData
): PlayerConfig {
  const loadoutId = parsed.labyrinthMonsterLoadouts[monsterHrid];
  if (loadoutId) {
    const loadout = parsed.combatLoadouts.find((l) => l.id === loadoutId);
    if (loadout) return loadout.config;
  }
  return parsed.combatLoadouts[0].config;
}

// =============================================================================
// Hit chance formula
// =============================================================================

function combatLogExists(): boolean {
  return existsSync(COMBAT_LOG_PATH) && statSync(COMBAT_LOG_PATH).size > 10;
}

function computeHitChance(accuracy: number, evasion: number): number {
  if (accuracy <= 0) return 0;
  if (evasion <= 0) return 1;
  return Math.min(
    1,
    Math.max(
      0,
      Math.pow(accuracy, 1.4) /
        (Math.pow(accuracy, 1.4) + Math.pow(evasion, 1.4))
    )
  );
}

// =============================================================================
// Stat extraction helpers
// =============================================================================

function getStyleStats(
  cd: any,
  style: string
): { accuracy: number; maxDamage: number; evasion: number } {
  if (style?.includes("ranged")) {
    return {
      accuracy: cd.rangedAccuracyRating,
      maxDamage: cd.rangedMaxDamage,
      evasion: cd.rangedEvasionRating,
    };
  } else if (style?.includes("magic")) {
    return {
      accuracy: cd.magicAccuracyRating,
      maxDamage: cd.magicMaxDamage,
      evasion: cd.magicEvasionRating,
    };
  } else if (style?.includes("stab")) {
    return {
      accuracy: cd.stabAccuracyRating,
      maxDamage: cd.stabMaxDamage,
      evasion: cd.stabEvasionRating,
    };
  } else if (style?.includes("slash")) {
    return {
      accuracy: cd.slashAccuracyRating,
      maxDamage: cd.slashMaxDamage,
      evasion: cd.slashEvasionRating,
    };
  } else if (style?.includes("smash")) {
    return {
      accuracy: cd.smashAccuracyRating,
      maxDamage: cd.smashMaxDamage,
      evasion: cd.smashEvasionRating,
    };
  }
  return { accuracy: 0, maxDamage: 0, evasion: 0 };
}

function getResistanceForDamageType(cd: any, damageType: string): number {
  const dt = damageType?.split("/").pop();
  if (dt === "fire") return cd.totalFireResistance;
  if (dt === "water") return cd.totalWaterResistance;
  if (dt === "nature") return cd.totalNatureResistance;
  return cd.totalArmor; // physical
}

// =============================================================================
// Raw event analysis — compute stats from per-event data (immune to summary bugs)
// =============================================================================

interface RawEventAnalysis {
  playerHits: number;
  playerMisses: number;
  playerCrits: number;
  playerDmg: number;
  monsterHits: number;
  monsterMisses: number;
  monsterCrits: number;
  monsterDmg: number;
  totalHealing: number;
}

function analyzeRawEvents(fight: any): RawEventAnalysis {
  let playerHits = 0, playerMisses = 0, playerCrits = 0, playerDmg = 0;
  let monsterHits = 0, monsterMisses = 0, monsterCrits = 0, monsterDmg = 0;
  let totalHealing = 0;

  for (const e of (fight.events || [])) {
    switch (e.type) {
      case "playerAttack":
      case "playerAbility":
        playerHits++;
        playerDmg += e.damage;
        if (e.isCrit) playerCrits++;
        break;
      case "playerMiss":
        playerMisses++;
        break;
      case "monsterAttack":
      case "monsterAbility":
        monsterHits++;
        monsterDmg += e.damage;
        if (e.isCrit) monsterCrits++;
        break;
      case "monsterMiss":
        monsterMisses++;
        break;
      case "regen":
        totalHealing += Math.abs(e.damage);
        break;
    }
  }

  return {
    playerHits, playerMisses, playerCrits, playerDmg,
    monsterHits, monsterMisses, monsterCrits, monsterDmg,
    totalHealing,
  };
}

function printRawEventAnalysis(raw: RawEventAnalysis, durationSec: number): void {
  const playerTotal = raw.playerHits + raw.playerMisses;
  const monsterTotal = raw.monsterHits + raw.monsterMisses;
  const playerHitRate = playerTotal > 0 ? raw.playerHits / playerTotal : 0;
  const playerCritRate = raw.playerHits > 0 ? raw.playerCrits / raw.playerHits : 0;
  const monsterHitRate = monsterTotal > 0 ? raw.monsterHits / monsterTotal : 0;
  const monsterCritRate = raw.monsterHits > 0 ? raw.monsterCrits / raw.monsterHits : 0;
  const playerDps = durationSec > 0 ? raw.playerDmg / durationSec : 0;
  const monsterDps = durationSec > 0 ? raw.monsterDmg / durationSec : 0;
  const playerDmgPerHit = raw.playerHits > 0 ? raw.playerDmg / raw.playerHits : 0;

  console.log("\n  Raw Event Analysis (computed from per-event data):");
  console.log(`    Player:  ${raw.playerHits} hits, ${raw.playerMisses} misses, ${raw.playerCrits} crits`);
  console.log(`             Hit rate: ${(playerHitRate * 100).toFixed(1)}%  Crit rate: ${(playerCritRate * 100).toFixed(1)}%`);
  console.log(`             Total dmg: ${raw.playerDmg}  DPS: ${playerDps.toFixed(1)}  Avg/hit: ${playerDmgPerHit.toFixed(1)}`);
  console.log(`    Monster: ${raw.monsterHits} hits, ${raw.monsterMisses} misses, ${raw.monsterCrits} crits`);
  console.log(`             Hit rate: ${(monsterHitRate * 100).toFixed(1)}%  Crit rate: ${(monsterCritRate * 100).toFixed(1)}%`);
  console.log(`             Total dmg: ${raw.monsterDmg}  DPS: ${monsterDps.toFixed(1)}`);
  console.log(`    Healing: ${raw.totalHealing}`);
}

// =============================================================================
// Comparison table printer
// =============================================================================

function printStatComparison(
  label: string,
  rows: Array<[string, number, number]>
) {
  console.log(`\n  ${label}:`);
  console.log(
    "    " +
      "Stat".padEnd(28) +
      "Game".padStart(10) +
      "Sim".padStart(10) +
      "Diff".padStart(10) +
      "Diff%".padStart(8)
  );
  console.log("    " + "-".repeat(66));

  let mismatches = 0;

  for (const [name, gameVal, simVal] of rows) {
    const diff = simVal - gameVal;
    const pctDiff =
      gameVal !== 0
        ? ((diff / Math.abs(gameVal)) * 100).toFixed(1)
        : simVal === 0
          ? "0.0"
          : "INF";
    const isMismatch = Math.abs(diff) > Math.max(1, Math.abs(gameVal) * 0.01);
    const marker = isMismatch ? " <<<" : "";
    if (isMismatch) mismatches++;

    const formatVal = (v: number) =>
      Math.abs(v) < 1 && v !== 0
        ? (v * 100).toFixed(2) + "%"
        : v % 1 !== 0
          ? v.toFixed(1)
          : String(v);

    console.log(
      "    " +
        name.padEnd(28) +
        formatVal(gameVal).padStart(10) +
        formatVal(simVal).padStart(10) +
        diff.toFixed(1).padStart(10) +
        (pctDiff + "%").padStart(8) +
        marker
    );
  }

  return mismatches;
}

// =============================================================================
// Infer labyrinth level from monster maxHitpoints
// =============================================================================

function inferLabyrinthLevel(
  monsterHrid: string,
  gameMaxHP: number
): number | null {
  const monsterData = gameData.combatMonsterDetailMap[monsterHrid];
  if (!monsterData) return null;

  // Labyrinth HP = scaleFactor * baseMaxHP where scaleFactor = level/100
  // Base HP comes from combatStats.maxHitpoints (flat) + level-derived HP
  // Try a range of levels and find the one that produces closest HP
  const abilityAdapter = new AbilityAdapter(gameData);

  let bestLevel = 0;
  let bestDiff = Infinity;

  for (let level = 1; level <= 500; level++) {
    const monster = new Monster(monsterHrid, gameData, 0, {
      Ability: abilityAdapter.getConstructor(),
    });
    monster.setLabyrinthTargetLevel(level);
    monster.updateCombatDetails();

    const diff = Math.abs(monster.combatDetails.maxHitpoints - gameMaxHP);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level;
    }
    // If we've gone past the target, stop
    if (monster.combatDetails.maxHitpoints > gameMaxHP * 1.1 && level > 50) {
      break;
    }
  }

  return bestDiff < gameMaxHP * 0.02 ? bestLevel : null;
}

// =============================================================================
// Run sim fight for a given monster at a given level
// =============================================================================

function runSimFight(
  playerConfig: PlayerConfig,
  monsterHrid: string,
  targetLevel: number
): {
  success: boolean;
  fightTimeSec: number;
  playerDps: number;
  monsterDps: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealing: number;
  playerHitChance: number;
  monsterHitChance: number;
  playerCd: any;
  monsterCd: any;
} {
  const deps = buildPlayerDeps(gameData);
  const player = Player.createFromDTO(playerConfig, gameData, deps);

  player.extraBuffs = [...crateBuffs, ...sealBuffs];
  player.wisdomBuffBonus = wisdomBuffBonus;
  player.food = [null, null, null];
  player.drinks = [null, null, null];
  player.generatePermanentBuffs();
  player.clearBuffs();

  const abilityAdapter = new AbilityAdapter(gameData);
  const monster = new Monster(monsterHrid, gameData, 0, {
    Ability: abilityAdapter.getConstructor(),
  });
  monster.setLabyrinthTargetLevel(targetLevel);
  monster.updateCombatDetails();

  const pd = player.combatDetails;
  const md = monster.combatDetails;

  const playerStyle = pd.combatStats.combatStyleHrid;
  const monsterStyle = md.combatStats.combatStyleHrid;

  const playerStats = getStyleStats(pd, playerStyle);
  const monsterEvasionVsPlayer = getStyleStats(md, playerStyle).evasion;
  const monsterStats = getStyleStats(md, monsterStyle);
  const playerEvasionVsMonster = getStyleStats(pd, monsterStyle).evasion;

  const playerHitChance = computeHitChance(
    playerStats.accuracy,
    monsterEvasionVsPlayer
  );
  const monsterHitChance = computeHitChance(
    monsterStats.accuracy,
    playerEvasionVsMonster
  );

  // Run actual sim fight
  const fightPlayer = Player.createFromDTO(playerConfig, gameData, deps);
  fightPlayer.extraBuffs = [...crateBuffs, ...sealBuffs];
  fightPlayer.wisdomBuffBonus = wisdomBuffBonus;
  fightPlayer.food = [null, null, null];
  fightPlayer.drinks = [null, null, null];

  const zone = Zone.createLabyrinthZone(monsterHrid);
  const simulator = new DeterministicSimulator([fightPlayer], zone, gameData, {
    stopAfterFirstEncounter: true,
    labyrinthTargetLevel: targetLevel,
    maxSimTimeNs: 120e9,
  });
  const simResult = simulator.simulate();

  const simTimeNs = simResult.totalSimTimeNs;
  const success = simResult.encounters > 0;
  const fightTimeSec = simTimeNs / 1e9;

  const playerKey = Object.keys(simResult.playerStats).find(
    (k) => !k.startsWith("/")
  );
  const ps = playerKey ? simResult.playerStats[playerKey] : null;

  const totalDamageDealt = ps?.totalDamageDealt ?? 0;
  const totalHealing = ps?.totalHealingReceived ?? 0;

  const fightPd = fightPlayer.combatDetails;
  const playerHpAtEnd = fightPd.currentHitpoints;
  const totalDamageTaken =
    fightPd.maxHitpoints - playerHpAtEnd + totalHealing;

  return {
    success,
    fightTimeSec,
    playerDps: fightTimeSec > 0 ? totalDamageDealt / fightTimeSec : 0,
    monsterDps: fightTimeSec > 0 ? totalDamageTaken / fightTimeSec : 0,
    totalDamageDealt,
    totalDamageTaken,
    totalHealing,
    playerHitChance,
    monsterHitChance,
    playerCd: pd,
    monsterCd: md,
    // Post-fight retaliation rate (includes all buffs; used as fallback for detection)
    fightPlayerRetaliation: fightPd.combatStats?.retaliation ?? 0,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Game Comparison", () => {
  it("should load combat log and compare stats", { timeout: 120_000 }, () => {
    if (!combatLogExists()) {
      console.log(
        `\nNo combat log found at ${COMBAT_LOG_PATH}.`
      );
      console.log(
        "Install scripts/mwi_combat_logger.user.js in Tampermonkey,"
      );
      console.log(
        "run some fights, export JSON, and save as live_data/combat_log_latest.json"
      );
      return;
    }

    if (!parsed) {
      console.log("\nNo character data found. Skipping comparison.");
      return;
    }

    const combatLog = JSON.parse(readFileSync(COMBAT_LOG_PATH, "utf-8"));
    console.log(`\nLoaded combat log: ${combatLog.fights.length} fights`);
    console.log(`Exported at: ${combatLog.exportedAt}`);
    console.log(`Version: ${combatLog.version}`);

    if (combatLog.messageTypeCounts) {
      console.log("\nMessage types seen:");
      for (const [type, count] of Object.entries(
        combatLog.messageTypeCounts
      ).sort((a, b) => (b[1] as number) - (a[1] as number))) {
        console.log(`  ${type}: ${count}`);
      }
    }

    // Process each fight
    let fightIdx = 0;
    for (const fight of combatLog.fights) {
      fightIdx++;
      const monsterHrid =
        fight.monsterStats?.[0]?.hrid ||
        fight.monsterStats?.[0]?.combatDetails?.combatStats?.combatStyleHrids?.[0]; // fallback
      const monsterName =
        fight.monsterStats?.[0]?.name ||
        (monsterHrid || "unknown").split("/").pop();

      console.log(
        `\n${"=".repeat(70)}\nFight ${fightIdx}: ${monsterName} (${fight.combatMode}) — ${fight.outcome}, ${(fight.durationSec || 0).toFixed(1)}s`
      );
      console.log("=".repeat(70));

      // -----------------------------------------------------------------
      // A. Compare game combatDetails vs sim-computed stats
      // -----------------------------------------------------------------
      const gamePd = fight.playerStats?.[0]?.combatDetails;
      const gameMd = fight.monsterStats?.[0]?.combatDetails;

      if (!gamePd) {
        console.log("  No player combatDetails in log — skipping stat comparison");
        continue;
      }

      // --- Change 1: Detect & flag partial captures ---
      const isPartialCapture = gameMd && gameMd.currentHitpoints < gameMd.maxHitpoints * 0.99;
      if (isPartialCapture) {
        console.log(`  ⚠ PARTIAL CAPTURE: monster at ${(gameMd.currentHitpoints / gameMd.maxHitpoints * 100).toFixed(0)}% HP — DPS/duration comparison invalid`);
      }

      // --- Change 5: Flag temporary combat buffs on player ---
      const playerBuffMap = fight.playerStats?.[0]?.combatBuffMap;
      if (playerBuffMap) {
        const tempBuffKeywords: Record<string, string> = {
          berserk: "physical_amplify",
          frenzy: "attack_speed",
          precision: "accuracy",
          retribution: "retaliation",
          enrage: "damage",
          reflect: "armor",
          surge: "damage",
        };
        const activeTemps: string[] = [];
        for (const [buffKey, buffData] of Object.entries(playerBuffMap) as [string, any][]) {
          for (const [kw, desc] of Object.entries(tempBuffKeywords)) {
            if (buffKey.toLowerCase().includes(kw)) {
              const val = buffData.flatBoost || buffData.ratioBoost || 0;
              activeTemps.push(`${kw} (${desc}: ${val > 0 ? "+" : ""}${(val * 100).toFixed(1)}%)`);
              break;
            }
          }
        }
        if (activeTemps.length > 0) {
          console.log(`  ⚠ TEMPORARY BUFFS ACTIVE: ${activeTemps.join(", ")}`);
          console.log("    Stats comparison may show inflated game values for affected stats");
        }
      }

      // Try to infer labyrinth level from monster HP
      let inferredLevel: number | null = null;
      if (monsterHrid && gameMd) {
        inferredLevel = inferLabyrinthLevel(
          monsterHrid,
          gameMd.maxHitpoints
        );
        if (inferredLevel) {
          console.log(
            `  Inferred labyrinth level: ${inferredLevel} (from monster maxHP=${gameMd.maxHitpoints})`
          );
        } else {
          console.log(
            `  Could not infer labyrinth level from maxHP=${gameMd.maxHitpoints}`
          );
        }
      }

      // --- Change 4: Show monster abilities and expected CC impact ---
      if (monsterHrid && inferredLevel) {
        const monsterDetail = gameData.combatMonsterDetailMap[monsterHrid];
        if (monsterDetail?.abilities?.length) {
          console.log(`\n  Monster Abilities (at labyrinth level ${inferredLevel}):`);
          for (const abInfo of monsterDetail.abilities) {
            const ahrid = abInfo.abilityHrid;
            const ad = gameData.abilityDetailMap[ahrid];
            if (!ad) continue;
            const name = ad.name || ahrid.split("/").pop();
            const cd = (ad.cooldownDuration || 0) / 1e9;
            const parts: string[] = [`cd=${cd.toFixed(0)}s`];

            for (const eff of ad.abilityEffects || []) {
              if (eff.blindChance) parts.push(`blind=${(eff.blindChance * 100).toFixed(0)}%/${(eff.blindDuration / 1e9).toFixed(0)}s`);
              if (eff.stunChance) parts.push(`stun=${(eff.stunChance * 100).toFixed(0)}%/${(eff.stunDuration / 1e9).toFixed(0)}s`);
              if (eff.silenceChance) parts.push(`silence=${(eff.silenceChance * 100).toFixed(0)}%/${(eff.silenceDuration / 1e9).toFixed(0)}s`);
              if (eff.hpHealRatio) parts.push(`heal=${(eff.hpHealRatio * 100).toFixed(0)}%`);
              const buffs = eff.buffs || [];
              for (const buff of buffs) {
                const btype = (buff.typeHrid || "").split("/").pop();
                const val = buff.flatBoost || buff.ratioBoost || 0;
                if (btype && val) parts.push(`${btype}=${val > 0 ? "+" : ""}${val}`);
              }
            }
            console.log(`    ${name}: ${parts.join(", ")}`);
          }
        }
      }

      // Build sim player + monster for comparison
      if (monsterHrid && inferredLevel && parsed) {
        const config = getMonsterLoadout(monsterHrid, parsed);
        const sim = runSimFight(config, monsterHrid, inferredLevel);

        // -----------------------------------------------------------------
        // B. Player stat comparison (game new_battle snapshot vs sim)
        // -----------------------------------------------------------------
        const simPd = sim.playerCd;
        const playerStatRows: Array<[string, number, number]> = [];

        if (gamePd.maxHitpoints != null)
          playerStatRows.push([
            "Max HP",
            gamePd.maxHitpoints,
            simPd.maxHitpoints,
          ]);
        if (gamePd.maxManapoints != null)
          playerStatRows.push([
            "Max MP",
            gamePd.maxManapoints,
            simPd.maxManapoints,
          ]);
        if (gamePd.totalArmor != null)
          playerStatRows.push([
            "Armor",
            gamePd.totalArmor,
            simPd.totalArmor,
          ]);
        if (gamePd.totalWaterResistance != null)
          playerStatRows.push([
            "Water Res",
            gamePd.totalWaterResistance,
            simPd.totalWaterResistance,
          ]);
        if (gamePd.totalFireResistance != null)
          playerStatRows.push([
            "Fire Res",
            gamePd.totalFireResistance,
            simPd.totalFireResistance,
          ]);
        if (gamePd.totalNatureResistance != null)
          playerStatRows.push([
            "Nature Res",
            gamePd.totalNatureResistance,
            simPd.totalNatureResistance,
          ]);

        // Accuracy ratings
        for (const style of [
          "stab",
          "slash",
          "smash",
          "ranged",
          "magic",
        ]) {
          const gameAcc = gamePd[`${style}AccuracyRating`];
          const simAcc = simPd[`${style}AccuracyRating`];
          if (gameAcc != null && gameAcc > 0) {
            playerStatRows.push([
              `${style} Accuracy`,
              gameAcc,
              simAcc,
            ]);
          }
          const gameMaxDmg = gamePd[`${style}MaxDamage`];
          const simMaxDmg = simPd[`${style}MaxDamage`];
          if (gameMaxDmg != null && gameMaxDmg > 0) {
            playerStatRows.push([
              `${style} MaxDamage`,
              gameMaxDmg,
              simMaxDmg,
            ]);
          }
          const gameEva = gamePd[`${style}EvasionRating`];
          const simEva = simPd[`${style}EvasionRating`];
          if (gameEva != null && gameEva > 0) {
            playerStatRows.push([
              `${style} Evasion`,
              gameEva,
              simEva,
            ]);
          }
        }

        // Combat stats
        // Reliable stats — game snapshot includes buffs for these
        const reliableCombatStatKeys = [
          "criticalRate",
          "criticalDamage",
          "physicalAmplify",
          "lifeSteal",
          "manaLeech",
          "tenacity",
          "parry",
          "retaliation",
          "weaken",
        ];

        for (const key of reliableCombatStatKeys) {
          const gameVal = gamePd.combatStats?.[key];
          const simVal = simPd.combatStats?.[key];
          if (gameVal != null && (gameVal !== 0 || simVal !== 0)) {
            playerStatRows.push([key, gameVal, simVal]);
          }
        }

        // Partially buffed stats — game snapshot excludes crate/seal buffs
        // Shown separately to avoid false-alarm mismatches
        const partialStatKeys = [
          "attackSpeed",
          "castSpeed",
          "attackInterval",
          "hpRegenPer10",
          "mpRegenPer10",
        ];
        const partialRows: Array<[string, number, number]> = [];
        for (const key of partialStatKeys) {
          const gameVal = gamePd.combatStats?.[key];
          const simVal = simPd.combatStats?.[key];
          if (gameVal != null && (gameVal !== 0 || simVal !== 0)) {
            if (key === "attackInterval") {
              partialRows.push([`${key} (s)`, gameVal / 1e9, simVal / 1e9]);
            } else {
              partialRows.push([key, gameVal, simVal]);
            }
          }
        }
        if (partialRows.length > 0) {
          printStatComparison(
            "Player Stats — partial (game excludes crate/seal buffs)",
            partialRows
          );
        }

        const playerMismatches = printStatComparison(
          "Player Stats (game vs sim base)",
          playerStatRows
        );

        // -----------------------------------------------------------------
        // C. Monster stat comparison
        // -----------------------------------------------------------------
        if (gameMd) {
          const simMd = sim.monsterCd;
          const monsterStatRows: Array<[string, number, number]> = [];

          if (gameMd.maxHitpoints != null)
            monsterStatRows.push([
              "Max HP",
              gameMd.maxHitpoints,
              simMd.maxHitpoints,
            ]);
          if (gameMd.maxManapoints != null)
            monsterStatRows.push([
              "Max MP",
              gameMd.maxManapoints,
              simMd.maxManapoints,
            ]);
          if (gameMd.totalArmor != null)
            monsterStatRows.push([
              "Armor",
              gameMd.totalArmor,
              simMd.totalArmor,
            ]);
          if (gameMd.totalWaterResistance != null)
            monsterStatRows.push([
              "Water Res",
              gameMd.totalWaterResistance,
              simMd.totalWaterResistance,
            ]);
          if (gameMd.totalFireResistance != null)
            monsterStatRows.push([
              "Fire Res",
              gameMd.totalFireResistance,
              simMd.totalFireResistance,
            ]);
          if (gameMd.totalNatureResistance != null)
            monsterStatRows.push([
              "Nature Res",
              gameMd.totalNatureResistance,
              simMd.totalNatureResistance,
            ]);

          for (const style of [
            "stab",
            "slash",
            "smash",
            "ranged",
            "magic",
          ]) {
            const gameAcc = gameMd[`${style}AccuracyRating`];
            const simAcc = simMd[`${style}AccuracyRating`];
            if (gameAcc != null && gameAcc > 0) {
              monsterStatRows.push([
                `${style} Accuracy`,
                gameAcc,
                simAcc,
              ]);
            }
            const gameEva = gameMd[`${style}EvasionRating`];
            const simEva = simMd[`${style}EvasionRating`];
            if (gameEva != null && gameEva > 0) {
              monsterStatRows.push([
                `${style} Evasion`,
                gameEva,
                simEva,
              ]);
            }
            const gameMaxDmg = gameMd[`${style}MaxDamage`];
            const simMaxDmg = simMd[`${style}MaxDamage`];
            if (gameMaxDmg != null && gameMaxDmg > 0) {
              monsterStatRows.push([
                `${style} MaxDamage`,
                gameMaxDmg,
                simMaxDmg,
              ]);
            }
          }

          // --- Change 2: Use derived attackInterval (top-level), not base (combatStats) ---
          // Game: gameMd.attackInterval is the derived value (after attack-level scaling)
          // Sim: simMd.combatStats.attackInterval is also derived (updateCombatDetails mutates in place)
          const gameMonsterAI = gameMd.attackInterval; // top-level = derived
          const simMonsterAI = simMd.combatStats?.attackInterval;
          if (gameMonsterAI != null && simMonsterAI != null && (gameMonsterAI !== 0 || simMonsterAI !== 0)) {
            monsterStatRows.push([`monster attackInterval (s)`, gameMonsterAI / 1e9, simMonsterAI / 1e9]);
          }

          const monsterCombatKeys = [
            "criticalRate",
            "criticalDamage",
          ];
          for (const key of monsterCombatKeys) {
            const gameVal = gameMd.combatStats?.[key];
            const simVal = simMd.combatStats?.[key];
            if (gameVal != null && (gameVal !== 0 || simVal !== 0)) {
              monsterStatRows.push([`monster ${key}`, gameVal, simVal]);
            }
          }

          printStatComparison("Monster Stats (game vs sim)", monsterStatRows);
        }

        // -----------------------------------------------------------------
        // D. Raw event analysis + sim comparison
        // -----------------------------------------------------------------
        const raw = analyzeRawEvents(fight);
        printRawEventAnalysis(raw, fight.durationSec || 0);

        const durationSec = fight.durationSec || 0;
        const rawPlayerTotal = raw.playerHits + raw.playerMisses;
        const rawMonsterTotal = raw.monsterHits + raw.monsterMisses;
        const rawPlayerHitRate = rawPlayerTotal > 0 ? raw.playerHits / rawPlayerTotal : 0;
        const rawPlayerCritRate = raw.playerHits > 0 ? raw.playerCrits / raw.playerHits : 0;
        const rawMonsterHitRate = rawMonsterTotal > 0 ? raw.monsterHits / rawMonsterTotal : 0;
        const rawPlayerDps = durationSec > 0 ? raw.playerDmg / durationSec : 0;
        const rawMonsterDps = durationSec > 0 ? raw.monsterDmg / durationSec : 0;
        // Compute effective crit rate: ranged adds 0.3 * hitChance to base critRate
        const baseCritRate = sim.playerCd.combatStats?.criticalRate ?? 0;
        const playerCombatStyle = sim.playerCd.combatStats?.combatStyleHrid ?? "";
        const simCritRate = playerCombatStyle.includes("ranged")
          ? 0.3 * sim.playerHitChance + baseCritRate
          : baseCritRate;

        // Detect retaliation — counter-attacks inflate player hit count
        // Game's combatStats may omit retaliation; fall back to sim's post-fight player
        const retaliationRate = gamePd.combatStats?.retaliation ?? sim.fightPlayerRetaliation;
        const hasRetaliation = retaliationRate > 0;
        let adjustedPlayerHitRate = rawPlayerHitRate;
        let estimatedRetaliations = 0;
        if (hasRetaliation && rawMonsterTotal > 0) {
          // Each successful monster hit can trigger a retaliation counter-attack
          const monsterHitsOnPlayer = raw.monsterHits;
          estimatedRetaliations = Math.round(retaliationRate * monsterHitsOnPlayer);
          const adjustedHits = Math.max(0, raw.playerHits - estimatedRetaliations);
          const adjustedTotal = adjustedHits + raw.playerMisses;
          adjustedPlayerHitRate = adjustedTotal > 0 ? adjustedHits / adjustedTotal : 0;
          console.log(`\n  Retaliation detected: rate=${(retaliationRate * 100).toFixed(0)}%, est. ${estimatedRetaliations} counter-attacks from ${monsterHitsOnPlayer} monster hits`);
          console.log(`    Raw player hit rate: ${(rawPlayerHitRate * 100).toFixed(1)}% → Adjusted (excl. retaliation): ${(adjustedPlayerHitRate * 100).toFixed(1)}%`);
        }

        // --- Change 3: Report sim vs game outcome ---
        const gameOutcome = fight.outcome || "unknown";
        const simOutcome = sim.success ? `KILL at ${sim.fightTimeSec.toFixed(1)}s` : `TIMEOUT (${sim.fightTimeSec.toFixed(0)}s)`;
        const gameHpPct = gameMd ? (1 - gameMd.currentHitpoints / gameMd.maxHitpoints) * 100 : null;
        const outcomeMatch = (sim.success && gameOutcome === "kill") || (!sim.success && gameOutcome !== "kill");
        const gameOutcomeStr = gameOutcome === "kill"
          ? `kill`
          : `${gameOutcome}${gameHpPct != null ? ` (${gameHpPct.toFixed(0)}% HP dealt)` : ""}`;
        console.log(`\n  Outcome:  Game=${gameOutcomeStr}  Sim=${simOutcome}${outcomeMatch ? "" : "  ← MISMATCH"}`);

        console.log("\n  Game vs Sim Comparison (using raw events):");
        console.log(
          "    " +
            "Metric".padEnd(28) +
            "Game".padStart(12) +
            "Sim".padStart(12) +
            "Diff".padStart(28)
        );
        console.log("    " + "-".repeat(80));

        const compRows: Array<[string, string, string, string]> = [
          [
            "Duration (s)",
            durationSec.toFixed(1),
            sim.fightTimeSec.toFixed(1),
            durationSec > 0
              ? (((sim.fightTimeSec - durationSec) / durationSec) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            "Player DPS",
            rawPlayerDps.toFixed(1),
            sim.playerDps.toFixed(1),
            rawPlayerDps > 0
              ? (((sim.playerDps - rawPlayerDps) / rawPlayerDps) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            "Monster DPS",
            rawMonsterDps.toFixed(1),
            sim.monsterDps.toFixed(1),
            rawMonsterDps > 0
              ? (((sim.monsterDps - rawMonsterDps) / rawMonsterDps) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            "Total Dmg Dealt",
            String(raw.playerDmg),
            sim.totalDamageDealt.toFixed(0),
            raw.playerDmg > 0
              ? (((sim.totalDamageDealt - raw.playerDmg) / raw.playerDmg) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            "Total Dmg Taken",
            String(raw.monsterDmg),
            sim.totalDamageTaken.toFixed(0),
            raw.monsterDmg > 0
              ? (((sim.totalDamageTaken - raw.monsterDmg) / raw.monsterDmg) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            "Total Healing",
            String(raw.totalHealing),
            sim.totalHealing.toFixed(0),
            raw.totalHealing > 0
              ? (((sim.totalHealing - raw.totalHealing) / raw.totalHealing) * 100).toFixed(1) + "%"
              : "N/A",
          ],
          [
            hasRetaliation ? "Player Hit Rate (adj)" : "Player Hit Rate",
            hasRetaliation
              ? (adjustedPlayerHitRate * 100).toFixed(1) + "%"
              : (rawPlayerHitRate * 100).toFixed(1) + "%",
            (sim.playerHitChance * 100).toFixed(1) + "%",
            // --- Change 6: Include standard error based on sample size ---
            (() => {
              const effectiveRate = hasRetaliation ? adjustedPlayerHitRate : rawPlayerHitRate;
              const n = hasRetaliation ? (rawPlayerTotal - estimatedRetaliations) : rawPlayerTotal;
              const diff = ((sim.playerHitChance - effectiveRate) * 100).toFixed(1);
              if (n > 0) {
                const se = Math.sqrt(effectiveRate * (1 - effectiveRate) / n) * 100;
                return `${diff}pp (±${se.toFixed(1)}pp @ n=${n})`;
              }
              return `${diff}pp`;
            })(),
          ],
          [
            "Monster Hit Rate",
            (rawMonsterHitRate * 100).toFixed(1) + "%",
            (sim.monsterHitChance * 100).toFixed(1) + "%",
            (() => {
              const diff = ((sim.monsterHitChance - rawMonsterHitRate) * 100).toFixed(1);
              if (rawMonsterTotal > 0) {
                const se = Math.sqrt(rawMonsterHitRate * (1 - rawMonsterHitRate) / rawMonsterTotal) * 100;
                return `${diff}pp (±${se.toFixed(1)}pp @ n=${rawMonsterTotal})`;
              }
              return `${diff}pp`;
            })(),
          ],
          [
            playerCombatStyle.includes("ranged") ? "Player Crit Rate (eff)" : "Player Crit Rate",
            (rawPlayerCritRate * 100).toFixed(1) + "%" + ` (${raw.playerCrits}/${raw.playerHits})`,
            (simCritRate * 100).toFixed(1) + "%" + (playerCombatStyle.includes("ranged") ? ` (base ${(baseCritRate * 100).toFixed(1)}%)` : ""),
            ((simCritRate - rawPlayerCritRate) * 100).toFixed(1) + "pp",
          ],
        ];

        for (const [name, gameStr, simStr, diffStr] of compRows) {
          console.log(
            "    " +
              name.padEnd(28) +
              gameStr.padStart(12) +
              simStr.padStart(12) +
              diffStr.padStart(28)
          );
        }

        // -----------------------------------------------------------------
        // E. Per-ability breakdown from raw events
        // -----------------------------------------------------------------
        const abilityBreakdown: Record<string, { casts: number; totalDamage: number; crits: number }> = {};
        for (const e of (fight.events || [])) {
          if (e.type === "playerAbility" && e.abilityHrid) {
            if (!abilityBreakdown[e.abilityHrid]) {
              abilityBreakdown[e.abilityHrid] = { casts: 0, totalDamage: 0, crits: 0 };
            }
            const ab = abilityBreakdown[e.abilityHrid];
            ab.casts++;
            ab.totalDamage += e.damage;
            if (e.isCrit) ab.crits++;
          }
        }

        if (Object.keys(abilityBreakdown).length > 0) {
          console.log("\n  Ability Breakdown (from raw events):");
          console.log(
            "    " +
              "Ability".padEnd(30) +
              "Casts".padStart(6) +
              "Damage".padStart(8) +
              "Crits".padStart(6) +
              "Avg/Hit".padStart(8)
          );
          console.log("    " + "-".repeat(58));
          for (const [hrid, d] of Object.entries(abilityBreakdown)) {
            const name = hrid.split("/").pop() || hrid;
            const avgPerHit = d.casts > 0 ? d.totalDamage / d.casts : 0;
            console.log(
              "    " +
                name.padEnd(30) +
                String(d.casts).padStart(6) +
                String(d.totalDamage).padStart(8) +
                String(d.crits).padStart(6) +
                avgPerHit.toFixed(0).padStart(8)
            );
          }
        }

        // Also show logger summary comparison if available
        const gameSummary = fight.summaries?.[0];
        if (gameSummary) {
          const summaryHits = gameSummary.hits;
          const summaryMisses = gameSummary.misses;
          const summaryCrits = gameSummary.crits;
          if (summaryHits !== raw.playerHits || summaryMisses !== raw.playerMisses || summaryCrits !== raw.playerCrits) {
            console.log("\n  Logger Summary vs Raw Events (sanity check):");
            console.log(`    Summary: ${summaryHits} hits, ${summaryMisses} misses, ${summaryCrits} crits, ${gameSummary.totalDamageDealt} dmg`);
            console.log(`    Raw:     ${raw.playerHits} hits, ${raw.playerMisses} misses, ${raw.playerCrits} crits, ${raw.playerDmg} dmg`);
            if (summaryHits !== raw.playerHits) {
              console.log(`    WARNING: summary undercounts hits (${summaryHits} vs ${raw.playerHits})`);
            }
          }
        }

        // Result indicator
        if (playerMismatches === 0) {
          console.log(
            "\n  All player stats match within 1%."
          );
        } else {
          console.log(
            `\n  WARNING: ${playerMismatches} player stat mismatch(es) detected.`
          );
        }
      } else {
        // No monster hrid or level — show raw event analysis without sim comparison
        const raw = analyzeRawEvents(fight);
        printRawEventAnalysis(raw, fight.durationSec || 0);
      }

      // -----------------------------------------------------------------
      // I. Event log summary
      // -----------------------------------------------------------------
      if (fight.events && fight.events.length > 0) {
        const eventTypes: Record<string, number> = {};
        for (const e of fight.events) {
          eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
        }
        console.log(`\n  Event log: ${fight.events.length} events`);
        for (const [type, count] of Object.entries(eventTypes).sort(
          (a, b) => b[1] - a[1]
        )) {
          console.log(`    ${type}: ${count}`);
        }
      }
    }

    expect(combatLog.fights.length).toBeGreaterThan(0);
  });

  it("should display summary table across all fights", { timeout: 30_000 }, () => {
    if (!combatLogExists()) {
      console.log("No combat log — skipping summary table");
      return;
    }

    const combatLog = JSON.parse(readFileSync(COMBAT_LOG_PATH, "utf-8"));
    if (combatLog.fights.length === 0) {
      console.log("No fights in log");
      return;
    }

    console.log("\n=== Fight Summary Table ===");
    console.log(
      "  " +
        "#".padStart(3) +
        "Monster".padEnd(20) +
        "Mode".padEnd(12) +
        "Outcome".padEnd(8) +
        "Dur(s)".padStart(8) +
        "pDPS".padStart(8) +
        "mDPS".padStart(8) +
        "Hit%".padStart(7) +
        "Crt%".padStart(7) +
        "Events".padStart(7)
    );
    console.log("  " + "-".repeat(88));

    combatLog.fights.forEach((fight: any, i: number) => {
      const name = (
        fight.monsterStats?.[0]?.name ||
        (fight.monsterStats?.[0]?.hrid || "?").split("/").pop() ||
        "?"
      ).slice(0, 18);
      const dur = fight.durationSec || 0;
      const events = fight.events?.length || 0;

      // Use raw event analysis for reliable stats
      const raw = analyzeRawEvents(fight);
      const rawPlayerTotal = raw.playerHits + raw.playerMisses;
      const pDPS = dur > 0 ? (raw.playerDmg / dur).toFixed(0) : "?";
      const mDPS = dur > 0 ? (raw.monsterDmg / dur).toFixed(0) : "?";
      const hitPct = rawPlayerTotal > 0
        ? ((raw.playerHits / rawPlayerTotal) * 100).toFixed(0) + "%"
        : "?";
      const crtPct = raw.playerHits > 0
        ? ((raw.playerCrits / raw.playerHits) * 100).toFixed(0) + "%"
        : "?";

      console.log(
        "  " +
          String(i + 1).padStart(3) +
          name.padEnd(20) +
          (fight.combatMode || "?").padEnd(12) +
          (fight.outcome || "?").padEnd(8) +
          dur.toFixed(1).padStart(8) +
          pDPS.padStart(8) +
          mDPS.padStart(8) +
          hitPct.padStart(7) +
          crtPct.padStart(7) +
          String(events).padStart(7)
      );
    });

    expect(true).toBe(true);
  });
});
