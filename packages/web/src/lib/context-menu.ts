/**
 * Pure geometry and gesture rules behind a row context menu (the sidebar's Session rows
 * are the first user). The component half is `components/ui/context-menu.tsx`; the parts
 * that decide *where* a menu lands and *whether* a gesture counts as a request for one
 * live here so they can be tested in this package's node-only vitest environment.
 *
 * A context menu must not be a mouse-only affordance: `design/specs/06-PROTOTYPE.md`
 * states that hover-reveal is desktop-only because touch screens have no hover, and a
 * secondary click is desktop-only for the same reason. So three gestures open the same
 * menu — a right-click at the pointer, the platform's keyboard chord against the focused
 * row, and press-and-hold on touch — and the rules for telling them apart are here.
 */

/** Viewport-space box a portaled panel is placed against (the Dropdown's `anchorRect`). */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The subset of a `contextmenu` event the anchoring rules read. */
export interface ContextMenuEventLike {
  button: number;
  clientX: number;
  clientY: number;
}

/** A point, for the press-and-hold slop test. */
export interface Point {
  x: number;
  y: number;
}

/** Zero-size box at the pointer: a context menu hangs off the click point itself. */
export function pointerAnchor(x: number, y: number): AnchorRect {
  return { top: y, bottom: y, left: x, right: x };
}

/**
 * Was this `contextmenu` event produced by a pointer rather than by the keyboard?
 * Browsers synthesize one for the Menu key and Shift+F10 with `button: 0` — no button was
 * pressed — and several report its coordinates as (0, 0); a real secondary click always
 * carries `button: 2`. Treating (0, 0) as keyboard-invoked costs nothing, because a list
 * row inside the sidebar can never be right-clicked at the viewport origin.
 */
export function isPointerContextMenu(e: ContextMenuEventLike): boolean {
  return e.button === 2 && !(e.clientX === 0 && e.clientY === 0);
}

/**
 * Where the menu opens: at the pointer for a real secondary click, and against the row's
 * own box when the keyboard asked for it — a keyboard user has no pointer, so a
 * pointer-anchored panel would land in the corner of the screen, detached from the row it
 * acts on.
 */
export function contextMenuAnchor(e: ContextMenuEventLike, row: AnchorRect): AnchorRect {
  return isPointerContextMenu(e) ? pointerAnchor(e.clientX, e.clientY) : row;
}

/**
 * Shift+F10 — the platform chord for "open the context menu for the focused element".
 * Handled explicitly rather than left to the browser: Windows and Linux browsers
 * synthesize a `contextmenu` event from it, but macOS keyboards have no Menu key and
 * Safari synthesizes nothing, which would stand a keyboard-only Mac user in front of a
 * menu they cannot open.
 */
export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.shiftKey && e.key === "F10";
}

/** Press-and-hold before a touch counts as a context-menu request (ms). */
export const LONG_PRESS_MS = 500;

/** Slop allowed during the hold: past this the finger is scrolling or dragging, not pressing. */
export const LONG_PRESS_SLOP_PX = 10;

/**
 * Grace period after a press-and-hold opened the menu, during which a dismiss request is
 * ignored (ms). Touch screens replay a held press as compatibility mouse events once the
 * finger lifts, and that synthetic `mousedown` lands on the row — outside the panel — so
 * the menu the gesture just opened would dismiss itself before it could be read.
 */
export const LONG_PRESS_SETTLE_MS = 350;

/** Only touch and pen press-and-hold; a mouse has a secondary button and uses it. */
export function isLongPressPointer(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** Did the finger travel far enough during the hold to make this a scroll instead? */
export function longPressMoved(from: Point, to: Point): boolean {
  return (
    Math.abs(to.x - from.x) > LONG_PRESS_SLOP_PX || Math.abs(to.y - from.y) > LONG_PRESS_SLOP_PX
  );
}

/** Is a dismiss arriving inside the post-long-press grace window (see LONG_PRESS_SETTLE_MS)? */
export function withinSettleWindow(openedAtMs: number, nowMs: number): boolean {
  return nowMs - openedAtMs < LONG_PRESS_SETTLE_MS;
}
