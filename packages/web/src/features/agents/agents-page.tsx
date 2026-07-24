/**
 * Agents list page: entry point for creating,
 * deleting, and editing Agents. Laid out as GitHub-repo-list-style single-column compact rows:
 * one horizontal band of "info | 30-day activity sparkline | button group" per row.
 * Info column has three lines: title line (small avatar + bold name + agentId); single-line
 * truncated description; and a stats line — icon + number only (Session count / tool count) plus
 * relative time (today/yesterday/n days ago), with meaning folded into the hover title.
 * Buttons sit to the right of the sparkline: "New Chat" (draft state, same as sidebar group
 * header) and "Settings" (goes to settings page) show text labels; "Usage" / "Traces" (deep link
 * via ?agentId= to the usage center / trace observability; traces use an eye line icon =
 * observability) and "Delete" (with confirmation; built-in Agents show a non-interactive light
 * gray placeholder with an undeletable tooltip) are square icon buttons (tooltip shows the full
 * name); "Create Agent" only fills in name + description.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { formatDateTime, formatRelativeDays } from "../../lib/format";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { agentDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Badge } from "../../components/ui/badge";
import { Skeleton, SkeletonCard } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { STAT_ICONS } from "../../lib/stat-icons";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { ActivitySparkline } from "./activity-sparkline";

/** Built-in Agent shipped with every Project (default_agent only; the server also rejects deletion, so no delete entry point is shown here). */
const BUILTIN_AGENT_IDS = new Set(["default_agent"]);

/** Card button icons (24x24 line path, rendered via GlyphIcon). */
const CARD_ICONS = {
  /** New chat (plus sign) */
  newChat: "M12 5v14M5 12h14",
  /** Settings (gear, same as sidebar user menu) */
  settings:
    "M10.3 4.3a2 2 0 0 1 3.4 0l.5.8a2 2 0 0 0 1.8 1l1-.1a2 2 0 0 1 1.7 3l-.5.8a2 2 0 0 0 0 2l.5.8a2 2 0 0 1-1.7 3l-1-.1a2 2 0 0 0-1.8 1l-.5.8a2 2 0 0 1-3.4 0l-.5-.8a2 2 0 0 0-1.8-1l-1 .1a2 2 0 0 1-1.7-3l.5-.8a2 2 0 0 0 0-2l-.5-.8a2 2 0 0 1 1.7-3l1 .1a2 2 0 0 0 1.8-1zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
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
} as const;

export function AgentsPage() {
  const navigate = useNavigate();
  useDocumentTitle(S.nav.agents);
  const { locale } = useLocale();
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
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, { state: { agentId } });
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
                    {/* Title line: small avatar + name + agentId + active badge */}
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
                      <span className="hidden shrink-0 font-mono text-xs text-gray-400 md:inline dark:text-gray-500">
                        {a.agentId}
                      </span>
                      <Badge tone="gray">v{a.version}</Badge>
                      {a.activeSessionCount > 0 && (
                        <Badge tone="brand">
                          {S.agent.activeSessions} {a.activeSessionCount}
                        </Badge>
                      )}
                    </div>
                    {/* Description truncated to one line (an empty description still takes up a line, keeping card heights equal) */}
                    <p className="mt-1.5 min-h-4 truncate text-xs text-gray-500 dark:text-gray-400">
                      {a.description ?? ""}
                    </p>
                    {/* Stats on their own line: same color/font size as the description; each
                        reserves a minimum width so they align vertically across cards; meaning
                        folded into the hover title */}
                    <div className="mt-1.5 flex items-center gap-x-2.5 text-xs text-gray-500 dark:text-gray-400">
                      <span
                        className="inline-flex min-w-[2.25rem] shrink-0 items-center gap-1 tabular-nums"
                        title={S.agent.sessionCount(a.sessionCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.sessions} size={12} />
                        {a.sessionCount}
                      </span>
                      <span
                        className="inline-flex min-w-[2.25rem] shrink-0 items-center gap-1 tabular-nums"
                        title={S.agent.toolCount(a.toolCount)}
                      >
                        <GlyphIcon d={STAT_ICONS.toolCalls} size={12} />
                        {a.toolCount}
                      </span>
                      <span
                        className="inline-flex min-w-[2.25rem] shrink-0 items-center gap-1 tabular-nums"
                        title={S.agent.vaultKeyCount(a.vaultKeyCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.vaultKeys} size={12} />
                        {a.vaultKeyCount}
                      </span>
                      <span
                        className="inline-flex min-w-[2.25rem] shrink-0 items-center gap-1 tabular-nums"
                        title={S.agent.scheduleCount(a.scheduleCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.schedules} size={12} />
                        {a.scheduleCount}
                      </span>
                      <span
                        className="inline-flex min-w-[2.25rem] shrink-0 items-center gap-1 tabular-nums"
                        title={S.skills.skillCount(a.skillCount)}
                      >
                        <GlyphIcon d={CARD_ICONS.skills} size={12} />
                        {a.skillCount}
                      </span>
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
                      <GlyphIcon
                        d={CARD_ICONS.settings}
                        className="text-gray-600 dark:text-gray-300"
                      />
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

      {/* Delete confirmation */}
      <Modal
        open={deleting !== null}
        title={S.agent.deleteAgent}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setDeleting(null);
                setDeleteError(null);
              }}
            >
              {S.common.cancel}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void doDelete()}>
              {S.common.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting ? S.agent.deleteConfirm(deleting.name) : ""}
        </p>
        {deleteError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
        )}
      </Modal>
    </div>
  );
}
