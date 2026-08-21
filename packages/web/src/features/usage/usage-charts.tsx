/**
 * Cost center stat charts: hand-drawn SVG / flex, no chart library. Every
 * chart is a time series over the page's shared date range and precision —
 * - RequestsChart: one dimension's requests and success rate on one pair of
 *   axes — per-bucket requests stacked by entity on the left count axis, one
 *   dashed success-rate line per entity on the right-hand 0–100% axis (drawn
 *   above the bars), a legend underneath. The page mounts it twice, by Agent
 *   and by Model, so both breakdowns are on screen without a toggle. Top
 *   entities keep their own CVD-checked hue and the tail folds into a neutral
 *   series labelled with how many it swallowed.
 * - TokenBarChart: per-bucket Token buckets as a three-segment stacked bar
 *   (bottom-to-top output → cacheWrite → cacheRead, same blue family, darkest
 *   at the bottom), with the cache hit rate as a dashed line **in front of the
 *   bars** on its own right-hand 0–100% axis. Bars always fit the card
 *   (fitBarWidth) — the charts never scroll.
 * Cost reuses TrendChart (straight line + area fill, with a dot per point
 * wherever the cells are wide enough to keep the dots apart).
 *
 * One x axis for the whole page: every chart is handed the same series with
 * its empty buckets already dropped (compactSeries, called once by the page),
 * so all four run left to right over the same intervals and can be read
 * against each other. A bucket only counts as empty when nothing at all was
 * recorded in it, so an entity that was idle while another one worked keeps
 * its place in that column — as a zero and a dash, not as a missing bucket.
 * `breaks` marks where the axis skipped an interval.
 *
 * Every data line is drawn at DATA_STROKE_W, and a bucket with no rate to
 * show is drawn at NO_RATE_PLOT so the stroke stays continuous. Neither is a
 * claim about the data: the hover table prints a dash there.
 *
 * Unified highlight interaction (a site-wide convention): highlight = fade
 * out the rest, and every chart offers the same three ways in: hover a column
 * for its bubble, hover one bar segment to single that segment out, hover a
 * line's own band to single the line out. A legend item does what hovering
 * its mark does. Line hit bands sit above the bars' in every chart, so a line
 * answers the pointer wherever it runs.
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
  linePath,
  stackSegments,
  PAD_R_AXIS,
  type TokenBucketKey,
} from "./chart-geom";
import { ChartFrame, DATA_STROKE_W, LineHits, useChartWidth } from "./chart-svg";
import {
  bucketAxisLabel,
  bucketFullLabel,
  foldEntitySeries,
  hitRateValues,
  plotRates,
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

/**
 * A rate in the hover table. A real 0 prints `0%`; a bucket that had nothing
 * to rate has no number at all and prints formatPercent's dash — the same
 * dash the rest of the app uses for an undefined ratio. The 100 those buckets
 * are *drawn* at (NO_RATE_PLOT) never reaches this table: the line is a shape,
 * the table is the data.
 */
function rateCell(v: number | null | undefined): string {
  return formatPercent(v == null ? null : v / 100);
}

/** Text/swatch classes for the i-th drawn entity (the folded tail wears the neutral). */
function entityColor(s: EntitySeries, i: number): SeriesColor {
  return s.other ? NEUTRAL_SERIES : seriesColor(i);
}

// —— Requests + success rate, broken down by entity ——

/**
 * What is currently singled out in a requests chart. `entity` is the series;
 * `bucket` narrows it to one column when the pointer is on a specific bar
 * segment, and is null when the whole series is meant (a legend item or the
 * rate line). One shape for all three affordances, so they cannot disagree
 * about what is lit.
 */
interface RequestsMark {
  entity: number;
  bucket: number | null;
}

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
 * The buckets are the page's compacted ones, and `entities` has been moved
 * onto them by the same kept list (compactCounts), so a column's bars and its
 * rate points come from the same interval. A bucket only one entity ran in is
 * still a bucket: the idle ones sit at zero in it with a dash for their rate.
 *
 * A bucket an entity had nothing to rate in has no rate: the line crosses it
 * at the top of the axis (NO_RATE_PLOT) so the stroke stays continuous, and
 * the bubble's table prints a dash there — never a number the bucket does not
 * have, and never the 0% that would read as "failed everything".
 *
 * Three ways to single out a series, all resolving to one RequestsMark: hover
 * a bar segment (that entity in that bucket), hover a rate line, or hover a
 * legend item (that entity everywhere). The lines are drawn above the bars
 * and their hit bands sit above the bars' too, so a line is never lost behind
 * a tall segment.
 */
export function RequestsChart({
  series,
  entities,
  granularity,
  breaks,
}: {
  series: UsageSeriesPoint[];
  /** Per-entity counts, already re-indexed onto `series` by compactCounts — the stack and its rate lines read them by position. */
  entities: EntityCounts[];
  granularity: UsageGranularity;
  /** Indices after which the series skipped at least one empty bucket (see compactSeries): ChartFrame marks the axis there. */
  breaks?: number[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [mark, setMark] = useState<RequestsMark | null>(null);
  const [ref, width] = useChartWidth();
  const drawn = foldEntitySeries(entities, S.usage.legendOther);
  if (series.length === 0 || drawn.length === 0) return <Empty />;

  const totals = sumCounts(drawn);
  const totalRate = rateSeries(totals);
  // Two readings of the same rates: `rates` keeps the nulls for the table,
  // `lines` gives every bucket a height so the strokes stay unbroken.
  const rates = drawn.map((e) => rateSeries(e));
  const lines = rates.map(plotRates);
  const geom = makeGeom(series.length, niceCountMax(...totals.requests), width, PAD_R_AXIS);
  const rateGeom = makeRangeGeom(series.length, 0, 100, width, PAD_R_AXIS);
  const barW = fitBarWidth(geom.step);
  const buckets = series.map((p) => p.bucket);
  const segs = series.map((_, i) =>
    stackSegments(
      geom,
      drawn.map((e) => e.requests[i] ?? 0),
    ),
  );
  // Highlight = fade out the rest. A mark on a whole series lights all of it; a
  // mark on one segment lights that rect and keeps its own line lit with it, so
  // the bar and the rate it produced are read together.
  const barLit = (entity: number, i: number) =>
    mark === null || (mark.entity === entity && (mark.bucket === null || mark.bucket === i));
  const lineLit = (entity: number) => mark === null || mark.entity === entity;
  const barOpacity = (entity: number, i: number) => {
    if (!barLit(entity, i)) return 0.15;
    return mark === null && hover !== null && hover !== i ? 0.35 : 1;
  };

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
            onHover={(i) => {
              if (i === null) {
                setHover(null);
                setMark(null);
              } else setHover(i);
            }}
            labels={autoLabelIdx(series.length, geom.step)}
            hoverLine={false}
            axisBreaks={breaks}
            rightAxis={{ y: rateGeom.y, ticks: [0, 50, 100], fmt: (v) => `${v}%` }}
            bubble={(i) => (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, buckets[i]!)}</p>
                {drawn.map((e, si) => (
                  <p
                    key={`${e.label}:${si}`}
                    className={`flex items-center gap-1.5 font-mono ${
                      mark?.entity === si ? "font-semibold" : ""
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${entityColor(e, si).swatch}`}
                    />
                    <span className="max-w-32 truncate">{e.label}</span>
                    <span className="ml-auto min-w-8 pl-2 text-right tabular-nums">
                      {e.requests[i] ?? 0}
                    </span>
                    <span className="min-w-10 pl-1.5 text-right tabular-nums">
                      {rateCell(rates[si]![i])}
                    </span>
                  </p>
                ))}
                {drawn.length > 1 && (
                  <p className="flex items-center gap-1.5 font-mono text-gray-500 dark:text-gray-400">
                    <span className="inline-block h-2 w-2 shrink-0" />
                    <span className="max-w-32 truncate">{S.usage.bucketTotal}</span>
                    <span className="ml-auto min-w-8 pl-2 text-right tabular-nums">
                      {totals.requests[i] ?? 0}
                    </span>
                    <span className="min-w-10 pl-1.5 text-right tabular-nums">
                      {rateCell(totalRate[i])}
                    </span>
                  </p>
                )}
              </>
            )}
            hitLayer={[
              // Column hits first (underneath): anywhere in the column reports the bucket.
              ...series.map((_, i) => (
                <rect
                  key={`col-${buckets[i]}`}
                  x={geom.x(i) - geom.step / 2}
                  y={0}
                  width={geom.step}
                  height={geom.y(0)}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => {
                    setHover(i);
                    setMark(null);
                  }}
                />
              )),
              // Per-segment hits next: as wide as the bar, split vertically with no
              // overlap and a minimum height, so a one-request segment is still reachable.
              ...series.map((_, i) =>
                segs[i]!.map((seg) => (
                  <rect
                    key={`seg-${buckets[i]}-${seg.index}`}
                    x={geom.x(i) - barW / 2}
                    y={seg.hitY}
                    width={barW}
                    height={seg.hitH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => {
                      setHover(i);
                      setMark({ entity: seg.index, bucket: i });
                    }}
                  />
                )),
              ),
              // Line hits last, so they win wherever a line crosses a bar.
              ...drawn.map((e, si) => (
                <LineHits
                  key={`line-${e.label}:${si}`}
                  geom={rateGeom}
                  values={lines[si]!}
                  onEnter={(i) => {
                    setHover(i);
                    setMark({ entity: si, bucket: null });
                  }}
                />
              )),
            ]}
          >
            {/* Stacked request bars, bottom-up in list order (1px seams would over-fragment thin bars, so segments sit flush). */}
            {series.map((_, i) =>
              segs[i]!.map((seg) => (
                <rect
                  key={`${buckets[i]}-${seg.index}`}
                  x={geom.x(i) - barW / 2}
                  y={seg.y}
                  width={barW}
                  height={seg.h}
                  className={`${entityColor(drawn[seg.index]!, seg.index).text} transition-opacity duration-150`}
                  fill="currentColor"
                  opacity={barOpacity(seg.index, i)}
                />
              )),
            )}
            {/* One success-rate line per entity on the right-hand scale, in that entity's hue,
                drawn after the bars so a line is never hidden behind a tall segment. Dashed,
                like the Token chart's hit-rate curve: a dash is what tells the reader a stroke
                belongs to the right-hand percentage axis rather than to the bars — and here the
                lines share their entity's bar color, so shape is the only separator left. */}
            {drawn.map((e, si) => (
              <path
                key={`rate-${e.label}:${si}`}
                d={linePath(rateGeom, lines[si]!)}
                fill="none"
                stroke="currentColor"
                strokeWidth={DATA_STROKE_W}
                strokeDasharray="4 3"
                className={`${entityColor(e, si).text} pointer-events-none transition-opacity duration-150`}
                opacity={lineLit(si) ? 1 : 0.15}
              />
            ))}
          </ChartFrame>
          <RequestsLegend
            entities={drawn}
            active={mark?.bucket == null ? (mark?.entity ?? null) : null}
            onHover={(i) => setMark(i === null ? null : { entity: i, bucket: null })}
          />
        </>
      )}
    </div>
  );
}

// —— Token buckets: three-segment stacked bars + a cache-hit-rate curve in front ——

/** Legend keys of the Token chart: the three Token buckets plus the hit-rate curve. */
export type TokenLegendKey = TokenBucketKey | "hitRate";

/** The hovered Token column, and within it the hovered mark (null = the column's empty space — the bubble still reports the whole bucket). */
interface SegHover {
  i: number;
  key: TokenLegendKey | null;
}

/** The hit-rate curve's color classes (amber — distinct from the bars' blue family, CVD-checked against sky in the series palette). */
const HIT_RATE_TEXT = "text-amber-500 dark:text-amber-600";
const HIT_RATE_SWATCH = "bg-amber-500 dark:bg-amber-600";

/**
 * Per-bucket Token buckets → a three-segment stacked bar (SVG, reusing the
 * shared coordinate system and grid), bottom-to-top output → cacheWrite →
 * cacheRead, with the cache hit rate drawn as a dashed line **in front of the
 * bars** on its own right-hand 0–100% axis (same x positions — the two geoms
 * share n / w / padR). A bucket with no cache traffic has no hit rate: the
 * line crosses it at NO_RATE_PLOT rather than dipping to a 0% it did not
 * measure, and the bubble prints a dash for it.
 *
 * The series arrives with its empty buckets already dropped (compactSeries),
 * so the bars run left to right over only the intervals that recorded
 * something; `breaks` is where the axis skipped one. Bars always fit the
 * card: fitBarWidth caps them at 25px and shrinks them with the cell so the
 * chart never scrolls horizontally.
 *
 * Hovering anywhere in a column shows the whole bucket's bubble — all three
 * Token counts plus the hit rate; hovering a segment's own rect additionally
 * highlights just that segment, and hovering the curve's own band highlights
 * the curve alone (per-segment hit bands, see chart-geom's barSegments — small
 * segments have a height floor, otherwise a sub-pixel output segment would be
 * un-hoverable). When legend is passed in (legend hover), it highlights all
 * segments of the matching bucket — or the curve alone for `hitRate`.
 * No hover vertical line is drawn (hoverLine={false}): the bar itself already indicates the x position.
 */
export function TokenBarChart({
  series,
  granularity,
  legend,
  breaks,
}: {
  series: UsageSeriesPoint[];
  granularity: UsageGranularity;
  /** The legend item currently hovered (highlights matching segments / the curve); null = none. */
  legend?: TokenLegendKey | null;
  /** Indices after which the series skipped at least one empty bucket (see compactSeries): ChartFrame marks the axis there. */
  breaks?: number[];
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
  // As in the requests charts: `rates` keeps the nulls for the bubble, `line`
  // gives every bucket a height so the curve stays unbroken.
  const rates = hitRateValues(series);
  const line = plotRates(rates);

  // Highlight = fade out the rest: segment-level hover leaves only "that bucket's that segment" (column-level hover highlights nothing), legend hover leaves all segments of the matching bucket (or the curve alone).
  const dimmed = (i: number, key: TokenBucketKey) =>
    (hover?.key != null && !(hover.i === i && hover.key === key)) ||
    (legend != null && legend !== key);
  const curveDim =
    (legend != null && legend !== "hitRate") || (hover?.key != null && hover.key !== "hitRate");

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
          axisBreaks={breaks}
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
                  rateCell(rates[i]),
                  key === "hitRate",
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
            // The hit-rate curve last, so it answers the pointer where it crosses a bar.
            <LineHits
              key="hit-rate-line"
              geom={rateGeom}
              values={line}
              onEnter={(i) => setHover({ i, key: "hitRate" })}
            />,
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
              d={linePath(rateGeom, line)}
              fill="none"
              stroke="currentColor"
              strokeWidth={DATA_STROKE_W}
              strokeDasharray="5 4"
            />
            {hover !== null && (
              <circle
                cx={rateGeom.x(hover.i)}
                cy={rateGeom.y(line[hover.i] ?? 0)}
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
