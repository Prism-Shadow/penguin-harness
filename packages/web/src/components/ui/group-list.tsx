/**
 * Shared building blocks of the grouped Session lists (the chat sidebar and the Trace
 * page's directory tree render the same structure — group header, collapsed lazy
 * folders, "More" rows, the Workspace/Agent grouping toggle). Extracted verbatim from
 * sidebar.tsx's inner closures so the two surfaces cannot drift apart visually: the
 * markup and classes here ARE the sidebar's; callers pass the state the closures used
 * to capture.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Chevron } from "./chevron";

/** Minimal stroke-icon wrapper shared by the grouped lists (moved from sidebar.tsx). */
export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
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
    >
      <path d={d} />
    </svg>
  );
}

/** Folder outline, closed (same glyph as the draft page's Workspace pill); collapsed workspace groups and the grouping toggle use it. */
export const FOLDER_ICON =
  "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z";

/** Folder outline, open (lucide folder-open: back panel + tilted front flap); expanded workspace groups use it. */
export const FOLDER_OPEN_ICON =
  "m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2";

/** Agent glyph (the grouping toggle's "by Agent" option; also NAV_ICONS.agents in the sidebar nav). */
export const AGENT_GROUP_ICON =
  "M12 3v3m-6 4a6 6 0 0 1 12 0v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5zm3 3h.01M15 13h.01";

/** Grouping mode of a Session list (persisted; Workspace is the default). */
export type GroupMode = "workspace" | "agent";

/**
 * One storage key for every grouped-list surface (sidebar + Trace page): the grouping
 * choice is a single user preference, not a per-page one — switching it anywhere
 * switches it everywhere.
 */
const GROUP_MODE_KEY = "penguin.sidebarGroupMode";

export function initialGroupMode(): GroupMode {
  return localStorage.getItem(GROUP_MODE_KEY) === "agent" ? "agent" : "workspace";
}

export function storeGroupMode(mode: GroupMode): void {
  localStorage.setItem(GROUP_MODE_KEY, mode);
}

/** The two-icon Workspace/Agent grouping toggle (the section header's mode switch). */
export function GroupModeToggle({
  value,
  onChange,
}: {
  value: GroupMode;
  onChange: (mode: GroupMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {(
        [
          { value: "workspace", icon: FOLDER_ICON, label: S.chat.groupByWorkspace },
          { value: "agent", icon: AGENT_GROUP_ICON, label: S.chat.groupByAgent },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.label}
          aria-label={opt.label}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
            value === opt.value
              ? "bg-gray-200/70 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              : "text-gray-400 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800/70 dark:hover:text-gray-300"
          }`}
        >
          <Icon d={opt.icon} size={14} />
        </button>
      ))}
    </div>
  );
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
  pending = false,
  onClick,
  className,
}: {
  label: string;
  /** A fetch is in flight: disable and show the loading label. */
  pending?: boolean;
  onClick: () => void;
  /** Extra spacing classes (the active list's row adds mt-0.5, the groups row mt-1). */
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={S.chat.loadMore}
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
 * Collapsed-by-default lazy folder (subagent / scheduled / promotion / archived): the toggle row
 * shows the label (typically with the group's exact server share), the body renders only
 * while open, and an optional "More" row pages the folder independently.
 */
export function FolderSection({
  label,
  open,
  onToggle,
  more = false,
  pending = false,
  onMore,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Show the folder's own "More" row (its share isn't fully loaded and somewhere is left to fetch from). */
  more?: boolean;
  /** The folder's "More" fetch in flight. */
  pending?: boolean;
  onMore?: () => void;
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
        <MoreRow label={S.chat.loadMore} pending={pending} onClick={() => onMore?.()} />
      )}
    </div>
  );
}

/**
 * Group header row: the collapse toggle (leading icon + label + optional count +
 * chevron) stretching across, with optional action buttons trailing outside it. The
 * toggle's hover pill spans the full row height set by any h-7 actions (self-stretch —
 * see the sidebar's header comments for where this first bit).
 */
export function GroupHeader({
  open,
  onToggle,
  icon,
  label,
  uppercase = false,
  count,
  title,
  actions,
}: {
  open: boolean;
  onToggle: () => void;
  /** Leading visual (Agent avatar / folder icon), sized by the caller. */
  icon: ReactNode;
  label: string;
  /** Agent names render uppercase-tracked (sidebar convention); a directory basename's casing is meaningful, so workspace groups don't. */
  uppercase?: boolean;
  /** Optional trailing count (workspace groups: the group's active total). */
  count?: number;
  /** Optional tooltip (workspace groups: the full path). */
  title?: string;
  /** Trailing header actions (pin / new chat / settings / import). */
  actions?: ReactNode;
}) {
  return (
    <div className="group/header flex items-center gap-0.5 px-1 pb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
        {...(title !== undefined ? { title } : {})}
        className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
      >
        {icon}
        <span
          className={`min-w-0 truncate text-xs font-semibold ${
            uppercase ? "uppercase tracking-wide " : ""
          }text-gray-500 dark:text-gray-400`}
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
