/**
 * The decisions behind the chat page's floating dock launcher (dock-launcher.tsx), kept
 * free of the DOM so they are unit-testable: whether the launcher shows at all, where the
 * ball rests along the chat body's right edge (one global preference, stored as a ratio of
 * the body's height), how far a drag may pull it, and which way its fan opens.
 *
 * Coordinates are the ball's TOP offset within the chat body — the region between the
 * toolbar and the composer — and its horizontal offset from the resting edge: 0 on the
 * edge, negative when pulled into the conversation.
 */
import { rubberband } from "../../lib/sheet-physics";

/** localStorage key of the resting position: the ball's centre as a ratio of the body's height. */
export const LAUNCHER_Y_KEY = "penguin.dock.launcherY";
/** The ball's diameter (px). */
export const LAUNCHER_SIZE = 44;
/** Room kept between the ball and the body's top and bottom edges (px). */
export const LAUNCHER_EDGE_MARGIN = 12;
/** Where the ball rests until the user moves it: centred on the body's height. */
export const DEFAULT_LAUNCHER_RATIO = 0.5;

/** A fan entry's diameter (px), one rung under the ball so the fan reads as its offspring. */
export const FAN_ENTRY_SIZE = 36;
/** Gap between two entries, and between the fan and the ball (px). */
export const FAN_ENTRY_GAP = 8;
export const FAN_GAP = 10;

/** How far the ball can be pulled off its edge mid-drag (px; the rubberband's asymptote). */
const HORIZONTAL_REACH = 40;
/** How far the ball can be pulled past the body's top or bottom mid-drag (px). */
const VERTICAL_REACH = 56;

export interface LauncherVisibility {
  /** The right dock occupies its edge (open — showing its tabs or its picker). */
  rightDockVisible: boolean;
  /** Below the desktop breakpoint the docks merge into one bottom surface. */
  narrow: boolean;
}

/**
 * The launcher stands in for the hidden right dock, so it shows exactly while that dock's
 * edge is free: the dock not visible, and the layout wide enough to have a right dock.
 */
export function shouldShowLauncher({ rightDockVisible, narrow }: LauncherVisibility): boolean {
  return !rightDockVisible && !narrow;
}

/** The ball's travel: the lowest and highest top offsets that keep it inside the body with the margin. */
export function launcherBounds(bodyHeight: number): { min: number; max: number } {
  const min = LAUNCHER_EDGE_MARGIN;
  return { min, max: Math.max(min, bodyHeight - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN) };
}

/** Where a top offset settles: inside the bounds; a body too short for the margins pins it at the top one. */
export function clampLauncherTop(top: number, bodyHeight: number): number {
  const { min, max } = launcherBounds(bodyHeight);
  if (!Number.isFinite(top)) return min;
  return Math.min(max, Math.max(min, top));
}

function clampRatio(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}

/** The resting top offset for a stored ratio (the ball's centre over the body's height). */
export function launcherTopFromRatio(ratio: number, bodyHeight: number): number {
  return clampLauncherTop(ratio * bodyHeight - LAUNCHER_SIZE / 2, bodyHeight);
}

/** The ratio to store for a settled top offset; a body with no height keeps the default. */
export function launcherRatioFromTop(top: number, bodyHeight: number): number {
  if (!(bodyHeight > 0)) return DEFAULT_LAUNCHER_RATIO;
  return clampRatio((clampLauncherTop(top, bodyHeight) + LAUNCHER_SIZE / 2) / bodyHeight);
}

/**
 * A stored ratio, made safe to use: a finite number is clamped into [0, 1]; anything else
 * (absent, malformed, hand-edited) is null, and the caller falls back to the default.
 */
export function parseLauncherRatio(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? clampRatio(value) : null;
}

/** The storage the launcher reads and writes — localStorage, or a stub in tests. */
export type LauncherStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LauncherStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // the accessor itself throws where site data is blocked
  }
}

/** The stored resting ratio, or the default when nothing usable is stored. */
export function readLauncherRatio(storage: LauncherStorage | null = defaultStorage()): number {
  try {
    return parseLauncherRatio(storage?.getItem(LAUNCHER_Y_KEY)) ?? DEFAULT_LAUNCHER_RATIO;
  } catch {
    return DEFAULT_LAUNCHER_RATIO;
  }
}

export function writeLauncherRatio(
  ratio: number,
  storage: LauncherStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(LAUNCHER_Y_KEY, String(clampRatio(ratio)));
  } catch {
    // Private-mode storage failures only cost persistence.
  }
}

/**
 * Where the ball follows the pointer mid-drag. Along the edge it tracks the pointer inside
 * the bounds and rubberbands past them; off the edge it rubberbands from the first pixel,
 * so the ball reads as attached to the edge it snaps back to on release.
 */
export function dragPosition(
  startTop: number,
  dx: number,
  dy: number,
  bodyHeight: number,
): { x: number; top: number } {
  const { min, max } = launcherBounds(bodyHeight);
  const raw = startTop + dy;
  const top =
    raw < min
      ? min - rubberband(min - raw, VERTICAL_REACH)
      : raw > max
        ? max + rubberband(raw - max, VERTICAL_REACH)
        : raw;
  const x = Math.sign(dx) * rubberband(Math.abs(dx), HORIZONTAL_REACH);
  return { x, top };
}

export type FanDirection = "up" | "down";

/** The fan's height for `count` entries, including its gap to the ball (px). */
export function fanHeight(count: number): number {
  if (count <= 0) return 0;
  return FAN_GAP + count * FAN_ENTRY_SIZE + (count - 1) * FAN_ENTRY_GAP;
}

/**
 * The fan rises above the ball whenever the stack fits there; otherwise it opens toward
 * whichever side has more room.
 */
export function fanDirection(top: number, bodyHeight: number, count: number): FanDirection {
  const above = top;
  const below = bodyHeight - top - LAUNCHER_SIZE;
  if (above >= fanHeight(count)) return "up";
  return below > above ? "down" : "up";
}
