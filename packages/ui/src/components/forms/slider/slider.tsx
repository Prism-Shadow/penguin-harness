/**
 * The slider: a native `<input type="range">` — so the role, the value, the arrow keys, Page Up /
 * Page Down and Home / End stay the browser's — drawn on the switch's roles: the track in the
 * switch's off track (the control well is close to invisible on Frost's dark canvas), the thumb
 * in the accent with the switch knob's hairline, both round like the switch in every theme. Beside it a readout states the value and its unit in tabular figures;
 * the track has no filled part, since the readout already says where the value sits.
 *
 * The readout is decorative for assistive technology: the slider's own `aria-valuetext` carries
 * the same words ("0.7 °C"), which is what is read out as the value moves. A slider always holds
 * a value, so `required` only draws the mark beside the title. An `error` takes the hint's place
 * and draws the thumb's line in the danger ink. Disabled, the whole row dims and takes no input.
 *
 * The title is a real `<label for>`. Without a `label`, give the slider an `id` and label it
 * from outside.
 */
import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { FieldError, FieldHint, FieldLabel } from "../field/field";
import { decimalsOf } from "../number-input/number-step";

export interface SliderProps {
  label?: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** The distance between two positions; 1 when omitted. */
  step?: number;
  /** Written after the value in the readout and in what is read out. */
  unit?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Decimals of the readout; default from `step`. */
  decimals?: number;
  id?: string;
}

/** The input itself: no browser widget, the room the thumb needs, the closed state. */
const RANGE =
  "h-4 min-w-0 flex-1 appearance-none bg-transparent disabled:cursor-not-allowed " +
  // The ring sits on the thumb, the part that moves, rather than around the whole bar.
  "focus-visible:outline-none " +
  "focus-visible:[&::-webkit-slider-thumb]:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[&::-webkit-slider-thumb]:[outline-offset:var(--ui-focus-ring-offset)] " +
  "focus-visible:[&::-moz-range-thumb]:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[&::-moz-range-thumb]:[outline-offset:var(--ui-focus-ring-offset)] " +
  // The track: a pill in the switch's off track.
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full " +
  "[&::-webkit-slider-runnable-track]:bg-switch-track " +
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full " +
  "[&::-moz-range-track]:bg-switch-track " +
  // The thumb: the accent with a hairline, centred on the track (WebKit lays it from the
  // track's top edge, so it is pulled up by half the difference of the two heights).
  "[&::-webkit-slider-thumb]:mt-[calc(var(--spacing)*-1.25)] " +
  "[&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:size-4 " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:bg-accent " +
  "[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-4 " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border " +
  "[&::-moz-range-thumb]:bg-accent";

/** The thumb's line: the knob's hairline, or the danger ink while the value is refused. */
const THUMB_LINE = {
  ok: "[&::-webkit-slider-thumb]:border-switch-knob-line [&::-moz-range-thumb]:border-switch-knob-line",
  bad: "[&::-webkit-slider-thumb]:border-tone-danger-fg [&::-moz-range-thumb]:border-tone-danger-fg",
} as const;

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  required,
  disabled = false,
  hint,
  error,
  decimals,
  id,
}: SliderProps): ReactElement {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const belowId = useId();
  const places = decimals ?? decimalsOf(step ?? 1);
  const figure = (n: number) => n.toFixed(places);
  // The browser keeps the thumb inside the range, so the readout does too.
  const shown = figure(Math.min(max, Math.max(min, value)));
  const spoken = unit !== undefined ? `${shown} ${unit}` : shown;
  // As wide as the widest figure the range can show, so the track never shifts as it moves.
  const width = Math.max(figure(min).length, figure(max).length);
  const bad = Boolean(error);
  const note = bad ? null : hint;
  return (
    <div className="min-w-0" data-control="slider">
      {label != null && (
        <FieldLabel htmlFor={controlId} required={required}>
          {label}
        </FieldLabel>
      )}
      <div className={`flex items-center gap-3 ${disabled ? "opacity-60" : ""}`}>
        <input
          id={controlId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={spoken}
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad || note != null ? belowId : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`${RANGE} ${bad ? THUMB_LINE.bad : THUMB_LINE.ok}`}
        />
        {/* A floor under the readout's width, so the tracks of a stack of sliders end at one
            edge whatever their figures and units. */}
        <span aria-hidden className="min-w-12 shrink-0 text-right text-xs text-fg tabular-nums">
          <span className="inline-block text-right" style={{ minWidth: `${width}ch` }}>
            {shown}
          </span>
          {unit !== undefined && ` ${unit}`}
        </span>
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
