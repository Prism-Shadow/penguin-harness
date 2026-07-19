/**
 * Segmented context-usage donut ring: used in the top-right corner of each round
 * (Task) card on the Trace page — shows both **usage ratio** (sum of arc lengths
 * / limit) and **segment composition** (three segments). Draws, clockwise from
 * the top (12 o'clock), the cacheRead, cacheWrite, and output segments in order,
 * with the remainder left as an empty ring; the limit `max` = the model's context
 * window (defaults to 128000 via resolveContextWindow when the caller doesn't
 * supply one). If all three buckets are 0, only the base ring is drawn; when
 * usage exceeds the limit, the ring is filled proportionally to usage and
 * colored by threshold (>80% amber / >95% red) to signal approaching/exceeding
 * the limit; exact values are given via a `<title>` hover.
 * Segments use the site-wide TOKEN_COLORS (works in both light/dark); the base
 * ring uses a currentColor gray.
 * The context usage under the chat page's input box is a **single-color,
 * single-value** ring (total only), custom-drawn in chat-input — it doesn't use
 * this component.
 */
import { TOKEN_COLORS } from "../../lib/token-colors";
import { humanizeTokens } from "../../lib/format";
import { S } from "../../lib/strings";

export function TokenDonut({
  cacheRead,
  cacheWrite,
  output,
  max,
  size = 44,
}: {
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** Limit (context window): when usage doesn't exceed it, values are normalized against this, leaving an empty ring. */
  max: number;
  /** Outer diameter in pixels. */
  size?: number;
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
  // The base ring's (i.e. "empty ring / remainder") color shifts to amber / red as usage approaches the limit, as a warning.
  const ringTone =
    pct > 0.95 ? "text-red-500" : pct > 0.8 ? "text-amber-500" : "text-gray-300 dark:text-gray-700";
  const segs = [
    {
      key: "cacheRead",
      value: cacheRead,
      color: TOKEN_COLORS.cacheRead,
      label: S.usage.colCacheRead,
    },
    {
      key: "cacheWrite",
      value: cacheWrite,
      color: TOKEN_COLORS.cacheWrite,
      label: S.usage.colCacheWrite,
    },
    { key: "output", value: output, color: TOKEN_COLORS.output, label: S.usage.colOutput },
  ];
  const title =
    `${S.chat.contextUsage} ${humanizeTokens(total)}/${humanizeTokens(max)}` +
    segs.map((s) => ` · ${s.label} ${humanizeTokens(s.value)}`).join("");
  let acc = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`block shrink-0 ${ringTone}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Base ring (empty ring / remainder) */}
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth={strokeWidth}
      />
      {/* Three arc segments: clockwise, starting at 12 o'clock (rotate -90), positioned via cumulative dashoffset per segment. */}
      {segs.map((seg) => {
        if (seg.value <= 0) return null;
        const len = (seg.value / denom) * c;
        const offset = -(acc / denom) * c;
        acc += seg.value;
        return (
          <circle
            key={seg.key}
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${len} ${c}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        );
      })}
    </svg>
  );
}
