/**
 * The built-in browser's state in a window (features/builtin-browser/browser-state.ts): the
 * server's tab registry, the pages this window hosts, and the agent's activity — driven by the
 * user channel's four events and the window's own actions (claim, close, activate).
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserServerEvent, BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import {
  INITIAL_BROWSER_STATE,
  activeTab,
  browserOffered,
  currentActivity,
  guestByKey,
  guestForTab,
  guestKey,
  reduceBrowser,
  shouldReveal,
  tabBusy,
  type BrowserAction,
  type BrowserState,
} from "../src/features/builtin-browser/browser-state";

function tab(id: number, over: Partial<BuiltinBrowserTab> = {}): BuiltinBrowserTab {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    ...over,
  };
}

function run(state: BrowserState, ...actions: BrowserAction[]): BrowserState {
  return actions.reduce(reduceBrowser, state);
}

const event = (e: BuiltinBrowserServerEvent): BrowserAction => ({ type: "event", event: e });

const open = (requestId: string, over: Partial<{ url: string; activate: boolean }> = {}) =>
  event({
    type: "builtin_browser_open",
    requestId,
    url: over.url ?? "https://example.com/",
    activate: over.activate ?? true,
  });

/** A desktop window whose server said the browser is available, with no tabs yet. */
const READY = run(
  INITIAL_BROWSER_STATE,
  { type: "supported", supported: true },
  { type: "status", status: { available: true, tabs: [], activeTabId: null } },
);

describe("availability", () => {
  it("offers the browser only where it can be hosted and the server can drive it", () => {
    expect(browserOffered(INITIAL_BROWSER_STATE)).toBe(false);
    expect(browserOffered(READY)).toBe(true);
    const shellTooOld = reduceBrowser(READY, {
      type: "status",
      status: { available: false, reason: "shell_unsupported", tabs: [], activeTabId: null },
    });
    expect(browserOffered(shellTooOld)).toBe(false);
    expect(shellTooOld.reason).toBe("shell_unsupported");
    // A plain browser tab: the server may be fine, but there is no <webview> here.
    const noWebview = reduceBrowser(INITIAL_BROWSER_STATE, {
      type: "status",
      status: { available: true, tabs: [], activeTabId: null },
    });
    expect(browserOffered(noWebview)).toBe(false);
  });

  it("stops offering it when the status is refused", () => {
    expect(browserOffered(reduceBrowser(READY, { type: "unreachable" }))).toBe(false);
  });

  it("takes the registry from the status", () => {
    const state = reduceBrowser(READY, {
      type: "status",
      status: { available: true, tabs: [tab(3), tab(5)], activeTabId: 5 },
    });
    expect(state.tabs.map((t) => t.id)).toEqual([3, 5]);
    expect(activeTab(state)?.id).toBe(5);
  });
});

describe("pages this window hosts", () => {
  it("creates a page for an open request, keyed by the request", () => {
    const state = run(READY, open("r1", { url: "https://amazon.com/" }));
    expect(state.guests).toEqual([
      {
        key: guestKey("r1"),
        src: "https://amazon.com/",
        requestId: "r1",
        tabId: null,
        activate: true,
      },
    ]);
  });

  it("starts a page asked for with no address on the blank page", () => {
    expect(run(READY, open("r1", { url: "" })).guests[0]?.src).toBe("about:blank");
  });

  it("creates one page per request, however often the event arrives", () => {
    expect(run(READY, open("r1"), open("r1")).guests).toHaveLength(1);
  });

  it("creates nothing in a window that cannot host a page", () => {
    const plain = { ...READY, supported: false };
    expect(run(plain, open("r1")).guests).toEqual([]);
  });

  it("only ever appends pages, so none is moved in the DOM", () => {
    const state = run(READY, open("a"), open("b"), open("c"));
    expect(state.guests.map((g) => g.requestId)).toEqual(["a", "b", "c"]);
    const afterClose = run(
      state,
      { type: "attached", key: guestKey("b"), tabId: 12 },
      { type: "closed", tabId: 12 },
      open("d"),
    );
    expect(afterClose.guests.map((g) => g.requestId)).toEqual(["a", "c", "d"]);
  });

  it("learns a page's tab id once, and gives one tab id to one page", () => {
    const state = run(
      READY,
      open("a"),
      open("b"),
      { type: "attached", key: guestKey("a"), tabId: 7 },
      { type: "attached", key: guestKey("a"), tabId: 99 },
      { type: "attached", key: guestKey("b"), tabId: 7 },
    );
    expect(guestByKey(state, guestKey("a"))?.tabId).toBe(7);
    expect(guestByKey(state, guestKey("b"))?.tabId).toBeNull();
    expect(guestForTab(state, 7)?.requestId).toBe("a");
    expect(guestForTab(state, null)).toBeNull();
  });

  it("drops its copy when another window claimed the request first", () => {
    const state = run(READY, open("a"), { type: "rejected", key: guestKey("a") });
    expect(state.guests).toEqual([]);
  });

  it("forgets every page when it stops hosting (signing out unmounts the layer)", () => {
    const state = run(READY, open("a"), { type: "supported", supported: false });
    expect(state.guests).toEqual([]);
  });
});

describe("tabs and closing", () => {
  const withTabs = run(
    READY,
    open("a"),
    { type: "attached", key: guestKey("a"), tabId: 1 },
    open("b"),
    { type: "attached", key: guestKey("b"), tabId: 2 },
    event({ type: "builtin_browser_tabs", tabs: [tab(1), tab(2)], activeTabId: 2 }),
  );

  it("replaces the registry whole on every tabs event", () => {
    const next = reduceBrowser(
      withTabs,
      event({ type: "builtin_browser_tabs", tabs: [tab(2, { title: "Renamed" })], activeTabId: 2 }),
    );
    expect(next.tabs).toEqual([tab(2, { title: "Renamed" })]);
  });

  it("removes a tab the server closed, page and all", () => {
    const next = reduceBrowser(withTabs, event({ type: "builtin_browser_close", tabId: 2 }));
    expect(next.tabs.map((t) => t.id)).toEqual([1]);
    expect(next.guests.map((g) => g.tabId)).toEqual([1]);
    expect(next.activeTabId).toBe(1);
  });

  it("closes a tab here at once, and keeps a stale snapshot from bringing it back", () => {
    const closed = reduceBrowser(withTabs, { type: "closed", tabId: 2 });
    expect(closed.tabs.map((t) => t.id)).toEqual([1]);
    expect(closed.guests.map((g) => g.tabId)).toEqual([1]);
    expect(closed.activeTabId).toBe(1);
    // A snapshot published before the close still lists tab 2.
    const stale = reduceBrowser(
      closed,
      event({ type: "builtin_browser_tabs", tabs: [tab(1), tab(2)], activeTabId: 2 }),
    );
    expect(stale.tabs.map((t) => t.id)).toEqual([1]);
    expect(stale.activeTabId).toBeNull();
    // Once the server stops listing it, the tab id is no longer held back.
    const settled = reduceBrowser(
      stale,
      event({ type: "builtin_browser_tabs", tabs: [tab(1)], activeTabId: 1 }),
    );
    expect(settled.closing).toEqual([]);
    expect(settled.activeTabId).toBe(1);
  });

  it("brings a tab to the front here before the server confirms", () => {
    const next = reduceBrowser(withTabs, { type: "activated", tabId: 1 });
    expect(activeTab(next)?.id).toBe(1);
    expect(reduceBrowser(next, { type: "activated", tabId: 1 })).toBe(next);
  });
});

describe("agent activity", () => {
  const busy = (tabId: number, on: boolean, sessionId?: string) =>
    event({
      type: "builtin_browser_activity",
      tabId,
      busy: on,
      action: "scan",
      ...(sessionId !== undefined ? { sessionId } : {}),
    });

  it("marks a tab while an agent acts in it", () => {
    const state = run(READY, busy(4, true, "s1"));
    expect(tabBusy(state, 4)).toBe(true);
    expect(currentActivity(state)).toEqual({ action: "scan", sessionId: "s1" });
    const done = reduceBrowser(state, busy(4, false));
    expect(tabBusy(done, 4)).toBe(false);
    expect(currentActivity(done)).toBeNull();
  });

  it("names the active tab's activity first", () => {
    const state = run(
      READY,
      event({ type: "builtin_browser_tabs", tabs: [tab(1), tab(2)], activeTabId: 2 }),
      busy(1, true),
      event({
        type: "builtin_browser_activity",
        tabId: 2,
        busy: true,
        action: "click",
      }),
    );
    expect(currentActivity(state)?.action).toBe("click");
  });

  it("drops the marks of a closed tab, and every mark on a resync", () => {
    const state = run(READY, busy(1, true), busy(2, true));
    expect(tabBusy(reduceBrowser(state, { type: "closed", tabId: 1 }), 1)).toBe(false);
    expect(currentActivity(reduceBrowser(state, { type: "resync" }))).toBeNull();
  });
});

describe("shouldReveal", () => {
  const onScreen = { conversation: "s1", browserShown: false };
  const opened = (sessionId?: string): BuiltinBrowserServerEvent => ({
    type: "builtin_browser_open",
    requestId: "r",
    url: "https://example.com/",
    activate: true,
    ...(sessionId !== undefined ? { sessionId } : {}),
  });
  const acting = (busy: boolean, sessionId = "s1"): BuiltinBrowserServerEvent => ({
    type: "builtin_browser_activity",
    tabId: 1,
    busy,
    action: "navigate",
    sessionId,
  });

  it("brings the browser up for the conversation on screen", () => {
    expect(shouldReveal(opened("s1"), onScreen, new Set())).toBe(true);
    expect(shouldReveal(acting(true), onScreen, new Set())).toBe(true);
  });

  it("leaves it alone for another conversation, no conversation, or a finished step", () => {
    expect(shouldReveal(opened("s2"), onScreen, new Set())).toBe(false);
    expect(shouldReveal(opened(), onScreen, new Set())).toBe(false);
    expect(shouldReveal(acting(false), onScreen, new Set())).toBe(false);
    expect(shouldReveal({ type: "builtin_browser_close", tabId: 1 }, onScreen, new Set())).toBe(
      false,
    );
  });

  it("does nothing while the browser is already showing", () => {
    expect(shouldReveal(acting(true), { ...onScreen, browserShown: true }, new Set())).toBe(false);
  });

  it("brings it up once per conversation, so hiding it again is respected", () => {
    expect(shouldReveal(acting(true), onScreen, new Set(["s1"]))).toBe(false);
  });
});
