// =============================================================================
// PlayerLoadout - Editable loadout: equipment, consumables, abilities
// =============================================================================

import { useState, useMemo } from "react";
import type {
  PlayerConfig,
  GameData,
  TriggerData,
} from "../../engine/types";
import { hridToName } from "../../utils/formatting";
import ItemSearchSelect, {
  getEquipmentOptionsForSlot,
  getConsumableOptions,
  getAbilityOptions,
  getSpecialAbilityOptions,
} from "./ItemSearchSelect";
import TriggerEditor from "./TriggerEditor";

interface PlayerLoadoutProps {
  player: PlayerConfig;
  gameData: GameData;
  onChange: (updated: PlayerConfig) => void;
  /** HRIDs of back items the player owns (from gearPool). When provided, shows a "Use owned back items only" checkbox. */
  ownedBackItemHrids?: Set<string>;
}

// Ordered list of equipment slots for display
const SLOT_ORDER: { slotHrid: string; label: string }[] = [
  { slotHrid: "/equipment_types/head", label: "Head" },
  { slotHrid: "/equipment_types/body", label: "Body" },
  { slotHrid: "/equipment_types/legs", label: "Legs" },
  { slotHrid: "/equipment_types/feet", label: "Feet" },
  { slotHrid: "/equipment_types/hands", label: "Hands" },
  { slotHrid: "/equipment_types/main_hand", label: "Main Hand" },
  { slotHrid: "/equipment_types/two_hand", label: "Two Hand" },
  { slotHrid: "/equipment_types/off_hand", label: "Off Hand" },
  { slotHrid: "/equipment_types/pouch", label: "Pouch" },
  { slotHrid: "/equipment_types/back", label: "Back" },
  { slotHrid: "/equipment_types/neck", label: "Neck" },
  { slotHrid: "/equipment_types/earrings", label: "Earrings" },
  { slotHrid: "/equipment_types/ring", label: "Ring" },
  { slotHrid: "/equipment_types/charm", label: "Charm" },
];

function getAbilityName(hrid: string, gameData: GameData): string {
  const ability = gameData.abilityDetailMap[hrid];
  return ability?.name ?? hridToName(hrid);
}

export default function PlayerLoadout({
  player,
  gameData,
  onChange,
  ownedBackItemHrids,
}: PlayerLoadoutProps) {
  // Track which trigger sections are expanded (keyed by "food-0", "drink-1", etc.)
  const [expandedTriggers, setExpandedTriggers] = useState<Record<string, boolean>>({});
  const [ownedBackItemsOnly, setOwnedBackItemsOnly] = useState(false);

  const toggleTrigger = (key: string) => {
    setExpandedTriggers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Memoize option lists
  const slotOptions = useMemo(() => {
    const map: Record<string, { hrid: string; name: string }[]> = {};
    for (const slot of SLOT_ORDER) {
      let options = getEquipmentOptionsForSlot(gameData, slot.slotHrid);
      // Filter back items to owned-only when checkbox is active
      if (slot.slotHrid === "/equipment_types/back" && ownedBackItemsOnly && ownedBackItemHrids) {
        options = options.filter((o) => ownedBackItemHrids.has(o.hrid));
      }
      map[slot.slotHrid] = options;
    }
    return map;
  }, [gameData, ownedBackItemsOnly, ownedBackItemHrids]);

  const foodOptions = useMemo(() => getConsumableOptions(gameData, "food"), [gameData]);
  const drinkOptions = useMemo(() => getConsumableOptions(gameData, "drink"), [gameData]);
  const abilityOptions = useMemo(() => getAbilityOptions(gameData), [gameData]);
  const specialAbilityOptions = useMemo(() => getSpecialAbilityOptions(gameData), [gameData]);

  // Count active house rooms / achievements
  const houseRoomCount = Object.values(player.houseRooms).filter((v) => v > 0).length;
  const achievementCount = Object.keys(player.achievements).length;

  // Determine which weapon type is active
  const hasMainHand = !!player.equipment["/equipment_types/main_hand"]?.hrid;
  const hasTwoHand = !!player.equipment["/equipment_types/two_hand"]?.hrid;

  // Filter visible slots
  const visibleSlots = SLOT_ORDER.filter((slot) => {
    if (slot.slotHrid === "/equipment_types/two_hand" && hasMainHand) return false;
    if (slot.slotHrid === "/equipment_types/main_hand" && hasTwoHand) return false;
    if (slot.slotHrid === "/equipment_types/off_hand" && hasTwoHand) return false;
    return true;
  });

  // --- Handlers ---

  const setEquipment = (slotHrid: string, hrid: string) => {
    const newEquipment = { ...player.equipment };
    if (!hrid) {
      newEquipment[slotHrid] = null;
    } else {
      const existing = player.equipment[slotHrid];
      newEquipment[slotHrid] = {
        hrid,
        enhancementLevel: existing?.enhancementLevel ?? 0,
      };
      // If equipping main_hand, clear two_hand (and vice versa)
      if (slotHrid === "/equipment_types/main_hand") {
        newEquipment["/equipment_types/two_hand"] = null;
      } else if (slotHrid === "/equipment_types/two_hand") {
        newEquipment["/equipment_types/main_hand"] = null;
        newEquipment["/equipment_types/off_hand"] = null;
      }
    }
    onChange({ ...player, equipment: newEquipment });
  };

  const setEnhancementLevel = (slotHrid: string, level: number) => {
    const existing = player.equipment[slotHrid];
    if (!existing) return;
    const newEquipment = { ...player.equipment };
    newEquipment[slotHrid] = { ...existing, enhancementLevel: Math.max(0, Math.min(25, level)) };
    onChange({ ...player, equipment: newEquipment });
  };

  const setFood = (index: number, hrid: string) => {
    const newFood = [...player.food];
    if (!hrid) {
      newFood[index] = null;
    } else {
      const existing = player.food[index];
      newFood[index] = { hrid, triggers: existing?.triggers ?? [] };
    }
    onChange({ ...player, food: newFood });
  };

  const setDrink = (index: number, hrid: string) => {
    const newDrinks = [...player.drinks];
    if (!hrid) {
      newDrinks[index] = null;
    } else {
      const existing = player.drinks[index];
      newDrinks[index] = { hrid, triggers: existing?.triggers ?? [] };
    }
    onChange({ ...player, drinks: newDrinks });
  };

  const addFood = () => {
    onChange({ ...player, food: [...player.food, null] });
  };

  const addDrink = () => {
    onChange({ ...player, drinks: [...player.drinks, null] });
  };

  const setAbility = (index: number, hrid: string) => {
    // Pad to 4 slots
    const newAbilities = [...player.abilities];
    while (newAbilities.length < 4) newAbilities.push(null);
    if (!hrid) {
      newAbilities[index] = null;
    } else {
      const existing = newAbilities[index];
      newAbilities[index] = {
        hrid,
        level: existing?.level ?? 1,
        triggers: existing?.triggers ?? [],
      };
    }
    onChange({ ...player, abilities: newAbilities.slice(0, 4) });
  };

  const setAbilityLevel = (index: number, level: number) => {
    const newAbilities = [...player.abilities];
    while (newAbilities.length < 4) newAbilities.push(null);
    const existing = newAbilities[index];
    if (!existing) return;
    newAbilities[index] = { ...existing, level: Math.max(1, level) };
    onChange({ ...player, abilities: newAbilities.slice(0, 4) });
  };

  const setSpecialAbility = (hrid: string) => {
    if (!hrid) {
      onChange({ ...player, specialAbility: null });
    } else {
      const existing = player.specialAbility;
      onChange({
        ...player,
        specialAbility: {
          hrid,
          level: existing?.level ?? 1,
          triggers: existing?.triggers ?? [],
        },
      });
    }
  };

  const setSpecialAbilityLevel = (level: number) => {
    if (!player.specialAbility) return;
    onChange({
      ...player,
      specialAbility: { ...player.specialAbility, level: Math.max(1, level) },
    });
  };

  // --- Trigger update handlers ---

  const setFoodTriggers = (index: number, triggers: TriggerData[]) => {
    const newFood = [...player.food];
    const existing = newFood[index];
    if (!existing) return;
    newFood[index] = { ...existing, triggers };
    onChange({ ...player, food: newFood });
  };

  const setDrinkTriggers = (index: number, triggers: TriggerData[]) => {
    const newDrinks = [...player.drinks];
    const existing = newDrinks[index];
    if (!existing) return;
    newDrinks[index] = { ...existing, triggers };
    onChange({ ...player, drinks: newDrinks });
  };

  const setAbilityTriggers = (index: number, triggers: TriggerData[]) => {
    const newAbilities = [...player.abilities];
    while (newAbilities.length < 4) newAbilities.push(null);
    const existing = newAbilities[index];
    if (!existing) return;
    newAbilities[index] = { ...existing, triggers };
    onChange({ ...player, abilities: newAbilities.slice(0, 4) });
  };

  const setSpecialAbilityTriggers = (triggers: TriggerData[]) => {
    if (!player.specialAbility) return;
    onChange({
      ...player,
      specialAbility: { ...player.specialAbility, triggers },
    });
  };

  // Ensure at least some food/drink slots exist for editing
  const foodSlots = player.food.length > 0 ? player.food : [null];
  const drinkSlots = player.drinks.length > 0 ? player.drinks : [null];

  // Always exactly 4 regular ability slots
  const abilitySlots: (typeof player.abilities[number])[] = [];
  for (let i = 0; i < 4; i++) {
    abilitySlots.push(player.abilities[i] ?? null);
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
        Loadout
      </h2>

      {/* Equipment */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-gray-400">Equipment</h3>
          {ownedBackItemHrids && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ownedBackItemsOnly}
                onChange={(e) => setOwnedBackItemsOnly(e.target.checked)}
                className="w-3 h-3 rounded bg-gray-900 border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-[10px] text-gray-400">Owned back items only</span>
            </label>
          )}
        </div>
        <div className="space-y-2">
          {visibleSlots.map((slot) => {
            const dto = player.equipment[slot.slotHrid];
            const currentHrid = dto?.hrid ?? "";
            const enh = dto?.enhancementLevel ?? 0;
            return (
              <div key={slot.slotHrid}>
                <div className="text-[10px] text-gray-500 uppercase mb-0.5">
                  {slot.label}
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <ItemSearchSelect
                      options={slotOptions[slot.slotHrid] ?? []}
                      value={currentHrid}
                      onChange={(hrid) => setEquipment(slot.slotHrid, hrid)}
                      placeholder={`Select ${slot.label.toLowerCase()}...`}
                    />
                  </div>
                  {currentHrid && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <span className="text-[10px] text-blue-400">+</span>
                      <input
                        type="number"
                        min={0}
                        max={25}
                        value={enh}
                        onChange={(e) =>
                          setEnhancementLevel(slot.slotHrid, parseInt(e.target.value) || 0)
                        }
                        className="w-10 text-xs text-center bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-blue-400 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Food */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-gray-400">Food</h3>
          <button
            type="button"
            onClick={addFood}
            className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
          >
            + Add Slot
          </button>
        </div>
        <div className="space-y-1">
          {foodSlots.map((f, i) => {
            const triggerKey = `food-${i}`;
            const triggerCount = f?.triggers?.length ?? 0;
            const isExpanded = expandedTriggers[triggerKey] ?? false;
            return (
              <div key={triggerKey}>
                <ItemSearchSelect
                  options={foodOptions}
                  value={f?.hrid ?? ""}
                  onChange={(hrid) => setFood(i, hrid)}
                  placeholder="Select food..."
                />
                {f?.hrid && (
                  <div className="mt-0.5 ml-1">
                    <button
                      type="button"
                      onClick={() => toggleTrigger(triggerKey)}
                      className="text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1 cursor-pointer"
                    >
                      <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        &#9654;
                      </span>
                      Triggers
                      {triggerCount > 0 && (
                        <span className="text-blue-400">({triggerCount})</span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="mt-1 ml-2">
                        <TriggerEditor
                          triggers={f.triggers}
                          gameData={gameData}
                          onChange={(triggers) => setFoodTriggers(i, triggers)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Drinks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-gray-400">Drinks</h3>
          <button
            type="button"
            onClick={addDrink}
            className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
          >
            + Add Slot
          </button>
        </div>
        <div className="space-y-1">
          {drinkSlots.map((d, i) => {
            const triggerKey = `drink-${i}`;
            const triggerCount = d?.triggers?.length ?? 0;
            const isExpanded = expandedTriggers[triggerKey] ?? false;
            return (
              <div key={triggerKey}>
                <ItemSearchSelect
                  options={drinkOptions}
                  value={d?.hrid ?? ""}
                  onChange={(hrid) => setDrink(i, hrid)}
                  placeholder="Select drink..."
                />
                {d?.hrid && (
                  <div className="mt-0.5 ml-1">
                    <button
                      type="button"
                      onClick={() => toggleTrigger(triggerKey)}
                      className="text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1 cursor-pointer"
                    >
                      <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        &#9654;
                      </span>
                      Triggers
                      {triggerCount > 0 && (
                        <span className="text-blue-400">({triggerCount})</span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="mt-1 ml-2">
                        <TriggerEditor
                          triggers={d.triggers}
                          gameData={gameData}
                          onChange={(triggers) => setDrinkTriggers(i, triggers)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Abilities: special (slot 1) + 4 regular slots */}
      <div>
        <h3 className="text-xs font-medium text-gray-400 mb-2">Abilities</h3>
        <div className="space-y-1">
          {/* Special ability - first slot */}
          <div>
            <div className="flex items-center gap-1">
              <div className="flex-1">
                <ItemSearchSelect
                  options={specialAbilityOptions}
                  value={player.specialAbility?.hrid ?? ""}
                  onChange={setSpecialAbility}
                  placeholder="Select special ability..."
                />
              </div>
              {player.specialAbility?.hrid && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <span className="text-[10px] text-gray-500">Lv</span>
                  <input
                    type="number"
                    min={1}
                    value={player.specialAbility.level}
                    onChange={(e) =>
                      setSpecialAbilityLevel(parseInt(e.target.value) || 1)
                    }
                    className="w-12 text-xs text-center bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>
            {player.specialAbility?.hrid && (
              <div className="mt-0.5 ml-1">
                <TriggerToggle
                  triggerKey="special"
                  triggerCount={player.specialAbility.triggers.length}
                  isExpanded={expandedTriggers["special"] ?? false}
                  onToggle={() => toggleTrigger("special")}
                />
                {(expandedTriggers["special"] ?? false) && (
                  <div className="mt-1 ml-2">
                    <TriggerEditor
                      triggers={player.specialAbility.triggers}
                      gameData={gameData}
                      onChange={setSpecialAbilityTriggers}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Regular abilities */}
          {abilitySlots.map((a, i) => {
            const triggerKey = `ability-${i}`;
            const triggerCount = a?.triggers?.length ?? 0;
            const isExpanded = expandedTriggers[triggerKey] ?? false;
            return (
              <div key={triggerKey}>
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <ItemSearchSelect
                      options={abilityOptions}
                      value={a?.hrid ?? ""}
                      onChange={(hrid) => setAbility(i, hrid)}
                      placeholder="Select ability..."
                    />
                  </div>
                  {a?.hrid && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <span className="text-[10px] text-gray-500">Lv</span>
                      <input
                        type="number"
                        min={1}
                        value={a.level}
                        onChange={(e) =>
                          setAbilityLevel(i, parseInt(e.target.value) || 1)
                        }
                        className="w-12 text-xs text-center bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}
                </div>
                {a?.hrid && (
                  <div className="mt-0.5 ml-1">
                    <TriggerToggle
                      triggerKey={triggerKey}
                      triggerCount={triggerCount}
                      isExpanded={isExpanded}
                      onToggle={() => toggleTrigger(triggerKey)}
                    />
                    {isExpanded && (
                      <div className="mt-1 ml-2">
                        <TriggerEditor
                          triggers={a.triggers}
                          gameData={gameData}
                          onChange={(triggers) => setAbilityTriggers(i, triggers)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Misc stats */}
      <div className="flex gap-3 text-xs text-gray-500 border-t border-gray-700 pt-3">
        <span>
          {houseRoomCount} house room{houseRoomCount !== 1 ? "s" : ""}
        </span>
        <span>
          {achievementCount} achievement{achievementCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

/** Small reusable toggle button for trigger sections */
function TriggerToggle({
  triggerKey,
  triggerCount,
  isExpanded,
  onToggle,
}: {
  triggerKey: string;
  triggerCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-[10px] text-gray-400 hover:text-gray-200 flex items-center gap-1 cursor-pointer"
    >
      <span className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>
        &#9654;
      </span>
      Triggers
      {triggerCount > 0 && (
        <span className="text-blue-400">({triggerCount})</span>
      )}
    </button>
  );
}
