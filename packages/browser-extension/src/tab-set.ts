/**
 * The driven-tab set: which Chrome tabs each paired server may drive, and the Penguin tab group
 * each server has in each window. A pure reducer: an action in, the next state and the effects
 * the caller must carry out (tell a server, group or ungroup a tab, stop debugging it) out.
 *
 * A tab becomes drivable in exactly two ways: the server opened it (`created`), or the user
 * handed it over with the toolbar icon (`adopted`). A page a driven tab opens (`popup`) joins its
 * opener's server. Nothing else, so the agent never sees the user's other tabs.
 *
 * A tab stops being drivable when it closes (the server hears `tab-closed`), when the user drags
 * it out of its group or stops the debugger (`tab-released`), or when its server is forgotten.
 * A released tab stays in the set, and in its group, until the user adds it again: nothing
 * re-attaches to it without that gesture.
 *
 * The state is plain JSON: it is kept in `chrome.storage.session`, so a worker restart keeps it.
 */
import type { TabReleaseReason } from "./wire.js";

export type TabOrigin = "created" | "user" | "popup";

export interface DrivenTab {
  tabId: number;
  /** The origin of the paired server that drives the tab. */
  server: string;
  windowId: number;
  how: TabOrigin;
  openerTabId?: number;
  /** The Penguin group the tab sits in; absent until grouped, or in a window that holds no groups. */
  groupId?: number;
  released?: TabReleaseReason;
}

export interface TabSetState {
  tabs: Record<string, DrivenTab>;
  /** `groupKey(server, windowId)` → the server's Penguin group in that window. */
  groups: Record<string, number>;
}

export type TabSetAction =
  | { type: "created"; tabId: number; windowId: number; server: string }
  | { type: "adopted"; tabId: number; windowId: number; server: string }
  | { type: "popup"; tabId: number; windowId: number; openerTabId: number }
  | { type: "grouped"; tabId: number; groupId: number }
  | { type: "group-changed"; tabId: number; groupId: number; windowId: number }
  | { type: "group-removed"; groupId: number }
  | { type: "released"; tabIds: readonly number[]; reason: TabReleaseReason }
  | { type: "release-all"; reason: TabReleaseReason }
  /** The user took the tab back (the popup's Release): it leaves the set and its group. */
  | { type: "returned"; tabId: number }
  | { type: "removed"; tabId: number }
  | { type: "server-forgotten"; server: string };

export type TabSetEffect =
  /** Announce the tab (its url, title, loading state) to its server. */
  | { type: "announce"; server: string; tabId: number }
  | { type: "closed"; server: string; tabId: number }
  | { type: "released"; server: string; tabId: number; reason: TabReleaseReason }
  /** Put the tab into its server's group in its window, creating the group when there is none. */
  | { type: "group"; server: string; tabId: number; windowId: number }
  | { type: "ungroup"; tabIds: number[] }
  /** Stop debugging the tab (the agent may no longer drive it). */
  | { type: "detach"; tabId: number };

export interface TabSetResult {
  state: TabSetState;
  effects: TabSetEffect[];
}

export const emptyTabSet = (): TabSetState => ({ tabs: {}, groups: {} });

export const groupKey = (server: string, windowId: number): string => `${windowId} ${server}`;

export const serverOfGroupKey = (key: string): string => key.slice(key.indexOf(" ") + 1);

/** The windows a server already has a group in, most recent first. */
export function windowsOf(state: TabSetState, server: string): number[] {
  return Object.keys(state.groups)
    .filter((key) => serverOfGroupKey(key) === server)
    .map((key) => Number(key.slice(0, key.indexOf(" "))))
    .reverse();
}

export function lookup(state: TabSetState, tabId: number): DrivenTab | undefined {
  return state.tabs[String(tabId)];
}

/** The tabs a server may drive now (released ones excluded), in the order they joined. */
export function drivenTabs(state: TabSetState, server: string): DrivenTab[] {
  return Object.values(state.tabs).filter((tab) => tab.server === server && !tab.released);
}

/** How many tabs every server together may drive (the toolbar badge). */
export function drivenCount(state: TabSetState): number {
  return Object.values(state.tabs).filter((tab) => !tab.released).length;
}

export function groupOf(state: TabSetState, server: string, windowId: number): number | undefined {
  return state.groups[groupKey(server, windowId)];
}

function withTab(state: TabSetState, tab: DrivenTab): TabSetState {
  return { ...state, tabs: { ...state.tabs, [String(tab.tabId)]: tab } };
}

function withoutTab(state: TabSetState, tabId: number): TabSetState {
  const tabs = { ...state.tabs };
  delete tabs[String(tabId)];
  return { ...state, tabs };
}

/** A tab joins `server`: announced, grouped. */
function join(state: TabSetState, tab: DrivenTab): TabSetResult {
  return {
    state: withTab(state, tab),
    effects: [
      { type: "group", server: tab.server, tabId: tab.tabId, windowId: tab.windowId },
      { type: "announce", server: tab.server, tabId: tab.tabId },
    ],
  };
}

function release(
  state: TabSetState,
  tabIds: readonly number[],
  reason: TabReleaseReason,
): TabSetResult {
  let next = state;
  const effects: TabSetEffect[] = [];
  for (const tabId of tabIds) {
    const tab = lookup(next, tabId);
    if (tab === undefined || tab.released !== undefined) continue;
    next = withTab(next, { ...tab, released: reason });
    effects.push({ type: "released", server: tab.server, tabId, reason });
    effects.push({ type: "detach", tabId });
  }
  return { state: next, effects };
}

export function reduce(state: TabSetState, action: TabSetAction): TabSetResult {
  switch (action.type) {
    case "created":
      return join(state, {
        tabId: action.tabId,
        server: action.server,
        windowId: action.windowId,
        how: "created",
      });

    case "adopted": {
      const current = lookup(state, action.tabId);
      if (current !== undefined && current.released === undefined) {
        if (current.server === action.server) return { state, effects: [] };
        // Handed from one server to another: the first one hears it is gone.
        const moved = release(state, [action.tabId], "user");
        const joined = join(withoutTab(moved.state, action.tabId), {
          tabId: action.tabId,
          server: action.server,
          windowId: action.windowId,
          how: "user",
        });
        return {
          state: joined.state,
          effects: [...moved.effects.filter((e) => e.type !== "detach"), ...joined.effects],
        };
      }
      // New, or released and handed over again. Its group id is forgotten until the grouping
      // lands, so the group change that grouping causes is never read as a drag-out.
      return join(state, {
        tabId: action.tabId,
        server: action.server,
        windowId: action.windowId,
        how: "user",
      });
    }

    case "popup": {
      const opener = lookup(state, action.openerTabId);
      if (opener === undefined || opener.released !== undefined) return { state, effects: [] };
      if (lookup(state, action.tabId) !== undefined) return { state, effects: [] };
      return join(state, {
        tabId: action.tabId,
        server: opener.server,
        windowId: action.windowId,
        how: "popup",
        openerTabId: action.openerTabId,
      });
    }

    case "grouped": {
      const tab = lookup(state, action.tabId);
      if (tab === undefined) return { state, effects: [] };
      const next = withTab(state, { ...tab, groupId: action.groupId });
      return {
        state: {
          ...next,
          groups: { ...next.groups, [groupKey(tab.server, tab.windowId)]: action.groupId },
        },
        effects: [],
      };
    }

    case "group-changed": {
      const tab = lookup(state, action.tabId);
      if (tab === undefined) return { state, effects: [] };
      // Not grouped yet (our own grouping is in flight) or never groupable: only follow it.
      if (tab.groupId === undefined || tab.groupId === action.groupId) {
        return { state: withTab(state, { ...tab, windowId: action.windowId }), effects: [] };
      }
      // Dragged out of its group (or into another window): the user took it back.
      const released = release(state, [action.tabId], "user");
      return { state: withoutTab(released.state, action.tabId), effects: released.effects };
    }

    case "group-removed": {
      const groups = Object.fromEntries(
        Object.entries(state.groups).filter(([, groupId]) => groupId !== action.groupId),
      );
      return { state: { ...state, groups }, effects: [] };
    }

    case "released":
      return release(state, action.tabIds, action.reason);

    case "release-all":
      return release(
        state,
        Object.values(state.tabs).map((tab) => tab.tabId),
        action.reason,
      );

    case "returned": {
      const tab = lookup(state, action.tabId);
      if (tab === undefined) return { state, effects: [] };
      const released = release(state, [action.tabId], "user");
      return {
        state: withoutTab(released.state, action.tabId),
        effects: [
          ...released.effects,
          ...(tab.groupId !== undefined ? [{ type: "ungroup" as const, tabIds: [tab.tabId] }] : []),
        ],
      };
    }

    case "removed": {
      const tab = lookup(state, action.tabId);
      if (tab === undefined) return { state, effects: [] };
      return {
        state: withoutTab(state, action.tabId),
        effects:
          tab.released === undefined
            ? [
                { type: "closed", server: tab.server, tabId: tab.tabId },
                { type: "detach", tabId: tab.tabId },
              ]
            : [],
      };
    }

    case "server-forgotten": {
      const gone = Object.values(state.tabs).filter((tab) => tab.server === action.server);
      const tabs = Object.fromEntries(
        Object.entries(state.tabs).filter(([, tab]) => tab.server !== action.server),
      );
      const groups = Object.fromEntries(
        Object.entries(state.groups).filter(([key]) => serverOfGroupKey(key) !== action.server),
      );
      const grouped = gone.filter((tab) => tab.groupId !== undefined).map((tab) => tab.tabId);
      return {
        state: { tabs, groups },
        effects: [
          ...(grouped.length > 0 ? [{ type: "ungroup" as const, tabIds: grouped }] : []),
          ...gone.map((tab) => ({ type: "detach" as const, tabId: tab.tabId })),
        ],
      };
    }
  }
}

/** A stored state read back defensively: anything malformed is dropped, never trusted. */
export function parseTabSet(value: unknown): TabSetState {
  const state = emptyTabSet();
  if (typeof value !== "object" || value === null) return state;
  const { tabs, groups } = value as { tabs?: unknown; groups?: unknown };
  if (typeof tabs === "object" && tabs !== null) {
    for (const raw of Object.values(tabs as Record<string, unknown>)) {
      if (typeof raw !== "object" || raw === null) continue;
      const tab = raw as Partial<DrivenTab>;
      if (!Number.isSafeInteger(tab.tabId) || !Number.isSafeInteger(tab.windowId)) continue;
      if (typeof tab.server !== "string") continue;
      if (tab.how !== "created" && tab.how !== "user" && tab.how !== "popup") continue;
      state.tabs[String(tab.tabId)] = {
        tabId: tab.tabId as number,
        server: tab.server,
        windowId: tab.windowId as number,
        how: tab.how,
        ...(Number.isSafeInteger(tab.openerTabId) ? { openerTabId: tab.openerTabId } : {}),
        ...(Number.isSafeInteger(tab.groupId) ? { groupId: tab.groupId } : {}),
        ...(tab.released === "user" || tab.released === "detached" || tab.released === "restricted"
          ? { released: tab.released }
          : {}),
      };
    }
  }
  if (typeof groups === "object" && groups !== null) {
    for (const [key, groupId] of Object.entries(groups as Record<string, unknown>)) {
      if (Number.isSafeInteger(groupId) && key.includes(" ")) state.groups[key] = groupId as number;
    }
  }
  return state;
}
