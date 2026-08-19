/**
 * Row context menu (controlled by the caller's `Dropdown`): a hook that turns a
 * secondary click, the keyboard's context-menu chord, and touch press-and-hold into one
 * anchored open, plus the handlers to spread on the row that owns it.
 *
 * It deliberately renders nothing. The panel is a `Dropdown` in `anchorRect` mode, so a
 * context menu inherits — rather than re-implements — that primitive's dismiss stack
 * (Escape through the shared esc-layer, outside click, scroll), its focus handling
 * (opening focuses the first item, Escape hands focus back), and its viewport clamping
 * and flip. The only thing the Dropdown cannot know is where the pointer was, which is
 * what the anchor this hook produces supplies.
 *
 * Native-menu suppression is scoped by construction: `preventDefault` is called inside
 * the row's own `onContextMenu`, so it only ever runs for events that originated in that
 * row. Nothing is bound to `document` or `window` — right-clicking anywhere else in the
 * app still gets the browser's own menu.
 *
 * The rules it applies (which gesture, which anchor, how much slop) are pure and live in
 * `lib/context-menu.ts`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  LONG_PRESS_MS,
  contextMenuAnchor,
  isContextMenuKey,
  isLongPressPointer,
  longPressMoved,
  pointerAnchor,
  withinSettleWindow,
} from "../../lib/context-menu";
import type { AnchorRect } from "../../lib/context-menu";

/** Handlers the owning row spreads onto its container element. */
export interface ContextMenuRowProps {
  onContextMenu: (e: ReactMouseEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export interface RowContextMenu {
  /** Attach to the row container: it is both the gesture target and the keyboard anchor. */
  rowRef: (el: HTMLElement | null) => void;
  rowProps: ContextMenuRowProps;
  open: boolean;
  /** Dismiss requests from the Dropdown (Escape / outside click / scroll). */
  setOpen: (v: boolean) => void;
  /** Viewport box to place the panel against; null while closed. */
  anchor: AnchorRect | null;
  /** Focus target when Escape closes the panel — the row's own button. */
  returnFocus: () => HTMLElement | null;
  /**
   * True exactly once, for the click a touch screen replays after a press-and-hold: the
   * row's click handler calls it first so opening the menu does not also open the row.
   */
  consumeLongPressClick: () => boolean;
  /** Close from inside the panel (an item ran). */
  close: () => void;
}

export function useRowContextMenu(): RowContextMenu {
  const row = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFrom = useRef<{ x: number; y: number } | null>(null);
  /** A press-and-hold opened the menu: swallow the replayed click, and hold off the dismiss. */
  const heldOpen = useRef(false);
  const openedAt = useRef(0);

  const cancelPress = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pressFrom.current = null;
  }, []);

  // A row can unmount mid-press — the list re-renders on every session patch, and the
  // sidebar itself unmounts on navigation — so a pending hold has to die with it rather
  // than fire into a component that is gone.
  useEffect(() => cancelPress, [cancelPress]);

  /** The row's own box, in viewport coordinates (the keyboard path's anchor). */
  const rowRect = useCallback((): AnchorRect => {
    const r = row.current?.getBoundingClientRect();
    return r
      ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      : { top: 0, bottom: 0, left: 0, right: 0 };
  }, []);

  const openAt = useCallback((at: AnchorRect) => {
    openedAt.current = Date.now();
    setAnchor(at);
  }, []);

  const close = useCallback(() => {
    heldOpen.current = false;
    setAnchor(null);
  }, []);

  const rowProps: ContextMenuRowProps = {
    onContextMenu: (e) => {
      // The whole of this feature's native-menu suppression: scoped to events raised
      // inside this row, never registered globally.
      e.preventDefault();
      // Android replays a held press as a native contextmenu on top of our own timer;
      // the hold already opened the menu, so don't re-anchor it out from under the finger.
      if (heldOpen.current) return;
      openAt(contextMenuAnchor(e, rowRect()));
    },
    onKeyDown: (e) => {
      if (!isContextMenuKey(e)) return;
      // Also stops the browser synthesizing its own contextmenu from this chord where it
      // does that, so the menu opens exactly once.
      e.preventDefault();
      openAt(rowRect());
    },
    onPointerDown: (e) => {
      // Cleared for every gesture, mouse included: a flag left set by a hold that never
      // produced its replayed click must not swallow the next real tap.
      heldOpen.current = false;
      if (!isLongPressPointer(e.pointerType)) return;
      const x = e.clientX;
      const y = e.clientY;
      pressFrom.current = { x, y };
      timer.current = setTimeout(() => {
        timer.current = null;
        heldOpen.current = true;
        openAt(pointerAnchor(x, y));
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const from = pressFrom.current;
      if (from === null) return;
      if (longPressMoved(from, { x: e.clientX, y: e.clientY })) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  };

  return {
    rowRef: (el) => {
      row.current = el;
    },
    rowProps,
    open: anchor !== null,
    setOpen: (v) => {
      if (v) return;
      // See LONG_PRESS_SETTLE_MS: the compatibility mousedown a touch screen replays when
      // the finger lifts lands on the row, which the Dropdown reads as an outside click.
      if (heldOpen.current && withinSettleWindow(openedAt.current, Date.now())) return;
      close();
    },
    anchor,
    returnFocus: () => row.current?.querySelector<HTMLElement>("button") ?? null,
    consumeLongPressClick: () => {
      if (!heldOpen.current) return false;
      heldOpen.current = false;
      return true;
    },
    close,
  };
}
