import { describe, expect, it } from "vitest";
import {
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  assistantText,
  thinkingMessage,
  toolCall,
  toolCallOutput,
} from "@prismshadow/amsp";
import {
  buildDedupIndex,
  createStreamModel,
  discardFragmentFor,
  isDuplicate,
  pushMessage,
  type ChatItem,
} from "../src/lib/amsp/stream-model";
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
  it("counts each call across fragments, complete messages, repeated delivery and history", () => {
    const id = "tool-1";
    const complete = toolCall({ name: "read_file", arguments: "{}", toolCallId: id });
    const result = toolCallOutput({ output: "contents", toolCallId: id, status: "completed" });
    const model = createStreamModel();
    for (const record of [
      partialThinking("start"),
      partialThinking("stop"),
      thinkingMessage("Review"),
      assistantText("Working"),
    ]) {
      pushMessage(model, record);
      expect(summarizeWork(model.items).steps).toBe(0);
    }
    for (const record of [
      partialToolCall({ eventType: "start", name: "", toolCallId: id }),
      partialToolCall({ eventType: "delta", name: "read_file", arguments: "{}", toolCallId: id }),
      partialToolCall({ eventType: "stop", name: "", toolCallId: id }),
      complete,
      partialToolCallOutput({ eventType: "start", toolCallId: id }),
      partialToolCallOutput({ eventType: "delta", toolCallId: id, output: "part" }),
      result,
      result,
    ]) {
      pushMessage(model, record);
      expect(summarizeWork(model.items).steps).toBe(1);
    }
    const history = createStreamModel();
    for (const record of [complete, result]) pushMessage(history, record);
    const overlap = buildDedupIndex([complete, result]);
    for (const record of [complete, result]) {
      expect(isDuplicate(overlap, record)).toBe(true);
      discardFragmentFor(history, record);
    }
    expect(summarizeWork(history.items).steps).toBe(1);
  });

  it("keeps an output-only history card outside the count until its call arrives", () => {
    const model = createStreamModel();
    const id = "tool-1";
    pushMessage(model, toolCallOutput({ output: "contents", toolCallId: id, status: "completed" }));
    expect(summarizeWork(model.items).steps).toBe(0);
    pushMessage(model, toolCall({ name: "read_file", arguments: "{}", toolCallId: id }));
    expect(summarizeWork(model.items).steps).toBe(1);
    // A later invocation may legitimately reuse the ID of a completed earlier invocation.
    pushMessage(
      model,
      toolCall({ name: "read_file", arguments: '{"file_path":"second"}', toolCallId: id }),
    );
    expect(summarizeWork(model.items).steps).toBe(2);
  });

  it("parallel work counts once: 15-way parallel over 9 minutes reports 9 minutes", () => {
    const nine = 9 * 60_000;
    const items = Array.from({ length: 15 }, () => tool({ start: 0, durationMs: nine }));
    expect(summarizeWork(items)).toEqual({ steps: 15, durationMs: nine });
  });

  it("staggered parallel tools span first start → last end", () => {
    const items = [
      tool({ start: 0, durationMs: 60_000 }),
      tool({ start: 10_000, durationMs: 60_000 }),
      tool({ start: 20_000, durationMs: 70_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 3, durationMs: 90_000 });
  });

  it("skips gaps between sequential steps", () => {
    const items = [
      tool({ start: 0, durationMs: 10_000 }),
      tool({ start: 15_000, durationMs: 10_000 }),
    ];
    // [0,10s] and [15s,25s] cover 20s of work.
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 20_000 });
  });

  it("thinking and tools share the same axis; thinking does not count as a step", () => {
    const items = [thinking(0, 5_000), tool({ start: 5_000, durationMs: 10_000 })];
    expect(summarizeWork(items)).toEqual({ steps: 1, durationMs: 15_000 });
  });

  it("excludes the approval wait and merges the overlapping executions", () => {
    const items = [
      // Call ready at 0, human approves at 100s, execution 100-105s.
      tool({ start: 0, approvalAt: 100_000, durationMs: 5_000 }),
      tool({ start: 102_000, durationMs: 8_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 10_000 });
  });

  it("argument generation anchors the start; execution end anchors the end", () => {
    const items = [
      // A: arg generation 0-10s, approval wait 10-100s, execution 100-110s (durationMs = 10s + 10s).
      tool({ argStart: 0, start: 10_000, approvalAt: 100_000, durationMs: 20_000 }),
      // B: execution 110-120s.
      tool({ start: 110_000, durationMs: 10_000 }),
    ];
    expect(summarizeWork(items)).toEqual({ steps: 2, durationMs: 30_000 });
  });

  it("uses only the observed union before the earliest active parallel interval", () => {
    const active = {
      ...tool({ start: 8000, approvalAt: 8500 }),
      decision: "allow",
      outputComplete: false,
    } as ChatItem;
    const thought = { ...thinking(9000), streaming: true } as ChatItem;
    expect(summarizeWork([thinking(1000, 1000), thinking(8000, 1200), active, thought])).toEqual({
      steps: 1,
      startMs: 7000,
    });
  });

  it("freezes completed argument generation while approval is pending", () => {
    const pending = { ...tool({ argStart: 1000, start: 2500 }), outputComplete: false };
    expect(summarizeWork([pending])).toEqual({ steps: 1, durationMs: 1500 });
  });

  it("does not time an output-only fragment, an undated thought, or a pure answer", () => {
    const model = createStreamModel();
    pushMessage(model, assistantText("Answer only"));
    pushMessage(
      model,
      toolCallOutput({ output: "orphan", toolCallId: "lost", status: "completed" }),
    );
    expect(summarizeWork([...model.items, thinking()])).toEqual({ steps: 0 });
  });
});
