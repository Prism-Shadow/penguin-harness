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
 * Does a scroll of `target` move the content `owner` sits in — the question a
 * pointer-anchored panel has to answer before dismissing itself?
 *
 * The panel's scroll listener runs in the capture phase, because scroll events do not
 * bubble. The price is that it hears **every** scrolling element in the document, not only
 * the ones the anchor lies inside: a streaming conversation scrolls its message list on
 * every chunk, and taking each of those as a reason to dismiss wiped a context menu opened
 * in the sidebar — a part of the page that had not moved at all. Containment is the whole
 * test, and the page itself needs no case of its own, because a full-page scroll targets
 * `document`, which contains every node in it.
 *
 * A caller that names no owner still dismisses on any scroll, which is what every anchored
 * panel did before this rule existed.
 */
export function scrollMovesAnchor(target: Node | null, owner: Node | null): boolean {
  if (owner === null || target === null) return true;
  // An Element and the Document both answer `contains`; a target that does not is not
  // something this rule can judge, so it dismisses rather than pin the panel to content
  // that may well have moved.
  return typeof target.contains === "function" ? target.contains(owner) : true;
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

/** Is a dismiss arriving inside the grace window that started at `fromMs` (see LONG_PRESS_SETTLE_MS)? */
export function withinSettleWindow(fromMs: number, nowMs: number): boolean {
  return nowMs - fromMs < LONG_PRESS_SETTLE_MS;
}

/**
 * The gesture's lifecycle, as a pure reducer.
 *
 * A press-and-hold is not one event but a sequence, and the sequence is where this gets
 * subtle: the browser may raise its own `contextmenu` mid-hold and beat our timer to it,
 * and when the finger finally lifts the screen replays the whole press as compatibility
 * mouse events — a `mousedown` that lands on the row (which the menu reads as an outside
 * click) and a `click` on the row's button (which would open the conversation). Both
 * arrive at **lift**, not at open, so the grace period is measured from the lift.
 *
 * Keeping this out of the hook is what makes it testable at all: the component half needs
 * a DOM, this needs only an ordered list of events.
 */
export interface HoldState {
  /** Pointer type of the gesture in flight ("" between gestures). */
  pointer: string;
  /** A press-and-hold owns the open menu, so its replayed click and mousedown are still expected. */
  held: boolean;
  /** Start of the grace period in which a dismiss is ignored. */
  settleFrom: number;
}

export const IDLE_HOLD: HoldState = { pointer: "", held: false, settleFrom: 0 };

export type HoldEvent =
  | { kind: "pointerdown"; pointerType: string }
  /** The press-and-hold timer elapsed. */
  | { kind: "hold"; at: number }
  /** The browser raised its own contextmenu (a right-click, or a hold it timed itself). */
  | { kind: "nativemenu"; at: number }
  | { kind: "pointerup"; at: number }
  /** The menu asked to close (Escape, outside click, scroll). */
  | { kind: "dismiss"; at: number }
  /** The row's button was activated. */
  | { kind: "click" };

export interface HoldOutcome {
  state: HoldState;
  /** `"held"` anchors at the pressed point, `"event"` by the event's own rule, null opens nothing. */
  open: "held" | "event" | null;
  close: boolean;
  /** Swallow the row's activation — this click is the one the hold replayed. */
  swallow: boolean;
}

const OUTCOME = { open: null, close: false, swallow: false } as const;

export function reduceHold(state: HoldState, event: HoldEvent): HoldOutcome {
  switch (event.kind) {
    case "pointerdown":
      // Cleared for every gesture, mouse included: a flag left set by a hold whose replayed
      // click never arrived must not swallow the next real tap.
      return { ...OUTCOME, state: { ...state, pointer: event.pointerType, held: false } };
    case "hold":
      return {
        ...OUTCOME,
        state: { ...state, held: true, settleFrom: event.at },
        open: "held",
      };
    case "nativemenu":
      // Our timer already opened it; don't re-anchor the menu out from under the finger.
      if (state.held) return { ...OUTCOME, state };
      // The browser timed the hold before we did — it is still a hold, and its replayed
      // events still have to be absorbed.
      if (isLongPressPointer(state.pointer))
        return {
          ...OUTCOME,
          state: { ...state, held: true, settleFrom: event.at },
          open: "event",
        };
      return { ...OUTCOME, state, open: "event" };
    case "pointerup":
      // The lift is when the replayed events start arriving, so the grace period starts here
      // rather than when the menu opened — a user who reads the menu before lifting would
      // otherwise have it dismissed by their own finger.
      return {
        ...OUTCOME,
        state: {
          ...state,
          pointer: "",
          settleFrom: state.held ? event.at : state.settleFrom,
        },
      };
    case "dismiss":
      if (state.held && withinSettleWindow(state.settleFrom, event.at))
        return { ...OUTCOME, state };
      return { ...OUTCOME, state: { ...state, held: false }, close: true };
    case "click":
      if (!state.held) return { ...OUTCOME, state };
      return { ...OUTCOME, state: { ...state, held: false }, swallow: true };
  }
}
