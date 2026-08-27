/**
 * Positioning and close behavior for a portaled popup panel (used by OptionMenu,
 * shared for future popup controls): the panel is mounted via createPortal to
 * document.body and positioned with `position: fixed` against viewport
 * coordinates, so it isn't clipped by any ancestor's overflow (Modal content
 * area overflow-y-auto, table overflow-x-auto, etc.).
 *
 * Positioned once on expand: opens upward if there isn't enough room below and
 * there's more room above, and the left edge is clamped within the viewport.
 * Closes on: outside click / Esc / a scroll that moved the trigger / window
 * resize. Esc uses capture and stops propagation — Modal also listens for Esc
 * during the window bubble phase and registers earlier, so without stopping
 * propagation it would close both the panel and the dialog together; scroll
 * likewise uses capture (scroll doesn't bubble), and the panel collapses
 * directly the moment its position would go stale from scrolling, rather than
 * leaving it floating out of place.
 *
 * "That moved the trigger" is not a nicety. Capture on `window` hears every
 * scrolling element in the document, and the panel took each one as a reason to
 * close — so a chat pane auto-following a streaming reply closed the context
 * ring's panel, which sits in the header over content that never moved, on every
 * chunk that arrived. `scrollMovesAnchor` (dropdown.tsx, shared with the context
 * menu's own dismissal) decides which scrolls those are, from the trigger this
 * hook already holds. Closing rather than re-positioning stays the behavior: the
 * panel is placed once and does not follow its trigger, so a scroll that DID move
 * it leaves the panel pointing at nothing. A trigger the rule cannot see closes,
 * as before — the panel must never become one that no scroll dismisses.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { scrollMovesAnchor } from "./dropdown";

export interface PortalPanelPosition {
  topPx?: number;
  bottomPx?: number;
  left: number;
  /** Trigger button width (px): the panel uses this as either min-width or a fixed width, as needed. */
  triggerWidth: number;
}

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 16;

export function usePortalPanel({
  open,
  onClose,
  estimatedHeight,
  panelWidth,
}: {
  open: boolean;
  onClose: () => void;
  /** Estimated panel height (px), used only to decide whether to open upward or downward. */
  estimatedHeight: number;
  /** Fixed panel width (px), used for left-edge clamping; if omitted, the panel width follows the trigger button. */
  panelWidth?: number;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PortalPanelPosition | null>(null);
  // Store onClose in a ref: callers mostly pass inline arrow functions, and putting it directly in the dependency array would re-attach the listener on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const height = Math.min(estimatedHeight, window.innerHeight * 0.7);
    const openUpward = spaceBelow < height && spaceAbove > spaceBelow;
    const width = panelWidth ?? rect.width;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    setPosition({
      topPx: openUpward ? undefined : rect.bottom + PANEL_GAP,
      bottomPx: openUpward ? window.innerHeight - rect.top + PANEL_GAP : undefined,
      left,
      triggerWidth: rect.width,
    });
  }, [open, estimatedHeight, panelWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    // The panel's own internal scroll (when the list exceeds max-h) must not trigger a close: only scrolling of an outer container invalidates the position.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      // ...and only a container that actually holds the trigger moved the position this
      // panel was placed against; the rest of the document's scrollers did not.
      if (!scrollMovesAnchor(e.target as Node | null, triggerRef.current)) return;
      onCloseRef.current();
    };
    // A resize moves every trigger on the page at once, so it closes with no ownership
    // test — the asymmetry with the scroll above is deliberate.
    const onResize = () => onCloseRef.current();
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return { triggerRef, panelRef, position };
}
