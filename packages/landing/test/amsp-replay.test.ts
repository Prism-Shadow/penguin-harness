/**
 * The AMSP player's panes, as functions of how many events have arrived.
 *
 * - Given fragments of a message, they open an item that grows; given its complete record, the item
 *   closes with the record's own content, whatever the fragments said.
 * - Given a tool's output that completes after its Request's `request_end`, it is shown under its
 *   call's Request, not the next one.
 * - Given a run before its `task_end`, there is no status, usage or time; given `task_end`, there
 *   are, and a new Session's run uses exactly what its Session has used.
 * - Given an approval request, the call shows as waiting until the decision arrives.
 * - Given the run's timestamps, the replay waits the recorded gap, within its bounds.
 * - Given an event of a kind the page does not read, or does not know, it still gets a row, shaded
 *   by whether the Trace stores it.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../src/lib/amsp-demo";
import type { AmspEvent, TokenCounts } from "../src/lib/amsp-protocol";
import {
  eventLine,
  FIRST_STEP_MS,
  foldEvents,
  MAX_STEP_MS,
  MIN_STEP_MS,
  stepDelays,
} from "../src/lib/amsp-replay";

const at = (ms: number) => new Date(Date.UTC(2026, 9, 21, 9, 0, 0, ms)).toISOString();
const text = (ms: number, phase: "start" | "delta" | "stop", piece: string): AmspEvent => ({
  timestamp: at(ms),
  type: "model_msg",
  payload: { type: "partial_text", role: "assistant", event_type: phase, text: piece },
});

const toolRun = SCENARIOS.find((scenario) => scenario.id === "tool")!.events;
const approvalRun = SCENARIOS.find((scenario) => scenario.id === "approval")!.events;
const kindAt = (events: readonly AmspEvent[], type: string) =>
  events.findIndex((event) => event.type !== "session_meta" && event.payload.type === type);

describe("the assembled run", () => {
  it("closes a streamed message with its complete record's own content", () => {
    const events: AmspEvent[] = [
      text(0, "start", ""),
      text(10, "delta", "Hel"),
      text(20, "delta", "lo"),
      text(30, "stop", ""),
      {
        timestamp: at(31),
        type: "model_msg",
        payload: { type: "text", role: "assistant", text: "Hello!", stop_reason: "completed" },
      },
    ];
    expect(foldEvents(events, 3).items).toEqual([
      expect.objectContaining({ kind: "text", body: "Hello", open: true }),
    ]);
    expect(foldEvents(events, 5).items).toEqual([
      expect.objectContaining({ kind: "text", body: "Hello!", open: false }),
    ]);
  });

  it("keeps a tool's output under its call's Request when it completes after request_end", () => {
    const outputAt = kindAt(toolRun, "tool_call_output");
    const firstEnd = kindAt(toolRun, "request_end");
    expect(outputAt).toBeGreaterThan(firstEnd);
    const { items, requests } = foldEvents(toolRun, toolRun.length);
    expect(requests.map((request) => request.index)).toEqual([1, 2]);
    expect(items.find((item) => item.kind === "tool_call")?.request).toBe(1);
    expect(items.find((item) => item.kind === "tool_call_output")?.request).toBe(1);
    expect(items.find((item) => item.kind === "text" && item.role === "assistant")?.request).toBe(
      2,
    );
  });

  it("has no outcome before task_end, and the Session's usage once it arrives", () => {
    const end = kindAt(toolRun, "task_end");
    expect(foldEvents(toolRun, end)).toMatchObject({
      done: false,
      status: null,
      usage: null,
      elapsedMs: null,
    });
    const finished = foldEvents(toolRun, end + 1);
    const lastUsage = toolRun.findLast(
      (event) => event.type === "event_msg" && event.payload.type === "token_usage",
    );
    const session = (lastUsage!.payload as { session: TokenCounts }).session;
    expect(finished).toMatchObject({ done: true, status: "completed", usage: session });
    expect(finished.elapsedMs).toBeGreaterThan(0);
    expect(finished.items.every((item) => !item.open)).toBe(true);
  });

  it("shows a call waiting for approval until the decision arrives", () => {
    const call = (count: number) =>
      foldEvents(approvalRun, count).items.find((item) => item.kind === "tool_call");
    const asked = kindAt(approvalRun, "approval_request");
    const decided = kindAt(approvalRun, "approval_decision");
    expect(call(asked)?.approval).toBeUndefined();
    expect(call(asked + 1)?.approval).toBe("waiting");
    expect(call(decided)?.approval).toBe("waiting");
    expect(call(decided + 1)?.approval).toBe("allow");
  });
});

describe("the replay's pace", () => {
  it("waits each recorded gap, held between its bounds", () => {
    const events = [
      text(0, "start", ""),
      text(5, "delta", "a"),
      text(405, "delta", "b"),
      text(9405, "stop", ""),
    ];
    expect(stepDelays(events)).toEqual([FIRST_STEP_MS, MIN_STEP_MS, 400, MAX_STEP_MS]);
  });
});

describe("the events pane", () => {
  it("lists a kind the page does not read, and one it does not know, shaded by the Trace", () => {
    const compaction: AmspEvent = {
      timestamp: at(0),
      type: "event_msg",
      payload: {
        type: "compaction_begin",
        reason: "context",
        mode: "summarize",
        context: 180000,
        turns: 12,
      },
    };
    expect(eventLine(compaction)).toMatchObject({ kind: "compaction_begin", stored: true });
    expect(eventLine(compaction).preview).toContain('"reason":"context"');

    // A server extension: carried as-is, never stored.
    const extension = {
      timestamp: at(0),
      type: "server_event",
      payload: { type: "org_run", runId: "r1" },
    } as unknown as AmspEvent;
    expect(eventLine(extension)).toMatchObject({ kind: "org_run", stored: false });
    expect(eventLine(extension).preview).toContain('"runId":"r1"');

    expect(eventLine(text(0, "delta", "Hi"))).toMatchObject({
      phase: "delta",
      stored: false,
      preview: 'delta "Hi"',
    });
  });
});
