/**
 * The score-against-cost view: one point per entry, score up the side and one run's
 * cost, time or tokens along the bottom. Entries no other entry beats on both counts (cheaper and
 * better) form the Pareto frontier, joined by a step line. A small board colours each point as
 * its entry (`colourPoints`, with a legend) and draws the line in ink; a larger one, whose hues
 * would not all tell apart on one plot, gives the frontier points the accent and the rest gray.
 */
import { useLayoutEffect, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import type { LeaderboardEntry } from "../../../lib/hub/types";
import { formatCompact, formatScore, formatUsd } from "../../../lib/hub/text";
import { S } from "../../../lib/strings";
import {
  CHART_FOCUS,
  Readout,
  decimalsOf,
  labelsOf,
  niceScale,
  textWidth,
  useWidth,
} from "./chart-kit";
import type { Scale } from "./chart-kit";
import type { EntryColour } from "./entry-colour";
import type { NameOf } from "./entry-name";
import { Dot } from "./score-table";

type Axis = "cost" | "duration" | "tokens";
const AXES: readonly Axis[] = ["cost", "duration", "tokens"];

const HOUR_MS = 3_600_000;
const RADIUS = 5;
const LABEL_HEIGHT = 14;
/** How close the pointer must come to a point to pick it. */
const HIT_RADIUS = 24;
const MARGIN = { top: 28, right: 4, bottom: 46 };

const along = (entry: LeaderboardEntry, axis: Axis): number =>
  axis === "cost" ? entry.cost : axis === "duration" ? entry.durationMs / HOUR_MS : entry.tokens;

const axisName = (axis: Axis): string => S.hub.leaderboards[axis];

/** A value along the axis at a point's precision. */
function formatAlong(axis: Axis, value: number): string {
  if (axis === "cost") return formatUsd(value);
  if (axis === "duration") return S.hub.leaderboards.hoursShort(value.toFixed(1));
  return formatCompact(value);
}

/** A tick along the axis, with as many decimals as its step needs. */
function formatTick(axis: Axis, value: number, scale: Scale): string {
  if (axis === "cost") {
    return `$${value.toFixed(Math.max(decimalsOf(scale.step), scale.max >= 10 ? 0 : 2))}`;
  }
  if (axis === "duration") {
    return S.hub.leaderboards.hoursShort(value.toFixed(decimalsOf(scale.step)));
  }
  const [unit, suffix] = scale.max >= 1e6 ? [1e6, "M"] : scale.max >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${(value / unit).toFixed(decimalsOf(scale.step / unit))}${suffix}`;
}

/**
 * Whether each point is on the frontier: no other point is at most as costly and at least as
 * good, and strictly one of the two.
 */
function frontierOf(points: readonly { x: number; y: number }[]): boolean[] {
  return points.map(
    (p, i) =>
      !points.some((q, j) => j !== i && q.x <= p.x && q.y >= p.y && (q.x < p.x || q.y > p.y)),
  );
}

/** [lo, hi] widened a little so no point sits on the plot's edge. */
function padded(values: readonly number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  return [lo - pad, hi + pad];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

type TextAnchor = "start" | "middle" | "end";

export function ParetoChart({
  entries,
  nameOf,
  colourOf,
  colourPoints,
}: {
  entries: readonly LeaderboardEntry[];
  nameOf: NameOf;
  colourOf: (entry: LeaderboardEntry) => EntryColour;
  /** Whether each point takes its entry's colour (the board is small enough to tell them apart). */
  colourPoints: boolean;
}) {
  const t = S.hub.leaderboards;
  /** The frontier's step line: the accent beside gray points, ink beside coloured ones. */
  const LINE = colourPoints
    ? "stroke-gray-700 dark:stroke-gray-300"
    : "stroke-brand-600 dark:stroke-brand-300";
  const [axis, setAxis] = useState<Axis>("cost");
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [font, setFont] = useState("");
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (wrapRef.current) setFont(`12px ${getComputedStyle(wrapRef.current).fontFamily}`);
  }, [wrapRef, entries.length]);

  if (entries.length === 0) return null;

  const labels = labelsOf(entries, nameOf);
  const points = entries.map((entry) => ({ x: along(entry, axis), y: entry.value }));
  const onFrontier = frontierOf(points);
  /** Point indices left to right: the keyboard's order, and the step line's. */
  const order = points
    .map((_, i) => i)
    .sort((a, b) => points[a]!.x - points[b]!.x || points[b]!.y - points[a]!.y);
  const frontier = order.filter((i) => onFrontier[i]);

  const height = width < 480 ? 260 : 320;
  const [xLo, xHi] = padded(points.map((p) => p.x));
  const xScale = niceScale(Math.max(0, xLo), xHi);
  const [yLo, yHi] = padded(points.map((p) => p.y));
  const scores = points.every((p) => p.y >= 0 && p.y <= 100);
  const yScale = scores ? niceScale(Math.max(0, yLo), Math.min(100, yHi)) : niceScale(yLo, yHi);
  const measure = (text: string) => (font ? textWidth(text, font) : text.length * 7);

  const yTicks = yScale.ticks.map((tick) => ({
    tick,
    text: tick.toFixed(decimalsOf(yScale.step)),
  }));
  const left = Math.ceil(Math.max(...yTicks.map(({ text }) => measure(text)))) + 10;
  const plotW = Math.max(1, width - left - MARGIN.right);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const baseline = height - MARGIN.bottom;
  const sx = (x: number) => left + ((x - xScale.min) / (xScale.max - xScale.min)) * plotW;
  const sy = (y: number) => MARGIN.top + (1 - (y - yScale.min) / (yScale.max - yScale.min)) * plotH;
  const at = points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
  const xTicks = xScale.ticks.map((tick) => {
    const text = formatTick(axis, tick, xScale);
    const half = measure(text) / 2;
    // A tick label near either end slides inwards rather than off the chart.
    return { tick, text, x: Math.max(half, Math.min(width - half, sx(tick))) };
  });

  // Each step runs across at the cheaper point's score, then up to the better one.
  const step = frontier
    .map((i, k) => (k === 0 ? `M${at[i]!.x},${at[i]!.y}` : `H${at[i]!.x}V${at[i]!.y}`))
    .join("");

  /** A label beside each point where one fits clear of the points, the step line, the axis text and the labels already placed. */
  const placeLabels = () => {
    const obstacles: Box[] = at.map((p) => ({
      x: p.x - RADIUS - 2,
      y: p.y - RADIUS - 2,
      w: 2 * RADIUS + 4,
      h: 2 * RADIUS + 4,
    }));
    for (let k = 1; k < frontier.length; k++) {
      const a = at[frontier[k - 1]!]!;
      const b = at[frontier[k]!]!;
      obstacles.push({ x: a.x, y: a.y - 2, w: b.x - a.x, h: 4 });
      obstacles.push({ x: b.x - 2, y: b.y, w: 4, h: a.y - b.y });
    }
    obstacles.push({ x: 0, y: 0, w: measure(t.score) + 6, h: 16 });
    for (const { tick, text } of yTicks) {
      obstacles.push({ x: 0, y: sy(tick) - 8, w: measure(text) + 14, h: 16 });
    }
    const placed: ({ x: number; y: number; anchor: TextAnchor } | null)[] = at.map(() => null);
    // Frontier points are labelled first, then the rest from the best score down.
    const queue = points
      .map((_, i) => i)
      .sort((a, b) => Number(onFrontier[b]) - Number(onFrontier[a]) || points[b]!.y - points[a]!.y);
    const gap = RADIUS + 4;
    for (const i of queue) {
      const p = at[i]!;
      const w = measure(labels[i]!);
      const above = p.y - gap - LABEL_HEIGHT;
      const below = p.y + gap;
      const beside = p.y - LABEL_HEIGHT / 2;
      // Box left edge, box top, and where the text is anchored.
      const candidates: [number, number, TextAnchor][] = [
        [p.x + gap, beside, "start"],
        [p.x - gap - w, beside, "end"],
        [p.x - w / 2, above, "middle"],
        [p.x - w / 2, below, "middle"],
        [p.x - 4, above, "start"],
        [p.x - 4, below, "start"],
        [p.x + 4 - w, above, "end"],
        [p.x + 4 - w, below, "end"],
      ];
      for (const [x, y, anchor] of candidates) {
        const box = { x, y, w, h: LABEL_HEIGHT };
        if (x < 0 || x + w > width || y < 0 || y + LABEL_HEIGHT > baseline) continue;
        if (obstacles.some((other) => overlaps(box, other))) continue;
        placed[i] = {
          x: anchor === "start" ? x : anchor === "end" ? x + w : x + w / 2,
          y: y + 11,
          anchor,
        };
        obstacles.push({ x: x - 2, y: y - 1, w: w + 4, h: LABEL_HEIGHT + 2 });
        break;
      }
    }
    return placed;
  };
  const placed = width > 0 && font ? placeLabels() : [];

  const pointText = (i: number) =>
    t.paretoPoint(
      labels[i]!,
      formatScore(points[i]!.y),
      axisName(axis),
      formatAlong(axis, points[i]!.x),
    );
  const summary = t.paretoSummary(
    axisName(axis),
    order.map(pointText),
    frontier.map((i) => labels[i]!),
  );

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best: number | null = null;
    let bestDistance = HIT_RADIUS;
    at.forEach((p, i) => {
      const distance = Math.hypot(p.x - x, p.y - y);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    setActive(best);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const position = active === null ? -1 : order.indexOf(active);
    const moves: Record<string, number> = {
      ArrowRight: Math.min(order.length - 1, position + 1),
      ArrowDown: Math.min(order.length - 1, position + 1),
      ArrowLeft: Math.max(0, position - 1),
      ArrowUp: Math.max(0, position - 1),
      Home: 0,
      End: order.length - 1,
      Escape: -1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next === -1 ? null : order[next]!);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (active === null && event.currentTarget.matches(":focus-visible")) {
      setActive(order[0] ?? null);
    }
  };

  const focused = active !== null && active < points.length ? active : null;
  // Frontier points are drawn last, over the rest.
  const drawOrder = points
    .map((_, i) => i)
    .sort((a, b) => Number(onFrontier[a]) - Number(onFrontier[b]));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div
          role="radiogroup"
          aria-label={t.axisLabel}
          className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-800"
        >
          {AXES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={candidate === axis}
              onClick={() => setAxis(candidate)}
              className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
                candidate === axis
                  ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              }`}
            >
              {axisName(candidate)}
            </button>
          ))}
        </div>
        <div
          aria-hidden
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 dark:text-gray-400"
        >
          {colourPoints &&
            entries.map((entry, i) => (
              <span key={`${entry.key}:${i}`} className="flex min-w-0 items-center gap-1.5">
                <Dot colour={colourOf(entry)} />
                <span title={labels[i]} className="max-w-40 truncate">
                  {labels[i]}
                </span>
              </span>
            ))}
          <span className="flex items-center gap-2">
            <svg width="20" height="10" viewBox="0 0 20 10" className="shrink-0">
              <path d="M1 5H19" strokeWidth="2" strokeLinecap="round" className={LINE} />
              {!colourPoints && (
                <circle cx="10" cy="5" r={RADIUS} className="fill-brand-600 dark:fill-brand-300" />
              )}
            </svg>
            {t.frontier}
          </span>
        </div>
      </div>

      <div
        ref={wrapRef}
        role="group"
        tabIndex={0}
        aria-label={t.charts.pareto}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className={`relative mt-4 rounded-sm ${CHART_FOCUS}`}
        style={{ height }}
      >
        {width > 0 && font && (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={summary}
            className="block"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setActive(null);
            }}
          >
            {yTicks.map(({ tick, text }) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - MARGIN.right}
                  y1={sy(tick)}
                  y2={sy(tick)}
                  strokeWidth="1"
                  shapeRendering="crispEdges"
                  className="stroke-gray-100 dark:stroke-gray-800"
                />
                <text
                  x={left - 10}
                  y={sy(tick) + 4}
                  textAnchor="end"
                  className="fill-gray-500 text-xs tabular-nums dark:fill-gray-400"
                >
                  {text}
                </text>
              </g>
            ))}
            <line
              x1={left}
              x2={width - MARGIN.right}
              y1={baseline}
              y2={baseline}
              strokeWidth="1"
              shapeRendering="crispEdges"
              className="stroke-gray-200 dark:stroke-gray-800"
            />
            <text x={0} y={12} className="fill-gray-500 text-xs dark:fill-gray-400">
              {t.score}
            </text>
            {xTicks.map(({ tick, text, x }) => (
              <text
                key={tick}
                x={x}
                y={baseline + 18}
                textAnchor="middle"
                className="fill-gray-500 text-xs tabular-nums dark:fill-gray-400"
              >
                {text}
              </text>
            ))}
            <text
              x={width - MARGIN.right}
              y={height - 6}
              textAnchor="end"
              className="fill-gray-500 text-xs dark:fill-gray-400"
            >
              {axisName(axis)}
            </text>

            {frontier.length > 1 && (
              <path
                d={step}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                className={LINE}
              />
            )}
            {drawOrder.map((i) => (
              <circle
                key={`${entries[i]!.key}:${i}`}
                cx={at[i]!.x}
                cy={at[i]!.y}
                r={RADIUS}
                strokeWidth="2"
                className={`stroke-white dark:stroke-gray-900 ${
                  colourPoints
                    ? colourOf(entries[i]!).fill
                    : onFrontier[i]
                      ? "fill-brand-600 dark:fill-brand-300"
                      : "fill-gray-400 dark:fill-gray-500"
                }`}
              />
            ))}
            {placed.map(
              (label, i) =>
                label && (
                  <text
                    key={`${entries[i]!.key}:${i}`}
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    className={`text-xs ${
                      onFrontier[i]
                        ? "fill-gray-900 dark:fill-gray-100"
                        : "fill-gray-600 dark:fill-gray-400"
                    }`}
                  >
                    {labels[i]}
                  </text>
                ),
            )}
            {focused !== null && (
              <circle
                cx={at[focused]!.x}
                cy={at[focused]!.y}
                r={RADIUS + 4}
                fill="none"
                strokeWidth="1.5"
                className="stroke-gray-900 dark:stroke-gray-100"
              />
            )}
          </svg>
        )}
        {focused !== null && width > 0 && (
          <Readout
            id={`${axis}:${focused}`}
            bound={width}
            anchor={{
              x: at[focused]!.x,
              top: at[focused]!.y - RADIUS - 4,
              bottom: at[focused]!.y + RADIUS + 4,
            }}
          >
            <div className="font-medium text-gray-900 dark:text-gray-100">{labels[focused]}</div>
            <div className="flex gap-3 tabular-nums">
              <span>
                {t.score}{" "}
                <span className="text-gray-900 dark:text-gray-100">
                  {formatScore(points[focused]!.y)}
                </span>
              </span>
              <span>
                {axisName(axis)}{" "}
                <span className="text-gray-900 dark:text-gray-100">
                  {formatAlong(axis, points[focused]!.x)}
                </span>
              </span>
            </div>
          </Readout>
        )}
        <p aria-live="polite" className="sr-only">
          {focused !== null ? pointText(focused) : ""}
        </p>
      </div>
    </div>
  );
}
