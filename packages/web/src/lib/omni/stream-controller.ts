/**
 * Session stream controller (connect-first + dedup): a pure
 * logic module, no React dependency, driven by use-session-stream (so protocol behavior is unit-testable).
 *
 * - Phase machine: buffering (history not ready yet, events are held in a
 *   buffer) → live (fed straight to the reducer);
 * - Load epoch: incremented on every load/rebuild. The replay loop aborts the
 *   current round as soon as it detects an epoch mismatch, handing the
 *   remaining buffer off to the new round — this eliminates the
 *   out-of-order/duplication that "a rebuild re-entering mid-buffer-replay" would otherwise cause;
 * - Authoritative running state: the server sends the current task_state
 *   snapshot as the first initial event on every subscription; the
 *   in-stream task_state overrides the Session list's snapshot, and history
 *   finalization trusts only the in-stream state;
 * - resync rebuild: clears the pending-approvals table (the server then
 *   resends still-pending approval_request events on the same connection),
 *   swaps in a new model but injects the shared localDecisions set (an
 *   approval clicked on this end is still labeled "manual" after the rebuild);
 * - Pending-approvals table key = `origin + " " + toolCallId` (approvalKey);
 *   when a resent approval_request can't find its tool card (sub-session
 *   messages aren't written to the parent Trace, so the card can be missing
 *   after a reload), the toolCall carried by the event (with origin) is fed
 *   to the reducer to rebuild the nested card, making the sub-session's approval visible and decidable;
 * - Live-tail seeding: while a Task runs, `/messages` also returns `live`
 *   ({cursor, fragments} — see MessagesLiveTail): buffered partial events at
 *   or before the cursor are dropped (their content is already accumulated
 *   inside the fragments), the synthetic `partial_* start` fragments are fed
 *   through the normal reducer path at the cursor's position, and the rest of
 *   the buffer replays on top — so the in-progress message survives a refresh
 *   with its streamed prefix intact and keeps streaming.
 */
import { isEventMessage, isPartialPayload } from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core/omnimessage";
import type {
  GoalServerEvent,
  MessagesLiveTail,
  MessagesPageInfo,
  PendingFollowUpInfo,
  SubagentRuntimeInfo,
  PendingSteeringInfo,
  ServerEvent,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import {
  approvalKey,
  buildDedupIndex,
  createStreamModel,
  discardFragmentFor,
  finalizeHistory,
  findToolCard,
  isDuplicate,
  notifyTaskIdle,
  pushMessage,
  pushMessages,
  registerLocalDecision,
} from "./stream-model";
import type { ChatItem, StreamModel } from "./stream-model";
import { seedPriorStats } from "./task-stats";

/** A single pending approval (keyed by approvalKey(origin, toolCallId)). */
export interface PendingApproval {
  toolCall: OmniMessage<ToolCallPayload>;
  origin?: string[];
}

/** Buffered stream event; `id` is the SSE event id (`<epoch>-<seq>`, null when unknown); `seeded` marks a live-tail fragment injected at replay time (never carried over into a later round's buffer — the new round refetches fresh fragments). */
type BufferedEvent =
  | { kind: "omni"; msg: OmniMessage; id: string | null; seeded?: boolean }
  | { kind: "server"; ev: ServerEvent; id: string | null };

/** Parse a channel event id (`<epoch>-<seq>`); null when malformed (same split rule as the server's Channel.replayAfter). */
function parseEventId(id: string): { epoch: string; seq: number } | null {
  const sep = id.lastIndexOf("-");
  if (sep <= 0) return null;
  const seq = Number.parseInt(id.slice(sep + 1), 10);
  if (!Number.isInteger(seq) || seq < 0) return null;
  return { epoch: id.slice(0, sep), seq };
}

/**
 * A windowed history request (mirrors the server's paging grammar, sized as a message
 * budget): the newest window, the window before a cursor, or the window starting at one
 * — the last bounded by `until` (exclusive) and, with no `messages`, running to the end.
 */
export type MessagesPageQuery =
  | { kind: "tail"; messages: number }
  | { kind: "before"; cursor: string; messages: number }
  | { kind: "after"; cursor: string; until?: string; messages?: number };

/**
 * Window size, as a message budget: a window is the shortest run of whole Tasks holding
 * at least this many messages (the server's cut rule keeps every stream-model invariant
 * inside it, so it is a floor — one Task of three hundred messages is one window). Sized
 * for what a screen shows, not for what a session holds: opening a conversation reads one
 * window and backfills a second in the background, and every further one is paid for as
 * it is scrolled to.
 */
export const WINDOW_MESSAGES = 15;

/**
 * The most messages kept loaded — and therefore rendered: the transcript renders exactly
 * what is loaded, which is what bounds the DOM and the heap together without a
 * virtualised list. Past it, whole windows leave from the end farther from the reader:
 * scrolling up sheds the live tail first, then the newest windows; scrolling back down
 * sheds the oldest. A budget, not a guarantee — the two windows around the reader always
 * stay, however large a single Task made them.
 */
export const MAX_LOADED_MESSAGES = 60;

/**
 * Item-id space reserved per frozen window. The live model numbers its items upward
 * from 1; each frozen window numbers upward from its own NEGATIVE base, so ids stay
 * unique across the concatenated view (React keys, outline anchors) without ever
 * renumbering already-mounted items — and bases are never reused, so a window fetched
 * again after eviction gets fresh ids. A window holds at most a few thousand items — far
 * under the span.
 */
const WINDOW_ID_SPAN = 1_000_000;

/** One frozen window of the loaded run. */
interface HistoryWindow {
  /** Cursor of its first unit; null = it starts at the transcript's beginning. */
  start: string | null;
  /** Cursor of the unit after it: the next window's start, or the live tail's. */
  end: string;
  items: ChatItem[];
  subagents: Map<string, StreamModel>;
  /** Messages it holds — its share of the loaded budget. */
  messages: number;
  /** Outline turns before it (the outline's numbering offset while it is the oldest loaded). */
  earlierTurns: number;
}

export interface StreamControllerDeps {
  /**
   * Fetch history messages (GET /api/sessions/:id/messages), including the live tail while
   * running. `serverNowMs` is the server's clock at read time (the response's `Date` header);
   * omitted/null just costs a running Task's header the time its in-flight event has taken so
   * far, which falls back to the Trace's own span (see pushMessages). `page` requests a
   * WINDOW (the response then carries `page`); omitted = the legacy full transcript.
   */
  loadMessages: (page?: MessagesPageQuery) => Promise<{
    messages: OmniMessage[];
    live?: MessagesLiveTail;
    serverNowMs?: number | null;
    page?: MessagesPageInfo;
  }>;
  /** Authoritative running state from the stream (covers both the subscription snapshot and transition events). */
  onTaskState: (state: SessionStatus) => void;
  /** Queued follow-up count carried on task_state events (absent on old servers -> 0). */
  onQueuedFollowUps?: (count: number) => void;
  /** Undelivered steering messages carried on task_state events (absent = none): keeps the composer's "steering queued" hint alive across reloads. */
  onPendingSteering?: (items: PendingSteeringInfo[]) => void;
  /** Queued follow-up tasks carried on task_state events (absent = none): each entry's content + recall handle, alongside the count. */
  onPendingFollowUps?: (items: PendingFollowUpInfo[]) => void;
  /** Live subagent children carried on task_state events (absent = none): the panel's structural running marks — no tool-output text parsing for live sessions. */
  onSubagents?: (items: SubagentRuntimeInfo[]) => void;
  onLoading: (loading: boolean) => void;
  /** History load failure message (null = clear). */
  onError: (message: string | null) => void;
  /** View model content changed (triggers a re-render). */
  onModelChange: () => void;
  /** Pending-approvals table changed. */
  onPendingChange: () => void;
  /** Auto-generated title pushed by the server (for updating the Session list in place). */
  onSessionTitle?: (sessionId: string, title: string) => void;
  /** A new session has been registered (sub-sessions are pushed along the parent session's channel; used to refresh the Session list). */
  onSessionCreated?: (sessionId: string) => void;
  /** Goal-mode progress (goal_started / goal_round / goal_finished): drives the chat page's goal banner. */
  onGoalEvent?: (ev: GoalServerEvent) => void;
  /** Local clock (injectable for tests). */
  now?: () => number;
}

/** One end of the loaded run (drives the stream's top / bottom affordance). */
export interface HistoryEdgeState {
  /** More history lies past this end: older windows above, or the live tail (and any window before it) below. */
  hasMore: boolean;
  /** A fetch for this end is in flight. */
  loading: boolean;
  /** The last fetch for this end failed (the affordance offers a retry); null = fine. */
  error: string | null;
}

/** The top end's state (the name the consumers grew up with). */
export type OlderHistoryState = HistoryEdgeState;

export interface StreamController {
  /** The current view model (a resync rebuild swaps in a new object): the LIVE tail window. */
  readonly model: StreamModel;
  /**
   * The transcript to render: the loaded run — frozen windows oldest first, then the live
   * model's items while the tail is attached. Frozen items carry negative ids, unique
   * across windows, so the concatenated list keys/anchors cleanly.
   */
  readonly items: readonly ChatItem[];
  /** Nested subagent models of the frozen windows (merged view for the subagents panel; disjoint from model.subagents — a child session lives in exactly one window). */
  readonly windowSubagents: ReadonlyMap<string, StreamModel>;
  /** Frozen windows in the run (>0 gates the beginning-of-history marker: a session that fit one window shows no extra chrome). */
  readonly windowCount: number;
  /** Whether the live tail follows the frozen run on screen; false once scrolling up shed it (the model keeps streaming meanwhile). */
  readonly tailAttached: boolean;
  /** Outline entries that exist before the OLDEST loaded window: the outline's global numbering offset. */
  readonly outlineOffset: number;
  readonly older: HistoryEdgeState;
  readonly newer: HistoryEdgeState;
  /** Bumped whenever the run changes shape at either end (a window in or out, the tail off or on): the renderer's cue to re-anchor the reader. */
  readonly edgesVersion: number;
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval>;
  /** Load history for the first time (called once after connect-first): fetches the TAIL window, then one older window in the background. */
  load: () => Promise<void>;
  /** Retry entry point after a history load failure (keeps the buffer, refetches history). */
  retry: () => Promise<void>;
  /** Prepend the previous window (scroll-up backfill); no-op while loading, failed, at the beginning, or before the initial load settled. */
  loadOlder: () => Promise<void>;
  /** Append the next window below the run, re-attaching the live tail when the run reaches its start; no-op while attached. */
  loadNewer: () => Promise<void>;
  /** Drop the run and re-attach the live tail (the jump-to-latest button while detached); no-op while attached. */
  jumpToLatest: () => void;
  /**
   * Open the run at a unit cursor (the outline's jump to a turn that is not loaded): the
   * window starting there replaces the run, detached unless it reaches the live tail.
   * Rejects when the window could not be fetched; the run is then left as it was.
   */
  openAt: (cursor: string) => Promise<void>;
  /** SSE OmniMessage entry point (`eventId`: the SSE event id, used for live-tail cursor alignment). */
  handleOmni: (msg: OmniMessage, eventId?: string | null) => void;
  /** SSE server-event entry point (`eventId`: same as handleOmni). */
  handleServer: (ev: ServerEvent, eventId?: string | null) => void;
  /** Register that this end clicked an approval ("manual" label, persists across resync rebuilds). */
  markLocalDecision: (toolCallId: string) => void;
  /** Remove a pending approval by its composite key (optimistic update; also removed as a fallback when the event arrives). */
  resolveApproval: (key: string) => void;
  dispose: () => void;
}

const NO_ITEMS: readonly ChatItem[] = [];

export function createStreamController(deps: StreamControllerDeps): StreamController {
  const now = deps.now ?? (() => Date.now());
  /** Approvals decided on this end (persists at the hook level: injected into every generation of the model, never lost across a resync rebuild). */
  const localDecisions = new Set<string>();
  const pending = new Map<string, PendingApproval>();

  let model = createStreamModel(localDecisions);
  let disposed = false;
  let phase: "buffering" | "live" = "buffering";
  let buffer: BufferedEvent[] = [];
  /** The most recent in-stream task_state (null = the snapshot hasn't arrived yet; history finalization trusts only this value). */
  let streamStatus: SessionStatus | null = null;
  /** The most recent SSE event id seen on this connection (null = none yet): identifies the channel epoch the live-tail cursor must match. */
  let lastEventId: string | null = null;
  /** Load epoch: incremented on rebuild/retry; any replay or finalization from an older epoch is discarded. */
  let epoch = 0;
  /** Whether the most recent load failed (retry only takes effect after a failure, to avoid mistakenly replaying history). */
  let failed = false;

  // —— Windowed-history state: a contiguous run of frozen windows, then (or not) the live tail ——
  /**
   * The run's frozen part, oldest first. Every window here was built by its own model
   * and closed by finalizeHistory — complete by construction, since a newer window (or
   * the tail) follows — and its items carry ids from its own negative range.
   */
  let windows: HistoryWindow[] = [];
  /** Windows ever frozen (derives each one's id base; never reused, so ids stay unique across evictions). */
  let windowSeq = 0;
  /**
   * Whether the live tail follows the run on screen. False once scrolling up shed it
   * (see shedFromBottom): the model keeps receiving the stream, the transcript shows the
   * run alone, and loadNewer walks back down to it.
   */
  let tailAttached = true;
  /**
   * The live tail's start cursor (its first unit); null = the tail reaches the beginning
   * (or the transcript was loaded whole). What resync refetches from — a refetch from the
   * same start abuts the run by construction — and where a forward page stops.
   */
  let tailStart: string | null = null;
  /** Outline turns before the tail (its numbering offset while no frozen window precedes it). */
  let tailEarlierTurns = 0;
  /** Messages the live tail holds — its share of the loaded budget: the fetch's count plus every complete message streamed since. */
  let tailMessages = 0;
  const older: HistoryEdgeState = { hasMore: false, loading: false, error: null };
  const newer: HistoryEdgeState = { hasMore: false, loading: false, error: null };
  /** Bumped whenever the run changes shape at either end: the renderer re-anchors the reader on the next commit. */
  let edgesVersion = 0;
  /** Bumped whenever the run is REPLACED (jump-to-latest, open-at): a frontier fetch from before it must not land on the new run. */
  let runGeneration = 0;

  /** Cursor the next older window ends at: the run's start, or the tail's while nothing is frozen. Null = the beginning is loaded. */
  const topCursor = (): string | null => (windows.length > 0 ? windows[0]!.start : tailStart);
  const loadedMessages = (): number =>
    windows.reduce((n, w) => n + w.messages, 0) + (tailAttached ? tailMessages : 0);

  /** Reset all windowed-history bookkeeping to "everything loaded from the beginning". */
  const resetPaging = (): void => {
    windows = [];
    tailAttached = true;
    tailStart = null;
    tailEarlierTurns = 0;
    tailMessages = 0;
    older.hasMore = false;
    older.loading = false;
    older.error = null;
    newer.hasMore = false;
    newer.loading = false;
    newer.error = null;
    edgesVersion += 1;
  };

  /** Adopt a TAIL page's pagination envelope as the fresh baseline (initial load / retry / a rebuild that dropped the run). */
  const adoptTailPage = (page: MessagesPageInfo | undefined, messageCount: number): void => {
    resetPaging();
    tailMessages = messageCount;
    if (page === undefined) return; // full transcript: nothing older exists by definition
    tailStart = page.before ?? null;
    tailEarlierTurns = page.earlierTurns;
    older.hasMore = tailStart !== null;
  };

  /**
   * A fetched window, frozen: a FRESH model builds its items (its own negative id base,
   * priors seeded, finalizeHistory closing its last Task — complete by construction,
   * since a newer window or the tail follows), and the model is then only a container.
   */
  const freezeWindow = (
    res: { messages: OmniMessage[]; page: MessagesPageInfo },
    start: string | null,
    end: string,
  ): HistoryWindow => {
    windowSeq += 1;
    const m = createStreamModel(localDecisions);
    m.nextItemId = -windowSeq * WINDOW_ID_SPAN;
    seedPriorStats(m.stats, res.page.prior);
    pushMessages(m, res.messages, now(), null);
    finalizeHistory(m);
    return {
      start,
      end,
      items: m.items,
      subagents: m.subagents,
      messages: res.messages.length,
      earlierTurns: res.page.earlierTurns,
    };
  };

  /**
   * Past the budget after a prepend (the reader is at the top of the run): shed from the
   * bottom — the live tail first, then the newest windows — keeping the two windows
   * around the reader. The tail is only ever shed with a frozen window to stand in for
   * it; a run of one huge window and a huge tail stays as it is.
   */
  const shedFromBottom = (): void => {
    while (loadedMessages() > MAX_LOADED_MESSAGES) {
      if (tailAttached) {
        if (windows.length === 0) return;
        tailAttached = false;
        newer.hasMore = true;
        newer.error = null;
      } else if (windows.length > 2) {
        windows.pop();
      } else {
        return;
      }
    }
  };

  /** Past the budget after an append or a re-attach (the reader is at the bottom of the run): shed the oldest windows, keeping what surrounds the reader. */
  const shedFromTop = (): void => {
    while (loadedMessages() > MAX_LOADED_MESSAGES && windows.length > (tailAttached ? 1 : 2)) {
      windows.shift();
    }
    older.hasMore = topCursor() !== null;
  };

  /** Full clear (resync rebuilds): the server resends every still-pending approval_request on the same connection, child ones included. */
  const clearPending = (): void => {
    if (pending.size === 0) return;
    pending.clear();
    deps.onPendingChange();
  };

  // Main-session approvals only (the task-idle flip): an origin-tagged approval belongs to a
  // subagent child that outlives the parent's task — the server keeps it pending across idle
  // (see the registry's denyMain), so dropping its card here would hide a question that
  // still blocks the child. Child cards leave via their approval_decision instead.
  const clearMainPending = (): void => {
    let dropped = false;
    for (const [key, entry] of [...pending]) {
      if (entry.origin === undefined || entry.origin.length === 0) {
        pending.delete(key);
        dropped = true;
      }
    }
    if (dropped) deps.onPendingChange();
  };

  const feedOmni = (msg: OmniMessage, dedup: Set<string> | null): void => {
    // The SDK has already produced an approval_decision: sync the pending-approvals table (keyed by the origin composite key).
    if (isEventMessage(msg) && msg.payload.type === "approval_decision") {
      if (pending.delete(approvalKey(msg.origin, msg.payload.tool_call_id))) {
        deps.onPendingChange();
      }
    }
    if (dedup && !isPartialPayload(msg.payload) && isDuplicate(dedup, msg)) {
      // Overlap dedup: when a complete message matches, also discard the corresponding in-flight fragment.
      discardFragmentFor(model, msg);
      return;
    }
    pushMessage(model, msg, now());
    if (!isPartialPayload(msg.payload)) tailMessages += 1;
  };

  const handleServer = (ev: ServerEvent): void => {
    switch (ev.type) {
      case "approval_request": {
        const toolCallId = ev.toolCall.payload.tool_call_id;
        const entry: PendingApproval = { toolCall: ev.toolCall };
        if (ev.origin) entry.origin = ev.origin;
        pending.set(approvalKey(ev.origin, toolCallId), entry);
        // Resend scenario (reload / mid-stream join): sub-session messages
        // aren't in the parent Trace, so the tool card can be missing —
        // feed the event's toolCall (with origin) to the reducer to rebuild the nested card, so the approval button is visible.
        if (!findToolCard(model, ev.origin, toolCallId)) {
          const msg: OmniMessage = { ...ev.toolCall };
          if (ev.origin && ev.origin.length > 0) msg.origin = [...ev.origin];
          else delete msg.origin;
          pushMessage(model, msg, now());
          deps.onModelChange();
        }
        deps.onPendingChange();
        return;
      }
      case "task_state": {
        // The in-stream task_state is the authoritative running state (the
        // server sends the current snapshot as soon as it subscribes; the list's snapshot is only a first-frame placeholder).
        streamStatus = ev.state;
        deps.onTaskState(ev.state);
        deps.onQueuedFollowUps?.(ev.queued ?? 0);
        deps.onPendingSteering?.(ev.pendingSteering ?? []);
        deps.onPendingFollowUps?.(ev.pendingFollowUps ?? []);
        deps.onSubagents?.(ev.subagents ?? []);
        if (ev.state === "idle") {
          // Task ended (or the snapshot confirms idle): finalize the current Task's stats.
          // The main session's approvals converged server-side with the run; a subagent
          // child's stay pending — and rendered — until the user decides.
          notifyTaskIdle(model);
          clearMainPending();
          deps.onModelChange();
        }
        return;
      }
      case "resync_required": {
        // The buffer has been evicted: refetch history to rebuild the model, then continue consuming the same connection.
        void rebuild();
        return;
      }
      case "credentials_updated":
        // The Project's model credentials changed (Models page save): the server already
        // invalidated cached runtimes, so the next task simply runs with the new key —
        // nothing to update client-side.
        return;
      case "hello":
        return;
    }
  };

  /**
   * resync_required — which refetch rebuilds the model. Resync means the SSE buffer was
   * evicted and the transcript state is suspect, so every branch chooses correctness over
   * cleverness (ANY doubt falls back to the full read):
   *
   *   1. The tail's start cursor is known → refetch the tail FROM THAT CURSOR (`after`,
   *      unbounded). Cursors are (shard, ordinal) positions on immutable storage, so a
   *      window that starts at the same cursor abuts the frozen run exactly — no gap, no
   *      overlap — whether or not new units arrived since, which is what a size-based
   *      tail refetch could never promise once the session had grown. The run and its
   *      attachment state stay as they are; the buffered events replay with overlap
   *      dedup, and the live attachment weaves in under the channel-epoch guard.
   *   2. The tail reaches the beginning (no cursor: the transcript fit one window) →
   *      the legacy FULL refetch, which IS that window.
   *   3. The refetch could not be honoured — no page envelope (a server without
   *      windowing), no start (the cursor's shard is gone), or an `after` cursor (the
   *      read was cut short, which an unbounded request never is) — is doubt: the full
   *      read, run dropped, offsets zeroed. Slow but beyond suspicion.
   *
   * The decision runs inside load() (it needs the response); this entry only picks the
   * request shape.
   */
  const rebuild = async (): Promise<void> => {
    epoch += 1;
    phase = "buffering";
    buffer = [];
    // Clear the pending-approvals table: an approval decided while
    // disconnected shouldn't leave a lingering button; the server will
    // resend still-pending approval_request events on the same connection afterward, naturally rebuilding it.
    clearPending();
    // Atomic swap — deliberately NOT `onLoading(true)`. The fresh model (shared localDecisions
    // injected, so approvals decided on this end stay labeled "manual") is handed to load(), which
    // makes it the visible model only once history is back in hand. Until then the OLD transcript
    // stays mounted and on screen: a mid-stream resync never blanks the conversation nor unmounts
    // the composer. (Flipping loading=true here drove the consumer to swap both the message list and
    // the input for a skeleton, losing scroll position, expanded tool cards, and composer
    // focus/draft.) Deltas arriving during the refetch are buffered and replayed on swap; the brief
    // no-new-text pause is invisible next to a full teardown.
    await load(
      epoch,
      createStreamModel(localDecisions),
      tailStart !== null ? { page: { kind: "after", cursor: tailStart }, splice: true } : {},
    );
  };

  /**
   * Weave the live tail into the buffered replay (see MessagesLiveTail in the server API):
   * entries at/or before the cursor come first with their partials dropped (the fragment
   * snapshot already accumulates them; completes still replay — the dedup gate decides),
   * then the synthetic fragment starts at the cursor's position, then everything after the
   * cursor. Skipped entirely when the cursor's epoch doesn't match the epoch of the events
   * seen on this connection (channel recycled/server restarted between the two requests —
   * seq comparison would be meaningless; the resync flow covers that path).
   */
  const weaveLiveTail = (replay: BufferedEvent[], live: MessagesLiveTail): BufferedEvent[] => {
    const cursor = parseEventId(live.cursor);
    if (!cursor) return replay;
    const seen = lastEventId === null ? null : parseEventId(lastEventId);
    if (seen !== null && seen.epoch !== cursor.epoch) return replay;
    const pre: BufferedEvent[] = [];
    const post: BufferedEvent[] = [];
    for (const e of replay) {
      const eid = e.id === null ? null : parseEventId(e.id);
      if (eid !== null && eid.epoch === cursor.epoch && eid.seq <= cursor.seq) {
        if (e.kind !== "omni" || !isPartialPayload(e.msg.payload)) pre.push(e);
      } else {
        post.push(e);
      }
    }
    const seeds: BufferedEvent[] = live.fragments.map((msg) => ({
      kind: "omni",
      msg,
      id: null,
      seeded: true,
    }));
    return [...pre, ...seeds, ...post];
  };

  const load = async (
    currentEpoch: number,
    freshModel?: StreamModel,
    opts: { page?: MessagesPageQuery; splice?: boolean; eager?: boolean } = {},
  ): Promise<void> => {
    try {
      let res = await deps.loadMessages(opts.page);
      if (disposed || currentEpoch !== epoch) return;
      if (opts.splice === true) {
        // The resync refetch from the tail's own start (see rebuild): it abuts the run by
        // construction, so the run and its paging state stay — unless the server could
        // not honour the request, which is doubt: the full read within this same epoch
        // (events keep buffering meanwhile).
        const start = res.page?.before ?? null;
        if (
          res.page !== undefined &&
          start !== null &&
          start === tailStart &&
          res.page.after === undefined
        ) {
          tailMessages = res.messages.length;
        } else {
          res = await deps.loadMessages();
          if (disposed || currentEpoch !== epoch) return;
          adoptTailPage(undefined, res.messages.length); // full transcript: no run, no cursors
        }
      } else if (opts.page !== undefined) {
        // Fresh tail baseline (initial load / retry): any previously-loaded run is
        // superseded by the new window chain.
        adoptTailPage(res.page, res.messages.length);
      } else {
        adoptTailPage(undefined, res.messages.length);
      }
      const { messages, live, serverNowMs } = res;
      // Rebuild path: make the freshly-built model visible only now, atomically — the old model
      // stayed on screen throughout the refetch above (see rebuild). Initial load / retry pass no
      // freshModel and keep operating on the current model.
      if (freshModel) model = freshModel;
      const target = model;
      // Windowed loads seed the stats accrued before the window, so header chips and
      // per-turn cumulative rows equal a full load (see seedPriorStats).
      if (res.page !== undefined) seedPriorStats(target.stats, res.page.prior);
      pushMessages(target, messages, now(), serverNowMs ?? null);
      const dedup = buildDedupIndex(messages, 100);
      // Replay the buffer (events that arrived while fetching history), with dedup; while a
      // Task runs, the live tail is woven in so the in-progress message is seeded too.
      const replay = live !== undefined ? weaveLiveTail(buffer, live) : buffer;
      buffer = [];
      for (let i = 0; i < replay.length; i += 1) {
        const e = replay[i]!;
        if (e.kind === "omni") feedOmni(e.msg, dedup);
        else handleServer(e.ev);
        if (disposed) return;
        if (currentEpoch !== epoch) {
          // A rebuild was triggered mid-replay (e.g. resync_required): this
          // round is discarded, and the remaining events are handed off to
          // the new round's buffer — phase is left unchanged and the old buffer is never
          // fed to the new model. Seeded fragments are snapshot-bound to THIS round and
          // are dropped instead of carried over (the new round refetches fresh ones).
          buffer.push(...replay.slice(i + 1).filter((r) => r.kind !== "omni" || !r.seeded));
          return;
        }
      }
      phase = "live";
      // History finalization trusts only the in-stream authoritative state:
      // finalize the last Task at the end of history only when idle; if the
      // snapshot hasn't arrived yet (rare), don't finalize — the
      // task_state:idle branch will complete the equivalent finalization once it arrives.
      if (streamStatus === "idle") finalizeHistory(target);
      failed = false;
      deps.onError(null);
      deps.onLoading(false);
      deps.onModelChange();
      // A fresh open shows one window and quietly fetches the one above it: about two
      // screens on a phone, without the first paint waiting for the second.
      if (opts.eager === true && older.hasMore) void loadOlder();
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return;
      failed = true;
      deps.onLoading(false);
      deps.onError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Scroll-up backfill: fetch the window before the run's start and prepend it, frozen,
   * then shed from the bottom if the run grew past its budget. Guarded to the live
   * phase: a rebuild in flight owns the loading pipeline, and its epoch bump discards
   * any backfill that raced it.
   */
  const loadOlder = async (): Promise<void> => {
    if (disposed || phase !== "live" || failed) return;
    const cursor = topCursor();
    if (older.loading || cursor === null) return;
    const currentEpoch = epoch;
    const currentRun = runGeneration;
    older.loading = true;
    older.error = null;
    deps.onModelChange();
    try {
      const res = await deps.loadMessages({ kind: "before", cursor, messages: WINDOW_MESSAGES });
      if (disposed || currentEpoch !== epoch || currentRun !== runGeneration) return;
      // A before-request against a server without windowing support would return the
      // full transcript with no envelope; prepending that would duplicate history.
      if (res.page === undefined) throw new Error("windowed history not supported");
      windows.unshift(
        freezeWindow({ messages: res.messages, page: res.page }, res.page.before ?? null, cursor),
      );
      older.hasMore = res.page.before !== undefined;
      shedFromBottom();
      edgesVersion += 1;
    } catch (e) {
      if (disposed || currentEpoch !== epoch || currentRun !== runGeneration) return;
      older.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (!disposed && currentEpoch === epoch && currentRun === runGeneration) {
        older.loading = false;
        deps.onModelChange();
      }
    }
  };

  /**
   * Scroll-down backfill, once the tail has been shed: fetch the window after the run's
   * end — never past the tail's start — and append it; a page that arrives at the
   * tail's start re-attaches the live model instead (it IS the next window), and the
   * run then sheds from the top if it grew past its budget.
   */
  const loadNewer = async (): Promise<void> => {
    if (disposed || phase !== "live" || failed || tailAttached) return;
    const last = windows[windows.length - 1];
    if (newer.loading || last === undefined) return;
    if (last.end === tailStart) {
      // The run already ends where the tail begins (the tail was shed with no window
      // after it): nothing lies between them to fetch — re-attach outright.
      tailAttached = true;
      newer.hasMore = false;
      newer.error = null;
      shedFromTop();
      edgesVersion += 1;
      deps.onModelChange();
      return;
    }
    const currentEpoch = epoch;
    const currentRun = runGeneration;
    newer.loading = true;
    newer.error = null;
    deps.onModelChange();
    try {
      const res = await deps.loadMessages({
        kind: "after",
        cursor: last.end,
        ...(tailStart !== null ? { until: tailStart } : {}),
        messages: WINDOW_MESSAGES,
      });
      if (disposed || currentEpoch !== epoch || currentRun !== runGeneration) return;
      if (res.page === undefined) throw new Error("windowed history not supported");
      const after = res.page.after ?? null;
      const reachedTail = after === null || after === tailStart;
      if (res.messages.length > 0) {
        windows.push(
          freezeWindow({ messages: res.messages, page: res.page }, last.end, after ?? last.end),
        );
      }
      if (reachedTail) {
        tailAttached = true;
        newer.hasMore = false;
      }
      shedFromTop();
      edgesVersion += 1;
    } catch (e) {
      if (disposed || currentEpoch !== epoch || currentRun !== runGeneration) return;
      newer.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (!disposed && currentEpoch === epoch && currentRun === runGeneration) {
        newer.loading = false;
        deps.onModelChange();
      }
    }
  };

  /**
   * Jump-to-latest while detached: the reader wants the conversation's end, not the
   * windows between here and there — drop the run, re-attach the tail, and backfill one
   * window above it again, the shape a fresh open has.
   */
  /** The run becomes the tail alone, one window backfilled above it again — the shape a fresh open has. */
  const resetToTail = (): void => {
    runGeneration += 1;
    windows = [];
    tailAttached = true;
    newer.hasMore = false;
    newer.loading = false;
    newer.error = null;
    older.hasMore = tailStart !== null;
    older.loading = false;
    older.error = null;
    edgesVersion += 1;
    deps.onModelChange();
    if (older.hasMore) void loadOlder();
  };

  const jumpToLatest = (): void => {
    if (disposed || tailAttached) return;
    resetToTail();
  };

  /**
   * Open-at (the outline's jump to a turn outside the run): the window starting at the
   * cursor becomes the whole run — detached, unless it reaches the tail's start, in which
   * case the tail follows it — and both frontiers work from there as usual. Opening at the
   * tail's own start is the tail itself. The run is replaced only once the window is in
   * hand, so a failed fetch leaves the reader where they were.
   */
  const openAt = async (cursor: string): Promise<void> => {
    if (disposed || phase !== "live" || failed) return;
    if (cursor === tailStart) {
      resetToTail();
      return;
    }
    const currentEpoch = epoch;
    const res = await deps.loadMessages({
      kind: "after",
      cursor,
      ...(tailStart !== null ? { until: tailStart } : {}),
      messages: WINDOW_MESSAGES,
    });
    if (disposed || currentEpoch !== epoch) return;
    if (res.page === undefined) throw new Error("windowed history not supported");
    const after = res.page.after ?? null;
    const reachedTail = after === null || after === tailStart;
    runGeneration += 1;
    windows =
      res.messages.length > 0
        ? [
            freezeWindow(
              { messages: res.messages, page: res.page },
              res.page.before ?? cursor,
              after ?? tailStart ?? cursor,
            ),
          ]
        : [];
    tailAttached = reachedTail;
    older.hasMore = topCursor() !== null;
    older.loading = false;
    older.error = null;
    newer.hasMore = !tailAttached;
    newer.loading = false;
    newer.error = null;
    edgesVersion += 1;
    deps.onModelChange();
  };

  return {
    get model() {
      return model;
    },
    get items(): readonly ChatItem[] {
      if (windows.length === 0) return tailAttached ? model.items : NO_ITEMS;
      const frozen = windows.flatMap((w) => w.items);
      return tailAttached ? [...frozen, ...model.items] : frozen;
    },
    get windowSubagents(): ReadonlyMap<string, StreamModel> {
      // Child sessions live in exactly one window (a spawn is contained in its Task), so
      // the merge is disjoint; newer windows' entries win defensively on a clash.
      const merged = new Map<string, StreamModel>();
      for (const w of windows) for (const [sid, sub] of w.subagents) merged.set(sid, sub);
      return merged;
    },
    get windowCount() {
      return windows.length;
    },
    get tailAttached() {
      return tailAttached;
    },
    get outlineOffset() {
      return windows.length > 0 ? windows[0]!.earlierTurns : tailEarlierTurns;
    },
    get older(): HistoryEdgeState {
      return older;
    },
    get newer(): HistoryEdgeState {
      return newer;
    },
    get edgesVersion() {
      return edgesVersion;
    },
    get pendingApprovals(): ReadonlyMap<string, PendingApproval> {
      return pending;
    },
    load: () => {
      epoch += 1;
      return load(epoch, undefined, {
        page: { kind: "tail", messages: WINDOW_MESSAGES },
        eager: true,
      });
    },
    retry: async () => {
      if (disposed || !failed) return;
      // Retry always rebuilds into a FRESH model. After an initial-load failure the model was
      // never written, but after a failed *resync* rebuild the OLD populated model is deliberately
      // left in place (so the transcript didn't blank during the refetch) — pushing the refetched
      // history straight onto it would duplicate the entire conversation (pushMessages appends with
      // no id-dedup). load() swaps the fresh model in only once the refetch succeeds, then replays
      // the still-accumulating buffer into it; localDecisions carry over via the shared set.
      // The refetch is a fresh TAIL baseline: any retained run is superseded on success.
      deps.onError(null);
      deps.onLoading(true);
      epoch += 1;
      await load(epoch, createStreamModel(localDecisions), {
        page: { kind: "tail", messages: WINDOW_MESSAGES },
        eager: true,
      });
    },
    loadOlder,
    loadNewer,
    jumpToLatest,
    openAt,
    handleOmni: (msg, eventId = null) => {
      if (disposed) return;
      if (eventId !== null) lastEventId = eventId;
      if (phase === "buffering") {
        buffer.push({ kind: "omni", msg, id: eventId });
        return;
      }
      feedOmni(msg, null);
      deps.onModelChange();
    },
    handleServer: (ev, eventId = null) => {
      if (disposed) return;
      if (eventId !== null) lastEventId = eventId;
      // session_title / session_created only affect list display (unrelated
      // to the view model/history): forwarded immediately at any phase, never buffered.
      if (ev.type === "session_title") {
        deps.onSessionTitle?.(ev.sessionId, ev.title);
        return;
      }
      if (ev.type === "session_created") {
        deps.onSessionCreated?.(ev.sessionId);
        return;
      }
      // Goal progress only affects the banner (UI state, not the transcript model): forwarded
      // immediately at any phase, never buffered — same treatment as session_title.
      if (ev.type === "goal_started" || ev.type === "goal_round" || ev.type === "goal_finished") {
        deps.onGoalEvent?.(ev);
        return;
      }
      if (phase === "buffering") {
        // task_state is reflected immediately in the input area (authoritative
        // state, doesn't wait for history replay); model side effects like
        // finalization are still processed in replay order (idempotent on the same value, eventually consistent).
        if (ev.type === "task_state") {
          streamStatus = ev.state;
          deps.onTaskState(ev.state);
          deps.onQueuedFollowUps?.(ev.queued ?? 0);
          deps.onPendingSteering?.(ev.pendingSteering ?? []);
          deps.onPendingFollowUps?.(ev.pendingFollowUps ?? []);
        }
        buffer.push({ kind: "server", ev, id: eventId });
        return;
      }
      handleServer(ev);
    },
    markLocalDecision: (toolCallId) => {
      registerLocalDecision(model, toolCallId);
    },
    resolveApproval: (key) => {
      if (pending.delete(key)) deps.onPendingChange();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
