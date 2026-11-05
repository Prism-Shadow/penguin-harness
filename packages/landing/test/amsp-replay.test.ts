/**
 * The AMSP player's panes, as functions of how many steps of a run have arrived.
 *
 * - Given fragments of a message, they open an item that grows; given its complete record, the item
 *   closes with the record's own content, whatever the fragments said; an interrupted reply closes
 *   with its complete record too, holding what had arrived; a later attempt starts an item of its
 *   own.
 * - Given a tool's output that completes after its Request's `request_end`, it is shown under its
 *   call's Request, not the next one.
 * - Given a run before `[DONE]`, there is no outcome, usage or time; at `[DONE]` there are, and a new
 *   Session's run uses exactly what its Session has used.
 * - Given the Session's first message, the pane names the model; a later message names none.
 * - Given a finished run, the outcome is read from the records in the SDK's order: a `task_begin`
 *   left open (or none) is a failure, then an `abort` with its cause, then a terminal `request_end`
 *   (one past its retries; one to be retried, or one a later Request went on from, is not), else
 *   completed.
 * - Given the run's timestamps, the replay waits the recorded gap, within its bounds.
 * - Given a finished run with two tool rounds, its spans nest longest first: each Request inside the
 *   Task, its messages tiling it from `request_begin` to `request_end`, each tool's output running
 *   on from its call into the gap before the next Request; a message that arrives whole (the echoed
 *   input) has no span, and a run whose Task never closed has none at all.
 * - Given a record of a kind the page does not read, it still gets a row, shaded by whether the Trace
 *   stores it; frames and the caller's request never are.
 */
import { describe, expect, it } from "vitest";
import { CHART_SCENARIO, recordsOf, SCENARIOS } from "../src/lib/amsp-demo";
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
const reply = (said = "…"): AmspRecord => ({
  timestamp: at(0),
  type: "model_msg",
  payload: { type: "text", role: "assistant", text: said },
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
      reply(),
    ].map(step);
    expect(foldRun(steps, 3).items).toEqual([
      expect.objectContaining({ kind: "text", body: "Hello", open: true }),
    ]);
    expect(foldRun(steps, 5).items).toEqual([
      expect.objectContaining({ kind: "text", body: "…", open: false }),
    ]);
  });

  it("closes an interrupted reply with its complete record, and starts the next attempt afresh", () => {
    const interrupted = run("interrupt");
    const cut = foldRun(interrupted, interrupted.length).items.find(
      (item) => item.kind === "text" && item.role === "assistant",
    );
    expect(cut).toMatchObject({
      body: "The first mechanical clocks appeared in European monasteries around",
      open: false,
    });

    const steps = [
      text(0, "start", ""),
      text(10, "delta", "Cut"),
      text(20, "stop", ""),
      reply("Cut"),
      text(30, "start", ""),
      text(40, "delta", "Whole"),
      text(50, "stop", ""),
      reply("Whole"),
    ].map(step);
    expect(foldRun(steps, steps.length).items).toEqual([
      expect.objectContaining({ body: "Cut", open: false }),
      expect.objectContaining({ body: "Whole", open: false }),
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
      outcome: { status: "aborted", errorCode: "user_abort" },
      usage: null,
    });
  });
});

describe("a run's outcome", () => {
  const begin = event({ type: "task_begin" });
  const end = event({ type: "task_end" });
  const completedRequest = event({ type: "request_end", status: "completed" });

  const failed = event({ type: "request_end", status: "fatal", error_code: "auth" });

  it.each([
    ["a task_begin left open", [begin, completedRequest, reply()], "fatal"],
    ["no task_begin at all", [completedRequest, reply()], "fatal"],
    ["an abort", [begin, event({ type: "abort", error_code: "user_abort" }), end], "aborted"],
    ["a terminal request_end", [begin, failed, end], "fatal"],
    [
      "a request cut at the output cap past its retries",
      [
        begin,
        event({
          type: "request_end",
          status: "retryable",
          error_code: "output_truncated",
          attempt: 3,
        }),
        end,
      ],
      "retryable",
    ],
    [
      "a failure a later Request went on from",
      [begin, failed, event({ type: "request_begin" }), completedRequest, end],
      "completed",
    ],
    ["none of these", [begin, completedRequest, reply(), end], "completed"],
  ] as const)("given %s, is %s", (_case, records, status) => {
    expect(runOutcome(records).status).toBe(status);
  });

  it("gives the turn cap's abort its cause", () => {
    const capped = event({ type: "abort", error_code: "max_turns" });
    expect(runOutcome([begin, completedRequest, capped, end])).toMatchObject({
      status: "aborted",
      errorCode: "max_turns",
    });
  });

  it("names a server failure internal, and does not end a run on a request it will retry", () => {
    expect(runOutcome([begin, completedRequest])).toEqual({
      status: "fatal",
      errorCode: "internal",
    });
    const retried = event({ type: "request_end", status: "retryable", retry_in_ms: 2000 });
    expect(runOutcome([begin, retried, completedRequest, reply(), end]).status).toBe("completed");
  });
});

describe("the replay's pace", () => {
  it("waits each recorded gap, held between its bounds", () => {
    const steps = [
      text(0, "start", ""),
      text(5, "delta", "a"),
      text(705, "delta", "b"),
      text(9705, "stop", ""),
    ].map(step);
    expect(stepDelays(steps)).toEqual([FIRST_STEP_MS, MIN_STEP_MS, 700, MAX_STEP_MS]);
  });
});

describe("the message structure", () => {
  it("tiles each Request with its messages and puts each tool's output in the gap after it", () => {
    const spans = runSpans(recordsOf(CHART_SCENARIO.steps))!;
    expect(spans.requests).toHaveLength(3);
    for (const request of spans.requests) {
      expect(request.begin).toBeGreaterThanOrEqual(spans.task.begin);
      expect(request.end).toBeLessThanOrEqual(spans.task.end);
    }
    expect(spans.messages.map((message) => message.kind)).toEqual([
      "thinking",
      "tool_call",
      "tool_call_output",
      "thinking",
      "tool_call",
      "tool_call_output",
      "text",
    ]);
    const [first, second, third] = spans.requests;
    const [thinking, call1, output1, thinking2, call2, output2, answer] = spans.messages;
    // The messages tile their Request: the first from request_begin, each from the one before.
    expect(thinking!.begin).toBe(first!.begin);
    expect(call1!.begin).toBe(thinking!.end);
    expect(call1!.end).toBeLessThanOrEqual(first!.end);
    expect(thinking2!.begin).toBe(second!.begin);
    expect(call2!.begin).toBe(thinking2!.end);
    expect(call2!.end).toBeLessThanOrEqual(second!.end);
    expect(answer!.begin).toBe(third!.begin);
    expect(answer!.end).toBeLessThanOrEqual(third!.end);
    // Each output runs on from its call, past request_end, into the gap before the next Request.
    for (const [call, output, ended, next] of [
      [call1!, output1!, first!, second!],
      [call2!, output2!, second!, third!],
    ] as const) {
      expect(output.begin).toBe(call.end);
      expect(output.end).toBeGreaterThan(ended.end);
      expect(output.end).toBeLessThanOrEqual(next.begin);
    }
  });

  it("has no spans for a run whose Task never closed", () => {
    const open = [event({ type: "task_begin" }), text(10, "start", ""), reply()];
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
