/**
 * The agent browser's state in a window (features/builtin-browser/browser-state.ts): the
 * built-in browser's tab registry, the pages this window hosts, the agent's activity, the
 * homepage and the browser's load — driven by the user channel's events and the window's own
 * actions (claim, close, activate, settings read or saved, a new tab asked for) — and the rule
 * that keeps a tab open while the panel is on screen. Then the second backend, the user's own
 * Chrome:
 *
 * - Given a server with no desktop shell, the Browser panel is offered in a window that cannot
 *   host a page, and the agents' backend is Chrome; given a server too old to name backends, the
 *   built-in rule alone decides.
 * - A desktop admin hears both backends' tab lists: each replaces only its own registry, so the
 *   built-in pages and their tabs survive a Chrome list and the other way round, and the
 *   built-in list does not make an unconnected Chrome look connected.
 * - A backend switch moves the window to the new backend as its entry last stood and drops the
 *   activity marks; a repeated switch changes nothing.
 * - The server's word on the user's Chrome: connected makes it drivable and names it, a
 *   disconnection does not (unless the admin's switch is why), a revoke of the Chrome shown
 *   takes it away, and every word is counted.
 * - Closing a Chrome tab here drops it at once and holds back a stale list, as built-in closes do.
 * - Chrome never gets the new-tab page by itself, and a link opens where the chosen backend can
 *   take it: the built-in browser while it runs here, Chrome while it is connected, else nowhere.
 * - A refused status read stops offering the browser.
 */
import { describe, expect, it } from "vitest";
import type {
  BrowserBackendInfo,
  BrowserExtensionRecord,
  BuiltinBrowserMetrics,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "@prismshadow/penguin-server/api";
import {
  INITIAL_BROWSER_STATE,
  activeTab,
  addressOf,
  browserOffered,
  chromeInfo,
  currentActivity,
  guestByKey,
  guestForTab,
  guestKey,
  linkTarget,
  reduceBrowser,
  shouldReveal,
  shownActiveTab,
  shownTabs,
  tabBusy,
  wantsNewTabPage,
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

/** A status's backend fields, as a desktop server answers them for its admin. */
const BUILTIN = {
  backend: "builtin" as const,
  backends: [{ backend: "builtin" as const, available: true }],
};

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
  { type: "status", status: { available: true, ...BUILTIN, tabs: [], activeTabId: null } },
);

describe("availability", () => {
  it("offers the browser only where it can be hosted and the server can drive it", () => {
    expect(browserOffered(INITIAL_BROWSER_STATE)).toBe(false);
    expect(browserOffered(READY)).toBe(true);
    const shellTooOld = reduceBrowser(READY, {
      type: "status",
      status: {
        available: false,
        reason: "shell_unsupported",
        ...BUILTIN,
        tabs: [],
        activeTabId: null,
      },
    });
    expect(browserOffered(shellTooOld)).toBe(false);
    expect(shellTooOld.reason).toBe("shell_unsupported");
    // A plain browser tab: the server may be fine, but there is no <webview> here.
    const noWebview = reduceBrowser(INITIAL_BROWSER_STATE, {
      type: "status",
      status: { available: true, ...BUILTIN, tabs: [], activeTabId: null },
    });
    expect(browserOffered(noWebview)).toBe(false);
  });

  it("stops offering it when the status is refused", () => {
    expect(browserOffered(reduceBrowser(READY, { type: "unreachable" }))).toBe(false);
  });

  it("takes the registry from the status", () => {
    const state = reduceBrowser(READY, {
      type: "status",
      status: { available: true, ...BUILTIN, tabs: [tab(3), tab(5)], activeTabId: 5 },
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
    event({
      type: "builtin_browser_tabs",
      backend: "builtin",
      tabs: [tab(1), tab(2)],
      activeTabId: 2,
    }),
  );

  it("replaces the registry whole on every tabs event", () => {
    const next = reduceBrowser(
      withTabs,
      event({
        type: "builtin_browser_tabs",
        backend: "builtin",
        tabs: [tab(2, { title: "Renamed" })],
        activeTabId: 2,
      }),
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
      event({
        type: "builtin_browser_tabs",
        backend: "builtin",
        tabs: [tab(1), tab(2)],
        activeTabId: 2,
      }),
    );
    expect(stale.tabs.map((t) => t.id)).toEqual([1]);
    expect(stale.activeTabId).toBeNull();
    // Once the server stops listing it, the tab id is no longer held back.
    const settled = reduceBrowser(
      stale,
      event({ type: "builtin_browser_tabs", backend: "builtin", tabs: [tab(1)], activeTabId: 1 }),
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
      event({
        type: "builtin_browser_tabs",
        backend: "builtin",
        tabs: [tab(1), tab(2)],
        activeTabId: 2,
      }),
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

describe("settings", () => {
  it("has no homepage until the server names one, and follows it being cleared", () => {
    expect(READY.homepage).toBeNull();
    const set = reduceBrowser(READY, {
      type: "settings",
      settings: { homepage: "https://example.com/start" },
    });
    expect(set.homepage).toBe("https://example.com/start");
    const cleared = reduceBrowser(set, { type: "settings", settings: { homepage: null } });
    expect(cleared.homepage).toBeNull();
  });

  it("keeps the same state object when nothing changed, so nothing re-renders", () => {
    expect(reduceBrowser(READY, { type: "settings", settings: { homepage: null } })).toBe(READY);
  });

  it("keeps the homepage across the window's other changes", () => {
    const set = reduceBrowser(READY, {
      type: "settings",
      settings: { homepage: "https://example.com/start" },
    });
    const after = run(set, open("r1"), { type: "resync" }, { type: "supported", supported: false });
    expect(after.homepage).toBe("https://example.com/start");
  });
});

describe("load", () => {
  const heavy: BuiltinBrowserMetrics = {
    at: 1,
    tabs: [
      { tabId: 1, memoryKB: 1_400_000, cpuPercent: 3 },
      { tabId: 2, memoryKB: 300_000, cpuPercent: 0 },
    ],
    totalKB: 1_700_000,
    warnings: ["memory"],
    heavyTabIds: [1, 2],
  };

  it("has no measurement until the first one, then follows each", () => {
    expect(READY.metrics).toBeNull();
    const warned = run(READY, event({ type: "builtin_browser_metrics", metrics: heavy }));
    expect(warned.metrics).toEqual(heavy);
    const calm = { ...heavy, at: 2, totalKB: 500_000, warnings: [], heavyTabIds: [] };
    expect(run(warned, event({ type: "builtin_browser_metrics", metrics: calm })).metrics).toEqual(
      calm,
    );
  });

  it("takes the status's measurement, and keeps the last one when a status has none", () => {
    const status = { available: true, ...BUILTIN, tabs: [tab(1), tab(2)], activeTabId: 1 };
    const read = run(READY, { type: "status", status: { ...status, metrics: heavy } });
    expect(read.metrics).toEqual(heavy);
    expect(run(read, { type: "status", status }).metrics).toEqual(heavy);
  });

  it("shows a crashed tab as the server reports it", () => {
    const state = run(
      READY,
      event({
        type: "builtin_browser_tabs",
        backend: "builtin",
        tabs: [tab(4, { crashed: "oom" })],
        activeTabId: 4,
      }),
    );
    expect(activeTab(state)?.crashed).toBe("oom");
  });
});

describe("the new-tab page", () => {
  const listed = (...tabs: BuiltinBrowserTab[]) =>
    event({
      type: "builtin_browser_tabs",
      backend: "builtin",
      tabs,
      activeTabId: tabs.at(-1)?.id ?? null,
    });

  it("is opened for a panel on screen with no tab: the first time, or after a restart", () => {
    expect(wantsNewTabPage(READY, true)).toBe(true);
  });

  it("is not opened out of sight, or where the browser cannot be used", () => {
    expect(wantsNewTabPage(READY, false)).toBe(false);
    expect(wantsNewTabPage(INITIAL_BROWSER_STATE, true)).toBe(false);
    expect(wantsNewTabPage(reduceBrowser(READY, { type: "unreachable" }), true)).toBe(false);
  });

  it("is not opened beside a tab that is open", () => {
    expect(wantsNewTabPage(run(READY, listed(tab(1))), true)).toBe(false);
  });

  it("is not opened beside a tab on its way", () => {
    // Asked for by any window, the agent or a page: the page is being created here.
    const creating = run(READY, open("r1"));
    expect(wantsNewTabPage(creating, true)).toBe(false);
    // Claimed, not yet in the registry.
    const claimed = run(creating, { type: "attached", key: guestKey("r1"), tabId: 4 });
    expect(wantsNewTabPage(claimed, true)).toBe(false);
    // This window's own request, before the server has asked it for the page.
    const asking = reduceBrowser(READY, { type: "opening", delta: 1 });
    expect(wantsNewTabPage(asking, true)).toBe(false);
    expect(wantsNewTabPage(reduceBrowser(asking, { type: "opening", delta: -1 }), true)).toBe(true);
  });

  it("replaces the last tab once it closes, however it closed", () => {
    const one = run(
      READY,
      open("r1"),
      { type: "attached", key: guestKey("r1"), tabId: 4 },
      listed(tab(4)),
    );
    expect(wantsNewTabPage(one, true)).toBe(false);
    // Its × here, or the agent's close through the server.
    expect(wantsNewTabPage(reduceBrowser(one, { type: "closed", tabId: 4 }), true)).toBe(true);
    const byAgent = run(one, event({ type: "builtin_browser_close", tabId: 4 }));
    expect(wantsNewTabPage(byAgent, true)).toBe(true);
    // Closed while the panel was out of sight: nothing until it is shown again.
    expect(wantsNewTabPage(byAgent, false)).toBe(false);
  });

  it("counts this window's requests on their way, and never below none", () => {
    const twice = run(
      READY,
      { type: "opening", delta: 1 },
      { type: "opening", delta: 1 },
      { type: "opening", delta: -1 },
    );
    expect(twice.opening).toBe(1);
    expect(run(READY, { type: "opening", delta: -1 }).opening).toBe(0);
  });
});

describe("the address a tab shows", () => {
  const home = "https://home.example/";

  it("is the address its page was opened at while the first page is on its way", () => {
    const opening = tab(4, { url: "", title: "", loading: true });
    const state = run(
      READY,
      open("r1", { url: home }),
      { type: "attached", key: guestKey("r1"), tabId: 4 },
      event({ type: "builtin_browser_tabs", backend: "builtin", tabs: [opening], activeTabId: 4 }),
    );
    expect(addressOf(state, opening)).toBe(home);
  });

  it("is the page's own once it committed, and blank for a blank new tab", () => {
    const loaded = tab(4, { url: "https://home.example/welcome", loading: true });
    const state = run(READY, open("r1", { url: home }), {
      type: "attached",
      key: guestKey("r1"),
      tabId: 4,
    });
    expect(addressOf(state, loaded)).toBe("https://home.example/welcome");
    const blank = run(READY, open("r2", { url: "about:blank" }), {
      type: "attached",
      key: guestKey("r2"),
      tabId: 5,
    });
    expect(addressOf(blank, tab(5, { url: "", title: "", loading: true }))).toBe("");
  });

  it("is the registry's for a tab whose page this window does not host", () => {
    expect(addressOf(READY, tab(8, { url: "", title: "", loading: true }))).toBe("");
  });
});

// ------------------------------------------------------------------- the user's own Chrome

const CHROME_130: BrowserExtensionRecord = {
  id: "ext-1",
  name: "Chrome 130 on macOS",
  version: "0.2.13",
  createdAt: "2026-10-02T08:00:00.000Z",
  lastSeenAt: "2026-10-02T09:00:00.000Z",
  connected: true,
};

const chromeEntry = (over: Partial<BrowserBackendInfo> = {}): BrowserBackendInfo => ({
  backend: "chrome",
  available: true,
  extension: {
    id: CHROME_130.id,
    name: CHROME_130.name,
    version: CHROME_130.version,
    connected: true,
    lastSeenAt: CHROME_130.lastSeenAt,
  },
  ...over,
});

const UNPAIRED = chromeEntry({
  available: false,
  reason: "extension_not_paired",
  extension: undefined,
});
const DISCONNECTED = chromeEntry({
  available: false,
  reason: "extension_disconnected",
  extension: { ...chromeEntry().extension!, connected: false },
});

/** GET /status as a server answers it for one backend among `backends`. */
const status = (
  backend: "builtin" | "chrome",
  backends: BrowserBackendInfo[],
  tabs: BuiltinBrowserTab[] = [],
  activeTabId: number | null = null,
): BuiltinBrowserStatus => {
  const entry = backends.find((b) => b.backend === backend);
  return {
    available: entry?.available === true,
    ...(entry?.reason !== undefined ? { reason: entry.reason } : {}),
    backend,
    backends,
    tabs,
    activeTabId,
  };
};

const chromeTabs = (tabs: BuiltinBrowserTab[], activeTabId: number | null) =>
  event({ type: "builtin_browser_tabs", backend: "chrome", tabs, activeTabId });

/** A plain browser window against a server with no desktop shell, its Chrome connected. */
const WEB_CONNECTED = run(INITIAL_BROWSER_STATE, {
  type: "status",
  status: status("chrome", [chromeEntry()], [tab(1201)], 1201),
});

/** The desktop app's window for its admin, on the built-in browser, its Chrome connected too. */
const DESKTOP = run(
  READY,
  {
    type: "status",
    status: status("builtin", [{ backend: "builtin", available: true }, chromeEntry()]),
  },
  open("a"),
  { type: "attached", key: guestKey("a"), tabId: 3 },
  event({ type: "builtin_browser_tabs", backend: "builtin", tabs: [tab(3)], activeTabId: 3 }),
);

describe("where the browser is offered", () => {
  it("offers the panel without a page host when the server has the user's Chrome, even unpaired", () => {
    const web = reduceBrowser(INITIAL_BROWSER_STATE, {
      type: "status",
      status: status("chrome", [UNPAIRED]),
    });
    expect(web.supported).toBe(false);
    expect(web.backend).toBe("chrome");
    expect(browserOffered(web)).toBe(true);
    expect(chromeInfo(web)?.reason).toBe("extension_not_paired");
    expect(linkTarget(web)).toBeNull();
  });

  it("falls back to the built-in rule alone for a server too old to name its backends", () => {
    const old = { available: true, tabs: [], activeTabId: null } as unknown as BuiltinBrowserStatus;
    const desktop = run(
      INITIAL_BROWSER_STATE,
      { type: "supported", supported: true },
      {
        type: "status",
        status: old,
      },
    );
    expect(desktop.backend).toBe("builtin");
    expect(browserOffered(desktop)).toBe(true);
    expect(
      browserOffered(reduceBrowser(INITIAL_BROWSER_STATE, { type: "status", status: old })),
    ).toBe(false);
  });

  it("stops offering it once the status is refused", () => {
    expect(browserOffered(reduceBrowser(WEB_CONNECTED, { type: "unreachable" }))).toBe(false);
  });
});

describe("two registries", () => {
  it("takes the Chrome tabs from a status on Chrome, leaving the built-in registry alone", () => {
    expect(shownTabs(WEB_CONNECTED).tabs.map((t) => t.id)).toEqual([1201]);
    expect(shownActiveTab(WEB_CONNECTED)?.id).toBe(1201);
    expect(WEB_CONNECTED.tabs).toEqual([]);
  });

  it("keeps the built-in tabs and pages when the user's Chrome reports its list, and the other way round", () => {
    const heard = reduceBrowser(DESKTOP, chromeTabs([tab(1201), tab(1202)], 1202));
    expect(heard.tabs.map((t) => t.id)).toEqual([3]);
    expect(heard.guests.map((g) => g.tabId)).toEqual([3]);
    expect(activeTab(heard)?.id).toBe(3);
    expect(heard.chrome.tabs.map((t) => t.id)).toEqual([1201, 1202]);
    const back = reduceBrowser(
      heard,
      event({
        type: "builtin_browser_tabs",
        backend: "builtin",
        tabs: [tab(3), tab(4)],
        activeTabId: 4,
      }),
    );
    expect(back.chrome.tabs.map((t) => t.id)).toEqual([1201, 1202]);
    expect(back.tabs.map((t) => t.id)).toEqual([3, 4]);
  });

  it("does not take a built-in list as word that an unconnected Chrome runs", () => {
    const onChrome = run(DESKTOP, {
      type: "status",
      status: status("chrome", [{ backend: "builtin", available: true }, DISCONNECTED]),
    });
    expect(onChrome.available).toBe(false);
    const heard = reduceBrowser(
      onChrome,
      event({ type: "builtin_browser_tabs", backend: "builtin", tabs: [tab(3)], activeTabId: 3 }),
    );
    expect(heard.available).toBe(false);
    expect(heard.reason).toBe("extension_disconnected");
  });

  it("closes a Chrome tab here at once, and keeps a stale list from bringing it back", () => {
    const two = reduceBrowser(WEB_CONNECTED, chromeTabs([tab(1201), tab(1202)], 1202));
    const closed = reduceBrowser(two, { type: "chrome-closed", tabId: 1202 });
    expect(closed.chrome.tabs.map((t) => t.id)).toEqual([1201]);
    expect(closed.chrome.activeTabId).toBe(1201);
    const stale = reduceBrowser(closed, chromeTabs([tab(1201), tab(1202)], 1202));
    expect(stale.chrome.tabs.map((t) => t.id)).toEqual([1201]);
    expect(reduceBrowser(stale, chromeTabs([tab(1201)], 1201)).chrome.closing).toEqual([]);
  });

  it("brings a Chrome tab to the front here, not a built-in one", () => {
    const two = reduceBrowser(DESKTOP, chromeTabs([tab(1201), tab(1202)], 1202));
    const picked = reduceBrowser(two, { type: "activated", tabId: 1201, backend: "chrome" });
    expect(picked.chrome.activeTabId).toBe(1201);
    expect(picked.activeTabId).toBe(3);
  });
});

describe("switching backends", () => {
  it("moves to the new backend as its entry last stood, and drops the activity marks", () => {
    const busy = reduceBrowser(
      DESKTOP,
      event({ type: "builtin_browser_activity", tabId: 3, busy: true, action: "scan" }),
    );
    const moved = reduceBrowser(
      busy,
      event({ type: "builtin_browser_backend", backend: "chrome" }),
    );
    expect(moved.backend).toBe("chrome");
    expect(moved.available).toBe(true);
    expect(moved.activity).toEqual({});
    // The built-in pages stay hosted, out of sight.
    expect(moved.guests.map((g) => g.tabId)).toEqual([3]);
    expect(
      reduceBrowser(moved, event({ type: "builtin_browser_backend", backend: "chrome" })),
    ).toBe(moved);
  });

  it("names the active Chrome tab's activity once the agents drive Chrome", () => {
    const onChrome = run(
      WEB_CONNECTED,
      event({ type: "builtin_browser_activity", tabId: 1201, busy: true, action: "exec" }),
    );
    expect(currentActivity(onChrome)?.action).toBe("exec");
  });

  it("never opens the new-tab page in the user's Chrome", () => {
    const desktopOnChrome = reduceBrowser(
      { ...READY, backends: [{ backend: "builtin", available: true }, chromeEntry()] },
      event({ type: "builtin_browser_backend", backend: "chrome" }),
    );
    expect(wantsNewTabPage(desktopOnChrome, true)).toBe(false);
    expect(wantsNewTabPage(WEB_CONNECTED, true)).toBe(false);
  });
});

describe("the server's word on the user's Chrome", () => {
  const extension = (
    state: "connected" | "disconnected" | "replaced" | "revoked",
    record: BrowserExtensionRecord = CHROME_130,
  ) => event({ type: "builtin_browser_extension", state, extension: record });

  it("makes a Chrome that connects drivable and names it, and counts every word", () => {
    const waiting = reduceBrowser(INITIAL_BROWSER_STATE, {
      type: "status",
      status: status("chrome", [DISCONNECTED]),
    });
    const connected = reduceBrowser(waiting, extension("connected"));
    expect(connected.available).toBe(true);
    expect(chromeInfo(connected)?.extension?.name).toBe("Chrome 130 on macOS");
    expect(connected.extension).toEqual({ seq: 1, last: "connected" });
    expect(linkTarget(connected)).toBe("chrome");
  });

  it("makes a Chrome that went away undrivable, still named, and an admin's switch stays the reason", () => {
    const gone = reduceBrowser(
      WEB_CONNECTED,
      extension("disconnected", { ...CHROME_130, connected: false }),
    );
    expect(gone.available).toBe(false);
    expect(gone.reason).toBe("extension_disconnected");
    expect(chromeInfo(gone)?.extension?.connected).toBe(false);
    const switchedOff = run(
      INITIAL_BROWSER_STATE,
      {
        type: "status",
        status: status("chrome", [chromeEntry({ available: false, reason: "extension_disabled" })]),
      },
      extension("disconnected"),
    );
    expect(switchedOff.reason).toBe("extension_disabled");
  });

  it("takes a revoked Chrome away when it is the one shown, and leaves it when another was revoked", () => {
    const revoked = reduceBrowser(WEB_CONNECTED, extension("revoked"));
    expect(revoked.available).toBe(false);
    expect(chromeInfo(revoked)?.extension).toBeUndefined();
    const other = reduceBrowser(
      WEB_CONNECTED,
      extension("revoked", { ...CHROME_130, id: "ext-2" }),
    );
    expect(other.available).toBe(true);
    expect(other.extension.seq).toBe(1);
  });

  it("names the Chrome that replaced another and waits for it to connect", () => {
    const replaced = reduceBrowser(
      WEB_CONNECTED,
      extension("replaced", {
        ...CHROME_130,
        id: "ext-2",
        name: "Chrome 131 on Linux",
        connected: false,
      }),
    );
    expect(chromeInfo(replaced)?.extension?.name).toBe("Chrome 131 on Linux");
    expect(replaced.available).toBe(true);
  });
});

describe("where a link opens", () => {
  it("opens in the built-in browser while it runs here, else in a connected Chrome, else nowhere", () => {
    expect(linkTarget(DESKTOP)).toBe("builtin");
    expect(linkTarget(WEB_CONNECTED)).toBe("chrome");
    const gone = reduceBrowser(
      WEB_CONNECTED,
      event({ type: "builtin_browser_extension", state: "disconnected" }),
    );
    expect(linkTarget(gone)).toBeNull();
  });
});
