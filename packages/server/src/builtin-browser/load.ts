/**
 * How heavy the built-in browser is, and what to warn about: the policy half of the load
 * measurement. The desktop shell measures its guests (builtin-browser.ts in packages/desktop);
 * this decides what that means, and the windows and the CLI only word it.
 *
 * Three warnings, each with a little hysteresis, so a load hovering at a line does not flicker
 * the warning (and the window's toast) on and off:
 * - `memory`: the pages hold more than 1.5 GB between them; it clears under 1.35 GB. Measured on
 *   Linux, twenty busy shopping and news sites held 3.3 GB, about 165 MB a tab, with single pages
 *   past 1 GB; a laptop with 8 GB starts to swap, or to kill processes, well before that.
 * - `low_system_memory`: less than 10% of this computer's memory is available; it clears over
 *   12%. Only where the system reports available memory (see `systemMemory`).
 * - `many_tabs`: more than 12 tabs are open.
 *
 * While a memory warning stands the heaviest tabs are named: up to three, largest first, each
 * holding at least a tenth of the pages' memory, so a mark points at a tab worth closing.
 */
import type {
  BuiltinBrowserLoadWarning,
  BuiltinBrowserMetrics,
  BuiltinBrowserTabMetrics,
} from "../api/types.js";

const GB_KB = 1024 * 1024;
/** The pages' memory over which `memory` is warned about, and under which the warning clears. */
export const MEMORY_WARN_KB = 1.5 * GB_KB;
export const MEMORY_CLEAR_KB = 1.35 * GB_KB;
/** The share of this computer's memory under which `low_system_memory` is warned about, and over which it clears. */
export const LOW_MEMORY_WARN_SHARE = 0.1;
export const LOW_MEMORY_CLEAR_SHARE = 0.12;
/** More tabs than this are `many_tabs`. */
export const MANY_TABS = 12;
/** At most this many tabs are named the heaviest… */
const HEAVY_TABS = 3;
/** …and only tabs holding at least this share of the pages' memory. */
const HEAVY_SHARE = 0.1;

/**
 * This computer's memory as the warning may read it, in KB. Linux reports what is available
 * (MemAvailable) and Windows the available physical memory, but macOS only its free pages: a Mac
 * keeps nearly all of its memory in use on purpose and hands back cached pages on demand, so a
 * healthy one would read as out of memory. There the system's memory is left out.
 */
export function systemMemory(
  platform: string,
  freeBytes: number,
  totalBytes: number,
): { freeKB: number; totalKB: number } | undefined {
  if (platform === "darwin" || !(totalBytes > 0) || !(freeBytes >= 0)) return undefined;
  return { freeKB: Math.round(freeBytes / 1024), totalKB: Math.round(totalBytes / 1024) };
}

export interface LoadInput {
  at: number;
  /** The shell's measurement, narrowed to the tabs still open. */
  tabs: BuiltinBrowserTabMetrics[];
  totalKB: number;
  system?: { freeKB: number; totalKB: number };
  /** How many tabs are open now. */
  tabCount: number;
}

/** The measurement with its verdict; `previous` is the last verdict's warnings, for the hysteresis. */
export function assessLoad(
  input: LoadInput,
  previous: readonly BuiltinBrowserLoadWarning[],
): BuiltinBrowserMetrics {
  const had = new Set(previous);
  const warnings: BuiltinBrowserLoadWarning[] = [];
  if (input.totalKB > (had.has("memory") ? MEMORY_CLEAR_KB : MEMORY_WARN_KB)) {
    warnings.push("memory");
  }
  const { system } = input;
  if (system !== undefined && system.totalKB > 0 && input.tabs.length > 0) {
    const line = had.has("low_system_memory") ? LOW_MEMORY_CLEAR_SHARE : LOW_MEMORY_WARN_SHARE;
    if (system.freeKB / system.totalKB < line) warnings.push("low_system_memory");
  }
  if (input.tabCount > MANY_TABS) warnings.push("many_tabs");
  const aboutMemory = warnings.includes("memory") || warnings.includes("low_system_memory");
  const heavyTabIds =
    aboutMemory && input.tabs.length > 1
      ? input.tabs
          .filter((tab) => tab.memoryKB >= input.totalKB * HEAVY_SHARE)
          .sort((a, b) => b.memoryKB - a.memoryKB)
          .slice(0, HEAVY_TABS)
          .map((tab) => tab.tabId)
      : [];
  return {
    at: input.at,
    tabs: input.tabs,
    totalKB: input.totalKB,
    ...(system !== undefined ? { system } : {}),
    warnings,
    heavyTabIds,
  };
}
