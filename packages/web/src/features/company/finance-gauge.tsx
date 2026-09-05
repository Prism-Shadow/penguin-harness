/**
 * Spend-against-budget ring for the finance page's KPI row: one arc from 12 o'clock, filled
 * to the ratio (capped at a full circle when spend is over the budget) and inked in the
 * budget tone — success below 80%, attention from 80%, danger from 100%. Without a budget
 * the track stands alone. The ring is the picture; the numbers stand beside it in the row,
 * and the full statement rides in the accessible name and the tooltip.
 */
import { toneInk } from "../../lib/tone";
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
