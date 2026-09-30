/**
 * Where a tooltip hangs off its trigger, pure so it is unit-tested: under it, aligned to whichever
 * of its vertical edges faces the roomier half of the window, so the panel always grows inward —
 * a control at the right end of the top bar gets a panel that grows leftward and stays on
 * screen. `room` is how wide the panel may grow from its anchored edge before it would cross the
 * margin on the other side; a long hint wraps at it.
 */

export interface TipBox {
  bottom: number;
  left: number;
  right: number;
  width: number;
}

/** Exactly one of `left` / `right` is given: the edge the panel is pinned by. */
export interface TipPlacement {
  top: number;
  left?: number;
  right?: number;
  room: number;
}

const TIP_GAP = 6;
const VIEWPORT_MARGIN = 8;

export function placeTip(
  trigger: TipBox,
  viewport: { width: number; height: number },
): TipPlacement {
  const top = trigger.bottom + TIP_GAP;
  if (trigger.left + trigger.width / 2 > viewport.width / 2) {
    const right = Math.max(viewport.width - trigger.right, VIEWPORT_MARGIN);
    return { top, right, room: Math.max(viewport.width - right - VIEWPORT_MARGIN, 0) };
  }
  const left = Math.max(trigger.left, VIEWPORT_MARGIN);
  return { top, left, room: Math.max(viewport.width - left - VIEWPORT_MARGIN, 0) };
}
