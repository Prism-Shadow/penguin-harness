/**
 * Agents list page: entry point for creating,
 * deleting, and editing Agents. Laid out as GitHub-repo-list-style single-column compact rows:
 * one horizontal band of "info | 30-day activity sparkline | button group" per row.
 * Info column has three lines: title line (small avatar + bold name + agentId); single-line
 * truncated description; and a stats line — icon + number only (Session count / tool count) plus
 * relative time (today/yesterday/n days ago), with meaning folded into the hover title; the
 * tool / skill / memory / vault-key / schedule counts deep-link to the settings page's matching
 * tab (?tab=tools|skills|memory|vault|schedules) and appear in the settings tabs' order.
 * Buttons sit to the right of the sparkline: "New Chat" (draft state, same as sidebar group
 * header) and "Settings" (goes to settings page) show text labels; "Usage" / "Traces" (deep link
 * via ?agentId= to the usage center / trace observability; traces use an eye line icon =
 * observability) and "Delete" (with confirmation; built-in Agents show a non-interactive light
 * gray placeholder with an undeletable tooltip) are square icon buttons (tooltip shows the full
 * name); "Create Agent" only fills in name + description.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatDateTime, formatRelativeDays } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Badge } from "../../components/ui/badge";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CopyButton } from "../../components/ui/copy-button";
import { GEAR_ICON } from "../../components/ui/icons";
import { STAT_ICONS } from "../../lib/stat-icons";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { parkActiveDraft } from "../chat/draft-sessions";
import { ActivitySparkline } from "./activity-sparkline";

/** Built-in Agent shipped with every Project (default_agent only; the server also rejects deletion, so no delete entry point is shown here). */
const BUILTIN_AGENT_IDS = new Set(["default_agent"]);

/** Card button icons (24x24 line path, rendered via GlyphIcon). */
const CARD_ICONS = {
  /** New chat (plus sign) */
  newChat: "M12 5v14M5 12h14",
  /** Delete (trash can) */
  trash:
    "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6",
  /** Total session count (chat bubble) */
  sessions: "M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5",
  /** Vault key count (key: bow + teeth) */
  vaultKeys: "M15.5 7.5l3 3L22 7l-3-3M21 2l-9.6 9.6M13 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z",
  /** Schedule count (alarm clock: dial + hands + twin bells, distinct from the plain clock face used for "last modified") */
  schedules: "M12 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm0-10v3l2 1.5M5 3L2.5 5.5M19 3l2.5 2.5",
  /** Installed skill count (open book, same family as the skill library) */
  skills:
    "M12 6.5C10.5 5 8 4.5 4 5v12c4-.5 6.5 0 8 1.5 1.5-1.5 4-2 8-1.5V5c-4-.5-6.5 0-8 1.5zm0 0V18",
  /** Usage (bar chart, same as sidebar "Usage Center") */
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  /** Traces (eye line icon: observability; follows text color, no fill) */
  traces: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  /** Memory (brain: two hemispheres + inner fold, lucide simplified), opens the settings tab */
  memory:
    "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18ZM12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18ZM15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
  /** Kernel update available (rotate-cw — the skill library's update glyph), deep-links to the settings overview */
  kernelUpdate: "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10",
} as const;

/**
 * Stat entries that deep-link into a settings tab: same look as the plain stat spans
 * (no button chrome) plus a subtle hover text-color shift and pointer cursor.
 */
const STAT_LINK_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center gap-1 tabular-nums " +
  "transition-colors duration-150 hover:text-gray-800 dark:hover:text-gray-200";

export function AgentsPage() {
  const navigate = useNavigate();
  useDocumentTitle(S.nav.agents);
  const { locale } = useLocale();
  const { user } = useAuth();
  const { currentProject, agents, agentsLoading, reloadAgents, setCurrentAgentId } = useProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The id is the only validated create field; format problems and the server's duplicate-id rejection land beside it.
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  /** Open the create dialog: don't keep the previous draft, always start from an empty form. */
  const openCreate = () => {
    setAgentId("");
    setName("");
    setDescription("");
    setIdError(undefined);
    setCreateOpen(true);
  };

  // Cross-page create intent (the sidebar's mode-dependent "new" button navigates here
  // with { create: true } route state — the chat draft's route-state idiom): open the
  // existing create dialog once, then strip the state so a refresh or back-nav doesn't
  // reopen it.
  const location = useLocation();
  const createIntent = (location.state as { create?: boolean } | null)?.create === true;
  useEffect(() => {
    if (!createIntent) return;
    openCreate();
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createIntent]);
  /** Agent pending delete confirmation (null = none). */
  const [deleting, setDeleting] = useState<{ agentId: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const projectId = currentProject?.projectId;

  const create = async () => {
    if (!projectId) return;
    const id = agentId.trim();
    if (!id) {
      setIdError(S.common.requiredField);
      return;
    }
    if (!SEMANTIC_ID_PATTERN.test(id)) {
      setIdError(S.agent.idHint);
      return;
    }
    setBusy(true);
    setIdError(undefined);
    try {
      // Name defaults to the id (leave blank to let the server fill it in from the id).
      const body: { agentId: string; name?: string; description?: string } = { agentId: id };
      if (name.trim()) body.name = name.trim();
      if (description.trim()) body.description = description.trim();
      const res = await api.createAgent(projectId, body);
      setCreateOpen(false);
      await reloadAgents();
      setCurrentAgentId(res.agent.agentId);
      navigate(`/agents/${res.agent.agentId}`);
    } catch (e) {
      setIdError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * "New Chat": enters draft state (same as sidebar group header) — the Session is only
   * actually created when the first message is sent. agentId travels via route state: when the
   * draft view restores from cache it prefers the cached agentId, but the route state explicitly
   * overrides it, ensuring that clicking "New Chat" on a given card always lands on that Agent
   * rather than the previous one from the cache.
   */
  const newChat = (agentId: string) => {
    // Typed-but-unsent draft text becomes a parked draft conversation first (draft-sessions.ts).
    if (user && projectId) parkActiveDraft(user.userId, projectId);
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
  };

  /**
   * Stat icon click: same navigation as the "Settings" button plus `?tab=` so the settings
   * page lands directly on the matching tab (unknown keys fall back to Overview there, so
   * "skills" is harmless until the Skills tab ships).
   */
  const openSettingsTab = (
    agentId: string,
    tab: "overview" | "tools" | "vault" | "schedules" | "skills" | "memory",
  ) => {
    setCurrentAgentId(agentId);
    navigate(`/agents/${agentId}?tab=${tab}`);
  };

  const doDelete = async () => {
    if (!projectId || !deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteAgent(projectId, deleting.agentId);
      setDeleting(null);
      await reloadAgents();
    } catch (e) {
      setDeleteError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{S.agent.listTitle}</h1>
          <Button variant="primary" onClick={openCreate}>
            {S.agent.create}
          </Button>
        </div>

        {agentsLoading ? (
          /* Same single-column row styling as the real list (space-y-3 + px-5 py-4), with a
             three-line info column plus sparkline/button-group placeholders, so no layout shift
             occurs once the skeleton disappears */
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard
                key={i}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
              >
                <div className="min-w-[14rem] flex-1">
                  <Skeleton className="h-[18px] w-40" />
                  <Skeleton className="mt-1.5 h-4 w-2/3" />
                  <Skeleton className="mt-1.5 h-4 w-48" />
                </div>
                <Skeleton className="hidden h-9 w-40 md:block" />
                <Skeleton className="h-8 w-52" />
              </SkeletonCard>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState title={S.common.none} />
        ) : (
          /* GitHub-repo-list-style single column: separate cards with row spacing; each row is
             one horizontal band of "info | sparkline | button group", with the info column
             compressed to two lines of text (name line + combined description/stats line) to
             minimize row height */
          <div className="space-y-3">
            {agents.map((a) => {
              const builtin = BUILTIN_AGENT_IDS.has(a.agentId);
              return (
                <div
                  key={a.agentId}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"
                >
                  {/* Info column: once it can't fit within 14rem, everything after it
                      (sparkline/buttons) wraps as a whole. The avatar counts as the first line
                      (same line as the name); description/stats share the same left edge as the
                      avatar (the column's left edge) */}
                  <div className="min-w-[14rem] flex-1">
                    {/* Title line: small avatar + name + agentId (with the shared copy button,
                        hidden together with the id on narrow screens) + version badge */}
                    <div className="flex items-center gap-2">
                      <AgentAvatar
                        id={a.agentId}
                        name={agentDisplayName(a)}
                        size={18}
                        className="shrink-0 rounded"
                      />
                      {/* min-w-0: flex children don't shrink below their content by default; needed here to truncate overly long names */}
                      <span className="min-w-0 truncate text-base font-bold">
                        {agentDisplayName(a)}
                      </span>
                      <span className="hidden shrink-0 items-center gap-1 font-mono text-xs text-gray-400 md:inline-flex dark:text-gray-500">
                        {a.agentId}
                        <CopyButton text={a.agentId} label={S.agent.copyId} />
                      </span>
                      <Badge tone="gray">v{a.version}</Badge>
                      {/* Kernel-outdated hint: minimal icon + tooltip (skills-library update
                          convention, no textual/red alarm), deep-linking to the settings
                          overview where the update action lives. */}
                      {a.kernelOutdated && (
                        <button
                          type="button"
                          className="shrink-0 cursor-pointer text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                          title={S.agent.kernelOutdatedHint}
                          aria-label={S.agent.kernelOutdatedHint}
                          onClick={() => openSettingsTab(a.agentId, "overview")}
                        >
                          <GlyphIcon d={CARD_ICONS.kernelUpdate} size={12} />
                        </button>
                      )}
                    </div>
                    {/* Description truncated to one line (an empty description still takes up a line, keeping card heights equal) */}
                    <p className="mt-1.5 min-h-4 truncate text-xs text-gray-500 dark:text-gray-400">
                      {a.description ?? ""}
                    </p>
                    {/* Stats on their own line: same color/font size as the description; each
                        item hugs its content, with spacing left to the container's uniform
                        gap-x-4; meaning folded into the hover title. Tool/skill/memory/vault/
                        schedule counts are buttons deep-linking to the matching settings tab,
                        listed in the settings tabs' order (also for built-in Agents — their
                        Settings entry point has no gating either); session count and
                        last-modified stay plain text */}
                    <div className="mt-1.5 flex items-center gap-x-4 text-xs text-gray-500 dark:text-gray-400">
                      <span
                        className="inline-flex shrink-0 items-center gap-1 tabular-nums"
                        title={S.agent.sessionCount(a.sessionCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.sessions} size={12} />
                        {a.sessionCount}
                      </span>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.toolCount(a.toolCount)}
                        aria-label={S.agent.toolCount(a.toolCount)}
                        onClick={() => openSettingsTab(a.agentId, "tools")}
                      >
                        <GlyphIcon d={STAT_ICONS.toolCalls} size={12} />
                        {a.toolCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.skills.skillCount(a.skillCount)}
                        aria-label={S.skills.skillCount(a.skillCount)}
                        onClick={() => openSettingsTab(a.agentId, "skills")}
                      >
                        <GlyphIcon d={CARD_ICONS.skills} size={12} />
                        {a.skillCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.memoryCount(a.memoryCount)}
                        aria-label={S.agent.memoryCount(a.memoryCount)}
                        onClick={() => openSettingsTab(a.agentId, "memory")}
                      >
                        <GlyphIcon d={CARD_ICONS.memory} size={12} />
                        {a.memoryCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.vaultKeyCount(a.vaultKeyCount)}
                        aria-label={S.agent.vaultKeyCount(a.vaultKeyCount)}
                        onClick={() => openSettingsTab(a.agentId, "vault")}
                      >
                        <GlyphIcon d={CARD_ICONS.vaultKeys} size={12} />
                        {a.vaultKeyCount}
                      </button>
                      <button
                        type="button"
                        className={STAT_LINK_CLASS}
                        title={S.agent.scheduleCount(a.scheduleCount)}
                        aria-label={S.agent.scheduleCount(a.scheduleCount)}
                        onClick={() => openSettingsTab(a.agentId, "schedules")}
                      >
                        <GlyphIcon d={CARD_ICONS.schedules} size={12} />
                        {a.scheduleCount}
                      </button>
                      <span
                        className="inline-flex shrink-0 items-center gap-1"
                        title={`${S.agent.updatedAt} ${a.updatedAt ? formatDateTime(a.updatedAt) : "—"}`}
                      >
                        <GlyphIcon d={STAT_ICONS.elapsed} size={12} />
                        {a.updatedAt ? formatRelativeDays(a.updatedAt, locale) : "—"}
                      </span>
                    </div>
                  </div>

                  {/* Session activity sparkline (hidden on narrow screens first, giving the horizontal space back to content and buttons) */}
                  <ActivitySparkline
                    data={a.sessionActivity}
                    label={S.agent.activity(a.sessionActivity.length || 30)}
                    className="hidden shrink-0 md:block"
                  />

                  {/* Button group to the right of the sparkline: "New Chat" shows text, the rest are square icon buttons (tooltip shows the full name) */}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="primary" onClick={() => newChat(a.agentId)}>
                      <GlyphIcon d={CARD_ICONS.newChat} />
                      {S.chat.newSessionMenu}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setCurrentAgentId(a.agentId);
                        navigate(`/agents/${a.agentId}`);
                      }}
                    >
                      <GlyphIcon d={GEAR_ICON} />
                      {S.common.settings}
                    </Button>
                    <Button
                      size="icon"
                      title={S.nav.usage}
                      aria-label={S.nav.usage}
                      onClick={() => navigate(`/usage?agentId=${encodeURIComponent(a.agentId)}`)}
                    >
                      <GlyphIcon
                        d={CARD_ICONS.usage}
                        size={15}
                        className="text-gray-600 dark:text-gray-300"
                      />
                    </Button>
                    <Button
                      size="icon"
                      title={S.nav.traces}
                      aria-label={S.nav.traces}
                      onClick={() => navigate(`/traces?agentId=${encodeURIComponent(a.agentId)}`)}
                    >
                      <GlyphIcon
                        d={CARD_ICONS.traces}
                        size={15}
                        className="text-gray-600 dark:text-gray-300"
                      />
                    </Button>
                    {/* Built-in Agents can't be deleted: shown as a non-button light gray
                        placeholder (no border/background, no hover response, disabled cursor,
                        explained via tooltip); the transparent border keeps the same box size as
                        an icon button so column widths stay consistent across cards */}
                    {builtin ? (
                      <span
                        role="img"
                        title={S.agent.builtinUndeletable}
                        aria-label={S.agent.builtinUndeletable}
                        className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-transparent p-1.5 text-gray-300 dark:text-gray-600"
                      >
                        <GlyphIcon d={CARD_ICONS.trash} size={15} />
                      </span>
                    ) : (
                      <Button
                        size="icon"
                        variant="danger"
                        title={S.agent.deleteAgent}
                        aria-label={S.agent.deleteAgent}
                        onClick={() =>
                          setDeleting({ agentId: a.agentId, name: agentDisplayName(a) })
                        }
                      >
                        <GlyphIcon d={CARD_ICONS.trash} size={15} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        title={S.agent.createTitle}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void create()}>
              {S.common.create}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={S.agent.id}
            required
            size="sm"
            value={agentId}
            onChange={(e) => {
              setAgentId(e.target.value);
              setIdError(undefined);
            }}
            error={idError}
            hint={S.agent.idHint}
            autoFocus
          />
          <Input
            label={S.common.name}
            size="sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={S.agent.nameHint}
          />
          <Textarea
            label={S.agent.description}
            size="sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </Modal>

      {/* Delete confirmation (shared ConfirmModal) */}
      <ConfirmModal
        open={deleting !== null}
        title={S.agent.deleteAgent}
        busy={busy}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={() => void doDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting ? S.agent.deleteConfirm(deleting.name) : ""}
        </p>
        {deleteError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </ConfirmModal>
    </div>
  );
}
