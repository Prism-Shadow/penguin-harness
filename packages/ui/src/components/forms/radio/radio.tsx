/**
 * Radio buttons: `Radio` is one native `<input type="radio">` drawn as a small token disc, and
 * `RadioGroup` is the usual way to use it — a `<fieldset>` whose `<legend>` names the choice, one
 * row per option, all sharing a `name` so the browser gives the group its arrow-key walk and
 * exactly one tab stop.
 *
 * A radio group is for a small, always-visible choice whose options each need a sentence (an
 * import mode and what it does to existing data). A short choice without explanations is a
 * `Segmented`; a long one is a `Select`.
 */
import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { sizeTextClass } from "../input/input";
import type { ControlSize } from "../input/input";

export interface RadioProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "checked" | "defaultChecked" | "onChange" | "children"
> {
  checked: boolean;
  /** Called when this radio becomes the selected one. */
  onChange: () => void;
  /** The visible name; the whole row selects. Omit it and name the radio with `aria-label`. */
  label?: ReactNode;
  /** A line under the label, announced as the radio's description. */
  hint?: ReactNode;
  /** The label's text rung; the disc keeps one size and centres on the label's first line. */
  size?: ControlSize;
}

const DISC =
  "size-3.5 shrink-0 appearance-none rounded-full border transition-colors duration-150 " +
  "disabled:cursor-not-allowed " +
  "focus-visible:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

const DISC_OFF = "border-line-emphasis bg-surface hover:border-fg-subtle";
const DISC_ON = "border-accent bg-accent";

export function Radio({
  checked,
  onChange,
  label,
  hint,
  size = "sm",
  disabled,
  className = "",
  "aria-describedby": describedBy,
  ...rest
}: RadioProps) {
  const hintId = useId();
  const describedByIds =
    [describedBy, hint != null ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  const bare = label === undefined;
  const disc = (
    <span
      className={`relative inline-flex shrink-0 items-center ${
        bare ? `${disabled ? "opacity-60" : ""} ${className}` : ""
      }`}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedByIds}
        onChange={(event) => {
          if (event.target.checked) onChange();
        }}
        className={`${DISC} ${checked ? DISC_ON : DISC_OFF}`}
        {...rest}
      />
      {checked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full bg-accent-fg"
        />
      )}
    </span>
  );
  if (bare) return disc;
  return (
    <label
      className={`inline-flex items-start gap-1.5 ${sizeTextClass[size]} ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${className}`}
    >
      {/* One line tall, whatever the rung: the disc centres on the label's first line. */}
      <span className="flex h-[1lh] shrink-0 items-center">{disc}</span>
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

/** One choice of a {@link RadioGroup}. */
export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  /** What choosing it does, under the label. */
  hint?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  /** The question the options answer: the fieldset's legend, in the field-label look. */
  label?: ReactNode;
  options: readonly RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The radios' shared `name`; a generated one when omitted. */
  name?: string;
  /** Options stacked (the default, for options that carry a hint) or on one wrapping line. */
  orientation?: "vertical" | "horizontal";
  size?: ControlSize;
  disabled?: boolean;
  className?: string;
}

export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  orientation = "vertical",
  size = "sm",
  disabled = false,
  className = "",
}: RadioGroupProps<T>) {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  return (
    <fieldset className={`min-w-0 ${className}`} disabled={disabled}>
      {label != null && (
        <legend className="mb-1 text-xs font-semibold text-fg-muted">{label}</legend>
      )}
      <div
        className={
          orientation === "vertical" ? "flex flex-col gap-2" : "flex flex-wrap gap-x-4 gap-y-2"
        }
      >
        {options.map((option) => (
          <Radio
            key={option.value}
            name={groupName}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            label={option.label}
            hint={option.hint}
            size={size}
            disabled={disabled || option.disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}
