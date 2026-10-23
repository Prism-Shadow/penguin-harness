/**
 * The runs the AMSP page replays keep the protocol's promises. They are scripted by hand, so this
 * is what stops an edit (or the spec moving under them) from putting a stream on the page that no
 * server would send.
 *
 * - Given any run, it opens with the `hello` frame that names its Session, ends with `[DONE]`, and
 *   its clock never runs backwards.
 * - Given the Session's first message, `session_meta` follows `hello`, then `task_begin`, then the
 *   echoed input; given a later message, `task_begin` follows `hello` and no `session_meta` comes.
 * - Given any run, `task_begin` and `task_end` enclose its records and each `request_begin` is
 *   closed by a `request_end` before the next one opens.
 * - Given a streamed message, its fragments go start → delta* → stop before its complete record,
 *   and a tool's output completes after its call and before the next Request.
 * - Given the interrupted run, the caller's abort comes before the reply closes as `aborted`, no
 *   usage is reported for that Request, and the `abort` record comes before `task_end`.
 */
import { describe, expect, it } from "vitest";
import { recordsOf, SCENARIOS } from "../src/lib/amsp-demo";
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

const first = SCENARIOS.find((scenario) => !scenario.continues)!;

describe.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
  "the %s run",
  (_id, scenario) => {
    const { steps } = scenario;
    const kinds = sequence(steps);
    const records = recordsOf(steps);

    it("opens with hello, ends with [DONE], and its clock never runs backwards", () => {
      expect(steps[0]).toMatchObject({
        kind: "control",
        control: { kind: "hello", agent: "demo/coder" },
      });
      expect(kinds.at(-1)).toBe("[DONE]");
      const times = records.map((record) => Date.parse(record.timestamp));
      expect(times.every((time, i) => i === 0 || time >= times[i - 1]!)).toBe(true);
    });

    it("sends session_meta only on the Session's first message, before task_begin and the input", () => {
      const opening = kinds.slice(0, 4);
      if (scenario.continues) {
        expect(kinds).not.toContain("session_meta");
        expect(opening.slice(0, 3)).toEqual(["event: hello", "task_begin", "text"]);
        const firstHello = first.steps[0]!;
        expect(steps[0]).toEqual(firstHello);
      } else {
        expect(opening).toEqual(["event: hello", "session_meta", "task_begin", "text"]);
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

    it("streams each message as start, deltas and stop before its complete record", () => {
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
      // …and its complete record follows its stop.
      for (const stop of fragments.filter((fragment) => fragment.phase === "stop")) {
        const complete = stop.type.slice("partial_".length);
        expect(
          records.findIndex((record, i) => i > stop.at && kindOf(record) === complete),
        ).toBeGreaterThan(stop.at);
      }
    });

    it("completes a tool's output after its call and before the next Request", () => {
      for (const call of indicesOf(kinds, "tool_call")) {
        const output = kinds.indexOf("tool_call_output");
        expect(output).toBeGreaterThan(call);
        const nextRequest = indicesOf(kinds, "request_begin").find((i) => i > call);
        if (nextRequest !== undefined) expect(output).toBeLessThan(nextRequest);
      }
    });

    it("ends an interrupted reply as aborted, without usage, and closes the Task after the abort", () => {
      const abortAt = kinds.indexOf("abort");
      if (scenario.abortAfterMs === undefined) {
        expect(abortAt).toBe(-1);
        expect(kinds.some((kind) => kind.startsWith("POST"))).toBe(false);
        return;
      }
      const requestAt = kinds.indexOf("POST abort");
      const replyAt = kinds.lastIndexOf("text");
      expect(requestAt).toBeGreaterThan(kinds.indexOf("partial_text"));
      expect(requestAt).toBeLessThan(replyAt);
      expect(steps[replyAt]).toMatchObject({ record: { payload: { stop_reason: "aborted" } } });
      expect(kinds.slice(replyAt)).toEqual(["text", "request_end", "abort", "task_end", "[DONE]"]);
      expect(steps[replyAt + 1]).toMatchObject({ record: { payload: { status: "aborted" } } });
      expect(kinds).not.toContain("token_usage");
      expect(abortAt).toBeLessThan(kinds.indexOf("task_end"));
    });
  },
);
