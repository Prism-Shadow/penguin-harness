/**
 * A scatter chart from data: each series a set of [x, y] points on two value axes, every point a
 * dot in its series' slot (or its own paint). Each axis runs between round numbers around the
 * data's own extent, not from zero (numeric-geom.ts), with grid lines at the y ticks and the
 * caller's units on every label (`fmtX`, `fmtY`); `min` / `max` bound the y axis. Drawn through the chart primitives at the
 * width it is given, so every theme's points, grid and labels apply.
 *
 * With more than one series a legend sits under the plot; pointing at an item fades the other
 * series. The plot is an image named `label`; `captions` names the axes in rows around it. No
 * hover in this version: a point's own values are what the axes say.
 */
import { useState } from "react";
import { CHART_H } from "../chart-frame/chart-geom";
import { PlotCaptions } from "../cartesian/plot-captions";
import { Legend } from "../legend/legend";
import { roundCoord } from "../marks/geom";
import { ChartAxis, ChartGrid, ChartPoint } from "../marks/marks";
import type { ChartPaint } from "../marks/marks";
import { numericPlot } from "./numeric-geom";

/** A scatter point's size against the theme's point radius: a little larger than a line's dot. */
const POINT_SCALE = 1.4;
/** How far a series the legend is not pointing at fades. */
const FADE = 0.2;

export interface ScatterSeries {
  label: string;
  points: readonly (readonly [number, number])[];
  /** The series' colour; palette slot `i` (its position) when omitted. */
  paint?: ChartPaint;
}

export interface ScatterChartProps {
  series: readonly ScatterSeries[];
  /** The canvas width, px (measured by the caller). */
  width: number;
  /** The canvas height, px. */
  height?: number;
  /** The y axis' bounds. */
  min?: number;
  max?: number;
  /** An x value as its axis prints it, unit included ("2.5 s"). */
  fmtX: (v: number) => string;
  /** A y value as its axis prints it, unit included ("120 ms"). */
  fmtY: (v: number) => string;
  /** The plot's accessible name. */
  label: string;
  /** Show the legend; by default only with more than one series. */
  legend?: boolean;
  /** The axes' names, in rows around the plot. */
  captions?: { x?: string; y?: string };
}

const paintOf = (s: ScatterSeries, i: number): ChartPaint => s.paint ?? { series: i };

export function ScatterChart({
  series,
  width,
  height = CHART_H,
  min,
  max,
  fmtX,
  fmtY,
  label,
  legend = series.length > 1,
  captions,
}: ScatterChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const finite = series.flatMap((s) =>
    s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  );
  const plot = numericPlot({
    xs: finite.map((p) => p[0]),
    ys: finite.map((p) => p[1]),
    width,
    height,
    fmtX,
    fmtY,
    min,
    max,
  });
  return (
    <div data-chart="scatter" className="flex min-w-0 flex-col gap-1.5">
      <PlotCaptions {...captions} inset={plot.padL}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
          // ui-chart: the theme draws the grid, the labels and the points its own way.
          className="ui-chart block text-fg-muted"
        >
          {plot.yTicks.map((tick) => (
            <g key={`y${tick.value}`}>
              <ChartGrid x1={plot.padL} x2={width - plot.padR} y={plot.y(tick.value)} />
              <ChartAxis x={plot.padL - 6} y={plot.y(tick.value) + 3} anchor="end">
                {tick.text}
              </ChartAxis>
            </g>
          ))}
          {plot.xTicks.map((tick) => (
            <ChartAxis key={`x${tick.value}`} x={plot.x(tick.value)} y={height - 6} anchor="middle">
              {tick.text}
            </ChartAxis>
          ))}
          {series.map((s, si) =>
            s.points.map(([px, py], k) =>
              Number.isFinite(px) && Number.isFinite(py) ? (
                <ChartPoint
                  key={`${si}:${k}`}
                  cx={roundCoord(plot.x(px))}
                  cy={roundCoord(plot.y(py))}
                  paint={paintOf(s, si)}
                  scale={POINT_SCALE}
                  opacity={active !== null && active !== si ? FADE : undefined}
                />
              ) : null,
            ),
          )}
        </svg>
      </PlotCaptions>
      {legend && (
        <Legend
          items={series.map((s, i) => ({
            key: String(i),
            label: s.label,
            paint: paintOf(s, i),
            shape: "block" as const,
          }))}
          active={active === null ? null : String(active)}
          onHover={(key) => setActive(key === null ? null : Number(key))}
        />
      )}
    </div>
  );
}
