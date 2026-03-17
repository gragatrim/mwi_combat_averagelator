// =============================================================================
// TriggerEditor - Reusable editor for combat trigger arrays
// =============================================================================

import { useMemo } from "react";
import type { TriggerData, GameData } from "../../engine/types";

interface TriggerEditorProps {
  triggers: TriggerData[];
  gameData: GameData;
  onChange: (triggers: TriggerData[]) => void;
}

interface SortedOption {
  hrid: string;
  name: string;
}

export default function TriggerEditor({
  triggers,
  gameData,
  onChange,
}: TriggerEditorProps) {
  // Build sorted option lists from game data detail maps
  const dependencyOptions = useMemo(
    () =>
      Object.values(gameData.combatTriggerDependencyDetailMap)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((d): SortedOption => ({ hrid: d.hrid, name: d.name })),
    [gameData]
  );

  const conditionOptions = useMemo(
    () =>
      Object.values(gameData.combatTriggerConditionDetailMap)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((c): SortedOption => ({ hrid: c.hrid, name: c.name })),
    [gameData]
  );

  const comparatorOptions = useMemo(
    () =>
      Object.values(gameData.combatTriggerComparatorDetailMap)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((c): SortedOption => ({ hrid: c.hrid, name: c.name })),
    [gameData]
  );

  // Lookup for comparator allowValue
  const comparatorAllowValue = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const c of Object.values(gameData.combatTriggerComparatorDetailMap)) {
      map[c.hrid] = c.allowValue;
    }
    return map;
  }, [gameData]);

  const updateTrigger = (index: number, partial: Partial<TriggerData>) => {
    const updated = triggers.map((t, i) =>
      i === index ? { ...t, ...partial } : t
    );
    onChange(updated);
  };

  const removeTrigger = (index: number) => {
    onChange(triggers.filter((_, i) => i !== index));
  };

  const addTrigger = () => {
    const defaultDep = dependencyOptions[0]?.hrid ?? "";
    const defaultCond = conditionOptions[0]?.hrid ?? "";
    const defaultComp = comparatorOptions[0]?.hrid ?? "";
    onChange([
      ...triggers,
      {
        dependencyHrid: defaultDep,
        conditionHrid: defaultCond,
        comparatorHrid: defaultComp,
        value: 0,
      },
    ]);
  };

  return (
    <div className="space-y-1.5">
      {triggers.map((trigger, i) => {
        const showValue = comparatorAllowValue[trigger.comparatorHrid] ?? false;
        return (
          <div key={i} className="flex items-center gap-1 flex-wrap">
            {/* Dependency */}
            <select
              value={trigger.dependencyHrid}
              onChange={(e) =>
                updateTrigger(i, { dependencyHrid: e.target.value })
              }
              className="bg-gray-900 text-gray-300 text-[11px] border border-gray-600 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 min-w-0"
            >
              {dependencyOptions.map((opt) => (
                <option key={opt.hrid} value={opt.hrid}>
                  {opt.name}
                </option>
              ))}
            </select>

            {/* Condition */}
            <select
              value={trigger.conditionHrid}
              onChange={(e) =>
                updateTrigger(i, { conditionHrid: e.target.value })
              }
              className="bg-gray-900 text-gray-300 text-[11px] border border-gray-600 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 min-w-0 flex-1"
            >
              {conditionOptions.map((opt) => (
                <option key={opt.hrid} value={opt.hrid}>
                  {opt.name}
                </option>
              ))}
            </select>

            {/* Comparator */}
            <select
              value={trigger.comparatorHrid}
              onChange={(e) =>
                updateTrigger(i, { comparatorHrid: e.target.value })
              }
              className="bg-gray-900 text-gray-300 text-[11px] border border-gray-600 rounded px-1.5 py-1 focus:outline-none focus:border-blue-500 min-w-0"
            >
              {comparatorOptions.map((opt) => (
                <option key={opt.hrid} value={opt.hrid}>
                  {opt.name}
                </option>
              ))}
            </select>

            {/* Value (only if comparator allows it) */}
            {showValue && (
              <input
                type="number"
                value={trigger.value}
                onChange={(e) =>
                  updateTrigger(i, {
                    value: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-16 bg-gray-900 text-gray-300 text-[11px] border border-gray-600 rounded px-1.5 py-1 text-center focus:outline-none focus:border-blue-500"
              />
            )}

            {/* Remove button */}
            <button
              type="button"
              onClick={() => removeTrigger(i)}
              className="text-red-400 hover:text-red-300 text-xs px-1 cursor-pointer shrink-0"
              title="Remove trigger"
            >
              &times;
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addTrigger}
        className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer"
      >
        + Add Trigger
      </button>
    </div>
  );
}
