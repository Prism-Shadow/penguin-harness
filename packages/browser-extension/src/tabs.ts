/**
 * The driven-tab set (tab-set.ts) applied to Chrome: opening, closing and focusing a server's
 * tabs, keeping each server's Penguin group in each window, following Chrome's tab events, and
 * telling each server what changed for its tabs (and nothing about any other tab).
 */
import { isRestrictedUrl } from "./policy.js";
import {
  drivenTabs,
  emptyTabSet,
  groupOf,
  lookup,
  reduce,
  serverOfGroupKey,
  windowsOf,
  type DrivenTab,
  type TabSetAction,
  type TabSetEffect,
  type TabSetState,
} from "./tab-set.js";
import type { BuiltinBrowserTab, DesktopBrowserEvent, TabReleaseReason } from "./wire.js";

/** The group colour every Penguin group gets. */
export const GROUP_COLOR = "blue";

/** The longest favicon a tab event carries (the server drops longer ones the same way). */
const MAX_DATA_FAVICON_CHARS = 4 * 1024;
const MAX_FAVICON_URL_CHARS = 2 * 1024;

export class TabRefusal extends Error {
  constructor(readonly code: "no_such_tab" | "tab_released") {
    super(code);
    this.name = "TabRefusal";
  }
}

export interface TabControllerOptions {
  state?: TabSetState;
  /** Delivers an event to one server (dropped while it is not connected). */
  send(server: string, event: DesktopBrowserEvent): void;
  /** Stops debugging a tab. */
  detach(tabId: number): void;
  /** The title of a server's group: "Penguin", or "Penguin · <label>" beside other servers. */
  groupTitle(server: string): string;
  /** Called with every new state (to persist it and refresh the toolbar). */
  onChange?(state: TabSetState): void;
  log?(line: string): void;
}

/** A Chrome tab as the server's registry holds it. */
export function toWireTab(tab: chrome.tabs.Tab): BuiltinBrowserTab {
  const favicon = tab.favIconUrl;
  const limit = favicon?.startsWith("data:") ? MAX_DATA_FAVICON_CHARS : MAX_FAVICON_URL_CHARS;
  return {
    id: tab.id ?? -1,
    url: tab.url || tab.pendingUrl || "",
    title: tab.title ?? "",
    loading: tab.status === "loading",
    canGoBack: false,
    canGoForward: false,
    ...(favicon !== undefined && favicon !== "" && favicon.length <= limit ? { favicon } : {}),
  };
}

export class TabController {
  private state: TabSetState;
  /** Effects run one batch at a time, so grouping calls never interleave. */
  private work: Promise<void> = Promise.resolve();
  private readonly log: (line: string) => void;

  constructor(private readonly options: TabControllerOptions) {
    this.state = options.state ?? emptyTabSet();
    this.log = options.log ?? (() => {});
  }

  /**
   * A stored state brought back after a worker restart: tabs and groups Chrome no longer has are
   * dropped without a word (no server is connected yet; each re-reads its tabs on `hello`).
   */
  static async restore(stored: TabSetState): Promise<TabSetState> {
    const state: TabSetState = { tabs: {}, groups: {} };
    for (const [key, tab] of Object.entries(stored.tabs)) {
      if (await exists(() => chrome.tabs.get(tab.tabId))) state.tabs[key] = tab;
    }
    for (const [key, groupId] of Object.entries(stored.groups)) {
      if (await exists(() => chrome.tabGroups.get(groupId))) state.groups[key] = groupId;
    }
    return state;
  }

  get snapshot(): TabSetState {
    return this.state;
  }

  owner(tabId: number): DrivenTab | undefined {
    return lookup(this.state, tabId);
  }

  /** The tab, if this server may drive it now; otherwise the refusal the server is answered. */
  drivable(server: string, tabId: number): DrivenTab {
    const tab = lookup(this.state, tabId);
    if (tab === undefined || tab.server !== server) throw new TabRefusal("no_such_tab");
    if (tab.released !== undefined) throw new TabRefusal("tab_released");
    return tab;
  }

  /** Applies one action now; its effects run after any still running. Resolves when they ran. */
  dispatch(action: TabSetAction): Promise<void> {
    const { state, effects } = reduce(this.state, action);
    if (state !== this.state) {
      this.state = state;
      this.options.onChange?.(state);
    }
    if (effects.length === 0) return this.work;
    const run = this.work.then(() => this.run(effects));
    this.work = run.catch(() => {});
    return run;
  }

  /** `open-tab`: a new tab in the server's group (its window, or the last focused one). */
  async open(server: string, url: string, activate: boolean): Promise<BuiltinBrowserTab> {
    const windowId = await this.windowFor(server);
    let tab: chrome.tabs.Tab | undefined;
    if (windowId === undefined) {
      const window = await chrome.windows.create({ url, focused: activate, type: "normal" });
      tab = window?.tabs?.[0];
    } else {
      tab = await chrome.tabs.create({ url, active: activate, windowId });
      if (activate) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
    }
    if (tab?.id === undefined) throw new Error("Chrome did not open the tab.");
    await this.dispatch({ type: "created", tabId: tab.id, windowId: tab.windowId, server });
    const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
    return toWireTab(fresh);
  }

  /** `tabs`: the server's drivable tabs as Chrome has them now. */
  async list(server: string): Promise<BuiltinBrowserTab[]> {
    const out: BuiltinBrowserTab[] = [];
    for (const driven of drivenTabs(this.state, server)) {
      try {
        out.push(toWireTab(await chrome.tabs.get(driven.tabId)));
      } catch {
        void this.dispatch({ type: "removed", tabId: driven.tabId });
      }
    }
    return out;
  }

  async close(server: string, tabId: number): Promise<void> {
    this.drivable(server, tabId);
    await chrome.tabs.remove(tabId);
  }

  /** Shows the tab in Chrome: selected in its window, the window focused. */
  async activate(server: string, tabId: number): Promise<void> {
    this.drivable(server, tabId);
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  }

  /**
   * The user hands a tab over (the toolbar icon, the popup). Refused for a page the extension may
   * not debug. Also how a released tab becomes drivable again.
   */
  async adopt(server: string, tabId: number): Promise<"adopted" | "restricted"> {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url || tab.pendingUrl)) return "restricted";
    await this.dispatch({ type: "adopted", tabId, windowId: tab.windowId, server });
    return "adopted";
  }

  release(tabIds: readonly number[], reason: TabReleaseReason): Promise<void> {
    return this.dispatch({ type: "released", tabIds, reason });
  }

  /** The user takes a tab back: the server hears it is released, and it leaves the group. */
  giveBack(tabId: number): Promise<void> {
    return this.dispatch({ type: "returned", tabId });
  }

  releaseAll(reason: TabReleaseReason): Promise<void> {
    return this.dispatch({ type: "release-all", reason });
  }

  /** A server was removed or revoked: its tabs leave their groups and stop being driven. */
  forgetServer(server: string): Promise<void> {
    return this.dispatch({ type: "server-forgotten", server });
  }

  /** Renames every group (the number of paired servers changed). */
  async retitle(): Promise<void> {
    for (const [key, groupId] of Object.entries(this.state.groups)) {
      await chrome.tabGroups
        .update(groupId, { title: this.options.groupTitle(serverOfGroupKey(key)) })
        .catch(() => {});
    }
  }

  // --- Chrome's tab events -------------------------------------------------------------------

  onUpdated(tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void {
    if (lookup(this.state, tabId) === undefined) return;
    if (change.groupId !== undefined) void this.followGroup(tabId);
    const driven = lookup(this.state, tabId);
    if (driven === undefined || driven.released !== undefined) return;
    if (
      change.url !== undefined ||
      change.title !== undefined ||
      change.status !== undefined ||
      change.favIconUrl !== undefined
    ) {
      this.options.send(driven.server, { kind: "tab", tab: toWireTab(tab) });
    }
  }

  onRemoved(tabId: number): void {
    void this.dispatch({ type: "removed", tabId });
  }

  /**
   * A driven tab's group changed. Chrome also takes a tab out of its group as it closes it, just
   * before `onRemoved`, so the tab is read back first: a closing tab is gone by then, and its
   * close is reported as one. A tab still there is compared as it is now, not as the event said.
   */
  private async followGroup(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) return;
    await this.dispatch({
      type: "group-changed",
      tabId,
      groupId: tab.groupId,
      windowId: tab.windowId,
    });
  }

  /** A page a driven tab opened (window.open, target=_blank) joins its opener's server. */
  async onCreatedNavigationTarget(sourceTabId: number, tabId: number): Promise<void> {
    const opener = lookup(this.state, sourceTabId);
    if (opener === undefined || opener.released !== undefined) return;
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    await this.dispatch({ type: "popup", tabId, windowId: tab.windowId, openerTabId: sourceTabId });
  }

  onGroupRemoved(groupId: number): void {
    void this.dispatch({ type: "group-removed", groupId });
  }

  // --- effects -------------------------------------------------------------------------------

  private async run(effects: TabSetEffect[]): Promise<void> {
    for (const effect of effects) {
      try {
        await this.apply(effect);
      } catch (err) {
        this.log(`tab set: '${effect.type}' failed: ${messageOf(err)}`);
      }
    }
  }

  private async apply(effect: TabSetEffect): Promise<void> {
    switch (effect.type) {
      case "announce": {
        const tab = await chrome.tabs.get(effect.tabId).catch(() => undefined);
        if (tab !== undefined)
          this.options.send(effect.server, { kind: "tab", tab: toWireTab(tab) });
        return;
      }
      case "closed":
        this.options.send(effect.server, { kind: "tab-closed", tabId: effect.tabId });
        return;
      case "released":
        this.options.send(effect.server, {
          kind: "tab-released",
          tabId: effect.tabId,
          reason: effect.reason,
        });
        return;
      case "group":
        await this.group(effect.server, effect.tabId, effect.windowId);
        return;
      case "ungroup": {
        const [first, ...rest] = effect.tabIds;
        if (first !== undefined) await chrome.tabs.ungroup([first, ...rest]).catch(() => {});
        return;
      }
      case "detach":
        this.options.detach(effect.tabId);
        return;
    }
  }

  /** Into the server's group in the tab's window; a new group when there is none (yet). */
  private async group(server: string, tabId: number, windowId: number): Promise<void> {
    let groupId: number | undefined;
    const existing = groupOf(this.state, server, windowId);
    if (existing !== undefined) {
      try {
        groupId = await chrome.tabs.group({ groupId: existing, tabIds: [tabId] });
      } catch {
        void this.dispatch({ type: "group-removed", groupId: existing });
      }
    }
    if (groupId === undefined) {
      try {
        groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
      } catch (err) {
        // A popup window holds no groups: the tab is driven without one.
        this.log(`tab ${tabId} stays ungrouped: ${messageOf(err)}`);
        return;
      }
      await chrome.tabGroups
        .update(groupId, { title: this.options.groupTitle(server), color: GROUP_COLOR })
        .catch(() => {});
    }
    if (lookup(this.state, tabId) !== undefined) {
      void this.dispatch({ type: "grouped", tabId, groupId });
    }
  }

  private async windowFor(server: string): Promise<number | undefined> {
    for (const windowId of windowsOf(this.state, server)) {
      const window = await chrome.windows.get(windowId).catch(() => undefined);
      if (window?.type === "normal") return windowId;
    }
    const focused = await chrome.windows
      .getLastFocused({ windowTypes: ["normal"] })
      .catch(() => undefined);
    return focused?.id;
  }
}

async function exists(get: () => Promise<unknown>): Promise<boolean> {
  try {
    await get();
    return true;
  } catch {
    return false;
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
