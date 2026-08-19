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
  PendingSteeringInfo,
  SessionSubagentInfo,
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

/** A windowed history request (mirrors the server's tailLimit / before params). */
export type MessagesPageQuery =
  { kind: "tail"; limit: number } | { kind: "before"; cursor: string; limit: number };

/**
 * Initial (tail) window size, in message-bearing units — one unit = one Task, opened by
 * a user prompt (the server's cut rule; see MessagesPageInfo). 200 covers the vast
 * majority of real sessions in a single request, so ordinary conversations still load
 * whole exactly as before — only the pathological long tail (months-long sessions,
 * agentic marathons) starts windowed, which is the point: their full-transcript reads
 * were the unbounded memory/disk cost this pagination removes.
 */
export const TAIL_UNITS = 200;

/** Scroll-up backfill window size: smaller than the tail so each prepend stays snappy. */
export const OLDER_UNITS = 100;

/**
 * Item-id space reserved per prepended window. The live model numbers its items upward
 * from 1; each prepended window numbers upward from its own NEGATIVE base, so ids stay
 * unique across the concatenated view (React keys, outline anchors) without ever
 * renumbering already-mounted items. A window holds at most a few thousand items —
 * far under the span.
 */
const PREPEND_ID_SPAN = 1_000_000;

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
  /** Authoritative lifecycle snapshots for retained child Sessions. */
  onSubagents?: (items: SessionSubagentInfo[]) => void;
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

/** Scroll-up backfill state (drives the stream's top affordance). */
export interface OlderHistoryState {
  /** Older windows exist beyond the loaded prefix. */
  hasMore: boolean;
  /** A backfill request is in flight. */
  loading: boolean;
  /** The last backfill failed (the affordance offers a retry); null = fine. */
  error: string | null;
}

export interface StreamController {
  /** The current view model (a resync rebuild swaps in a new object): the LIVE tail window. */
  readonly model: StreamModel;
  /**
   * Items of the backfilled older windows, oldest first — render them immediately BEFORE
   * `model.items`. Frozen once built (their Tasks are complete); item ids are negative
   * and unique across windows, so the concatenated list keys/anchors cleanly.
   */
  readonly prefixItems: readonly ChatItem[];
  /** Nested subagent models of the backfilled windows (merged view for the subagents panel; disjoint from model.subagents — a child session lives in exactly one window). */
  readonly prefixSubagents: ReadonlyMap<string, StreamModel>;
  /** Outline entries that exist before the OLDEST loaded window: the outline's global numbering offset. */
  readonly outlineOffset: number;
  readonly older: OlderHistoryState;
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval>;
  /** Load history for the first time (called once after connect-first): fetches the TAIL window. */
  load: () => Promise<void>;
  /** Retry entry point after a history load failure (keeps the buffer, refetches history). */
  retry: () => Promise<void>;
  /** Prepend the previous window (scroll-up backfill); no-op while loading, failed, at the beginning, or before the initial load settled. */
  loadOlder: () => Promise<void>;
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

  // —— Windowed-history state (tail-first load + scroll-up backfill) ——
  /** Items of backfilled older windows, oldest first (frozen; rendered before model.items). */
  let prefixItems: ChatItem[] = [];
  /** Nested subagent models owned by backfilled windows. */
  let prefixSubagents = new Map<string, StreamModel>();
  /** How many windows have been prepended (derives each one's negative item-id base). */
  let prependCount = 0;
  /** Cursor for the NEXT older window (= the oldest loaded window's start); null = beginning reached or full transcript loaded. */
  let nextBefore: string | null = null;
  /**
   * The LIVE tail window's start cursor, as returned by the last tail fetch — the resync
   * continuity anchor: a refetched tail whose start cursor equals this provably abuts the
   * retained prefix. Null = the tail reaches the beginning (or the transcript was loaded
   * whole), in which case there is no prefix to splice against.
   */
  let tailStartCursor: string | null = null;
  const older: OlderHistoryState = { hasMore: false, loading: false, error: null };
  /** Outline entries before the OLDEST loaded window (the outline's numbering offset). */
  let outlineOffset = 0;

  /** Reset all windowed-history bookkeeping to "everything loaded from the beginning". */
  const resetPaging = (): void => {
    prefixItems = [];
    prefixSubagents = new Map();
    prependCount = 0;
    nextBefore = null;
    tailStartCursor = null;
    older.hasMore = false;
    older.loading = false;
    older.error = null;
    outlineOffset = 0;
  };

  /** Adopt a TAIL page's pagination envelope as the fresh baseline (initial load / prefix-dropping rebuild). */
  const adoptTailPage = (page: MessagesPageInfo | undefined): void => {
    resetPaging();
    if (page === undefined) return; // full transcript: nothing older exists by definition
    nextBefore = page.before ?? null;
    tailStartCursor = page.before ?? null;
    older.hasMore = page.before !== undefined;
    outlineOffset = page.earlierTurns;
  };

  const clearPending = (): void => {
    if (pending.size === 0) return;
    pending.clear();
    deps.onPendingChange();
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
        if (ev.state === "idle") {
          // Task ended (or the snapshot confirms idle): finalize the current Task's stats; pending approvals have already converged server-side.
          notifyTaskIdle(model);
          clearPending();
          deps.onModelChange();
        }
        return;
      }
      case "subagent_state": {
        deps.onSubagents?.(ev.subagents);
        return;
      }
      case "resync_required": {
        // The buffer has been evicted: refetch history to rebuild the model, then continue consuming the same connection.
        void rebuild();
        return;
      }
      case "credentials_updated": {
        // The Project's model credentials changed (Models page save): the server has
        // already invalidated cached runtimes, so any auth-dead state is stale — clear it
        // and let the user simply continue (it re-arms if the new key fails too). Buffered
        // during history load like other model-affecting events, so it replays AFTER the
        // history that set the flag.
        model.lastAuthFailureMs = null;
        deps.onModelChange();
        return;
      }
      case "hello":
        return;
    }
  };

  /**
   * resync_required decision tree — which refetch rebuilds the model. Resync means the
   * SSE buffer was evicted and the transcript state is suspect, so every branch below
   * chooses correctness over cleverness (ANY doubt falls back to the full read):
   *
   *   1. No backfilled prefix → refetch the TAIL window. Identical in shape to the
   *      initial load: the window is a disk-true suffix, the buffered events replay
   *      with overlap dedup, and the live attachment weaves in under the existing
   *      channel-epoch guard (weaveLiveTail skips seeding when the cursor's epoch
   *      doesn't match the events seen on this connection).
   *   2. Prefix retained → refetch the TAIL window and splice ONLY when continuity is
   *      provable: the refetched window's start cursor must EQUAL the recorded start
   *      of the current tail window (cursors are (shard, ordinal) positions on
   *      immutable storage, so equality proves the new tail abuts the prefix exactly —
   *      no gap, no overlap). Equality holds precisely when no new unit started since
   *      the last tail fetch, the common mid-Task resync.
   *   3. Prefix retained but the refetched tail reaches the very beginning (no cursor)
   *      → the tail alone provably covers everything: drop the prefix and use it.
   *   4. Anything else — the start cursor moved (new units arrived), the response
   *      carried no page envelope, or the tail fetch itself failed mid-decision —
   *      is doubt: fall back to the legacy FULL refetch (one complete transcript, no
   *      prefix, offsets zeroed). Slow but beyond suspicion.
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
    await load(epoch, createStreamModel(localDecisions), {
      page: { kind: "tail", limit: TAIL_UNITS },
      splice: prefixItems.length > 0,
    });
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
    opts: { page?: MessagesPageQuery; splice?: boolean } = {},
  ): Promise<void> => {
    try {
      let res = await deps.loadMessages(opts.page);
      if (disposed || currentEpoch !== epoch) return;
      if (opts.splice === true) {
        // The resync decision tree's prefix-retained branches (see rebuild): splice only
        // on exact cursor continuity; a beginning-reaching tail supersedes the prefix;
        // everything else falls back to the full read within this same epoch (events
        // keep buffering meanwhile).
        const start = res.page?.before ?? null;
        if (res.page !== undefined && start !== null && start === tailStartCursor) {
          // Continuity proven: keep prefix and paging state exactly as they are.
        } else if (res.page !== undefined && start === null) {
          adoptTailPage(res.page); // tail covers everything: prefix dropped, provably complete
        } else {
          res = await deps.loadMessages();
          if (disposed || currentEpoch !== epoch) return;
          adoptTailPage(undefined); // full transcript: no prefix, no cursors
        }
      } else if (opts.page !== undefined) {
        // Fresh tail baseline (initial load / retry): any previously-loaded prefix is
        // superseded by the new window chain.
        adoptTailPage(res.page);
      } else {
        adoptTailPage(undefined);
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
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return;
      failed = true;
      deps.onLoading(false);
      deps.onError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Scroll-up backfill: fetch the window before the oldest loaded one and prepend it.
   * The window's messages build a FRESH model (its own negative id base, priors seeded,
   * finalizeHistory closing its last Task — complete by construction, since a newer
   * window follows), whose items freeze into the prefix. Guarded to the live phase: a
   * rebuild in flight owns the loading pipeline, and its epoch bump discards any
   * backfill that raced it.
   */
  const loadOlder = async (): Promise<void> => {
    if (disposed || phase !== "live" || failed) return;
    if (older.loading || !older.hasMore || nextBefore === null) return;
    const currentEpoch = epoch;
    older.loading = true;
    older.error = null;
    deps.onModelChange();
    try {
      const res = await deps.loadMessages({
        kind: "before",
        cursor: nextBefore,
        limit: OLDER_UNITS,
      });
      if (disposed || currentEpoch !== epoch) return;
      // A before-request against a server without windowing support would return the
      // full transcript with no envelope; prepending that would duplicate history.
      if (res.page === undefined) throw new Error("windowed history not supported");
      prependCount += 1;
      const m = createStreamModel(localDecisions);
      m.nextItemId = -prependCount * PREPEND_ID_SPAN;
      seedPriorStats(m.stats, res.page.prior);
      pushMessages(m, res.messages, now(), null);
      finalizeHistory(m);
      prefixItems = [...m.items, ...prefixItems];
      // Child sessions live in exactly one window (a spawn is contained in its Task),
      // so the merge is disjoint; newer windows' entries win defensively on a clash.
      const mergedSubagents = new Map(m.subagents);
      for (const [sid, sub] of prefixSubagents) mergedSubagents.set(sid, sub);
      prefixSubagents = mergedSubagents;
      nextBefore = res.page.before ?? null;
      older.hasMore = res.page.before !== undefined;
      outlineOffset = res.page.earlierTurns;
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return;
      older.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (!disposed && currentEpoch === epoch) {
        older.loading = false;
        deps.onModelChange();
      }
    }
  };

  return {
    get model() {
      return model;
    },
    get prefixItems(): readonly ChatItem[] {
      return prefixItems;
    },
    get prefixSubagents(): ReadonlyMap<string, StreamModel> {
      return prefixSubagents;
    },
    get outlineOffset() {
      return outlineOffset;
    },
    get older(): OlderHistoryState {
      return older;
    },
    get pendingApprovals(): ReadonlyMap<string, PendingApproval> {
      return pending;
    },
    load: () => {
      epoch += 1;
      return load(epoch, undefined, { page: { kind: "tail", limit: TAIL_UNITS } });
    },
    retry: async () => {
      if (disposed || !failed) return;
      // Retry always rebuilds into a FRESH model. After an initial-load failure the model was
      // never written, but after a failed *resync* rebuild the OLD populated model is deliberately
      // left in place (so the transcript didn't blank during the refetch) — pushing the refetched
      // history straight onto it would duplicate the entire conversation (pushMessages appends with
      // no id-dedup). load() swaps the fresh model in only once the refetch succeeds, then replays
      // the still-accumulating buffer into it; localDecisions carry over via the shared set.
      // The refetch is a fresh TAIL baseline: any retained prefix is superseded on success.
      deps.onError(null);
      deps.onLoading(true);
      epoch += 1;
      await load(epoch, createStreamModel(localDecisions), {
        page: { kind: "tail", limit: TAIL_UNITS },
      });
    },
    loadOlder,
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
        } else if (ev.type === "subagent_state") {
          // Like task_state, this is authoritative UI state and should be visible while the
          // history fetch is still in flight; replaying it later is harmless and preserves
          // ordering relative to any following child messages.
          deps.onSubagents?.(ev.subagents);
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
