/**
 * The panel a date or time picker opens: a small non-modal dialog portaled to the body and placed
 * against its trigger by `usePortalPanel`, so no ancestor's overflow clips it — a dialog's
 * scrolling body, a reply in the transcript — and it takes the `popover` layer over an open
 * dialog. It hangs under the trigger and opens above it when there is no room below, held inside
 * the viewport; on a phone (under 640px) it is a full-width sheet along the bottom edge instead.
 *
 * It closes on a press outside, on Escape (captured and stopped, so a dialog around the field
 * stays open), on a scroll that moves the trigger and on a resize — the portal hook's rules — and
 * whenever a pick closes it. A close that finds the focus inside the panel hands it back to the
 * trigger, so a keyboard reader lands where they started. Opening moves the focus in: to the
 * element marked `data-autofocus` (the calendar's focused day), else the first that takes focus;
 * Tab and Shift+Tab cycle inside, as in any dialog.
 *
 * The panel is the floating-layer glass (`ui-glass`) with the dialog role, so each theme draws it
 * as it draws its popovers' cards; it scrolls inside when the window is too short to hold it.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR, nextFocusIndex } from "../../overlays/esc-layers/esc-layers";
import { usePortalPanel } from "../../overlays/portal-panel/use-portal-panel";
import type { PortalPanelPosition } from "../../overlays/portal-panel/use-portal-panel";

/** Below this viewport width the panel is a sheet along the bottom edge (Tailwind's `sm`). */
const SHEET_BELOW = 640;
/** The panel's distance from the viewport's edges as a sheet, and below its trigger's room (px). */
const EDGE = 8;

export interface PickerPanelState {
  open: boolean;
  /** Opens or closes the panel from the trigger. */
  toggle: () => void;
  /** Closes the panel, handing the focus back to the trigger if it was inside. */
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  position: PortalPanelPosition | null;
  /** The panel's id, for the trigger's `aria-controls`. */
  panelId: string;
}

/**
 * Open state and placement for one picker. `estimatedHeight` decides only whether the panel opens
 * above or below; `width` is the panel's width in px at the default text size, for the first
 * clamp against the viewport (the portal hook clamps again against the width it renders at).
 */
export function usePickerPanel(estimatedHeight: number, width: number): PickerPanelState {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const closeRef = useRef<() => void>(() => {});
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => closeRef.current(),
    estimatedHeight,
    panelWidth: width,
  });
  const close = useCallback(() => {
    const inside = panelRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (inside) triggerRef.current?.focus();
  }, [panelRef, triggerRef]);
  closeRef.current = close;
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return { open, toggle, close, triggerRef, panelRef, position, panelId };
}

/** The elements Tab reaches inside the panel: a grid's other days (`tabindex="-1"`) are not among them. */
function tabbable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => element.tabIndex >= 0,
  );
}

export function PickerPanel({
  picker,
  label,
  widthClass,
  children,
}: {
  picker: PickerPanelState;
  /** The dialog's accessible name: the field's title. */
  label: string;
  /** The panel's width beside the trigger (`w-72`); a sheet takes the viewport's width. */
  widthClass: string;
  children: ReactNode;
}) {
  const { open, position, panelRef, panelId } = picker;
  const placed = open && position !== null;

  useEffect(() => {
    const panel = panelRef.current;
    if (!placed || panel === null || panel.contains(document.activeElement)) return;
    const target = panel.querySelector<HTMLElement>("[data-autofocus]") ?? tabbable(panel)[0];
    target?.focus({ preventScroll: true });
  }, [placed, panelRef]);

  if (!placed) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const panel = panelRef.current;
    if (panel === null) return;
    event.preventDefault();
    const items = tabbable(panel);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[nextFocusIndex(items.length, at, event.shiftKey)]?.focus();
  };

  const sheet = window.innerWidth < SHEET_BELOW;
  const room =
    position.topPx !== undefined
      ? window.innerHeight - position.topPx - EDGE
      : position.bottomPx !== undefined
        ? window.innerHeight - position.bottomPx - EDGE
        : window.innerHeight - EDGE * 2;
  const place = sheet
    ? { left: EDGE, right: EDGE, bottom: EDGE, maxHeight: window.innerHeight - EDGE * 2 }
    : {
        left: position.left,
        top: position.topPx,
        bottom: position.bottomPx,
        maxHeight: Math.max(0, room),
      };

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ position: "fixed", ...place }}
      className={`ui-glass anim-pop z-popover overflow-y-auto rounded-md border border-line bg-overlay p-3 text-sm text-fg shadow-lg ${
        sheet ? "" : widthClass
      }`}
    >
      {sheet ? <div className={`mx-auto max-w-full ${widthClass}`}>{children}</div> : children}
    </div>,
    document.body,
  );
}

/** The row under a picker's calendar or wheels: what it offers besides a pick (Today, the time). */
export function PickerFoot({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-muted pt-2">
      {children}
    </div>
  );
}
