/**
 * A pie chart from data: one series as slices of a circle, clockwise from twelve o'clock in the
 * order given, each its share of the total — or, with `donut`, a ring that leaves the middle open.
 * Drawn as ring arcs through the chart primitives, so every theme's palette applies; slice `i`
 * paints in palette slot `i` unless it names a paint.
 *
 * Beside it (wrapping under it when the room is narrow) the list legend names each slice with its
 * amount, in the caller's `fmtValue`, and its share; pointing at a row fades the other slices.
 * A slice of nothing draws no arc but keeps its row, so the list still accounts for every part.
 * The circle is an image named `label`; the legend is the reading.
 */
import { useState } from "react";
import { Legend } from "../legend/legend";
import { ChartArc } from "../marks/marks";
import type { ChartPaint } from "../marks/marks";
import { pieArcs, pieRing, shareText, sliceShares } from "./pie-geom";
import type { PieSlice } from "./pie-geom";

export type { PieSlice } from "./pie-geom";

/** How far a slice the legend is not pointing at fades. */
const FADE = 0.3;

const paintOf = (slice: PieSlice, i: number): ChartPaint => slice.paint ?? { series: i };

export interface PieChartProps {
  slices: readonly PieSlice[];
  /** The circle's diameter, px. */
  size?: number;
  /** Leave the middle open. */
  donut?: boolean;
  /** An amount as the legend prints it, unit included ("1,240 GB"). */
  fmtValue: (v: number) => string;
  /** The circle's accessible name. */
  label: string;
  /** The list legend beside the circle, or none (the caller names the slices itself). */
  legend?: "list" | "none";
}

export function PieChart({
  slices,
  size = 160,
  donut = false,
  fmtValue,
  label,
  legend = "list",
}: PieChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const ring = pieRing(size, donut);
  const arcs = pieArcs(slices, ring.circumference);
  const shares = sliceShares(slices);
  return (
    <div data-chart="pie" className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        // ui-chart: the theme draws the slices (series parts) its own way.
        className="ui-chart block shrink-0"
      >
        {arcs.map((arc) => (
          <g key={arc.index} opacity={active !== null && active !== arc.index ? FADE : undefined}>
            <ChartArc
              cx={ring.c}
              cy={ring.c}
              r={ring.r}
              width={ring.width}
              paint={paintOf(slices[arc.index]!, arc.index)}
              length={arc.length}
              offset={arc.offset}
            />
          </g>
        ))}
      </svg>
      {legend === "list" && (
        <div className="max-w-80 min-w-40 flex-1">
          <Legend
            layout="list"
            label={label}
            items={slices.map((slice, i) => ({
              key: String(i),
              label: slice.label,
              paint: paintOf(slice, i),
              value: (
                <>
                  <span className="shrink-0 font-medium text-fg tabular-nums">
                    {fmtValue(slice.value)}
                  </span>
                  <span className="w-10 shrink-0 text-right text-fg-subtle tabular-nums">
                    {shareText(shares[i] ?? 0)}
                  </span>
                </>
              ),
            }))}
            active={active === null ? null : String(active)}
            onHover={(key) => setActive(key === null ? null : Number(key))}
          />
        </div>
      )}
    </div>
  );
}
