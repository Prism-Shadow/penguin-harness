/**
 * A form's number field: the package's number input — its label, the range under it, the unit
 * drawn inside the box, the danger line while the value is malformed or out of range — with a
 * stepper after it, a minus and a plus that move the value by the field's `step` (1 when it names
 * none) and stop at its bounds.
 *
 * The value stays the text the reader typed until they press a step: a step rewrites it as the
 * number it lands on, clamped to the range, rounded to the step's precision so 0.1 + 0.2 shows as
 * 0.3. A step from an empty or malformed box starts from 0, as the browser's own spinner does. At
 * a bound the button that would pass it is disabled, and both are while the form is read-only.
 *
 * The browser's spinner is hidden, since the two buttons do its job and it would otherwise sit
 * over the unit. The arrow keys in the box still step, as they do in any number input.
 */
import { useId } from "react";
import type { A2uiFormField } from "@prismshadow/penguin-core/a2ui";
import { ICON_SIZE } from "../../../icon-scale";
import type { A2uiStrings } from "../../../strings";
import { IconButton } from "../../actions/button/button";
import { FieldHint } from "../../forms/field/field";
import { Input } from "../../forms/input/input";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { numberOutOfRange } from "./form-answers";

/**
 * A number field's range in symbols every language reads ("1–10", "≥ 0"), under the box, so a
 * reader sees the limits before the fill button refuses a value outside them.
 */
function rangeHint(field: A2uiFormField): string | undefined {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return undefined;
}

/** The digits after the point a number needs: 0.25 → 2, 3 → 0, 1e-7 → 7. */
function decimalsOf(value: number): number {
  if (Number.isInteger(value)) return 0;
  const [mantissa = "", exponent = "0"] = value.toExponential().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}

/** The typed text as a number, or NaN when it is empty or not one. */
function typedNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/**
 * The text a step leaves in the box: the typed value (0 when there is none) moved by one `step`
 * up or down, rounded to the precision of the value and the step, then clamped to the range.
 */
export function stepNumber(text: string, field: A2uiFormField, direction: 1 | -1): string {
  const step = field.step ?? 1;
  const typed = typedNumber(text);
  const base = Number.isFinite(typed) ? typed : 0;
  const places = Math.min(20, Math.max(decimalsOf(base), decimalsOf(step)));
  let next = Number((base + direction * step).toFixed(places));
  if (field.min !== undefined) next = Math.max(field.min, next);
  if (field.max !== undefined) next = Math.min(field.max, next);
  return String(next);
}

/**
 * The step buttons, the input's height exactly: its two paddings, one line of the small rung and
 * its two border pixels, as a square — so the three sit as one row in every theme's density.
 */
const STEP_BUTTON =
  "size-[calc(var(--ui-space-unit)*2_+_var(--ui-text-small-size)*var(--ui-text-small-lh)_+_2px)]";

/** The browser's own spinner, hidden in every engine: the stepper does its job. */
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none " +
  "[&::-webkit-outer-spin-button]:appearance-none";

export function NumberField({
  field,
  value,
  onChange,
  disabled,
  strings,
}: {
  field: A2uiFormField;
  /** The text in the box, as typed. */
  value: string;
  onChange: (value: string) => void;
  /** Read-only: the box and both buttons. */
  disabled: boolean;
  strings: A2uiStrings;
}) {
  const hintId = useId();
  const hint = rangeHint(field);
  const typed = typedNumber(value);
  const atMin = field.min !== undefined && Number.isFinite(typed) && typed <= field.min;
  const atMax = field.max !== undefined && Number.isFinite(typed) && typed >= field.max;
  return (
    <div className="min-w-0">
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
          <Input
            type="number"
            inputMode="decimal"
            label={field.label}
            required={field.required}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
            aria-describedby={hint !== undefined ? hintId : undefined}
            invalid={numberOutOfRange(field, value)}
            affix={field.unit !== undefined ? { trailing: field.unit } : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            size="sm"
            disabled={disabled}
            className={NO_SPINNER}
          />
        </div>
        <IconButton
          label={strings.stepDown}
          size="sm"
          disabled={disabled || atMin}
          onClick={() => onChange(stepNumber(value, field, -1))}
          className={STEP_BUTTON}
        >
          <GlyphIcon d={ICONS.minus} size={ICON_SIZE.iconButton} />
        </IconButton>
        <IconButton
          label={strings.stepUp}
          size="sm"
          disabled={disabled || atMax}
          onClick={() => onChange(stepNumber(value, field, 1))}
          className={STEP_BUTTON}
        >
          <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
        </IconButton>
      </div>
      {hint !== undefined && (
        <FieldHint>
          <span id={hintId}>{hint}</span>
        </FieldHint>
      )}
    </div>
  );
}
