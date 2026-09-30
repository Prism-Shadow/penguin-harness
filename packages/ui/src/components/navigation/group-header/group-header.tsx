/**
 * The grouped list's building blocks: the group header, the collapsed lazy folder, and the
 * "more" row that reveals or pages a list. They came out of the chat sidebar, which is why the
 * markup reads like its rows; the sidebar, the company channel list and the organization's
 * session list all build on them.
 *
 * The words a row says on its own — "More", "Show less", a header's "Expand" / "Collapse" and the
 * loading label of a pending row — are the interface's (`UiStrings`); anything that counts or
 * names what the row holds ("Show 7 more chats") is the caller's.
 *
 * The rows sit on the sidebar's muted surface, so their hover is a thin wash of the ink
 * (`bg-fg/5`) rather than a surface step, which on that surface would not show.
 */
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Chevron } from "../../icons/chevron/chevron";
import { ICON_SIZE } from "../../../icon-scale";

/** A folder toggle's and a "more" row's shape: a dense, muted row with a chevron column. */
const FOLDER_ROW_CLASS =
  "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs font-medium text-fg-subtle transition-colors duration-150 hover:bg-fg/5";

/**
 * A "more"-style row (a group's load-next-page, a folder's paging, the reveal-more-groups cap):
 * the folder row's styling with the chevron column left blank. While `pending` the row disables
 * and reads the interface's loading label.
 */
export function MoreRow({
  label,
  ariaLabel,
  pending = false,
  onClick,
  className,
}: {
  /** What the row says; the interface's "More" when omitted. */
  label?: string;
  /**
   * The accessible name, when the row's own wording is not the bare "More" — a name that
   * contradicted the visible text would announce a different row than the one on screen.
   * Defaults to "More", which is what the count-carrying rows announce.
   */
  ariaLabel?: string;
  /** A fetch is in flight: disable and show the loading label. */
  pending?: boolean;
  onClick: () => void;
  /** Extra spacing classes (the active list's row adds mt-0.5, the groups row mt-1). */
  className?: string;
}) {
  const strings = useUiStrings();
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? strings.more}
      disabled={pending}
      onClick={onClick}
      className={`${FOLDER_ROW_CLASS}${className ? ` ${className}` : ""} disabled:opacity-60`}
    >
      <span className="w-3" aria-hidden />
      {pending ? strings.loading : (label ?? strings.more)}
    </button>
  );
}

/**
 * A collapsed-by-default lazy folder (subagent, scheduled, archived): the toggle row shows the
 * label (typically with the group's exact share), the body renders only while open, and an
 * optional "more" row reveals and pages the folder on its own. The "show less" row below it
 * folds the folder back to its first page; the two can stand at once, since a folder revealed
 * part-way still has rows to show and rows to fold away.
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
  /** Show the folder's own "more" row (its share is not fully loaded and there is more to fetch). */
  more?: boolean;
  /**
   * The wording of that row, when the caller can count what is still hidden in this folder
   * ("Show 7 more chats"). Defaults to the bare "More", the honest label where the caller has no
   * per-folder remainder to name.
   */
  moreLabel?: string;
  /** The folder's "more" fetch is in flight. */
  pending?: boolean;
  onMore?: () => void;
  /** Show the folder's "show less" row (it is revealed past its first page). */
  less?: boolean;
  onLess?: () => void;
  children?: ReactNode;
}) {
  const strings = useUiStrings();
  return (
    <div className="mt-1">
      <button type="button" onClick={onToggle} aria-expanded={open} className={FOLDER_ROW_CLASS}>
        <Chevron open={open} size={ICON_SIZE.chevronDense} />
        {label}
      </button>
      {open && children}
      {open && more && (
        <MoreRow
          {...(moreLabel !== undefined ? { label: moreLabel, ariaLabel: moreLabel } : {})}
          pending={pending}
          onClick={() => onMore?.()}
        />
      )}
      {open && less && (
        <MoreRow label={strings.fewer} ariaLabel={strings.fewer} onClick={() => onLess?.()} />
      )}
    </div>
  );
}

/**
 * A group header row: the collapse toggle (leading icon, label, optional count, chevron)
 * stretching across, with optional action buttons trailing outside it. The toggle's hover pill
 * spans the full row height set by any h-7 actions (`self-stretch`).
 *
 * An uppercase label is a group label naming the rows below it, so it takes the eyebrow rung
 * (`ui-eyebrow`) rather than spelling its own case and tracking; a label whose casing means
 * something (a directory's basename) keeps the plain small rung.
 *
 * The header doubles as the drag handle when the caller makes it draggable (a manual group
 * order). The handle is the header rather than the whole group, so the rows inside keep their
 * own drag, and it is the element itself rather than an added grip, so the row costs no width —
 * the list is a drawer at phone width and already carries up to three actions.
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
  /** The leading visual (an avatar, a folder glyph), sized by the caller. */
  icon: ReactNode;
  label: string;
  /** A group label rather than a name whose casing matters: set on the eyebrow rung. */
  uppercase?: boolean;
  /** Dim the label one step (a group with nothing active of its own); the count keeps its ink. */
  muted?: boolean;
  /** An optional trailing count (a workspace group's active total). */
  count?: number;
  /** An optional tooltip (a workspace group's full path). */
  title?: string;
  /** Trailing header actions (pin, new chat, settings, import). */
  actions?: ReactNode;
  /** The header acts as the drag handle; the caller wires the handlers below. */
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: (e: ReactDragEvent) => void;
  onDrop?: (e: ReactDragEvent) => void;
}) {
  const strings = useUiStrings();
  const ink = muted ? "text-fg-subtle" : "text-fg-muted";
  return (
    <div
      // cursor-grab while the header is a handle: groups have no sort toggle, so the cursor is
      // the one thing on screen that says the row can be dragged at all.
      // min-w-0: the row never asks for more than its column; the title button gives way (it
      // truncates) and the actions after it keep their size.
      className={`group/header flex min-w-0 items-center gap-1 px-1 pb-0.5${
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
        aria-label={open ? strings.collapse : strings.expand}
        {...(title !== undefined ? { "data-tooltip": title } : {})}
        className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-fg/5"
      >
        {icon}
        <span
          className={`min-w-0 truncate ${uppercase ? "ui-eyebrow" : "text-xs font-semibold"} ${ink}`}
        >
          {label}
        </span>
        {count !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{count}</span>
        )}
        {/* The expand/collapse indicator sits right after the label. */}
        <Chevron open={open} size={ICON_SIZE.chevronDense} className="text-fg-subtle" />
        <span className="min-w-0 flex-1" />
      </button>
      {actions}
    </div>
  );
}
