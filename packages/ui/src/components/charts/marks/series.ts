/**
 * What a mark says about its paint in the DOM, for the chart primitives (marks.tsx, and the
 * Trace timeline's HTML bars in timeline-bar.tsx) to write the same way: the series it belongs to,
 * and, for an HTML mark, the paint its background takes.
 */
import type { ChartPaint } from "./marks";

/** A named colour's series, spelled as its token is (`--ui-chart-cache-read` names `cache-read`). */
const ROLE_SERIES = {
  ref: "ref",
  cacheRead: "cache-read",
  cacheWrite: "cache-write",
  output: "output",
} as const;

/**
 * `data-series` for a paint: the 1-based slot, like the tokens, or a named colour's token name
 * (`ref`, `cache-read`, `cache-write`, `output`) — none for an ink.
 */
export function seriesAttr(paint: ChartPaint): { "data-series"?: number | string } {
  if ("series" in paint) return { "data-series": paint.series + 1 };
  if ("role" in paint) return { "data-series": ROLE_SERIES[paint.role] };
  return {};
}

/**
 * An HTML mark's paint (a timeline bar, a swatch) for its `--_paint`, which theme.css paints its
 * background from, so a theme may paint it otherwise, as it may an SVG mark: the fill the mark
 * resolved. An ink's mark takes its background from the ink's background class (`swatch`) and
 * names the same colour as `currentColor` through its text class; an ink with no background
 * class paints nothing.
 */
export function htmlPaint(fill: string | undefined, paint: ChartPaint): string {
  if (fill !== undefined) return fill;
  return "ink" in paint && paint.swatch !== undefined ? "currentColor" : "transparent";
}
