/**
 * A weather widget's next hours: the temperature as a line through the hours, each hour's reading
 * above its point and its time under it, and the hour's condition as a small still drawing under
 * that, on the same column.
 *
 * Drawn through the chart primitives at one unit to the pixel, across the width it is given, so
 * it takes the theme's line, curve, points and fill; the line is the accent's ink, the words the
 * muted ink. The vertical scale is the hours' own range, at least six degrees and centred, so a
 * flat day draws a level line through the middle rather than a cliff. Packed hours keep every
 * point and label only every few, so no two labels touch.
 *
 * The line draws in once, left to right (a2ui-motion.css): its length is measured here as it is
 * laid out, and until then it simply shows.
 */
import { useLayoutEffect, useRef } from "react";
import { formatTemp } from "@prismshadow/penguin-core/a2ui";
import type { A2uiLang, A2uiWeatherHour } from "@prismshadow/penguin-core/a2ui";
import { useChartWidth } from "../../charts/chart-frame/chart-frame";
import { roundCoord } from "../../charts/marks/geom";
import { ChartArea, ChartAxis, ChartLine, ChartPoint } from "../../charts/marks/marks";
import type { ChartPaint } from "../../charts/marks/marks";
import { sparklineDomain } from "../../charts/sparkline/sparkline";
import { hourLabel } from "./time-format";
import { WeatherArt } from "./weather-art";
import "./a2ui-motion.css";

/** The plot's height and rows, px: reading labels, the line, the hour labels. */
const HEIGHT = 88;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 60;
const AREA_BASE = 66;
const HOUR_BASELINE = 82;
/** How far a reading's label sits above its point. */
const LABEL_LIFT = 8;
/** Room at each end, so the first and last labels are not cut. */
const SIDE = 16;
/** The least horizontal room a label needs; packed hours label every few. */
const LABEL_ROOM = 36;
/** The smallest span of degrees the scale stands for. */
const MIN_SPAN = 6;
/** The forecast icons' size, px. */
const ART = 14;
/** The width drawn before the container is measured (a static render). */
const FALLBACK_WIDTH = 320;
/** How many hours the accessible name reads out. */
const SPOKEN = 8;

/** The line, its fill and its points: the svg's own ink, the accent. */
const INK: ChartPaint = { ink: "" };

export function WeatherHourly({
  hours,
  unit,
  lang,
  label,
}: {
  hours: readonly A2uiWeatherHour[];
  unit?: "C" | "F";
  lang: A2uiLang;
  /** What the chart is of ("Next hours"); its accessible name reads the hours after it. */
  label: string;
}) {
  const [frame, measured] = useChartWidth();
  const line = useRef<SVGGElement>(null);
  const width = measured > 0 ? measured : FALLBACK_WIDTH;
  const n = hours.length;
  const span = width - 2 * SIDE;
  const step = n > 1 ? span / (n - 1) : span;
  const x = (i: number) => roundCoord(n > 1 ? SIDE + i * step : SIDE + span / 2);
  const temps = hours.map((h) => h.temp);
  const domain = sparklineDomain(temps, "range", MIN_SPAN);
  const y = (t: number) =>
    roundCoord(PLOT_BOTTOM - ((t - domain.low) / domain.span) * (PLOT_BOTTOM - PLOT_TOP));
  const points = hours.map((h, i) => [x(i), y(h.temp)] as const);
  const every = Math.max(1, Math.ceil(LABEL_ROOM / step));
  const labelled = hours.flatMap((h, i) => (i % every === 0 ? [{ hour: h, i }] : []));
  const arts = labelled.flatMap(({ hour, i }) =>
    hour.condition === undefined
      ? []
      : [{ condition: hour.condition, night: hour.night === true, i }],
  );
  const temp = (t: number) => formatTemp(t, unit, false, lang);
  const name = `${label}: ${hours
    .slice(0, SPOKEN)
    .map((h) => `${hourLabel(h.time)} ${temp(h.temp)}`)
    .join(", ")}`;

  // The draw-in's dashes need the line's length, which only layout knows; measured on every
  // render, so a resize mid-animation keeps them true.
  useLayoutEffect(() => {
    const group = line.current;
    const path = group?.querySelector("path");
    if (!group || !path || typeof path.getTotalLength !== "function") return;
    group.style.setProperty("--a2ui-len", String(Math.ceil(path.getTotalLength()) + 1));
  });

  return (
    <div ref={frame} className="w-full min-w-0">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={name}
        // ui-chart: the theme draws the line, its fill, the points and the labels its own way.
        className="ui-chart block text-accent"
      >
        <ChartArea points={points} baseY={AREA_BASE} paint={INK} strength={1} />
        <g ref={line} data-anim="line">
          <ChartLine points={points} paint={INK} />
        </g>
        {points.map(([px, py], i) => (
          <ChartPoint key={i} cx={px} cy={py} paint={INK} />
        ))}
        {labelled.map(({ hour, i }) => (
          <text
            key={`t${i}`}
            data-part="label"
            x={x(i)}
            y={y(hour.temp) - LABEL_LIFT}
            textAnchor="middle"
            fontSize={11}
            className="fill-fg-muted tabular-nums"
          >
            {temp(hour.temp)}
          </text>
        ))}
        {labelled.map(({ hour, i }) => (
          <ChartAxis key={`h${i}`} x={x(i)} y={HOUR_BASELINE} anchor="middle">
            {hourLabel(hour.time)}
          </ChartAxis>
        ))}
      </svg>
      {/* Each hour's condition under its column, still and unnamed: a small picture of what
          the widget's own words say. */}
      {arts.length > 0 && (
        <div aria-hidden className="relative" style={{ height: ART }}>
          {arts.map(({ condition, night, i }) => (
            <span key={i} className="absolute top-0" style={{ left: x(i) - ART / 2 }}>
              <WeatherArt condition={condition} night={night} size={ART} animated={false} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
