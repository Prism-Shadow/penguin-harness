/**
 * The org chart page's view arithmetic (pure, unit tested): the zoom range and its steps,
 * the fit-to-width zoom a wide chart opens at, and the tone an employee's live state takes.
 */
import type { OrgEmployeeState } from "@prismshadow/penguin-server/api";
import type { Tone } from "../../lib/tone";

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.2;
export const ZOOM_STEP = 0.1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** One step in or out, snapped to the step grid so 0.9 + 0.1 reads 100% and not 99.99999%. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const steps = Math.round(zoom / ZOOM_STEP) + direction;
  return clampZoom(Math.round(steps * ZOOM_STEP * 100) / 100);
}

/**
 * The zoom that fits the drawing in its frame: shrinks a wide chart, down to ZOOM_MIN, and
 * never enlarges a narrow one; 1 while the frame is unmeasured. Floored to whole percents so
 * the readout says what is applied.
 */
export function fitZoom(frameWidth: number, drawingWidth: number): number {
  if (!(frameWidth > 0) || !(drawingWidth > 0)) return 1;
  if (drawingWidth <= frameWidth) return 1;
  return Math.max(ZOOM_MIN, Math.floor((frameWidth / drawingWidth) * 100) / 100);
}

/** Busy while running, attention when its budget paused it, success on the desk — by meaning, as every status mark. */
export function employeeStateTone(state: OrgEmployeeState): Tone {
  return state === "running" ? "busy" : state === "paused" ? "attention" : "success";
}
