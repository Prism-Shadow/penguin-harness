/**
 * Modal dialog component: overlay fades in, panel rises into place; closes on
 * Esc or clicking the overlay. Docked to the bottom on narrow screens (bottom
 * sheet style), centered card at >=sm.
 *
 * **Rendered via portal to body**: the panel has its own transform entrance
 * animation (anim-pop), which makes it a containing block for descendant `fixed`
 * elements — if a nested modal (e.g. a delete confirmation inside a settings
 * modal) rendered in place, its overlay would be confined to the parent panel's
 * rectangle, leaving a misaligned edge (a white sliver showing through). After
 * portaling, every modal is a sibling child of body and stacks naturally in DOM
 * order.
 *
 * **Focus is contained**: opening moves focus into the panel, Tab and Shift+Tab cycle
 * inside it, and closing returns focus to whatever held it before. `role="dialog"` plus
 * `aria-modal` announce the page behind as out of scope, but neither moves focus — without
 * the trap, Tab walks straight out of the overlay into content the dialog sits on top of.
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { CloseButton } from "./icons";

export interface ModalProps {
  open: boolean;
  /** Dialog name: rendered as the header bar and used to name the dialog, or (headerless) exposed as the panel's aria-label only. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width class (defaults to sm:max-w-md). */
  widthClass?: string;
  /** No header bar (no visible title, no close button): compact dialogs like confirmations — the title still names the dialog for assistive tech. */
  headerless?: boolean;
  /** Render children full-bleed: no built-in padding or 70vh scroller. For dialogs that own their inner layout and scroll regions (PagedDialog); the caller then also owns a close control. */
  bare?: boolean;
}

/**
 * Stack of currently open Escape-consuming layers: Escape only acts on the **topmost**
 * one. Modals AND popup menus (Dropdown) join the same stack. When dialogs are nested
 * (e.g. a confirmation popped inside a settings modal), each Modal registers its own
 * window keydown->onClose; without checking the top of the stack, a single Escape would
 * close both layers at once and discard unsaved edits in the outer modal. The same rule
 * gives menus-inside-dialogs the right order: a Dropdown opened inside a Modal pushes
 * above it, so the first Escape closes only the menu (the Modal's handler sees itself
 * not on top and stays), and the next one closes the dialog. Pushed in mount order, so
 * the top of the stack is the visually topmost layer.
 */
const escLayers: symbol[] = [];

/** Register an Escape-consuming layer (called when a modal/menu opens); pair with popEscLayer. */
export function pushEscLayer(): symbol {
  const id = Symbol("esc-layer");
  escLayers.push(id);
  return id;
}

export function popEscLayer(id: symbol): void {
  const i = escLayers.lastIndexOf(id);
  if (i !== -1) escLayers.splice(i, 1);
}

/** Whether this layer is the topmost one — the only layer an Escape press may act on. */
export function isTopEscLayer(id: symbol): boolean {
  return escLayers[escLayers.length - 1] === id;
}

/**
 * The elements an overlay hands focus to, in DOM order. Shared with Dropdown so a dialog and
 * a menu agree on what "focusable" means. Visually hidden controls stay in the set on
 * purpose: the app's file pickers are hidden the `sr-only` way rather than with `display:
 * none` precisely so they keep their place in the Tab order (hidden-file-input.tsx).
 */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Index that Tab — or Shift+Tab, `backward` — moves to within a ring of `count` focusables,
 * wrapping at both ends so focus cannot walk out of the dialog. `at` is -1 when focus sits on
 * the panel container itself rather than on one of the ring's elements, which enters the ring
 * at whichever end the direction implies.
 */
export function nextFocusIndex(count: number, at: number, backward: boolean): number {
  if (at < 0) return backward ? count - 1 : 0;
  return (at + (backward ? -1 : 1) + count) % count;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  widthClass,
  headerless,
  bare,
}: ModalProps) {
  // Latest-callback ref, so the effect below re-runs ONLY on open/close: call sites pass an
  // inline arrow for onClose, and re-running on its identity would pop and re-push this
  // dialog's esc-layer on every render — jumping it back above a menu opened inside it, so
  // Escape would close the whole dialog instead of just the menu. Dropdown keeps the same
  // guard for the same reason.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Where focus goes when the dialog closes, read during render rather than in the effect
  // below: a child with `autoFocus` is focused during the same commit, before any effect
  // runs, so by effect time document.activeElement already points inside the dialog and the
  // element to return to is gone. Written only on the closed->open edge, so reopening from a
  // different trigger returns to that trigger, and a StrictMode double-mount — whose extra
  // cleanup restores focus once before the real one — does not drop the target.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open;
    if (open)
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  useEffect(() => {
    if (!open) return;
    const id = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(id)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(id);
    };
  }, [open]);

  // Opening moves focus into the panel, closing hands it back. `aria-modal` tells assistive
  // tech the page behind is out of scope but moves nothing, so without this a keyboard user
  // stays parked on the trigger with the dialog's own controls several Tabs away.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // A child with autoFocus already claimed focus during the commit — leave it there.
    if (panel && !panel.contains(document.activeElement))
      (panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel).focus();
    // Every close path lands in this cleanup: Escape, the close button, the overlay
    // mousedown, `open` going false, and the dialog unmounting outright.
    return () => restoreFocusRef.current?.focus();
  }, [open]);

  /**
   * Tab and Shift+Tab cycle inside the panel instead of walking out into the page behind the
   * overlay.
   *
   * Two things this must not take over. A control that owns Tab for its own model (the
   * composer's slash picker accepts a completion with it) marks the event handled, and this
   * yields to that the way Dropdown's arrow keys do. And a menu or popover opened from inside
   * the dialog is portaled to body — outside this panel's DOM subtree, yet still a React
   * child, so its keydown bubbles through here; the containment check leaves that panel's own
   * focus alone.
   */
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
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

  if (!open) return null;
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        // The titled branch is named by its own heading rather than a second copy of the
        // string, so a renamed dialog cannot end up announcing the old name.
        {...(headerless ? { "aria-label": title } : { "aria-labelledby": titleId })}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`anim-pop w-full ${widthClass ?? "sm:max-w-md"} rounded-t-lg border border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-lg sm:pb-0 dark:border-gray-800 dark:bg-gray-900`}
      >
        {!headerless && (
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <CloseButton onClose={onClose} />
          </div>
        )}
        {bare ? children : <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>}
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
