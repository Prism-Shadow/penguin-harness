/**
 * Circled "?" that discloses an explanation on demand.
 *
 * Explanatory prose falls into two kinds, and only one of them belongs here. **Semantics** —
 * what a section is, what a field means, what it affects, when a change takes effect — is read
 * once and then never again, so leaving it on screen costs every later visit a paragraph of
 * scrolling. It goes behind this trigger. **Formatting** — "one KEY=value per line", "leave
 * empty for unlimited" — is read *while typing*, so hiding it converts a glance into a click
 * and raises the error rate. That stays visible, in the field's own hint.
 *
 * The panel is portaled to document.body and positioned against viewport coordinates by
 * usePortalPanel, so no ancestor's overflow can clip it (a modal body, a horizontally scrolling
 * table) and it closes on outside click / Esc / a scroll that moves the trigger / resize. Esc there is captured and its
 * propagation stopped, which is what lets one Esc dismiss this popover while an enclosing Modal
 * stays open. z-[60] for the same reason OptionMenu uses it: a portaled node sits in the root
 * stacking context and must clear the modal overlay's z-50.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { usePortalPanel } from "./use-portal-panel";

/** Circled question mark: the app's 9-radius status circle, with a mark and a dot inside it. */
const HELP_ICON =
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.3a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.5-2.5 2.5M12 16.8h.01";

const PANEL_WIDTH = 288; // w-72, the OptionMenu panel width

export function InfoPopover({
  children,
  label,
  size = ICON_SIZE.inlineGlyph,
  className = "",
}: {
  /** The explanation. Plain text in almost every case; nodes are allowed for the rare inline code. */
  children: ReactNode;
  /**
   * What this explains — the section title or the field label it sits beside. It is folded into
   * the trigger's accessible name ("More info: Vault") rather than used verbatim, so a trigger
   * inside a heading never makes that heading announce its own title twice. Omit it and the
   * trigger falls back to a bare "More info".
   */
  label?: string;
  size?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    // Panel geometry: a fixed 288px column whose height is two to six lines of text.
    estimatedHeight: 160,
    panelWidth: PANEL_WIDTH,
  });
  const name = label !== undefined ? S.common.moreInfoAbout(label) : S.common.moreInfo;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={name}
        title={name}
        aria-expanded={open}
        aria-controls={panelId}
        // While open the panel is also the trigger's description, so a screen reader reads the
        // explanation on focus rather than only announcing that something expanded.
        aria-describedby={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 ${className}`}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="block shrink-0"
        >
          <path d={HELP_ICON} />
        </svg>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
            }}
            className="anim-pop z-[60] max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-600 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
