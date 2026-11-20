/**
 * How the Storage page (Settings › Storage) prints what the server measured: the categories in
 * the order the bar stacks them, each one's name and paint, and a size in spaced units.
 *
 * The categories are identities, not judgements: each takes a chart palette slot of the theme
 * (`--ui-chart-1…8`), and `other` — the rest, not a kind of its own — the neutral every chart's
 * folded tail wears.
 */
import type { ChartPaint, UsageSegment } from "@prismshadow/penguin-ui";
import { formatBytes } from "@prismshadow/penguin-web-plugin";
import type { StorageBytes, StorageCategory } from "../types";
import { S } from "./strings";

/** The order the bar stacks the categories in, and the legend lists them. */
export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  "traces",
  "agentState",
  "workspaces",
  "scratchpads",
  "caches",
  "logs",
  "plugins",
  "other",
];

/**
 * Each coloured category's palette slot (0-based: `--ui-chart-<slot + 1>`). Picked against every
 * theme's eight slots, light and dark, in OKLab: a theme's palette holds fewer well-separated hues
 * than seven, so three pairs stay close whatever the order, and the order decides where they fall —
 * - every two neighbours in the bar and the legend take clearly different hues (in Frost: violet,
 *   orange, blue, rose, teal, amber, mauve);
 * - Traces, the largest part, is close to no small one, and the five parts a Project's and an
 *   Agent's bars hold (Traces to caches) are as far apart as eight slots allow;
 * - the closest pair falls on two small parts far apart in the order (scratchpads and plugins),
 *   and none falls on logs and scratchpads, or plugins and caches.
 * The legend names every part and its size beside its swatch, so colour is never read alone.
 */
const CATEGORY_SLOTS: Readonly<Record<Exclude<StorageCategory, "other">, number>> = {
  traces: 0,
  agentState: 7,
  workspaces: 2,
  scratchpads: 3,
  caches: 6,
  logs: 1,
  plugins: 5,
};

/** The app's neutral series (lib/category-colors.ts NEUTRAL_SERIES): the rest, not an identity. */
const OTHER_PAINT: ChartPaint = {
  ink: "text-gray-400 dark:text-gray-500",
  swatch: "bg-gray-400 dark:bg-gray-500",
};

/** A category's paint: its palette slot, or the neutral for `other`. */
export function categoryPaint(category: StorageCategory): ChartPaint {
  return category === "other" ? OTHER_PAINT : { series: CATEGORY_SLOTS[category] };
}

/** A byte count with a space before its unit, as a sentence prints it: `812 B`, `4.9 GB`. */
export function formatSize(bytes: number): string {
  const n = Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0;
  return formatBytes(n).replace(/^([\d.]+)([KMG]?B)$/, "$1 $2");
}

/** The bar's parts for a breakdown by category, in stacking order (a zero part takes no room). */
export function categorySegments(categories: StorageBytes): UsageSegment[] {
  return STORAGE_CATEGORIES.map((category) => ({
    key: category,
    label: S.storage.categories[category],
    value: categories[category] ?? 0,
    paint: categoryPaint(category),
    display: formatSize(categories[category] ?? 0),
  }));
}
