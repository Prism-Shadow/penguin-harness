/**
 * A plot's axis names, as two quiet rows around it: the value axis' name above the plot, over
 * its tick labels, and the category axis' name under it, centred on the plot area (`inset` is
 * the room the tick labels take on the left). Rows of HTML text rather than SVG text inside the
 * plot's padding, so a long name wraps or truncates like any caption instead of running off the
 * canvas, and the plot keeps its full height for marks.
 *
 * Each name is the caller's words, units included ("Latency (ms)"). Without either name the plot
 * is returned as it is.
 */
import type { ReactNode } from "react";
import { PAD_L } from "../chart-frame/chart-geom";

export function PlotCaptions({
  x,
  y,
  inset = PAD_L,
  children,
}: {
  /** The category (horizontal) axis' name. */
  x?: string;
  /** The value (vertical) axis' name. */
  y?: string;
  /** The plot area's left edge in the plot, px: the x name centres on what lies right of it. */
  inset?: number;
  children: ReactNode;
}) {
  if (x === undefined && y === undefined) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {y !== undefined && (
        <div data-caption="y" className="truncate text-xs text-fg-muted">
          {y}
        </div>
      )}
      {children}
      {x !== undefined && (
        <div
          data-caption="x"
          className="truncate text-center text-xs text-fg-muted"
          style={{ paddingLeft: inset }}
        >
          {x}
        </div>
      )}
    </div>
  );
}
