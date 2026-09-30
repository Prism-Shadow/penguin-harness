/**
 * When a tooltip shows and where it hangs, pure so both are unit-tested.
 *
 * It shows only when the element shows no text of its own (an icon-only control) or when the
 * text it shows is cut off — some box of it, the element or a descendant, scrolls wider or taller
 * than it is. An element whose words are all on screen gets no hint, whatever it carries: the
 * hint would only repeat them.
 *
 * Placement: under the trigger, aligned to whichever
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

/** The overflow facts of one box, as the DOM reports them. */
export interface OverflowBox {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

const overflows = (box: OverflowBox) =>
  box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;

/** Whether an element with this visible text and these boxes (itself and its descendants) gets a hint. */
export function shouldHint(text: string, boxes: readonly OverflowBox[]): boolean {
  return text.trim() === "" || boxes.some(overflows);
}
