/**
 * The built-in browser's load as the window says it: the toolbar mark's warning, a heavy tab's
 * line in its tooltip, and which warnings just appeared (each gets one toast). What counts as too
 * much is the server's call (its builtin-browser/load.ts); nothing here judges, it only words.
 */
import type {
  BuiltinBrowserLoadWarning,
  BuiltinBrowserMetrics,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { Strings } from "../../lib/strings";

const MB_KB = 1024;
const GB_KB = 1024 * 1024;

/** A size in KB as the browser's warnings show it: `640 MB`, or `2.1 GB` from about a gigabyte up. */
export function formatMemory(kb: number): string {
  if (kb >= 0.95 * GB_KB) return `${(kb / GB_KB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(kb / MB_KB))} MB`;
}

/**
 * The warning the toolbar's mark carries, and the toast says once: how little the computer has
 * left, how much the pages hold and in how many tabs (when memory is the concern) or else how many
 * tabs are open, then what to do about it. Null when there is nothing to warn about.
 */
export function loadWarningText(
  metrics: BuiltinBrowserMetrics | null,
  tabCount: number,
  t: Strings["builtinBrowser"]["load"] = S.builtinBrowser.load,
): string | null {
  if (metrics === null || metrics.warnings.length === 0) return null;
  const { warnings, system } = metrics;
  const sentences: string[] = [];
  if (warnings.includes("low_system_memory") && system !== undefined && system.totalKB > 0) {
    sentences.push(t.lowSystemMemory(Math.round((100 * system.freeKB) / system.totalKB)));
  }
  if (warnings.includes("memory") || warnings.includes("low_system_memory")) {
    // It names the tab count too, which is all `many_tabs` would add.
    sentences.push(t.memory(formatMemory(metrics.totalKB), tabCount));
  } else if (warnings.includes("many_tabs")) {
    sentences.push(t.manyTabs(tabCount));
  }
  sentences.push(t.advice);
  return t.join(sentences);
}

/** The memory a tab holds when it is one the warning points at (a heavy tab), else null. */
export function heavyTabMemory(
  metrics: BuiltinBrowserMetrics | null,
  tabId: number,
): number | null {
  if (metrics === null || !metrics.heavyTabIds.includes(tabId)) return null;
  return metrics.tabs.find((tab) => tab.tabId === tabId)?.memoryKB ?? null;
}

/** The warnings `next` has that `previous` had not: each is a crossing, which is toasted once. */
export function newWarnings(
  previous: readonly BuiltinBrowserLoadWarning[],
  next: readonly BuiltinBrowserLoadWarning[],
): BuiltinBrowserLoadWarning[] {
  return next.filter((warning) => !previous.includes(warning));
}
