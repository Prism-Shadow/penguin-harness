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
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { CloseButton } from "./icons";

export interface ModalProps {
  open: boolean;
  /** Dialog name: rendered as the header bar, or (headerless) exposed as the panel's aria-label only. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width class (defaults to sm:max-w-md). */
  widthClass?: string;
  /** No header bar (no visible title, no close button): compact dialogs like confirmations — the title still names the dialog for assistive tech. */
  headerless?: boolean;
}

/**
 * Stack of currently open Modals: Escape only closes the **topmost** one. When
 * dialogs are nested (e.g. a confirmation popped inside a settings modal), each
 * Modal registers its own window keydown->onClose; without checking the top of
 * the stack, a single Escape would close both layers at once and discard unsaved
 * edits in the outer modal. Pushed in mount order, so the top of the stack is the
 * visually topmost dialog.
 */
const modalStack: symbol[] = [];

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  widthClass,
  headerless,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const id = Symbol("modal");
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalStack[modalStack.length - 1] === id) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = modalStack.lastIndexOf(id);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        {...(headerless ? { role: "dialog", "aria-label": title } : {})}
        className={`anim-pop w-full ${widthClass ?? "sm:max-w-md"} rounded-t-lg border border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-lg sm:pb-0 dark:border-gray-800 dark:bg-gray-900`}
      >
        {!headerless && (
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <h2 className="text-base font-semibold">{title}</h2>
            <CloseButton onClose={onClose} />
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
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
