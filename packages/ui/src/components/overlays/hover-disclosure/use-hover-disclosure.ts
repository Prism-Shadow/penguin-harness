/**
 * Hover disclosure: a trigger whose panel opens when a mouse rests on it and pins open on a
 * click. The "?" beside a title (InfoPopover) is the first user; any small explanation that
 * should answer a pointer that stopped to ask, without a click, opens through it.
 *
 * - **Hover.** A mouse resting on the trigger opens the panel after the tooltip's delay
 *   (`HOVER_OPEN_DELAY_MS`), so the app has one hover timing and a pointer crossing the page
 *   leaves no trail of panels. Leaving closes it after a short grace, and the pointer entering
 *   the panel inside that grace keeps it open: the panel is read, its text selected and a link
 *   in it followed, which a panel that vanished on the way to it would forbid.
 * - **Pin.** A click on the trigger pins the panel open, and leaving no longer closes it; a
 *   second click closes it. A press inside an open panel pins it too, since a text selection
 *   that overshoots the panel's edge must not lose the panel mid-drag.
 * - **Touch and pen** are ignored for hover. Touch has no hover: the enter and leave a tap
 *   raises around its press are not a pointer resting anywhere, and a finger held past the delay
 *   would open the panel before the tap was done. A tap is the click, so it pins, as before.
 * - **Keyboard.** Enter and Space toggle through the button's own click. Focus alone opens
 *   nothing, or tabbing through a form full of triggers would spray panels.
 *
 * Dismissal from outside (an outside click, Esc, a scroll, a resize) is the caller's panel
 * layer's: `close` is what it calls, and it clears a pin as well.
 *
 * Every decision is the pure {@link reduceHoverDisclosure}, so the sequences can be tested in
 * the package's node-only suite; the hook owns only the timer and the React state.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HOVER_OPEN_DELAY_MS } from "../tooltip/tooltip";

/**
 * How long a hover-opened panel outlives the pointer leaving it (ms). The panel hangs a few
 * pixels off its trigger, so this only has to cover the trip across that gap, diagonals
 * included; longer, and a panel the reader is done with lingers after them.
 */
export const HOVER_CLOSE_GRACE_MS = 200;

/** The wait before each pending change takes effect (ms). */
export const HOVER_DISCLOSURE_DELAY_MS = {
  open: HOVER_OPEN_DELAY_MS,
  close: HOVER_CLOSE_GRACE_MS,
} as const;

export interface HoverDisclosureState {
  /** The panel is showing. */
  open: boolean;
  /** Held by a click, a tap, a key or a press inside the panel: leaving does not close it. */
  pinned: boolean;
  /** The change waiting on a timer: the hover's open delay, the leave's grace, or none. */
  pending: "open" | "close" | null;
}

export const CLOSED_DISCLOSURE: HoverDisclosureState = {
  open: false,
  pinned: false,
  pending: null,
};

/** What the trigger and the panel report: the pointer entering or leaving either, then the rest. */
export type HoverDisclosureEvent =
  | { kind: "enter"; part: "trigger" | "panel"; pointerType: string }
  | { kind: "leave"; pointerType: string }
  /** A press inside the open panel: the reader is using it. */
  | { kind: "press" }
  /** The trigger was activated: a click, a tap, or Enter/Space on the focused button. */
  | { kind: "toggle" }
  /** The pending timer elapsed. */
  | { kind: "elapsed" }
  /** Dismissed from outside: an outside click, Esc, a scroll, a resize. A pin goes with it. */
  | { kind: "dismiss" };

/** Only a mouse hovers; a touch or a pen raises enter and leave around a tap. */
export function isHoverPointer(pointerType: string): boolean {
  return pointerType === "mouse";
}

const PINNED: HoverDisclosureState = { open: true, pinned: true, pending: null };

export function reduceHoverDisclosure(
  state: HoverDisclosureState,
  event: HoverDisclosureEvent,
): HoverDisclosureState {
  switch (event.kind) {
    case "enter":
      if (!isHoverPointer(event.pointerType)) return state;
      // Back inside the trigger or the panel within the grace: the close is called off.
      if (state.open) return state.pending === "close" ? { ...state, pending: null } : state;
      // Closed, only the trigger asks; a panel being taken down is not a request to open.
      return event.part === "trigger" && state.pending !== "open"
        ? { ...state, pending: "open" }
        : state;
    case "leave":
      if (!isHoverPointer(event.pointerType)) return state;
      if (!state.open) return state.pending === "open" ? { ...state, pending: null } : state;
      return state.pinned ? state : { ...state, pending: "close" };
    case "press":
      return state.open ? PINNED : state;
    case "toggle":
      // A hover-opened panel is pinned rather than closed: the click of a reader who expected
      // to need one must not take away what they came for.
      return state.open && state.pinned ? CLOSED_DISCLOSURE : PINNED;
    case "elapsed":
      if (state.pending === "open") return { open: true, pinned: false, pending: null };
      if (state.pending === "close") return CLOSED_DISCLOSURE;
      return state;
    case "dismiss":
      return CLOSED_DISCLOSURE;
  }
}

/** Handlers the trigger spreads. */
export interface HoverDisclosureTriggerProps {
  onPointerEnter: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
  onClick: () => void;
}

/** Handlers the panel spreads. */
export interface HoverDisclosurePanelProps {
  onPointerEnter: (e: ReactPointerEvent) => void;
  onPointerLeave: (e: ReactPointerEvent) => void;
  onPointerDown: () => void;
}

export interface HoverDisclosure {
  open: boolean;
  /** Close it, pinned or not: the panel layer's outside click, Esc, scroll and resize. */
  close: () => void;
  triggerProps: HoverDisclosureTriggerProps;
  panelProps: HoverDisclosurePanelProps;
}

export function useHoverDisclosure(): HoverDisclosure {
  const [open, setOpen] = useState(false);
  // The reducer's state lives in a ref, read and written synchronously by each event, so a
  // leave and an enter in the same frame see each other; only `open` drives a render.
  const state = useRef<HoverDisclosureState>(CLOSED_DISCLOSURE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { stop, ...handlers } = useMemo(() => {
    const clearTimer = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const dispatch = (event: HoverDisclosureEvent) => {
      const prev = state.current;
      const next = reduceHoverDisclosure(prev, event);
      state.current = next;
      // A timer runs exactly while `pending` names it: a change of pending cancels the old one
      // and starts the new one, and an unchanged pending keeps its timer running.
      if (next.pending !== prev.pending) {
        clearTimer();
        const pending = next.pending;
        if (pending !== null) {
          timer.current = setTimeout(() => {
            timer.current = null;
            dispatch({ kind: "elapsed" });
          }, HOVER_DISCLOSURE_DELAY_MS[pending]);
        }
      }
      if (next.open !== prev.open) setOpen(next.open);
    };
    const leave = (e: ReactPointerEvent) => dispatch({ kind: "leave", pointerType: e.pointerType });
    return {
      stop: () => {
        clearTimer();
        state.current = { ...state.current, pending: null };
      },
      close: () => dispatch({ kind: "dismiss" }),
      triggerProps: {
        onPointerEnter: (e: ReactPointerEvent) =>
          dispatch({ kind: "enter", part: "trigger", pointerType: e.pointerType }),
        onPointerLeave: leave,
        onClick: () => dispatch({ kind: "toggle" }),
      },
      panelProps: {
        onPointerEnter: (e: ReactPointerEvent) =>
          dispatch({ kind: "enter", part: "panel", pointerType: e.pointerType }),
        onPointerLeave: leave,
        onPointerDown: () => dispatch({ kind: "press" }),
      },
    };
  }, []);

  // A trigger can unmount with a timer in flight (a dialog closing under the pointer), and the
  // timer must die with it rather than set state on a component that is gone.
  useEffect(() => stop, [stop]);

  return { open, ...handlers };
}
