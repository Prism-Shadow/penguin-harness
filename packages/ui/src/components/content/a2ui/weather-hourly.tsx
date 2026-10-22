/**
 * A weather widget's next hours: a line chart of the temperature through the hours in its bare
 * frame — each hour's reading above its point and its time under it — and the hour's condition as
 * a small still drawing under that, on the same column.
 *
 * The chart is the basic LineChart: it takes the theme's line, curve, points and fill, scales to
 * the hours' own range (at least six degrees, centred, so a flat day draws a level line through
 * the middle rather than a cliff), labels as many hours as fit, and traces the line in once, left
 * to right, under the chart's own motion rules. The line is the accent's ink. What is the
 * widget's own is the row of drawings, placed with the chart's columns so each sits under its
 * hour.
 */
import { formatTemp } from "@prismshadow/penguin-core/a2ui";
import type { A2uiLang, A2uiWeatherHour } from "@prismshadow/penguin-core/a2ui";
import { LineChart } from "../../charts/cartesian/line-chart";
import { bareColumns } from "../../charts/cartesian/plot-layout";
import { useChartWidth } from "../../charts/chart-frame/chart-frame";
import type { ChartPaint } from "../../charts/marks/marks";
import { hourLabel } from "./time-format";
import { WeatherArt } from "./weather-art";

/** The smallest span of degrees the scale stands for. */
const MIN_SPAN = 6;
/** The forecast icons' size, px. */
const ART = 14;
/** The width drawn before the container is measured (a static render). */
const FALLBACK_WIDTH = 320;
/** How many hours the accessible name reads out. */
const SPOKEN = 8;

/** The line, its fill and its points: the accent. */
const INK: ChartPaint = { ink: "text-accent", swatch: "bg-accent" };

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
  const width = measured > 0 ? measured : FALLBACK_WIDTH;
  const temp = (t: number) => formatTemp(t, unit, false, lang);
  const times = hours.map((h) => hourLabel(h.time));
  // The chart's own columns, so a drawing lands under the hour the chart labels.
  const columns = bareColumns(
    width,
    times,
    hours.map((h) => temp(h.temp)),
  );
  const arts = columns.labelled.flatMap((i) => {
    const condition = hours[i]?.condition;
    return condition === undefined ? [] : [{ condition, night: hours[i]?.night === true, i }];
  });
  const name = `${label}: ${hours
    .slice(0, SPOKEN)
    .map((h, i) => `${times[i]} ${temp(h.temp)}`)
    .join(", ")}`;

  return (
    <div ref={frame} className="w-full min-w-0">
      <LineChart
        categories={times}
        series={[{ label, values: hours.map((h) => h.temp), paint: INK }]}
        width={width}
        frame="bare"
        area
        pointLabels
        drawIn
        minSpan={MIN_SPAN}
        fmtValue={temp}
        label={name}
      />
      {/* Each hour's condition under its column, still and unnamed: a small picture of what
          the widget's own words say. */}
      {arts.length > 0 && (
        <div aria-hidden className="relative" style={{ height: ART }}>
          {arts.map(({ condition, night, i }) => (
            <span key={i} className="absolute top-0" style={{ left: columns.x(i) - ART / 2 }}>
              <WeatherArt condition={condition} night={night} size={ART} animated={false} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
