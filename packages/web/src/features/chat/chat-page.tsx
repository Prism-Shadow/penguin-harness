/**
 * Chat page (refactored version):
 * a thin top toolbar (Session title / status / iconized stats / Files toggle / details popup) +
 * the message stream and input area (input box vertically centered when there are no messages).
 * Files is no longer a mutually exclusive tab — it's a persistent, closable, resizable docked
 * panel on the right (use-files-panel.ts), and each message's trailing file summary card jumps to
 * and locates the file in the tree via onOpenFile.
 * Approval mode and Model/context usage live in the input area's toolbar; context is compacted
 * via the /compact slash command.
 * Draft state (/chat/new) is carried by DraftView: Agent / Workspace / approval mode / Model are
 * chosen before sending, and everything except approval mode is locked once the Session is
 * created. The Session list and the new-chat entry point live in the global sidebar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  AgentSummary,
  ApprovalMode,
  ModelsResponse,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime, formatMoney, humanizeDuration, humanizeTokens } from "../../lib/format";
import { latestConversation } from "../../lib/session-grouping";
import { approvalKey } from "../../lib/omni/stream-model";
import { useTheme } from "../../state/theme";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Truncated } from "../../components/ui/truncated";
import { Dropdown } from "../../components/ui/dropdown";
import { EmptyState } from "../../components/ui/empty-state";
import { toastError } from "../../components/ui/toast";
import { MessageStream } from "./message-stream";
import type { StreamRenderContext } from "./message-stream";
import { ChatInput } from "./chat-input";
import { DraftView } from "./draft-view";
import { handoffMessage } from "./agent-mentions";
import { sameModelRef } from "../models/model-grouping";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { FilesPanel } from "./files-panel";
import { useFilesPanel } from "./use-files-panel";
import { useSessionDraft } from "./use-session-draft";
import { useSessionStream } from "./use-session-stream";

const STAT_ICONS = {
  // Tokens (database / stacked cylinders)
  tokens:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  // Cost (circled dollar sign)
  cost: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-15v12m2.6-9.3c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2 0 2.7 5.4 1.3 5.4 4 0 1.2-1.2 2-2.7 2-1.2 0-2.2-.5-2.7-1.4",
  // Elapsed time (clock)
  elapsed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2",
  // Files (folder)
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
} as const;

/** Iconized stat item: a symbol + a value, with the title giving the full meaning. */
function StatChip({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <span
      title={label}
      className="flex shrink-0 items-center gap-1 font-mono text-xs text-gray-500 dark:text-gray-400"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={icon} />
      </svg>
      {value}
    </span>
  );
}

/**
 * Route id for a draft chat (`/chat/new`): the Session hasn't been persisted yet — the user may
 * still want to change the model or configure a key first. The actual Session is only created
 * once **the first message is sent** (once created, the model is locked into its meta).
 * Real session ids always start with `session-`, so there's no collision with this constant.
 */
export const DRAFT_SESSION_ID = "new";

export function ChatPage() {
  const navigate = useNavigate();
  const params = useParams<{ sessionId?: string }>();
  const { currency } = useTheme();
  const { currentProject, currentAgent, setCurrentAgentId, reloadAgents, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const agentId = currentAgent?.agentId ?? null;
  const {
    sessions,
    loading: sessionsLoading,
    reload: reloadSessions,
    add: addSession,
    replace,
    setStatus,
    setTitle,
  } = useSessions();

  const [sessionCost, setSessionCost] = useState<number | null>(null);
  const [costUncosted, setCostUncosted] = useState(false);
  const [credentialGuide, setCredentialGuide] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);

  const routeSessionId = params.sessionId ?? null;
  const filesPanel = useFilesPanel(routeSessionId);
  const draft = routeSessionId === DRAFT_SESSION_ID;
  const selected = draft ? null : (sessions.find((s) => s.sessionId === routeSessionId) ?? null);
  // Currently effective model (session state, the model reference comes from the Session DTO): model selection in draft state is handled internally by DraftView.
  const activeModelRef = selected
    ? { provider: selected.provider, modelId: selected.modelId }
    : null;

  // Tab title follows the current Session (refreshes in sync once the auto-generated title arrives).
  useDocumentTitle(selected ? (selected.title ?? S.chat.defaultSessionTitle) : S.nav.chat);

  const stream = useSessionStream(
    selected?.sessionId ?? null,
    selected?.status ?? "idle",
    setTitle,
    // Sub-session registration notice (session_created is pushed over the parent session's channel): reload the list so it appears immediately.
    () => void reloadSessions(),
  );

  // Chat input area draft: caches text, @ target, and selected skills keyed by sessionId; restored after navigating away and back or a refresh, discarded on successful send.
  const {
    initial: sessionDraft,
    onTextChange: onDraftTextChange,
    onHandoffTargetChange: onDraftHandoffChange,
    onSkillsChange: onDraftSkillsChange,
    discard: discardSessionDraft,
  } = useSessionDraft(selected?.sessionId ?? null);

  // Current Agent follows the Session in the route (keeps the sidebar and stats aligned on deep
  // links / refresh). Only aligns when **the selected Session changes** — never put agentId in
  // the dependency array: otherwise, when switching from a "running session" to a new chat with
  // a different Agent, navigate and setCurrentAgentId aren't in the same batch — a transitional
  // render of "new agentId + old route (old session still selected)" would appear first, and
  // this effect would then flip the Agent back to the old session's Agent based on that,
  // causing the new chat to end up created on the old Agent.
  const selectedSessionId = selected?.sessionId ?? null;
  const selectedAgentId = selected?.agentId ?? null;
  useEffect(() => {
    if (selectedSessionId && selectedAgentId) setCurrentAgentId(selectedAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedAgentId, setCurrentAgentId]);

  // Skills installed on the session's Agent (candidates for the input area's skill dropdown):
  // fetched keyed on the session's Agent; on switch, cleared first (which also clears the input
  // area's selection) before refetching; a failed fetch is silently treated as no skills.
  // Clearing preserves reference identity (an already-empty array isn't replaced), matching
  // draft-view's convention.
  const [agentSkills, setAgentSkills] = useState<SkillMetadataItem[]>([]);
  useEffect(() => {
    setAgentSkills((prev) => (prev.length > 0 ? [] : prev));
    if (!projectId || !selectedAgentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, selectedAgentId)
      .then((res) => {
        if (!cancelled) setAgentSkills(res.skills);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAgentId]);

  // The Session list is paged: a deep-linked Session (old bookmark, cross-page jump) may sit
  // beyond the loaded pages. Look it up directly and insert it before the auto-select effect
  // below concludes it doesn't exist; only a failed probe releases that redirect.
  const [probeFailedId, setProbeFailedId] = useState<string | null>(null);
  useEffect(() => {
    if (draft || !routeSessionId || sessionsLoading) return;
    if (sessions.some((s) => s.sessionId === routeSessionId)) return;
    let cancelled = false;
    api.getSession(routeSessionId).then(
      (res) => {
        if (!cancelled) addSession(res.session);
      },
      () => {
        if (!cancelled) setProbeFailedId(routeSessionId);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draft, routeSessionId, sessionsLoading, sessions, addSession]);

  // Auto-select the most recent conversation when the route doesn't select one (newest loaded
  // active/schedule Session — archived rows are hidden by choice and subagent Sessions belong
  // to their parent, so neither is auto-opened); if there is none, fall back to draft state
  // (instead of auto-creating one).
  useEffect(() => {
    if (sessionsLoading || draft) return;
    if (routeSessionId && sessions.some((s) => s.sessionId === routeSessionId)) return;
    // A routed id missing from the paged list isn't gone until the direct lookup fails.
    if (routeSessionId && probeFailedId !== routeSessionId) return;
    const last = latestConversation(sessions);
    navigate(last ? `/chat/${last.sessionId}` : `/chat/${DRAFT_SESSION_ID}`, { replace: true });
  }, [sessionsLoading, draft, routeSessionId, probeFailedId, sessions, navigate]);

  // Sync task_state to the sidebar list badge.
  useEffect(() => {
    if (selected) setStatus(selected.sessionId, stream.taskState);
  }, [stream.taskState, selected, setStatus]);

  // Task returns from running/compacting to idle: this turn may have spawned a sub-session or
  // auto-created a new Agent — reload the session and Agent lists so they appear in the sidebar
  // immediately (no manual refresh needed).
  const prevTaskRef = useRef(stream.taskState);
  useEffect(() => {
    const prev = prevTaskRef.current;
    prevTaskRef.current = stream.taskState;
    if (prev !== "idle" && stream.taskState === "idle") {
      void reloadSessions();
      void reloadAgents();
    }
  }, [stream.taskState, reloadSessions, reloadAgents]);

  // Existence cache for message file cards (session-level): normalized relative path -> whether
  // it exists; while a lookup is in flight, the cache shares a single Promise, so a batch of
  // concurrent mounts only issues one files/stat call.
  const statCacheRef = useRef(new Map<string, boolean | Promise<boolean>>());

  // Session switch: resets the cost and the file-card existence cache, avoiding stale data from
  // the previous Session (Files panel state resets itself keyed on sessionId inside use-files-panel).
  useEffect(() => {
    setSessionCost(null);
    setCostUncosted(false);
    statCacheRef.current = new Map();
  }, [routeSessionId]);

  // Batched existence check (message file cards): merges only the cache-miss paths into a single
  // files/stat call, and the result lands in the session-level cache — during streaming, the
  // candidate set is re-checked on every change, and the cache ensures only new paths trigger a
  // request. On request failure, the placeholder is cleared (don't permanently cache a "couldn't
  // find" as "doesn't exist"), returned as not-existing this time, and re-checked on the next mount.
  const statFiles = useCallback(
    async (paths: string[]): Promise<ReadonlySet<string>> => {
      const sessionId = selected?.sessionId ?? null;
      const cache = statCacheRef.current;
      const misses = sessionId === null ? [] : paths.filter((p) => !cache.has(p));
      if (sessionId !== null && misses.length > 0) {
        const batch = api
          .statSessionFiles(sessionId, misses)
          .then((res) => new Set(res.existing))
          .catch(() => null);
        for (const p of misses) {
          cache.set(
            p,
            batch.then((existing) => {
              if (existing === null) {
                cache.delete(p);
                return false;
              }
              const exists = existing.has(p);
              cache.set(p, exists);
              return exists;
            }),
          );
        }
      }
      const result = new Set<string>();
      await Promise.all(
        paths.map(async (p) => {
          const hit = cache.get(p);
          if (hit === true || (hit instanceof Promise && (await hit))) result.add(p);
        }),
      );
      return result;
    },
    [selected?.sessionId],
  );

  // Session's cumulative cost: refreshed on entry and every time it returns to idle (cost is computed by the server in real time based on current pricing).
  useEffect(() => {
    if (!projectId || !selected || stream.taskState !== "idle") return;
    let cancelled = false;
    api
      .getUsage(projectId, { groupBy: "session", agentId: selected.agentId })
      .then((res) => {
        if (cancelled) return;
        const row = res.groups.find((g) => g.key === selected.sessionId);
        setSessionCost(row?.cost ?? null);
        setCostUncosted(row?.hasUncosted ?? false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, stream.taskState]);

  // Model config (context window + credential guide): fetched once per Project.
  //
  // The credential guide **only ever nags once per lifetime** (first entry after registration):
  // gated by the server prefs' credentialGuideSeen — previously it checked "default model has no
  // key" and popped up a dialog on every visit to the chat page, which was repeated nagging for
  // users who simply don't intend to configure a key / use environment variables instead.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setModels(null);
    void (async () => {
      try {
        const res = await api.getModels(projectId);
        if (cancelled) return;
        setModels(res);
        const { prefs } = await api.getPrefs();
        if (cancelled || prefs.credentialGuideSeen) return;
        const def = res.models.find((m) => sameModelRef(m, res.defaultModel));
        const missing = !res.defaultModel || !def?.credential?.apiKeyMasked;
        if (missing) setCredentialGuide(true);
        // Mark as "seen" regardless of whether the dialog actually popped up: only ever once.
        void api.putPrefs({ credentialGuideSeen: true }).catch(() => undefined);
      } catch {
        // A failed fetch doesn't affect the rest of the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Self-heal: the server returned a new session_id, update the route and list (shared by tasks and compact).
  const syncHealedSessionId = useCallback(
    async (currentId: string, respondedId: string) => {
      if (respondedId === currentId) return;
      await reloadSessions();
      navigate(`/chat/${respondedId}`, { replace: true });
    },
    [reloadSessions, navigate],
  );

  const onSend = useCallback(
    async (input: TaskInputPart[]): Promise<boolean> => {
      if (!selected) return false;
      try {
        const res = await api.postTask(selected.sessionId, { input });
        discardSessionDraft();
        await syncHealedSessionId(selected.sessionId, res.sessionId);
        return true;
      } catch (e) {
        // Returning false -> the input area keeps the draft, letting the user fix it and resend (the error copy includes the session model's upstream id).
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return false;
      }
    },
    [selected, discardSessionDraft, syncHealedSessionId],
  );

  // @ handoff: doesn't use the current Session — creates a new chat for the @-mentioned agent
  // (approval mode carries over from the input area's current value; model/Workspace use the
  // creation defaults). The first input = a <handoff_from> source block (current agent / Session
  // / Workspace info) + the user's input and images with the @ mention stripped; jumps to the new
  // chat once sent.
  // Returns false on failure, keeping the draft so it can be resent (deletes the empty Session that never got its first message sent).
  const onHandoff = useCallback(
    async (target: AgentSummary, input: TaskInputPart[]): Promise<boolean> => {
      if (!projectId || !currentAgent || !selected) return false;
      const origin: TaskInputPart = {
        type: "text",
        text: handoffMessage({
          agentId: currentAgent.agentId,
          ...(currentAgent.name !== undefined ? { agentName: currentAgent.name } : {}),
          sessionId: selected.sessionId,
          workspace: selected.workspace,
          ...(selected.title !== undefined ? { sessionTitle: selected.title } : {}),
        }),
      };
      let createdId: string | null = null;
      try {
        const created = await api.createSession(projectId, target.agentId, {
          approvalMode: selected.approvalMode,
        });
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input: [origin, ...input] });
        addSession(created.session);
        // The text body has been handed off into the new chat: discard the current session's input draft along with it.
        discardSessionDraft();
        navigate(`/chat/${res.sessionId}`);
        return true;
      } catch (e) {
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        // The new chat uses the project's default model (createSession doesn't specify a model reference), so the error copy's model context follows suit.
        toastError(
          apiErrorText(e, models?.defaultModel ? { modelId: models.defaultModel.modelId } : {}),
        );
        return false;
      }
    },
    [projectId, currentAgent, selected, addSession, discardSessionDraft, navigate, models],
  );

  const onStop = useCallback(async () => {
    if (!selected) return;
    await api.postAbort(selected.sessionId).catch(() => undefined);
  }, [selected]);

  const onApprove = useCallback(
    async (toolCallId: string, decision: "allow" | "deny", origin: string[]) => {
      if (!selected) return;
      // A decision clicked locally is marked "manual"; removed from the pending table keyed by the origin composite key.
      stream.markLocalDecision(toolCallId);
      const key = approvalKey(origin, toolCallId);
      try {
        await api.postApproval(selected.sessionId, toolCallId, { decision });
        stream.resolveApproval(key);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) stream.resolveApproval(key);
      }
    },
    [selected, stream],
  );

  const onChangeApprovalMode = useCallback(
    (mode: ApprovalMode) => {
      if (!selected || modeSaving) return;
      setModeSaving(true);
      void api
        .patchSession(selected.sessionId, { approvalMode: mode })
        .then((res) => replace(res.session))
        .catch((e: unknown) => {
          toastError(apiErrorText(e));
        })
        .finally(() => setModeSaving(false));
    },
    [selected, modeSaving, replace],
  );

  const onCompact = useCallback(async () => {
    if (!selected) return;
    try {
      // compact shares get-or-resume-or-heal with tasks: it can likewise self-heal to a new session_id.
      const res = await api.postCompact(selected.sessionId);
      await syncHealedSessionId(selected.sessionId, res.sessionId);
    } catch (e) {
      toastError(apiErrorText(e, { modelId: selected.modelId }));
    }
  }, [selected, syncHealedSessionId]);

  // "New Chat" = enter draft state: no Session is created until the first message is sent.
  const newChat = useCallback(() => {
    navigate(`/chat/${DRAFT_SESSION_ID}`);
  }, [navigate]);

  // Real-time cost for this turn: converts the Task's bucketed usage using the session Model's
  // (paired reference) current pricing; null if no pricing is configured.
  const modelPricing = models?.models.find((m) => sameModelRef(m, activeModelRef))?.pricing;
  const ctx: StreamRenderContext = {
    pendingApprovals: stream.pendingApprovals,
    onApprove,
    origin: [],
    // Any non-idle state (running / compacting) counts as "not yet stopped": compaction can
    // happen mid-turn, and if only running were checked, the trailing group would flash
    // "finished running" during compaction before flipping back to "running".
    taskRunning: stream.taskState !== "idle",
    taskCost: (stats) => {
      if (!modelPricing) return null;
      const b = stats.tokensByBucket;
      return (
        (b.cacheRead * modelPricing.cacheRead +
          b.cacheWrite * modelPricing.cacheWrite +
          b.output * modelPricing.output) /
        1e6
      );
    },
    onOpenFile: (path) => {
      // The file card has already normalized the text path to a Workspace-relative path
      // (toWorkspaceRelative, including stripping absolute-path prefixes and converting Windows
      // separators), so this just opens the panel and navigates to it directly.
      filesPanel.setOpen(true);
      filesPanel.browsePath(path);
    },
    workspace: selected?.workspace ?? null,
    statFiles,
  };

  if (!projectId || !agentId) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }

  const totalTokens = stream.model.stats.sessionTotal + stream.model.stats.subagentTotal;
  const modelInfo = models?.models.find((m) => sameModelRef(m, activeModelRef));
  const contextWindow = modelInfo?.contextWindow;
  // Assumed supported by default: only models explicitly marked vision=false show a blocking hint when adding images.
  const vision = modelInfo?.vision !== false;
  const emptyChat =
    selected !== null && !stream.loading && !stream.error && stream.model.items.length === 0;

  // Input area in session state: Agent / Workspace / Model are already locked by the Session
  // (the model selector isn't rendered; models is only used to look up the locked model's
  // provider logo and display name for a read-only display) — only approval mode can still be
  // changed (saved immediately on change).
  const input = selected && (
    <ChatInput
      status={stream.taskState}
      onSend={onSend}
      onStop={onStop}
      onCompact={onCompact}
      modelRef={activeModelRef}
      {...(models !== null ? { models: models.models } : {})}
      sessionThinkingLevel={stream.model.thinkingLevel}
      {...(contextWindow !== undefined ? { contextWindow } : {})}
      contextNow={stream.model.stats.contextNow}
      contextStale={stream.model.stats.contextStale}
      vision={vision}
      approvalMode={selected.approvalMode}
      onChangeApprovalMode={onChangeApprovalMode}
      modeSaving={modeSaving}
      autoFocus
      agents={agents}
      skills={agentSkills}
      {...(sessionDraft.skills && sessionDraft.skills.length > 0
        ? { initialSkills: sessionDraft.skills }
        : {})}
      onSkillsChange={onDraftSkillsChange}
      onHandoff={onHandoff}
      initialText={sessionDraft.text ?? ""}
      onTextChange={onDraftTextChange}
      {...(sessionDraft.handoffAgentId
        ? { initialHandoffTargetId: sessionDraft.handoffAgentId }
        : {})}
      onHandoffTargetChange={onDraftHandoffChange}
    />
  );

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
      {/* Thin top toolbar */}
      {selected && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="flex min-w-0 text-[15px] font-semibold">
              <Truncated text={selected.title ?? S.chat.defaultSessionTitle} />
            </h1>
            {/* Running indicator (placed to the right of the title); the compacting state is shown separately by the compaction banner within the message stream, not repeated here. */}
            {stream.taskState === "running" && (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {S.chat.statusRunning}
              </span>
            )}
          </div>

          {/* Stats: Token / cost / elapsed time (icon + title for the full meaning) */}
          <div className="hidden items-center gap-3 sm:flex">
            <StatChip
              icon={STAT_ICONS.tokens}
              value={humanizeTokens(totalTokens)}
              label={`${S.chat.statTokens}（Token）`}
            />
            {/* When there's no cost (the Model has no pricing configured), don't render this stat
                at all, rather than showing a "—" — that would take up space while saying
                nothing, only making people think the cost is zero or something's broken. */}
            {sessionCost != null && (
              <StatChip
                icon={STAT_ICONS.cost}
                value={`${formatMoney(sessionCost, currency)}${costUncosted ? " *" : ""}`}
                label={`${S.common.cost}（${currency}）${costUncosted ? ` · ${S.usage.uncostedNote}` : ""}`}
              />
            )}
            <StatChip
              icon={STAT_ICONS.elapsed}
              value={humanizeDuration(stream.model.stats.sessionElapsedMs)}
              label={S.chat.statElapsed}
            />
          </div>

          {/* Files panel toggle: docks on the right of the chat instead of replacing it full-screen (use-files-panel.ts). */}
          <button
            type="button"
            aria-expanded={filesPanel.open}
            onClick={() => filesPanel.setOpen(!filesPanel.open)}
            title={S.chat.openWorkspace}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 ${
              filesPanel.open
                ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            }`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden
            >
              <path d={STAT_ICONS.folder} />
            </svg>
            {S.chat.openWorkspace}
          </button>

          {/* Details popup: Model / Workspace / created time / stats */}
          <Dropdown
            open={infoOpen}
            setOpen={setInfoOpen}
            menuClass="right-0 top-full mt-1 w-80 max-w-[calc(100vw-1.5rem)] origin-top-right"
            button={
              <button
                type="button"
                title={S.chat.infoPanel}
                onClick={() => setInfoOpen(!infoOpen)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5m0-8h.01" />
                </svg>
              </button>
            }
          >
            <div className="space-y-3 px-3.5 py-2.5 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {S.chat.model}
                </p>
                {/* Paired display: upstream model_id + provider name (two separate fields on the Session DTO). */}
                <p className="truncate text-xs">
                  <span className="font-mono">{selected.modelId}</span>
                  <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                    {providerInfo(selected.provider)?.label ?? selected.provider}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {S.chat.workspace}
                </p>
                <p className="break-all font-mono text-xs leading-5">{selected.workspace}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {S.common.created}
                </p>
                <p className="font-mono text-xs">{formatDateTime(selected.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {S.chat.sessionStats}
                </p>
                {/* Same as above: if there's no cost, the whole item is omitted, not left as "Cost —". */}
                <p className="font-mono text-xs">
                  {S.chat.statTokens} {humanizeTokens(totalTokens)}
                  {sessionCost != null &&
                    ` · ${S.common.cost} ${formatMoney(sessionCost, currency)}`}{" "}
                  · {S.chat.statElapsed} {humanizeDuration(stream.model.stats.sessionElapsedMs)}
                </p>
              </div>
            </div>
          </Dropdown>
        </div>
      )}

      {/* Body: chat column + the docked Files panel on the right (message file cards jump to and locate a file in the tree via onOpenFile). */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {draft ? (
            // Draft state: DraftView's vertically centered input card + Agent / Workspace
            // selection panel; the Session is only created once the first message is sent. Keyed
            // by Project: switching Project remounts and switches to that Project's draft cache
            // (Agent selection happens inside the draft itself, so it's no longer part of the key).
            <DraftView key={`draft:${projectId}`} projectId={projectId} models={models} />
          ) : (
            // Keyed by Session: the whole block does a light fade-in when switching sessions.
            <div
              key={selected?.sessionId ?? "empty"}
              className="anim-fade flex min-h-0 flex-1 flex-col"
            >
              {selected ? (
                stream.error ? (
                  // History failed to load: show a clear error and a retry entry point, instead of staying on a misleading empty state.
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {S.chat.historyLoadFailed}：{stream.error}
                    </p>
                    <Button onClick={stream.retry}>{S.common.retry}</Button>
                  </div>
                ) : stream.loading ? (
                  <div className="space-y-3 p-6">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-1/2" />
                  </div>
                ) : (
                  // The empty state shares the same structure as the message stream (message
                  // area + bottom input area): only the message area's content differs, and
                  // ChatInput always mounts in the same JSX slot, so it isn't unmounted and
                  // recreated when the first message arrives (preserving draft/focus).
                  <>
                    <div className="min-h-0 flex-1">
                      {emptyChat ? (
                        <div className="flex h-full items-center justify-center px-4">
                          <p className="text-lg font-medium text-gray-400 dark:text-gray-500">
                            {S.chat.emptyGreeting}
                          </p>
                        </div>
                      ) : (
                        <MessageStream
                          items={stream.model.items}
                          version={stream.version}
                          ctx={ctx}
                        />
                      )}
                    </div>
                    <div className="shrink-0 border-t border-gray-200 bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800 dark:bg-gray-950">
                      <div className="mx-auto max-w-3xl">{input}</div>
                    </div>
                  </>
                )
              ) : sessionsLoading ? (
                <div className="space-y-3 p-6">
                  <Skeleton className="h-5 w-1/2" />
                </div>
              ) : (
                <EmptyState
                  title={S.chat.noSessions}
                  action={<Button onClick={newChat}>{S.nav.newChat}</Button>}
                />
              )}
            </div>
          )}
        </div>

        {selected && <FilesPanel session={selected} panel={filesPanel} />}
      </div>

      <Modal
        open={credentialGuide}
        title={S.project.noCredentialTitle}
        onClose={() => setCredentialGuide(false)}
        footer={
          <>
            <Button onClick={() => setCredentialGuide(false)}>{S.project.later}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setCredentialGuide(false);
                navigate("/models");
              }}
            >
              {S.project.goToModels}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.noCredentialBody}</p>
      </Modal>
    </div>
  );
}
