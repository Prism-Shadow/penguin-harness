/**
 * The phone's top bar: a thin strip at the top of the main column, below `md` only, holding the
 * button that opens the navigation drawer and the product's name. The navigation column itself is
 * hidden at that width (`AppShell`), so this button is the way to everything the column lists.
 *
 * The button is named by the caller for what the drawer lists; a badge on its corner (an update
 * dot) says something is waiting inside, and `menuHint` names it — in the accessible name too, so
 * the caller folds it into `menuLabel` as well.
 */
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export interface MobileTopBarProps {
  /** The product's name beside the button. */
  title: ReactNode;
  /** The drawer button's accessible name: what the drawer lists. */
  menuLabel: string;
  /** A hint on the button, for what its badge means. */
  menuHint?: string;
  /** A mark on the button's corner (an update dot). */
  menuBadge?: ReactNode;
  onMenu: () => void;
}

export function MobileTopBar({ title, menuLabel, menuHint, menuBadge, onMenu }: MobileTopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2 md:hidden">
      <button
        type="button"
        aria-label={menuLabel}
        {...(menuHint !== undefined ? { "data-tooltip": menuHint } : {})}
        onClick={onMenu}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-line-muted hover:text-fg"
      >
        <GlyphIcon d={ICONS.menu} size={ICON_SIZE.sectionMark} />
        {menuBadge}
      </button>
      <span className="text-sm font-semibold">{title}</span>
    </header>
  );
}
