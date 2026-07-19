/**
 * Task stats row semantics (aligned line-by-line with the CLI "stats info").
 *
 * Each Task shows one stats row on completion, covering context, Token usage, and elapsed time —
 * all as Session-level cumulative values plus this-Task deltas:
 *   - Context: `request.total` from the most recent (main session) `token_usage`; delta = this
 *     Task's ending value minus the previous Task's ending value. Can be negative (compaction
 *     drop-off / provider stripping historical thinking); not clamped to non-negative;
 *   - Token: main session's latest `session.total` plus each subagent's `request.total`,
 *     Session-level cumulative; delta = sum of `total` across this Task's parent + subagent
 *     Requests (delta and cumulative share the same basis);
 *   - Elapsed: accumulated across Tasks; delta = this Task's elapsed time (= this round's last
 *     non-compaction request_end minus the first message; see stream-model).
 * Compaction attribution depends on whether it falls **within or after this round's span**
 * (test: is there still a normal Request in this round after the compaction?):
 *   - Automatic compaction **mid-round** (engine compacts then keeps running with carry-over) →
 *     elapsed time is enclosed by the span, Token / cost count toward this round (see
 *     commitPendingCompaction) — it genuinely is time and cost spent finishing this round's work;
 *   - Compaction **after round end** (wrap-up auto-compaction / manual /compact) → falls after the
 *     round's end, elapsed time and Token both excluded from this round.
 * Neither case updates the context basis or counts toward TPS (compaction is not a user request).
 * The session's `session.total` always tracks the provider (including compaction, so nothing
 * leaks at the session level; total session cost is reconciled separately server-side from the
 * session total). The compaction banner doesn't display Token.
 *
 * The stats row on the chat page reports **this round's usage** (`tokensByBucket` + `outputTps` +
 * `elapsedDeltaMs` + this round's cost) — all six answer "how much did this round cost";
 * **current context occupancy** is not duplicated in the stats row, it's shown separately by the
 * ring below the input box (`contextNow` / context window). Output TPS = this Task's main-session
 * output tokens ÷ LLM generation seconds (`taskMainOutput / taskLlmMs`, LLM duration taken from
 * paired request event wall-clock times; see stream-model).
 *
 * Pure logic module, no React dependency; driven by stream-model.ts.
 */
import type { TokenUsagePayload } from "@prismshadow/penguin-core/omnimessage";
import { computeTps, formatTps, humanizeTokens } from "../format";

/** Token three buckets (cached input / uncached input / output). */
export interface TokenBucketCounts {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Stats tracker: Session-level cumulative counts that persist across Tasks + this-Task delta counts. */
export interface TaskStatsTracker {
  /** Current context occupancy = total from the most recent main-session request (not updated by compaction requests). */
  contextNow: number;
  /**
   * Context occupancy is stale: after a successful compaction the old value is invalid, and the
   * new value isn't known until the next normal Request's token_usage arrives. The live ring
   * draws an empty ring based on this flag (occupancy unknown) instead of falling back to the
   * pre-compaction value. Cleared as soon as the next normal Request reports in.
   */
  contextStale: boolean;
  /** Context at the last stats row produced (delta baseline). */
  contextAtLastStats: number;
  /** session.total from the main session's most recent token_usage. */
  sessionTotal: number;
  /** Session-level cumulative of subagent request.total (persists across Tasks). */
  subagentTotal: number;
  /** This Task's cumulative parent + subagent Request total (the stats row's Token delta). */
  taskTokens: number;
  /** This Task's cumulative parent + subagent Request bucketed usage (for real-time cost calc of this round). */
  taskCacheRead: number;
  taskCacheWrite: number;
  taskOutput: number;
  /** This Task's main-session Request output-token cumulative (main session only, for output TPS; consistent with the Trace page's per-round basis). */
  taskMainOutput: number;
  /** This Task's main-session LLM generation duration cumulative (ms, request_begin↔request_end wall clock; compaction requests excluded). */
  taskLlmMs: number;
  /**
   * **Pending** bucket for compaction request usage: when compaction arrives, it's not yet known
   * whether it's **mid-round** (a normal Request still follows in this round → usage belongs to
   * this round) or **after round end** (wrap-up compaction / manual /compact → usage doesn't
   * belong to this round). Held here until the next non-compaction request_end arrives (proving
   * mid-round), at which point commitPendingCompaction settles it into this round; otherwise
   * discarded by resetTaskCounters when the Task closes. Counts only toward Token / cost, not
   * toward the context basis or TPS (consistent with compaction being its own round).
   */
  pendingCompactionTokens: number;
  pendingCompactionCacheRead: number;
  pendingCompactionCacheWrite: number;
  pendingCompactionOutput: number;
  /** Whether token_usage occurred during this Task (if not, no stats row is produced). */
  hasUsage: boolean;
  /** Session total elapsed time (sum of each Task's elapsed time, ms). */
  sessionElapsedMs: number;
  /** Compaction in progress (between compaction_begin and end). */
  compactionActive: boolean;
}

export function createTaskStatsTracker(): TaskStatsTracker {
  return {
    contextNow: 0,
    contextStale: false,
    contextAtLastStats: 0,
    sessionTotal: 0,
    subagentTotal: 0,
    taskTokens: 0,
    taskCacheRead: 0,
    taskCacheWrite: 0,
    taskOutput: 0,
    taskMainOutput: 0,
    taskLlmMs: 0,
    pendingCompactionTokens: 0,
    pendingCompactionCacheRead: 0,
    pendingCompactionCacheWrite: 0,
    pendingCompactionOutput: 0,
    hasUsage: false,
    sessionElapsedMs: 0,
    compactionActive: false,
  };
}

/** This Task's bucketed accumulation (shared by main + subagent sessions; for real-time cost calc). */
function addBuckets(t: TaskStatsTracker, p: TokenUsagePayload): void {
  t.taskCacheRead += p.request.cache_read;
  t.taskCacheWrite += p.request.cache_write;
  t.taskOutput += p.request.output;
}

/** Main-session token_usage: normal requests count toward this Task; compaction requests are held pending (attribution undetermined, see pendingCompactionTokens). */
export function trackMainUsage(t: TaskStatsTracker, p: TokenUsagePayload): void {
  // The session cumulative always tracks the provider's session.total (including compaction, so
  // nothing is missed at the session level; total session cost is reconciled separately
  // server-side from the session total, unaffected by this).
  t.sessionTotal = p.session.total;
  if (t.compactionActive) {
    // Compaction usage is held pending: whether it belongs to this round depends on whether a
    // normal Request follows in this round (mid-round → belongs; after round end → doesn't).
    // Doesn't update the context basis (post-compaction occupancy comes from the next normal
    // request) or count toward TPS (compaction is not a user request).
    t.pendingCompactionTokens += p.request.total;
    t.pendingCompactionCacheRead += p.request.cache_read;
    t.pendingCompactionCacheWrite += p.request.cache_write;
    t.pendingCompactionOutput += p.request.output;
    return;
  }
  t.taskTokens += p.request.total;
  addBuckets(t, p);
  t.contextNow = p.request.total; // Current context occupancy = total from the most recent normal request
  t.contextStale = false; // New occupancy measured, ring resumes showing a real value
  t.taskMainOutput += p.request.output; // Output TPS numerator (normal requests only)
  t.hasUsage = true;
}

/**
 * Settles pending compaction usage: called by stream-model at a **non-compaction** request_end —
 * reaching this point means the preceding compaction is followed by a normal Request in this
 * round (compaction **mid-round**), so its Token / cost belongs to this round. Counted into the
 * Token and cost buckets, but **not** into TPS (taskMainOutput — compaction output is not
 * user-requested generation) or the context basis.
 */
export function commitPendingCompaction(t: TaskStatsTracker): void {
  if (t.pendingCompactionTokens === 0) return;
  t.taskTokens += t.pendingCompactionTokens;
  t.taskCacheRead += t.pendingCompactionCacheRead;
  t.taskCacheWrite += t.pendingCompactionCacheWrite;
  t.taskOutput += t.pendingCompactionOutput;
  t.hasUsage = true;
  clearPendingCompaction(t);
}

/** Discards pending compaction usage (compaction **after round end**: no further Request in this round follows, so it doesn't belong to this round). */
function clearPendingCompaction(t: TaskStatsTracker): void {
  t.pendingCompactionTokens = 0;
  t.pendingCompactionCacheRead = 0;
  t.pendingCompactionCacheWrite = 0;
  t.pendingCompactionOutput = 0;
}

/**
 * Adds one main-session LLM Request's wall-clock duration (request_begin↔request_end outer time
 * difference) to this Task's LLM duration (for output TPS); called by stream-model when pairing
 * request events, compaction requests excluded.
 */
export function addLlmDuration(t: TaskStatsTracker, ms: number): void {
  if (ms > 0) t.taskLlmMs += ms;
}

/** Subagent (with origin) token_usage: request delta counts toward this Task and the Session-level subagent cumulative. */
export function trackSubagentUsage(t: TaskStatsTracker, p: TokenUsagePayload): void {
  t.taskTokens += p.request.total;
  addBuckets(t, p);
  t.subagentTotal += p.request.total;
  t.hasUsage = true;
}

/** Enter compaction interval (see module comment). */
export function beginCompaction(t: TaskStatsTracker): void {
  t.compactionActive = true;
}

/**
 * End the compaction interval.
 *
 * On **successful** compaction, marks context occupancy stale (`contextStale`): the old context
 * has been replaced by a summary, so the pre-compaction number no longer holds, and the new
 * occupancy isn't known until the next normal Request's `token_usage` (the provider-reported
 * prompt size) arrives. Meanwhile the live ring draws an empty ring for "unknown" — it must not
 * still show "almost full" right after the user runs `/compact`, since after a manual compaction
 * the user specifically wants to see whether space was freed. On non-completed status
 * (abandoned/interrupted), the original context is retained (see core's
 * CompactionEndPayload.status) and the flag is not set.
 *
 * Note this only sets the flag, it does not clear `contextNow`: the latter also serves as
 * TaskStats' per-round history (`context` and the negative `contextDelta` for "compaction
 * drop-off"), and zeroing it would erase that record too. The two consumers need two different
 * views.
 */
export function endCompaction(t: TaskStatsTracker, status?: string): void {
  t.compactionActive = false;
  if (status === "completed") t.contextStale = true;
}

/**
 * Resets this-Task counters when a new Task starts: usage outside Task boundaries (e.g. manual
 * compaction) must not be mistakenly counted into the next Task's delta (corresponds to the
 * CLI's endCompact semantics).
 */
export function resetTaskCounters(t: TaskStatsTracker): void {
  t.taskTokens = 0;
  t.taskCacheRead = 0;
  t.taskCacheWrite = 0;
  t.taskOutput = 0;
  t.taskMainOutput = 0;
  t.taskLlmMs = 0;
  // Unsettled pending compaction usage is discarded here: the round has ended and no further
  // Request follows in this round → compaction after round end, doesn't belong to this round.
  clearPendingCompaction(t);
  t.hasUsage = false;
  t.compactionActive = false;
}

/** Structured data for one stats row (rendered by the view layer via formatTaskStats). */
export interface TaskStats {
  context: number;
  contextDelta: number;
  tokens: number;
  tokensDelta: number;
  elapsedMs: number;
  elapsedDeltaMs: number;
  /** This Task's bucketed usage (the stats row's input/cached/output, also the basis for this round's cost calc; 0 when there's no token_usage). */
  tokensByBucket: TokenBucketCounts;
  /** This Task's output TPS = main-session output tokens ÷ LLM generation seconds; null when there's no LLM timing. */
  outputTps: number | null;
}

/**
 * Task end: settles Session elapsed time and produces a stats snapshot; returns null if no
 * token_usage occurred during this Task (no stats row shown, but elapsed time still accumulates).
 * Resets this-Task counters and advances the context delta baseline after producing the snapshot.
 */
export function endTask(t: TaskStatsTracker, elapsedMs: number): TaskStats | null {
  t.sessionElapsedMs += elapsedMs;
  // Unsettled pending compaction usage is discarded at close: the round's end is fixed and no
  // further Request follows in this round → compaction after round end, doesn't belong to this round.
  clearPendingCompaction(t);
  if (!t.hasUsage) {
    t.taskTokens = 0;
    return null;
  }
  const stats: TaskStats = {
    context: t.contextNow,
    contextDelta: t.contextNow - t.contextAtLastStats,
    tokens: t.sessionTotal + t.subagentTotal,
    tokensDelta: t.taskTokens,
    elapsedMs: t.sessionElapsedMs,
    elapsedDeltaMs: elapsedMs,
    tokensByBucket: {
      cacheRead: t.taskCacheRead,
      cacheWrite: t.taskCacheWrite,
      output: t.taskOutput,
    },
    outputTps: computeTps(t.taskMainOutput, t.taskLlmMs),
  };
  t.contextAtLastStats = t.contextNow;
  t.taskTokens = 0;
  t.taskCacheRead = 0;
  t.taskCacheWrite = 0;
  t.taskOutput = 0;
  t.taskMainOutput = 0;
  t.taskLlmMs = 0;
  t.hasUsage = false;
  t.compactionActive = false;
  return stats;
}

/**
 * Stats row text (copy fallback / used when there's no body text): same basis as the stats row —
 * this round's usage "input tokens (including cached amount) · output tokens · output TPS", e.g.
 * `[统计信息] 输入 tokens 4k（已缓存 3k） · 输出 tokens 1.2k · 42.5 tok/s`; label can be overridden
 * per UI locale.
 */
export function formatTaskStats(s: TaskStats, label = "统计信息"): string {
  const b = s.tokensByBucket;
  return (
    `[${label}] 输入 tokens ${humanizeTokens(b.cacheRead + b.cacheWrite)}（已缓存 ${humanizeTokens(b.cacheRead)}）` +
    ` · 输出 tokens ${humanizeTokens(b.output)}` +
    ` · ${formatTps(s.outputTps)}`
  );
}
