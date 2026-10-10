/**
 * The heat mark: a small solid disc whose colour places a magnitude on the theme's cool → hot
 * ramp, beside the figure it encodes (a model's price on its card). Like the state dot it stays
 * round in every theme and never carries its meaning alone: the figure sits next to it, and a
 * dot that stands alone takes `label`.
 *
 * The ramp is continuous. The theme declares four stops (`--ui-heat-1` … `--ui-heat-4`, slate
 * blue → steel cyan → bronze → orange) evenly spaced over 0–1, and a position between two stops
 * is the two mixed in OKLCH by the browser (`heatColor`), so the colour follows the theme and the
 * mode with no colour maths here and no value of its own. The theme's contrast suite samples the
 * same mix densely: every point of the ramp clears 3:1 on the page and card surfaces.
 */

/** The ramp's stops, cool → hot, at 0, 1/3, 2/3 and 1. */
export const HEAT_STOPS = ["--ui-heat-1", "--ui-heat-2", "--ui-heat-3", "--ui-heat-4"] as const;

/**
 * The CSS colour at position `t` on the heat ramp, clamped to 0–1: a stop itself where `t` lands
 * on one, otherwise `color-mix(in oklch, <cooler stop> p%, <hotter stop>)` with `p` the cooler
 * stop's share, to a tenth of a percent.
 */
export function heatColor(t: number): string {
  const at = Math.min(1, Math.max(0, t));
  const segments = HEAT_STOPS.length - 1;
  const k = Math.min(segments - 1, Math.floor(at * segments));
  const cooler = Math.round((k + 1 - at * segments) * 1000) / 10;
  if (cooler >= 100) return `var(${HEAT_STOPS[k]})`;
  if (cooler <= 0) return `var(${HEAT_STOPS[k + 1]})`;
  return `color-mix(in oklch, var(${HEAT_STOPS[k]}) ${cooler}%, var(${HEAT_STOPS[k + 1]}))`;
}

/** 8 px whatever the root font tier, the state dot's `sm` rung: the smallest disc whose hue reads. */
const SIZE_PX = 8;

export function HeatDot({
  t,
  label,
  className = "",
}: {
  /** The position on the ramp, 0 (cool) to 1 (hot); values outside are clamped. */
  t: number;
  /** Names a dot that stands alone; without it the dot is decoration beside its figure. */
  label?: string;
  /** Layout only (a margin, an alignment); the colour and the size are the dot's. */
  className?: string;
}) {
  return (
    <span
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label })}
      style={{ width: SIZE_PX, height: SIZE_PX, backgroundColor: heatColor(t) }}
      className={`inline-block shrink-0 rounded-full ${className}`}
    />
  );
}
