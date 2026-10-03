/**
 * The dock's viewport slots the browser layer lays pages over.
 *
 * Every mounted browser panel registers its slot element; the one on screen says so. More
 * than one can be mounted at a time — a tab moving between docks keeps the old dock's copy
 * mounted through its collapse — so the most recently shown slot wins.
 *
 * With the slot comes what the layer needs to place a page over it: the ancestors that clip it,
 * and whether it sits inside a fullscreen dock surface, in which case the page must float above
 * the surface's layer rather than under it. Both are read from the DOM once per slot and cached;
 * the one thing that changes them while a slot stays mounted is the surface going fullscreen or
 * back (the dock's content box becomes `fixed` and its placeholder stops clipping it), and the
 * layer drops the caches on that flip (`invalidateSlotClips`).
 */

interface SlotGeometry {
  /** Ancestors that clip the slot, innermost first. */
  clips: HTMLElement[];
  /** The slot is inside a fullscreen dock surface: its page paints above the surface's layer. */
  lifted: boolean;
}

interface SlotEntry {
  element: HTMLElement;
  visible: boolean;
  /** When it last became visible: the tiebreak between two visible slots. */
  shownAt: number;
  /** Read from the DOM on first use; dropped when the fullscreen state flips. */
  geometry: SlotGeometry | null;
}

const slots = new Map<symbol, SlotEntry>();
const listeners = new Set<() => void>();
let version = 0;
let sequence = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Change counter (the useSyncExternalStore snapshot). */
export function slotsVersion(): number {
  return version;
}

/** Registers a slot; the returned function withdraws it. */
export function registerSlot(id: symbol, element: HTMLElement): () => void {
  slots.set(id, { element, visible: false, shownAt: 0, geometry: null });
  notify();
  return () => {
    slots.delete(id);
    notify();
  };
}

export function setSlotVisible(id: symbol, visible: boolean): void {
  const entry = slots.get(id);
  if (entry === undefined || entry.visible === visible) return;
  entry.visible = visible;
  if (visible) {
    sequence += 1;
    entry.shownAt = sequence;
  }
  notify();
}

/** Whether a browser panel is on screen, without measuring anything (safe during render). */
export function hasVisibleSlot(): boolean {
  for (const entry of slots.values()) if (entry.visible) return true;
  return false;
}

/**
 * Drops every slot's cached clip chain and lift flag, to be re-read from the DOM on next use.
 * Called after the DOM has changed around the slots — once the fullscreen flip has been committed,
 * not when the store announces it, since the attribute and the fixed box exist only from the
 * commit on and a read before it would cache the old layout.
 */
export function invalidateSlotClips(): void {
  for (const entry of slots.values()) entry.geometry = null;
}

/**
 * Every ancestor whose overflow clips its content — what can hide part of a slot from view. The
 * walk stops at the nearest `fixed` ancestor (after checking it): a fixed box is laid out against
 * the window, and the boxes above it clip nothing of it — the app shell has no transforms or
 * filters, which would make one of them its containing block instead. That is what lets a
 * fullscreen dock's page escape the dock's placeholder, which clips at the old panel size.
 */
function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") found.push(node);
    if (style.position === "fixed") break;
  }
  return found;
}

function readGeometry(element: HTMLElement): SlotGeometry {
  return {
    clips: clippingAncestors(element),
    lifted: element.closest("[data-fullscreen]") !== null,
  };
}

/** The slot on screen, with what the layer needs to place a page over it. */
export interface VisibleSlot extends SlotGeometry {
  element: HTMLElement;
}

/**
 * The slot on screen, with the ancestors that clip it and whether its page must float above the
 * fullscreen layer; null when no browser panel is showing.
 */
export function visibleSlot(): VisibleSlot | null {
  let best: SlotEntry | null = null;
  for (const entry of slots.values()) {
    if (entry.visible && (best === null || entry.shownAt > best.shownAt)) best = entry;
  }
  if (best === null) return null;
  best.geometry ??= readGeometry(best.element);
  return { element: best.element, clips: best.geometry.clips, lifted: best.geometry.lifted };
}
