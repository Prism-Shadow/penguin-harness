/**
 * The pinned sidebar's frame: one column, top to bottom — an optional mode switch, the switcher
 * row (the fold button and the Project or organization switcher), the fixed block (New chat and
 * the favourite entries), the scroll area, and the account row at the foot. The pieces the nav
 * and the list are built from are here too: the fold the other entries go away in under a slim
 * toggle, the entries with their favourite toggles (a star) and the areas a dragged entry can
 * land in, the list's header with its label and its controls, the controls themselves, and the
 * switcher's and the account's buttons.
 *
 * The fixed block holds still while the scroll area scrolls under it; the fold sits at the top
 * of the scroll area and rides up with the list. At rest the two read as one column of rows:
 * between the last fixed row and the first row below it is the rows' own one-pixel gap, nothing
 * more. Once the list is scrolled away from its top, that pixel turns into a hairline in the
 * column's rule colour, so rows sliding up under the block do not run into it; back at the top
 * it clears. The pixel is always there (a transparent border at rest), so the line moves nothing
 * when it shows. A column of fixed chrome taller than a short
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
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { useArrived } from "../../../motion/use-arrived";
import { ChevronFlip } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { ChevronDown } from "../../icons/marks/marks";
import { Text } from "../../content/typography/typography";
import { Fold } from "../../layout/fold/fold";
import { NAV_FILL, NavRow } from "../../navigation/nav-list/nav-list";
import type { NavRowProps } from "../../navigation/nav-list/nav-list";
import { setDragPreview } from "../../overlays/drag-preview/drag-preview";
import { ROW_ACTION_GLYPH, ROW_HOVER_BUTTON } from "../session-row/session-row";

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
   * The fixed block under the switcher: the entries that never scroll ("New chat" and the
   * favourites, as one `SidebarNavArea` so they share one row spacing). Without it the column
   * keeps the gap the scroll area below depends on.
   */
  pinned?: ReactNode;
  /** The scroll area: the fold of the page nav and the list. */
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

/**
 * A nav area a dragged entry can be dropped into: the caller's drag handlers, and whether a drag
 * the area would take is over it now, which lays the accent ring over the area.
 */
export interface SidebarDropTarget {
  /** A drag this area would take is over it. */
  over: boolean;
  onDragOver: (e: ReactDragEvent) => void;
  onDragLeave: (e: ReactDragEvent) => void;
  onDrop: (e: ReactDragEvent) => void;
}

const dropHandlers = (drop: SidebarDropTarget | undefined) =>
  drop === undefined
    ? {}
    : { onDragOver: drop.onDragOver, onDragLeave: drop.onDragLeave, onDrop: drop.onDrop };

/**
 * The ring over the area a drop would land in. It is laid over the area's `relative` box rather
 * than drawn by the box itself, because the rows paint over their container and a selected row's
 * fill would hide an outline of the box's own.
 */
function DropRing() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 z-raised rounded-md ring-1 ring-inset ring-accent"
    />
  );
}

/**
 * The page nav's fold: the entries that are not favourites, in a group that folds away, and
 * under them a slim, full-width toggle whose caret points up while the rows show (fold them) and
 * down once they are folded (the way back). The favourites are not here: they stand in the
 * frame's fixed block. The fold slides: the rows fold through `Fold`, their track tweening
 * between `0fr` and `1fr` under the theme's layout motion while they fade, and the list below
 * glides up with it. Folding, the rows turn inert until they leave, so a zero-height row is
 * never focusable or clickable; folded, they are not mounted. The toggle's resting band is the
 * column's one fill at rest: it reads as the seam between the nav and the list below it.
 *
 * With nothing to fold (`foldable={false}`) nothing is drawn. When the last entry leaves the
 * fold (made a favourite), the group does not vanish in one frame: its rows fold away, the band
 * fades, and both unmount once the fold has finished. With `drop`, the group and its toggle band
 * are one drop target, ringed while a drag it would take is over them.
 */
export function SidebarNavGroup({
  collapsed,
  onToggle,
  expandLabel,
  collapseLabel,
  foldable = true,
  drop,
  toggleRef,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** The toggle's name while the rows are folded. */
  expandLabel: string;
  /** The toggle's name while they show. */
  collapseLabel: string;
  /** Whether there is a group to fold: false draws neither the group nor its toggle. */
  foldable?: boolean;
  /** The group and its toggle band as a drop target. */
  drop?: SidebarDropTarget;
  /** The toggle's node: where the caller sends focus that cannot land in the folded group. */
  toggleRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const label = collapsed ? expandLabel : collapseLabel;
  const open = foldable && !collapsed;
  // Whether the fold still holds its rows: they stay through a fold's close, so a group that
  // stopped being foldable leaves once its rows have folded away, not in the frame it stopped.
  const [holding, setHolding] = useState(open);
  if (open && !holding) setHolding(true);
  // The rows fade in only when the reader unfolds them, not on every page load.
  const toggled = useArrived(collapsed);
  if (!foldable && !holding) return null;
  return (
    <nav {...dropHandlers(drop)} className="relative flex flex-col gap-px">
      <Fold open={open} onClosed={() => setHolding(false)}>
        <div
          className={`space-y-px transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}${
            toggled ? " starting:opacity-0" : ""
          }`}
        >
          {children}
        </div>
      </Fold>
      <button
        ref={toggleRef}
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={label}
        className={`flex h-4 w-full items-center justify-center rounded-md ${NAV_FILL.selected} text-fg-subtle transition-[color,background-color,opacity] duration-150 hover:bg-fg/10 hover:text-fg ${
          foldable ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ChevronFlip up={!collapsed} />
      </button>
      {drop?.over === true && <DropRing />}
    </nav>
  );
}

/**
 * A run of nav entries outside the fold — New chat and the favourites in the fixed block — as
 * the place a dragged entry can land: the caller's `drop` wiring, and the ring while a drag it
 * would take is over it. Its rows stand as far apart as the fold's (`gap-px`). `reserve` keeps a
 * row's height while the run is empty, so a drag still has somewhere to land.
 */
export function SidebarNavArea({
  drop,
  reserve = false,
  children,
}: {
  drop?: SidebarDropTarget;
  /** Hold a row's height with no rows in it. */
  reserve?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      {...dropHandlers(drop)}
      className={`relative flex flex-col gap-px${reserve ? " min-h-8" : ""}`}
    >
      {children}
      {drop?.over === true && <DropRing />}
    </div>
  );
}

/** A nav entry's favourite toggle, as its caller describes it. */
export interface SidebarNavPin {
  /** The entry is a favourite, kept out of the fold: the star is solid (an outline while not). */
  pinned: boolean;
  /** The toggle's accessible name, the same either way: `aria-pressed` carries the state. */
  label: string;
  /**
   * The hint: the move a click makes ("Add to favorites" while not one, "Remove from favorites"
   * while it is).
   */
  tooltip: string;
  onToggle: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  /** The toggle's node: a caller moving focus onto it once the entry has changed area reads it. */
  buttonRef?: Ref<HTMLButtonElement>;
}

export interface SidebarNavEntryProps extends Omit<
  NavRowProps,
  "badge" | "surface" | "groupHover" | "draggable"
> {
  pin: SidebarNavPin;
  /**
   * A mark at the row's end (an update dot), drawn by the caller to sit at the row's end; it
   * steps just left of the toggle wherever the toggle shows.
   */
  badge?: ReactNode;
  /**
   * The whole row is a drag handle, its drag image the row's chip; the caller wires the handlers
   * below.
   */
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
}

/**
 * A page entry on the navigation column that the reader can make a favourite, which keeps it out
 * of the fold: the column's `NavRow`, with a star toggle over the row's end (a button cannot sit
 * inside the row's link, so the toggle is laid over the link's last pixels and the link keeps the
 * whole row as its hit area). The toggle is the conversation rows' hover button — flat, shown on
 * the row's hover or its own focus, taking taps only while shown — with one addition: where there
 * is no hover at all it always shows, because the toggle is then the only way to move an entry.
 * The star is solid on a favourite and an outline otherwise, so the drawing itself carries the
 * state.
 *
 * The row's hover answers to the entry as a whole, so its fill holds while the pointer is on the
 * toggle. A badge never hides and never shares the toggle's spot: at rest it sits at the row's
 * end, and wherever the toggle shows (the entry hovered, the toggle focused, or always where
 * nothing hovers) it stands just left of the toggle, whose own place does not move. The badge
 * steps over at once rather than sliding — a transform under hover is a motion the house rules
 * refuse — so reduced motion has nothing to undo. Draggable, the whole entry is the handle and
 * its link starts no drag of its own; the drag image is the entry's chip (`setDragPreview`).
 * An entry that moves to the other area simply takes its place there: the star filling is the
 * feedback, and a reveal on the moved row read as a flicker.
 */
export function SidebarNavEntry({
  pin,
  badge,
  draggable = false,
  onDragStart,
  onDragEnd,
  ...row
}: SidebarNavEntryProps) {
  return (
    <div
      className="group relative flex items-center"
      {...(draggable
        ? {
            draggable: true,
            onDragStart: (e: ReactDragEvent) => {
              if (e.target === e.currentTarget) setDragPreview(e);
              onDragStart?.(e);
            },
            onDragEnd,
          }
        : {})}
    >
      <NavRow
        {...row}
        surface="muted"
        groupHover
        {...(draggable ? { draggable: false as const } : {})}
      />
      <span className="peer absolute right-1 top-1/2 flex -translate-y-1/2">
        <button
          ref={pin.buttonRef}
          type="button"
          data-tooltip={pin.tooltip}
          aria-label={pin.label}
          aria-pressed={pin.pinned}
          onClick={pin.onToggle}
          className={`${ROW_HOVER_BUTTON} hover:text-fg [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100`}
        >
          <GlyphIcon d={ICONS.star} size={ROW_ACTION_GLYPH} filled={pin.pinned} />
        </button>
      </span>
      {/* The badge's two places: the row's end, and — while the toggle shows — five and a half
          units in, which puts a dot the caller hangs `right-2.5` one unit clear of the toggle's
          box (`right-1`, `w-6`). */}
      {badge !== undefined && (
        <span className="pointer-events-none absolute inset-y-0 right-0 group-hover:right-5.5 peer-focus-within:right-5.5 [@media(hover:none)]:right-5.5">
          {badge}
        </span>
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
