/**
 * Shared SVG skeleton for the daily trend charts (extracted from the
 * original TrendChart, reused by both the daily Token stacked bar and the
 * daily cost line): 4 horizontal grid lines + y-axis ticks, x-axis dates, a
 * hover vertical indicator line + a transparent hit area + a value bubble
 * that follows the cursor at its lower-right (flipping to the other side of
 * the pointer near the edges, see chart-geom's bubblePosition). "Data marks" (line / area / bars) are drawn by
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
import {
  bubblePosition,
  CHART_H,
  PAD_L,
  PAD_R,
  PAD_T,
  sparseLabelIdx,
  type BubbleView,
  type ChartGeom,
} from "./chart-geom";

/** Bubble size estimate for the frame before the first measurement: the layout effect swaps in the real offsetWidth/offsetHeight before paint, so the estimate itself never shows. */
const BUBBLE_EST = { w: 160, h: 48 };

/** The pointer in canvas coordinates plus the scroll container's visible window at that moment (bubble and content scroll together, so plain content pixels are enough to place it). */
interface PointerAt {
  x: number;
  y: number;
  view: BubbleView;
}

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

  // The bubble follows the pointer (lower-right, flipping at the edges — see
  // chart-geom's bubblePosition): mousemove records the pointer in canvas
  // coordinates together with the visible window at that moment, and the
  // bubble's real size is re-measured after every render (its content
  // changes as hover moves between days/buckets) in a layout effect — i.e.
  // before paint, so neither the first-frame estimate nor a stale size ever shows.
  const [pointer, setPointer] = useState<PointerAt | null>(null);
  const [bubbleSize, setBubbleSize] = useState(BUBBLE_EST);
  const bubbleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    setBubbleSize((s) => (s.w === bw && s.h === bh ? s : { w: bw, h: bh }));
  });

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
    // the bubble is this container's absolutely-positioned child element and scrolls along with the content, so anchoring it to the pointer in content pixels is enough.
    <div ref={scrollRef} className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${CHART_H}`}
        width={w}
        height={CHART_H}
        className="text-gray-600 dark:text-gray-400"
        role="img"
        onMouseLeave={() => {
          onHover(null);
          setPointer(null);
        }}
        // Pointer in canvas coordinates (the svg's top-left is the content
        // origin), plus the visible window read off the scroll container:
        // clamping against the window (not the full canvas) is what keeps
        // the bubble on screen when the Token bar canvas is scrolled.
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const sc = scrollRef.current;
          setPointer({
            x: e.clientX - r.left,
            y: e.clientY - r.top,
            view: sc
              ? { left: sc.scrollLeft, right: sc.scrollLeft + sc.clientWidth, bottom: CHART_H }
              : { left: 0, right: w, bottom: CHART_H },
          });
        }}
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

      {bubble && hover !== null && dates[hover] && pointer && (
        <div
          ref={bubbleRef}
          className="pointer-events-none absolute rounded border border-gray-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-sm dark:border-gray-700 dark:bg-gray-900"
          // Anchored at the pointer's lower-right, flipped to the pointer's
          // other side near the right/bottom edges (see bubblePosition): it
          // never sits under the pointer or hides the hovered mark, and
          // never gets clipped by the visible window (nowrap keeps the
          // measured width the true content width, independent of where the bubble lands).
          style={bubblePosition(pointer.x, pointer.y, bubbleSize.w, bubbleSize.h, pointer.view)}
        >
          {bubble(hover)}
        </div>
      )}
    </div>
  );
}
