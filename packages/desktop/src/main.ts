/**
 * Desktop shell main process.
 *
 * RUNTIME LAYER — MECHANISM ONLY (see packages/server/src/hmr/README.md). The
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
 * window loads that instance instead — normal login page, deliberate degradation.
 *
 * Tray: a system-tray icon is shown for as long as the app runs, and by default closing the
 * window only hides it, so the server and its background tasks keep running (see tray.ts;
 * both preferences live in userData/tray.json and Quit still goes through the graceful
 * stop). Settings › Appearance turns the icon off and on, reaching the shell over the same
 * utilityProcess relay the client updater uses.
 *
 * Dev isolation: an unpackaged run takes a dev-suffixed identity (own userData, and with
 * it the single-instance lock and sticky port) and defaults to the ~/.penguin/dev-data
 * root, so it runs beside an installed release build (see app-identity.ts).
 *
 * Smoke hook (PENGUIN_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when PENGUIN_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import { appIdentity, desktopDataRoot } from "./app-identity.js";
import { embeddedCliEntry } from "./launcher.js";
import { webDistEntry, webDistFor } from "./web-dist.js";
import { resolveTrayIcon, resolveWindowIcon } from "./app-icon.js";
import { installCliCommand, ensureCliCommand, currentCliInstallKind } from "./cli-install.js";
import { applyLoginShellEnv } from "./login-shell-env.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
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
  desktopLoginUrl,
  hidesOnClose,
  isAppUrl,
  isLocalSurfaceUrl,
  MAX_SERVER_RESTARTS,
  restartDelayMs,
} from "./util.js";

// Identity first: the name decides the userData directory, which also keys the
// single-instance lock requested below — a dev (unpackaged) run takes a dev-suffixed
// identity so it runs beside an installed release build instead of quitting into its
// window (#292; see app-identity.ts).
const identity = appIdentity(app.isPackaged);
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
let server: EmbeddedServer | null = null;
/** The live server child, for pushes that are not answers to one of its messages. */
let relayChild: EmbeddedServer["child"] | null = null;
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;

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
    },
  });
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
  // "Open in a new tab" (Workspace HTML previews) is an app-origin link that mints a
  // token and 302s to the preview origin — it needs the session cookie, so it must open
  // in a window of this app; handing it to the system browser would land on a 401.
  // Denying it outright (as this did at first) made the entry silently do nothing.
  // Genuinely external links still go to the system browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalSurfaceUrl(target, appOrigin)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 800,
          autoHideMenuBar: true,
          ...(iconPath !== null ? { icon: iconPath } : {}),
          // Same hardening as the main window: the preview is Agent-written, untrusted
          // HTML and must never get Node.
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    void shell.openExternal(target);
    return { action: "deny" };
  });
  // The child lands on the preview origin after the redirect, so its policy is "stay
  // within this instance's loopback surface, everything else to the system browser" —
  // the main window's stricter app-origin-only rule would bounce the preview itself out.
  win.webContents.on("did-create-window", (child) => {
    child.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isLocalSurfaceUrl(target, appOrigin)) return { action: "allow" };
      void shell.openExternal(target);
      return { action: "deny" };
    });
    child.webContents.on("will-navigate", (event, target) => {
      if (!isLocalSurfaceUrl(target, appOrigin)) {
        event.preventDefault();
        void shell.openExternal(target);
      }
    });
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!isAppUrl(target, appOrigin)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  win.webContents.on("render-process-gone", () => win?.webContents.reload());
  armSmokeProbe(win);
  void win.loadURL(url);
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
    onShowWindow: showMainWindow,
    onNavigate: navigateMainWindow,
    onQuit: () => app.quit(),
    log: (line) => process.stdout.write(`[shell] ${line}\n`),
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
    process.stdout.write(`[shell] the tray preference could not be saved: ${String(err)}\n`);
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
  relayChild?.postMessage(trayStatusMessage(showTrayIcon));
}

/**
 * Shell relay over the utilityProcess port: forward the account-menu row's check/install
 * frames to the updater and the Appearance switch's frames to the tray, push every updater
 * status fold back, and push both current states now — the fresh child, restarts included,
 * must not start blind. The subscription dies with the child; the next start wires the next
 * one.
 */
function wireShellRelay(child: EmbeddedServer["child"]): void {
  relayChild = child;
  child.on("message", (message: unknown) => {
    const action = parseUpdaterCommand(message);
    if (action !== null) {
      handleUpdaterCommand(action);
      return;
    }
    const nextShowTrayIcon = parseTrayCommand(message);
    if (nextShowTrayIcon !== null) setShowTrayIcon(nextShowTrayIcon);
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
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk) => process.stdout.write(`[server] ${chunk}`),
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
  if (quitting) return;
  server = null;
  if (restartAttempts >= MAX_SERVER_RESTARTS) {
    fatal(`The embedded server keeps exiting (last exit code ${code}).`, "Giving up.");
    return;
  }
  const wait = restartDelayMs(restartAttempts);
  restartAttempts += 1;
  process.stdout.write(`[shell] server exited (code ${code}); restarting in ${wait}ms\n`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  if (quitting) return;
  try {
    await startServerAndWindow(dataRoot);
  } catch (err) {
    fatal("The embedded server could not be restarted.", err);
  }
}

async function boot(): Promise<void> {
  // Explicit PENGUIN_HOME wins; otherwise a release build shares the CLI's data root and
  // a dev run takes the repo's dev root (the rule, and why, live in app-identity.ts).
  const dataRoot = desktopDataRoot({
    envHome: process.env.PENGUIN_HOME,
    isPackaged: app.isPackaged,
    homedir: os.homedir(),
    releaseRoot: resolveRoot,
  });
  if (!app.isPackaged) {
    process.stdout.write(`[shell] dev instance '${app.name}' on data root ${dataRoot}\n`);
  }
  const existing = await liveServerLock(dataRoot);
  if (existing !== null) {
    // Attach mode: the one-shot token only works against a server this shell spawned,
    // so the window goes through the normal login page of the existing instance.
    appOrigin = `http://localhost:${existing.port}`;
    process.stdout.write(`[shell] attaching to the running server at ${appOrigin}\n`);
    createWindow(`${appOrigin}/`);
    return;
  }
  await startServerAndWindow(dataRoot);
}

// --- app lifecycle ---------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

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
        log: (line) => process.stdout.write(`[shell] ${line}\n`),
      });
      // Standard menu plus native desktop-only actions; the window gets no IPC channel.
      installAppMenu({
        includeCliInstall: currentCliInstallKind() !== null,
        onInstallCli: () => void installCliCommand(win),
      });
      // Before boot, and whatever the window is doing: the icon is there for as long as the
      // app runs. Its menu's navigation entries tolerate an origin that is not resolved yet,
      // and the close-to-tray preference has to be in hand before the first window close can
      // happen.
      showTrayIcon = readTrayPrefs(app.getPath("userData")).showTrayIcon;
      openTray();
      initUpdater(() => win);
      await boot();
      // Install or repair the bundled 'penguin' command. Runs every launch: that is what
      // carries it across an update and repairs a link a moved app left dangling. Skipped
      // in smoke mode — the macOS administrator prompt would hang the automated run.
      if (process.env.PENGUIN_DESKTOP_SMOKE !== "1") await ensureCliCommand();
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
