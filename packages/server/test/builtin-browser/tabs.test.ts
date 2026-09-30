/**
 * The tab registry: the shell's reflection, the active tab's fallback rule, the refresh after a
 * handshake, and open requests — the first claim wins, a second window's is a duplicate.
 */
import { describe, expect, it } from "vitest";
import { TabRegistry } from "../../src/builtin-browser/tabs.js";
import { tab } from "./fake-shell.js";

describe("TabRegistry tabs", () => {
  it("keeps tabs in creation order and reports each one's previous state", () => {
    const tabs = new TabRegistry();
    expect(tabs.upsert(tab(3))).toBeUndefined();
    tabs.upsert(tab(1));
    expect(tabs.upsert(tab(3, { title: "Renamed" }))).toEqual(tab(3));
    expect(tabs.ids()).toEqual([3, 1]);
    expect(tabs.get(3)?.title).toBe("Renamed");
  });

  it("falls back to the newest tab until one is used or focused", () => {
    const tabs = new TabRegistry();
    expect(tabs.activeTabId).toBeNull();
    tabs.upsert(tab(1));
    tabs.upsert(tab(2));
    expect(tabs.activeTabId).toBe(2);
    expect(tabs.activate(1)).toBe(true);
    expect(tabs.activate(1)).toBe(false);
    tabs.upsert(tab(3));
    expect(tabs.activeTabId).toBe(1);
    tabs.remove(1);
    expect(tabs.activeTabId).toBe(3);
    tabs.remove(3);
    tabs.remove(2);
    expect(tabs.activeTabId).toBeNull();
  });

  it("activates a tab the shell has not reported yet once it is", () => {
    const tabs = new TabRegistry();
    tabs.upsert(tab(1));
    tabs.upsert(tab(2));
    tabs.activate(1);
    expect(tabs.activate(9)).toBe(false);
    expect(tabs.activeTabId).toBe(1);
    tabs.upsert(tab(9));
    expect(tabs.activeTabId).toBe(9);
  });

  it("replaces its list with the shell's, keeping first-seen order and the active tab", () => {
    const tabs = new TabRegistry();
    tabs.upsert(tab(1));
    tabs.upsert(tab(2));
    tabs.upsert(tab(3));
    tabs.activate(2);
    expect(tabs.replaceAll([tab(4), tab(2, { title: "New" }), tab(1)])).toBe(true);
    expect(tabs.ids()).toEqual([1, 2, 4]);
    expect(tabs.activeTabId).toBe(2);
    expect(tabs.replaceAll([tab(4), tab(2, { title: "New" }), tab(1)])).toBe(false);
    tabs.replaceAll([tab(4)]);
    expect(tabs.activeTabId).toBe(4);
  });

  it("settles close waiters when the tab goes, by event or by refresh", async () => {
    const tabs = new TabRegistry();
    tabs.upsert(tab(1));
    tabs.upsert(tab(2));
    const first = tabs.waitForClose(1, 1_000);
    const second = tabs.waitForClose(2, 1_000);
    tabs.remove(1);
    tabs.replaceAll([]);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(tabs.waitForClose(7, 1_000)).resolves.toBe(true);
    tabs.upsert(tab(3));
    await expect(tabs.waitForClose(3, 20)).resolves.toBe(false);
    tabs.dispose();
  });
});

describe("TabRegistry first pages", () => {
  it("waits for a new tab's first page to commit, or its first load to end without one", async () => {
    const tabs = new TabRegistry();
    // Claimed before the shell reported it at all, then reported on its initial empty document.
    const committed = tabs.waitForFirstPage(1, 1_000);
    tabs.upsert(tab(1, { url: "", title: "", loading: true }));
    tabs.upsert(tab(1, { url: "https://a.test/", loading: true }));
    await expect(committed).resolves.toBe(true);
    // A first load that stopped without committing anything.
    tabs.upsert(tab(2, { url: "", title: "", loading: true }));
    const stopped = tabs.waitForFirstPage(2, 1_000);
    tabs.upsert(tab(2, { url: "", title: "", loading: false }));
    await expect(stopped).resolves.toBe(true);
    // Already past it: at once.
    await expect(tabs.waitForFirstPage(1, 1_000)).resolves.toBe(true);
    tabs.dispose();
  });

  it("ends the wait when the tab closes or crashes, and gives up after the timeout", async () => {
    const tabs = new TabRegistry();
    tabs.upsert(tab(1, { url: "", title: "", loading: true }));
    tabs.upsert(tab(2, { url: "", title: "", loading: true }));
    tabs.upsert(tab(3, { url: "", title: "", loading: true }));
    const closed = tabs.waitForFirstPage(1, 1_000);
    const crashed = tabs.waitForFirstPage(2, 1_000);
    tabs.remove(1);
    tabs.markCrashed(2, "crashed");
    await expect(closed).resolves.toBe(true);
    await expect(crashed).resolves.toBe(true);
    await expect(tabs.waitForFirstPage(3, 20)).resolves.toBe(false);
    // Gone from the shell's list after a refresh.
    const refreshed = tabs.waitForFirstPage(3, 1_000);
    tabs.replaceAll([]);
    await expect(refreshed).resolves.toBe(true);
    tabs.dispose();
  });
});

describe("TabRegistry crashes", () => {
  it("marks a crashed tab with why until the shell reports it again", () => {
    const tabs = new TabRegistry();
    tabs.upsert(tab(3, { loading: true }));
    expect(tabs.markCrashed(3, "oom")).toBe(true);
    expect(tabs.get(3)).toEqual(tab(3, { loading: false, crashed: "oom" }));
    expect(tabs.markCrashed(3, "oom")).toBe(false);
    expect(tabs.markCrashed(9, "oom")).toBe(false);
    tabs.upsert(tab(3));
    expect(tabs.get(3)?.crashed).toBeUndefined();
  });
});

describe("TabRegistry open requests", () => {
  it("resolves the waiter with the first claim and calls a second window's claim a duplicate", async () => {
    const tabs = new TabRegistry();
    const request = tabs.createOpen({ url: "https://a.test/", activate: true });
    const waiting = tabs.waitForClaim(request.requestId, 1_000);
    expect(tabs.claim(request.requestId, 11)).toBe("claimed");
    await expect(waiting).resolves.toBe(11);
    // The same claim again is harmless; another tab's is the duplicate to remove.
    expect(tabs.claim(request.requestId, 11)).toBe("claimed");
    expect(tabs.claim(request.requestId, 12)).toBe("duplicate");
    expect(tabs.claim("no-such-request", 13)).toBe("unknown");
    expect(tabs.openRequest(request.requestId)).toMatchObject({ claimedTabId: 11, activate: true });
    await expect(tabs.waitForClaim(request.requestId, 1_000)).resolves.toBe(11);
  });

  it("times a claim out, and expires an old unclaimed request", async () => {
    let now = 0;
    const tabs = new TabRegistry(() => now);
    const request = tabs.createOpen({ url: "https://a.test/", activate: false });
    await expect(tabs.waitForClaim(request.requestId, 20)).resolves.toBeNull();
    now += 61_000;
    expect(tabs.claim(request.requestId, 5)).toBe("unknown");
  });

  it("lists a tab's popups since a moment", () => {
    let now = 100;
    const tabs = new TabRegistry(() => now);
    tabs.createOpen({ url: "https://early.test/", activate: true, openerTabId: 1 });
    now = 200;
    const popup = tabs.createOpen({ url: "https://popup.test/", activate: true, openerTabId: 1 });
    tabs.createOpen({ url: "https://other.test/", activate: true, openerTabId: 2 });
    tabs.createOpen({ url: "https://fresh.test/", activate: true });
    expect(tabs.opensFrom(1, 150).map((r) => r.requestId)).toEqual([popup.requestId]);
  });

  it("settles every waiter with nothing on dispose", async () => {
    const tabs = new TabRegistry();
    const request = tabs.createOpen({ url: "about:blank", activate: true });
    const waiting = tabs.waitForClaim(request.requestId, 60_000);
    tabs.dispose();
    await expect(waiting).resolves.toBeNull();
  });
});
