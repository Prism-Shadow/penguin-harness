/**
 * work-summary.ts unit tests: the group header duration is the group's real wall-clock
 * span — earliest segment start → latest segment end — including approval waits and the
 * gaps between steps (the header answers "how long did this group take"; per-item cards
 * keep the fine-grained settled durations). Parallel work counts once by construction.
 * Items missing a start point fall back to direct accumulation on top of the span; the
 * returned startMs is the earliest start stamp of ANY item (settled or not) — the anchor
 * the header ticks from while the group is still running.
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
  it("parallel work counts once: 15-way parallel over 9 minutes reports 9 minutes", () => {
    const nine = 9 * 60_000;
    const items = Array.from({ length: 15 }, () => tool({ start: 0, durationMs: nine }));
    expect(summarizeWork(items)).toEqual({ steps: 15, durationMs: nine, startMs: 0 });
  });

  it("staggered parallel tools span first start → last end", () => {
    const items = [
      tool({ start: 0, durationMs: 60_000 }),
      tool({ start: 10_000, durationMs: 60_000 }),
      tool({ start: 20_000, durationMs: 70_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 3, durationMs: 90_000, startMs: 0 });
  });

  it("gaps between sequential steps count toward the span", () => {
    const items = [
      tool({ start: 0, durationMs: 10_000 }),
      tool({ start: 15_000, durationMs: 10_000 }),
    ];
    // [0,10s] then a 5s gap then [15s,25s]: the group took 25s of wall time.
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 25_000, startMs: 0 });
  });

  it("thinking and tools share the same axis; thinking does not count as a step", () => {
    const items = [thinking(0, 5_000), tool({ start: 5_000, durationMs: 10_000 })];
    expect(summarizeWork(items)).toEqual({ steps: 1, durationMs: 15_000, startMs: 0 });
  });

  it("approval waits are included: the span runs from the call start, not the approval", () => {
    const items = [
      // Call ready at 0, human approves at 100s, execution 100-105s.
      tool({ start: 0, approvalAt: 100_000, durationMs: 5_000 }),
      tool({ start: 102_000, durationMs: 8_000 }),
    ];
    // Span 0 → 110s: the 100s spent waiting for the human is part of how long the group took.
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 110_000, startMs: 0 });
  });

  it("argument generation anchors the start; execution end anchors the end", () => {
    const items = [
      // A: arg generation 0-10s, approval wait 10-100s, execution 100-110s (durationMs = 10s + 10s).
      tool({ argStart: 0, start: 10_000, approvalAt: 100_000, durationMs: 20_000 }),
      // B: execution 110-120s.
      tool({ start: 110_000, durationMs: 10_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 120_000, startMs: 0 });
  });

  it("items missing a start point fall back to direct accumulation; items without a duration only count as steps", () => {
    const items = [tool({ start: 0, durationMs: 10_000 }), tool({ durationMs: 7_000 }), tool()];
    expect(summarizeWork(items)).toEqual({ steps: 3, durationMs: 17_000, startMs: 0 });
  });

  it("a still-streaming first item already anchors startMs (live tick before anything settles)", () => {
    expect(summarizeWork([thinking(1_000)])).toEqual({ steps: 0, durationMs: 0, startMs: 1_000 });
  });

  it("no timestamps at all: no startMs key", () => {
    expect(summarizeWork([tool({ durationMs: 7_000 })])).toEqual({ steps: 1, durationMs: 7_000 });
  });
});
