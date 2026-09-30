/**
 * Segmented context-usage donut ring: used in the top-right corner of each round
 * (Task) card on the Trace page — shows both **usage ratio** (sum of arc lengths
 * / limit) and **segment composition** (three segments). Draws, clockwise from
 * the top (12 o'clock), the cacheRead, cacheWrite, and output segments in order,
 * with the remainder left as an empty ring; the limit `max` is the model's context
 * window, which the caller resolves. If all three buckets are 0, only the base ring
 * is drawn; when usage exceeds the limit, the ring is filled proportionally to usage
 * and the remainder is coloured by threshold (>80% attention / >95% danger) to signal
 * approaching/exceeding the limit; exact values show in the shared tooltip on hover.
 * Segments use the theme's Token-kind colours; the base ring takes the ring's own ink.
 *
 * The words are the caller's: `labels` names the usage and each Token kind, and the
 * figures come from `format` (the app's own token abbreviation).
 *
 * The composer's context usage is a single-colour, single-value ring (total only) — a
 * `Ring`, not this component.
 */
import { ChartArc } from "../marks/marks";

/** The words the donut's accessible name and tooltip are built from. */
export interface TokenDonutLabels {
  /** What the ratio is ("Context usage"). */
  usage: string;
  cacheRead: string;
  cacheWrite: string;
  output: string;
}

export function TokenDonut({
  cacheRead,
  cacheWrite,
  output,
  max,
  size = 44,
  labels,
  format = String,
}: {
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** Limit (context window): when usage doesn't exceed it, values are normalized against this, leaving an empty ring. */
  max: number;
  /** Outer diameter in pixels. */
  size?: number;
  labels: TokenDonutLabels;
  /** How a Token count is printed in the accessible name and tooltip. */
  format?: (tokens: number) => string;
}) {
  const total = cacheRead + cacheWrite + output;
  const strokeWidth = Math.max(2, Math.round(size * 0.16));
  const center = size / 2;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  // Normalization denominator: when usage doesn't exceed the limit, use the limit
  // (leaves an empty ring); when it exceeds, use usage itself so the ring fills
  // completely (arcs never wrap past a full circle).
  const denom = Math.max(max, total, 1);
  const pct = max > 0 ? total / max : 0;
  // The base ring's (i.e. "empty ring / remainder") colour shifts to attention / danger as usage approaches the limit, as a warning.
  const ringTone =
    pct > 0.95
      ? "text-tone-danger-fg"
      : pct > 0.8
        ? "text-tone-attention-fg"
        : "text-line-emphasis";
  const segs = [
    { key: "cacheRead", value: cacheRead, role: "cacheRead" as const, label: labels.cacheRead },
    { key: "cacheWrite", value: cacheWrite, role: "cacheWrite" as const, label: labels.cacheWrite },
    { key: "output", value: output, role: "output" as const, label: labels.output },
  ];
  const title =
    `${labels.usage} ${format(total)}/${format(max)}` +
    segs.map((s) => ` · ${s.label} ${format(s.value)}`).join("");
  let acc = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      // ui-chart: a theme may redraw the parts (the track as the grid, each arc a series).
      className={`ui-chart block shrink-0 ${ringTone}`}
      role="img"
      aria-label={title}
      data-tooltip={title}
    >
      {/* Base ring (empty ring / remainder), in the svg's own ink: the near-limit tone above. */}
      <ChartArc
        cx={center}
        cy={center}
        r={r}
        width={strokeWidth}
        paint={{ ink: "" }}
        track
        trackOpacity={0.35}
      />
      {/* Three arc segments: clockwise, starting at 12 o'clock, each placed by the cumulative offset. */}
      {segs.map((seg) => {
        if (seg.value <= 0) return null;
        const len = (seg.value / denom) * c;
        const offset = -(acc / denom) * c;
        acc += seg.value;
        return (
          <ChartArc
            key={seg.key}
            cx={center}
            cy={center}
            r={r}
            width={strokeWidth}
            paint={{ role: seg.role }}
            length={len}
            offset={offset}
          />
        );
      })}
    </svg>
  );
}
