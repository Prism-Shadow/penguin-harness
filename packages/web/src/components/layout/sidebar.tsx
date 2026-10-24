/**
 * Single-column sidebar, top to bottom:
 * Project switcher -> nav: New chat (a draft on the Project's new-chat defaults), always pinned
 * in its fixed slot above the scroll area, then Agents → Evaluation Center. Each page entry is
 * pinned (always shown) or collapsible (folded away by a nav-row-wide chevron button under the
 * collapsible area: arrow up = click to collapse, arrow down while collapsed = the way back);
 * Agents, Models and Plugins are pinned by default, a row's hover pin button or a drag across
 * the areas moves an entry, and both the fold and the pin choices persist in localStorage
 * (nav-group-collapse.ts) -> Session area with three grouping
 * modes (chosen in the section header's list options; the
 * choice and each Project's group collapse and pin state persist in localStorage): by Workspace
 * (the default; groups loaded Sessions by their
 * Workspace path, temporary workspaces merged into one trailing group, header "+" starts a
 * draft in that Workspace), by Agent (group header = Agent name + new chat + Agent settings;
 * shows all Agents, including empty groups), or by time (last day / last month / earlier,
 * bucketed on last activity; the buckets span every Agent, so the paging row sits below them
 * as one Project-wide row). The list holds the user's active conversations only: an archived
 * Session — one the user archived, or one a program opened that nobody kept — is listed on the
 * Settings dialog's archive page, and a subagent Session opens from its parent's Agent panel.
 * Groups can be pinned via the header's hover pin toggle: pinned groups sort before unpinned within
 * their mode, keeping each partition's own order — the time buckets excepted, whose order
 * IS the timeline and which therefore carry no pin. Conversations can be pinned too (row
 * context menu; persisted per Project in
 * localStorage): pinned rows bubble to the top of their group's active list. Each row's
 * trailing slot shows the compact last-active time at rest and swaps to archive + delete
 * icon buttons on hover/focus; the full set (pin, rename, archive, delete) opens as a
 * context menu on right-click, Shift+F10, or a press-and-hold on touch
 * -> bottom user row, which opens the shared account menu (user-menu.tsx).
 * In company mode the shape holds but the objects change: the organization switcher stands
 * where the Project switcher stands, "New channel" where "New chat" is, the organization's
 * six pages in the nav group, and the channel list where the conversation list is, followed
 * by the organization's own 工位 group — one row per employee
 * (features/company/channel-sidebar.tsx, features/company/org-session-groups.tsx). The
 * development list is the user's OWN conversations only: an organization's desk, ticket and
 * sub-sessions are left out of its fetches and totals by the server, and out of every group
 * and bucket here should one still arrive.
 * Desktop keeps it pinned as the left column; mobile puts the whole thing in a drawer.
 * New chats always enter draft state (/chat/new; a group header's "+" names its group's Agent or
 * Workspace in route state): Model / Workspace / approval mode are all chosen on the draft input
 * card, so there's no longer a separate "quick / advanced" pair of new-chat dialogs.
 * The column's look — its frame, page rows, list header, controls and conversation rows — is the
 * UI package's (SidebarFrame, NavRow, SessionRow); this file binds them to the app's state. On the
 * column's muted surface a hover and a selection are washes of the ink (NAV_FILL), and a running
 * status is a small mark, never a block of colour.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { useLocation, useMatch, useNavigate } from "react-router";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Badge,
  Button,
  ConfirmModal,
  Dropdown,
  Fold,
  GlyphIcon,
  GroupHeader,
  ICONS,
  ICON_SIZE,
  Input,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  Modal,
  MoreRow,
  NAV_FILL,
  NavRow,
  SearchInput,
  Segmented,
  SessionRow,
  SidebarAccountButton,
  SidebarControl,
  SidebarFrame,
  SidebarListHeader,
  SidebarNavArea,
  SidebarNavEntry,
  SidebarNavGroup,
  SidebarSwitcherButton,
  SkeletonList,
  UpdateDot,
  UserAvatar,
  toastError,
  toastInfo,
  toastSuccess,
  useArrived,
  type SidebarDropTarget,
} from "@prismshadow/penguin-ui";

import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { formatRelativeShort } from "../../lib/format";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutTitle } from "../../lib/shortcuts/use-keymap";
import {
  sessionActivityLabel,
  sessionBackgroundTasks,
  sessionRowActivity,
  type SessionActivity,
} from "../../lib/session-activity";

import { forgetSession, noteSessionSeen, useSessionSeen } from "../../lib/session-seen";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  SIDEBAR_PAGE_SIZE,
  TIME_LIST_KEY,
  aggregateWorkspaceCounts,
  aggregateWorkspaceLatest,
  clampGroupPage,
  completeWorkspaceGroups,
  cutAtWatermark,
  groupPageCount,
  groupPageOf,
  groupPageSlice,
  groupSessionsByTime,
  groupSessionsByWorkspace,
  isSidebarRow,
  matchesSessionQuery,
  revealPlan,
  revealStep,
  sectionWindow,
  workspaceGroupKey,
  workspaceLabel,
} from "../../lib/session-grouping";
import { machineForSession } from "../../lib/session-machines";
import { backgroundSourceMark } from "../../lib/session-source-mark";
import { nameOnMachine } from "../../lib/workspace-machines";
import {
  initialNavGroupCollapsed,
  initialNavPinOverrides,
  isNavPinned,
  navEntryKeysFor,
  splitNavEntries,
  storeNavGroupCollapsed,
  storeNavPinOverrides,
  withNavPinned,
  type NavEntryKey,
  type NavGroupKey,
} from "../../lib/nav-group-collapse";

import { navPagesOf, useWebAppPages } from "../../web-app";
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
  type WorkspaceEntry,
} from "../../lib/workspace-registry";

import {
  applyManualReorder,
  initialSessionSortMode,
  loadSessionOrder,
  moveInSequence,
  orderSessionRows,
  removeFromSessionOrder,
  saveSessionOrder,
  storeSessionSortMode,
  type SessionSortMode,
} from "../../lib/session-order";

import {
  commitGroupOrder,
  isOrderableGroupMode,
  loadGroupOrder,
  orderGroups,
  saveGroupOrder,
} from "../../lib/group-order";
import {
  CONTEXT_MENU_ACTIONS,
  HOVER_ROW_ACTIONS,
  sessionRowActions,
  type SessionRowAction,
} from "../ui/session-row-menu";
import { NAV_ICONS } from "../../lib/nav-icons";
import {
  GROUP_MODE_ICONS,
  SORT_MODE_ICONS,
  GroupPager,
  Icon,
  initialGroupMode,
  newEntityForGroupMode,
  storeGroupMode,
  type GroupMode,
} from "../ui/group-list";

import { writeClipboard } from "../../lib/clipboard";
import { Truncated } from "../ui/truncated";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { MessagingBindingModal } from "../../features/messaging/messaging-binding-modal";
import { WorkspaceSelect } from "../../features/chat/workspace-select";
import { clearDraft, sessionDraftKey } from "../../features/chat/draft-cache";
import {
  draftSessionTitle,
  removeDraftSession,
  useDraftSessions,
  type DraftSessionEntry,
} from "../../features/chat/draft-sessions";

import { prepareNewChatDraft } from "../../features/chat/new-chat";
import { docksOnScreen, openPanel } from "../../features/dock/dock-state";
import { dockWorkspace } from "../../features/dock/dock-terminal";
import { CreateProjectDialog, ProjectSettingsDialog } from "./project-dialogs";
import { UserMenu } from "./user-menu";
import { PinnedBalanceBadge } from "../../features/models/group-balance";
import { isCurrentPath, renderRouterLink } from "./router-link";
import { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
import { pendingScheduleSessions } from "../../features/schedules/schedule-panel-state";
import { useSchedulesAcross } from "../../features/schedules/schedule-store";
import { useCompany } from "../../state/company";
import { NoOrganizationsSidebar, OrgSwitcher } from "../../features/company/org-switcher";
import { CompanyBetaBadge } from "../../features/company/company-beta";
import { ChannelSidebar } from "../../features/company/channel-sidebar";
import { OrgSessionGroups } from "../../features/company/org-session-groups";
import { COMPANY_NAV_ICONS } from "../../features/company/company-nav-icons";
import { dropsEmployeeGroup, employmentsOf } from "../../features/agents/agent-employment";
import {
  COMPANY_NAV_KEYS,
  isOrgRoute,
  orgPagePath,
  parseOrgKey,
  type WorkMode,
} from "../../lib/company-nav";

/** New-chat pen over a baseline (the pinned "New chat" button and the collapsed rail share it). */
export const NEW_CHAT_ICON = ICONS.penLine;

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

/** Private drag payload type of a nav entry moved between the pinned and collapsible areas (never text/plain, as above). */
const NAV_DRAG_MIME = "application/x-penguin-nav-entry";

/** Is the drag in flight a nav entry of ours? Authorizes a nav drop the way isGroupDrag authorizes a group drop. */
const isNavDrag = (e: ReactDragEvent): boolean => e.dataTransfer.types.includes(NAV_DRAG_MIME);

/** The two nav areas a dragged entry can be dropped into. */
type NavArea = "pinned" | "collapsible";

/** A page entry of the development nav: every entry but New chat, which keeps its fixed slot. */
const isNavPage = (key: NavEntryKey): key is NavGroupKey => key !== "newChat";

/** Manual drag-reordering needs a pointer that can drag (HTML5 DnD never fires from touch) — the outline rail's query. */
const DRAG_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * A group header's trailing action (new chat, Agent settings): a square on the column's hover
 * wash, the subtle glyph deepening under the pointer.
 */
const GROUP_ACTION_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-fg/7 hover:text-fg";

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

/** Collapse-state key of the parked-drafts group ("\0" keeps it clear of Agent ids and Workspace paths). */
const DRAFTS_GROUP_KEY = "\0drafts";

/** Standing "no Session is scheduled", so the first render has something to hold before any answer. */
const NO_SCHEDULED_SESSIONS: ReadonlySet<string> = new Set();

export function Sidebar({
  onNavigate,
  onCollapse,
  initialSearchOpen = false,
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
  /** Mount with the session search open and focused: the search shortcut pressed on the collapsed rail. */
  initialSearchOpen?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, sessionVia } = useAuth();
  const { locale } = useLocale();
  const {
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    setCurrentAgentId,
  } = useProject();
  const {
    sessions: allSessions,
    byAgent: allByAgent,
    countsByAgent,
    workspaceCountsByAgent,
    workspaceLatestActiveByAgent,
    machineLabels,
    machineIds,
    isLoadedFor,
    hasMoreFor,
    activityWatermarkFor,
    loadMoreFor,
    loading,
    remove,
    replace,
  } = useSessions();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  /** The badges over the update and to-do trails (use-update-badges.ts); the avatar's dot follows the update flow's offer / restart states. */
  const badges = useUpdateBadges();
  const company = useCompany();
  /** Company mode swaps the Project switcher, the page nav and the session list for their organization forms. */
  const inCompany = company.workMode === "company";
  /** The organization the company nav points at: the open one, else the one last opened (the switcher names the same). */
  const navOrg = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);

  /**
   * The rows this list renders: the user's OWN active conversations (isSidebarRow). The store
   * also holds rows the chat page handed it for the conversation it shows — an archived
   * Session's stub, a subagent opened from the Agent panel, an organization's desk or ticket
   * Session (`company` Sessions, marked by `orgId` too, and by the durable `client === "org"`
   * stamp that outlives the organization). The store's own fetches already leave all of those
   * out, totals and Workspace stamps included (`category=active`, `excludeOrg`), so the counts
   * below are the list's exact share; this filter is for a row that entered by another door,
   * applied once, at the source, or the dropped row would still conjure the Workspace group,
   * Agent group or time bucket it belongs to. It applies whatever the company-mode switches say:
   * this list is the user's conversations, and a switch about the shell does not turn a
   * scheduler's Session into one.
   */
  const sessions = useMemo(() => allSessions.filter(isSidebarRow), [allSessions]);
  const byAgent = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const [agentId, rows] of allByAgent) map.set(agentId, rows.filter(isSidebarRow));
    return map;
  }, [allByAgent]);

  const currentProjectId = currentProject?.projectId ?? null;
  /** This Project's read markers; re-renders the rows whenever one is stamped. */
  const sessionSeen = useSessionSeen(currentProjectId);
  // The Project's scheduled tasks, shared with the dock's schedules panel through one store, so
  // that neither surface can take the other's answer away. The scope is the Project, not the
  // current Agent: this list draws every Agent's Sessions in every grouping mode, so whether a
  // row wears the mark must not depend on which Agent is current — the chat page moves that to
  // whatever conversation is open, and with a per-Agent list every other Agent's rows lost their
  // marks until the user came back to them. Re-read on every navigation: opening a conversation
  // is the moment a task may just have been created or switched off. Read on every server whose
  // Sessions this list draws: a task bound to a conversation on a machine is that machine's file,
  // and only that machine lists it.
  const projectSchedules = useSchedulesAcross(currentProjectId, machineIds, activeSessionId ?? "");
  // The Sessions wearing the alarm clock: one bound task with a next fire time is enough. The
  // store re-renders these rows on every refresh (a navigation, a schedule event, a turn ending,
  // the panel's poll), and the server recomputes `nextFireAt` on each listing, so a task that
  // fired for the last time loses its mark at the next refresh.
  const pendingScheduled = useMemo(
    () => (projectSchedules === null ? null : pendingScheduleSessions(projectSchedules)),
    [projectSchedules],
  );
  // A null list means "this Project has not been read yet", never "this Project has no tasks":
  // reading it as the second blanks every alarm in the list for as long as a request takes. The
  // marks on screen stand until a real answer replaces them, which is the standing the pin and
  // the relay glyph get for free by being fields of the row itself.
  const lastScheduledRef = useRef<ReadonlySet<string>>(NO_SCHEDULED_SESSIONS);
  useEffect(() => {
    if (pendingScheduled !== null) lastScheduledRef.current = pendingScheduled;
  }, [pendingScheduled]);
  const scheduledSessions = pendingScheduled ?? lastScheduledRef.current;
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
  /** Folded collapsible nav area (company mode: the whole nav group); expanded by default, the choice persists across sessions. */
  const [navCollapsed, setNavCollapsed] = useState(initialNavGroupCollapsed);
  /** The main nav's pages, as the modules contributed them (web-app/page-table.ts). */
  const navPages = navPagesOf(useWebAppPages());
  /** The user's changes to which nav entries are pinned (the defaults live in nav-group-collapse.ts); persisted like the fold. */
  const [navPins, setNavPins] = useState(() => initialNavPinOverrides(navPages));
  /** Nav entry being dragged across the areas, and the area a drop would move it into. */
  const [navDrag, setNavDrag] = useState<NavEntryKey | null>(null);
  const [navDropArea, setNavDropArea] = useState<NavArea | null>(null);
  /**
   * The entry whose pin button takes focus once its row re-mounts in the other area. Moving
   * an entry moves its row to another container, and the button that had focus goes with the
   * old one — a keyboard user would be dropped onto <body>.
   */
  const pinFocusRef = useRef<NavEntryKey | null>(null);
  /** The chevron toggle: where focus goes when the moved row lands in the folded area. */
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  /** Grouping mode of the Session list (Workspace by default; the choice persists across sessions). */
  const [groupMode, setGroupModeState] = useState<GroupMode>(initialGroupMode);
  /** The reader has switched the grouping here: the regrouped list surfaces under the theme's reveal (never on load). */
  const regrouped = useArrived(groupMode);
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
  /** Registered Workspace being renamed (alias edit; null = none) and the alias being typed. The machine is half of which directory this is. */
  const [renamingWorkspace, setRenamingWorkspace] = useState<{
    path: string;
    machineId: string | null;
  } | null>(null);
  const [workspaceAliasText, setWorkspaceAliasText] = useState("");
  /** Registered Workspace pending removal confirmation (null = none); label = the group's displayed name for the confirm copy. */
  const [deletingWorkspace, setDeletingWorkspace] = useState<{
    path: string;
    machineId: string | null;
    label: string;
  } | null>(null);
  /** Live title search: the input's visibility and its query (transient — never persisted). */
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchTitle = useShortcutTitle(S.chat.searchSessions, "sessions.search");
  const newChatTitle = useShortcutTitle(S.chat.newSessionMenu, "chat.new");
  const collapseTitle = useShortcutTitle(S.nav.collapseSidebar, "sidebar.toggle");
  // The sessions.search command: open the field, or put the caret back into an open one. It
  // declines (the browser's own key runs) when the field could not be seen: company mode has
  // no session list, and the pinned sidebar is `display: none` below the `md` breakpoint while
  // still mounted. Re-registered when the field opens or closes so the handler reads the state.
  useEffect(
    () =>
      onCommand("sessions.search", () => {
        if (inCompany) return false;
        if (rootRef.current !== null && rootRef.current.getClientRects().length === 0) return false;
        if (searchOpen) searchInputRef.current?.focus();
        else setSearchOpen(true);
      }),
    [searchOpen, inCompany],
  );
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
  /** Reveal rows with a fetch in flight, keyed by list key (a group, or time mode's whole list) — the row disables and reads "loading" so a page that lands entirely in other groups still visibly did something. */
  const [pendingLoads, setPendingLoads] = useState<ReadonlySet<string>>(new Set());
  /** Per-list display cap (keyed by group key, or TIME_LIST_KEY for time mode's whole list; absent = SIDEBAR_PAGE_SIZE). The list's reveal row raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /** Which PAGE of groups renders (#139: dozens of Agents/Workspaces made the list too tall to scan), 0-based; reset per Project and on a mode switch, and clamped at render to the pages that still exist. */
  const [groupPage, setGroupPage] = useState(0);
  // Project resolved on first load / switched: swap in that Project's persisted collapse/pin
  // sets, row and group orders and registered Workspaces — in the render that sees the switch
  // (React re-renders before committing), not in an effect: an effect runs a commit late, and
  // that commit would draw the new Project's list with the previous Project's groups.
  const [setsFor, setSetsFor] = useState(currentProjectId);
  if (setsFor !== currentProjectId) {
    setSetsFor(currentProjectId);
    setCollapsedGroups(loadGroupSet(collapseStoreKey));
    setPinnedGroups(loadGroupSet(pinStoreKey));
    setPinnedSessions(loadPinnedSessions(currentProjectId));
    setSessionOrder(loadSessionOrder(currentProjectId, groupMode));
    setGroupOrder(loadGroupOrder(currentProjectId, groupMode));
    setRegisteredWorkspaces(loadWorkspaceRegistry(currentProjectId));
    setGroupPage(0);
    // The other Project's groups are gone, and so is any meaning their reveal state had.
    setGroupCaps(new Map());
  }
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

  /**
   * Favourite or unfavourite one nav entry: the star and a drop across the areas both land here.
   * The entry simply takes its place in the other area; the star filling is the whole feedback,
   * with no reveal on the moved row (a de-blur there read as the row flickering).
   */
  const setNavPinned = (key: NavEntryKey, pinned: boolean) => {
    const next = withNavPinned(navPins, key, pinned);
    if (next === navPins) return;
    storeNavPinOverrides(next);
    setNavPins(next);
  };

  /**
   * Drag wiring of one development-mode nav entry: the row is its own handle. Offered only
   * where a pointer that can drag exists (HTML5 drag-and-drop never fires from touch); the
   * pin button is the way everywhere, and the only one there.
   */
  const navEntryDragProps = (key: NavEntryKey) =>
    canDrag
      ? {
          draggable: true,
          onDragStart: (e: ReactDragEvent) => {
            e.dataTransfer.setData(NAV_DRAG_MIME, key);
            e.dataTransfer.effectAllowed = "move";
            setNavDrag(key);
          },
          onDragEnd: () => {
            setNavDrag(null);
            setNavDropArea(null);
          },
        }
      : {};

  /**
   * Drop wiring of one nav area. Only a drag that would move the entry to this side is
   * accepted, so dropping a row back into its own area is not a drop at all; where inside the
   * area it lands is not asked, since both areas keep manifest order.
   */
  const navAreaDrop = (area: NavArea): SidebarDropTarget => ({
    over: navDropArea === area,
    onDragOver: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      if (isNavPinned(navDrag, navPins) === (area === "pinned")) return;
      e.preventDefault();
      // The effect must be one effectAllowed permits, or the drop never fires (groupDragProps).
      e.dataTransfer.dropEffect = "move";
      setNavDropArea(area);
    },
    // Crossing onto one of the area's own rows fires dragleave too; still inside is no change.
    onDragLeave: (e) => {
      const to = e.relatedTarget;
      if (to instanceof Node && e.currentTarget.contains(to)) return;
      setNavDropArea((prev) => (prev === area ? null : prev));
    },
    onDrop: (e) => {
      if (navDrag === null || !isNavDrag(e)) return;
      e.preventDefault();
      setNavPinned(navDrag, area === "pinned");
      setNavDrag(null);
      setNavDropArea(null);
    },
  });

  /** Workspace-mode per-group exact server totals (folded from the per-Agent per-Workspace counts). */
  const workspaceGroupCounts = useMemo(
    () => aggregateWorkspaceCounts(workspaceCountsByAgent),
    [workspaceCountsByAgent],
  );

  /**
   * Workspace-mode per-group newest-active-Session stamps (folded the same way): a group's
   * recency before any of its rows are loaded. Active only, like the rows a group shows: an
   * archived Session — a scheduled task's run, say — does not move the group it is not in.
   */
  const workspaceGroupLatest = useMemo(
    () => aggregateWorkspaceLatest(workspaceLatestActiveByAgent),
    [workspaceLatestActiveByAgent],
  );

  /**
   * Workspace groups (workspace mode): the loaded rows' groups, completed with every
   * Workspace the server's counts know (empty until their rows page in — the initial load
   * is each Agent's ten newest conversations, which touch only a few of dozens of
   * Workspaces), by recency with the temp group last, plus the manually-added Workspaces
   * as empty groups behind them (newest registration first).
   */
  const workspaceGroups = useMemo(
    () =>
      mergeRegisteredWorkspaces(
        completeWorkspaceGroups(
          // A Workspace is a directory on a machine: rows from two machines that share a path
          // string are two groups, and the "+" of each opens a chat on its own machine.
          groupSessionsByWorkspace(sessions, (s) => machineForSession(s.sessionId)),
          workspaceGroupCounts,
          workspaceGroupLatest,
        ),
        registeredWorkspaces,
      ),
    [sessions, workspaceGroupCounts, workspaceGroupLatest, registeredWorkspaces],
  );

  /**
   * The Agents that get a group: every Agent but an organization's employee with no
   * development conversation of its own in this list (agent-employment.ts). Its desk and
   * ticket sessions are company mode's and never counted here, so its group would only ever
   * be empty; it comes back the moment a development conversation with it exists. The
   * server's active total is raised by the loaded rows, which include a conversation created
   * since the counts were taken.
   */
  const groupAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          !dropsEmployeeGroup(
            agent,
            Math.max(
              countsByAgent.get(agent.agentId)?.active ?? 0,
              byAgent.get(agent.agentId)?.length ?? 0,
            ),
          ),
      ),
    [agents, countsByAgent, byAgent],
  );

  // Pinned groups first within each mode, then the manual drag order within each pin
  // partition. Nothing dragged yet = an empty order = the automatic sort untouched (recency
  // for Workspace groups with the temp group last, the configured Agent order for Agents),
  // which is also what a group with no stored place falls back to.
  // The stored array belongs to the mode it was loaded for: handing an Agent list an
  // order of Workspace keys is a no-op only as long as the two key namespaces cannot
  // collide, and it costs the empty-order fast path on every render of the other mode.
  const orderedAgents = useMemo(
    () =>
      orderGroups(groupAgents, (a) => a.agentId, {
        pinned: pinnedGroups,
        order: groupMode === "agent" ? groupOrder : [],
      }),
    [groupAgents, pinnedGroups, groupOrder, groupMode],
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

  /** Collapse/expand a group. */
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
   * Time mode's loaded rows, through the search. Deliberately NOT memoized — the bucket
   * boundary is `Date.now()`, and a memo would freeze it at its last dependency change; the
   * compact relative timestamps rendered beside these rows are recomputed every render for
   * exactly the same reason. Null outside time mode, so no other mode pays for the pass.
   */
  const timeRows = groupMode === "time" ? filterRows(sessions) : null;

  /** Agents holding active rows anywhere in this Project — time mode's fetch fan-out (the counts are kept in step locally, so they cover freshly added rows too). */
  const projectActiveAgents = [...countsByAgent]
    .filter(([, counts]) => counts.active > 0)
    .map(([agentId]) => agentId);

  /**
   * Time mode's rows, cut at the list's watermark BEFORE bucketing. Every Agent (on every
   * machine) pages its own stream, so only the rows above the most recent cursor that still
   * has more are a true prefix of the Project's activity order; the rows below it stay in
   * memory until a reveal fetches past it. That is what makes the list grow only at its bottom —
   * a fetched page can no longer land rows in "Last day" above an "Earlier" the user is
   * reading. A search sees every loaded row (a hidden match would read as no match), and the
   * open conversation always shows.
   */
  const timeVisible =
    timeRows === null
      ? []
      : cutAtWatermark(
          timeRows,
          searching ? null : activityWatermarkFor(projectActiveAgents),
          activeSessionId,
        );
  const timeGroups = timeRows === null ? [] : groupSessionsByTime(timeVisible, Date.now());

  /** Agents with an unfetched page left: the streams time mode's reveal row pages, all at once. */
  const timeMoreAgents = projectActiveAgents.filter((id) => hasMoreFor(id));

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
        ? timeRows !== null && timeRows.length > 0
        : orderedWorkspaceGroups.some((g) => filterRows(g.sessions).length > 0));

  /**
   * The server stream a group's fetches walk: its own, under Workspace grouping, or the
   * Agent's whole one otherwise. Only Workspace groups need their own — an Agent group IS
   * the whole stream, and time mode's list pages every Agent's whole stream at once (a
   * bucket is cut from rows that are already loaded, so it fetches nothing of its own).
   *
   * This is what makes the groups independent. Sharing one per-Agent cursor meant a group's
   * "load more" consumed the page its siblings were about to read: their rows appeared,
   * their reveal counts moved, and the group that asked could grow by less than a page — or
   * by nothing at all.
   */
  const fetchScope = (groupKey: string): string | undefined =>
    groupMode === "workspace" ? groupKey : undefined;

  /** loadMoreFor with an in-flight marker for the triggering reveal row (disable + loading text). */
  const trackedLoadMore = (groupKey: string, agentIds: string[]) => {
    setPendingLoads((prev) => new Set(prev).add(groupKey));
    void loadMoreFor(agentIds, fetchScope(groupKey)).finally(() => {
      setPendingLoads((prev) => {
        const next = new Set(prev);
        next.delete(groupKey);
        return next;
      });
    });
  };

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
   *
   * The ask is marked in flight like a reveal click (pendingLoads), for two reasons: a group
   * the counts know but no page has loaded rows of starts out empty, and its body must read
   * as loading rather than as having no conversations; and the marker is what keeps this
   * effect from asking twice — every landed page changes the group list and re-runs it, and
   * an in-flight pair is still unloaded, so a second request would start its cursor over and
   * the group would later skip a page.
   */
  useEffect(() => {
    if (groupMode !== "workspace" || searching) return;
    for (const group of groupPageSlice(orderedWorkspaceGroups, shownGroupPage)) {
      const counts = workspaceGroupCounts.get(group.key);
      const total = counts?.totals.active ?? 0;
      const agents = [
        ...new Set([...(counts?.agents.active ?? []), ...group.sessions.map((s) => s.agentId)]),
      ];
      // Counts not in yet (0): nothing is known to be missing, so nothing is asked for. What
      // the group SHOWS is what a first page has to fill: rows in memory below its watermark
      // (another Agent's stream reached further) are not on screen.
      const loaded = cutAtWatermark(group.sessions, activityWatermarkFor(agents, group.key)).length;
      if (loaded >= Math.min(SIDEBAR_PAGE_SIZE, total)) continue;
      const unloaded = agents.filter((id) => !isLoadedFor(id, group.key));
      if (unloaded.length === 0) continue;
      const key = group.key;
      if (pendingLoads.has(key)) continue;
      setPendingLoads((prev) => new Set(prev).add(key));
      void loadMoreFor(unloaded, group.key).finally(() => {
        setPendingLoads((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
    }
  }, [
    groupMode,
    searching,
    orderedWorkspaceGroups,
    shownGroupPage,
    workspaceGroupCounts,
    isLoadedFor,
    activityWatermarkFor,
    loadMoreFor,
    pendingLoads,
  ]);

  /**
   * Archive: persists immediately and moves the row out of the list in place (fails silently;
   * the next list refresh self-corrects). Archiving the conversation on screen leaves it for a
   * new chat, as the New chat button does — it is filed away, not something to read on; only
   * its URL, opened again later, shows the archived stub.
   */
  const archiveSession = async (s: SessionInfo) => {
    try {
      const res = await api.patchSession(s.sessionId, { archived: true });
      // Leave first, so the page never paints the stub for the row it is about to drop.
      if (activeSessionId === s.sessionId) newChat();
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
      // fall back to the chat home page. Only a conversation of this list is auto-opened —
      // never an archived one (filed away — landing there would look like the chat vanished
      // into thin air), the rule latestConversation follows.
      if (activeSessionId === target.sessionId) {
        const rest = (byAgent.get(target.agentId) ?? []).filter(
          (s) => s.sessionId !== target.sessionId,
        );
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
   * created when the first message is sent. Route state carries only what the clicked entry
   * is about: the agent-mode group header's "+" names that group's Agent, the workspace-mode
   * group header's "+" names that group's Workspace path ("" = a temporary workspace), and the
   * pinned "New chat" and the header's create button name nothing. Every field left unnamed
   * starts on the Project's new-chat defaults, then the built-in fallback (new-chat.ts).
   */
  const newChat = ({
    agentId,
    workspace,
    machineId,
    browseFiles,
  }: { agentId?: string; workspace?: string; machineId?: string; browseFiles?: boolean } = {}) => {
    // Typed-but-unsent text in the ACTIVE new-chat draft becomes a parked draft
    // conversation first (a row in the list below, sendable anytime — draft-sessions.ts),
    // so this click always lands on an empty composer and never silently shelves content;
    // the selections a text-less earlier visit left behind are released with it.
    if (user && currentProjectId) prepareNewChatDraft(user.userId, currentProjectId);
    if (agentId) setCurrentAgentId(agentId);
    const state = {
      ...(agentId ? { agentId } : {}),
      // The machine travels WITH the path, always — including its absence. A path names a
      // different directory on every machine, so handing the composer one without the other
      // is handing it a directory it cannot find.
      ...(workspace !== undefined ? { workspace, machineId } : {}),
      // The chat page opens the dock's Files panel on arrival (a group's "Browse files").
      ...(browseFiles === true ? { browseFiles } : {}),
    };
    navigate(`/chat/${DRAFT_SESSION_ID}`, Object.keys(state).length > 0 ? { state } : undefined);
    onNavigate?.();
  };

  /**
   * A Workspace group's "Browse files": the dock's Files panel on that directory. A page already
   * on it — the open conversation's Workspace, or the folder the draft picked, on the same
   * machine — only brings the panel up. Anywhere else lands on a new-chat draft for the folder,
   * the group's "+", whose Files panel is addressed by the directory itself: the dock belongs to
   * the conversation on screen, so a folder another conversation is in has no panel here.
   */
  const browseFiles = (path: string, machineId: string | null) => {
    const here = dockWorkspace();
    if (docksOnScreen() && here !== null && here.path === path && here.machineId === machineId) {
      openPanel("workspace");
      onNavigate?.();
      return;
    }
    newChat({ workspace: path, ...(machineId ? { machineId } : {}), browseFiles: true });
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
    const key = workspaceGroupKey(path, machineId ?? null);
    const existing = orderedWorkspaceGroups.findIndex((g) => g.key === key);
    setGroupPage(groupPageOf(existing >= 0 ? existing : orderedWorkspaceGroups.length));
  };

  /**
   * The ssh alias of a group's machine, or null for this server's own groups — what a name
   * is qualified with. An unlabelled machine (the list is admin-only, and a machine can also
   * drop out of the ssh config) falls back to its id: honest, where inventing a name is not.
   */
  const machineNameOf = (machineId: string | null): string | null =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);

  /** Registered Workspaces by GROUP key — only their groups offer the rename/remove overflow. */
  const registeredKeys = useMemo(
    () => new Set(registeredWorkspaces.map((e) => workspaceGroupKey(e.path, e.machineId ?? null))),
    [registeredWorkspaces],
  );

  /** Open the alias editor pre-filled with the current alias ("" = following the basename). */
  const openRenameWorkspace = (path: string, machineId: string | null) => {
    setWorkspaceAliasText(
      registeredWorkspaces.find((e) => e.path === path && (e.machineId ?? null) === machineId)
        ?.alias ?? "",
    );
    setRenamingWorkspace({ path, machineId });
  };

  /** Commit the alias (blank reverts the label to the directory basename). Direct save — no server, nothing destructive. */
  const confirmRenameWorkspace = () => {
    if (!renamingWorkspace) return;
    applyRegistryChange(
      setWorkspaceAlias(
        registeredWorkspaces,
        renamingWorkspace.path,
        renamingWorkspace.machineId,
        workspaceAliasText,
      ),
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
    applyRegistryChange(
      unregisterWorkspace(
        registeredWorkspaces,
        deletingWorkspace.path,
        deletingWorkspace.machineId,
      ),
    );
    setDeletingWorkspace(null);
  };

  const openSession = (s: SessionInfo) => {
    // Opening is what "read" means here: stamp the marker before navigating.
    noteSessionSeen(currentProjectId, s.sessionId, s.lastActiveAt);
    // Cross-group click: the current Agent follows this Session's own Agent.
    setCurrentAgentId(s.agentId);
    go(`/chat/${s.sessionId}`);
  };

  /**
   * The mode switch: company mode enters at `/org` (the organization last opened, else the
   * first); development mode keeps whatever conversation is open and only leaves an
   * organization page, which has no development form.
   */
  const switchMode = (mode: WorkMode) => {
    if (mode === company.workMode) return;
    company.setWorkMode(mode);
    if (mode === "company") go("/org");
    else if (isOrgRoute(location.pathname)) go("/chat");
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
    /** Manual sort only: the drag scope (group key) plus the group's FULL ordered list — the drop must commit every loaded row of the partition, not the display-capped slice the user happens to see. */
    dragCtx?: { scope: string; fullRows: SessionInfo[] },
  ) => (
    <ul className="space-y-px">
      {rows.map((s) => {
        // Manual-sort drag wiring (never while searching — a filtered view is not the real
        // order). A drop stays within its own scope AND its own pin partition: dragging can
        // reorder but never pin or unpin.
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
          <SidebarSessionRow
            key={s.sessionId}
            s={s}
            active={s.sessionId === activeSessionId}
            // Busy / settled / read / never-ran, decided in one place (session-activity.ts) so
            // the whole transition sequence is testable without a DOM.
            activity={sessionRowActivity(s, sessionSeen, activeSessionId)}
            background={sessionBackgroundTasks(s)}
            scheduled={scheduledSessions.has(s.sessionId)}
            pinned={pinnedSessions.has(s.sessionId)}
            // Last ACTIVITY, not creation: the server stamps lastActiveAt when a run
            // starts and again when it ends, so a running row shows its run-start time
            // (it recedes while the run continues — the hourglass beside it is what says
            // "active right now"). CLI-adopted and subagent rows are not
            // driven by this server, so theirs stays at createdAt.
            lastActive={formatRelativeShort(s.lastActiveAt, locale)}
            locale={locale}
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
            onArchive={(x) => void archiveSession(x)}
          />
        );
      })}
    </ul>
  );

  /**
   * "Show N more chats" on one list (a group, or time mode's whole list): one page more on
   * screen, and a fetch of the next server page only when that page runs past the rows
   * already loaded (revealStep). A list whose next page is already in memory spends no
   * request — in workspace mode a fetch fans out to every Agent contributing to the group and
   * its rows may land in other groups entirely, so a pointless one is not free. `agents` is
   * the list's fetch fan-out, and `canFetch` whether any of their streams still holds rows.
   */
  const showMore = (
    listKey: string,
    agents: string[],
    { shown, loaded, canFetch }: { shown: number; loaded: number; canFetch: boolean },
  ) => {
    const cap = groupCaps.get(listKey) ?? SIDEBAR_PAGE_SIZE;
    const step = revealStep({ cap, shown, loaded, canFetch });
    setGroupCaps((prev) => new Map(prev).set(listKey, step.cap));
    if (step.fetch) trackedLoadMore(listKey, agents);
  };

  /** "Show less": drop one list's reveal back to the first page (rows already fetched stay in memory). */
  const collapseRows = (listKey: string) => {
    setGroupCaps((prev) => {
      if (!prev.has(listKey)) return prev;
      const next = new Map(prev);
      next.delete(listKey);
      return next;
    });
  };

  /**
   * The one reveal row of a list, "Show N more chats" with N what the list still hides, and
   * its "Show less". Both can stand at once: a list revealed part-way still has more to show
   * AND something to fold back.
   */
  const renderRevealRows = (
    listKey: string,
    plan: { hidden: number; canCollapse: boolean },
    onMore: () => void,
  ) => (
    <>
      {plan.hidden > 0 && (
        <MoreRow
          label={S.chat.expandRestSessions(plan.hidden)}
          ariaLabel={S.chat.expandRestSessions(plan.hidden)}
          pending={pendingLoads.has(listKey)}
          onClick={onMore}
          className="mt-0.5"
        />
      )}
      {plan.canCollapse && (
        <MoreRow
          label={S.chat.showLess}
          ariaLabel={S.chat.showLess}
          onClick={() => collapseRows(listKey)}
          {...(plan.hidden > 0 ? {} : { className: "mt-0.5" })}
        />
      )}
    </>
  );

  /** One list's rows in display order: the pinned cluster first, then the sort mode within each pin partition. */
  const orderRows = (rows: SessionInfo[]) =>
    orderSessionRows(rows, (s) => s.sessionId, {
      pinned: pinnedSessions,
      sortMode: effectiveSortMode,
      order: sessionOrder,
      recencyOf: (s) => s.lastActiveAt,
    });

  /**
   * Expanded body of an Agent or Workspace group: the group's conversations, display-capped,
   * and its reveal row. `total` is the group's exact server share of active rows and
   * `activeAgents` the Agents that may hold one — its fetch fan-out set.
   */
  const renderGroupBody = (
    groupKey: string,
    rows: SessionInfo[],
    withAgentHint: boolean,
    total: number | undefined,
    activeAgents: string[],
  ) => {
    // Row order: the pinned cluster first, then — under manual sort — the stored order
    // within each pin partition (lib/session-order.ts). Both reorder only rows already
    // FETCHED: a pinned conversation that lives past the loaded pages does not surface
    // until the reveal row pulls its page in (the list has no server-side pin), so the
    // pinned cluster leads what is loaded, not the Agent's whole history.
    // While searching, the display cap is bypassed — every loaded match shows, and the
    // reveal row hides (it pages the unfiltered list and would read as "more matches",
    // which the server cannot promise).
    //
    // Before any of that, the rows are cut at the group's watermark: an Agent group on
    // several machines and a Workspace group spanning Agents both merge several streams,
    // and only the rows above the most recent cursor that still has more are a true prefix
    // of the group's activity order. The rest wait in memory, so a reveal only ever adds
    // rows below the ones on screen. A search sees every loaded row.
    const visibleActive = cutAtWatermark(
      rows,
      searching || activeAgents.length === 0
        ? null
        : activityWatermarkFor(activeAgents, fetchScope(groupKey)),
      activeSessionId,
    );
    const orderedActive = orderRows(visibleActive);
    /** Manual sort only (never on a search-filtered view): drag scope + the group's full ordered list, so a drop commits the whole partition. */
    const dragCtx =
      effectiveSortMode === "manual" && !searching
        ? { scope: groupKey, fullRows: orderedActive }
        : undefined;
    // The reveal row counts THIS group's own hidden conversations and nothing else — no other
    // group's numbers reach it. `fullyLoaded` says the group's whole active share is already in
    // memory (no Agent that could hold a row of it has more to serve), which is when the
    // loaded rows become the truth: server counts refresh only on reload, so a count drifting
    // above reality would otherwise leave a row that reveals nothing behind it.
    const canFetch = activeAgents.some((id) => hasMoreFor(id, fetchScope(groupKey)));
    // One page of rows at a time, what the reveal row still hides, and whether "Show less"
    // has anything to fold away: the single rule revealPlan states.
    const plan = revealPlan({
      cap: groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE,
      loaded: visibleActive.length,
      total: total ?? 0,
      fullyLoaded: activeAgents.length > 0 && !canFetch,
    });
    const shownActive = searching ? orderedActive : orderedActive.slice(0, plan.shown);
    const hiddenActive = searching ? 0 : plan.hidden;
    const empty = visibleActive.length === 0;
    const activePending = pendingLoads.has(groupKey);
    // Rows the server counts that no page has loaded yet — a Workspace group known from
    // the counts alone while its own first page is on its way (or, after a failed fetch,
    // waiting on the reveal row below to be asked for again). Not "no conversations".
    const awaitingRows = !searching && visibleActive.length === 0 && hiddenActive > 0;
    return (
      <>
        {empty ? (
          loading || (awaitingRows && activePending) ? (
            // The same window the chat pane's skeleton covers: the Agent groups render as
            // soon as the Agents arrive, but the session pages are still being fetched —
            // "no Sessions yet" is not the honest answer until they land.
            <SkeletonList rows={2} />
          ) : awaitingRows ? null : (
            <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.noSessions}
            </p>
          )
        ) : (
          // Drag-reorder is offered under manual sort, and never on a search-filtered view.
          renderRows(shownActive, withAgentHint, dragCtx)
        )}

        {!searching &&
          renderRevealRows(groupKey, plan, () =>
            showMore(groupKey, activeAgents, {
              shown: plan.shown,
              loaded: visibleActive.length,
              canFetch,
            }),
          )}
      </>
    );
  };

  /**
   * Time mode's list: the buckets, then the list's one reveal row. The buckets are stretches of
   * ONE activity-ordered list, not lists of their own: no bucket can know how many of its rows
   * the server still holds (the counts are per Agent, not per time span), and a fetch lands its
   * rows below the last one shown, in whichever bucket their activity puts them. So the window,
   * the count and the reveal row belong to the list (sectionWindow): N is the Project's exact
   * active total — the sum of the Agents' totals, the numbers the Agent groups count from —
   * minus the rows on screen and those behind a folded bucket. Each bucket's rows are ordered
   * as a group orders its own (pins first, then the sort mode) before the window is cut. A
   * search shows every loaded match and no reveal row.
   */
  const renderTimeList = () => {
    const ordered = timeGroups.map((group) => orderRows(group.sessions));
    const timeWindow = sectionWindow({
      sections: timeGroups.map((group, i) => ({
        rows: ordered[i] ?? [],
        folded: collapsedGroups.has(group.key),
      })),
      cap: groupCaps.get(TIME_LIST_KEY) ?? SIDEBAR_PAGE_SIZE,
      total: projectActiveAgents.reduce((sum, id) => sum + (countsByAgent.get(id)?.active ?? 0), 0),
      fullyLoaded: projectActiveAgents.length > 0 && timeMoreAgents.length === 0,
    });
    const shown = searching ? ordered : timeWindow.rows;
    return (
      <>
        {timeGroups.map((group, i) => {
          const rows = shown[i];
          // Past the window's edge: not drawn, the reveal row below counts its rows.
          if (rows === null || rows === undefined) return null;
          const collapsed = !searching && collapsedGroups.has(group.key);
          /** Manual sort only: a drop commits the bucket's whole ordered partition, not the windowed slice. */
          const dragCtx =
            effectiveSortMode === "manual" && !searching
              ? { scope: group.key, fullRows: ordered[i] ?? [] }
              : undefined;
          return (
            <div key={group.key} className="pt-2.5">
              <GroupHeader
                open={!collapsed}
                onToggle={() => toggleGroup(group.key)}
                glyph={GROUP_MODE_ICONS.time}
                label={S.chat.timeGroups[group.bucket]}
                uppercase
                count={group.sessions.length}
              />
              <Fold open={!collapsed}>{() => renderRows(rows, true, dragCtx)}</Fold>
            </div>
          );
        })}

        {/* Nothing loaded: "no conversations" only when the counts agree; rows the server
            counts but no page holds yet wait on the reveal row below instead. */}
        {timeGroups.length === 0 &&
          !searching &&
          (timeWindow.hidden === 0 ? (
            <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.noSessions}
            </p>
          ) : pendingLoads.has(TIME_LIST_KEY) ? (
            <SkeletonList rows={2} />
          ) : null)}

        {!searching &&
          renderRevealRows(TIME_LIST_KEY, timeWindow, () =>
            showMore(TIME_LIST_KEY, timeMoreAgents, {
              shown: timeWindow.shown,
              loaded: timeWindow.reachable,
              canFetch: timeMoreAgents.length > 0,
            }),
          )}
      </>
    );
  };

  /**
   * Company mode's nav rows: the organization's six pages (COMPANY_NAV_KEYS) — channels are not
   * among them, they are the list below — all in the fold, with no pins and no drag. Always
   * mounted — the fold animates their height to zero and turns them inert.
   */
  const companyNavItems: Array<{
    key: string;
    /** Where the row leads — null for a row with nowhere to lead, which renders disabled. */
    to: string | null;
    label: string;
    icon: string;
  }> = inCompany
    ? COMPANY_NAV_KEYS.map((key) => ({
        key,
        // Company mode with no organization keeps its six rows and disables them: the pages
        // exist, they just have no organization to show yet, and a nav that empties itself
        // reads as a broken shell rather than as an empty one.
        to: navOrg === null ? null : orgPagePath(navOrg.projectId, navOrg.orgId, key),
        label: S.nav.org[key],
        icon: COMPANY_NAV_ICONS[key],
      }))
    : [];

  /**
   * Development mode's entries by area (nav-group-collapse.ts): New chat, then the main
   * nav's pages minus the entries this user's role cannot reach, each pinned or
   * collapsible, both areas in page order. New chat is always pinned and renders in its
   * fixed slot above the scroll area, so the pinned rows here are the pages after it.
   */
  const navSplit = splitNavEntries(navEntryKeysFor(navPages, user?.isAdmin === true), navPins);
  const pinnedNavPages = navSplit.pinned.filter(isNavPage);
  const collapsibleNavPages = navSplit.collapsible.filter(isNavPage);

  /**
   * One development-mode page entry: the package's pinnable nav row, bound to its route, its
   * badge trail, its pin choice and its drag. Four entries sit on a badge trail — Agents (an
   * outdated kernel, fixed on the Agent settings page two clicks down), Plugins, Models and the
   * Cost Center (each cleared on the page itself). The row's own label is visible, so the hint
   * only adds what the dot means, and the accessible name keeps the label as its prefix. The dot
   * hangs at the row's right edge, vertically centred on the row.
   */
  const renderNavEntry = (key: NavGroupKey) => {
    const to = `/${key}`;
    const label = S.nav[key];
    const note = navNoteFor(badges, to);
    const pinned = isNavPinned(key, navPins);
    return (
      <SidebarNavEntry
        key={key}
        label={label}
        glyph={NAV_ICONS[key]}
        href={to}
        active={isCurrentPath(to, location.pathname)}
        renderLink={renderRouterLink}
        onClick={() => onNavigate?.()}
        {...navEntryDragProps(key)}
        pin={{
          pinned,
          label: S.nav.pinEntry,
          tooltip: pinned ? S.nav.unpinEntry : S.nav.pinEntry,
          onToggle: (e) => {
            // A keyboard toggle follows its row into the other area (see pinFocusRef). A row
            // that lands in the folded area is not on screen: the chevron that unfolds it is the
            // nearest place to stand, read once the move has committed, since the commit may be
            // mounting the chevron itself.
            if (e.currentTarget.matches(":focus-visible")) {
              if (pinned && navCollapsed) {
                requestAnimationFrame(() => navToggleRef.current?.focus());
              } else {
                pinFocusRef.current = key;
              }
            }
            setNavPinned(key, !pinned);
          },
          buttonRef: (el) => {
            if (el === null || pinFocusRef.current !== key) return;
            pinFocusRef.current = null;
            el.focus();
            // A row that lands in an area still folding away is inert and cannot take focus:
            // the chevron again, once this commit is done.
            if (document.activeElement !== el) {
              queueMicrotask(() => navToggleRef.current?.focus());
            }
          },
        }}
        {...(note !== null
          ? {
              ariaLabel: `${label} · ${note}`,
              tooltip: note,
              badge: <UpdateDot size="inline" position="right-2.5 top-1/2 -translate-y-1/2" />,
            }
          : {})}
      />
    );
  };

  /**
   * The account row at the column's foot: the trigger for the account menu both this sidebar and
   * the collapsed rail open (user-menu.tsx).
   */
  const accountRow = (
    <UserMenu
      menuClass="bottom-full left-0 right-0 mb-1 origin-bottom"
      trigger={({ open, toggle }) => (
        <SidebarAccountButton
          expanded={open}
          onClick={toggle}
          // The dot alone is mysterious: name what is waiting on the trigger (hover tooltip +
          // accessible name), in the App info row's own wording.
          {...(badges.softwareNote !== null
            ? {
                hint: badges.softwareNote,
                label: `${user?.displayName ?? user?.userId ?? ""} · ${badges.softwareNote}`,
              }
            : {})}
          avatar={
            <UserAvatar
              userId={user?.userId ?? "?"}
              {...(user?.displayName !== undefined ? { displayName: user.displayName } : {})}
              {...(user?.avatar !== undefined ? { avatar: user.avatar } : {})}
            >
              {/* Update reminder: the menu behind this trigger holds the row that acts on it,
                  and the trigger's tooltip/label above say what it is. */}
              {badges.software !== null && <UpdateDot />}
            </UserAvatar>
          }
          name={user?.displayName ?? user?.userId}
          trailing={<PinnedBalanceBadge />}
          {...(user?.isAdmin ? { role: S.auth.admin } : {})}
        />
      )}
    />
  );

  /** The dialogs the column's rows and menus open, mounted after the column. */
  const dialogs = (
    <>
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
            <Button size="sm" onClick={() => setRenamingSession(null)} disabled={renameBusy}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
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
          size="sm"
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
            <Button size="sm" onClick={() => setRenamingWorkspace(null)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" onClick={confirmRenameWorkspace}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
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
        cancelLabel={S.common.cancel}
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
        cancelLabel={S.common.cancel}
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
        cancelLabel={S.common.cancel}
        onClose={() => setDeletingDraft(null)}
        onConfirm={confirmDeleteDraft}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingDraft
            ? S.chat.deleteDraftConfirm(draftSessionTitle(deletingDraft) || S.chat.draftUntitled)
            : ""}
        </p>
      </ConfirmModal>
    </>
  );

  return (
    <SidebarFrame
      rootRef={rootRef}
      // The page nav and the Session list are one find-in-page region (components/find/).
      findRegion="sessions"
      // The work-mode switch, above the Project switcher: 开发 | 公司. Rendered only while
      // company mode is available (the admin master switch and the user's own switch both on);
      // the choice persists per user. The 内测版 tag rides on 公司 — the switch is the one
      // control that names the mode, so the mark stands on the word it qualifies rather than
      // somewhere inside the mode it describes.
      {...(company.available
        ? {
            modeSwitch: {
              label: S.company.workMode,
              control: (
                <Segmented
                  options={[
                    { value: "dev" as const, label: S.company.modeDev },
                    {
                      value: "company" as const,
                      label: S.company.modeCompany,
                      badge: { node: <CompanyBetaBadge />, name: S.company.beta },
                    },
                  ]}
                  value={company.workMode}
                  onChange={switchMode}
                  cols={2}
                />
              ),
            },
          }
        : {})}
      {...(onCollapse
        ? {
            collapse: { label: S.nav.collapseSidebar, tooltip: collapseTitle, onClick: onCollapse },
          }
        : {})}
      switcher={
        // The Project switcher; the organization switcher in company mode.
        inCompany ? (
          <OrgSwitcher {...(onNavigate ? { onNavigate } : {})} />
        ) : (
          <Dropdown
            open={projectOpen}
            setOpen={setProjectOpen}
            className="min-w-0 flex-1"
            menuClass="left-0 right-0 top-full mt-1 origin-top"
            button={
              <SidebarSwitcherButton
                label={currentProject ? projectDisplayName(currentProject) : S.common.loading}
                onClick={() => setProjectOpen(!projectOpen)}
              />
            }
          >
            {/* Plain rows rather than a role="menu": the switcher's Project rows are named
                like its trigger, and both are reached as buttons. */}
            {projects.map((p) => (
              <MenuRadioItem
                key={p.projectId}
                label={<span className="font-sans">{projectDisplayName(p)}</span>}
                trailing={<Badge>{p.role}</Badge>}
                checked={p.projectId === currentProject?.projectId}
                onSelect={() => {
                  setCurrentProjectId(p.projectId);
                  setProjectOpen(false);
                }}
              />
            ))}
            <MenuSeparator />
            <MenuItem
              glyph={ICONS.plus}
              label={S.project.create}
              onSelect={() => {
                setProjectOpen(false);
                setCreateProjectOpen(true);
              }}
            />
            {currentProject && (
              <MenuItem
                glyph={ICONS.gear}
                label={S.project.settings}
                onSelect={() => {
                  setProjectOpen(false);
                  setProjectSettingsOpen(true);
                }}
              />
            )}
          </Dropdown>
        )
      }
      // New chat: always pinned, in the one slot between the switcher above and the scroll area
      // below; it has no pin button and cannot be dragged. A page row like the nav's (no fill at
      // rest), told apart by its place and its weight, and lit while on the draft page. Its slot
      // belongs to the pinned area, so it also takes an entry dragged out of the collapsible
      // one. Company mode pins nothing here: a channel is made rarely, so "New channel" is the
      // channel list's own header action rather than a permanent row (channel-sidebar.tsx).
      {...(inCompany
        ? {}
        : {
            pinned: (
              <SidebarNavArea drop={navAreaDrop("pinned")}>
                <NavRow
                  surface="muted"
                  label={S.chat.newSessionMenu}
                  tooltip={newChatTitle}
                  // The title adds the shortcut when one is bound.
                  tooltipExtra={newChatTitle !== S.chat.newSessionMenu}
                  glyph={NEW_CHAT_ICON}
                  active={activeSessionId === DRAFT_SESSION_ID}
                  onClick={() => newChat()}
                  className="font-medium"
                />
              </SidebarNavArea>
            ),
          })}
      account={accountRow}
      overlays={dialogs}
    >
      {/* The page nav: in development mode the pinned pages, then the collapsible ones folded
          away under the slim toggle (with nothing collapsible there is no toggle); in company
          mode the organization's six pages, all under the toggle. The fold persists. Folding
          rows tween their height to zero, inert, and leave once folded. The nav and the session
          list scroll together. Mid-drag, an empty pinned run keeps a row's height and a hidden
          toggle band comes back, so either side can take the drop. */}
      <SidebarNavGroup
        collapsed={navCollapsed}
        onToggle={toggleNavGroup}
        expandLabel={S.nav.expandGroup}
        collapseLabel={S.nav.collapseGroup}
        toggleRef={navToggleRef}
        {...(inCompany
          ? {}
          : {
              pinned:
                pinnedNavPages.length > 0 || navDrag !== null ? (
                  <SidebarNavArea
                    drop={navAreaDrop("pinned")}
                    reserve={pinnedNavPages.length === 0}
                  >
                    {pinnedNavPages.map(renderNavEntry)}
                  </SidebarNavArea>
                ) : undefined,
              foldable: collapsibleNavPages.length > 0 || navDrag !== null,
              drop: navAreaDrop("collapsible"),
            })}
      >
        {inCompany
          ? companyNavItems.map((item) => (
              /* A row with nowhere to go keeps its place and its glyph, muted, with nothing to
                 click or tab to. */
              <NavRow
                key={item.key}
                surface="muted"
                label={item.label}
                glyph={item.icon}
                href={item.to ?? ""}
                disabled={item.to === null}
                active={item.to !== null && isCurrentPath(item.to, location.pathname)}
                renderLink={renderRouterLink}
                onClick={() => onNavigate?.()}
              />
            ))
          : collapsibleNavPages.map(renderNavEntry)}
      </SidebarNavGroup>

      {inCompany ? (
        navOrg !== null ? (
          /* Company mode: the organization's channels, where development mode lists
             conversations, and below them its 工位 group — one row per employee's desk. */
          <>
            <ChannelSidebar
              projectId={navOrg.projectId}
              orgId={navOrg.orgId}
              {...(onNavigate ? { onNavigate } : {})}
            />
            <OrgSessionGroups
              projectId={navOrg.projectId}
              orgId={navOrg.orgId}
              activeSessionId={activeSessionId}
              {...(onNavigate ? { onNavigate } : {})}
            />
          </>
        ) : (
          /* No organization to list: the create block, not an empty channel list. */
          <NoOrganizationsSidebar {...(onNavigate ? { onNavigate } : {})} />
        )
      ) : (
        <>
          {/* The list's header: its label and the controls (icon + tooltip family) — search, list
              settings (grouping + sort radios), and the mode-dependent create button (the created
              object follows the grouping mode). The search opens in place, over the label's
              column, so it costs no extra row; the magnifier becomes the field's leading glyph.
              No ruled separator at this boundary — the nav toggle above is the seam. The label
              names the grouping: workspaces, agents, or the recent ones by time. */}
          <SidebarListHeader label={S.chat.sessionListByMode[groupMode]} searching={searchOpen}>
            {searchOpen ? (
              /* Expanded field: the magnifier, the input and the clear ×, one bordered
             box filling the row (its width rides the column tween). Esc and × both
             collapse it and drop the filter, which is why the × stays while it is empty. */
              <SearchInput
                ref={searchInputRef}
                icon
                alwaysClearable
                autoFocus
                className="min-w-0 flex-1"
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={closeSearch}
                placeholder={S.chat.searchSessionsPlaceholder}
                aria-label={S.chat.searchSessions}
                clearLabel={S.chat.searchClear}
              />
            ) : (
              <SidebarControl
                label={S.chat.searchSessions}
                tooltip={searchTitle}
                glyph={ICONS.search}
                onClick={() => setSearchOpen(true)}
              />
            )}
            <Dropdown
              open={listSettingsOpen}
              setOpen={setListSettingsOpen}
              portal={{ direction: "down", align: "right" }}
              menuClass="w-40"
              button={
                <SidebarControl
                  label={S.chat.listSettings}
                  glyph={ICONS.slidersHorizontal}
                  active={listSettingsOpen}
                  aria-haspopup="menu"
                  aria-expanded={listSettingsOpen}
                  onClick={() => setListSettingsOpen(!listSettingsOpen)}
                />
              }
            >
              <Menu density="sm">
                <MenuLabel>{S.chat.groupModeSection}</MenuLabel>
                <MenuRadioItem
                  glyph={GROUP_MODE_ICONS.workspace}
                  label={S.chat.groupByWorkspace}
                  checked={groupMode === "workspace"}
                  onSelect={() => {
                    setGroupMode("workspace");
                    setListSettingsOpen(false);
                  }}
                />
                <MenuRadioItem
                  glyph={GROUP_MODE_ICONS.agent}
                  label={S.chat.groupByAgent}
                  checked={groupMode === "agent"}
                  onSelect={() => {
                    setGroupMode("agent");
                    setListSettingsOpen(false);
                  }}
                />
                <MenuRadioItem
                  glyph={GROUP_MODE_ICONS.time}
                  label={S.chat.groupByTime}
                  checked={groupMode === "time"}
                  onSelect={() => {
                    setGroupMode("time");
                    setListSettingsOpen(false);
                  }}
                />
                <MenuSeparator />
                <MenuLabel>{S.chat.sortModeSection}</MenuLabel>
                {/* Manual order is offered only where a drag can actually happen (see canDrag). */}
                {canDrag && (
                  <MenuRadioItem
                    glyph={SORT_MODE_ICONS.manual}
                    label={S.chat.sortManual}
                    checked={sortMode === "manual"}
                    onSelect={() => {
                      setSortMode("manual");
                      setListSettingsOpen(false);
                    }}
                  />
                )}
                <MenuRadioItem
                  glyph={SORT_MODE_ICONS.recent}
                  label={S.chat.sortRecent}
                  checked={sortMode === "recent"}
                  onSelect={() => {
                    setSortMode("recent");
                    setListSettingsOpen(false);
                  }}
                />
              </Menu>
            </Dropdown>
            {/* Mode-dependent create — what gets created follows the grouping mode, and the
            icon follows suit (the folder with a plus, the robot with a plus badge):
            agent grouping opens the Agents page's existing create dialog (route
            state); workspace grouping opens the SAME directory-browse menu the
            draft's workspace picker uses — the picked directory registers as a
            workspace group immediately, Sessions or not. Time buckets are not
            something to create into, so that mode starts a plain new conversation
            and wears the compose glyph without a plus badge. */}
            {newEntity === "agent" ? (
              <SidebarControl
                label={newEntityLabel}
                glyph={<GlyphIcon d={ICONS.robotPlus} size={ICON_SIZE.iconButton} />}
                onClick={() => {
                  navigate("/agents", { state: { create: true } });
                  onNavigate?.();
                }}
              />
            ) : newEntity === "chat" ? (
              <SidebarControl
                label={newEntityLabel}
                glyph={<GlyphIcon d={NEW_CHAT_ICON} size={ICON_SIZE.iconButton} />}
                onClick={() => newChat()}
              />
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
                clearable={false}
                trigger={(open, toggle) => (
                  <SidebarControl
                    label={newEntityLabel}
                    glyph={<GlyphIcon d={ICONS.folderPlus} size={ICON_SIZE.iconButton} />}
                    active={open}
                    aria-expanded={open}
                    onClick={toggle}
                  />
                )}
              />
            )}
          </SidebarListHeader>

          {/* Parked draft conversations (unsent new chats, newest first): pinned above both
          grouping modes — they belong to no Agent or Workspace until sent. Hidden
          entirely while there are none; the search filter applies to their titles too. */}
          {shownDrafts.length > 0 && (
            <div className="pt-2.5">
              <GroupHeader
                open={searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)}
                onToggle={() => toggleGroup(DRAFTS_GROUP_KEY)}
                glyph={NEW_CHAT_ICON}
                label={S.chat.draftGroup}
                uppercase
                count={shownDrafts.length}
              />
              <Fold open={searching || !collapsedGroups.has(DRAFTS_GROUP_KEY)}>
                <ul className="space-y-px">
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
              </Fold>
            </div>
          )}

          {/* The grouped list, one piece per grouping: a switch of the grouping remounts it, and
              the regrouped list surfaces as a whole under the theme's reveal. */}
          <div key={groupMode} {...(regrouped ? { "data-reveal": true } : {})}>
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
                  const collapsed = !searching && collapsedGroups.has(agent.agentId);
                  const pinned = pinnedGroups.has(agent.agentId);
                  const drag = groupDragProps(agent.agentId, agentGroupSequence);
                  /** An organization's employee says so in its header's tooltip. */
                  const employments = employmentsOf(agent);
                  const employeeNote =
                    employments.length === 0 ? null : S.agent.employeeMark(employments);
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
                        {...(employeeNote === null ? {} : { title: employeeNote })}
                        actions={
                          <>
                            <GroupPinButton
                              pinned={pinned}
                              onToggle={() => togglePin(agent.agentId)}
                            />
                            {/* New chat: enters draft state directly with this group's Agent (all options live on the draft input card) */}
                            <button
                              type="button"
                              data-tooltip={S.chat.newSessionMenu}
                              aria-label={S.chat.newSessionMenu}
                              onClick={() => newChat({ agentId: agent.agentId })}
                              className={GROUP_ACTION_CLASS}
                            >
                              <Icon d={ICONS.plus} size={ICON_SIZE.groupHeaderAction} />
                            </button>
                            <button
                              type="button"
                              data-tooltip={S.agent.settings}
                              aria-label={S.agent.settings}
                              onClick={() => go(`/agents/${agent.agentId}`)}
                              className={GROUP_ACTION_CLASS}
                            >
                              <Icon d={ICONS.gear} size={ICON_SIZE.groupHeaderAction} />
                            </button>
                          </>
                        }
                      />

                      <Fold open={!collapsed}>
                        {() =>
                          renderGroupBody(
                            agent.agentId,
                            groupRows,
                            false,
                            countsByAgent.get(agent.agentId)?.active,
                            [agent.agentId],
                          )
                        }
                      </Fold>
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
                const collapsed = !searching && collapsedGroups.has(group.key);
                const pinned = pinnedGroups.has(group.key);
                /** Header tooltip: the full Workspace path, named on its machine. */
                const qualifiedPath =
                  group.fullPath !== null
                    ? nameOnMachine(group.fullPath, machineNameOf(group.machineId))
                    : null;
                const drag = groupDragProps(group.key, workspaceGroupSequence);
                /** This group's exact server share (per-Workspace fold) and its fetch fan-out. */
                const counts = workspaceGroupCounts.get(group.key);
                /** Read once so the registry actions below keep the narrowing (null = the merged temp group, which has no single path). */
                const fullPath = group.fullPath;
                /** The ssh alias qualifying this group's names, or null when it is on this server. */
                const machineName = machineNameOf(group.machineId);
                const activeAgents = [
                  ...new Set([
                    ...(counts?.agents.active ?? []),
                    ...group.sessions.map((s) => s.agentId),
                  ]),
                ];
                return (
                  <GroupBlock key={group.key} dropEdge={drag.dropEdge}>
                    {/* Group header: collapse toggle (folder icon + directory basename + count, full
                  path in the tooltip; the count = the group's conversations, exact server share,
                  loaded rows win a disagreement) + pin + new chat in this Workspace; also the
                  group's drag handle. */}
                    <GroupHeader
                      {...drag.header}
                      open={!collapsed}
                      onToggle={() => toggleGroup(group.key)}
                      // The folder opens and closes with the group.
                      glyph={collapsed ? ICONS.folder : ICONS.folderOpen}
                      label={group.temp ? S.chat.tempWorkspaces : group.label}
                      // The machine stays readable however narrow the column: two machines'
                      // groups can share a name, and the machine is what tells them apart.
                      {...(machineName !== null
                        ? { qualifier: S.chat.machineTag(machineName) }
                        : {})}
                      count={
                        searching
                          ? groupRows.length
                          : Math.max(counts?.totals.active ?? 0, groupRows.length)
                      }
                      {...(qualifiedPath !== null ? { title: qualifiedPath } : {})}
                      actions={
                        <>
                          <GroupPinButton pinned={pinned} onToggle={() => togglePin(group.key)} />
                          {/* New chat in this Workspace: pre-fills the group's path in the draft ("" = temporary workspace); the Agent is the Project's new-chat default, like any other new chat */}
                          <button
                            type="button"
                            data-tooltip={S.chat.newSessionInWorkspace}
                            aria-label={S.chat.newSessionInWorkspace}
                            onClick={() =>
                              newChat({
                                workspace: fullPath ?? "",
                                // The machine travels with the path: this group's rows live on it,
                                // and the same path here is a different directory (or none).
                                ...(group.machineId ? { machineId: group.machineId } : {}),
                              })
                            }
                            className={GROUP_ACTION_CLASS}
                          >
                            <Icon d={ICONS.plus} size={ICON_SIZE.groupHeaderAction} />
                          </button>
                          {/* A group that is one directory (not the merged temporary group):
                              the overflow right of the "+" — browse its files, and, for a
                              manually-added (registry-backed) Workspace, rename the alias or
                              remove it from the sidebar (session-derived groups have no
                              registry entry for those two to act on). */}
                          {fullPath !== null && (
                            <GroupOverflowMenu
                              onBrowse={() => browseFiles(fullPath, group.machineId)}
                              {...(registeredKeys.has(group.key)
                                ? {
                                    onRename: () => openRenameWorkspace(fullPath, group.machineId),
                                    onDelete: () =>
                                      setDeletingWorkspace({
                                        path: fullPath,
                                        machineId: group.machineId,
                                        label: group.label,
                                      }),
                                  }
                                : {})}
                            />
                          )}
                        </>
                      }
                    />

                    {/* A workspace group can span Agents: the group body fans its reveal out to the
                  Agents whose share of THIS group is non-zero (plus the Agents already
                  contributing loaded rows). */}
                    <Fold open={!collapsed}>
                      {() =>
                        renderGroupBody(
                          group.key,
                          groupRows,
                          true,
                          counts?.totals.active,
                          activeAgents,
                        )
                      }
                    </Fold>
                  </GroupBlock>
                );
              })
            )}
            {groupMode === "workspace" ? groupPagerRow() : null}

            {/* Time mode: last day / last month / earlier, bucketed on each conversation's last
                activity — the same stamp the rows' compact timestamps and the recency sort
                read, so a row can never sit under a bucket its own timestamp contradicts.
                Empty buckets are dropped, and there are at most three, so this mode never
                paginates its groups. */}
            {groupMode !== "time" || timeRows === null ? null : loading && sessions.length === 0 ? (
              <SkeletonList rows={5} />
            ) : (
              renderTimeList()
            )}
          </div>

          {/* Quiet no-match line: the search is live and nothing — drafts included — hit. */}
          {searching && !hasSearchMatches && (
            <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.searchNoMatches}
            </p>
          )}
        </>
      )}
    </SidebarFrame>
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
          active ? NAV_FILL.selected : NAV_FILL.hover
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
            // The conversation rows' inks (SessionRow), so a parked draft reads as one of them.
            className={`min-w-0 flex-1 font-sans text-sm ${
              active ? "font-medium text-fg" : "text-fg/80"
            }`}
          />
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            data-tooltip={S.chat.deleteDraft}
            aria-label={S.chat.deleteDraft}
            onClick={onDelete}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-gray-300/60 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-gray-700 dark:hover:text-red-400"
          >
            <Icon d={ICONS.trash} size={14} />
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
          className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent ${
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
      data-tooltip={pinned ? S.nav.unpinGroup : S.nav.pinGroup}
      aria-label={S.nav.pinGroup}
      aria-pressed={pinned}
      onClick={onToggle}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-[opacity,background-color,color] duration-150 hover:bg-fg/7 hover:text-fg ${
        pinned
          ? "text-fg-muted"
          : "text-fg-subtle opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100"
      }`}
    >
      <Icon d={ICONS.pin} size={ICON_SIZE.groupHeaderAction} />
    </button>
  );
}

/**
 * One conversation row: the package's `SessionRow`, bound to this Session. The row itself — the
 * title with its marks, the trailing slot that swaps the last-active time for archive and the
 * "more" button on hover or focus, and the context menu a right-click, Shift+F10 or a
 * press-and-hold opens — is the package's; this container says which actions each surface
 * carries (session-row-menu.tsx), what each one does, and in which words the marks name
 * themselves.
 *
 * The hover pair is the affordance every release up to v0.2.2 shipped (archive as a direct icon
 * button), the rest of the set one click further; the full set stays one right-click away.
 *
 * A truncated title scrolls its tail into view while the row is hovered or keyboard-focused
 * (#309; Truncated's scrollReveal, keyed on the row's `data-title-reveal`). No `title` tooltip
 * comes with it: it would sit over the very text scrolling past underneath. Under
 * prefers-reduced-motion nothing scrolls and the conditional hint returns instead.
 */
function SidebarSessionRow({
  s,
  active,
  activity,
  background,
  scheduled,
  pinned,
  lastActive,
  locale,
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
  onArchive,
}: {
  s: SessionInfo;
  active: boolean;
  /** Busy / settled-read / settled-unread / never-ran, already resolved by sessionRowActivity. */
  activity: SessionActivity;
  /** Background tasks the Session still owns (sessionBackgroundTasks); 0 draws no mark. */
  background: number;
  /** A scheduled task still to fire is bound to this Session (pendingScheduleSessions); false draws no mark. */
  scheduled: boolean;
  /** Row is pinned (bubbled to its group's top; small pin glyph on the title). */
  pinned: boolean;
  /** Preformatted compact last-active time ("" hides the slot's resting text). */
  lastActive: string;
  /** Interface language: decides the fixed width the time slot reserves (SessionRow's `timeSlot`). */
  locale: "zh" | "en";
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
  onArchive: (s: SessionInfo) => void;
}) {
  /** Run one action on this Session (the row has closed its menu first). */
  const run = (action: SessionRowAction) => {
    const handler: Record<SessionRowAction, (x: SessionInfo) => void> = {
      pin: onTogglePin,
      rename: onRename,
      // The copy affordance's feedback normally rides on the button itself (copy-button.tsx),
      // which a menu row cannot do: the row acts and the panel closes under it. A toast is
      // the confirmation that survives that, and it says the same word — once the write
      // has landed.
      copy: (x) => {
        void writeClipboard(x.sessionId).then((ok) => ok && toastSuccess(S.common.copied));
      },
      messaging: onMessaging,
      archive: onArchive,
      delete: onDelete,
    };
    handler[action](s);
  };
  const rowState = { pinned };
  return (
    <SessionRow
      sessionId={s.sessionId}
      renderTitle={(className) => (
        <Truncated
          scrollReveal
          text={s.title ?? S.chat.defaultSessionTitle}
          className={className}
        />
      )}
      active={active}
      {...(agentHint !== undefined ? { agent: { id: s.agentId, name: agentHint } } : {})}
      // The marks for the row's STANDING arrangements, all in one dim cluster: which program
      // opened it (a Session the user kept after a program opened it), how the row is filed
      // (pinned), where it can be reached from (the messaging relay, named by its channel),
      // whether it runs on its own (a scheduled task still to fire; a paused or ended one draws
      // nothing) and whether it owns work that outlives the turn (background tasks, live via
      // session_background).
      {...(backgroundSourceMark(s) ?? {})}
      {...(pinned ? { pinnedLabel: S.chat.pinnedSession } : {})}
      {...(s.messagingChannel !== undefined
        ? { relayLabel: S.messaging.enabledIndicator[s.messagingChannel] }
        : {})}
      {...(scheduled ? { scheduledLabel: S.chat.sessionScheduled } : {})}
      background={{ count: background, label: S.chat.backgroundTasks(background) }}
      activity={
        activity === null ? null : { state: activity, label: sessionActivityLabel(activity) }
      }
      approvals={{
        count: s.pendingApprovalCount,
        label: S.chat.pendingApprovals(s.pendingApprovalCount),
      }}
      time={lastActive}
      // Sized for the widest compact time each language produces — 「12月31日」 and 「59 分钟前」 in
      // zh, "Nov 30" in en.
      timeSlot={locale === "zh" ? "wide" : "narrow"}
      hoverActions={sessionRowActions(HOVER_ROW_ACTIONS, rowState, run)}
      menuActions={sessionRowActions(CONTEXT_MENU_ACTIONS, rowState, run)}
      moreLabel={S.chat.moreActions}
      onOpen={() => onOpen(s)}
      draggable={draggable}
      dropEdge={dropEdge}
      {...(onDragStart ? { onDragStart } : {})}
      {...(onDragEnd ? { onDragEnd } : {})}
      {...(onDragOver ? { onDragOver } : {})}
      {...(onDragLeave ? { onDragLeave } : {})}
      {...(onDrop ? { onDrop } : {})}
    />
  );
}

/**
 * A workspace group's overflow (… to the right of the header's "+"): 打开文件浏览, then — for a
 * registry-backed group — 重命名工作区 / 删除工作区, as small Menu rows like the session row's
 * menu. Sits among the header's action buttons — outside the header's collapse toggle, so
 * opening it never expands/collapses the group. Body-portaled like every menu inside the
 * scroller.
 */
function GroupOverflowMenu({
  onBrowse,
  onRename,
  onDelete,
}: {
  onBrowse: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
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
      menuClass="w-max min-w-32"
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
          data-tooltip={S.chat.workspaceMenu}
          aria-label={S.chat.workspaceMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
        >
          {/* Filled: the stroked dots read too faint at this size. */}
          <GlyphIcon d={ICONS.ellipsis} size={16} filled />
        </button>
      }
    >
      <Menu density="sm">
        <MenuItem
          glyph={ICONS.folderOpen}
          label={S.chat.browseWorkspaceFiles}
          onSelect={item(onBrowse)}
        />
        {onRename !== undefined && (
          <MenuItem glyph={ICONS.pencil} label={S.chat.renameWorkspace} onSelect={item(onRename)} />
        )}
        {onDelete !== undefined && (
          <MenuItem
            glyph={ICONS.trash}
            label={S.chat.deleteWorkspace}
            danger
            onSelect={item(onDelete)}
          />
        )}
      </Menu>
    </Dropdown>
  );
}
