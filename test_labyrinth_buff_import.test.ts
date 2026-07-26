import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import type { GameData } from "./src/engine/types";
import { parseFullCharacterData } from "./src/data/fullCharacterData";
import { buildLabyrinthUpgradeBuffs } from "./src/features/labyrinthSimulator";
import Player from "./src/engine/player";
import Equipment from "./src/engine/equipment";
import Consumable from "./src/engine/consumable";
import Ability from "./src/engine/ability";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

function createPlayer(config: ReturnType<typeof parseFullCharacterData>["combatLoadouts"][number]["config"]): Player {
  return Player.createFromDTO(config, gameData, {
    Equipment: {
      createFromDTO: (dto) => Equipment.createFromDTO(gameData, dto),
    },
    Consumable: {
      createFromDTO: (dto) => Consumable.createFromDTO(gameData, dto),
    },
    Ability: {
      createFromDTO: (dto) => Ability.createFromDTO(gameData, dto),
    },
  });
}

describe("labyrinth buff import", () => {
  it("uses owned crates and flags missing upgrades in privacy-filtered exports", () => {
    const parsed = parseFullCharacterData(
      readFileSync("live_data/gragatrim.json", "utf-8"),
      gameData
    );

    expect(parsed.labyrinthCrates.coffeeCrate).toBe("/items/expert_coffee_crate");
    expect(parsed.labyrinthCrates.foodCrate).toBe("/items/expert_food_crate");
    expect(parsed.labyrinthCrates.teaCrate).toBe("/items/expert_tea_crate");
    expect(parsed.hasLabyrinthUpgradeData).toBe(false);
    expect(parsed.labyrinthUpgrades.combatDamage).toBe(0);
  });

  it("imports upgrade levels when characterInfo is present", () => {
    const parsed = parseFullCharacterData(
      readFileSync("live_data/gragatrim_full_char_data.json", "utf-8"),
      gameData
    );

    expect(parsed.hasLabyrinthUpgradeData).toBe(true);
    expect(parsed.labyrinthUpgrades.combatDamage).toBe(12);
    expect(parsed.labyrinthUpgrades.attackSpeed).toBe(12);
    expect(parsed.labyrinthUpgrades.experience).toBe(4);
  });

  it("does not apply combat-only house buffs inside labyrinth", () => {
    const parsed = parseFullCharacterData(
      readFileSync("live_data/gragatrim.json", "utf-8"),
      gameData
    );
    const config = parsed.combatLoadouts.find((loadout) => loadout.name === "cyclops")!.config;

    const combatPlayer = createPlayer(config);
    combatPlayer.generatePermanentBuffs();
    expect(combatPlayer.permanentBuffs["/buff_types/attack_level"]?.flatBoost).toBe(8);
    expect(combatPlayer.permanentBuffs["/buff_types/attack_speed"]?.ratioBoost).toBeCloseTo(0.04);

    const labPlayer = createPlayer(config);
    labPlayer.actionTypeHrid = "/action_types/labyrinth";
    labPlayer.generatePermanentBuffs();
    expect(labPlayer.permanentBuffs["/buff_types/attack_level"]).toBeUndefined();
    expect(labPlayer.permanentBuffs["/buff_types/attack_speed"]).toBeUndefined();
    // Global house wisdom is present in the export's labyrinth action buff map.
    expect(labPlayer.permanentBuffs["/buff_types/wisdom"]?.flatBoost).toBeCloseTo(0.0595);
  });

  it("builds manually supplied labyrinth combat upgrades", () => {
    const buffs = buildLabyrinthUpgradeBuffs({
      combatDamage: 12,
      attackSpeed: 11,
      castSpeed: 10,
      criticalRate: 9,
      experience: 4,
    });

    expect(buffs.find((buff) => buff.typeHrid === "/buff_types/damage")?.ratioBoost).toBeCloseTo(0.12);
    expect(buffs.find((buff) => buff.typeHrid === "/buff_types/attack_speed")?.ratioBoost).toBeCloseTo(0.11);
    expect(buffs.find((buff) => buff.typeHrid === "/buff_types/cast_speed")?.flatBoost).toBeCloseTo(0.10);
    expect(buffs.find((buff) => buff.typeHrid === "/buff_types/critical_rate")?.flatBoost).toBeCloseTo(0.09);

    const parsed = parseFullCharacterData(
      readFileSync("live_data/gragatrim.json", "utf-8"),
      gameData
    );
    const config = parsed.combatLoadouts.find((loadout) => loadout.name === "cyclops")!.config;
    const baseline = createPlayer(config);
    baseline.actionTypeHrid = "/action_types/labyrinth";
    baseline.generatePermanentBuffs();
    baseline.clearBuffs();

    const upgraded = createPlayer(config);
    upgraded.actionTypeHrid = "/action_types/labyrinth";
    upgraded.extraBuffs = buffs;
    upgraded.generatePermanentBuffs();
    upgraded.clearBuffs();

    expect(
      upgraded.combatDetails.combatStats.combatExperience -
        baseline.combatDetails.combatStats.combatExperience
    ).toBeCloseTo(0.04);
  });
});
