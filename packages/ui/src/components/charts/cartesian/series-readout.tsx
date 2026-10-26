/**
 * What a basic cartesian chart says about its series in words: the legend under the plot and
 * the hover bubble over it. Both name each series beside a swatch painted the way its marks are
 * (a square for a bar, a dash for a line, a block for an area), so a series reads the same in
 * the plot, the legend and the bubble.
 *
 * - The legend lists the series in order; pointing at one singles it out on the chart (the
 *   site-wide highlight: the others fade), and the chart reports which through `onHover`.
 * - The bubble names the category in full (an axis label may be shortened), then one row per
 *   series with its value as the chart formats it — a series with no reading there says "—". A
 *   chart whose categories have no names (readings with no times) leaves the name out.
 * - A segment's bubble (a horizontal stack's) names its row, then the one series it is part of,
 *   with that series' value.
 */
import type { CSSProperties, ReactNode } from "react";
import { Legend } from "../legend/legend";
import { ChartSwatch } from "../marks/marks";
import type { ChartPaint, ChartSwatchShape } from "../marks/marks";
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
  /** The series to name: their labels and paints (a series' values are not read). */
  series: readonly Pick<CartesianSeries, "label" | "paint">[];
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
      {title !== "" && <p className="text-fg-muted">{title}</p>}
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

/**
 * The bubble over one segment of a horizontal stack, hung above its row (below the first row, so
 * it never leaves the chart's top edge): the row's label, then the
 * segment's series beside its swatch and its value, in the look of the plotted charts' bubble. The
 * row already reads its parts out in words, so the bubble is hidden from assistive technology.
 */
export function SegmentBubble({
  title,
  series,
  paint,
  value,
  style,
  below = false,
}: {
  /** The row's label. */
  title: ReactNode;
  /** The segment's series. */
  series: string;
  paint: ChartPaint;
  /** The segment's value, as the chart formats it. */
  value: string;
  /** Where it hangs along the row (a `left` or a `right`). */
  style?: CSSProperties;
  /** Hang under the row rather than over it. */
  below?: boolean;
}) {
  return (
    <span
      aria-hidden
      data-bubble=""
      className={`pointer-events-none absolute z-10 block rounded border border-line bg-overlay px-2 py-1 text-xs whitespace-nowrap shadow-sm ${below ? "top-full mt-1" : "bottom-full mb-1"}`}
      style={style}
    >
      <span className="block text-fg-muted">{title}</span>
      <span className="flex items-center gap-1.5">
        <ChartSwatch paint={paint} shape={SWATCH.bar} />
        <span className="max-w-40 truncate">{series}</span>
        <span className="ml-auto pl-3 font-medium tabular-nums">{value}</span>
      </span>
    </span>
  );
}
