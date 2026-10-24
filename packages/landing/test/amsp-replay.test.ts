/**
 * The AMSP player's panes, as functions of how many steps of a run have arrived.
 *
 * - Given fragments of a message, they open an item that grows; given its complete record, the item
 *   closes with the record's own content, whatever the fragments said.
 * - Given a tool's output that completes after its Request's `request_end`, it is shown under its
 *   call's Request, not the next one.
 * - Given a run before `[DONE]`, there is no outcome, usage or time; at `[DONE]` there are, and a new
 *   Session's run uses exactly what its Session has used.
 * - Given the Session's first message, the pane names the model; a later message names none.
 * - Given a finished run, the outcome is read from the records in the protocol's order: a
 *   `task_begin` left open is a failure, then an `abort`, then a terminal `request_end` (one to be
 *   retried is not), then a fatal final reply, else completed.
 * - Given the run's timestamps, the replay waits the recorded gap, within its bounds.
 * - Given a finished run, its spans nest longest first: each Request inside the Task, each streamed
 *   message inside its Request, except a tool's output, which ends after its Request does and before
 *   the next one opens; a message that arrives whole (the echoed input) has no span, and a run whose
 *   Task never closed has none at all.
 * - Given a record of a kind the page does not read, it still gets a row, shaded by whether the Trace
 *   stores it; frames and the caller's request never are.
 */
import { describe, expect, it } from "vitest";
import { recordsOf, SCENARIOS } from "../src/lib/amsp-demo";
import type { RunStep } from "../src/lib/amsp-demo";
import type { AmspRecord, EventPayload, TokenCounts } from "../src/lib/amsp-protocol";
import {
  FIRST_STEP_MS,
  foldRun,
  MAX_STEP_MS,
  MIN_STEP_MS,
  runOutcome,
  runSpans,
  stepDelays,
  stepLine,
} from "../src/lib/amsp-replay";

const at = (ms: number) => new Date(Date.UTC(2026, 9, 21, 9, 0, 0, ms)).toISOString();
const step = (record: AmspRecord): RunStep => ({ kind: "record", id: "e-1", record });
const text = (ms: number, phase: "start" | "delta" | "stop", piece: string): AmspRecord => ({
  timestamp: at(ms),
  type: "model_msg",
  payload: { type: "partial_text", role: "assistant", event_type: phase, text: piece },
});
const event = (payload: EventPayload): AmspRecord => ({
  timestamp: at(0),
  type: "event_msg",
  payload,
});
const reply = (stop: "completed" | "fatal"): AmspRecord => ({
  timestamp: at(0),
  type: "model_msg",
  payload: { type: "text", role: "assistant", text: "…", stop_reason: stop },
});

const run = (id: string) => SCENARIOS.find((scenario) => scenario.id === id)!.steps;
const firstRun = run("first");
const kindAt = (steps: readonly RunStep[], type: string) =>
  steps.findIndex(
    (each) =>
      each.kind === "record" &&
      (each.record.type === "session_meta" ? "session_meta" : each.record.payload.type) === type,
  );

describe("the assembled run", () => {
  it("closes a streamed message with its complete record's own content", () => {
    const steps = [
      text(0, "start", ""),
      text(10, "delta", "Hel"),
      text(20, "delta", "lo"),
      text(30, "stop", ""),
      reply("completed"),
    ].map(step);
    expect(foldRun(steps, 3).items).toEqual([
      expect.objectContaining({ kind: "text", body: "Hello", open: true }),
    ]);
    expect(foldRun(steps, 5).items).toEqual([
      expect.objectContaining({ kind: "text", body: "…", open: false }),
    ]);
  });

  it("keeps a tool's output under its call's Request when it completes after request_end", () => {
    expect(kindAt(firstRun, "tool_call_output")).toBeGreaterThan(kindAt(firstRun, "request_end"));
    const { items, requests } = foldRun(firstRun, firstRun.length);
    expect(requests.map((request) => request.index)).toEqual([1, 2]);
    expect(items.find((item) => item.kind === "tool_call")?.request).toBe(1);
    expect(items.find((item) => item.kind === "tool_call_output")?.request).toBe(1);
    expect(items.find((item) => item.kind === "text" && item.role === "assistant")?.request).toBe(
      2,
    );
  });

  it("has no outcome before [DONE], and the Session's usage once it arrives", () => {
    const done = firstRun.length - 1;
    expect(foldRun(firstRun, done)).toMatchObject({
      done: false,
      outcome: null,
      usage: null,
      elapsedMs: null,
    });
    const finished = foldRun(firstRun, done + 1);
    const lastUsage = recordsOf(firstRun).findLast(
      (record) => record.type === "event_msg" && record.payload.type === "token_usage",
    );
    const session = (lastUsage!.payload as { session: TokenCounts }).session;
    expect(finished).toMatchObject({
      done: true,
      outcome: { status: "completed" },
      usage: session,
    });
    expect(finished.elapsedMs).toBeGreaterThan(0);
    expect(finished.items.every((item) => !item.open)).toBe(true);
  });

  it("names the model only on the Session's first message", () => {
    expect(foldRun(firstRun, firstRun.length)).toMatchObject({ model: "mock/scripted-model" });
    const later = run("continue");
    expect(foldRun(later, later.length)).toMatchObject({ model: null });
  });

  it("reads the interrupted run as aborted, with no usage reported", () => {
    const interrupted = run("interrupt");
    expect(foldRun(interrupted, interrupted.length)).toMatchObject({
      outcome: { status: "aborted", closed: true, aborted: true, lastRequestEnd: "aborted" },
      usage: null,
    });
  });
});

describe("a run's outcome", () => {
  const begin = event({ type: "task_begin" });
  const end = event({ type: "task_end" });
  const completedRequest = event({ type: "request_end", status: "completed" });

  it.each([
    ["a task_begin left open", [begin, completedRequest, reply("completed")], "fatal"],
    ["an abort", [begin, event({ type: "abort", error_code: "user_abort" }), end], "aborted"],
    [
      "a terminal request_end",
      [begin, event({ type: "request_end", status: "fatal", error_code: "auth" }), end],
      "fatal",
    ],
    ["a fatal final reply", [begin, completedRequest, reply("fatal"), end], "fatal"],
    ["none of these", [begin, completedRequest, reply("completed"), end], "completed"],
  ] as const)("given %s, is %s", (_case, records, status) => {
    expect(runOutcome(records).status).toBe(status);
  });

  it("names a server failure internal, and does not end a run on a request it will retry", () => {
    expect(runOutcome([begin, completedRequest])).toMatchObject({
      status: "fatal",
      errorCode: "internal",
      closed: false,
    });
    const retried = event({ type: "request_end", status: "retryable", retry_in_ms: 2000 });
    expect(runOutcome([begin, retried, completedRequest, reply("completed"), end]).status).toBe(
      "completed",
    );
  });
});

describe("the replay's pace", () => {
  it("waits each recorded gap, held between its bounds", () => {
    const steps = [
      text(0, "start", ""),
      text(5, "delta", "a"),
      text(405, "delta", "b"),
      text(9405, "stop", ""),
    ].map(step);
    expect(stepDelays(steps)).toEqual([FIRST_STEP_MS, MIN_STEP_MS, 400, MAX_STEP_MS]);
  });
});

describe("the message structure", () => {
  it("nests the Requests in the Task and the messages in their Requests, the tool's output ending late", () => {
    const spans = runSpans(recordsOf(firstRun))!;
    const [first, second] = spans.requests;
    expect(spans.requests).toHaveLength(2);
    for (const request of spans.requests) {
      expect(request.begin).toBeGreaterThanOrEqual(spans.task.begin);
      expect(request.end).toBeLessThanOrEqual(spans.task.end);
    }
    expect(spans.messages.map((message) => message.kind)).toEqual([
      "thinking",
      "tool_call",
      "tool_call_output",
      "text",
    ]);
    const [thinking, call, output, answer] = spans.messages;
    for (const message of [thinking!, call!]) {
      expect(message.begin).toBeGreaterThan(first!.begin);
      expect(message.end).toBeLessThan(first!.end);
    }
    expect(output!.end).toBeGreaterThan(first!.end);
    expect(output!.end).toBeLessThan(second!.begin);
    expect(answer!.begin).toBeGreaterThan(second!.begin);
    expect(answer!.end).toBeLessThan(second!.end);
  });

  it("has no spans for a run whose Task never closed", () => {
    const open = [event({ type: "task_begin" }), text(10, "start", ""), reply("completed")];
    expect(runSpans(open)).toBeNull();
  });
});

describe("the stream pane", () => {
  it("lists a kind the page does not read, shading only the records the Trace stores", () => {
    const compaction = event({
      type: "compaction_begin",
      reason: "context",
      mode: "summarize",
      context: 180000,
      turns: 12,
    });
    expect(stepLine(step(compaction))).toMatchObject({ name: "compaction_begin", stored: true });
    expect(stepLine(step(compaction)).preview).toContain('"reason":"context"');
    expect(stepLine(step(text(0, "delta", "Hi")))).toMatchObject({
      phase: "delta",
      stored: false,
      preview: 'delta "Hi"',
    });
    const besides = run("interrupt").filter((each) => each.kind !== "record");
    expect(besides.map((each) => each.kind)).toEqual(["control", "request", "done"]);
    for (const frame of besides) {
      expect(stepLine(frame).stored).toBe(false);
    }
  });
});
