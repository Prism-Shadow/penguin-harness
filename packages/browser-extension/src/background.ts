/**
 * The service worker: one ServerConnection per paired server, one driven-tab set, one
 * debuggee, wired to Chrome's events.
 *
 * Every Chrome listener is registered synchronously at the top level, so an event that wakes
 * the worker is delivered; each waits for `ready` (state restored from storage) before acting.
 * A server only ever reaches its own tabs: every command is checked against the tab set, and
 * every event goes to the one server that drives the tab.
 */
import { ServerConnection } from "./connection.js";
import { Debuggee } from "./debuggee.js";
import { currentPlatform, deviceName } from "./pairing.js";
import { isNavigableUrl } from "./policy.js";
import {
  clearHold,
  parseUiLanguage,
  readHolds,
  readPaused,
  readServers,
  readTabSet,
  readUiLanguage,
  removeServer,
  setHold,
  writeStatus,
  writeTabSet,
  type ConnectionState,
  type Hold,
  type PairedServer,
  type ServerStatus,
} from "./storage.js";
import { stringsFor, type UiLanguage } from "./strings.js";
import { drivenCount, type TabSetState } from "./tab-set.js";
import { TabController } from "./tabs.js";
import { applyToolbar, popupFor } from "./toolbar.js";
import {
  PROTOCOL_VERSION,
  type BrowserHello,
  type DesktopBrowserCommand,
  type DesktopBrowserEvent,
} from "./wire.js";

const RECONNECT_ALARM = "penguin-reconnect";

const log = (line: string) => console.debug(`[penguin] ${line}`);

let servers: PairedServer[] = [];
let paused = false;
/** The language the user picked for the pages, which the toolbar title follows. */
let language: UiLanguage = "en";
const connections = new Map<string, ServerConnection>();
const status: Record<string, ServerStatus> = {};
/** The holds as last written, so a state change writes storage only when its hold changed. */
let holds: Record<string, Hold> = {};

const debuggee = new Debuggee({
  event: relayCdpEvent,
  release: (tabIds, reason) =>
    void (tabIds === "all" ? tabs.releaseAll(reason) : tabs.release(tabIds, reason)),
  log,
});

let tabs: TabController;

const ready: Promise<void> = (async () => {
  const state = await TabController.restore(await readTabSet());
  tabs = new TabController({
    state,
    send: sendTo,
    detach: (tabId) => debuggee.forget(tabId),
    groupTitle,
    onChange: onTabsChanged,
    log,
  });
  // A worker restart leaves the previous worker's debugger sessions behind: start clean, the
  // next command attaches again.
  for (const tab of Object.values(state.tabs)) {
    await chrome.debugger.detach({ tabId: tab.tabId }).catch(() => {});
  }
  paused = await readPaused();
  language = await readUiLanguage();
  await reconcile();
})();

// --- servers -----------------------------------------------------------------------------------

/** One at a time: storage events can arrive back to back. */
let reconciling: Promise<void> = Promise.resolve();
function reconcile(): Promise<void> {
  const run = reconciling.then(reconcileNow);
  reconciling = run.catch((err: unknown) => log(`reconcile failed: ${String(err)}`));
  return run;
}

async function reconcileNow(): Promise<void> {
  const next = await readServers();
  holds = await readHolds();
  const wasMany = servers.length > 1;
  servers = next;
  for (const [origin, connection] of connections) {
    if (next.some((server) => server.origin === origin)) continue;
    connection.stop();
    connections.delete(origin);
    delete status[origin];
    await tabs.forgetServer(origin);
  }
  for (const server of next) {
    const existing = connections.get(server.origin);
    if (existing !== undefined) {
      existing.setToken(server.token);
      continue;
    }
    const connection = new ServerConnection({
      origin: server.origin,
      token: server.token,
      ...(holds[server.origin] !== undefined ? { hold: holds[server.origin] } : {}),
      handle: (command) => handle(server.origin, command),
      hello,
      onState: (state, hold) => void onConnectionState(server.origin, state, hold),
      log,
    });
    connections.set(server.origin, connection);
    status[server.origin] = { label: server.label, status: "connecting" };
    connection.start();
  }
  if (wasMany !== next.length > 1) await tabs.retitle();
  if (next.length > 0) {
    await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(RECONNECT_ALARM);
  }
  await refresh();
}

async function onConnectionState(
  origin: string,
  state: ConnectionState,
  hold: Hold | null,
): Promise<void> {
  const server = servers.find((s) => s.origin === origin);
  if (server === undefined || connections.get(origin) === undefined) return;
  status[origin] = { label: server.label, ...state };
  const stored = holds[origin];
  if (hold === null && stored !== undefined) {
    delete holds[origin];
    await clearHold(origin);
  } else if (hold !== null && JSON.stringify(hold) !== JSON.stringify(stored)) {
    holds[origin] = hold;
    await setHold(origin, hold);
  }
  if (state.status === "revoked") {
    // Revoked in the Web App: forget the server here too (reconcile drops its tabs).
    await removeServer(origin);
    return;
  }
  await refresh();
}

function hello(): BrowserHello {
  const chromeVersion = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? "";
  return {
    version: PROTOCOL_VERSION,
    backend: "chrome",
    extension: {
      version: chrome.runtime.getManifest().version,
      chrome: chromeVersion,
      name: deviceName(navigator.userAgent, currentPlatform()),
    },
  };
}

function groupTitle(server: string): string {
  const { groupTitle: title } = stringsFor(language);
  if (servers.length <= 1) return title;
  const label = servers.find((s) => s.origin === server)?.label ?? server;
  return `${title} · ${label}`;
}

// --- commands ----------------------------------------------------------------------------------

/** One server's command. `hello` and `ping` never reach here (the connection answers them). */
async function handle(server: string, command: DesktopBrowserCommand): Promise<unknown> {
  await ready;
  switch (command.op) {
    case "tabs":
      return { tabs: await tabs.list(server) };
    case "cdp":
      if (paused) throw new Error("extension_paused");
      tabs.drivable(server, command.tabId);
      return debuggee.send(command.tabId, command.method, command.params, command.events);
    case "open-tab":
      if (paused) throw new Error("extension_paused");
      if (!isNavigableUrl(command.url)) throw new Error("bad_url");
      return { tab: await tabs.open(server, command.url, command.activate) };
    case "close-tab":
      await tabs.close(server, command.tabId);
      return {};
    case "activate-tab":
      await tabs.activate(server, command.tabId);
      return {};
    default:
      throw new Error("unknown_op");
  }
}

function sendTo(server: string, event: DesktopBrowserEvent): void {
  connections.get(server)?.emit(event);
}

function relayCdpEvent(tabId: number, method: string, params: Record<string, unknown>): void {
  const owner = tabs?.owner(tabId);
  if (owner === undefined || owner.released !== undefined) return;
  sendTo(owner.server, { kind: "cdp-event", tabId, method, params });
}

// --- toolbar, popups, the pages' view ---------------------------------------------------------

function onTabsChanged(state: TabSetState): void {
  void writeTabSet(state).catch(() => {});
  void refresh();
}

async function refresh(): Promise<void> {
  await writeStatus({ ...status }).catch(() => {});
  await applyToolbar({
    servers: servers.map((s) => ({ label: s.label, status: status[s.origin]?.status })),
    paused,
    driven: tabs === undefined ? 0 : drivenCount(tabs.snapshot),
    language,
  });
  const active = await chrome.tabs.query({ active: true }).catch(() => []);
  for (const tab of active) await refreshPopup(tab);
}

async function refreshPopup(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const driven = tabs?.owner(tab.id);
  const only = servers.length === 1 ? status[servers[0]!.origin]?.status : undefined;
  const popup = popupFor({
    url: tab.url || tab.pendingUrl,
    driven: driven !== undefined && driven.released === undefined,
    servers: servers.length,
    attention: only === "replaced" || only === "protocol_mismatch",
    paused,
  });
  await chrome.action.setPopup({ tabId: tab.id, popup }).catch(() => {});
}

// --- Chrome's events (top level, synchronously) -------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("servers" in changes) void ready.then(reconcile);
  if ("paused" in changes) {
    void ready.then(async () => {
      paused = changes.paused?.newValue === true;
      if (paused) debuggee.detachAll();
      await refresh();
    });
  }
  if ("uiLanguage" in changes) {
    void ready.then(async () => {
      language = parseUiLanguage(changes.uiLanguage?.newValue);
      await tabs.retitle();
      await refresh();
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RECONNECT_ALARM) return;
  void ready.then(() => {
    for (const connection of connections.values()) connection.kick();
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  void ready.then(async () => {
    tabs.onUpdated(tabId, change, tab);
    if (tab.active && (change.url !== undefined || change.status !== undefined)) {
      await refreshPopup(tab);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => tabs.onRemoved(tabId));
});

chrome.tabs.onReplaced.addListener((_added, removed) => {
  void ready.then(() => tabs.onRemoved(removed));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ready.then(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab !== undefined) await refreshPopup(tab);
  });
});

chrome.tabGroups.onRemoved.addListener((group) => {
  void ready.then(() => tabs.onGroupRemoved(group.id));
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  void ready.then(() => tabs.onCreatedNavigationTarget(details.sourceTabId, details.tabId));
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  void ready.then(() => debuggee.handleEvent(source, method, params));
});

chrome.debugger.onDetach.addListener((source, reason) => {
  void ready.then(() => debuggee.handleDetach(source, reason));
});

/** A click on a tab with no popup: the user hands the tab to the one paired server. */
chrome.action.onClicked.addListener((tab) => {
  void ready.then(async () => {
    const only = servers.length === 1 ? servers[0] : undefined;
    if (only === undefined || tab.id === undefined) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    await tabs.adopt(only.origin, tab.id);
  });
});

/** What the extension's own pages ask of the worker. Web pages cannot reach this. */
type PageRequest =
  | { type: "adopt"; tabId: number; origin: string }
  | { type: "give-back"; tabId: number }
  | { type: "reconnect"; origin: string };

chrome.runtime.onMessage.addListener((message: PageRequest, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    return false;
  }
  void ready
    .then(async () => {
      switch (message.type) {
        case "adopt":
          if (!servers.some((s) => s.origin === message.origin)) return { ok: false };
          return { ok: true, outcome: await tabs.adopt(message.origin, message.tabId) };
        case "give-back":
          await tabs.giveBack(message.tabId);
          return { ok: true };
        case "reconnect":
          connections.get(message.origin)?.reconnect();
          return { ok: true };
        default:
          return { ok: false };
      }
    })
    .then(respond, (err: unknown) => respond({ ok: false, error: String(err) }));
  return true;
});
