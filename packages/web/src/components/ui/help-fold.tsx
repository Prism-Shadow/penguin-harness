/**
 * Inline help fold: a compact, self-naming row that expands its explanation underneath it.
 *
 * The sibling of InfoPopover, and one rule decides which a site gets. The circled "?" is an
 * **anchored** mark: it reads as help only because it sits immediately after a title, and it
 * borrows that title's meaning. Where a surface has no title to anchor to — an Agent settings
 * tab, whose name lives in the tab bar and is not repeated in the panel — a "?" floating alone
 * at the top of the panel is a mark modifying nothing. The disclosure then has to name itself,
 * and this is that form.
 *
 * Inline flow, not an overlay, so **no portal**. usePortalPanel earns its keep by keeping a
 * floating panel clear of an ancestor's overflow and closing it on outside click, Esc or scroll;
 * a fold pushes the content below it down and stays open until the reader folds it back, so none
 * of that applies. It is the WAI-ARIA disclosure pattern: the panel stays in the DOM and is
 * `hidden` while collapsed, which keeps `aria-controls` pointing at something real (the popover
 * cannot do that — a portaled panel only exists while open).
 *
 * The chevron is the app's one collapse indicator, the same glyph every other collapsible
 * rotates; a help fold that announced itself differently would be a second pattern for no reason.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Chevron } from "./chevron";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";

export function HelpFold({
  children,
  label,
  className = "",
}: {
  /** The explanation. Revealed only on request — a description that shows up uninvited is what this replaces. */
  children: ReactNode;
  /**
   * What this explains — the surface's own name. It is folded into the trigger's accessible name
   * ("More info: Vault") while the visible row stays the short generic label, so a screen-reader
   * user tabbing past knows what the fold is about without the panel repeating the tab bar.
   */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // The visible text is a prefix of the accessible name, so "label in name" holds and a
        // voice-control user can still say what they see.
        {...(label !== undefined ? { "aria-label": S.common.moreInfoAbout(label) } : {})}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center ${ICON_GAP.tight} rounded text-xs text-gray-500 transition-colors duration-150 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200`}
      >
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {S.common.moreInfo}
      </button>
      {/* pl-4.5 = the chevron's 12px plus the row's gap, so the body lines up under the label. */}
      <div
        id={panelId}
        hidden={!open}
        className="mt-1.5 pl-4.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
      >
        {children}
      </div>
    </div>
  );
}
