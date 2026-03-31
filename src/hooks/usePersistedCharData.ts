// =============================================================================
// usePersistedCharData — Persist raw character JSON to localStorage
// =============================================================================
// Keys used:
//   mwi-averagelator:combat-slots  — JSON array of slot text for combat/zone ranking
//   mwi-averagelator:lab-json      — raw text for labyrinth import

const COMBAT_KEY = "mwi-averagelator:combat-slots";
const LAB_KEY = "mwi-averagelator:lab-json";

export function saveCombatSlots(slots: string[]): void {
  try {
    localStorage.setItem(COMBAT_KEY, JSON.stringify(slots));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadCombatSlots(): string[] | null {
  try {
    const raw = localStorage.getItem(COMBAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      if (parsed.some((s: string) => s.trim())) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLabJson(text: string): void {
  try {
    localStorage.setItem(LAB_KEY, text);
  } catch {
    // silently ignore
  }
}

export function loadLabJson(): string | null {
  try {
    const raw = localStorage.getItem(LAB_KEY);
    if (raw && raw.trim()) return raw;
    return null;
  } catch {
    return null;
  }
}
