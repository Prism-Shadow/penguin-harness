/**
 * Merging Sessions from several machines into one sidebar list.
 *
 * Every source answers about itself — its own rows, its own pagination — so ordering and
 * "there is more" are decided here. Both fail quietly if wrong: a mis-ordered list reads as
 * arbitrary rather than recent, and a lost hasMore hides Sessions behind a button that never
 * appears, which looks exactly like those Sessions not existing.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { mergeCounts, mergeSessionPages } from "../src/lib/session-merge";

const session = (id: string, createdAt: string): SessionInfo =>
  ({ sessionId: id, createdAt }) as SessionInfo;

describe("mergeSessionPages", () => {
  it("interleaves sources newest-first", () => {
    const merged = mergeSessionPages(
      [
        {
          machineId: null,
          items: [session("a", "2026-08-24T03:00:00Z"), session("c", "2026-08-24T01:00:00Z")],
          hasMore: false,
        },
        { machineId: "m1", items: [session("b", "2026-08-24T02:00:00Z")], hasMore: false },
      ],
      10,
    );
    expect(merged.items.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
  });

  it("says where every Session came from, so later calls can be routed", () => {
    const merged = mergeSessionPages(
      [
        { machineId: null, items: [session("a", "2026-08-24T03:00:00Z")], hasMore: false },
        { machineId: "m1", items: [session("b", "2026-08-24T02:00:00Z")], hasMore: false },
      ],
      10,
    );
    expect(merged.owners).toEqual([
      { sessionId: "a", machineId: null },
      { sessionId: "b", machineId: "m1" },
    ]);
  });

  it("keeps hasMore when ANY source had more", () => {
    // Losing it hides that machine's remaining Sessions behind a button that never renders.
    const merged = mergeSessionPages(
      [
        { machineId: null, items: [session("a", "3")], hasMore: false },
        { machineId: "m1", items: [session("b", "2")], hasMore: true },
      ],
      10,
    );
    expect(merged.hasMore).toBe(true);
  });

  it("sets hasMore when the sources TOGETHER overflow the page", () => {
    // Neither source had more of its own, but the merged page cannot show them all.
    const merged = mergeSessionPages(
      [
        { machineId: null, items: [session("a", "4"), session("c", "2")], hasMore: false },
        { machineId: "m1", items: [session("b", "3"), session("d", "1")], hasMore: false },
      ],
      3,
    );
    expect(merged.items).toHaveLength(3);
    expect(merged.hasMore).toBe(true);
    expect(merged.items.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
  });

  it("is false only when everything fits and nobody had more", () => {
    const merged = mergeSessionPages(
      [{ machineId: null, items: [session("a", "1")], hasMore: false }],
      10,
    );
    expect(merged.hasMore).toBe(false);
  });

  it("drops a duplicate id rather than showing a Session twice", () => {
    const merged = mergeSessionPages(
      [
        { machineId: null, items: [session("a", "2")], hasMore: false },
        { machineId: "m1", items: [session("a", "2")], hasMore: false },
      ],
      10,
    );
    expect(merged.items).toHaveLength(1);
    // The first source to claim it wins, so the owner does not flip between refreshes.
    expect(merged.owners).toEqual([{ sessionId: "a", machineId: null }]);
  });

  it("keeps source order among equal timestamps, so the list does not reshuffle", () => {
    const sources = [
      { machineId: null, items: [session("a", "1")], hasMore: false },
      { machineId: "m1", items: [session("b", "1")], hasMore: false },
    ];
    expect(mergeSessionPages(sources, 10).items.map((s) => s.sessionId)).toEqual(["a", "b"]);
    expect(mergeSessionPages(sources, 10).items.map((s) => s.sessionId)).toEqual(["a", "b"]);
  });

  it("handles a machine that returned nothing", () => {
    const merged = mergeSessionPages(
      [
        { machineId: null, items: [session("a", "1")], hasMore: false },
        { machineId: "m1", items: [], hasMore: false },
      ],
      10,
    );
    expect(merged.items.map((s) => s.sessionId)).toEqual(["a"]);
  });
});

describe("mergeCounts", () => {
  it("sums each machine's counts, so a badge matches the rows under it", () => {
    expect(mergeCounts([{ active: 2, archived: 1 }, { active: 3 }])).toEqual({
      active: 5,
      archived: 1,
    });
  });

  it("is undefined when no machine reported any, rather than a misleading zero", () => {
    expect(mergeCounts([undefined, undefined])).toBeUndefined();
  });

  it("ignores machines that reported none", () => {
    expect(mergeCounts([{ active: 2 }, undefined])).toEqual({ active: 2 });
  });
});
