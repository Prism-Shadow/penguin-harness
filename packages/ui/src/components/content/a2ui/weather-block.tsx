/**
 * A weather widget: the conditions at a place as the model read them — the condition drawn and
 * named, the temperature large, the day's high and low, how it feels, the humidity and the wind —
 * and, when it has them, the next hours as a line chart (weather-hourly.tsx) and the coming days
 * as a horizontal range chart, each day's low to high a bar on the week's scale so the warm and
 * the cold days read at a glance. The charts are the basic ones; the drawings, the figure and the
 * detail rows are the widget's own.
 *
 * A snapshot: the head says when it was read and the foot where from. Nothing here fetches or
 * updates; only the drawing moves.
 */
import { Fragment } from "react";
import { formatNumber, formatTemp, weekdayOf } from "@prismshadow/penguin-core/a2ui";
import type { A2uiLang, A2uiWeather, A2uiWeatherDay } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { HBarChart } from "../../charts/cartesian/hbar-chart";
import type { HBarRow } from "../../charts/cartesian/hbar-chart";
import type { ChartPaint } from "../../charts/marks/marks";
import { localDay } from "./time-format";
import { useNow } from "./use-now";
import { WeatherArt } from "./weather-art";
import { WeatherHourly } from "./weather-hourly";
import { WidgetSurface } from "./widget";

/** The current reading's detail rows, label and value, in the order they are read. */
function details(
  spec: A2uiWeather,
  strings: A2uiStrings,
  lang: A2uiLang,
): { label: string; value: string }[] {
  const temp = (t: number) => formatTemp(t, spec.unit, false, lang);
  const rows: { label: string; value: string }[] = [];
  if (spec.high !== undefined && spec.low !== undefined) {
    rows.push({
      label: `${strings.high} / ${strings.low}`,
      value: `${temp(spec.high)} / ${temp(spec.low)}`,
    });
  } else if (spec.high !== undefined) {
    rows.push({ label: strings.high, value: temp(spec.high) });
  } else if (spec.low !== undefined) {
    rows.push({ label: strings.low, value: temp(spec.low) });
  }
  if (spec.feelsLike !== undefined) {
    rows.push({ label: strings.feelsLike, value: temp(spec.feelsLike) });
  }
  if (spec.humidity !== undefined) {
    rows.push({ label: strings.humidity, value: `${formatNumber(spec.humidity, lang)}%` });
  }
  if (spec.windSpeed !== undefined) {
    const direction = spec.windDirection !== undefined ? ` ${spec.windDirection}` : "";
    rows.push({
      label: strings.wind,
      value: `${formatNumber(spec.windSpeed, lang)} ${spec.windUnit ?? "km/h"}${direction}`,
    });
  }
  return rows;
}

/** The day's range bar: the quiet ink, so the week reads as one scale, not as series. */
const RANGE_INK: ChartPaint = { ink: "text-fg-subtle", swatch: "bg-fg-subtle" };

/**
 * The coming days as a range chart: one row each — the weekday, the condition and its chance of
 * rain, the day's low to high as a bar on the week's scale, and the low and the high in words.
 */
function Days({
  days,
  unit,
  lang,
  strings,
}: {
  days: readonly A2uiWeatherDay[];
  unit: "C" | "F" | undefined;
  lang: A2uiLang;
  strings: A2uiStrings;
}) {
  const today = localDay(useNow(false));
  const temp = (t: number) => formatTemp(t, unit, false, lang);
  const rows: HBarRow[] = days.map((day) => ({
    label: day.date.slice(0, 10) === today ? strings.today : weekdayOf(day.date, lang),
    aside: (
      <>
        <WeatherArt condition={day.condition} size={18} animated={false} />
        <span className="sr-only">{strings.conditions[day.condition]}</span>
        {day.precip !== undefined && (
          <span className="text-xs text-fg-muted tabular-nums">
            <span className="sr-only">{`${strings.precipitation} `}</span>
            {`${formatNumber(day.precip, lang)}%`}
          </span>
        )}
      </>
    ),
    from: day.low,
    to: day.high,
    value: (
      <>
        <span className="text-fg-muted">{temp(day.low)}</span>
        {` / ${temp(day.high)}`}
      </>
    ),
    paint: RANGE_INK,
  }));
  return (
    <HBarChart
      rows={rows}
      min={Math.min(...days.map((d) => d.low))}
      max={Math.max(...days.map((d) => d.high))}
      label={strings.daily}
    />
  );
}

export function WeatherBlock({ spec }: { spec: A2uiWeather }) {
  const strings = useUiStrings().a2ui;
  const lang = strings.lang;
  const condition = strings.conditions[spec.condition];
  const rows = details(spec, strings, lang);
  const hourly = spec.hourly ?? [];
  const daily = spec.daily ?? [];
  return (
    <WidgetSurface
      kind="weather"
      label={`${spec.place}, ${condition}, ${formatTemp(spec.temp, spec.unit, true, lang)}`}
      title={spec.place}
      {...(spec.asOf !== undefined ? { asOf: spec.asOf } : {})}
      {...(spec.source !== undefined ? { foot: strings.source(spec.source) } : {})}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <WeatherArt
            condition={spec.condition}
            night={spec.night === true}
            size={72}
            label={condition}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start">
              <span data-figure className="text-4xl leading-none font-medium tabular-nums">
                {formatTemp(spec.temp, spec.unit, false, lang)}
              </span>
              <span className="mt-1 text-sm text-fg-muted">{spec.unit ?? "C"}</span>
            </div>
            <div className="text-sm text-fg">{condition}</div>
            {spec.summary !== undefined && (
              <div className="text-xs text-fg-muted">{spec.summary}</div>
            )}
          </div>
          {rows.length > 0 && (
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs">
              {rows.map((row) => (
                <Fragment key={row.label}>
                  <span className="text-fg-muted">{row.label}</span>
                  <span className="text-fg tabular-nums">{row.value}</span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
        {hourly.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-fg-muted">{strings.hourly}</div>
            <WeatherHourly hours={hourly} unit={spec.unit} lang={lang} label={strings.hourly} />
          </div>
        )}
        {daily.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-fg-muted">{strings.daily}</div>
            <Days days={daily} unit={spec.unit} lang={lang} strings={strings} />
          </div>
        )}
      </div>
    </WidgetSurface>
  );
}
