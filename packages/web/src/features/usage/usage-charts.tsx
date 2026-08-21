/**
 * Cost center stat charts: hand-drawn SVG / flex, no chart library. Every
 * chart is a time series over the page's shared date range and precision —
 * - RequestsChart: one dimension's requests and success rate on one pair of
 *   axes — per-bucket requests stacked by entity on the left count axis, one
 *   success-rate line per entity on the right-hand 0–100% axis, a legend
 *   underneath. The page mounts it twice, by Agent and by Model, so both
 *   breakdowns are on screen without a toggle. Top entities keep their own
 *   CVD-checked hue and the tail folds into a neutral series labelled with
 *   how many it swallowed.
 * - TokenBarChart: per-bucket Token buckets as a three-segment stacked bar
 *   (bottom-to-top output → cacheWrite → cacheRead, same blue family, darkest
 *   at the bottom), with the cache hit rate as a dashed smooth curve **in
 *   front of the bars** on its own right-hand 0–100% axis — continuous: a
 *   bucket with no cache traffic counts as 0, never a gap. Bars always fit
 *   the card (fitBarWidth) — the charts never scroll.
 * Cost reuses TrendChart (straight line + area fill, with a dot per point
 * wherever the cells are wide enough to keep the dots apart).
 *
 * Unified highlight interaction (a site-wide convention): highlight = fade
 * out the rest. Hovering anywhere in a Token column reports the whole bucket
 * (all three Token buckets plus the hit rate); hovering a segment additionally
 * highlights just that segment; hovering a requests legend item leaves only
 * that entity's bars and line at full strength.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatPercent, humanizeTokens } from "../../lib/format";
import { TOKEN_COLORS } from "../../lib/token-colors";
import { NEUTRAL_SERIES, seriesColor, type SeriesColor } from "../../lib/category-colors";
import {
  makeGeom,
  makeRangeGeom,
  autoLabelIdx,
  barSegments,
  fitBarWidth,
  lineSegments,
  monotonePath,
  segmentPath,
  PAD_R_AXIS,
  type TokenBucketKey,
} from "./chart-geom";
import { ChartFrame, useChartWidth } from "./chart-svg";
import {
  bucketAxisLabel,
  bucketFullLabel,
  foldEntitySeries,
  hitRateValues,
  rateSeries,
  sumCounts,
  type EntityCounts,
  type EntitySeries,
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

/** Smallest multiple of 4 that covers the data (at least 4), so quartered gridlines land on integers. */
function niceCountMax(...values: number[]): number {
  return Math.max(4, Math.ceil(Math.max(0, ...values) / 4) * 4);
}

/** Text/swatch classes for the i-th drawn entity (the folded tail wears the neutral). */
function entityColor(s: EntitySeries, i: number): SeriesColor {
  return s.other ? NEUTRAL_SERIES : seriesColor(i);
}

// —— Requests + success rate, broken down by entity ——

/**
 * Legend row under a requests chart: one square swatch per drawn entity —
 * that entity's bar segments and its success-rate line share the hue, so one
 * item covers both — plus a neutral line swatch naming what the lines are.
 * Hovering an item highlights that entity (site-wide convention: highlight =
 * fade out the rest).
 */
function RequestsLegend({
  entities,
  active,
  onHover,
}: {
  entities: EntitySeries[];
  active: number | null;
  onHover: (i: number | null) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
      {entities.map((e, i) => (
        <button
          key={`${e.label}:${i}`}
          type="button"
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
          className={`flex min-w-0 items-center gap-1.5 transition-opacity duration-150 ${
            active != null && active !== i ? "opacity-30" : ""
          }`}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${entityColor(e, i).swatch}`}
          />
          <span className="max-w-40 truncate font-mono">{e.label}</span>
        </button>
      ))}
      {/* The lines wear each entity's own hue, so their legend item is about shape, not color: a neutral dash saying "the lines are the success rate, on the right axis". */}
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-0.5 w-3 shrink-0 rounded-sm ${NEUTRAL_SERIES.swatch}`} />
        {S.usage.legendSuccessRate}
      </span>
    </div>
  );
}

/**
 * One dimension's requests and success rate on one pair of axes: per-bucket
 * request counts stacked by entity against the left count axis, and one
 * success-rate line per entity against the right-hand 0-100% axis. The page
 * mounts this twice, once per dimension, so both breakdowns are on screen at
 * once with no toggle between them.
 *
 * Only the top MAX_NAMED_SERIES entities are drawn by name; the rest fold
 * into a neutral tail labelled with how many it swallowed, so the chart never
 * implies the head is everything.
 *
 * A rate line stops wherever its entity has no rated request in the bucket
 * (see rateSeries): a gap says "this entity did not run here", where a filled
 * 100% would claim a perfect record it never earned. A run of one bucket
 * strokes nothing, so it is drawn as a dot instead.
 */
export function RequestsChart({
  series,
  entities,
  granularity,
}: {
  series: UsageSeriesPoint[];
  entities: EntityCounts[];
  granularity: UsageGranularity;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  const drawn = foldEntitySeries(entities, S.usage.legendOther);
  if (series.length === 0 || drawn.length === 0) return <Empty />;

  const totals = sumCounts(drawn);
  const totalRate = rateSeries(totals);
  const rates = drawn.map((e) => rateSeries(e));
  // Requests are whole numbers and ChartFrame quarters the axis, so the top is
  // rounded up to a multiple of 4: a max of 5 would otherwise label its
  // gridlines 0 / 1 / 3 / 4 / 5, skipping 2 and pretending the spacing is even.
  const geom = makeGeom(series.length, niceCountMax(...totals.requests), width, PAD_R_AXIS);
  const rateGeom = makeRangeGeom(series.length, 0, 100, width, PAD_R_AXIS);
  const barW = fitBarWidth(geom.step);
  const buckets = series.map((p) => p.bucket);
  const faded = (i: number) => focus !== null && focus !== i;
  const pct = (v: number | null | undefined) => formatPercent(v == null ? null : v / 100);

  /** One bubble row: swatch + label + the bucket's request count + that entity's rate. */
  const bubbleRow = (
    key: string,
    swatch: React.ReactNode,
    label: string,
    requests: number,
    rate: number | null | undefined,
    muted = false,
  ) => (
    <p
      key={key}
      className={`flex items-center gap-1.5 font-mono ${muted ? "text-gray-500 dark:text-gray-400" : ""}`}
    >
      {swatch}
      <span className="max-w-32 truncate">{label}</span>
      <span className="ml-auto min-w-8 pl-2 text-right tabular-nums">{requests}</span>
      <span className="min-w-10 pl-1.5 text-right tabular-nums">{pct(rate)}</span>
    </p>
  );

  return (
    <div ref={ref}>
      {width > 0 && (
        <>
          <ChartFrame
            geom={geom}
            fmtY={(v) => String(Math.round(v))}
            dates={buckets}
            fmtX={(b) => bucketAxisLabel(granularity, b)}
            hover={hover}
            onHover={setHover}
            labels={autoLabelIdx(series.length, geom.step)}
            hoverLine={false}
            rightAxis={{ y: rateGeom.y, ticks: [0, 50, 100], fmt: (v) => `${v}%` }}
            bubble={(i) => (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, buckets[i]!)}</p>
                {drawn.map((e, si) =>
                  bubbleRow(
                    `${e.label}:${si}`,
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${entityColor(e, si).swatch}`}
                    />,
                    e.label,
                    e.requests[i] ?? 0,
                    rates[si]![i],
                  ),
                )}
                {drawn.length > 1 &&
                  bubbleRow(
                    "total",
                    <span className="inline-block h-2 w-2 shrink-0" />,
                    S.usage.bucketTotal,
                    totals.requests[i] ?? 0,
                    totalRate[i],
                    true,
                  )}
              </>
            )}
          >
            {/* Stacked request bars, bottom-up in list order (1px seams would over-fragment thin bars, so segments sit flush). */}
            {series.map((_, i) => {
              let cum = 0;
              return drawn.map((e, si) => {
                const v = e.requests[i] ?? 0;
                if (v <= 0) return null;
                const y0 = geom.y(cum);
                cum += v;
                const y1 = geom.y(cum);
                return (
                  <rect
                    key={`${buckets[i]}-${e.label}-${si}`}
                    x={geom.x(i) - barW / 2}
                    y={y1}
                    width={barW}
                    height={y0 - y1}
                    className={`${entityColor(e, si).text} transition-opacity duration-150`}
                    fill="currentColor"
                    opacity={faded(si) ? 0.15 : hover !== null && hover !== i ? 0.35 : 1}
                  />
                );
              });
            })}
            {/* One success-rate line per entity on the right-hand scale, in that entity's hue.
                Dashed, like the Token chart's hit-rate curve: a dash is what tells the reader a
                stroke belongs to the right-hand percentage axis rather than to the bars — and
                here the lines share their entity's bar color, so shape is the only thing left
                to separate the two marks with. */}
            {drawn.map((e, si) => (
              <g
                key={`rate-${e.label}-${si}`}
                className={`${entityColor(e, si).text} pointer-events-none transition-opacity duration-150`}
                opacity={faded(si) ? 0.15 : 1}
              >
                {lineSegments(rates[si]!).map((seg) => (
                  <g key={seg[0]!.index}>
                    {seg.length > 1 && (
                      <path
                        d={segmentPath(rateGeom, seg)}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                    )}
                    {/* A lone bucket strokes nothing: draw its point so a one-off run is still visible. */}
                    {seg.length === 1 && (
                      <circle
                        cx={rateGeom.x(seg[0]!.index)}
                        cy={rateGeom.y(seg[0]!.value)}
                        r={2}
                        className="fill-current"
                      />
                    )}
                  </g>
                ))}
              </g>
            ))}
          </ChartFrame>
          <RequestsLegend entities={drawn} active={focus} onHover={setFocus} />
        </>
      )}
    </div>
  );
}

// —— Token buckets: three-segment stacked bars + a cache-hit-rate curve in front ——

/** The hovered Token column, and within it the hovered segment (null = the column's empty space — the bubble still reports the whole bucket). */
interface SegHover {
  i: number;
  key: TokenBucketKey | null;
}

/** Legend keys of the Token chart: the three Token buckets plus the hit-rate curve. */
export type TokenLegendKey = TokenBucketKey | "hitRate";

/** The hit-rate curve's color classes (amber — distinct from the bars' blue family, CVD-checked against sky in the series palette). */
const HIT_RATE_TEXT = "text-amber-500 dark:text-amber-600";
const HIT_RATE_SWATCH = "bg-amber-500 dark:bg-amber-600";

/**
 * Per-bucket Token buckets → a three-segment stacked bar (SVG, reusing the
 * shared coordinate system and grid), bottom-to-top output → cacheWrite →
 * cacheRead, with the cache hit rate drawn as a dashed smooth curve **in front
 * of the bars** on its own right-hand 0–100% axis (same x positions — the two
 * geoms share n / w / padR). The curve is continuous: a bucket with no cache
 * traffic counts as 0.
 *
 * Bars always fit the card: fitBarWidth caps them at 25px and shrinks them
 * with the cell so the chart never scrolls horizontally.
 *
 * Hovering anywhere in a column shows the whole bucket's bubble — all three
 * Token counts plus the hit rate (hovering the curve therefore reads its
 * value); hovering a segment's own rect additionally highlights just that
 * segment (per-segment hit bands, see chart-geom's barSegments — small
 * segments have a height floor, otherwise a sub-pixel output segment would be
 * un-hoverable). When legend is passed in (legend hover), it highlights all
 * segments of the matching bucket — or the curve alone for `hitRate`.
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

  // Highlight = fade out the rest: segment-level hover leaves only "that bucket's that segment" (column-level hover highlights nothing), legend hover leaves all segments of the matching bucket (or the curve alone).
  const dimmed = (i: number, key: TokenBucketKey) =>
    (hover?.key != null && !(hover.i === i && hover.key === key)) ||
    (legend != null && legend !== key);
  const curveDim = (legend != null && legend !== "hitRate") || hover?.key != null;

  /** One bubble row: swatch + label + value, shared by the three Token buckets and the hit-rate line. */
  const bubbleRow = (swatch: React.ReactNode, label: string, value: string, strong: boolean) => (
    <p
      key={label}
      className={`flex items-center gap-1.5 font-mono ${strong ? "font-semibold" : ""}`}
    >
      {swatch}
      {label}
      <span className="ml-auto pl-2 tabular-nums">{value}</span>
    </p>
  );

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
          // Hits go through hitLayer below; ChartFrame only calls back when the mouse leaves the whole chart (i=null).
          onHover={(i) => {
            if (i === null) setHover(null);
          }}
          bubble={(i) => {
            const p = series[i]!;
            const key = hover?.key ?? null;
            const sq = (color: string) => (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
            );
            return (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, p.bucket)}</p>
                {(["cacheRead", "cacheWrite", "output"] as const).map((k) =>
                  bubbleRow(sq(TOKEN_COLORS[k]), bucketLabel(k), humanizeTokens(p[k]), key === k),
                )}
                {bubbleRow(
                  <span
                    className={`inline-block h-0.5 w-2 shrink-0 rounded-sm ${HIT_RATE_SWATCH}`}
                  />,
                  S.usage.legendHitRate,
                  formatPercent((rates[i] ?? 0) / 100),
                  false,
                )}
              </>
            );
          }}
          hitLayer={[
            // Column-level hits first (underneath): anywhere in the column — the empty
            // space and the curve included — reports the whole bucket's bubble.
            ...series.map((p, i) => (
              <rect
                key={`col-${p.bucket}`}
                x={geom.x(i) - geom.step / 2}
                y={0}
                width={geom.step}
                height={geom.y(0)}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHover({ i, key: null })}
              />
            )),
            // Per-segment hits on top: the hit band is as wide as the bar horizontally,
            // split by segment vertically with no overlap (small segments raised to the
            // minimum hit height, see hitHeights). Leaving a segment falls back to the
            // column hit underneath, so the bubble never flickers off inside the chart.
            ...series.map((p, i) =>
              segs[i]!.map((s) => (
                <rect
                  key={`hit-${p.bucket}-${s.key}`}
                  x={geom.x(i) - barW / 2}
                  y={s.hitY}
                  width={barW}
                  height={s.hitH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHover({ i, key: s.key })}
                  onMouseLeave={() =>
                    setHover((h) => (h?.i === i && h.key === s.key ? { i, key: null } : h))
                  }
                />
              )),
            ),
          ]}
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
          {/* Cache-hit-rate curve, dashed, in front of the bars on the right-hand 0–100% scale.
              pointer-events-none: the column/segment hit rects stay hoverable through it. */}
          <g
            className={`${HIT_RATE_TEXT} pointer-events-none transition-opacity duration-150`}
            opacity={curveDim ? 0.3 : 1}
          >
            <path
              d={monotonePath(rateGeom, rates)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            {hover !== null && (
              <circle
                cx={rateGeom.x(hover.i)}
                cy={rateGeom.y(rates[hover.i] ?? 0)}
                r={2.5}
                className="fill-current"
              />
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
