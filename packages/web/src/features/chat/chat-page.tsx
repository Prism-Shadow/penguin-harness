/**
 * Chat page:
 * a thin top toolbar (Session title / status / iconized stats / panel switcher / details
 * popup) + the message stream and input area (input box vertically centered when there
 * are no messages), with the dock surfaces beside and below (features/dock): every side
 * element — subagents, Workspace files, Memory, Trace, terminals — is a tab in the right
 * or bottom dock, arranged by the user and persisted globally. This page contributes the
 * panel BODIES (they need its session/stream state) through DockPanel's renderPanel, and
 * the stream's jump commands: a message file card opens the Workspace tab on that file
 * (onOpenFile), a subagent chip opens the agents tab focused (onOpenSubagent), a
 * memory-change row opens the Memory tab located (onLocateMemoryChange).
 * Approval mode and Model/context usage live in the input area's toolbar; context is compacted
 * via the /compact slash command.
 * Draft state (/chat/new) is carried by DraftView: Agent / Workspace / approval mode / Model are
 * chosen before sending, and everything except approval mode is locked once the Session is
 * created. The Session list and the new-chat entry point live in the global sidebar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type {
  AgentSummary,
  ApprovalMode,
  ModelRefDto,
  ModelsResponse,
  SessionInfo,
  SessionPatchRequest,
  SessionProcessInfo,
  SessionStatus,
  SkillMetadataItem,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useWorkflowTabs, WorkflowFrame, WorkflowTabStrip } from "../workflows/workflow-tabs";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  formatDateTime,
  humanizeDuration,
  humanizeDurationLive,
  humanizeTokens,
} from "../../lib/format";
import { latestConversation } from "../../lib/session-grouping";
import { sessionActivity } from "../../lib/session-activity";
import { noteSessionSeen } from "../../lib/session-seen";
import {
  approvalKey,
  createStreamModel,
  finalizeHistory,
  pushMessage,
} from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import { aggregateMemoryChanges, sameMemoryChanges } from "../../lib/omni/memory-changes";
import type { MemoryLocateTarget } from "../../lib/omni/memory-changes";
import { bucketCostUsd, liveSessionElapsedMs } from "../../lib/omni/task-stats";
import type { TaskStatsTracker } from "../../lib/omni/task-stats";
import { useAuth } from "../../state/auth";
import { useTheme } from "../../state/theme";
import { agentDisplayName, useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { Truncated } from "../../components/ui/truncated";
import { Dropdown } from "../../components/ui/dropdown";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { EmptyState } from "../../components/ui/empty-state";
import {
  SessionActivityIcon,
  sessionActivityLabel,
} from "../../components/ui/session-activity-icon";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { MessageStream } from "./message-stream";
import type { StreamRenderContext } from "./message-stream";
import type { ForkTarget } from "./task-stats-line";
import { latestTaskHasSubagent, modelTaskStartCount, taskStartCount } from "./agent-topology";
import { ChatInput } from "./chat-input";
import {
  compactionTally,
  heldThinkingSwitch,
  needsThinkingSwitchConfirm,
  sessionThinkingLevel,
  thinkingLevelLabel,
} from "./thinking-level";
import type { StagedThinkingSwitch } from "./thinking-level";
import { ChatDropRegion } from "./drop-zone";
import { ConversationOutline, OutlineMenuButton, useOutlineRailFit } from "./conversation-outline";
import { DraftView } from "./draft-view";
import { parkActiveDraft } from "./draft-sessions";
import { heldRouteSession, sessionForProject, sessionProbeKey } from "./session-project";
import { machineForSession } from "../../lib/session-machines";
import { CHAT_DEFAULTS_CHANGED_EVENT, chatDefaultsChangedDetail } from "./chat-defaults-event";
import { advanceCostStat, applyUsageFetch, createCostStatHold } from "./header-stats";
import type { CostStatDisplay } from "./header-stats";
import { buildInputHistory } from "./input-history";
import { buildOutline } from "./outline-model";
import { GoalStatusBanner } from "./goal-banner";
import { handoffMessage, modelSwitchMessage } from "./agent-handoff";
import { hasConfiguredKey, sameModelRef } from "../models/model-grouping";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { WorkspaceBrowser } from "./workspace-browser";
import { ChatMemoryView } from "./memory-view";
import { useMemoryListing } from "./use-memory-listing";
import { deletedChangeKeys } from "./memory-nav";
import { SubagentsView } from "./subagents-view";
import { TracePanel } from "../traces/trace-panel";
import { MessagingPanel } from "../messaging/messaging-panel";
import { DockPanel } from "../dock/dock-panel";
import { useDockMount } from "../dock/use-dock-mount";
import { panelLabel } from "../dock/panel-meta";
// importing it also registers the global Ctrl+` hotkey with the app bundle
import { setDockCwd } from "../dock/dock-terminal";
import {
  adoptDockScope,
  dockViews,
  dockVersion,
  isTabShown,
  openPanel,
  panelDock,
  subscribeDock,
  type PanelKind,
} from "../dock/dock-state";
import { terminalApiSupported, subscribeTerminals } from "../terminal/terminal-list";
import { advancePanelTaskScope, createPanelTaskScope } from "./panel-task-scope";
import { useSessionDraft } from "./use-session-draft";
import { useSessionStream } from "./use-session-stream";
import { PanelsToolbar } from "./panels-toolbar";
import { toneDot, toneInk } from "../../lib/tone";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { STAT_ICONS } from "../../lib/stat-icons";
import { INFO_ICON } from "../../components/ui/icons";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";

/** How often the background-process list refreshes while it can still change (a run may promote a command at any time; a running process can exit on its own). */
const PROCESS_POLL_MS = 15_000;

/** Iconized stat item: a symbol + a value, with the title giving the full meaning. */
function StatChip({ icon, value, label }: { icon: string; value: ReactNode; label: string }) {
  return (
    <span
      title={label}
      className={`flex shrink-0 items-center ${ICON_GAP.tight} font-mono text-xs text-gray-500 dark:text-gray-400`}
    >
      <GlyphIcon d={icon} />
      {value}
    </span>
  );
}

/**
 * Session id row in the details card: the id is selectable mono text (styled like the other
 * sections' values) with the shared CopyButton beside it. The copy feedback is the button's
 * icon swapping to the check (#312, no "已复制" text) — the "Session id" label above never
 * changes.
 */
function SessionIdRow({ sessionId }: { sessionId: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {S.chat.sessionIdLabel}
      </p>
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">{sessionId}</span>
        <CopyButton text={sessionId} label={S.chat.copySessionId} className={ROW_COPY_CLASS} />
      </div>
    </div>
  );
}

/**
 * Elapsed value for the header statistics: while a Task runs it ticks once per second over the
 * live cumulative (settled cross-Task total + the running Task's wall clock so far, see
 * liveSessionElapsedMs); when idle no timer runs and it renders exactly the settled total.
 * Whole seconds while ticking, decimals only on the settled value — same convention as
 * LiveDuration on running tool/thinking cards.
 */
function SessionElapsed({
  stats,
  taskOpen,
  taskStartLocalMs,
}: {
  stats: TaskStatsTracker;
  taskOpen: boolean;
  taskStartLocalMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!taskOpen) return;
    // Load-bearing, not redundant: `now` still holds whatever the state last saw (mount time,
    // or the final tick of a previous Task), and the first interval callback is a full second
    // away. The first live render after a Task starts must not compute from that stale clock,
    // so re-anchor immediately on entering the running state.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [taskOpen]);
  if (!taskOpen) return <>{humanizeDuration(stats.sessionElapsedMs)}</>;
  return <>{humanizeDurationLive(liveSessionElapsedMs(stats, taskOpen, taskStartLocalMs, now))}</>;
}

/** The header's three statistics — the chip row and the info dropdown render these verbatim. */
interface HeaderStats {
  tokensText: string;
  /** Formatted session cost; null = nothing to show yet for this session (see header-stats.ts). */
  costText: string | null;
  /** Server-reported "some usage had no pricing" flag riding the shown figure (the chip's `*`). */
  costUncosted: boolean;
  elapsedNode: ReactNode;
}

/**
 * Computes the header statistics, live while a Task runs:
 *   - Tokens: session cumulative (main + subagents), already advancing per completed request;
 *   - Cost: advanceCostStat's display value — the fetched session cost plus a client-settled
 *     live estimate that carries across Task boundaries, sticky once shown (semantics
 *     documented in header-stats.ts). The live estimate applies the main Model's pricing to
 *     all of the open Task's buckets (subagents may run on different models), so it can be
 *     slightly off mid-task; usage fetches reconcile it to the server-recorded value;
 *   - Elapsed: ticking cumulative while running, settled cumulative when idle (SessionElapsed).
 */
function headerStats(model: StreamModel, cost: CostStatDisplay): HeaderStats {
  const stats = model.stats;
  return {
    tokensText: humanizeTokens(stats.sessionTotal + stats.subagentTotal),
    costText: cost.costText,
    costUncosted: cost.costUncosted,
    elapsedNode: (
      <SessionElapsed
        stats={stats}
        taskOpen={model.taskOpen}
        taskStartLocalMs={model.taskStartLocalMs}
      />
    ),
  };
}

/**
 * Route id for a draft chat (`/chat/new`): the Session hasn't been persisted yet — the user may
 * still want to change the model or configure a key first. The actual Session is only created
 * once **the first message is sent** (once created, the model is locked into its meta).
 * Real session ids always start with `session-`, so there's no collision with this constant —
 * nor with parked draft conversations, whose route ids start with `draft-` (draft-sessions.ts).
 */
export const DRAFT_SESSION_ID = "new";

/** Parked-draft route id (`/chat/draft-…` — a draft conversation row in the sidebar list), or null. */
export const parkedDraftIdOf = (routeSessionId: string | null): string | null =>
  routeSessionId !== null && routeSessionId.startsWith("draft-") ? routeSessionId : null;

/**
 * Server-enforced ceiling on paths per files/stat call (STAT_MAX_PATHS in the sessions routes,
 * which 400s above it). A Task-level summary aggregates candidates across the whole Task and can
 * exceed it, so cache misses are checked in chunks of this size.
 */
const STAT_PATHS_PER_REQUEST = 100;

export function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ sessionId?: string }>();
  const { user } = useAuth();
  const { currency } = useTheme();
  const { currentProject, currentAgent, setCurrentAgentId, reloadAgents, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const agentId = currentAgent?.agentId ?? null;
  const workflowTabs = useWorkflowTabs(projectId, agentId);
  const {
    sessions,
    loading: sessionsLoading,
    machinesUnreachable,
    offlineMachineIds,
    reload: reloadSessions,
    add: addSession,
    isDeleted: isSessionDeleted,
    replace,
    setStatus,
    setTitle,
  } = useSessions();

  // Cost chip state lives in a mutable per-session hold (header-stats.ts, pure/unit-tested):
  // the fetched session cost + a client-settled live base + the last shown value, advanced once
  // per render by advanceCostStat (which also resets it on session switch). usageAppliedRef
  // marks the session whose usage fetch has applied ("initial fetch done"); usageStamp only
  // forces a repaint when a fetch resolves outside the stream's own version bumps.
  const costHoldRef = useRef(createCostStatHold());
  const usageAppliedRef = useRef<string | null>(null);
  const [, bumpUsageStamp] = useState(0);
  const [credentialGuide, setCredentialGuide] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  // Background processes the conversation started (details popover list + the header's
  // running-services count), refreshed by the polling effect below; procBusy marks the
  // row whose stop request is in flight.
  const [processes, setProcesses] = useState<SessionProcessInfo[]>([]);
  const [procBusy, setProcBusy] = useState<string | null>(null);
  // Session Token buckets from the last usage fetch (the popover's tokens-line breakdown):
  // server-recorded values — they can trail the live chip mid-run and reconcile on idle.
  const [usageBuckets, setUsageBuckets] = useState<{
    cacheRead: number;
    cacheWrite: number;
    output: number;
  } | null>(null);
  // A mid-chat thinking-level pick staged behind the confirm dialog (issue #310): some
  // providers key their prompt PREFIX on the thinking level, so switching with history in
  // place invalidates the provider's prefix cache and the next request re-bills the whole
  // history as uncached input. The pick is only applied on an explicit choice; null = no
  // dialog, "ask" = dialog open, "compacting" = the user chose "compact, then switch" and
  // the pick is held until the compaction completes. Logic in thinking-level.ts
  // (needsThinkingSwitchConfirm / thinkingSwitchAfterCompaction).
  const [thinkingSwitch, setThinkingSwitch] = useState<StagedThinkingSwitch | null>(null);

  const routeSessionId = params.sessionId ?? null;
  // The docks' arrangement lives in the dock store (features/dock) — tabs, active tab,
  // sizes, all global and persisted. This page re-renders on any dock change and owns only
  // the stream-driven JUMP COMMANDS the panel bodies consume: each is a fresh object per
  // call (identity-compared, so repeating the same jump still re-triggers the view's
  // effect), and each resets on a Session switch because it pointed into the old session's
  // stream. The tabs themselves deliberately survive the switch — the panels re-bind to
  // the conversation on screen.
  useSyncExternalStore(subscribeDock, dockVersion);
  useSyncExternalStore(subscribeTerminals, terminalApiSupported);
  /** Workspace tab: locate this file in the tree (a message file card's click). */
  const [fileOpenRequest, setFileOpenRequest] = useState<{ path: string } | null>(null);
  /** Memory tab: land on this memory's detail (a card row), or the list (null target). */
  const [memoryRequest, setMemoryRequest] = useState<{
    target: MemoryLocateTarget | null;
  } | null>(null);
  /** Agents tab: select this child conversation (a subagent chip's click; the chain ends with the child's own id). */
  const [subagentFocus, setSubagentFocus] = useState<{
    sessionId: string;
    origin: string[];
  } | null>(null);
  /**
   * Which Task's topology the agents tab displays. Null = the LATEST Task; a chip click
   * pins the graph to the Task containing that chip instead — `anchorSessionId` is the
   * clicked child's TOP-LEVEL ancestor, which the view resolves to its Task slice.
   */
  const [subagentTaskScope, setSubagentTaskScope] = useState<{
    anchorSessionId: string;
  } | null>(null);
  useEffect(() => {
    setFileOpenRequest(null);
    setMemoryRequest(null);
    setSubagentFocus(null);
    setSubagentTaskScope(null);
  }, [routeSessionId]);
  // A command also resets when its panel's TAB closes: the tab body unmounts with the tab,
  // so a re-added tab is a fresh mount that would otherwise replay the stale command —
  // reopening the Workspace would re-locate a long-clicked file, and reopening the agents
  // tab would come back pinned to an old Task instead of the latest.
  const workspaceTabExists = panelDock("workspace") !== null;
  const memoryTabExists = panelDock("memory") !== null;
  const agentsTabExists = panelDock("agents") !== null;
  useEffect(() => {
    if (!workspaceTabExists) setFileOpenRequest(null);
  }, [workspaceTabExists]);
  useEffect(() => {
    if (!memoryTabExists) setMemoryRequest(null);
  }, [memoryTabExists]);
  useEffect(() => {
    if (!agentsTabExists) {
      setSubagentFocus(null);
      setSubagentTaskScope(null);
    }
  }, [agentsTabExists]);
  // Parked draft conversations (`/chat/draft-…`) render the same DraftView as `/chat/new`,
  // just bound to their own stored entry — every "this is a draft, not a Session" branch
  // below treats the two alike.
  const parkedDraftId = parkedDraftIdOf(routeSessionId);
  const draft = routeSessionId === DRAFT_SESSION_ID || parkedDraftId !== null;
  const listed = draft ? null : (sessions.find((s) => s.sessionId === routeSessionId) ?? null);
  /**
   * The routed Session, held across a refetch that momentarily does not list it.
   *
   * `listed` is derived from a list that reload() rebuilds WHOLESALE: for the tick between
   * the fetches landing and the merged array being set, a source that answers slower, a
   * machine that misses one round, or a Session whose category changed under a page that is
   * not loaded, all read as "that row is not here". None of them mean the conversation on
   * screen has gone anywhere, so the render must not take them for it — dropping `selected`
   * for that tick paints the skeleton over a conversation the reader is in the middle of.
   *
   * Held only for the route it was seen on, and only until the direct lookup SAYS it is gone:
   * `routeSessionPending` and the redirect below still read `listed`, so a Session actually
   * deleted still probes, still fails, and still redirects — one tick later than before.
   */
  const probeKey = projectId && routeSessionId ? sessionProbeKey(projectId, routeSessionId) : null;
  const [probeFailedKey, setProbeFailedKey] = useState<string | null>(null);
  const heldSession = useRef<SessionInfo | null>(null);
  heldSession.current = heldRouteSession(
    heldSession.current,
    listed,
    routeSessionId ?? null,
    probeKey !== null && probeFailedKey === probeKey,
  );
  const selected = draft ? null : heldSession.current;
  // New shells start in this conversation's Workspace — its files are what a terminal
  // opened here is for. While drafting, the Workspace is the one picked in the draft and
  // DraftView publishes it instead (a child effect runs before this one, so this must
  // yield rather than clobber it with null). Leaving the chat for another page keeps the
  // last conversation's Workspace: it is a better default than home for the hotkey,
  // which stays live everywhere. With the machine that Workspace is on: the path only means
  // anything on its own filesystem, and a shell for this conversation belongs beside the
  // agent running it.
  useEffect(() => {
    if (draft) return;
    setDockCwd(
      selected?.workspace ?? null,
      selected === null ? null : machineForSession(selected.sessionId),
    );
  }, [draft, selected]);

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

  // Chat input area draft: caches text, both staged switch chips (`/agent` target, `/model`
  // target) and the selected skills keyed by sessionId; restored after navigating away and back
  // or a refresh, discarded on successful send.
  const {
    initial: sessionDraft,
    onTextChange: onDraftTextChange,
    onHandoffTargetChange: onDraftHandoffChange,
    onPendingModelChange: onDraftPendingModelChange,
    onSkillsChange: onDraftSkillsChange,
    discard: discardSessionDraft,
  } = useSessionDraft(selected?.sessionId ?? null);

  // The rendered transcript: the loaded run — frozen windows (negative ids) ahead of the
  // live tail model's items while the tail is attached. Keyed on the edges version as well
  // as the stream version: the controller reshapes the run synchronously and its repaint
  // signal is throttled, so a render forced by anything else in between must not pair
  // the NEW edges version (read live below) with the OLD item list — the stream would
  // re-anchor against a layout that has not changed yet and skip the commit that does.
  const allItems = useMemo(
    () => [...stream.items],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, stream.edgesVersion, routeSessionId],
  );
  // Everything loaded, the live tail included even while it is off screen (scrolling up
  // sheds it from the transcript, not from the conversation): what recall and the
  // subagents panel read, so neither loses the most recent turns to a scroll.
  const historyItems = useMemo(
    () => (stream.tailAttached ? allItems : [...allItems, ...stream.model.items]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, stream.edgesVersion, routeSessionId],
  );
  // Derivations over the stream items (the model mutates in place, so `version` — its own
  // repaint signal — keys the memos; the session id covers a switch racing a same-valued
  // version): the composer's ↑/↓ recall list and the left outline's entries. Both read the
  // LOADED transcript (frozen windows included), so backfilling extends recall and the
  // index alike; the outline lists what is on screen.
  const inputHistory = useMemo(
    () => buildInputHistory(historyItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  const outline = useMemo(
    () => buildOutline(allItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // The subagents panel's model view: the live model, with backfilled windows' items and
  // nested subagent models merged in — a chip clicked on a backfilled turn must still
  // resolve its historical Task slice and child conversation. Scalar fields snapshot per
  // version, which is exactly as fresh as everything else the panel renders.
  const panelModel = useMemo<StreamModel>(
    () =>
      stream.windowCount > 0 || stream.windowSubagents.size > 0
        ? {
            ...stream.model,
            items: [...historyItems],
            subagents: new Map([...stream.windowSubagents, ...stream.model.subagents]),
          }
        : stream.model,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, stream.edgesVersion, routeSessionId],
  );
  // This conversation's memory changes, aggregated across every visible Task for the Memory
  // panel and the card (version keys the memo like panelModel). Backfilled windows are read
  // here too, but each builds its own model, and a model derives rows only once a session_meta
  // has told it where the Memory root is — so a window that starts mid-shard contributes none
  // (see collectTaskMemoryChanges).
  const rawMemoryChanges = useMemo(
    () =>
      aggregateMemoryChanges(
        allItems.flatMap((it) =>
          it.kind === "task_stats" && it.memoryChanges !== undefined ? [it.memoryChanges] : [],
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // Identity-stable view of the rows: the memo above re-derives on EVERY streamed message
  // (version bumps per tick), but downstream effects — the listing fetch, the detail
  // refetch — and memos key on the array's identity. Keeping the previous reference while
  // the content is unchanged is what stops the Memory panel flashing during a streaming
  // reply; only a settled Task that actually changed memory swaps it.
  const memoryChangesRef = useRef(rawMemoryChanges);
  if (!sameMemoryChanges(memoryChangesRef.current, rawMemoryChanges)) {
    memoryChangesRef.current = rawMemoryChanges;
  }
  const sessionMemoryChanges = memoryChangesRef.current;
  // The Agent's memory listing, fetched once the Memory tab exists (its body is mounted
  // even behind another tab) or this conversation has changes to mark; shared by the
  // Memory panel and the card's deleted-row marking.
  const memoryListing = useMemoryListing(
    projectId,
    selected?.agentId ?? null,
    panelDock("memory") !== null || sessionMemoryChanges.length > 0,
    sessionMemoryChanges,
  );
  // Changed files the loaded listing no longer carries: the card drops those rows
  // (undefined while the listing hasn't loaded — "unknown" must not read as "deleted").
  const deletedMemoryKeys = useMemo(
    () => deletedChangeKeys(memoryListing.scopes, sessionMemoryChanges) ?? undefined,
    [memoryListing.scopes, sessionMemoryChanges],
  );
  // The message stream's scroll container, exposed by MessageStream for the outline's
  // jump/scrollspy (anchors are queried inside it, never document-wide).
  const streamScrollRef = useRef<HTMLDivElement | null>(null);
  // Which outline shape fits: the gutter tick rail, or (exactly when it can't show —
  // phones without hover, and any window whose gutter a docked panel ate) the toolbar's
  // dropdown index button.
  const railFit = useOutlineRailFit(streamScrollRef, stream.version);

  // Current Agent follows the Session in the route (keeps the sidebar and stats aligned on deep
  // links / refresh). Only aligns when **the selected Session changes** — never put agentId in
  // the dependency array: otherwise, when switching from a "running session" to a new chat with
  // a different Agent, navigate and setCurrentAgentId aren't in the same batch — a transitional
  // render of "new agentId + old route (old session still selected)" would appear first, and
  // this effect would then flip the Agent back to the old session's Agent based on that,
  // causing the new chat to end up created on the old Agent.
  const selectedSessionId = selected?.sessionId ?? null;
  const selectedAgentId = selected?.agentId ?? null;
  // The thinking level pinned on THIS Session, read straight off the Session row
  // (SessionInfo.thinkingLevel, written by the picker through PATCH — see
  // applyTurnThinkingLevel): "" = never pinned, and the picker then displays the Agent
  // config's level (auto-follow — each model context reads the config, so Agent-config edits
  // keep taking effect). A pin is DURABLE: it survives a reload, shows up in a second tab,
  // and core applies it from the Session's next LLM request on (soft-limited — the picker's
  // menu advises compacting first, since the change invalidates the model's cached
  // context). It is still never written through to the Agent config (that stays draft-only).
  const turnThinkingLevel = selected?.thinkingLevel ?? "";
  useEffect(() => {
    if (selectedSessionId && selectedAgentId) setCurrentAgentId(selectedAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedAgentId, setCurrentAgentId]);

  // Agents tab AUTO-OPEN (the one automatic tab action): the pure tracker
  // (advancePanelTaskScope, unit-tested) brings the agents tab to the front on the CURRENT
  // task's first live spawn, re-armed at every task boundary so a manual close is respected
  // until the next one. It never re-triggers an already-shown tab (that would yank a pinned
  // historical graph back to the latest Task); the tracker consumes the attempt regardless.
  const panelTaskScopeRef = useRef(createPanelTaskScope());
  // Deliberately the LIVE model's items only (never the backfilled prefix): the tracker
  // reads an INCREASE as "the user started a new Task", and a scroll-up backfill growing
  // the count would spuriously re-arm the auto-open mid-conversation. The latest Task
  // always lives in the live tail window, so live-only loses nothing.
  const taskCount = taskStartCount(stream.model.items);
  const liveSpawn = stream.taskState !== "idle" && latestTaskHasSubagent(stream.model);
  useEffect(() => {
    const action = advancePanelTaskScope(panelTaskScopeRef.current, {
      sessionId: selectedSessionId,
      taskCount,
      liveSpawn,
    });
    if (action === "autoOpen" && !isTabShown("agents")) openPanel("agents");
    // The tracker only acts on real transitions of these three observed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, taskCount, liveSpawn]);

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

  // The session Agent's configured thinking level ("" = unset/loading), via the same
  // agent-config endpoint the draft picker uses: the in-session picker DISPLAYS this while
  // the user hasn't picked a level (auto-follow — sending still omits the level until
  // touched, see turnThinkingLevel). Refetched when the session's Agent changes; a failed
  // fetch leaves it unset (the picker then shows an em dash until picked).
  const [agentThinkingLevel, setAgentThinkingLevel] = useState("");
  useEffect(() => {
    setAgentThinkingLevel("");
    if (!projectId || !selectedAgentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, selectedAgentId)
      .then((res) => {
        if (!cancelled) setAgentThinkingLevel(res.config.model?.thinkingLevel ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAgentId]);

  // The Session list is paged: a deep-linked Session (old bookmark, cross-page jump) may sit
  // beyond the loaded pages. Look it up directly and insert it before the auto-select effect
  // below concludes it doesn't exist; only a failed probe releases that redirect. `probeKey`
  // and `probeFailedKey` are declared up with `selected`, which needs them to know when to
  // let the held Session go.
  /**
   * The route names a Session we cannot answer for YET: not in the loaded pages, and the
   * direct lookup that settles it has not failed. Ordinary with a paged list — a deep link,
   * a Session just created, a row beyond the first page. Shared by the probe effect, the
   * auto-select effect and the render, so the three cannot disagree about what "pending"
   * means — their disagreeing is what once painted "no Sessions yet" over a conversation
   * that was about to appear.
   */
  /**
   * Nobody who could answer for this Session is answering, so a failed lookup settles nothing.
   *
   * Two shapes of that. Either no owner is recorded and some machine is out of reach — the
   * probe then asks THIS server (lib/session-machines.ts: absence means here), which 404s
   * about a Session that is alive THERE. Or the owner IS recorded and is itself one of the
   * machines not answering, which is every row restored from the cache. Reading either as
   * "gone" is what drops the reader into the draft page mid-conversation.
   */
  const routeSessionOwner = routeSessionId ? machineForSession(routeSessionId) : null;
  const routeSessionUnowned =
    !!routeSessionId &&
    (routeSessionOwner === null
      ? machinesUnreachable
      : offlineMachineIds.includes(routeSessionOwner));
  // Read from `listed`, never from `selected`: the held Session above keeps the conversation
  // on screen through a refetch, but it must not tell the probe that the row is loaded — a
  // Session that really is gone has to keep probing until the lookup fails and releases both.
  const routeSessionPending =
    !!routeSessionId && listed === null && (probeFailedKey !== probeKey || routeSessionUnowned);
  useEffect(() => {
    if (draft || !projectId || !routeSessionId || !probeKey || sessionsLoading) return;
    // Settled (row loaded, or the lookup already failed): nothing to probe — and a failed
    // key must not be re-probed just because the list's identity churned.
    if (!routeSessionPending) return;
    // We deleted this Session ourselves: the row is gone from the list on purpose, so the
    // lookup below could only 404 (and the server would record that as an error). Deleting
    // the conversation you are looking at is the normal way to discard a Session fork, so
    // this path runs on every such delete. Treat it as an already-failed probe, which
    // releases the redirect effect below to move on to another conversation.
    if (isSessionDeleted(routeSessionId)) {
      setProbeFailedKey(probeKey);
      return;
    }
    let cancelled = false;
    api.getSession(routeSessionId).then(
      (res) => {
        if (cancelled) return;
        const session = sessionForProject(res.session, projectId);
        if (session) addSession(session);
        else setProbeFailedKey(probeKey);
      },
      () => {
        if (!cancelled) setProbeFailedKey(probeKey);
      },
    );
    return () => {
      cancelled = true;
    };
    // `selected` rather than `sessions`: while the routed row stays unloaded, list churn
    // (status flips, new pages) keeps it null and leaves the in-flight lookup alone —
    // depending on the array identity cancelled and re-issued it on every user event.
  }, [
    draft,
    projectId,
    routeSessionId,
    probeKey,
    sessionsLoading,
    routeSessionPending,
    selected,
    addSession,
    isSessionDeleted,
  ]);

  // Auto-select the most recent conversation when the route doesn't select one (newest loaded
  // active/schedule Session — archived rows are hidden by choice and subagent Sessions belong
  // to their parent, so neither is auto-opened); if there is none, fall back to draft state
  // (instead of auto-creating one).
  useEffect(() => {
    if (sessionsLoading || draft) return;
    if (selected !== null) return;
    // A routed id missing from the paged list isn't gone until the direct lookup fails.
    if (routeSessionPending) return;
    const last = latestConversation(sessions);
    navigate(last ? `/chat/${last.sessionId}` : `/chat/${DRAFT_SESSION_ID}`, { replace: true });
  }, [sessionsLoading, draft, selected, routeSessionPending, sessions, navigate]);

  // Sync task_state to the sidebar list badge.
  //
  // Keyed on the session ID, not the `selected` row: the row object is replaced whenever
  // anything about it changes — including by the user channel's own `session_state` event for
  // this very Session, which arrives on a second connection with no ordering guarantee against
  // this one. Depending on the object re-ran this effect on that replacement and re-asserted
  // whatever `stream.taskState` still held, so a run that ended could be pushed back to
  // "running" until this tab's Session stream caught up. Depending on the id means only a real
  // state change writes, and the two sources agree instead of overwriting each other.
  useEffect(() => {
    if (selectedSessionId !== null) setStatus(selectedSessionId, stream.taskState);
  }, [stream.taskState, selectedSessionId, setStatus]);

  // Task returns from running/compacting to idle ON THE SAME SESSION: this turn may have
  // spawned a sub-session or auto-created a new Agent — reload both lists so they appear in
  // the sidebar immediately (no manual refresh needed). Guarded by session identity: the
  // stream resets its state to "idle" whenever it detaches (switching conversations,
  // entering the draft), and treating that phantom transition as a completion made every
  // mid-run "new chat" click reload the sessions + agents contexts — an app-wide re-render
  // arriving right after the click, occasionally visible as an uncontrolled flicker. On a
  // switch the tracker restarts from "idle": a state observed in the same commit as the id
  // change still belongs to the previous stream, so it must not seed the new session's
  // baseline (the new stream's own task_state push advances it).
  const prevTaskRef = useRef<{ id: string | null; state: SessionStatus }>({
    id: selectedSessionId,
    state: "idle",
  });
  /**
   * Settled-turn counter handed to the dock panels that read what the Session produced — the
   * Files browser and the Trace panel; every bump means "re-read".
   */
  const [settledTurnSignal, setSettledTurnSignal] = useState(0);
  useEffect(() => {
    const prev = prevTaskRef.current;
    const sameSession = prev.id === selectedSessionId;
    prevTaskRef.current = {
      id: selectedSessionId,
      state: sameSession ? stream.taskState : "idle",
    };
    if (!sameSession || selectedSessionId === null) return;
    if (prev.state !== "idle" && stream.taskState === "idle") {
      void reloadSessions();
      void reloadAgents();
      // The turn that just ended is when the Agent's file writes landed: the Files panel's
      // listing and whatever it has open are stale from this moment on (see the browser's
      // reloadSignal), and so are the Trace panel's file list and the file it is showing —
      // the turn appended its own record to it. Same edge, same guard — a phantom "idle"
      // from a detaching stream never reaches here.
      setSettledTurnSignal((n) => n + 1);
    }
  }, [stream.taskState, selectedSessionId, reloadSessions, reloadAgents]);

  // Looking at a settled Session is what marks it read (session-seen.ts): stamped on open, and
  // again when a run finishes under the user's eyes, so the sidebar row left behind is not
  // flagged unread. Depending on lastActiveAt is what keeps the marker honest across clock skew
  // — the effect above reloads the list on that same active→idle edge, and the refreshed
  // server timestamp re-runs this one.
  const selectedLastActiveAt = selected?.lastActiveAt ?? null;
  useEffect(() => {
    if (selectedSessionId === null || selectedLastActiveAt === null) return;
    if (stream.taskState !== "idle") return; // Still working: nothing settled to have read yet.
    noteSessionSeen(projectId, selectedSessionId, selectedLastActiveAt);
  }, [projectId, selectedSessionId, selectedLastActiveAt, stream.taskState]);

  // Positive-only existence cache for file summary cards (session-level): normalized relative
  // path -> true, or the shared in-flight lookup. Missing files aren't retained — a later Task may
  // create the same path, so its summary must re-check instead of inheriting stale false state.
  const statCacheRef = useRef(new Map<string, true | Promise<boolean>>());

  // Session switch: resets the usage-fetch marker, the file-card existence cache, any
  // thinking-level switch staged behind its dialog (per-session UI state — a compaction
  // that self-heals to a new session id routes through here too and drops the held pick),
  // and the popover's per-session data (process list / token buckets),
  // avoiding stale data from the previous Session (the panel jump commands reset in their
  // own effect above, and the cost hold re-keys itself inside advanceCostStat). The thinking level itself needs no reset — it is read off the
  // selected Session row, so it changes with the session by construction.
  useEffect(() => {
    usageAppliedRef.current = null;
    setThinkingSwitch(null);
    statCacheRef.current = new Map();
    setProcesses([]);
    setUsageBuckets(null);
  }, [routeSessionId]);

  // Batched existence check for file summaries: cache stable positive results and share in-flight
  // requests, but never retain a negative result. Each pending lookup mutates the cache only while
  // it is still the current entry, so an old request can't delete or overwrite a newer one.
  const statFiles = useCallback(
    async (paths: string[]): Promise<ReadonlySet<string>> => {
      const sessionId = selected?.sessionId ?? null;
      const cache = statCacheRef.current;
      const misses = sessionId === null ? [] : paths.filter((p) => !cache.has(p));
      if (sessionId !== null && misses.length > 0) {
        for (let i = 0; i < misses.length; i += STAT_PATHS_PER_REQUEST) {
          const chunk = misses.slice(i, i + STAT_PATHS_PER_REQUEST);
          const batch = api
            .statSessionFiles(sessionId, chunk)
            .then((res) => new Set(res.existing))
            .catch(() => null);
          for (const p of chunk) {
            const pending = batch.then((existing) => existing?.has(p) ?? false);
            cache.set(p, pending);
            void pending.then((exists) => {
              if (cache.get(p) !== pending) return;
              if (exists) cache.set(p, true);
              else cache.delete(p);
            });
          }
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

  // Session's cumulative cost (priced by the server in real time from its usage rows): fetched
  // once when the session becomes selected — even mid-run, so a page load during an active run
  // recovers the already-accrued total instead of waiting for idle — then refreshed on every
  // return to idle (the authoritative reconcile, as before). usageAppliedRef marks the initial
  // fetch done only when a response applies, so a cancelled/failed attempt retries on the next
  // transition rather than polling. The cancelled flag doubles as a staleness guard: any
  // task-state change re-runs the effect and discards an in-flight response fetched under the
  // previous run state (whose total would misalign with the live buckets it is snapshotted
  // against — see applyUsageFetch).
  // infoOpen is a refresh trigger on top of the original conditions: opening the details
  // popover mid-run re-fetches once, so its token breakdown isn't a whole Task stale
  // (applyUsageFetch is designed for mid-run reconciles — see header-stats.ts).
  useEffect(() => {
    if (!projectId || !selected) return;
    if (usageAppliedRef.current === selected.sessionId && stream.taskState !== "idle" && !infoOpen)
      return;
    let cancelled = false;
    api
      .getUsage(projectId, { groupBy: "session", agentId: selected.agentId })
      .then((res) => {
        if (cancelled) return;
        usageAppliedRef.current = selected.sessionId;
        const row = res.groups.find((g) => g.key === selected.sessionId);
        applyUsageFetch(costHoldRef.current, selected.sessionId, row ?? null);
        setUsageBuckets(
          row ? { cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output } : null,
        );
        bumpUsageStamp((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, stream.taskState, infoOpen]);

  // The currently selected Session, readable from an async callback that captured an older
  // one (the process actions below): a state value read through a closure would be the value
  // at click time, which is exactly what must not decide where a late response lands.
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Background-process list: fetched on session entry, then kept fresh while it can still
  // change — during a run (a foreground command may promote to background at any moment),
  // while any listed process is still running (it can exit on its own), and while the
  // details popover shows the list. Otherwise no timer runs: an idle session with no
  // processes has nothing to poll for. Fail-soft — a failed poll keeps the last list.
  const runningProcessCount = processes.filter((p) => p.running).length;
  const processesCanChange =
    stream.taskState !== "idle" || runningProcessCount > 0 || (infoOpen && processes.length > 0);
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    const refresh = () => {
      api
        .getSessionProcesses(selectedSessionId)
        .then((res) => {
          if (!cancelled) setProcesses(res.processes);
        })
        .catch(() => undefined);
    };
    refresh();
    if (!processesCanChange) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(refresh, PROCESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSessionId, stream.taskState, processesCanChange]);

  /**
   * Shared body of the per-row process actions (Stop / Remove): one request at a time
   * (procBusy), the statuses that only mean "the list was stale" swallowed instead of
   * toasted, and the list refreshed however the request ended — the truth comes from the
   * refresh, not from the response. The refresh is applied ONLY while its own session is
   * still selected: switching sessions mid-request would otherwise paint the previous
   * session's processes into the new session's card, and with the popover closed and
   * nothing running there is no poll to correct it.
   */
  const runProcessAction = useCallback(
    async (
      processId: string,
      request: (sessionId: string, processId: string) => Promise<void>,
      staleStatuses: readonly number[],
    ) => {
      if (!selected || procBusy !== null) return;
      const sessionId = selected.sessionId;
      setProcBusy(processId);
      try {
        await request(sessionId, processId);
      } catch (e) {
        if (!(e instanceof ApiError && staleStatuses.includes(e.status))) {
          toastError(apiErrorText(e));
        }
      } finally {
        setProcBusy(null);
        api
          .getSessionProcesses(sessionId)
          .then((res) => {
            if (selectedSessionIdRef.current === sessionId) setProcesses(res.processes);
          })
          .catch(() => undefined);
      }
    },
    [selected, procBusy],
  );

  // Stop one background process: the kill also removes it from the server-side registry,
  // so the follow-up refresh drops the row (a 404 means it already exited/was reaped —
  // same outcome, not an error worth surfacing).
  const onKillProcess = useCallback(
    (processId: string) => runProcessAction(processId, api.killSessionProcess, [404]),
    [runProcessAction],
  );

  // Remove one EXITED process entry from the list (#312; running rows offer Stop instead).
  // A 404 means the entry is already gone, a 409 that it is in fact (still) running —
  // either way the follow-up refresh shows the truth, so neither is surfaced as an error.
  const onRemoveProcess = useCallback(
    (processId: string) => runProcessAction(processId, api.removeSessionProcess, [404, 409]),
    [runProcessAction],
  );

  // Model config (context window + credential guide): fetched once per Project.
  //
  // The credential guide **only ever nags once per lifetime** (first entry after registration):
  // gated by the server prefs' credentialGuideSeen — previously it checked "default model has no
  // key" and popped up a dialog on every visit to the chat page, which was repeated nagging for
  // users who simply don't intend to configure a key / use environment variables instead.
  // "Has a key" is hasConfiguredKey, the same rule the model library and the model picker use: a
  // model backed by an exported environment variable is configured and must not be nagged.
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
        const missing = !res.defaultModel || !def || !hasConfiguredKey(def);
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

  // Project new-chat defaults saved in this tab (project-settings dialog) with a CHANGED
  // default model: refetch the model config so the "project default" marker and a later
  // draft mount see the fresh default. models goes null first — DraftView's model
  // fallback holds off while null, so it cannot re-pin the stale default from the old
  // response in the meantime (the mounted draft's own selection comes straight from the
  // event payload, see DraftView.onDefaultsChanged); a failed refetch leaves models null,
  // the same degraded state as a failed mount fetch.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const onEvent = (e: Event) => {
      const detail = chatDefaultsChangedDetail(e, projectId);
      if (!detail || detail.defaultModel === undefined) return;
      setModels(null);
      api
        .getModels(projectId)
        .then((res) => {
          if (!cancelled) setModels(res);
        })
        .catch(() => undefined);
    };
    window.addEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    };
  }, [projectId]);

  // Self-heal: the server returned a new session_id, update the route and list (shared by tasks and compact).
  const syncHealedSessionId = useCallback(
    async (currentId: string, respondedId: string) => {
      if (respondedId === currentId) return;
      await reloadSessions();
      // Same conversation under a new id: its docks follow, or they are stranded under
      // an id nothing routes to again.
      adoptDockScope(respondedId);
      navigate(`/chat/${respondedId}`, { replace: true });
    },
    [reloadSessions, navigate],
  );

  const onSend = useCallback(
    async (input: TaskInputPart[], goal: { budget: number } | null): Promise<boolean> => {
      if (!selected) return false;
      try {
        // No thinking level rides a task: the level belongs to the model context (pinned on
        // the Session through PATCH, see applyTurnThinkingLevel).
        const res = await api.postTask(selected.sessionId, {
          input,
          ...(goal ? { goal } : {}),
        });
        discardSessionDraft();
        await syncHealedSessionId(selected.sessionId, res.sessionId);
        return true;
      } catch (e) {
        // Returning false -> the input area keeps the draft, letting the user fix it and resend (the error copy includes the session model's upstream id).
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return false;
      }
    },
    [selected, turnThinkingLevel, discardSessionDraft, syncHealedSessionId],
  );

  // /model switch (handoff-style, mirroring onHandoff exactly): opens a NEW session for the
  // SAME agent on the picked model via the normal createSession API — deliberately with the
  // SOURCE session's Workspace, so files the conversation refers to stay reachable — then
  // posts a first task whose input starts with a [model_switch_from] source block (source
  // session id / its latest trace path / workspace / previous model pair) followed by the
  // user's remainder text and images. The earlier history is NOT injected into the new
  // context (some models require thinking payloads and provider fidelity byte-for-byte on
  // history replay, which cannot cross models); the model reads the source trace file itself
  // when it needs the context. Returns false on failure, keeping the draft so it can be
  // resent (the empty session that never got its first message is deleted, like handoff).
  const onSwitchModel = useCallback(
    async (ref: ModelRefDto, input: TaskInputPart[]): Promise<boolean> => {
      if (!projectId || !selected) return false;
      // The source's latest trace file path comes from the single-session GET (list rows
      // don't carry it); best-effort — a brand-new source has no trace, the block then
      // simply omits the line.
      const tracePath = await api
        .getSession(selected.sessionId)
        .then((res) => res.session.tracePath)
        .catch(() => undefined);
      const origin: TaskInputPart = {
        type: "text",
        text: modelSwitchMessage({
          sessionId: selected.sessionId,
          ...(selected.title !== undefined ? { sessionTitle: selected.title } : {}),
          ...(tracePath !== undefined ? { tracePath } : {}),
          workspace: selected.workspace,
          prevProvider: selected.provider,
          prevModelId: selected.modelId,
        }),
      };
      let createdId: string | null = null;
      try {
        const created = await api.createSession(projectId, selected.agentId, {
          provider: ref.provider,
          modelId: ref.modelId,
          workspace: selected.workspace,
          approvalMode: selected.approvalMode,
        });
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input: [origin, ...input] });
        addSession(created.session);
        // The remainder text has been carried into the new chat: discard the source session's input draft along with it.
        discardSessionDraft();
        navigate(`/chat/${res.sessionId}`);
        return true;
      } catch (e) {
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        toastError(apiErrorText(e, { modelId: ref.modelId }));
        return false;
      }
    },
    [projectId, selected, addSession, discardSessionDraft, navigate],
  );

  // /agent handoff: doesn't use the current Session — creates a new chat for the picked agent
  // (approval mode carries over from the input area's current value; model/Workspace use the
  // creation defaults). The first input = a [handoff_from] source block (current agent / Session
  // / Workspace info) + the user's input and images; jumps to the new
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

  // Follow-up queue: post the full input with queueIfBusy — a busy session holds it
  // server-side and auto-sends it as an ordinary next task once this run finishes (the
  // "N queued" count arrives via task_state). Succeeds either way (queued or started
  // directly in the completion race), so the input area clears the draft on true.
  // The per-turn thinking level rides along exactly as it does on onSend: the level is the
  // one picked when the follow-up was composed, and the server keeps it with the queued
  // input and applies it at auto-start (see TaskCreateRequest.queueIfBusy).
  const onQueueFollowUp = useCallback(
    async (input: TaskInputPart[]): Promise<boolean> => {
      if (!selected) return false;
      try {
        const res = await api.postTask(selected.sessionId, { input, queueIfBusy: true });
        discardSessionDraft();
        await syncHealedSessionId(selected.sessionId, res.sessionId);
        return true;
      } catch (e) {
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return false;
      }
    },
    [selected, turnThinkingLevel, discardSessionDraft, syncHealedSessionId],
  );

  // Mid-run steering: the message is queued on the server and delivered between turns as a
  // standalone `[user_steering]` user message followed by its images (visible once they
  // arrive over SSE / from the Trace); file attachments land in the Session scratchpad and
  // ride the steering text as `[attached file: <path>]` lines, exactly as a task's do. On
  // "queued" the localStorage draft is discarded, like a successful send — without this a
  // reload resurrects the already-sent text as a draft, and re-sending it duplicates the
  // steering message (#136). "not_running" (409) means no Task is in progress anymore (race
  // with completion): the input area then falls back to its **full** normal send path —
  // skills and the whole draft included — rather than a text+images task.
  const onSteer = useCallback(
    async (
      text: string,
      images: string[] = [],
      files: { fileName: string; dataUrl: string }[] = [],
    ): Promise<"queued" | "not_running" | "failed"> => {
      if (!selected) return "failed";
      try {
        await api.postSteer(selected.sessionId, {
          text,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        });
        discardSessionDraft();
        return "queued";
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return "not_running";
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return "failed";
      }
    },
    [selected, discardSessionDraft],
  );

  // Pins a picked level on the Session so it outlives this tab: PATCH, then swap the
  // returned row into the session store (the picker reads it back from there); it applies
  // from the next LLM request (the picker's menu advises compacting first). Modeled on
  // onChangeApprovalMode — a failed write surfaces as a toast and leaves the level as it
  // was, rather than showing a level the server does not have.
  const applyTurnThinkingLevel = useCallback(
    (level: string) => {
      if (!selected) return;
      void api
        .patchSession(selected.sessionId, {
          thinkingLevel: level as SessionPatchRequest["thinkingLevel"],
        })
        .then((res) => replace(res.session))
        .catch((e: unknown) => {
          toastError(apiErrorText(e));
        });
    },
    [selected, replace],
  );

  // Recall a queued message back into the composer (#287): the DELETE returns the original
  // content (text / images / files) and the input area restores it as the draft. A 409 —
  // not_pending (steering already delivered) or follow_up_started (the follow-up already
  // became a task) — surfaces as a toast, each with its own sentence; the queued hint
  // retires on its own via the re-broadcast task_state.
  const onRecallSteering = useCallback(
    async (steerId: string) => {
      if (!selected) return null;
      try {
        return await api.recallSteer(selected.sessionId, steerId);
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
      }
    },
    [selected],
  );

  const onRecallFollowUp = useCallback(
    async (followUpId: string) => {
      if (!selected) return null;
      try {
        // A queued follow-up carries no thinking level of its own: the level lives on the
        // Session and applies per model context, so a resend goes out at whatever the Session
        // is pinned to.
        return await api.recallFollowUp(selected.sessionId, followUpId);
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
      }
    },
    [selected],
  );

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

  // Starts a context compaction — the single path to the server for it (the composer's
  // /compact command and the thinking-switch dialog's "compact, then switch" both come
  // through here). Returns whether the request was ACCEPTED: the endpoint answers 202 and
  // the compaction itself runs asynchronously, so a true here means "started", not
  // "finished" — the outcome only shows up on the stream (see the staged-switch watcher).
  // false means the server refused it (409 while a task runs / nothing to compact / …) and
  // the reason has already been surfaced as a toast.
  const runCompaction = useCallback(async (): Promise<boolean> => {
    if (!selected) return false;
    try {
      // compact shares get-or-resume-or-heal with tasks: it can likewise self-heal to a new session_id.
      const res = await api.postCompact(selected.sessionId);
      await syncHealedSessionId(selected.sessionId, res.sessionId);
      return true;
    } catch (e) {
      toastError(apiErrorText(e, { modelId: selected.modelId }));
      return false;
    }
  }, [selected, syncHealedSessionId]);

  // The composer's /compact command: unchanged behavior (fire it, errors land as a toast).
  const onCompact = useCallback(async () => {
    await runCompaction();
  }, [runCompaction]);

  // Session picker pick: pinned directly while it cannot hurt (empty transcript, a re-pick
  // of the displayed level, or right after a successful compaction), staged behind the
  // confirm dialog otherwise — switching the level mid-chat costs prompt-cache hits over
  // the whole history (issue #310), so the dialog offers compact-then-switch (recommended),
  // switch anyway, or cancel. The transcript is always loaded when the picker is clickable
  // (the composer only mounts once history load settles), so the live tail items are
  // authoritative here.
  const onPickTurnThinkingLevel = useCallback(
    (level: string) => {
      if (
        needsThinkingSwitchConfirm(
          stream.model.items,
          sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel),
          level,
        )
      ) {
        setThinkingSwitch({ phase: "ask", level });
      } else {
        applyTurnThinkingLevel(level);
      }
    },
    [stream.model, turnThinkingLevel, agentThinkingLevel, applyTurnThinkingLevel],
  );

  // Dialog choice 1 (recommended): compact first, then switch. The compaction is only
  // STARTED here — POST /compact answers 202 — so the pick is held with a tally of the
  // compactions already on record, and the watcher below releases it once a new one ends
  // (either way it ends). Compaction cannot be started (nor queued) while the session is
  // busy, so the dialog disables this choice unless idle; the guard here is the same rule.
  const compactThenThinkingSwitch = useCallback(() => {
    if (thinkingSwitch === null || stream.taskState !== "idle") return;
    const staged: StagedThinkingSwitch = {
      phase: "compacting",
      level: thinkingSwitch.level,
      baseline: compactionTally(stream.model.items),
    };
    setThinkingSwitch(staged);
    toastInfo(S.chat.thinkingSwitchCompacting);
    void runCompaction().then((ok) => {
      // Refused (the toast already said why, e.g. nothing to compact): no compaction will
      // ever settle, so hand the pick to the watcher below to release — the user asked to
      // switch, and only the compaction half of that failed. A pick staged meanwhile owns
      // the state instead.
      if (!ok) {
        setThinkingSwitch((cur) =>
          cur === staged ? { phase: "settle", level: staged.level } : cur,
        );
      }
    });
  }, [thinkingSwitch, stream.taskState, stream.model, runCompaction]);

  // Releases the pick held behind a running compaction: applied as soon as the compaction is
  // over, whichever way it ended. A failed/aborted compaction is reported (the context was
  // not rewritten, so this switch does cost cache hits) but never swallows the switch the
  // user asked for. Runs on every stream version bump because the model's items are mutated
  // in place.
  useEffect(() => {
    if (thinkingSwitch === null) return;
    const next = heldThinkingSwitch(thinkingSwitch, stream.model.items);
    if (next.act === "wait") return;
    setThinkingSwitch(null);
    applyTurnThinkingLevel(next.level);
    if (next.notice === "compacted") {
      toastSuccess(
        S.chat.thinkingSwitchApplied(
          thinkingLevelLabel(S.chat.thinkingLevelNames, next.level) ?? next.level,
        ),
      );
    } else if (next.notice === "compaction-failed") {
      toastError(S.chat.thinkingSwitchCompactFailed);
    }
    // notice "none": the compaction never started and runCompaction already said why.
    // The items are read from the model per run; `version` is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.version, stream.model, thinkingSwitch, applyTurnThinkingLevel]);

  // "New Chat" = enter draft state: no Session is created until the first message is sent.
  // Typed-but-unsent text in the ACTIVE new-chat draft first becomes a parked draft
  // conversation (a sidebar row, sendable anytime) instead of lingering invisibly in the
  // cache — the sidebar's own new-chat entries do the same (sidebar.tsx).
  const newChat = useCallback(() => {
    if (user && projectId) parkActiveDraft(user.userId, projectId);
    navigate(`/chat/${DRAFT_SESSION_ID}`);
  }, [user, projectId, navigate]);

  // Auth-dead notice primary CTA: the Models page is where the credential is actually fixed.

  const onFork = useCallback(
    async (target: ForkTarget): Promise<void> => {
      if (!selected) return;
      try {
        let position = target.position;
        // Live SSE messages do not carry disk coordinates. Once the Task is idle, one history
        // read resolves the just-finished footer onto the immutable Trace position; the fork
        // request itself always sends that position, never display text or a timestamp.
        if (position === undefined) {
          const history = await api.getMessages(selected.sessionId);
          const model = createStreamModel();
          for (const message of history.messages) pushMessage(model, message);
          finalizeHistory(model);
          const match = [...model.items]
            .reverse()
            .find(
              (item) =>
                item.kind === "task_stats" &&
                item.assistantText === target.assistantText &&
                item.atMs === target.atMs &&
                item.forkPosition !== undefined,
            );
          position = match?.kind === "task_stats" ? match.forkPosition : undefined;
        }
        if (position === undefined) {
          toastError(S.chat.forkSessionFailed);
          return;
        }
        const created = await api.forkSession(selected.sessionId, { position });
        addSession(created.session);
        navigate(`/chat/${created.session.sessionId}`);
      } catch (e) {
        toastError(apiErrorText(e, { modelId: selected.modelId }));
      }
    },
    [selected, addSession, navigate],
  );

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
    taskCost: (stats) => bucketCostUsd(stats.tokensByBucket, modelPricing),
    // Reconnect countdown controls (live waiting state only): retry-now skips the
    // remaining backoff server-side (benign no-op on timing races), give-up is the
    // ordinary session abort — the engine's abort-during-backoff path ends the turn.
    onRetryNow: () => {
      if (selected) void api.postRetryNow(selected.sessionId).catch(() => undefined);
    },
    onGiveUp: () => {
      void onStop();
    },
    onOpenFile: (path) => {
      // The file card has already normalized the text path to a Workspace-relative path
      // (toWorkspaceRelative, including stripping absolute-path prefixes and converting
      // Windows separators), so this just brings the Workspace tab up and navigates to it.
      openPanel("workspace");
      setFileOpenRequest({ path });
    },
    onOpenSubagent: (sessionId, origin) => {
      // Chip click: the agents tab focused on that child (the focus chain ends with the
      // child's own id), with the graph pinned to this chip's Task.
      openPanel("agents");
      setSubagentTaskScope({ anchorSessionId: origin[0] ?? sessionId });
      setSubagentFocus({ sessionId, origin: [...origin, sessionId] });
    },
    onOpenMemory: () => {
      // The Memory tab on its list.
      openPanel("memory");
      setMemoryRequest({ target: null });
    },
    onLocateMemoryChange: (row) => {
      openPanel("memory");
      setMemoryRequest({
        target: {
          scope: row.scope,
          ...(row.scopeKey !== undefined ? { scopeKey: row.scopeKey } : {}),
          file: row.file,
        },
      });
    },
    ...(deletedMemoryKeys !== undefined ? { deletedMemoryKeys } : {}),
    workspace: selected?.workspace ?? null,
    statFiles,
    onFork,
  };

  // Any pending approval sitting inside a subagent (approvalKey = "originChain toolCallId";
  // main-session keys start with a space): surfaces an amber dot on the toolbar button so a
  // nested approval stays discoverable while the panel is closed.
  const anySubagentPending = [...stream.pendingApprovals.keys()].some((k) => !k.startsWith(" "));

  // The docks to render: right beside the chat row, bottom below it (the narrow merged
  // view arrives as a bottom view). They render on the draft page too — the arrangement is
  // the user's workbench, and a terminal opened while drafting must be visible — with the
  // session-bound panels showing a placeholder until the first send creates the Session.
  // useDockMount keeps a closing dock mounted through its collapse transition and skips
  // the animation for instant changes (scope switches, cross-dock moves).
  const views = dockViews();
  const rightMount = useDockMount(views.find((view) => view.position === "right") ?? null);
  const bottomMount = useDockMount(views.find((view) => view.position === "bottom") ?? null);
  const terminalSupported = terminalApiSupported();

  /**
   * The panel tabs' bodies. Keyed by Session where the view starts over per conversation
   * (agents / memory / trace); the Workspace browser instead re-binds through its props —
   * its own handled-once request guard is what the conversation-switch e2e covers.
   */
  const renderPanel = (kind: PanelKind, active: boolean): ReactNode => {
    if (!selected) return <EmptyState title={panelLabel(kind)} description={S.dock.draftEmpty} />;
    switch (kind) {
      case "agents":
        return (
          <SubagentsView
            key={selected.sessionId}
            session={selected}
            // The merged view (backfilled windows included): a chip on an older turn keeps
            // its historical graph and child conversation reachable after pagination.
            model={panelModel}
            version={stream.version}
            taskRunning={stream.taskState !== "idle"}
            ctx={ctx}
            focusRequest={subagentFocus}
            taskScope={subagentTaskScope}
            subagents={stream.subagents}
            models={models?.models ?? []}
            approvalMode={selected.approvalMode}
            onChangeApprovalMode={onChangeApprovalMode}
            modeSaving={modeSaving}
            parentThinkingLevel={sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel)}
          />
        );
      case "workspace":
        return (
          <WorkspaceBrowser
            session={selected}
            openRequest={fileOpenRequest}
            active={active}
            reloadSignal={settledTurnSignal}
          />
        );
      case "memory":
        return (
          <ChatMemoryView
            key={selected.sessionId}
            session={selected}
            changes={sessionMemoryChanges}
            scopes={memoryListing.scopes}
            listingError={memoryListing.error}
            request={memoryRequest}
            active={active}
            // Management (add / edit / delete) lives on the agent-settings memory tab.
            onOpenSettings={() => navigate(`/agents/${selected.agentId}?tab=memory`)}
          />
        );
      case "trace":
        return (
          <TracePanel
            key={selected.sessionId}
            session={selected}
            active={active}
            reloadSignal={settledTurnSignal}
          />
        );
      case "messaging":
        return (
          <MessagingPanel key={selected.sessionId} sessionId={selected.sessionId} active={active} />
        );
    }
  };

  if (!projectId || !agentId) {
    return (
      <div className="p-6">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }

  // Header statistics (chip row + info dropdown), live while a Task runs; recomputed every
  // stream version bump, so the in-place-mutated model stats always read fresh. The cost chip
  // advances its per-session hold with this render's observation (idempotent per observation,
  // so a replayed render converges — see header-stats.ts).
  const liveTaskUsd = stream.model.taskOpen
    ? bucketCostUsd(
        {
          cacheRead: stream.model.stats.taskCacheRead,
          cacheWrite: stream.model.stats.taskCacheWrite,
          output: stream.model.stats.taskOutput,
        },
        modelPricing,
      )
    : null;
  const hs = headerStats(
    stream.model,
    advanceCostStat(costHoldRef.current, {
      sessionId: selected?.sessionId ?? null,
      // The cost tracker's Task boundary is the MODEL's, not the panel's: a completion notice
      // opens a new Task (zeroing the per-Task usage buckets) even though the panel keeps it
      // inside the launching Task's scope, so it must be counted here or the finished half's
      // live cost is dropped instead of folded.
      taskCount: modelTaskStartCount(stream.model.items),
      taskOpen: stream.model.taskOpen,
      loading: stream.loading,
      liveUsd: liveTaskUsd,
      currency,
    }),
  );
  // Cache hit rate over the recorded input buckets (cacheRead = hits, cacheWrite =
  // uncached input) — the details card's tokens-line parenthetical. Null until a usage
  // row with any input has applied, so a fresh session shows no "0%" out of thin air.
  const recordedInput = usageBuckets ? usageBuckets.cacheRead + usageBuckets.cacheWrite : 0;
  const cacheHitRate =
    usageBuckets && recordedInput > 0
      ? `${Math.round((100 * usageBuckets.cacheRead) / recordedInput)}%`
      : null;
  // Display name of the Session's own Agent for the details card — null when the Agent has
  // no name of its own (agentDisplayName then returns the id, which the row already shows)
  // or when the Agent list hasn't arrived yet.
  const sessionAgent = agents.find((a) => a.agentId === selected?.agentId);
  const sessionAgentName =
    sessionAgent && sessionAgent.name !== undefined ? agentDisplayName(sessionAgent) : null;
  const modelInfo = models?.models.find((m) => sameModelRef(m, activeModelRef));
  const contextWindow = modelInfo?.contextWindow;
  // Assumed supported by default: only models explicitly marked vision=false show a blocking hint when adding images.
  const vision = modelInfo?.vision !== false;
  const emptyChat =
    selected !== null && !stream.loading && !stream.error && stream.model.items.length === 0;

  // Input area in session state: Agent / Workspace / Model are already locked by the Session
  // (the model selector isn't rendered; models feeds the locked model's read-only display and
  // the /model switch picker) — approval mode and the per-turn thinking level stay editable;
  // /model forks the conversation onto another model.
  const input = selected && (
    <ChatInput
      status={stream.taskState}
      onSend={onSend}
      onSteer={onSteer}
      // Count of steering messages already visible in the stream: the input area keeps its
      // "queued" indicator up until this count increases (i.e. the steering message arrived).
      steeringDeliveredCount={stream.model.items.filter((i) => i.kind === "user_steering").length}
      pendingSteering={stream.pendingSteering}
      onRecallSteering={onRecallSteering}
      onQueueFollowUp={onQueueFollowUp}
      queuedFollowUps={stream.queuedFollowUps}
      pendingFollowUps={stream.pendingFollowUps}
      onRecallFollowUp={onRecallFollowUp}
      onStop={onStop}
      onCompact={onCompact}
      modelRef={activeModelRef}
      {...(models !== null ? { models: models.models } : {})}
      {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
      onSwitchModel={onSwitchModel}
      // Display value: the level pinned on this Session, else the Agent config's level
      // (auto-follow while unpinned; the send path uses the raw pin — see onSend).
      turnThinkingLevel={sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel)}
      // Guarded: a mid-chat change stages behind the prefix-cache confirm dialog (issue #310).
      onChangeTurnThinkingLevel={onPickTurnThinkingLevel}
      {...(contextWindow !== undefined ? { contextWindow } : {})}
      contextNow={stream.model.stats.contextNow}
      contextStale={stream.model.stats.contextStale}
      sessionId={selected.sessionId}
      vision={vision}
      approvalMode={selected.approvalMode}
      onChangeApprovalMode={onChangeApprovalMode}
      modeSaving={modeSaving}
      autoFocus
      agents={agents}
      currentAgentId={selected.agentId}
      skills={agentSkills}
      {...(sessionDraft.skills && sessionDraft.skills.length > 0
        ? { initialSkills: sessionDraft.skills }
        : {})}
      onSkillsChange={onDraftSkillsChange}
      onHandoff={onHandoff}
      initialText={sessionDraft.text ?? ""}
      onTextChange={onDraftTextChange}
      history={inputHistory}
      {...(sessionDraft.handoffAgentId
        ? { initialHandoffTargetId: sessionDraft.handoffAgentId }
        : {})}
      onHandoffTargetChange={onDraftHandoffChange}
      {...(sessionDraft.switchModelRef
        ? { initialPendingModelRef: sessionDraft.switchModelRef }
        : {})}
      onPendingModelChange={onDraftPendingModelChange}
    />
  );

  /**
   * Header glyph state. Never unread: this is the Session on screen, so its last reply is being
   * read right now — the read/unread split is a sidebar affordance, and passing the live marker
   * here would only flash the unread tone for the frame before the effect above stamps it.
   */
  const headerActivity =
    selected === null ? null : sessionActivity(stream.taskState, selected.hasTrace, false);

  return (
    // data-dock-host: the docks' edge bands, drop preview and the bottom dock's height
    // ratio all measure this column (dock-drag.tsx / dock-panel.tsx).
    <div data-dock-host className="relative flex h-full flex-col bg-white dark:bg-gray-950">
      {/* Workflow tabs: the Agent's own pages beside the chat. A workflow tab covers the
          chat (which stays mounted, so its state survives a look at the page) below the
          strip; the strip is absent when the Agent has no workflow with a UI. */}
      <WorkflowTabStrip
        tabs={workflowTabs.tabs}
        active={workflowTabs.active}
        onSelect={workflowTabs.setActive}
      />
      {workflowTabs.activeTab !== null && projectId !== null && agentId !== null && (
        <div className="absolute inset-x-0 bottom-0 top-9 z-10">
          <WorkflowFrame
            projectId={projectId}
            agentId={agentId}
            tab={workflowTabs.activeTab}
            onChanged={() => void workflowTabs.refresh()}
            onRemoved={() => {
              workflowTabs.setActive(null);
              void workflowTabs.refresh();
            }}
          />
        </div>
      )}
      {/* Thin top toolbar */}
      {selected && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h1 className="flex min-w-0 text-[15px] font-semibold">
              <Truncated text={selected.title ?? S.chat.defaultSessionTitle} />
            </h1>
            {/* Session-level state: a turning hourglass while the run is active, and nothing at
                all once it settles — the conversation on screen is by definition read, and the
                unread dot is a sidebar affordance for the rows you are NOT looking at. The
                compacting state stays in the stream banner rather than being repeated here.
                Below sm only the glyph remains so the title keeps its room. */}
            {headerActivity === "running" && (
              <span
                title={sessionActivityLabel(headerActivity)}
                className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
              >
                <SessionActivityIcon activity={headerActivity} />
                <span className="hidden sm:inline">{sessionActivityLabel(headerActivity)}</span>
              </span>
            )}
          </div>

          {/* Panel switcher (icon-only): pinned triggers + the "create" dropdown with
              placement actions and pin toggles. Every entry is a dock tab (features/dock)
              — the toolbar reads and drives the dock store directly; this page only feeds
              the pending-approval dot. */}
          <PanelsToolbar agentsPending={anySubagentPending} />

          {/* Conversation index fallback: exactly when the gutter tick rail can't show
              (phones without a hover pointer; a desktop window whose gutter a docked panel
              ate) the index moves up here as a dropdown — navigation stays reachable. */}
          {!railFit.shown && (
            <OutlineMenuButton
              entries={outline}
              turnOffset={stream.outlineOffset}
              scrollRef={streamScrollRef}
              running={stream.taskState !== "idle"}
            />
          )}

          {/* Details entry, at the toolbar's far right — the stats ARE the trigger: wide
              viewports show the live chips (Token / cost / elapsed, plus the running-services
              count while any process is alive) and clicking them opens the details card; narrow
              viewports collapse the whole thing to the single info icon. There is no separate
              info icon while the chips are visible. */}
          <Dropdown
            open={infoOpen}
            setOpen={setInfoOpen}
            menuClass="right-0 top-full mt-1 w-96 max-w-[calc(100vw-1.5rem)] origin-top-right"
            button={
              <button
                type="button"
                title={S.chat.infoPanel}
                aria-label={S.chat.infoPanel}
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen(!infoOpen)}
                className={`flex h-7 shrink-0 items-center rounded-md transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  infoOpen ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                {/* Wide: the chip row (icon + title per chip carries the full meaning). */}
                <span className="hidden items-center gap-3 px-2 sm:flex">
                  <StatChip
                    icon={STAT_ICONS.tokens}
                    value={hs.tokensText}
                    label={`${S.chat.statTokens}（Token）`}
                  />
                  {/* When there's no cost (the Model has no pricing configured), don't render
                      this stat at all, rather than showing a "—" — that would take up space
                      while saying nothing, only making people think the cost is zero or
                      something's broken. */}
                  {hs.costText != null && (
                    <StatChip
                      icon={STAT_ICONS.cost}
                      value={`${hs.costText}${hs.costUncosted ? " *" : ""}`}
                      label={`${S.common.cost}（${currency}）${hs.costUncosted ? ` · ${S.usage.uncostedNote}` : ""}`}
                    />
                  )}
                  <StatChip
                    icon={STAT_ICONS.elapsed}
                    value={hs.elapsedNode}
                    label={S.chat.statElapsed}
                  />
                  {/* Right of the time, only while the conversation has live background
                      processes: their count, in the live-status green. */}
                  {runningProcessCount > 0 && (
                    <span
                      title={S.chat.runningServices(runningProcessCount)}
                      className={`flex shrink-0 items-center ${ICON_GAP.tight} font-mono text-xs ${toneInk.busy}`}
                    >
                      <GlyphIcon d={STAT_ICONS.services} />
                      {runningProcessCount}
                    </span>
                  )}
                </span>
                {/* Narrow: the info icon alone (the chips would crowd the title out). */}
                <span className="flex h-7 w-7 items-center justify-center text-gray-500 sm:hidden dark:text-gray-400">
                  <GlyphIcon d={INFO_ICON} size={ICON_SIZE.navRow} />
                </span>
              </button>
            }
          >
            <div className="space-y-3 px-3.5 py-2.5 text-sm">
              {/* Agent, above the Model: a conversation belongs to an Agent first, and the
                  Model it runs on is one of that Agent's settings. Paired the same way as the
                  Model row — the id the API speaks, then the display name, which is dropped
                  when the Agent has none of its own and the two would simply repeat. */}
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {S.chat.agent}
                </p>
                <p className="truncate text-xs">
                  <span className="font-mono">{selected.agentId}</span>
                  {sessionAgentName !== null && (
                    <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                      {sessionAgentName}
                    </span>
                  )}
                </p>
              </div>
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
              <SessionIdRow sessionId={selected.sessionId} />
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
                {/* A bulleted list, one stat per line. The tokens bullet carries the cache
                    hit rate in parentheses (cacheRead ÷ all recorded input); the rate comes
                    from the usage fetch, so it can trail the live total mid-run and
                    reconciles on idle. No-cost sessions omit the cost bullet entirely, as
                    the chip does. */}
                <ul className="list-inside list-disc space-y-0.5 font-mono text-xs">
                  <li>
                    {S.chat.statTotalTokens} {hs.tokensText}
                    {cacheHitRate !== null &&
                      `${S.chat.statParenOpen}${S.chat.statCacheHit(cacheHitRate)}${S.chat.statParenClose}`}
                  </li>
                  {hs.costText != null && (
                    <li>
                      {S.common.cost} {hs.costText}
                      {hs.costUncosted ? " *" : ""}
                    </li>
                  )}
                  <li>
                    {S.chat.statElapsed} {hs.elapsedNode}
                  </li>
                </ul>
              </div>
              {/* Background processes the conversation started (e.g. a dev server on
                  localhost:3000): live rows carry a stop button — the kill signals the whole
                  process group and the row drops on the follow-up refresh; exited rows keep
                  their "exited" label and carry a remove button that deletes the entry from
                  the list (#312). Hidden entirely while there are none. */}
              {processes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.chat.processList}
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {processes.map((p) => (
                      <li key={p.processId} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            p.running
                              ? `animate-pulse ${toneDot.busy}`
                              : "bg-gray-300 dark:bg-gray-600"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs" title={p.cmd}>
                            {p.cmd}
                          </span>
                          <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
                            {formatDateTime(p.startedAt)}
                            {p.pid !== null && ` · pid ${p.pid}`}
                            {/* Detected service URL (output scan or port probe), running rows
                                only — an exited process serves nothing to open. Scheme dropped
                                at this size; the tooltip and the link carry the full URL. */}
                            {p.running && p.serviceUrl !== undefined && (
                              <>
                                {" · "}
                                <a
                                  href={p.serviceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={p.serviceUrl}
                                  className="text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-700 hover:decoration-gray-500 dark:text-gray-400 dark:decoration-gray-600 dark:hover:text-gray-200"
                                >
                                  {p.serviceUrl.replace(/^https?:\/\//i, "")}
                                </a>
                              </>
                            )}
                          </span>
                        </span>
                        {p.running ? (
                          <button
                            type="button"
                            disabled={procBusy !== null}
                            onClick={() => void onKillProcess(p.processId)}
                            className="shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          >
                            {procBusy === p.processId ? S.common.loading : S.chat.processStop}
                          </button>
                        ) : (
                          <>
                            <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                              {S.chat.processExited}
                            </span>
                            {/* The row is the only handle on that process's captured
                                output — removing the entry drops it from the runtime
                                registry, so the model can no longer be asked to read it
                                (input_command answers "unknown process_id"). No confirm
                                step for a one-click tidy-up of a dead row, but the title
                                says what leaves with it. */}
                            <button
                              type="button"
                              title={S.chat.processRemoveHint}
                              disabled={procBusy !== null}
                              onClick={() => void onRemoveProcess(p.processId)}
                              className="shrink-0 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 transition-colors duration-150 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-default disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            >
                              {procBusy === p.processId ? S.common.loading : S.chat.processRemove}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      )}

      {/* Body: chat column + the right dock on this row (below the toolbar — a dock
          beside the whole page would squeeze the header), with the bottom dock after the
          row spanning the full page width. data-dock-row is what the drag preview
          measures for a right landing. */}
      <div data-dock-row className="flex min-h-0 flex-1">
        {/* The chat area, and the only region a dragged file may be dropped on (#311): it
            covers the conversation and the composer in both branches below, and nothing else
            — the sidebar, the mobile top bar, the toolbar above and the docked panels beside
            it (terminal panes included) are all outside, where a file drop is inert (see
            drop-zone.tsx). `relative` bounds the drop overlay to this column. */}
        <ChatDropRegion className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {draft ? (
            // Draft state: DraftView's vertically centered input card + Agent / Workspace
            // selection panel; the Session is only created once the first message is sent. Keyed
            // by Project (switching Project remounts onto that Project's draft cache) and by the
            // parked-draft id — falling back to location.key for `/chat/new`, so clicking "New
            // chat" while already on the draft page (which just parked the typed text) remounts
            // onto the freshly cleared cache. (Agent selection happens inside the draft itself,
            // so it's not part of the key.)
            <DraftView
              key={`draft:${projectId}:${parkedDraftId ?? location.key}`}
              projectId={projectId}
              models={models}
              {...(parkedDraftId !== null ? { draftId: parkedDraftId } : {})}
            />
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
                          items={allItems}
                          version={stream.version}
                          ctx={ctx}
                          scrollElRef={streamScrollRef}
                          // The loaded run's two frontiers (windowed history): near-top
                          // scrolling prepends the previous window; once scrolling up has
                          // shed the live tail, near-bottom scrolling walks back down to
                          // it. The reader stays anchored through both (see MessageStream).
                          older={{
                            hasMore: stream.older.hasMore,
                            loading: stream.older.loading,
                            error: stream.older.error,
                            atBeginning: stream.windowCount > 0,
                            edgesVersion: stream.edgesVersion,
                            onLoad: stream.loadOlder,
                          }}
                          newer={{
                            hasMore: stream.newer.hasMore,
                            loading: stream.newer.loading,
                            error: stream.newer.error,
                            onLoad: stream.loadNewer,
                            onJump: stream.jumpToLatest,
                          }}
                          // Tick-rail minimap over the stream's left gutter (zero layout
                          // width; hides itself when the gutter is too narrow or the
                          // pointer can't hover).
                          outline={
                            <ConversationOutline
                              entries={outline}
                              turnOffset={stream.outlineOffset}
                              version={stream.version}
                              scrollRef={streamScrollRef}
                              running={stream.taskState !== "idle"}
                              fit={railFit}
                            />
                          }
                        />
                      )}
                    </div>
                    <div className="shrink-0 border-t border-gray-200 bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:pb-3 dark:border-gray-800 dark:bg-gray-950">
                      <div className="mx-auto max-w-3xl">
                        {/* Goal banner docked above the composer: an in-flight goal's progress
                            (restored on load while still active), or the terminal state reached
                            during this page's lifetime. The stop button is the composer's
                            regular stop (one abort ends the whole goal loop). */}
                        {stream.goal && <GoalStatusBanner goal={stream.goal} />}
                        {input}
                      </div>
                    </div>
                  </>
                )
              ) : sessionsLoading || routeSessionPending ? (
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
        </ChatDropRegion>

        {rightMount.view && (
          <DockPanel
            view={rightMount.view}
            open={rightMount.open}
            animateEntrance={rightMount.animateEntrance}
            renderPanel={renderPanel}
            panelBadges={{ agents: anySubagentPending }}
            terminalSupported={terminalSupported}
          />
        )}
      </div>

      {bottomMount.view && (
        <DockPanel
          view={bottomMount.view}
          open={bottomMount.open}
          animateEntrance={bottomMount.animateEntrance}
          renderPanel={renderPanel}
          panelBadges={{ agents: anySubagentPending }}
          terminalSupported={terminalSupported}
        />
      )}

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

      {/* Mid-chat thinking-level switch confirmation (issue #310), three choices: compact
          first and switch when it finishes (primary — the recommended, cheap path), switch
          anyway (immediate, today's force path), or cancel (keeps the current level). The
          compact choice is unavailable while the session is busy — the server only starts a
          compaction on an idle session and does not queue it — and the body then says so.
          After a successful compaction the guard lets a re-pick through without asking. */}
      <ConfirmModal
        open={thinkingSwitch?.phase === "ask"}
        title={S.chat.thinkingSwitchTitle}
        tone="primary"
        confirmLabel={S.chat.thinkingSwitchCompactFirst}
        confirmDisabled={stream.taskState !== "idle"}
        onConfirm={compactThenThinkingSwitch}
        secondaryLabel={S.chat.thinkingSwitchConfirm}
        onSecondary={() => {
          if (thinkingSwitch !== null) applyTurnThinkingLevel(thinkingSwitch.level);
          setThinkingSwitch(null);
        }}
        onClose={() => setThinkingSwitch(null)}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.chat.thinkingSwitchBody(
            thinkingLevelLabel(S.chat.thinkingLevelNames, thinkingSwitch?.level) ??
              thinkingSwitch?.level ??
              "",
          )}
        </p>
        {stream.taskState !== "idle" && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {S.chat.thinkingSwitchBusyHint}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
