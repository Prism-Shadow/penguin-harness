/**
 * The on/off switch: a `button` with `role="switch"` + `aria-checked` (a native button is
 * keyboard-operable out of the box — Space/Enter activate it — and is labelable content, so
 * clicking an enclosing `<label>`'s text toggles it too). The on track is the accent (the same
 * source as the primary Button), the off track the theme's `switch-track`; the track's fill eases
 * between the two.
 *
 * Geometry (all in spacing units, so it scales with the theme's unit and never pushes the knob
 * out of the track): a size-4 knob in the w-9 × h-5 track, inset 0.5 on every side in both states,
 * and at either end concentric with the track's end-cap circle, so the gap along the arcs matches
 * the straight runs. The knob is painted from the theme's two knob tokens, one per track: the on
 * track is the accent, and an accent can be near-white (a dark theme's neutral accent, a lifted
 * preset), where a white knob would vanish — the theme picks a knob that stays apart from each
 * track at every accent. The track draws a 1px inset hairline in the ink at 10%; the knob's
 * hairline is a *border* — inside its own box — not an outer ring: an outer ring would fill the gap
 * on the near arc and stack on the track hairline as one heavier line, reading as unequal spacing.
 * No offset shadow (it reads as vertical asymmetry at this size); disabled dims and blocks. The
 * focus ring is accent-tinted and `focus-visible`-only, so keyboard focus shows it but a mouse
 * click doesn't leave a lingering halo.
 *
 * The knob travels by layout, not by a transform: it sits in the second column of a grid whose
 * first column grows from `0fr` (off) to `1fr` (on), and that grid carries `data-layout-motion`,
 * so the theme's layout motion moves it (Primer an ease over 200 ms, Frost a longer glide,
 * Console four steps; none under reduced motion). A transform transition is the motion files'
 * alone.
 */
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "role"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ checked, onChange, disabled, className, title, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 " +
        "inset-ring inset-ring-fg/10 transition-colors duration-200 ease-out " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked ? "bg-accent" : "bg-switch-track") +
        ` ${className ?? ""}`
      }
      // A hover hint shows in the shared tooltip, never the browser's own `title`.
      data-tooltip={title}
      {...rest}
    >
      <span
        aria-hidden
        data-layout-motion
        className={`grid w-full ${checked ? "grid-cols-[1fr_auto]" : "grid-cols-[0fr_auto]"}`}
      >
        <span />
        <span
          className={`size-4 rounded-full border ${
            // The off knob sits on a pale track, so its edge is the theme's knob line (it
            // carries the 3:1 there); on the accent track the fill already contrasts and the
            // edge stays faint.
            checked ? "border-fg/10 bg-switch-knob-on" : "border-switch-knob-line bg-switch-knob"
          }`}
        />
      </span>
    </button>
  );
}
