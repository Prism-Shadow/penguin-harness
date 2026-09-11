/**
 * Hover/focus tooltip for a control whose visible form is an icon alone.
 *
 * What it replaces is the native `title` attribute: that one waits about a second before it
 * appears, cannot be styled, and never shows on keyboard focus — so an icon rail labeled
 * only by `title` reads as unlabeled. A trigger must carry one or the other, never both, or
 * two tooltips appear over each other.
 *
 * Portaled to document.body at fixed viewport coordinates, like every other overlay here
 * (see use-portal-panel.ts): an in-place absolute panel is a descendant of its trigger, so a
 * scrolling or clipping ancestor — the collapsed rail is both — cuts it off. It sits on the
 * portaled-panel layer (z-[60]) and takes no pointer events, so it can never swallow a click
 * meant for what it covers.
 *
 * Deliberately NOT `role="tooltip"` + `aria-describedby`: its callers label their triggers
 * with the same words it shows, and a description repeating the accessible name makes a
 * screen reader say the entry twice. The panel is decorative here and hidden from the
 * accessibility tree; the trigger's own `aria-label` stays the one name.
 *
 * Dismissal mirrors the portal panel's, minus the parts a hover-driven panel has no use for
 * (no outside click, no Esc layer): it closes on pointer leave, on blur, on Escape, on any
 * scroll and on a resize — the last three because the position is measured once and is stale
 * the moment the trigger moves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Open delay. Long enough that a pointer crossing a column of icons on its way elsewhere
 * leaves no trail of popping panels, short enough to answer a pointer that stopped to ask.
 */
const OPEN_DELAY_MS = 400;

/** Gap between the trigger's edge and the panel, and the panel's minimum distance from the viewport edge (px). */
const PANEL_GAP = 8;
const VIEWPORT_MARGIN = 8;

export function Tooltip({
  label,
  suppressed,
  className,
  children,
}: {
  /** The words the panel shows — the trigger's own name, so the two cannot disagree. */
  label: string;
  /**
   * Hold the panel closed and refuse to open it. For a trigger that owns something else on
   * screen while it is active: the rail avatar's open user menu hangs off the same corner,
   * and a tooltip naming that avatar would sit on top of the menu it just opened.
   */
  suppressed?: boolean;
  /** Extra classes for the wrapper that measures the trigger (e.g. `mt-auto` in a flex column). */
  className?: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Non-null only while the panel is up; the measured viewport point its left edge and vertical centre sit at. */
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPosition(null);
  }, []);

  const show = () => {
    if (suppressed === true || timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Placed to the right of the trigger — the one geometry the callers need, an icon rail
      // against the left edge of the window. Vertically centred on the trigger and clamped so
      // a rail entry scrolled to the very top or bottom still gets a panel on screen.
      setPosition({
        top: Math.min(
          Math.max(rect.top + rect.height / 2, VIEWPORT_MARGIN),
          window.innerHeight - VIEWPORT_MARGIN,
        ),
        left: rect.right + PANEL_GAP,
      });
    }, OPEN_DELAY_MS);
  };

  useEffect(() => {
    if (suppressed === true) hide();
  }, [suppressed, hide]);

  // Unmounting with a pending timer would fire a state update on a dead component.
  useEffect(() => hide, [hide]);

  useEffect(() => {
    if (position === null) return;
    // Escape is heard in capture so a focused trigger inside a dialog still dismisses its
    // tooltip, and is deliberately NOT stopped: this panel is not a dismissible layer, and
    // swallowing the key would keep the dialog behind it open on the same press.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // Capture, because scroll does not bubble. Any scroll dismisses, with none of the
    // portal panel's "did it move the trigger" refinement: this panel is already gone the
    // moment the pointer leaves, so the cost of closing one too eagerly is nothing.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [position, hide]);

  return (
    <span
      ref={anchorRef}
      className={`flex ${className ?? ""}`}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {position !== null &&
        createPortal(
          <div
            data-testid="tooltip"
            aria-hidden
            style={{ position: "fixed", top: position.top, left: position.left }}
            className="anim-fade pointer-events-none z-[60] w-max max-w-64 -translate-y-1/2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
