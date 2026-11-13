/**
 * The arithmetic of a number input's stepper and range: where a minus or a plus moves the typed
 * value, when one of them has nowhere to go, and the range in symbols every language reads.
 *
 * The value is the text the reader typed until they press a step: a step rewrites it as the
 * number it lands on, clamped to the range, rounded to the precision of the value and the step so
 * 0.1 + 0.2 shows as 0.3. A step from an empty or malformed box starts from 0, as the browser's
 * own spinner does.
 */

/** The bounds and the step a number input keeps to; each is optional. */
export interface NumberBounds {
  min?: number;
  max?: number;
  /** The distance one press moves; 1 when omitted. */
  step?: number;
}

/** The digits after the point a number needs: 0.25 → 2, 3 → 0, 1e-7 → 7. */
export function decimalsOf(value: number): number {
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
export function stepNumber(text: string, bounds: NumberBounds, direction: 1 | -1): string {
  const step = bounds.step ?? 1;
  const typed = typedNumber(text);
  const base = Number.isFinite(typed) ? typed : 0;
  const places = Math.min(20, Math.max(decimalsOf(base), decimalsOf(step)));
  let next = Number((base + direction * step).toFixed(places));
  if (bounds.min !== undefined) next = Math.max(bounds.min, next);
  if (bounds.max !== undefined) next = Math.min(bounds.max, next);
  return String(next);
}

/**
 * Whether a step in `direction` has nowhere to go: the typed value already sits at, or past, the
 * bound that step would cross. An empty or malformed box can always step.
 */
export function stepBlocked(text: string, bounds: NumberBounds, direction: 1 | -1): boolean {
  const typed = typedNumber(text);
  if (!Number.isFinite(typed)) return false;
  return direction === 1
    ? bounds.max !== undefined && typed >= bounds.max
    : bounds.min !== undefined && typed <= bounds.min;
}

/** A range in symbols every language reads: "1–10", "≥ 1", "≤ 10"; undefined when unbounded. */
export function rangeText(bounds: { min?: number; max?: number }): string | undefined {
  const { min, max } = bounds;
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return undefined;
}
