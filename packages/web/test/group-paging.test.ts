/**
 * session-grouping.ts unit tests for the sidebar's two display windows: the PAGE of
 * groups the list shows at a time, and the count of conversations one group still hides
 * behind its "Show N more chats" row.
 *
 * The invariants worth pinning: a page number always resolves to a page that exists
 * (groups come and go under a stored page), search-free slicing never drops or repeats a
 * group across pages, and the hidden count is computed from ONE group's own numbers —
 * with the loaded rows overriding a server total that drifted above reality, so the
 * reveal row can never promise conversations that are not there.
 */
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_GROUP_PAGE_SIZE,
  clampGroupPage,
  groupPageCount,
  groupPageOf,
  groupPageSlice,
  hiddenRowCount,
} from "../src/lib/session-grouping";

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("groupPageCount", () => {
  it("gives an empty list one page, so page 1 always exists", () => {
    expect(groupPageCount(0)).toBe(1);
  });

  it("rounds up a partial last page", () => {
    expect(groupPageCount(1)).toBe(1);
    expect(groupPageCount(SIDEBAR_GROUP_PAGE_SIZE)).toBe(1);
    expect(groupPageCount(SIDEBAR_GROUP_PAGE_SIZE + 1)).toBe(2);
    expect(groupPageCount(SIDEBAR_GROUP_PAGE_SIZE * 3)).toBe(3);
  });
});

describe("clampGroupPage", () => {
  it("keeps a page that exists", () => {
    expect(clampGroupPage(2, 25)).toBe(2);
  });

  it("lands on the last real page when the groups shrank under a stored page", () => {
    expect(clampGroupPage(7, 25)).toBe(2);
    expect(clampGroupPage(7, 0)).toBe(0);
  });

  it("floors at the first page", () => {
    expect(clampGroupPage(-3, 25)).toBe(0);
  });
});

describe("groupPageSlice", () => {
  it("cuts consecutive, non-overlapping pages that cover the whole sequence", () => {
    const groups = seq(23);
    const pages = seq(groupPageCount(groups.length)).map((p) => groupPageSlice(groups, p));
    expect(pages.map((page) => page.length)).toEqual([10, 10, 3]);
    expect(pages.flat()).toEqual(groups);
  });

  it("clamps an out-of-range page to the last one rather than rendering nothing", () => {
    expect(groupPageSlice(seq(12), 9)).toEqual([10, 11]);
  });

  it("holds the order it was given (the caller has already sorted)", () => {
    expect(groupPageSlice(["b", "a", "c"], 0)).toEqual(["b", "a", "c"]);
  });
});

describe("groupPageOf", () => {
  it("maps a group's index to the page it renders on", () => {
    expect(groupPageOf(0)).toBe(0);
    expect(groupPageOf(SIDEBAR_GROUP_PAGE_SIZE - 1)).toBe(0);
    expect(groupPageOf(SIDEBAR_GROUP_PAGE_SIZE)).toBe(1);
    expect(groupPageOf(SIDEBAR_GROUP_PAGE_SIZE * 2 + 4)).toBe(2);
  });
});

describe("hiddenRowCount", () => {
  it("counts the loaded rows the display cap hides", () => {
    expect(hiddenRowCount({ shown: 10, loaded: 14, total: 14, fullyLoaded: true })).toBe(4);
  });

  it("counts unfetched rows too while the group's share is not fully loaded", () => {
    expect(hiddenRowCount({ shown: 10, loaded: 10, total: 42, fullyLoaded: false })).toBe(32);
  });

  it("drops a stale total once every Agent of the group is fetched out", () => {
    // The counts refresh only on reload: a total left above reality would otherwise keep a
    // reveal row on screen with nothing behind it.
    expect(hiddenRowCount({ shown: 12, loaded: 12, total: 42, fullyLoaded: true })).toBe(0);
  });

  it("trusts loaded rows over a total that lags behind them", () => {
    expect(hiddenRowCount({ shown: 10, loaded: 13, total: 11, fullyLoaded: false })).toBe(3);
  });

  it("never goes negative when everything is on screen", () => {
    expect(hiddenRowCount({ shown: 8, loaded: 8, total: 8, fullyLoaded: true })).toBe(0);
    expect(hiddenRowCount({ shown: 20, loaded: 8, total: 3, fullyLoaded: false })).toBe(0);
  });
});
