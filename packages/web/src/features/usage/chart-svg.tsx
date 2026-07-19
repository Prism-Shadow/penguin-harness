/**
 * Shared SVG skeleton for the daily trend charts (extracted from the
 * original TrendChart, reused by both the daily Token stacked bar and the
 * daily cost line): 4 horizontal grid lines + y-axis ticks, x-axis dates, a
 * hover vertical indicator line + a transparent hit area + a value bubble
 * that follows the cursor. "Data marks" (line / area / bars) are drawn by
 * the caller as children in the same x()/y() coordinate system;
 * see chart-geom.ts for the coordinate math.
 *
 * **1 canvas unit = 1 CSS pixel**: the SVG renders at real pixel width per
 * geom.w (not scaled via viewBox), so sizing requirements like "25px bar
 * width" land on real display pixels. The canvas width is supplied by the
 * caller after measuring the container with useChartWidth; when the canvas
 * is wider than the container (e.g. the Token bar chart stretched out by its bar-width floor), the outer container scrolls horizontally, and the bubble scrolls along with the content.
 *
 * Two hit-granularity tiers: the default is "whole column" (the cost line —
 * a column only has one value); the bar chart passes hitLayer to override
 * it as "per-segment" (a column has three segments, each independently
 * hoverable), in which case hover only serves as the bubble's anchor (a
 * column index).
 * The hover vertical line likewise has two tiers: on the line chart it's a
 * necessary x-position indicator, while on the bar chart the bar itself
 * already indicates the x position — an extra vertical line would just be
 * noise, so the bar chart passes hoverLine={false} to turn it off.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CHART_H, PAD_L, PAD_R, PAD_T, sparseLabelIdx, type ChartGeom } from "./chart-geom";

/** Upper bound on bubble width: clamps the bubble back inside the canvas near the right edge, so it doesn't spuriously trigger extra horizontal scroll. */
const BUBBLE_W = 160;

/**
 * Measure the available width inside the chart card (CSS pixels, rounded
 * down — a few stray tenths of a pixel would otherwise spawn a scrollbar out of nowhere).
 * The canvas is drawn at real pixels, so the container must be measured
 * first; returns 0 before it's measured (the first frame), and the caller
 * skips rendering the chart at that point.
 * What's measured is the **outer plain div** (not the scroll container), whose width is independent of the canvas content and won't trigger the scrollbar back and forth.
 */
export function useChartWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

export function ChartFrame({
  geom,
  fmtY,
  dates,
  hover,
  onHover,
  bubble,
  hitLayer,
  labels,
  hoverLine = true,
  scrollToEnd = false,
  children,
}: {
  geom: ChartGeom;
  /** y-axis tick formatting (abbreviated for Token, currency for cost). */
  fmtY: (v: number) => string;
  /** Each point's date (x-axis labels and the hit area align to this). */
  dates: string[];
  /** Currently hovered column index (the anchor for the vertical line and bubble). */
  hover: number | null;
  /** Callback for the default hit area (whole column); always called with null when the mouse leaves the whole chart. */
  onHover: (i: number | null) => void;
  /** Bubble content while hovering point i (omit to not show a bubble). */
  bubble?: (i: number) => ReactNode;
  /** Custom hit layer (per-segment hits for the bar chart): omit to use the default "whole column" transparent hit area. */
  hitLayer?: ReactNode;
  /** Indices for x-axis labels (omit for the default first/middle/last sparse labeling): the bar chart's cells are each wide, so it can label more via autoLabelIdx. */
  labels?: number[];
  /** Hover vertical indicator line (drawn by default): the bar chart turns it off — the bar itself already indicates the x position, so an extra line is just noise. */
  hoverLine?: boolean;
  /** Scroll to the far right by default when the canvas is wider than the container: the daily chart shows the most recent days first (scroll left for earlier ones). */
  scrollToEnd?: boolean;
  /** Data marks: bars / line / area, drawn between the grid and the hit area. */
  children?: ReactNode;
}) {
  const { x, y, w, innerH, step, max } = geom;
  const gridLevels = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const labelIdx = labels ?? sparseLabelIdx(dates.length);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The daily chart defaults to sitting on the most recent day (there's only
  // room to scroll when the canvas is wider than the container). It
  // re-snaps whenever the data or canvas width changes, without disturbing a position the user has manually scrolled to in the meantime.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!scrollToEnd || !el) return;
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [scrollToEnd, w, dates.length]);

  return (
    // Horizontal scroll when the canvas is wider than the container (bar
    // width has a pixel floor, so 30 days won't fit in a half-width panel);
    // the bubble is this container's absolutely-positioned child element and scrolls along with the content, so anchoring it to the column by pixels is enough.
    <div ref={scrollRef} className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${CHART_H}`}
        width={w}
        height={CHART_H}
        className="text-gray-600 dark:text-gray-400"
        role="img"
        onMouseLeave={() => onHover(null)}
      >
        {/* Grid lines and y-axis ticks (recessive gray) */}
        {gridLevels.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={w - PAD_R}
              y1={y(v)}
              y2={y(v)}
              className="stroke-gray-200 dark:stroke-gray-800"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-gray-400 dark:fill-gray-500"
              fontSize={9}
            >
              {fmtY(v)}
            </text>
          </g>
        ))}

        {/* Hover vertical indicator line (line-chart-only: the bar chart's bar itself is the x indicator, see hoverLine) */}
        {hoverLine && hover !== null && dates[hover] && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD_T}
            y2={PAD_T + innerH}
            className="stroke-gray-300 dark:stroke-gray-700"
            strokeWidth={1}
          />
        )}

        {/* Data marks (provided by the caller) */}
        {children}

        {/* x-axis dates */}
        {labelIdx.map((i) => {
          const d = dates[i];
          if (!d) return null;
          return (
            <text
              key={i}
              x={x(i)}
              y={CHART_H - 6}
              textAnchor="middle"
              className="fill-gray-400 dark:fill-gray-500"
              fontSize={9}
            >
              {d.slice(5)}
            </text>
          );
        })}

        {/* Hover hit area (larger than the mark itself): whole column by default, the bar chart swaps in hitLayer for per-segment */}
        {hitLayer ??
          dates.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={PAD_L + step * i}
              y={PAD_T}
              width={step}
              height={innerH}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => onHover(i)}
            />
          ))}
      </svg>

      {bubble && hover !== null && dates[hover] && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-900"
          // Anchored near that column's left edge, clamped back inside the
          // canvas (1 unit = 1 pixel, positioned directly in pixels; the
          // left edge can't be negative, since the scroll container would clip off the part that sticks out).
          style={{ left: `${Math.max(0, Math.min(x(hover) - 30, w - BUBBLE_W))}px` }}
        >
          {bubble(hover)}
        </div>
      )}
    </div>
  );
}
