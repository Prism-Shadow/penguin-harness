/**
 * Chat page (refactored version):
 * a thin top toolbar (Session title / status / iconized stats / Agents + Files toggles /
 * details popup) + the message stream and input area (input box vertically centered when there
 * are no messages).
 * Files is no longer a mutually exclusive tab — it's a persistent, closable, resizable docked
 * panel on the right (use-files-panel.ts), and each message's trailing file summary card jumps to
 * and locates the file in the tree via onOpenFile. The subagents panel docks the same way
 * (use-subagents-panel.ts): subagent chips in the stream open it focused via onOpenSubagent,
 * and the two docked panels are mutually exclusive (coordinated here, not in the hooks).
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
  SessionPatchRequest,
  SessionProcessInfo,
  SessionStatus,
  SkillMetadataItem,
  TaskCreateRequest,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import {
  adoptDockScope,
  chatSidePanelOpen,
  dockStateVersion,
  setChatSidePanelOpen,
  subscribeTerminalDock,
  visiblePanes,
} from "../terminal/terminal-dock-state";
import { apiErrorText } from "../../lib/api-error";
import { pathFileName } from "../../lib/file-path";
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
  isModelAuthDead,
  pushMessage,
} from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import { bucketCostUsd, liveSessionElapsedMs } from "../../lib/omni/task-stats";
import type { TaskStatsTracker } from "../../lib/omni/task-stats";
import { useAuth } from "../../state/auth";
import { useTheme } from "../../state/theme";
import { useProject } from "../../state/project";
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
import { latestTaskHasSubagent, taskStartCount } from "./agent-topology";
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
import { CHAT_DEFAULTS_CHANGED_EVENT, chatDefaultsChangedDetail } from "./chat-defaults-event";
import { advanceCostStat, applyUsageFetch, createCostStatHold } from "./header-stats";
import type { CostStatDisplay } from "./header-stats";
import { buildInputHistory } from "./input-history";
import { buildOutline } from "./outline-model";
import { GoalStatusBanner } from "./goal-banner";
import { handoffMessage, modelSwitchMessage } from "./agent-handoff";
import { sameModelRef } from "../models/model-grouping";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { FilesPanel } from "./files-panel";
import { useFilesPanel } from "./use-files-panel";
import type { FilesPanelState } from "./use-files-panel";
import { SubagentsPanel } from "./subagents-panel";
import { TerminalDockSlot } from "../terminal/terminal-dock-slot";
import {
  advancePanelTaskScope,
  createPanelTaskScope,
  useSubagentsPanel,
} from "./use-subagents-panel";
import type { SubagentsPanelState } from "./use-subagents-panel";
import { useSessionDraft } from "./use-session-draft";
import { useSessionStream } from "./use-session-stream";
import { PanelsToolbar } from "./panels-toolbar";

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
  // Running services (server rack: two stacked units with an indicator dot each)
  services:
    "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm0 11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3zM7 6.5h.01M7 17.5h.01",
} as const;

/** How often the background-process list refreshes while it can still change (a run may promote a command at any time; a running process can exit on its own). */
const PROCESS_POLL_MS = 15_000;

/**
 * Docked panel swap sequencing: how long the outgoing panel gets to retract before the
 * incoming one slides in. Matches the panels' own `transition-[width] duration-200`
 * (files-panel.tsx / subagents-panel.tsx) — shorter would cut the retract off, longer
 * would leave a dead gap.
 */
const PANEL_SWAP_MS = 200;

/** Iconized stat item: a symbol + a value, with the title giving the full meaning. */
function StatChip({ icon, value, label }: { icon: string; value: ReactNode; label: string }) {
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
  const {
    sessions,
    loading: sessionsLoading,
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
  // Latest trace file path (single-session GET only — list rows don't carry it), fetched
  // when the details popover opens; null = none yet (brand-new session) or still loading.
  const [tracePath, setTracePath] = useState<string | null>(null);
  // A mid-chat thinking-level pick staged behind the confirm dialog (issue #310): some
  // providers key their prompt PREFIX on the thinking level, so switching with history in
  // place invalidates the provider's prefix cache and the next request re-bills the whole
  // history as uncached input. The pick is only applied on an explicit choice; null = no
  // dialog, "ask" = dialog open, "compacting" = the user chose "compact, then switch" and
  // the pick is held until the compaction completes. Logic in thinking-level.ts
  // (needsThinkingSwitchConfirm / thinkingSwitchAfterCompaction).
  const [thinkingSwitch, setThinkingSwitch] = useState<StagedThinkingSwitch | null>(null);

  const routeSessionId = params.sessionId ?? null;
  const filesPanelRaw = useFilesPanel(routeSessionId);
  const subagentsPanelRaw = useSubagentsPanel(routeSessionId);
  // The two docked panels are MUTUALLY EXCLUSIVE — side by side they'd crush the chat column at
  // the 1024px breakpoint (and two stacked Sheets on mobile would be worse). Exclusivity is
  // enforced here, on the panel objects every consumer receives, rather than at each call site:
  // ANY path that opens one panel (toolbar toggles, message file cards via onOpenFile, subagent
  // chips via onOpenSubagent, or a future caller) closes the other as a side effect of
  // setOpen(true). Closing never cascades. The hooks stay uncoordinated on purpose — they don't
  // know about each other; only this page, which owns both, does.
  //
  // Docked swaps are SEQUENCED, not simultaneous: with both width transitions running at
  // once the total width is constant, so the closing panel's left-anchored content never
  // moves — the incoming panel just wipes over it, which reads as "the old panel never
  // retracted". Closing the old one fully first (its width animates while the chat column
  // takes the space back), then sliding the new one in, makes both motions legible. A new
  // swap/toggle cancels the pending open; mobile Sheets keep the instant switch — they
  // overlay rather than share width, so the sequencing would only add dead time.
  const panelSwapTimer = useRef<number | null>(null);
  const cancelPanelSwap = () => {
    if (panelSwapTimer.current !== null) {
      window.clearTimeout(panelSwapTimer.current);
      panelSwapTimer.current = null;
    }
  };
  useEffect(() => cancelPanelSwap, []);
  /**
   * Opens `open` after retracting `closeFirst` when a docked swap needs sequencing; instant
   * otherwise. `retractingPane` extends the same courtesy to a side terminal pane the open
   * is displacing: it collapses on the same 200ms a closing panel takes, and opening over
   * it mid-collapse is the wipe the sequencing exists to avoid.
   */
  const swapPanels = (
    closeFirst: { open: boolean; isDocked: boolean; setOpen: (v: boolean) => void },
    open: (v: boolean) => void,
    retractingPane = false,
  ) => {
    closeFirst.setOpen(false);
    if ((closeFirst.open && closeFirst.isDocked) || retractingPane) {
      panelSwapTimer.current = window.setTimeout(() => {
        panelSwapTimer.current = null;
        open(true);
      }, PANEL_SWAP_MS);
    } else {
      open(true);
    }
  };
  // The exclusivity above extends to the terminal dock's LEFT and RIGHT panes, which want the
  // same horizontal half of the content area: opening a panel displaces them, and opening a
  // side pane retracts the panels. Whichever the user asked for last is what they get. The
  // dock only learns that a panel is up (setChatSidePanelOpen); it keeps its arrangement, so
  // closing the panel brings the pane back where it was. Top/bottom panes are unaffected —
  // they cost height, not width.
  /** A visible left/right terminal pane — read BEFORE the flag below starts hiding it. */
  const sidePaneShowing = () => visiblePanes().some((p) => p === "left" || p === "right");
  const filesPanel: FilesPanelState = {
    ...filesPanelRaw,
    setOpen: (next: boolean) => {
      cancelPanelSwap();
      if (next) {
        const retracting = sidePaneShowing();
        setChatSidePanelOpen(true);
        swapPanels(subagentsPanelRaw, filesPanelRaw.setOpen, retracting);
      } else {
        filesPanelRaw.setOpen(false);
        // The OTHER panel decides whether the side is still held: this one's `open` is the
        // render-time value and still reads true here.
        setChatSidePanelOpen(subagentsPanelRaw.open);
      }
    },
  };
  const subagentsPanel: SubagentsPanelState = {
    ...subagentsPanelRaw,
    setOpen: (next: boolean) => {
      cancelPanelSwap();
      if (next) {
        const retracting = sidePaneShowing();
        setChatSidePanelOpen(true);
        swapPanels(filesPanelRaw, subagentsPanelRaw.setOpen, retracting);
      } else {
        subagentsPanelRaw.setOpen(false);
        setChatSidePanelOpen(filesPanelRaw.open);
      }
    },
  };
  // The other direction. The store flips this the moment anything puts a terminal on screen
  // (see terminalTakesTheSide), which is the only signal the page needs: retract both panels
  // and let the pane render. Edge-triggered, so a panel the user opens is not immediately
  // closed again — it sets the flag back on its way up.
  useSyncExternalStore(subscribeTerminalDock, dockStateVersion);
  const terminalHasTheSide = !chatSidePanelOpen();
  useEffect(() => {
    if (!terminalHasTheSide) return;
    // A sequenced open still waiting on its timer must die with the panels it belongs to:
    // firing after the terminal reclaimed the side would open a panel over the pane with
    // the exclusion flag already false — visibly both at once, and nothing to clear it.
    cancelPanelSwap();
    filesPanelRaw.setOpen(false);
    subagentsPanelRaw.setOpen(false);
    // Panel objects are recreated every render; the raw hooks' setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalHasTheSide]);
  // Parked draft conversations (`/chat/draft-…`) render the same DraftView as `/chat/new`,
  // just bound to their own stored entry — every "this is a draft, not a Session" branch
  // below treats the two alike.
  const parkedDraftId = parkedDraftIdOf(routeSessionId);
  const draft = routeSessionId === DRAFT_SESSION_ID || parkedDraftId !== null;
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

  // The rendered transcript: backfilled older windows (frozen items, negative ids) ahead
  // of the live tail model's items. Version keys the memo — a prepend bumps it.
  const allItems = useMemo(
    () =>
      stream.prefixItems.length > 0
        ? [...stream.prefixItems, ...stream.model.items]
        : stream.model.items,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
  );
  // Derivations over the stream items (the model mutates in place, so `version` — its own
  // repaint signal — keys the memos; the session id covers a switch racing a same-valued
  // version): the composer's ↑/↓ recall list and the left outline's entries. Both read the
  // LOADED transcript (prefix included), so backfilling extends recall and the index alike.
  const inputHistory = useMemo(
    () => buildInputHistory(allItems),
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
      stream.prefixItems.length > 0 || stream.prefixSubagents.size > 0
        ? {
            ...stream.model,
            items: [...allItems],
            subagents: new Map([...stream.prefixSubagents, ...stream.model.subagents]),
          }
        : stream.model,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version, routeSessionId],
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
  // config's level while sends omit thinkingLevel (auto-follow — the server/core fallback
  // applies, so Agent-config edits keep taking effect). A pin is DURABLE: it survives a
  // reload, shows up in a second tab, and the server applies it to every later run of this
  // Session. It is still never written through to the Agent config (that stays draft-only).
  const turnThinkingLevel = selected?.thinkingLevel ?? "";
  useEffect(() => {
    if (selectedSessionId && selectedAgentId) setCurrentAgentId(selectedAgentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedAgentId, setCurrentAgentId]);

  // A NEW chat starts with both panels closed: a panel opened for an earlier conversation must
  // not carry into a freshly created one. The draft is the reset point — it renders no panels
  // itself, so the Session created from it (first send navigates to /chat/:id) begins closed,
  // while a plain conversation switch keeps whatever the user had open. This effect owns the
  // ONLY automatic close of either panel.
  useEffect(() => {
    if (!draft) return;
    // A swap's pending delayed open must not fire into the fresh draft after this reset.
    cancelPanelSwap();
    filesPanelRaw.setOpen(false);
    subagentsPanelRaw.setOpen(false);
    setChatSidePanelOpen(false); // nothing holds the side any more: side panes come back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Subagents panel AUTO-OPEN (the one visibility rule this panel has beyond the Files panel's):
  // the pure tracker (advancePanelTaskScope, unit-tested) opens it on the CURRENT task's first
  // live spawn, re-armed at every task boundary so a manual close is respected until the next
  // one. Boundaries themselves no longer close anything — an open panel now survives Session
  // switches and new Tasks alike, matching the Files panel.
  // The auto-open applies only when docked (a mobile Sheet sliding over the conversation
  // uninvited would be worse than staying discoverable via the row), never over an open Files
  // panel (an automatic open must not steal an explicit one — the row and the toolbar's amber
  // dot still signal), and never re-triggers an already-open panel (that would yank a pinned
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
    if (
      action === "autoOpen" &&
      subagentsPanelRaw.isDocked &&
      !subagentsPanelRaw.open &&
      !filesPanelRaw.open
    ) {
      setChatSidePanelOpen(true);
      subagentsPanelRaw.setOpen(true);
    }
    // The panel objects are rebuilt every render; the tracker only acts on real transitions of
    // these three observed values.
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
  // below concludes it doesn't exist; only a failed probe releases that redirect.
  const [probeFailedId, setProbeFailedId] = useState<string | null>(null);
  useEffect(() => {
    if (draft || !routeSessionId || sessionsLoading) return;
    if (sessions.some((s) => s.sessionId === routeSessionId)) return;
    // We deleted this Session ourselves: the row is gone from the list on purpose, so the
    // lookup below could only 404 (and the server would record that as an error). Deleting
    // the conversation you are looking at is the normal way to discard a Session fork, so
    // this path runs on every such delete. Treat it as an already-failed probe, which
    // releases the redirect effect below to move on to another conversation.
    if (isSessionDeleted(routeSessionId)) {
      setProbeFailedId(routeSessionId);
      return;
    }
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
  }, [draft, routeSessionId, sessionsLoading, sessions, addSession, isSessionDeleted]);

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
  // and the popover's per-session data (process list / token buckets / trace path),
  // avoiding stale data from the previous Session (Files panel state resets itself keyed
  // on sessionId inside use-files-panel, and the cost hold re-keys itself inside
  // advanceCostStat). The thinking level itself needs no reset — it is read off the
  // selected Session row, so it changes with the session by construction.
  useEffect(() => {
    usageAppliedRef.current = null;
    setThinkingSwitch(null);
    statCacheRef.current = new Map();
    setProcesses([]);
    setUsageBuckets(null);
    setTracePath(null);
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

  // Trace file path for the popover's trace row: the single-session GET is the only
  // surface carrying it, so fetch lazily on open (and once per session — the path only
  // ever moves forward when a new trace file starts, which a reopen picks up).
  useEffect(() => {
    if (!infoOpen || !selectedSessionId) return;
    let cancelled = false;
    api
      .getSession(selectedSessionId)
      .then((res) => {
        if (!cancelled) setTracePath(res.session.tracePath ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [infoOpen, selectedSessionId]);

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
      // Same conversation under a new id: its terminals follow, or they are stranded under
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
        // An explicitly picked per-turn thinking level rides on each task; "" (untouched)
        // sends nothing — the server/core falls back to the Agent config, so config edits
        // keep taking effect mid-session until the user pins a level.
        const res = await api.postTask(selected.sessionId, {
          input,
          ...(goal ? { goal } : {}),
          ...(turnThinkingLevel
            ? { thinkingLevel: turnThinkingLevel as TaskCreateRequest["thinkingLevel"] }
            : {}),
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
        const res = await api.postTask(selected.sessionId, {
          input,
          queueIfBusy: true,
          ...(turnThinkingLevel
            ? { thinkingLevel: turnThinkingLevel as TaskCreateRequest["thinkingLevel"] }
            : {}),
        });
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
  // returned row into the session store (the picker reads it back from there). Modeled on
  // onChangeApprovalMode — a failed write surfaces as a toast and leaves the level as it
  // was, rather than showing a level the server does not have. Declared above the recall
  // callbacks because one of them lists it as a dependency, which is evaluated during
  // render rather than when the callback runs.
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
  // content (text / images / files) and the input area restores it as the draft. A 409
  // not_pending (steering already delivered, follow-up already started) surfaces as a toast;
  // the queued hint retires on its own via the re-broadcast task_state.
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
        const res = await api.recallFollowUp(selected.sessionId, followUpId);
        // The follow-up was queued with a per-turn thinking level: restore it with the draft,
        // so an unedited resend goes out exactly as it was queued. The level now lives on the
        // Session (#310), so restoring it pins it there rather than in local state.
        if (res.thinkingLevel) applyTurnThinkingLevel(res.thinkingLevel);
        return res;
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
      }
    },
    [selected, applyTurnThinkingLevel],
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
  const openModels = useCallback(() => {
    navigate("/models");
  }, [navigate]);

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
      // (toWorkspaceRelative, including stripping absolute-path prefixes and converting Windows
      // separators), so this just opens the panel and navigates to it directly (the wrapped
      // setOpen already closes the subagents panel — see the exclusivity block above).
      filesPanel.setOpen(true);
      filesPanel.browsePath(path);
    },
    onOpenSubagent: (sessionId, origin) => {
      // Chip click: open the panel focused on that child (the focus chain ends with the child's
      // own id; the wrapped setOpen closes the Files panel). focusSubagent after setOpen: the
      // open resets the Task scope to "latest", and the focus then pins it to this chip's Task.
      subagentsPanel.setOpen(true);
      subagentsPanel.focusSubagent(sessionId, [...origin, sessionId]);
    },
    workspace: selected?.workspace ?? null,
    statFiles,
    onFork,
  };

  // Any pending approval sitting inside a subagent (approvalKey = "originChain toolCallId";
  // main-session keys start with a space): surfaces an amber dot on the toolbar button so a
  // nested approval stays discoverable while the panel is closed.
  const anySubagentPending = [...stream.pendingApprovals.keys()].some((k) => !k.startsWith(" "));

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
      taskCount,
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
  const modelInfo = models?.models.find((m) => sameModelRef(m, activeModelRef));
  const contextWindow = modelInfo?.contextWindow;
  // Assumed supported by default: only models explicitly marked vision=false show a blocking hint when adding images.
  const vision = modelInfo?.vision !== false;
  const emptyChat =
    selected !== null && !stream.loading && !stream.error && stream.model.items.length === 0;

  // Auth-dead gate (recoverable): an auth failure is on record AND the Project's credentials
  // have not been updated since — only the model reference is fixed at creation, credentials
  // come from the current Project config, so a key update (Models page) unlocks the session
  // (live via the credentials_updated event; across reloads via this time comparison against
  // the models response's updatedAt).
  const credsUpdatedMs = models?.updatedAt !== undefined ? Date.parse(models.updatedAt) : NaN;
  const modelAuthDead = isModelAuthDead(
    stream.lastAuthFailureMs,
    Number.isFinite(credsUpdatedMs) ? credsUpdatedMs : null,
  );

  // Input area in session state: Agent / Workspace / Model are already locked by the Session
  // (the model selector isn't rendered; models feeds the locked model's read-only display and
  // the /model switch picker) — approval mode and the per-turn thinking level stay editable;
  // /model forks the conversation onto another model.
  const input = selected && (
    <ChatInput
      status={stream.taskState}
      modelAuthDead={modelAuthDead}
      onOpenModels={openModels}
      onRetryModelAuth={stream.dismissModelAuthDead}
      onNewSession={newChat}
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
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
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

          {/* Panel switcher (icon-only): pinned panel triggers + the "all panels" dropdown
              with per-panel pin toggles. Subagents panel docks the latest-Task call graph
              (use-subagents-panel.ts), Workspace docks the files panel (use-files-panel.ts) —
              opening either closes the other (wrapped setOpen) — and the terminal toggles the
              app-wide dock (terminal-dock.tsx). */}
          <PanelsToolbar
            agentsOpen={subagentsPanel.open}
            onToggleAgents={() => subagentsPanel.setOpen(!subagentsPanel.open)}
            agentsPending={anySubagentPending}
            workspaceOpen={filesPanel.open}
            onToggleWorkspace={() => filesPanel.setOpen(!filesPanel.open)}
          />

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
                      className="flex shrink-0 items-center gap-1 font-mono text-xs text-emerald-600 dark:text-emerald-400"
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
                        <path d={STAT_ICONS.services} />
                      </svg>
                      {runningProcessCount}
                    </span>
                  )}
                </span>
                {/* Narrow: the info icon alone (the chips would crowd the title out). */}
                <span className="flex h-7 w-7 items-center justify-center text-gray-500 sm:hidden dark:text-gray-400">
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
                </span>
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
                              ? "animate-pulse bg-emerald-500"
                              : "bg-gray-300 dark:bg-gray-600"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs" title={p.cmd}>
                            {p.cmd}
                          </span>
                          <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                            {formatDateTime(p.startedAt)}
                            {p.pid !== null && ` · pid ${p.pid}`}
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
              {/* Trace file, same section anatomy as the rows above (label + mono value):
                  the value is the file NAME on a single line (#312 — the full path wrapped
                  over several lines; it now lives in the tooltip and the copy button, which
                  copies the FULL path). The name itself is the click target and
                  SPA-navigates to the Trace page deep-linked to the owning Agent AND this
                  Session (?agentId= focuses/expands the Agent group, ?sessionId=
                  auto-selects — a Session beyond the first loaded page resolves via the
                  Trace page's full-fetch fallback). Hidden until a trace exists (a
                  brand-new session has no file to open); only reachable for a real
                  Session — this whole header renders behind the `selected` guard, so a
                  draft never shows it. */}
              {tracePath !== null && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {S.chat.traceFile}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {/* Wrapper (not flex-1 on the button itself) keeps the click target no
                        wider than the name while the copy button still sits at the row's
                        right edge, mirroring the Session id row. */}
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        title={tracePath}
                        onClick={() => {
                          setInfoOpen(false);
                          navigate(
                            `/traces?agentId=${encodeURIComponent(selected.agentId)}&sessionId=${encodeURIComponent(selected.sessionId)}`,
                          );
                        }}
                        className="max-w-full truncate text-left font-mono text-xs leading-5 text-gray-600 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-900 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-gray-100"
                      >
                        {pathFileName(tracePath)}
                      </button>
                    </div>
                    <CopyButton
                      text={tracePath}
                      label={S.chat.copyTracePath}
                      className={ROW_COPY_CLASS}
                    />
                  </div>
                </div>
              )}
            </div>
          </Dropdown>
        </div>
      )}

      {/* Body: chat column + the docked panels on the right (message file cards jump to and
          locate a file in the tree via onOpenFile), and the dock's side panes, which share
          that slot and so belong on this row rather than around <main> — otherwise they
          squeeze the header above. data-dock-side-row is what the drop preview measures for
          a left/right landing. */}
      <div data-dock-side-row className="flex min-h-0 flex-1">
        <TerminalDockSlot position="left" />
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
                          // Scroll-up backfill of older history windows (tail-first
                          // loading): near-top scrolling prepends the previous window,
                          // scroll position anchored (see MessageStream).
                          older={{
                            hasMore: stream.older.hasMore,
                            loading: stream.older.loading,
                            error: stream.older.error,
                            prependedCount: stream.prefixItems.length,
                            onLoad: stream.loadOlder,
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
        </ChatDropRegion>

        {selected && (
          <SubagentsPanel
            session={selected}
            panel={subagentsPanel}
            // The merged view (backfilled windows included): a chip on an older turn keeps
            // its historical graph and child conversation reachable after pagination.
            model={panelModel}
            version={stream.version}
            taskRunning={stream.taskState !== "idle"}
            ctx={ctx}
          />
        )}
        {selected && <FilesPanel session={selected} panel={filesPanel} />}
        <TerminalDockSlot position="right" />
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
