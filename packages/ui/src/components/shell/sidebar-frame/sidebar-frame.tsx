/**
 * The pinned sidebar's frame: one column, top to bottom — an optional mode switch, the switcher
 * row (the fold button and the Project or organization switcher), one pinned entry, the scroll
 * area, and the account row at the foot. The pieces the scroll area is built from are here too:
 * the page nav that folds away under a slim toggle, the list's header with its label and its
 * controls, the controls themselves, and the switcher's and the account's buttons.
 *
 * The page nav and the list scroll together, so the nav rides up as the list is scrolled: the
 * scroll area is the column's only shrinkable block, and a column of fixed chrome taller than a
 * short window would push the document into a second scrollbar. The area is its own containing
 * block (`relative`), so an absolutely placed descendant (a row's visually hidden name) scrolls
 * with it rather than stretching the document, and it clips sideways (`overflow-x-clip`) so a
 * pixel of horizontal overflow never turns into a scrollbar under the list.
 *
 * Everything on the column sits on its muted surface, so a hover and a selection are the column's
 * washes of the ink (`NAV_FILL`). The frame paints no background of its own: the column that holds
 * it does (`AppShell`'s navigation slot, or the phone's drawer).
 */
import type { ReactNode, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { ChevronFlip } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { ChevronDown } from "../../icons/marks/marks";
import { Text } from "../../content/typography/typography";
import { NAV_FILL } from "../../navigation/nav-list/nav-list";

/**
 * A list-header control's glyph: one step under the icon-button rung, since the control's square
 * is the dense 24px one and its glyph sits beside a small label.
 */
const CONTROL_GLYPH = 14;

export interface SidebarFrameProps {
  /** Above everything: a mode switch, in a group named by its `label`. */
  modeSwitch?: { label: string; control: ReactNode };
  /** The switcher row's content: the Project or organization switcher. */
  switcher: ReactNode;
  /**
   * The fold button at the start of the switcher row; drawn only when given. `tooltip` says more
   * than the name when it has more to say (the name with its shortcut).
   */
  collapse?: { label: string; tooltip?: string; onClick: () => void };
  /**
   * The one entry pinned under the switcher ("New chat"). Without one the column keeps the gap the
   * scroll area below depends on.
   */
  pinned?: ReactNode;
  /** The scroll area: the page nav and the list. */
  children?: ReactNode;
  /** The account row at the foot: the account menu's trigger. */
  account: ReactNode;
  /** Layers the column opens (its dialogs), mounted after it. */
  overlays?: ReactNode;
  /** The column's node: a caller that must know whether the column is on screen reads it. */
  rootRef?: Ref<HTMLDivElement>;
}

export function SidebarFrame({
  modeSwitch,
  switcher,
  collapse,
  pinned,
  children,
  account,
  overlays,
  rootRef,
}: SidebarFrameProps) {
  return (
    <div ref={rootRef} className="flex h-full w-full flex-col">
      {modeSwitch !== undefined && (
        <div className="shrink-0 px-2 pt-2" role="group" aria-label={modeSwitch.label}>
          {modeSwitch.control}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        {collapse !== undefined && (
          <button
            type="button"
            data-tooltip={collapse.tooltip ?? collapse.label}
            aria-label={collapse.label}
            onClick={collapse.onClick}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-fg/7 hover:text-fg"
          >
            <GlyphIcon d={ICONS.chevronLeftPipe} size={ICON_SIZE.sectionMark} />
          </button>
        )}
        {switcher}
      </div>
      {/* The gap to the scroll area is this block's own bottom padding, not padding inside the
          scroller: padding there belongs to the scrolled content and slides away with it, and a
          scrolled nav row would end up flush against the pinned entry. */}
      {pinned === undefined ? (
        <div className="shrink-0 pb-2" />
      ) : (
        <div className="shrink-0 px-2 pb-2 pt-2">{pinned}</div>
      )}
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-clip px-2 pb-2">
        {children}
      </div>
      <div className="shrink-0 border-t border-line p-2">{account}</div>
      {overlays}
    </div>
  );
}

/**
 * The page nav: its rows in a group that folds away, and under them a slim, full-width toggle
 * whose caret points up while the rows show (fold them) and down once they are folded (the way
 * back). The fold slides: the group's row track tweens between `0fr` and `1fr` under the theme's
 * layout motion while the rows fade, and the list below glides up with it. The rows stay mounted
 * for the tween but turn inert while folded, so a zero-height row is never focusable or
 * clickable. The toggle's resting band is the column's one fill at rest: it reads as the seam
 * between the nav and the list below it.
 */
export function SidebarNavGroup({
  collapsed,
  onToggle,
  expandLabel,
  collapseLabel,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** The toggle's name while the rows are folded. */
  expandLabel: string;
  /** The toggle's name while they show. */
  collapseLabel: string;
  children: ReactNode;
}) {
  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <nav className="space-y-px">
      <div
        data-layout-motion
        className={`grid ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
      >
        <div className="overflow-hidden" inert={collapsed}>
          <div
            className={`space-y-px transition-opacity duration-200 ${
              collapsed ? "opacity-0" : "opacity-100"
            }`}
          >
            {children}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={label}
        data-tooltip={label}
        className={`flex h-4 w-full items-center justify-center rounded-md ${NAV_FILL.selected} text-fg-subtle transition-colors duration-150 hover:bg-fg/10 hover:text-fg`}
      >
        <ChevronFlip up={!collapsed} />
      </button>
    </nav>
  );
}

/**
 * The list's header: its group label on the left, its controls on the right. Searching, the
 * header becomes the search field in place — the label's column closes while the controls'
 * column takes the whole row under the theme's layout motion, and the field inside grows leftward
 * over the label's place — so a search costs no extra row.
 */
export function SidebarListHeader({
  label,
  searching = false,
  children,
}: {
  /** The group label naming the list below. */
  label: string;
  /** The search field is open in the controls' column. */
  searching?: boolean;
  /** The controls, or the open search field and the controls after it. */
  children: ReactNode;
}) {
  return (
    <div
      data-layout-motion
      className={`mt-3 grid items-center px-1 pt-2 ${
        searching ? "grid-cols-[0fr_1fr]" : "grid-cols-[1fr_1fr]"
      }`}
    >
      <Text
        as="span"
        variant="eyebrow"
        className={`min-w-0 overflow-hidden whitespace-nowrap px-1 transition-opacity duration-200 ${
          searching ? "opacity-0" : "opacity-100"
        }`}
      >
        {label}
      </Text>
      <div className="flex min-w-0 items-center justify-end gap-px">{children}</div>
    </div>
  );
}

/**
 * A control's square on the list header (search, list options, create): the subtle glyph, the
 * column's hover wash, and the selected wash while `active` (its menu or picker is open). For a
 * trigger another module draws (a picker's own button).
 */
export function sidebarControlClass(active = false): string {
  return `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
    active ? `${NAV_FILL.selected} text-fg` : `text-fg-subtle ${NAV_FILL.hover} hover:text-fg`
  }`;
}

/** An icon control on the list header, named by its hint. */
export function SidebarControl({
  label,
  tooltip,
  glyph,
  active = false,
  onClick,
  "aria-haspopup": hasPopup,
  "aria-expanded": expanded,
}: {
  /** The accessible name, and the hint when `tooltip` is absent. */
  label: string;
  /** The hint, when it says more than the name (the name with its shortcut). */
  tooltip?: string;
  /** A registry path, drawn at the header's small rung, or a mark the caller sized. */
  glyph: string | ReactNode;
  /** Its menu or picker is open. */
  active?: boolean;
  onClick: () => void;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      data-tooltip={tooltip ?? label}
      aria-label={label}
      aria-haspopup={hasPopup}
      aria-expanded={expanded}
      onClick={onClick}
      className={sidebarControlClass(active)}
    >
      {typeof glyph === "string" ? <GlyphIcon d={glyph} size={CONTROL_GLYPH} /> : glyph}
    </button>
  );
}

/** The switcher's trigger: the current Project's name, full width, and the caret. */
export function SidebarSwitcherButton({
  label,
  onClick,
}: {
  label: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-semibold transition-colors duration-150 hover:bg-fg/7"
    >
      <span className="min-w-0 flex-1 truncate font-sans text-left">{label}</span>
      <span className="text-fg-subtle">
        <ChevronDown />
      </span>
    </button>
  );
}

/**
 * The account row's trigger at the column's foot: the avatar, the account's name and an optional
 * role after it. The menu it opens is the caller's.
 */
export function SidebarAccountButton({
  avatar,
  name,
  trailing,
  role,
  expanded,
  onClick,
  label,
  hint,
}: {
  avatar: ReactNode;
  name: ReactNode;
  /** What the app shows after the name, which the name truncates before: a pinned balance. */
  trailing?: ReactNode;
  /** A short role after the name ("Admin"). */
  role?: string;
  /** The account menu is open. */
  expanded: boolean;
  onClick: () => void;
  /** The accessible name, when a hint adds to what the name says. */
  label?: string;
  /** A hint on hover and focus (what the avatar's badge means). */
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={expanded}
      {...(hint !== undefined ? { "data-tooltip": hint } : {})}
      {...(label !== undefined ? { "aria-label": label } : {})}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-fg/7"
    >
      {avatar}
      <span className="min-w-0 flex-1 truncate font-sans text-sm font-medium">{name}</span>
      {trailing}
      {role !== undefined && <span className="text-xs text-fg-subtle">{role}</span>}
    </button>
  );
}
