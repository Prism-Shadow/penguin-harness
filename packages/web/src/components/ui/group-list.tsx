/**
 * Building blocks of the chat sidebar's grouped Session list — group header, collapsed
 * lazy folders, the reveal/collapse rows, the group pager. Extracted from sidebar.tsx's
 * inner closures, which is why the markup and classes here ARE the sidebar's and callers
 * pass the state those closures used to capture. The Trace page's directory tree used to
 * render the same structure from here; that page is gone, so this is now one surface's
 * vocabulary kept in one file rather than a contract between two.
 */
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { Chevron, GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { SessionSortMode } from "../../lib/session-order";

/** The grouped lists' line icon: GlyphIcon at the nav-row rung, which is what these rows are. */
export function Icon({ d, size = ICON_SIZE.navRow }: { d: string; size?: number }) {
  return <GlyphIcon d={d} size={size} />;
}

/** Grouping mode of a Session list (persisted; Workspace is the default). */
export type GroupMode = "workspace" | "agent" | "time";

/**
 * Leading glyph per grouping mode — the one place these are chosen, read by both the
 * two-icon toggle below and the sidebar's list-options menu, so a row and its toggle can
 * never end up wearing different icons for the same mode. Each glyph names the thing the
 * list is grouped *into*: a folder for Workspaces, the agent glyph for Agents. Time uses the
 * calendar, deliberately not the clock: that glyph already names the recency SORT one section
 * below in the same menu, and two rows wearing one mark would read as one setting.
 */
export const GROUP_MODE_ICONS: Record<GroupMode, string> = {
  workspace: ICONS.folder,
  agent: ICONS.robot,
  time: ICONS.calendar,
};

/**
 * Leading glyph per sort mode, distinguishing what actually decides the order rather than
 * decorating the rows: a clock for recency, and the opposed arrows of the drag that
 * produces a manual order.
 */
export const SORT_MODE_ICONS: Record<SessionSortMode, string> = {
  recent: ICONS.clock,
  manual: ICONS.arrowUpDown,
};

/**
 * One storage key for every grouped-list surface (sidebar + Trace page): the grouping
 * choice is a single user preference, not a per-page one — switching it anywhere
 * switches it everywhere.
 */
const GROUP_MODE_KEY = "penguin.sidebarGroupMode";

export function initialGroupMode(): GroupMode {
  const stored = localStorage.getItem(GROUP_MODE_KEY);
  return stored === "agent" || stored === "time" ? stored : "workspace";
}

/**
 * Entity the sidebar's "new" header button creates, decided by the grouping mode (the
 * created object follows what the list is grouped by): agent mode → an Agent (the
 * Agents page's existing create dialog), workspace mode → a Workspace (a new-chat
 * draft — there is no Workspace entity on the server; a Workspace comes into being
 * with the conversation created in it, chosen or auto-created on the draft card).
 * Time mode groups into buckets nothing can be created in, so its button falls back to
 * the plain new conversation — the one object every mode's list is made of.
 */
export function newEntityForGroupMode(mode: GroupMode): "agent" | "workspace" | "chat" {
  if (mode === "agent") return "agent";
  return mode === "time" ? "chat" : "workspace";
}

export function storeGroupMode(mode: GroupMode): void {
  localStorage.setItem(GROUP_MODE_KEY, mode);
}

/** Row class of folder toggles and "More" rows (the sidebar's folderClass). */
export const FOLDER_ROW_CLASS =
  "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 dark:text-gray-500 dark:hover:bg-gray-800/50";

/**
 * "More"-style row (a group's load-next-page, a folder's paging, the reveal-more-groups
 * cap): folder-row styling with the chevron column left blank. While `pending` the row
 * disables and reads the shared loading label.
 */
export function MoreRow({
  label,
  ariaLabel,
  pending = false,
  onClick,
  className,
}: {
  label: string;
  /**
   * Accessible name, when the row's own wording is not the shared "More" — a name that
   * contradicted the visible text would announce a different row than the one on screen.
   * Defaults to the shared label, which is what the count-carrying rows announce.
   */
  ariaLabel?: string;
  /** A fetch is in flight: disable and show the loading label. */
  pending?: boolean;
  onClick: () => void;
  /** Extra spacing classes (the active list's row adds mt-0.5, the groups row mt-1). */
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? S.chat.loadMore}
      disabled={pending}
      onClick={onClick}
      className={`${FOLDER_ROW_CLASS}${className ? ` ${className}` : ""} disabled:opacity-60`}
    >
      <span className="w-3" aria-hidden />
      {pending ? S.common.loading : label}
    </button>
  );
}

/**
 * Page stepper of a grouped list whose groups are paginated (the sidebar renders at most
 * SIDEBAR_GROUP_PAGE_SIZE groups per page): two flat chevron buttons around the "2/5"
 * position readout, no wider than the rows it sits under — this list is a drawer at phone
 * width. `page` is 0-based; the readout and the accessible names count from 1.
 *
 * Rendered only by callers that already know there is more than one page; the buttons
 * still disable at the ends so the control never offers a step that goes nowhere.
 */
export function GroupPager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  const step = (delta: number) => {
    const next = page + delta;
    if (next >= 0 && next < pageCount) onChange(next);
  };
  const buttonClass =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 hover:text-gray-700 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-500 dark:hover:bg-gray-800/50 dark:hover:text-gray-300";
  return (
    <div className="mt-1 flex items-center justify-center gap-1.5 px-1.5 py-0.5">
      <button
        type="button"
        data-tooltip={S.chat.prevGroupPage}
        aria-label={S.chat.prevGroupPage}
        disabled={page <= 0}
        onClick={() => step(-1)}
        className={buttonClass}
      >
        <Icon d={ICONS.chevronLeft} size={12} />
      </button>
      {/* The position doubles as the control's status: announced on change so a step is
          audible without counting the rows that swapped underneath it. */}
      <span
        aria-live="polite"
        aria-label={S.chat.groupPagePosition(page + 1, pageCount)}
        className="min-w-[2.5rem] text-center text-[11px] font-medium tabular-nums text-gray-400 dark:text-gray-500"
      >
        {page + 1}/{pageCount}
      </span>
      <button
        type="button"
        data-tooltip={S.chat.nextGroupPage}
        aria-label={S.chat.nextGroupPage}
        disabled={page >= pageCount - 1}
        onClick={() => step(1)}
        className={buttonClass}
      >
        <Icon d={ICONS.chevronRight} size={12} />
      </button>
    </div>
  );
}

/**
 * Collapsed-by-default lazy folder (subagent / scheduled / archived): the toggle row
 * shows the label (typically with the group's exact server share), the body renders only
 * while open, and an optional "More" row reveals and pages the folder independently. The
 * "show less" row below it folds the folder back to its first page; the two can stand at
 * once, since a folder revealed part-way still has rows to show AND rows to fold away.
 */
export function FolderSection({
  label,
  open,
  onToggle,
  more = false,
  moreLabel,
  pending = false,
  onMore,
  less = false,
  onLess,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Show the folder's own "More" row (its share isn't fully loaded and somewhere is left to fetch from). */
  more?: boolean;
  /**
   * Wording of that row, when the caller can count what is still hidden in THIS folder
   * ("Show 7 more chats"). Defaults to the bare shared "More" — the honest label where
   * the caller has no per-folder remainder to name.
   */
  moreLabel?: string;
  /** The folder's "More" fetch in flight. */
  pending?: boolean;
  onMore?: () => void;
  /** Show the folder's "show less" row (it is revealed past its first page and has rows to fold away). */
  less?: boolean;
  onLess?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mt-1">
      <button type="button" onClick={onToggle} className={FOLDER_ROW_CLASS}>
        <Chevron open={open} size={12} />
        {label}
      </button>
      {open && children}
      {open && more && (
        <MoreRow
          label={moreLabel ?? S.chat.loadMore}
          {...(moreLabel !== undefined ? { ariaLabel: moreLabel } : {})}
          pending={pending}
          onClick={() => onMore?.()}
        />
      )}
      {open && less && (
        <MoreRow label={S.chat.showLess} ariaLabel={S.chat.showLess} onClick={() => onLess?.()} />
      )}
    </div>
  );
}

/**
 * Group header row: the collapse toggle (leading icon + label + optional count +
 * chevron) stretching across, with optional action buttons trailing outside it. The
 * toggle's hover pill spans the full row height set by any h-7 actions (self-stretch —
 * see the sidebar's header comments for where this first bit).
 *
 * The header doubles as the drag handle when the caller makes it draggable (the
 * sidebar's manual group order). The handle is the header rather than the whole group
 * block so that the Session rows inside keep their own row-level drag, and it is the
 * element itself rather than an added grip button so the row costs no extra width —
 * this list is a drawer at phone width and already carries up to three actions.
 */
export function GroupHeader({
  open,
  onToggle,
  icon,
  label,
  uppercase = false,
  muted = false,
  count,
  title,
  actions,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  open: boolean;
  onToggle: () => void;
  /** Leading visual (Agent avatar / folder icon), sized by the caller. */
  icon: ReactNode;
  label: string;
  /** Agent names render uppercase-tracked (sidebar convention); a directory basename's casing is meaningful, so workspace groups don't. */
  uppercase?: boolean;
  /** Dim the label one step (folder-only groups: nothing active of their own); the count keeps its own class. */
  muted?: boolean;
  /** Optional trailing count (workspace groups: the group's active total). */
  count?: number;
  /** Optional tooltip (workspace groups: the full path). */
  title?: string;
  /** Trailing header actions (pin / new chat / settings / import). */
  actions?: ReactNode;
  /** Manual group order: the header acts as the drag handle (the caller wires the handlers below). */
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: (e: ReactDragEvent) => void;
  onDrop?: (e: ReactDragEvent) => void;
}) {
  return (
    <div
      // cursor-grab while the header is a handle — the SessionRow treatment one axis up.
      // Groups have no sort toggle by design, so the cursor is the only thing on screen
      // that says this row can be dragged at all.
      // min-w-0: the row never asks for more than its column; the title button is the part
      // that gives way (it truncates), the actions after it keep their size.
      className={`group/header flex min-w-0 items-center gap-0.5 px-1 pb-0.5${
        draggable ? " cursor-grab" : ""
      }`}
      {...(draggable
        ? { draggable: true, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }
        : {})}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
        {...(title !== undefined ? { "data-tooltip": title } : {})}
        className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
      >
        {icon}
        <span
          className={`min-w-0 truncate text-xs font-semibold ${
            uppercase ? "uppercase tracking-wide " : ""
          }${muted ? "text-gray-400 dark:text-gray-500" : "text-gray-500 dark:text-gray-400"}`}
        >
          {label}
        </span>
        {count !== undefined && (
          <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{count}</span>
        )}
        {/* Expand/collapse indicator sits right after the label */}
        <Chevron open={open} size={12} className="text-gray-400" />
        <span className="min-w-0 flex-1" />
      </button>
      {actions}
    </div>
  );
}
