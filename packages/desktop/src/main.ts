/**
 * Desktop shell main process (design § "桌面端原型").
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
 * Smoke hook (PENGUIN_DESKTOP_SMOKE=1): after the first load settles, print a
 * `DESKTOP-SMOKE-RESULT {json}` line (+ screenshot when PENGUIN_DESKTOP_SMOKE_SHOT is
 * set) and quit through the regular quit path, exercising the graceful server stop.
 */
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import { startEmbeddedServer, stopEmbeddedServer } from "./server-process.js";
import type { EmbeddedServer } from "./server-process.js";
import {
  desktopLoginUrl,
  isAppUrl,
  isLocalSurfaceUrl,
  MAX_SERVER_RESTARTS,
  restartDelayMs,
} from "./util.js";

app.setName("PenguinHarness");

let win: BrowserWindow | null = null;
let server: EmbeddedServer | null = null;
/** App origin (embedded or attached); null until boot resolves. */
let appOrigin: string | null = null;
let quitting = false;
let stopPromise: Promise<void> | null = null;
let restartAttempts = 0;

function fatal(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  dialog.showErrorBox("PenguinHarness", `${context}\n\n${detail}`);
  app.exit(1);
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
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
  const dataRoot = process.env.PENGUIN_HOME ?? resolveRoot();
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

  void app
    .whenReady()
    .then(() => boot().catch((err) => fatal("PenguinHarness failed to start.", err)));
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
