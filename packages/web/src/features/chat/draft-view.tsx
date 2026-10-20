/**
 * Draft view (/chat/new): the pre-persistence form of a new
 * conversation, before any Session exists. The page around the input card is the start
 * dashboard (start-dashboard.tsx: the brand and its counts above the card, the examples and
 * shortcuts below it); this module keeps the draft itself. Before sending,
 * this is where Agent / Workspace / approval mode / Model are all
 * chosen in one place — two small buttons sit right below the card: the Agent dialog and Workspace
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
 * The one thing that does not resume is a prompt a "Create with AI" surface composed
 * (`aiPrefill`, draft-cache.ts): nobody typed it, so leaving this page without editing
 * or sending it clears the slot exactly as a send would (see dropAiPrefill).
 * Every "New chat" entry point first rewrites the slot to the model carry-over and staged
 * skills, releasing whatever else an earlier visit left in the cache (prepareNewChatDraft,
 * new-chat.ts), then names in route state only what it is about: an Agent group's "+" or
 * an Agent card names its Agent, a Workspace group's "+" its path ("" = temporary
 * workspace), and the plain "New chat" names nothing. A direct visit or refresh keeps the
 * cache. Precedence per field: route state > draft cache > the Project's new-chat defaults
 * ([default_chat]) > built-in fallback (for the Agent: default_agent, then the first —
 * newChatAgentId); the model default already flows through models.defaultModel.
 *
 * Saving the Project's new-chat defaults resets the seeded selections so new chats pick
 * the change up: the project-settings dialog strips the cached pins (next visits reseed
 * from the fresh defaults) and dispatches a same-tab chat-defaults-changed event that a
 * MOUNTED draft answers by resetting Agent / Workspace / approval mode / Model in
 * component state (see onDefaultsChanged) — typed-but-unsent text and staged skills
 * always survive.
 */
import { browserState } from "../builtin-browser/browser-store";
import { adoptBrowserSession } from "../builtin-browser/browser-actions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import type {
  AgentModelConfigDto,
  AgentSummary,
  ApprovalMode,
  ChatDefaultsDto,
  ModelRefDto,
  ModelsResponse,
  SessionCreateRequest,
  SessionSandbox,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import { AgentSelect } from "../agents/agent-select";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { UNCONFINED, draftSandboxAfter } from "../../lib/permission-level";
import type { PermissionPick } from "../../lib/permission-level";
import { apiErrorText } from "../../lib/api-error";
import { rememberSessionMachine } from "../../lib/session-machines";
import { cachedMachineAgents, rememberMachineAgents } from "../../lib/machine-cache";
import { machineLink, remoteAgentsEmpty } from "../../lib/machine-link";
import type { MachineLink } from "../../lib/machine-link";
import { useMachines } from "../../state/machines";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { ChatInput } from "./chat-input";
import type { ComposerControl } from "./chat-input";
import { goalPluginGate } from "./goal-plugin-gate";
import { discardUnstartedSession } from "./unstarted-session";
import { APPROVAL_MODES } from "./approval-mode";
import { adoptDockScope } from "../dock/dock-state";
import { setDockConversation } from "../dock/dock-terminal";
import { StartDashboard } from "./start-dashboard";
import { clearDraft, draftKey, loadDraft, saveDraft } from "./draft-cache";
import type { DraftCache } from "./draft-cache";
import {
  DRAFT_FLUSH_EVENT,
  getDraftSession,
  removeDraftSession,
  saveDraftSession,
} from "./draft-sessions";
import {
  CHAT_DEFAULTS_CHANGED_EVENT,
  chatDefaultsChangedDetail,
  type ChatDefaultsChangedDetail,
} from "./chat-defaults-event";
import { newChatAgentId } from "./new-chat";
import { onPluginConfigSaved } from "../../lib/plugin-config-event";
import { effectiveThinkingLevel } from "./thinking-level";
import { WorkspaceSelect } from "./workspace-select";
import { FilesPanelToggle } from "./dock-toggles";
import { sameModelRef } from "../models/model-grouping";

/** Coalescing window for writing body text to the cache: keystrokes are frequent, so a short batch accumulates before persisting (option changes are still written immediately). */
const DRAFT_SAVE_DEBOUNCE_MS = 300;

/**
 * "Applied" markers for the route-state overrides (one slot per field, holding the last
 * consumed location.key). React Router persists location.state AND location.key in
 * history.state, which survives a full page reload, while a ref resets with the JS
 * context — with a ref alone, a reload would re-apply the override and clobber whatever
 * the user changed since (restored from the draft cache). sessionStorage is per-tab
 * exactly like history.state, so the marker follows the history entry; on storage
 * failure (private mode) both helpers degrade to "not consumed", and the in-component
 * ref still provides the previous apply-once-per-mount behavior.
 */
type RouteStateField = "agentId" | "workspace";
function loadAppliedRouteKey(field: RouteStateField): string | null {
  try {
    return sessionStorage.getItem(`penguin.chatRouteApplied.${field}`);
  } catch {
    return null;
  }
}
function saveAppliedRouteKey(field: RouteStateField, key: string): void {
  try {
    sessionStorage.setItem(`penguin.chatRouteApplied.${field}`, key);
  } catch {
    /* best-effort: the dedup marker falls back to the per-mount ref */
  }
}

export function DraftView({
  projectId,
  models,
  draftId,
  composerRef: pageComposerRef,
  onWorkspaceChange,
  onAgentChange,
}: {
  projectId: string;
  /**
   * The model config of the server the draft's workspace is on (ChatPage reads it: this server's,
   * or the machine's): candidate list and default model. A Session created on a machine can only
   * name a model that machine has.
   */
  models: ModelsResponse | null;
  /** Parked draft conversation id (`/chat/draft-…` — see draft-sessions.ts); absent = the ordinary active draft (`/chat/new`). */
  draftId?: string;
  /**
   * The page's handle on the composer, so what the dock's panels hand the conversation (the
   * Files panel's references) reaches this draft's composer as it reaches a live Session's.
   */
  composerRef?: RefObject<ComposerControl | null>;
  /** The Workspace picked here ("" = a temporary one) and its machine, for the Files panel. */
  onWorkspaceChange?: (path: string, machineId: string | null) => void;
  /** The resolved draft owner, including the machine whose Agent list was used. */
  onAgentChange?: (agentId: string | null, machineId: string | null) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents: localAgents, setCurrentAgentId } = useProject();
  /**
   * Agents on the machine the workspace is on. They are per-server: a Session created on
   * another machine can only name an Agent that exists THERE, so offering this machine's
   * list would offer choices that cannot be made. Empty while loading, which the validation
   * below already treats as "not ready" rather than "none".
   */
  const [remoteAgents, setRemoteAgents] = useState<AgentSummary[]>([]);
  /** Why a connected machine's list may be empty: still asking, or its answer was a failure. */
  const [remoteAgentsFailure, setRemoteAgentsFailure] = useState<string | null>(null);
  const { add, remove } = useSessions();
  // The draft key includes a user dimension (#68 cross-account leakage). RequireAuth
  // guarantees the user is logged in here; on the off chance there's no user (the
  // type allows null), it's better to disable caching entirely than to read/write a
  // key that isn't account-scoped.
  const userId = useAuth().user?.userId ?? null;

  // The cache is read only once, on mount: the component remounts keyed by Project (and
  // by parked-draft id), so switching Projects or parked drafts automatically switches to
  // the corresponding content; switching accounts always goes through logout (clearing
  // the user unmounts the whole route tree), so logging back in is likewise a fresh
  // mount. A parked draft reads its own entry instead of the active slot.
  const [parkedMissing] = useState(
    () =>
      draftId !== undefined && (!userId || getDraftSession(userId, projectId, draftId) === null),
  );
  const [cached] = useState<DraftCache>(() => {
    if (!userId) return {};
    if (draftId !== undefined) return getDraftSession(userId, projectId, draftId)?.draft ?? {};
    return loadDraft(draftKey(userId, projectId));
  });

  // A parked id that no longer exists (deleted in the sidebar, stale bookmark): fall
  // back to the plain new-chat draft instead of editing into a void.
  useEffect(() => {
    if (parkedMissing) navigate("/chat/new", { replace: true });
  }, [parkedMissing, navigate]);

  // Null until something names an Agent: the cache here, otherwise the resolution effect below
  // once the Agent list and the Project's defaults are in — never a stand-in it would swap out.
  const [agentId, setAgentId] = useState<string | null>(cached.agentId ?? null);
  const [workspace, setWorkspace] = useState(cached.workspace ?? "");
  /**
   * The machine that workspace is on (null = this one). Carried beside the path because a
   * path alone does not identify a directory: `/srv/app` exists on many machines and means
   * a different one on each.
   */
  const [workspaceMachine, setWorkspaceMachine] = useState<string | null>(cached.machineId ?? null);
  /** The Agents actually offerable for this draft: the target machine's, or this one's. */
  const agents = workspaceMachine === null ? localAgents : remoteAgents;
  /**
   * The workspace's machine as the Machines page sees it — connected, coming back, stopped —
   * from the one live account of the machines, so this composer and that page never disagree:
   * the Agents are asked for when the machine is connected, and asked again the moment it is.
   */
  const machines = useMachines();
  const remoteLink: MachineLink | null =
    workspaceMachine === null
      ? null
      : machineLink(machines.state, machines.settled, workspaceMachine);
  // The draft's docks belong to no Session yet, so they offer no terminal; the Workspace
  // chosen here is still theirs (the Files panel, the sidebar's "browse files"). "" is the
  // temporary Workspace, whose directory the server only creates with the Session.
  useEffect(() => {
    setDockConversation({
      sessionId: null,
      workspace: workspace || null,
      machineId: workspaceMachine,
    });
    onWorkspaceChange?.(workspace, workspaceMachine);
  }, [workspace, workspaceMachine, onWorkspaceChange]);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    cached.approvalMode ?? "allow-all",
  );
  // Only what the person picked: the rest follows the server's sandbox settings, which the
  // chat-defaults response carries, so the button shows what the Session would start with.
  const [sandboxPick, setSandboxPick] = useState<Partial<SessionSandbox>>(cached.sandbox ?? {});
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(cached.modelRef ?? null);
  const textRef = useRef(cached.text ?? "");
  /**
   * The text came from a "Create with AI" surface rather than a keyboard (`aiPrefill`,
   * draft-cache.ts): it seeded this draft and dies with it. The mark rides in the cache so a
   * reload restores the same prefilled draft, and it is dropped by the first edit — from then on
   * the text is the user's and is cached, parked and kept exactly like any other draft.
   */
  const aiPrefillRef = useRef(cached.aiPrefill === true);
  /**
   * Selected skills (prefilled by "quick invoke" from the Skills page + checked in
   * the input area): passed to ChatInput as the initial selection via initialSkills
   * on mount, then written back through onSkillsChange and persisted immediately
   * (discrete clicks) — survives a refresh; cleared along with the whole draft on
   * successful send, kept on failure so it can be resent.
   */
  const skillsRef = useRef<string[]>(cached.skills ?? []);

  // —— Project new-chat defaults ([default_chat]) ——
  // Fetched once per Project mount (fail-soft: an error reads as "no defaults", so the
  // draft keeps working). They prefill the seams below with the precedence
  // route location.state > mount-time draft cache > project default > built-in fallback;
  // null = still loading (the thinking picker below stays disabled until resolved).
  const [chatDefaults, setChatDefaults] = useState<ChatDefaultsDto | null>(null);
  /**
   * Set once the chat-defaults-changed event delivered a fresh block (see the reseed
   * handler below): from then on the mount-time fetch must not apply — it was started
   * earlier and would overwrite the fresher event payload when it resolves.
   */
  const defaultsFromEventRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    api
      .getChatDefaults(projectId)
      .then((res) => {
        if (!cancelled && !defaultsFromEventRef.current) setChatDefaults(res);
      })
      .catch(() => {
        if (!cancelled && !defaultsFromEventRef.current) setChatDefaults({});
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * Fields the user already touched this mount: the project defaults arrive async (after
   * mount), and an explicit pick made in the meantime must never be clobbered by them.
   * The mount-time cache (`cached`) covers everything picked in PREVIOUS visits; these
   * refs cover the window between mount and the defaults resolving. The Agent needs no flag:
   * the resolution below never replaces a valid selection.
   */
  const touchedRef = useRef({ workspace: false, approval: false });

  // Unified resolution of the Agent selection (a single effect, single writer):
  // explicit route state > current valid value (from cache / panel selection) > the
  // new-chat default Agent (newChatAgentId: the Project's `[default_chat].agent_id`, then
  // default_agent, then the first one), which waits for the Project's defaults to resolve.
  // Explicit intent (an Agent group's "+", an Agent card) is applied only once per
  // location.key — clicking "+" again for the same Agent gets a new key and re-aligns, while
  // the user's subsequent reselection in the panel won't keep getting overridden. Merging
  // this into one effect is essential: splitting it into an "apply state" effect and a
  // "fallback on invalid value" effect would let the former write B in one render while the
  // latter, still judging by the stale closure's invalid value, writes the default Agent and
  // clobbers B.
  const routeState = location.state as {
    agentId?: string;
    workspace?: string;
    machineId?: string;
  } | null;
  const stateAgentId = routeState?.agentId;
  // Read here rather than beside their own effect below: the Agent resolution waits on them
  // (see `routeMachineSettled`), and a dependency array is evaluated during the render that
  // declares it.
  const stateWorkspace = routeState?.workspace;
  const stateMachineId = routeState?.machineId;
  const appliedStateKey = useRef<string | null>(null);
  useEffect(() => {
    if (agents.length === 0) return; // list not ready yet, nothing to validate against — wait for the next pass
    const valid = (id: string | null | undefined): id is string =>
      !!id && agents.some((a) => a.agentId === id);
    // The route may name an Agent that only exists on the machine it names alongside it (the
    // Agents page offers a new chat on a machine's own Agent). That machine is applied by the
    // Workspace effect below, one render later, and its Agents are fetched after that — so
    // this pass would validate the id against THIS server's list, reject it, and spend the
    // one-shot key on the fallback Agent, which is then what the Session is created with.
    // Nothing is decided until the list being validated against is the one the route asked
    // for. A machine named without a path is never applied at all (the machine travels with
    // the path), so it cannot hold this up.
    const routeMachineSettled =
      stateMachineId === undefined ||
      stateWorkspace === undefined ||
      workspaceMachine === stateMachineId;
    if (
      stateAgentId &&
      appliedStateKey.current !== location.key &&
      loadAppliedRouteKey("agentId") !== location.key
    ) {
      if (!routeMachineSettled) return;
      appliedStateKey.current = location.key;
      saveAppliedRouteKey("agentId", location.key);
      if (valid(stateAgentId)) {
        setAgentId(stateAgentId);
        return;
      }
    }
    if (valid(agentId)) return;
    // Nothing names a valid Agent (no route override, no cached or picked one, or the one
    // there was is gone): the new-chat default, once the Project's defaults are known.
    if (chatDefaults === null) return;
    setAgentId(newChatAgentId(agents, chatDefaults));
  }, [
    agents,
    agentId,
    location.key,
    stateAgentId,
    stateMachineId,
    stateWorkspace,
    workspaceMachine,
    chatDefaults,
  ]);

  // Explicit Workspace from route state (the workspace-mode group header "+"): applied once per
  // location.key, same convention as the Agent above, overriding the cached selection ("" pre-fills
  // the temporary workspace). Unlike the Agent there's no list to validate against, so this is a
  // separate effect that never has to wait for a load.
  const appliedWorkspaceKey = useRef<string | null>(null);
  useEffect(() => {
    if (
      stateWorkspace === undefined ||
      appliedWorkspaceKey.current === location.key ||
      loadAppliedRouteKey("workspace") === location.key
    ) {
      return;
    }
    appliedWorkspaceKey.current = location.key;
    saveAppliedRouteKey("workspace", location.key);
    setWorkspace(stateWorkspace);
    // Set together with the path, and to null when the route names none: a machine left over
    // from a cached draft would send this Session to a machine the chosen path is not on.
    setWorkspaceMachine(stateMachineId ?? null);
  }, [location.key, stateWorkspace, stateMachineId]);

  // Project defaults for Workspace / approval mode: the same apply-once discipline as the
  // route-state effects above, deferred until the defaults resolve. A field is only seeded
  // when nothing with higher precedence claims it — no route override (workspace only), no
  // mount-time cached value (a cached "" workspace counts: it is an explicit temporary workspace),
  // and no user edit since mount. Model is deliberately not here (models.defaultModel
  // already flows through its own fallback effect below — the single-sourced default).
  const appliedProjectDefaults = useRef(false);
  useEffect(() => {
    if (chatDefaults === null || appliedProjectDefaults.current) return;
    appliedProjectDefaults.current = true;
    if (
      chatDefaults.workspace !== undefined &&
      stateWorkspace === undefined &&
      cached.workspace === undefined &&
      !touchedRef.current.workspace
    ) {
      setWorkspace(chatDefaults.workspace);
    }
    // The Project's own default wins; else the Sandbox card's default preset, while it is on.
    const seeded = chatDefaults.approvalMode ?? chatDefaults.sandbox?.defaultApprovalMode;
    if (seeded !== undefined && cached.approvalMode === undefined && !touchedRef.current.approval) {
      setApprovalMode(seeded);
    }
  }, [chatDefaults, stateWorkspace, cached.workspace, cached.approvalMode]);

  // Model fallback: once config is ready, if nothing is selected or the selection is no longer valid, fall back to the project default → the first model (always as a paired reference).
  useEffect(() => {
    if (!models) return;
    if (modelRef && models.models.some((m) => sameModelRef(m, modelRef))) return;
    const first = models.models[0];
    setModelRef(
      models.defaultModel ?? (first ? { provider: first.provider, modelId: first.modelId } : null),
    );
  }, [models, modelRef]);

  /**
   * Live reseed: the project-settings dialog saved new defaults in THIS tab while the
   * draft is mounted. The dialog already stripped the cached pins, but this component's
   * state still holds the old selections and persistNow would silently write them right
   * back over the stripped cache — so the seeded fields are reset here to exactly what a
   * fresh /chat/new mount would now produce (with the cache stripped, the seeding
   * precedence collapses to: fresh project default > built-in fallback); the persist
   * effect then pins the NEW values. Typed text and staged skills are user content and
   * stay untouched; route-state overrides and in-mount picks are superseded — the save is
   * the later explicit intent, and the next fresh mount would drop them anyway. Values
   * come from the event payload (server-confirmed by the dialog's PUTs), not a refetch.
   * The mount-time seeding effects re-run when chatDefaults changes but cannot fight
   * this: their apply-once refs are already consumed, and where they are not, they
   * re-apply the same fresh values.
   */
  const onDefaultsChanged = useCallback(
    (detail: ChatDefaultsChangedDetail) => {
      if (detail.defaults) {
        const d = detail.defaults;
        defaultsFromEventRef.current = true;
        setChatDefaults(d);
        touchedRef.current = { workspace: false, approval: false };
        setWorkspace(d.workspace ?? "");
        setApprovalMode(d.approvalMode ?? d.sandbox?.defaultApprovalMode ?? "allow-all");
        // The Agent a fresh mount would now start on (the new block's default while it names
        // an Agent, then default_agent, then the first).
        setAgentId(newChatAgentId(agents, d));
      }
      // New default model: adopt it directly (the event carries the authoritative pair).
      // Setting null and leaning on the fallback effect would race ChatPage's models
      // refetch and re-pin the STALE default from the old models prop.
      if (detail.defaultModel !== undefined) setModelRef(detail.defaultModel);
    },
    [agents],
  );
  /** Latest-closure mirror for the window listener (same convention as persistRef). */
  const onDefaultsChangedRef = useRef(onDefaultsChanged);
  onDefaultsChangedRef.current = onDefaultsChanged;
  // The Sandbox card was saved (from the composer's More…, say): the permission menu reads the
  // sandbox view again, and an approval mode nobody picked follows the new default preset.
  useEffect(
    () =>
      onPluginConfigSaved("sandbox", () => {
        void api.getChatDefaults(projectId).then(
          (res) => {
            setChatDefaults((prev) => ({
              ...(prev ?? {}),
              ...(res.sandbox !== undefined ? { sandbox: res.sandbox } : {}),
            }));
            const seeded = res.approvalMode ?? res.sandbox?.defaultApprovalMode;
            if (seeded !== undefined && !touchedRef.current.approval) setApprovalMode(seeded);
          },
          () => undefined,
        );
      }),
    [projectId],
  );
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = chatDefaultsChangedDetail(e, projectId);
      if (detail) onDefaultsChangedRef.current(detail);
    };
    window.addEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    return () => window.removeEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
  }, [projectId]);

  // —— Conversation-time thinking level (backed by the Agent settings) ——
  // The picker DISPLAYS the effective level, resolved by the same chain core applies when
  // the Session is created (core agent.ts `configuredThinkingLevel`): the Agent's explicit
  // `model.thinking_level` > the Project's `default_chat.thinking_level` > the built-in
  // "medium" (see effectiveThinkingLevel). `agentThinkingLevel` keeps the raw agent value
  // ("" = no explicit override); the derived value below waits for BOTH fetches. Picking a
  // level immediately persists it via the agent-config API (the PUT carries only that key —
  // the server merges per-key into the YAML, so nothing else is clobbered): the session
  // created on first send reads systemConfig fresh, so it runs with the picked level, which
  // also becomes the Agent's new default — the project default is only a fallback and is
  // never written from here. Refetched whenever the draft's Agent changes; while loading
  // (or after a failed fetch) the picker stays disabled (null). The Agent is the one on the
  // workspace's machine, so its settings are read and written over there.
  const [agentThinkingLevel, setAgentThinkingLevel] = useState<string | null>(null);
  /**
   * The draft's Agent once the list on offer carries it. Nothing is asked about an id the cache
   * or the route named until then: a cached id may be one this Project does not have (deleted
   * since, or written while another Project's Agents were on screen), and the request would only
   * come back "This agent no longer exists."
   */
  const selectedAgent = agents.find((a) => a.agentId === agentId) ?? null;
  const resolvedAgentId = selectedAgent?.agentId ?? null;
  useEffect(() => {
    setAgentThinkingLevel(null);
    if (!resolvedAgentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, resolvedAgentId, workspaceMachine)
      .then((res) => {
        if (!cancelled) setAgentThinkingLevel(res.config.model?.thinkingLevel ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, resolvedAgentId, workspaceMachine]);
  const thinkingLevel =
    agentThinkingLevel === null || chatDefaults === null
      ? null
      : effectiveThinkingLevel(agentThinkingLevel, chatDefaults.thinkingLevel);
  /** Live mirror for the rollback value (a stale closure would roll back to an outdated level). */
  const thinkingRef = useRef<string | null>(null);
  thinkingRef.current = agentThinkingLevel;
  const onChangeThinkingLevel = useCallback(
    (level: string) => {
      // "" (no override) is not persistable through the config API — the picker disables that row.
      if (!agentId || !level) return;
      const rollback = thinkingRef.current;
      setAgentThinkingLevel(level); // Optimistic: the derived display follows immediately.
      api
        .putAgentConfig(
          projectId,
          agentId,
          {
            config: { model: { thinkingLevel: level as AgentModelConfigDto["thinkingLevel"] } },
          },
          workspaceMachine,
        )
        .catch((e: unknown) => {
          setAgentThinkingLevel(rollback);
          toastError(apiErrorText(e));
        });
    },
    [projectId, agentId, workspaceMachine],
  );

  // Skills installed on the currently selected Agent (candidates for the input
  // area's skills dropdown): switching Agents first clears the list (which also
  // clears the selection in the input area), then refetches; a fetch failure is
  // silently treated as no skills. Clearing preserves the reference when already
  // empty (doesn't swap in a new array): swapping the reference on the very first
  // mount render would trigger ChatInput's pruning effect and wrongly clear the
  // quick-invoke preselection.
  const [agentSkills, setAgentSkills] = useState<SkillMetadataItem[]>([]);
  /** Whether the skills fetch for the current Agent has settled — the example task waits for it so its `[use_skills]` pinning doesn't silently depend on network timing. */
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  useEffect(() => {
    setAgentSkills((prev) => (prev.length > 0 ? [] : prev));
    setSkillsLoaded(false);
    if (!resolvedAgentId) return;
    let cancelled = false;
    api
      .getAgentSkills(projectId, resolvedAgentId, workspaceMachine)
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
  }, [projectId, resolvedAgentId, workspaceMachine]);

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
    if (Object.keys(sandboxPick).length > 0) data.sandbox = sandboxPick;
    // Saved with the path: a draft restored without its machine would create the Session
    // here, against a path that only exists somewhere else.
    if (workspaceMachine !== null) data.machineId = workspaceMachine;
    if (agentId) data.agentId = agentId;
    if (modelRef) data.modelRef = modelRef;
    if (skillsRef.current.length > 0) data.skills = skillsRef.current;
    // Carried through every write, so a reload finds the prefill still marked as composed
    // rather than resuming it as if it had been typed here.
    if (aiPrefillRef.current) data.aiPrefill = true;
    // A parked draft writes back into its own list entry; the active draft into its slot.
    if (draftId !== undefined) saveDraftSession(userId, projectId, draftId, data);
    else saveDraft(draftKey(userId, projectId), data);
  }, [
    cancelPendingSave,
    userId,
    projectId,
    draftId,
    agentId,
    workspace,
    workspaceMachine,
    approvalMode,
    sandboxPick,
    modelRef,
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
      // Editing an AI-composed prefill makes it the user's own text — an ordinary draft, kept
      // when the page is left and parkable like any other (see aiPrefillRef).
      aiPrefillRef.current = false;
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

  /**
   * Leaving an AI-composed prefill the user neither edited nor sent: the slot is left exactly as
   * a successful send leaves it — model carry-over only — so the prompt cannot reappear in a
   * later new conversation, and the next "Create with AI" jump has nothing to park. Storage is
   * all this touches, deliberately: StrictMode runs the unmount cleanup once right after mount,
   * and the persist effect above then rewrites the slot from component state, which must still
   * describe the prefilled draft on screen.
   */
  const dropAiPrefill = useCallback(() => {
    if (!userId) return;
    if (modelRef) saveDraft(draftKey(userId, projectId), { modelRef });
    else clearDraft(draftKey(userId, projectId));
  }, [userId, projectId, modelRef]);
  /** Latest-closure mirror for the unmount cleanup (same convention as persistRef). */
  const dropAiPrefillRef = useRef(dropAiPrefill);
  dropAiPrefillRef.current = dropAiPrefill;

  // Unmount: drop an untouched AI prefill, or else flush still-unsaved body text (so a route
  // change/page switch doesn't lose the last few keystrokes). Exclusive by construction — a
  // pending save exists only after an edit, and an edit clears the prefill mark.
  useEffect(
    () => () => {
      if (aiPrefillRef.current) {
        dropAiPrefillRef.current();
      } else if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        persistRef.current();
      }
    },
    [],
  );

  // parkActiveDraft ("New chat" clicked while text is typed here) reads the active cache
  // synchronously right after firing this event: flush the debounce window so the park
  // captures the latest keystrokes — and so this instance's unmount flush, which would
  // otherwise fire AFTER the park, has nothing left to write back into the just-cleared
  // active slot. A parked instance flushes into its own entry (harmless).
  useEffect(() => {
    const onFlush = (): void => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        persistRef.current();
      }
    };
    window.addEventListener(DRAFT_FLUSH_EVENT, onFlush);
    return () => window.removeEventListener(DRAFT_FLUSH_EVENT, onFlush);
  }, []);

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
    // A sent prefill has done its job; the unmount that follows has nothing left to drop.
    aiPrefillRef.current = false;
    // The unmount flush routes through persistNow, which would otherwise write the
    // just-sent content back (into the parked entry, resurrecting a deleted row): with
    // the text gone the flush becomes an idempotent empty-shell write.
    textRef.current = "";
    if (!userId) return;
    if (draftId !== undefined) {
      // A sent parked draft simply disappears from the list; the ACTIVE slot is not
      // touched — it may hold a different conversation-in-the-making.
      removeDraftSession(userId, projectId, draftId);
      return;
    }
    if (modelRef) saveDraft(draftKey(userId, projectId), { modelRef });
    else clearDraft(draftKey(userId, projectId));
  }, [cancelPendingSave, userId, projectId, draftId, modelRef]);

  const selectAgent = (a: AgentSummary) => {
    setAgentId(a.agentId);
    // Follow through to the global current Agent: keeps the sidebar memory and stats convention consistent.
    setCurrentAgentId(a.agentId);
  };

  // The Agents of the machine the workspace is on. What that machine was last seen running
  // is offered first, so the picker has something while the machine is asked — and stays on
  // offer if it cannot be: it is the best account of that machine anyone has. The machine's
  // own answer replaces it wholesale, including with nothing, so an Agent deleted over there
  // stops being offered here. Asked only while the machine is connected, and again each time it
  // becomes so: nothing here connects, and the server keeps an enabled machine connected itself.
  useEffect(() => {
    if (workspaceMachine === null) {
      setRemoteAgents([]);
      return;
    }
    setRemoteAgents(cachedMachineAgents(projectId, workspaceMachine));
    setRemoteAgentsFailure(null);
    if (remoteLink !== "connected") return;
    let cancelled = false;
    void (async () => {
      try {
        const answered = (await api.listAgents(projectId, workspaceMachine)).agents;
        rememberMachineAgents(projectId, workspaceMachine, answered);
        if (!cancelled) setRemoteAgents(answered);
      } catch (err) {
        if (!cancelled) setRemoteAgentsFailure(apiErrorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceMachine, projectId, remoteLink]);

  /** User edits routed through these two so a late-arriving project default cannot clobber them. */
  const changeWorkspace = useCallback((path: string, machineId?: string | null) => {
    touchedRef.current.workspace = true;
    setWorkspace(path);
    // The machine travels with the path, always — including back to null when the pick moves
    // home, or the next Session would be created on the machine the previous pick named.
    setWorkspaceMachine(machineId ?? null);
  }, []);
  // A preset sets both halves of the draft's level at once, as it does on a Session; an
  // approval-mode pick (switch off) leaves the sandbox half unpicked, so the settings decide it.
  const changePermission = useCallback((pick: PermissionPick) => {
    touchedRef.current.approval = true;
    setApprovalMode(pick.approvalMode);
    setSandboxPick((prev) => draftSandboxAfter(prev, pick));
  }, []);

  // Synchronous in-flight guard for the one send entry point (the composer): a second
  // submission while one is running would create a second Session with its own first task and
  // a racing navigation. A ref rather than state — the composer disables its own send button
  // off its `busy` state, and nothing else on this page renders differently mid-send.
  const sendingRef = useRef(false);

  // First message sent: only now is the Session created (Agent / Workspace / Model / approval
  // mode are all locked in together), then the route jumps once sent; returns false on any
  // failure, so the input area keeps the draft and can resend.
  const onSend = useCallback(
    async (input: TaskInputPart[], goal: { budget: number } | null = null): Promise<boolean> => {
      if (!agentId || sendingRef.current) return false;
      sendingRef.current = true;
      const browserScope = browserState().scope;
      let createdId: string | null = null;
      try {
        const body: SessionCreateRequest = { approvalMode };
        if (Object.keys(sandboxPick).length > 0) body.sandbox = sandboxPick;
        // Model reference is submitted as a pair (provider + modelId; falls back to the Project default when not set).
        if (modelRef) {
          body.modelId = modelRef.modelId;
          body.provider = modelRef.provider;
        }
        if (workspace.trim()) body.workspace = workspace.trim();
        // Created ON the machine that owns the workspace: that server runs the agent in it.
        const created = await api.createSession(projectId, agentId, body, workspaceMachine);
        createdId = created.session.sessionId;
        // The first task can use the draft's pages as soon as it starts.
        await adoptBrowserSession(browserScope, createdId);
        const res = await api.postTask(createdId, { input, ...(goal ? { goal } : {}) });
        await adoptBrowserSession(createdId, res.sessionId);
        // postTask answers with the CURRENT id: a Session with no Trace whose process
        // restarted in between self-heals into a new one. Everything recorded a moment ago
        // under the id we created is then about a Session that no longer answers to it, and
        // the routing map is the half that fails silently — a remote Session left mapped
        // under the old id would be asked of THIS server, which does not have it. Re-recorded
        // BEFORE the lookup below, which is itself one of those calls.
        if (res.sessionId !== createdId) rememberSessionMachine(res.sessionId, workspaceMachine);
        // Re-fetch the row before listing it: the server persisted the fallback title at
        // Task start (inside the postTask call), and its session_title push may have gone
        // out before this row existed in the list, where it patched nothing. The fresh row
        // also carries the post-self-heal id, matching where we navigate.
        const fresh = await api.getSession(res.sessionId).catch(() => null);
        // Listed under the id we are about to navigate to. Falling back to the created row
        // verbatim would list the OLD id — a stale row, and a route naming a Session the
        // list does not contain.
        add(fresh?.session ?? { ...created.session, sessionId: res.sessionId });
        discardDraft();
        // The draft now has an id of its own, so its docks move with it: anything left
        // behind under the draft's scope would surface in the NEXT new conversation
        // instead (dock-state.ts).
        adoptDockScope(res.sessionId);
        navigate(`/chat/${res.sessionId}`, { replace: true });
        return true;
      } catch (e) {
        // The Session was created but its first Task was refused or failed (postTask failed):
        // discard it — out of the list first, then off the server (unstarted-session.ts says why
        // in that order) — or every resend would pile up another empty Session in the sidebar.
        if (createdId) {
          await adoptBrowserSession(createdId, browserScope);
          void discardUnstartedSession(createdId, { remove, deleteSession: api.deleteSession });
        }
        toastError(apiErrorText(e, modelRef ? { modelId: modelRef.modelId } : {}));
        return false;
      } finally {
        sendingRef.current = false;
      }
    },
    [
      projectId,
      agentId,
      approvalMode,
      sandboxPick,
      modelRef,
      workspace,
      // The machine can change while the path does not: a temporary workspace there after a
      // temporary one here is "" both times, and a send that kept the old machine would create
      // the Session on this server.
      workspaceMachine,
      add,
      remove,
      discardDraft,
      navigate,
    ],
  );

  /**
   * The start dashboard's examples and shortcuts: a click FILLS the composer —
   * the prompt into the text body, the Skills it pins into the skills dropdown — and sends
   * nothing. The user reads what landed, edits it if they want, and presses Send, which then
   * builds the very message the card used to submit by itself (the `[use_skills]` block is the
   * send path's job, so the textarea never shows a marker block). A saved shortcut pins no
   * Skills: its prompt is the user's own text, and an empty pin list leaves the composer's Skill
   * selection exactly as the user set it (see user-shortcuts.ts). Filling is instant and local:
   * there is no busy state and no in-flight guard to keep here, and everything else — where the
   * prompt goes when text is already typed, focus, the caret — is the composer's, reached
   * through this handle.
   */
  const ownComposerRef = useRef<ComposerControl | null>(null);
  const composerRef = pageComposerRef ?? ownComposerRef;
  const fillComposer = useCallback((prompt: string, skills: readonly string[]) => {
    composerRef.current?.fillPrompt(prompt, skills);
  }, []);
  const readComposerText = useCallback(() => textRef.current, []);

  useEffect(() => {
    onAgentChange?.(resolvedAgentId, workspaceMachine);
    if (resolvedAgentId && workspaceMachine === null) setCurrentAgentId(resolvedAgentId);
  }, [resolvedAgentId, workspaceMachine, onAgentChange, setCurrentAgentId]);

  // Capability info for the currently selected model (vision/context window) switches instantly with the selection (matched by paired reference).
  const modelInfo = models?.models.find((m) => sameModelRef(m, modelRef));
  // Goal mode's plugin check, against the Agent the Session will be created for, on the server
  // that holds it: nothing is created for a goal that cannot start (goal-plugin-gate.ts).
  const goalPlugin = useMemo(
    () => (resolvedAgentId ? goalPluginGate(projectId, resolvedAgentId, workspaceMachine) : null),
    [projectId, resolvedAgentId, workspaceMachine],
  );
  const contextWindow = modelInfo?.contextWindow;
  const vision = modelInfo?.vision !== false;

  // The composer and the ownership pills under it, which the dashboard sets between its brand
  // and its examples.
  const composer = (
    <>
      <ChatInput
        status="idle"
        controlRef={composerRef}
        onSend={onSend}
        onStop={async () => undefined}
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
        // A draft becomes an ordinary conversation, never an organization's: every mode.
        approvalModes={APPROVAL_MODES}
        sandbox={{ ...(chatDefaults?.sandbox ?? UNCONFINED), ...sandboxPick }}
        onChangePermission={changePermission}
        modeSaving={false}
        autoFocus
        agents={agents}
        {...(agentId ? { currentAgentId: agentId } : {})}
        skills={agentSkills}
        {...(cached.skills && cached.skills.length > 0 ? { initialSkills: cached.skills } : {})}
        {...(cached.goal === true ? { initialGoal: true } : {})}
        goalPlugin={goalPlugin}
        onSkillsChange={onSkillsChange}
        initialText={cached.text ?? ""}
        onTextChange={onTextChange}
      />

      {/* Agent and Workspace selection below the composer. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AgentSelect
          agents={agents}
          selected={selectedAgent}
          onSelect={selectAgent}
          empty={remoteAgentsEmpty(remoteLink, remoteAgentsFailure)}
        />
        <WorkspaceSelect
          projectId={projectId}
          workspace={workspace}
          machineId={workspaceMachine}
          onChange={changeWorkspace}
          chooseMachine
          {...(agentId ? { agentId } : {})}
        />
        {/* The dock's Files panel on the folder picked beside it; a temporary Workspace has
            none yet (see FilesPanelToggle). */}
        <FilesPanelToggle available={workspace.trim() !== ""} />
      </div>
    </>
  );

  return (
    <div className="anim-fade flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-6 md:px-4">
      {/*
       * Vertical layout: everything visible — the dashboard's brand and tiles, the input card,
       * the ownership pills, the dashboard's examples — lives in ONE block between two empty flex-1
       * spacers, so the block is centred and the free space above and below it is exactly equal.
       * The header deliberately sits inside that block rather than in the upper spacer: keeping
       * the brand in the spacer made the upper gap shorter than the lower one by the brand's own
       * height, which pushed the card up the viewport. When the viewport is too short the spacers
       * collapse to nothing, the container's own py-6 keeps the content off the edges, and the
       * page falls back to natural scrolling; the composer's upward menus measure the room above
       * the card (chat-input.tsx) rather than assume it.
       */}
      <div className="flex-1" />

      <div className="mx-auto w-full max-w-3xl">
        <StartDashboard
          projectId={projectId}
          composer={composer}
          skillsLoaded={skillsLoaded}
          fill={fillComposer}
          readComposerText={readComposerText}
        />
      </div>

      {/* Lower symmetric space — empty, so it matches the upper one exactly */}
      <div className="flex-1" />
    </div>
  );
}
