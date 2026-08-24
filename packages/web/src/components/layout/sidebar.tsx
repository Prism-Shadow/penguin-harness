/**
 * Single-column sidebar, top to bottom:
 * Project switcher -> new chat (default_agent draft) + page nav (Agents → Evaluation Center,
 * one collapsible group behind a nav-row-wide chevron button under its last entry: arrow
 * up = click to collapse, arrow down while collapsed = the way back; state persists in
 * localStorage, the pinned new-chat block never collapses) -> Session area with three grouping
 * modes (chosen in the section header's list options; the
 * choice and each Project's group collapse and pin state persist in localStorage): by Workspace
 * (the default; groups loaded Sessions by their
 * Workspace path, temporary workspaces merged into one trailing group, header "+" starts a
 * draft in that Workspace), by Agent (group header = Agent name + new chat + Agent settings;
 * shows all Agents, including empty groups), or by time (last day / last month / earlier,
 * bucketed on last activity; the buckets span every Agent, so the Subagents / Scheduled /
 * Archived folders and the paging row sit below them as one Project-wide set). Groups can
 * be pinned via the header's hover pin toggle: pinned groups sort before unpinned within
 * their mode, keeping each partition's own order — the time buckets excepted, whose order
 * IS the timeline and which therefore carry no pin. Conversations can be pinned too (row
 * context menu; persisted per Project in
 * localStorage): pinned rows bubble to the top of their group's active list. Each row's
 * trailing slot shows the compact last-active time at rest and swaps to archive + delete
 * icon buttons on hover/focus; the full set (pin, rename, archive, delete) opens as a
 * context menu on right-click, Shift+F10, or a press-and-hold on touch
 * -> bottom user config (theme / language / System settings / logout).
 * Desktop keeps it pinned as the left column; mobile puts the whole thing in a drawer.
 * New chats always enter draft state (/chat/new, route state specifies the Agent and optionally
 * the Workspace): Model / Workspace / approval mode are all chosen on the draft input card, so
 * there's no longer a separate "quick / advanced" pair of new-chat dialogs.
 * Color scheme is white/gray-based: active state uses a solid gray fill, running status uses a small color dot, no large blocks of color.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { NavLink, useMatch, useNavigate } from "react-router";
import type {
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatRelativeShort } from "../../lib/format";
import { sessionRowActivity } from "../../lib/session-activity";
import type { SessionActivity } from "../../lib/session-activity";
import { forgetSession, noteSessionSeen, useSessionSeen } from "../../lib/session-seen";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  FOLDER_CATEGORIES,
  SIDEBAR_PAGE_SIZE,
  TIME_FOLDERS_GROUP_KEY,
  aggregateWorkspaceCounts,
  clampGroupPage,
  groupPageCount,
  groupPageOf,
  groupPageSlice,
  groupSessionsByTime,
  groupSessionsByWorkspace,
  hiddenRowCount,
  matchesSessionQuery,
  partitionSessions,
  sessionCategory,
  totalCategoryCounts,
  workspaceGroupKey,
  workspaceLabel,
} from "../../lib/session-grouping";
import type { FolderCategory, SessionPartition } from "../../lib/session-grouping";
import {
  initialNavGroupCollapsed,
  navKeysFor,
  storeNavGroupCollapsed,
} from "../../lib/nav-group-collapse";
import {
  loadPinnedSessions,
  removePinnedSession,
  savePinnedSessions,
  togglePinnedSession,
} from "../../lib/pinned-sessions";
import {
  loadWorkspaceRegistry,
  mergeRegisteredWorkspaces,
  registerWorkspace,
  saveWorkspaceRegistry,
  setWorkspaceAlias,
  unregisterWorkspace,
} from "../../lib/workspace-registry";
import type { WorkspaceEntry } from "../../lib/workspace-registry";
import {
  applyManualReorder,
  initialSessionSortMode,
  loadSessionOrder,
  moveInSequence,
  orderSessionRows,
  removeFromSessionOrder,
  saveSessionOrder,
  storeSessionSortMode,
} from "../../lib/session-order";
import type { SessionSortMode } from "../../lib/session-order";
import {
  commitGroupOrder,
  isOrderableGroupMode,
  loadGroupOrder,
  orderGroups,
  saveGroupOrder,
} from "../../lib/group-order";
import { Dropdown } from "../ui/dropdown";
import { useRowContextMenu } from "../ui/context-menu";
import {
  HOVER_ROW_ACTIONS,
  PENCIL_ICON,
  PIN_ICON,
  SessionRowHoverActions,
  SessionRowMenuRows,
  TRASH_ICON,
  contextMenuActions,
  overflowMenuDangerClass,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../ui/session-row-menu";
import type { SessionRowAction } from "../ui/session-row-menu";
import { AgentAvatar } from "../ui/agent-avatar";
import { CheckIcon, ChevronDown, GEAR_ICON, MESSAGING_RELAY_ICON, NAV_ICONS } from "../ui/icons";
import {
  FOLDER_ICON,
  FOLDER_OPEN_ICON,
  GROUP_MODE_ICONS,
  SORT_MODE_ICONS,
  FolderSection,
  GroupHeader,
  GroupPager,
  Icon,
  MoreRow,
  initialGroupMode,
  newEntityForGroupMode,
  storeGroupMode,
} from "../ui/group-list";
import type { GroupMode } from "../ui/group-list";
import { toastError, toastInfo, toastSuccess } from "../ui/toast";
import { Truncated } from "../ui/truncated";
import { Badge } from "../ui/badge";
import { SessionActivityIcon } from "../ui/session-activity-icon";
import { Modal } from "../ui/modal";
import { ConfirmModal } from "../ui/confirm-modal";
import { Button } from "../ui/button";
import { Input, noAutofill } from "../ui/input";
import { SkeletonList } from "../ui/skeleton";
import { UpdateDot } from "../ui/update-dot";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { MessagingBindingModal } from "../../features/messaging/messaging-binding-modal";
import { WorkspaceSelect } from "../../features/chat/workspace-select";
import { clearDraft, sessionDraftKey } from "../../features/chat/draft-cache";
import {
  draftSessionTitle,
  parkActiveDraft,
  removeDraftSession,
  useDraftSessions,
} from "../../features/chat/draft-sessions";
import type { DraftSessionEntry } from "../../features/chat/draft-sessions";
import { CreateProjectDialog, ProjectSettingsDialog } from "./project-dialogs";
import { DesktopUpdateRow } from "../account/desktop-update-row";
import { ServerUpdateRow } from "../account/server-update-row";
import { UpdateDialog } from "../account/update-dialog";
import { offersClientUpdate } from "../../lib/desktop-update";
import { requestClientInstall, useDesktopUpdate } from "../../lib/use-desktop-update";
import { forceUpdateCheck, updateCheckOutcome, useVersionInfo } from "../../lib/use-version-info";
import { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
import { releaseUpdate } from "../../lib/update-badges";
import { SettingsDialog } from "../../features/settings/settings-dialog";
import { ICON_SIZE } from "../../lib/icon-scale";

/** New-chat pencil (the pinned "New chat" button and the collapsed rail share it). */
export const NEW_CHAT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";

/** The workspace group's overflow-menu trigger: three FILLED dots (the stroke version read too faint at this size). */
function EllipsisGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** Magnifier (lucide search), the section header's search toggle. */
const SEARCH_ICON = "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z";

/** Horizontal sliders (lucide sliders-horizontal), the section header's list-settings menu. */
const SLIDERS_ICON = "M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3M14 2v6M8 9v6M16 16v6";

/** Close cross (the expanded search field's clear button). */
const CLOSE_ICON = "M18 6L6 18M6 6l12 12";

/**
 * Private drag payload type of a manual session reorder. Deliberately NOT `text/plain`:
 * the composer is a controlled textarea with no drop guard, and a native text drop
 * mutates its value and fires `input` — a mis-aimed reorder would paste a session id
 * into the user's message. Nothing outside these rows reads this type.
 */
const SESSION_DRAG_MIME = "application/x-penguin-session-id";

/** Private drag payload type of a group reorder (same reasoning as SESSION_DRAG_MIME: never text/plain). */
const GROUP_DRAG_MIME = "application/x-penguin-group-key";

/**
 * Is the drag in flight one of our group reorders? `types` is readable during dragover
 * (unlike getData), so the payload GROUP_DRAG_MIME carries is what authorizes the drop
 * rather than React state alone: a `dragGroup` left behind by a source header that
 * unmounted mid-drag can no longer make the sidebar swallow an unrelated drag — a file
 * from the desktop, a Session row — paint a phantom drop line, and commit on release.
 */
const isGroupDrag = (e: ReactDragEvent): boolean => e.dataTransfer.types.includes(GROUP_DRAG_MIME);

/** Manual drag-reordering needs a pointer that can drag (HTML5 DnD never fires from touch) — the outline rail's query. */
const DRAG_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * Mode-dependent create glyph: the entity's own icon (folder / robot) shrunk toward
 * the top-left, with a plus badge in the freed bottom-right corner — no knockout disc
 * needed (a background-colored punch would mismatch the hover pill), so it stays
 * legible at icon size in both themes. Stroke style matches the shared Icon set.
 */
function AddBadgeIcon({ base, size = 15 }: { base: string; size?: number }) {
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
      <g transform="translate(-1 -1) scale(0.82)">
        <path d={base} />
      </g>
      <path d="M18.5 15.5v6M15.5 18.5h6" strokeWidth="2" />
    </svg>
  );
}

const menuItemClass =
  "block w-full px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

/** Section-header icon control (search / list settings / create): the grouping-toggle button look — active renders as a pressed fill. */
const headerControlClass = (active: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
      : "text-gray-400 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800/70 dark:hover:text-gray-300"
  }`;

/** Muted section label inside the list-settings menu (分组方式 / 排序方式), at the overflow menus' density. */
const menuSectionClass =
  "px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500";

/**
 * Collapsed-group and pinned-group persistence (survives a refresh), one storage key
 * per Project and concern — group keys are Agent ids / Workspace paths, which are
 * Project-scoped. Both grouping modes share one set per concern (their key spaces
 * never collide); stray keys left by deleted Agents or Workspaces are harmless
 * (never matched) and the per-Project sets stay tiny.
 */
const collapsedGroupsKey = (projectId: string) => `penguin.sidebarCollapsedGroups.${projectId}`;
const pinnedGroupsKey = (projectId: string) => `penguin.sidebarPinnedGroups.${projectId}`;
/** Reads a persisted group-key set (no Project yet / corrupted storage degrade to empty). */
function loadGroupSet(storageKey: string | null): ReadonlySet<string> {
  if (!storageKey) return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}
function saveGroupSet(storageKey: string | null, next: ReadonlySet<string>): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...next]));
  } catch {
    /* best-effort persistence (quota/private mode) */
  }
}

/**
 * Open-state key of a collapsed folder (subagent / scheduled / archived) inside a group:
 * each folder has its own state. "\0" never appears in Agent ids or Workspace paths, so
 * the composite never collides across groups or with plain group keys.
 */
const folderKey = (groupKey: string, category: FolderCategory) => `${category}\0${groupKey}`;

/** Collapse-state key of the parked-drafts group ("\0" keeps it clear of Agent ids and Workspace paths). */
const DRAFTS_GROUP_KEY = "\0drafts";

/**
 * Session status glyph: a turning hourglass while the Session is busy, a green dot once it has
 * finished with a reply the user has not seen, and nothing once that reply has been read — or
 * if the Session never ran at all. See sessionActivity.
 */
function StatusGlyph({ activity }: { activity: SessionActivity }) {
  // Reserve the glyph's box even when there is no glyph: the row is a flex line whose title
  // truncates into whatever space is left, so letting the slot collapse would re-flow the title
  // of every never-run row (and again the moment its first run starts).
  if (activity === null) return <span aria-hidden="true" className="block h-3 w-3 shrink-0" />;
  return <SessionActivityIcon activity={activity} />;
}

export function Sidebar({
  onNavigate,
  onCollapse,
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const { user, logout, desktopMode, sessionVia } = useAuth();
  const { locale } = useLocale();
  const {
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    currentAgent,
    setCurrentAgentId,
  } = useProject();
  const {
    sessions,
    byAgent,
    countsByAgent,
    workspaceCountsByAgent,
    isLoadedFor,
    hasMoreFor,
    loadMoreFor,
    loading,
    remove,
    replace,
  } = useSessions();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Client update (desktop shell window only): the snapshot and the armed-check flag live
  // at module level in use-desktop-update.ts; this always-mounted hook instance drives the
  // polling, so a check armed in the menu still settles after the menu closes.
  const clientUpdateOffered = offersClientUpdate({ desktopMode, sessionVia });
  const clientUpdate = useDesktopUpdate(clientUpdateOffered, userOpen);
  /** Install confirmation (restarting interrupts running tasks — same consent as the shell's native prompt). */
  const [clientInstallOpen, setClientInstallOpen] = useState(false);
  // Server update: the app layout already ran the one check per session; keeping the dropdown
  // as an activation only costs a retry after a failed one.
  const { version, update } = useVersionInfo(userOpen);
  /**
   * The two update badges (use-update-badges.ts). Not the same gate as `newVersion` below,
   * which drives the ROW: a badge only appears where the trail ends in a control this mode
   * actually offers, so in the shell's own window the avatar marks the client build waiting
   * to install rather than a server release the menu never shows here.
   */
  const badges = useUpdateBadges();
  /**
   * The newer release's version string, or null while none is known — the single update row's
   * whole state machine. A resolved version is required, not just the boolean: the row's label
   * names it, so a would-be "available but unnamed" result stays on the check action rather
   * than rendering a versionless reminder.
   */
  const newVersion = releaseUpdate(update);
  /** Release announcement + admin self-update, opened from the update row once a release is known. */
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  /**
   * A manual server-update check is in flight. Held here rather than in the row, which
   * unmounts with the menu: a check clicked and then dismissed must still settle, and the
   * spinner must still be there when the menu is reopened mid-flight.
   */
  const [updateChecking, setUpdateChecking] = useState(false);
  const currentProjectId = currentProject?.projectId ?? null;
  /** This Project's read markers; re-renders the rows whenever one is stamped. */
  const sessionSeen = useSessionSeen(currentProjectId);
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
  /** Collapsed page-nav group (the 智能体 → 评估中心 entries; expanded by default, the choice persists across sessions). */
  const [navCollapsed, setNavCollapsed] = useState(initialNavGroupCollapsed);
  /** Grouping mode of the Session list (Workspace by default; the choice persists across sessions). */
  const [groupMode, setGroupModeState] = useState<GroupMode>(initialGroupMode);
  /** Collapsed groups (expanded by default), keyed by Agent id or Workspace group key depending on the mode; persisted per Project. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(collapseStoreKey),
  );
  /** Pinned groups (sorted before unpinned within their mode), keyed like collapsedGroups; persisted per Project. */
  const [pinnedGroups, setPinnedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(pinStoreKey),
  );
  /** Pinned conversations (bubbled to the top of their group's active list), Session ids; persisted per Project frontend-side (lib/pinned-sessions.ts). */
  const [pinnedSessions, setPinnedSessions] = useState<ReadonlySet<string>>(() =>
    loadPinnedSessions(currentProjectId),
  );
  /** Row sort mode ("recent" default / "manual" drag order; the choice persists across sessions like the grouping mode). */
  const [sortMode, setSortModeState] = useState<SessionSortMode>(initialSessionSortMode);
  /** Manual row order (Session ids; only relative order within a co-rendered partition matters); persisted per Project AND grouping mode — the modes cut different partitions. */
  const [sessionOrder, setSessionOrder] = useState<readonly string[]>(() =>
    loadSessionOrder(currentProjectId, initialGroupMode()),
  );
  /**
   * Manual GROUP order (Workspace keys / Agent ids), persisted per Project and grouping
   * mode like the row order. Independent of `sortMode`: dragging a group is itself the
   * intent, so there is no second toggle — an empty array is the identity and the list
   * keeps its automatic sort. Empty in time mode, whose buckets are chronological
   * (group-order.ts).
   */
  const [groupOrder, setGroupOrder] = useState<readonly string[]>(() =>
    loadGroupOrder(currentProjectId, initialGroupMode()),
  );
  /** Manually-added Workspaces (header 新建工作区; render as empty groups until Sessions exist, with optional display aliases); persisted per Project. */
  const [registeredWorkspaces, setRegisteredWorkspaces] = useState<readonly WorkspaceEntry[]>(() =>
    loadWorkspaceRegistry(currentProjectId),
  );
  /** Registered Workspace being renamed (alias edit; null = none) and the alias being typed. */
  const [renamingWorkspace, setRenamingWorkspace] = useState<{ path: string } | null>(null);
  const [workspaceAliasText, setWorkspaceAliasText] = useState("");
  /** Registered Workspace pending removal confirmation (null = none); label = the group's displayed name for the confirm copy. */
  const [deletingWorkspace, setDeletingWorkspace] = useState<{
    path: string;
    label: string;
  } | null>(null);
  /** Live title search: the input's visibility and its query (transient — never persisted). */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** Header list-settings dropdown (grouping + sort radios). */
  const [listSettingsOpen, setListSettingsOpen] = useState(false);
  /**
   * Whether a pointer that can drag is present (the outline rail's HOVER_QUERY idiom).
   * HTML5 drag-and-drop never fires from touch, and the sort mode is one GLOBAL
   * preference: offering 手动排序 in the mobile drawer would freeze that list in an
   * order the phone has no gesture to change — and flip the desktop too. The option is
   * hidden there; an already-stored "manual" degrades to recency on such a device.
   */
  const [canDrag, setCanDrag] = useState(() => window.matchMedia(DRAG_POINTER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DRAG_POINTER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setCanDrag(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /** Row being dragged (manual sort only) and the current drop hint (target row + which edge). */
  const [dragSession, setDragSession] = useState<{ scope: string; id: string } | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; after: boolean } | null>(null);
  /** Group header being dragged (its key) and the current group drop hint (target group + which edge). */
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [groupDropHint, setGroupDropHint] = useState<{ key: string; after: boolean } | null>(null);
  // Project resolved on first load / switched: swap in that Project's persisted collapse/pin sets.
  useEffect(() => {
    setCollapsedGroups(loadGroupSet(collapseStoreKey));
    setPinnedGroups(loadGroupSet(pinStoreKey));
    setPinnedSessions(loadPinnedSessions(currentProjectId));
    setSessionOrder(loadSessionOrder(currentProjectId, groupMode));
    setGroupOrder(loadGroupOrder(currentProjectId, groupMode));
    setRegisteredWorkspaces(loadWorkspaceRegistry(currentProjectId));
    setGroupPage(0);
    // The other Project's groups are gone, and so is any meaning their reveal state had.
    setGroupCaps(new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseStoreKey, pinStoreKey, currentProjectId]);
  /** Expanded folders (subagent / scheduled / archived; collapsed by default), keyed by folderKey — each folder has its own open state. */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
  /** "More" rows with a fetch in flight, keyed `${category}\0${groupKey}` — the row disables and reads "loading" so a page that lands entirely in other groups still visibly did something. */
  const [pendingLoads, setPendingLoads] = useState<ReadonlySet<string>>(new Set());
  /** Per-group display cap for active rows (keyed by group key; absent = SIDEBAR_PAGE_SIZE). "More" raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /** Which PAGE of groups renders (#139: dozens of Agents/Workspaces made the list too tall to scan), 0-based; reset per Project and on a mode switch, and clamped at render to the pages that still exist. */
  const [groupPage, setGroupPage] = useState(0);
  /** Session pending delete confirmation (null = none). */
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  /** Parked draft conversation pending delete confirmation (null = none). */
  const [deletingDraft, setDeletingDraft] = useState<DraftSessionEntry | null>(null);
  /** Parked draft conversations of this user × Project, newest first (reactive module store). */
  const draftEntries = useDraftSessions(user?.userId ?? null, currentProjectId);
  /** Session currently being renamed (null = none) and the title being typed. */
  const [renamingSession, setRenamingSession] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  /** Session whose messaging-binding dialog is open (null = none). */
  const [messagingSession, setMessagingSession] = useState<SessionInfo | null>(null);

  const setGroupMode = (mode: GroupMode) => {
    storeGroupMode(mode);
    setGroupModeState(mode);
    // The modes have unrelated group lists: go back to the first page, drop the per-group
    // reveal state (a cap keyed by an Agent id means nothing to a Workspace group), and
    // swap in this mode's own manual order (the stored sequence is read within partitions,
    // whose boundaries are exactly what the mode decides — one shared array would scramble).
    setSessionOrder(loadSessionOrder(currentProjectId, mode));
    setGroupOrder(loadGroupOrder(currentProjectId, mode));
    setGroupPage(0);
    setGroupCaps(new Map());
  };

  /** Collapse/expand the page-nav group (same store-then-set convention as setGroupMode). */
  const toggleNavGroup = () => {
    const next = !navCollapsed;
    storeNavGroupCollapsed(next);
    setNavCollapsed(next);
  };

  /** Workspace groups (workspace mode): computed from the flat list, temp directories merged last, plus the manually-added Workspaces as empty groups on top (newest registration first). */
  const workspaceGroups = useMemo(
    () => mergeRegisteredWorkspaces(groupSessionsByWorkspace(sessions), registeredWorkspaces),
    [sessions, registeredWorkspaces],
  );

  /** Workspace-mode per-group exact server totals (folded from the per-Agent per-Workspace counts). */
  const workspaceGroupCounts = useMemo(
    () => aggregateWorkspaceCounts(workspaceCountsByAgent),
    [workspaceCountsByAgent],
  );

  // Pinned groups first within each mode, then the manual drag order within each pin
  // partition. Nothing dragged yet = an empty order = the automatic sort untouched
  // (recency for Workspace groups with the temp group last, the configured Agent order
  // for Agents), which is also what a group with no stored place falls back to.
  // The stored array belongs to the mode it was loaded for: handing an Agent list an
  // order of Workspace keys is a no-op only as long as the two key namespaces cannot
  // collide, and it costs the empty-order fast path on every render of the other mode.
  const orderedAgents = useMemo(
    () =>
      orderGroups(agents, (a) => a.agentId, {
        pinned: pinnedGroups,
        order: groupMode === "agent" ? groupOrder : [],
      }),
    [agents, pinnedGroups, groupOrder, groupMode],
  );
  const orderedWorkspaceGroups = useMemo(
    () =>
      orderGroups(workspaceGroups, (g) => g.key, {
        pinned: pinnedGroups,
        order: groupMode === "workspace" ? groupOrder : [],
      }),
    [workspaceGroups, pinnedGroups, groupOrder, groupMode],
  );

  // The FULL displayed group sequences a drop commits — every group of the mode, not the
  // page of groups on screen (see groupDragProps).
  const agentGroupSequence = useMemo(() => orderedAgents.map((a) => a.agentId), [orderedAgents]);
  const workspaceGroupSequence = useMemo(
    () => orderedWorkspaceGroups.map((g) => g.key),
    [orderedWorkspaceGroups],
  );

  /** Group key a Session's FOLDERS hang off under the current mode (the archived-open state); time mode keeps one shared set for the whole Project. */
  const sessionGroupKey = (s: SessionInfo) =>
    groupMode === "agent"
      ? s.agentId
      : groupMode === "time"
        ? TIME_FOLDERS_GROUP_KEY
        : workspaceGroupKey(s.workspace);

  const toggleGroup = (key: string) => {
    // Inert while searching: groups render force-opened then, so a click would change
    // nothing on screen while silently rewriting the persisted collapse state — the user
    // would find groups flipped once the query clears.
    if (searching) return;
    // Computed outside the state updater (theme.tsx convention): the persistence write is a
    // side effect, and updaters must stay pure (double-invoked in StrictMode).
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
    saveGroupSet(collapseStoreKey, next);
  };

  /** Pin / unpin a group (same toggle-and-persist convention as toggleGroup). */
  const togglePin = (key: string) => {
    const next = new Set(pinnedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPinnedGroups(next);
    saveGroupSet(pinStoreKey, next);
  };

  /** Pin / unpin one conversation (row menu; same toggle-and-persist convention). */
  const toggleSessionPin = (sessionId: string) => {
    const next = togglePinnedSession(pinnedSessions, sessionId);
    setPinnedSessions(next);
    savePinnedSessions(currentProjectId, next);
  };

  /** Switch the row sort mode (store-then-set convention). Leaving manual KEEPS the stored order — toggling back restores it. */
  const setSortMode = (mode: SessionSortMode) => {
    storeSessionSortMode(mode);
    setSortModeState(mode);
  };

  /** Search active = a non-blank query is live-filtering the list. */
  const searching = searchQuery.trim() !== "";

  /**
   * Group pagination (Workspace / Agent modes — time mode has at most three buckets and
   * pages nothing). A pure display window: the manual group order still commits over the
   * FULL sequence (see groupDragProps), and no group's data loading depends on which page
   * it sits on. Search bypasses paging entirely — a match on page 3 would read as no match
   * at all, which is the same reason a collapsed group is forced open while searching.
   */
  const pagedGroupTotal =
    groupMode === "agent"
      ? orderedAgents.length
      : groupMode === "workspace"
        ? orderedWorkspaceGroups.length
        : 0;
  const groupPageTotal = groupPageCount(pagedGroupTotal);
  /** The page actually on screen: the stored one, pinned inside the pages that still exist. */
  const shownGroupPage = clampGroupPage(groupPage, pagedGroupTotal);

  /** The groups to render: this page's slice, or every match while searching. */
  const groupsOnPage = <T,>(groups: T[]): T[] =>
    searching ? groups : groupPageSlice(groups, shownGroupPage);

  /** Pager below the group list — rendered only once the groups overflow a single page. */
  const groupPagerRow = () =>
    !searching && groupPageTotal > 1 ? (
      <GroupPager page={shownGroupPage} pageCount={groupPageTotal} onChange={setGroupPage} />
    ) : null;

  /** The sort actually applied: a stored "manual" needs a drag-capable pointer to mean anything (see canDrag). */
  const effectiveSortMode: SessionSortMode = sortMode === "manual" && canDrag ? "manual" : "recent";

  /** Title filter of one group's loaded rows (search only sees loaded pages — there is no server-side search). */
  const filterRows = (rows: SessionInfo[]) =>
    searching ? rows.filter((s) => matchesSessionQuery(s, searchQuery)) : rows;

  /**
   * Time mode's split of the loaded rows: the buckets take the active conversations, the
   * shared folders below take the rest. Deliberately NOT memoized — the bucket boundary is
   * `Date.now()`, and a memo would freeze it at its last dependency change; the compact
   * relative timestamps rendered beside these rows are recomputed every render for exactly
   * the same reason. Null outside time mode, so no other mode pays for the two passes.
   */
  const timeParts = groupMode === "time" ? partitionSessions(filterRows(sessions)) : null;
  const timeGroups = timeParts === null ? [] : groupSessionsByTime(timeParts.active, Date.now());

  /** Time mode's exact server share, Project-wide: its buckets span every Agent, so the shared folders and the whole-list "More" read the summed counts. */
  const projectCounts = totalCategoryCounts(countsByAgent);

  /** Agents holding rows of a category anywhere in this Project — time mode's fetch fan-out (the counts are kept in step locally, so they cover freshly added rows too). */
  const projectAgentsFor = (category: SessionCategory) =>
    [...countsByAgent].filter(([, counts]) => counts[category] > 0).map(([agentId]) => agentId);

  /** Agents with an unfetched active page left; the whole-list "More" of time mode pages all of them at once. */
  const timeMoreAgents = projectAgentsFor("active").filter((id) => hasMoreFor(id, "active"));

  /** A time bucket's rows as a group partition: the buckets carry active conversations only. */
  const bucketPartition = (rows: SessionInfo[]): SessionPartition => ({
    active: rows,
    subagent: [],
    schedule: [],
    archived: [],
  });

  /** Close the search row and drop the filter (the toggle button, the clear ×, and Escape all land here). */
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  /**
   * Drop of a manual drag: commit the reordered partition sequence into the stored
   * order (the sequence moves to the array's front; only relative order within a
   * co-rendered partition is ever read, so other groups' ids are unaffected).
   */
  const commitManualDrop = (partitionIds: readonly string[], targetId: string, after: boolean) => {
    if (!dragSession) return;
    const seq = moveInSequence(partitionIds, dragSession.id, targetId, after);
    // Identity guard: a drop that changes nothing (self-drop, or landing where the row
    // already sat) must not rewrite and persist a fresh array.
    if (seq === partitionIds) return;
    const next = applyManualReorder(sessionOrder, seq);
    setSessionOrder(next);
    saveSessionOrder(currentProjectId, groupMode, next);
  };

  /**
   * Drop of a group drag: splice the dragged group in beside its target and persist.
   *
   * `sequence` is the mode's FULL rendered key list — every group of the mode, not the
   * page of groups on screen — and commitGroupOrder folds it into the stored array
   * where those groups already render, so a Workspace whose Sessions have not paged in
   * yet keeps its stored place instead of being pushed behind the ones that have.
   *
   * Nothing prunes here. Deciding a stored key is DEAD needs the mode's complete live
   * key set, and this component cannot prove one — the per-Workspace counts that look
   * like a proof are filtered by the "show CLI sessions" preference, and a settled Agent
   * fetch may simply have failed. Stale keys are inert (group-order.ts), so the cost of
   * keeping them is a map entry; the cost of a wrong proof is an arrangement the user
   * cannot get back.
   */
  const commitGroupDrop = (sequence: readonly string[], targetKey: string, after: boolean) => {
    if (dragGroup === null) return;
    const next = commitGroupOrder(groupOrder, sequence, dragGroup, targetKey, after);
    // Identity guard, as for rows: a drop that changes nothing must not persist a fresh array.
    if (next === groupOrder) return;
    setGroupOrder(next);
    saveGroupOrder(currentProjectId, groupMode, next);
  };

  /**
   * Drag-reorder wiring of one group header, given the mode's FULL ordered key list
   * (not the page of groups on screen — committing only the visible groups would drop
   * the hidden ones out of the stored sequence and bring them back as newcomers).
   *
   * Offered only where the groups have an order to change (isOrderableGroupMode: time
   * mode's buckets are a fixed chronological ladder), never on a search-filtered view,
   * and only where a pointer that can drag exists — HTML5 drag-and-drop never fires
   * from touch. A stored order still APPLIES on such a device: unlike the rows' global
   * sort mode, a group order is per Project and implicit, so there is nothing to
   * degrade — a phone renders the arrangement its owner made at a desk.
   *
   * A drop stays inside the dragged group's own pin partition, so dragging can reorder
   * but never pin or unpin (the rows' rule, one axis up).
   */
  const groupDragProps = (key: string, sequence: readonly string[]) => {
    if (!canDrag || searching || !isOrderableGroupMode(groupMode)) {
      return { header: {}, dropEdge: null as "above" | "below" | null };
    }
    const dragging = dragGroup;
    const samePartition =
      dragging !== null && dragging !== key && pinnedGroups.has(dragging) === pinnedGroups.has(key);
    /** Which half of the header the pointer is in — the edge the drop would land on. */
    const edgeOf = (e: ReactDragEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientY - rect.top > rect.height / 2;
    };
    return {
      header: {
        draggable: true,
        onDragStart: (e: ReactDragEvent) => {
          e.dataTransfer.setData(GROUP_DRAG_MIME, key);
          e.dataTransfer.effectAllowed = "move" as const;
          setDragGroup(key);
        },
        onDragEnd: () => {
          setDragGroup(null);
          setGroupDropHint(null);
        },
        onDragOver: (e: ReactDragEvent) => {
          if (!samePartition || !isGroupDrag(e)) return;
          e.preventDefault();
          // preventDefault alone only says "a drop may land here"; the effect still has
          // to be one effectAllowed permits, or a modifier held during the drag resolves
          // it to "none" and the drop event never fires (drop-zone.tsx sets it too).
          e.dataTransfer.dropEffect = "move";
          const after = edgeOf(e);
          setGroupDropHint((prev) =>
            prev?.key === key && prev.after === after ? prev : { key, after },
          );
        },
        // dragleave also fires when the pointer merely crosses onto one of the header's
        // OWN children — the collapse toggle spans most of the row, and up to three
        // action buttons follow it — so clearing unconditionally strobes the indicator.
        // relatedTarget is where the drag is going: still inside means nothing changed
        // (the idiom features/chat/drop-zone.tsx already uses).
        onDragLeave: (e: ReactDragEvent) => {
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          setGroupDropHint((prev) => (prev?.key === key ? null : prev));
        },
        onDrop: (e: ReactDragEvent) => {
          if (!samePartition || dragging === null || !isGroupDrag(e)) return;
          e.preventDefault();
          // The FULL sequence, not the drag's pin partition: commitGroupOrder splices
          // within one array, and samePartition has already refused a cross-boundary
          // drop, so filtering here would only hide the other partition's keys from the
          // splice and cost them their stored positions.
          commitGroupDrop(sequence, key, edgeOf(e));
          setDragGroup(null);
          setGroupDropHint(null);
        },
      },
      dropEdge:
        samePartition && groupDropHint?.key === key
          ? groupDropHint.after
            ? ("below" as const)
            : ("above" as const)
          : null,
    };
  };

  /** Parked drafts through the live search (matched on their first-line title). */
  const shownDrafts = searching
    ? draftEntries.filter((e) =>
        draftSessionTitle(e).toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : draftEntries;

  /** Whether the active search hits anything anywhere (drafts included) — drives the quiet no-match line. */
  const hasSearchMatches =
    shownDrafts.length > 0 ||
    (groupMode === "agent"
      ? orderedAgents.some((a) => filterRows(byAgent.get(a.agentId) ?? []).length > 0)
      : groupMode === "time"
        ? timeParts !== null && Object.values(timeParts).some((rows) => rows.length > 0)
        : orderedWorkspaceGroups.some((g) => filterRows(g.sessions).length > 0));

  /** In-flight key of one group's category "More" (folderKey shares the same composite for folder categories). */
  const loadKey = (groupKey: string, category: SessionCategory) => `${category}\0${groupKey}`;

  /**
   * The server stream a group's fetches walk: its own, under Workspace grouping, or the
   * Agent's whole one otherwise. Only Workspace groups need their own — an Agent group IS
   * the whole stream, and a time bucket is cut from rows that are already loaded, so it
   * fetches nothing of its own at all.
   *
   * This is what makes the groups independent. Sharing one per-Agent cursor meant a group's
   * "load more" consumed the page its siblings were about to read: their rows appeared,
   * their reveal counts moved, and the group that asked could grow by less than a page — or
   * by nothing at all.
   */
  const fetchScope = (groupKey: string): string | undefined =>
    groupMode === "workspace" ? groupKey : undefined;

  /** loadMoreFor with an in-flight marker for the triggering "More" row (disable + loading text). */
  const trackedLoadMore = (groupKey: string, category: SessionCategory, agentIds: string[]) => {
    const key = loadKey(groupKey, category);
    setPendingLoads((prev) => new Set(prev).add(key));
    void loadMoreFor(agentIds, category, fetchScope(groupKey)).finally(() => {
      setPendingLoads((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    });
  };

  /**
   * Open/close a group's folder. A folder's content is loaded on demand: the first
   * expand fetches its category's first page for every contributing Agent that hasn't
   * been asked yet (already-loaded rows stay put — re-expanding never refetches; the
   * folder's own "More" row does the paging from there).
   */
  const toggleFolder = (groupKey: string, category: FolderCategory, agentIds: string[]) => {
    // Inert while searching (same reason as toggleGroup): folders render force-opened,
    // so a click would only fire a pointless category fetch and desync the open state.
    if (searching) return;
    const key = folderKey(groupKey, category);
    const opening = !openFolders.has(key);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (opening) next.add(key);
      else next.delete(key);
      return next;
    });
    if (opening) {
      const scope = fetchScope(groupKey);
      const unloaded = agentIds.filter((id) => !isLoadedFor(id, category, scope));
      if (unloaded.length > 0) void loadMoreFor(unloaded, category, scope);
    }
  };

  // The open chat is an automation-created Session: expand exactly its origin's folder in its
  // group, so the active row is never hidden inside a collapsed folder (mirrors the archived
  // expansion on archiving the open chat; archived wins, so an archived Session is left to
  // that folder). Auto-expansion fires ONCE per (grouping mode, active session): the ref guard
  // keeps list mutations (status ticks, reloads) from re-opening a folder the user explicitly
  // collapsed while that chat stays open. `sessions` must remain a dependency — the active
  // session may not be in the list yet on first render, and the guard is only set once the
  // row is actually found and expanded.
  const lastAutoExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    const s = sessions.find((x) => x.sessionId === activeSessionId);
    if (!s) return;
    const category = sessionCategory(s);
    if (category === "active" || category === "archived") return;
    const guard = `${groupMode}\0${activeSessionId}`;
    if (lastAutoExpandedRef.current === guard) return;
    lastAutoExpandedRef.current = guard;
    const groupKey =
      groupMode === "agent"
        ? s.agentId
        : groupMode === "time"
          ? TIME_FOLDERS_GROUP_KEY
          : workspaceGroupKey(s.workspace);
    const key = folderKey(groupKey, category);
    setOpenFolders((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    // Same on-demand load a click-expand does, for this Session's own Agent (siblings of
    // other contributing Agents stay behind the folder's "More"), down the same stream the
    // folder itself pages.
    const scope = groupMode === "workspace" ? groupKey : undefined;
    if (!isLoadedFor(s.agentId, category, scope)) void loadMoreFor([s.agentId], category, scope);
  }, [activeSessionId, sessions, groupMode, isLoadedFor, loadMoreFor]);

  /**
   * Workspace mode: give every rendered group its own first page. The initial load reads
   * the Agent's whole stream, which is one stream cut by Workspace — it fills the groups
   * unevenly, so a group can come up with two rows while the neighbour it shares an Agent
   * with got eight. Any group left short of a full first page (or of its own total, if that
   * is smaller) asks for one down its own stream, once: the scoped pair is loaded from then
   * on and this is inert.
   *
   * Only the groups on screen ask — the pager bounds that to one page of groups — and a
   * search is left alone, since it renders loaded matches only and fetching cannot find more.
   */
  useEffect(() => {
    if (groupMode !== "workspace" || searching) return;
    for (const group of groupPageSlice(orderedWorkspaceGroups, shownGroupPage)) {
      const counts = workspaceGroupCounts.get(group.key);
      const total = counts?.totals.active ?? 0;
      // Counts not in yet (0): nothing is known to be missing, so nothing is asked for.
      const loaded = group.sessions.filter((s) => sessionCategory(s) === "active").length;
      if (loaded >= Math.min(SIDEBAR_PAGE_SIZE, total)) continue;
      const agents = [
        ...new Set([...(counts?.agents.active ?? []), ...group.sessions.map((s) => s.agentId)]),
      ];
      const unloaded = agents.filter((id) => !isLoadedFor(id, "active", group.key));
      if (unloaded.length > 0) void loadMoreFor(unloaded, "active", group.key);
    }
  }, [
    groupMode,
    searching,
    orderedWorkspaceGroups,
    shownGroupPage,
    workspaceGroupCounts,
    isLoadedFor,
    loadMoreFor,
  ]);

  /**
   * Manual server-update check, from the menu's update row: forces a lookup past the
   * server's TTL cache and pushes the result into the shared version-info store, so the
   * row turns into the update entry and the avatar's reminder dot appears at once. Every
   * outcome toasts — the check is fail-soft (a failed lookup arrives as the `error` field,
   * not an exception; the catch handles our own server being unreachable).
   */
  const runUpdateCheck = async () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    try {
      const outcome = updateCheckOutcome(await forceUpdateCheck());
      if (outcome.kind === "disabled") toastInfo(S.update.checkDisabled);
      else if (outcome.kind === "failed") toastError(S.update.checkFailed);
      else if (outcome.kind === "found") toastSuccess(S.update.foundNew(outcome.latestVersion));
      else toastSuccess(S.update.upToDate);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setUpdateChecking(false);
    }
  };

  /** Archive / unarchive: persists immediately and updates in place (fails silently; the next list refresh self-corrects). */
  const toggleArchive = async (s: SessionInfo) => {
    // Archiving the currently open chat: expand the "archived" folder so it doesn't silently vanish from the sidebar with no way back.
    if (!s.archived && s.sessionId === activeSessionId) {
      setOpenFolders((prev) => new Set(prev).add(folderKey(sessionGroupKey(s), "archived")));
    }
    try {
      const res = await api.patchSession(s.sessionId, { archived: !s.archived });
      replace(res.session);
    } catch {
      /* Ignore: non-critical operation */
    }
  };

  const confirmRename = async () => {
    if (!renamingSession) return;
    const title = renameText.trim();
    if (!title) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await api.patchSession(renamingSession.sessionId, { title });
      replace(res.session);
      setRenamingSession(null);
    } catch (e) {
      setRenameError(apiErrorText(e));
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDeleteSession = async () => {
    if (!deletingSession) return;
    setDeletingBusy(true);
    const target = deletingSession;
    try {
      await api.deleteSession(target.sessionId);
      // remove() also tombstones the id (see the store's isDeleted), which is what keeps the
      // chat page from re-fetching the Session it is still routed at during the frames before
      // the navigate() below lands. Ordering the two is deliberately NOT the mechanism: the
      // list lives in a zustand store whose updates are not subject to React's transition
      // lanes, so scheduling tricks here cannot be relied on to sequence them.
      remove(target.sessionId);
      // The session is gone, so clear its input draft too (no orphaned keys left in localStorage; keys are scoped per user, #68).
      if (user) clearDraft(sessionDraftKey(user.userId, target.sessionId));
      // Prune its pin and manual-order entry as well (both helpers return the same
      // reference when the id wasn't present — the write is skipped then).
      const prunedPins = removePinnedSession(pinnedSessions, target.sessionId);
      if (prunedPins !== pinnedSessions) {
        setPinnedSessions(prunedPins);
        savePinnedSessions(currentProjectId, prunedPins);
      }
      forgetSession(currentProjectId, target.sessionId);
      const prunedOrder = removeFromSessionOrder(sessionOrder, target.sessionId);
      if (prunedOrder !== sessionOrder) {
        setSessionOrder(prunedOrder);
        saveSessionOrder(currentProjectId, groupMode, prunedOrder);
      }
      setDeletingSession(null);
      // The deleted session was the one open: jump to this Agent's next conversation, otherwise
      // fall back to the chat home page. Auto-opened conversations are never archived (hidden by
      // default — landing there would look like the chat vanished into thin air) and never
      // subagent children (they belong to some other conversation).
      if (activeSessionId === target.sessionId) {
        const rest = (byAgent.get(target.agentId) ?? []).filter((s) => {
          const category = sessionCategory(s);
          return (
            s.sessionId !== target.sessionId && (category === "active" || category === "schedule")
          );
        });
        navigate(rest[0] ? `/chat/${rest[0].sessionId}` : "/chat");
      }
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setDeletingBusy(false);
    }
  };

  const go = (to: string) => {
    navigate(to);
    onNavigate?.();
  };

  /**
   * New chat: enters draft state (/chat/new) without creating a Session — Model / Workspace /
   * approval mode are all chosen on the draft input card, and the Session is only actually
   * created when the first message is sent. The route state explicitly carries the target
   * Agent: the agent-mode group header's "+" uses that group's Agent, while the menu's "New
   * chat" uses default_agent; this explicit intent overrides the previously selected Agent in
   * the draft cache (the rest of the draft content, such as the message body, is preserved).
   * The workspace-mode group header's "+" additionally carries that group's Workspace path
   * ("" = a temporary workspace), pre-filling the draft's Workspace selection the same way.
   */
  const newChat = (agentId?: string, workspace?: string) => {
    // Typed-but-unsent text in the ACTIVE new-chat draft becomes a parked draft
    // conversation first (a row in the list below, sendable anytime — draft-sessions.ts),
    // so this click always lands on an empty composer and never silently shelves content.
    if (user && currentProjectId) parkActiveDraft(user.userId, currentProjectId);
    if (agentId) setCurrentAgentId(agentId);
    const state = {
      ...(agentId ? { agentId } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
    };
    navigate(`/chat/${DRAFT_SESSION_ID}`, Object.keys(state).length > 0 ? { state } : undefined);
    onNavigate?.();
  };

  /** Confirmed parked-draft deletion: drops the entry; a deleted draft that is open falls back to the plain new-chat page. */
  const confirmDeleteDraft = () => {
    if (!deletingDraft) return;
    if (user && currentProjectId) {
      removeDraftSession(user.userId, currentProjectId, deletingDraft.id);
    }
    if (activeSessionId === deletingDraft.id) navigate(`/chat/${DRAFT_SESSION_ID}`);
    setDeletingDraft(null);
  };

  /** Target of the menu's "New chat": default_agent, falling back to the first Agent (if the list isn't ready yet, resolution is deferred to the draft page). */
  const defaultAgentId = (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;

  /** A Session always needs an Agent, so the workspace-mode "+" uses the current Agent, falling back to default_agent. */
  const workspaceNewChatAgentId = currentAgent?.agentId ?? defaultAgentId;

  /** What the header's create button makes, and its tooltip (the created object follows the grouping mode). */
  const newEntity = newEntityForGroupMode(groupMode);
  const newEntityLabel =
    newEntity === "agent"
      ? S.agent.create
      : newEntity === "chat"
        ? S.chat.newSessionMenu
        : S.chat.newWorkspaceEntity;

  /** Persist-if-changed for every registry mutation (register / alias / unregister share the same-reference fast exit). */
  const applyRegistryChange = (next: readonly WorkspaceEntry[]) => {
    if (next === registeredWorkspaces) return;
    setRegisteredWorkspaces(next);
    saveWorkspaceRegistry(currentProjectId, next);
  };

  /**
   * 新建工作区: register the browsed pick so it surfaces as a group immediately, Sessions
   * or not. An empty registered group is appended and nothing pins or orders it yet, so it
   * lands last — turn to the page that now holds it, or to the page of the group that was
   * already there. Otherwise, past ten groups, the freshly added Workspace would sit on a
   * page the user is not looking at and the click would read as a no-op.
   */
  const addWorkspace = (path: string, machineId?: string | null) => {
    const next = registerWorkspace(registeredWorkspaces, path, machineId ?? undefined);
    if (next === registeredWorkspaces) return;
    applyRegistryChange(next);
    const key = workspaceGroupKey(path);
    const existing = orderedWorkspaceGroups.findIndex((g) => g.key === key);
    setGroupPage(groupPageOf(existing >= 0 ? existing : orderedWorkspaceGroups.length));
  };

  /** Paths with a registry entry — only their groups offer the rename/remove overflow. */
  const registeredPaths = useMemo(
    () => new Set(registeredWorkspaces.map((e) => e.path)),
    [registeredWorkspaces],
  );

  /** Open the alias editor pre-filled with the current alias ("" = following the basename). */
  const openRenameWorkspace = (path: string) => {
    setWorkspaceAliasText(registeredWorkspaces.find((e) => e.path === path)?.alias ?? "");
    setRenamingWorkspace({ path });
  };

  /** Commit the alias (blank reverts the label to the directory basename). Direct save — no server, nothing destructive. */
  const confirmRenameWorkspace = () => {
    if (!renamingWorkspace) return;
    applyRegistryChange(
      setWorkspaceAlias(registeredWorkspaces, renamingWorkspace.path, workspaceAliasText),
    );
    setRenamingWorkspace(null);
  };

  /**
   * 删除工作区 (confirmed via the shared ConfirmModal, like every destructive-looking
   * action): drops the sidebar registry entry only — disk and Sessions are never
   * touched, the confirm copy says exactly that, and re-adding restores it. A group
   * that still has Sessions simply persists as session-derived.
   */
  const confirmDeleteWorkspace = () => {
    if (!deletingWorkspace) return;
    applyRegistryChange(unregisterWorkspace(registeredWorkspaces, deletingWorkspace.path));
    setDeletingWorkspace(null);
  };

  const openSession = (s: SessionInfo) => {
    // Opening is what "read" means here: stamp the marker before navigating.
    noteSessionSeen(currentProjectId, s.sessionId, s.lastActiveAt);
    // Cross-group click: the current Agent follows this Session's own Agent.
    setCurrentAgentId(s.agentId);
    go(`/chat/${s.sessionId}`);
  };

  /** agentId → display name (row hint tooltips in workspace mode). */
  const agentNameById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, agentDisplayName(a)])),
    [agents],
  );

  /** Session rows shared by both modes; withAgentHint adds a small Agent avatar per row (workspace mode, where the group no longer names the Agent). */
  const renderRows = (
    rows: SessionInfo[],
    withAgentHint: boolean,
    /** Manual sort only: the drag scope (group key) plus the group's FULL ordered active list — the drop must commit every loaded row of the partition, not the display-capped slice the user happens to see. */
    dragCtx?: { scope: string; fullRows: SessionInfo[] },
    /** Whether these rows are the group's ACTIVE list (the only rows pinning can reorder). */
    activeList = false,
  ) => (
    <ul className="space-y-0.5">
      {rows.map((s) => {
        // Manual-sort drag wiring (active lists only; never while searching — a filtered
        // view is not the real order). A drop stays within its own scope AND its own
        // pin partition: dragging can reorder but never pin or unpin.
        const dragging =
          dragCtx !== undefined && dragSession?.scope === dragCtx.scope ? dragSession : null;
        const samePartition =
          dragging !== null &&
          dragging.id !== s.sessionId &&
          pinnedSessions.has(dragging.id) === pinnedSessions.has(s.sessionId);
        const drag =
          dragCtx === undefined
            ? {}
            : {
                draggable: true,
                onDragStart: (e: ReactDragEvent) => {
                  // Firefox refuses to start a drag without payload data — but the id must
                  // NOT ride on text/plain: the composer is a controlled textarea with no
                  // drop guard, so a mis-aimed reorder would paste a session id straight
                  // into the user's message. A private type is invisible to text drops.
                  e.dataTransfer.setData(SESSION_DRAG_MIME, s.sessionId);
                  e.dataTransfer.effectAllowed = "move" as const;
                  setDragSession({ scope: dragCtx.scope, id: s.sessionId });
                },
                onDragEnd: () => {
                  setDragSession(null);
                  setDropHint(null);
                },
                onDragOver: (e: ReactDragEvent) => {
                  if (!dragging || !samePartition) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY - rect.top > rect.height / 2;
                  setDropHint((prev) =>
                    prev?.id === s.sessionId && prev.after === after
                      ? prev
                      : { id: s.sessionId, after },
                  );
                },
                onDragLeave: () => setDropHint((prev) => (prev?.id === s.sessionId ? null : prev)),
                onDrop: (e: ReactDragEvent) => {
                  if (!dragging || !samePartition) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY - rect.top > rect.height / 2;
                  // The FULL partition (every loaded row of this group on the dragged
                  // row's side of the pin boundary), not the visible slice: committing
                  // only the capped rows would drop the hidden ones out of the stored
                  // sequence, and they would come back as "newcomers" at the top.
                  const partitionIds = dragCtx.fullRows
                    .filter(
                      (r) => pinnedSessions.has(r.sessionId) === pinnedSessions.has(dragging.id),
                    )
                    .map((r) => r.sessionId);
                  commitManualDrop(partitionIds, s.sessionId, after);
                  setDragSession(null);
                  setDropHint(null);
                },
                dropEdge:
                  samePartition && dropHint?.id === s.sessionId
                    ? dropHint.after
                      ? ("below" as const)
                      : ("above" as const)
                    : null,
              };
        return (
          <SessionRow
            key={s.sessionId}
            s={s}
            active={s.sessionId === activeSessionId}
            // Busy / settled / read / never-ran, decided in one place (session-activity.ts) so
            // the whole transition sequence is testable without a DOM.
            activity={sessionRowActivity(s, sessionSeen, activeSessionId)}
            pinned={pinnedSessions.has(s.sessionId)}
            // Pinning is an ACTIVE-list priority: folder rows (subagent / scheduled /
            // archived) are ordered chronologically inside their folder and never pass
            // through orderSessionRows, so a pin there would write an id, light the
            // glyph, move nothing — and then shift the active list's drag partition.
            canPin={activeList}
            // Last ACTIVITY, not creation: the server stamps lastActiveAt when a run
            // starts and again when it ends, so a running row shows its run-start time
            // (it recedes while the run continues — the hourglass beside it is what says
            // "active right now"). CLI-adopted and subagent rows are not
            // driven by this server, so theirs stays at createdAt.
            lastActive={formatRelativeShort(s.lastActiveAt, locale)}
            {...(withAgentHint ? { agentHint: agentNameById.get(s.agentId) ?? s.agentId } : {})}
            {...drag}
            onOpen={openSession}
            onTogglePin={(x) => toggleSessionPin(x.sessionId)}
            onRename={(x) => {
              setRenameError(null);
              setRenameText(x.title ?? "");
              setRenamingSession(x);
            }}
            onMessaging={(x) => setMessagingSession(x)}
            onDelete={(x) => setDeletingSession(x)}
            onToggleArchive={(x) => void toggleArchive(x)}
          />
        );
      })}
    </ul>
  );

  /**
   * Collapsed-by-default lazy folder (subagent / scheduled / archived): nothing is
   * fetched until the first expand, and once open the folder pages independently with
   * its own "More" row. Everything is driven by the group's **own** exact server share
   * (`totals` — the Agent's counts in agent mode, the per-Workspace fold in workspace
   * mode): the folder exists only while its share is non-zero, the label shows that
   * share, and "More" shows only while loaded rows fall short of it — an Agent's
   * content in *other* Workspaces can never surface a folder here. The folder's "More"
   * pages independently of the active list's; in workspace mode a fetched page can land
   * rows in other groups' folders too, so one click may grow this folder by fewer than
   * a full page — the row shows a loading state while the fetch runs and stays until
   * this group's share is fully loaded.
   */
  const renderFolder = (
    groupKey: string,
    category: FolderCategory,
    parts: SessionPartition,
    withAgentHint: boolean,
    /** Agents that may hold this group's rows of this category (fetch fan-out set). */
    agentIds: string[],
    totals: SessionCategoryCounts | undefined,
  ) => {
    const rows = parts[category];
    // While searching the folder speaks for its loaded MATCHES only: a match hidden
    // behind a collapsed folder would look like a missing result (the models page's
    // search-forces-open rationale), so the folder is forced open, labelled by the
    // match count, hidden when nothing matches, and never offers "More" (the server
    // cannot search unloaded rows).
    if (searching && rows.length === 0) return null;
    // Loaded rows win a disagreement with the totals (counts refresh only on reload).
    const total = searching ? rows.length : Math.max(totals?.[category] ?? 0, rows.length);
    if (total === 0) return null;
    // More while the group's share isn't fully loaded AND somewhere is left to fetch from
    // (counts drifting above reality would otherwise leave a dead button until reload).
    const more =
      !searching &&
      rows.length < total &&
      agentIds.some((id) => hasMoreFor(id, category, fetchScope(groupKey)));
    return (
      <FolderSection
        key={category}
        label={S.chat.folderGroups[category](total)}
        open={searching || openFolders.has(folderKey(groupKey, category))}
        onToggle={() => toggleFolder(groupKey, category, agentIds)}
        more={more}
        // The folder shows every row it has loaded, so its remainder is its own share
        // minus those — the same count the active list's reveal row names one level up.
        moreLabel={S.chat.expandRestSessions(Math.max(total - rows.length, 0))}
        pending={pendingLoads.has(loadKey(groupKey, category))}
        onMore={() => trackedLoadMore(groupKey, category, agentIds)}
      >
        {renderRows(rows, withAgentHint)}
      </FolderSection>
    );
  };

  /**
   * Active-list "Show N more chats": reveal one more page of this group's already-loaded
   * active rows, and fetch the next active server page only when the reveal actually runs
   * past what is loaded. A group whose next page is already in memory spends no request —
   * in workspace mode a fetch fans out to every Agent contributing to the group and its
   * rows may land in other groups entirely, so a pointless one is not free.
   */
  const showMore = (groupKey: string, agentIds: string[], loaded: number) => {
    const nextCap = (groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE) + SIDEBAR_PAGE_SIZE;
    setGroupCaps((prev) => {
      const next = new Map(prev);
      next.set(groupKey, nextCap);
      return next;
    });
    if (agentIds.length > 0 && loaded < nextCap) trackedLoadMore(groupKey, "active", agentIds);
  };

  /** "Show less": drop one group's reveal back to the first page (rows already fetched stay in memory). */
  const collapseRows = (groupKey: string) => {
    setGroupCaps((prev) => {
      if (!prev.has(groupKey)) return prev;
      const next = new Map(prev);
      next.delete(groupKey);
      return next;
    });
  };

  /**
   * Expanded group body shared by both modes: active user rows (display-capped; "More"
   * reveals and loads further **active-only** pages — the folders below never feed it) +
   * the collapsed-by-default subagent / scheduled / archived folders, each loading on
   * first expand and paging on its own. `totals` / `agentsFor` carry the group's exact
   * server share and its fetch fan-out set per category.
   */
  const renderGroupBody = (
    groupKey: string,
    parts: SessionPartition,
    withAgentHint: boolean,
    totals: SessionCategoryCounts | undefined,
    agentsFor: (category: SessionCategory) => string[],
  ) => {
    const cap = groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE;
    // Row order: the pinned cluster first, then — under manual sort — the stored order
    // within each pin partition (lib/session-order.ts). Both reorder only rows already
    // FETCHED: a pinned conversation that lives past the loaded pages does not surface
    // until "More" pulls its page in (the list has no server-side pin), so the pinned
    // cluster leads what is loaded, not the Agent's whole history. Folder rows keep
    // their chronological order: pinning and manual order are active-list concerns.
    // While searching, the display cap is bypassed — every loaded match shows, and
    // "More" hides (it pages the unfiltered list and would read as "more matches",
    // which the server cannot promise).
    const orderedActive = orderSessionRows(parts.active, (s) => s.sessionId, {
      pinned: pinnedSessions,
      sortMode: effectiveSortMode,
      order: sessionOrder,
      recencyOf: (s) => s.lastActiveAt,
    });
    const shownActive = searching ? orderedActive : orderedActive.slice(0, cap);
    /** Manual sort only (never on a search-filtered view): drag scope + the group's full ordered list, so a drop commits the whole partition. */
    const dragCtx =
      effectiveSortMode === "manual" && !searching
        ? { scope: groupKey, fullRows: orderedActive }
        : undefined;
    // The reveal row counts THIS group's own hidden conversations and nothing else — the
    // folders never feed it, and no other group's numbers reach it. `fullyLoaded` says the
    // group's whole active share is already in memory (every Agent that could hold a row of
    // it is fetched out), which is when the loaded rows become the truth: server counts
    // refresh only on reload, so a count drifting above reality would otherwise leave a row
    // that reveals nothing behind it.
    const activeAgents = agentsFor("active");
    const fullyLoaded =
      activeAgents.length > 0 &&
      !activeAgents.some((id) => hasMoreFor(id, "active", fetchScope(groupKey)));
    const hiddenActive = searching
      ? 0
      : hiddenRowCount({
          shown: shownActive.length,
          loaded: parts.active.length,
          total: totals?.active ?? 0,
          fullyLoaded,
        });
    // "Show less" appears once the group is revealed past its first page and there is
    // something for it to hide again.
    const canCollapse =
      !searching && cap > SIDEBAR_PAGE_SIZE && parts.active.length > SIDEBAR_PAGE_SIZE;
    const folders = FOLDER_CATEGORIES.map((category) =>
      renderFolder(groupKey, category, parts, withAgentHint, agentsFor(category), totals),
    );
    const empty = parts.active.length === 0 && folders.every((f) => f === null);
    const activePending = pendingLoads.has(loadKey(groupKey, "active"));
    return (
      <>
        {empty ? (
          loading ? (
            // The same window the chat pane's skeleton covers: the Agent groups render as
            // soon as the Agents arrive, but the session pages are still being fetched —
            // "no Sessions yet" is not the honest answer until they land.
            <SkeletonList rows={2} />
          ) : (
            <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.noSessions}
            </p>
          )
        ) : (
          // Drag-reorder is offered on the active list under manual sort (folders keep
          // chronological order), and never on a search-filtered view.
          renderRows(shownActive, withAgentHint, dragCtx, true)
        )}

        {/* Reveal / collapse this group's own conversations (kept adjacent to the active
            list they extend, above the folders). Both rows can stand at once: a group
            revealed part-way still has more to show AND something to fold back. */}
        {hiddenActive > 0 && (
          <MoreRow
            label={S.chat.expandRestSessions(hiddenActive)}
            ariaLabel={S.chat.expandRestSessions(hiddenActive)}
            pending={activePending}
            onClick={() => showMore(groupKey, activeAgents, parts.active.length)}
            className="mt-0.5"
          />
        )}
        {canCollapse && (
          <MoreRow
            label={S.chat.showLess}
            ariaLabel={S.chat.showLess}
            onClick={() => collapseRows(groupKey)}
            {...(hiddenActive > 0 ? {} : { className: "mt-0.5" })}
          />
        )}

        {/* Folders (collapsed by default): subagent first — spawned from the conversations
            at hand — then scheduled background runs, then archived (archived wins over the
            origin folders). */}
        {folders}
      </>
    );
  };

  /**
   * Time mode's one shared, Project-wide set of folders (rendered once below the buckets):
   * their rows load only on first expand, so an unloaded Session has no known bucket and no
   * bucket could honestly claim a share of them. Counts and fetch fan-out are summed over
   * every Agent. A null entry means the Project holds no rows of that category at all —
   * which is also what tells the empty-list line whether it is telling the truth.
   */
  const timeFolders =
    timeParts === null
      ? []
      : FOLDER_CATEGORIES.map((category) =>
          renderFolder(
            TIME_FOLDERS_GROUP_KEY,
            category,
            timeParts,
            true,
            projectAgentsFor(category),
            projectCounts,
          ),
        );

  /** Page entries of the collapsible nav group (智能体 → 评估中心, driven by the NAV_GROUP_KEYS manifest, minus the entries this user's role cannot reach). Always mounted — the collapse animates their height to zero and turns them inert. */
  const navItems: Array<{ to: string; label: string; icon: string }> = navKeysFor(
    user?.isAdmin === true,
  ).map((key) => ({ to: `/${key}`, label: S.nav[key], icon: NAV_ICONS[key] }));

  return (
    <div className="flex h-full w-full flex-col">
      {/* Project switcher (+ collapse sidebar) */}
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        {onCollapse && (
          <button
            type="button"
            title={S.nav.collapseSidebar}
            aria-label={S.nav.collapseSidebar}
            onClick={onCollapse}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <Icon d="M15 6l-6 6 6 6M4 4v16" size={18} />
          </button>
        )}
        <Dropdown
          open={projectOpen}
          setOpen={setProjectOpen}
          className="min-w-0 flex-1"
          menuClass="left-0 right-0 top-full mt-1 origin-top"
          button={
            <button
              type="button"
              onClick={() => setProjectOpen(!projectOpen)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-semibold transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {currentProject ? projectDisplayName(currentProject) : S.common.loading}
              </span>
              <span className="text-gray-400">
                <ChevronDown />
              </span>
            </button>
          }
        >
          {projects.map((p) => (
            <button
              key={p.projectId}
              type="button"
              onClick={() => {
                setCurrentProjectId(p.projectId);
                setProjectOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                p.projectId === currentProject?.projectId ? "font-semibold" : ""
              }`}
            >
              <span className="truncate">{projectDisplayName(p)}</span>
              <Badge tone="gray">{p.role}</Badge>
            </button>
          ))}
          <div className="mt-1.5 border-t border-gray-100 pt-1.5 dark:border-gray-800">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                setProjectOpen(false);
                setCreateProjectOpen(true);
              }}
            >
              + {S.project.create}
            </button>
            {currentProject && (
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setProjectOpen(false);
                  setProjectSettingsOpen(true);
                }}
              >
                {S.project.settings}
              </button>
            )}
          </div>
        </Dropdown>
      </div>

      {/* New chat: the only pinned entry besides the Project switcher above and the user row
          below. No background fill, the same gray hover/active styling as the nav items,
          distinguished only by its position and font-medium; shows the same gray active state
          while on the draft page.
          The gap to the scroll area below is this block's OWN pb-2, not padding inside the
          scroller: padding-top there belongs to the scrollable content and slides away with
          it, so a scrolled nav entry ended up flush against this pinned button, the two
          labels touching. Outside the scroller the 8px stays put at every scroll offset —
          the same text-to-text rhythm two adjacent nav rows have. */}
      <div className="shrink-0 px-2 pb-2 pt-2">
        <button
          type="button"
          onClick={() => newChat(defaultAgentId)}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
            activeSessionId === DRAFT_SESSION_ID
              ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
          }`}
        >
          <span className="text-gray-500 dark:text-gray-400">
            <Icon d={NEW_CHAT_ICON} />
          </span>
          {S.chat.newSessionMenu}
        </button>
      </div>

      {/* Scroll area: the page nav and the session list scroll together, so the nav rides up
          as the list is scrolled. It is the sidebar's only shrinkable block — with the nav
          pinned, the column's fixed height (Project switcher + New chat + eight nav entries +
          user row ≈ 412px) exceeded a short window, and the overflow, clipped by nothing,
          grew the document into a second scrollbar.
          relative: the scroller acts as its own containing block, so absolute descendants
          (each row's sr-only Agent name) anchor and scroll inside it — anchored to the
          initial containing block instead, rows past the fold would bypass this
          overflow-y-auto and stretch the **document**, so expanding "More" / a source
          folder made the whole page scroll (composer pushed up, blank space below). */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <nav className="space-y-0.5">
          {/* Expand/collapse SLIDE: grid-template-rows tweens between 0fr and 1fr with the
              inner overflow-hidden clipping the rows (the skills/models-page convention) —
              the moving clip edge reveals/hides the entries while the toggle button and the
              Session list below glide up/down with it; a subtle opacity fade rides along,
              both 200ms, moving as one with the chevron flip below. The rows stay mounted
              for the tween but go inert while collapsed (zero-height rows must not stay
              Tab-focusable or clickable). Transitions fire only on state CHANGES, so a mount
              restoring a persisted collapsed state renders collapsed instantly — only user
              toggles animate; reduced motion is covered by the global
              prefers-reduced-motion override in styles.css. */}
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              navCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
            }`}
          >
            <div className="overflow-hidden" inert={navCollapsed}>
              <div
                className={`space-y-0.5 transition-opacity duration-200 ${
                  navCollapsed ? "opacity-0" : "opacity-100"
                }`}
              >
                {navItems.map((item) => {
                  /* Four nav entries sit on a badge trail — Agents (an outdated kernel, fixed on
                     the Agent settings page two clicks down), Skills, Models and the Cost Center
                     (each cleared on the page itself). The dot is anchored to the row, not to the
                     label text (where it would float over whatever follows the word): at the
                     row's right edge, on the same inset as its horizontal padding, and vertically
                     centred on the row rather than on the line of text. */
                  const note = navNoteFor(badges, item.to);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => onNavigate?.()}
                      {...(note !== null
                        ? {
                            // The row's own label is visible, so the tooltip only adds what
                            // the dot means; the accessible name keeps that label as its
                            // prefix. (The collapsed rail's icon-only twin has no visible
                            // label, so its tooltip carries both.)
                            title: note,
                            "aria-label": `${item.label} · ${note}`,
                          }
                        : {})}
                      className={({ isActive }) =>
                        `relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
                          isActive
                            ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                            : "text-gray-600 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
                        }`
                      }
                    >
                      <span className="text-gray-500 dark:text-gray-400">
                        <Icon d={item.icon} />
                      </span>
                      {item.label}
                      {note !== null && (
                        <UpdateDot size="inline" position="right-2.5 top-1/2 -translate-y-1/2" />
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </div>
          {/* Collapse toggle of the page-nav group (智能体 → 评估中心): a slim (h-4)
              nav-row-wide button directly under the group's last entry — a centered chevron
              pointing UP while expanded (click to collapse) and DOWN while collapsed (the
              button stays as the only way back, right under the new-chat boundary once the
              entries are hidden). The soft resting band is deliberate — the sidebar's one
              exception to flat-at-rest: it makes the strip read as the seam between the
              page nav above and the Session list below (the ruled separator it replaces
              was rejected as a line under the button); hover deepens it a step further so
              it stays clearly interactive. Icon-only, so tooltip + aria carry the name
              (GroupHeader's collapse/expand wording). */}
          <button
            type="button"
            onClick={toggleNavGroup}
            aria-expanded={!navCollapsed}
            aria-label={navCollapsed ? S.nav.expandGroup : S.nav.collapseGroup}
            title={navCollapsed ? S.nav.expandGroup : S.nav.collapseGroup}
            className="flex h-4 w-full items-center justify-center rounded-md bg-gray-200/70 text-gray-400 transition-colors duration-150 hover:bg-gray-300/60 hover:text-gray-700 dark:bg-gray-800/70 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${navCollapsed ? "" : "rotate-180"}`}
            />
          </button>
        </nav>

        {/* Section header: list label + right-aligned controls (icon + tooltip family):
            search, list settings (grouping + sort radios — the old inline grouping
            toggle relocated into this menu), and the mode-dependent create button (the
            created object follows the grouping mode). The search is a mac-style
            IN-PLACE expansion — no extra row: the two grid columns tween (the 0fr/1fr
            trick, horizontal), the label's column collapsing while the controls column
            takes the full width and the field inside grows leftward over the label's
            place; the magnifier morphs from toggle button into the field's leading
            glyph. No ruled separator at this boundary — see the nav toggle above. */}
        <div
          className={`mt-3 grid items-center px-1 pt-2 transition-[grid-template-columns] duration-200 ease-out ${
            searchOpen ? "grid-cols-[0fr_1fr]" : "grid-cols-[1fr_1fr]"
          }`}
        >
          <span
            className={`min-w-0 overflow-hidden whitespace-nowrap px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 transition-opacity duration-200 dark:text-gray-500 ${
              searchOpen ? "opacity-0" : "opacity-100"
            }`}
          >
            {S.chat.sessionList}
          </span>
          <div className="flex min-w-0 items-center justify-end gap-0.5">
            {searchOpen ? (
              /* Expanded field: leading magnifier glyph + input + clear ×, one bordered
                 box filling the row (its width rides the column tween). Esc and × both
                 collapse it and drop the filter. */
              <div className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md border border-gray-300 bg-white px-1.5 transition-colors duration-150 focus-within:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:focus-within:border-gray-500">
                <span aria-hidden className="shrink-0 text-gray-400 dark:text-gray-500">
                  <Icon d={SEARCH_ICON} size={12} />
                </span>
                <input
                  autoFocus
                  value={searchQuery}
                  placeholder={S.chat.searchSessionsPlaceholder}
                  aria-label={S.chat.searchSessions}
                  {...noAutofill}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      closeSearch();
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
                />
                <button
                  type="button"
                  title={S.chat.searchClear}
                  aria-label={S.chat.searchClear}
                  onClick={closeSearch}
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <Icon d={CLOSE_ICON} size={11} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                title={S.chat.searchSessions}
                aria-label={S.chat.searchSessions}
                onClick={() => setSearchOpen(true)}
                className={headerControlClass(false)}
              >
                <Icon d={SEARCH_ICON} size={14} />
              </button>
            )}
            <Dropdown
              open={listSettingsOpen}
              setOpen={setListSettingsOpen}
              portal={{ direction: "down", align: "right" }}
              menuClass="w-40"
              button={
                <button
                  type="button"
                  title={S.chat.listSettings}
                  aria-label={S.chat.listSettings}
                  aria-haspopup="menu"
                  aria-expanded={listSettingsOpen}
                  onClick={() => setListSettingsOpen(!listSettingsOpen)}
                  className={headerControlClass(listSettingsOpen)}
                >
                  <Icon d={SLIDERS_ICON} size={14} />
                </button>
              }
            >
              <p className={menuSectionClass}>{S.chat.groupModeSection}</p>
              <MenuRadioRow
                icon={GROUP_MODE_ICONS.workspace}
                label={S.chat.groupByWorkspace}
                checked={groupMode === "workspace"}
                onSelect={() => {
                  setGroupMode("workspace");
                  setListSettingsOpen(false);
                }}
              />
              <MenuRadioRow
                icon={GROUP_MODE_ICONS.agent}
                label={S.chat.groupByAgent}
                checked={groupMode === "agent"}
                onSelect={() => {
                  setGroupMode("agent");
                  setListSettingsOpen(false);
                }}
              />
              <MenuRadioRow
                icon={GROUP_MODE_ICONS.time}
                label={S.chat.groupByTime}
                checked={groupMode === "time"}
                onSelect={() => {
                  setGroupMode("time");
                  setListSettingsOpen(false);
                }}
              />
              <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
              <p className={menuSectionClass}>{S.chat.sortModeSection}</p>
              {/* Manual order is offered only where a drag can actually happen (see canDrag). */}
              {canDrag && (
                <MenuRadioRow
                  icon={SORT_MODE_ICONS.manual}
                  label={S.chat.sortManual}
                  checked={sortMode === "manual"}
                  onSelect={() => {
                    setSortMode("manual");
                    setListSettingsOpen(false);
                  }}
                />
              )}
              <MenuRadioRow
                icon={SORT_MODE_ICONS.recent}
                label={S.chat.sortRecent}
                checked={sortMode === "recent"}
                onSelect={() => {
                  setSortMode("recent");
                  setListSettingsOpen(false);
                }}
              />
            </Dropdown>
            {/* Mode-dependent create — 具体新建的对象按分组方式决定, the icon following
                suit (folder+ / robot+, a bottom-right plus badge on the entity's glyph):
                agent grouping opens the Agents page's existing create dialog (route
                state); workspace grouping opens the SAME directory-browse menu the
                draft's workspace picker uses — the picked directory registers as a
                workspace group immediately, Sessions or not. Time buckets are not
                something to create into, so that mode starts a plain new conversation
                and wears the compose glyph without a plus badge. */}
            {newEntity === "agent" ? (
              <button
                type="button"
                title={newEntityLabel}
                aria-label={newEntityLabel}
                onClick={() => {
                  navigate("/agents", { state: { create: true } });
                  onNavigate?.();
                }}
                className={headerControlClass(false)}
              >
                <AddBadgeIcon base={NAV_ICONS.agents} />
              </button>
            ) : newEntity === "chat" ? (
              <button
                type="button"
                title={newEntityLabel}
                aria-label={newEntityLabel}
                onClick={() => newChat()}
                className={headerControlClass(false)}
              >
                <Icon d={NEW_CHAT_ICON} size={ICON_SIZE.iconButton} />
              </button>
            ) : (
              <WorkspaceSelect
                // Remount per Project: the picker browses lazily and caches the listing
                // for its lifetime, so a long-lived instance would show the PREVIOUS
                // Project's directories after a switch — and register that path into the
                // new Project's registry.
                key={currentProjectId ?? "no-project"}
                projectId={currentProjectId ?? ""}
                workspace=""
                onChange={addWorkspace}
                // The sidebar's + is where a workspace is CREATED, so it is where the
                // machine is chosen; the draft and settings pickers edit a workspace that
                // already has one.
                chooseMachine
                trigger={(open, toggle) => (
                  <button
                    type="button"
                    title={newEntityLabel}
                    aria-label={newEntityLabel}
                    aria-expanded={open}
                    onClick={toggle}
                    className={headerControlClass(open)}
                  >
                    <AddBadgeIcon base={FOLDER_ICON} />
                  </button>
                )}
              />
            )}
          </div>
        </div>

        {/* Parked draft conversations (unsent new chats, newest first): pinned above both
            grouping modes — they belong to no Agent or Workspace until sent. Hidden
            entirely while there are none; the search filter applies to their titles too. */}
        {shownDrafts.length > 0 && (
          <div className="pt-2.5">
            <GroupHeader
              open={searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)}
              onToggle={() => toggleGroup(DRAFTS_GROUP_KEY)}
              icon={
                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                  <Icon d={NEW_CHAT_ICON} size={ICON_SIZE.groupHeaderGlyph} />
                </span>
              }
              label={S.chat.draftGroup}
              uppercase
              count={shownDrafts.length}
            />
            {(searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)) && (
              <ul className="space-y-0.5">
                {shownDrafts.map((entry) => (
                  <DraftRow
                    key={entry.id}
                    entry={entry}
                    active={entry.id === activeSessionId}
                    onOpen={() => go(`/chat/${entry.id}`)}
                    onDelete={() => setDeletingDraft(entry)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {groupMode === "agent" ? (
          loading && agents.length === 0 ? (
            <SkeletonList rows={5} />
          ) : (
            // While searching: every group renders (paging bypassed), zero-match groups
            // hide, and the rest are forced open — a hit inside a collapsed group would
            // look like a missing result.
            groupsOnPage(orderedAgents).map((agent) => {
              const groupRows = filterRows(byAgent.get(agent.agentId) ?? []);
              if (searching && groupRows.length === 0) return null;
              const parts = partitionSessions(groupRows);
              const collapsed = !searching && collapsedGroups.has(agent.agentId);
              const pinned = pinnedGroups.has(agent.agentId);
              const drag = groupDragProps(agent.agentId, agentGroupSequence);
              return (
                <GroupBlock key={agent.agentId} dropEdge={drag.dropEdge}>
                  {/* Group header: collapse toggle (Agent name) + pin + new chat + Agent settings; also the group's drag handle. */}
                  <GroupHeader
                    {...drag.header}
                    open={!collapsed}
                    onToggle={() => toggleGroup(agent.agentId)}
                    icon={
                      <AgentAvatar
                        id={agent.agentId}
                        name={agentDisplayName(agent)}
                        size={18}
                        className="shrink-0 rounded"
                      />
                    }
                    label={agentDisplayName(agent)}
                    uppercase
                    actions={
                      <>
                        <GroupPinButton pinned={pinned} onToggle={() => togglePin(agent.agentId)} />
                        {/* New chat: enters draft state directly with this group's Agent (all options live on the draft input card) */}
                        <button
                          type="button"
                          title={S.chat.newSessionMenu}
                          aria-label={S.chat.newSessionMenu}
                          onClick={() => newChat(agent.agentId)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          <Icon d="M12 5v14M5 12h14" size={ICON_SIZE.groupHeaderAction} />
                        </button>
                        <button
                          type="button"
                          title={S.agent.settings}
                          onClick={() => go(`/agents/${agent.agentId}`)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          <Icon d={GEAR_ICON} size={ICON_SIZE.groupHeaderAction} />
                        </button>
                      </>
                    }
                  />

                  {collapsed
                    ? null
                    : renderGroupBody(
                        agent.agentId,
                        parts,
                        false,
                        countsByAgent.get(agent.agentId),
                        () => [agent.agentId],
                      )}
                </GroupBlock>
              );
            })
          )
        ) : null}
        {groupMode === "agent" ? groupPagerRow() : null}
        {groupMode !== "workspace" ? null : loading && sessions.length === 0 ? (
          <SkeletonList rows={5} />
        ) : orderedWorkspaceGroups.length === 0 && !searching ? (
          <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
            {S.chat.noSessions}
          </p>
        ) : (
          // Same search treatment as agent mode: paging bypassed, zero-match groups hidden, the rest forced open.
          groupsOnPage(orderedWorkspaceGroups).map((group) => {
            const groupRows = filterRows(group.sessions);
            if (searching && groupRows.length === 0) return null;
            const parts = partitionSessions(groupRows);
            const collapsed = !searching && collapsedGroups.has(group.key);
            const pinned = pinnedGroups.has(group.key);
            const drag = groupDragProps(group.key, workspaceGroupSequence);
            /** This group's exact server share (per-Workspace fold) and its per-category fetch fan-out. */
            const counts = workspaceGroupCounts.get(group.key);
            const contributingAgents = [...new Set(group.sessions.map((s) => s.agentId))];
            const agentsFor = (category: SessionCategory) => [
              ...new Set([...(counts?.agents[category] ?? []), ...contributingAgents]),
            ];
            return (
              <GroupBlock key={group.key} dropEdge={drag.dropEdge}>
                {/* Group header: collapse toggle (folder icon + directory basename + count, full
                    path in the tooltip; the count = the group's active conversations only, exact
                    server share, loaded rows win a disagreement — the folders never feed it) +
                    pin + new chat in this Workspace; also the group's drag handle. */}
                <GroupHeader
                  {...drag.header}
                  open={!collapsed}
                  onToggle={() => toggleGroup(group.key)}
                  icon={
                    /* Folder opens and closes with the group */
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      <Icon
                        d={collapsed ? FOLDER_ICON : FOLDER_OPEN_ICON}
                        size={ICON_SIZE.groupHeaderGlyph}
                      />
                    </span>
                  }
                  label={group.temp ? S.chat.tempWorkspaces : group.label}
                  count={
                    searching
                      ? parts.active.length
                      : Math.max(counts?.totals.active ?? 0, parts.active.length)
                  }
                  {...(group.fullPath !== null ? { title: group.fullPath } : {})}
                  actions={
                    <>
                      <GroupPinButton pinned={pinned} onToggle={() => togglePin(group.key)} />
                      {/* New chat in this Workspace: pre-fills the group's path in the draft ("" = temporary workspace); the Agent is the current one, falling back to default_agent */}
                      <button
                        type="button"
                        title={S.chat.newSessionInWorkspace}
                        aria-label={S.chat.newSessionInWorkspace}
                        onClick={() => newChat(workspaceNewChatAgentId, group.fullPath ?? "")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      >
                        <Icon d="M12 5v14M5 12h14" size={ICON_SIZE.groupHeaderAction} />
                      </button>
                      {/* Manually-added (registry-backed) Workspaces only: rename-alias /
                            remove-from-sidebar overflow, to the right of the "+" (session-
                            derived groups have no registry entry for these to act on). */}
                      {registeredPaths.has(group.key) && (
                        <GroupOverflowMenu
                          onRename={() => openRenameWorkspace(group.key)}
                          onDelete={() =>
                            setDeletingWorkspace({ path: group.key, label: group.label })
                          }
                        />
                      )}
                    </>
                  }
                />

                {/* A workspace group can span Agents: the group body fans folder loads and "More"
                    out per category to the Agents whose share of THIS group is non-zero (plus the
                    Agents already contributing loaded rows) — the active list and each folder
                    page independently. */}
                {collapsed
                  ? null
                  : renderGroupBody(group.key, parts, true, counts?.totals, agentsFor)}
              </GroupBlock>
            );
          })
        )}
        {groupMode === "workspace" ? groupPagerRow() : null}

        {/* Time mode: last day / last month / earlier, bucketed on each conversation's last
            activity — the same stamp the rows' compact timestamps and the recency sort read,
            so a row can never sit under a bucket its own timestamp contradicts. Empty buckets
            are dropped, and there are at most three, so this mode never paginates its groups.
            The buckets span every Agent and every Workspace: a bucket's "More" only reveals
            further loaded rows, while fetching the next page and reaching the Subagents /
            Scheduled / Archived rows happen once for the whole Project, below. */}
        {groupMode !== "time" || timeParts === null ? null : loading && sessions.length === 0 ? (
          <SkeletonList rows={5} />
        ) : (
          <>
            {timeGroups.map((group) => {
              const collapsed = !searching && collapsedGroups.has(group.key);
              return (
                <div key={group.key} className="pt-2.5">
                  <GroupHeader
                    open={!collapsed}
                    onToggle={() => toggleGroup(group.key)}
                    icon={
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">
                        <Icon d={GROUP_MODE_ICONS.time} size={ICON_SIZE.groupHeaderGlyph} />
                      </span>
                    }
                    label={S.chat.timeGroups[group.bucket]}
                    uppercase
                    count={group.sessions.length}
                  />
                  {collapsed
                    ? null
                    : renderGroupBody(
                        group.key,
                        bucketPartition(group.sessions),
                        true,
                        undefined,
                        () => [],
                      )}
                </div>
              );
            })}

            {/* Empty only when the shared folders below are empty too (renderGroupBody's own
                rule): "no Sessions yet" over an "Archived (3)" row would contradict it. */}
            {timeGroups.length === 0 && !searching && timeFolders.every((f) => f === null) && (
              <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
                {S.chat.noSessions}
              </p>
            )}

            {/* Whole-list paging: a fetched page lands in whichever bucket its rows' activity
                puts them, so the row that pulls one belongs to the list, not to a bucket —
                and its label says "conversations" where a bucket's says "more". */}
            {!searching &&
              timeParts.active.length < projectCounts.active &&
              timeMoreAgents.length > 0 && (
                <MoreRow
                  label={S.chat.loadMoreSessions}
                  ariaLabel={S.chat.loadMoreSessions}
                  pending={pendingLoads.has(loadKey(TIME_FOLDERS_GROUP_KEY, "active"))}
                  onClick={() => trackedLoadMore(TIME_FOLDERS_GROUP_KEY, "active", timeMoreAgents)}
                  className="mt-1"
                />
              )}

            {/* The shared, Project-wide folders (see timeFolders). */}
            <div className="pt-2.5">{timeFolders}</div>
          </>
        )}

        {/* Quiet no-match line: the search is live and nothing — drafts included — hit. */}
        {searching && !hasSearchMatches && (
          <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
            {S.chat.searchNoMatches}
          </p>
        )}
      </div>

      {/* Bottom user config */}
      <div className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-800">
        <Dropdown
          open={userOpen}
          setOpen={setUserOpen}
          menuClass="bottom-full left-0 right-0 mb-1 origin-bottom"
          button={
            <button
              type="button"
              onClick={() => setUserOpen(!userOpen)}
              {...(badges.softwareNote !== null
                ? {
                    // The dot alone is mysterious: name what is waiting on the trigger (hover
                    // tooltip + accessible name), in the update row's own wording.
                    title: badges.softwareNote,
                    "aria-label": `${user?.userId ?? ""} · ${badges.softwareNote}`,
                  }
                : {})}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
            >
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900">
                {(user?.userId ?? "?").slice(0, 1).toUpperCase()}
                {/* Update reminder: the menu behind this trigger holds the row that acts on
                    it, and the trigger's tooltip/label above say what it is. */}
                {badges.software !== null && <UpdateDot />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{user?.userId}</span>
              {user?.isAdmin && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{S.auth.admin}</span>
              )}
            </button>
          }
        >
          <div className="py-1">
            {/* System settings dialog: everyone gets the row — the dialog always has the
                personal pages, and the server-global ones inside it stay gated by the
                section registry rather than by this row. The preference rows that used to
                stack here live on its pages now. */}
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                setUserOpen(false);
                setSettingsOpen(true);
              }}
            >
              {S.settings.systemSettings}
            </button>
            {/* Update row, directly under the settings entry rather than on a page inside
                it: the check is one click from the menu, and the same row turns into the
                update entry once the lazy check (menu open) names a newer release. Desktop
                mode never checks here — updating is the shell's job. */}
            {!desktopMode && (
              <ServerUpdateRow
                version={version?.version ?? null}
                newVersion={newVersion}
                checking={updateChecking}
                menuItemClass={menuItemClass}
                onCheck={() => void runUpdateCheck()}
                onOpenDialog={() => {
                  setUserOpen(false);
                  setUpdateDialogOpen(true);
                }}
              />
            )}
            {/* Desktop stand-in for the row above, in the shell's own window only:
                the same slot updates the CLIENT through the shell's own updater (relayed
                via /api/desktop/update) — which is what "updating is the shell's job"
                means for someone sitting in front of the app. A browser signed into the
                same desktop-mode server gets neither row: it can't run the CLI self-update
                there, nor restart someone else's GUI app (offersClientUpdate mirrors the
                gate the routes enforce). */}
            {clientUpdateOffered && (
              <DesktopUpdateRow
                status={clientUpdate.status}
                checkPending={clientUpdate.checkPending}
                menuItemClass={menuItemClass}
                onInstallRequest={() => {
                  setUserOpen(false);
                  setClientInstallOpen(true);
                }}
              />
            )}
            {/* Hidden in desktop mode: the window IS the session — logging out would
                strand the user on a login page whose password was never shown. */}
            {!desktopMode && (
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-sm text-red-600 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => {
                  setUserOpen(false);
                  void logout().then(() => navigate("/login"));
                }}
              >
                {S.auth.logout}
              </button>
            )}
          </div>
        </Dropdown>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Release announcement, release-notes link and the admin-only self-update. Mounted
          here rather than in the row, which unmounts as the menu closes on the click that
          opens this. */}
      <UpdateDialog
        open={updateDialogOpen}
        onClose={() => setUpdateDialogOpen(false)}
        latestVersion={newVersion}
        releaseUrl={update?.releaseUrl ?? null}
        canUpdate={user?.isAdmin === true}
        /* A finished self-update makes the known release stale — re-check silently so the
           row stops offering the version that is now running. */
        onRunFinished={() => void forceUpdateCheck().catch(() => undefined)}
      />

      {/* Client-update install consent: restarting interrupts running tasks, the same
          warning the shell's native prompt carries — the web row must not be the one
          path that kills work without asking. */}
      <ConfirmModal
        open={clientInstallOpen}
        title={S.update.clientInstallConfirmTitle}
        onClose={() => setClientInstallOpen(false)}
        onConfirm={() => {
          setClientInstallOpen(false);
          void requestClientInstall();
        }}
        confirmLabel={S.update.clientInstallConfirmAction}
        tone="primary"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.update.clientInstallConfirmBody}
        </p>
      </ConfirmModal>

      <CreateProjectDialog
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={(projectId) => {
          setCreateProjectOpen(false);
          void reloadProjects().then(() => setCurrentProjectId(projectId));
        }}
      />
      {currentProject && (
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
      {/* Rename chat */}
      <Modal
        open={renamingSession !== null}
        title={S.chat.renameSession}
        onClose={() => (renameBusy ? undefined : setRenamingSession(null))}
        footer={
          <>
            <Button onClick={() => setRenamingSession(null)} disabled={renameBusy}>
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={renameBusy || !renameText.trim()}
              onClick={() => void confirmRename()}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          label={S.chat.renameSessionLabel}
          value={renameText}
          error={renameError ?? undefined}
          autoFocus
          maxLength={120}
          onChange={(e) => {
            setRenameText(e.target.value);
            if (renameError) setRenameError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameText.trim() && !renameBusy) void confirmRename();
          }}
        />
      </Modal>

      {/* Messaging binding dialog (row menu "Messaging binding…"): the row indicator
          updates in place from the dialog's own save/unbind outcome. */}
      {messagingSession && (
        <MessagingBindingModal
          sessionId={messagingSession.sessionId}
          onClose={() => setMessagingSession(null)}
          onChanged={(sessionId, channel) => {
            const current = sessions.find((x) => x.sessionId === sessionId);
            if (!current) return;
            const updated = { ...current };
            if (channel !== null) updated.messagingChannel = channel;
            else delete updated.messagingChannel;
            replace(updated);
          }}
        />
      )}

      {/* Rename workspace (alias edit, same Modal + Input idiom as rename chat): the alias
          replaces the directory basename as the group label; leaving it blank reverts to
          the basename — so an empty save is valid here, unlike the chat rename. */}
      <Modal
        open={renamingWorkspace !== null}
        title={S.chat.renameWorkspace}
        onClose={() => setRenamingWorkspace(null)}
        footer={
          <>
            <Button onClick={() => setRenamingWorkspace(null)}>{S.common.cancel}</Button>
            <Button variant="primary" onClick={confirmRenameWorkspace}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          label={S.chat.renameWorkspaceLabel}
          hint={S.chat.renameWorkspaceHint}
          value={workspaceAliasText}
          placeholder={renamingWorkspace ? workspaceLabel(renamingWorkspace.path) : ""}
          autoFocus
          maxLength={80}
          onChange={(e) => setWorkspaceAliasText(e.target.value)}
          onKeyDown={(e) => {
            // isComposing guard (the repo's IME convention, cf. workspace-select.tsx):
            // accepting a Chinese candidate fires Enter, which would save the raw pinyin.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) confirmRenameWorkspace();
          }}
        />
      </Modal>

      {/* Delete chat confirmation (shared ConfirmModal) */}
      <ConfirmModal
        open={deletingSession !== null}
        title={S.chat.deleteSession}
        confirmLabel={S.common.delete}
        busy={deletingBusy}
        onClose={() => (deletingBusy ? undefined : setDeletingSession(null))}
        onConfirm={() => void confirmDeleteSession()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingSession
            ? S.chat.deleteSessionConfirm(deletingSession.title ?? S.chat.defaultSessionTitle)
            : ""}
        </p>
      </ConfirmModal>

      {/* Remove-workspace confirmation (shared ConfirmModal, same stop as the other
          destructive-looking actions): the copy is honest about the scope — sidebar
          registry entry only, disk and Sessions untouched, re-addable anytime. */}
      <ConfirmModal
        open={deletingWorkspace !== null}
        title={S.chat.deleteWorkspace}
        confirmLabel={S.common.delete}
        onClose={() => setDeletingWorkspace(null)}
        onConfirm={confirmDeleteWorkspace}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingWorkspace ? S.chat.deleteWorkspaceConfirm(deletingWorkspace.label) : ""}
        </p>
      </ConfirmModal>

      {/* Delete parked-draft confirmation: purely local (localStorage entry), but the typed
          content is gone for good, which deserves the same explicit stop as a session. */}
      <ConfirmModal
        open={deletingDraft !== null}
        title={S.chat.deleteDraft}
        confirmLabel={S.common.delete}
        onClose={() => setDeletingDraft(null)}
        onConfirm={confirmDeleteDraft}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingDraft
            ? S.chat.deleteDraftConfirm(draftSessionTitle(deletingDraft) || S.chat.draftUntitled)
            : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}

/** Single parked-draft row: first line of the unsent text + hover delete (opening resumes the draft at `/chat/<draft-id>`). */
function DraftRow({
  entry,
  active,
  onOpen,
  onDelete,
}: {
  entry: DraftSessionEntry;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = draftSessionTitle(entry) || S.chat.draftUntitled;
  return (
    <li>
      <div
        // Same truncated-title scroll reveal as the session rows (#309).
        data-title-reveal
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          <Truncated
            scrollReveal
            text={title}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-700 dark:text-gray-300"
            }`}
          />
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            title={S.chat.deleteDraft}
            aria-label={S.chat.deleteDraft}
            onClick={onDelete}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 hover:bg-gray-300/60 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-red-400"
          >
            <Icon
              d="M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6"
              size={14}
            />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * One group's block — its header and body — carrying the manual group order's drop
 * indicator: a thin accent line in the gap the drop would land in, drawn against the
 * WHOLE group rather than its header, so "below" reads as "after this group and its
 * conversations" instead of "between the header and its own first row".
 *
 * The line is absolutely positioned and `inset-x-1` (matching the header's `px-1`), so
 * it consumes no layout width and cannot push the header's up-to-three action buttons
 * out of a narrow drawer.
 */
function GroupBlock({
  dropEdge,
  children,
}: {
  /** Which edge of this group a drop would land on while a group drag hovers it. */
  dropEdge: "above" | "below" | null;
  children: ReactNode;
}) {
  return (
    <div className="relative pt-2.5">
      {dropEdge !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--accent-bg)] ${
            dropEdge === "above" ? "top-1" : "-bottom-1"
          }`}
        />
      )}
      {children}
    </div>
  );
}

/**
 * Group-header pin toggle, shared by both grouping modes: revealed on header hover (or
 * keyboard focus) while unpinned; once pinned it stays visible, doubling as the subtle
 * pinned indicator. The header row carries the `group/header` scope so the reveal only
 * reacts to its own row, not to the session rows' plain `group` scope.
 * The accessible name stays STATIC and aria-pressed alone carries the state (the toggle
 * pattern the grouping-mode buttons use) — a name that swaps Pin/Unpin alongside
 * aria-pressed reads as "Unpin group, pressed", saying the state twice in conflicting
 * ways. The title tooltip may still swap: it is presentation for pointer users and does
 * not feed the accessible name while aria-label is present.
 */
function GroupPinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={pinned ? S.nav.unpinGroup : S.nav.pinGroup}
      aria-label={S.nav.pinGroup}
      aria-pressed={pinned}
      onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${
        pinned
          ? "text-gray-500 dark:text-gray-400"
          : "text-gray-400 opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100 dark:text-gray-500"
      }`}
    >
      <Icon d={PIN_ICON} size={ICON_SIZE.groupHeaderAction} />
    </button>
  );
}

/**
 * Single Session row: title + pinned indicator + status dot/approval badge, and one
 * trailing slot that swaps its content — at rest it shows the compact last-active time,
 * on row hover — or on either of them taking focus — it shows archive and delete as
 * direct icon buttons.
 * That pair is the affordance every release up to v0.2.2 shipped (as icon buttons in
 * exactly this slot), restored here: the 0.3 line had replaced it with an ellipsis
 * dropdown carrying pin / rename / archive / delete, which cost two clicks for the two
 * actions people actually reach for.
 *
 * The rest of the set did not disappear — **right-clicking the row** opens all four as a
 * context menu at the pointer (useRowContextMenu; also Shift+F10 from the keyboard and
 * press-and-hold on touch, since neither hover nor a secondary click exists there). Both
 * panels go through the Dropdown body portal so the sidebar scroller can't clip them, and
 * both read their action set from session-row-menu.tsx.
 *
 * A truncated title scrolls its tail into view while the row is hovered or
 * keyboard-focused (#309; Truncated's scrollReveal + data-title-reveal).
 */
function SessionRow({
  s,
  active,
  activity,
  pinned,
  canPin = false,
  lastActive,
  agentHint,
  draggable = false,
  dropEdge = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onTogglePin,
  onRename,
  onMessaging,
  onDelete,
  onToggleArchive,
}: {
  s: SessionInfo;
  active: boolean;
  /** Busy / settled-read / settled-unread / never-ran, already resolved by sessionRowActivity. */
  activity: SessionActivity;
  /** Row is pinned (bubbled to its group's top; small pin glyph on the title). */
  pinned: boolean;
  /** Whether pinning can actually reorder this row — active-list rows only; folder rows hide the action (see renderRows). */
  canPin?: boolean;
  /** Preformatted compact last-active time ("" hides the slot's resting text). */
  lastActive: string;
  /** Agent display name; when set (workspace mode) a small avatar keeps the Agent context visible on the row. */
  agentHint?: string;
  /** Manual sort: the row can be drag-reordered (the sidebar wires the handlers below). */
  draggable?: boolean;
  /** Drop indicator edge while another row hovers over this one (a thin accent line above/below). */
  dropEdge?: "above" | "below" | null;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: ReactDragEvent) => void;
  onOpen: (s: SessionInfo) => void;
  onTogglePin: (s: SessionInfo) => void;
  onRename: (s: SessionInfo) => void;
  onMessaging: (s: SessionInfo) => void;
  onDelete: (s: SessionInfo) => void;
  onToggleArchive: (s: SessionInfo) => void;
}) {
  const ctx = useRowContextMenu();
  /** Run one action on this Session, closing the context menu first if it was open. */
  const run = (action: SessionRowAction) => {
    ctx.close();
    const handler: Record<SessionRowAction, (x: SessionInfo) => void> = {
      pin: onTogglePin,
      rename: onRename,
      messaging: onMessaging,
      archive: onToggleArchive,
      delete: onDelete,
    };
    handler[action](s);
  };
  /**
   * Menu items hand focus back to the row before acting: the panel unmounts under the
   * user, and the context menu is the only keyboard route to pin and rename, so a
   * Shift+F10 → Enter user would otherwise be dropped onto <body> and lose their place in
   * the list. Actions that open a dialog (rename, delete) take focus from there as usual.
   */
  const runFromMenu = (action: SessionRowAction) => {
    ctx.returnFocus()?.focus();
    run(action);
  };
  const rowState = { archived: s.archived, pinned };
  return (
    <li
      className="relative"
      {...(draggable
        ? { draggable: true, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }
        : {})}
    >
      {/* Manual-drag drop indicator: a thin accent line on the edge the drop would land on (both themes read it against the row gap). */}
      {dropEdge !== null && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-[var(--accent-bg)] ${
            dropEdge === "above" ? "-top-px" : "-bottom-px"
          }`}
        />
      )}
      <div
        // data-title-reveal: hovering the row / keyboard-focusing its button scrolls a
        // truncated title's tail into view (the Truncated below; styles.css #309 rules).
        data-title-reveal
        ref={ctx.rowRef}
        // Right-click / Shift+F10 / press-and-hold open the row's context menu. The
        // native menu is suppressed inside this handler only — the rest of the app keeps
        // the browser's own. select-none keeps a held press from raising the text
        // selection callout on touch instead of the menu.
        {...ctx.rowProps}
        className={`group flex select-none items-center rounded-md pr-1 transition-colors duration-150 ${
          draggable ? "cursor-grab " : ""
        }${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          data-testid="session-row"
          data-session-id={s.sessionId}
          // A press-and-hold that opened the context menu must not also open the Session:
          // touch screens replay the held press as a click once the finger lifts.
          onClick={() => {
            if (ctx.consumeLongPressClick()) return;
            onOpen(s);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          {agentHint !== undefined && (
            <span title={agentHint} className="flex shrink-0 items-center">
              <AgentAvatar id={s.agentId} name={agentHint} size={14} className="rounded" />
              {/* The avatar is aria-hidden and title only serves pointer users: expose the Agent name to keyboard/screen-reader users as visually hidden text inside the row button. */}
              <span className="sr-only">{agentHint}</span>
            </span>
          )}
          {/* Truncated titles reveal their full text on row hover / keyboard focus by
              scrolling the tail into view (#309; scrollReveal, no-op when the title fits).
              The conditional `title` stays as the pointer-hover fallback under
              prefers-reduced-motion — not as a touch path: mobile browsers do not surface
              `title` on long-press. Touch reaches the full text by opening the Session. */}
          <Truncated
            scrollReveal
            text={s.title ?? S.chat.defaultSessionTitle}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : s.archived
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-gray-700 dark:text-gray-300"
            }`}
          />
          {/* Pinned indicator: a dim pin after the title (tooltip + sr text; unpin lives in the row menu). */}
          {pinned && canPin && (
            <span
              title={S.chat.pinnedSession}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <Icon d={PIN_ICON} size={12} />
              <span className="sr-only">{S.chat.pinnedSession}</span>
            </span>
          )}
          {/* Enabled-messaging indicator: one glyph for every channel, the channel named in
              the tooltip and sr text. Same dim treatment as the pin (saved-but-disabled
              configs stay off the row; the binding dialog lives in the row menu). */}
          {s.messagingChannel !== undefined && (
            <span
              title={S.messaging.enabledIndicator[s.messagingChannel]}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <Icon d={MESSAGING_RELAY_ICON} size={12} />
              <span className="sr-only">{S.messaging.enabledIndicator[s.messagingChannel]}</span>
            </span>
          )}
          {/* No per-row source tag: subagent / scheduled Sessions live in their own labelled, collapsed folders, so a badge on the title would just repeat the folder. */}
          <StatusGlyph activity={activity} />
          {s.pendingApprovalCount > 0 && (
            <span title={S.chat.pendingApprovals(s.pendingApprovalCount)}>
              <Badge tone="amber">{s.pendingApprovalCount}</Badge>
            </span>
          )}
        </button>
        {/* Trailing swap slot: resting last-active time / hover-focus archive + delete.
            The buttons form a CONSTANT-width group anchored at the slot's right edge —
            NOT a whole-slot overlay: the slot's width rides the time string (2 分钟前 vs
            31 分钟前), and slot-centered glyphs landed at a different x per row, so the
            icons never formed a vertical column (the user saw them shift with the time's
            character count). Right-anchored, every row's icons share one x. min-w-12
            reserves the pair's own width, so on a row with no time they still don't
            overhang the title. The swap stays a pure opacity handoff: the time hides on
            row hover (group-hover) and while a button holds focus (peer-focus-within; the
            group precedes the time span so the peer combinator can reach it). */}
        <div className="relative flex h-6 min-w-12 shrink-0 items-center justify-end">
          {/* No hover pill on these (a fill as wide as the date read ugly); feedback is
              the glyph color deepening — red for delete. */}
          <div className="peer absolute right-0 top-1/2 flex -translate-y-1/2 items-center">
            <SessionRowHoverActions
              actions={HOVER_ROW_ACTIONS}
              state={rowState}
              onRun={run}
              onMore={ctx.openAt}
            />
          </div>
          {lastActive !== "" && (
            <span
              aria-hidden
              className="pointer-events-none px-1 text-[11px] text-gray-400 transition-opacity duration-150 group-hover:opacity-0 peer-focus-within:opacity-0 dark:text-gray-500"
            >
              {lastActive}
            </span>
          )}
        </div>
        {/* The full set, one right-click away (also Shift+F10 / press-and-hold — see
            useRowContextMenu). `contents` keeps this wrapper out of the row's flex
            layout: it renders no box of its own, the panel is portaled, and the anchor
            is the viewport point the gesture landed on rather than this element. */}
        <Dropdown
          open={ctx.open}
          setOpen={ctx.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={ctx.anchor}
          anchorOwner={ctx.anchorOwner}
          returnFocus={ctx.returnFocus}
          className="contents"
          menuClass="w-36"
          button={null}
        >
          <SessionRowMenuRows
            actions={contextMenuActions(canPin)}
            state={rowState}
            onRun={runFromMenu}
          />
        </Dropdown>
      </div>
    </li>
  );
}

/**
 * Registry-backed workspace group's overflow (… to the right of the header's "+"):
 * 重命名工作区 / 删除工作区 in the session-row menu's compact style. Sits among the
 * header's action buttons — outside the header's collapse toggle, so opening it never
 * expands/collapses the group. Body-portaled like every menu inside the scroller.
 */
function GroupOverflowMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  /** Close first, then act (the rename modal opens on top; the delete is immediate). */
  const item = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-32"
      className="shrink-0"
      button={
        /* No hover pill on this trigger (user: color, not background, should carry the
           hover hint) — feedback is the glyph deepening in light / brightening in dark,
           the session-row ellipsis treatment. Geometry: the same h-7 w-7 square as the
           sibling "+" and the LAST action in the header, flush at GroupHeader's px-1
           inset — which equals the session rows' pr-1, so with the row trigger's 16px
           glyph the dot columns line up with the rows' trailing slot below. */
        <button
          type="button"
          title={S.chat.workspaceMenu}
          aria-label={S.chat.workspaceMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <EllipsisGlyph size={16} />
        </button>
      }
    >
      <button type="button" className={overflowMenuRowClass} onClick={item(onRename)}>
        {overflowMenuGlyph(PENCIL_ICON)}
        {S.chat.renameWorkspace}
      </button>
      <button type="button" className={overflowMenuDangerClass} onClick={item(onDelete)}>
        <span className="shrink-0">
          <Icon d={TRASH_ICON} size={13} />
        </span>
        {S.chat.deleteWorkspace}
      </button>
    </Dropdown>
  );
}

/**
 * List-settings menu option: leading glyph + label, with a checkmark marking the active
 * choice (reference-style radio row; aria-pressed carries the state). Same type scale and
 * leading-glyph column as the session/workspace overflow menus (用户口径: 字体和 Session
 * 更多一样), so the two menus read as one family.
 *
 * The glyph is decorative — it names the option's subject (a folder for Workspace
 * grouping, a clock for recency) beside a label that is never dropped, so the row's
 * accessible name stays the label alone.
 */
function MenuRadioRow({
  icon,
  label,
  checked,
  onSelect,
}: {
  icon: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className={`${overflowMenuRowClass} justify-between`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {overflowMenuGlyph(icon)}
        <span className="truncate">{label}</span>
      </span>
      {checked && <CheckIcon className="shrink-0 text-gray-500 dark:text-gray-400" />}
    </button>
  );
}
