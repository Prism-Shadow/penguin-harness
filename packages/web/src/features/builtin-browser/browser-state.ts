/**
 * The agent browser's state in this window, as a pure reducer.
 *
 * Two backends: the desktop's built-in browser, whose pages this window hosts as `<webview>`
 * guests, and the user's own Chrome, driven through the PenguinHarness Browser extension, whose
 * pages live in Chrome. `backend` is the one this user's agents drive (the server decides it,
 * from the user's choice); `backends` is every one the server offers them, each with whether it
 * can be driven now and, for Chrome, the paired extension. On the desktop an admin has both, and
 * both keep their tabs whichever is chosen, so each has its own registry:
 *
 * - `tabs` is the built-in browser's registry on the SERVER — what the desktop shell reports
 *   about every guest page (address, title, loading, history) and which one is active.
 *   `guests` are the `<webview>` elements THIS window hosts, in creation order. A guest starts
 *   from a `builtin_browser_open` request, learns its tab id once it attaches, and is removed
 *   by a close. The order is the DOM order of the elements and must never change: moving a
 *   webview in the DOM reloads its page, so guests are only ever appended or removed.
 * - `chrome` is the user's Chrome's registry: the tabs the extension drives.
 *
 * The user channel's `builtin_browser_tabs` names the backend whose list it carries and replaces
 * that registry whole. `builtin_browser_backend` moves the user to another backend, and
 * `builtin_browser_extension` says their Chrome connected, went away, was replaced by another of
 * theirs or was revoked; `extension` counts those, so a dialog can wait for the next connection.
 *
 * Activity (`builtin_browser_activity`) marks the tabs an agent is working in right now (only
 * the chosen backend's: a switch is refused while an agent acts), the homepage is the server's
 * setting as this window last read or saved it, and the metrics are the built-in browser's load
 * with the server's verdict on it (`builtin_browser_metrics`, about every 10 s).
 *
 * The built-in browser keeps a tab while its panel is on screen: with none open and none on its
 * way, the window opens the new-tab page by itself (`wantsNewTabPage`), the homepage or a blank
 * page. Chrome does not: a tab opened there would take the user's own browser to the front.
 */
import type {
  BrowserBackend,
  BrowserBackendInfo,
  BrowserExtensionRecord,
  BuiltinBrowserAction,
  BuiltinBrowserMetrics,
  BuiltinBrowserServerEvent,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "@prismshadow/penguin-server/api";
import { BLANK_URL, tabAddress } from "./address";

/** One webview this window hosts. */
export interface BrowserGuest {
  /** Stable for the element's whole life: it is the React key, and a remount reloads the page. */
  key: string;
  /** The address the element was created with. Never changes, even as the page navigates. */
  src: string;
  /** The open request this guest answers, claimed once it has a tab id. */
  requestId: string;
  /** The guest's webContents id, known once it attached. */
  tabId: number | null;
  /** Whether it comes to the front once claimed. */
  activate: boolean;
}

export interface BrowserActivity {
  action: BuiltinBrowserAction;
  sessionId?: string;
}

/** One backend's tabs as the server lists them, and the ones this window is closing. */
export interface BrowserRegistry {
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /**
   * Tabs this window closed and the server has not yet dropped. A registry snapshot published
   * before the close would otherwise put a closed tab back in the strip for a moment.
   */
  closing: readonly number[];
}

/** What the server last said about the user's Chrome, counted so a listener can wait for the next word. */
export interface ExtensionNews {
  /** How many `builtin_browser_extension` events this window has heard. */
  seq: number;
  /** The latest one's state; null before any. */
  last: "connected" | "disconnected" | "replaced" | "revoked" | null;
}

export interface BrowserState {
  /** This window can host guests at all: Electron's `<webview>` element exists here. */
  supported: boolean;
  /** The backend this user's agents drive: built-in until the server says otherwise. */
  backend: BrowserBackend;
  /** Every backend the server offers this user; empty before the first status, or from a server too old to say. */
  backends: readonly BrowserBackendInfo[];
  /** The chosen backend can be driven now (built-in: the shell is there; Chrome: it is connected). */
  available: boolean;
  /** Why not, when the server said so. */
  reason: BuiltinBrowserStatus["reason"] | null;
  /** The built-in browser's registry (see the module doc); `closing` is its own. */
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  guests: BrowserGuest[];
  /** Tabs an agent is acting on right now, by tab id. */
  activity: Readonly<Record<number, BrowserActivity>>;
  /** Built-in tabs this window closed and the server has not yet dropped (see BrowserRegistry). */
  closing: readonly number[];
  /** The user's Chrome's registry. */
  chrome: BrowserRegistry;
  extension: ExtensionNews;
  /** The page a new tab and the Home button open; null for none (new tabs are blank). */
  homepage: string | null;
  /** The browser's load as last measured, with the server's warnings; null before the first measurement. */
  metrics: BuiltinBrowserMetrics | null;
  /** This window's own requests for a new tab that have not been answered yet. */
  opening: number;
}

export type BrowserAction =
  | { type: "supported"; supported: boolean }
  | { type: "status"; status: BuiltinBrowserStatus }
  /** The status could not be read at all (an older server, a member account, no network). */
  | { type: "unreachable" }
  | { type: "event"; event: BuiltinBrowserServerEvent }
  /** A guest attached and reported its tab id. */
  | { type: "attached"; key: string; tabId: number }
  /** Another window claimed this guest's request first: this copy goes. */
  | { type: "rejected"; key: string }
  /** The user closed a tab here (its ×, or the page called window.close()). */
  | { type: "closed"; tabId: number }
  /**
   * The user closed a tab of the user's Chrome here (its ×); the extension closes it there. The
   * built-in browser's own closes are `closed`, since a page in this window may close itself.
   */
  | { type: "chrome-closed"; tabId: number }
  /** The user brought a tab to the front here; the server confirms with a tabs event. */
  | { type: "activated"; tabId: number; backend?: BrowserBackend }
  /** Events may have been lost: activity marks can no longer be trusted. */
  | { type: "resync" }
  /** The browser's settings as the server holds them (read, or answered to a save). */
  | { type: "settings"; settings: BuiltinBrowserSettings }
  /** This window asked for a new tab (1), or heard the answer (-1). */
  | { type: "opening"; delta: 1 | -1 };

const NO_TABS: BrowserRegistry = { tabs: [], activeTabId: null, closing: [] };

export const INITIAL_BROWSER_STATE: BrowserState = {
  supported: false,
  backend: "builtin",
  backends: [],
  available: false,
  reason: null,
  tabs: [],
  activeTabId: null,
  guests: [],
  activity: {},
  closing: [],
  chrome: NO_TABS,
  extension: { seq: 0, last: null },
  homepage: null,
  metrics: null,
  opening: 0,
};

/** The key a guest is known by, from the request that created it. */
export function guestKey(requestId: string): string {
  return `request:${requestId}`;
}

function withoutActivity(
  activity: Readonly<Record<number, BrowserActivity>>,
  tabId: number,
): Readonly<Record<number, BrowserActivity>> {
  if (!(tabId in activity)) return activity;
  const { [tabId]: _dropped, ...rest } = activity;
  return rest;
}

/** A registry snapshot, minus the tabs this window is closing; a closing tab it no longer lists is gone for good. */
function applyRegistry(
  registry: BrowserRegistry,
  tabs: BuiltinBrowserTab[],
  activeTabId: number | null,
): BrowserRegistry {
  const listed = new Set(tabs.map((tab) => tab.id));
  const closing = registry.closing.filter((id) => listed.has(id));
  const shown = closing.length === 0 ? tabs : tabs.filter((tab) => !closing.includes(tab.id));
  const active = activeTabId !== null && closing.includes(activeTabId) ? null : activeTabId;
  return { tabs: shown, activeTabId: active, closing };
}

/**
 * The built-in browser's snapshot. While it is the chosen backend, a list from the shell is
 * also word that the browser runs.
 */
function applyTabs(
  state: BrowserState,
  tabs: BuiltinBrowserTab[],
  activeTabId: number | null,
): BrowserState {
  const registry = applyRegistry(
    { tabs: state.tabs, activeTabId: state.activeTabId, closing: state.closing },
    tabs,
    activeTabId,
  );
  return {
    ...state,
    ...registry,
    ...(state.backend === "builtin" ? { available: true, reason: null } : {}),
  };
}

/** The state with `backends`' entry for `info.backend` replaced, and the top-level availability following the chosen one. */
function withBackendInfo(state: BrowserState, info: BrowserBackendInfo): BrowserState {
  const backends = state.backends.map((entry) => (entry.backend === info.backend ? info : entry));
  return state.backend === info.backend
    ? { ...state, backends, available: info.available, reason: info.reason ?? null }
    : { ...state, backends };
}

/** A paired Chrome as GET /status's chrome entry carries it. */
function extensionInfo(record: BrowserExtensionRecord): BrowserBackendInfo["extension"] {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    connected: record.connected,
    lastSeenAt: record.lastSeenAt,
  };
}

/**
 * The chrome entry after the server's word on the user's Chrome. A connection makes it
 * drivable; a disconnection does not, unless the admin's switch is why; a replacement names the
 * new Chrome and waits for it to connect; a revoked Chrome that was the one shown goes, and the
 * status read that follows says whether another is still paired.
 */
function chromeAfter(
  info: BrowserBackendInfo,
  event: Extract<BuiltinBrowserServerEvent, { type: "builtin_browser_extension" }>,
): BrowserBackendInfo {
  const record = event.extension;
  switch (event.state) {
    case "connected": {
      const shown =
        record !== undefined ? extensionInfo(record) : info.extension && { ...info.extension };
      return {
        backend: "chrome",
        available: true,
        ...(shown !== undefined ? { extension: { ...shown, connected: true } } : {}),
      };
    }
    case "disconnected": {
      const shown =
        record !== undefined ? extensionInfo(record) : info.extension && { ...info.extension };
      return {
        backend: "chrome",
        available: false,
        reason:
          info.reason === "extension_disabled" ? "extension_disabled" : "extension_disconnected",
        ...(shown !== undefined ? { extension: { ...shown, connected: false } } : {}),
      };
    }
    case "replaced":
      return record !== undefined ? { ...info, extension: extensionInfo(record) } : info;
    case "revoked": {
      if (record === undefined || info.extension?.id !== record.id) return info;
      const { extension: _revoked, ...rest } = info;
      return {
        ...rest,
        available: false,
        reason:
          info.reason === "extension_disabled" ? "extension_disabled" : "extension_disconnected",
      };
    }
  }
}

function applyEvent(state: BrowserState, event: BuiltinBrowserServerEvent): BrowserState {
  switch (event.type) {
    case "builtin_browser_tabs":
      return event.backend === "chrome"
        ? { ...state, chrome: applyRegistry(state.chrome, event.tabs, event.activeTabId) }
        : applyTabs(state, event.tabs, event.activeTabId);
    case "builtin_browser_open": {
      // Only a window that can host a guest takes the request; a replayed event must not
      // create a second guest for the same request.
      if (!state.supported || state.guests.some((guest) => guest.requestId === event.requestId))
        return state;
      const guest: BrowserGuest = {
        key: guestKey(event.requestId),
        // A webview with no address never creates its page, so it would never be claimed.
        src: event.url === "" ? BLANK_URL : event.url,
        requestId: event.requestId,
        tabId: null,
        activate: event.activate,
      };
      // A request from the shell is word that the built-in browser runs, while it is the one chosen.
      const running = state.backend === "builtin" ? { available: true, reason: null } : {};
      return { ...state, ...running, guests: [...state.guests, guest] };
    }
    case "builtin_browser_close":
      return closeTab(state, event.tabId);
    case "builtin_browser_metrics":
      return { ...state, metrics: event.metrics };
    case "builtin_browser_activity": {
      if (!event.busy) return { ...state, activity: withoutActivity(state.activity, event.tabId) };
      const mark: BrowserActivity =
        event.sessionId !== undefined
          ? { action: event.action, sessionId: event.sessionId }
          : { action: event.action };
      return { ...state, activity: { ...state.activity, [event.tabId]: mark } };
    }
    case "builtin_browser_backend": {
      if (event.backend === state.backend) return state;
      // Until the status read that follows, the new backend is as its entry last said.
      const info = state.backends.find((entry) => entry.backend === event.backend);
      return {
        ...state,
        backend: event.backend,
        available: info?.available === true,
        reason: info?.reason ?? null,
        activity: {},
      };
    }
    case "builtin_browser_extension": {
      const extension: ExtensionNews = { seq: state.extension.seq + 1, last: event.state };
      const info = state.backends.find((entry) => entry.backend === "chrome");
      const next = { ...state, extension };
      return info === undefined ? next : withBackendInfo(next, chromeAfter(info, event));
    }
  }
}

/** Drops a tab everywhere this window knows it: its guest, its strip entry, its activity mark. */
function closeTab(state: BrowserState, tabId: number): BrowserState {
  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  // The server names the next active tab in its next snapshot; until then the newest one
  // left stands in, which is the server's own fallback.
  const activeTabId =
    state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
  return {
    ...state,
    tabs,
    activeTabId,
    guests: state.guests.filter((guest) => guest.tabId !== tabId),
    activity: withoutActivity(state.activity, tabId),
  };
}

export function reduceBrowser(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "supported":
      if (state.supported === action.supported) return state;
      // A window that stops hosting (the layer unmounting on sign-out) takes its pages with it.
      return action.supported
        ? { ...state, supported: true }
        : { ...state, supported: false, guests: [], activity: {} };
    case "status": {
      const { status } = action;
      // A server older than the backends answers for the built-in browser alone.
      const backend = status.backend ?? "builtin";
      const moved = backend === state.backend ? state : { ...state, backend, activity: {} };
      const next =
        backend === "chrome"
          ? { ...moved, chrome: applyRegistry(moved.chrome, status.tabs, status.activeTabId) }
          : applyTabs(moved, status.tabs, status.activeTabId);
      return {
        ...next,
        backends: status.backends ?? [],
        available: status.available,
        reason: status.reason ?? null,
        metrics: status.metrics ?? next.metrics,
      };
    }
    case "unreachable":
      return { ...state, available: false, reason: null, backends: [] };
    case "event":
      return applyEvent(state, action.event);
    case "attached": {
      // One guest per tab id: a guest reporting an id another guest already holds is the
      // same page seen twice, and the first keeps it.
      if (state.guests.some((guest) => guest.tabId === action.tabId && guest.key !== action.key))
        return state;
      const guests = state.guests.map((guest) =>
        guest.key === action.key && guest.tabId === null
          ? { ...guest, tabId: action.tabId }
          : guest,
      );
      return { ...state, guests };
    }
    case "rejected":
      return { ...state, guests: state.guests.filter((guest) => guest.key !== action.key) };
    case "closed": {
      const next = closeTab(state, action.tabId);
      return next.closing.includes(action.tabId)
        ? next
        : { ...next, closing: [...next.closing, action.tabId] };
    }
    case "chrome-closed": {
      const { chrome } = state;
      const tabs = chrome.tabs.filter((tab) => tab.id !== action.tabId);
      const activeTabId =
        chrome.activeTabId === action.tabId
          ? (tabs[tabs.length - 1]?.id ?? null)
          : chrome.activeTabId;
      const closing = chrome.closing.includes(action.tabId)
        ? chrome.closing
        : [...chrome.closing, action.tabId];
      return {
        ...state,
        chrome: { tabs, activeTabId, closing },
        activity: withoutActivity(state.activity, action.tabId),
      };
    }
    case "activated": {
      if ((action.backend ?? "builtin") === "chrome") {
        return state.chrome.activeTabId === action.tabId
          ? state
          : { ...state, chrome: { ...state.chrome, activeTabId: action.tabId } };
      }
      return state.activeTabId === action.tabId ? state : { ...state, activeTabId: action.tabId };
    }
    case "resync":
      return { ...state, activity: {} };
    case "settings":
      return state.homepage === action.settings.homepage
        ? state
        : { ...state, homepage: action.settings.homepage };
    case "opening":
      return { ...state, opening: Math.max(0, state.opening + action.delta) };
  }
}

// ------------------------------------------------------------------------------ selectors

/** The chrome entry of the server's backends: whether this user's Chrome is offered, paired, connected. */
export function chromeInfo(state: BrowserState): BrowserBackendInfo | null {
  return state.backends.find((entry) => entry.backend === "chrome") ?? null;
}

/** Whether this window can show the built-in browser now: it hosts pages, and it is the chosen, running backend. */
export function builtinUsable(state: BrowserState): boolean {
  return state.supported && state.backend === "builtin" && state.available;
}

/**
 * Whether the dock offers the browser at all: wherever the server offers the user's Chrome
 * (every window, `<webview>` or not), and where this window can host the built-in browser and
 * the server can drive it.
 */
export function browserOffered(state: BrowserState): boolean {
  return chromeInfo(state) !== null || builtinUsable(state);
}

/**
 * Where a link from the conversation would open now: in a new built-in tab, in a new tab of the
 * user's Chrome, or nowhere when the chosen backend cannot be driven.
 */
export function linkTarget(state: BrowserState): BrowserBackend | null {
  if (builtinUsable(state)) return "builtin";
  return state.backend === "chrome" && state.available ? "chrome" : null;
}

/** The built-in browser's tab on top (the one its layer lays over the panel). */
export function activeTab(state: BrowserState): BuiltinBrowserTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

/** The chosen backend's tabs: what the panel's strip lists. */
export function shownTabs(state: BrowserState): BrowserRegistry {
  return state.backend === "chrome"
    ? state.chrome
    : { tabs: state.tabs, activeTabId: state.activeTabId, closing: state.closing };
}

/** The chosen backend's active tab. */
export function shownActiveTab(state: BrowserState): BuiltinBrowserTab | null {
  const { tabs, activeTabId } = shownTabs(state);
  return tabs.find((tab) => tab.id === activeTabId) ?? null;
}

export function guestByKey(state: BrowserState, key: string): BrowserGuest | null {
  return state.guests.find((guest) => guest.key === key) ?? null;
}

export function guestForTab(state: BrowserState, tabId: number | null): BrowserGuest | null {
  if (tabId === null) return null;
  return state.guests.find((guest) => guest.tabId === tabId) ?? null;
}

/**
 * A tab's address as this window shows it: its page's, or while its first page is still on its
 * way, the address this window created the page at (address.ts `tabAddress`).
 */
export function addressOf(state: BrowserState, tab: BuiltinBrowserTab): string {
  return tabAddress(tab, guestForTab(state, tab.id)?.src ?? null);
}

/**
 * Whether this window should open the new-tab page by itself: its browser panel is on screen,
 * the browser can be used, and it has no tab, none open and none on its way. A tab on its way
 * is a page this window is creating or has created and the registry does not list yet (from any
 * window's, the agent's or a page's request), or a request of its own not yet answered, whose
 * page this window has not been asked for yet.
 */
export function wantsNewTabPage(state: BrowserState, panelOnScreen: boolean): boolean {
  return (
    panelOnScreen &&
    builtinUsable(state) &&
    state.tabs.length === 0 &&
    state.guests.length === 0 &&
    state.opening === 0
  );
}

/** The mark of an agent working in the browser, the active tab's first when it is one of them. */
export function currentActivity(state: BrowserState): BrowserActivity | null {
  const { activeTabId } = shownTabs(state);
  if (activeTabId !== null) {
    const active = state.activity[activeTabId];
    if (active !== undefined) return active;
  }
  const first = Object.values(state.activity)[0];
  return first ?? null;
}

/** Whether an agent is working in this tab right now. */
export function tabBusy(state: BrowserState, tabId: number): boolean {
  return state.activity[tabId] !== undefined;
}

/**
 * Whether an event should bring the browser's dock tab on screen: an agent opened a page or
 * started acting for the conversation the user is looking at, and the browser is not already
 * showing. Once per conversation: after the first reveal, hiding the browser is the user's
 * answer, and every later step of the same agent run popping it back open would fight it.
 */
export function shouldReveal(
  event: BuiltinBrowserServerEvent,
  onScreen: { conversation: string; browserShown: boolean },
  revealed: ReadonlySet<string>,
): boolean {
  const sessionId =
    event.type === "builtin_browser_open" ||
    (event.type === "builtin_browser_activity" && event.busy)
      ? event.sessionId
      : undefined;
  return (
    sessionId !== undefined &&
    sessionId === onScreen.conversation &&
    !onScreen.browserShown &&
    !revealed.has(sessionId)
  );
}
