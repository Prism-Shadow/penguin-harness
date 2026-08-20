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
 * `http://localhost:<port>/api/auth/desktop-login?token=…` — the one-shot token lands
 * the window signed in as admin. The window is a plain browser environment (no preload,
 * no node integration); every capability flows through the server's HTTP API.
 *
 * Attach mode: when a live server (e.g. `penguin web`) already owns the data root, the
 * window loads that instance instead — normal login page, deliberate degradation.
 *
 * Dev isolation: an unpackaged run takes a dev-suffixed identity (own userData, and with
 * it the single-instance lock and sticky port) and defaults to the ~/.penguin/dev-data
 * root, so it runs beside an installed release build (see app-identity.ts).
 *
 * Smoke hook (PENGUIN_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when PENGUIN_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import { appIdentity, desktopDataRoot } from "./app-identity.js";
import { resolveWindowIcon } from "./app-icon.js";
import { installCliCommand, maybeOfferCliInstall, currentCliInstallKind } from "./cli-install.js";
import { applyLoginShellEnv } from "./login-shell-env.js";
import { installAppMenu } from "./menu.js";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
import { initUpdater } from "./updater.js";
import {
  desktopLoginUrl,
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
let server: EmbeddedServer | null = null;
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

/** Starts (or restarts) the embedded server and points the window at desktop-login. */
async function startServerAndWindow(dataRoot: string): Promise<void> {
  const started = await startEmbeddedServer({
    dataRoot,
    portFile: path.join(app.getPath("userData"), "server-port"),
    preferredPortFile: path.join(app.getPath("userData"), "preferred-port"),
    log: (chunk) => process.stdout.write(`[server] ${chunk}`),
  });
  server = started;
  appOrigin = started.origin;
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
  app.on("second-instance", () => {
    if (win !== null) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app alive in the Dock; elsewhere closing the window quits.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (win === null && appOrigin !== null) createWindow(`${appOrigin}/`);
  });

  // Quit path: stop the embedded server gracefully first (shutdown endpoint → kill),
  // then let the quit proceed. Attach mode has no child to stop.
  app.on("before-quit", (event) => {
    quitting = true;
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
      initUpdater(() => win);
      await boot();
      // First launch only: offer the 'penguin' command once; the menu entry remains.
      // Skipped in smoke mode — a modal dialog would hang the automated run.
      if (process.env.PENGUIN_DESKTOP_SMOKE !== "1") await maybeOfferCliInstall(win);
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
