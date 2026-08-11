/**
 * iOS-style toggle switch: a `button` with `role="switch"` + `aria-checked` (a native
 * button is keyboard-operable out of the box — Space/Enter activate it — and is labelable
 * content, so clicking an enclosing `<label>`'s text toggles it too). Sliding knob with an
 * ease-out color/transform transition; the on-state follows the theme accent variable (same
 * source as Button primary), the off-state is gray. Track and knob each carry an inset/outer
 * hairline so the edges stay defined on any surface (the dark neutral accent is near-white,
 * where the white knob would otherwise vanish); dark-mode aware; disabled dims and blocks.
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
        className={`inline-block size-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200 ease-out ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
