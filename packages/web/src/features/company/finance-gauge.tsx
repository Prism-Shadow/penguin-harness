/**
 * The finance page's two spend-against-budget pictures. Both ink themselves in the budget tone
 * — success below 80%, attention from 80%, danger from 100% — and both leave the amounts to
 * the text beside them, carrying the full statement in the accessible name and the tooltip.
 *
 * `FinanceGauge` is the KPI row's ring: one arc from 12 o'clock, filled to the ratio and
 * capped at a full circle when spend is over the budget; without a budget the track stands
 * alone. `SpendMeter` is the spend tree's bar, which carries its own percent.
 */
import { formatPercent } from "../../lib/format";
import { toneDot, toneInk } from "../../lib/tone";
import { budgetTone } from "./finance-tree";

export function FinanceGauge({
  ratio,
  label,
  size = 64,
}: {
  /** cost / budget; absent without a budget. */
  ratio?: number;
  /** The full statement ("$6.20 / $10 · 62%"), for the tooltip and screen readers. */
  label: string;
  size?: number;
}) {
  const tone = budgetTone(ratio);
  const strokeWidth = Math.max(3, Math.round(size * 0.11));
  const center = size / 2;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const fraction = ratio === undefined ? 0 : Math.min(1, Math.max(0, ratio));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={`block shrink-0 ${toneInk[tone]}`}
    >
      <title>{label}</title>
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-gray-200 dark:stroke-gray-800"
      />
      {fraction > 0 && (
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap={fraction < 1 ? "round" : "butt"}
          strokeDasharray={`${fraction * c} ${c}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
    </svg>
  );
}

/**
 * The share of the track a fill needs before the percent can sit inside it. The widest label,
 * "100%" at 10px with its padding, is about 30px, and the bar is 80px wide in the one column
 * that draws it — so 45% of the track holds the label, and below that there is room for it to
 * stand past the fill's end without leaving the track.
 */
const PERCENT_INSIDE_MIN = 45;

/**
 * Spend against a budget as a bar with its percent drawn on it: the percent rides inside the
 * fill once the fill is wide enough to hold it, and just past the fill's end on the track when
 * it is not, so the number is never printed on a colour it cannot be read against. Inside, the
 * ink is a fixed near-black rather than white: the fills are one value across both themes
 * (lib/tone.ts explains why the dots are), and white on amber-500 measures 2.1 : 1, while
 * gray-900 on emerald-500, amber-500 and red-500 measures 6.7, 8.1 and 4.6 : 1 in light and
 * higher in dark, where gray-900 is darker still. Without a budget there is no percent to draw
 * and the track stands empty.
 */
export function SpendMeter({
  ratio,
  label,
}: {
  /** cost / budget; absent without a budget. */
  ratio?: number;
  /** The full statement ("$41.00 / $100.00 · 41%"), for the tooltip and screen readers. */
  label: string;
}) {
  const tone = budgetTone(ratio);
  const width = ratio === undefined ? 0 : Math.min(100, Math.max(0, ratio * 100));
  const inside = width >= PERCENT_INSIDE_MIN;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      title={label}
      className="relative block h-4 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 rounded-full ${toneDot[tone]}`}
        style={{ width: `${width}%` }}
      />
      {ratio !== undefined && (
        <span
          aria-hidden
          className={`absolute inset-y-0 flex items-center text-[10px] font-medium tabular-nums ${
            inside ? "pr-1.5 text-gray-900" : `pl-1.5 ${toneInk[tone]}`
          }`}
          style={inside ? { right: `${100 - width}%` } : { left: `${width}%` }}
        >
          {formatPercent(ratio)}
        </span>
      )}
    </span>
  );
}
