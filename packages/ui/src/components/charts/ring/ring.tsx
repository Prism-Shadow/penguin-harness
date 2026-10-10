/**
 * A ring gauge: arcs clockwise from twelve o'clock over a track, each arc its segment's share of
 * `max` — one arc for a single reading (spend against a budget, a context's occupancy), several
 * for a composition. When the segments add up to more than `max` the ring fills and every arc
 * keeps its share of the total, so no arc wraps past a full circle. A segment at zero draws
 * nothing, so an empty reading is the track alone.
 *
 * The ring's ink is its tone's, or, without one, the ink it sits in (a caller that names the
 * state on the element around it). An arc paints in that ink unless its segment names a paint
 * of its own (a Token kind, a series slot). The track is the chart grid's line, or — with
 * `trackOpacity` — the ring's own ink faded, so a ring that changes colour with its state keeps
 * its track in step. A lone arc that does not close the ring has round caps.
 *
 * With a `label` the ring is an image with that name, which is also its tooltip: it draws no
 * numbers, so the name carries them. Without one it is decoration inside a control that is
 * named already.
 */
import { ChartArc } from "../marks/marks";
import type { ChartPaint } from "../marks/marks";
import type { ToneName } from "../../../tokens";

export interface RingSegment {
  value: number;
  /** The arc's colour, as a chart mark is painted; the ring's own ink when omitted. */
  paint?: ChartPaint;
}

const TONE_INK: Record<ToneName, string> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

const OWN_INK: ChartPaint = { ink: "" };
const GRID_INK: ChartPaint = { ink: "text-chart-grid" };

/** A segment's value as the ring counts it: nothing for a negative or unmeasured one. */
const countOf = (segment: RingSegment) =>
  Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0;

/** Where each drawn arc starts and how long it runs, in px of the circumference. */
export function ringArcs(
  segments: readonly RingSegment[],
  max: number,
  circumference: number,
): { index: number; length: number; offset: number }[] {
  const total = segments.reduce((sum, s) => sum + countOf(s), 0);
  const denom = Math.max(Number.isFinite(max) ? max : 0, total);
  if (denom <= 0) return [];
  let acc = 0;
  return segments.flatMap((segment, index) => {
    const value = countOf(segment);
    if (value === 0) return [];
    const arc = {
      index,
      length: (value / denom) * circumference,
      offset: -(acc / denom) * circumference,
    };
    acc += value;
    return [arc];
  });
}

export function Ring({
  segments,
  max,
  size = 44,
  width = Math.max(2, Math.round(size * 0.12)),
  tone,
  trackOpacity,
  label,
  className = "",
}: {
  segments: readonly RingSegment[];
  /** The value a full ring stands for. */
  max: number;
  /** Outer diameter, px. */
  size?: number;
  /** Stroke width, px. */
  width?: number;
  /** The ring's ink; the surrounding ink when omitted. */
  tone?: ToneName;
  /** Draw the track in the ring's own ink at this opacity instead of the grid's line. */
  trackOpacity?: number;
  /** The accessible name and tooltip; the ring is hidden from assistive technology without one. */
  label?: string;
  /** Layout only (a margin, an alignment); the colour is the tone's. */
  className?: string;
}) {
  const center = size / 2;
  const r = (size - width) / 2;
  const circumference = 2 * Math.PI * r;
  const arcs = ringArcs(segments, max, circumference);
  const lone = arcs.length === 1 && arcs[0]!.length < circumference;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label, "data-tooltip": label })}
      // ui-chart: a theme may redraw the parts (the track as the grid, each arc a series).
      className={`ui-chart block shrink-0 ${tone === undefined ? "" : TONE_INK[tone]} ${className}`}
    >
      <ChartArc
        cx={center}
        cy={center}
        r={r}
        width={width}
        paint={trackOpacity === undefined ? GRID_INK : OWN_INK}
        track
        {...(trackOpacity !== undefined ? { trackOpacity } : {})}
      />
      {arcs.map((arc) => (
        <ChartArc
          key={arc.index}
          cx={center}
          cy={center}
          r={r}
          width={width}
          paint={segments[arc.index]!.paint ?? OWN_INK}
          length={arc.length}
          offset={arc.offset}
          round={lone}
        />
      ))}
    </svg>
  );
}
