/**
 * The built-in browser's shell half: it hosts the <webview> guests the Web App creates in the
 * main window, and relays for the embedded server what only the main process can do — raw CDP
 * through each guest's `webContents.debugger`, and cookie and storage writes on the guests'
 * partition session. Mechanism only (see main.ts's header and packages/hmr/README.md): no page
 * scripts, no importers, no formatting. The tab registry, the page scripts, scan / exec /
 * click, import and history are the server platform's (packages/server/src/builtin-browser).
 *
 * Electron-facing and untested, like main.ts and tray.ts; the rules it applies are the pure
 * builtin-browser-rules.ts beside it, which carries the tests, and
 * scripts/builtin-browser-smoke.mjs runs this module under Electron itself.
 *
 * The wire is the server's api contract (DesktopBrowserCommand and the three message types),
 * imported type-only. Every command gets exactly one reply; tab changes, closes, crashes, popups
 * and the CDP events a `cdp` command asked for are pushed as events whenever a server is there to
 * hear them — a server that starts later asks for the tab list itself.
 *
 * Load is measured here because only the main process can see the guests' processes: every
 * METRICS_INTERVAL_MS while guests exist, each tab's memory and CPU go out as a `metrics` event.
 * What is too much, and what to tell the user, is the server's call; so is which tabs may be
 * throttled while out of sight (the `throttle` command) — every guest runs unthrottled until it
 * says.
 */
import fs from "node:fs";
import { BrowserWindow, Menu, app, clipboard, session } from "electron";
import type { ContextMenuParams, MenuItemConstructorOptions, Session, WebContents } from "electron";
import type {
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserCookie,
  DesktopBrowserEvent,
  DesktopBrowserEventMessage,
  DesktopBrowserReplyMessage,
} from "@prismshadow/penguin-server/api";
import {
  BUILTIN_BROWSER_PARTITION,
  BUILTIN_BROWSER_PROTOCOL_VERSION,
  METRICS_INTERVAL_MS,
  clearDataPlan,
  guestContextMenu,
  hardenGuestPreferences,
  isGrantedPermission,
  isOpenableUrl,
  mayAttachGuest,
  mayNavigate,
  parseBrowserCommand,
  pickFavicon,
  plainChromeUserAgent,
  privateMemoryKB,
  tabLoads,
} from "./builtin-browser-rules.js";
import type { GuestMenuAction } from "./builtin-browser-rules.js";
import type { TrayLocale } from "./tray-menu.js";
import { urlForLog } from "./util.js";

export interface BuiltinBrowserShellOptions {
  /** Sends one frame to the embedded server; dropped while none is running. */
  post(message: unknown): void;
  /** The language of the guests' context menu: the Web App's, as the tray follows it. */
  locale(): TrayLocale;
  log(line: string): void;
}

export interface BuiltinBrowserShell {
  /**
   * Lets this window's page host guests. The main window only: every other page is refused a
   * guest, even one that was given `webviewTag`.
   */
  host(win: BrowserWindow): void;
  /** Runs one frame from the server if it is a browser command; false when it is not one. */
  handle(message: unknown): boolean;
}

/** The CDP version the debugger attaches with (the only one Chromium serves). */
const CDP_VERSION = "1.3";
/** How many cookie-write failures a `set-cookies` reply names; the rest are only counted. */
const MAX_COOKIE_ERRORS = 10;
/** After a tab closes, how soon the load is measured again, so a warning it caused can clear. */
const METRICS_AFTER_CLOSE_MS = 1_500;

interface Guest {
  /** The guest's webContents id, kept because a destroyed webContents can no longer be asked. */
  id: number;
  wc: WebContents;
  favicon?: string;
  /** The CDP events relayed to the server, as the last `cdp` command's `events` set them. */
  relayed: ReadonlySet<string>;
  /** Why the page's renderer last went away; reported while `wc.isCrashed()` says it still is. */
  crashReason?: string;
}

/** The pages' processes: the guest's renderer and those of its cross-site frames (ads, embeds). */
function pagePids(wc: WebContents): number[] {
  const pids = new Set<number>();
  try {
    pids.add(wc.getOSProcessId());
    for (const frame of wc.mainFrame.framesInSubtree) pids.add(frame.osProcessId);
  } catch {
    // A page between renderers has no frames to ask.
  }
  return [...pids].filter((pid) => pid > 0);
}

/** Linux's account of a process's memory, where one is kept; null elsewhere or once it has exited. */
function procStatus(pid: number): string | null {
  if (process.platform !== "linux") return null;
  try {
    return fs.readFileSync(`/proc/${pid}/status`, "utf8");
  } catch {
    return null;
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createBuiltinBrowserShell(opts: BuiltinBrowserShellOptions): BuiltinBrowserShell {
  const guests = new Map<number, Guest>();
  const hosted = new WeakSet<BrowserWindow>();
  /** The pages of the hosted windows: the only embedders a guest may attach to. */
  const embedders = new WeakSet<WebContents>();
  let partitionSession: Session | null = null;
  let metricsTimer: NodeJS.Timeout | null = null;
  let metricsSoon: NodeJS.Timeout | null = null;

  // No page but a hosted window's may attach a guest, whatever its own preferences say. Any
  // other window's are built from options its opener can reach (a `webviewTag=yes` in
  // window.open's features), and a <webview> there would attach past every check below: in any
  // partition, the app's own signed-in session included.
  app.on("web-contents-created", (_event, wc) => {
    wc.on("will-attach-webview", (event) => {
      if (embedders.has(wc)) return;
      event.preventDefault();
      opts.log(`builtin browser: refused a <webview> in ${urlForLog(wc.getURL())}`);
    });
  });

  /**
   * The guests' session, set up once before the first guest is created: the user agent sites
   * see, and which permission prompts a page is granted. Downloads keep Electron's own save
   * dialog.
   */
  function browserSession(): Session {
    if (partitionSession !== null) return partitionSession;
    const ses = session.fromPartition(BUILTIN_BROWSER_PARTITION);
    ses.setUserAgent(plainChromeUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(isGrantedPermission(permission)),
    );
    ses.setPermissionCheckHandler((_wc, permission) => isGrantedPermission(permission));
    partitionSession = ses;
    return ses;
  }

  function emit(event: DesktopBrowserEvent): void {
    opts.post({ type: "desktop-browser-event", event } satisfies DesktopBrowserEventMessage);
  }

  function reply(
    id: string,
    outcome: { ok: true; result: unknown } | { ok: false; error: string },
  ) {
    opts.post({
      type: "desktop-browser-reply",
      id,
      ...outcome,
    } satisfies DesktopBrowserReplyMessage);
  }

  function tabOf(guest: Guest): BuiltinBrowserTab {
    const { wc } = guest;
    const crashed = wc.isCrashed() ? (guest.crashReason ?? "crashed") : undefined;
    return {
      id: guest.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      ...(guest.favicon !== undefined ? { favicon: guest.favicon } : {}),
      ...(crashed !== undefined ? { crashed } : {}),
    };
  }

  /**
   * Measures every live guest's load and sends it; with none left, one empty measurement clears
   * the last. It runs on a timer, where a throw would be an uncaught main-process error, so a
   * measurement that fails is logged and skipped.
   */
  function sendMetrics(): void {
    try {
      const live = [...guests.values()].filter((guest) => !guest.wc.isDestroyed());
      const tabs = live.map((guest) => ({ tabId: guest.id, pids: pagePids(guest.wc) }));
      const wanted = new Set(tabs.flatMap((tab) => tab.pids));
      const processes = app
        .getAppMetrics()
        .filter((metric) => wanted.has(metric.pid))
        .map((metric) => ({
          pid: metric.pid,
          memoryKB: privateMemoryKB(process.platform, metric.memory, procStatus(metric.pid)),
          cpuPercent: metric.cpu.percentCPUUsage,
        }));
      emit({ kind: "metrics", ...tabLoads(processes, tabs) });
    } catch (err) {
      opts.log(`builtin browser: the tabs' load could not be measured: ${messageOf(err)}`);
    }
  }

  /** Measures on a steady beat while there are guests, and stops with the last of them. */
  function followLoad(): void {
    if (guests.size > 0) {
      metricsTimer ??= setInterval(() => sendMetrics(), METRICS_INTERVAL_MS);
      return;
    }
    if (metricsTimer !== null) clearInterval(metricsTimer);
    metricsTimer = null;
  }

  /** Measures again shortly (coalesced): a closed tab's memory should leave the numbers soon. */
  function measureSoon(): void {
    if (metricsSoon !== null) return;
    metricsSoon = setTimeout(() => {
      metricsSoon = null;
      sendMetrics();
    }, METRICS_AFTER_CLOSE_MS);
  }

  function liveGuest(tabId: number): Guest {
    const guest = guests.get(tabId);
    if (guest === undefined || guest.wc.isDestroyed()) throw new Error("no_such_tab");
    return guest;
  }

  /** Registers a guest that passed `will-attach-webview` and wires what the server hears of it. */
  function adopt(wc: WebContents): void {
    const id = wc.id;
    if (guests.has(id)) return;
    const guest: Guest = { id, wc, relayed: new Set() };
    guests.set(id, guest);
    // The CDP events the server asked for, and only those: the debugger's session sees every
    // event of the domains enabled on it.
    wc.debugger.on("message", (_event, method: string, params: unknown) => {
      if (!guest.relayed.has(method)) return;
      emit({
        kind: "cdp-event",
        tabId: id,
        method,
        params: (params ?? {}) as Record<string, unknown>,
      });
    });

    // Every popup is denied; a web one becomes a request for a tab, which the server turns
    // into a <webview> in the Web App like any other.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (isOpenableUrl(url)) {
        emit({
          kind: "open-request",
          url,
          openerTabId: id,
          ...(disposition === "background-tab" ? { background: true } : {}),
        });
      } else {
        opts.log(`builtin browser: refused a popup to ${urlForLog(url)}`);
      }
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (mayNavigate(url)) return;
      event.preventDefault();
      opts.log(`builtin browser: refused a navigation to ${urlForLog(url)}`);
    });

    const push = () => {
      if (!wc.isDestroyed()) emit({ kind: "tab", tab: tabOf(guest) });
    };
    wc.on("did-start-loading", push);
    wc.on("did-stop-loading", push);
    // A new document keeps the icon the tab shows: Chromium announces a document's icons only
    // when they differ from the previous document's, so the icon changes exactly when
    // `page-favicon-updated` says so — and a page on the same site, which shares its icon with
    // the one before it, is never announced at all.
    wc.on("did-navigate", push);
    wc.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (isMainFrame) push();
    });
    wc.on("page-title-updated", push);
    wc.on("page-favicon-updated", (_event, favicons) => {
      const favicon = pickFavicon(favicons);
      if (favicon === undefined) delete guest.favicon;
      else guest.favicon = favicon;
      push();
    });
    wc.on("context-menu", (_event, params) => openContextMenu(guest, params));
    // The page's renderer died (a crash, the system reclaiming memory, a kill): the tab stays,
    // showing the crash until it is reloaded, and the server hears why. The app-level
    // render-process-gone handler in main.ts logs it.
    wc.on("render-process-gone", (_event, details) => {
      guest.crashReason = details.reason;
      emit({ kind: "tab-crashed", tabId: id, reason: details.reason, exitCode: details.exitCode });
      push();
      // A command the dead renderer took is never answered. Detaching fails every one of them
      // now (their replies go out after the event above); the next command attaches again.
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch {
        // Nothing attached.
      }
    });
    wc.on("unresponsive", () => opts.log(`builtin browser: tab ${id} stopped responding`));
    wc.on("responsive", () => opts.log(`builtin browser: tab ${id} responds again`));
    wc.once("destroyed", () => {
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch {
        // Already gone with its webContents.
      }
      guests.delete(id);
      emit({ kind: "tab-closed", tabId: id });
      followLoad();
      measureSoon();
    });
    push();
    followLoad();
  }

  /**
   * Raw CDP on a guest. The debugger attaches on first use and stays; when it is detached
   * under us (the target's DevTools, or a crash) the next command simply attaches again.
   */
  async function sendCdp(guest: Guest, method: string, params?: Record<string, unknown>) {
    const dbg = guest.wc.debugger;
    if (!dbg.isAttached()) {
      try {
        dbg.attach(CDP_VERSION);
      } catch (err) {
        if (!/already attached/i.test(messageOf(err))) throw err;
      }
    }
    return (await dbg.sendCommand(method, params ?? {})) as unknown;
  }

  /** Writes cookies one by one, so a bad one costs itself only. Failures name the cookie, never its value. */
  async function setCookies(cookies: DesktopBrowserCookie[]) {
    const ses = browserSession();
    let set = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const cookie of cookies) {
      try {
        await ses.cookies.set(cookie);
        set += 1;
      } catch (err) {
        failed += 1;
        if (errors.length < MAX_COOKIE_ERRORS) {
          errors.push(
            `${cookie.name} (${cookie.domain ?? urlForLog(cookie.url)}): ${messageOf(err)}`,
          );
        }
      }
    }
    await ses.cookies.flushStore();
    return { set, failed, errors };
  }

  /**
   * Lets the listed tabs' pages be throttled while out of sight, and runs every other one at full
   * speed. A guest is only touched when its setting changes: Electron shows a hidden page again on
   * every call, so repeating a page's setting would undo the throttling it already has.
   */
  function throttle(tabIds: readonly number[]) {
    const throttled = new Set(tabIds);
    for (const guest of guests.values()) {
      const allowed = throttled.has(guest.id);
      const { wc } = guest;
      if (wc.isDestroyed() || wc.getBackgroundThrottling() === allowed) continue;
      wc.setBackgroundThrottling(allowed);
      if (allowed && !wc.isCrashed()) void applyThrottling(guest);
    }
    return {};
  }

  /**
   * Makes a newly allowed throttling take hold now. Electron applies it only at the page's next
   * change of visibility, and a page parked out of sight has none coming: measured, it went on at
   * 60 frames and 63 timer ticks a second. Freezing the page for an instant and resuming it (the
   * Page Lifecycle states, the `freeze` and `resume` events a backgrounded page may get anyway)
   * has Chromium send it its visibility afresh: none and one after. A DevTools focus-emulation
   * toggle did the same until the page had had an agent's action; the capture count and hiding
   * the page's frame in the window never did.
   */
  async function applyThrottling(guest: Guest): Promise<void> {
    try {
      await sendCdp(guest, "Page.setWebLifecycleState", { state: "frozen" });
      await sendCdp(guest, "Page.setWebLifecycleState", { state: "active" });
    } catch (err) {
      opts.log(
        `builtin browser: tab ${guest.id} is throttled from its next change of visibility: ${messageOf(err)}`,
      );
    }
  }

  async function clearData(storages: readonly string[]) {
    const plan = clearDataPlan(storages);
    if (plan === null) throw new Error("bad_command");
    const ses = browserSession();
    if (plan.storageData.length > 0) await ses.clearStorageData({ storages: plan.storageData });
    if (plan.cache) await ses.clearCache();
    return {};
  }

  async function run(command: DesktopBrowserCommand): Promise<unknown> {
    switch (command.op) {
      case "hello":
        return { version: BUILTIN_BROWSER_PROTOCOL_VERSION, partition: BUILTIN_BROWSER_PARTITION };
      case "tabs":
        return {
          tabs: [...guests.values()].filter((g) => !g.wc.isDestroyed()).map((g) => tabOf(g)),
        };
      case "cdp": {
        const guest = liveGuest(command.tabId);
        // A page with no renderer cannot answer; it takes a reload first.
        if (guest.wc.isCrashed()) throw new Error("tab_crashed");
        if (command.events !== undefined) guest.relayed = new Set(command.events);
        return sendCdp(guest, command.method, command.params);
      }
      case "set-cookies":
        return setCookies(command.cookies);
      case "clear-data":
        return clearData(command.storages);
      case "throttle":
        return throttle(command.tabIds);
    }
  }

  function runMenuAction(guest: Guest, action: GuestMenuAction, params: ContextMenuParams): void {
    const { wc } = guest;
    if (wc.isDestroyed()) return;
    switch (action) {
      case "back":
        wc.navigationHistory.goBack();
        return;
      case "forward":
        wc.navigationHistory.goForward();
        return;
      case "reload":
        wc.reload();
        return;
      case "open-link":
        emit({
          kind: "open-request",
          url: params.linkURL,
          openerTabId: guest.id,
          background: true,
        });
        return;
      case "copy-link":
        clipboard.writeText(params.linkURL);
        return;
      case "copy-image-address":
        clipboard.writeText(params.srcURL);
        return;
      case "cut":
        wc.cut();
        return;
      case "copy":
        wc.copy();
        return;
      case "paste":
        wc.paste();
        return;
      case "select-all":
        wc.selectAll();
        return;
      case "inspect":
        wc.inspectElement(params.x, params.y);
        return;
      case "devtools":
        wc.openDevTools();
        return;
    }
  }

  function openContextMenu(guest: Guest, params: ContextMenuParams): void {
    const { wc } = guest;
    const items = guestContextMenu({
      locale: opts.locale(),
      x: params.x,
      y: params.y,
      linkURL: params.linkURL,
      srcURL: params.srcURL,
      mediaType: params.mediaType,
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      editFlags: params.editFlags,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
    const template: MenuItemConstructorOptions[] = items.map((item) =>
      item.action === undefined
        ? { type: "separator" }
        : {
            label: item.label,
            enabled: item.enabled ?? true,
            click: () => runMenuAction(guest, item.action!, params),
          },
    );
    const host = BrowserWindow.fromWebContents(wc.hostWebContents ?? wc);
    Menu.buildFromTemplate(template).popup(host !== null ? { window: host } : {});
  }

  return {
    host(win) {
      if (hosted.has(win)) return;
      hosted.add(win);
      const embedder = win.webContents;
      embedders.add(embedder);
      // Every <webview> the page creates passes here first: the browser's partition and a web
      // or blank start page, or it is refused; then its preferences are forced into the
      // hardened shape. Electron only defines the element in the main frame of a window with
      // `webviewTag`, so a frame inside the page (a Files panel preview) never reaches here.
      embedder.on("will-attach-webview", (event, webPreferences, params) => {
        if (!mayAttachGuest(params)) {
          event.preventDefault();
          opts.log(
            `builtin browser: refused a <webview> in partition '${params.partition ?? ""}' for ${urlForLog(params.src ?? "")}`,
          );
          return;
        }
        browserSession();
        hardenGuestPreferences(webPreferences as unknown as Record<string, unknown>);
      });
      embedder.on("did-attach-webview", (_event, wc) => adopt(wc));
    },

    handle(message) {
      const parsed = parseBrowserCommand(message);
      if (parsed === null) return false;
      if ("error" in parsed) {
        reply(parsed.id, { ok: false, error: parsed.error });
        return true;
      }
      run(parsed.command).then(
        (result) => reply(parsed.id, { ok: true, result }),
        (err: unknown) => reply(parsed.id, { ok: false, error: messageOf(err) }),
      );
      return true;
    },
  };
}
