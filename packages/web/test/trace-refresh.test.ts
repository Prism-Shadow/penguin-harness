/**
 * The Trace panel's refresh rules (features/traces/trace-refresh.ts), decided by a pure tracker
 * the panel's effect applies.
 *
 * - The panel's own first render is no edge (the fetch effect already loads on mount).
 * - It re-fetches on the hidden→visible edge (not on the way back) and when a turn settles while
 *   it shows; a hidden tab fetches nothing and the re-show brings it current; a settle arriving
 *   with the re-show is one fetch; any change of the counter is a bump.
 * - The pill row orders files newest first without sorting the response in place; a re-fetch
 *   keeps the selected file (grown, or with newer files beside it), falls back to the newest
 *   when the selection vanished, and to nothing when the Session has no Trace.
 */
import { describe, expect, it } from "vitest";
import {
  activeTraceFile,
  advanceTraceRefresh,
  createTraceRefresh,
  sortTraceFiles,
} from "../src/features/traces/trace-refresh";

const obs = (active: boolean, signal: number) => ({ active, signal });

describe("advanceTraceRefresh (when the Trace panel re-fetches)", () => {
  it("treats the panel's own first render as no edge — the fetch effect already loads on mount", () => {
    const shown = createTraceRefresh(obs(true, 3));
    expect(advanceTraceRefresh(shown, obs(true, 3))).toBe(false);
    const hidden = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(hidden, obs(false, 0))).toBe(false);
  });

  it("re-fetches on the hidden→visible edge, and not on the way back", () => {
    const s = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
    // Still showing, nothing settled: renders alone must not fetch.
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 0))).toBe(false);
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
  });

  it("re-fetches when a turn settles while the panel is showing", () => {
    const s = createTraceRefresh(obs(true, 0));
    expect(advanceTraceRefresh(s, obs(true, 1))).toBe(true);
    // One bump is one fetch: re-rendering at the same count does not fetch again.
    expect(advanceTraceRefresh(s, obs(true, 1))).toBe(false);
    expect(advanceTraceRefresh(s, obs(true, 2))).toBe(true);
  });

  it("fetches nothing for a hidden tab, and the re-show is what brings it current", () => {
    const s = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(s, obs(false, 1))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 2))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 3))).toBe(false);
    // Three turns went by unread; showing the tab again re-fetches ONCE, not once per turn.
    expect(advanceTraceRefresh(s, obs(true, 3))).toBe(true);
    expect(advanceTraceRefresh(s, obs(true, 3))).toBe(false);
  });

  it("counts a turn settling in the same observation as the re-show as one fetch", () => {
    const s = createTraceRefresh(obs(false, 4));
    expect(advanceTraceRefresh(s, obs(true, 5))).toBe(true);
    expect(advanceTraceRefresh(s, obs(true, 5))).toBe(false);
  });

  it("reads any change of the counter as a bump, so a reset source cannot go unnoticed", () => {
    const s = createTraceRefresh(obs(true, 7));
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
  });
});

describe("the Trace file list across a re-fetch", () => {
  const file = (index: number, sizeBytes = 100) => ({ index, date: "2026-08-26", sizeBytes });

  it("orders the pill row newest first, without sorting the response in place", () => {
    const res = [file(1), file(3), file(2)];
    expect(sortTraceFiles(res).map((f) => f.index)).toEqual([3, 2, 1]);
    expect(res.map((f) => f.index)).toEqual([1, 3, 2]);
  });

  it("keeps the selected file when a re-fetch returns it grown, or with newer files beside it", () => {
    const before = sortTraceFiles([file(1, 200), file(2, 900)]);
    expect(activeTraceFile(before, 1)?.index).toBe(1);
    // The ordinary refresh: the SAME file, larger. The pick survives and reports the new size.
    const grown = sortTraceFiles([file(1, 4200), file(2, 900)]);
    expect(activeTraceFile(grown, 1)).toMatchObject({ index: 1, sizeBytes: 4200 });
    // A compaction shard appearing must not yank the user onto it.
    const withNew = sortTraceFiles([file(1, 4200), file(2, 900), file(3, 10)]);
    expect(activeTraceFile(withNew, 1)?.index).toBe(1);
    // Held as null it WOULD yank: the fallback is re-resolved on every re-list, so the shard
    // that just appeared becomes the selection and the view below remounts onto it. That is
    // the whole reason the panel pins a real index the first time a listing arrives — a reader
    // who never clicked a pill is otherwise the one reader a refresh is allowed to disturb.
    expect(activeTraceFile(withNew, null)?.index).toBe(3);
  });

  it("falls back to the newest file when the selection vanished, and to nothing when the Session has no Trace", () => {
    const files = sortTraceFiles([file(4), file(5)]);
    expect(activeTraceFile(files, 9)?.index).toBe(5);
    // Null reaches here only before the first listing has been shown; the panel pins the
    // default from that listing, so this fallback is what it pins TO.
    expect(activeTraceFile(files, null)?.index).toBe(5);
    expect(activeTraceFile([], null)).toBeNull();
    expect(activeTraceFile([], 2)).toBeNull();
  });
});
