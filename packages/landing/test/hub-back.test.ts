/**
 * The back control of a hub entry's page (src/lib/hub/back.ts).
 *
 * Scenarios:
 * - Given an entry page a card opened from a filtered list, when its back control is resolved,
 *   then it steps back through history, and its link names the list with that query.
 * - Given an entry page opened from the bare list, when its back control is resolved, then it
 *   steps back through history to the bare list.
 * - Given an entry page opened by a deep link (no history state), when its back control is
 *   resolved, then it opens the list route and does not step back through history.
 * - Given an entry page whose state came from another list, or state that is not a list's, when
 *   its back control is resolved, then it does not step back: the entry behind is not its list.
 * - Given state naming its list with a query that is not text, when its back control is
 *   resolved, then it steps back, and its link names the bare list.
 */
import { describe, expect, it } from "vitest";
import { backTarget, listState } from "../src/lib/hub/back";

describe("the back control of a hub entry's page", () => {
  it("steps back to the filtered list a card was opened from, and links to it", () => {
    const state = listState({ pathname: "/plugins", search: "?q=sandbox&category=rsi" });
    expect(backTarget("/plugins", state)).toEqual({
      href: "/plugins?q=sandbox&category=rsi",
      history: true,
    });
  });

  it("steps back to the bare list when the list had no query", () => {
    const state = listState({ pathname: "/leaderboards", search: "" });
    expect(backTarget("/leaderboards", state)).toEqual({ href: "/leaderboards", history: true });
  });

  it("opens the list route from a deep link, without stepping back through history", () => {
    expect(backTarget("/benchmarks", null)).toEqual({ href: "/benchmarks", history: false });
    expect(backTarget("/benchmarks", undefined)).toEqual({ href: "/benchmarks", history: false });
  });

  it.each([
    ["another list's", listState({ pathname: "/benchmarks", search: "?q=x" })],
    ["some other", { from: "/plugins" }],
  ])("does not step back on %s state: the entry behind is not this list", (_, state) => {
    expect(backTarget("/plugins", state)).toEqual({ href: "/plugins", history: false });
  });

  it("steps back to its list but links to the bare list when the stored query is not text", () => {
    const state = { hubList: { pathname: "/plugins", search: 3 } };
    expect(backTarget("/plugins", state)).toEqual({ href: "/plugins", history: true });
  });
});
