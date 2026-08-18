/**
 * Auto-update (design § "桌面端原型 · 自动更新").
 *
 * electron-updater against the GitHub Releases feed the build publishes
 * (`latest*.yml` + `.blockmap` ship as Release assets). The shell deliberately exposes
 * updates through **native UI only** — an app-menu item plus dialogs — because it injects
 * no IPC channel into the page; the Web App keeps hiding its own self-update entry in
 * desktop mode.
 *
 * Automatic checks are quiet: they run on a timer, download in the background, and speak
 * up only when a build is ready to install. A manual check reports every outcome (already
 * up to date / downloading / failed), the same rule the Web App's check-for-updates row
 * follows — a manual action that answers with silence reads as broken.
 *
 * Release builds use Developer ID signing on macOS and Authenticode signing on Windows;
 * unsigned dry-run artifacts can still find updates, but platform trust and release
 * gates only apply to signed release builds. Linux AppImage continues without
 * code-signing for now.
 */
import { app, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { feedUrlOverride, updateSupport } from "./update-support.js";

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
  const support = updateSupport({
    isPackaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
  });
  if (!support.supported) {
    log(`disabled (${support.reason})`);
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

  autoUpdater.on("checking-for-update", () => log("checking"));
  autoUpdater.on("update-not-available", (info: { version: string }) => {
    log(`up to date (${info.version})`);
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
  });
  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    downloadedVersion = info.version;
    log(`downloaded: ${info.version}`);
    void promptRestart(info.version, getWindow());
  });
  autoUpdater.on("error", (err: Error) => {
    log(`error: ${err.message}`);
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
