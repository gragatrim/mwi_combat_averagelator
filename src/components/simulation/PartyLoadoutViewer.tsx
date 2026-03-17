// =============================================================================
// PartyLoadoutViewer - Collapsible panel showing each party member's loadout
// =============================================================================

import { useState } from "react";
import type { PlayerConfig, GameData, TriggerData } from "../../engine/types";
import { EQUIPMENT_SLOTS } from "../../engine/constants";
import { hridToName } from "../../utils/formatting";

interface PartyLoadoutViewerProps {
  playerConfigs: PlayerConfig[];
  gameData: GameData;
}

/** Format a trigger array into a compact readable string. */
function formatTriggers(triggers: TriggerData[], gameData: GameData): string {
  if (!triggers || triggers.length === 0) return "";
  return triggers
    .map((t) => {
      const dep =
        gameData.combatTriggerDependencyDetailMap[t.dependencyHrid]?.name ??
        hridToName(t.dependencyHrid);
      const cond =
        gameData.combatTriggerConditionDetailMap[t.conditionHrid]?.name ??
        hridToName(t.conditionHrid);
      const comp =
        gameData.combatTriggerComparatorDetailMap[t.comparatorHrid]?.name ??
        hridToName(t.comparatorHrid);
      const allowValue =
        gameData.combatTriggerComparatorDetailMap[t.comparatorHrid]?.allowValue ??
        false;
      const valuePart = allowValue ? ` ${t.value}` : "";
      return `${dep}: ${cond} ${comp}${valuePart}`;
    })
    .join(" AND ");
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function PlayerCard({
  config,
  gameData,
  defaultOpen,
}: {
  config: PlayerConfig;
  gameData: GameData;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const equippedSlots = EQUIPMENT_SLOTS.filter(
    (slot) => config.equipment[slot]?.hrid
  );
  const foods = config.food.filter((f): f is NonNullable<typeof f> => f !== null && !!f.hrid);
  const drinks = config.drinks.filter((d): d is NonNullable<typeof d> => d !== null && !!d.hrid);
  const abilities = config.abilities.filter(
    (a): a is NonNullable<typeof a> => a !== null && !!a.hrid
  );

  return (
    <div className="bg-gray-800/50 rounded border border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-gray-700/30 transition-colors"
      >
        <ChevronIcon open={open} />
        <span className="text-sm font-medium text-gray-200">
          {hridToName(config.hrid)}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Equipment */}
          {equippedSlots.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Equipment
              </div>
              <div className="grid grid-cols-2 gap-1">
                {equippedSlots.map((slot) => {
                  const eq = config.equipment[slot]!;
                  const itemName =
                    gameData.itemDetailMap[eq.hrid]?.name ?? hridToName(eq.hrid);
                  const slotName =
                    gameData.equipmentTypeDetailMap[slot]?.name ?? hridToName(slot);
                  return (
                    <div
                      key={slot}
                      className="bg-gray-900/60 rounded px-2 py-1 text-[11px]"
                    >
                      <span className="text-gray-500">{slotName}: </span>
                      <span className="text-gray-300">{itemName}</span>
                      {eq.enhancementLevel > 0 && (
                        <span className="text-blue-400"> +{eq.enhancementLevel}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Food */}
          {foods.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Food
              </div>
              <div className="space-y-1">
                {foods.map((food, i) => {
                  const name =
                    gameData.itemDetailMap[food.hrid]?.name ?? hridToName(food.hrid);
                  const trigStr = formatTriggers(food.triggers, gameData);
                  return (
                    <div key={i} className="bg-gray-900/60 rounded px-2 py-1 text-[11px]">
                      <span className="text-gray-300">{name}</span>
                      {trigStr && (
                        <span className="text-gray-500 ml-1">({trigStr})</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Drinks */}
          {drinks.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Drinks
              </div>
              <div className="space-y-1">
                {drinks.map((drink, i) => {
                  const name =
                    gameData.itemDetailMap[drink.hrid]?.name ?? hridToName(drink.hrid);
                  const trigStr = formatTriggers(drink.triggers, gameData);
                  return (
                    <div key={i} className="bg-gray-900/60 rounded px-2 py-1 text-[11px]">
                      <span className="text-gray-300">{name}</span>
                      {trigStr && (
                        <span className="text-gray-500 ml-1">({trigStr})</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Abilities */}
          {abilities.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Abilities
              </div>
              <div className="space-y-1">
                {abilities.map((ab, i) => {
                  const name =
                    gameData.abilityDetailMap[ab.hrid]?.name ?? hridToName(ab.hrid);
                  const trigStr = formatTriggers(ab.triggers, gameData);
                  return (
                    <div key={i} className="bg-gray-900/60 rounded px-2 py-1 text-[11px]">
                      <span className="text-gray-300">
                        {name} <span className="text-gray-500">Lv{ab.level}</span>
                      </span>
                      {trigStr && (
                        <span className="text-gray-500 ml-1">({trigStr})</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Special Ability */}
          {config.specialAbility && config.specialAbility.hrid && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Special Ability
              </div>
              <div className="bg-gray-900/60 rounded px-2 py-1 text-[11px]">
                <span className="text-gray-300">
                  {gameData.abilityDetailMap[config.specialAbility.hrid]?.name ??
                    hridToName(config.specialAbility.hrid)}{" "}
                  <span className="text-gray-500">
                    Lv{config.specialAbility.level}
                  </span>
                </span>
                {config.specialAbility.triggers.length > 0 && (
                  <span className="text-gray-500 ml-1">
                    ({formatTriggers(config.specialAbility.triggers, gameData)})
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PartyLoadoutViewer({
  playerConfigs,
  gameData,
}: PartyLoadoutViewerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronIcon open={open} />
          <span className="text-sm font-semibold text-gray-300">
            Party Loadouts
          </span>
          <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
            {playerConfigs.length} player{playerConfigs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2">
          {playerConfigs.map((config, i) => (
            <PlayerCard
              key={config.hrid + i}
              config={config}
              gameData={gameData}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
