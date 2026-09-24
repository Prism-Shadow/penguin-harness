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
 * imported type-only. Every command gets exactly one reply; tab changes, closes and popups are
 * pushed as events whenever a server is there to hear them — a server that starts later asks
 * for the tab list itself.
 */
import { BrowserWindow, Menu, clipboard, session } from "electron";
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
  /** Lets this window's page host guests. The main window only: no other window gets `webviewTag`. */
  host(win: BrowserWindow): void;
  /** Runs one frame from the server if it is a browser command; false when it is not one. */
  handle(message: unknown): boolean;
}

/** The CDP version the debugger attaches with (the only one Chromium serves). */
const CDP_VERSION = "1.3";
/** How many cookie-write failures a `set-cookies` reply names; the rest are only counted. */
const MAX_COOKIE_ERRORS = 10;

interface Guest {
  /** The guest's webContents id, kept because a destroyed webContents can no longer be asked. */
  id: number;
  wc: WebContents;
  favicon?: string;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createBuiltinBrowserShell(opts: BuiltinBrowserShellOptions): BuiltinBrowserShell {
  const guests = new Map<number, Guest>();
  const hosted = new WeakSet<BrowserWindow>();
  let partitionSession: Session | null = null;

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
    return {
      id: guest.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      ...(guest.favicon !== undefined ? { favicon: guest.favicon } : {}),
    };
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
    const guest: Guest = { id, wc };
    guests.set(id, guest);

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
    wc.once("destroyed", () => {
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch {
        // Already gone with its webContents.
      }
      guests.delete(id);
      emit({ kind: "tab-closed", tabId: id });
    });
    push();
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
      case "cdp":
        return sendCdp(liveGuest(command.tabId), command.method, command.params);
      case "set-cookies":
        return setCookies(command.cookies);
      case "clear-data":
        return clearData(command.storages);
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
