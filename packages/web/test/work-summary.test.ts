/**
 * work-summary.ts unit tests (issue #76): group header duration is computed as the union
 * of time intervals — overlapping time from parallel tools counts once; sequential calls
 * accumulate as usual (gaps don't count); approval waits are excluded per the durationMs
 * convention; the argument-generation segment and execution segment are separate intervals
 * (generation is not shifted into the execution period); items missing a start point fall
 * back to direct accumulation.
 */
import { describe, expect, it } from "vitest";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { summarizeWork } from "../src/features/chat/work-summary";

let nextId = 1;

const thinking = (startedAtMs?: number, durationMs?: number): ChatItem => ({
  kind: "thinking",
  id: nextId++,
  thinking: "",
  streaming: false,
  ...(startedAtMs !== undefined ? { startedAtMs } : {}),
  ...(durationMs !== undefined ? { durationMs } : {}),
});

const tool = (
  o: { argStart?: number; start?: number; approvalAt?: number; durationMs?: number } = {},
): ChatItem => ({
  kind: "tool_call",
  id: nextId++,
  toolCallId: `call_${nextId}`,
  name: "run_subagent",
  argumentsText: "{}",
  callStreaming: false,
  callComplete: true,
  output: "",
  outputStreaming: false,
  outputComplete: true,
  ...(o.argStart !== undefined ? { argStartedAtMs: o.argStart } : {}),
  ...(o.start !== undefined ? { callStartedAtMs: o.start } : {}),
  ...(o.approvalAt !== undefined ? { approvalAtMs: o.approvalAt } : {}),
  ...(o.durationMs !== undefined ? { durationMs: o.durationMs } : {}),
});

describe("summarizeWork", () => {
  it("overlapping time of parallel tools counts once (15-way parallel for 9 minutes no longer reports 99 minutes)", () => {
    const nine = 9 * 60_000;
    const items = Array.from({ length: 15 }, () => tool({ start: 0, durationMs: nine }));
    expect(summarizeWork(items)).toEqual({ steps: 15, durationMs: nine });
  });

  it("partial overlaps merge as a union", () => {
    const items = [
      tool({ start: 0, durationMs: 60_000 }),
      tool({ start: 10_000, durationMs: 60_000 }),
      tool({ start: 20_000, durationMs: 70_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 3, durationMs: 90_000 });
  });

  it("sequential calls accumulate as usual; gaps do not count", () => {
    const items = [
      tool({ start: 0, durationMs: 10_000 }),
      tool({ start: 15_000, durationMs: 10_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 20_000 });
  });

  it("thinking and tools merge on the same axis; thinking does not count as a step", () => {
    const items = [thinking(0, 5_000), tool({ start: 5_000, durationMs: 10_000 })];
    expect(summarizeWork(items)).toEqual({ steps: 1, durationMs: 15_000 });
  });

  it("approval waits excluded: intervals start at approvalAtMs", () => {
    const items = [
      tool({ start: 0, approvalAt: 100_000, durationMs: 5_000 }),
      tool({ start: 102_000, durationMs: 8_000 }),
    ];
    // [100s,105s] ∪ [102s,110s] = 10s; starting from callStartedAtMs by mistake would include the 100s approval wait.
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 10_000 });
  });

  it("argument-generation and execution are separate intervals: generation is not shifted into the execution period", () => {
    const items = [
      // A: arg generation 0-10s, approval wait 10-100s, execution 100-110s (durationMs = 10s generation + 10s execution).
      tool({ argStart: 0, start: 10_000, approvalAt: 100_000, durationMs: 20_000 }),
      // B: execution 110-120s. If A were computed entirely from its execution start ([100s,120s]), it would fully overlap with B, leaving only 20s.
      tool({ start: 110_000, durationMs: 10_000 }),
    ];
    // Correct union: [0,10s] ∪ [100s,120s] = 30s.
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 30_000 });
  });

  it("items missing a start point fall back to direct accumulation; items without a duration only count as steps", () => {
    const items = [tool({ start: 0, durationMs: 10_000 }), tool({ durationMs: 7_000 }), tool()];
    expect(summarizeWork(items)).toEqual({ steps: 3, durationMs: 17_000 });
  });
});
