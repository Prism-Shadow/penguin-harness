/**
 * A bar chart from data: a column per category, and in it a bar per series — side by side
 * (grouped, the default), one on another (`stacked`), or filling the column edge to edge
 * (`flush`: a histogram's bins, one series of counts). Drawn in the plot frame (ChartFrame) at the
 * width it is given, through the chart primitives, so every theme's bars, grid and labels apply.
 *
 * A bar's length is read from zero, so zero is always on the value axis: the axis runs from zero
 * (or the lowest negative value) to a round number above the tallest bar or stack, and the
 * caller's `min` and `max` set it otherwise (a `min` above zero is not honoured: a bar cut off at
 * its foot misreads). The tick labels and the hover bubble print values with the caller's
 * `fmtValue`, units included; the category labels print with `fmtCategory`, shortened and
 * thinned when columns are narrow.
 *
 * Series `i` paints in palette slot `i` unless it names a paint. With more than one series a
 * legend sits under the plot; pointing at an item fades the other series. Pointing at a column
 * fades the other columns and opens the bubble: the category, then each series' value. A null
 * value draws no bar (and "—" in the bubble).
 *
 * The plot is an image named `label`; `captions` names the axes in rows around it.
 */
import { useState } from "react";
import { ChartFrame } from "../chart-frame/chart-frame";
import { CHART_H, stackSegments } from "../chart-frame/chart-geom";
import { ChartBar, useBarWidth } from "../marks/marks";
import { isReading, niceDomain, seriesPaint } from "./cartesian-data";
import type { CartesianSeries } from "./cartesian-data";
import { PlotCaptions } from "./plot-captions";
import { valuePlot } from "./plot-layout";
import { SeriesBubble, SeriesLegend } from "./series-readout";

/**
 * The share of a column a group of side-by-side bars may take (each bar is the theme's share of
 * its part of it); the rest separates the groups. A group's bars stand next to each other, a
 * hairline apart, so a group reads as one category.
 */
const GROUP_FILL = 0.8;
const GROUP_GAP = 2;
/** How far a series the legend is not pointing at fades, and a column the pointer is not on. */
const FADE_SERIES = 0.15;
const FADE_COLUMN = 0.35;

const same = (text: string) => text;

export interface BarChartProps {
  /** The x labels, one per column. */
  categories: readonly string[];
  series: readonly CartesianSeries[];
  /** The canvas width, px (measured by the caller). */
  width: number;
  /** The canvas height, px. */
  height?: number;
  /** Stack the series in each column instead of setting them side by side. */
  stacked?: boolean;
  /** Bars fill their column (a histogram's bins). */
  flush?: boolean;
  /** The value axis' bounds; zero is always on it. */
  min?: number;
  max?: number;
  /** A value as the ticks and the bubble print it, unit included ("120 ms"). */
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

export function BarChart({
  categories,
  series,
  width,
  height = CHART_H,
  stacked = false,
  flush = false,
  min,
  max,
  fmtValue,
  fmtCategory = same,
  label,
  legend = series.length > 1,
  captions,
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const domain = niceDomain(
    series.map((s) => s.values),
    {
      min: isReading(min) ? Math.min(min, 0) : undefined,
      max: isReading(max) ? Math.max(max, 0) : undefined,
      stacked,
    },
  );
  const names = categories.map(fmtCategory);
  const { geom, ticks, tickText, axis } = valuePlot({
    categories: names,
    domain,
    width,
    height,
    fmtValue,
  });
  const zero = geom.y(0);
  const grouped = !stacked && series.length > 1;
  const band = grouped ? (geom.step * GROUP_FILL) / series.length : geom.step;
  const pitch = useBarWidth(band) + GROUP_GAP;
  const opacity = (s: number, column: number) =>
    active !== null && active !== s
      ? FADE_SERIES
      : hover !== null && hover !== column
        ? FADE_COLUMN
        : undefined;

  const bars = categories.flatMap((_, column) => {
    const cx = geom.x(column);
    if (stacked) {
      const segments = stackSegments(
        geom,
        series.map((s) => {
          const v = s.values[column];
          return isReading(v) ? v : 0;
        }),
      );
      return segments.map((seg, k) => (
        <ChartBar
          key={`${column}:${seg.index}`}
          cx={cx}
          band={band}
          y={seg.y}
          height={seg.h}
          paint={seriesPaint(series[seg.index]!, seg.index)}
          top={k === segments.length - 1}
          flush={flush}
          opacity={opacity(seg.index, column)}
        />
      ));
    }
    return series.flatMap((s, i) => {
      const v = s.values[column];
      if (!isReading(v)) return [];
      const at = grouped ? cx + (i - (series.length - 1) / 2) * pitch : cx;
      const y = geom.y(v);
      return [
        <ChartBar
          key={`${column}:${i}`}
          cx={at}
          band={band}
          y={Math.min(y, zero)}
          height={Math.abs(zero - y)}
          paint={seriesPaint(s, i)}
          // A negative bar hangs from zero: its rounded end is at the bottom, not drawn.
          top={v >= 0}
          flush={flush}
          opacity={opacity(i, column)}
        />,
      ];
    });
  });

  return (
    <div data-chart="bar" className="flex min-w-0 flex-col gap-1.5">
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
          hoverLine={false}
          label={label}
          bubble={(i) => (
            <SeriesBubble
              title={names[i] ?? ""}
              series={series}
              index={i}
              mark="bar"
              fmtValue={fmtValue}
            />
          )}
        >
          <g>{bars}</g>
        </ChartFrame>
      </PlotCaptions>
      {legend && <SeriesLegend series={series} mark="bar" active={active} onHover={setActive} />}
    </div>
  );
}
