/**
 * A horizontal bar chart: one row per item on a shared scale from `min` to `max`, each its label,
 * what the caller sets beside it (`aside`: a drawing, a chance of rain), its bar on a track, and
 * its value in words. Rows of HTML rather than an SVG plot, so a label truncates and a value wraps
 * like text at any width, and the rows line up on shared columns.
 *
 * Three readings of a row:
 * - a value (`to` alone): a bar from the scale's start to the value — a disk's share used;
 * - a range (`from` and `to`): a bar from one to the other — a day's low to its high, every day on
 *   the week's scale so the warm and the cold days read at a glance;
 * - a stack (`stack`): one segment per series, end to end from zero, so the row's bar is its total
 *   and each segment one series' part of it — a region's traffic, read and written.
 *
 * Each bar is a TimelineBar, so the theme draws it as it draws every bar (radius, outline,
 * opacity). Its colour is the row's tone when it carries a judgement (a disk nearly full), else
 * its paint, else its series' colour, else the first palette slot. The track is the chart's grid
 * part, which a theme may redraw.
 *
 * The series (`series`) name what the segments are: series `i` paints in palette slot `i` unless
 * it names a paint, and with more than one a legend sits under the rows. Pointing at a legend item
 * or at a segment singles its series out (the others fade); pointing at a segment also opens a
 * bubble over it (under it on the first row, so it stays inside the chart) with the row's label,
 * the series and the segment's value (`fmtValue`). Segments meet square; the theme's radius
 * rounds only a row's free ends. A value or
 * range row may say which series it belongs to (a grouped chart's rows), so it takes that series'
 * colour and fades with the others.
 *
 * The bars are pictures of the values the rows print, so they are hidden from assistive
 * technology and the list is named by `label`; a stack's segments, which no row prints, are read
 * out in words after the row's label.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ToneName } from "../../../tokens";
import type { ChartPaint } from "../marks/marks";
import { TimelineBar } from "../marks/timeline-bar";
import type { TimelineBarJoin } from "../marks/timeline-bar";
import { isReading, seriesPaint } from "./cartesian-data";
import { SegmentBubble, SeriesLegend } from "./series-readout";

/** A series the rows' bars belong to: its name, and its colour when not palette slot `i`. */
export interface HBarSeries {
  label: string;
  paint?: ChartPaint;
}

interface HBarRowBase {
  label: ReactNode;
  /** The value in words, after the bar. */
  value?: ReactNode;
  /** Set between the label and the bar (a drawing, a figure). */
  aside?: ReactNode;
}

/** A row with one bar: a value from the scale's start, or a range. */
export interface HBarSpanRow extends HBarRowBase {
  /** A range's start; without it the bar starts at the scale's `min`. */
  from?: number;
  /** The value, or a range's end. */
  to: number;
  /** The bar's colour when no tone judges it. */
  paint?: ChartPaint;
  /** A judgement on the row (attention, danger): the bar takes the tone's solid ink. */
  tone?: ToneName;
  /** The series the bar belongs to, by its index in the chart's `series`. */
  series?: number;
  stack?: undefined;
}

/** A row of segments, one per series of the chart, end to end from zero. */
export interface HBarStackRow extends HBarRowBase {
  /** One reading per series of the chart's `series`, in order; a null or a value ≤ 0 takes no room. */
  stack: readonly (number | null)[];
}

export type HBarRow = HBarSpanRow | HBarStackRow;

/** One segment of a stack row: its series, its reading, and where it sits along the track. */
export interface HBarSegment {
  series: number;
  value: number;
  /** Left edge and width, in percent of the track. */
  left: number;
  width: number;
}

/** A tone as a bar's paint: the solid fill, with the tone's ink for an outline. */
const TONE_PAINT: Readonly<Record<ToneName, ChartPaint>> = {
  success: { ink: "text-tone-success-fg", swatch: "bg-tone-success-emphasis" },
  attention: { ink: "text-tone-attention-fg", swatch: "bg-tone-attention-emphasis" },
  danger: { ink: "text-tone-danger-fg", swatch: "bg-tone-danger-emphasis" },
  done: { ink: "text-tone-done-fg", swatch: "bg-tone-done-emphasis" },
  neutral: { ink: "text-tone-neutral-fg", swatch: "bg-tone-neutral-emphasis" },
  info: { ink: "text-tone-info-fg", swatch: "bg-tone-info-emphasis" },
};

const FIRST_SLOT: ChartPaint = { series: 0 };

/** What a part of a stack says to a screen reader between its neighbours, in any language. */
const PART_GAP = " · ";

/** A value's place on the scale, as a percentage of the track (clamped to it). */
function share(v: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, ((v - min) / span) * 100));
}

/** Where a row's bar sits along its track: left edge and width, in percent. */
export function hbarPlace(
  row: Pick<HBarSpanRow, "from" | "to">,
  min: number,
  max: number,
): { left: number; width: number } {
  const start = share(row.from ?? min, min, max);
  const end = share(row.to, min, max);
  const left = Math.min(start, end);
  return { left, width: Math.abs(end - start) };
}

/**
 * A stack row's segments along its track: end to end from zero (or from the scale's nearer end
 * when zero is off it), in series order; a null or a value ≤ 0 takes no room and has no segment.
 */
export function hbarSegments(
  stack: readonly (number | null)[],
  min: number,
  max: number,
): HBarSegment[] {
  const segments: HBarSegment[] = [];
  let base = Math.min(Math.max(0, min), max);
  stack.forEach((value, series) => {
    if (!isReading(value) || value <= 0) return;
    segments.push({ series, value, ...hbarPlace({ from: base, to: base + value }, min, max) });
    base += value;
  });
  return segments;
}

/** Which ends of segment `k` of `n` meet a neighbour. */
const joinOf = (k: number, n: number): TimelineBarJoin | undefined =>
  n < 2 ? undefined : k === 0 ? "end" : k === n - 1 ? "start" : "both";

/** A place along the track as the bar's style takes it. */
const percent = ({ left, width }: { left: number; width: number }) => ({
  left: `${left}%`,
  width: `${width}%`,
});

/**
 * Where a segment's bubble hangs: from the segment's start when the segment lies in the left half
 * of the track, else back from its end, so the bubble opens toward the room the track has.
 */
function bubbleAnchor(segment: HBarSegment): CSSProperties {
  const end = segment.left + segment.width;
  return segment.left + segment.width / 2 <= 50
    ? { left: `${segment.left}%` }
    : { right: `${100 - end}%` };
}

export function HBarChart({
  rows,
  min = 0,
  max,
  track = true,
  series = [],
  fmtValue = String,
  legend = series.length > 1,
  label,
}: {
  rows: readonly HBarRow[];
  /** The scale's start (the left end of every track). */
  min?: number;
  /** The scale's end (the right end of every track). */
  max: number;
  /** Draw each bar on a track the scale's full width. */
  track?: boolean;
  /** The series the bars belong to: their names and colours. */
  series?: readonly HBarSeries[];
  /** A segment's value as its bubble and its words print it, unit included ("420 GB"). */
  fmtValue?: (v: number) => string;
  /** Show the legend; by default only with more than one series. */
  legend?: boolean;
  /** The list's accessible name. */
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  // The segment under the pointer: its row, and its series.
  const [hover, setHover] = useState<{ row: number; series: number } | null>(null);
  const aside = rows.some((row) => row.aside !== undefined);
  const value = rows.some((row) => row.value !== undefined);
  const columns = [
    "fit-content(40%)",
    aside ? "auto" : null,
    "minmax(3rem, 1fr)",
    value ? "auto" : null,
  ]
    .filter((column) => column !== null)
    .join(" ");
  const paintOf = (index: number): ChartPaint => {
    const s = series[index];
    return s !== undefined ? seriesPaint(s, index) : { series: index };
  };
  /** A one-bar row's colour: its tone's, else its paint, else its series', else slot 1. */
  const spanPaint = (row: HBarSpanRow): ChartPaint =>
    row.tone !== undefined
      ? TONE_PAINT[row.tone]
      : (row.paint ?? (row.series !== undefined ? paintOf(row.series) : FIRST_SLOT));
  // The series singled out: the legend's, else the segment under the pointer's.
  const lit = active ?? hover?.series ?? null;
  const fade = (index: number | undefined) =>
    lit !== null && index !== undefined && index !== lit
      ? "opacity-30 transition-opacity duration-150"
      : "transition-opacity duration-150";

  return (
    <div data-chart="hbar" className="flex min-w-0 flex-col gap-2">
      <ul
        aria-label={label}
        // ui-chart: the theme draws the tracks (grid parts) and the bars its own way.
        className="ui-chart grid items-center gap-x-2 gap-y-1.5 text-sm"
        style={{ gridTemplateColumns: columns }}
      >
        {rows.map((row, i) => {
          const segments = row.stack !== undefined ? hbarSegments(row.stack, min, max) : [];
          const hovered =
            hover?.row === i ? segments.find((s) => s.series === hover.series) : undefined;
          const parts =
            row.stack !== undefined
              ? row.stack.flatMap((v, k) =>
                  isReading(v) ? [`${series[k]?.label ?? ""} ${fmtValue(v)}`.trim()] : [],
                )
              : [];
          return (
            <li key={i} className="col-span-full grid grid-cols-subgrid items-center">
              <span className="min-w-0 truncate text-fg-muted">
                {row.label}
                {parts.length > 0 && (
                  <span className="sr-only">{`${PART_GAP}${parts.join(PART_GAP)}`}</span>
                )}
              </span>
              {aside && <span className="flex items-center gap-1.5">{row.aside}</span>}
              {/* The track's cell: the track clips its bars to its rounded ends, so the hover
                  bands and the bubble sit beside it, in the row's full height. */}
              <span className="relative flex items-center self-stretch">
                <span
                  aria-hidden
                  data-part={track ? "grid" : undefined}
                  className={`relative block h-1.5 w-full overflow-hidden rounded-full ${track ? "bg-tone-neutral-bg" : ""}`}
                >
                  {row.stack !== undefined ? (
                    segments.map((segment, k) => (
                      <TimelineBar
                        key={segment.series}
                        paint={paintOf(segment.series)}
                        place={percent(segment)}
                        square={joinOf(k, segments.length)}
                        className={fade(segment.series)}
                      />
                    ))
                  ) : (
                    <TimelineBar
                      paint={spanPaint(row)}
                      place={percent(hbarPlace(row, min, max))}
                      className={fade(row.series)}
                    />
                  )}
                </span>
                {segments.map((segment) => (
                  <span
                    key={segment.series}
                    aria-hidden
                    data-hit=""
                    className="absolute inset-y-0"
                    style={percent(segment)}
                    onMouseEnter={() => setHover({ row: i, series: segment.series })}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
                {hovered !== undefined && (
                  <SegmentBubble
                    title={row.label}
                    series={series[hovered.series]?.label ?? ""}
                    paint={paintOf(hovered.series)}
                    value={fmtValue(hovered.value)}
                    style={bubbleAnchor(hovered)}
                    below={i === 0}
                  />
                )}
              </span>
              {value && <span className="text-right tabular-nums">{row.value}</span>}
            </li>
          );
        })}
      </ul>
      {legend && <SeriesLegend series={series} mark="bar" active={lit} onHover={setActive} />}
    </div>
  );
}
