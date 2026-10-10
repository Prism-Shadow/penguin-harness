/**
 * Modal dialog component: overlay fades in, panel rises into place; closes on Esc or clicking the
 * overlay. Docked to the bottom on narrow screens (bottom sheet style), centered card at >=sm.
 *
 * **Rendered via portal to body**: the panel has its own transform entrance animation
 * (anim-pop), which makes it a containing block for descendant `fixed` elements — if a nested
 * modal (e.g. a delete confirmation inside a settings modal) rendered in place, its overlay would
 * be confined to the parent panel's rectangle, leaving a misaligned edge (a white sliver showing
 * through). After portaling, every modal is a sibling child of body and stacks naturally in DOM
 * order.
 *
 * **Focus is contained**: opening moves focus into the panel, Tab and Shift+Tab cycle inside it,
 * and closing returns focus to whatever held it before. `role="dialog"` plus `aria-modal`
 * announce the page behind as out of scope, but neither moves focus — without the trap, Tab walks
 * straight out of the overlay into content the dialog sits on top of. The keyboard wiring is
 * {@link useDialogLayer}, shared with the overlays that own their layout.
 */
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { CloseButton } from "../../actions/close-button/close-button";
import { useDialogLayer } from "../esc-layers/esc-layers";

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
  /**
   * Fill the whole screen on a phone instead of rising as a bottom sheet, and lay the panel out
   * as a column so a `bare` body can take the height between header and footer. For dialogs
   * that are a workspace of their own (the Workspace finder) rather than a question; pair it
   * with an `sm:` height in `widthClass`, since above the breakpoint the panel is a card again.
   */
  fullScreenOnPhone?: boolean;
  /** The header's close cross's accessible name; defaults to the interface's word for "close". */
  closeLabel?: string;
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
  fullScreenOnPhone,
  closeLabel,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { onKeyDown: onPanelKeyDown } = useDialogLayer(open, panelRef, onClose);

  if (!open) return null;
  return createPortal(
    <div
      // ui-scrim: the dimmed layer between the page and the dialog; a theme may blur the page
      // through it. The overlay is the scrim itself, with the dialog inside it.
      className="ui-scrim anim-fade fixed inset-0 z-50 flex items-end justify-center bg-[var(--ui-overlay-backdrop)] p-0 sm:items-center sm:p-4"
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
        className={`ui-glass anim-pop w-full ${widthClass ?? "sm:max-w-md"} ${
          fullScreenOnPhone
            ? "flex h-[100dvh] flex-col pt-[env(safe-area-inset-top)] sm:pt-0"
            : "rounded-t-lg"
        } border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-lg sm:pb-0`}
      >
        {/* The head, the body and the foot name themselves (the glass hook's dialog anatomy), so
            a theme may draw or drop the rules that part them, and close up the space a dropped
            rule leaves between the title and the content. A `bare` body is the caller's own and
            carries no slot. */}
        {!headerless && (
          <div
            data-slot="head"
            className="flex items-center justify-between border-b border-line px-4 py-3"
          >
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <CloseButton onClose={onClose} label={closeLabel} />
          </div>
        )}
        {bare ? (
          children
        ) : (
          <div data-slot="body" className="max-h-[70vh] overflow-y-auto px-4 py-4">
            {children}
          </div>
        )}
        {/* The buttons keep their labels whole, so when a phone-width foot cannot hold them in
            one row it starts another rather than squeezing one. */}
        {footer && (
          <div
            data-slot="foot"
            className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
