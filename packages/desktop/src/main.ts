/**
 * Desktop shell main process.
 *
 * HMR LAYER — MECHANISM ONLY (see packages/hmr/README.md). The
 * shell boots and hosts; it does not implement product behavior. It is also
 * the least updatable code in the system — a change here reaches users only
 * through a new installer — so a capability that could instead be delivered
 * by a platform push must be. A rejected example: adding a preload bridge so
 * the web UI could open DevTools, when the shell's own View menu already
 * does it.
 *
 * One window over the embedded server: fork penguin-server as a utilityProcess on the
 * shared data root (PENGUIN_HOME or ~/.penguin/data), learn its port (last launch's when
 * still free, so origin-scoped localStorage preferences survive restarts), and load
 * `http://localhost:<port>/api/auth/claim?token=…` — the one-shot token lands
 * the window signed in as admin. The window is a plain browser environment (no preload,
 * no node integration); every capability flows through the server's HTTP API.
 *
 * Attach mode: when a live server (e.g. `penguin web`) already owns the data root, the
 * window loads that instance instead. The one-shot token buys nothing there, so the shell
 * signs the window in the other way it is entitled to — a session minted straight into the
 * data root it owns (see attach-session.ts) — and the same move answers any later arrival at
 * the sign-in page, which has no password anyone could type. Signing out is the exception:
 * it is a decision rather than a failure, so it is left to stand until the next sign-in or
 * the next launch.
 *
 * Tray: a system-tray icon is shown for as long as the app runs, and by default closing the
 * window only hides it, so the server and its background tasks keep running (see tray.ts;
 * both preferences live in userData/tray.json and Quit still goes through the graceful
 * stop). Settings › Appearance turns the icon off and on, reaching the shell over the same
 * utilityProcess relay the client updater uses.
 *
 * Built-in browser: the main window (and no other) may host <webview> guests in the
 * `persist:penguin-browser` partition, and builtin-browser.ts relays raw CDP and cookie writes
 * for them over that same port. That relay is the only part of the browser the shell carries,
 * and it lives here because it has to: a guest's `webContents.debugger` and the partition's
 * session are main-process APIs that neither the page nor the server process can reach. The
 * tab registry, the page scripts, scan / exec / click, import and history are the server
 * platform's, delivered by push like any other product behavior.
 *
 * Folder access (macOS): on the Workspace picker's request, relayed over the same port, the
 * main process reads a protected folder once and opens System Settings at a privacy pane (see
 * folder-access.ts). It lives here because it has to: macOS asks about Desktop, Documents and
 * Downloads only on behalf of the app it holds responsible, and the app is this process. What
 * to tell the user about the outcome is the Web App's.
 *
 * Dev isolation: the dev profile — an unpackaged run, or any build launched with `--dev`
 * — takes a dev-suffixed identity (own userData, and with it the single-instance lock and
 * sticky port) and defaults to the ~/.penguin/dev-data root, so it runs beside an
 * installed release build (see app-identity.ts). Updating and the per-launch CLI link
 * repair stay with the release profile: both touch the one installation the two
 * instances share.
 *
 * Smoke hook (PENGUIN_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when PENGUIN_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, session, shell } from "electron";
import type { WindowOpenHandlerResponse } from "electron";
import { resolveRoot } from "@prismshadow/penguin-core";
import { mintApiToken } from "@prismshadow/penguin-server/auth-token";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import type { ServerLock } from "@prismshadow/penguin-server/lock";
import { appIdentity, desktopDataRoot, resolveProfile } from "./app-identity.js";
import {
  createSignInGuard,
  isLoginPageUrl,
  planSignIn,
  signInFailureDialog,
} from "./attach-session.js";
import type { SignInFailure } from "./attach-session.js";
import { embeddedCliEntry } from "./launcher.js";
import { webDistEntry, webDistFor } from "./web-dist.js";
import { resolveTrayIcon, resolveWindowIcon } from "./app-icon.js";
import { createBuiltinBrowserShell } from "./builtin-browser.js";
import { installCliCommand, ensureCliCommand, currentCliInstallKind } from "./cli-install.js";
import { logLine, logServerOutput, startDesktopLog, stopDesktopLog } from "./desktop-log.js";
import { handleFolderAccessFrame } from "./folder-access.js";
import type { FolderAccessFrameDeps } from "./folder-access.js";
import { applyLoginShellEnv } from "./login-shell-env.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
import { resolveTrayLocale } from "./tray-menu.js";
import type { TrayLocale } from "./tray-menu.js";
import { installTray } from "./tray.js";
import type { TrayHandle } from "./tray.js";
import {
  parseTrayCommand,
  readTrayPrefs,
  trayStatusMessage,
  updateTrayPrefs,
} from "./tray-prefs.js";
import { getUpdaterStatus, handleUpdaterCommand, initUpdater, onUpdaterStatus } from "./updater.js";
import { parseUpdaterCommand, updaterStatusMessage } from "./updater-status.js";
import {
  APP_WINDOW_OPTIONS,
  childGoneLine,
  classifyWindowOpen,
  desktopLoginUrl,
  hidesOnClose,
  isAppUrl,
  isExternalScheme,
  isLocalSurfaceUrl,
  MAX_SERVER_RESTARTS,
  RENDERER_HEALTHY_MS,
  rendererGoneLine,
  rendererReloadDelayMs,
  restartDelayMs,
  urlForLog,
} from "./util.js";

// Identity first: the name decides the userData directory, which also keys the
// single-instance lock requested below — the dev profile takes a dev-suffixed identity
// so it runs beside an installed release build instead of quitting into its window
// (#292; see app-identity.ts).
const profile = resolveProfile({ argv: process.argv, isPackaged: app.isPackaged });
const identity = appIdentity(profile);
app.setName(identity.name);
// Windows toasts (the web app's task-completion notifications) need the AppUserModelID
// of the installed shortcuts; electron-builder stamps them with the appId. Keep the
// release value in sync with electron-builder.yml. Dev runs stamp the dev-suffixed id
// so their taskbar/toast identity never claims the installed app's.
if (process.platform === "win32") app.setAppUserModelId(identity.appUserModelId);

let win: BrowserWindow | null = null;
let tray: TrayHandle | null = null;
/** The Appearance switch's value; the tray exists exactly while this is true and one could be created. */
let showTrayIcon = true;
/**
 * The language the tray menu is drawn in. Seeded from the stored report, or from the device
 * when there is none, so the first menu of a fresh launch is already right — the Web App's
 * own report arrives only once a window has loaded far enough to send it.
 */
let trayLocale: TrayLocale = "en";
let server: EmbeddedServer | null = null;
/** The live server child, for pushes that are not answers to one of its messages. */
let relayChild: EmbeddedServer["child"] | null = null;
/**
 * The built-in browser's guests and their relay (see the header). Frames for the server go to
 * whichever child is live; with none, a push is dropped and the next server asks for the tabs.
 */
const builtinBrowser = createBuiltinBrowserShell({
  post: (message) => relayChild?.postMessage(message),
  locale: () => trayLocale,
  log: (line) => logLine(`[shell] ${line}`),
});
/** The Workspace picker's macOS folder access (see the header); replies go to whichever child is live. */
const folderAccess: FolderAccessFrameDeps = {
  platform: process.platform,
  isPackaged: app.isPackaged,
  readdir: (dir) => fs.promises.readdir(dir),
  openExternal: (url) => shell.openExternal(url),
  post: (reply) => relayChild?.postMessage(reply),
  log: (line) => logLine(`[shell] ${line}`),
};
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;
/** The main window's page died this many times in a row; a page that stays up resets it. */
let rendererDeaths = 0;
let rendererHealthyTimer: NodeJS.Timeout | null = null;

// app.name, not a literal: a dev run raises this box while the installed build may be
// running beside it, and a dialog titled "PenguinHarness" cannot be attributed to either.
function fatal(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox(app.name, `${context}\n\n${detail}`);
  app.exit(1);
}

function createWindow(url: string): void {
  // Linux window/taskbar icon (and Windows dev runs); packaged Windows uses the exe
  // resources and macOS its bundle icns, so those ignore it (see app-icon.ts).
  const iconPath = resolveWindowIcon(app.getAppPath(), process.platform);
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    ...(iconPath !== null ? { icon: iconPath } : {}),
    webPreferences: {
      // The window is a plain browser: no Node, no preload — the minimal attack surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The built-in browser's tabs are <webview> guests of this page. This window only:
      // windows it opens are built from their own preferences, which leave the tag off.
      webviewTag: true,
    },
  });
  builtinBrowser.host(win);
  win.once("ready-to-show", () => win?.show());
  // Close-to-tray: the window goes away, the app and its embedded server stay, and the tray
  // icon is the way back. Every real exit — the tray's Quit, the app menu's, an OS logout —
  // passes through before-quit first, which is what `quitting` reports.
  win.on("close", (event) => {
    const hide = hidesOnClose({
      quitting,
      trayShown: tray !== null,
      closeToTray: tray?.closeToTray() ?? false,
    });
    if (!hide) return;
    event.preventDefault();
    win?.hide();
  });
  win.on("closed", () => {
    win = null;
  });
  // New windows, from this window and from every window it opens, go through one rule
  // (classifyWindowOpen): only the Workspace preview hand-off, a preview page and a detached
  // terminal get a window of this app; other sites go to the system browser; anything else
  // on this instance is refused, since every other app path boots a second copy of the App.
  // This window gets no exception of its own: the handler is not told which frame asked, and
  // the Files panel previews Agent-written HTML in an iframe that allows popups, so any window
  // allowed here is one that HTML can open too — a hidden one, it could own outright.
  win.webContents.setWindowOpenHandler(({ url: target }) => openWindowFor(target, iconPath));
  win.webContents.on("did-create-window", (child) => guardOpenedWindow(child, iconPath));
  win.webContents.on("will-navigate", (event, target) => {
    if (!isAppUrl(target, appOrigin)) {
      event.preventDefault();
      openInSystem(target);
    }
  });
  // The catch-all for every route to the sign-in page — an attached instance that never saw
  // this shell's token, a session that lapsed, a claim that failed. The page asks for a
  // password this installation does not have, so the shell answers it the way it answers
  // attach mode (see signInFromDataRoot). Both events are needed: the App routes to the
  // sign-in page within the loaded page, and the server redirects to it across a load.
  win.webContents.on("did-navigate", (_event, url) => onMainWindowNavigated(url));
  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) onMainWindowNavigated(url);
  });
  watchForSignOut(win);
  // The page's renderer died (the app-level handler below logs why): reload it, after a pause
  // that grows while it keeps dying, so a page that crashes as it loads cannot spin.
  const target = win;
  target.webContents.on("render-process-gone", () => reloadAfterRendererDeath(target));
  target.webContents.on("unresponsive", () => logLine("[shell] the window stopped responding"));
  target.webContents.on("responsive", () => logLine("[shell] the window responds again"));
  armSmokeProbe(win);
  void win.loadURL(url);
}

/**
 * Reloads the main window's page after its renderer died: at once the first time, then after
 * a growing pause (rendererReloadDelayMs) while it keeps dying. A page that then stays up for
 * RENDERER_HEALTHY_MS starts the ladder over.
 */
function reloadAfterRendererDeath(target: BrowserWindow): void {
  if (rendererHealthyTimer !== null) clearTimeout(rendererHealthyTimer);
  rendererHealthyTimer = null;
  const wait = rendererReloadDelayMs(rendererDeaths);
  rendererDeaths += 1;
  if (wait > 0) logLine(`[shell] the window's page keeps dying; reloading it in ${wait} ms`);
  setTimeout(() => {
    if (quitting || target.isDestroyed()) return;
    target.webContents.reload();
    rendererHealthyTimer = setTimeout(() => {
      rendererDeaths = 0;
      rendererHealthyTimer = null;
    }, RENDERER_HEALTHY_MS);
  }, wait);
}

/**
 * Answers a window-open request from any window of this app (see classifyWindowOpen in
 * util.ts). A refusal is logged, by origin and path only: the user clicked something, and
 * this line is the one trace of why nothing opened.
 */
function openWindowFor(target: string, iconPath: string | null): WindowOpenHandlerResponse {
  switch (classifyWindowOpen(target, appOrigin)) {
    case "window":
      return {
        action: "allow",
        // Electron merges the page's `window.open` feature string under this override, so
        // every key a page could use to hide the window is pinned here (APP_WINDOW_OPTIONS).
        overrideBrowserWindowOptions: {
          ...(iconPath !== null ? { icon: iconPath } : {}),
          // Same hardening as the main window: a preview is Agent-written, untrusted HTML
          // and must never get Node. Nor <webview>, the main window's alone: Electron copies
          // an opener's preference only when it is the safe one, so without this line the
          // main window's `webviewTag: true` leaves a features string (`webviewTag=yes`) in
          // charge.
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
          },
          ...APP_WINDOW_OPTIONS,
        },
      };
    case "external":
      void shell.openExternal(target);
      return { action: "deny" };
    case "deny":
      logLine(`[shell] refused to open a window for ${urlForLog(target)}`);
      return { action: "deny" };
  }
}

/**
 * The rules a window opened by this app lives under — and, in turn, every window that one
 * opens: a window-open handler belongs to one window, so a window opened from a preview page
 * would otherwise open anything at all. Its navigation policy is "stay within this instance's
 * loopback surface": a child lands on the preview host after the redirect, and the main
 * window's stricter app-origin-only rule would bounce the preview itself out. A window stays
 * open when one of its links opens externally.
 *
 * The window is also kept where the user can see it. APP_WINDOW_OPTIONS pins what the page's
 * feature string could hide, but a position is not an option to pin — `left`/`top` arrive as
 * `x`/`y` — so the window is centered here instead, and the page's own `moveTo`/`resizeTo`,
 * which Electron would otherwise apply, is refused: off-screen is hidden too.
 */
function guardOpenedWindow(child: BrowserWindow, iconPath: string | null): void {
  child.center();
  child.webContents.on("content-bounds-updated", (event) => event.preventDefault());
  child.webContents.setWindowOpenHandler(({ url: target }) => openWindowFor(target, iconPath));
  child.webContents.on("did-create-window", (next) => guardOpenedWindow(next, iconPath));
  // A session that dies while a child window is open sends that window to the sign-in page
  // too — the App's guard redirects on the first 401, wherever it is rendered. A sign-in form
  // is of no use in a subordinate surface: there is no password to type, and signing back in
  // is the main window's business, which it now does by itself. So the child closes instead,
  // which for a detached terminal returns its tab to the dock in the main window rather than
  // stranding it behind a form. A preview window never reaches this page: an unauthorized
  // preview hand-off answers with an API error, not the App.
  const closeOnSignInPage = (url: string): void => {
    if (isLoginPageUrl(url, appOrigin)) child.close();
  };
  child.webContents.on("did-navigate", (_event, url) => closeOnSignInPage(url));
  child.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) closeOnSignInPage(url);
  });
  child.webContents.on("will-navigate", (event, target) => {
    if (!isLocalSurfaceUrl(target, appOrigin)) {
      event.preventDefault();
      openInSystem(target);
    }
  });
}

/** A navigation that leaves the app: a web or mail link goes to the system; any other scheme is refused. */
function openInSystem(target: string): void {
  if (isExternalScheme(target)) void shell.openExternal(target);
  else logLine(`[shell] refused to hand ${urlForLog(target)} to the system`);
}

/**
 * Bring the main window forward, whatever state it is in: hidden by close-to-tray, minimized,
 * or gone entirely (a closed window with close-to-tray off). Used by the tray icon, a second
 * launch, and the macOS Dock.
 */
function showMainWindow(): void {
  if (win === null) {
    if (appOrigin !== null) createWindow(`${appOrigin}/`);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Tray navigation. The window is a plain browser, so a destination is just a URL to load —
 * no IPC channel into the Web App. Before boot resolves an origin there is nowhere to go, and
 * showing the window is the whole action. A window that has to be created starts on the
 * destination rather than on the app root: loading `/` first would boot the whole Web App
 * only to abort it a tick later, with the aborted load's rejection going unhandled.
 */
function navigateMainWindow(target: string): void {
  if (appOrigin === null) {
    showMainWindow();
    return;
  }
  const url = `${appOrigin}${target}`;
  if (win === null) {
    createWindow(url);
    return;
  }
  showMainWindow();
  void win.loadURL(url);
}

// --- signing the window in -------------------------------------------------

/** The data root this shell owns; null until boot resolves it. */
let shellDataRoot: string | null = null;
/**
 * The lock of the server this shell attached to instead of starting its own, so a failure
 * can name the process holding the data root; null while the server is this shell's.
 */
let attachedServer: ServerLock | null = null;
/**
 * Which arrivals at the sign-in page the shell answers with a session — one attempt per
 * stay, and none at all after a sign-out. It starts fresh with the process, which is what
 * makes a launch the way back in after signing out (see attach-session.ts).
 */
const signInGuard = createSignInGuard();

/**
 * Puts a session cookie for the current origin into the window's cookie store, by minting a
 * session row in the data root this shell owns. False means it could not and the dialog
 * explaining that is up; the caller then lets the window reach the sign-in page, which is at
 * least a page with an explanation behind it rather than a dead end.
 */
async function signInFromDataRoot(): Promise<boolean> {
  const root = shellDataRoot;
  if (root === null || appOrigin === null) return false;
  const plan = planSignIn({ root, origin: appOrigin, mint: mintApiToken });
  if (plan.outcome === "failed") {
    showSignInFailure(root, plan.failure);
    return false;
  }
  try {
    await session.defaultSession.cookies.set(plan.cookie);
    return true;
  } catch (err) {
    // The row exists and the cookie store refused it. Rare enough to have no handling of its
    // own, and identical from where the user sits, so it takes the same explanation.
    showSignInFailure(root, { reason: "failed", detail: String(err) });
    return false;
  }
}

/** Reports a failed sign-in: one line in the log, and the dialog the user acts on. */
function showSignInFailure(dataRoot: string, failure: SignInFailure): void {
  logLine(`[shell] the window could not be signed in: ${failure.detail}`);
  const opts = {
    type: "warning" as const,
    title: app.name,
    ...signInFailureDialog({ dataRoot, other: attachedServer, failure }),
  };
  void (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

/** The App's sign-out, as a request pattern: the one intent a navigation cannot express. */
const SIGN_OUT_REQUEST = "*://*/api/auth/logout";

/**
 * Watches for the App ending the session on purpose, which the catch-all must not undo.
 * A sign-out leads to the same page as an expired session and needs the opposite answer, and
 * the page never tells the shell which it is — so the intent is read off the request the App
 * makes to end the session. The listener belongs to the session rather than to one window, so
 * a sign-out from any window of this app counts, and registering it again replaces it.
 */
function watchForSignOut(target: BrowserWindow): void {
  target.webContents.session.webRequest.onCompleted({ urls: [SIGN_OUT_REQUEST] }, (details) => {
    // A refused sign-out leaves the session alive, so the window never reaches the sign-in
    // page, and there is nothing to suppress.
    if (details.statusCode < 400 && isAppUrl(details.url, appOrigin)) signInGuard.signedOut();
  });
}

/** Runs the guard's decision for wherever the main window has just landed. */
function onMainWindowNavigated(url: string): void {
  if (signInGuard.arrived(url, appOrigin) !== "rescue") return;
  void signInFromDataRoot().then((signedIn) => {
    // The app root, not a reload: the page underneath IS the sign-in page, and reloading it
    // shows it for a beat before the App redirects a signed-in window away from it. A failed
    // attempt loads nothing — the window is already going where it would be sent.
    const landing = signedIn && appOrigin !== null ? `${appOrigin}/` : null;
    signInGuard.tried(landing);
    if (landing !== null) void win?.loadURL(landing);
  });
}

// --- tray -----------------------------------------------------------------

/**
 * Creates the tray icon if the preference asks for one and there is none. Idempotent: the
 * app installs exactly one tray, and a platform that cannot host one (a Linux desktop
 * without a tray, a headless run) simply leaves `tray` null — see installTray.
 */
function openTray(): void {
  // `quitting`: before-quit takes the icon down, and a frame still in flight from the
  // page must not put one back for the seconds the graceful server stop takes.
  if (quitting || !showTrayIcon || tray !== null) return;
  tray = installTray({
    userDataDir: app.getPath("userData"),
    iconPath: resolveTrayIcon(app.getAppPath(), process.platform),
    appName: app.name,
    locale: trayLocale,
    onShowWindow: showMainWindow,
    onNavigate: navigateMainWindow,
    onQuit: () => app.quit(),
    log: (line) => logLine(`[shell] ${line}`),
  });
}

/**
 * Applies Settings › Appearance's tray switch: the icon appears or goes at once, no
 * restart, and the choice is stored for the next launch. Turning it off also turns off
 * close-to-tray in effect — with no icon the window's close handler stops intercepting
 * (see hidesOnClose), so the window can never hide where nothing could bring it back.
 */
function setShowTrayIcon(next: boolean): void {
  showTrayIcon = next;
  try {
    updateTrayPrefs(app.getPath("userData"), { showTrayIcon: next });
  } catch (err) {
    logLine(`[shell] the tray preference could not be saved: ${String(err)}`);
  }
  if (next) {
    openTray();
  } else {
    tray?.dispose();
    tray = null;
  }
  pushTrayStatus();
}

/** Tells the page what the tray is actually doing, which is what its switch renders. */
function pushTrayStatus(): void {
  relayChild?.postMessage(trayStatusMessage(showTrayIcon, trayLocale));
}

/**
 * Applies the Web App's UI language to the tray menu. The menu is built per popup, so a
 * change costs nothing until the next one is opened — except on Linux, where the menu is
 * attached to the icon and has to be rebuilt in place; the tray handle does that itself.
 */
function setTrayLocale(next: TrayLocale): void {
  if (next === trayLocale) return;
  trayLocale = next;
  try {
    updateTrayPrefs(app.getPath("userData"), { locale: next });
  } catch (err) {
    logLine(`[shell] the tray language could not be saved: ${String(err)}`);
  }
  tray?.setLocale(next);
  pushTrayStatus();
}

/**
 * Shell relay over the utilityProcess port: forward the account-menu row's check/install
 * frames to the updater, the Appearance switch's frames to the tray, the built-in browser's
 * commands to its guests and the Workspace picker's folder-access requests to folder-access.ts,
 * push every updater status fold back, and push both current states now — the fresh child,
 * restarts included, must not start blind. The subscription dies with the child; the next
 * start wires the next one.
 */
function wireShellRelay(child: EmbeddedServer["child"]): void {
  relayChild = child;
  child.on("message", (message: unknown) => {
    if (builtinBrowser.handle(message)) return;
    if (handleFolderAccessFrame(message, folderAccess)) return;
    const action = parseUpdaterCommand(message);
    if (action !== null) {
      handleUpdaterCommand(action);
      return;
    }
    const command = parseTrayCommand(message);
    if (command !== null) {
      if (command.locale !== undefined) setTrayLocale(command.locale);
      if (command.showTrayIcon !== undefined) setShowTrayIcon(command.showTrayIcon);
    }
  });
  const unsubscribe = onUpdaterStatus((status) => child.postMessage(updaterStatusMessage(status)));
  child.on("exit", () => {
    unsubscribe();
    if (relayChild === child) relayChild = null;
  });
  child.postMessage(updaterStatusMessage(getUpdaterStatus()));
  pushTrayStatus();
}

/** Starts (or restarts) the embedded server and points the window at the claim link. */
async function startServerAndWindow(dataRoot: string): Promise<void> {
  const webDist = webDistFor({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    env: process.env,
  });
  // Checked here, not left to the server: a server with nothing to serve still starts,
  // and the window would open on a 404 with no line in the log naming the directory.
  if (webDist !== null && !fs.existsSync(webDistEntry(webDist))) {
    throw new Error(
      `The Web App is missing: ${webDistEntry(webDist)} does not exist. ` +
        `This build was packed without the web assets, or PENGUIN_WEB_DIST points elsewhere.`,
    );
  }
  const started = await startEmbeddedServer({
    dataRoot,
    webDist,
    cliEntry: embeddedCliEntry({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      env: process.env,
    }),
    profile,
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk, stream) => logServerOutput(stream, chunk),
  });
  server = started;
  appOrigin = started.origin;
  wireShellRelay(started.child);
  // A run that stays up for a minute is healthy: reset the restart budget so a crash
  // days later starts a fresh 1s/2s/4s ladder instead of hitting the cap immediately.
  const healthyTimer = setTimeout(() => {
    restartAttempts = 0;
  }, 60_000);
  started.child.on("exit", (code) => {
    clearTimeout(healthyTimer);
    void handleServerExit(dataRoot, code);
  });
  const url = desktopLoginUrl(started.origin, started.token);
  if (win === null) createWindow(url);
  else void win.loadURL(url);
}

/** Unexpected server death: restart with backoff; give up with an error dialog at the cap. */
async function handleServerExit(dataRoot: string, code: number): Promise<void> {
  if (quitting) {
    logLine(`[shell] server exited (code ${code})`);
    return;
  }
  server = null;
  if (restartAttempts >= MAX_SERVER_RESTARTS) {
    fatal(`The embedded server keeps exiting (last exit code ${code}).`, "Giving up.");
    return;
  }
  const wait = restartDelayMs(restartAttempts);
  restartAttempts += 1;
  logLine(`[shell] server exited (code ${code}); restarting in ${wait}ms`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  if (quitting) return;
  try {
    await startServerAndWindow(dataRoot);
  } catch (err) {
    fatal("The embedded server could not be restarted.", err);
  }
}

async function boot(): Promise<void> {
  // Explicit PENGUIN_HOME wins; otherwise the release profile shares the CLI's data root
  // and the dev profile takes the repo's dev root (the rule, and why, live in app-identity.ts).
  const dataRoot = desktopDataRoot({
    envHome: process.env.PENGUIN_HOME,
    profile,
    homedir: os.homedir(),
    releaseRoot: resolveRoot,
  });
  shellDataRoot = dataRoot;
  if (profile === "dev") {
    logLine(`[shell] dev instance '${app.name}' on data root ${dataRoot}`);
  }
  const existing = await liveServerLock(dataRoot);
  if (existing !== null) {
    // Attach mode: another server — a `penguin web` run, an older app still up — holds this
    // data root, and the one-shot token only works against a server this shell spawned. The
    // window is signed in the other way the product recognizes instead: a session minted
    // straight into the root this shell owns, which is the same authority the CLI mints on.
    attachedServer = existing;
    appOrigin = `http://localhost:${existing.port}`;
    logLine(`[shell] attaching to the running server at ${appOrigin} (pid ${existing.pid})`);
    await signInFromDataRoot();
    // Either way the window opens on the app root: signed in it goes straight into the App,
    // and otherwise the App sends it to the sign-in page the dialog has just explained. The
    // attempt is recorded with that URL, so arriving there does not buy a second one.
    const landing = `${appOrigin}/`;
    signInGuard.tried(landing);
    createWindow(landing);
    return;
  }
  await startServerAndWindow(dataRoot);
}

// --- app lifecycle ---------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // The log file is this instance's from here: a second launch quits above without touching it.
  const logFile = startDesktopLog(path.join(app.getPath("userData"), "logs", "desktop.log"));
  logLine(
    `[shell] ${app.name} ${app.getVersion()} starting (Electron ${process.versions.electron}, ` +
      `${process.platform} ${process.arch}, ${Math.round(os.totalmem() / 2 ** 30)} GB memory); log ${logFile}`,
  );

  app.on("second-instance", () => showMainWindow());

  // Every renderer and child process that dies says so in the log: the app window's page (which
  // the window then reloads), a browser tab's, DevTools', the GPU process, the embedded server.
  app.on("render-process-gone", (_event, contents, details) => {
    logLine(
      `[shell] ${rendererGoneLine({
        type: contents.getType(),
        id: contents.id,
        url: contents.getURL(),
        reason: details.reason,
        exitCode: details.exitCode,
      })}`,
    );
  });
  app.on("child-process-gone", (_event, details) => {
    logLine(
      `[shell] ${childGoneLine({
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        ...(details.serviceName !== undefined ? { serviceName: details.serviceName } : {}),
        ...(details.name !== undefined ? { name: details.name } : {}),
      })}`,
    );
  });
  app.on("will-quit", () => stopDesktopLog());

  app.on("window-all-closed", () => {
    // macOS keeps the app alive in the Dock; elsewhere closing the window quits.
    if (process.platform !== "darwin") app.quit();
  });

  // Dock click: the window may be hidden in the tray rather than gone, so show before recreate.
  app.on("activate", () => showMainWindow());

  // Quit path: stop the embedded server gracefully first (shutdown endpoint → kill),
  // then let the quit proceed. Attach mode has no child to stop.
  app.on("before-quit", (event) => {
    quitting = true;
    // The icon goes as soon as the app is on its way out, rather than lingering through the
    // graceful server stop; nulling it keeps the second pass (after the stop) from destroying
    // an already destroyed tray.
    tray?.dispose();
    tray = null;
    if (server !== null && stopPromise === null) {
      event.preventDefault();
      const running = server;
      server = null;
      stopPromise = stopEmbeddedServer(running).finally(() => app.quit());
    }
  });

  void app.whenReady().then(() =>
    (async () => {
      // GUI launches on macOS/Linux miss the login shell's exports (model API keys for
      // core's env fallback, the PATH the agent shell needs). Import them fill-missing
      // before anything reads process.env — boot() resolves PENGUIN_HOME from it, and
      // the forked server inherits it (#351).
      await applyLoginShellEnv({
        platform: process.platform,
        env: process.env,
        shell: process.env.SHELL,
        log: (line) => logLine(`[shell] ${line}`),
      });
      // Standard menu plus native desktop-only actions; the window gets no IPC channel.
      // The install item is the release profile's, like the per-launch repair below: the
      // `penguin` command has one owner, and a `--dev` instance of the same install would
      // rewrite it and record having done so in its own userData.
      installAppMenu({
        includeCliInstall: profile === "release" && currentCliInstallKind() !== null,
        onInstallCli: () => void installCliCommand(win),
      });
      // Before boot, and whatever the window is doing: the icon is there for as long as the
      // app runs. Its menu's navigation entries tolerate an origin that is not resolved yet,
      // and the close-to-tray preference has to be in hand before the first window close can
      // happen.
      const trayPrefs = readTrayPrefs(app.getPath("userData"));
      showTrayIcon = trayPrefs.showTrayIcon;
      // Nothing has reported a language yet on a first launch, so the device decides — the
      // same rule the Web App applies to its own "follow the system" default.
      trayLocale = trayPrefs.locale ?? resolveTrayLocale(app.getLocale());
      openTray();
      initUpdater(() => win);
      await boot();
      // Install or repair the bundled 'penguin' command. Runs every launch: that is what
      // carries it across an update and repairs a link a moved app left dangling. Only the
      // release profile does it — a `--dev` instance of the same install has nothing of
      // its own to link, and one owner keeps the link from being rewritten twice. Skipped
      // in smoke mode — the macOS administrator prompt would hang the automated run.
      if (profile === "release" && process.env.PENGUIN_DESKTOP_SMOKE !== "1") {
        await ensureCliCommand();
      }
    })().catch((err) => fatal(`${app.name} failed to start.`, err)),
  );
}

// --- smoke hook ------------------------------------------------------------

/** Render-settle delay before sampling the page in smoke mode. */
const SMOKE_SETTLE_MS = 2500;

function armSmokeProbe(target: BrowserWindow): void {
  if (process.env.PENGUIN_DESKTOP_SMOKE !== "1") return;
  target.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void (async () => {
        try {
          const result = {
            title: target.webContents.getTitle(),
            url: target.webContents.getURL(),
            origin: appOrigin,
            embedded: server !== null,
          };
          const shot = process.env.PENGUIN_DESKTOP_SMOKE_SHOT;
          if (shot) {
            const image = await target.webContents.capturePage();
            const { writeFileSync } = await import("node:fs");
            writeFileSync(shot, image.toPNG());
          }
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify(result)}\n`);
        } catch (err) {
          process.stdout.write(`DESKTOP-SMOKE-RESULT ${JSON.stringify({ error: String(err) })}\n`);
        } finally {
          app.quit();
        }
      })();
    }, SMOKE_SETTLE_MS);
  });
}
