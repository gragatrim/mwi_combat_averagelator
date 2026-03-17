// =============================================================================
// ItemSearchSelect - Searchable dropdown for selecting equipment items
// =============================================================================

import { useState, useRef, useEffect, useMemo } from "react";
import type { GameData } from "../../engine/types";

interface ItemOption {
  hrid: string;
  name: string;
}

interface ItemSearchSelectProps {
  /** Items to choose from. */
  options: ItemOption[];
  /** Currently selected item hrid, or "" for none. */
  value: string;
  /** Callback when an item is selected. Pass "" to clear. */
  onChange: (hrid: string) => void;
  /** Placeholder text when nothing is selected. */
  placeholder?: string;
}

export default function ItemSearchSelect({
  options,
  value,
  onChange,
  placeholder = "Select item...",
}: ItemSearchSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(
    () => options.find((o) => o.hrid === value),
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(lower));
  }, [options, search]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearch("");
        }}
        className="w-full text-left text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1.5 hover:border-gray-500 cursor-pointer transition-colors truncate"
      >
        {selectedItem ? (
          <span className="text-gray-200">{selectedItem.name}</span>
        ) : (
          <span className="text-gray-500">{placeholder}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-64 flex flex-col">
          <div className="p-2 border-b border-gray-700">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full text-xs bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {/* Clear option */}
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
                setSearch("");
              }}
              className="w-full text-left text-xs px-3 py-1.5 text-gray-500 hover:bg-gray-700 cursor-pointer italic"
            >
              (Empty)
            </button>
            {filtered.length === 0 && (
              <div className="text-xs text-gray-500 px-3 py-2">
                No items found
              </div>
            )}
            {filtered.map((item) => (
              <button
                key={item.hrid}
                type="button"
                onClick={() => {
                  onChange(item.hrid);
                  setIsOpen(false);
                  setSearch("");
                }}
                className={`w-full text-left text-xs px-3 py-1.5 cursor-pointer transition-colors ${
                  item.hrid === value
                    ? "bg-blue-900/50 text-blue-300"
                    : "text-gray-200 hover:bg-gray-700"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers: build option lists from GameData
// =============================================================================

/** Get all equipment items that fit a given equipment type slot. */
export function getEquipmentOptionsForSlot(
  gameData: GameData,
  slotHrid: string
): ItemOption[] {
  const items: ItemOption[] = [];
  for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
    if (item.equipmentDetail && item.equipmentDetail.type === slotHrid) {
      items.push({ hrid, name: item.name });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** Get all combat-usable consumable items (food or drinks). */
export function getConsumableOptions(
  gameData: GameData,
  type: "food" | "drink"
): ItemOption[] {
  const items: ItemOption[] = [];
  for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
    if (!item.consumableDetail) continue;
    const usable = item.consumableDetail.usableInActionTypeMap;
    if (!usable?.["/action_types/combat"]) continue;

    // Distinguish food vs drink by category
    const cat = item.categoryHrid;
    if (type === "food" && cat === "/item_categories/food") {
      items.push({ hrid, name: item.name });
    } else if (type === "drink" && cat === "/item_categories/drink") {
      items.push({ hrid, name: item.name });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** Get all learnable regular (non-special) abilities. */
export function getAbilityOptions(gameData: GameData): ItemOption[] {
  const items: ItemOption[] = [];
  for (const [hrid, ability] of Object.entries(gameData.abilityDetailMap)) {
    if (!ability.isSpecialAbility) {
      items.push({ hrid, name: ability.name });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** Get all special abilities (5th ability slot). */
export function getSpecialAbilityOptions(gameData: GameData): ItemOption[] {
  const items: ItemOption[] = [];
  for (const [hrid, ability] of Object.entries(gameData.abilityDetailMap)) {
    if (ability.isSpecialAbility) {
      items.push({ hrid, name: ability.name });
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
