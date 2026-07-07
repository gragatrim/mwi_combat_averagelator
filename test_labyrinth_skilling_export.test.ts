import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type { GameData } from "./src/engine/types";
import { getBaseSkillLevels, parseLabyrinthSkip } from "./src/features/labyrinthAnalyzer/skillBuffs";
import { computeAllSkillThresholds } from "./src/features/labyrinthAnalyzer/thresholds";

const gameData: GameData = JSON.parse(
  readFileSync("public/init_client_data.json", "utf-8")
);

const fullCharData = JSON.parse(
  readFileSync("live_data/gragatrim_full_char_data.json", "utf-8")
);

function skillThresholds(charData: Record<string, unknown>) {
  const baseLevels = getBaseSkillLevels(charData);
  const { skillRooms } = parseLabyrinthSkip(charData);
  return computeAllSkillThresholds(charData, gameData, baseLevels, skillRooms);
}

describe("Labyrinth skilling room exports", () => {
  it("uses skilling loadouts when sanitized exports omit nested loadout ids", () => {
    const rawResults = skillThresholds(fullCharData);

    const sanitized = JSON.parse(JSON.stringify(fullCharData));
    const loadoutMap = sanitized.characterLoadoutMap as Record<string, Record<string, unknown>>;
    for (const loadout of Object.values(loadoutMap)) {
      delete loadout.id;
    }

    const sanitizedResults = skillThresholds(sanitized);

    expect(sanitizedResults.map((s) => [s.name, s.maxClearable])).toEqual(
      rawResults.map((s) => [s.name, s.maxClearable])
    );
    expect(sanitizedResults.find((s) => s.name === "Milking")?.buffs.actionSpeed)
      .toBeGreaterThan(1);
  });
});
