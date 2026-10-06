/**
 * Positioning and close behaviour for a portaled popup panel (Select, OptionMenu, InfoPopover
 * and the app's own panels open through it): the panel is mounted via createPortal to
 * document.body and positioned with `position: fixed` against viewport coordinates, so it isn't
 * clipped by any ancestor's overflow (a Modal's scrolling body, a table's overflow-x-auto, etc.).
 *
 * Positioned once on expand: opens upward if there isn't enough room below and there's more room
 * above, and the left edge is clamped within the viewport. Closes on: outside click / Esc / a
 * scroll that moved the trigger / window resize. Esc uses capture and stops propagation — Modal
 * also listens for Esc during the window bubble phase and registers earlier, so without stopping
 * propagation it would close both the panel and the dialog together; scroll likewise uses capture
 * (scroll doesn't bubble), and the panel collapses directly the moment its position would go
 * stale from scrolling, rather than leaving it floating out of place.
 *
 * "That moved the trigger" is not a nicety. Capture on `window` hears every scrolling element in
 * the document, and the panel took each one as a reason to close — so a chat pane auto-following
 * a streaming reply closed the context ring's panel, which sits in the composer toolbar over
 * content that never moved, on every chunk that arrived. {@link scrollMovesAnchor} (shared with
 * the app's context menu and the dock launcher's dismissal) decides which scrolls those are, from
 * the trigger this hook already holds. Closing rather than re-positioning stays the behaviour: the
 * panel is placed once and does not follow its trigger, so a scroll that DID move it leaves the
 * panel pointing at nothing. A trigger the rule cannot see closes, as before — the panel must
 * never become one that no scroll dismisses.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface PortalPanelPosition {
  topPx?: number;
  bottomPx?: number;
  left: number;
  /** Trigger button width (px): the panel uses this as either min-width or a fixed width, as needed. */
  triggerWidth: number;
}

const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 16;

/**
 * Does a scroll of `target` move the content `owner` sits in — the question an anchored panel has
 * to answer before dismissing itself?
 *
 * The panel's scroll listener runs in the capture phase, because scroll events do not bubble. The
 * price is that it hears **every** scrolling element in the document, not only the ones the
 * anchor lies inside: a streaming conversation scrolls its message list on every chunk, and taking
 * each of those as a reason to dismiss wiped a context menu opened in the sidebar — a part of the
 * page that had not moved at all. Containment is the whole test, and the page itself needs no case
 * of its own, because a full-page scroll targets `document`, which contains every node in it.
 *
 * A caller that names no owner still dismisses on any scroll, which is what every anchored panel
 * did before this rule existed.
 */
export function scrollMovesAnchor(target: Node | null, owner: Node | null): boolean {
  if (owner === null || target === null) return true;
  // An Element and the Document both answer `contains`; a target that does not is not
  // something this rule can judge, so it dismisses rather than pin the panel to content
  // that may well have moved.
  return typeof target.contains === "function" ? target.contains(owner) : true;
}

/**
 * The left edge that keeps a panel of `width` px inside a viewport `viewportWidth` px wide: as
 * far right as `preferred` asks, never past the right margin, and never past the left margin
 * either — a panel wider than the viewport pins to the left margin and lets its right side go.
 */
export function clampPanelLeft(preferred: number, width: number, viewportWidth: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(preferred, viewportWidth - width - VIEWPORT_MARGIN));
}

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
  // Store onClose in a ref: callers mostly pass inline arrow functions, and putting it directly in
  // the dependency array would re-attach the listener on every render.
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
    setPosition({
      topPx: openUpward ? undefined : rect.bottom + PANEL_GAP,
      bottomPx: openUpward ? window.innerHeight - rect.top + PANEL_GAP : undefined,
      left: clampPanelLeft(rect.left, width, window.innerWidth),
      triggerWidth: rect.width,
    });
  }, [open, estimatedHeight, panelWidth]);

  // `panelWidth` is only the caller's estimate: a panel sized in spacing units (`w-72`) scales
  // with the theme's --ui-space-unit, so under a theme whose unit is not 4px the mounted panel is
  // wider than the number it was clamped by, and one opened near the right edge ran off the
  // screen. Once the panel is in the DOM its own width re-clamps it — still before paint, and the
  // second pass finds the left edge already in range, so this settles in one extra render.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (position === null || panel === null) return;
    const left = clampPanelLeft(position.left, panel.offsetWidth, window.innerWidth);
    if (left !== position.left) setPosition({ ...position, left });
  }, [position]);

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
    // The panel's own internal scroll (when the list exceeds max-h) must not trigger a close: only
    // scrolling of an outer container invalidates the position.
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
