/**
 * How the Storage page (Settings › Storage) prints what the server measured: the categories in
 * the order the bar stacks them, each one's name and paint, and a size in spaced units.
 *
 * The categories are identities, not judgements: each takes a palette slot in order, and `other`
 * — the rest, not a kind of its own — the neutral every chart's folded tail wears.
 */
import type { StorageBytes, StorageCategory } from "@prismshadow/penguin-server/api";
import type { ChartPaint, UsageSegment } from "@prismshadow/penguin-ui";
import { NEUTRAL_SERIES } from "../../lib/category-colors";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";

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

const OTHER_PAINT: ChartPaint = { ink: NEUTRAL_SERIES.text, swatch: NEUTRAL_SERIES.swatch };

/** A category's paint: its palette slot, or the neutral for `other`. */
export function categoryPaint(category: StorageCategory): ChartPaint {
  return category === "other" ? OTHER_PAINT : { series: STORAGE_CATEGORIES.indexOf(category) };
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
