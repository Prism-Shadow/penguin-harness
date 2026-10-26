/**
 * The runs the AMSP page replays, and the one its message chart draws, keep the protocol's promises. They are scripted by hand, so this
 * is what stops an edit (or the spec moving under them) from putting a stream on the page that no
 * server would send.
 *
 * - Given any run, it opens with `ping`, ends with `[DONE]`, its clock never runs backwards, and no
 *   record carries a `stop_reason`.
 * - Given the Session's first message, its first record is `session_meta` naming the new Session,
 *   then `task_begin`, then the echoed input; given a later message, its first record is
 *   `task_begin` and no `session_meta` comes.
 * - Given any run, `task_begin` and `task_end` enclose its records and each `request_begin` is
 *   closed by a `request_end` before the next one opens.
 * - Given a streamed message, its fragments go start → delta* → stop, and its complete record
 *   follows the stop at once, holding what the deltas carried, an interrupted message's included;
 *   the first run's answer streams as more than one delta.
 * - Given a tool call, its output completes after its call and before the next Request, and says
 *   what it is in its `status`.
 * - Given the interrupted run, the caller's abort comes while the reply streams, the reply closes
 *   with a complete text holding what had arrived, its Request ends `aborted` with no usage
 *   reported, and the `abort` record comes before `task_end`.
 */
import { describe, expect, it } from "vitest";
import { CHART_SCENARIO, recordsOf, SCENARIOS } from "../src/lib/amsp-demo";
import type { RunStep } from "../src/lib/amsp-demo";
import type { AmspRecord } from "../src/lib/amsp-protocol";

const kindOf = (record: AmspRecord) =>
  record.type === "session_meta" ? "session_meta" : record.payload.type;
/** The record kinds of a run in order, with the frames and requests beside the stream named too. */
const sequence = (steps: readonly RunStep[]) =>
  steps.map((step) =>
    step.kind === "record"
      ? kindOf(step.record)
      : step.kind === "control"
        ? `event: ${step.control.kind}`
        : step.kind === "request"
          ? `${step.request.method} ${step.request.path.split("/").at(-1)}`
          : "[DONE]",
  );
const indicesOf = (kinds: readonly string[], kind: string) =>
  kinds.flatMap((each, i) => (each === kind ? [i] : []));

describe.each([...SCENARIOS, CHART_SCENARIO].map((scenario) => [scenario.id, scenario] as const))(
  "the %s run",
  (_id, scenario) => {
    const { steps } = scenario;
    const kinds = sequence(steps);
    const records = recordsOf(steps);

    it("opens with ping, ends with [DONE], keeps time, and carries no stop_reason", () => {
      expect(kinds[0]).toBe("event: ping");
      expect(kinds.at(-1)).toBe("[DONE]");
      expect(JSON.stringify(records)).not.toContain("stop_reason");
      const times = records.map((record) => Date.parse(record.timestamp));
      expect(times.every((time, i) => i === 0 || time >= times[i - 1]!)).toBe(true);
    });

    it("starts at session_meta only on the Session's first message, then task_begin and the input", () => {
      if (scenario.continues) {
        expect(kinds).not.toContain("session_meta");
        expect(kinds.slice(1, 3)).toEqual(["task_begin", "text"]);
      } else {
        expect(kinds.slice(1, 4)).toEqual(["session_meta", "task_begin", "text"]);
        expect(records[0]).toMatchObject({
          payload: { session_id: expect.stringMatching(/^session-/) },
        });
      }
      expect(records.find((record) => kindOf(record) === "text")).toMatchObject({
        payload: { role: "user", text: scenario.input },
      });
    });

    it("keeps its records between task_begin and task_end, and its Requests paired", () => {
      const begin = kinds.indexOf("task_begin");
      const end = kinds.lastIndexOf("task_end");
      const messages = kinds.flatMap((_, i) =>
        steps[i]!.kind === "record" &&
        (steps[i] as { record: AmspRecord }).record.type === "model_msg"
          ? [i]
          : [],
      );
      expect(messages.every((i) => i > begin && i < end)).toBe(true);
      expect(end).toBe(kinds.length - 2);

      const opens = indicesOf(kinds, "request_begin");
      const closes = indicesOf(kinds, "request_end");
      expect(opens.length).toBeGreaterThan(0);
      expect(closes).toHaveLength(opens.length);
      opens.forEach((open, n) => {
        expect(closes[n]!).toBeGreaterThan(open);
        if (n + 1 < opens.length) expect(closes[n]!).toBeLessThan(opens[n + 1]!);
      });
    });

    it("streams each message as start, deltas and stop, then its complete record", () => {
      const fragments = records.flatMap((record, i) =>
        record.type === "model_msg" && "event_type" in record.payload
          ? [{ at: i, type: record.payload.type, phase: String(record.payload.event_type) }]
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
      // …and its complete record follows its stop at once.
      for (const stop of fragments.filter((fragment) => fragment.phase === "stop")) {
        expect(kindOf(records[stop.at + 1]!)).toBe(stop.type.slice("partial_".length));
      }
      // …holding its deltas joined.
      const content = (record: AmspRecord): string => {
        if (record.type !== "model_msg") return "";
        const p = record.payload;
        if ("text" in p) return p.text;
        if ("thinking" in p) return p.thinking;
        if ("arguments" in p) return p.arguments;
        return "output" in p ? p.output : "";
      };
      for (const stop of fragments.filter((fragment) => fragment.phase === "stop")) {
        const start = fragments.findLast((f) => f.phase === "start" && f.at < stop.at)!;
        const said = records.slice(start.at, stop.at).map(content).join("");
        expect(content(records[stop.at + 1]!)).toBe(said);
      }
    });

    it("completes a tool's output after its call and before the next Request, with its status", () => {
      for (const call of indicesOf(kinds, "tool_call")) {
        const output = kinds.indexOf("tool_call_output", call);
        expect(output).toBeGreaterThan(call);
        expect(steps[output]).toMatchObject({ record: { payload: { status: "completed" } } });
        const nextRequest = indicesOf(kinds, "request_begin").find((i) => i > call);
        if (nextRequest !== undefined) expect(output).toBeLessThan(nextRequest);
      }
    });

    it("closes an interrupted reply with what had arrived, ends its Request aborted, and closes the Task after the abort", () => {
      const abortAt = kinds.indexOf("abort");
      if (scenario.abortAfterMs === undefined) {
        expect(abortAt).toBe(-1);
        expect(kinds.some((kind) => kind.startsWith("POST"))).toBe(false);
        return;
      }
      const requestAt = kinds.indexOf("POST abort");
      const stopAt = kinds.lastIndexOf("partial_text");
      expect(requestAt).toBeGreaterThan(kinds.indexOf("partial_text"));
      expect(requestAt).toBeLessThan(stopAt);
      expect(steps[stopAt]).toMatchObject({ record: { payload: { event_type: "stop" } } });
      expect(kinds.slice(stopAt)).toEqual([
        "partial_text",
        "text",
        "request_end",
        "abort",
        "task_end",
        "[DONE]",
      ]);
      // The complete text holds what the fragments carried before the stop.
      const said = records
        .filter((record) => kindOf(record) === "partial_text")
        .map((record) => (record.payload as { text: string }).text)
        .join("");
      expect(steps[stopAt + 1]).toMatchObject({
        record: { payload: { type: "text", role: "assistant", text: said } },
      });
      expect(steps[stopAt + 2]).toMatchObject({ record: { payload: { status: "aborted" } } });
      expect(kinds).not.toContain("token_usage");
      expect(abortAt).toBeLessThan(kinds.indexOf("task_end"));
    });
  },
);

describe("the first run's answer", () => {
  it("streams as more than one delta, the text split mid-sentence", () => {
    const first = SCENARIOS.find((scenario) => scenario.id === "first")!;
    const pieces = recordsOf(first.steps).flatMap((record) =>
      record.type === "model_msg" &&
      record.payload.type === "partial_text" &&
      record.payload.event_type === "delta"
        ? [record.payload.text]
        : [],
    );
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces[0]).not.toMatch(/[.!?]$/);
  });
});
