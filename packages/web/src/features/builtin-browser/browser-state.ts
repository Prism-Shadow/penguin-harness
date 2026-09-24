/**
 * The built-in browser's state in this window, as a pure reducer.
 *
 * Two lists, from two sources:
 * - `tabs` is the SERVER's registry — what the desktop shell reports about every guest page
 *   (address, title, loading, history) and which one is active. The strip and the toolbar
 *   render from it, and the user channel's `builtin_browser_tabs` event replaces it whole.
 * - `guests` are the `<webview>` elements THIS window hosts, in creation order. A guest starts
 *   from a `builtin_browser_open` request, learns its tab id once it attaches, and is removed
 *   by a close. The order is the DOM order of the elements and must never change: moving a
 *   webview in the DOM reloads its page, so guests are only ever appended or removed.
 *
 * Activity (`builtin_browser_activity`) marks the tabs an agent is working in right now.
 */
import type {
  BuiltinBrowserAction,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "@prismshadow/penguin-server/api";
import { BLANK_URL } from "./address";

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

export interface BrowserState {
  /** This window can host guests at all: Electron's `<webview>` element exists here. */
  supported: boolean;
  /** The server can drive the browser (desktop shell connected and new enough). */
  available: boolean;
  /** Why not, when the server said so. */
  reason: BuiltinBrowserStatus["reason"] | null;
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  guests: BrowserGuest[];
  /** Tabs an agent is acting on right now, by tab id. */
  activity: Readonly<Record<number, BrowserActivity>>;
  /**
   * Tabs this window closed and the server has not yet dropped. A registry snapshot published
   * before the close would otherwise put a closed tab back in the strip for a moment.
   */
  closing: readonly number[];
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
  /** The user brought a tab to the front here; the server confirms with a tabs event. */
  | { type: "activated"; tabId: number }
  /** Events may have been lost: activity marks can no longer be trusted. */
  | { type: "resync" };

export const INITIAL_BROWSER_STATE: BrowserState = {
  supported: false,
  available: false,
  reason: null,
  tabs: [],
  activeTabId: null,
  guests: [],
  activity: {},
  closing: [],
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
function applyTabs(
  state: BrowserState,
  tabs: BuiltinBrowserTab[],
  activeTabId: number | null,
): BrowserState {
  const listed = new Set(tabs.map((tab) => tab.id));
  const closing = state.closing.filter((id) => listed.has(id));
  const shown = closing.length === 0 ? tabs : tabs.filter((tab) => !closing.includes(tab.id));
  const active = activeTabId !== null && closing.includes(activeTabId) ? null : activeTabId;
  return { ...state, available: true, reason: null, tabs: shown, activeTabId: active, closing };
}

function applyEvent(state: BrowserState, event: BuiltinBrowserServerEvent): BrowserState {
  switch (event.type) {
    case "builtin_browser_tabs":
      return applyTabs(state, event.tabs, event.activeTabId);
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
      return { ...state, available: true, reason: null, guests: [...state.guests, guest] };
    }
    case "builtin_browser_close":
      return closeTab(state, event.tabId);
    case "builtin_browser_activity": {
      if (!event.busy) return { ...state, activity: withoutActivity(state.activity, event.tabId) };
      const mark: BrowserActivity =
        event.sessionId !== undefined
          ? { action: event.action, sessionId: event.sessionId }
          : { action: event.action };
      return { ...state, activity: { ...state.activity, [event.tabId]: mark } };
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
      const next = applyTabs(state, status.tabs, status.activeTabId);
      return { ...next, available: status.available, reason: status.reason ?? null };
    }
    case "unreachable":
      return { ...state, available: false, reason: null };
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
    case "activated":
      return state.activeTabId === action.tabId ? state : { ...state, activeTabId: action.tabId };
    case "resync":
      return { ...state, activity: {} };
  }
}

// ------------------------------------------------------------------------------ selectors

/** Whether the dock offers the browser at all. */
export function browserOffered(state: BrowserState): boolean {
  return state.supported && state.available;
}

export function activeTab(state: BrowserState): BuiltinBrowserTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function guestByKey(state: BrowserState, key: string): BrowserGuest | null {
  return state.guests.find((guest) => guest.key === key) ?? null;
}

export function guestForTab(state: BrowserState, tabId: number | null): BrowserGuest | null {
  if (tabId === null) return null;
  return state.guests.find((guest) => guest.tabId === tabId) ?? null;
}

/** The mark of an agent working in the browser, the active tab's first when it is one of them. */
export function currentActivity(state: BrowserState): BrowserActivity | null {
  if (state.activeTabId !== null) {
    const active = state.activity[state.activeTabId];
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
