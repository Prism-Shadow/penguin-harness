/**
 * The `penguin` command an installed desktop app provides: PATH exposure for the bundled
 * CLI launcher (`<app>/bin/penguin`, generated at stage time; see launcher.ts).
 *
 * It installs itself, at every launch, without asking — the CLI is part of what the app
 * is, and an update that left a stale command behind would point an old client at a new
 * server. Per platform (deb is absent on purpose: its postinst ships /usr/bin/penguin, see
 * build/linux/after-install.tpl):
 * - macOS: symlink /usr/local/bin/penguin → <app>/bin/penguin. The unprivileged write is
 *   tried first and an administrator prompt appears only where it actually fails, which on
 *   a Mac without Homebrew is where /usr/local/bin has to be created.
 * - Windows: append <app>\bin to the user PATH (HKCU\Environment) via reg.exe, idempotently
 *   and append-only; new terminals pick it up. No elevation is involved.
 * - Linux AppImage: write an executable ~/.local/bin/penguin wrapper that runs the AppImage
 *   itself as Node (see launcher.ts appImageWrapperScript).
 *
 * Two rules follow from doing this silently, both enforced in cli-link.ts:
 * - A `penguin` this app did not write is never replaced. `install.sh` puts its own symlink
 *   at the very path the AppImage form uses, and the user may have one from anywhere else.
 *   Such a target is skipped and the reason recorded.
 * - Nothing is installed from a location that will not persist — a macOS bundle still on
 *   its dmg, or one Gatekeeper is running translocated — because the link would dangle the
 *   moment the mount goes away. The next launch from /Applications installs it.
 *
 * Everything is native UI (menu item + dialogs) in English: the main process stays outside
 * the web app's i18n, and per the design the desktop shell talks to the page only through
 * the server's HTTP API — never a private IPC channel.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, dialog } from "electron";
import type { BrowserWindow } from "electron";
import {
  adminSymlinkAppleScript,
  appImageWrapperScript,
  cliInstallKind,
  mergeWindowsUserPath,
} from "./launcher.js";
import type { CliInstallKind } from "./launcher.js";
import {
  isVolatileAppLocation,
  readCliCommandState,
  syncSymlink,
  syncWrapper,
  writeCliCommandState,
} from "./cli-link.js";
import type { CliCommandState, SyncResult } from "./cli-link.js";

const execFileAsync = promisify(execFile);

/** The macOS PATH directory. Fixed: it is on the default PATH of every Mac. */
const MAC_LINK_DIR = "/usr/local/bin";

function log(line: string): void {
  process.stdout.write(`[cli] ${line}\n`);
}

/** The launcher directory inside the packaged app. */
function binDir(): string {
  return path.join(app.getAppPath(), "bin");
}

/** This run's install kind, or null when there is nothing to install (dev run / deb). */
export function currentCliInstallKind(): CliInstallKind | null {
  return cliInstallKind({
    packaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE ?? null,
  });
}

interface Attempt {
  ok: boolean;
  result: NonNullable<CliCommandState["lastResult"]>;
  detail: string;
  /** The user dismissed the administrator prompt: stop attempting automatically. */
  declined?: boolean;
}

/** macOS: /usr/local/bin/penguin symlink, escalating via osascript only on EACCES/EPERM. */
async function attemptDarwin(force: boolean): Promise<Attempt> {
  const appPath = app.getAppPath();
  if (isVolatileAppLocation(appPath, process.platform)) {
    return {
      ok: false,
      result: "deferred",
      detail: `The app is running from ${appPath}, which will not stay there. Move PenguinHarness to your Applications folder and open it from there; the command installs itself on that launch.`,
    };
  }
  const desired = path.join(binDir(), "penguin");
  const link = path.join(MAC_LINK_DIR, "penguin");
  try {
    const synced = syncSymlink(link, desired, force);
    if (synced.action === "current") return { ok: true, result: "current", detail: synced.detail };
    if (synced.action === "skipped") return { ok: false, result: "foreign", detail: synced.detail };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") {
      return { ok: false, result: "failed", detail: String(err) };
    }
    // Privileged retry — the common path on a Mac without Homebrew, where /usr/local/bin
    // does not exist and creating it needs root. The command's quoting is the generator's
    // job (launcher.ts): the bundle path comes off disk and may hold an apostrophe.
    try {
      await execFileAsync("osascript", ["-e", adminSymlinkAppleScript(desired, link)]);
    } catch (escalated) {
      return {
        ok: false,
        result: "failed",
        declined: true,
        detail: `Administrator authorization was cancelled or failed, so ${link} was not created. Use "Install 'penguin' Command…" in the application menu to try again.\n${String(escalated)}`,
      };
    }
  }
  return {
    ok: true,
    result: "installed",
    detail: `${link} now points at the app's bundled CLI. Run 'penguin' from any terminal.`,
  };
}

/** Windows: idempotent, append-only HKCU\Environment PATH entry via reg.exe. */
async function attemptWindows(): Promise<Attempt> {
  const dir = binDir();
  let current: string | null = null;
  try {
    const { stdout } = await execFileAsync("reg", ["query", "HKCU\\Environment", "/v", "Path"]);
    // Output line: "    Path    REG_EXPAND_SZ    C:\foo;C:\bar"
    const m = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/im.exec(stdout);
    if (m === null) {
      // The value is there and this output does not name it. Writing the merge now would
      // put the app's directory in place of the whole user PATH, so nothing is written.
      return { ok: false, result: "failed", detail: `Could not read the user PATH:\n${stdout}` };
    }
    current = m[1]!.trim();
  } catch {
    current = null; // No user Path value yet.
  }
  const merged = mergeWindowsUserPath(current, dir);
  if (merged === null) {
    return { ok: true, result: "current", detail: `${dir} is already on your PATH.` };
  }
  try {
    // REG_EXPAND_SZ keeps any %VAR% entries of the existing value expandable.
    await execFileAsync("reg", [
      "add",
      "HKCU\\Environment",
      "/v",
      "Path",
      "/t",
      "REG_EXPAND_SZ",
      "/d",
      merged,
      "/f",
    ]);
  } catch (err) {
    return { ok: false, result: "failed", detail: String(err) };
  }
  // Nothing on disk is touched here: the entry is appended, so another `penguin` earlier in
  // PATH keeps winning and no other software's entry is rewritten.
  return {
    ok: true,
    result: "installed",
    detail: `${dir} was added to your user PATH. Open a NEW terminal (existing ones keep the old PATH) and run 'penguin'.`,
  };
}

/** Linux AppImage: executable ~/.local/bin/penguin wrapper invoking the AppImage as Node. */
function attemptAppImage(force: boolean): Attempt {
  const appImage = process.env.APPIMAGE;
  if (!appImage) {
    return {
      ok: false,
      result: "failed",
      detail: "APPIMAGE is not set; this build cannot install the command.",
    };
  }
  const target = path.join(os.homedir(), ".local", "bin", "penguin");
  let script: string;
  try {
    script = appImageWrapperScript(appImage);
  } catch (err) {
    return { ok: false, result: "failed", detail: String(err) };
  }
  let synced: SyncResult;
  try {
    synced = syncWrapper(target, script, force);
  } catch (err) {
    return { ok: false, result: "failed", detail: String(err) };
  }
  if (synced.action === "current") return { ok: true, result: "current", detail: synced.detail };
  if (synced.action === "skipped") return { ok: false, result: "foreign", detail: synced.detail };
  return {
    ok: true,
    result: "installed",
    detail: `${target} now runs the CLI bundled in this AppImage. Make sure ~/.local/bin is on your PATH (most distributions add it at login), then run 'penguin' from a new terminal.`,
  };
}

async function attempt(kind: CliInstallKind, force: boolean): Promise<Attempt> {
  switch (kind) {
    case "darwin":
      return await attemptDarwin(force);
    case "windows":
      return await attemptWindows();
    case "appimage":
      return attemptAppImage(force);
  }
}

/** The record every attempt leaves; `declined` is the only field that changes later behaviour. */
function record(outcome: Attempt): void {
  writeCliCommandState(app.getPath("userData"), {
    version: 1,
    decision: outcome.declined === true ? "declined" : undefined,
    lastResult: outcome.result,
    detail: outcome.detail,
    at: new Date().toISOString(),
  });
}

/**
 * Every launch: install the command, repair it, or record why neither happened. Cheap when
 * there is nothing to do — one lstat, or one `reg query` on Windows — and it runs again
 * next launch, which is what repairs a link left dangling by a moved or updated app.
 */
export async function ensureCliCommand(): Promise<void> {
  const kind = currentCliInstallKind();
  if (kind === null) return;
  try {
    // A dismissed administrator prompt is a decision and is respected; nothing else here
    // is. In particular the pre-0.2.7 `cli-install-offered` marker is not read at all —
    // it was written before its dialog was answered, so it records the question, not a
    // decline (writeCliCommandState removes it).
    if (readCliCommandState(app.getPath("userData")).decision === "declined") {
      log("skipped: the administrator prompt was declined; use the application menu to retry");
      return;
    }
    const outcome = await attempt(kind, false);
    record(outcome);
    log(`${outcome.result}: ${outcome.detail.split("\n")[0]}`);
  } catch (err) {
    // Never let this stop a launch.
    log(`failed: ${String(err)}`);
  }
}

function showResult(win: BrowserWindow | null, ok: boolean, detail: string): void {
  const opts = {
    type: ok ? ("info" as const) : ("error" as const),
    title: "PenguinHarness",
    message: ok
      ? "The 'penguin' command is installed."
      : "Could not install the 'penguin' command.",
    detail,
  };
  void (win !== null ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
}

/**
 * The menu item. Same install, but it reports every outcome and it is the one place a
 * `penguin` this app did not write can be replaced — with the user looking at what is
 * about to be overwritten. Invoking it also clears a previously declined prompt.
 */
export async function installCliCommand(win: BrowserWindow | null): Promise<void> {
  const kind = currentCliInstallKind();
  if (kind === null) {
    showResult(win, false, "This build has no bundled CLI to install (development run).");
    return;
  }
  let outcome = await attempt(kind, false);
  if (outcome.result === "foreign") {
    const opts = {
      type: "warning" as const,
      title: "PenguinHarness",
      message: "Something else already provides the 'penguin' command.",
      detail: `${outcome.detail}\n\nReplace it with this app's command? The file it replaces is not backed up.`,
      buttons: ["Replace", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    };
    const { response } = await (win !== null
      ? dialog.showMessageBox(win, opts)
      : dialog.showMessageBox(opts));
    if (response !== 0) {
      record(outcome);
      showResult(win, false, `Left the existing command untouched.\n${outcome.detail}`);
      return;
    }
    outcome = await attempt(kind, true);
  }
  record(outcome);
  showResult(win, outcome.ok, outcome.detail);
}
