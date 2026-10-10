/**
 * The one fake of Chrome's extension APIs the unit tests share: a small in-memory browser with
 * windows, tabs, tab groups, debugger sessions and storage areas, behaving the way the real
 * APIs do where the extension depends on it (errors included). Each test file installs a fresh
 * one per test with `installChrome()` and `vi.unstubAllGlobals()` in `afterEach`.
 */
import { vi } from "vitest";

type Listener = (...args: never[]) => unknown;

export class FakeEvent<L extends Listener> {
  private readonly listeners = new Set<L>();
  addListener(listener: L): void {
    this.listeners.add(listener);
  }
  removeListener(listener: L): void {
    this.listeners.delete(listener);
  }
  fire(...args: Parameters<L>): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

export interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  pendingUrl?: string;
  title: string;
  status: "loading" | "complete";
  favIconUrl?: string;
  groupId: number;
  active: boolean;
}

export interface FakeWindow {
  id: number;
  type: "normal" | "popup";
}

export interface FakeGroup {
  id: number;
  windowId: number;
  title?: string;
  color?: string;
}

export interface CommandCall {
  tabId: number;
  method: string;
  params: object | undefined;
}

class StorageArea {
  readonly data: Record<string, unknown> = {};
  constructor(
    private readonly name: string,
    private readonly changed: FakeEvent<(changes: object, area: string) => void>,
  ) {}
  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    const wanted = keys === undefined ? Object.keys(this.data) : [keys].flat();
    const out: Record<string, unknown> = {};
    for (const key of wanted) {
      if (key in this.data) out[key] = structuredClone(this.data[key]);
    }
    return out;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, { oldValue?: unknown; newValue: unknown }> = {};
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: this.data[key], newValue: structuredClone(value) };
      this.data[key] = structuredClone(value);
    }
    this.changed.fire(changes, this.name);
  }
}

export interface FakeChrome {
  windows: Map<number, FakeWindow>;
  tabs: Map<number, FakeTab>;
  groups: Map<number, FakeGroup>;
  /** Tabs a debugger session is attached to. */
  attached: Set<number>;
  /** Every `chrome.debugger.attach` call that succeeded, in order (each one is an infobar). */
  attaches: number[];
  detaches: number[];
  commands: CommandCall[];
  /** Answers `sendCommand`; the default answers `{}`. */
  respond: (call: CommandCall) => unknown | Promise<unknown>;
  /** While set, `chrome.debugger.detach` waits for it before it detaches. */
  detachGate: Promise<void> | null;
  lastFocusedWindow: number | undefined;
  local: StorageArea;
  session: StorageArea;
  /** Adds a tab as if the user (or a page) opened it. */
  openTab(props: Partial<FakeTab> & { windowId: number; url: string }): FakeTab;
  addWindow(type?: "normal" | "popup"): FakeWindow;
  /** Chrome closes a tab (the user, or the page). */
  closeTab(tabId: number): void;
  /** The user drags a tab out of its group. */
  ungroupByUser(tabId: number): void;
  events: {
    tabUpdated: FakeEvent<(tabId: number, change: object, tab: object) => void>;
    tabRemoved: FakeEvent<(tabId: number, info: object) => void>;
    groupRemoved: FakeEvent<(group: object) => void>;
    debuggerEvent: FakeEvent<(source: object, method: string, params?: object) => void>;
    debuggerDetach: FakeEvent<(source: object, reason: string) => void>;
  };
}

export function installChrome(): FakeChrome {
  let nextTab = 100;
  let nextWindow = 1;
  let nextGroup = 500;
  const storageChanged = new FakeEvent<(changes: object, area: string) => void>();
  const events: FakeChrome["events"] = {
    tabUpdated: new FakeEvent(),
    tabRemoved: new FakeEvent(),
    groupRemoved: new FakeEvent(),
    debuggerEvent: new FakeEvent(),
    debuggerDetach: new FakeEvent(),
  };

  const fake: FakeChrome = {
    windows: new Map(),
    tabs: new Map(),
    groups: new Map(),
    attached: new Set(),
    attaches: [],
    detaches: [],
    commands: [],
    respond: () => ({}),
    detachGate: null,
    lastFocusedWindow: undefined,
    local: new StorageArea("local", storageChanged),
    session: new StorageArea("session", storageChanged),
    openTab(props) {
      const tab: FakeTab = {
        id: nextTab++,
        title: "",
        status: "complete",
        groupId: -1,
        active: false,
        ...props,
      };
      fake.tabs.set(tab.id, tab);
      return tab;
    },
    addWindow(type = "normal") {
      const window = { id: nextWindow++, type };
      fake.windows.set(window.id, window);
      if (type === "normal") fake.lastFocusedWindow = window.id;
      return window;
    },
    closeTab(tabId) {
      const tab = fake.tabs.get(tabId);
      if (tab === undefined) return;
      // As Chrome does: a grouped tab leaves its group first, then is removed.
      if (tab.groupId !== -1) {
        events.tabUpdated.fire(tabId, { groupId: -1 }, { ...tab, groupId: -1 });
      }
      fake.tabs.delete(tabId);
      fake.attached.delete(tabId);
      dropEmptyGroup(tab.groupId);
      events.tabRemoved.fire(tabId, { windowId: tab.windowId, isWindowClosing: false });
    },
    ungroupByUser(tabId) {
      setGroup(mustTab(tabId), -1);
    },
    events,
  };

  const snapshot = (tab: FakeTab) => ({ ...tab });
  const noTab = (tabId: number) => new Error(`No tab with id: ${tabId}.`);

  function mustTab(tabId: number): FakeTab {
    const tab = fake.tabs.get(tabId);
    if (tab === undefined) throw noTab(tabId);
    return tab;
  }

  function dropEmptyGroup(groupId: number): void {
    if (groupId === -1 || !fake.groups.has(groupId)) return;
    if ([...fake.tabs.values()].some((tab) => tab.groupId === groupId)) return;
    const group = fake.groups.get(groupId)!;
    fake.groups.delete(groupId);
    events.groupRemoved.fire({ ...group });
  }

  function setGroup(tab: FakeTab, groupId: number): void {
    if (tab.groupId === groupId) return;
    const before = tab.groupId;
    tab.groupId = groupId;
    events.tabUpdated.fire(tab.id, { groupId }, snapshot(tab));
    dropEmptyGroup(before);
  }

  const RESTRICTED = /^(chrome|chrome-extension|devtools|file):/;

  const api = {
    runtime: {
      id: "dodgfhpcbmkjfcbgnoidablfgjjhhmgp",
      getManifest: () => ({ version: "0.2.13" }),
      getURL: (path: string) => `chrome-extension://dodgfhpcbmkjfcbgnoidablfgjjhhmgp/${path}`,
    },
    storage: { local: fake.local, session: fake.session, onChanged: storageChanged },
    windows: {
      async get(windowId: number) {
        const window = fake.windows.get(windowId);
        if (window === undefined) throw new Error(`No window with id: ${windowId}.`);
        return { ...window };
      },
      async getLastFocused() {
        const id = fake.lastFocusedWindow;
        if (id === undefined || !fake.windows.has(id)) throw new Error("No last-focused window");
        return { ...fake.windows.get(id)! };
      },
      async create(props: { url?: string }) {
        const window = fake.addWindow("normal");
        const tab = fake.openTab({
          windowId: window.id,
          url: "",
          pendingUrl: props.url,
          active: true,
        });
        return { ...window, tabs: [snapshot(tab)] };
      },
      async update(windowId: number) {
        fake.lastFocusedWindow = windowId;
        return { ...fake.windows.get(windowId)! };
      },
    },
    tabs: {
      async get(tabId: number) {
        return snapshot(mustTab(tabId));
      },
      async create(props: { url: string; active?: boolean; windowId?: number }) {
        const windowId = props.windowId ?? fake.lastFocusedWindow;
        if (windowId === undefined || !fake.windows.has(windowId)) {
          throw new Error("No current window");
        }
        const tab = fake.openTab({
          windowId,
          url: "",
          pendingUrl: props.url,
          status: "loading",
          active: props.active ?? true,
        });
        return snapshot(tab);
      },
      async remove(tabId: number) {
        mustTab(tabId);
        fake.closeTab(tabId);
      },
      async update(tabId: number, props: { active?: boolean }) {
        const tab = mustTab(tabId);
        if (props.active === true) {
          for (const other of fake.tabs.values()) {
            if (other.windowId === tab.windowId) other.active = other.id === tabId;
          }
        }
        return snapshot(tab);
      },
      async query(query: { active?: boolean }) {
        return [...fake.tabs.values()]
          .filter((tab) => query.active === undefined || tab.active === query.active)
          .map(snapshot);
      },
      async group(options: {
        tabIds: number[];
        groupId?: number;
        createProperties?: { windowId?: number };
      }) {
        const tabs = options.tabIds.map(mustTab);
        let groupId = options.groupId;
        if (groupId !== undefined) {
          if (!fake.groups.has(groupId)) throw new Error(`No group with id: ${groupId}.`);
        } else {
          const windowId = options.createProperties?.windowId ?? tabs[0]!.windowId;
          if (fake.windows.get(windowId)?.type !== "normal") {
            throw new Error("Tabs can only be grouped in normal windows.");
          }
          groupId = nextGroup++;
          fake.groups.set(groupId, { id: groupId, windowId });
        }
        const group = fake.groups.get(groupId)!;
        for (const tab of tabs) {
          if (fake.windows.get(tab.windowId)?.type !== "normal") {
            throw new Error("Tabs can only be grouped in normal windows.");
          }
          tab.windowId = group.windowId;
          setGroup(tab, groupId);
        }
        return groupId;
      },
      async ungroup(tabIds: number[]) {
        for (const tab of tabIds.map(mustTab)) setGroup(tab, -1);
      },
    },
    tabGroups: {
      async get(groupId: number) {
        const group = fake.groups.get(groupId);
        if (group === undefined) throw new Error(`No group with id: ${groupId}.`);
        return { ...group };
      },
      async update(groupId: number, props: { title?: string; color?: string }) {
        const group = fake.groups.get(groupId);
        if (group === undefined) throw new Error(`No group with id: ${groupId}.`);
        Object.assign(group, props);
        return { ...group };
      },
      onRemoved: events.groupRemoved,
    },
    debugger: {
      async attach(target: { tabId: number }, version: string) {
        const tab = fake.tabs.get(target.tabId);
        if (tab === undefined) throw new Error(`No tab with given id ${target.tabId}.`);
        if (version !== "1.3")
          throw new Error(`Requested protocol version is not supported: ${version}.`);
        if (fake.attached.has(target.tabId)) {
          throw new Error(
            `Another debugger is already attached to the tab with id: ${target.tabId}.`,
          );
        }
        if (RESTRICTED.test(tab.url))
          throw new Error(`Cannot access a ${tab.url.split(":")[0]}:// URL`);
        fake.attached.add(target.tabId);
        fake.attaches.push(target.tabId);
      },
      async detach(target: { tabId: number }) {
        if (fake.detachGate !== null) await fake.detachGate;
        if (!fake.attached.delete(target.tabId)) {
          throw new Error(`Debugger is not attached to the tab with id: ${target.tabId}.`);
        }
        fake.detaches.push(target.tabId);
      },
      async sendCommand(target: { tabId: number }, method: string, params?: object) {
        if (!fake.attached.has(target.tabId)) {
          throw new Error(`Debugger is not attached to the tab with id: ${target.tabId}.`);
        }
        const call = { tabId: target.tabId, method, params };
        fake.commands.push(call);
        return fake.respond(call);
      },
      onEvent: events.debuggerEvent,
      onDetach: events.debuggerDetach,
    },
  };

  vi.stubGlobal("chrome", api);
  return fake;
}
