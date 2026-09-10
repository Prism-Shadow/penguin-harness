/**
 * The decisions behind the chat page's floating dock launcher (dock-launcher.tsx), kept
 * free of the DOM so they are unit-testable: whether the launcher shows at all, where the
 * ball rests along the chat body's right edge (one global preference, stored as a ratio of
 * the body's height), how far a drag may pull it, and where on the arc its entries sit.
 *
 * Two global preferences live here: `penguin.dock.launcherY` (where it rests) and
 * `penguin.dock.launcherHidden` (whether the user put it away at all). Both are registered
 * as browser preferences in lib/install-scope.ts, so switching data roots keeps them.
 *
 * Coordinates are the ball's TOP offset within the chat body — the region between the
 * toolbar and the composer — and its horizontal offset from the resting edge: 0 on the
 * edge, negative when pulled into the conversation.
 */
import { rubberband } from "../../lib/sheet-physics";

/** localStorage key of the resting position: the ball's centre as a ratio of the body's height. */
export const LAUNCHER_Y_KEY = "penguin.dock.launcherY";
/** localStorage key of the put-it-away preference; only LAUNCHER_HIDDEN_ON counts as hidden. */
export const LAUNCHER_HIDDEN_KEY = "penguin.dock.launcherHidden";
const LAUNCHER_HIDDEN_ON = "1";
const LAUNCHER_HIDDEN_OFF = "0";
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
 * The ring's radius at rest (px): how far an entry's centre sits from the ball's centre
 * while the whole semicircle is available.
 *
 * The floor is the tightest packing that arc produces. Seven entries — five panel kinds,
 * the terminal, and the hide entry — spread evenly over a semicircle leave a chord of
 * 2R·sin(step / 2) between neighbours, with step = pi / 6, so keeping FAN_ENTRY_GAP of air
 * around the 36px circles needs 44 / (2·sin 15°) ≈ 85px. 92 is that with a few pixels to
 * spare (a chord of ≈ 48px, some 12px of air), and it keeps the ring close enough to the
 * ball to read as one object. The arc only ever grows from here, and only where a trimmed
 * span would otherwise crowd the entries together.
 */
export const FAN_MIN_RADIUS = 92;
/** Air kept between two neighbouring entries' circles (px). */
export const FAN_ENTRY_GAP = 8;
/**
 * The widest the ring may grow (px). Real geometry never asks for this much — a ball parked
 * against the body's top edge, the tightest span seven entries ever get, settles at ≈ 161px.
 * It is there for a body barely taller than the entries themselves, where no radius can
 * space them apart (the arc that fits keeps a bounded length however far the ring is pushed
 * out) and the solver below would otherwise run away with them off the left of the screen.
 * The ceiling is the narrow layout's width: on a ~320px phone the ball's centre sits 36px
 * from the edge, so an entry's far side, R + 18, has to fit what is left.
 */
export const FAN_MAX_RADIUS = 240;
/** Room kept between an entry and the body's top or bottom edge (px). */
const FAN_EDGE_PAD = 4;
/**
 * How many times the radius and the span are solved against each other before the last
 * pass is taken as-is. Each depends on the other — a wider radius trims the span, a
 * narrower span demands a wider radius — and the loop converges from below within three.
 */
const FAN_RADIUS_PASSES = 6;

/** How far the ball can be pulled off its edge mid-drag (px; the rubberband's asymptote). */
const HORIZONTAL_REACH = 40;
/** How far the ball can be pulled past the body's top or bottom mid-drag (px). */
const VERTICAL_REACH = 56;

export interface LauncherVisibility {
  /** The right dock occupies its edge (open — showing its tabs or its picker). */
  rightDockVisible: boolean;
  /** The bottom dock is open; below the breakpoint it is the surface both docks merge into. */
  bottomDockVisible: boolean;
  /** Below the desktop breakpoint the docks merge into one bottom surface. */
  narrow: boolean;
  /** The user put the launcher away (`penguin.dock.launcherHidden`). */
  hidden: boolean;
}

/**
 * The launcher stands in for whichever dock surface is away, so it shows exactly while
 * that surface's room is free. Wide: the right dock is the one it opens into, so only that
 * dock's state counts. Narrow: the two docks render as ONE merged bottom surface, and the
 * launcher would sit on top of it, so it shows only while neither dock is open. Either way
 * the put-it-away preference wins over the layout.
 */
export function shouldShowLauncher({
  rightDockVisible,
  bottomDockVisible,
  narrow,
  hidden,
}: LauncherVisibility): boolean {
  if (hidden) return false;
  return narrow ? !rightDockVisible && !bottomDockVisible : !rightDockVisible;
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

// ------------------------------------------------------------- put away, and brought back
//
// A tiny store rather than a plain read, because two places far apart render from it: the
// launcher's own mount on the chat page, and the Appearance switch that turns it back on.
// Either can write it, and both have to follow the other. The version counter is the
// useSyncExternalStore snapshot; callers then read the value with readLauncherHidden().

let hiddenVersion = 0;
const hiddenListeners = new Set<() => void>();
/**
 * The live value, read from storage once and kept in memory afterwards: the launcher is
 * rendered from the chat page, which re-renders on every streamed token, and that is no
 * place for a synchronous storage read. Like the dock layout store, this means a change
 * made in another tab is not seen until a reload.
 */
let hiddenCache: boolean | null = null;

export function subscribeLauncherHidden(listener: () => void): () => void {
  hiddenListeners.add(listener);
  return () => void hiddenListeners.delete(listener);
}

export function launcherHiddenVersion(): number {
  return hiddenVersion;
}

function hiddenIn(storage: LauncherStorage | null): boolean {
  try {
    return storage?.getItem(LAUNCHER_HIDDEN_KEY) === LAUNCHER_HIDDEN_ON;
  } catch {
    return false;
  }
}

/**
 * Whether the user put the launcher away. Only the stored "1" hides it; anything else —
 * absent, stale, hand-edited — shows it. An explicit storage bypasses the cache.
 */
export function readLauncherHidden(storage?: LauncherStorage | null): boolean {
  if (storage !== undefined) return hiddenIn(storage);
  if (hiddenCache === null) hiddenCache = hiddenIn(defaultStorage());
  return hiddenCache;
}

/** Puts the launcher away or brings it back, and tells everything rendering from it. */
export function writeLauncherHidden(hidden: boolean, storage?: LauncherStorage | null): void {
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.setItem(LAUNCHER_HIDDEN_KEY, hidden ? LAUNCHER_HIDDEN_ON : LAUNCHER_HIDDEN_OFF);
  } catch {
    // Private-mode storage failures only cost persistence; this session still updates.
  }
  if (storage === undefined) hiddenCache = hidden;
  hiddenVersion += 1;
  for (const listener of hiddenListeners) listener();
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

/** One entry's place on the ring: an offset from the ball's centre. */
export interface FanSlot {
  /** Horizontal offset (px). Never positive — the arc opens leftward, away from the edge. */
  x: number;
  /** Vertical offset (px); negative above the ball's centre. */
  y: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/**
 * The stretch of the leftward semicircle a ring of this radius may use, as angles from 0 at
 * straight up to pi at straight down: an entry may not rise above the body's top nor sink
 * below its bottom, which bounds cos(angle) from both sides and trims the arc toward
 * whichever end has room. A body shorter than one entry collapses the span to its midpoint.
 */
function fanSpan(
  centerY: number,
  bodyHeight: number,
  radius: number,
): { start: number; end: number } {
  const half = FAN_ENTRY_SIZE / 2 + FAN_EDGE_PAD;
  // acos decreases, so the upper bound on cos gives the smallest angle and vice versa.
  const start = Math.acos(clampUnit((centerY - half) / radius));
  const end = Math.acos(clampUnit((centerY + half - bodyHeight) / radius));
  if (end < start) {
    const mid = (start + end) / 2;
    return { start: mid, end: mid };
  }
  return { start, end };
}

/**
 * The radius the ring takes here. It rests at FAN_MIN_RADIUS and grows only as far as the
 * entries need to stay apart: neighbours an angular step apart are a chord of
 * 2R·sin(step / 2) from each other, which has to clear an entry's diameter plus the gap.
 * Growing the radius trims the span, which widens the step it takes again, so the two are
 * solved against each other — each pass starts from the radius the previous one asked for,
 * and FAN_MAX_RADIUS stops a body too short for any spacing to work.
 */
function fanRadius(centerY: number, bodyHeight: number, count: number): number {
  let radius = FAN_MIN_RADIUS;
  for (let pass = 0; pass < FAN_RADIUS_PASSES; pass += 1) {
    const { start, end } = fanSpan(centerY, bodyHeight, radius);
    const step = (end - start) / (count - 1);
    if (!(step > 0)) return radius;
    const needed = (FAN_ENTRY_SIZE + FAN_ENTRY_GAP) / (2 * Math.sin(step / 2));
    if (needed <= radius) return radius;
    if (needed >= FAN_MAX_RADIUS) return FAN_MAX_RADIUS;
    radius = needed;
  }
  return radius;
}

/**
 * Where the fan's entries sit, as offsets from the ball's centre.
 *
 * Angles run from 0 at straight up, through pi/2 at straight left, to pi at straight down,
 * so `x = -R·sin(angle)` and `y = -R·cos(angle)`. The usable span is the part of that
 * semicircle that fits inside the chat body — near the body's top what is left is the
 * stretch from straight left round to below, near its bottom the stretch from above round
 * to straight left, and in between the whole semicircle. Entries divide that span evenly
 * and come back in DOM order from top to bottom, so keyboard order is visual order.
 */
export function fanLayout(top: number, bodyHeight: number, count: number): FanSlot[] {
  if (count <= 0) return [];
  const centerY = top + LAUNCHER_SIZE / 2;
  const radius = count > 1 ? fanRadius(centerY, bodyHeight, count) : FAN_MIN_RADIUS;
  const { start, end } = fanSpan(centerY, bodyHeight, radius);
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  const first = count > 1 ? start : (start + end) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = first + index * step;
    return { x: -radius * Math.sin(angle), y: -radius * Math.cos(angle) };
  });
}
