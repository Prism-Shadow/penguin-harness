/**
 * Cost center stat charts: hand-drawn SVG
 * / flex, no chart library. The form follows the nature of the data —
 * - AgentPieChart: each Agent's call count → a pie chart (compositional
 *   share; each slice's angle is that Agent's share of total calls);
 * - SuccessBarChart: each Model's success rate → a horizontal progress bar
 *   with a 100% track (shows how far from perfect at a glance), filled with
 *   a single uniform color (the bar's length alone conveys magnitude, not a three-color threshold);
 * - TokenBarChart: daily Token buckets → a three-segment stacked bar (one
 *   bar per day, bottom-to-top output → cacheWrite → cacheRead, same blue
 *   family, darkest at the bottom and lightest at the top; bar width fixed
 *   at 25 real pixels, spacing ≥ bar width, scrolls horizontally when it doesn't fit the card).
 * Daily cost reuses TrendChart (line + area fill).
 *
 * Unified highlight interaction (a site-wide convention): highlight = fade
 * out the rest. Pie slices and the legend are linked both ways; the Token
 * bar is **precise down to the segment** — hovering a given day's given
 * bucket lights up only that segment, and the bubble reports only that segment's value (not the whole column's total).
 */
import { useState } from "react";
import type {
  UsageAgentCount,
  UsageSuccessRate,
  UsageTrendPoint,
} from "@prismshadow/penguin-server/api";
import { catalogEntryFor, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { S } from "../../lib/strings";
import { humanizeTokens } from "../../lib/format";
import { TOKEN_COLORS } from "../../lib/token-colors";
import { categoryColor } from "../../lib/category-colors";
import {
  makeGeom,
  autoLabelIdx,
  barSegments,
  cacheHitRate,
  tokenBarLayout,
  pieSlices,
  successRate,
  type TokenBucketKey,
} from "./chart-geom";
import { ChartFrame, useChartWidth } from "./chart-svg";

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

/** Highlight = fade out the rest. */
const DIM = "opacity-25";

// —— Each Agent's call count: pie chart ——

/** Pie chart canvas (square viewBox) and radius: leave a 5px margin so slice edges don't get clipped by the viewBox. */
const PIE_SIZE = 160;
const PIE_R = 75;

/**
 * Each Agent's call count → a pie chart: each slice's angle = that Agent's
 * share of total calls, laid out clockwise from 12 o'clock sorted by
 * requests descending (re-sorted here defensively). Slices and the legend
 * on the right link both ways: hovering either side lights up the other and fades out the rest.
 * When a single Agent holds 100%, pieSlices degrades to a full circle (see chart-geom).
 */
export function AgentPieChart({ data }: { data: UsageAgentCount[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.requests, 0);
  if (data.length === 0 || total <= 0) return <Empty />;

  const rows = [...data].sort((a, b) => b.requests - a.requests);
  const slices = pieSlices(
    rows.map((d) => d.requests),
    PIE_SIZE / 2,
    PIE_SIZE / 2,
    PIE_R,
  );
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const dim = (i: number) => (hover !== null && hover !== i ? DIM : "");

  return (
    <div className="flex items-center gap-3" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`}
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={S.usage.chartAgentCalls}
      >
        {slices.map((s) => {
          const d = rows[s.index]!;
          return (
            <path
              key={d.agentId}
              d={s.path}
              onMouseEnter={() => setHover(s.index)}
              className={`cursor-pointer ${categoryColor(s.index).fill} transition-opacity duration-150 ${dim(s.index)}`}
            >
              <title>{`${d.agentId} · ${d.requests} ${S.usage.requests} · ${pct(d.requests)}`}</title>
            </path>
          );
        })}
      </svg>

      {/* Legend: name + count + share (hover links to the pie slice; a long agentId truncates, with the title giving the full name and total Token count) */}
      <ul className="flex max-h-40 min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
        {rows.map((d, i) => (
          <li
            key={d.agentId}
            onMouseEnter={() => setHover(d.requests > 0 ? i : null)}
            title={`${d.agentId} · ${d.requests} ${S.usage.requests} · ${humanizeTokens(d.total)}`}
            className={`flex cursor-pointer items-center gap-1.5 text-[10px] transition-opacity duration-150 ${dim(i)}`}
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-sm ${categoryColor(i).swatch}`}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-gray-500 dark:text-gray-400">
              {d.agentId}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-gray-500 dark:text-gray-400">
              {d.requests}
            </span>
            <span className="w-8 shrink-0 text-right font-mono tabular-nums text-gray-400 dark:text-gray-500">
              {pct(d.requests)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// —— Each Model's success rate: horizontal progress bar ——

/** A progress bar row's shell: label on the left + track/fill in the middle + value on the right. Fades when hovering a different row. */
function BarRow({
  dimmed,
  onEnter,
  title,
  label,
  value,
  children,
}: {
  dimmed: boolean;
  onEnter: () => void;
  title: string;
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onMouseEnter={onEnter}
      className={`flex cursor-pointer items-center gap-2 transition-opacity duration-150 ${dimmed ? DIM : ""}`}
      title={title}
    >
      <span className="w-24 shrink-0 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {children}
      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
        {value}
      </span>
    </div>
  );
}

/** Row label: falls back from the catalog display name to the upstream id ((provider, modelId) paired lookup against the catalog). */
function successLabel(d: UsageSuccessRate): string {
  return catalogEntryFor(d.provider, d.modelId)?.displayName ?? d.modelId;
}

/**
 * Hover detail: the model's paired reference (upstream id + provider name) +
 * `completed/denominator` + a failure breakdown + excluded aborted runs. The
 * denominator already excludes aborted (the user clicking "stop" isn't a
 * model failure), so aborted is listed as its own item and labeled "not counted".
 */
function successTitle(d: UsageSuccessRate): string {
  const parts = [`${d.completed}/${d.total}`];
  if (d.failed > 0) parts.push(`failed ${d.failed}`);
  if (d.timeout > 0) parts.push(`timeout ${d.timeout}`);
  if (d.malformed > 0) parts.push(`malformed ${d.malformed}`);
  if (d.aborted > 0) parts.push(`${S.usage.successAborted} ${d.aborted}`);
  const provider = providerInfo(d.provider)?.label ?? d.provider;
  return `${d.modelId} · ${provider} · ${parts.join(" · ")}`;
}

/**
 * Each Model's success rate → a horizontal progress bar: the 100% track
 * (light gray) makes "how far from perfect" obvious at a glance, with the
 * percentage shown on the right. Filled with a **single uniform color**
 * (sky, the same primary color family as the Token chart): the bar's length
 * alone already conveys magnitude — a three-color threshold (green/yellow/red) would just re-encode the same information and add two more colors to the page unrelated to any site-wide meaning.
 */
export function SuccessBarChart({ data }: { data: UsageSuccessRate[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <Empty />;
  return (
    <div className="flex flex-col gap-1.5" onMouseLeave={() => setHover(null)}>
      {data.map((d, i) => {
        const rate = successRate(d.completed, d.total);
        const pct = Math.round(rate * 100);
        return (
          <BarRow
            // Row key is a pair: the same model_id can coexist under multiple providers, so using modelId alone would collide.
            key={`${d.provider}:${d.modelId}`}
            dimmed={hover !== null && hover !== i}
            onEnter={() => setHover(i)}
            title={successTitle(d)}
            label={successLabel(d)}
            value={`${pct}%`}
          >
            <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-sm bg-sky-500 dark:bg-sky-400"
                style={{ width: `${rate * 100}%` }}
              />
            </div>
          </BarRow>
        );
      })}
    </div>
  );
}

// —— Daily Token: three-segment stacked bar ——

/** The currently hovered segment: which day (column index), which bucket. */
interface SegHover {
  i: number;
  key: TokenBucketKey;
}

/**
 * Daily Token buckets → a three-segment stacked bar (SVG, reusing
 * TrendChart's coordinate system and grid), bottom-to-top output → cacheWrite → cacheRead.
 *
 * **Bar width fixed at 25 real pixels, spacing ≥ bar width** (see
 * chart-geom's tokenBarLayout): the canvas renders at real pixels per the
 * container's measured width (1 canvas unit = 1 pixel, no scaling); when 30
 * days' worth of n×2×25px doesn't fit a half-width card, the canvas
 * overflows and ChartFrame's container carries horizontal scroll; with few
 * points the bars **never stretch** (25px is a fixed value, not a floor) —
 * all the extra space goes to bar spacing, and the canvas still fills the card without a scrollbar.
 *
 * **Each segment is an independent, individually hoverable rect**: the hit
 * layer swaps ChartFrame's whole-column hit area for a per-segment hit band
 * (see chart-geom's barSegments — the hit band fills the whole bar and small
 * segments have a height floor, otherwise a sub-pixel output segment would
 * be un-hoverable; widening the bar doesn't help the vertical dimension
 * either). Hitting a segment highlights only that segment and fades out
 * everything else; the bubble reports only that segment's date/bucket
 * name/Token count (the cacheRead segment adds that day's cache hit rate,
 * cacheRead / (cacheRead + cacheWrite)). When legend is passed in (legend hover), it highlights all segments of the matching bucket.
 * No hover vertical line is drawn (hoverLine={false}): the bar itself already indicates the x position.
 */
export function TokenBarChart({
  trend,
  legend,
}: {
  trend: UsageTrendPoint[];
  /** The bucket currently hovered in the legend (highlights matching segments); null = none. */
  legend?: TokenBucketKey | null;
}) {
  const [hover, setHover] = useState<SegHover | null>(null);
  // Bar width is a pixel constraint, so the container must be measured
  // first (unmeasured on the first frame → width=0, at which point nothing is rendered — see the ref container below).
  const [ref, width] = useChartWidth();
  if (trend.length === 0) return <Empty />;

  const sums = trend.map((p) => p.cacheRead + p.cacheWrite + p.output);
  const max = Math.max(1, ...sums);
  const { barW, chartW, scroll } = tokenBarLayout(width, trend.length);
  const geom = makeGeom(trend.length, max, chartW);
  const dates = trend.map((p) => p.date);
  const segs = trend.map((p) => barSegments(geom, p));

  // Highlight = fade out the rest: segment-level hover leaves only "that day's that bucket", legend hover leaves all segments of the matching bucket.
  const dimmed = (i: number, key: TokenBucketKey) =>
    (hover !== null && !(hover.i === i && hover.key === key)) || (legend != null && legend !== key);

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => humanizeTokens(Math.round(v))}
          dates={dates}
          hover={hover?.i ?? null}
          // Each cell ≥ 50px: dates can be labeled every day (autoLabelIdx sets the density by cell width, so they never blur together).
          labels={autoLabelIdx(trend.length, geom.step)}
          // The bar itself indicates x position: no hover vertical line spanning the whole chart.
          hoverLine={false}
          // 30 days doesn't fit a half-width card (bar width fixed at 25px): defaults to sitting on the most recent day, scrolling left for earlier ones.
          scrollToEnd={scroll}
          // Per-segment hits go through hitLayer below; ChartFrame only calls back when the mouse leaves the whole chart (i=null).
          onHover={(i) => {
            if (i === null) setHover(null);
          }}
          bubble={(i) => {
            const p = trend[i]!;
            const key = hover?.key;
            if (!key) return null;
            // The cacheRead bubble additionally reports that day's cache hit
            // rate, cacheRead / (cacheRead + cacheWrite); null (denominator 0) omits the line instead of showing 0/0.
            const hitRate = key === "cacheRead" ? cacheHitRate(p.cacheRead, p.cacheWrite) : null;
            return (
              <>
                <p className="text-gray-400">{p.date}</p>
                <p className="font-mono">
                  {bucketLabel(key)} {humanizeTokens(p[key])}
                </p>
                {hitRate !== null && (
                  <p className="font-mono">
                    {S.usage.cacheHitRate} {hitRate}
                  </p>
                )}
              </>
            );
          }}
          hitLayer={trend.map((p, i) =>
            segs[i]!.map((s) => (
              // The hit band is as wide as the bar horizontally (empty space
              // outside the bar doesn't trigger highlighting), and split by
              // segment vertically with no overlap (small segments raised
              // to the minimum hit height, see hitHeights). Highlighting
              // clears as soon as the pointer leaves the bar — otherwise the
              // previous segment's highlight would linger when moving from the bar into the empty space.
              <rect
                key={`hit-${p.date}-${s.key}`}
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
          {trend.map((p, i) =>
            segs[i]!.map((s) => (
              <rect
                key={`${p.date}-${s.key}`}
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
        </ChartFrame>
      )}
    </div>
  );
}

/** Token bar chart legend (cacheRead / cacheWrite / output): hovering an item highlights matching segments (fading out the rest). */
export function TokenLegend({
  active,
  onHover,
}: {
  active?: TokenBucketKey | null;
  onHover?: (key: TokenBucketKey | null) => void;
}) {
  const items: Array<[TokenBucketKey, string]> = [
    ["cacheRead", S.usage.colCacheRead],
    ["cacheWrite", S.usage.colCacheWrite],
    ["output", S.usage.colOutput],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onMouseEnter={() => onHover?.(key)}
          onMouseLeave={() => onHover?.(null)}
          className={`flex items-center gap-1 text-[10px] text-gray-500 transition-opacity duration-150 dark:text-gray-400 ${
            active != null && active !== key ? "opacity-30" : ""
          }`}
        >
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: TOKEN_COLORS[key] }}
          />
          {label}
        </button>
      ))}
    </div>
  );
}
