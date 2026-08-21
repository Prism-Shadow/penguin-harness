/**
 * Dropdown container (controlled): clicking outside collapses it; the panel is absolutely
 * positioned (z-40, per the layering convention — chrome avoids stacking contexts, in-flow
 * menus are z-40, overlays are z-50, and **portaled** popups are z-[60] so they clear an
 * open Modal, matching Select's portal panel). menuClass controls the docking direction and
 * width.
 *
 * `portal` switches the panel to the shared popup strategy (same idea as OptionMenu's
 * use-portal-panel): mounted on document.body with `position: fixed` against viewport
 * coordinates, so **no ancestor's overflow can clip it**. Anchoring inside a scrolling
 * container (the composer toolbar scrolls horizontally on phones) makes that mandatory:
 * setting one axis to a non-`visible` overflow makes the other compute to `auto` too, so an
 * absolutely-positioned panel — an upward one especially — is clipped away entirely.
 *
 * Escape goes through the shared esc-layer stack (see modal.tsx): while open, the menu is
 * the topmost layer, so one Escape closes only the menu even inside a Modal — the Modal's
 * own handler sees itself not on top and stays; the next Escape closes the dialog. The
 * event is deliberately NOT stopped, so element-level Escape handlers inside the panel
 * (e.g. an input reverting its draft) still run on the same press.
 *
 * Keyboard: opening moves focus to the panel's first focusable item, Up/Down walk the
 * items (wrapping), and closing via Escape returns focus to the trigger — without this a
 * keyboard user could open a menu and never reach its contents, which is exactly what
 * happened when the sidebar's row actions moved from bare buttons into these panels.
 *
 * `anchorRect` turns the same panel into a context menu: placement measures the given
 * viewport box instead of the container's own, so the menu can hang off the point a
 * secondary click landed on while everything else — the dismiss stack, focus handling,
 * edge clamping and flip — stays shared with every other menu. A virtual anchor is a
 * position rather than an element, so scrolling **dismisses** such a panel instead of
 * re-placing it: the point it was anchored to has moved out from under it, and there is
 * no trigger left to follow.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "./modal";

/** Gap between the trigger and the portaled panel, and the panel's minimum distance from the viewport edge (px). */
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

/** Portal docking: which way the panel opens and which of its edges lines up with the trigger. */
export interface DropdownPortal {
  direction: "up" | "down";
  align: "left" | "right";
}

export function Dropdown({
  button,
  open,
  setOpen,
  children,
  menuClass,
  menuStyle,
  className,
  portal,
  anchorRect,
  returnFocus,
  onEscape,
  focusOnOpen,
}: {
  button: ReactNode;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: ReactNode;
  /** Panel positioning and size (default: downward, left-aligned, w-64). With `portal`, only the size classes apply — placement comes from the measured trigger rect. */
  menuClass?: string;
  /** Inline overrides for the panel, for values a static class cannot know (e.g. a max-width measured from the trigger's viewport offset). */
  menuStyle?: CSSProperties;
  /** Extra classes for the root container (e.g. flex-1 in a flex layout). */
  className?: string;
  /** Render the panel through a body portal at fixed viewport coordinates, escaping any clipping ancestor. */
  portal?: DropdownPortal;
  /**
   * Place the panel against this viewport box instead of the container's own — a context
   * menu opened at the pointer, where the "trigger" is a whole row rather than a button.
   * Requires `portal`. While set, scrolling dismisses the panel rather than re-placing it.
   */
  anchorRect?: { top: number; bottom: number; left: number; right: number } | null;
  /**
   * Element to focus when Escape closes the panel. Defaults to the first button inside
   * the container, which is the trigger for an ordinary dropdown; a context menu has no
   * trigger of its own and points this at the row it was opened from.
   */
  returnFocus?: () => HTMLElement | null;
  /**
   * When provided, the window-level Escape calls this instead of setOpen(false) — for panels
   * whose close-request semantics differ from a plain dismiss (e.g. an editor where outside
   * click means "commit" but Escape means "cancel"). Outside clicks still call setOpen(false).
   */
  onEscape?: () => void;
  /**
   * Whether opening moves focus into the panel (default true — a click/keyboard-opened
   * menu must be operable from the keyboard). Pass false for a menu that opens on hover:
   * the programmatic focus would otherwise draw the `:focus-visible` ring on its first row
   * (browsers treat scripted focus as keyboard-ish until the page has seen a mouse click),
   * so merely sweeping the pointer past the trigger leaves a stray outline behind.
   */
  focusOnOpen?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Fixed coordinates of the portaled panel, measured from the trigger when it opens. */
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight: number;
  } | null>(null);

  /** The caller-rendered trigger's button element (focus target when Escape closes the menu). */
  const triggerButton = useCallback(
    () => returnFocus?.() ?? ref.current?.querySelector<HTMLElement>("button") ?? null,
    [returnFocus],
  );

  /** The panel's focusable items, in DOM order (menu rows, and any input/link a panel carries). */
  const panelItems = useCallback(
    () =>
      panelRef.current
        ? [
            ...panelRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ]
        : [],
    [],
  );

  // Opening moves focus into the panel (first item), so the menu is operable from the
  // keyboard at all. Runs after the panel has mounted, portal or in-flow alike.
  // Read through a ref so the effect still depends on `open` alone: a caller that flips
  // focusOnOpen while the menu is open must not make focus jump into the panel.
  const focusOnOpenRef = useRef(focusOnOpen);
  focusOnOpenRef.current = focusOnOpen;
  useEffect(() => {
    if (!open || focusOnOpenRef.current === false) return;
    panelItems()[0]?.focus();
  }, [open, panelItems]);

  /**
   * Up/Down walk the panel's items, wrapping at both ends (the standard menu idiom) —
   * but only for plain menus. Two panels own their own keyboard model (model-select and
   * the slash/skill pickers drive a highlighted-index list from an autofocused search
   * box), so this yields whenever an inner handler already consumed the key, and
   * whenever focus sits in a text field where the arrows belong to the caret.
   */
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (e.defaultPrevented) return;
    const focused = document.activeElement;
    const tag = focused?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const items = panelItems();
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const next =
      at < 0 ? (step === 1 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next]?.focus();
  };

  // Latest-callback refs: the open effect below must re-run ONLY on open/close — if it also
  // re-ran on a callback identity change, its esc-layer would pop and re-push, wrongly
  // jumping above any dialog opened in the meantime.
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpenRef.current(false);
    };
    // Escape closes only when this menu is the topmost esc layer (see the header comment)
    // and hands focus back to the trigger — a keyboard user must not be stranded on a
    // panel that just unmounted.
    const layer = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopEscLayer(layer)) return;
      triggerButton()?.focus();
      const esc = onEscapeRef.current;
      if (esc) esc();
      else setOpenRef.current(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      popEscLayer(layer);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Portal mode: place the panel against the trigger's viewport rect, clamped to stay fully
  // on-screen. Measured after paint so the panel's own (class-driven) size is known — the
  // width decides how far the left edge must be pulled back on a phone, and the height decides
  // whether the requested direction has room.
  const place = useCallback(() => {
    if (!open || !portal || !ref.current) {
      setPos(null);
      return;
    }
    // A virtual anchor (context menu) is already in viewport coordinates; otherwise the
    // container's own box is the trigger.
    const rect = anchorRect ?? ref.current.getBoundingClientRect();
    // offsetWidth/offsetHeight, not the bounding rect: the panel plays a pop-in scale
    // animation, and a mid-animation rect reports a smaller box — which would under-clamp the
    // left edge and let the settled panel overrun the viewport. The offset box is untransformed.
    const panel = panelRef.current;
    const panelWidth = panel?.offsetWidth ?? 0;
    const panelHeight = panel?.offsetHeight ?? 0;
    const wanted = portal.align === "right" ? rect.right - panelWidth : rect.left;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(wanted, window.innerWidth - panelWidth - VIEWPORT_MARGIN),
    );
    // Flip when the requested side can't hold the panel and the other side has more room, then
    // cap the height to whatever that side actually offers: the panel scrolls internally rather
    // than running off the top or bottom of the screen, so every row stays reachable.
    const roomBelow = window.innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const roomAbove = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
    const wantUp = portal.direction === "up";
    const fits = wantUp ? panelHeight <= roomAbove : panelHeight <= roomBelow;
    const up = fits ? wantUp : roomAbove > roomBelow;
    setPos({
      left,
      maxHeight: Math.max(0, up ? roomAbove : roomBelow),
      ...(up
        ? { bottom: window.innerHeight - rect.top + PANEL_GAP }
        : { top: rect.bottom + PANEL_GAP }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    portal?.direction,
    portal?.align,
    children,
    anchorRect?.top,
    anchorRect?.left,
    anchorRect?.bottom,
    anchorRect?.right,
  ]);

  useLayoutEffect(place, [place]);

  // Fixed coordinates go stale when anything scrolls or the viewport changes — **re-place**
  // rather than closing: the trigger lives in a horizontally scrolling toolbar on phones, and
  // tapping a partially visible control scrolls it into view, which would otherwise dismiss
  // the panel the same gesture just opened. The panel's own inner scroll is exempt. Capture
  // phase — scroll events don't bubble.
  useEffect(() => {
    if (!open || !portal) return;
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      // A pointer-anchored panel has nothing left to follow once the content under the
      // pointer moves, so it dismisses instead (the usual context-menu behavior).
      if (anchorRect) setOpenRef.current(false);
      else place();
    };
    // A resize moves the same anchor point out from under the panel, so it dismisses for
    // the same reason a scroll does.
    const onResize = () => {
      if (anchorRect) setOpenRef.current(false);
      else place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, portal, place, anchorRect]);

  // Portaled panels sit at z-[60], above a Modal's z-50 overlay (a body portal appended
  // after the overlay would otherwise paint UNDER it and be unclickable); in-flow panels
  // keep the z-40 menu tier — they stack within their host's own context.
  const panelClass = `anim-pop ${portal ? "z-[60]" : "z-40"} overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900 ${
    portal ? "" : "max-h-[70vh]"
  } ${menuClass ?? "left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] origin-top-left"}`;

  return (
    <div className={`relative ${className ?? ""}`} ref={ref}>
      {button}
      {open &&
        (portal ? (
          createPortal(
            <div
              ref={panelRef}
              onKeyDown={onPanelKeyDown}
              style={{
                position: "fixed",
                // Before the first measurement the panel is rendered invisibly at the
                // trigger's corner: it must be laid out to be measured, but must not flash
                // in the wrong place for a frame.
                ...(pos
                  ? {
                      left: pos.left,
                      maxHeight: pos.maxHeight,
                      ...(pos.top !== undefined ? { top: pos.top } : {}),
                      ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
                    }
                  : { left: 0, top: 0, visibility: "hidden" as const }),
                maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
                ...menuStyle,
              }}
              className={panelClass}
            >
              {children}
            </div>,
            document.body,
          )
        ) : (
          <div
            ref={panelRef}
            onKeyDown={onPanelKeyDown}
            {...(menuStyle !== undefined ? { style: menuStyle } : {})}
            className={`absolute ${panelClass}`}
          >
            {children}
          </div>
        ))}
    </div>
  );
}
