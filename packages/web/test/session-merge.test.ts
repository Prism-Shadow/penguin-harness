/**
 * Merging what several machines answered (lib/session-merge.ts): counts are summed across the
 * sources that answered, never zeroed by one that did not; the order is total, so equal
 * timestamps do not reshuffle between refreshes.
 */
import { describe, expect, it } from "vitest";
import { mergeCounts, newestFirst } from "../src/lib/session-merge";

describe("mergeCounts", () => {
  it("sums each category across the sources that reported", () => {
    expect(
      mergeCounts([
        { active: 2, archived: 1 },
        { active: 3, archived: 0 },
      ]),
    ).toEqual({ active: 5, archived: 1 });
  });

  it("a source that could not answer contributes nothing — and nobody counting is not zero", () => {
    expect(mergeCounts([{ active: 2 }, undefined])).toEqual({ active: 2 });
    expect(mergeCounts([undefined, undefined])).toBeUndefined();
  });
});

describe("newestFirst", () => {
  it("orders by createdAt descending, then by id, so the order is total", () => {
    const rows = [
      { sessionId: "b", createdAt: "2026-01-01T00:00:00.000Z" },
      { sessionId: "a", createdAt: "2026-01-01T00:00:00.000Z" },
      { sessionId: "c", createdAt: "2026-01-02T00:00:00.000Z" },
    ];
    expect([...rows].sort(newestFirst).map((r) => r.sessionId)).toEqual(["c", "b", "a"]);
    // The same input in another order lands the same way: equal stamps are not "stable
    // by source", they are decided.
    expect(
      [...rows]
        .reverse()
        .sort(newestFirst)
        .map((r) => r.sessionId),
    ).toEqual(["c", "b", "a"]);
  });
});
