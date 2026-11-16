/**
 * Dragging tiles, on the browser's own drag and drop (as the session list's rows drag): no
 * library, nothing follows the pointer but the browser's drag image, and no tile moves until the
 * drop. What a drop would do is marked where it would land — a line on the edge of the tile the
 * dragged one would go beside, or a ring on the tile it would go into — so the grid holds still
 * while the pointer travels, and there is no motion for reduced motion to calm.
 *
 * Where on a tile the pointer is decides the drop (`dropOnTile`): the leading quarter puts the
 * dragged item before the tile, the trailing quarter after it, and the middle half into it — onto
 * an app makes a folder of the two, onto a folder adds to it. A folder never goes into anything,
 * and neither does an app inside an open folder, so there the tile splits in two halves instead.
 * The grid's empty space takes a drop at the end, and the open folder's backdrop takes an app
 * dragged out of the folder (folder-panel.tsx).
 *
 * The keyboard and touch have the same moves through the tile's menu (Move to…, forward,
 * backward); this module is the pointer's way only.
 */
import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { Side } from "./arrangement";

/** What a drop does. */
export type Drop =
  | { kind: "beside"; targetId: string; side: Side }
  | { kind: "into"; targetId: string }
  | { kind: "end" }
  | { kind: "outOfFolder" };

/** The share of a tile's width, from each edge, that drops beside it rather than into it. */
const EDGE_SHARE = 0.25;

/** The drop the pointer at `x` makes over a tile spanning `left`…`left + width`. */
export function dropOnTile(
  rect: { left: number; width: number },
  x: number,
  canGoInto: boolean,
): { side: Side } | "into" {
  const at = rect.width > 0 ? (x - rect.left) / rect.width : 0.5;
  if (!canGoInto) return { side: at < 0.5 ? "before" : "after" };
  if (at < EDGE_SHARE) return { side: "before" };
  if (at > 1 - EDGE_SHARE) return { side: "after" };
  return "into";
}

/** The type a tile's drag carries, so a file or a link dragged in from elsewhere is not taken. */
const DRAG_TYPE = "application/x-penguin-app-center-tile";

/** The item being dragged: its id, whether it is a folder, and the folder it was dragged out of. */
export interface Dragged {
  id: string;
  folder: boolean;
  from: string | null;
}

export interface TileDrag {
  dragged: Dragged | null;
  /** The drop the pointer would make now, for the marks. */
  pending: Drop | null;
  /** On a tile: the handlers that make it draggable and a drop target. */
  tileProps: (tile: { id: string; folder: boolean; from: string | null; canTakeInto: boolean }) => {
    draggable: true;
    onDragStart: (e: ReactDragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLElement>) => void;
  };
  /**
   * Ends the drag with this drop: for a drop a region hears without being a React target of its
   * own (the open folder's backdrop, which is the dialog's).
   */
  dropNow: (drop: Drop) => void;
  /** On a region that takes a drop of its own: the grid's empty space. */
  areaProps: (
    drop: Drop,
    accepts: (dragged: Dragged) => boolean,
  ) => {
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLElement>) => void;
  };
}

const sameDrop = (a: Drop | null, b: Drop | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function useTileDrag(onDrop: (dragged: Dragged, drop: Drop) => void): TileDrag {
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [pending, setPending] = useState<Drop | null>(null);
  // Read by the handlers mid-drag: a dragover fires every few milliseconds, and the state of the
  // render it was bound in may be one behind.
  const current = useRef<Dragged | null>(null);
  const shown = useRef<Drop | null>(null);

  const show = useCallback((drop: Drop | null) => {
    if (sameDrop(shown.current, drop)) return;
    shown.current = drop;
    setPending(drop);
  }, []);

  const end = useCallback(() => {
    current.current = null;
    setDragged(null);
    show(null);
  }, [show]);

  const take = (e: ReactDragEvent<HTMLElement>, drop: Drop) => {
    e.preventDefault();
    e.stopPropagation();
    const item = current.current;
    end();
    if (item !== null) onDrop(item, drop);
  };

  return {
    dragged,
    pending,
    dropNow: (drop) => {
      const item = current.current;
      end();
      if (item !== null) onDrop(item, drop);
    },
    tileProps: ({ id, folder, from, canTakeInto }) => ({
      draggable: true,
      onDragStart: (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_TYPE, id);
        const item = { id, folder, from };
        current.current = item;
        setDragged(item);
      },
      onDragEnd: end,
      onDragOver: (e) => {
        const item = current.current;
        if (item === null) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (item.id === id) {
          show(null);
          return;
        }
        const zone = dropOnTile(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          canTakeInto && !item.folder,
        );
        show(
          zone === "into"
            ? { kind: "into", targetId: id }
            : { kind: "beside", targetId: id, ...zone },
        );
      },
      onDrop: (e) => {
        const item = current.current;
        if (item === null || item.id === id) {
          end();
          return;
        }
        const zone = dropOnTile(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          canTakeInto && !item.folder,
        );
        take(
          e,
          zone === "into"
            ? { kind: "into", targetId: id }
            : { kind: "beside", targetId: id, ...zone },
        );
      },
    }),
    areaProps: (drop, accepts) => ({
      onDragOver: (e) => {
        const item = current.current;
        if (item === null || !accepts(item)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        show(drop);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) show(null);
      },
      onDrop: (e) => {
        const item = current.current;
        if (item === null || !accepts(item)) return;
        take(e, drop);
      },
    }),
  };
}
