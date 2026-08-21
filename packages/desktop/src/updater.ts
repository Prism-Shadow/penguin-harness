/**
 * Auto-update (design § "桌面端原型 · 自动更新").
 *
 * electron-updater against the GitHub Releases feed the build publishes
 * (`latest*.yml` + `.blockmap` ship as Release assets). Updates surface in two places:
 * the native app-menu item with its dialogs, and the account menu of the shell's own
 * window — fed over the utilityProcess port to the embedded server (main.ts pushes each
 * status fold, GET /api/desktop/update serves it). The window itself stays a plain
 * browser: the relay adds server HTTP surface, never a renderer IPC bridge.
 *
 * Automatic checks are quiet: they run on a timer, download in the background, and speak
 * up only when a build is ready to install. A manual check reports every outcome (already
 * up to date / downloading / failed), the same rule the Web App's check-for-updates row
 * follows — a manual action that answers with silence reads as broken. A web-initiated
 * check is manual too, but its outcomes render in the row that asked, not in dialogs.
 *
 * Release builds use Developer ID signing on macOS and Authenticode signing on Windows;
 * unsigned dry-run artifacts can still find updates, but platform trust and release
 * gates only apply to signed release builds. Linux AppImage continues without
 * code-signing for now.
 */
import { app, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import { feedUrlOverride, updateSupport } from "./update-support.js";
import { initialUpdateStatus, nextUpdateStatus } from "./updater-status.js";
import type { UpdaterEvent } from "./updater-status.js";

const { autoUpdater } = electronUpdater;

/** First check runs after this delay: booting the server and the window comes first. */
const FIRST_CHECK_DELAY_MS = 20_000;
/** Subsequent automatic checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";

function log(line: string): void {
  process.stdout.write(`[updater] ${line}\n`);
}

let manualCheckInFlight = false;
let downloadedVersion: string | null = null;

// --- status relay (the account-menu row's data source) -----------------------

let status: DesktopUpdateStatus = initialUpdateStatus("");
const statusListeners = new Set<(status: DesktopUpdateStatus) => void>();

/** Folds one event into the snapshot and pushes it to every subscriber. */
function emitStatus(ev: UpdaterEvent): void {
  status = nextUpdateStatus(status, ev);
  for (const listener of statusListeners) listener(status);
}

/** Current snapshot, for the initial push after a server (re)start. */
export function getUpdaterStatus(): DesktopUpdateStatus {
  return status;
}

/** Subscribes to every status fold; returns the unsubscribe (main.ts drops it when the server child exits). */
export function onUpdaterStatus(listener: (status: DesktopUpdateStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/**
 * Server-relayed command from the account-menu row. `check` is a manual check whose
 * outcomes render in the row (no dialogs); `install` restarts into a downloaded build —
 * the row only offers it in the `downloaded` state, so a stale frame is dropped here.
 */
export function handleUpdaterCommand(action: "check" | "install"): void {
  if (action === "check") {
    if (updatesAvailableInThisForm()) void check();
    return;
  }
  if (downloadedVersion === null) {
    log("install requested with nothing downloaded (stale row); ignoring");
    return;
  }
  // Same path as the dialog's "Restart now": quitAndInstall goes through the normal
  // quit sequence, so the shell's before-quit hook still stops the embedded server
  // gracefully before the files are replaced.
  autoUpdater.quitAndInstall();
}

/** Whether the "Check for Updates…" menu item should be enabled at all. */
export function updatesAvailableInThisForm(): boolean {
  return updateSupport({ isPackaged: app.isPackaged, platform: process.platform, env: process.env })
    .supported;
}

/**
 * Wires the updater and starts the automatic schedule. Safe to call in any form: an
 * unsupported one (dev run, deb install) only logs why it is standing down.
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  status = initialUpdateStatus(app.getVersion());
  const support = updateSupport({
    isPackaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
  });
  if (!support.supported) {
    log(`disabled (${support.reason})`);
    emitStatus({ kind: "unsupported", reason: support.reason });
    return;
  }

  // Background downloads, explicit install: the user decides when to restart. Quitting
  // normally must NOT swap the app underneath a running server, so install happens only
  // through the dialog's own path.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

  const override = feedUrlOverride(process.env);
  if (override) {
    // Generic provider: also the shape the documented auto | oss | github source switch
    // will use for the OSS mirror.
    autoUpdater.setFeedURL({ provider: "generic", url: override });
    log(`feed override: ${override}`);
  }

  autoUpdater.on("checking-for-update", () => {
    log("checking");
    emitStatus({ kind: "checking" });
  });
  autoUpdater.on("update-not-available", (info: { version: string }) => {
    log(`up to date (${info.version})`);
    emitStatus({ kind: "not-available" });
    if (manualCheckInFlight) {
      manualCheckInFlight = false;
      void dialog.showMessageBox({
        type: "info",
        message: "PenguinHarness is up to date.",
        detail: `Version ${app.getVersion()} is the latest release.`,
        buttons: ["OK"],
      });
    }
  });
  autoUpdater.on("update-available", (info: { version: string }) => {
    log(`update available: ${info.version} (downloading)`);
    emitStatus({ kind: "available", version: info.version });
    if (manualCheckInFlight) {
      manualCheckInFlight = false;
      void dialog.showMessageBox({
        type: "info",
        message: `Version ${info.version} is available.`,
        detail:
          "It is downloading in the background; you will be asked to restart when it is ready.",
        buttons: ["OK"],
      });
    }
  });
  autoUpdater.on("download-progress", (p: { percent: number }) => {
    log(`downloading ${Math.round(p.percent)}%`);
    emitStatus({ kind: "progress", percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    downloadedVersion = info.version;
    log(`downloaded: ${info.version}`);
    emitStatus({ kind: "downloaded", version: info.version });
    void promptRestart(info.version, getWindow());
  });
  autoUpdater.on("error", (err: Error) => {
    log(`error: ${err.message}`);
    emitStatus({ kind: "error", message: err.message });
    if (manualCheckInFlight) {
      manualCheckInFlight = false;
      void dialog
        .showMessageBox({
          type: "error",
          message: "Could not check for updates.",
          detail: `${err.message}\n\nYou can always download the latest release manually.`,
          buttons: ["Open Releases", "OK"],
          defaultId: 1,
          cancelId: 1,
        })
        .then((r) => {
          if (r.response === 0) void shell.openExternal(RELEASES_URL);
        });
    }
  });

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
}

async function check(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The error event already reported it; this catch only keeps the rejection from
    // reaching the process-level handler.
    log(`check failed: ${(err as Error).message}`);
  }
}

/** Menu action: same check, but every outcome is reported. */
export async function checkForUpdatesManually(): Promise<void> {
  if (!updatesAvailableInThisForm()) {
    const support = updateSupport({
      isPackaged: app.isPackaged,
      platform: process.platform,
      env: process.env,
    });
    const detail =
      support.supported || support.reason === "dev"
        ? "This build does not update itself."
        : "This copy was installed from a system package; update it with your package manager.";
    await dialog.showMessageBox({ type: "info", message: "Updates are unavailable.", detail });
    return;
  }
  if (downloadedVersion !== null) {
    await promptRestart(downloadedVersion, null);
    return;
  }
  manualCheckInFlight = true;
  await check();
}

/** "Ready to install" prompt; restarting is the only path that swaps the app. */
async function promptRestart(version: string, parent: BrowserWindow | null): Promise<void> {
  const options = {
    type: "info" as const,
    message: `Version ${version} is ready to install.`,
    detail: "PenguinHarness will restart to finish updating. Running tasks will be interrupted.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
  };
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) return;
  // quitAndInstall triggers the normal quit path first, so the shell's before-quit hook
  // still stops the embedded server gracefully before the files are replaced.
  autoUpdater.quitAndInstall();
}
