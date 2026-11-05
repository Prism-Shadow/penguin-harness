/**
 * The ticket card's press gesture (pure, unit tested): a click opens the ticket, and dragging the
 * card lifts it so it can be dropped on another column.
 *
 * One machine per board, since a board only ever has one card under a finger or the mouse:
 *
 * - `idle` → a primary press starts `pressing`.
 * - `pressing` → released without moving past the slop: a click, and the click event that follows
 *   is let through, so the card opens. A mouse or a pen that moves past the slop lifts the card
 *   there and then. A touch lifts it only by holding still for the long press: on a phone the
 *   board is mostly cards, so a finger moving on one has to scroll the page, and a touch that moves
 *   past the slop first gives the press up and leaves the browser's scroll (or tap) alone.
 * - `lifted` → the card follows the pointer, and releasing it drops it where the pointer is.
 * - A cancel (the browser took the gesture over, the pointer was lost, Escape) ends any phase; a
 *   lifted card is put back.
 *
 * Only a gesture that lifted the card swallows the click the browser sends after it: a mouse
 * released over the card it pressed still fires one, and so does a touch released between the
 * hold completing and the platform's own long-press threshold. The guard is short-lived and a new
 * press resets it, so a click that does not belong to a drag — Enter, Space, a screen reader's
 * activation — is never eaten by a stale one.
 *
 * The touch-scroll half of the contract lives in the DOM binding: while a card is only being
 * pressed nothing here stops the page, so a finger that moves scrolls it and the browser's
 * `pointercancel` ends the press.
 */

/** How long a touch has to hold a card still before it lifts; a mouse or a pen never waits. */
export const LONG_PRESS_MS = 350;

/**
 * How far (px, either axis) a pressed pointer may move and still be a click. Past it a mouse or a
 * pen starts dragging the card, and a touch gives up its hold.
 */
export const PRESS_SLOP_PX = 6;

/** How long after a drag ends the click it produces is still swallowed. */
export const CLICK_GUARD_MS = 600;

export type PressPhase = "idle" | "pressing" | "lifted";

export interface PressPoint {
  pointerId: number;
  x: number;
  y: number;
}

export interface PressStart extends PressPoint {
  /** `MouseEvent.button`: only the main button (0) presses a card. */
  button: number;
  isPrimary: boolean;
  /** `PointerEvent.pointerType`: `"touch"` lifts the card on a long press, any other on movement. */
  pointerType: string;
}

export interface PressHandlers {
  /** The card lifts, held from the point it was pressed. */
  lift: (at: { x: number; y: number }) => void;
  /** A lifted card follows the pointer. */
  drag: (at: { x: number; y: number }) => void;
  /** A lifted card was released here. */
  drop: (at: { x: number; y: number }) => void;
  /** A lifted card was cancelled rather than released: it goes back where it was. */
  cancel: () => void;
}

/** The timer seam: the browser's in the app, fake timers in the tests. */
export interface PressTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: PressTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TicketPress {
  phase: () => PressPhase;
  down: (e: PressStart) => void;
  move: (e: PressPoint) => void;
  up: (e: PressPoint) => void;
  /** The gesture is over without a release: pointercancel, a lost pointer, Escape. */
  cancel: () => void;
  /** Whether the click now arriving belongs to a drag (and so is swallowed). */
  consumeClick: () => boolean;
  dispose: () => void;
}

export function createTicketPress(
  handlers: PressHandlers,
  options: { holdMs?: number; slopPx?: number; timers?: PressTimers } = {},
): TicketPress {
  const holdMs = options.holdMs ?? LONG_PRESS_MS;
  const slopPx = options.slopPx ?? PRESS_SLOP_PX;
  const timers = options.timers ?? defaultTimers;
  let phase: PressPhase = "idle";
  let pointerId = -1;
  let origin = { x: 0, y: 0 };
  /** The press is a touch: it lifts on the hold, and moving past the slop gives it up. */
  let touch = false;
  let holdTimer: unknown = null;
  let guard = false;
  let guardTimer: unknown = null;

  const clearHold = () => {
    if (holdTimer !== null) timers.clear(holdTimer);
    holdTimer = null;
  };
  const clearGuard = () => {
    if (guardTimer !== null) timers.clear(guardTimer);
    guardTimer = null;
    guard = false;
  };
  /** A drag ended: swallow the click it is about to produce. */
  const armGuard = () => {
    clearGuard();
    guard = true;
    guardTimer = timers.set(() => {
      guard = false;
      guardTimer = null;
    }, CLICK_GUARD_MS);
  };
  const end = () => {
    clearHold();
    phase = "idle";
    pointerId = -1;
  };
  const liftCard = () => {
    phase = "lifted";
    handlers.lift(origin);
  };

  return {
    phase: () => phase,

    down: (e) => {
      if (!e.isPrimary || e.button !== 0) return;
      // A lifted card whose release was lost goes back before the next press takes over.
      if (phase === "lifted") handlers.cancel();
      end();
      clearGuard();
      phase = "pressing";
      pointerId = e.pointerId;
      origin = { x: e.x, y: e.y };
      touch = e.pointerType === "touch";
      if (touch) {
        holdTimer = timers.set(() => {
          holdTimer = null;
          if (phase === "pressing") liftCard();
        }, holdMs);
      }
    },

    move: (e) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      if (phase === "lifted") {
        handlers.drag({ x: e.x, y: e.y });
        return;
      }
      if (Math.abs(e.x - origin.x) <= slopPx && Math.abs(e.y - origin.y) <= slopPx) return;
      // Past the slop before lifting: a touch is scrolling the page, anything else is dragging.
      if (touch) {
        end();
        return;
      }
      liftCard();
      handlers.drag({ x: e.x, y: e.y });
    },

    up: (e) => {
      if (phase === "idle" || e.pointerId !== pointerId) return;
      const was = phase;
      end();
      // Released before it lifted, the press is a click: the click that follows opens the card.
      if (was !== "lifted") return;
      handlers.drop({ x: e.x, y: e.y });
      armGuard();
    },

    cancel: () => {
      if (phase === "idle") return;
      const was = phase;
      end();
      if (was !== "lifted") return;
      handlers.cancel();
      armGuard();
    },

    consumeClick: () => {
      const swallow = guard;
      clearGuard();
      return swallow;
    },

    dispose: () => {
      end();
      clearGuard();
    },
  };
}

/**
 * How far to scroll a container this frame while a lifted card is held near one of its edges:
 * nothing outside the band, then faster the deeper into it — negative toward the start edge,
 * positive toward the end. `pos`, `start` and `end` are one axis of the pointer and of the
 * container's visible box.
 */
export function edgeScrollStep(
  pos: number,
  start: number,
  end: number,
  band = 48,
  maxStep = 16,
): number {
  if (end - start <= band * 2) return 0;
  if (pos < start + band) {
    const depth = Math.min(1, (start + band - pos) / band);
    return -Math.ceil(depth * maxStep);
  }
  if (pos > end - band) {
    const depth = Math.min(1, (pos - (end - band)) / band);
    return Math.ceil(depth * maxStep);
  }
  return 0;
}
