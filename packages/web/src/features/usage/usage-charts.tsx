/**
 * Cost center stat charts: hand-drawn SVG / flex, no chart library. Every
 * chart is a time series over the page's shared date range and precision —
 * - CallsChart: requests per bucket as smooth lines, one color per Agent (top
 *   Agents keep their own CVD-checked hue, the tail folds into a neutral
 *   "other" line — colors are assigned in fixed order, never cycled);
 * - SuccessRateChart: per-bucket success rate as a single smooth line on a
 *   fixed 0–100% scale (smoothing is monotone cubic, so the curve never arcs
 *   above 100%);
 * - TokenBarChart: per-bucket Token buckets as a three-segment stacked bar
 *   (bottom-to-top output → cacheWrite → cacheRead, same blue family, darkest
 *   at the bottom), with the cache hit rate drawn as a smooth curve **in front
 *   of the bars** on its own right-hand 0–100% axis. Bars always fit the card
 *   (fitBarWidth) — the charts never scroll.
 * Cost reuses TrendChart (smooth line + area fill).
 *
 * Unified highlight interaction (a site-wide convention): highlight = fade
 * out the rest. The Token bar is **precise down to the segment** — hovering a
 * given bucket's given segment lights up only that segment, and the bubble
 * reports only that segment's value (not the whole column's total).
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { cacheHitRate, formatPercent, humanizeTokens } from "../../lib/format";
import { TOKEN_COLORS } from "../../lib/token-colors";
import { seriesColor } from "../../lib/category-colors";
import {
  makeGeom,
  makeRangeGeom,
  autoLabelIdx,
  barSegments,
  fitBarWidth,
  monotonePath,
  successRate,
  PAD_R_AXIS,
  type TokenBucketKey,
} from "./chart-geom";
import { ChartFrame, useChartWidth } from "./chart-svg";
import {
  bucketAxisLabel,
  bucketFullLabel,
  hitRateValues,
  successRateValues,
  type CallsSeries,
} from "./usage-controls";

/** Empty state for a chart card (defaults to "no usage records yet"; the errors chart passes its own copy). */
export function Empty({ text }: { text?: string }) {
  return <p className="py-6 text-center text-xs text-gray-400">{text ?? S.usage.empty}</p>;
}

/** Bucket name copy: S is a runtime live binding (switching language remounts the whole tree), so it must be read at render time and never cached at module scope. */
function bucketLabel(key: TokenBucketKey): string {
  if (key === "cacheRead") return S.usage.colCacheRead;
  if (key === "cacheWrite") return S.usage.colCacheWrite;
  return S.usage.colOutput;
}

/** The neutral color of the folded "other" series (a line series color, not a category hue). */
const OTHER_SERIES = {
  text: "text-gray-400 dark:text-gray-500",
  swatch: "bg-gray-400 dark:bg-gray-500",
};

/** Text/swatch classes for the i-th calls series (the folded tail is neutral). */
function callsColor(s: CallsSeries, i: number): { text: string; swatch: string } {
  return s.other ? OTHER_SERIES : seriesColor(i);
}

// —— Requests per bucket: smooth lines per Agent ——

/**
 * Requests per bucket → smooth lines, one per Agent (pre-folded by
 * usage-controls' callsSeries; colors in fixed order). The legend lives in the
 * card header (see CallsLegend), linked through lifted hover state: hovering a
 * legend item fades out every other line.
 */
export function CallsChart({
  series,
  calls,
  granularity,
  legend,
}: {
  series: UsageSeriesPoint[];
  calls: CallsSeries[];
  granularity: UsageGranularity;
  /** Index of the legend item currently hovered (fades the other lines); null = none. */
  legend?: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  const total = series.reduce((s, p) => s + p.requests, 0);
  if (series.length === 0 || calls.length === 0 || total === 0) return <Empty />;

  const max = Math.max(1, ...calls.flatMap((c) => c.values));
  const geom = makeGeom(series.length, max, width);
  const buckets = series.map((p) => p.bucket);

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => String(Math.round(v))}
          dates={buckets}
          fmtX={(b) => bucketAxisLabel(granularity, b)}
          hover={hover}
          onHover={setHover}
          bubble={(i) => (
            <>
              <p className="text-gray-400">{bucketFullLabel(granularity, buckets[i]!)}</p>
              {calls.map((c, si) => (
                <p key={c.label} className="flex items-center gap-1.5 font-mono">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-sm ${callsColor(c, si).swatch}`}
                  />
                  <span className="max-w-40 truncate">{c.label}</span>
                  <span className="ml-auto pl-2 tabular-nums">{c.values[i] ?? 0}</span>
                </p>
              ))}
            </>
          )}
        >
          {calls.map((c, si) => (
            <g
              key={c.label}
              className={`${callsColor(c, si).text} transition-opacity duration-150`}
              opacity={legend != null && legend !== si ? 0.2 : 1}
            >
              <path
                d={monotonePath(geom, c.values)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                opacity={hover !== null ? 0.5 : 1}
              />
              {hover !== null && (
                <circle
                  cx={geom.x(hover)}
                  cy={geom.y(c.values[hover] ?? 0)}
                  r={3}
                  className="fill-current"
                />
              )}
            </g>
          ))}
        </ChartFrame>
      )}
    </div>
  );
}

/** Calls chart legend (one item per drawn series): hovering an item highlights its line and fades out the rest. */
export function CallsLegend({
  calls,
  active,
  onHover,
}: {
  calls: CallsSeries[];
  active?: number | null;
  onHover?: (i: number | null) => void;
}) {
  return (
    <div className="flex max-w-72 flex-wrap justify-end gap-x-3 gap-y-1">
      {calls.map((c, i) => (
        <button
          key={c.label}
          type="button"
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onHover?.(null)}
          title={c.label}
          className={`flex min-w-0 items-center gap-1 text-[10px] text-gray-500 transition-opacity duration-150 dark:text-gray-400 ${
            active != null && active !== i ? "opacity-30" : ""
          }`}
        >
          <span className={`inline-block h-2 w-3 shrink-0 rounded-sm ${callsColor(c, i).swatch}`} />
          <span className="max-w-28 truncate font-mono">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

// —— Success rate per bucket: a single smooth line on a fixed 0–100% scale ——

/**
 * Per-bucket success rate → one smooth line on a fixed 0–100% scale. An idle
 * bucket counts as 100% (the site-wide "no requests = nothing failed"
 * convention — see successRate), which also keeps the line continuous. The
 * bubble reports the rate plus the completed/denominator counts behind it.
 */
export function SuccessRateChart({
  series,
  granularity,
}: {
  series: UsageSeriesPoint[];
  granularity: UsageGranularity;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  if (series.length === 0 || series.every((p) => p.denominator === 0)) return <Empty />;

  const values = successRateValues(series);
  const geom = makeRangeGeom(series.length, 0, 100, width);
  const buckets = series.map((p) => p.bucket);

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => `${Math.round(v)}%`}
          yTicks={[0, 25, 50, 75, 100]}
          dates={buckets}
          fmtX={(b) => bucketAxisLabel(granularity, b)}
          hover={hover}
          onHover={setHover}
          bubble={(i) => {
            const p = series[i]!;
            return (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, buckets[i]!)}</p>
                <p className="font-mono">
                  {formatPercent(successRate(p.completed, p.denominator))}
                  {p.denominator > 0 && (
                    <span className="ml-1.5 text-gray-400">
                      {p.completed}/{p.denominator}
                    </span>
                  )}
                </p>
              </>
            );
          }}
        >
          <g className="text-sky-500 dark:text-sky-400">
            <path
              d={monotonePath(geom, values)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={hover !== null ? 0.5 : 1}
            />
            {hover !== null && (
              <circle
                cx={geom.x(hover)}
                cy={geom.y(values[hover] ?? 100)}
                r={3}
                className="fill-current"
              />
            )}
          </g>
        </ChartFrame>
      )}
    </div>
  );
}

// —— Token buckets: three-segment stacked bars + a cache-hit-rate curve in front ——

/** The currently hovered segment: which bucket (column index), which Token bucket. */
interface SegHover {
  i: number;
  key: TokenBucketKey;
}

/** Legend keys of the Token chart: the three Token buckets plus the hit-rate curve. */
export type TokenLegendKey = TokenBucketKey | "hitRate";

/** The hit-rate curve's color classes (amber — distinct from the bars' blue family, CVD-checked against sky in the series palette). */
const HIT_RATE_TEXT = "text-amber-500 dark:text-amber-600";
const HIT_RATE_SWATCH = "bg-amber-500 dark:bg-amber-600";

/**
 * Per-bucket Token buckets → a three-segment stacked bar (SVG, reusing the
 * shared coordinate system and grid), bottom-to-top output → cacheWrite →
 * cacheRead, with the cache hit rate drawn as a smooth curve **in front of the
 * bars** on its own right-hand 0–100% axis (same x positions — the two geoms
 * share n / w / padR).
 *
 * Bars always fit the card: fitBarWidth caps them at 25px and shrinks them
 * with the cell so the chart never scrolls horizontally.
 *
 * **Each segment is an independent, individually hoverable rect**: the hit
 * layer swaps ChartFrame's whole-column hit area for a per-segment hit band
 * (see chart-geom's barSegments — the hit band fills the whole bar and small
 * segments have a height floor, otherwise a sub-pixel output segment would
 * be un-hoverable). Hitting a segment highlights only that segment and fades
 * out everything else; the bubble reports only that segment's bucket/name/
 * Token count (the cacheRead segment adds that bucket's cache hit rate).
 * When legend is passed in (legend hover), it highlights all segments of the
 * matching bucket — or the curve alone for `hitRate`. The curve itself takes
 * no pointer events; its per-bucket value already rides the cacheRead bubble.
 * No hover vertical line is drawn (hoverLine={false}): the bar itself already indicates the x position.
 */
export function TokenBarChart({
  series,
  granularity,
  legend,
}: {
  series: UsageSeriesPoint[];
  granularity: UsageGranularity;
  /** The legend item currently hovered (highlights matching segments / the curve); null = none. */
  legend?: TokenLegendKey | null;
}) {
  const [hover, setHover] = useState<SegHover | null>(null);
  const [ref, width] = useChartWidth();
  if (series.length === 0 || series.every((p) => p.total === 0)) return <Empty />;

  const sums = series.map((p) => p.cacheRead + p.cacheWrite + p.output);
  const max = Math.max(1, ...sums);
  const geom = makeGeom(series.length, max, width, PAD_R_AXIS);
  const rateGeom = makeRangeGeom(series.length, 0, 100, width, PAD_R_AXIS);
  const barW = fitBarWidth(geom.step);
  const buckets = series.map((p) => p.bucket);
  const segs = series.map((p) => barSegments(geom, p));
  const rates = hitRateValues(series);

  // Highlight = fade out the rest: segment-level hover leaves only "that bucket's that segment", legend hover leaves all segments of the matching bucket (or the curve alone).
  const dimmed = (i: number, key: TokenBucketKey) =>
    (hover !== null && !(hover.i === i && hover.key === key)) || (legend != null && legend !== key);
  const curveDim = (legend != null && legend !== "hitRate") || hover !== null;

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => humanizeTokens(Math.round(v))}
          dates={buckets}
          fmtX={(b) => bucketAxisLabel(granularity, b)}
          hover={hover?.i ?? null}
          labels={autoLabelIdx(series.length, geom.step)}
          // The bar itself indicates x position: no hover vertical line spanning the whole chart.
          hoverLine={false}
          rightAxis={{ y: rateGeom.y, ticks: [0, 50, 100], fmt: (v) => `${v}%` }}
          // Per-segment hits go through hitLayer below; ChartFrame only calls back when the mouse leaves the whole chart (i=null).
          onHover={(i) => {
            if (i === null) setHover(null);
          }}
          bubble={(i) => {
            const p = series[i]!;
            const key = hover?.key;
            if (!key) return null;
            // The cacheRead bubble additionally reports that bucket's cache hit
            // rate, via the formula/format/label shared with the Trace page
            // (lib/format.ts cacheHitRate + formatPercent, S.traces.hitRate),
            // so the metric reads identically everywhere; null (denominator 0) omits the line instead of showing 0/0.
            const hitRate = key === "cacheRead" ? cacheHitRate(p.cacheRead, p.cacheWrite) : null;
            return (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, p.bucket)}</p>
                <p className="font-mono">
                  {bucketLabel(key)} {humanizeTokens(p[key])}
                </p>
                {hitRate !== null && (
                  <p className="font-mono">
                    {S.traces.hitRate} {formatPercent(hitRate)}
                  </p>
                )}
              </>
            );
          }}
          hitLayer={series.map((p, i) =>
            segs[i]!.map((s) => (
              // The hit band is as wide as the bar horizontally (empty space
              // outside the bar doesn't trigger highlighting), and split by
              // segment vertically with no overlap (small segments raised
              // to the minimum hit height, see hitHeights). Highlighting
              // clears as soon as the pointer leaves the bar — otherwise the
              // previous segment's highlight would linger when moving from the bar into the empty space.
              <rect
                key={`hit-${p.bucket}-${s.key}`}
                x={geom.x(i) - barW / 2}
                y={s.hitY}
                width={barW}
                height={s.hitH}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHover({ i, key: s.key })}
                onMouseLeave={() => setHover(null)}
              />
            )),
          )}
        >
          {series.map((p, i) =>
            segs[i]!.map((s) => (
              <rect
                key={`${p.bucket}-${s.key}`}
                x={geom.x(i) - barW / 2}
                y={s.y}
                width={barW}
                height={s.h}
                fill={TOKEN_COLORS[s.key]}
                className="transition-opacity duration-150"
                opacity={dimmed(i, s.key) ? 0.2 : 1}
              />
            )),
          )}
          {/* Cache-hit-rate curve, in front of the bars on the right-hand 0–100% scale.
              Gaps (no cache traffic) split the curve; a lone point between gaps gets a
              dot so it stays visible. pointer-events-none: the bars' hit bands stay hoverable through it. */}
          <g
            className={`${HIT_RATE_TEXT} pointer-events-none transition-opacity duration-150`}
            opacity={curveDim ? 0.3 : 1}
          >
            <path
              d={monotonePath(rateGeom, rates)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
            {rates.map((r, i) =>
              r !== null && rates[i - 1] == null && rates[i + 1] == null ? (
                <circle
                  key={buckets[i]}
                  cx={rateGeom.x(i)}
                  cy={rateGeom.y(r)}
                  r={2}
                  className="fill-current"
                />
              ) : null,
            )}
          </g>
        </ChartFrame>
      )}
    </div>
  );
}

/** Token chart legend (cacheRead / cacheWrite / output + the hit-rate curve): hovering an item highlights the matching marks (fading out the rest). */
export function TokenLegend({
  active,
  onHover,
}: {
  active?: TokenLegendKey | null;
  onHover?: (key: TokenLegendKey | null) => void;
}) {
  const items: Array<[TokenBucketKey, string]> = [
    ["cacheRead", S.usage.colCacheRead],
    ["cacheWrite", S.usage.colCacheWrite],
    ["output", S.usage.colOutput],
  ];
  const dim = (key: TokenLegendKey) => (active != null && active !== key ? "opacity-30" : "");
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onMouseEnter={() => onHover?.(key)}
          onMouseLeave={() => onHover?.(null)}
          className={`flex items-center gap-1 text-[10px] text-gray-500 transition-opacity duration-150 dark:text-gray-400 ${dim(key)}`}
        >
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: TOKEN_COLORS[key] }}
          />
          {label}
        </button>
      ))}
      {/* The curve's legend item wears a line-shaped swatch: it is a line on its own axis, not a fourth stack segment. */}
      <button
        type="button"
        onMouseEnter={() => onHover?.("hitRate")}
        onMouseLeave={() => onHover?.(null)}
        className={`flex items-center gap-1 text-[10px] text-gray-500 transition-opacity duration-150 dark:text-gray-400 ${dim("hitRate")}`}
      >
        <span className={`inline-block h-0.5 w-3 rounded-sm ${HIT_RATE_SWATCH}`} />
        {S.usage.legendHitRate}
      </button>
    </div>
  );
}
