/**
 * What a basic cartesian chart says about its series in words: the legend under the plot and
 * the hover bubble over it. Both name each series beside a swatch painted the way its marks are
 * (a square for a bar, a dash for a line, a block for an area), so a series reads the same in
 * the plot, the legend and the bubble.
 *
 * - The legend lists the series in order; pointing at one singles it out on the chart (the
 *   site-wide highlight: the others fade), and the chart reports which through `onHover`.
 * - The bubble names the category in full (an axis label may be shortened), then one row per
 *   series with its value as the chart formats it — a series with no reading there says "—".
 */
import { Legend } from "../legend/legend";
import { ChartSwatch } from "../marks/marks";
import type { ChartSwatchShape } from "../marks/marks";
import { isReading, seriesPaint } from "./cartesian-data";
import type { CartesianSeries } from "./cartesian-data";

/** What a series' swatch looks like, by the mark it draws. */
export type SeriesMark = "bar" | "line" | "area";

const SWATCH: Readonly<Record<SeriesMark, ChartSwatchShape>> = {
  bar: "square",
  line: "dash",
  area: "block",
};

/** The text a missing reading prints in the bubble. */
const NO_READING = "—";

export function SeriesLegend({
  series,
  mark,
  active,
  onHover,
}: {
  series: readonly CartesianSeries[];
  mark: SeriesMark;
  /** The series singled out (by its index), or null. */
  active: number | null;
  onHover: (index: number | null) => void;
}) {
  return (
    <Legend
      items={series.map((s, i) => ({
        key: String(i),
        label: s.label,
        paint: seriesPaint(s, i),
        shape: SWATCH[mark],
      }))}
      active={active === null ? null : String(active)}
      onHover={(key) => onHover(key === null ? null : Number(key))}
    />
  );
}

export function SeriesBubble({
  title,
  series,
  index,
  mark,
  fmtValue,
}: {
  /** The category, in full. */
  title: string;
  series: readonly CartesianSeries[];
  /** The category's position in each series' values. */
  index: number;
  mark: SeriesMark;
  fmtValue: (v: number) => string;
}) {
  return (
    <>
      <p className="text-fg-muted">{title}</p>
      {series.map((s, i) => {
        const value = s.values[index];
        return (
          <p key={i} className="flex items-center gap-1.5">
            <ChartSwatch paint={seriesPaint(s, i)} shape={SWATCH[mark]} />
            <span className="max-w-40 truncate">{s.label}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums">
              {isReading(value) ? fmtValue(value) : NO_READING}
            </span>
          </p>
        );
      })}
    </>
  );
}
