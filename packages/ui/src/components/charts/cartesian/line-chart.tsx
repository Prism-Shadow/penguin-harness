/**
 * A line chart from data: each series a line through its categories, a dot on every point while
 * the columns are wide enough to keep the dots apart. `area` fills under each line; `stacked`
 * (with `area`) piles the series into bands, each filling down to the one under it. A null value
 * is no reading: the line breaks there and resumes after it, and a reading with no neighbour is a
 * lone dot. In a stacked area a null counts as nothing, so the bands stay closed.
 *
 * Two frames:
 * - `plot` (the default): the plot frame (ChartFrame) — grid, a value axis from zero to a round
 *   number above the data (`min` / `max` set it otherwise: a `min` zooms in on the data), category
 *   labels shortened and thinned to fit (none at all, and no room kept for them, when the
 *   categories have no names: readings with no times), and hover: pointing at a column draws the
 *   cursor, grows the column's dots and opens the bubble with each series' value.
 * - `bare`: no grid, no value axis and no hover — a line across the width with its category
 *   labels under it, on the readings' own range (at least `minSpan` wide, centred) so a flat run
 *   draws level through the middle rather than along an edge: an hourly forecast.
 *
 * `pointLabels` writes each value over its point, as many as fit. `drawIn` traces the lines in
 * once, left to right (line-chart.css: data motion, still under reduced motion). Values print with
 * the caller's `fmtValue`, units included; categories with `fmtCategory`. Series `i` paints in
 * palette slot `i` unless it names a paint; with more than one series a legend sits under the
 * plot, and pointing at an item fades the other lines. The plot is an image named `label`;
 * `captions` names the axes in rows around it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ChartFrame } from "../chart-frame/chart-frame";
import { CHART_H } from "../chart-frame/chart-geom";
import { roundCoord } from "../marks/geom";
import { ChartArea, ChartAxis, ChartLabel, ChartLine, ChartPoint } from "../marks/marks";
import { sparklineDomain } from "../sparkline/sparkline";
import { gapRuns, isReading, niceDomain, seriesPaint, stackLevels } from "./cartesian-data";
import type { CartesianSeries } from "./cartesian-data";
import { PlotCaptions } from "./plot-captions";
import {
  BARE_SIDE,
  bareColumns,
  everyNth,
  LABEL_FONT,
  labelStride,
  valuePlot,
} from "./plot-layout";
import { SeriesBubble, SeriesLegend } from "./series-readout";
import "./line-chart.css";

/** The bare frame's height, px: value labels, the line, the category labels. */
const BARE_H = 88;
/** The bare frame's rows, measured from its bottom: the plot's foot, the fill's foot, the labels. */
const BARE_PLOT_FOOT = 28;
const BARE_AREA_FOOT = 22;
const BARE_LABEL_FOOT = 6;
/** The bare frame's top margin: room for the value labels, or only for the dots' radius. */
const BARE_TOP_LABELLED = 24;
const BARE_TOP = 8;
/** How far a value's label sits above its point. */
const LABEL_LIFT = 8;
/** Column width below which only lone points and the hovered column keep their dots, px. */
const MIN_DOT_STEP = 8;
/** How far a series the legend is not pointing at fades. */
const FADE_SERIES = 0.25;

const same = (text: string) => text;

export interface LineChartProps {
  /** The x labels, one per point. */
  categories: readonly string[];
  series: readonly CartesianSeries[];
  /** The canvas width, px (measured by the caller). */
  width: number;
  /** The canvas height, px: 200 in the plot frame, 88 bare. */
  height?: number;
  /** Fill under each line. */
  area?: boolean;
  /** With `area`, pile the series into bands. */
  stacked?: boolean;
  frame?: "plot" | "bare";
  /** Write each value over its point. */
  pointLabels?: boolean;
  /** Trace the lines in once as they appear. */
  drawIn?: boolean;
  /** The bare frame's least vertical span, in the values' unit. */
  minSpan?: number;
  /** The value axis' bounds. */
  min?: number;
  max?: number;
  /** A value as the ticks, the labels and the bubble print it, unit included ("21°", "120 ms"). */
  fmtValue: (v: number) => string;
  /** A category as the axis and the bubble print it. */
  fmtCategory?: (c: string) => string;
  /** The plot's accessible name. */
  label: string;
  /** Show the legend; by default only with more than one series. */
  legend?: boolean;
  /** The axes' names, in rows around the plot. */
  captions?: { x?: string; y?: string };
}

/** Where the marks go: a column's x, a value's y, the fill's foot. */
interface Scale {
  x: (i: number) => number;
  y: (v: number) => number;
  base: number;
}

/** The lines, fills, dots and value labels of every series on one scale. */
function SeriesMarks({
  series,
  scale,
  area,
  stacked,
  everyDot,
  hover,
  active,
  labelled,
  fmtValue,
  drawIn,
  drawRef,
}: {
  series: readonly CartesianSeries[];
  scale: Scale;
  area: boolean;
  stacked: boolean;
  everyDot: boolean;
  hover: number | null;
  active: number | null;
  /** The columns whose values are written over their points. */
  labelled: readonly number[];
  fmtValue: (v: number) => string;
  drawIn: boolean;
  drawRef: RefObject<SVGGElement | null>;
}) {
  const { x, y, base } = scale;
  const at = (index: number, value: number) =>
    [roundCoord(x(index)), roundCoord(y(value))] as const;
  const fills: ReactNode[] = [];
  const lines: ReactNode[] = [];
  const dots: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const showLabel = new Set(labelled);
  const levels = stacked ? stackLevels(series.map((s) => s.values)) : null;

  series.forEach((s, si) => {
    const paint = seriesPaint(s, si);
    const faded = active !== null && active !== si;
    // A stacked band runs unbroken along its layer's top; a free line breaks at each gap.
    const runs = levels
      ? [levels[si]!.map((value, index) => ({ index, value }))]
      : gapRuns(s.values);
    runs.forEach((run, ri) => {
      const points = run.map((p) => at(p.index, p.value));
      const key = `${si}:${ri}`;
      if (area) {
        const floor =
          levels && si > 0 ? run.map((p) => at(p.index, levels[si - 1]![p.index]!)) : undefined;
        fills.push(
          <ChartArea
            key={key}
            points={points}
            baseY={base}
            floor={floor}
            paint={paint}
            strength={faded ? FADE_SERIES : 1}
          />,
        );
      }
      if (points.length > 1) {
        lines.push(
          <ChartLine key={key} points={points} paint={paint} opacity={faded ? FADE_SERIES : 1} />,
        );
      }
      run.forEach((p, k) => {
        const own = s.values[p.index];
        const hovered = hover === p.index;
        if (everyDot || run.length === 1 || hovered) {
          dots.push(
            <ChartPoint
              key={`${key}:${p.index}`}
              cx={points[k]![0]}
              cy={points[k]![1]}
              paint={paint}
              grow={hovered}
              opacity={faded ? FADE_SERIES : undefined}
            />,
          );
        }
        if (showLabel.has(p.index) && isReading(own)) {
          labels.push(
            <ChartLabel key={`${key}:${p.index}`} x={points[k]![0]} y={points[k]![1] - LABEL_LIFT}>
              {fmtValue(own)}
            </ChartLabel>,
          );
        }
      });
    });
  });

  return (
    <>
      {fills}
      <g ref={drawRef} {...(drawIn ? { "data-anim": "draw" } : {})}>
        {lines}
      </g>
      {dots}
      {labels}
    </>
  );
}

/** The value texts the chart would write over its points (to judge how many fit). */
const valueTexts = (series: readonly CartesianSeries[], fmt: (v: number) => string) =>
  series.flatMap((s) => s.values.filter(isReading).map(fmt));

export function LineChart({
  categories,
  series,
  width,
  height,
  area = false,
  stacked = false,
  frame = "plot",
  pointLabels = false,
  drawIn = false,
  minSpan = 1,
  min,
  max,
  fmtValue,
  fmtCategory = same,
  label,
  legend = series.length > 1,
  captions,
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const drawRef = useRef<SVGGElement>(null);
  const stack = area && stacked;
  const names = categories.map(fmtCategory);
  const texts = pointLabels ? valueTexts(series, fmtValue) : [];
  const mark = area ? "area" : "line";

  // The draw-in's dashes need each line's length, which only layout knows; measured on every
  // render, so a resize mid-trace keeps them true.
  useLayoutEffect(() => {
    if (!drawIn) return;
    for (const path of drawRef.current?.querySelectorAll("path") ?? []) {
      if (typeof path.getTotalLength !== "function") continue;
      path.style.setProperty("--_chart-len", String(Math.ceil(path.getTotalLength()) + 1));
    }
  });

  const legendRow = legend && (
    <SeriesLegend series={series} mark={mark} active={active} onHover={setActive} />
  );

  if (frame === "bare") {
    const h = height ?? BARE_H;
    const top = pointLabels ? BARE_TOP_LABELLED : BARE_TOP;
    const foot = h - BARE_PLOT_FOOT;
    const levels = stack ? stackLevels(series.map((s) => s.values)) : null;
    const readings = levels ? levels.flat() : series.flatMap((s) => s.values.filter(isReading));
    const fit = sparklineDomain(readings, "range", Math.max(minSpan, Number.EPSILON));
    const low = isReading(min) ? min : fit.low;
    const high = isReading(max) ? max : fit.low + fit.span;
    const span = high > low ? high - low : 1;
    const columns = bareColumns(width, names, texts);
    const scale: Scale = {
      x: columns.x,
      y: (v) => foot - ((v - low) / span) * (foot - top),
      base: h - BARE_AREA_FOOT,
    };
    return (
      <div data-chart="line" className="flex min-w-0 flex-col gap-1.5">
        <PlotCaptions {...captions} inset={BARE_SIDE}>
          <svg
            width={width}
            height={h}
            viewBox={`0 0 ${width} ${h}`}
            role="img"
            aria-label={label}
            // ui-chart: the theme draws the lines, fills, points and labels its own way.
            className="ui-chart block text-fg-muted"
          >
            <SeriesMarks
              series={series}
              scale={scale}
              area={area}
              stacked={stack}
              everyDot
              hover={null}
              active={active}
              labelled={pointLabels ? columns.labelled : []}
              fmtValue={fmtValue}
              drawIn={drawIn}
              drawRef={drawRef}
            />
            {columns.labelled.map((i) => (
              <ChartAxis key={i} x={columns.x(i)} y={h - BARE_LABEL_FOOT} anchor="middle">
                {names[i]}
              </ChartAxis>
            ))}
          </svg>
        </PlotCaptions>
        {legendRow}
      </div>
    );
  }

  const domain = niceDomain(
    series.map((s) => s.values),
    { min, max, stacked: stack },
  );
  const { geom, ticks, tickText, axis } = valuePlot({
    categories: names,
    domain,
    width,
    height: height ?? CHART_H,
    fmtValue,
  });
  const floor = Math.min(geom.max, Math.max(geom.min, 0));
  const labelled = pointLabels
    ? everyNth(categories.length, labelStride(texts, geom.step, LABEL_FONT))
    : [];
  return (
    <div data-chart="line" className="flex min-w-0 flex-col gap-1.5">
      <PlotCaptions {...captions} inset={geom.padL}>
        <ChartFrame
          geom={geom}
          fmtY={tickText}
          yTicks={ticks}
          dates={axis.text}
          fmtX={same}
          labels={axis.shown}
          hover={hover}
          onHover={setHover}
          label={label}
          bubble={(i) => (
            <SeriesBubble
              title={names[i] ?? ""}
              series={series}
              index={i}
              mark={mark}
              fmtValue={fmtValue}
            />
          )}
        >
          <SeriesMarks
            series={series}
            scale={{ x: geom.x, y: geom.y, base: geom.y(floor) }}
            area={area}
            stacked={stack}
            everyDot={geom.step >= MIN_DOT_STEP}
            hover={hover}
            active={active}
            labelled={labelled}
            fmtValue={fmtValue}
            drawIn={drawIn}
            drawRef={drawRef}
          />
        </ChartFrame>
      </PlotCaptions>
      {legendRow}
    </div>
  );
}
