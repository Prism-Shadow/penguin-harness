/**
 * The ticket board's card gesture, bound to the DOM: the press machine of ticket-press.ts fed
 * from pointer events, the lifted card's ghost following the pointer, the column under it, the
 * board and the page scrolling while the ghost is held near their edges, and the one thing a
 * touch screen needs on top — once a card has lifted, the finger's movement drags it instead of
 * scrolling the page.
 *
 * A card is a plain `<button>`: a click (a press the machine lets through, Enter, Space, or a
 * screen reader's activation) opens the ticket. Only the press is tracked here; its moves and its
 * release are read off `window` for the length of the press, so the pointer is followed wherever
 * it goes without capturing it. Columns are found by `data-ticket-column` under the pointer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { OrgTicketItem, OrgTicketStatus } from "@prismshadow/penguin-server/api";
import { canMove, isTicketStatus } from "./ticket-board";
import { createTicketPress, edgeScrollStep } from "./ticket-press";

/** The attribute a column's drop zone carries, holding its status. */
export const TICKET_COLUMN_ATTR = "data-ticket-column";

/** The card being lifted: what the ghost draws and where it is held from. */
export interface LiftedCard {
  ticket: OrgTicketItem;
  /** The card's width, so the ghost is the card's shape. */
  width: number;
  /** Where inside the card the pointer holds it. */
  offsetX: number;
  offsetY: number;
}

/** The column whose drop zone is under a viewport point, if any. */
function columnAt(x: number, y: number): OrgTicketStatus | null {
  const el = document.elementFromPoint(x, y);
  const zone = el?.closest<HTMLElement>(`[${TICKET_COLUMN_ATTR}]`);
  const status = zone?.getAttribute(TICKET_COLUMN_ATTR) ?? null;
  return isTicketStatus(status) ? status : null;
}

/** The nearest ancestor that scrolls vertically: the page column the board sits in. */
function verticalScroller(from: HTMLElement | null): HTMLElement | null {
  for (let el = from?.parentElement ?? null; el !== null; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

export function useTicketBoardDrag({
  onOpen,
  onDrop,
}: {
  onOpen: (ticket: OrgTicketItem) => void;
  /** A lifted card was released over another column. */
  onDrop: (ticket: OrgTicketItem, to: OrgTicketStatus) => void;
}): {
  /** The board's horizontal scroller: the touch listener and the edge scroll hang off it. */
  boardRef: RefObject<HTMLDivElement | null>;
  /** The ghost element: its position is written straight to the DOM as the pointer moves. */
  ghostRef: RefObject<HTMLDivElement | null>;
  lifted: LiftedCard | null;
  /** The ghost's position as of this render, for its `style`. */
  ghostTransform: () => string;
  dropOver: OrgTicketStatus | null;
  cardProps: (ticket: OrgTicketItem) => {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onClick: (e: ReactMouseEvent<HTMLElement>) => void;
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  };
} {
  const [lifted, setLifted] = useState<LiftedCard | null>(null);
  const [dropOver, setDropOver] = useState<OrgTicketStatus | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const callbacks = useRef({ onOpen, onDrop });
  callbacks.current = { onOpen, onDrop };
  /** The pressed card and the live pointer: read by the machine's handlers and the scroll loop. */
  const pressed = useRef<{
    ticket: OrgTicketItem;
    el: HTMLElement;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const ghostTransform = useCallback(() => {
    const p = pressed.current;
    return p === null ? "none" : `translate(${p.x - p.offsetX}px, ${p.y - p.offsetY}px)`;
  }, []);

  /** Re-reads the column under the pointer; only a column the card may move to lights up. */
  const track = useCallback(() => {
    const p = pressed.current;
    if (p === null) return;
    const over = columnAt(p.x, p.y);
    setDropOver(over !== null && canMove(p.ticket.status, over) ? over : null);
  }, []);

  const stopScrolling = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  /** The press is over: the ghost goes, the columns go dark, the edge scroll stops. */
  const finish = useCallback(() => {
    stopScrolling();
    pressed.current = null;
    setLifted(null);
    setDropOver(null);
  }, [stopScrolling]);

  const press = useMemo(
    () =>
      createTicketPress({
        lift: () => {
          const p = pressed.current;
          if (p === null) return;
          const rect = p.el.getBoundingClientRect();
          p.offsetX = p.x - rect.left;
          p.offsetY = p.y - rect.top;
          setLifted({
            ticket: p.ticket,
            width: rect.width,
            offsetX: p.offsetX,
            offsetY: p.offsetY,
          });
          track();
          // Held near an edge of the board or of the page, the view scrolls toward the column
          // the card is being carried to — one step a frame, for as long as it is held there.
          const board = boardRef.current;
          const page = verticalScroller(board);
          const step = () => {
            const q = pressed.current;
            if (q === null) return;
            let moved = false;
            if (board !== null) {
              const r = board.getBoundingClientRect();
              const dx = edgeScrollStep(q.x, r.left, r.right);
              if (dx !== 0) {
                const before = board.scrollLeft;
                board.scrollLeft += dx;
                moved ||= board.scrollLeft !== before;
              }
            }
            if (page !== null) {
              const r = page.getBoundingClientRect();
              const dy = edgeScrollStep(q.y, r.top, r.bottom);
              if (dy !== 0) {
                const before = page.scrollTop;
                page.scrollTop += dy;
                moved ||= page.scrollTop !== before;
              }
            }
            if (moved) track();
            frame.current = requestAnimationFrame(step);
          };
          frame.current = requestAnimationFrame(step);
        },
        drag: (at) => {
          const p = pressed.current;
          if (p === null) return;
          p.x = at.x;
          p.y = at.y;
          if (ghostRef.current !== null) ghostRef.current.style.transform = ghostTransform();
          track();
        },
        drop: (at) => {
          const p = pressed.current;
          const to = columnAt(at.x, at.y);
          finish();
          if (p !== null && to !== null && canMove(p.ticket.status, to)) {
            callbacks.current.onDrop(p.ticket, to);
          }
        },
        cancel: () => finish(),
      }),
    [track, ghostTransform, finish],
  );

  // A lifted card owns the touch that carries it: its moves drag the card rather than scroll the
  // page. The listener is registered for the board's lifetime, not per press, because a browser
  // decides whether a touch may be held back from scrolling when the touch starts — a listener
  // added once the card has lifted would be too late to stop anything.
  useEffect(() => {
    const board = boardRef.current;
    if (board === null) return;
    const hold = (e: TouchEvent) => {
      if (press.phase() === "lifted" && e.cancelable) e.preventDefault();
    };
    board.addEventListener("touchmove", hold, { passive: false });
    return () => board.removeEventListener("touchmove", hold);
  }, [press]);

  useEffect(
    () => () => {
      detach.current?.();
      press.dispose();
      stopScrolling();
    },
    [press, stopScrolling],
  );

  const cardProps = (ticket: OrgTicketItem) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (!e.isPrimary || e.button !== 0) return;
      detach.current?.();
      pressed.current = {
        ticket,
        el: e.currentTarget,
        x: e.clientX,
        y: e.clientY,
        offsetX: 0,
        offsetY: 0,
      };
      press.down({
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        isPrimary: e.isPrimary,
        pointerType: e.pointerType,
      });
      const pointerId = e.pointerId;
      /** Once the machine is idle again the press is over: nothing is held and nothing listens. */
      const settle = () => {
        if (press.phase() !== "idle") return;
        pressed.current = null;
        detach.current?.();
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        press.move({ pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY });
      };
      const onUp = (ev: PointerEvent) => {
        press.up({ pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY });
        settle();
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        press.cancel();
        settle();
      };
      const onKey = (ev: KeyboardEvent) => {
        // Escape puts a lifted card back and goes no further (it would close a dialog). A card
        // not yet lifted has nothing to put back, so its press carries on.
        if (ev.key !== "Escape" || press.phase() !== "lifted") return;
        ev.preventDefault();
        ev.stopPropagation();
        press.cancel();
        settle();
      };
      const onBlur = () => {
        press.cancel();
        settle();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onBlur);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onBlur);
        detach.current = null;
      };
    },
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      // The click a drag produces is not an open.
      if (press.consumeClick()) {
        e.preventDefault();
        return;
      }
      callbacks.current.onOpen(ticket);
    },
    // A pressed card must not raise the platform's long-press menu under the finger.
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      if (press.phase() !== "idle") e.preventDefault();
    },
  });

  return { boardRef, ghostRef, lifted, ghostTransform, dropOver, cardProps };
}
