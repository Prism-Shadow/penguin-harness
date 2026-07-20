/**
 * Unit tests for task-stats.ts: the stats-row convention matches the CLI's "统计信息"
 * output item for item.
 */
import { describe, expect, it } from "vitest";
import type { TokenUsagePayload } from "@prismshadow/penguin-core/omnimessage";
import {
  addLlmDuration,
  beginCompaction,
  commitPendingCompaction,
  createTaskStatsTracker,
  endCompaction,
  endTask,
  formatTaskStats,
  resetTaskCounters,
  trackMainUsage,
  trackSubagentUsage,
} from "../src/lib/omni/task-stats";

function usage(requestTotal: number, sessionTotal: number): TokenUsagePayload {
  return {
    type: "token_usage",
    session: { cache_read: 0, cache_write: 0, output: 0, total: sessionTotal },
    request: { cache_read: 0, cache_write: 0, output: 0, total: requestTotal },
  };
}

/** Three-bucket request (session uses its total): builds a token_usage with specific cache/output figures. */
function req(cr: number, cw: number, o: number): TokenUsagePayload {
  const total = cr + cw + o;
  return {
    type: "token_usage",
    session: { cache_read: 0, cache_write: 0, output: 0, total },
    request: { cache_read: cr, cache_write: cw, output: o, total },
  };
}

describe("TaskStatsTracker", () => {
  it("a Task without token_usage produces no stats row, but elapsed time still accumulates", () => {
    const t = createTaskStatsTracker();
    expect(endTask(t, 500)).toBeNull();
    expect(t.sessionElapsedMs).toBe(500);
  });

  it("context/Token/elapsed each report a cumulative value + delta", () => {
    const t = createTaskStatsTracker();
    trackMainUsage(t, usage(1000, 1000));
    const s1 = endTask(t, 2300);
    expect(s1).toEqual({
      context: 1000,
      contextDelta: 1000,
      tokens: 1000,
      tokensDelta: 1000,
      elapsedMs: 2300,
      elapsedDeltaMs: 2300,
      tokensByBucket: { cacheRead: 0, cacheWrite: 0, output: 0 },
      outputTps: null,
    });

    // Second Task: context can drop (may be negative, not clamped to non-negative).
    trackMainUsage(t, usage(800, 1800));
    const s2 = endTask(t, 1000);
    expect(s2).toEqual({
      context: 800,
      contextDelta: -200,
      tokens: 1800,
      tokensDelta: 800,
      elapsedMs: 3300,
      elapsedDeltaMs: 1000,
      tokensByBucket: { cacheRead: 0, cacheWrite: 0, output: 0 },
      outputTps: null,
    });
  });

  it("bucketed usage accumulates per Task (parent + child) for cost conversion; resets across Tasks", () => {
    const t = createTaskStatsTracker();
    const buckets = (cr: number, cw: number, o: number, total: number): TokenUsagePayload => ({
      type: "token_usage",
      session: { cache_read: 0, cache_write: 0, output: 0, total },
      request: { cache_read: cr, cache_write: cw, output: o, total },
    });
    trackMainUsage(t, buckets(100, 10, 5, 200));
    trackSubagentUsage(t, buckets(50, 0, 3, 60));
    const s1 = endTask(t, 100);
    expect(s1?.tokensByBucket).toEqual({ cacheRead: 150, cacheWrite: 10, output: 8 });
    // Next Task accumulates from zero.
    trackMainUsage(t, buckets(20, 2, 1, 40));
    const s2 = endTask(t, 100);
    expect(s2?.tokensByBucket).toEqual({ cacheRead: 20, cacheWrite: 2, output: 1 });
  });

  it("output TPS = this Task's main-session output ÷ LLM seconds", () => {
    const t = createTaskStatsTracker();
    // No LLM timing (no request pairing) -> TPS is null, avoiding a divide-by-zero.
    trackMainUsage(t, req(300, 100, 200));
    expect(endTask(t, 100)?.outputTps).toBeNull();
    // Output 900 tokens / 3s LLM time = 300 tok/s.
    trackMainUsage(t, req(0, 0, 900));
    addLlmDuration(t, 3000);
    expect(endTask(t, 100)?.outputTps).toBe(300);
    // Subagent output doesn't count toward the main session's TPS (matches the Trace page's
    // per-round convention): 600 / 2s = 300, excluding the subagent's 400.
    trackMainUsage(t, req(0, 0, 600));
    trackSubagentUsage(t, req(0, 0, 400));
    addLlmDuration(t, 2000);
    expect(endTask(t, 100)?.outputTps).toBe(300);
  });

  it("child-session usage counts toward the Token cumulative and delta, without affecting context", () => {
    const t = createTaskStatsTracker();
    trackMainUsage(t, usage(1000, 1000));
    trackSubagentUsage(t, usage(400, 400));
    const s = endTask(t, 100);
    expect(s?.context).toBe(1000);
    expect(s?.tokens).toBe(1400); // parent session.total + subagent cumulative
    expect(s?.tokensDelta).toBe(1400); // sum of this Task's parent + subagent request totals
    expect(t.subagentTotal).toBe(400); // persists across Tasks
  });

  it("compaction **after** the round ends (pending, never committed): Token / cost / context untouched, only the session total advances", () => {
    const t = createTaskStatsTracker();
    trackMainUsage(t, usage(1000, 1000));
    beginCompaction(t);
    trackMainUsage(t, usage(300, 1300)); // compaction request: request 300 -> stays pending first
    expect(t.contextNow).toBe(1000); // compaction doesn't update the context figure
    expect(t.sessionTotal).toBe(1300); // but the session total still tracks the provider (includes compaction; nothing leaks at the session level)
    endCompaction(t, "completed");
    // No commitPendingCompaction follows (no normal request_end for this round before closing) ->
    // compaction after the round ends is discarded when the round closes.
    expect(endTask(t, 100)?.tokensDelta).toBe(1000);
  });

  it("**mid-round** compaction (committed via commitPendingCompaction): Token / cost count toward the round, but not context / TPS", () => {
    const t = createTaskStatsTracker();
    trackMainUsage(t, req(200, 0, 100)); // own1: request 300 (cache 200 + output 100)
    beginCompaction(t);
    trackMainUsage(t, req(0, 500, 40)); // compaction request: request 540 (cache write 500 + output 40) -> pending
    expect(t.contextNow).toBe(300); // compaction doesn't update the context figure
    endCompaction(t, "completed");
    // This round still has a normal Request after compaction -> commit the pending compaction
    // usage at that request's request_end.
    commitPendingCompaction(t);
    trackMainUsage(t, req(0, 0, 200)); // own2: request 200 (output 200)
    addLlmDuration(t, 4000); // LLM wall clock for the two normal requests (compaction request excluded)
    const s = endTask(t, 100);
    expect(s?.tokensDelta).toBe(1040); // 300 + 540 (compaction) + 200
    expect(s?.tokensByBucket).toEqual({ cacheRead: 200, cacheWrite: 500, output: 340 }); // includes compaction
    // The TPS numerator only counts normal-request output (100 + 200 = 300, compaction's 40 excluded): 300 / 4s = 75 tok/s.
    expect(s?.outputTps).toBe(75);
  });

  it("successful compaction marks context usage stale (the ring draws empty instead of holding the pre-compaction value); abandoned compaction does not set it", () => {
    // The ring reads usage **live**: once compaction succeeds, the old value no longer holds,
    // and the new usage isn't measurable until the next normal Request's token_usage arrives.
    // Without this flag, right after a user runs /compact the ring would still show "nearly
    // full" — but the whole point of manual compaction is to see the space freed up. (The CLI
    // only prints the stats row at the end of each round, and the next line is guaranteed to
    // already have new token_usage, so this issue never surfaced there.)
    const t = createTaskStatsTracker();
    trackMainUsage(t, usage(120_000, 120_000));
    beginCompaction(t);
    trackMainUsage(t, usage(2_000, 122_000)); // the compaction request's own usage
    endCompaction(t, "completed");
    expect(t.contextStale).toBe(true);
    // Only sets the flag, doesn't touch contextNow: it also serves as TaskStats' per-round
    // history (context and the negative delta from "compaction dropping usage").
    expect(t.contextNow).toBe(120_000);
    // The next normal Request measures the new usage -> the flag clears, the ring shows the real number.
    trackMainUsage(t, usage(15_000, 137_000));
    expect(t.contextStale).toBe(false);
    expect(t.contextNow).toBe(15_000);

    // Compaction abandoned: the original context still holds (per core's CompactionEndPayload.status comment), so the flag isn't set.
    const t2 = createTaskStatsTracker();
    trackMainUsage(t2, usage(120_000, 120_000));
    beginCompaction(t2);
    endCompaction(t2, "aborted");
    expect(t2.contextStale).toBe(false);
    expect(t2.contextNow).toBe(120_000);
  });

  it("resetTaskCounters prevents usage outside the Task boundary from being misattributed to the next Task", () => {
    const t = createTaskStatsTracker();
    // Manual compaction (outside the Task boundary) consumes usage.
    beginCompaction(t);
    trackMainUsage(t, usage(300, 300));
    endCompaction(t);
    // Reset when the new Task starts.
    resetTaskCounters(t);
    trackMainUsage(t, usage(500, 800));
    const s = endTask(t, 100);
    expect(s?.tokensDelta).toBe(500); // excludes the compaction's 300
    expect(s?.tokens).toBe(800);
  });
});

describe("formatTaskStats", () => {
  const EN_LABELS = {
    stats: "Stats",
    input: "Input tokens",
    cached: "cached",
    output: "Output tokens",
  };
  const ZH_LABELS = {
    stats: "统计信息",
    input: "输入 tokens",
    cached: "已缓存",
    output: "输出 tokens",
  };

  it("the convention is this round's usage \"input (cached) · output · output TPS\", taking this Task's three-bucket usage + this Task's TPS", () => {
    expect(
      formatTaskStats(
        {
          context: 40000, // context usage isn't in the stats row (shown by the input-box ring instead)
          contextDelta: 1000,
          tokens: 60000,
          tokensDelta: 1200,
          elapsedMs: 5100,
          elapsedDeltaMs: 2300,
          tokensByBucket: { cacheRead: 3000, cacheWrite: 1000, output: 1200 },
          outputTps: 42.5,
        },
        EN_LABELS,
      ),
    ).toBe("[Stats] Input tokens 4k (cached 3k) · Output tokens 1.2k · 42.5 tok/s");
  });

  it("TPS shows — without LLM timing", () => {
    expect(
      formatTaskStats(
        {
          context: 500,
          contextDelta: 0,
          tokens: 500,
          tokensDelta: 500,
          elapsedMs: 900,
          elapsedDeltaMs: 900,
          tokensByBucket: { cacheRead: 500, cacheWrite: 0, output: 0 },
          outputTps: null,
        },
        EN_LABELS,
      ),
    ).toBe("[Stats] Input tokens 500 (cached 500) · Output tokens 0 · —");
  });

  it("renders with the supplied locale labels (zh)", () => {
    expect(
      formatTaskStats(
        {
          context: 40000,
          contextDelta: 1000,
          tokens: 60000,
          tokensDelta: 1200,
          elapsedMs: 5100,
          elapsedDeltaMs: 2300,
          tokensByBucket: { cacheRead: 3000, cacheWrite: 1000, output: 1200 },
          outputTps: 42.5,
        },
        ZH_LABELS,
      ),
    ).toBe("[统计信息] 输入 tokens 4k (已缓存 3k) · 输出 tokens 1.2k · 42.5 tok/s");
  });
});
