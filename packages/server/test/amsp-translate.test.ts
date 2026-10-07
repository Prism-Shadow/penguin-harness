/**
 * The AMSP translator: a Session's live stream (what its channel carries) in, the events an
 * Agent API caller reads out. Pure — every case feeds channel events and reads what comes back.
 *
 * Scenarios:
 * - Given a streamed assistant text, the caller gets one text.delta per start/delta fragment and
 *   one text.done whose text equals the fragments joined.
 * - Given a partial `stop` fragment, nothing is produced for it.
 * - Given a complete message no fragment preceded, its .done still arrives (zero deltas).
 * - Given a request's token_usage, its usage is stamped on that request.done and summed into
 *   run.done, with the Session's cumulative count as session_usage.
 * - Given a retried request, request.done is retryable with retry_in_ms, the next
 *   request.started carries the next ordinal, and the run still completes.
 * - Given a request that fails for good (no retry planned), run.done is fatal with that request's
 *   error pair.
 * - Given a tool call, its fragments carry the id (and the name on the first), its done keeps the
 *   raw arguments string, and its result is attributed by tool_call_id wherever it lands.
 * - Given two tools running at once, their results interleave and each keeps its tool_call_id.
 * - Given an approval_request server event, approval.requested carries the call and its origin;
 *   the engine's decision follows as approval.decided.
 * - Given a compaction, only summary.* sits between compaction.started and compaction.done (the
 *   summary text as summary.done, the compaction's thinking left out), its usage is the sum of
 *   its attempts, and a main-Session session_meta becomes context.opened.
 * - Given a child Session's messages, they carry its origin and count their own requests without
 *   moving the main Session's ordinals.
 * - Given the run's own input on the channel, it is not echoed; a steering text and a harness
 *   injection are, as user text.done with their sender; anything published before the input is
 *   not this run's.
 * - Given an abort event, run.done is aborted with the abort's error code.
 * - Given the max-turns notice (an assistant text ending fatal, no error recorded), run.done is
 *   fatal without an error; a compaction that failed at a Task boundary does not end the run if
 *   a request follows.
 * - Given task_state re-published as running, the run goes on; idle ends it with exactly one
 *   run.done, after which nothing more is produced.
 */
import { describe, expect, it } from "vitest";
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { OmniMessage, TokenCounts } from "@prismshadow/penguin-core";
import type { AmspEvent } from "@prismshadow/amsp";
import type { ServerEvent } from "../src/api/types.js";
import { AmspTranslator } from "../src/amsp/translate.js";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const counts = (output: number, total: number): TokenCounts => ({
  cache_read: 0,
  cache_write: 0,
  output,
  total,
});

/** A translator for a run whose input is `input`, with that input already echoed (the run has started). */
function startRun(input: OmniMessage[] = [userText("go")]) {
  const translator = new AmspTranslator(input, { now: () => NOW });
  let seq = 0;
  const message = (m: OmniMessage): AmspEvent[] =>
    translator.feed({ id: `e-${++seq}`, data: JSON.stringify(m) });
  const server = (e: ServerEvent): AmspEvent[] =>
    translator.feed({ id: `e-${++seq}`, event: "server_event", data: JSON.stringify(e) });
  for (const m of input) message(m);
  return {
    translator,
    message,
    server,
    /** Feeds every message, then the idle flip; returns everything produced. */
    play: (messages: OmniMessage[]): AmspEvent[] => [
      ...messages.flatMap(message),
      ...server({ type: "task_state", state: "idle" }),
    ],
  };
}

const types = (events: AmspEvent[]): string[] => events.map((e) => e.type);
const runDone = (events: AmspEvent[]) => {
  const done = events.filter((e) => e.type === "run.done");
  expect(done).toHaveLength(1);
  return done[0] as Extract<AmspEvent, { type: "run.done" }>;
};

describe("AMSP translator", () => {
  it("a streamed assistant text reaches the caller as text.delta fragments and one text.done whose text equals the fragments joined", () => {
    const events = startRun().play([
      requestBegin(),
      partialText("start"),
      partialText("delta", "Hel"),
      partialText("delta", "lo"),
      partialText("stop"),
      assistantText("Hello"),
      requestEnd("completed"),
    ]);
    const deltas = events.filter((e) => e.type === "text.delta");
    expect(deltas.map((e) => (e as { text: string }).text)).toEqual(["", "Hel", "lo"]);
    const done = events.find((e) => e.type === "text.done") as { text: string };
    expect(done.text).toBe(deltas.map((e) => (e as { text: string }).text).join(""));
    expect(types(events)).toEqual([
      "request.started",
      "text.delta",
      "text.delta",
      "text.delta",
      "text.done",
      "request.done",
      "run.done",
    ]);
  });

  it("a partial stop fragment produces no event", () => {
    const { message } = startRun();
    expect(message(partialText("stop"))).toEqual([]);
    expect(message(partialThinking("stop"))).toEqual([]);
    expect(message(partialToolCall({ eventType: "stop", name: "", toolCallId: "c" }))).toEqual([]);
    expect(message(partialToolCallOutput({ eventType: "stop", toolCallId: "c" }))).toEqual([]);
  });

  it("a complete message without a preceding start still produces its .done (zero deltas)", () => {
    const events = startRun().play([
      requestBegin(),
      thinkingMessage("let me think"),
      assistantText("Plain."),
      requestEnd("completed"),
    ]);
    expect(types(events)).toEqual([
      "request.started",
      "thinking.done",
      "text.done",
      "request.done",
      "run.done",
    ]);
  });

  it("the usage of a request is stamped on its request.done and summed into run.done", () => {
    const events = startRun().play([
      requestBegin(),
      assistantText("one"),
      tokenUsage(counts(2, 100), counts(2, 100)),
      requestEnd("completed"),
      requestBegin(),
      assistantText("two"),
      tokenUsage(counts(5, 250), counts(3, 150)),
      requestEnd("completed"),
    ]);
    const requests = events.filter((e) => e.type === "request.done") as Array<{
      usage: TokenCounts | null;
    }>;
    expect(requests.map((r) => r.usage)).toEqual([counts(2, 100), counts(3, 150)]);
    const done = runDone(events);
    expect(done.status).toBe("completed");
    expect(done.requests).toBe(2);
    expect(done.usage).toEqual(counts(5, 250));
    expect(done.session_usage).toEqual(counts(5, 250));
  });

  it("a retried request yields request.done retryable with retry_in_ms, then a new request.started with the next ordinal", () => {
    const events = startRun().play([
      requestBegin(),
      requestEnd("retryable", {
        errorCode: "network",
        errorMessage: "fetch failed",
        attempt: 1,
        retryInMs: 1000,
      }),
      requestBegin(),
      assistantText("ok"),
      requestEnd("completed", { attempt: 2 }),
    ]);
    expect(events[1]).toMatchObject({
      type: "request.done",
      request: 1,
      status: "retryable",
      usage: null,
      error: { code: "network", message: "fetch failed" },
      attempt: 1,
      retry_in_ms: 1000,
    });
    expect(events[2]).toMatchObject({ type: "request.started", request: 2 });
    const done = runDone(events);
    expect(done.status).toBe("completed");
    expect(done.error).toBeUndefined();
    expect(done.requests).toBe(2);
  });

  it("a terminal request failure makes run.done fatal with the request's error pair", () => {
    const events = startRun().play([
      requestBegin(),
      requestEnd("fatal", { errorCode: "auth", errorMessage: "401 invalid key", attempt: 1 }),
    ]);
    const done = runDone(events);
    expect(done.status).toBe("fatal");
    expect(done.error).toEqual({ code: "auth", message: "401 invalid key" });
  });

  it("a tool call's fragments carry the id and name, and the tool result is attributed by tool_call_id", () => {
    const args = '{"command": "ls"}';
    const events = startRun().play([
      requestBegin(),
      partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "call_1" }),
      partialToolCall({ eventType: "delta", name: "", arguments: args, toolCallId: "call_1" }),
      partialToolCall({ eventType: "stop", name: "", toolCallId: "call_1" }),
      // The complete call's arguments are the engine's own serialization: forwarded as they are,
      // never rebuilt from (or checked against) the fragments.
      toolCall({ name: "exec_command", arguments: '{"command":"ls"}', toolCallId: "call_1" }),
      approvalDecision("allow", "call_1"),
      partialToolCallOutput({ eventType: "start", toolCallId: "call_1" }),
      requestEnd("completed"),
      partialToolCallOutput({ eventType: "delta", output: "a\n", toolCallId: "call_1" }),
      toolCallOutput({ output: "a\n", toolCallId: "call_1" }),
    ]);
    expect(events.filter((e) => e.type === "tool_call.delta")).toMatchObject([
      { tool_call_id: "call_1", name: "exec_command", arguments: "" },
      { tool_call_id: "call_1", name: "", arguments: args },
    ]);
    expect(events.find((e) => e.type === "tool_call.done")).toMatchObject({
      tool_call_id: "call_1",
      name: "exec_command",
      arguments: '{"command":"ls"}',
      stop_reason: "completed",
    });
    expect(
      events
        .filter((e) => e.type.startsWith("tool_result."))
        .map((e) => [e.type, (e as { tool_call_id: string }).tool_call_id]),
    ).toEqual([
      ["tool_result.delta", "call_1"],
      ["tool_result.delta", "call_1"],
      ["tool_result.done", "call_1"],
    ]);
  });

  it("parallel tool results interleave and are attributed by tool_call_id", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const events = startRun().play([
      partialToolCallOutput({ eventType: "delta", output: "a1", toolCallId: "a" }),
      partialToolCallOutput({ eventType: "delta", output: "b1", toolCallId: "b" }),
      partialToolCallOutput({ eventType: "delta", toolCallId: "b", images: [image] }),
      toolCallOutput({ output: "b1", toolCallId: "b", images: [image] }),
      partialToolCallOutput({ eventType: "delta", output: "a2", toolCallId: "a" }),
      toolCallOutput({ output: "a1a2", toolCallId: "a" }),
    ]);
    const results = events.filter((e) => e.type.startsWith("tool_result.")) as Array<{
      type: string;
      tool_call_id: string;
      output: string;
      images?: string[];
    }>;
    expect(results.map((r) => `${r.type}:${r.tool_call_id}:${r.output}`)).toEqual([
      "tool_result.delta:a:a1",
      "tool_result.delta:b:b1",
      "tool_result.delta:b:",
      "tool_result.done:b:b1",
      "tool_result.delta:a:a2",
      "tool_result.done:a:a1a2",
    ]);
    expect(results[2]!.images).toEqual([image]);
    expect(results[3]!.images).toEqual([image]);
  });

  it("an approval_request server event becomes approval.requested and the decision follows", () => {
    const { server, message } = startRun();
    const call = toolCall({ name: "write_file", arguments: '{"path":"x"}', toolCallId: "call_9" });
    expect(server({ type: "approval_request", toolCall: call, origin: ["child-1"] })).toEqual([
      {
        type: "approval.requested",
        at: NOW.toISOString(),
        origin: ["child-1"],
        tool_call: { tool_call_id: "call_9", name: "write_file", arguments: '{"path":"x"}' },
      },
    ]);
    expect(message(approvalDecision("deny", "call_9"))).toMatchObject([
      { type: "approval.decided", tool_call_id: "call_9", decision: "deny" },
    ]);
  });

  it("compaction encloses summary items, never text or thinking items, and context.opened follows the new context's session_meta", () => {
    const meta = sessionMeta({
      session_id: "s-main",
      provider: "custom",
      model_id: "m2",
      model_context_window: "unknown",
      system_prompt: "",
      agent_state: "/a",
      workspace: "/w",
      source: "api",
    });
    const events = startRun().play([
      compactionBegin({ reason: "context", mode: "summarize", context: 9000, turns: 4 }),
      partialThinking("start"),
      partialThinking("delta", "condensing"),
      thinkingMessage("condensing"),
      partialText("start"),
      partialText("delta", "Sum"),
      tokenUsage(counts(9, 900), counts(3, 300)),
      tokenUsage(counts(12, 1200), counts(3, 300)),
      compactionEnd({ reason: "context", mode: "summarize", status: "completed", attempt: 2 }),
      meta,
      requestBegin(),
      assistantText("after"),
      requestEnd("completed"),
    ]);
    const start = events.findIndex((e) => e.type === "compaction.started");
    const end = events.findIndex((e) => e.type === "compaction.done");
    expect(types(events.slice(start + 1, end))).toEqual(["summary.delta", "summary.delta"]);
    expect(events[end]).toMatchObject({ status: "completed", usage: counts(6, 600), attempt: 2 });
    expect(events[end + 1]).toMatchObject({
      type: "context.opened",
      session_id: "s-main",
      model_id: "m2",
      context_window: "unknown",
    });
    expect(events[end + 1]!.origin).toBeUndefined();
    // A summary that arrives complete (nothing streamed) is its summary.done.
    const whole = startRun().play([
      compactionBegin({ reason: "manual", mode: "summarize", context: 10, turns: 1 }),
      assistantText("The whole summary."),
      compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
    ]);
    expect(types(whole)).toEqual([
      "compaction.started",
      "summary.done",
      "compaction.done",
      "run.done",
    ]);
    expect(runDone(events).usage).toEqual(counts(6, 600));
  });

  it("a child Session's messages carry its origin and do not disturb the main Session's request numbering", () => {
    const child = "session-child-1";
    const events = startRun().play([
      requestBegin(),
      withOrigin(requestBegin(), child),
      withOrigin(assistantText("child text"), child),
      withOrigin(tokenUsage(counts(1, 50), counts(1, 50)), child),
      withOrigin(requestEnd("completed"), child),
      withOrigin(requestBegin(), child),
      withOrigin(requestEnd("completed"), child),
      tokenUsage(counts(4, 400), counts(4, 400)),
      requestEnd("completed"),
      requestBegin(),
      requestEnd("completed"),
    ]);
    const requests = events.filter((e) => e.type === "request.started") as Array<{
      request: number;
      origin?: string[];
    }>;
    expect(requests.map((r) => [r.origin?.[0] ?? "main", r.request])).toEqual([
      ["main", 1],
      [child, 1],
      [child, 2],
      ["main", 2],
    ]);
    expect(events.find((e) => e.type === "text.done")).toMatchObject({ origin: [child] });
    const done = runDone(events);
    // The child's usage is part of the run's spend; the Session's own count is the main one.
    expect(done.usage).toEqual(counts(5, 450));
    expect(done.session_usage).toEqual(counts(4, 400));
    expect(done.requests).toBe(4);
  });

  it("the run's own input is not echoed, a steering user text is (with its sender), and nothing published before the input counts", () => {
    const input = [userText("the question")];
    const translator = new AmspTranslator(input, { now: () => NOW });
    const feed = (m: OmniMessage | ServerEvent, server = false) =>
      translator.feed({
        id: "x",
        ...(server ? { event: "server_event" } : {}),
        data: JSON.stringify(m),
      });
    // Before the run's input: an idle flip a child's state change re-published, a stray output.
    expect(feed({ type: "task_state", state: "idle" }, true)).toEqual([]);
    expect(feed(assistantText("not this run's"))).toEqual([]);
    expect(feed(input[0]!)).toEqual([]);
    expect(feed(userText("[user_steering]\nfaster\n[/user_steering]"))).toMatchObject([
      { type: "text.done", role: "user", text: "[user_steering]\nfaster\n[/user_steering]" },
    ]);
    expect(feed(userText("[background_task_done]", "harness"))).toMatchObject([
      { type: "text.done", role: "user", sender: "harness" },
    ]);
    expect(feed({ type: "task_state", state: "idle" }, true)).toMatchObject([
      { type: "run.done", status: "completed" },
    ]);
  });

  it("an abort event ends the run aborted with the abort's error code", () => {
    const events = startRun().play([
      requestBegin(),
      partialText("start"),
      partialText("delta", "Let me"),
      assistantText("Let me", "aborted"),
      requestEnd("aborted", { attempt: 1 }),
      abortEvent("user_abort"),
    ]);
    const done = runDone(events);
    expect(done.status).toBe("aborted");
    expect(done.error?.code).toBe("user_abort");
    // A child's abort is the child's business.
    const child = startRun().play([withOrigin(abortEvent("user_abort"), "child")]);
    expect(runDone(child).status).toBe("completed");
  });

  it("the max-turns notice ends the run fatal without an error pair", () => {
    const events = startRun().play([
      requestBegin(),
      requestEnd("completed"),
      partialText("start"),
      partialText("delta", "[reached max turns (1); stopping]"),
      partialText("stop", "", "fatal"),
      assistantText("[reached max turns (1); stopping]", "fatal"),
    ]);
    const done = runDone(events);
    expect(done.status).toBe("fatal");
    expect(done.error).toBeUndefined();
  });

  it("a compaction that failed is the run's end only when no request follows it", () => {
    const failed = compactionEnd({
      reason: "context",
      mode: "summarize",
      status: "fatal",
      errorCode: "rejected",
      errorMessage: "400 context too long",
    });
    const begin = compactionBegin({ reason: "context", mode: "summarize", context: 1, turns: 1 });
    const ended = startRun().play([begin, failed]);
    expect(runDone(ended)).toMatchObject({
      status: "fatal",
      error: { code: "rejected", message: "400 context too long" },
    });
    const continued = startRun().play([begin, failed, requestBegin(), requestEnd("completed")]);
    expect(runDone(continued).status).toBe("completed");
  });

  it("a task_state re-published while running does not end the run; idle does, once", () => {
    const { server, message } = startRun();
    expect(server({ type: "task_state", state: "running", queued: 1 })).toEqual([]);
    expect(message(requestBegin())).toHaveLength(1);
    const end = server({ type: "task_state", state: "idle" });
    expect(types(end)).toEqual(["run.done"]);
    expect(server({ type: "task_state", state: "idle" })).toEqual([]);
    expect(message(assistantText("late"))).toEqual([]);
  });
});
