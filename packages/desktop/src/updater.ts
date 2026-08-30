/**
 * Auto-update.
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
import { app, dialog, net, shell } from "electron";
import type { BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import { resolveProfile } from "./app-identity.js";
import { feedUrlOverride, updateSourceConfig, updateSupport } from "./update-support.js";
import {
  feedLabel,
  ossFeedUrl,
  resolveOssLatestTag,
  selectAutoUpdateFeed,
} from "./update-source.js";
import type { FetchFn } from "./update-source.js";
import { initialUpdateStatus, nextUpdateStatus } from "./updater-status.js";
import type { UpdaterEvent } from "./updater-status.js";

const { autoUpdater } = electronUpdater;

/** First check runs after this delay: booting the server and the window comes first. */
const FIRST_CHECK_DELAY_MS = 20_000;
/** Subsequent automatic checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";
const GITHUB_FEED = {
  provider: "github" as const,
  owner: "Prism-Shadow",
  repo: "penguin-harness",
};

function log(line: string): void {
  process.stdout.write(`[updater] ${line}\n`);
}

// Pure over argv and isPackaged, so resolving it here again costs nothing and keeps the
// menu's enabled state (read before initUpdater) in step with the running instance.
const profile = resolveProfile({ argv: process.argv, isPackaged: app.isPackaged });
let manualCheckInFlight = false;
let downloadedVersion: string | null = null;
let downloadInFlight = false;

type FeedState =
  { phase: "pending" } | { phase: "unavailable" } | { phase: "ready"; fallbackUrl: string | null };
let feedState: FeedState = { phase: "pending" };
type FeedRefreshMode = "static" | "github" | "oss" | "auto-probe";
let feedRefreshMode: FeedRefreshMode = "github";
let feedRefreshInFlight: Promise<void> | null = null;
/** The generic URL electron-updater currently points at (null = default GitHub feed). */
let activeGenericUrl: string | null = null;
/** The other pinned feed: retrying switches to it, and the pair swaps roles. */
let otherGenericUrl: string | null = null;

/** fetch for update-source.ts: Electron's proxy-aware network stack, same as updater downloads. */
const fetchForUpdateSource: FetchFn = (url, init) =>
  net.fetch(url, { headers: init.headers, signal: init.signal });

function setGenericFeed(url: string, fallbackUrl: string | null): void {
  activeGenericUrl = url;
  otherGenericUrl = fallbackUrl;
  feedState = { phase: "ready", fallbackUrl };
  autoUpdater.setFeedURL({ provider: "generic", url });
}

function setGitHubFeed(): void {
  activeGenericUrl = null;
  otherGenericUrl = null;
  feedState = { phase: "ready", fallbackUrl: null };
  autoUpdater.setFeedURL(GITHUB_FEED);
}

function switchToFallbackFeed(reason: string): boolean {
  if (downloadedVersion !== null || feedState.phase !== "ready" || feedState.fallbackUrl === null) {
    return false;
  }
  const previous = activeGenericUrl;
  const next = feedState.fallbackUrl;
  activeGenericUrl = next;
  otherGenericUrl = previous;
  feedState = { phase: "ready", fallbackUrl: null };
  autoUpdater.setFeedURL({ provider: "generic", url: next });
  log(`${feedLabel(previous ?? next)} update ${reason}; retrying ${feedLabel(next)}`);
  return true;
}

function refreshUpdateFeed(): Promise<void> {
  if (feedRefreshInFlight !== null) return feedRefreshInFlight;
  feedRefreshInFlight = refreshUpdateFeedOnce().finally(() => {
    feedRefreshInFlight = null;
  });
  return feedRefreshInFlight;
}

async function refreshUpdateFeedOnce(): Promise<void> {
  if (feedRefreshMode === "static") return;
  if (feedRefreshMode === "github") {
    setGitHubFeed();
    return;
  }

  feedState = { phase: "pending" };
  if (feedRefreshMode === "oss") {
    try {
      const tag = await resolveOssLatestTag(fetchForUpdateSource);
      if (tag === null) {
        feedState = { phase: "unavailable" };
        log(
          "PENGUIN_UPDATE_SOURCE=oss but the OSS mirror latest.json is unavailable or invalid; updates are disabled for this check.",
        );
        return;
      }
      setGenericFeed(ossFeedUrl(tag), null);
      log(`selected OSS update feed (${tag})`);
    } catch {
      feedState = { phase: "unavailable" };
      log("OSS update source selection failed; updates are disabled for this check.");
    }
    return;
  }

  try {
    const decision = await selectAutoUpdateFeed({
      fetchFn: fetchForUpdateSource,
      platform: process.platform,
      arch: process.arch,
      log,
    });
    if (decision.kind === "pinned") {
      setGenericFeed(decision.primaryUrl, decision.fallbackUrl);
      log(`selected ${feedLabel(decision.primaryUrl)} update feed`);
    } else {
      setGitHubFeed();
      log("selected GitHub update feed");
    }
  } catch (err) {
    setGitHubFeed();
    log(`update source selection failed: ${(err as Error).message}; keeping GitHub update feed.`);
  }
}

function scheduleChecks(): void {
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
}

// --- status relay (the account-menu row's data source) -----------------------

let status: DesktopUpdateStatus = initialUpdateStatus(app.getVersion());
let statusSeq = 0;
const statusListeners = new Set<(status: DesktopUpdateStatus) => void>();

/** Folds one event into the snapshot, stamps the seq and pushes it to every subscriber. */
function emitStatus(ev: UpdaterEvent): void {
  status = { ...nextUpdateStatus(status, ev), seq: ++statusSeq };
  for (const listener of statusListeners) listener(status);
}

/**
 * Re-pushes the current snapshot with a fresh seq — the NACK for a relayed check that
 * changes nothing (already downloading, or a build already waiting): the row's armed
 * check settles on what is, instead of waiting out its timeout.
 */
function reannounceStatus(): void {
  status = { ...status, seq: ++statusSeq };
  for (const listener of statusListeners) listener(status);
}

function reportUpdaterError(err: Error): void {
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
 * outcomes render in the row (no dialogs); a check that cannot run answers with a
 * status push instead of silence, so the row always settles. `install` restarts into a
 * downloaded build — the page confirmed the interruption before sending it, and the
 * row only offers it in the `downloaded` state, so a stale frame is dropped here.
 */
export function handleUpdaterCommand(action: "check" | "install"): void {
  if (action === "check") {
    const support = updateSupport({
      isPackaged: app.isPackaged,
      profile,
      platform: process.platform,
      env: process.env,
    });
    if (!support.supported) {
      emitStatus({ kind: "unsupported", reason: support.reason });
      return;
    }
    if (
      downloadedVersion !== null ||
      status.state === "downloading" ||
      status.state === "checking"
    ) {
      reannounceStatus();
      return;
    }
    if (feedState.phase === "pending") {
      reannounceStatus();
      return;
    }
    void check();
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
  return updateSupport({
    isPackaged: app.isPackaged,
    profile,
    platform: process.platform,
    env: process.env,
  }).supported;
}

/**
 * Wires the updater and starts the automatic schedule. Safe to call in any form: an
 * unsupported one (dev run, deb install) only logs why it is standing down.
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  const support = updateSupport({
    isPackaged: app.isPackaged,
    profile,
    platform: process.platform,
    env: process.env,
  });
  if (!support.supported) {
    log(`disabled (${support.reason})`);
    emitStatus({ kind: "unsupported", reason: support.reason });
    return;
  }

  // Background downloads, explicit install: the user decides when to restart. The
  // download is still started immediately after update-available; keeping the trigger
  // here lets a failed package download retry the same tag on the fallback feed.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;

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
    void downloadUpdateWithFallback();
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
    if (downloadInFlight) {
      return;
    }
    if (switchToFallbackFeed("feed unavailable")) {
      void autoUpdater.checkForUpdates().catch((retryErr: Error) => {
        log(`check failed: ${retryErr.message}`);
      });
      return;
    }
    reportUpdaterError(err);
  });

  const override = feedUrlOverride(process.env);
  if (override) {
    feedRefreshMode = "static";
    setGenericFeed(override, null);
    log(`feed override: ${override}`);
    scheduleChecks();
    return;
  }

  const config = updateSourceConfig(process.env);
  if (config.invalidSource) {
    log("PENGUIN_UPDATE_SOURCE has an unsupported value; treated as auto.");
  }
  if (config.invalidProbe) {
    log("PENGUIN_UPDATE_SPEED_PROBE has an unsupported value; treated as 1.");
  }

  if (config.source === "github") {
    feedRefreshMode = "github";
    setGitHubFeed();
    log("selected GitHub update feed");
    scheduleChecks();
    return;
  }

  if (config.source === "oss") {
    feedRefreshMode = "oss";
    void refreshUpdateFeed().finally(scheduleChecks);
    return;
  }

  if (!config.probe) {
    feedRefreshMode = "github";
    setGitHubFeed();
    log("selected GitHub update feed");
    scheduleChecks();
    return;
  }

  feedRefreshMode = "auto-probe";
  void refreshUpdateFeed().finally(scheduleChecks);
}

async function check(): Promise<void> {
  // A waiting build ends the checking: a re-check that finds a newer release would
  // start fetching it and invalidate the downloaded package on disk while the UI still
  // points its install action at it. The user installs what they were offered; the next
  // launch checks again. A running download likewise finishes undisturbed.
  if (downloadedVersion !== null || status.state === "downloading") return;
  await refreshUpdateFeed();
  if (feedState.phase !== "ready") {
    const message =
      feedState.phase === "pending"
        ? "Update source selection is still in progress."
        : "The configured update source is unavailable.";
    log(
      `check skipped (${feedState.phase === "pending" ? "update source selection pending" : "update source unavailable"})`,
    );
    emitStatus({ kind: "error", message });
    return;
  }
  // Each fresh cycle gets its one-shot switch back (the retry path bypasses check()).
  feedState = { phase: "ready", fallbackUrl: otherGenericUrl };
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // The error event already reported it; this catch only keeps the rejection from
    // reaching the process-level handler.
    log(`check failed: ${(err as Error).message}`);
  }
}

async function downloadUpdateWithFallback(): Promise<void> {
  if (downloadedVersion !== null || downloadInFlight) return;
  downloadInFlight = true;
  let delegatedToRetryCheck = false;
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    const error = err as Error;
    if (downloadedVersion !== null) return;
    downloadInFlight = false;
    if (switchToFallbackFeed("download failed")) {
      delegatedToRetryCheck = true;
      try {
        const retryResult = await autoUpdater.checkForUpdates();
        if (retryResult === null || !retryResult.isUpdateAvailable) {
          const message = "The fallback update source did not offer a downloadable update.";
          log(message);
          emitStatus({ kind: "error", message });
        }
      } catch (retryErr) {
        log(`check failed: ${(retryErr as Error).message}`);
      }
      return;
    }
    reportUpdaterError(error);
  } finally {
    if (!delegatedToRetryCheck) downloadInFlight = false;
  }
}

/** Menu action: same check, but every outcome is reported. */
export async function checkForUpdatesManually(): Promise<void> {
  if (!updatesAvailableInThisForm()) {
    const support = updateSupport({
      isPackaged: app.isPackaged,
      profile,
      platform: process.platform,
      env: process.env,
    });
    // `linux-not-appimage` covers every Linux form that is not an AppImage — a deb install,
    // but also an unpacked tree — so the wording names the rule rather than assuming dpkg.
    const detail =
      support.supported || support.reason === "dev"
        ? "This build does not update itself."
        : "Only the AppImage build updates itself on Linux. Update a package install with your package manager, or download the latest release manually.";
    await dialog.showMessageBox({ type: "info", message: "Updates are unavailable.", detail });
    return;
  }
  if (downloadedVersion !== null) {
    await promptRestart(downloadedVersion, null);
    return;
  }
  if (feedState.phase === "pending") {
    await dialog.showMessageBox({
      type: "info",
      message: "Updates are unavailable.",
      detail: "Update source selection is still in progress; try again in a moment.",
      buttons: ["OK"],
    });
    return;
  }
  if (status.state === "downloading") {
    // check() would decline anyway; a manual action still answers (the silence rule).
    await dialog.showMessageBox({
      type: "info",
      message: "An update is downloading.",
      detail: "You will be asked to restart when it is ready.",
    });
    return;
  }
  manualCheckInFlight = true;
  await check();
  if (manualCheckInFlight && feedState.phase === "unavailable") {
    manualCheckInFlight = false;
    await dialog.showMessageBox({
      type: "error",
      message: "Could not check for updates.",
      detail: "The configured update source is unavailable. See the updater log for details.",
      buttons: ["OK"],
    });
  }
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
