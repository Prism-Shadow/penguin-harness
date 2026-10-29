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
 * - Live-tail seeding: while a Task runs, a history window also carries `live`
 *   ({cursor, fragments} — see MessagesLiveTail): buffered partial events at
 *   or before the cursor are dropped (their content is already accumulated
 *   inside the fragments), the synthetic `partial_* start` fragments are fed
 *   through the normal reducer path at the cursor's position, and the rest of
 *   the buffer replays on top — so the in-progress message survives a refresh
 *   with its streamed prefix intact and keeps streaming.
 * - History over the stream: every window is a read of the `history` stream
 *   (lib/history/history-read.ts), which reports how far the bytes behind it have
 *   come. The first read asks for the newest Tasks that fit FIRST_PAINT_BYTES, so a
 *   conversation on a slow machine shows its latest messages within seconds; the
 *   older windows then follow until TAIL_UNITS Tasks are on screen, each prepended
 *   like a scroll-up backfill, and the first read stays open while the server brings
 *   the rest of the Session over behind them (the fill). Leaving the conversation
 *   (`dispose`) closes every read, which stops the transfer at once.
 * - Folded bodies: a history window carries a bulky value (a tool's output, a long
 *   argument, a thinking block) as a preview; `loadBodies` fetches the whole of an
 *   item's folded values when the reader unfolds it and puts them in place.
 */
import { isEventMessage, isPartialPayload } from "@prismshadow/amsp";
import type { AmspRecord, ToolCallPayload } from "@prismshadow/amsp";
import type {
  GoalServerEvent,
  HistoryProgress,
  MessagesLiveTail,
  MessagesPageInfo,
  PendingFollowUpInfo,
  SubagentRuntimeInfo,
  PendingSteeringInfo,
  ServerEvent,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import type { HistoryStreamQuery } from "../../api/sse";
import { BodyCache, foldedItems, takeHeldBodies } from "../history/folded-bodies";
import { readBody, readHistory } from "../history/history-read";
import { countUnits } from "../history/window-units";
import type { HistoryRead, OpenBody, OpenHistory } from "../history/history-read";
import type { HistoryWindow } from "../history/window-assembler";
import {
  approvalKey,
  buildDedupIndex,
  createStreamModel,
  discardFragmentFor,
  elidedRecordsOf,
  finalizeHistory,
  findToolCard,
  isDuplicate,
  notifyTaskIdle,
  pushMessage,
  pushMessages,
  registerLocalDecision,
} from "./stream-model";
import type { BodyLoad, ChatItem, StreamModel, ThinkingItem, ToolCallItem } from "./stream-model";
import { seedPriorStats } from "./task-stats";

/** A single pending approval (keyed by approvalKey(origin, toolCallId)). */
export interface PendingApproval {
  toolCall: AmspRecord<ToolCallPayload>;
  origin?: string[];
}

/** Buffered stream event; `id` is the SSE event id (`<epoch>-<seq>`, null when unknown); `seeded` marks a live-tail fragment injected at replay time (never carried over into a later round's buffer — the new round refetches fresh fragments). */
type BufferedEvent =
  | { kind: "record"; msg: AmspRecord; id: string | null; seeded?: boolean }
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
 * Initial (tail) window size, in message-bearing units — one unit = one Task, opened by
 * a user prompt (the server's cut rule; see MessagesPageInfo). A conversation opens on its
 * newest 20 Q&A pairs, the user's call: the rest of a long Session streams in on scroll
 * (see loadOlder). The count bounds what the page renders, not what it weighs — one Task
 * can run hundreds of tool calls — so the server also cuts a page at its byte budget, and
 * a page may then hold fewer units than asked for while still carrying `before`.
 */
export const TAIL_UNITS = 20;

/**
 * The first read's byte budget, measured on the records as the history stream sends them
 * (images by reference, bulky bodies folded): the newest whole Tasks that fit it — always at
 * least one — are the first paint, and the rest of the TAIL_UNITS follow in older windows. At
 * 10 KB/s and the ~3x the link's compression reaches on text, 64 KiB is two to three seconds
 * on the wire, where a whole 20-Task window can be minutes.
 */
export const FIRST_PAINT_BYTES = 64 * 1024;

/** Scroll-up backfill window size: each scroll to the top adds 20 more Q&A pairs. */
export const OLDER_UNITS = 20;

/**
 * Item-id space reserved per prepended window. The live model numbers its items upward
 * from 1; each prepended window numbers upward from its own NEGATIVE base, so ids stay
 * unique across the concatenated view (React keys, outline anchors) without ever
 * renumbering already-mounted items. A window holds at most a few thousand items —
 * far under the span.
 */
const PREPEND_ID_SPAN = 1_000_000;

/** A resync's bridge between a moved tail and the earlier windows gives up after this many reads. */
const MAX_BRIDGE_WINDOWS = 20;

export interface StreamControllerDeps {
  /** The Session whose stream this is: the owner of the model a history window starts on (see MessagesPageInfo.contextModel). */
  sessionId: string;
  /**
   * Opens one read of this Session's `history` stream (api/sse.ts `openHistoryStream`): a
   * window's records with its `page` envelope and, while a Task runs, its live tail, and the
   * server's clock at read time (`serverNowMs`; null just costs a running Task's header the time
   * its in-flight event has taken so far, which falls back to the Trace's own span, see
   * pushMessages).
   */
  openHistory: OpenHistory;
  /** Opens one read of a folded value (api/sse.ts `openTraceBodyStream`); absent, nothing unfolds to more. */
  openBody?: OpenBody;
  /** How far the reads behind the transcript have come (see HistoryTransfer). */
  onTransfer?: (transfer: HistoryTransfer) => void;
  /** Authoritative running state from the stream (covers both the subscription snapshot and transition events). */
  onTaskState: (state: SessionStatus) => void;
  /** Queued follow-up count carried on task_state events (absent on old servers -> 0). */
  onQueuedFollowUps?: (count: number) => void;
  /** Undelivered steering messages carried on task_state events (absent = none): keeps the composer's "steering queued" hint alive across reloads. */
  onPendingSteering?: (items: PendingSteeringInfo[]) => void;
  /** Steering a finished run never delivered: the composer takes it back into its draft. */
  onReturnedSteering?: (items: PendingSteeringInfo[]) => void;
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
  /**
   * A window was read because the reader scrolled up for it, past the TAIL_UNITS Tasks a
   * conversation opens on: only then does reaching the beginning say so (a conversation that
   * fits the first 20 Tasks looks as it always has, with no marker).
   */
  beyondTail: boolean;
}

/**
 * How far the bytes behind the transcript have come, per read: `window` while the window the
 * transcript waits on is read (the first paint, a rebuild), `older` while an older window is,
 * and `fill` while the server brings the rest of the Session over behind the first paint. Null
 * when no such read is under way, and for a Session on this server, whose reads report nothing.
 */
export interface HistoryTransfer {
  window: HistoryProgress | null;
  older: HistoryProgress | null;
  fill: HistoryProgress | null;
}

const NO_TRANSFER: HistoryTransfer = { window: null, older: null, fill: null };

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
  readonly transfer: HistoryTransfer;
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval>;
  /** Load history for the first time (called once after connect-first): the first paint, then older windows up to TAIL_UNITS Tasks. */
  load: () => Promise<void>;
  /** Retry entry point after a history load failure (keeps the buffer, refetches history). */
  retry: () => Promise<void>;
  /** The window the transcript waits on is read again now (Retry now while the server waits for the machine). */
  retryNow: () => void;
  /** Fetches the whole of an item's folded values and puts them in place; no-op while fetching, or with nothing folded. */
  loadBodies: (item: ToolCallItem | ThinkingItem) => void;
  /** Prepend the previous window (scroll-up backfill); no-op while loading, failed, at the beginning, or before the initial load settled. */
  loadOlder: () => Promise<void>;
  /** SSE AmspRecord entry point (`eventId`: the SSE event id, used for live-tail cursor alignment). */
  handleRecord: (msg: AmspRecord, eventId?: string | null) => void;
  /** SSE server-event entry point (`eventId`: same as handleRecord). */
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
  /** How many windows have been frozen into the prefix (derives each one's negative item-id base). */
  let prependCount = 0;
  /** Cursor for the NEXT older window (= the oldest loaded window's start); null = beginning reached or full transcript loaded. */
  let nextBefore: string | null = null;
  /**
   * The LIVE tail window's start cursor, as returned by the last tail fetch — the resync
   * continuity anchor: a refetched tail whose start cursor equals this provably abuts the
   * retained prefix. Null = the tail reaches the beginning (or the transcript was loaded
   * whole).
   */
  let tailStartCursor: string | null = null;
  /** The live tail window's page as it was read: the seeds of a window cut at its start. */
  let tailPage: MessagesPageInfo | undefined;
  const older: OlderHistoryState = {
    hasMore: false,
    loading: false,
    error: null,
    beyondTail: false,
  };
  /** Outline entries before the OLDEST loaded window (the outline's numbering offset). */
  let outlineOffset = 0;
  /** Units (the server's Tasks) of the tail window as read, and of every frozen window. */
  let tailUnits = 0;
  let prefixUnits = 0;
  /** The first paint's older windows are being read, up to TAIL_UNITS: one row for all of them. */
  let backfilling = false;

  // —— Reads of the history stream ——
  let transfer: HistoryTransfer = NO_TRANSFER;
  /** The reads open now, closed on dispose; a read leaves the set when it ends. */
  const reads = new Set<{ close: () => void }>();
  /** The window read the transcript waits on, while its window has not arrived. */
  let waitingRead: HistoryRead | null = null;
  /** A window read whose fill runs on behind the transcript; null once filled or failed. */
  let fillRead: HistoryRead | null = null;
  /** The older window being read (a scroll-up, or the first paint's backfill); one at a time. */
  let olderRead: HistoryRead | null = null;

  const setTransfer = (key: keyof HistoryTransfer, value: HistoryProgress | null): void => {
    if (transfer[key] === value) return;
    transfer = { ...transfer, [key]: value };
    deps.onTransfer?.(transfer);
  };

  /**
   * One window over the history stream. `track` names where its progress shows until the window
   * arrives (`quiet`: nowhere, a read behind a transcript that stays as it is); a read that fills
   * on after it reports the fill under `fill`. An `older` read belongs to the epoch it was opened
   * in: once a rebuild moves on, nothing it says reaches the row. A `window` read takes the place
   * of one still waiting (a retry, a rebuild): the old one is closed, not left to run. A read
   * leaves the open set when it ends, and the window it assembled goes to the caller only.
   */
  const readWindow = (
    query: HistoryStreamQuery,
    track: "window" | "older" | "quiet",
    readEpoch: number,
  ): { done: Promise<HistoryWindow>; read: HistoryRead } => {
    let resolve!: (window: HistoryWindow) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<HistoryWindow>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    const fills = query.kind === "tail" && query.fill === true;
    let delivered = false;
    let ended = false;
    const self: { read: HistoryRead | null } = { read: null };
    const end = (): void => {
      ended = true;
      if (self.read !== null) reads.delete(self.read);
    };
    const owned = (): boolean => !disposed && (track !== "older" || readEpoch === epoch);
    const read = readHistory(deps.openHistory, query, {
      onProgress: (progress, after) => {
        if (!owned()) return;
        if (after) setTransfer("fill", progress);
        else if (track !== "quiet") setTransfer(track, progress);
      },
      onWindow: (window) => {
        delivered = true;
        if (waitingRead === self.read) waitingRead = null;
        if (fills) fillRead = self.read;
        else end();
        // The first paint's backfill keeps its row's last reading between its windows.
        if (track === "window" || (track === "older" && owned() && !backfilling)) {
          setTransfer(track, null);
        }
        resolve(window);
      },
      onFilled: () => {
        end();
        if (fillRead === self.read) fillRead = null;
        setTransfer("fill", null);
      },
      onError: (message) => {
        end();
        if (waitingRead === self.read) waitingRead = null;
        if (delivered) {
          // The fill failed behind a transcript already on screen: older windows are still
          // read on scroll, so all the reader loses is the head start.
          if (fillRead === self.read) fillRead = null;
          setTransfer("fill", null);
          return;
        }
        if (track === "window" || (track === "older" && owned())) setTransfer(track, null);
        reject(new Error(message));
      },
    });
    self.read = read;
    if (!ended) reads.add(read);
    if (track === "window") {
      if (waitingRead !== null && waitingRead !== read) {
        waitingRead.close();
        reads.delete(waitingRead);
      }
      waitingRead = delivered ? null : read;
    }
    return { done, read };
  };

  /** Reset all windowed-history bookkeeping to "everything loaded from the beginning". */
  const resetPaging = (): void => {
    prefixItems = [];
    prefixSubagents = new Map();
    prependCount = 0;
    prefixUnits = 0;
    nextBefore = null;
    tailStartCursor = null;
    tailPage = undefined;
    older.hasMore = false;
    older.loading = false;
    older.error = null;
    older.beyondTail = false;
    outlineOffset = 0;
  };

  /** Adopt a TAIL page's pagination envelope as the fresh baseline (initial load / prefix-dropping rebuild). */
  const adoptTailPage = (page: MessagesPageInfo | undefined): void => {
    resetPaging();
    tailPage = page;
    if (page === undefined) return; // full transcript: nothing older exists by definition
    nextBefore = page.before ?? null;
    tailStartCursor = page.before ?? null;
    older.hasMore = page.before !== undefined;
    outlineOffset = page.earlierTurns;
  };

  /**
   * The older window being read stops: a rebuild owns the chain now, a retry starts it over.
   * Its read is closed — the bytes behind it stop — and the row lets it go.
   */
  const stopOlder = (): void => {
    if (olderRead !== null) {
      olderRead.close();
      reads.delete(olderRead);
      olderRead = null;
    }
    backfilling = false;
    older.loading = false;
    setTransfer("older", null);
  };

  /**
   * A subagent a backfilled window spawned can still speak (it runs on in the background past
   * its Task): the live model takes that window's child model over before anything reaches it,
   * so the child's live records, its pending approvals and its card land on the history the
   * window holds, not on a new, empty child.
   */
  const adoptEarlierChild = (origin: readonly string[] | undefined): void => {
    const head = origin?.[0];
    if (head === undefined || model.subagents.has(head)) return;
    const earlier = prefixSubagents.get(head);
    if (earlier !== undefined) model.subagents.set(head, earlier);
  };

  /**
   * Children the live model made from a record before any window had shown them — a background
   * subagent of an older Task speaking again, or its approval re-sent on subscribe, while the
   * window that holds its history is still to come — with every record routed to each since, in
   * order. When an older window brings that child, the window's copy takes its place and these
   * records are fed to it again (see takeOverLiveChildren). Bounded: a child that outgrows the
   * log keeps what the live model made of it (null).
   */
  const liveOnlyChildren = new Map<string, AmspRecord[] | null>();
  const LIVE_CHILD_LOG = 2_000;

  /** Notes a record about to be routed to a child of the live model (see liveOnlyChildren). */
  const noteChildRecord = (msg: AmspRecord): void => {
    const head = msg.origin?.[0];
    if (head === undefined) return;
    if (!model.subagents.has(head)) {
      // Made from this record: only a child an older window can still bring is logged.
      if (prefixSubagents.has(head) || !older.hasMore) return;
      liveOnlyChildren.set(head, [msg]);
      return;
    }
    const log = liveOnlyChildren.get(head);
    if (log === undefined || log === null) return;
    if (log.length >= LIVE_CHILD_LOG) liveOnlyChildren.set(head, null);
    else log.push(msg);
  };

  /**
   * An older window just built holds a child the live model made without its history: the
   * window's copy becomes the child — history first, then every record the live one took, fed
   * again in order — and the card the first record left at the end of the newest Task goes, the
   * child's own run_subagent card in the window being where it belongs. Merging a frozen
   * window's child into the live one instead would leave two models of one child in play.
   */
  const takeOverLiveChildren = (window: StreamModel): void => {
    for (const [sid, child] of window.subagents) {
      const log = liveOnlyChildren.get(sid);
      if (log === undefined) continue;
      liveOnlyChildren.delete(sid);
      const live = model.subagents.get(sid);
      if (log === null || live === undefined || live === child) continue;
      const stray = model.items.findIndex((i) => i.kind === "subagent" && i.model === live);
      if (stray >= 0) model.items.splice(stray, 1);
      for (const item of model.items) {
        if (item.kind === "tool_call" && item.subagent === live) item.subagent = child;
      }
      model.unconfirmedSubagents.delete(sid);
      model.subagents.set(sid, child);
      for (const msg of log) {
        const rest = msg.origin!.slice(1);
        const forwarded: AmspRecord = { ...msg };
        if (rest.length > 0) forwarded.origin = rest;
        else delete forwarded.origin;
        pushMessage(child, forwarded, now());
      }
    }
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

  const feedRecord = (msg: AmspRecord, dedup: Set<string> | null): void => {
    adoptEarlierChild(msg.origin);
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
    noteChildRecord(msg);
    pushMessage(model, msg, now());
  };

  const handleServer = (ev: ServerEvent): void => {
    switch (ev.type) {
      case "approval_request": {
        const toolCallId = ev.toolCall.payload.tool_call_id;
        const entry: PendingApproval = { toolCall: ev.toolCall };
        if (ev.origin) entry.origin = ev.origin;
        pending.set(approvalKey(ev.origin, toolCallId), entry);
        adoptEarlierChild(ev.origin);
        const card = findToolCard(model, ev.origin, toolCallId);
        // Resend scenario (reload / mid-stream join): sub-session messages
        // aren't in the parent Trace, so the tool card can be missing —
        // feed the event's toolCall (with origin) to the reducer to rebuild the nested card, so the approval button is visible.
        if (!card) {
          const msg: AmspRecord = { ...ev.toolCall };
          if (ev.origin && ev.origin.length > 0) msg.origin = [...ev.origin];
          else delete msg.origin;
          noteChildRecord(msg);
          pushMessage(model, msg, now());
          deps.onModelChange();
        } else if (card.elidedCall !== undefined) {
          // A history window folded this call's long arguments (a file to write, an edit); the
          // approval carries them whole, and what is approved must be what is shown.
          card.argumentsText = ev.toolCall.payload.arguments;
          delete card.elidedCall;
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
        deps.onReturnedSteering?.(ev.returnedSteering ?? []);
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
   * resync_required decision tree — which refetch rebuilds the model. Resync means the SSE
   * buffer was evicted and the transcript state is suspect, so every branch chooses what can
   * be proven; and none of them takes away what the reader is looking at — the old transcript
   * stays on screen until the new one is whole, and then holds every Task the old one held:
   *
   *   1. The refetched tail starts where the current one started (cursors are (shard, ordinal)
   *      positions on append-only storage, so equality proves the new tail abuts what lies
   *      before it — no gap, no overlap): splice, the earlier windows kept as they are. The
   *      common mid-Task resync.
   *   2. It starts later (new units arrived): the windows between the two starts are read
   *      while the old transcript stays on screen, the oldest cut exactly at the old start by
   *      the records' Trace positions, and they join the earlier windows; nothing the reader
   *      had is dropped and nothing is read twice. When the cut cannot be proven (a window
   *      without a page, no record at the old start), the refetched tail is the new baseline
   *      (case 3's shape).
   *   3. It reaches the very beginning, or carries no page envelope (the whole transcript):
   *      it alone covers everything, and the earlier windows give way to it.
   *
   * The tail is read exactly as the first paint read it (same unit count, same byte budget),
   * so with no new unit the same cut comes back. An older window in flight is closed first: it
   * belongs to the chain being rebuilt.
   */
  const rebuild = async (): Promise<void> => {
    epoch += 1;
    phase = "buffering";
    buffer = [];
    // Clear the pending-approvals table: an approval decided while
    // disconnected shouldn't leave a lingering button; the server will
    // resend still-pending approval_request events on the same connection afterward, naturally rebuilding it.
    clearPending();
    stopOlder();
    // Atomic swap — deliberately NOT `onLoading(true)`. The fresh model (shared localDecisions
    // injected, so approvals decided on this end stay labeled "manual") is handed to load(), which
    // makes it the visible model only once history is back in hand. Until then the OLD transcript
    // stays mounted and on screen: a mid-stream resync never blanks the conversation nor unmounts
    // the composer. (Flipping loading=true here drove the consumer to swap both the message list and
    // the input for a skeleton, losing scroll position, expanded tool cards, and composer
    // focus/draft.) Deltas arriving during the refetch are buffered and replayed on swap; the brief
    // no-new-text pause is invisible next to a full teardown.
    await load(epoch, createStreamModel(localDecisions), {
      // The fill rides along unless one already runs behind the transcript.
      query: firstPaint(fillRead === null),
      bridge: true,
    });
  };

  /** Cursors (`<shard>:<ordinal>`) in Trace order. */
  const compareCursor = (a: string, b: string): number => {
    const [af = 0, ao = 0] = a.split(":").map(Number);
    const [bf = 0, bo = 0] = b.split(":").map(Number);
    return af !== bf ? af - bf : ao - bo;
  };

  /**
   * The windows between a refetched tail's start (`from`) and the old tail's (`to`; null: the
   * beginning), read newest first behind the old transcript, the oldest cut at `to` by its
   * records' Trace positions and seeded as the old tail was (`toPage`). Null when the cut
   * cannot be proven.
   */
  const bridgeGap = async (
    from: string,
    to: string | null,
    toPage: MessagesPageInfo,
    currentEpoch: number,
  ): Promise<HistoryWindow[] | null> => {
    const windows: HistoryWindow[] = [];
    let cursor = from;
    for (let n = 0; n < MAX_BRIDGE_WINDOWS; n += 1) {
      const w = await readWindow(
        { kind: "before", cursor, limit: OLDER_UNITS },
        "quiet",
        currentEpoch,
      ).done;
      if (disposed || currentEpoch !== epoch || w.page === undefined) return null;
      const start = w.page.before ?? null;
      const pastOldStart =
        to === null ? start === null : start === null || compareCursor(start, to) <= 0;
      if (!pastOldStart) {
        windows.unshift(w);
        cursor = start!;
        continue;
      }
      if (to === null) {
        windows.unshift(w);
        return windows;
      }
      const cut = w.messages.findIndex(
        (m) =>
          m.tracePosition !== undefined &&
          `${m.tracePosition.fileIndex}:${m.tracePosition.ordinal}` === to,
      );
      if (cut < 0) return null;
      windows.unshift({ ...w, messages: w.messages.slice(cut), page: toPage });
      return windows;
    }
    return null;
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
        if (e.kind !== "record" || !isPartialPayload(e.msg.payload)) pre.push(e);
      } else {
        post.push(e);
      }
    }
    const seeds: BufferedEvent[] = live.fragments.map((msg) => ({
      kind: "record",
      msg,
      id: null,
      seeded: true,
    }));
    return [...pre, ...seeds, ...post];
  };

  /**
   * Seeds a model with what came before the window it is about to take: the stats accrued
   * ahead of it, so header chips and per-turn cumulative rows equal a full load (see
   * seedPriorStats), the model its first context runs on, and the Agent State directory for
   * memory-change detection. Their `session_meta` may fall before the window.
   */
  const seedWindow = (target: StreamModel, page: MessagesPageInfo): void => {
    seedPriorStats(target.stats, page.prior);
    if (page.contextModel !== undefined) {
      target.contextModel = { sessionId: deps.sessionId, ...page.contextModel };
    }
    if (page.agentState !== undefined) target.agentState = page.agentState;
  };

  const load = async (
    currentEpoch: number,
    freshModel: StreamModel | undefined,
    opts: { query: HistoryStreamQuery; bridge?: boolean },
  ): Promise<void> => {
    try {
      const res = await readWindow(opts.query, "window", currentEpoch).done;
      if (disposed || currentEpoch !== epoch) return;
      const start = res.page?.before ?? null;
      const continuous = res.page !== undefined && start !== null && start === tailStartCursor;
      let bridged: HistoryWindow[] | null = null;
      if (opts.bridge === true && !continuous && start !== null && tailPage !== undefined) {
        bridged = await bridgeGap(start, tailStartCursor, tailPage, currentEpoch);
        if (disposed || currentEpoch !== epoch) return;
      }
      if (opts.bridge === true && continuous) {
        // The resync decision tree's continuity branch (see rebuild): keep the prefix and the
        // paging state exactly as they are.
        tailPage = res.page;
      } else if (bridged !== null) {
        // The tail moved on: the windows between join the earlier ones, after them.
        for (const w of bridged) {
          const m = freeze(w, w.page!);
          takeOverLiveChildren(m);
          prefixItems = [...prefixItems, ...m.items];
          prefixUnits += countUnits(w.messages);
          prefixSubagents = new Map([...prefixSubagents, ...m.subagents]);
        }
        tailStartCursor = start;
        tailPage = res.page;
      } else {
        // A fresh tail baseline: the initial load, a retry, a tail reaching the beginning,
        // or a cut that could not be proven. Any previously-loaded prefix is superseded.
        adoptTailPage(res.page);
      }
      tailUnits = countUnits(res.messages);
      const { messages, live, serverNowMs } = res;
      // Rebuild path: make the freshly-built model visible only now, atomically — the old model
      // stayed on screen throughout the refetch above (see rebuild). Initial load / retry pass no
      // freshModel and keep operating on the current model.
      if (freshModel) model = freshModel;
      const target = model;
      // The children a replay is about to make are this model's to log, from scratch.
      liveOnlyChildren.clear();
      if (res.page !== undefined) seedWindow(target, res.page);
      pushMessages(target, messages, now(), serverNowMs ?? null);
      const dedup = buildDedupIndex(messages, 100);
      // Replay the buffer (events that arrived while fetching history), with dedup; while a
      // Task runs, the live tail is woven in so the in-progress message is seeded too.
      const replay = live !== undefined ? weaveLiveTail(buffer, live) : buffer;
      buffer = [];
      for (let i = 0; i < replay.length; i += 1) {
        const e = replay[i]!;
        if (e.kind === "record") feedRecord(e.msg, dedup);
        else handleServer(e.ev);
        if (disposed) return;
        if (currentEpoch !== epoch) {
          // A rebuild was triggered mid-replay (e.g. resync_required): this
          // round is discarded, and the remaining events are handed off to
          // the new round's buffer — phase is left unchanged and the old buffer is never
          // fed to the new model. Seeded fragments are snapshot-bound to THIS round and
          // are dropped instead of carried over (the new round refetches fresh ones).
          buffer.push(...replay.slice(i + 1).filter((r) => r.kind !== "record" || !r.seeded));
          return;
        }
      }
      phase = "live";
      // Values fetched before a rebuild go back into the items it built folded again.
      putHeldBodies();
      // History finalization trusts only the in-stream authoritative state:
      // finalize the last Task at the end of history only when idle; if the
      // snapshot hasn't arrived yet (rare), don't finalize — the
      // task_state:idle branch will complete the equivalent finalization once it arrives.
      if (streamStatus === "idle") finalizeHistory(target);
      failed = false;
      deps.onError(null);
      deps.onLoading(false);
      deps.onModelChange();
      void backfill(currentEpoch);
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return;
      failed = true;
      deps.onLoading(false);
      deps.onError(e instanceof Error ? e.message : String(e));
    }
  };

  /** A window as a frozen model of its own: a fresh negative id base, priors seeded, its last Task closed. */
  const freeze = (w: HistoryWindow, page: MessagesPageInfo): StreamModel => {
    prependCount += 1;
    const m = createStreamModel(localDecisions);
    m.nextItemId = -prependCount * PREPEND_ID_SPAN;
    seedWindow(m, page);
    pushMessages(m, w.messages, now(), null);
    finalizeHistory(m);
    return m;
  };

  /**
   * Scroll-up backfill: fetch the window of `limit` Tasks before the oldest loaded one and
   * prepend it. The window's messages build a FRESH model (its own negative id base, priors
   * seeded, finalizeHistory closing its last Task — complete by construction, since a newer
   * window follows), whose items freeze into the prefix: the live model's items are never
   * touched, so the transcript below stays exactly where it was. Guarded to the live phase: a
   * rebuild in flight owns the loading pipeline, and its epoch bump discards any backfill that
   * raced it. `auto`: the first paint's backfill, which a scroll-up waits for. True when a
   * window was prepended.
   */
  const loadOlderWindow = async (limit: number, auto: boolean): Promise<boolean> => {
    if (disposed || phase !== "live" || failed) return false;
    if (olderRead !== null || !older.hasMore || nextBefore === null) return false;
    if (!auto && backfilling) return false;
    const currentEpoch = epoch;
    older.loading = true;
    older.error = null;
    deps.onModelChange();
    const { done, read } = readWindow(
      { kind: "before", cursor: nextBefore, limit },
      "older",
      currentEpoch,
    );
    olderRead = read;
    try {
      const res = await done;
      if (disposed || currentEpoch !== epoch) return false;
      // A before-request against a server without windowing support would return the
      // full transcript with no envelope; prepending that would duplicate history.
      if (res.page === undefined) throw new Error("windowed history not supported");
      const m = freeze(res, res.page);
      takeOverLiveChildren(m);
      prefixItems = [...m.items, ...prefixItems];
      prefixUnits += countUnits(res.messages);
      // Child sessions live in exactly one window (a spawn is contained in its Task),
      // so the merge is disjoint; newer windows' entries win defensively on a clash.
      const mergedSubagents = new Map(m.subagents);
      for (const [sid, sub] of prefixSubagents) mergedSubagents.set(sid, sub);
      prefixSubagents = mergedSubagents;
      nextBefore = res.page.before ?? null;
      older.hasMore = res.page.before !== undefined;
      outlineOffset = res.page.earlierTurns;
      if (!auto) older.beyondTail = true;
      return true;
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return false;
      older.error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      if (olderRead === read) olderRead = null;
      if (!disposed && currentEpoch === epoch) {
        older.loading = backfilling;
        deps.onModelChange();
      }
    }
  };

  /** Units on screen: the tail window's and every frozen window's, counted as the server counts. */
  const unitsOnScreen = (): number => tailUnits + prefixUnits;

  /**
   * After a first paint (or a rebuild that took a new baseline): older windows, each asking for
   * the units still missing, until TAIL_UNITS are on screen or the beginning is reached. The
   * whole run is one loading state — the older row says one thing from its start to its end,
   * never flipping between windows. Stops at the first window that does not land (a failure
   * shows on the older row and is retried from there; a newer epoch supersedes it).
   */
  const backfill = async (currentEpoch: number): Promise<void> => {
    if (disposed || currentEpoch !== epoch || !older.hasMore) return;
    if (unitsOnScreen() >= TAIL_UNITS) return;
    backfilling = true;
    older.loading = true;
    deps.onModelChange();
    try {
      while (!disposed && currentEpoch === epoch && older.hasMore && unitsOnScreen() < TAIL_UNITS) {
        if (!(await loadOlderWindow(TAIL_UNITS - unitsOnScreen(), true))) break;
      }
    } finally {
      if (!disposed && currentEpoch === epoch) {
        backfilling = false;
        older.loading = olderRead !== null;
        setTransfer("older", null);
        deps.onModelChange();
      }
    }
  };

  /** The first read's shape: the newest Tasks that fit the first-paint budget. */
  const firstPaint = (fill: boolean): HistoryStreamQuery => ({
    kind: "tail",
    limit: TAIL_UNITS,
    budget: FIRST_PAINT_BYTES,
    ...(fill ? { fill: true } : {}),
  });

  /** Whole values fetched so far, by ref: a rebuilt item takes them back (folded-bodies.ts). */
  const bodyCache = new BodyCache();
  /**
   * The fetches running, by the refs they fetch, with the items waiting on each: an item rebuilt
   * by a resync while its values come over joins the fetch already running instead of starting
   * another.
   */
  const bodyFetches = new Map<
    string,
    { progress: BodyLoad; items: Set<ToolCallItem | ThinkingItem> }
  >();
  /** The model's folded items whose values are all held take them back. */
  const putHeldBodies = (): void => {
    for (const folded of foldedItems(model)) takeHeldBodies(folded, bodyCache);
  };

  /**
   * Fetches the whole of an item's folded values, one after another, and puts each record back
   * whole once all of its values have arrived — on the item asked for, on any item that joined
   * the fetch, and on the copy a resync rebuilt meanwhile. The item carries the fetch's progress
   * (`bodyLoad`), which never goes back: a body stream the socket re-issued starts its count over,
   * and the reader is shown the furthest point reached. A failure stays on the item until the
   * next call, which starts over; values already fetched are not asked again.
   */
  const loadBodies = (item: ToolCallItem | ThinkingItem): void => {
    const openBody = deps.openBody;
    if (disposed || openBody === undefined) return;
    if (item.bodyLoad !== undefined && item.bodyLoad.error === null) return;
    if (elidedRecordsOf(item).length === 0) return;
    // Fetched before (a resync put the item back folded): whole again, at once.
    if (takeHeldBodies(item, bodyCache)) {
      delete item.bodyLoad;
      deps.onModelChange();
      return;
    }
    const entries = elidedRecordsOf(item)
      .flatMap(({ elided }) => elided.entries)
      .filter((entry) => !bodyCache.has(entry.ref));
    const key = entries.map((entry) => entry.ref).join("\n");
    const running = bodyFetches.get(key);
    if (running !== undefined) {
      running.items.add(item);
      item.bodyLoad = running.progress;
      deps.onModelChange();
      return;
    }
    const fetch = {
      progress: {
        doneBytes: 0,
        totalBytes: entries.reduce((n, entry) => n + entry.bytes, 0),
        error: null,
      } as BodyLoad,
      items: new Set([item]),
    };
    bodyFetches.set(key, fetch);
    item.bodyLoad = fetch.progress;
    deps.onModelChange();
    let base = 0;
    const next = (at: number): void => {
      if (disposed || bodyFetches.get(key) !== fetch) return;
      const entry = entries[at];
      if (entry === undefined) {
        bodyFetches.delete(key);
        for (const waiting of fetch.items) {
          takeHeldBodies(waiting, bodyCache);
          delete waiting.bodyLoad;
        }
        putHeldBodies();
        deps.onModelChange();
        return;
      }
      let ended = false;
      const self: { read: { close: () => void } | null } = { read: null };
      const end = (): void => {
        ended = true;
        if (self.read !== null) reads.delete(self.read);
      };
      self.read = readBody(openBody, entry.ref, {
        onProgress: (doneBytes) => {
          if (bodyFetches.get(key) !== fetch) return;
          const reached = base + Math.min(doneBytes, entry.bytes);
          if (reached <= fetch.progress.doneBytes) return;
          fetch.progress.doneBytes = reached;
          deps.onModelChange();
        },
        onValue: (value) => {
          end();
          if (bodyFetches.get(key) !== fetch) return;
          bodyCache.set(entry.ref, value);
          base += entry.bytes;
          fetch.progress.doneBytes = Math.max(fetch.progress.doneBytes, base);
          next(at + 1);
        },
        onError: (message) => {
          end();
          if (bodyFetches.get(key) !== fetch) return;
          bodyFetches.delete(key);
          const failed: BodyLoad = { ...fetch.progress, error: message };
          for (const waiting of fetch.items) waiting.bodyLoad = failed;
          deps.onModelChange();
        },
      });
      if (!ended) reads.add(self.read);
    };
    next(0);
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
    get transfer(): HistoryTransfer {
      return transfer;
    },
    get pendingApprovals(): ReadonlyMap<string, PendingApproval> {
      return pending;
    },
    load: () => {
      epoch += 1;
      return load(epoch, undefined, { query: firstPaint(true) });
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
      stopOlder();
      // A fill still running behind the old transcript carries on; only a read that never got
      // that far asks for one again.
      await load(epoch, createStreamModel(localDecisions), {
        query: firstPaint(fillRead === null),
      });
    },
    retryNow: () => {
      waitingRead?.reissue();
    },
    loadBodies,
    loadOlder: async () => {
      await loadOlderWindow(OLDER_UNITS, false);
    },
    handleRecord: (msg, eventId = null) => {
      if (disposed) return;
      if (eventId !== null) lastEventId = eventId;
      if (phase === "buffering") {
        buffer.push({ kind: "record", msg, id: eventId });
        return;
      }
      feedRecord(msg, null);
      deps.onModelChange();
    },
    handleServer: (ev, eventId = null) => {
      if (disposed) return;
      if (eventId !== null) lastEventId = eventId;
      // session_title only affects list display (unrelated to the view model/history):
      // forwarded immediately at any phase, never buffered.
      if (ev.type === "session_title") {
        deps.onSessionTitle?.(ev.sessionId, ev.title);
        return;
      }
      // A subagent registered under this Session: no list shows a subagent Session (its
      // parent's Agent panel opens it), and the transcript learns of it from its own records.
      if (ev.type === "session_created") return;
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
          deps.onReturnedSteering?.(ev.returnedSteering ?? []);
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
      const entry = pending.get(key);
      if (entry === undefined) return;
      pending.delete(key);
      // The local answer time, stamped as the pending entry goes: the approval_decision event
      // that sets approvalAtMs lands a broadcast later, and in that window an elapsed-time gate
      // reading the card would fall back to the call's start and count the human wait as
      // execution — then jump forward when the event finally arrives.
      adoptEarlierChild(entry.origin);
      const card = findToolCard(model, entry.origin, entry.toolCall.payload.tool_call_id);
      if (card) card.localApprovalAtMs = now();
      deps.onPendingChange();
    },
    dispose: () => {
      disposed = true;
      // Leaving the conversation stops every transfer it started, at once.
      for (const read of [...reads]) read.close();
      reads.clear();
      bodyFetches.clear();
      liveOnlyChildren.clear();
      waitingRead = null;
      fillRead = null;
    },
  };
}
