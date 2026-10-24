/**
 * Where a Trace's thinking level changes (features/traces/trace-levels.ts), as the request rows
 * mark it.
 *
 * - The first level a file states is a change, from nothing.
 * - Requests at the same level as the one before mark nothing; a switch marks the request that
 *   went out at the new level, naming the old and the new.
 * - A file of requests with no level (written before the field) marks nothing, and a known level
 *   followed by an unknown one is not a switch.
 * - A round with two switches marks each request at its own.
 * - A change reads as the level alone where the file states its first, and as `from → to` where
 *   it switches.
 */
import { describe, expect, it } from "vitest";
import type { RequestSpan } from "@prismshadow/penguin-server/api";
import { levelChangeText, thinkingLevelChanges } from "../src/features/traces/trace-levels";

let clock = 0;
/** One request of round `taskIndex`, at `level` (undefined: none recorded). */
function req(taskIndex: number, level?: string): RequestSpan {
  clock += 1000;
  return {
    beginTs: new Date(Date.UTC(2026, 9, 22) + clock).toISOString(),
    taskIndex,
    ...(level !== undefined ? { thinkingLevel: level } : {}),
  };
}

/** The marked requests as `[index, from, to]`. */
function marked(requests: RequestSpan[]): [number, string | null, string][] {
  const { byBeginTs } = thinkingLevelChanges(requests);
  return requests.flatMap((r, i) => {
    const c = byBeginTs.get(r.beginTs);
    return c === undefined ? [] : [[i, c.from, c.to] as [number, string | null, string]];
  });
}

describe("thinking level change points", () => {
  it("marks the first level a file states, from nothing", () => {
    expect(marked([req(0, "medium"), req(0, "medium")])).toEqual([[0, null, "medium"]]);
  });

  it("marks a switch on the request that went out at the new level, and nothing between", () => {
    const requests = [req(0, "medium"), req(1, "medium"), req(2, "high"), req(2, "high")];
    expect(marked(requests)).toEqual([
      [0, null, "medium"],
      [2, "medium", "high"],
    ]);
  });

  it("marks nothing in a file written before the field, nor a step from a level to none", () => {
    expect(marked([req(0), req(1), req(2)])).toEqual([]);
    expect(marked([req(0, "high"), req(1)])).toEqual([[0, null, "high"]]);
  });

  it("a round switched twice marks each request at its own", () => {
    const requests = [req(0, "low"), req(0, "high"), req(0, "max")];
    expect(marked(requests)).toEqual([
      [0, null, "low"],
      [1, "low", "high"],
      [2, "high", "max"],
    ]);
  });
});

describe("a level change as text", () => {
  it("is the level alone where the file states its first, and from → to at a switch", () => {
    expect(levelChangeText({ from: null, to: "medium" })).toBe("medium");
    expect(levelChangeText({ from: "medium", to: "high" })).toBe("medium → high");
  });
});
