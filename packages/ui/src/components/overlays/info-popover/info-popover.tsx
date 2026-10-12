/**
 * Circled "?" that discloses an explanation on demand.
 *
 * Hovering opens it: a mouse resting on the "?" shows the panel after the tooltip's delay, the
 * panel stays while the pointer moves into it (so its text can be selected and a link in it
 * followed), and it closes a moment after the pointer leaves both. A click pins it open until an
 * outside click, Esc, a scroll or a resize, and a second click closes it. Touch has no hover, so
 * there a tap is the way in; the keyboard toggles it with Enter or Space, and focus alone opens
 * nothing, or tabbing through a form of "?"s would spray panels. Those rules are
 * `useHoverDisclosure`'s, where any other hover-to-explain trigger gets them too.
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
 * table) and it closes on outside click / Esc / a scroll that moves the trigger / resize. Esc
 * there is captured and its propagation stopped, which is what lets one Esc dismiss this
 * popover while an enclosing Modal stays open. z-[60] for the same reason OptionMenu uses it:
 * a portaled node sits in the root stacking context and must clear the modal overlay's z-50.
 *
 * The trigger's accessible name is the interface's "More info" (`UiStrings.moreInfo`), with the
 * subject folded in when the caller names one (`UiStrings.moreInfoAbout`). It carries no tooltip:
 * a circled "?" beside a title already reads as help for that title, and hovering it shows the
 * explanation itself, so a tooltip saying "More info" would only stand in the way. The name
 * exists for assistive technology only.
 */
import { useId } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useHoverDisclosure } from "../hover-disclosure/use-hover-disclosure";
import { usePortalPanel } from "../portal-panel/use-portal-panel";

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
  const strings = useUiStrings();
  const { open, close, triggerProps, panelProps } = useHoverDisclosure();
  const panelId = useId();
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: close,
    // Panel geometry: a fixed 288px column whose height is two to six lines of text.
    estimatedHeight: 160,
    panelWidth: PANEL_WIDTH,
  });
  const name = label !== undefined ? strings.moreInfoAbout(label) : strings.moreInfo;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={name}
        aria-expanded={open}
        aria-controls={panelId}
        // While open the panel is also the trigger's description, so a screen reader reads the
        // explanation on focus rather than only announcing that something expanded.
        aria-describedby={open ? panelId : undefined}
        {...triggerProps}
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors duration-150 hover:text-fg-muted ${className}`}
      >
        <GlyphIcon d={ICONS.helpCircle} size={size} />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="tooltip"
            {...panelProps}
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
            }}
            className="ui-glass anim-pop z-[60] max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-line bg-overlay px-3 py-2 text-xs leading-relaxed text-fg-muted shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
