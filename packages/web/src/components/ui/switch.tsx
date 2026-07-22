/**
 * iOS-style toggle switch: a `button` with `role="switch"` + `aria-checked` (a native
 * button is keyboard-operable out of the box — Space/Enter activate it — and is labelable
 * content, so clicking an enclosing `<label>`'s text toggles it too). Sliding knob with a
 * color/transform transition; the on-state follows the theme accent variable (same source
 * as Button primary), the off-state is gray; dark-mode aware; disabled dims and blocks.
 * Sized for compact (sm) form rows, matching the dialogs' controls.
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
        "transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400/30 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked ? "bg-[var(--accent-bg)]" : "bg-gray-300 dark:bg-gray-600") +
        ` ${className ?? ""}`
      }
      {...rest}
    >
      <span
        aria-hidden
        className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
