/* Test fixtures intentionally model partial game DTOs. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import CombatUtilities from "./src/engine/combatUtilities";
import Zone from "./src/engine/zone";
import DeterministicSimulator from "./src/engine/deterministicSimulator";
import CombatUnit from "./src/engine/combatUnit";
import Monster from "./src/engine/monster";
import Ability from "./src/engine/ability";
import Equipment from "./src/engine/equipment";
import Trigger from "./src/engine/trigger";

describe("deterministic parity regressions", () => {
  it("scales a probabilistic heal before mutating target HP", () => {
    const target = {
      combatDetails: { currentHitpoints: 10, maxHitpoints: 100 },
      addHitpoints(amount: number) {
        const added = Math.min(amount, this.combatDetails.maxHitpoints - this.combatDetails.currentHitpoints);
        this.combatDetails.currentHitpoints += added;
        return added;
      },
    };
    const source = {
      combatDetails: { combatStats: { healingAmplify: 0 }, magicMaxDamage: 20 },
    };
    const effect = { combatStyleHrid: "/combat_styles/magic", damageFlat: 0, damageRatio: 1 };

    // The unscaled deterministic heal is (1 + 20) / 2 = 10.5.
    const healed = CombatUtilities.processHeal(source as never, effect as never, target as never, 0.25);
    expect(healed).toBe(2.625);
    expect(target.combatDetails.currentHitpoints).toBe(12.625);
  });

  it("defaults focus training when current item data omits it", () => {
    const gameData = JSON.parse(
      readFileSync("public/init_client_data.json", "utf8")
    );
    // This current combat item has combat stats but no focusTraining field.
    const itemHrid = "/items/acrobatic_hood";
    expect(gameData.itemDetailMap[itemHrid].equipmentDetail.combatStats)
      .not.toHaveProperty("focusTraining");

    const item = new Equipment(gameData as never, itemHrid, 0);
    expect(item.getFocusTraining()).toBe("");
  });

  it("excludes dead units from aggregate HP and MP trigger conditions", () => {
    const trigger = new Trigger(
      { combatTriggerDependencyDetailMap: {
        "/combat_trigger_dependencies/all_allies": { isSingleTarget: false },
      } } as never,
      "/combat_trigger_dependencies/all_allies",
      "/combat_trigger_conditions/current_mp",
      "/combat_trigger_comparators/greater_than_equal",
      100,
    );
    const alive = { combatDetails: { currentHitpoints: 100, currentManapoints: 50, maxHitpoints: 100 } };
    const dead = { combatDetails: { currentHitpoints: 0, currentManapoints: 500, maxHitpoints: 100 } };
    expect(trigger.isActive(alive as never, null, [alive, dead] as never, null, 0)).toBe(false);

    const lowestHp = new Trigger(
      { combatTriggerDependencyDetailMap: {
        "/combat_trigger_dependencies/all_allies": { isSingleTarget: false },
      } } as never,
      "/combat_trigger_dependencies/all_allies",
      "/combat_trigger_conditions/lowest_hp_percentage",
      "/combat_trigger_comparators/greater_than_equal",
      100,
    );
    expect(lowestHp.isActive(alive as never, null, [alive, dead] as never, null, 0)).toBe(true);
  });

  it("multiplies flat HP and MP bonuses by their maximum-resource ratios", () => {
    const unit = new CombatUnit();
    unit.staminaLevel = 50;
    unit.intelligenceLevel = 40;
    unit.combatDetails.combatStats.maxHitpoints = 100;
    unit.combatDetails.combatStats.maxHitpointsRatio = 0.1;
    unit.combatDetails.combatStats.maxManapoints = 50;
    unit.combatDetails.combatStats.maxManapointsRatio = 0.2;
    unit.updateCombatDetails();

    expect(unit.combatDetails.maxHitpoints).toBe(770);
    expect(unit.combatDetails.maxManapoints).toBe(660);
  });

  it("keeps permanent buffs while expiration and dungeon-wipe reset clear temporary buffs", () => {
    const unit = new CombatUnit();
    unit.isPlayer = true;
    const ability = { lastUsed: 123 };
    unit.abilities = [ability as never, null, null, null];
    const permanentBuff = {
      uniqueHrid: "/buffs/permanent", typeHrid: "/buff_types/damage",
      flatBoost: 0, ratioBoost: 0.1, startTime: 1, duration: 0,
    };
    const activeBuff = {
      uniqueHrid: "/buffs/active", typeHrid: "/buff_types/damage",
      flatBoost: 0, ratioBoost: 0.1, startTime: 1, duration: 100,
    };
    const expiredBuff = {
      uniqueHrid: "/buffs/expired", typeHrid: "/buff_types/armor",
      flatBoost: 1, ratioBoost: 0, startTime: 1, duration: 2,
    };
    unit.combatBuffs = {
      [permanentBuff.uniqueHrid]: permanentBuff,
      [activeBuff.uniqueHrid]: activeBuff,
      [expiredBuff.uniqueHrid]: expiredBuff,
    } as never;

    unit.removeExpiredBuffs(10);
    expect(unit.combatBuffs[permanentBuff.uniqueHrid]).toBe(permanentBuff);
    expect(unit.combatBuffs[activeBuff.uniqueHrid]).toBe(activeBuff);
    expect(unit.combatBuffs[expiredBuff.uniqueHrid]).toBeUndefined();

    unit.combatBuffs[expiredBuff.uniqueHrid] = expiredBuff as never;
    unit.reset(10);
    expect(unit.combatBuffs[permanentBuff.uniqueHrid]).toBe(permanentBuff);
    expect(unit.combatBuffs[activeBuff.uniqueHrid]).toBe(activeBuff);
    expect(unit.combatBuffs[expiredBuff.uniqueHrid]).toBeUndefined();
    expect(ability.lastUsed).toBe(123);
  });

  it("models Mayhem as one proc followed by miss retries", () => {
    // 50% Mayhem, 50% hit, three targets: 1 + .5(.5 + .5²) = 1.375.
    expect(CombatUtilities.expectedMayhemTargets(0.5, 3, 0.5)).toBeCloseTo(1.375);
  });

  it("uses each Mayhem retry target's hit chance rather than the first target's", () => {
    const stats = { combatStyleHrid: "/combat_styles/stab", damageType: "/damage_types/physical", criticalRate: 0, criticalDamage: 0, physicalAmplify: 0, armorPenetration: 0, taskDamage: 0, damageTaken: 0, autoAttackDamage: 0, abilityDamage: 0, mayhem: 0, pierce: 0, lifeSteal: 0, manaLeech: 0, curse: 0, weaken: 0, fury: 0, parry: 0, retaliation: 0, physicalThorns: 0, elementalThorns: 0 };
    const unit = (isPlayer: boolean, evasion: number) => ({
      isPlayer,
      hrid: isPlayer ? "/players/p" : `/monsters/${evasion}`,
      combatDetails: { currentHitpoints: 1000, maxHitpoints: 1000, stabAccuracyRating: 1, stabMaxDamage: 20, stabEvasionRating: evasion, slashAccuracyRating: 1, slashMaxDamage: 20, slashEvasionRating: 1, smashAccuracyRating: 1, smashMaxDamage: 20, smashEvasionRating: 1, rangedAccuracyRating: 1, rangedMaxDamage: 20, rangedEvasionRating: 1, magicAccuracyRating: 1, magicMaxDamage: 20, magicEvasionRating: 1, totalArmor: 0, totalWaterResistance: 0, totalNatureResistance: 0, totalFireResistance: 0, defensiveMaxDamage: 1, combatStats: { ...stats } },
      addHitpoints: () => 0,
      addManapoints: () => 0,
    });
    const source = unit(true, 1);
    source.combatDetails.combatStats.mayhem = 0.5;
    const first = unit(false, 1);
    const retry = unit(false, 100);
    const retryResult = CombatUtilities.processAttack(source as never, retry as never);
    const simulator = Object.create(DeterministicSimulator.prototype) as any;
    simulator.enemies = [first, retry]; simulator.players = [source]; simulator.encounterPreClampDamage = 0; simulator.encounterPostClampDamage = 0;
    simulator.eventQueue = { clearEventsForUnit() {} }; simulator.simResult = { addDamageDealt() {}, addDamageTaken() {}, addPreClampDamageDealt() {} };
    simulator.checkEncounterEnd = () => true; simulator.applyCurse = () => {}; simulator.applyWeaken = () => {}; simulator.applyFury = () => {};
    (simulator as any).processAutoAttackEvent({ source });
    // Retry is reached on Mayhem × first miss = .5 × .5.
    expect(retry.combatDetails.currentHitpoints).toBeCloseTo(1000 - retryResult.damageDone * 0.25);
  });

  it("uses each auto-pierce target's hit chance rather than double-counting the first", () => {
    const stats = { combatStyleHrid: "/combat_styles/stab", damageType: "/damage_types/physical", criticalRate: 0, criticalDamage: 0, physicalAmplify: 0, armorPenetration: 0, taskDamage: 0, damageTaken: 0, autoAttackDamage: 0, abilityDamage: 0, mayhem: 0, pierce: 0, lifeSteal: 0, manaLeech: 0, curse: 0, weaken: 0, fury: 0, parry: 0, retaliation: 0, physicalThorns: 0, elementalThorns: 0 };
    const unit = (isPlayer: boolean, evasion: number) => ({
      isPlayer, hrid: isPlayer ? "/players/p" : `/monsters/${evasion}`,
      combatDetails: { currentHitpoints: 1000, maxHitpoints: 1000, stabAccuracyRating: 1, stabMaxDamage: 20, stabEvasionRating: evasion, slashAccuracyRating: 1, slashMaxDamage: 20, slashEvasionRating: 1, smashAccuracyRating: 1, smashMaxDamage: 20, smashEvasionRating: 1, rangedAccuracyRating: 1, rangedMaxDamage: 20, rangedEvasionRating: 1, magicAccuracyRating: 1, magicMaxDamage: 20, magicEvasionRating: 1, totalArmor: 0, totalWaterResistance: 0, totalNatureResistance: 0, totalFireResistance: 0, defensiveMaxDamage: 1, combatStats: { ...stats } },
      addHitpoints: () => 0, addManapoints: () => 0,
    });
    const source = unit(true, 1);
    source.combatDetails.combatStats.pierce = 0.5;
    const first = unit(false, 1);
    const chained = unit(false, 100);
    const chainedResult = CombatUtilities.processAttack(source as never, chained as never);
    const simulator = Object.create(DeterministicSimulator.prototype) as any;
    simulator.enemies = [first, chained]; simulator.players = [source]; simulator.encounterPreClampDamage = 0; simulator.encounterPostClampDamage = 0;
    simulator.eventQueue = { clearEventsForUnit() {} }; simulator.simResult = { addDamageDealt() {}, addDamageTaken() {}, addPreClampDamageDealt() {} };
    simulator.checkEncounterEnd = () => true; simulator.applyCurse = () => {}; simulator.applyWeaken = () => {}; simulator.applyFury = () => {};
    simulator.processAutoAttackEvent({ source });

    // Reach chained target = first hit (.5) × pierce (.5); its own result already includes its hit chance.
    expect(chained.combatDetails.currentHitpoints).toBeCloseTo(1000 - chainedResult.damageDone * 0.25);
  });

  it("does not let tenacity reduce curse applied by an ability hit", () => {
    const source = { combatDetails: { stabAccuracyRating: 1, stabMaxDamage: 10, totalArmor: 0, combatStats: { criticalRate: 0, criticalDamage: 0, physicalAmplify: 0, armorPenetration: 0, taskDamage: 0, abilityDamage: 0, curse: 10 } } };
    const target = { combatDetails: { stabEvasionRating: 1, totalArmor: 0, combatStats: { damageTaken: 0, tenacity: 10_000 } } };
    const effect = { combatStyleHrid: "/combat_styles/stab", damageType: "/damage_types/physical", bonusAccuracyRatio: 0, damageFlat: 0, damageRatio: 1, armorDamageRatio: 0, hpDrainRatio: 0, stunChance: 0, stunDuration: 0, blindChance: 0, blindDuration: 0, silenceChance: 0, silenceDuration: 0, damageOverTimeRatio: 0, damageOverTimeDuration: 0 };
    expect(CombatUtilities.processAttack(source as never, target as never, effect as never).expectedCurseApplied).toBe(5);
  });

  it("evaluates triggers at a new encounter boundary before attacks", () => {
    const simulator = Object.create(DeterministicSimulator.prototype) as any;
    const calls: string[] = [];
    simulator.allPlayersDead = false; simulator.zone = { isDungeon: false }; simulator.players = [];
    simulator.simulationTime = 1; simulator.encounterPreClampDamage = 0; simulator.encounterPostClampDamage = 0;
    simulator.monsterTargetCounters = new Map(); simulator.spawnEncounterFromDistribution = () => [];
    simulator.eventQueue = { clearEventsOfType() {}, addEvent() {} };
    simulator.checkTriggers = () => calls.push("triggers"); simulator.startAttacks = () => calls.push("attacks");
    simulator.startNewEncounter();
    expect(calls).toEqual(["triggers", "attacks"]);
  });

  it("uses threat weights rather than treating a unique maximum as a taunt", () => {
    const simulator = Object.create(DeterministicSimulator.prototype) as unknown as {
      monsterTargetCounters: Map<object, number>;
      selectMonsterTarget(source: object, targets: object[]): object;
    };
    simulator.monsterTargetCounters = new Map();
    const source = {};
    const low = { combatDetails: { combatStats: { threat: 100 } } };
    const high = { combatDetails: { combatStats: { threat: 101 } } };
    let highSelections = 0;
    for (let i = 0; i < 1_000; i++) {
      if (simulator.selectMonsterTarget(source, [low, high]) === high) highSelections++;
    }
    // A 101:100 split must be close to 50:50, never the old 100% selection.
    expect(highSelections).toBeGreaterThan(450);
    expect(highSelections).toBeLessThan(550);
  });

  it("applies the dungeon key tier to fixed dungeon-wave mobs", () => {
    const gameData = {
      actionDetailMap: {
        "/actions/test": {
          combatZoneInfo: {
            isDungeon: true,
            fightInfo: { randomSpawnInfo: { maxSpawnCount: 1, maxTotalStrength: 10, spawns: [] }, bossSpawns: null },
            dungeonInfo: {
              maxWaves: 1,
              fixedSpawnsMap: { "1": [{ combatMonsterHrid: "/monsters/a", difficultyTier: 2 }] },
              randomSpawnInfoMap: {},
            },
          },
          buffs: null,
        },
      },
    };
    const zone = new Zone("/actions/test", 3, gameData as never);
    expect(zone.getNextWave()).toEqual([
      { monsters: [{ hrid: "/monsters/a", difficultyTier: 5 }], probability: 1 },
    ]);
  });

  it("validates every current normal-zone and dungeon-wave spawn configuration", () => {
    const gameData = JSON.parse(
      readFileSync("public/init_client_data.json", "utf8")
    ) as Record<string, any>;
    const zones = Object.entries(gameData.actionDetailMap)
      .filter(([, action]: [string, any]) => action.combatZoneInfo);

    for (const [hrid, action] of zones as [string, any][]) {
      const zone = new Zone(hrid, 0, gameData);
      if (!action.combatZoneInfo.isDungeon) {
        const spawnInfo = action.combatZoneInfo.fightInfo.randomSpawnInfo;
        expect(spawnInfo.spawns.length, hrid).toBeGreaterThan(0);
        expect(spawnInfo.maxSpawnCount, hrid).toBeGreaterThan(0);
        expect(spawnInfo.maxTotalStrength, hrid).toBeGreaterThan(0);
        expect(spawnInfo.spawns.reduce((sum: number, spawn: any) => sum + spawn.rate, 0), hrid).toBeGreaterThan(0);
        continue;
      }

      const dungeon = action.combatZoneInfo.dungeonInfo;
      for (let wave = 1; wave <= dungeon.maxWaves; wave++) {
        const fixed = dungeon.fixedSpawnsMap[String(wave)];
        const random = (zone as any).getRandomSpawnInfoForWave(wave);
        // A fixed wave takes precedence; every other wave must resolve to one
        // of the configured random-spawn ranges.
        expect(Boolean(fixed) || Boolean(random), `${hrid} wave ${wave}`).toBe(true);
        if (random) {
          expect(random.spawns.length, `${hrid} wave ${wave}`).toBeGreaterThan(0);
          expect(random.spawns.reduce((sum: number, spawn: any) => sum + spawn.rate, 0), `${hrid} wave ${wave}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("scales weaken stacks for a probabilistic damage proc", () => {
    const simulator = Object.create(DeterministicSimulator.prototype) as {
      simulationTime: number;
      eventQueue: {
        getMatching: () => null;
        clearMatching: () => void;
        addEvent: (event: { weakenAmount: number }) => void;
      };
      applyWeaken: (
        source: CombatUnit,
        target: CombatUnit,
        attackResult: { expectedWeakenApplied: number },
        applicationScale: number
      ) => void;
    };
    const events: { weakenAmount: number }[] = [];
    simulator.simulationTime = 0;
    simulator.eventQueue = {
      getMatching: () => null,
      clearMatching: () => {},
      addEvent: (event) => events.push(event),
    };
    const source = { addBuff: () => {} } as unknown as CombatUnit;
    const target = {
      combatDetails: { combatStats: { weaken: 0.2 } },
    } as unknown as CombatUnit;

    simulator.applyWeaken(source, target, { expectedWeakenApplied: 0.2 }, 0.25);
    expect(events).toHaveLength(1);
    expect(events[0].weakenAmount).toBeCloseTo(0.25);
  });

  it("defaults missing monster combat stats to 0 including taskDamage", () => {
    // Test that MONSTER_COMBAT_STAT_KEYS matches authority: includes taskDamage,
    // excludes maxHitpointsRatio and maxManapointsRatio (which are ratio multipliers, not additive stats)
    const gameData = {
      combatMonsterDetailMap: {
        "/monsters/test": {
          enrageTime: 0,
          abilities: [],
          dropTable: [],
          rareDropTable: [],
          experience: 10,
          combatDetails: {
            staminaLevel: 10,
            intelligenceLevel: 10,
            attackLevel: 10,
            meleeLevel: 10,
            defenseLevel: 10,
            rangedLevel: 10,
            magicLevel: 10,
            attackInterval: 3000000000,
            combatStats: {
              combatStyleHrids: ["/combat_styles/stab"],
              // Only provide a few stats, rest should be defaulted to 0
              stabAccuracy: 100,
              stabDamage: 50,
              // taskDamage is intentionally missing to test it gets defaulted
              // maxHitpointsRatio and maxManapointsRatio should NOT be in the default list
            },
          },
        },
      },
    };

    const monster = new Monster("/monsters/test", gameData as never, 0, { Ability });
    monster.updateCombatDetails();

    // taskDamage should be defaulted to 0 by the monster stat loop
    expect(monster.combatDetails.combatStats.taskDamage).toBe(0);
    // Other stats should also be defaulted
    expect(monster.combatDetails.combatStats.mayhem).toBe(0);
    expect(monster.combatDetails.combatStats.pierce).toBe(0);
    // maxHitpointsRatio and maxManapointsRatio are initialized to 0 by base CombatUnit,
    // but should NOT be in MONSTER_COMBAT_STAT_KEYS (authority excludes them)
    expect(monster.combatDetails.combatStats.maxHitpointsRatio).toBe(0);
    expect(monster.combatDetails.combatStats.maxManapointsRatio).toBe(0);
  });
});
