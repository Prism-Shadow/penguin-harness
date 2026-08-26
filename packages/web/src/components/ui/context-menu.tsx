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
 * This half owns only the DOM: element rects, the hold timer, and dispatching events.
 * Every decision — which gesture counts, which anchor, whether a dismiss is believed —
 * is pure and lives in `lib/context-menu.ts`, where the sequences can be tested without
 * a DOM.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  IDLE_HOLD,
  LONG_PRESS_MS,
  contextMenuAnchor,
  isContextMenuKey,
  isLongPressPointer,
  longPressMoved,
  pointerAnchor,
  reduceHold,
} from "../../lib/context-menu";
import type { AnchorRect, HoldEvent, HoldState } from "../../lib/context-menu";

/** Handlers the owning row spreads onto its container element. */
export interface ContextMenuRowProps {
  onContextMenu: (e: ReactMouseEvent) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
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
  /**
   * Programmatic open at a given viewport box (the row's ellipsis "more" button anchors
   * the panel at itself). Same direct setAnchor path as the keyboard chord — no hold
   * lifecycle is involved, and the Dropdown's dismiss stack takes over once open.
   */
  openAt: (rect: AnchorRect) => void;
  /** Close from inside the panel (an item ran). */
  close: () => void;
}

export function useRowContextMenu(): RowContextMenu {
  const row = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressFrom = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<HoldState>(IDLE_HOLD);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pressFrom.current = null;
  }, []);

  // A row can unmount mid-press — the list re-renders on every session patch, and the
  // sidebar itself unmounts on navigation — so a pending hold has to die with it rather
  // than fire into a component that is gone.
  useEffect(() => cancelTimer, [cancelTimer]);

  /** The row's own box, in viewport coordinates (the keyboard path's anchor). */
  const rowRect = useCallback((): AnchorRect => {
    const r = row.current?.getBoundingClientRect();
    return r
      ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      : { top: 0, bottom: 0, left: 0, right: 0 };
  }, []);

  /** Run one gesture event through the pure lifecycle and apply what it asks for. */
  const dispatch = useCallback((event: HoldEvent, eventAnchor?: AnchorRect) => {
    const out = reduceHold(hold.current, event);
    hold.current = out.state;
    if (out.open === "held") {
      const at = pressFrom.current;
      if (at) setAnchor(pointerAnchor(at.x, at.y));
    } else if (out.open === "event" && eventAnchor) {
      setAnchor(eventAnchor);
    }
    if (out.close) setAnchor(null);
    return out;
  }, []);

  /**
   * Did this event actually come from the row, rather than from the menu panel?
   * React propagates events through its own tree, and the Dropdown's portal is a React
   * child of this row — so without this check, right-clicking a menu item would bubble
   * back here and jump the open menu to sit under the cursor. The panel is mounted on
   * `document.body`, so it fails a DOM containment test while any real row child passes.
   */
  const fromRow = (e: { currentTarget: unknown; target: unknown }): boolean => {
    const host = e.currentTarget as Node | null;
    return host instanceof Node && host.contains(e.target as Node);
  };

  const rowProps: ContextMenuRowProps = {
    onContextMenu: (e) => {
      if (!fromRow(e)) return;
      // The whole of this feature's native-menu suppression: scoped to events raised
      // inside this row, never registered globally.
      e.preventDefault();
      dispatch({ kind: "nativemenu", at: Date.now() }, contextMenuAnchor(e, rowRect()));
      // The browser may have timed the hold itself; our own timer must not fire on top.
      if (hold.current.held) cancelTimer();
    },
    onKeyDown: (e) => {
      if (!fromRow(e)) return;
      if (!isContextMenuKey(e)) return;
      // Also stops the browser synthesizing its own contextmenu from this chord where it
      // does that, so the menu opens exactly once.
      e.preventDefault();
      setAnchor(rowRect());
    },
    onPointerDown: (e) => {
      if (!fromRow(e)) return;
      dispatch({ kind: "pointerdown", pointerType: e.pointerType });
      if (!isLongPressPointer(e.pointerType)) return;
      const x = e.clientX;
      const y = e.clientY;
      pressFrom.current = { x, y };
      timer.current = setTimeout(() => {
        timer.current = null;
        dispatch({ kind: "hold", at: Date.now() });
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      const from = pressFrom.current;
      if (from === null) return;
      if (longPressMoved(from, { x: e.clientX, y: e.clientY })) cancelTimer();
    },
    onPointerUp: () => {
      cancelTimer();
      dispatch({ kind: "pointerup", at: Date.now() });
    },
    onPointerCancel: () => {
      cancelTimer();
      dispatch({ kind: "pointerup", at: Date.now() });
    },
  };

  const close = useCallback(() => {
    hold.current = { ...hold.current, held: false };
    setAnchor(null);
  }, []);

  return {
    rowRef: useCallback((el: HTMLElement | null) => {
      row.current = el;
    }, []),
    rowProps,
    open: anchor !== null,
    setOpen: (v) => {
      if (v) return;
      // The dismiss is only believed outside the post-lift grace window: a touch screen
      // replays the held press as a mousedown on the row, which the Dropdown reads as an
      // outside click on the menu that same gesture just opened.
      dispatch({ kind: "dismiss", at: Date.now() });
    },
    anchor,
    returnFocus: () => row.current?.querySelector<HTMLElement>("button") ?? null,
    consumeLongPressClick: () => dispatch({ kind: "click" }).swallow,
    openAt: setAnchor,
    close,
  };
}
