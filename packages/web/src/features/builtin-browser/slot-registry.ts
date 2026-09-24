/**
 * The dock's viewport slots the browser layer lays pages over.
 *
 * Every mounted browser panel registers its slot element; the one on screen says so. More
 * than one can be mounted at a time — a tab moving between docks keeps the old dock's copy
 * mounted through its collapse — so the most recently shown slot wins.
 */

interface SlotEntry {
  element: HTMLElement;
  visible: boolean;
  /** When it last became visible: the tiebreak between two visible slots. */
  shownAt: number;
  /** Ancestors that clip it, found on first use (the chain does not change while mounted). */
  clips: HTMLElement[] | null;
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
  slots.set(id, { element, visible: false, shownAt: 0, clips: null });
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

/** Every ancestor whose overflow clips its content — what can hide part of a slot from view. */
function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") found.push(node);
  }
  return found;
}

/** The slot on screen, with the ancestors that clip it; null when no browser panel is showing. */
export function visibleSlot(): { element: HTMLElement; clips: HTMLElement[] } | null {
  let best: SlotEntry | null = null;
  for (const entry of slots.values()) {
    if (entry.visible && (best === null || entry.shownAt > best.shownAt)) best = entry;
  }
  if (best === null) return null;
  best.clips ??= clippingAncestors(best.element);
  return { element: best.element, clips: best.clips };
}
