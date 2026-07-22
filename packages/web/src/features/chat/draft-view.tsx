/**
 * Draft view (/chat/new): the pre-persistence form of a new
 * conversation, before any Session exists. The input card sits vertically centered;
 * before sending, this is where Agent / Workspace / approval mode / Model are all
 * chosen in one place — two small dropdown pills sit right below the card (pill
 * buttons, styled after ChatGPT's project picker): Agent selection and Workspace
 * directory selection (the menu browses server-side directories, and the current
 * path can be edited directly); the model picker lives in the input card's bottom
 * toolbar, left of the send button (with a vendor logo). The Session is only
 * created when **the first message is sent**; once created, Agent / Workspace /
 * Model are locked in via meta, and only approval mode remains editable (in the
 * session-mode input area).
 *
 * Draft auto-cache (storage and validation in draft-cache.ts; keys are isolated by
 * "user × Project", #68): the four selections are saved as soon as they change;
 * body text is keystroke-frequent and deferred/coalesced (if there's an unsaved
 * change before unmount, one final write is flushed) — closing and returning to
 * the page resumes where you left off; on successful send the cache clears, except
 * the model selection, which carries over as the next conversation's default
 * (switch-becomes-default, mirroring the thinking level persisting on the Agent).
 * The sidebar group header "+" / menu "New conversation" explicitly specify an
 * Agent via route state (overriding the cached selection); a direct visit or
 * refresh falls back to the cache.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type {
  AgentModelConfigDto,
  AgentSummary,
  ApprovalMode,
  DirListResponse,
  ModelRefDto,
  ModelsResponse,
  SessionCreateRequest,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { Dropdown } from "../../components/ui/dropdown";
import { PenguinLogo } from "../../components/ui/penguin-logo";
import { toastError } from "../../components/ui/toast";
import { ChatInput } from "./chat-input";
import { buildSkillsMessage } from "./skill-use";
import { clearDraft, draftKey, loadDraft, saveDraft } from "./draft-cache";
import type { DraftCache } from "./draft-cache";
import { handoffMessage } from "./agent-mentions";
import { sameModelRef } from "../models/model-grouping";

/** Coalescing window for writing body text to the cache: keystrokes are frequent, so a short batch accumulates before persisting (option changes are still written immediately). */
const DRAFT_SAVE_DEBOUNCE_MS = 300;

/**
 * Example tasks on the draft screen, in display order (game card first, LoL music player,
 * then the RAG build). Copy lives in S.chat.exampleTasks[id]; skills are pinned via a
 * `<use_skills>` block — only those the selected Agent actually has installed are included,
 * so the block never references a skill the agent can't read.
 */
const EXAMPLE_TASKS: { id: "game" | "lol" | "rag"; skills: string[] }[] = [
  { id: "game", skills: ["web-design"] },
  { id: "lol", skills: ["web-design"] },
  { id: "rag", skills: ["penguin-sdk", "web-design"] },
];

export function DraftView({
  projectId,
  models,
}: {
  projectId: string;
  /** Project model config (already fetched by ChatPage): candidate list and default model. */
  models: ModelsResponse | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, currentAgent, setCurrentAgentId } = useProject();
  const { add } = useSessions();
  // The draft key includes a user dimension (#68 cross-account leakage). RequireAuth
  // guarantees the user is logged in here; on the off chance there's no user (the
  // type allows null), it's better to disable caching entirely than to read/write a
  // key that isn't account-scoped.
  const userId = useAuth().user?.userId ?? null;

  // The cache is read only once, on mount: the component remounts keyed by Project,
  // so switching Projects automatically switches to the corresponding draft; switching
  // accounts always goes through logout (clearing the user unmounts the whole route
  // tree), so logging back in is likewise a fresh mount.
  const [cached] = useState<DraftCache>(() =>
    userId ? loadDraft(draftKey(userId, projectId)) : {},
  );

  const [agentId, setAgentId] = useState<string | null>(
    cached.agentId ?? currentAgent?.agentId ?? null,
  );
  const [workspace, setWorkspace] = useState(cached.workspace ?? "");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    cached.approvalMode ?? "allow-all",
  );
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(cached.modelRef ?? null);
  /** @-handoff target (chip): draft content just like the body text, cached alongside it (fed in via the ChatInput callback). */
  const [handoffAgentId, setHandoffAgentId] = useState<string | null>(
    cached.handoffAgentId ?? null,
  );
  const textRef = useRef(cached.text ?? "");
  /**
   * Selected skills (prefilled by "quick invoke" from the Skills page + checked in
   * the input area): passed to ChatInput as the initial selection via initialSkills
   * on mount, then written back through onSkillsChange and persisted immediately
   * (discrete clicks) — survives a refresh; cleared along with the whole draft on
   * successful send, kept on failure so it can be resent.
   */
  const skillsRef = useRef<string[]>(cached.skills ?? []);

  // Unified resolution of the Agent selection (a single effect, single writer):
  // explicit route state > current valid value (from cache / panel selection) >
  // default_agent > the first one. Explicit intent (sidebar group header "+" / menu
  // "New conversation") is applied only once per location.key — clicking "+" again
  // for the same Agent gets a new key and re-aligns, while the user's subsequent
  // reselection in the panel won't keep getting overridden. Merging this into one
  // effect is essential: splitting it into an "apply state" effect and a "fallback
  // on invalid value" effect would let the former write B in one render while the
  // latter, still judging by the stale closure's invalid value, writes the default
  // Agent and clobbers B.
  const stateAgentId = (location.state as { agentId?: string } | null)?.agentId;
  const appliedStateKey = useRef<string | null>(null);
  useEffect(() => {
    if (agents.length === 0) return; // list not ready yet, nothing to validate against — wait for the next pass
    const valid = (id: string | null | undefined): id is string =>
      !!id && agents.some((a) => a.agentId === id);
    if (stateAgentId && appliedStateKey.current !== location.key) {
      appliedStateKey.current = location.key;
      if (valid(stateAgentId)) {
        setAgentId(stateAgentId);
        return;
      }
    }
    if (valid(agentId)) return;
    setAgentId((agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId ?? null);
  }, [agents, agentId, location.key, stateAgentId]);

  // Model fallback: once config is ready, if nothing is selected or the selection is no longer valid, fall back to the project default → the first model (always as a paired reference).
  useEffect(() => {
    if (!models) return;
    if (modelRef && models.models.some((m) => sameModelRef(m, modelRef))) return;
    const first = models.models[0];
    setModelRef(
      models.defaultModel ?? (first ? { provider: first.provider, modelId: first.modelId } : null),
    );
  }, [models, modelRef]);

  // —— Conversation-time thinking level (backed by the Agent settings) ——
  // Shows the selected Agent's current `model.thinking_level` ("" = no override); picking a
  // level immediately persists it via the agent-config API (the PUT carries only that key —
  // the server merges per-key into the YAML, so nothing else is clobbered). The session created
  // on first send reads systemConfig fresh, so it runs with the picked level, which also
  // becomes the Agent's new default. Refetched whenever the draft's Agent changes; while
  // loading (or after a failed fetch) the picker stays disabled (null).
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);
  useEffect(() => {
    setThinkingLevel(null);
    if (!agentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, agentId)
      .then((res) => {
        if (!cancelled) setThinkingLevel(res.config.model?.thinkingLevel ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);
  /** Live mirror for the rollback value (a stale closure would roll back to an outdated level). */
  const thinkingRef = useRef<string | null>(null);
  thinkingRef.current = thinkingLevel;
  const onChangeThinkingLevel = useCallback(
    (level: string) => {
      // "" (no override) is not persistable through the config API — the picker disables that row.
      if (!agentId || !level) return;
      const rollback = thinkingRef.current;
      setThinkingLevel(level); // Optimistic: the picker reflects the choice immediately.
      api
        .putAgentConfig(projectId, agentId, {
          config: { model: { thinkingLevel: level as AgentModelConfigDto["thinkingLevel"] } },
        })
        .catch((e: unknown) => {
          setThinkingLevel(rollback);
          toastError(e instanceof ApiError ? e.message : S.common.unknownError);
        });
    },
    [projectId, agentId],
  );

  // Skills installed on the currently selected Agent (candidates for the input
  // area's skills dropdown): switching Agents first clears the list (which also
  // clears the selection in the input area), then refetches; a fetch failure is
  // silently treated as no skills. Clearing preserves the reference when already
  // empty (doesn't swap in a new array): swapping the reference on the very first
  // mount render would trigger ChatInput's pruning effect and wrongly clear the
  // quick-invoke preselection.
  const [agentSkills, setAgentSkills] = useState<SkillMetadataItem[]>([]);
  /** Whether the skills fetch for the current Agent has settled — the example task waits for it so its `<use_skills>` pinning doesn't silently depend on network timing. */
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  useEffect(() => {
    setAgentSkills((prev) => (prev.length > 0 ? [] : prev));
    setSkillsLoaded(false);
    if (!agentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, agentId)
      .then((res) => {
        if (!cancelled) setAgentSkills(res.skills);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSkillsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);

  // —— Auto-cache ——
  // Options (Agent / Workspace / approval mode / Model) are discrete clicks: written
  // immediately on change; body text is keystroke-frequent: debounced trailing write,
  // with a final flush on unmount if there's an unsaved change.
  const saveTimer = useRef<number | null>(null);
  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const persistNow = useCallback(() => {
    cancelPendingSave();
    if (!userId) return;
    const data: DraftCache = { text: textRef.current, workspace, approvalMode };
    if (agentId) data.agentId = agentId;
    if (modelRef) data.modelRef = modelRef;
    if (handoffAgentId) data.handoffAgentId = handoffAgentId;
    if (skillsRef.current.length > 0) data.skills = skillsRef.current;
    saveDraft(draftKey(userId, projectId), data);
  }, [
    cancelPendingSave,
    userId,
    projectId,
    agentId,
    workspace,
    approvalMode,
    modelRef,
    handoffAgentId,
  ]);

  // The timer and unmount cleanup read persistNow via a ref to always get the **latest version**: a stale closure would write back outdated options.
  const persistRef = useRef(persistNow);
  useEffect(() => {
    persistRef.current = persistNow;
    // Write immediately on option change (also writes once on mount, idempotently).
    persistNow();
  }, [persistNow]);

  const onTextChange = useCallback(
    (text: string) => {
      textRef.current = text;
      cancelPendingSave();
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        persistRef.current();
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [cancelPendingSave],
  );

  /** Skill checklist change: writes back to the ref and persists immediately (discrete click, same convention as Agent/Model and other options). */
  const onSkillsChange = useCallback((names: string[]) => {
    skillsRef.current = names;
    persistRef.current();
  }, []);

  // Unmount: if there's still unsaved body text, flush it (so a route change/page switch doesn't lose the last few keystrokes).
  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        persistRef.current();
      }
    },
    [],
  );

  /**
   * Discard the draft after a successful send: first cancels the pending save timer, otherwise
   * it would write the just-cleared draft back. The **model selection carries over** as the
   * next conversation's default (review: switching the model, like switching the thinking
   * level, makes the switched-to value the new default — the level persists on the Agent
   * config, the model here in the per-user draft cache); everything else clears.
   */
  const discardDraft = useCallback(() => {
    cancelPendingSave();
    // Clear the preselected skills too: any subsequent write (e.g. the unmount flush) must not resurrect a selection that's already been sent.
    skillsRef.current = [];
    if (!userId) return;
    if (modelRef) saveDraft(draftKey(userId, projectId), { modelRef });
    else clearDraft(draftKey(userId, projectId));
  }, [cancelPendingSave, userId, projectId, modelRef]);

  const selectAgent = (a: AgentSummary) => {
    setAgentId(a.agentId);
    // Follow through to the global current Agent: keeps the sidebar memory and stats convention consistent.
    setCurrentAgentId(a.agentId);
  };

  // One in-flight guard shared by every send entry point (composer send / example task /
  // @-handoff): a second submission while one is running would create a second Session with
  // its own first task and a racing navigation. The ref is the synchronous guard; the state
  // drives disabled styling on the example button (the composer has its own busy state).
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // First message sent: only now is the Session created (Agent / Workspace / Model / approval
  // mode are all locked in together), then the route jumps once sent; returns false on any
  // failure, so the input area keeps the draft and can resend. `keepDraft` is set by sends
  // that did not consume the composer text (the example task), so a typed-but-unsent draft
  // survives the navigation instead of being silently discarded.
  const onSend = useCallback(
    async (input: TaskInputPart[], keepDraft = false): Promise<boolean> => {
      if (!agentId || sendingRef.current) return false;
      sendingRef.current = true;
      setSending(true);
      let createdId: string | null = null;
      try {
        const body: SessionCreateRequest = { approvalMode };
        // Model reference is submitted as a pair (provider + modelId; falls back to the Project default when not set).
        if (modelRef) {
          body.modelId = modelRef.modelId;
          body.provider = modelRef.provider;
        }
        if (workspace.trim()) body.workspace = workspace.trim();
        const created = await api.createSession(projectId, agentId, body);
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input });
        add(created.session);
        if (!keepDraft) discardDraft();
        navigate(`/chat/${res.sessionId}`, { replace: true });
        return true;
      } catch (e) {
        // The Session was created but the first message failed to send (postTask failed): delete
        // this empty Session, otherwise every resend attempt would create another one, piling up
        // empty sessions with no messages in the sidebar (best-effort cleanup).
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        toastError(apiErrorText(e, modelRef ? { modelId: modelRef.modelId } : {}));
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [projectId, agentId, approvalMode, modelRef, workspace, add, discardDraft, navigate],
  );

  // Example tasks: one click submits the canned prompt exactly like a hand-typed send (the
  // busy id drives the clicked card's spinner; the shared in-flight guard and all failure
  // handling live in onSend). keepDraft: an example never consumes the composer text, so a
  // typed-but-unsent draft must survive. The selected model / Workspace / approval mode apply as-is.
  const [exampleBusy, setExampleBusy] = useState<"game" | "lol" | "rag" | null>(null);
  const runExample = useCallback(
    async (task: (typeof EXAMPLE_TASKS)[number]) => {
      if (exampleBusy !== null) return;
      setExampleBusy(task.id);
      try {
        const names = task.skills.filter((n) => agentSkills.some((s) => s.name === n));
        await onSend(
          [{ type: "text", text: buildSkillsMessage(names, S.chat.exampleTasks[task.id].prompt) }],
          true,
        );
      } finally {
        setExampleBusy(null);
      }
    },
    [exampleBusy, agentSkills, onSend],
  );

  // @ handoff: opens a new chat for the @-mentioned agent (approval mode carries over from the
  // draft's current value; model/Workspace use the creation defaults), first input =
  // <handoff_from> source block + the text and images with the @ mention stripped.
  const selectedAgent = agents.find((a) => a.agentId === agentId) ?? null;
  const onHandoff = useCallback(
    async (target: AgentSummary, input: TaskInputPart[]): Promise<boolean> => {
      if (!selectedAgent || sendingRef.current) return false;
      sendingRef.current = true;
      setSending(true);
      const origin: TaskInputPart = {
        type: "text",
        text: handoffMessage({
          agentId: selectedAgent.agentId,
          ...(selectedAgent.name !== undefined ? { agentName: selectedAgent.name } : {}),
        }),
      };
      let createdId: string | null = null;
      try {
        const created = await api.createSession(projectId, target.agentId, { approvalMode });
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input: [origin, ...input] });
        add(created.session);
        discardDraft();
        navigate(`/chat/${res.sessionId}`);
        return true;
      } catch (e) {
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        // The new chat uses the project's default model (createSession doesn't specify a model reference), so the error copy's model context follows suit.
        toastError(
          apiErrorText(e, models?.defaultModel ? { modelId: models.defaultModel.modelId } : {}),
        );
        return false;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [projectId, selectedAgent, approvalMode, add, discardDraft, navigate, models],
  );

  // Capability info for the currently selected model (vision/context window) switches instantly with the selection (matched by paired reference).
  const modelInfo = models?.models.find((m) => sameModelRef(m, modelRef));
  const contextWindow = modelInfo?.contextWindow;
  const vision = modelInfo?.vision !== false;

  return (
    <div className="anim-fade flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-6 md:px-4">
      {/*
       * Vertical layout: everything visible — brand, input card, ownership pills, example tasks —
       * lives in ONE block between two empty flex-1 spacers, so the block is centred and the free
       * space above and below it is exactly equal. The brand deliberately sits inside that block
       * rather than in the upper spacer: keeping it in the spacer made the upper gap shorter than
       * the lower one by the brand's own height, which pushed the card up the viewport and left
       * the slash menu — it opens upward, `bottom-full` — too little room, so it clipped against
       * the top of this scroll container. When the viewport is too short the spacers collapse to
       * nothing, the container's own py-6 keeps the content off the edges, and the page falls back
       * to natural scrolling.
       */}
      <div className="flex-1" />

      <div className="mx-auto w-full max-w-3xl">
        {/* Large brand logo + brand name + subtitle (e2e tests identify the draft page by this
            heading). The asset is square-cropped and the graphic already has a bit of built-in
            padding, so a small margin is enough to sit visually close to the title. */}
        <div className="mb-10 text-center">
          <PenguinLogo className="mx-auto mb-1 h-36 w-36 rounded-3xl" />
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {S.appName}
          </h1>
          <p className="mt-2 text-base text-gray-400 dark:text-gray-500">{S.chat.draftSubtitle}</p>
        </div>

        <ChatInput
          status="idle"
          onSend={onSend}
          onStop={async () => undefined}
          onCompact={async () => undefined}
          modelRef={modelRef}
          models={models?.models ?? []}
          onChangeModel={setModelRef}
          thinkingLevel={thinkingLevel}
          onChangeThinkingLevel={onChangeThinkingLevel}
          {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
          {...(contextWindow !== undefined ? { contextWindow } : {})}
          contextNow={0}
          vision={vision}
          approvalMode={approvalMode}
          onChangeApprovalMode={setApprovalMode}
          modeSaving={false}
          autoFocus
          agents={agents}
          skills={agentSkills}
          {...(cached.skills && cached.skills.length > 0 ? { initialSkills: cached.skills } : {})}
          onSkillsChange={onSkillsChange}
          onHandoff={onHandoff}
          initialText={cached.text ?? ""}
          onTextChange={onTextChange}
          {...(cached.handoffAgentId ? { initialHandoffTargetId: cached.handoffAgentId } : {})}
          onHandoffTargetChange={setHandoffAgentId}
        />

        {/* Ownership selection right below the card (small pill dropdowns, styled after ChatGPT's project picker button) */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AgentSelect agents={agents} selected={selectedAgent} onSelect={selectAgent} />
          <WorkspaceSelect projectId={projectId} workspace={workspace} onChange={setWorkspace} />
        </div>

        {/* Example tasks: one-click canned builds showing off the one-sentence → app flow,
            stacked vertically in display order on every viewport. Disabled until
            agents/models/skills are resolved (onSend would silently no-op without an Agent);
            hover only darkens the border, per the card convention. */}
        <div className="mt-6 flex flex-col items-stretch gap-2">
          {EXAMPLE_TASKS.map((task) => {
            const copy = S.chat.exampleTasks[task.id];
            return (
              <button
                key={task.id}
                type="button"
                disabled={exampleBusy !== null || sending || !skillsLoaded || !agentId || !models}
                onClick={() => void runExample(task)}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors duration-150 hover:border-gray-300 disabled:cursor-default disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
              >
                {/* 24×24 line icons (gamepad / music note / sparkle), consistent with the icon convention */}
                {task.id === "lol" ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="shrink-0 text-brand-500 dark:text-brand-400"
                    aria-hidden
                  >
                    <path
                      d="M9 18V6l11-2v12"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="6.5" cy="18" r="2.5" strokeWidth="1.7" />
                    <circle cx="17.5" cy="16" r="2.5" strokeWidth="1.7" />
                  </svg>
                ) : task.id === "game" ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="shrink-0 text-brand-500 dark:text-brand-400"
                    aria-hidden
                  >
                    <path
                      d="M6.7 6h10.6a4 4 0 0 1 3.97 3.56c.2 1.8.73 5.05.73 6.44a3 3 0 0 1-3 3c-1 0-1.5-.5-2-1l-1.4-1.4a2 2 0 0 0-1.42-.6H9.82a2 2 0 0 0-1.41.6L7 18c-.5.5-1 1-2 1a3 3 0 0 1-3-3c0-1.39.52-4.64.73-6.44A4 4 0 0 1 6.7 6z"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.5 11h4M8.5 9v4M15 12h.01M18 10h.01"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="shrink-0 text-brand-500 dark:text-brand-400"
                    aria-hidden
                  >
                    <path
                      d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {copy.label}
                  </span>
                  <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                    {copy.desc}
                  </span>
                </span>
                {exampleBusy === task.id ? (
                  <span className="ml-1 shrink-0 text-xs text-gray-400">{S.common.loading}</span>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="ml-1 shrink-0 text-gray-300 transition-colors duration-150 group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-400"
                    aria-hidden
                  >
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lower symmetric space — empty, so it matches the upper one exactly */}
      <div className="flex-1" />
    </div>
  );
}

/** Shared style for pill trigger buttons (ChatGPT project button style: small rounded pill + icon + short name + collapse arrow). */
const pillClass =
  "flex max-w-64 items-center gap-1.5 rounded-full border border-gray-300 bg-white py-1 pl-1.5 pr-2 " +
  "text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/** Agent selection (pill dropdown): avatar + name, menu opens downward with an internal scroll cap. */
function AgentSelect({
  agents,
  selected,
  onSelect,
}: {
  agents: AgentSummary[];
  selected: AgentSummary | null;
  onSelect: (agent: AgentSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="left-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] origin-top-left"
      button={
        <button
          type="button"
          title={S.chat.chooseAgent}
          aria-label={S.chat.chooseAgent}
          onClick={() => setOpen(!open)}
          className={pillClass}
        >
          {selected ? (
            <AgentAvatar id={selected.agentId} size={16} className="shrink-0 rounded" />
          ) : null}
          <span className="min-w-0 truncate">
            {selected ? agentDisplayName(selected) : S.common.loading}
          </span>
          <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
        </button>
      }
    >
      <div className="max-h-56 overflow-y-auto">
        {agents.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-gray-400">{S.common.loading}</p>
        )}
        {agents.map((a) => {
          const active = a.agentId === selected?.agentId;
          return (
            <button
              key={a.agentId}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onSelect(a);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <AgentAvatar id={a.agentId} size={20} className="shrink-0 rounded" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-xs ${
                    active
                      ? "font-medium text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {agentDisplayName(a)}
                </span>
                {a.description && (
                  <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
                    {a.description}
                  </span>
                )}
              </span>
              <span className="w-4 shrink-0 text-center text-xs text-gray-500 dark:text-gray-400">
                {active ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </Dropdown>
  );
}

/**
 * Workspace selection (pill dropdown): the button shows the selected directory name (empty =
 * auto temporary directory). The menu browses server-side directories: **the current path can be
 * edited directly** at the top (Enter/blur commits it, an invalid directory toasts and reverts
 * to the previous path), the list omits hidden directories, and the hint text sits at the bottom
 * of the menu; only loads on first expand.
 */
function WorkspaceSelect({
  projectId,
  workspace,
  onChange,
}: {
  projectId: string;
  workspace: string;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const browsedRef = useRef(false);

  const [dir, setDir] = useState<DirListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Edit draft for the path row: synced with the browsing position, reverts on a failed commit. */
  const [pathDraft, setPathDraft] = useState("");

  useEffect(() => {
    setPathDraft(dir?.path ?? "");
  }, [dir]);

  /** Browses level by level (clicking a directory/parent); an empty string means the server's home directory (the default starting point). */
  const loadDir = useCallback(
    (abs: string) => {
      setLoading(true);
      setError(null);
      api
        .listDirs(projectId, abs)
        .then(setDir)
        .catch((e: unknown) => setError(e instanceof ApiError ? e.message : S.common.unknownError))
        .finally(() => setLoading(false));
    },
    [projectId],
  );

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Only loads on first expand: an already-filled absolute path is used as the starting point, otherwise the server falls back to the home directory.
    if (next && !browsedRef.current) {
      browsedRef.current = true;
      const ws = workspace.trim();
      loadDir(ws.startsWith("/") ? ws : "");
    }
  };

  /** Commits the edited path: navigates to it if it exists, otherwise toasts and reverts to the current browsing position. */
  const commitPathEdit = async () => {
    const p = pathDraft.trim();
    if (!p || p === dir?.path) {
      setPathDraft(dir?.path ?? "");
      return;
    }
    try {
      setDir(await api.listDirs(projectId, p));
    } catch {
      toastError(S.chat.workspaceDirInvalid);
      setPathDraft(dir?.path ?? "");
    }
  };

  const trimmed = workspace.trim();
  // Pill short name: the last segment of the directory name (root gives "/"); shows "auto temp directory" when empty.
  const label = trimmed ? (trimmed.split("/").filter(Boolean).pop() ?? "/") : S.chat.workspaceAuto;
  const parentPath = dir?.parent ?? null;
  // Hidden directories (starting with .) are excluded from the list.
  const entries = (dir?.entries ?? []).filter((e) => !e.name.startsWith("."));
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="left-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] origin-top-left"
      button={
        <button
          type="button"
          title={trimmed ? `${S.chat.workspace}：${trimmed}` : S.chat.workspaceHint}
          aria-label={S.chat.workspace}
          onClick={toggle}
          className={pillClass}
        >
          {/* Folder icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="ml-0.5 shrink-0 text-gray-400"
            aria-hidden
          >
            <path
              d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className={`min-w-0 truncate ${trimmed ? "font-mono" : ""}`}>{label}</span>
          <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
        </button>
      }
    >
      <div className="space-y-1.5 px-2.5 pb-2.5 pt-2">
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          {/* Current path (editable: Enter/blur commits, Escape discards) + "Use this directory" (closes the menu once selected) */}
          <div className="flex items-center gap-1.5 border-b border-gray-100 px-1.5 py-1 dark:border-gray-800">
            <input
              value={pathDraft}
              placeholder="…"
              aria-label={S.chat.workspace}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={() => void commitPathEdit()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void commitPathEdit();
                } else if (e.key === "Escape") {
                  // Discard the edit: only reverts the draft; Escape bubbles up to Dropdown, which closes the menu.
                  setPathDraft(dir?.path ?? "");
                }
              }}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-gray-600 focus:border-gray-300 focus:outline-none dark:text-gray-300 dark:focus:border-gray-600"
            />
            <button
              type="button"
              disabled={!dir}
              onClick={() => {
                if (!dir) return;
                onChange(dir.path);
                setOpen(false);
              }}
              className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {S.chat.workspaceUseThis}
            </button>
          </div>
          {/* Directory list (excludes hidden directories) */}
          <ul className="max-h-40 overflow-y-auto py-1">
            {parentPath !== null && (
              <li>
                <button
                  type="button"
                  onClick={() => loadDir(parentPath)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  ↰ {S.chat.workspaceUp}
                </button>
              </li>
            )}
            {entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => loadDir(entry.path)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="shrink-0 text-gray-400"
                    aria-hidden
                  >
                    <path
                      d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              </li>
            ))}
            {dir && entries.length === 0 && (
              <li className="px-2.5 py-1.5 text-xs text-gray-400">{S.chat.workspaceNoSubdirs}</li>
            )}
            {loading && <li className="px-2.5 py-1.5 text-xs text-gray-400">{S.common.loading}</li>}
            {/* Load failure (e.g. the cached starting directory was deleted): provide "retry" to fall back to the home directory, avoiding getting stuck in an error state. */}
            {error && (
              <li className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-red-500">
                <span className="min-w-0 flex-1 truncate" title={error}>
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => loadDir("")}
                  className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {S.common.retry}
                </button>
              </li>
            )}
          </ul>
        </div>
        {/* When a directory has been specified, offer a one-click way back to the auto temp directory */}
        {trimmed && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {S.chat.workspaceClear}
          </button>
        )}
        {/* Hint text (bottom of the menu) */}
        <p className="px-0.5 text-xs leading-5 text-gray-400 dark:text-gray-500">
          {S.chat.workspaceHint}
        </p>
      </div>
    </Dropdown>
  );
}
