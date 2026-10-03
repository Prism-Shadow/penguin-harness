/**
 * The per-run segment tally behind telemetry's turn.* samples (PRFC-0008): counts and sums per
 * segment with the slowest call kept, and the model's share measured from each top-level
 * request_begin to its request_end — a subagent's requests (origin set) are its own run's.
 */
import { describe, expect, it } from "vitest";
import { assistantText, requestBegin, requestEnd } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { TurnTally } from "../src/telemetry/turn.js";

/** A clock the test moves by hand. */
function manualClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("TurnTally", () => {
  it("sums each segment, keeps its slowest call, and counts the messages", async () => {
    const clock = manualClock();
    const tally = new TurnTally(clock.now);
    expect(() =>
      tally.time("errors", () => {
        clock.advance(0);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    for (const ms of [2, 5, 1]) {
      tally.message(assistantText("x"));
      tally.time("fanout", () => clock.advance(ms));
      tally.time("tail", () => clock.advance(1));
      await tally.timeAsync("usage", async () => clock.advance(3));
    }
    const samples = tally.samples("ok");
    const byProbe = new Map(samples.map((s) => [s.probe, s]));
    expect([...byProbe.keys()]).toEqual([
      "turn.run",
      "turn.tail",
      "turn.fanout",
      "turn.errors",
      "turn.usage",
    ]);
    expect(byProbe.get("turn.fanout")).toMatchObject({ durMs: 8, n: 3, attrs: { maxMs: 5 } });
    expect(byProbe.get("turn.tail")).toMatchObject({ durMs: 3, n: 3, attrs: { maxMs: 1 } });
    expect(byProbe.get("turn.usage")).toMatchObject({ durMs: 9, n: 3, attrs: { maxMs: 3 } });
    // A segment whose work threw still counts, and rethrows.
    expect(byProbe.get("turn.errors")).toMatchObject({ durMs: 0, n: 1 });
    expect(byProbe.get("turn.run")).toMatchObject({
      durMs: 20,
      n: 3,
      status: "ok",
      attrs: { modelMs: 0, requests: 0, serverMs: 20 },
    });
  });

  it("measures the model from each top-level request_begin to its request_end, an open one up to the end", () => {
    const clock = manualClock();
    const tally = new TurnTally(clock.now);
    clock.advance(4); // before the first request: server and core time
    tally.message(requestBegin());
    clock.advance(100);
    // A subagent's request on the same stream does not open or close the parent's window.
    tally.message({ ...requestEnd("completed"), origin: ["child"] } as OmniMessage);
    clock.advance(20);
    tally.message(requestEnd("completed"));
    clock.advance(30); // a tool call between the two requests
    tally.message(requestBegin());
    clock.advance(50); // aborted: the stream ends with the request open
    const run = tally.samples("error").find((s) => s.probe === "turn.run")!;
    expect(run).toMatchObject({
      durMs: 204,
      n: 4,
      status: "error",
      attrs: { modelMs: 170, requests: 2 },
    });
  });
});
