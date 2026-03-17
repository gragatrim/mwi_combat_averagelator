// =============================================================================
// Number Formatting Utilities
// =============================================================================

/**
 * Format a number with comma separators and appropriate decimal places.
 * - Integers: no decimals
 * - Small numbers (< 100): up to 2 decimal places
 * - Large numbers: up to 1 decimal place
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";

  if (Number.isInteger(n)) {
    return n.toLocaleString("en-US");
  }

  if (Math.abs(n) < 100) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * Format an XP/hr value with suffix notation.
 * e.g., 450200 -> "450.2k XP/hr", 1200000 -> "1.2M XP/hr"
 */
export function formatXpPerHour(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 XP/hr";

  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)}B XP/hr`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)}M XP/hr`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}k XP/hr`;
  }
  return `${sign}${abs.toFixed(1)} XP/hr`;
}

/**
 * Format a compact number with suffix notation (no unit label).
 * e.g., 450200 -> "450.2k", 1200000 -> "1.2M"
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";

  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}k`;
  }
  return `${sign}${abs.toFixed(1)}`;
}

/**
 * Format a duration in seconds to a human-readable string.
 * e.g., 3600 -> "1h 0m", 90 -> "1m 30s", 0.5 -> "0.5s"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }

  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format a ratio (0-1) as a percentage string.
 * e.g., 0.853 -> "85.3%"
 */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Format nanoseconds to seconds.
 */
export function nsToSeconds(ns: number): number {
  return ns / 1e9;
}

/**
 * Format nanoseconds to hours.
 */
export function nsToHours(ns: number): number {
  return ns / 3.6e12;
}

/**
 * Convert a zone hrid to a display name.
 * e.g., "/actions/combat/smoldering_volcano" -> "Smoldering Volcano"
 */
export function hridToName(hrid: string): string {
  const parts = hrid.split("/");
  const lastPart = parts[parts.length - 1];
  return lastPart
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
