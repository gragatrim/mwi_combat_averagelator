// =============================================================================
// LabyrinthAnalysis — Full floor analysis display with collapsible sections
// =============================================================================

import { useState } from "react";
import type { AnalysisResult } from "../../../features/labyrinthAnalyzer/types";
import { PERCOLATION_THRESHOLD, LAB_UPGRADE_DISPLAY, LAB_UPGRADE_MAX_LEVEL, LAB_UPGRADE_PER_LEVEL, labSkillOrder, labMonsterOrderByName } from "../../../features/labyrinthAnalyzer/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctColor(value: number): string {
  if (value >= 0.95) return "text-green-400";
  if (value >= 0.75) return "text-blue-400";
  if (value >= 0.55) return "text-yellow-400";
  if (value >= 0.35) return "text-orange-400";
  return "text-red-400";
}

function formatTimeMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function clearableColor(maxClear: number): string {
  if (maxClear >= 280) return "text-green-400";
  if (maxClear >= 220) return "text-blue-400";
  if (maxClear >= 180) return "text-yellow-400";
  if (maxClear >= 140) return "text-orange-400";
  return "text-red-400";
}

function sourceBadge(source: string): React.ReactNode {
  const colors: Record<string, string> = {
    simulated: "bg-purple-900/40 text-purple-300 border-purple-700",
    calculated: "bg-blue-900/40 text-blue-300 border-blue-700",
    "in-game": "bg-green-900/40 text-green-300 border-green-700",
    hardcoded: "bg-gray-700/40 text-gray-400 border-gray-600",
  };
  const labels: Record<string, string> = {
    simulated: "sim",
    calculated: "calc",
    "in-game": "ig",
    hardcoded: "hc",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[source] ?? colors.hardcoded}`}>
      {labels[source] ?? source}
    </span>
  );
}

function thresholdStr(t: number): string {
  return t >= 0 ? `+${t}` : String(t);
}

function categoryBadge(cat: string): React.ReactNode {
  const colors: Record<string, string> = {
    capacity: "bg-blue-900/40 text-blue-300 border-blue-700",
    skill:    "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    combat:   "bg-red-900/40 text-red-300 border-red-700",
    qol:      "bg-gray-700/40 text-gray-400 border-gray-600",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[cat] ?? colors.qol}`}>
      {cat}
    </span>
  );
}

function UpgradeStatusGrid({ levels }: { levels: NonNullable<AnalysisResult["upgradeLevels"]> }) {
  const rows = (Object.keys(LAB_UPGRADE_DISPLAY) as (keyof typeof LAB_UPGRADE_DISPLAY)[]).map((key) => {
    const display = LAB_UPGRADE_DISPLAY[key];
    const lv = (levels as unknown as Record<string, number>)[key] ?? 0;
    const max = LAB_UPGRADE_MAX_LEVEL[key];
    return { key, display, lv, max };
  });
  const grouped: Record<string, typeof rows> = { capacity: [], skill: [], combat: [], qol: [] };
  for (const r of rows) grouped[r.display.category].push(r);

  const renderGroup = (title: string, list: typeof rows) => (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{title}</div>
      <div className="space-y-0.5">
        {list.map(({ key, display, lv, max }) => {
          const per = LAB_UPGRADE_PER_LEVEL[key];
          const isPercent = display.unit === "%";
          let valStr: string;
          if (display.category === "capacity" && key !== "cooldown") {
            const base = key === "torch" ? 100 : key === "shroud" ? 4 : key === "beacon" ? 5 : 0;
            valStr = `${base + lv * per}${display.unit}`;
          } else if (key === "cooldown") {
            valStr = `${72 + lv * per}h`;
          } else if (isPercent) {
            valStr = `+${(lv * per * 100).toFixed(per === 0.005 ? 1 : 0)}%`;
          } else {
            valStr = `${lv * per} ${display.unit}`;
          }
          const maxed = lv >= max;
          return (
            <div key={key} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-300">{display.name}</span>
              <span className={`tabular-nums ${maxed ? "text-emerald-400" : "text-gray-400"}`}>
                {valStr} <span className="text-gray-600">({lv}/{max})</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        {renderGroup("Capacity", grouped.capacity)}
        {renderGroup("Skilling", grouped.skill)}
        {renderGroup("Combat", grouped.combat)}
        {renderGroup("Quality of Life", grouped.qol)}
      </div>
      {levels.points > 0 && (
        <div className="text-[11px] text-emerald-400 mt-2">
          {levels.points.toLocaleString()} unspent tokens
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left cursor-pointer hover:bg-gray-700/30 transition-colors"
      >
        <svg
          className={`w-3 h-3 shrink-0 transition-transform text-gray-500 ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{title}</h3>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  analysis: AnalysisResult;
}

export default function LabyrinthAnalysis({ analysis }: Props) {
  const {
    skillData, combatData, floorResults, maxFloorNoShrouds,
    shroudEstimates, bottleneck, upgradeLevels, torchBudget,
    upgradePriority, skipRecommendations, charName, timestamp, targetFloor,
  } = analysis;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">
              Floor Analysis — {charName}
            </h2>
            <div className="text-[10px] text-gray-500 mt-0.5">{timestamp}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">
              Max floor (no shrouds): <span className="text-blue-400 font-semibold">F{maxFloorNoShrouds}</span>
            </div>
            <div className="text-xs text-gray-400">
              Target: <span className="text-blue-400 font-semibold">F{targetFloor}</span>
            </div>
          </div>
        </div>
        {/* Source legend */}
        <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
          <span>{sourceBadge("simulated")} simulated</span>
          <span>{sourceBadge("calculated")} calculated</span>
          <span>{sourceBadge("in-game")} in-game</span>
          <span>{sourceBadge("hardcoded")} fallback</span>
        </div>
      </div>

      {/* ============================================================== */}
      {/* Section 1: Floor Clearability                                  */}
      {/* ============================================================== */}
      <Section title="Floor Clearability">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-2 py-1.5 font-medium">Floor</th>
                <th className="text-left px-2 py-1.5 font-medium">Levels</th>
                <th className="text-left px-2 py-1.5 font-medium">Grid</th>
                <th className="text-right px-2 py-1.5 font-medium">Skill%</th>
                <th className="text-right px-2 py-1.5 font-medium">Combat%</th>
                <th className="text-right px-2 py-1.5 font-medium">Overall</th>
                <th className="text-right px-2 py-1.5 font-medium">Blocked</th>
                <th className="text-right px-2 py-1.5 font-medium">Shrouds</th>
              </tr>
            </thead>
            <tbody>
              {floorResults.map((f, i) => (
                <tr key={f.floor} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-2 py-1.5 text-gray-300 font-medium">F{f.floor}</td>
                  <td className="px-2 py-1.5 text-gray-400">{f.min}-{f.max}</td>
                  <td className="px-2 py-1.5 text-gray-400">{f.grid}</td>
                  <td className={`px-2 py-1.5 text-right ${pctColor(f.skill)}`}>{(f.skill * 100).toFixed(1)}%</td>
                  <td className={`px-2 py-1.5 text-right ${pctColor(f.combat)}`}>{(f.combat * 100).toFixed(1)}%</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(f.overall)}`}>
                    {(f.overall * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{(f.blocked * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{shroudEstimates[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-gray-500 mt-2">
          Percolation threshold: {(PERCOLATION_THRESHOLD * 100).toFixed(0)}% — floors above this are clearable without shrouds.
        </div>
      </Section>

      {/* ============================================================== */}
      {/* Section 2: Torch Budget                                        */}
      {/* ============================================================== */}
      {torchBudget && torchBudget.length > 0 && upgradeLevels && (
        <Section title="Torch Budget" defaultOpen={true}>
          <div className="text-[11px] text-gray-400 mb-2">
            Torches: {100 + upgradeLevels.torch * 20} (expert, 20% preservation) |{" "}
            Beacons: {5 + upgradeLevels.beacon} | Target: F{targetFloor}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-2 py-1 font-medium">Floor</th>
                  <th className="text-right px-2 py-1 font-medium">Rush</th>
                  <th className="text-right px-2 py-1 font-medium">Explore</th>
                  <th className="text-right px-2 py-1 font-medium">Total</th>
                  <th className="text-right px-2 py-1 font-medium">T→End</th>
                  <th className="text-right px-2 py-1 font-medium">Floor T</th>
                  <th className="text-right px-2 py-1 font-medium">Cumul T</th>
                  <th className="text-right px-2 py-1 font-medium">E[Tok]</th>
                  <th className="text-right px-2 py-1 font-medium">E[Box]</th>
                  <th className="text-right px-2 py-1 font-medium">Bal</th>
                  <th className="text-left px-2 py-1 font-medium">Advice</th>
                </tr>
              </thead>
              <tbody>
                {torchBudget.map(b => (
                  <tr key={b.floor} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                    <td className="px-2 py-1 text-gray-300 font-medium">F{b.floor}</td>
                    <td className="px-2 py-1 text-right text-gray-400">{Math.round(b.rushTorches)}T</td>
                    <td className="px-2 py-1 text-right text-gray-400">
                      {b.exploreTorches >= 1 ? `${Math.round(b.exploreTorches)}T` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-300">{Math.round(b.totalSpend)}T</td>
                    <td className="px-2 py-1 text-right text-gray-400">{b.torchesToFinish}T</td>
                    <td className="px-2 py-1 text-right text-blue-300">{formatTimeMs(b.estimatedTimeMs)}</td>
                    <td className="px-2 py-1 text-right text-blue-300 font-medium">{formatTimeMs(b.cumulativeTimeMs)}</td>
                    <td className="px-2 py-1 text-right text-gray-400">
                      {b.expectedTokens > 0 ? b.expectedTokens.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-400">
                      {b.expectedBoxes > 0 ? b.expectedBoxes.toFixed(2) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-300">{Math.round(b.torchBalance)}T</td>
                    <td className="px-2 py-1 text-left text-gray-500 text-[10px]">{b.advice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-500 mt-2">
            Expected exploration drops per run: ~{torchBudget.reduce((s, b) => s + b.expectedTokens, 0).toFixed(0)} tokens,
            ~{torchBudget.reduce((s, b) => s + b.expectedBoxes, 0).toFixed(1)} boxes |{" "}
            Est. total run time: {formatTimeMs(torchBudget[torchBudget.length - 1]?.cumulativeTimeMs ?? 0)}
          </div>
        </Section>
      )}

      {/* ============================================================== */}
      {/* Section 3: Skill Rooms                                         */}
      {/* ============================================================== */}
      <Section title="Skill Rooms (In-Lab)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-2 py-1.5 font-medium">Skill</th>
                <th className="text-right px-2 py-1.5 font-medium">Base</th>
                <th className="text-right px-2 py-1.5 font-medium">In-Lab</th>
                <th className="text-right px-2 py-1.5 font-medium">Skip</th>
                <th className="text-right px-2 py-1.5 font-medium">Max Room</th>
                <th className="text-center px-2 py-1.5 font-medium">Src</th>
              </tr>
            </thead>
            <tbody>
              {skillData.map(s => (
                <tr key={s.hrid} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-2 py-1.5 text-gray-300">{s.name}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{s.base}</td>
                  <td className="px-2 py-1.5 text-right text-gray-300">{s.effective}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{thresholdStr(s.threshold)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${clearableColor(s.maxClearable)}`}>
                    {s.maxClearable}
                    {/* In-game comparison (existing logic) */}
                    {s.igMaxClearable != null && (
                      <span className="text-[10px] text-gray-500 ml-1">
                        (ig: {thresholdStr(s.igThreshold!)}→{s.igMaxClearable})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">{sourceBadge(s.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ============================================================== */}
      {/* Section 4: Combat Rooms                                        */}
      {/* ============================================================== */}
      <Section title="Combat Rooms (In-Lab)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-2 py-1.5 font-medium">Monster</th>
                <th className="text-right px-2 py-1.5 font-medium">Loadout</th>
                <th className="text-right px-2 py-1.5 font-medium">In-Lab</th>
                <th className="text-right px-2 py-1.5 font-medium">Skip</th>
                <th className="text-right px-2 py-1.5 font-medium">Max Room</th>
                <th className="text-center px-2 py-1.5 font-medium">Src</th>
              </tr>
            </thead>
            <tbody>
              {combatData.map(c => (
                <tr key={c.name} className="border-t border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-2 py-1.5 text-gray-300">{c.name}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{c.loadout}</td>
                  <td className="px-2 py-1.5 text-right text-gray-300">{c.effective}</td>
                  <td className="px-2 py-1.5 text-right text-gray-400">{thresholdStr(c.threshold)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${clearableColor(c.maxClearable)}`}>
                    {c.maxClearable}
                  </td>
                  <td className="px-2 py-1.5 text-center">{sourceBadge(c.source)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ============================================================== */}
      {/* Section 5: Upgrade Priority                                    */}
      {/* ============================================================== */}
      {upgradePriority && upgradeLevels && (
        <Section title="Upgrade Priority" defaultOpen={false}>
          <UpgradeStatusGrid levels={upgradeLevels} />
          {upgradePriority.length === 0 ? (
            <p className="mt-3 text-xs text-gray-400">
              No positive economic upgrades are available at the modeled target. Upgrade status remains shown above; Full Auto and Experience are quality-of-life upgrades.
            </p>
          ) : <>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-2 py-1 font-medium">#</th>
                  <th className="text-left px-2 py-1 font-medium">Upgrade</th>
                  <th className="text-center px-2 py-1 font-medium">Cat</th>
                  <th className="text-right px-2 py-1 font-medium">Cost</th>
                  <th className="text-right px-2 py-1 font-medium">+Box/mo</th>
                  <th className="text-right px-2 py-1 font-medium">Val/1kT</th>
                  <th className="text-right px-2 py-1 font-medium">Projected tier</th>
                  <th className="text-left px-2 py-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {upgradePriority.map((e, i) => {
                  const display = LAB_UPGRADE_DISPLAY[e.type];
                  return (
                    <tr
                      key={`${e.type}-${e.level}`}
                      className={`border-t border-gray-700/50 ${i === 0 ? "bg-emerald-900/10" : ""}`}
                    >
                      <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-1 text-gray-300 font-medium">
                        {display?.name ?? e.type} +{e.level}
                        {e.deltaBoxesMonth === 0 && e.projectedTier && (
                          <span className="ml-1 text-[9px] font-normal text-amber-300">investment step</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-center">{categoryBadge(e.category)}</td>
                      <td className="px-2 py-1 text-right text-gray-400">{e.cost}</td>
                      <td className="px-2 py-1 text-right text-gray-300">
                        {e.deltaBoxesMonth > 0 ? "+" : ""}{e.deltaBoxesMonth.toFixed(1)}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-400">{e.valuePerToken.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right text-gray-400 text-[10px]">
                        {e.projectedTier
                          ? `+${e.projectedTier.levels}: +${e.projectedTier.deltaBoxesMonth.toFixed(1)} / ${e.projectedTier.cost}T (${e.projectedTier.valuePerToken.toFixed(2)}/1kT)`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-left text-gray-500 text-[10px]">{e.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-500 mt-2">
            Rankings use boxes/month per token: ordinary rows use the immediate single-level ROI shown; tier rows are ranked by the explicitly shown projected multi-level ROI while +Box/mo remains the immediate benefit. Rows marked investment step have no immediate box gain, but are recommended as part of the projected tier. Exit rewards are weighted by modeled chance to reach each floor. Combat rows require simulator data; Full Auto and Experience remain in the status grid only.
          </div>
          </>}
        </Section>
      )}

      {/* ============================================================== */}
      {/* Section 6: Auto-Skip Recommendations                           */}
      {/* ============================================================== */}
      {skipRecommendations.length > 0 && (
        <Section title="Recommended Auto-Skip Settings" defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-2 py-1 font-medium">Room</th>
                  <th className="text-center px-2 py-1 font-medium">Type</th>
                  <th className="text-right px-2 py-1 font-medium">Current</th>
                  <th className="text-right px-2 py-1 font-medium">→ Set To</th>
                  <th className="text-right px-2 py-1 font-medium">Change</th>
                  <th className="text-right px-2 py-1 font-medium">Max Room</th>
                </tr>
              </thead>
              <tbody>
                {[...skipRecommendations]
                  .sort((a, b) => {
                    if (a.category !== b.category) return a.category === "skill" ? -1 : 1;
                    return a.category === "skill"
                      ? labSkillOrder(a.name) - labSkillOrder(b.name)
                      : labMonsterOrderByName(a.name) - labMonsterOrderByName(b.name);
                  })
                  .map(r => {
                    const deltaColor = r.delta > 0 ? "text-green-400" : r.delta < 0 ? "text-red-400" : "text-gray-400";
                    return (
                      <tr key={r.name} className="border-t border-gray-700/50">
                        <td className="px-2 py-1 text-gray-300">{r.name}</td>
                        <td className="px-2 py-1 text-center text-gray-400">{r.category}</td>
                        <td className="px-2 py-1 text-right text-gray-400">{thresholdStr(r.currentThreshold)}</td>
                        <td className="px-2 py-1 text-right text-gray-300 font-medium">{thresholdStr(r.recommendedThreshold)}</td>
                        <td className={`px-2 py-1 text-right font-medium ${deltaColor}`}>
                          {r.delta > 0 ? "+" : ""}{r.delta}
                        </td>
                        <td className="px-2 py-1 text-right text-gray-400">
                          {r.currentMaxClearable}→{r.maxClearable}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ============================================================== */}
      {/* Section 7: Per-Floor Detail (F5+)                              */}
      {/* ============================================================== */}
      <Section title="Per-Floor Room Breakdown (F5+)" defaultOpen={false}>
        {floorResults.filter(f => f.floor >= 5).map(f => (
          <div key={f.floor} className="mb-4 last:mb-0">
            <div className="text-xs font-medium text-gray-300 mb-1">
              F{f.floor} ({f.min}-{f.max}) —{" "}
              <span className={pctColor(f.overall)}>{(f.overall * 100).toFixed(1)}%</span> clearable
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-2 py-0.5 font-medium">Room</th>
                  <th className="text-center px-2 py-0.5 font-medium">Type</th>
                  <th className="text-right px-2 py-0.5 font-medium">Max Clear</th>
                  <th className="text-right px-2 py-0.5 font-medium">Clear%</th>
                </tr>
              </thead>
              <tbody>
                {skillData.map((s, j) => {
                  const frac = f.skillFracs[j];
                  return (
                    <tr key={s.name} className="border-t border-gray-700/30">
                      <td className="px-2 py-0.5 text-gray-400">{s.name}</td>
                      <td className="px-2 py-0.5 text-center text-gray-500">skill</td>
                      <td className="px-2 py-0.5 text-right text-gray-400">{s.maxClearable}</td>
                      <td className={`px-2 py-0.5 text-right ${pctColor(frac)}`}>{(frac * 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
                {combatData.map((c, j) => {
                  const frac = f.combatFracs[j];
                  return (
                    <tr key={c.name} className="border-t border-gray-700/30">
                      <td className="px-2 py-0.5 text-gray-400">{c.name}</td>
                      <td className="px-2 py-0.5 text-center text-gray-500">combat</td>
                      <td className="px-2 py-0.5 text-right text-gray-400">{c.maxClearable}</td>
                      <td className={`px-2 py-0.5 text-right ${pctColor(frac)}`}>{(frac * 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </Section>

      {/* ============================================================== */}
      {/* Section 8: Progression Advice (moved to bottom)                */}
      {/* ============================================================== */}
      {bottleneck && (
        <Section title="Progression Advice" defaultOpen={false}>
          {/* Bottleneck callout */}
          <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-lg px-4 py-3 mb-3">
            <div className="text-xs font-semibold text-yellow-300">
              Bottleneck: {bottleneck.bottleneckCategory.charAt(0).toUpperCase() + bottleneck.bottleneckCategory.slice(1)} rooms on F{bottleneck.frontierFloor}
            </div>
            <div className="text-[11px] text-gray-300 mt-1">
              Your {bottleneck.bottleneckCategory} rooms average{" "}
              <span className={pctColor(bottleneck.bottleneckCategory === "skill" ? bottleneck.skillAvg : bottleneck.combatAvg)}>
                {((bottleneck.bottleneckCategory === "skill" ? bottleneck.skillAvg : bottleneck.combatAvg) * 100).toFixed(1)}%
              </span>{" "}
              clearable vs {bottleneck.bottleneckCategory === "skill" ? "combat" : "skill"} at{" "}
              <span className={pctColor(bottleneck.bottleneckCategory === "skill" ? bottleneck.combatAvg : bottleneck.skillAvg)}>
                {((bottleneck.bottleneckCategory === "skill" ? bottleneck.combatAvg : bottleneck.skillAvg) * 100).toFixed(1)}%
              </span>.
            </div>
          </div>

          {/* Weak rooms table */}
          <div className="text-xs text-gray-400 mb-1.5 font-medium">
            Weakest rooms on F{bottleneck.frontierFloor} ({bottleneck.frontierMin}-{bottleneck.frontierMax})
          </div>
          <table className="w-full text-xs mb-3">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-2 py-1 font-medium">Room</th>
                <th className="text-right px-2 py-1 font-medium">Max Clear</th>
                <th className="text-right px-2 py-1 font-medium">Floor Max</th>
                <th className="text-right px-2 py-1 font-medium">Gap</th>
                <th className="text-right px-2 py-1 font-medium">Clear%</th>
              </tr>
            </thead>
            <tbody>
              {bottleneck.weakRooms.map(wr => {
                const gapColor = wr.gapNeeded > 40 ? "text-red-400" : wr.gapNeeded > 20 ? "text-orange-400" : wr.gapNeeded > 0 ? "text-yellow-400" : "text-green-400";
                return (
                  <tr key={wr.name} className="border-t border-gray-700/50">
                    <td className="px-2 py-1 text-gray-300">{wr.name}</td>
                    <td className="px-2 py-1 text-right text-gray-300">{wr.maxClearable}</td>
                    <td className="px-2 py-1 text-right text-gray-400">{bottleneck.frontierMax}</td>
                    <td className={`px-2 py-1 text-right font-medium ${gapColor}`}>
                      {wr.gapNeeded > 0 ? `+${wr.gapNeeded}` : "OK"}
                    </td>
                    <td className={`px-2 py-1 text-right ${pctColor(wr.frac)}`}>
                      {(wr.frac * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Impact estimate */}
          {bottleneck.impactEstimate != null && (
            <div className="bg-emerald-900/20 border border-emerald-800/50 rounded px-3 py-2 text-[11px]">
              <span className="text-gray-300">
                Fixing {bottleneck.nFixed} weakest rooms → F{bottleneck.frontierFloor} clearability:{" "}
              </span>
              <span className={pctColor(bottleneck.frontierOverall)}>
                {(bottleneck.frontierOverall * 100).toFixed(1)}%
              </span>
              {" → "}
              <span className={pctColor(bottleneck.impactEstimate)}>
                ~{(bottleneck.impactEstimate * 100).toFixed(1)}%
              </span>
              {bottleneck.impactEstimate >= PERCOLATION_THRESHOLD && (
                <span className="text-emerald-400 ml-1">— above percolation threshold!</span>
              )}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
