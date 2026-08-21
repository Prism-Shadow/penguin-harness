/**
 * Cost center stat charts: hand-drawn SVG / flex, no chart library. Every
 * chart is a time series over the page's shared date range and precision —
 * - RequestsChart: the requests + success-rate combo — request bars from the
 *   bottom on the left axis, the success-rate line on top against its own
 *   right-hand 0–100% axis (a dot marks the line's end), a legend underneath.
 *   A dimension toggle (by Agent / by Model) and an entity dropdown live in
 *   the card header: "all" stacks the bars by entity (top entities keep their
 *   own CVD-checked hue, the tail folds into a neutral "other") under the
 *   overall success line; picking one entity shows that entity's bars and its
 *   own success line — the per-model success rate, labeled.
 * - TokenBarChart: per-bucket Token buckets as a three-segment stacked bar
 *   (bottom-to-top output → cacheWrite → cacheRead, same blue family, darkest
 *   at the bottom), with the cache hit rate as a dashed smooth curve **in
 *   front of the bars** on its own right-hand 0–100% axis — continuous: a
 *   bucket with no cache traffic counts as 0, never a gap. Bars always fit
 *   the card (fitBarWidth) — the charts never scroll.
 * Cost reuses TrendChart (straight line + points + area fill).
 *
 * Unified highlight interaction (a site-wide convention): highlight = fade
 * out the rest. Hovering anywhere in a Token column reports the whole bucket
 * (all three Token buckets plus the hit rate); hovering a segment additionally
 * highlights just that segment.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatPercent, humanizeTokens } from "../../lib/format";
import { TOKEN_COLORS } from "../../lib/token-colors";
import { seriesColor } from "../../lib/category-colors";
import { Select } from "../../components/ui/select";
import {
  makeGeom,
  makeRangeGeom,
  autoLabelIdx,
  barSegments,
  fitBarWidth,
  linePath,
  monotonePath,
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
  successRateValues,
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

/** The neutral color of the folded "other" series (a line series color, not a category hue). */
const OTHER_SERIES = {
  text: "text-gray-400 dark:text-gray-500",
  swatch: "bg-gray-400 dark:bg-gray-500",
};

/** The single-entity bar color (the site's primary blue, like the Token chart's family). */
const SINGLE_BAR = { text: "text-sky-500 dark:text-sky-400", swatch: "bg-sky-500 dark:bg-sky-400" };

/** The success-rate line's color classes (distinct from every bar hue). */
const RATE_TEXT = "text-emerald-500 dark:text-emerald-400";
const RATE_SWATCH = "bg-emerald-500 dark:bg-emerald-400";

/** Text/swatch classes for the i-th stacked series (the folded tail is neutral). */
function stackColor(s: EntitySeries, i: number): { text: string; swatch: string } {
  return s.other ? OTHER_SERIES : seriesColor(i);
}

// —— Requests + success rate: the dual-axis combo ——

/** The requests chart's dimension: stack/pick by Agent or by Model. */
export type RequestsDimension = "agent" | "model";

/** One selectable entity of the requests chart, shaped by the page from byAgentSeries / byModelSeries. */
export interface RequestsEntity {
  label: string;
  requests: number[];
  completed: number[];
  denominator: number[];
}

/**
 * The combo card's header controls: the dimension toggle and the entity
 * dropdown ("all" = stack every entity). Lives in the card header (ChartCard's
 * extra), so the state is lifted to the page like the other chart legends.
 */
export function RequestsControls({
  dim,
  onDim,
  entities,
  entity,
  onEntity,
}: {
  dim: RequestsDimension;
  onDim: (d: RequestsDimension) => void;
  entities: RequestsEntity[];
  /** Index into entities as a string; "" = all. */
  entity: string;
  onEntity: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select
        size="sm"
        value={dim}
        aria-label={S.usage.dimLabel}
        onChange={(e) => onDim(e.target.value as RequestsDimension)}
      >
        <option value="agent">{S.usage.dimByAgent}</option>
        <option value="model">{S.usage.dimByModel}</option>
      </Select>
      <Select
        size="sm"
        value={entity}
        aria-label={S.usage.entityLabel}
        onChange={(e) => onEntity(e.target.value)}
      >
        <option value="">
          {dim === "agent" ? S.usage.filterAllAgents : S.usage.filterAllModels}
        </option>
        {entities.map((s, i) => (
          <option key={`${s.label}:${i}`} value={String(i)}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Legend row under the combo chart: square swatches for the bar series, a round dot for the success-rate line. */
function RequestsLegend({ bars }: { bars: Array<{ label: string; swatch: string }> }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 dark:text-gray-400">
      {bars.map((b) => (
        <span key={b.label} className="flex min-w-0 items-center gap-1.5">
          <span className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${b.swatch}`} />
          <span className="max-w-40 truncate font-mono">{b.label}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${RATE_SWATCH}`} />
        {S.usage.legendSuccessRate}
      </span>
    </div>
  );
}

/**
 * Requests per bucket + success rate → the dual-axis combo: bars from the
 * bottom (left axis, requests), the success-rate polyline on top (right axis,
 * fixed 0–100%, a dot at the line's end). With no entity selected the bars
 * stack by entity and the line is the overall rate; with one selected both
 * marks narrow to that entity. An idle bucket draws 0 requests and a 100%
 * rate (the site-wide "no requests = nothing failed" convention).
 */
export function RequestsChart({
  series,
  entities,
  selected,
  granularity,
}: {
  series: UsageSeriesPoint[];
  entities: RequestsEntity[];
  /** Index into entities; null = all (stacked). */
  selected: number | null;
  granularity: UsageGranularity;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  if (series.length === 0) return <Empty />;

  const one = selected !== null ? entities[selected] : undefined;
  const stacked: EntitySeries[] = one ? [] : foldEntitySeries(entities, S.usage.callsOther);
  const totals = one
    ? one.requests
    : series.map((_, i) => stacked.reduce((s, e) => s + (e.requests[i] ?? 0), 0));
  const rate = one ? rateSeries(one) : successRateValues(series);

  const maxReq = Math.max(1, ...totals);
  const geom = makeGeom(series.length, maxReq, width, PAD_R_AXIS);
  const rateGeom = makeRangeGeom(series.length, 0, 100, width, PAD_R_AXIS);
  const barW = fitBarWidth(geom.step);
  const buckets = series.map((p) => p.bucket);
  const legendBars = one
    ? [{ label: one.label, swatch: SINGLE_BAR.swatch }]
    : stacked.map((s, i) => ({ label: s.label, swatch: stackColor(s, i).swatch }));

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
                {one ? (
                  <p className="flex items-center gap-1.5 font-mono">
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${SINGLE_BAR.swatch}`}
                    />
                    <span className="max-w-40 truncate">{one.label}</span>
                    <span className="ml-auto pl-2 tabular-nums">{one.requests[i] ?? 0}</span>
                  </p>
                ) : (
                  stacked.map((s, si) => (
                    <p key={s.label} className="flex items-center gap-1.5 font-mono">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${stackColor(s, si).swatch}`}
                      />
                      <span className="max-w-40 truncate">{s.label}</span>
                      <span className="ml-auto pl-2 tabular-nums">{s.requests[i] ?? 0}</span>
                    </p>
                  ))
                )}
                <p className="flex items-center gap-1.5 font-mono">
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${RATE_SWATCH}`} />
                  {S.usage.legendSuccessRate}
                  <span className="ml-auto pl-2 tabular-nums">
                    {formatPercent((rate[i] ?? 100) / 100)}
                  </span>
                </p>
              </>
            )}
          >
            {/* Bars: a single entity's plain bars, or the all-entities stack (bottom-up in list order, 1px seams between segments would over-fragment thin bars, so segments sit flush). */}
            {one
              ? one.requests.map((v, i) =>
                  v > 0 ? (
                    <rect
                      key={buckets[i]}
                      x={geom.x(i) - barW / 2}
                      y={geom.y(v)}
                      width={barW}
                      height={geom.y(0) - geom.y(v)}
                      className={`${SINGLE_BAR.text} transition-opacity duration-150`}
                      fill="currentColor"
                      opacity={hover !== null && hover !== i ? 0.35 : 1}
                    />
                  ) : null,
                )
              : series.map((_, i) => {
                  let cum = 0;
                  return stacked.map((s, si) => {
                    const v = s.requests[i] ?? 0;
                    if (v <= 0) return null;
                    const y0 = geom.y(cum);
                    cum += v;
                    const y1 = geom.y(cum);
                    return (
                      <rect
                        key={`${buckets[i]}-${s.label}`}
                        x={geom.x(i) - barW / 2}
                        y={y1}
                        width={barW}
                        height={y0 - y1}
                        className={`${stackColor(s, si).text} transition-opacity duration-150`}
                        fill="currentColor"
                        opacity={hover !== null && hover !== i ? 0.35 : 1}
                      />
                    );
                  });
                })}
            {/* Success-rate polyline on the right-hand scale, a dot at its end (and one under the pointer). */}
            <g className={`${RATE_TEXT} pointer-events-none`}>
              <path
                d={linePath(rateGeom, rate)}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              />
              {rate.length > 0 && (
                <circle
                  cx={rateGeom.x(rate.length - 1)}
                  cy={rateGeom.y(rate[rate.length - 1]!)}
                  r={3}
                  className="fill-current"
                />
              )}
              {hover !== null && hover !== rate.length - 1 && (
                <circle
                  cx={rateGeom.x(hover)}
                  cy={rateGeom.y(rate[hover] ?? 100)}
                  r={3}
                  className="fill-current"
                />
              )}
            </g>
          </ChartFrame>
          <RequestsLegend bars={legendBars} />
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
