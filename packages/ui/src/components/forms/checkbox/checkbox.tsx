/**
 * The checkbox: a real `<input type="checkbox">` — keyboard, focus, form semantics and the
 * screen-reader state all stay the browser's — drawn as a small token box so it follows the theme
 * (the accent fill when on, the control line when off) instead of each browser's own widget.
 *
 * `indeterminate` is the "some but not all" state of a box that summarises others. HTML has no
 * attribute for it, only a DOM property, so the component sets the property on the element (which
 * is what assistive tech reads as "mixed") and draws the dash itself.
 *
 * With a `label` the box and its text sit in one `<label>`, so the whole row toggles and the text
 * names the control; a `hint` under the label is tied to the box by `aria-describedby`. Without a
 * label the caller names the box (`aria-label`).
 */
import { useCallback, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { sizeTextClass } from "../input/input";
import type { ControlSize } from "../input/input";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "checked" | "defaultChecked" | "onChange" | "children"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Some but not all of what this box stands for is on: draws a dash and reads as "mixed". */
  indeterminate?: boolean;
  /** The visible name; the whole row toggles. Omit it and name the box with `aria-label`. */
  label?: ReactNode;
  /** A line under the label, announced as the box's description. */
  hint?: ReactNode;
  /** The label's text rung; the box keeps one size and centres on the label's first line. */
  size?: ControlSize;
}

const BOX =
  "size-3.5 shrink-0 appearance-none rounded-sm border transition-colors duration-150 " +
  "disabled:cursor-not-allowed " +
  "focus-visible:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

const BOX_OFF = "border-line-emphasis bg-surface hover:border-fg-subtle";
const BOX_ON = "border-accent bg-accent";

/**
 * The check and the dash, drawn at 12px on a 12px grid of their own inside the 14px box: like the
 * caret and the close cross, a two-stroke mark stays crisp only when its grid and its size agree.
 */
function BoxMark({ mixed }: { mixed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="pointer-events-none absolute inset-0 m-auto text-accent-fg"
    >
      <path d={mixed ? "M3 6h6" : "M2.6 6.2l2.2 2.2 4.6-4.8"} />
    </svg>
  );
}

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  label,
  hint,
  size = "sm",
  disabled,
  className = "",
  "aria-describedby": describedBy,
  ...rest
}: CheckboxProps) {
  const hintId = useId();
  // The property, not an attribute: there is no `indeterminate` attribute to render.
  const syncIndeterminate = useCallback(
    (el: HTMLInputElement | null) => {
      if (el !== null) el.indeterminate = indeterminate;
    },
    [indeterminate],
  );
  const on = checked || indeterminate;
  const describedByIds =
    [describedBy, hint != null ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  // A bare box carries the caller's class and dims itself; with a label, the row does both.
  const bare = label === undefined;
  const box = (
    <span
      className={`relative inline-flex shrink-0 items-center ${
        bare ? `${disabled ? "opacity-60" : ""} ${className}` : ""
      }`}
    >
      <input
        ref={syncIndeterminate}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedByIds}
        onChange={(event) => onChange(event.target.checked)}
        className={`${BOX} ${on ? BOX_ON : BOX_OFF}`}
        {...rest}
      />
      {on && <BoxMark mixed={indeterminate} />}
    </span>
  );
  if (bare) return box;
  return (
    <label
      className={`inline-flex items-start gap-1.5 ${sizeTextClass[size]} ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${className}`}
    >
      {/* One line tall, whatever the rung: the box centres on the label's first line. */}
      <span className="flex h-[1lh] shrink-0 items-center">{box}</span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint != null && (
          <span id={hintId} className="block text-fg-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
