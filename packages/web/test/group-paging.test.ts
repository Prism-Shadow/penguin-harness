/**
 * session-grouping.ts unit tests for the sidebar's display windows: the PAGE of groups the
 * list shows at a time, the count of conversations one group still hides behind its
 * "Show N more chats" row, and the window a single folder reveals through that same row.
 *
 * The invariants worth pinning: a page number always resolves to a page that exists
 * (groups come and go under a stored page), search-free slicing never drops or repeats a
 * group across pages, the hidden count is computed from ONE group's own numbers — with the
 * loaded rows overriding a server total that drifted above reality, so the reveal row can
 * never promise conversations that are not there — and a list (a group's active rows, or
 * one of its folders) reveals one page per click whatever a fetch returned, folding back
 * to exactly that first page and never to nothing.
 *
 * A click on a list's one reveal row ("Show N more chats"):
 * - Given the next page already in memory, it shows ten more and asks the server for nothing.
 * - Given the loaded rows run out, it shows what is loaded and asks for the next page — and
 *   never asks once every stream behind the list is exhausted.
 * - Given a fetch that came back short, the next click asks for one page past the screen,
 *   not two — and a click never lowers the cap, which a folded time bucket would feel.
 *
 * Time mode's list, whose buckets are stretches of one list rather than lists of their own:
 * - Given rows in several buckets, the window fills the newest bucket first, stops inside one
 *   bucket, does not draw the buckets past it, and the single count names every row it has
 *   not reached, loaded or not.
 * - Given a list revealed click by click to its end, every click adds ten rows across the
 *   bucket boundaries, the server is asked only when the loaded rows run out, and the count
 *   walks down to no reveal row at all.
 * - Given a folded bucket, its rows spend none of the window (the next rows come into view
 *   and the count leaves them out), and it still holds the rows it opens onto.
 * - Given a window spent exactly at a bucket boundary, the next bucket is not drawn, so a
 *   drawn folded bucket opened never comes up empty.
 * - "Show less" stands only while more than the first page is on screen.
 */
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_GROUP_PAGE_SIZE,
  SIDEBAR_PAGE_SIZE,
  clampGroupPage,
  groupPageCount,
  groupPageOf,
  groupPageSlice,
  hiddenRowCount,
  revealPlan,
  revealStep,
  sectionWindow,
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

describe("revealPlan", () => {
  it("shows one page of a folder whose share is barely fetched, with no way back yet", () => {
    // The reported bug: a fetch that returned 13 rows revealed all 13 at once and then had
    // nothing to fold them back with.
    expect(revealPlan({ cap: 10, loaded: 10, total: 28, fullyLoaded: false })).toEqual({
      shown: 10,
      hidden: 18,
      canCollapse: false,
    });
  });

  it("reveals a page at a time, keeping the rows a fetch over-returned under the cap", () => {
    expect(revealPlan({ cap: 20, loaded: 23, total: 28, fullyLoaded: false })).toEqual({
      shown: 20,
      hidden: 8,
      canCollapse: true,
    });
  });

  it("drops the reveal row and keeps the collapse once the whole share is on screen", () => {
    expect(revealPlan({ cap: 30, loaded: 28, total: 28, fullyLoaded: true })).toEqual({
      shown: 28,
      hidden: 0,
      canCollapse: true,
    });
  });

  it("shows nothing it does not hold: the cap never promises unfetched rows", () => {
    expect(revealPlan({ cap: 20, loaded: 3, total: 3, fullyLoaded: true })).toEqual({
      shown: 3,
      hidden: 0,
      canCollapse: false,
    });
  });

  it("offers no collapse on a folder that fits in its first page", () => {
    const plan = revealPlan({
      cap: SIDEBAR_PAGE_SIZE,
      loaded: SIDEBAR_PAGE_SIZE,
      total: SIDEBAR_PAGE_SIZE,
      fullyLoaded: true,
    });
    expect(plan).toEqual({ shown: SIDEBAR_PAGE_SIZE, hidden: 0, canCollapse: false });
  });

  it("reveals the eleventh row and stops, rather than everything past the page", () => {
    // A list of exactly 11: ten show, the reveal row names the single row it hides (the
    // label's singular branch), and one click lands on 11 with nothing more to reveal.
    expect(revealPlan({ cap: 10, loaded: 10, total: 11, fullyLoaded: false })).toEqual({
      shown: 10,
      hidden: 1,
      canCollapse: false,
    });
    expect(revealPlan({ cap: 20, loaded: 11, total: 11, fullyLoaded: true })).toEqual({
      shown: 11,
      hidden: 0,
      canCollapse: true,
    });
  });

  it("folds back to the first page and not to nothing", () => {
    // What "show less" leaves behind: the cap returns to one page while every fetched row
    // stays in memory, so the window is the first ten again — with the reveal row back,
    // naming the rest — rather than an emptied list.
    expect(
      revealPlan({ cap: SIDEBAR_PAGE_SIZE, loaded: 28, total: 28, fullyLoaded: true }),
    ).toEqual({ shown: SIDEBAR_PAGE_SIZE, hidden: 18, canCollapse: false });
  });

  it("drops a stale total once every contributing Agent is fetched out", () => {
    // Same clause hiddenRowCount applies: counts refresh only on reload, and a folder must
    // not keep a reveal row standing over rows that no longer exist.
    expect(revealPlan({ cap: 10, loaded: 10, total: 42, fullyLoaded: true })).toEqual({
      shown: 10,
      hidden: 0,
      canCollapse: false,
    });
  });
});

describe("revealStep", () => {
  it("shows the next page from memory without asking the server", () => {
    // A fetch fanned out over several Agents returned more than a page: the rows are there.
    expect(revealStep({ cap: 10, shown: 10, loaded: 23, canFetch: true })).toEqual({
      cap: 20,
      fetch: false,
    });
  });

  it("asks for the next server page when the loaded rows run out", () => {
    expect(revealStep({ cap: 10, shown: 10, loaded: 14, canFetch: true })).toEqual({
      cap: 20,
      fetch: true,
    });
  });

  it("never asks once every stream behind the list is exhausted", () => {
    expect(revealStep({ cap: 10, shown: 10, loaded: 14, canFetch: false })).toEqual({
      cap: 20,
      fetch: false,
    });
  });

  it("counts from the screen, so a click after a short fetch asks for one page, not two", () => {
    // The previous click raised the cap to 20, but its fetch failed and only 14 show.
    expect(revealStep({ cap: 20, shown: 14, loaded: 14, canFetch: true })).toEqual({
      cap: 24,
      fetch: true,
    });
  });

  it("never shrinks the window, so a bucket folded over its rows opens onto as many", () => {
    // Every loaded row sits in a folded time bucket: none on screen under a cap of 20. The
    // click fetches more for the open buckets below and keeps the 20 the fold opens onto.
    expect(revealStep({ cap: 20, shown: 0, loaded: 0, canFetch: true })).toEqual({
      cap: 20,
      fetch: true,
    });
  });
});

describe("sectionWindow (time mode's list)", () => {
  /** Rows labelled by bucket and position, so a window's contents read off directly. */
  const rows = (bucket: string, n: number) => seq(n).map((i) => `${bucket}${i}`);
  const open = (r: string[]) => ({ rows: r, folded: false });
  const folded = (r: string[]) => ({ rows: r, folded: true });

  it("fills the newest bucket first, stops inside one, and counts every row it has not reached", () => {
    // 43 conversations in the Project, 25 of them loaded so far.
    const w = sectionWindow({
      sections: [open(rows("d", 4)), open(rows("m", 9)), open(rows("e", 12))],
      cap: SIDEBAR_PAGE_SIZE,
      total: 43,
      fullyLoaded: false,
    });
    expect(w.rows).toEqual([rows("d", 4), rows("m", 6), null]);
    expect(w.shown).toBe(10);
    expect(w.hidden).toBe(33);
    expect(w.canCollapse).toBe(false);
  });

  it("reveals ten rows a click across the buckets, fetching only when the loaded ones run out", () => {
    // The Project's 43 conversations in display order; each fetch fans out over every Agent
    // and lands 25 more rows, the first page included.
    const all = [...rows("d", 4), ...rows("m", 9), ...rows("e", 30)];
    let loaded = 25;
    let cap = SIDEBAR_PAGE_SIZE;
    let fetches = 0;
    const view = () => {
      const d = all.slice(0, loaded);
      return sectionWindow({
        sections: [
          open(d.filter((r) => r.startsWith("d"))),
          open(d.filter((r) => r.startsWith("m"))),
          open(d.filter((r) => r.startsWith("e"))),
        ],
        cap,
        total: all.length,
        fullyLoaded: loaded === all.length,
      });
    };
    const seen: Array<[number, number]> = [[view().shown, view().hidden]];
    while (view().hidden > 0) {
      const w = view();
      const step = revealStep({
        cap,
        shown: w.shown,
        loaded: w.reachable,
        canFetch: loaded < all.length,
      });
      cap = step.cap;
      if (step.fetch) {
        fetches += 1;
        loaded = Math.min(loaded + 25, all.length);
      }
      seen.push([view().shown, view().hidden]);
    }
    expect(seen).toEqual([
      [10, 33],
      [20, 23],
      [30, 13],
      [40, 3],
      [43, 0],
    ]);
    // Only the click that ran past the first 25 rows needed the server.
    expect(fetches).toBe(1);
    expect(view().rows.flat()).toEqual(all);
    expect(view().canCollapse).toBe(true);
  });

  it("spends none of the window on a folded bucket and leaves its rows out of the count", () => {
    const w = sectionWindow({
      sections: [folded(rows("d", 14)), open(rows("m", 9)), open(rows("e", 12))],
      cap: SIDEBAR_PAGE_SIZE,
      total: 35,
      fullyLoaded: true,
    });
    // The folded bucket keeps the rows it opens onto; the next ten rows come into view below.
    expect(w.rows).toEqual([rows("d", 10), rows("m", 9), rows("e", 1)]);
    expect(w.shown).toBe(10);
    expect(w.hidden).toBe(35 - 10 - 14);
    // The reveal goes on past the fold: the folded rows are not what is left to load.
    expect(w.reachable).toBe(21);
  });

  it("does not draw the bucket after a window spent exactly at a boundary", () => {
    // Were the folded bucket drawn here, opening it would leave it a header over no rows.
    const w = sectionWindow({
      sections: [open(rows("d", 10)), folded(rows("m", 9)), open(rows("e", 12))],
      cap: SIDEBAR_PAGE_SIZE,
      total: 31,
      fullyLoaded: true,
    });
    expect(w.rows).toEqual([rows("d", 10), null, null]);
    expect(w.hidden).toBe(21);
  });

  it("offers Show less only while more than the first page is on screen", () => {
    const raised = { cap: 20, total: 30, fullyLoaded: true };
    expect(
      sectionWindow({ ...raised, sections: [open(rows("d", 15)), open(rows("m", 15))] })
        .canCollapse,
    ).toBe(true);
    // The cap is raised, but folding the first bucket left fewer than a page to fold back.
    expect(
      sectionWindow({ ...raised, sections: [folded(rows("d", 22)), open(rows("m", 8))] })
        .canCollapse,
    ).toBe(false);
  });

  it("drops a stale total once every Agent is fetched out", () => {
    const w = sectionWindow({
      sections: [open(rows("d", 4))],
      cap: SIDEBAR_PAGE_SIZE,
      total: 9,
      fullyLoaded: true,
    });
    expect(w.hidden).toBe(0);
  });
});
