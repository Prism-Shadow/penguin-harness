/**
 * The number input: a number box with its unit drawn inside it, a minus and a plus after it that
 * move the value by `step` (1 when omitted) and stop at the bounds, and the range under it in
 * symbols ("1–10", "≥ 1") unless the caller's `hint` says something else. An `error` takes the
 * hint's place and draws the box's danger line.
 *
 * The value stays the text the reader typed until they press a step (number-step.ts). At a bound
 * the button that would pass it is disabled, and both are while the input is. The browser's own
 * spinner is hidden, since the two buttons do its job and it would sit over the unit; the arrow
 * keys in the box still step, as in any number input. The buttons are `type="button"`, so a press
 * never submits the form around them, while Enter in the box still does.
 *
 * The title is a real `<label for>`. Without a `label`, give the input an `id` and label it
 * from outside.
 */
import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { IconButton } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { FieldError, FieldHint, FieldLabel } from "../field/field";
import { Input } from "../input/input";
import type { ControlSize } from "../input/input";
import { rangeText, stepBlocked, stepNumber } from "./number-step";

export { rangeText, stepNumber } from "./number-step";

export interface NumberInputProps {
  label?: ReactNode;
  /** The text in the box, as typed. */
  value: string;
  onChange: (text: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Drawn inside the box, after the value. */
  unit?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  size?: ControlSize;
  /** Under the box; default: the range in symbols ("1–10", "≥ 1"). */
  hint?: ReactNode;
  /** Replaces the hint and marks the box. */
  error?: ReactNode;
  /** Accessible names of the two buttons. */
  stepLabels: { up: string; down: string };
  id?: string;
  "aria-describedby"?: string;
}

/**
 * The step buttons are the box's height exactly — its two paddings, one line of its rung and its
 * two border pixels — as a square, so the three sit as one row in every theme's density.
 */
const STEP_BUTTON: Record<ControlSize, string> = {
  sm: "size-[calc(var(--ui-space-unit)*2_+_var(--ui-text-small-size)*var(--ui-text-small-lh)_+_2px)]",
  base: "size-[calc(var(--ui-space-unit)*4_+_var(--text-base)*var(--text-base--line-height)_+_2px)]",
};

/** The browser's own spinner, hidden in every engine: the stepper does its job. */
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none " +
  "[&::-webkit-outer-spin-button]:appearance-none";

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  placeholder,
  required,
  disabled = false,
  size = "sm",
  hint,
  error,
  stepLabels,
  id,
  "aria-describedby": describedBy,
}: NumberInputProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const belowId = useId();
  const bounds = { min, max, step };
  const bad = Boolean(error);
  const note = bad ? null : (hint ?? rangeText(bounds));
  const describedByIds =
    [describedBy, bad || note != null ? belowId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="min-w-0" data-control="number-input">
      {label != null && (
        <FieldLabel htmlFor={controlId} required={required}>
          {label}
        </FieldLabel>
      )}
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Input
            id={controlId}
            type="number"
            inputMode="decimal"
            required={required}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step}
            aria-describedby={describedByIds}
            invalid={bad}
            affix={unit !== undefined ? { trailing: unit } : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            size={size}
            disabled={disabled}
            className={NO_SPINNER}
          />
        </div>
        <IconButton
          label={stepLabels.down}
          size="sm"
          disabled={disabled || stepBlocked(value, bounds, -1)}
          onClick={() => onChange(stepNumber(value, bounds, -1))}
          className={STEP_BUTTON[size]}
        >
          <GlyphIcon d={ICONS.minus} size={ICON_SIZE.iconButton} />
        </IconButton>
        <IconButton
          label={stepLabels.up}
          size="sm"
          disabled={disabled || stepBlocked(value, bounds, 1)}
          onClick={() => onChange(stepNumber(value, bounds, 1))}
          className={STEP_BUTTON[size]}
        >
          <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
        </IconButton>
      </div>
      {bad ? (
        <FieldError id={belowId}>{error}</FieldError>
      ) : note != null ? (
        <FieldHint>
          <span id={belowId}>{note}</span>
        </FieldHint>
      ) : null}
    </div>
  );
}
