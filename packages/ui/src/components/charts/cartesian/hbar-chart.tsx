/**
 * A horizontal bar chart: one row per item on a shared scale from `min` to `max`, each its label,
 * what the caller sets beside it (`aside`: a drawing, a chance of rain), its bar on a track, and
 * its value in words. Rows of HTML rather than an SVG plot, so a label truncates and a value wraps
 * like text at any width, and the rows line up on shared columns.
 *
 * Two readings of a row:
 * - a value (`to` alone): a bar from the scale's start to the value — a disk's share used;
 * - a range (`from` and `to`): a bar from one to the other — a day's low to its high, every day on
 *   the week's scale so the warm and the cold days read at a glance.
 *
 * Each bar is a TimelineBar, so the theme draws it as it draws every bar (radius, outline,
 * opacity). Its colour is the row's tone when it carries a judgement (a disk nearly full), else
 * its paint, else the first palette slot. The track is the chart's grid part, which a theme may
 * redraw. The bars are pictures of the values the rows already print, so they are hidden from
 * assistive technology; the list is named by `label`.
 */
import type { ReactNode } from "react";
import type { ToneName } from "../../../tokens";
import { TimelineBar } from "../marks/timeline-bar";
import type { ChartPaint } from "../marks/marks";

export interface HBarRow {
  label: ReactNode;
  /** A range's start; without it the bar starts at the scale's `min`. */
  from?: number;
  /** The value, or a range's end. */
  to: number;
  /** The value in words, after the bar. */
  value?: ReactNode;
  /** Set between the label and the bar (a drawing, a figure). */
  aside?: ReactNode;
  /** The bar's colour when no tone judges it. */
  paint?: ChartPaint;
  /** A judgement on the row (attention, danger): the bar takes the tone's solid ink. */
  tone?: ToneName;
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

/** A value's place on the scale, as a percentage of the track (clamped to it). */
function share(v: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, ((v - min) / span) * 100));
}

/** Where a row's bar sits along its track: left edge and width, in percent. */
export function hbarPlace(
  row: Pick<HBarRow, "from" | "to">,
  min: number,
  max: number,
): { left: number; width: number } {
  const start = share(row.from ?? min, min, max);
  const end = share(row.to, min, max);
  const left = Math.min(start, end);
  return { left, width: Math.abs(end - start) };
}

export function HBarChart({
  rows,
  min = 0,
  max,
  track = true,
  label,
}: {
  rows: readonly HBarRow[];
  /** The scale's start (the left end of every track). */
  min?: number;
  /** The scale's end (the right end of every track). */
  max: number;
  /** Draw each bar on a track the scale's full width. */
  track?: boolean;
  /** The list's accessible name. */
  label: string;
}) {
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
  return (
    <ul
      aria-label={label}
      data-chart="hbar"
      // ui-chart: the theme draws the tracks (grid parts) and the bars its own way.
      className="ui-chart grid items-center gap-x-2 gap-y-1.5 text-sm"
      style={{ gridTemplateColumns: columns }}
    >
      {rows.map((row, i) => {
        const place = hbarPlace(row, min, max);
        const paint = row.tone !== undefined ? TONE_PAINT[row.tone] : (row.paint ?? FIRST_SLOT);
        return (
          <li key={i} className="col-span-full grid grid-cols-subgrid items-center">
            <span className="min-w-0 truncate text-fg-muted">{row.label}</span>
            {aside && <span className="flex items-center gap-1.5">{row.aside}</span>}
            <span
              aria-hidden
              data-part={track ? "grid" : undefined}
              className={`relative h-1.5 overflow-hidden rounded-full ${track ? "bg-tone-neutral-bg" : ""}`}
            >
              <TimelineBar
                paint={paint}
                place={{ left: `${place.left}%`, width: `${place.width}%` }}
              />
            </span>
            {value && <span className="text-right tabular-nums">{row.value}</span>}
          </li>
        );
      })}
    </ul>
  );
}
