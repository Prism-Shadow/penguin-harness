/**
 * The slider: a native `<input type="range">` — so the role, the value, the arrow keys, Page Up /
 * Page Down and Home / End stay the browser's — drawn on the switch's roles. The part of the track
 * up to the thumb is filled in the accent, the switch's "on", and the rest is the switch's off
 * track (the control well is close to invisible on Frost's dark canvas), so where the value sits
 * reads at a glance. The thumb is the accent with the switch knob's hairline; track and thumb are
 * round like the switch in every theme, and every fill is an opaque token, so nothing depends on
 * transparency. Beside the track a readout states the value and its unit in tabular figures.
 *
 * The track is drawn under the input rather than on the browser's track, which has no filled
 * part in WebKit: two flat bars, the fill ending at the thumb's centre. No gradient.
 *
 * The readout is decorative for assistive technology: the slider's own `aria-valuetext` carries
 * the same words ("70%", "0.7 dB"), which is what is read out as the value moves. A slider always holds
 * a value, so `required` only draws the mark beside the title. An `error` takes the hint's place
 * and draws the thumb's line in the danger ink. Disabled, the fill and the thumb turn grey, the
 * whole row dims, and it takes no input.
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

/** The input itself, over the drawn track: no browser widget, the thumb's room, the closed state. */
const RANGE =
  "relative h-4 w-full appearance-none bg-transparent disabled:cursor-not-allowed " +
  // The ring sits on the thumb, the part that moves, rather than around the whole bar.
  "focus-visible:outline-none " +
  "focus-visible:[&::-webkit-slider-thumb]:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[&::-webkit-slider-thumb]:[outline-offset:var(--ui-focus-ring-offset)] " +
  "focus-visible:[&::-moz-range-thumb]:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[&::-moz-range-thumb]:[outline-offset:var(--ui-focus-ring-offset)] " +
  // The browser's track stays, empty, for the thumb to sit on: the drawn bars show through it.
  "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent " +
  "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent " +
  // The thumb, centred on the track (WebKit lays it from the track's top edge, so it is pulled up
  // by half the difference of the two heights).
  "[&::-webkit-slider-thumb]:mt-[calc(var(--spacing)*-1.25)] " +
  "[&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:size-4 " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:border " +
  "[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-4 " +
  "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border";

/** The thumb's fill: the accent, or the grey of a closed control. */
const THUMB_FILL = {
  on: "[&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:bg-accent",
  off: "[&::-webkit-slider-thumb]:bg-fg-muted [&::-moz-range-thumb]:bg-fg-muted",
} as const;

/** One bar of the drawn track: the track's height, centred on the input's line, under it. */
const BAR = "pointer-events-none absolute inset-y-0 left-0 my-auto h-1.5 rounded-full";

/**
 * How far along the range a value sits, from 0 at `min` to 1 at `max`. The fill ends at the
 * thumb's centre, which travels the track less the thumb's own width.
 */
function fillWidth(value: number, min: number, max: number): string {
  const share = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
  return `calc((100% - var(--spacing) * 4) * ${share} + var(--spacing) * 2)`;
}

/**
 * A unit that hugs its figure ("70%", "21°C"); any other takes a space ("0.7 dB"). The spacing
 * every A2UI value and chart reading uses, so a form's slider reads as its fill text does.
 */
const TIGHT_UNIT = /^[%°′″]/;

/** The unit as it follows the figure: tight, or after a space; nothing without one. */
function unitSuffix(unit: string | undefined): string {
  if (unit === undefined || unit === "") return "";
  return TIGHT_UNIT.test(unit) ? unit : ` ${unit}`;
}

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
  const spoken = `${shown}${unitSuffix(unit)}`;
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
        <div className="relative flex min-w-0 flex-1 items-center">
          <span aria-hidden data-track="rest" className={`${BAR} right-0 bg-switch-track`} />
          <span
            aria-hidden
            data-track="fill"
            className={`${BAR} ${disabled ? "bg-fg-muted" : "bg-accent"}`}
            style={{ width: fillWidth(value, min, max) }}
          />
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
            className={`${RANGE} ${bad ? THUMB_LINE.bad : THUMB_LINE.ok} ${
              disabled ? THUMB_FILL.off : THUMB_FILL.on
            }`}
          />
        </div>
        {/* A floor under the readout's width, so the tracks of a stack of sliders end at one
            edge whatever their figures and units. */}
        <span aria-hidden className="min-w-12 shrink-0 text-right text-xs text-fg tabular-nums">
          <span className="inline-block text-right" style={{ minWidth: `${width}ch` }}>
            {shown}
          </span>
          {unitSuffix(unit)}
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
