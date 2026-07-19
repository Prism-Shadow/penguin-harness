/**
 * Single-column sidebar, top to bottom:
 * Project switcher -> new chat (default_agent draft) + fixed nav (Agents / models / cost center /
 * Trace) -> Session area grouped by Agent (group header = Agent name + new chat + Agent settings;
 * shows all Agents, including empty groups) -> bottom user config (theme / language / logout).
 * Desktop keeps it pinned as the left column; mobile puts the whole thing in a drawer.
 * New chats always enter draft state (/chat/new, route state specifies the Agent): Model /
 * Workspace / approval mode are all chosen on the draft input card, so there's no longer a
 * separate "quick / advanced" pair of new-chat dialogs.
 * Color scheme is white/gray-based: active state uses a solid gray fill, running status uses a small color dot, no large blocks of color.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useMatch, useNavigate } from "react-router";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
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
import { Dropdown } from "../ui/dropdown";
import { AgentAvatar } from "../ui/agent-avatar";
import { Chevron } from "../ui/chevron";
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

/** Dropdown caret (used by the Project switcher; distinct from the collapse-indicator Chevron). */
function DropdownCaret() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 4.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ICONS = {
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

/** Standard gear (lucide settings): full tooth outline + center circle, crisp and undistorted at 16px. */
const GEAR_ICON =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";

const menuItemClass =
  "block w-full px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

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
    setCurrentAgentId,
  } = useProject();
  const { byAgent, loading, remove, replace } = useSessions();
  const chatMatch = useMatch("/chat/:sessionId");
  const activeSessionId = chatMatch?.params.sessionId ?? null;

  const [projectOpen, setProjectOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  /** Collapsed Agent groups (expanded by default). */
  const [collapsedAgents, setCollapsedAgents] = useState<ReadonlySet<string>>(new Set());
  /** Expanded "archived" groups (collapsed by default). */
  const [openArchived, setOpenArchived] = useState<ReadonlySet<string>>(new Set());
  /** Session pending delete confirmation (null = none). */
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Session currently being renamed (null = none) and the title being typed. */
  const [renamingSession, setRenamingSession] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const toggleAgent = (agentId: string) =>
    setCollapsedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  const toggleArchivedGroup = (agentId: string) =>
    setOpenArchived((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });

  /** Archive / unarchive: persists immediately and updates in place (fails silently; the next list refresh self-corrects). */
  const toggleArchive = async (s: SessionInfo) => {
    // Archiving the currently open chat: expand the "archived" group so it doesn't silently vanish from the sidebar with no way back.
    if (!s.archived && s.sessionId === activeSessionId) {
      setOpenArchived((prev) => new Set(prev).add(s.agentId));
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
    setDeleteError(null);
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
      setDeleteError(e instanceof ApiError ? e.message : S.common.unknownError);
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
   * Agent: the group header's "+" uses that group's Agent, while the menu's "New chat" uses
   * default_agent; this explicit intent overrides the previously selected Agent in the draft
   * cache (the rest of the draft content, such as the message body, is preserved).
   */
  const newChat = (agentId?: string) => {
    if (agentId) setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, agentId ? { state: { agentId } } : undefined);
    onNavigate?.();
  };

  /** Target of the menu's "New chat": default_agent, falling back to the first Agent (if the list isn't ready yet, resolution is deferred to the draft page). */
  const defaultAgentId = (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;

  const openSession = (s: SessionInfo) => {
    // Cross-group click: the current Agent follows this Session's own Agent.
    setCurrentAgentId(s.agentId);
    go(`/chat/${s.sessionId}`);
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
                <DropdownCaret />
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
            <Icon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
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

      {/* Session area grouped by Agent (scrollable) */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-gray-200 px-2 pb-2 dark:border-gray-800">
        {loading && agents.length === 0 ? (
          <SkeletonList rows={5} />
        ) : (
          agents.map((agent) => {
            const list = byAgent.get(agent.agentId) ?? [];
            const activeList = list.filter((s) => !s.archived);
            const archivedList = list.filter((s) => s.archived);
            const collapsed = collapsedAgents.has(agent.agentId);
            const archivedOpen = openArchived.has(agent.agentId);
            return (
              <div key={agent.agentId} className="pt-2.5">
                {/* Group header: collapse toggle (Agent name) + new chat + Agent settings */}
                <div className="flex items-center gap-0.5 px-1 pb-0.5">
                  <button
                    type="button"
                    onClick={() => toggleAgent(agent.agentId)}
                    aria-label={collapsed ? S.nav.expandGroup : S.nav.collapseGroup}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
                  >
                    <AgentAvatar id={agent.agentId} size={18} className="shrink-0 rounded" />
                    <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {agentDisplayName(agent)}
                    </span>
                    {/* Expand/collapse indicator sits right after the Agent name */}
                    <Chevron open={!collapsed} size={12} className="text-gray-400" />
                    <span className="min-w-0 flex-1" />
                  </button>
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

                {collapsed ? null : (
                  <>
                    {activeList.length === 0 && archivedList.length === 0 ? (
                      <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
                        {S.chat.noSessions}
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {activeList.map((s) => (
                          <SessionRow
                            key={s.sessionId}
                            s={s}
                            active={s.sessionId === activeSessionId}
                            onOpen={openSession}
                            onRename={(x) => {
                              setRenameError(null);
                              setRenameText(x.title ?? "");
                              setRenamingSession(x);
                            }}
                            onDelete={(x) => {
                              setDeleteError(null);
                              setDeletingSession(x);
                            }}
                            onToggleArchive={(x) => void toggleArchive(x)}
                          />
                        ))}
                      </ul>
                    )}

                    {/* Archived group (collapsed by default) */}
                    {archivedList.length > 0 && (
                      <div className="mt-1">
                        <button
                          type="button"
                          onClick={() => toggleArchivedGroup(agent.agentId)}
                          className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 dark:text-gray-500 dark:hover:bg-gray-800/50"
                        >
                          <Chevron open={archivedOpen} size={12} />
                          {S.chat.archivedGroup(archivedList.length)}
                        </button>
                        {archivedOpen && (
                          <ul className="space-y-0.5">
                            {archivedList.map((s) => (
                              <SessionRow
                                key={s.sessionId}
                                s={s}
                                active={s.sessionId === activeSessionId}
                                onOpen={openSession}
                                onRename={(x) => {
                                  setRenameError(null);
                                  setRenameText(x.title ?? "");
                                  setRenamingSession(x);
                                }}
                                onDelete={(x) => {
                                  setDeleteError(null);
                                  setDeletingSession(x);
                                }}
                                onToggleArchive={(x) => void toggleArchive(x)}
                              />
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
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
          autoFocus
          maxLength={120}
          onChange={(e) => setRenameText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && renameText.trim() && !renameBusy) void confirmRename();
          }}
        />
        {renameError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{renameError}</p>
        )}
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
        {deleteError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </Modal>
    </div>
  );
}

/** Single Session row: title + status dot/approval badge + hover action group (rename, archive/unarchive, delete). */
function SessionRow({
  s,
  active,
  onOpen,
  onRename,
  onDelete,
  onToggleArchive,
}: {
  s: SessionInfo;
  active: boolean;
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
