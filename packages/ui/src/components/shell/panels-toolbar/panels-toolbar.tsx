/**
 * The toolbar's dock switcher: one icon toggle per dock edge, each pulling its dock open or
 * putting it away. A toggle is `aria-expanded` while its dock is on screen, and may carry an
 * attention dot for something waiting inside that dock. Everything a dock holds — its tabs, its
 * add menu, its picker — lives on the dock itself, so this stays a row of toggles.
 */
import type { HTMLAttributes } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { Dot } from "../../icons/dot/dot";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

export interface PanelsToolbarToggle {
  /** Stable id: the toggle's test id is `dock-toggle-<key>`. */
  key: string;
  /** The accessible name, and the tooltip when `tooltip` is absent. */
  label: string;
  /** The tooltip, when it says more than the name (the name with its shortcut). */
  tooltip?: string;
  /** The glyph's path, from the icon registry. */
  glyph: string;
  /** The dock is on screen. */
  active: boolean;
  /** An attention dot beside the glyph (a pending approval inside that dock). */
  badge?: boolean;
  onToggle: () => void;
}

export interface PanelsToolbarProps extends HTMLAttributes<HTMLDivElement> {
  toggles: readonly PanelsToolbarToggle[];
}

export function PanelsToolbar({ toggles, className = "", ...rest }: PanelsToolbarProps) {
  return (
    <div
      data-testid="panels-toolbar"
      {...rest}
      className={`flex shrink-0 items-center gap-1 ${className}`}
    >
      {toggles.map((toggle) => (
        <button
          key={toggle.key}
          type="button"
          aria-expanded={toggle.active}
          onClick={toggle.onToggle}
          data-tooltip={toggle.tooltip ?? toggle.label}
          aria-label={toggle.label}
          data-testid={`dock-toggle-${toggle.key}`}
          className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 ${
            toggle.active
              ? "bg-line-muted text-fg"
              : "text-fg-muted hover:bg-line-muted hover:text-fg"
          }`}
        >
          <GlyphIcon d={toggle.glyph} size={ICON_SIZE.iconButton} />
          {toggle.badge === true && <Dot tone="attention" />}
        </button>
      ))}
    </div>
  );
}
