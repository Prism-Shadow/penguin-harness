/**
 * Message-window scanner: the pure logic behind cursor pagination of
 * `GET /api/sessions/:id/messages` (TraceService.readMessagesPage).
 *
 * A window **unit** is one Task in the Web reducer's sense: it opens at a main-session
 * user prompt (text or image) and runs until the next such prompt. Cutting only at these
 * boundaries is what keeps every stream-model invariant intact inside a window — a
 * tool_call is never separated from its tool_call_output (outputs land before the next
 * user prompt), a compaction_begin/end span never splits (compaction-internal messages
 * stay skippable), a steering chip keeps the images that ride behind it, and a
 * mid-Task shard rotation (auto compaction with carry-over) stays glued to its Task.
 *
 * The scanner walks one shard's RAW messages (no subagent expansion — origin-carrying
 * messages never appear in a shard) and mirrors, decision for decision, the Web reducer
 * in web/src/lib/omni/stream-model.ts (pushMessage/startTask/finalizeOpenTask) plus the
 * outline-entry rule in web/src/features/chat/outline-model.ts (buildOutline) — the four
 * implementations of "what is one turn" (this file, stream-model, outline-model, and
 * trace-service.analyze) must stay in step; tests on both sides pin the shared cases.
 *
 * Two distinct counts come out of one pass:
 *   - **unit boundaries** — the safe cut points described above (banner-only prompts and
 *     goal-round re-sends included: they start Tasks in the reducer);
 *   - **outline turns** — the subset that opens an entry in the Web's conversation
 *     outline (`第 N 轮` numbering). Machine-only prompts (handoff / model-switch
 *     blocks), goal rounds past 1, steering chips and compaction injections do NOT open
 *     entries, and consecutive user messages of one send merge into one entry — the
 *     count must match buildOutline exactly, or a paginated outline would mis-number.
 *
 * The pass also accumulates the **prior stats** a partial window needs seeded into the
 * Web's stats tracker so header chips and per-turn cumulative rows keep telling the
 * truth (see task-stats.ts `seedPriorStats`): elapsed time of finished Tasks, subagent
 * token totals (via the caller-provided child expander), and the last main-session
 * session/context token readings.
 *
 * Scan state is carried across shards (a Task can span a rotation). Cached per-shard
 * prefix records (trace_files.page_stats) persist the carry so old shards are read at
 * most once ever; bump CACHE_VERSION whenever any rule in this file changes.
 */
import { parseUserSteeringText } from "@prismshadow/penguin-core";
import {
  parseGoalMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
} from "@prismshadow/penguin-core/markers";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** Bump when any counting/boundary rule changes: cached page_stats records with an older version are recomputed. */
export const CACHE_VERSION = 1;

/** Cumulative totals at a point in the trace (all values are "before this point"). */
export interface WindowPriorStats {
  /** Outline entries opened before this point (the Web outline's global numbering offset). */
  turns: number;
  /** Sum of subagent token_usage request totals (all descendant sessions) before this point. */
  subagentTokens: number;
  /** Sum of finished Tasks' elapsed time before this point (the Web's sessionElapsedMs basis). */
  elapsedMs: number;
  /** The last main-session token_usage `session.total` seen before this point (0 = none). */
  sessionTokens: number;
  /** The last main-session NON-compaction token_usage `request.total` before this point (context occupancy basis). */
  contextTokens: number;
}

/** Open-Task bookkeeping carried across messages (mirrors StreamModel.task* fields). */
interface TaskCarry {
  open: boolean;
  /** Task first/latest message timestamps (ms; the degenerate-round elapsed fallback). */
  firstTsMs: number;
  lastTsMs: number;
  /** Last non-compaction request_end (ms); the Task's true end when present. */
  lastReqEndMs: number | null;
  /** Whether this Task saw main usage / non-blank assistant text — decides whether a stats row would be emitted at its close (which breaks a user-item run). */
  sawUsage: boolean;
  sawReply: boolean;
  /** Compaction usage held pending (committed to the Task by a later non-compaction request_end — mirrors task-stats.ts pendingCompaction*). */
  pendingCompactionUsage: boolean;
}

/** Full scanner state, serializable into a shard's cached prefix record. */
export interface ScanState {
  totals: WindowPriorStats;
  task: TaskCarry;
  /** Between a main-session compaction_begin and its compaction_end. */
  compactionActive: boolean;
  /** A steering chip is still collecting its trailing images (mirrors StreamModel.openSteering). */
  steeringOpen: boolean;
  /**
   * Inside an unbroken, entry-carrying run of user items — buildOutline's `lastWasUser`,
   * tracked at the item level: true after an entry-eligible user item, false after any
   * non-user item (a stats row included) AND after banner/goal-round texts (which open no
   * entry and break the run in buildOutline). Both the window-cut and the merge decision
   * key off it, so a cut can never split what the outline merges.
   */
  runOpen: boolean;
}

export function initialScanState(): ScanState {
  return {
    totals: { turns: 0, subagentTokens: 0, elapsedMs: 0, sessionTokens: 0, contextTokens: 0 },
    task: {
      open: false,
      firstTsMs: 0,
      lastTsMs: 0,
      lastReqEndMs: null,
      sawUsage: false,
      sawReply: false,
      pendingCompactionUsage: false,
    },
    compactionActive: false,
    steeringOpen: false,
    runOpen: false,
  };
}

/** One safe cut point: `ordinal` indexes into the shard's parsed message array; `stats` is the cumulative prior AT the cut (the unit itself not included). */
export interface UnitBoundary {
  ordinal: number;
  stats: WindowPriorStats;
}

/**
 * Aggregate a subagent pointer's child subtree without materializing its messages:
 * the token sum feeds `subagentTokens`, the max timestamp advances the open Task's
 * lastTs exactly as routeNested's touchTask would for every expanded child message.
 * Null = child trace missing (the pointer event stays a plain event, contributing nothing).
 */
export interface ChildAggregate {
  requestTokens: number;
  maxTsMs: number | null;
}

function tsMs(timestamp: string): number | null {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/** Mirrors stream-model touchTask: advance the open Task's latest timestamp (compaction-internal messages excluded). */
function touchTask(state: ScanState, ms: number | null): void {
  if (!state.task.open || state.compactionActive || ms === null) return;
  if (ms > state.task.lastTsMs) state.task.lastTsMs = ms;
}

/** Mirrors stream-model finalizeOpenTask + task-stats endTask: settle the open Task's elapsed into the cumulative. */
function finalizeTask(state: ScanState): void {
  const t = state.task;
  if (!t.open) return;
  t.open = false;
  const endMs = t.lastReqEndMs ?? t.lastTsMs;
  state.totals.elapsedMs += Math.max(0, endMs - t.firstTsMs);
  t.pendingCompactionUsage = false;
}

/** Mirrors stream-model startTask: finalize the previous Task and open a new one at `ms`. */
function startTask(state: ScanState, ms: number | null): void {
  finalizeTask(state);
  const t = state.task;
  t.open = true;
  t.firstTsMs = ms ?? 0;
  t.lastTsMs = t.firstTsMs;
  t.lastReqEndMs = null;
  t.sawUsage = false;
  t.sawReply = false;
  t.pendingCompactionUsage = false;
}

/** A non-user item entered the stream: the user-item run breaks (buildOutline's lastWasUser = false). */
function breakRuns(state: ScanState): void {
  state.runOpen = false;
}

/**
 * Handle one Task-starting user message (prompt text or non-steering image).
 * `entryEligible` says whether the message would open an outline entry (buildOutline's
 * rule); ineligible messages (banner blocks, goal rounds > 1) still start Tasks — and
 * still cut when the run is broken — but never count and always break the run, exactly
 * as buildOutline resets lastWasUser for them.
 */
function onTaskStart(
  state: ScanState,
  ms: number | null,
  entryEligible: boolean,
  onBoundary: (stats: WindowPriorStats) => void,
): void {
  // A stats row emitted while closing the previous Task lands BEFORE this user item and
  // breaks the item run (finalizeOpenTask inserts it ahead of the new prompt) — mirror
  // that so two sends merged by the outline are never cut apart, while two sends
  // separated by a stats row cut (and count) as two.
  if (state.task.open && (state.task.sawUsage || state.task.sawReply)) breakRuns(state);
  const boundary = !state.runOpen;
  startTask(state, ms);
  if (boundary) onBoundary({ ...state.totals });
  if (entryEligible) {
    if (boundary) state.totals.turns += 1;
    state.runOpen = true;
  } else {
    state.runOpen = false;
  }
}

/** buildOutline's eligibility for a user prompt TEXT: machine-only source blocks and goal rounds past 1 open no entry. */
function outlineEligibleText(text: string): boolean {
  if (parseHandoffMessage(text) || parseModelSwitchMessage(text)) return false;
  const goal = parseGoalMessage(text);
  return !(goal !== null && goal.round > 1);
}

/**
 * Scan one shard's raw messages, mutating `state` in place and reporting every unit
 * boundary through `onBoundary` (with the cumulative priors AT the cut). `expandChild`
 * resolves a subagent pointer's aggregate (may hit a per-request memo); pass null to
 * skip child reads when the caller does not need subagent totals for this span.
 */
export async function scanMessages(
  state: ScanState,
  messages: readonly OmniMessage[],
  onBoundary: (ordinal: number, stats: WindowPriorStats) => void,
  expandChild: ((sessionId: string) => Promise<ChildAggregate | null>) | null,
  fromOrdinal = 0,
  toOrdinal = messages.length,
): Promise<void> {
  for (let i = fromOrdinal; i < toOrdinal; i++) {
    const msg = messages[i]!;
    // Shards never contain origin-carrying messages (core's Writer filters them);
    // defensively skip any that appear rather than mis-shaping the counts.
    if (msg.origin !== undefined && msg.origin.length > 0) continue;
    const ms = tsMs(msg.timestamp);
    const p = msg.payload as Record<string, unknown> & { type?: string; role?: string };

    // Mirrors pushMessage's first step: anything that is not a complete user image
    // closes the steering-images window (session_meta and events included).
    const isUserImage = msg.type === "model_msg" && p.type === "image_url";
    if (!isUserImage) state.steeringOpen = false;

    if (msg.type === "model_msg") {
      // Compaction-internal model messages: never rendered, never counted (stream-model
      // returns before any item/Task logic; only touchTask advances).
      if (state.compactionActive) {
        touchTask(state, ms);
        continue;
      }
      if (p.type === "text" && p.role === "user" && typeof p.text === "string") {
        const text = p.text;
        // Compaction-summary injection: no item, no Task, no run change.
        if (text.startsWith("[context_summary]") || text.startsWith("<context_summary>")) {
          touchTask(state, ms);
          continue;
        }
        // Mid-run steering: rendered as a user_steering item (not user_text) — it breaks
        // the outline's user-item run but never starts a Task or cuts a window.
        if (parseUserSteeringText(text) !== null) {
          touchTask(state, ms);
          breakRuns(state);
          state.steeringOpen = true;
          continue;
        }
        onTaskStart(state, ms, outlineEligibleText(text), (stats) => onBoundary(i, stats));
        continue;
      }
      if (p.type === "image_url") {
        // An image riding behind a steering chip folds into it: no item, no Task.
        if (state.steeringOpen) {
          touchTask(state, ms);
          continue;
        }
        onTaskStart(state, ms, true, (stats) => onBoundary(i, stats));
        continue;
      }
      if (p.type === "text" && p.role === "assistant" && typeof p.text === "string") {
        touchTask(state, ms);
        // Blank fidelity-only messages produce no item (stream-model discards them).
        if (p.text.trim() !== "") {
          state.task.sawReply = true;
          breakRuns(state);
        }
        continue;
      }
      if (p.type === "thinking") {
        touchTask(state, ms);
        if (typeof p.thinking === "string" && p.thinking.trim() !== "") breakRuns(state);
        continue;
      }
      if (p.type === "tool_call") {
        touchTask(state, ms);
        breakRuns(state);
        continue;
      }
      // tool_call_output updates an existing card (no new item); inline_* render nothing.
      touchTask(state, ms);
      continue;
    }

    if (msg.type === "event_msg") {
      touchTask(state, ms);
      const t = p.type;
      if (t === "compaction_begin") {
        state.compactionActive = true;
        breakRuns(state); // the compaction banner is an item
        continue;
      }
      if (t === "compaction_end") {
        // Closes the banner opened by the begin (no new item mid-window). A compaction the
        // user quit out of is closed as `failed` by the resume path before the session
        // appends anything else (see core's resumeSession), so a span is never left open
        // across the conversation that follows it.
        state.compactionActive = false;
        continue;
      }
      if (t === "abort") {
        breakRuns(state); // the interruption marker is an item
        continue;
      }
      if (t === "request_end") {
        if (state.compactionActive) continue; // compaction requests render nothing
        if (ms !== null) state.task.lastReqEndMs = ms;
        // Pending compaction usage commits at a later non-compaction request_end
        // (compaction mid-Task) — from then on the Task WILL show a stats row.
        if (state.task.pendingCompactionUsage) {
          state.task.sawUsage = true;
          state.task.pendingCompactionUsage = false;
        }
        const status = p.status;
        // A retryable end renders a reconnect-hint item.
        if (status === "failed" || status === "timeout" || status === "malformed") {
          breakRuns(state);
        }
        continue;
      }
      if (t === "token_usage") {
        const request = p.request as { total?: number } | undefined;
        const session = p.session as { total?: number } | undefined;
        // The session cumulative tracks the provider even during compaction
        // (task-stats trackMainUsage does the same).
        if (typeof session?.total === "number") state.totals.sessionTokens = session.total;
        if (state.compactionActive) {
          state.task.pendingCompactionUsage = true;
        } else {
          if (typeof request?.total === "number") state.totals.contextTokens = request.total;
          state.task.sawUsage = true;
        }
        continue;
      }
      if (t === "subagent" && typeof p.session_id === "string" && expandChild !== null) {
        // The pointer expands to the child's messages in the served transcript: their
        // token_usage feeds the parent's subagent totals at every depth, and their
        // timestamps advance the open Task exactly as routeNested's touchTask would.
        const agg = await expandChild(p.session_id);
        if (agg !== null) {
          state.totals.subagentTokens += agg.requestTokens;
          touchTask(state, agg.maxTsMs);
        }
        continue;
      }
      // approval_decision / request_begin / unexpanded pointers: no items, no run change.
      continue;
    }
    // session_meta: no item (steering window already closed above).
  }
}

/** Finalize the trailing open Task (end of the whole trace): the cumulative then covers every finished Task. */
export function finalizeScan(state: ScanState): void {
  finalizeTask(state);
}

// ---------------------------------------------------------------------------
// Cursor encoding
// ---------------------------------------------------------------------------

/** A window cursor: shard file index + message ordinal within that shard's parsed array. */
export interface MessageCursor {
  fileIndex: number;
  ordinal: number;
}

/**
 * `<fileIndex>:<ordinal>` — stable across requests and compaction: rotation always
 * opens a NEW shard, closed shards are immutable, and the active shard is append-only,
 * so a (shard, ordinal) pair never moves.
 */
export function encodeCursor(c: MessageCursor): string {
  return `${c.fileIndex}:${c.ordinal}`;
}

/** Strict parse of a cursor string; null when malformed (callers turn that into a 400). */
export function decodeCursor(raw: string): MessageCursor | null {
  const m = /^(\d{1,9}):(\d{1,9})$/.exec(raw);
  if (!m) return null;
  return { fileIndex: Number(m[1]), ordinal: Number(m[2]) };
}

// ---------------------------------------------------------------------------
// Cached per-shard prefix records
// ---------------------------------------------------------------------------

/**
 * The persisted shape of trace_files.page_stats: the scan state at the END of a shard
 * (cumulative from the very beginning of the session). Only immutable shards are cached
 * — the newest shard still grows. `v` gates rule evolution: a record from an older
 * CACHE_VERSION is recomputed as if absent.
 */
export interface ShardPrefixRecord {
  v: number;
  state: ScanState;
}

export function serializePrefix(state: ScanState): string {
  return JSON.stringify({ v: CACHE_VERSION, state } satisfies ShardPrefixRecord);
}

/** Parse a cached record; null when absent, unparseable, or from another CACHE_VERSION. */
export function deserializePrefix(raw: string | null): ScanState | null {
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as ShardPrefixRecord;
    if (rec.v !== CACHE_VERSION || typeof rec.state !== "object" || rec.state === null) {
      return null;
    }
    return rec.state;
  } catch {
    return null;
  }
}

/** Deep-copy a scan state (cached records must not be mutated by a later scan). */
export function cloneScanState(state: ScanState): ScanState {
  return {
    totals: { ...state.totals },
    task: { ...state.task },
    compactionActive: state.compactionActive,
    steeringOpen: state.steeringOpen,
    runOpen: state.runOpen,
  };
}
