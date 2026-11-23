/**
 * The pinned sidebar's frame: one column, top to bottom — an optional mode switch, the switcher
 * row (the fold button and the Project or organization switcher), the fixed block (New chat and
 * the nav's entries), the scroll area, and the account row at the foot. The pieces the nav and
 * the list are built from are here too: a run of nav rows, a nav entry with its badge, the list's
 * header with its label and its controls, the controls themselves, and the switcher's and the
 * account's buttons. No entry is starred, dragged or folded away: the nav is a fixed set of rows.
 *
 * The fixed block holds still while the scroll area scrolls under it. At rest the two read as one
 * column of rows: between the last fixed row and the first row below it is the rows' own
 * one-pixel gap, nothing more. Once the list is scrolled away from its top, that pixel turns into
 * a hairline in the column's rule colour, so rows sliding up under the block do not run into it;
 * back at the top it clears. The pixel is always there (a transparent border at rest), so the line
 * moves nothing when it shows. A column of fixed chrome taller than a short
 * window would push the document into a second scrollbar, so both blocks give way: the scroll
 * area shrinks first, down to a floor that keeps the list's header and a row or two in view,
 * and past that the fixed block shrinks and scrolls its own rows. The scroll area is its own
 * containing block (`relative`), so an absolutely placed descendant (a row's visually hidden
 * name) scrolls with it rather than stretching the document, and it clips sideways
 * (`overflow-x-clip`) so a pixel of horizontal overflow never turns into a scrollbar under the
 * list.
 *
 * Everything on the column sits on its muted surface, so a hover and a selection are the column's
 * washes of the ink (`NAV_FILL`). The frame paints no background of its own: the column that holds
 * it does (`AppShell`'s navigation slot, or the phone's drawer).
 */
import { useState } from "react";
import type { ReactNode, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { ChevronDown } from "../../icons/marks/marks";
import { Text } from "../../content/typography/typography";
import { NAV_FILL, NavRow } from "../../navigation/nav-list/nav-list";
import type { NavRowProps } from "../../navigation/nav-list/nav-list";

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
   * The fixed block under the switcher: the entries that never scroll ("New chat" and the nav's
   * entries, as one `SidebarNavArea` so they share one row spacing). Without it the column keeps
   * the gap the scroll area below depends on.
   */
  pinned?: ReactNode;
  /** The scroll area: the list, and whatever rows the caller puts above it. */
  children?: ReactNode;
  /** If set, marks the scroll area as a find-in-page region of this kind (`data-find-region`). */
  findRegion?: string;
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
  findRegion,
  account,
  overlays,
  rootRef,
}: SidebarFrameProps) {
  // Whether the scroll area has left its top: the boundary above it shows its hairline.
  const [scrolled, setScrolled] = useState(false);
  const edge = `border-b transition-colors duration-150 ${scrolled ? "border-line" : "border-transparent"}`;
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
      {/* The boundary with the scroll area is this block's bottom border: the one-pixel row gap
          at rest, the hairline once the list is scrolled. It belongs to the block, not to the
          scroll area, whose own padding would slide away with the scrolled rows. The rows sit in
          a scroller of their own, for a column too short for them; it holds the gap under the
          switcher as its top padding (room for a focused row's ring), with a sliver outside it.
          With no fixed rows, the column keeps its gap under the switcher, the same border at
          its foot. */}
      {pinned === undefined ? (
        <div className={`h-2 shrink-0 ${edge}`} />
      ) : (
        <nav className={`flex min-h-0 flex-col pt-0.5 ${edge}`}>
          <div className="min-h-0 overflow-y-auto overflow-x-clip px-2 pt-1.5">{pinned}</div>
        </nav>
      )}
      {/* The floor (`min-h-24`) is where the fixed block starts giving way instead. */}
      <div
        {...(findRegion === undefined ? {} : { "data-find-region": findRegion })}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        className="relative min-h-24 flex-1 overflow-y-auto overflow-x-clip px-2 pb-2"
      >
        {children}
      </div>
      <div className="shrink-0 border-t border-line p-2">{account}</div>
      {overlays}
    </div>
  );
}

/** A run of nav rows (New chat and the nav's entries in the fixed block), one row spacing apart. */
export function SidebarNavArea({ children }: { children?: ReactNode }) {
  return <div className="flex flex-col gap-px">{children}</div>;
}

export interface SidebarNavEntryProps extends Omit<NavRowProps, "badge" | "surface"> {
  /**
   * A mark at the row's end (an update dot), positioned by the caller inside the entry's box: the
   * row's right edge, vertically centred.
   */
  badge?: ReactNode;
}

/**
 * A page entry on the navigation column: the column's `NavRow`, with an optional mark hung over
 * the row's end. The mark is laid over the link rather than drawn inside it, so a dot sits at the
 * same place on every row whatever its label's width, and the link keeps the whole row as its
 * hit area.
 */
export function SidebarNavEntry({ badge, ...row }: SidebarNavEntryProps) {
  return (
    <div className="relative flex items-center">
      <NavRow {...row} surface="muted" />
      {badge !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 right-0">{badge}</span>
      )}
    </div>
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
  fold,
  children,
}: {
  /** The group label naming the list below. */
  label: string;
  /** The search field is open in the controls' column. */
  searching?: boolean;
  /** A list that folds as a whole gives its label the toggle. */
  fold?: { open: boolean; toggle: () => void };
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
      {fold ? (
        <button
          type="button"
          aria-expanded={fold.open}
          aria-label={label}
          onClick={fold.toggle}
          disabled={searching}
          className={`flex min-w-0 items-center gap-1 overflow-hidden px-1 text-left ${searching ? "invisible" : ""}`}
        >
          <span className={`shrink-0 ${fold.open ? "" : "-rotate-90"}`}>
            <ChevronDown />
          </span>
          <Text as="span" variant="eyebrow" className="truncate">
            {label}
          </Text>
        </button>
      ) : (
        <Text
          as="span"
          variant="eyebrow"
          className={`min-w-0 overflow-hidden whitespace-nowrap px-1 transition-opacity duration-200 ${
            searching ? "opacity-0" : "opacity-100"
          }`}
        >
          {label}
        </Text>
      )}
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
