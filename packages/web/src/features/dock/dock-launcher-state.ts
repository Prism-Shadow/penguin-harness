/**
 * The decisions behind the chat page's floating dock launcher (dock-launcher.tsx), kept
 * free of the DOM so they are unit-testable: whether the launcher shows at all, where the
 * ball rests along the chat body's right edge (one global preference, stored as a ratio of
 * the body's height), how far a drag may pull it, and where on the arc its entries sit.
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
/**
 * The always-visible caption below the ball (px): its gap to the ball plus the pill's own
 * height. It hangs outside the ball's box, so the vertical clamp has to reserve it or the
 * caption would be the first thing the composer covers.
 */
export const LAUNCHER_CAPTION_HEIGHT = 26;

/** A fan entry's diameter (px), one rung under the ball so the fan reads as its offspring. */
export const FAN_ENTRY_SIZE = 36;
/**
 * The distance from the ball's centre to an entry's centre (px).
 *
 * Fixed by the tightest packing the arc can produce. Six entries — five panel kinds plus
 * the terminal — spread evenly leave a chord of 2R·sin(step / 2) between neighbours, and
 * that has to clear the 36px entry diameter. The full semicircle is roomy: step 36°, chord
 * 2·120·sin 18° ≈ 74px. The tight case is the ball parked at the body's top margin, where
 * the arc trims to ≈ 95.7°: step 19.1°, chord 2·120·sin 9.57° ≈ 40px, some 4px of air
 * between circles. A shorter radius closes that gap — at 104px the two would overlap.
 */
export const FAN_RADIUS = 120;
/** Room kept between an entry and the body's top or bottom edge (px). */
const FAN_EDGE_PAD = 4;
/** Vertical room an "above" / "below" label needs beyond the entry itself (px). */
const FAN_LABEL_ROOM = 28;
/**
 * How close to straight up or straight down the arc's END entry must sit for its label to
 * leave its side and stand above or below it instead. Only the two ends are eligible: a
 * trimmed arc packs its entries closely enough that two labels stacked the same way at the
 * same end of it would run into each other.
 */
const FAN_LABEL_TURN = (26 * Math.PI) / 180;

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

/**
 * The ball's travel: the lowest and highest top offsets that keep it inside the body with
 * the margin. The caption hangs below the ball, so the bottom end reserves it too.
 */
export function launcherBounds(bodyHeight: number): { min: number; max: number } {
  const min = LAUNCHER_EDGE_MARGIN;
  const max = bodyHeight - LAUNCHER_SIZE - LAUNCHER_CAPTION_HEIGHT - LAUNCHER_EDGE_MARGIN;
  return { min, max: Math.max(min, max) };
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

/** Which side of an entry its always-visible name is placed on. */
export type FanLabelSide = "left" | "above" | "below";

/** One entry's place on the arc: an offset from the ball's centre, and where its name goes. */
export interface FanSlot {
  /** Horizontal offset (px). Never positive — the arc opens leftward, away from the edge. */
  x: number;
  /** Vertical offset (px); negative above the ball's centre. */
  y: number;
  labelSide: FanLabelSide;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * Where the fan's entries sit, as offsets from the ball's centre.
 *
 * Angles run from 0 at straight up, through pi/2 at straight left, to pi at straight down,
 * so `x = -R·sin(angle)` and `y = -R·cos(angle)`. The usable span is the part of that
 * semicircle that fits inside the chat body: an entry may not rise above the body's top nor
 * sink below its bottom, which bounds `cos(angle)` from both sides and trims the arc toward
 * whichever end has room — near the body's top what is left is the stretch from straight
 * left round to below, near its bottom the stretch from above round to straight left, and
 * in between the whole semicircle. Entries divide that span evenly and come back in DOM
 * order from top to bottom, so keyboard order is visual order.
 */
export function fanLayout(top: number, bodyHeight: number, count: number): FanSlot[] {
  if (count <= 0) return [];
  const centerY = top + LAUNCHER_SIZE / 2;
  const half = FAN_ENTRY_SIZE / 2 + FAN_EDGE_PAD;
  // acos decreases, so the upper bound on cos gives the smallest angle and vice versa.
  let start = Math.acos(clampUnit((centerY - half) / FAN_RADIUS));
  let end = Math.acos(clampUnit((centerY + half - bodyHeight) / FAN_RADIUS));
  if (end < start) {
    // A body shorter than one entry: nothing fits, so collapse the span to its midpoint.
    const mid = (start + end) / 2;
    start = mid;
    end = mid;
  }
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  const first = count > 1 ? start : (start + end) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = first + index * step;
    const x = -FAN_RADIUS * Math.sin(angle);
    const y = -FAN_RADIUS * Math.cos(angle);
    // Which end of the arc this entry is, if either — a lone entry is both, so it is
    // neither, and takes the plain side label its mid-span angle calls for anyway.
    const atEnd =
      count === 1 ? "none" : index === 0 ? "top" : index === count - 1 ? "bottom" : "none";
    return { x, y, labelSide: labelSideAt(angle, atEnd, centerY + y, bodyHeight) };
  });
}

/**
 * An entry's name radiates away from the ball: to the left along most of the arc, and above
 * or below at its ends — but only where the label's own height still fits inside the body,
 * since a span trimmed toward the top can end exactly where a label above it would not.
 */
function labelSideAt(
  angle: number,
  atEnd: "top" | "bottom" | "none",
  entryY: number,
  bodyHeight: number,
): FanLabelSide {
  const reach = FAN_ENTRY_SIZE / 2 + FAN_LABEL_ROOM;
  if (atEnd === "top" && angle <= FAN_LABEL_TURN && entryY - reach >= 0) return "above";
  if (atEnd === "bottom" && angle >= Math.PI - FAN_LABEL_TURN && entryY + reach <= bodyHeight) {
    return "below";
  }
  return "left";
}
