/**
 * A gauge: one reading against a whole — its figure large, its unit beside it, and a ring of the
 * share it fills, from `min` (0 by default) to `max`. The reading's judgement is the caller's:
 * a `tone` inks the figure and the ring (attention, danger, done); without one the figure keeps
 * the text ink and the ring takes the accent. A ring short of full has round caps (Ring's lone
 * arc); a full one closes.
 *
 * To assistive technology the gauge is a `meter` named `label`, with its bounds, its value and
 * the figure and unit as its text. The figure arrives formatted (prefix and decimals are the
 * caller's: "$12.40", "37"), so the gauge never guesses a locale.
 *
 * `lone` sets the figure on the large rung, for a gauge that is the only reading on its surface;
 * `ring={false}` keeps the figure and the meter and leaves the ring out, for a reading whose share
 * is drawn some other way beside it (a progress bar under it).
 */
import type { ToneName } from "../../../tokens";
import { Ring } from "../ring/ring";

const TONE_INK: Readonly<Record<ToneName, string>> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

/** A unit that hugs its number ("37%", "21°C"); any other takes a space ("320 GB"). */
const TIGHT_UNIT = /^[%°′″]/;
/** The ring's track: its own ink, faded, so the track follows the tone. */
const TRACK_OPACITY = 0.18;

/** The share of the whole the reading fills, 0–1 (0 on a whole of no size). */
export function gaugeShare(value: number, max: number, min = 0): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export interface GaugeProps {
  value: number;
  max: number;
  min?: number;
  /** The reading as it prints, formatted by the caller ("37", "$12.40"). */
  figure: string;
  unit?: string;
  /** The reading's judgement: inks the figure and the ring. */
  tone?: ToneName;
  /** The ring's diameter, px. */
  size?: number;
  /** The meter's accessible name. */
  label: string;
  /** The only reading on its surface: the figure takes the large rung. */
  lone?: boolean;
  /** Draw the ring; without it the gauge is the figure and the meter alone. */
  ring?: boolean;
}

export function Gauge({
  value,
  max,
  min = 0,
  figure,
  unit,
  tone,
  size = 40,
  label,
  lone = false,
  ring = true,
}: GaugeProps) {
  const ink = tone === undefined ? "" : TONE_INK[tone];
  const unitText = unit === undefined ? "" : TIGHT_UNIT.test(unit) ? unit : ` ${unit}`;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${figure}${unitText}`}
      data-gauge=""
      className="flex items-end justify-between gap-2"
    >
      <span className="min-w-0">
        <span
          data-figure
          className={`${lone ? "text-4xl" : "text-2xl"} leading-none font-medium tabular-nums ${ink}`}
        >
          {figure}
        </span>
        {unit !== undefined && <span className="text-sm text-fg-muted">{unitText}</span>}
      </span>
      {ring && (
        // The ring takes the figure's ink, or the accent while the reading is fine.
        <span className={`shrink-0 ${ink === "" ? "text-accent" : ink}`}>
          <Ring
            segments={[{ value: gaugeShare(value, max, min) }]}
            max={1}
            size={size}
            width={Math.max(3, Math.round(size / 8))}
            trackOpacity={TRACK_OPACITY}
          />
        </span>
      )}
    </div>
  );
}
