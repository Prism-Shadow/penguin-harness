/**
 * iOS-style toggle switch: a `button` with `role="switch"` + `aria-checked` (a native
 * button is keyboard-operable out of the box — Space/Enter activate it — and is labelable
 * content, so clicking an enclosing `<label>`'s text toggles it too). Sliding knob with an
 * ease-out color/transform transition; the on-state follows the theme accent variable (same
 * source as Button primary), the off-state is gray. The 18px knob rides in the 20px track
 * with a symmetric 1px gap all around (the iOS knob/track proportion) and carries no offset
 * shadow — a directional shadow reads as vertical asymmetry at this size. Track and knob
 * each carry a hairline (inset ring / outer ring) that meet across that gap, so the edges
 * stay defined on any surface (the dark neutral accent is near-white, where the white knob
 * would otherwise vanish); dark-mode aware; disabled dims and blocks.
 * The focus ring is accent-tinted and `focus-visible`-only, so keyboard focus shows it but a
 * mouse click doesn't leave a lingering halo. Sized for compact (sm) form rows, matching the
 * dialogs' controls.
 */
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "role"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ checked, onChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full " +
        "inset-ring inset-ring-black/10 dark:inset-ring-white/10 " +
        "transition-colors duration-200 ease-out " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)]/40 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked ? "bg-[var(--accent-bg)]" : "bg-gray-200 dark:bg-gray-700") +
        ` ${className ?? ""}`
      }
      {...rest}
    >
      <span
        aria-hidden
        className={`inline-block size-[18px] rounded-full bg-white ring-1 ring-black/10 transition-transform duration-200 ease-out ${
          checked ? "translate-x-[17px]" : "translate-x-px"
        }`}
      />
    </button>
  );
}
