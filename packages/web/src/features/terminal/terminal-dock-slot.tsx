/**
 * Where a page wants the dock's side panes to live.
 *
 * The dock is app-global — it renders on every route from AppLayout, which knows nothing
 * about any page's insides. Left/right panes therefore sat beside `<main>`, taking width
 * from the whole of it, which squeezed a page's own header along with its content. The chat
 * page's Agents and Workspace panels do not do that: they live INSIDE the page, below its
 * top bar, beside the content only. A pane that shares a slot with those panels has to sit
 * where they sit.
 *
 * So a page may donate a position. `<TerminalDockSlot position="right" />` marks a spot in
 * the page's own layout, and AppLayout portals the pane into it instead of using its own
 * row. Pages that donate nothing keep the old placement, which is the right answer for a
 * page with no panel of its own to line up with.
 *
 * The slot is `display: contents`, so it adds no box: the pane and its resize handle become
 * flex children of the page's row directly, exactly as the panels are.
 */
import { useEffect, useRef } from "react";
import type { DockPosition } from "./terminal-dock-state";

type SideSlot = "left" | "right";

const slots = new Map<SideSlot, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeDockSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic change counter — a useSyncExternalStore snapshot for slot registration. */
export function dockSlotVersion(): number {
  return version;
}

/** The node a page donated for this side, or null to use AppLayout's own row. */
export function dockSlot(position: DockPosition): HTMLElement | null {
  return position === "left" || position === "right" ? (slots.get(position) ?? null) : null;
}

export function TerminalDockSlot({ position }: { position: SideSlot }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    slots.set(position, node);
    notify();
    return () => {
      // Only if still ours: a remount registers the new node before the old one cleans up.
      if (slots.get(position) === node) slots.delete(position);
      notify();
    };
  }, [position]);
  return <div ref={ref} className="contents" />;
}
