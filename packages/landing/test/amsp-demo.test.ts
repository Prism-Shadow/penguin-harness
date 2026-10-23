/**
 * The runs the AMSP page replays keep the protocol's promises. They are scripted by hand, so this
 * is what stops an edit (or the spec moving under them) from putting a stream on the page that no
 * server would send.
 *
 * - Given any run, it opens with the `hello` that names its Session, ends with `task_state idle`,
 *   and its clock never runs backwards.
 * - Given any run, `task_begin` and `task_end` enclose its records, and each `request_begin` is
 *   closed by a `request_end` before the next one opens.
 * - Given a streamed message, its fragments go start → delta* → stop before its complete record,
 *   and a tool's output completes after its call and before the next Request.
 * - Given the approval run, the request names the call and the caller's decision arrives before the
 *   tool starts; no other run asks.
 * - Given a run on a new Session, its context opens once, before `task_begin`; given a run that
 *   continues a Session, none opens and the Session is the one an earlier run opened.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../src/lib/amsp-demo";
import type { AmspEvent } from "../src/lib/amsp-protocol";

const kind = (event: AmspEvent) => (event.type === "session_meta" ? "" : event.payload.type);
const indexOf = (events: readonly AmspEvent[], type: string) =>
  events.findIndex((event) => kind(event) === type);
const indicesOf = (events: readonly AmspEvent[], type: string) =>
  events.flatMap((event, i) => (kind(event) === type ? [i] : []));

describe.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
  "the %s run",
  (_id, scenario) => {
    const { events } = scenario;

    it("opens with hello, ends with task_state idle, and its clock never runs backwards", () => {
      const first = events[0]!;
      expect(first.type === "server_event" && first.payload).toMatchObject({
        type: "hello",
        agent: "demo/coder",
      });
      expect(events.at(-1)).toMatchObject({
        type: "server_event",
        payload: { type: "task_state", state: "idle" },
      });
      const times = events.map((event) => Date.parse(event.timestamp));
      expect(times.every((time, i) => i === 0 || time >= times[i - 1]!)).toBe(true);
    });

    it("keeps its records between task_begin and task_end, and its Requests paired", () => {
      const begin = indexOf(events, "task_begin");
      const end = indexOf(events, "task_end");
      const records = events.flatMap((event, i) => (event.type === "model_msg" ? [i] : []));
      expect(records.every((i) => i > begin && i < end)).toBe(true);

      const opens = indicesOf(events, "request_begin");
      const closes = indicesOf(events, "request_end");
      expect(opens.length).toBeGreaterThan(0);
      expect(closes).toHaveLength(opens.length);
      opens.forEach((open, n) => {
        expect(closes[n]!).toBeGreaterThan(open);
        if (n + 1 < opens.length) expect(closes[n]!).toBeLessThan(opens[n + 1]!);
      });
      expect(end).toBeGreaterThan(closes.at(-1)!);
    });

    it("streams each message as start, deltas and stop before its complete record", () => {
      const fragments = events.flatMap((event, i) =>
        event.type === "model_msg" && "event_type" in event.payload
          ? [{ at: i, type: event.payload.type, phase: String(event.payload.event_type) }]
          : [],
      );
      // Each streamed message reads start, delta…, stop, and no other message interleaves.
      const messages = fragments
        .map((fragment) => `${fragment.type}:${fragment.phase}`)
        .join(" ")
        .split(/(?<=:stop) /);
      for (const message of messages) {
        expect(message).toMatch(/^(\w+):start( \1:delta)+ \1:stop$/);
      }
      // …and its complete record follows its stop.
      for (const stop of fragments.filter((fragment) => fragment.phase === "stop")) {
        const complete = stop.type.slice("partial_".length);
        expect(
          events.findIndex((event, i) => i > stop.at && kind(event) === complete),
        ).toBeGreaterThan(stop.at);
      }
    });

    it("completes a tool's output after its call and before the next Request", () => {
      for (const call of indicesOf(events, "tool_call")) {
        const output = indexOf(events, "tool_call_output");
        expect(output).toBeGreaterThan(call);
        const nextRequest = indicesOf(events, "request_begin").find((i) => i > call);
        if (nextRequest !== undefined) expect(output).toBeLessThan(nextRequest);
      }
    });

    it("asks for approval only when the caller has a decision to send", () => {
      const asked = indexOf(events, "approval_request");
      const decided = indexOf(events, "approval_decision");
      if (scenario.decision === undefined) {
        expect([asked, decided]).toEqual([-1, -1]);
        return;
      }
      const request = events[asked]!;
      const call = events[indexOf(events, "tool_call")]!;
      expect(request.type === "server_event" && request.payload).toMatchObject({
        toolCall: call,
      });
      expect(events[decided]).toMatchObject({ payload: { decision: scenario.decision } });
      expect(decided).toBeGreaterThan(asked);
      expect(indexOf(events, "partial_tool_call_output")).toBeGreaterThan(decided);
    });

    it("opens a context only on a new Session", () => {
      const metas = events.flatMap((event, i) => (event.type === "session_meta" ? [i] : []));
      if (scenario.continues) {
        expect(metas).toEqual([]);
        const opened = SCENARIOS.find((other) => !other.continues)!.events[0]!;
        expect(events[0]!.payload).toMatchObject({
          session_id: (opened.payload as { session_id: string }).session_id,
        });
      } else {
        expect(metas).toHaveLength(1);
        expect(metas[0]!).toBeLessThan(indexOf(events, "task_begin"));
      }
    });
  },
);
