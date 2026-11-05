/**
 * What the chrome's select shares with any listbox, pure so it is unit-tested: which option a key
 * moves the active row to (the arrows step and stop at the ends, Home and End jump, a typed
 * character jumps to the next option that starts with it), and where the panel opens against its
 * trigger — below it, or above when below lacks the room and above has more, with its left edge
 * kept inside the viewport.
 */

/** The option `key` moves to from `current` (-1 for none) among `count`; null for a key that is not navigation. */
export function nextOptionIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(current + 1, last);
    case "ArrowUp":
      return current < 0 ? last : Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/**
 * The option a typed character jumps to: the first after `current` whose label starts with it,
 * wrapping round, case-folded; null when none does (or the key is not one printable character).
 */
export function typeaheadIndex(
  key: string,
  labels: readonly string[],
  current: number,
): number | null {
  if (key.length !== 1 || key === " ") return null;
  const wanted = key.toLowerCase();
  for (let step = 1; step <= labels.length; step++) {
    const index = (current + step + labels.length) % labels.length;
    if (labels[index]?.toLowerCase().startsWith(wanted)) return index;
  }
  return null;
}

/** A trigger's viewport box: the part of a DOMRect the placement reads. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Where a listbox panel sits, in fixed viewport coordinates: exactly one of `top` / `bottom` is given. */
export interface PanelPlacement {
  top?: number;
  bottom?: number;
  left: number;
  /** The trigger's width: the panel is never narrower than what opened it. */
  minWidth: number;
}

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 16;

/**
 * Below the trigger, or above it when the room below is short of `panelHeight` and the room
 * above is larger; the left edge clamped so a panel `panelWidth` wide (the trigger's width when
 * not given) stays inside the viewport's margin.
 */
export function placePanel(
  trigger: Box,
  viewport: Viewport,
  panelHeight: number,
  panelWidth = trigger.width,
): PanelPlacement {
  const spaceBelow = viewport.height - trigger.bottom;
  const spaceAbove = trigger.top;
  const height = Math.min(panelHeight, viewport.height * 0.7);
  const upward = spaceBelow < height && spaceAbove > spaceBelow;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(trigger.left, viewport.width - panelWidth - VIEWPORT_MARGIN),
  );
  return {
    ...(upward
      ? { bottom: viewport.height - trigger.top + PANEL_GAP }
      : { top: trigger.bottom + PANEL_GAP }),
    left,
    minWidth: trigger.width,
  };
}
