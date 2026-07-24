/**
 * Single-column sidebar, top to bottom:
 * Project switcher -> new chat (default_agent draft) + fixed nav (Agents / models / cost center /
 * Trace) -> Session area with two grouping modes (a small toggle in the section header; the
 * choice and each Project's group collapse and pin state persist in localStorage): by Workspace
 * (the default; groups loaded Sessions by their
 * Workspace path, auto temp directories merged into one trailing group, header "+" starts a
 * draft in that Workspace) or by Agent (group header = Agent name + new chat + Agent settings;
 * shows all Agents, including empty groups). Groups can be pinned via the header's hover pin
 * toggle: pinned groups sort before unpinned within their mode, keeping each partition's own
 * order -> bottom user config (theme / language / logout).
 * Desktop keeps it pinned as the left column; mobile puts the whole thing in a drawer.
 * New chats always enter draft state (/chat/new, route state specifies the Agent and optionally
 * the Workspace): Model / Workspace / approval mode are all chosen on the draft input card, so
 * there's no longer a separate "quick / advanced" pair of new-chat dialogs.
 * Color scheme is white/gray-based: active state uses a solid gray fill, running status uses a small color dot, no large blocks of color.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useMatch, useNavigate } from "react-router";
import type { SessionInfo, SessionSource } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import type { LangPref } from "../../state/locale";
import { ACCENT_SWATCHES, useTheme } from "../../state/theme";
import type { Accent, Currency, FontScale, ThemeMode } from "../../state/theme";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  SIDEBAR_PAGE_SIZE,
  groupAgentsWithMore,
  groupSessionsByWorkspace,
  partitionSessions,
  pinnedFirst,
  workspaceGroupKey,
} from "../../lib/session-grouping";
import type { SessionPartition } from "../../lib/session-grouping";
import { Dropdown } from "../ui/dropdown";
import { AgentAvatar } from "../ui/agent-avatar";
import { Chevron } from "../ui/chevron";
import { ChevronDown } from "../ui/icons";
import { toastError } from "../ui/toast";
import { Truncated } from "../ui/truncated";
import { Badge } from "../ui/badge";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { SkeletonList } from "../ui/skeleton";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { clearDraft, sessionDraftKey } from "../../features/chat/draft-cache";
import { CreateProjectDialog, ProjectSettingsDialog } from "./project-dialogs";
import { ChangePasswordDialog } from "../account/change-password-dialog";

function Icon({ d, size = 16 }: { d: string; size?: number }) {
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

/** Page-nav glyphs (shared with the collapsed rail in app-layout.tsx). */
export const NAV_ICONS = {
  agents: "M12 3v3m-6 4a6 6 0 0 1 12 0v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5zm3 3h.01M15 13h.01",
  /** Skill library (an open book: two pages + spine). */
  skills: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  models: "M7 7h10v10H7zM4 10h3m10 0h3M4 14h3m10 0h3M10 4v3m4-3v3m-4 10v3m4-3v3",
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  traces: "M4 6h16M4 12h10M4 18h13",
  /** Benchmark center (a trophy: cup + two handles + base). */
  benchmark:
    "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
} as const;

/** New-chat pencil (the pinned "New chat" button and the collapsed rail share it). */
export const NEW_CHAT_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";

/** Standard gear (lucide settings): full tooth outline + center circle, crisp and undistorted at 16px. */
const GEAR_ICON =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";

/** Folder outline, closed (same glyph as the draft page's Workspace pill); collapsed workspace groups and the grouping toggle use it. */
const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z";

/** Folder outline, open (lucide folder-open: back panel + tilted front flap); expanded workspace groups use it. */
const FOLDER_OPEN_ICON =
  "m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2";

/** Pushpin (lucide pin: head + body + stem), the group-header pin toggle / pinned indicator. */
const PIN_ICON =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z";

const menuItemClass =
  "block w-full px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

/** Grouping mode of the Session list (persisted; Workspace is the default). */
type GroupMode = "workspace" | "agent";
const GROUP_MODE_KEY = "penguin.sidebarGroupMode";
function initialGroupMode(): GroupMode {
  return localStorage.getItem(GROUP_MODE_KEY) === "agent" ? "agent" : "workspace";
}

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
 * Open-state key of a per-origin folder (subagent / scheduled) inside a group: each folder
 * has its own state. "\0" never appears in Agent ids or Workspace paths, so the composite
 * never collides across groups or with plain group keys.
 */
const sourceFolderKey = (groupKey: string, source: SessionSource) => `${source}\0${groupKey}`;

/** Session status dot: running pulses green, compacting shows an amber dot; idle shows nothing. */
function StatusDot({ session }: { session: SessionInfo }) {
  if (session.status === "running") {
    return (
      <span
        title={S.chat.statusRunning}
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
      />
    );
  }
  if (session.status === "compacting") {
    return (
      <span
        title={S.chat.statusCompacting}
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
      />
    );
  }
  return null;
}

export function Sidebar({
  onNavigate,
  onCollapse,
}: {
  onNavigate?: () => void;
  onCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { mode, setMode, fontScale, setFontScale, accent, setAccent, currency, setCurrency } =
    useTheme();
  const { lang, setLang } = useLocale();
  const {
    projects,
    currentProject,
    setCurrentProjectId,
    reloadProjects,
    agents,
    currentAgent,
    setCurrentAgentId,
  } = useProject();
  const { sessions, byAgent, hasMoreByAgent, loadMoreFor, loading, remove, replace } =
    useSessions();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const currentProjectId = currentProject?.projectId ?? null;
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
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
  // Project resolved on first load / switched: swap in that Project's persisted collapse/pin sets.
  useEffect(() => {
    setCollapsedGroups(loadGroupSet(collapseStoreKey));
    setPinnedGroups(loadGroupSet(pinStoreKey));
  }, [collapseStoreKey, pinStoreKey]);
  /** Expanded "archived" groups (collapsed by default), keyed like collapsedGroups. */
  const [openArchived, setOpenArchived] = useState<ReadonlySet<string>>(new Set());
  /** Expanded per-origin folders (subagent / scheduled Sessions; collapsed by default), keyed by sourceFolderKey — each folder has its own open state. */
  const [openSourceFolders, setOpenSourceFolders] = useState<ReadonlySet<string>>(new Set());
  /** Per-group display cap for active rows (keyed by group key; absent = SIDEBAR_PAGE_SIZE). "More" raises it a page at a time. */
  const [groupCaps, setGroupCaps] = useState<ReadonlyMap<string, number>>(new Map());
  /** Session pending delete confirmation (null = none). */
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  /** Session currently being renamed (null = none) and the title being typed. */
  const [renamingSession, setRenamingSession] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const setGroupMode = (mode: GroupMode) => {
    localStorage.setItem(GROUP_MODE_KEY, mode);
    setGroupModeState(mode);
  };

  /** Workspace groups (workspace mode): computed from the flat list, temp directories merged last. */
  const workspaceGroups = useMemo(() => groupSessionsByWorkspace(sessions), [sessions]);

  // Pinned groups first within each mode; inside each partition the existing order is kept
  // (recency for Workspace groups, the configured Agent order for Agents).
  const orderedAgents = useMemo(
    () => pinnedFirst(agents, (a) => a.agentId, pinnedGroups),
    [agents, pinnedGroups],
  );
  const orderedWorkspaceGroups = useMemo(
    () => pinnedFirst(workspaceGroups, (g) => g.key, pinnedGroups),
    [workspaceGroups, pinnedGroups],
  );

  /** Group key of a Session under the current mode (collapse / archived-open state). */
  const sessionGroupKey = (s: SessionInfo) =>
    groupMode === "agent" ? s.agentId : workspaceGroupKey(s.workspace);

  const toggleGroup = (key: string) => {
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

  const toggleArchivedGroup = (key: string) =>
    setOpenArchived((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleSourceFolder = (groupKey: string, source: SessionSource) =>
    setOpenSourceFolders((prev) => {
      const key = sourceFolderKey(groupKey, source);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
    if (!s || !s.source || s.archived) return;
    const guard = `${groupMode}\0${activeSessionId}`;
    if (lastAutoExpandedRef.current === guard) return;
    lastAutoExpandedRef.current = guard;
    const groupKey = groupMode === "agent" ? s.agentId : workspaceGroupKey(s.workspace);
    const key = sourceFolderKey(groupKey, s.source);
    setOpenSourceFolders((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [activeSessionId, sessions, groupMode]);

  /** Archive / unarchive: persists immediately and updates in place (fails silently; the next list refresh self-corrects). */
  const toggleArchive = async (s: SessionInfo) => {
    // Archiving the currently open chat: expand the "archived" group so it doesn't silently vanish from the sidebar with no way back.
    if (!s.archived && s.sessionId === activeSessionId) {
      setOpenArchived((prev) => new Set(prev).add(sessionGroupKey(s)));
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
      setRenameError(e instanceof ApiError ? e.message : S.common.unknownError);
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
      remove(target.sessionId);
      // The session is gone, so clear its input draft too (no orphaned keys left in localStorage; keys are scoped per user, #68).
      if (user) clearDraft(sessionDraftKey(user.userId, target.sessionId));
      setDeletingSession(null);
      // The deleted session was the one open: jump to another **unarchived** Session in the same
      // group, otherwise fall back to the chat home page (never jump into an archived session —
      // it's hidden by default, so landing there would look like the chat vanished into thin air).
      if (activeSessionId === target.sessionId) {
        const rest = (byAgent.get(target.agentId) ?? []).filter(
          (s) => s.sessionId !== target.sessionId && !s.archived,
        );
        navigate(rest[0] ? `/chat/${rest[0].sessionId}` : "/chat");
      }
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : S.common.unknownError);
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
   * ("" = the auto temp directory), pre-filling the draft's Workspace selection the same way.
   */
  const newChat = (agentId?: string, workspace?: string) => {
    if (agentId) setCurrentAgentId(agentId);
    const state = {
      ...(agentId ? { agentId } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
    };
    navigate(`/chat/${DRAFT_SESSION_ID}`, Object.keys(state).length > 0 ? { state } : undefined);
    onNavigate?.();
  };

  /** Target of the menu's "New chat": default_agent, falling back to the first Agent (if the list isn't ready yet, resolution is deferred to the draft page). */
  const defaultAgentId = (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;

  /** A Session always needs an Agent, so the workspace-mode "+" uses the current Agent, falling back to default_agent. */
  const workspaceNewChatAgentId = currentAgent?.agentId ?? defaultAgentId;

  const openSession = (s: SessionInfo) => {
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
  const renderRows = (rows: SessionInfo[], withAgentHint: boolean) => (
    <ul className="space-y-0.5">
      {rows.map((s) => (
        <SessionRow
          key={s.sessionId}
          s={s}
          active={s.sessionId === activeSessionId}
          {...(withAgentHint ? { agentHint: agentNameById.get(s.agentId) ?? s.agentId } : {})}
          onOpen={openSession}
          onRename={(x) => {
            setRenameError(null);
            setRenameText(x.title ?? "");
            setRenamingSession(x);
          }}
          onDelete={(x) => setDeletingSession(x)}
          onToggleArchive={(x) => void toggleArchive(x)}
        />
      ))}
    </ul>
  );

  const folderClass =
    "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 dark:text-gray-500 dark:hover:bg-gray-800/50";

  /** Collapsed-by-default per-origin folder (subagent / scheduled), parallel to the archived folder. */
  const renderSourceFolder = (
    groupKey: string,
    source: SessionSource,
    rows: SessionInfo[],
    withAgentHint: boolean,
  ) => {
    if (rows.length === 0) return null;
    const open = openSourceFolders.has(sourceFolderKey(groupKey, source));
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => toggleSourceFolder(groupKey, source)}
          className={folderClass}
        >
          <Chevron open={open} size={12} />
          {S.chat.sourceGroups[source](rows.length)}
        </button>
        {open && renderRows(rows, withAgentHint)}
      </div>
    );
  };

  /** "More": reveal one more page of already-loaded active rows AND fetch the next server page for every contributing Agent that still has one. */
  const showMore = (groupKey: string, moreAgents: string[]) => {
    setGroupCaps((prev) => {
      const next = new Map(prev);
      next.set(groupKey, (prev.get(groupKey) ?? SIDEBAR_PAGE_SIZE) + SIDEBAR_PAGE_SIZE);
      return next;
    });
    if (moreAgents.length > 0) void loadMoreFor(moreAgents);
  };

  /**
   * Expanded group body shared by both modes: user rows (display-capped; "More" reveals and
   * loads further pages) + the collapsed-by-default subagent / scheduled / archived subgroups
   * (keyed by the group key; rendered uncapped over loaded data — they are collapsed by
   * default and only ever hold what the pages brought in).
   */
  const renderGroupBody = (
    groupKey: string,
    parts: SessionPartition,
    withAgentHint: boolean,
    /** Agents contributing to this group that still have unfetched server pages. */
    moreAgents: string[],
  ) => {
    const archivedOpen = openArchived.has(groupKey);
    const cap = groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE;
    const shownActive = parts.active.slice(0, cap);
    // "More" while hidden loaded rows exist OR any contributing Agent has server-side pages
    // left; a fetched page can also land rows in the folders below, so one click may grow
    // the visible list by fewer than a full page — the row simply stays until exhausted.
    const hasMore = parts.active.length > cap || moreAgents.length > 0;
    const empty =
      parts.active.length === 0 &&
      parts.subagent.length === 0 &&
      parts.schedule.length === 0 &&
      parts.archived.length === 0;
    return (
      <>
        {empty ? (
          <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
            {S.chat.noSessions}
          </p>
        ) : (
          renderRows(shownActive, withAgentHint)
        )}

        {/* Load/reveal more (kept adjacent to the active list it extends, above the folders) */}
        {hasMore && (
          <button
            type="button"
            aria-label={S.chat.loadMore}
            onClick={() => showMore(groupKey, moreAgents)}
            className={`${folderClass} mt-0.5`}
          >
            <span className="w-3" aria-hidden />
            {S.chat.loadMore}
          </button>
        )}

        {/* Per-origin folders (collapsed by default, above Archived): subagent first — spawned
            from the conversations at hand — then scheduled background runs. */}
        {renderSourceFolder(groupKey, "subagent", parts.subagent, withAgentHint)}
        {renderSourceFolder(groupKey, "schedule", parts.schedule, withAgentHint)}

        {/* Archived group (collapsed by default; archived wins over the per-origin folders) */}
        {parts.archived.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => toggleArchivedGroup(groupKey)}
              className={folderClass}
            >
              <Chevron open={archivedOpen} size={12} />
              {S.chat.archivedGroup(parts.archived.length)}
            </button>
            {archivedOpen && renderRows(parts.archived, withAgentHint)}
          </div>
        )}
      </>
    );
  };

  const navItems: Array<{ to: string; label: string; icon: string }> = [
    { to: "/agents", label: S.nav.agents, icon: NAV_ICONS.agents },
    { to: "/skills", label: S.nav.skills, icon: NAV_ICONS.skills },
    { to: "/models", label: S.nav.models, icon: NAV_ICONS.models },
    { to: "/usage", label: S.nav.usage, icon: NAV_ICONS.usage },
    { to: "/traces", label: S.nav.traces, icon: NAV_ICONS.traces },
    { to: "/benchmark", label: S.nav.benchmark, icon: NAV_ICONS.benchmark },
  ];

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];
  const fontOptions: ReadonlyArray<{ value: FontScale; label: string }> = [
    { value: "sm", label: S.settings.fontSmall },
    { value: "md", label: S.settings.fontMedium },
    { value: "lg", label: S.settings.fontLarge },
  ];
  const currencyOptions: ReadonlyArray<{ value: Currency; label: string }> = [
    { value: "USD", label: S.models.currencyUsd },
    { value: "CNY", label: S.models.currencyCny },
  ];

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

      {/* Fixed nav (new chat pinned at top: default_agent draft): no background fill, shares the
          same gray hover/active styling as nav items, distinguished only by its top position and
          font-medium; shows the same gray active state while on the draft page. */}
      <nav className="shrink-0 space-y-0.5 px-2 pt-2">
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
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => onNavigate?.()}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
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
          </NavLink>
        ))}
      </nav>

      {/* Session area (scrollable): grouped by Workspace (default) or by Agent.
          relative: the scroller acts as its own containing block, so absolute descendants
          (each row's sr-only Agent name) anchor and scroll inside it — anchored to the
          initial containing block instead, rows past the fold would bypass this
          overflow-y-auto and stretch the **document**, so expanding "More" / a source
          folder made the whole page scroll (composer pushed up, blank space below). */}
      <div className="relative mt-3 min-h-0 flex-1 overflow-y-auto border-t border-gray-200 px-2 pb-2 dark:border-gray-800">
        {/* Section header: list label + grouping-mode toggle (the choice persists in localStorage) */}
        <div className="flex items-center justify-between px-1 pt-2">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {S.chat.sessionList}
          </span>
          <div className="flex items-center gap-0.5">
            {(
              [
                { value: "workspace", icon: FOLDER_ICON, label: S.chat.groupByWorkspace },
                { value: "agent", icon: NAV_ICONS.agents, label: S.chat.groupByAgent },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.label}
                aria-label={opt.label}
                aria-pressed={groupMode === opt.value}
                onClick={() => setGroupMode(opt.value)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
                  groupMode === opt.value
                    ? "bg-gray-200/70 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    : "text-gray-400 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800/70 dark:hover:text-gray-300"
                }`}
              >
                <Icon d={opt.icon} size={14} />
              </button>
            ))}
          </div>
        </div>

        {groupMode === "agent" ? (
          loading && agents.length === 0 ? (
            <SkeletonList rows={5} />
          ) : (
            orderedAgents.map((agent) => {
              const parts = partitionSessions(byAgent.get(agent.agentId) ?? []);
              const collapsed = collapsedGroups.has(agent.agentId);
              const pinned = pinnedGroups.has(agent.agentId);
              return (
                <div key={agent.agentId} className="pt-2.5">
                  {/* Group header: collapse toggle (Agent name) + pin + new chat + Agent settings.
                      self-stretch makes the collapse toggle's hover pill span the full row height
                      set by the h-7 action buttons (one consistent hover geometry). */}
                  <div className="group/header flex items-center gap-0.5 px-1 pb-0.5">
                    <button
                      type="button"
                      onClick={() => toggleGroup(agent.agentId)}
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? S.nav.expandGroup : S.nav.collapseGroup}
                      className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
                    >
                      <AgentAvatar
                        id={agent.agentId}
                        name={agentDisplayName(agent)}
                        size={18}
                        className="shrink-0 rounded"
                      />
                      <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {agentDisplayName(agent)}
                      </span>
                      {/* Expand/collapse indicator sits right after the Agent name */}
                      <Chevron open={!collapsed} size={12} className="text-gray-400" />
                      <span className="min-w-0 flex-1" />
                    </button>
                    <GroupPinButton pinned={pinned} onToggle={() => togglePin(agent.agentId)} />
                    {/* New chat: enters draft state directly with this group's Agent (all options live on the draft input card) */}
                    <button
                      type="button"
                      title={S.chat.newSessionMenu}
                      aria-label={S.chat.newSessionMenu}
                      onClick={() => newChat(agent.agentId)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <Icon d="M12 5v14M5 12h14" size={18} />
                    </button>
                    <button
                      type="button"
                      title={S.agent.settings}
                      onClick={() => go(`/agents/${agent.agentId}`)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <Icon d={GEAR_ICON} size={16} />
                    </button>
                  </div>

                  {collapsed
                    ? null
                    : renderGroupBody(
                        agent.agentId,
                        parts,
                        false,
                        hasMoreByAgent.get(agent.agentId) === true ? [agent.agentId] : [],
                      )}
                </div>
              );
            })
          )
        ) : loading && sessions.length === 0 ? (
          <SkeletonList rows={5} />
        ) : orderedWorkspaceGroups.length === 0 ? (
          <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
            {S.chat.noSessions}
          </p>
        ) : (
          orderedWorkspaceGroups.map((group) => {
            const parts = partitionSessions(group.sessions);
            const collapsed = collapsedGroups.has(group.key);
            const pinned = pinnedGroups.has(group.key);
            return (
              <div key={group.key} className="pt-2.5">
                {/* Group header: collapse toggle (folder icon + directory basename + count, full path in the tooltip) + pin + new chat in this Workspace.
                    self-stretch: without it the collapse toggle's hover pill is content-sized
                    (~20px) and sits visibly shorter than the h-7 action buttons beside it. */}
                <div className="group/header flex items-center gap-0.5 px-1 pb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? S.nav.expandGroup : S.nav.collapseGroup}
                    {...(group.fullPath !== null ? { title: group.fullPath } : {})}
                    className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
                  >
                    {/* Folder opens and closes with the group */}
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      <Icon d={collapsed ? FOLDER_ICON : FOLDER_OPEN_ICON} size={15} />
                    </span>
                    {/* No uppercase transform: a directory basename's casing is meaningful */}
                    <span className="min-w-0 truncate text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {group.temp ? S.chat.tempWorkspaces : group.label}
                    </span>
                    {/* Header count = non-archived Sessions (user + automation-created; unchanged semantics) */}
                    <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                      {parts.active.length + parts.subagent.length + parts.schedule.length}
                    </span>
                    <Chevron open={!collapsed} size={12} className="text-gray-400" />
                    <span className="min-w-0 flex-1" />
                  </button>
                  <GroupPinButton pinned={pinned} onToggle={() => togglePin(group.key)} />
                  {/* New chat in this Workspace: pre-fills the group's path in the draft ("" = auto temp directory); the Agent is the current one, falling back to default_agent */}
                  <button
                    type="button"
                    title={S.chat.newSessionInWorkspace}
                    aria-label={S.chat.newSessionInWorkspace}
                    onClick={() => newChat(workspaceNewChatAgentId, group.fullPath ?? "")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  >
                    <Icon d="M12 5v14M5 12h14" size={18} />
                  </button>
                </div>

                {/* A workspace group can span Agents: "More" fans out to every contributing Agent that still has pages. */}
                {collapsed
                  ? null
                  : renderGroupBody(
                      group.key,
                      parts,
                      true,
                      groupAgentsWithMore(group.sessions, hasMoreByAgent),
                    )}
              </div>
            );
          })
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
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900">
                {(user?.userId ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{user?.userId}</span>
              {user?.isAdmin && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{S.auth.admin}</span>
              )}
            </button>
          }
        >
          <div className="space-y-2.5 px-3 py-2">
            <SettingRow label={S.settings.theme}>
              <Segmented options={themeOptions} value={mode} onChange={setMode} />
            </SettingRow>
            <SettingRow label={S.settings.fontSize}>
              <Segmented options={fontOptions} value={fontScale} onChange={setFontScale} />
            </SettingRow>
            <SettingRow label={S.settings.accent}>
              <AccentPicker value={accent} onChange={setAccent} />
            </SettingRow>
            <SettingRow label={S.models.currency}>
              <Segmented
                options={currencyOptions}
                value={currency}
                onChange={setCurrency}
                cols={2}
              />
            </SettingRow>
            <SettingRow label={S.settings.language}>
              <Segmented options={langOptions} value={lang} onChange={setLang} />
            </SettingRow>
          </div>
          <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                setUserOpen(false);
                setChangePasswordOpen(true);
              }}
            >
              {S.account.changePassword}
            </button>
            {/* User management is visible only to admins (the page route also has its own guard as a fallback). */}
            {user?.isAdmin && (
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  setUserOpen(false);
                  go("/admin/users");
                }}
              >
                {S.admin.users}
              </button>
            )}
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
          </div>
        </Dropdown>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

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

      {/* Delete chat confirmation */}
      <Modal
        open={deletingSession !== null}
        title={S.chat.deleteSession}
        onClose={() => (deletingBusy ? undefined : setDeletingSession(null))}
        footer={
          <>
            <Button onClick={() => setDeletingSession(null)} disabled={deletingBusy}>
              {S.common.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={deletingBusy}
              onClick={() => void confirmDeleteSession()}
            >
              {S.common.delete}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deletingSession
            ? S.chat.deleteSessionConfirm(deletingSession.title ?? S.chat.defaultSessionTitle)
            : ""}
        </p>
      </Modal>
    </div>
  );
}

/**
 * Group-header pin toggle, shared by both grouping modes: revealed on header hover (or
 * keyboard focus) while unpinned; once pinned it stays visible, doubling as the subtle
 * pinned indicator. The header row carries the `group/header` scope so the reveal only
 * reacts to its own row, not to the session rows' plain `group` scope.
 * The accessible name stays STATIC and aria-pressed alone carries the state (the toggle
 * pattern the grouping-mode buttons use) — a name that swaps 置顶/取消置顶 alongside
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
      <Icon d={PIN_ICON} size={15} />
    </button>
  );
}

/** Single Session row: title + status dot/approval badge + hover action group (rename, archive/unarchive, delete). */
function SessionRow({
  s,
  active,
  agentHint,
  onOpen,
  onRename,
  onDelete,
  onToggleArchive,
}: {
  s: SessionInfo;
  active: boolean;
  /** Agent display name; when set (workspace mode) a small avatar keeps the Agent context visible on the row. */
  agentHint?: string;
  onOpen: (s: SessionInfo) => void;
  onRename: (s: SessionInfo) => void;
  onDelete: (s: SessionInfo) => void;
  onToggleArchive: (s: SessionInfo) => void;
}) {
  const actionBtn =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-all duration-150 focus-visible:opacity-100 group-hover:opacity-100";
  return (
    <li>
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(s)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 text-left"
        >
          {agentHint !== undefined && (
            <span title={agentHint} className="flex shrink-0 items-center">
              <AgentAvatar id={s.agentId} name={agentHint} size={14} className="rounded" />
              {/* The avatar is aria-hidden and title only serves pointer users: expose the Agent name to keyboard/screen-reader users as visually hidden text inside the row button. */}
              <span className="sr-only">{agentHint}</span>
            </span>
          )}
          {/* Only attach a title attribute when the title is actually truncated (hover to see full text); don't duplicate the text otherwise. */}
          <Truncated
            text={s.title ?? S.chat.defaultSessionTitle}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : s.archived
                  ? "text-gray-400 dark:text-gray-500"
                  : "text-gray-700 dark:text-gray-300"
            }`}
          />
          {/* Source badge: schedule / sub-session (user-created sessions have no source and show nothing). */}
          {s.source && <Badge tone="gray">{S.chat.sourceNames[s.source] ?? s.source}</Badge>}
          <StatusDot session={s} />
          {s.pendingApprovalCount > 0 && (
            <span title={S.chat.pendingApprovals(s.pendingApprovalCount)}>
              <Badge tone="amber">{s.pendingApprovalCount}</Badge>
            </span>
          )}
        </button>
        {/* Action group: rename + archive/unarchive + delete */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            title={S.chat.renameSession}
            aria-label={S.chat.renameSession}
            onClick={() => onRename(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
          >
            <Icon d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3" size={14} />
          </button>
          <button
            type="button"
            title={s.archived ? S.chat.unarchiveSession : S.chat.archiveSession}
            aria-label={s.archived ? S.chat.unarchiveSession : S.chat.archiveSession}
            onClick={() => onToggleArchive(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200`}
          >
            <Icon
              d={
                s.archived
                  ? "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M12 17v-5m-2.5 2L12 11l2.5 3"
                  : "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M9.5 13.5 12 16l2.5-2.5"
              }
              size={14}
            />
          </button>
          <button
            type="button"
            title={S.chat.deleteSession}
            aria-label={S.chat.deleteSession}
            onClick={() => onDelete(s)}
            className={`${actionBtn} hover:bg-gray-300/60 hover:text-red-600 dark:hover:bg-gray-700 dark:hover:text-red-400`}
          >
            {/* Trash can: lid (4..20), handle, body (5..19, symmetric sides), two vertical ribs */}
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

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      {children}
    </div>
  );
}

/** Accent color picker: a row of swatches, with a ring on the selected one. */
function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {ACCENT_SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          title={S.settings.accentNames[s.value]}
          aria-label={S.settings.accentNames[s.value]}
          aria-pressed={value === s.value}
          onClick={() => onChange(s.value)}
          className={`h-5 w-5 rounded-full border transition-transform duration-150 hover:scale-110 ${
            value === s.value
              ? "border-gray-500 ring-2 ring-gray-400/50 dark:border-gray-300"
              : "border-transparent"
          }`}
          style={{ backgroundColor: s.color }}
        />
      ))}
    </div>
  );
}
