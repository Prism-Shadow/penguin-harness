/**
 * The Escape-layer stack and the focus rules every overlay shares: dialogs, drawers, sheets, the
 * lightbox and popup menus all register here, so one Escape press closes exactly one layer — the
 * topmost — and a dialog hands focus in and back the same way wherever it is drawn.
 *
 * Kept apart from `Modal` because the menus need the same stack without the dialog: a Dropdown
 * opened inside a Modal pushes above it, so the first Escape closes only the menu and the next
 * one the dialog.
 */
import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

/**
 * Stack of currently open Escape-consuming layers: Escape only acts on the **topmost** one.
 * Modals AND popup menus join the same stack. When dialogs are nested (a confirmation popped
 * inside a settings modal), each registers its own window keydown handler; without checking the
 * top of the stack, a single Escape would close both layers at once and discard unsaved edits in
 * the outer one. Pushed in mount order, so the top of the stack is the visually topmost layer.
 */
const escLayers: symbol[] = [];

/** Register an Escape-consuming layer (called when an overlay opens); pair with popEscLayer. */
export function pushEscLayer(): symbol {
  const id = Symbol("esc-layer");
  escLayers.push(id);
  return id;
}

/** Remove a layer pushed by {@link pushEscLayer}; a layer already gone is a no-op. */
export function popEscLayer(id: symbol): void {
  const i = escLayers.lastIndexOf(id);
  if (i !== -1) escLayers.splice(i, 1);
}

/** Whether this layer is the topmost one — the only layer an Escape press may act on. */
export function isTopEscLayer(id: symbol): boolean {
  return escLayers[escLayers.length - 1] === id;
}

/**
 * Whether any dialog or menu is open — the state in which an app-wide keyboard shortcut must not
 * run behind it. The app installs this as its shortcut blocker.
 */
export function hasEscLayers(): boolean {
  return escLayers.length > 0;
}

/**
 * Joins the Escape stack while `active`: an Escape press calls `onEscape` only while this layer
 * is the topmost one. The overlays with no focus ring of their own (Drawer, Sheet, Lightbox) use
 * it directly; {@link useDialogLayer} builds on it.
 *
 * `onEscape` is read through a ref so the effect re-runs ONLY when `active` flips: call sites pass
 * an inline arrow, and re-running on its identity would pop and re-push the layer on every render
 * — jumping it back above a menu or dialog opened inside it, so Escape would close the outer layer
 * instead of the inner one.
 */
export function useEscLayer(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const id = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(id)) onEscapeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(id);
    };
  }, [active]);
}

/**
 * The elements an overlay hands focus to, in DOM order. Shared by dialogs and menus so both agree
 * on what "focusable" means. Visually hidden controls stay in the set on purpose: the app's file
 * pickers are hidden the `sr-only` way rather than with `display: none` precisely so they keep
 * their place in the Tab order (`HiddenFileInput`).
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Index that Tab — or Shift+Tab, `backward` — moves to within a ring of `count` focusables,
 * wrapping at both ends so focus cannot walk out of the dialog. `at` is -1 when focus sits on the
 * panel container itself rather than on one of the ring's elements, which enters the ring at
 * whichever end the direction implies.
 */
export function nextFocusIndex(count: number, at: number, backward: boolean): number {
  if (at < 0) return backward ? count - 1 : 0;
  return (at + (backward ? -1 : 1) + count) % count;
}

/**
 * What makes a portaled panel a dialog for the keyboard, shared by Modal and the overlays that own
 * their layout (the command palette, the harness history): Escape closes it only while it is the
 * topmost Escape-consuming layer; opening moves focus into the panel and closing hands it back;
 * Tab and Shift+Tab cycle inside it. The returned `onKeyDown` goes on the panel element, which
 * also needs `tabIndex={-1}` so it can hold focus when nothing inside can.
 *
 * `onClose` is read through a ref (see {@link useEscLayer}), so the effects re-run ONLY on
 * open/close.
 */
export function useDialogLayer(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): { onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void } {
  useEscLayer(open, onClose);

  // Where focus goes when the dialog closes, read during render rather than in the effect below:
  // a child with `autoFocus` is focused during the same commit, before any effect runs, so by
  // effect time document.activeElement already points inside the dialog and the element to
  // return to is gone. Written only on the closed->open edge, so reopening from a different
  // trigger returns to that trigger, and a StrictMode double-mount — whose extra cleanup restores
  // focus once before the real one — does not drop the target.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open;
    if (open)
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  // Opening moves focus into the panel, closing hands it back. `aria-modal` tells assistive tech
  // the page behind is out of scope but moves nothing, so without this a keyboard user stays
  // parked on the trigger with the dialog's own controls several Tabs away.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // A child with autoFocus already claimed focus during the commit — leave it there.
    if (panel && !panel.contains(document.activeElement))
      (panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel).focus();
    // Every close path lands in this cleanup: Escape, the close button, the overlay mousedown,
    // `open` going false, and the dialog unmounting outright.
    return () => restoreFocusRef.current?.focus();
    // Keyed on `open` alone (a ref object is stable), so the cleanup runs for every close path.
  }, [open]);

  /**
   * Tab and Shift+Tab cycle inside the panel instead of walking out into the page behind the
   * overlay.
   *
   * Two things this must not take over. A control that owns Tab for its own model (the composer's
   * slash picker accepts a completion with it) marks the event handled, and this yields to that
   * the way Dropdown's arrow keys do. And a menu or popover opened from inside the dialog is
   * portaled to body — outside this panel's DOM subtree, yet still a React child, so its keydown
   * bubbles through here; the containment check leaves that panel's own focus alone.
   */
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const panel = panelRef.current;
    if (!panel?.contains(document.activeElement)) return;
    e.preventDefault();
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    // A dialog with nothing focusable in it keeps focus on the container, which is what the
    // panel's tabIndex={-1} is for.
    if (items.length === 0) {
      panel.focus();
      return;
    }
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[nextFocusIndex(items.length, at, e.shiftKey)]?.focus();
  };
  return { onKeyDown: onPanelKeyDown };
}
