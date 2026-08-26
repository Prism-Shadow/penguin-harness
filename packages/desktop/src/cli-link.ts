/**
 * The disk half of the `penguin` PATH entry: what sits at the target, whether this app put
 * it there, and how to write ours without destroying anyone else's. Pure `node:fs` and no
 * Electron import, so it unit-tests against real temporary directories rather than mocks.
 *
 * The install runs automatically at startup (see cli-install.ts), which removes the user's
 * chance to object to it — so the one rule this module exists to enforce is that a
 * `penguin` this app did not write is never touched. `install.sh` puts its own symlink at
 * exactly the path the AppImage form uses (`~/.local/bin/penguin`), and a user may have a
 * `penguin` from npm, Homebrew or their own hand anywhere on PATH. Every one of those is
 * classified `foreign` and left alone; the reason is recorded in the state file so support
 * can see why no command appeared.
 */
import fs from "node:fs";
import path from "node:path";
import { LAUNCHER_MARKER } from "./launcher.js";

/**
 * What the target holds, relative to what this app wants there.
 * - `absent`  — nothing at the path; write freely.
 * - `current` — ours, and already pointing at this app: nothing to do.
 * - `ours`    — ours, but stale (a dangling link, or an older/moved app): repair it.
 * - `foreign` — someone else's; never written over automatically.
 */
export type TargetKind = "absent" | "current" | "ours" | "foreign";

export interface TargetStatus {
  kind: TargetKind;
  /** One line naming what was found; recorded in the state file and shown by the menu item. */
  detail: string;
}

/**
 * Reading a file to look for the marker is bounded: the path is on PATH, so it could hold
 * anything, including a large binary from an unrelated install.
 */
const MAX_MARKER_READ_BYTES = 64 * 1024;

/**
 * The packaged layout every bundled launcher sits in — `<app>/bin/penguin`, where `<app>`
 * is `Contents/Resources/app` in a macOS bundle and `resources/app` in a Linux tree. It
 * identifies a link this app wrote even when the link dangles, which is the case the DMG
 * launch and a moved app both produce and the case where the file itself cannot be read.
 */
const BUNDLED_LAUNCHER_PATH = /(?:^|\/)[Rr]esources\/app\/bin\/penguin$/;

/** Whether `file` is a launcher this app generated (marker text shipped since 0.2.2). */
function hasLauncherMarker(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_MARKER_READ_BYTES) return false;
    return fs.readFileSync(file, "utf8").includes(LAUNCHER_MARKER);
  } catch {
    return false;
  }
}

/**
 * The macOS form: a symlink at `target` that should point at `desired`
 * (`<app>/bin/penguin`). Anything that is not a symlink is foreign — this app has never
 * written a regular file here, so a regular file is someone else's `penguin`.
 */
export function inspectSymlinkTarget(target: string, desired: string): TargetStatus {
  let link: fs.Stats;
  try {
    link = fs.lstatSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent", detail: `${target} does not exist` };
    }
    return { kind: "foreign", detail: `${target} could not be read: ${String(err)}` };
  }
  if (!link.isSymbolicLink()) {
    return { kind: "foreign", detail: `${target} is not a symlink this app wrote` };
  }
  const value = fs.readlinkSync(target);
  if (value === desired) return { kind: "current", detail: `${target} already points at this app` };
  if (BUNDLED_LAUNCHER_PATH.test(value) || hasLauncherMarker(target)) {
    return { kind: "ours", detail: `${target} points at ${value}, a stale copy of this app` };
  }
  return { kind: "foreign", detail: `${target} points at ${value}, which this app did not write` };
}

/**
 * The AppImage form: a regular file at `target` holding the generated wrapper. A symlink
 * here is foreign — `install.sh` writes exactly that, at exactly this path.
 */
export function inspectWrapperTarget(target: string, desired: string): TargetStatus {
  let entry: fs.Stats;
  try {
    entry = fs.lstatSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent", detail: `${target} does not exist` };
    }
    return { kind: "foreign", detail: `${target} could not be read: ${String(err)}` };
  }
  if (entry.isSymbolicLink()) {
    const value = fs.readlinkSync(target);
    return {
      kind: "foreign",
      detail: `${target} is a symlink to ${value}, which this app did not write`,
    };
  }
  if (!entry.isFile() || !hasLauncherMarker(target)) {
    return { kind: "foreign", detail: `${target} is not a launcher this app wrote` };
  }
  const current = fs.readFileSync(target, "utf8");
  if (current === desired) {
    return { kind: "current", detail: `${target} already runs this app's CLI` };
  }
  return { kind: "ours", detail: `${target} runs a different location of this app` };
}

/** Creates `target` as a symlink to `desired`, replacing whatever is there. Throws on failure. */
export function writeSymlink(target: string, desired: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  fs.symlinkSync(desired, target);
}

/**
 * Writes the wrapper script to `target`, executable. Written to a temporary file and
 * renamed into place: a failed write leaves the previous command on PATH rather than a
 * truncated script. chmod before the rename, since writeFileSync's mode is masked by the
 * umask.
 */
export function writeWrapper(target: string, script: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, script, { mode: 0o755, flush: true });
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);
}

/**
 * Whether the app is running from somewhere it will not still be next week. Installing
 * from one bakes a path into the PATH entry that dies with the mount, and nothing would
 * ever notice: `/Volumes/...` is the dmg the user has not copied to Applications yet, and
 * `AppTranslocation` is where Gatekeeper runs a quarantined bundle from — the exact state
 * the download page's `xattr -rd com.apple.quarantine` step exists to clear.
 */
export function isVolatileAppLocation(appPath: string, platform: NodeJS.Platform): boolean {
  if (platform !== "darwin") return false;
  return appPath.startsWith("/Volumes/") || appPath.includes("/AppTranslocation/");
}

/**
 * What one pass over the target did.
 * - `current`   — already ours and pointing here; nothing was written.
 * - `skipped`   — someone else's `penguin` is there and was left exactly as it was.
 * - `installed` — ours was written (fresh, or repairing a stale or dangling one).
 */
export interface SyncResult {
  action: "current" | "skipped" | "installed";
  /** The classification that produced the action, in one line. */
  detail: string;
}

/**
 * The whole disk-side decision, in one place so the automatic path and the menu item
 * cannot drift apart. `force` is reachable only from the menu item, where the user has
 * just been shown what would be replaced — the automatic path always passes false, which
 * is what makes "never overwrite a `penguin` this app did not write" a property of the
 * code rather than of a caller remembering to check.
 */
function sync(status: TargetStatus, force: boolean, write: () => void): SyncResult {
  if (status.kind === "current") return { action: "current", detail: status.detail };
  if (status.kind === "foreign" && !force) return { action: "skipped", detail: status.detail };
  write();
  return { action: "installed", detail: status.detail };
}

/** macOS. Propagates whatever writeSymlink throws, so the caller can escalate on EACCES/EPERM. */
export function syncSymlink(target: string, desired: string, force: boolean): SyncResult {
  return sync(inspectSymlinkTarget(target, desired), force, () => writeSymlink(target, desired));
}

/** Linux AppImage. */
export function syncWrapper(target: string, script: string, force: boolean): SyncResult {
  return sync(inspectWrapperTarget(target, script), force, () => writeWrapper(target, script));
}

// --- recorded state ---------------------------------------------------------

/**
 * What the last attempt did. Only `decision` changes behaviour; the rest is a record for
 * whoever has to explain why no `penguin` appeared.
 */
export interface CliCommandState {
  version: 1;
  /**
   * Set only by an explicit act of the user: declining the macOS administrator prompt. It
   * stops the automatic attempt for good; the menu item clears it, which is the one way
   * back. Absent means no decision has been made, which is not the same as a skip.
   */
  decision?: "declined";
  lastResult?: "installed" | "current" | "foreign" | "deferred" | "failed";
  detail?: string;
  at?: string;
}

/** Where the state lives, next to the shell's other files under userData. */
export function stateFilePath(userData: string): string {
  return path.join(userData, "cli-command.json");
}

/**
 * The pre-0.2.7 marker. It was written BEFORE the offer dialog, so it records that the
 * question was asked and not what was answered — it cannot be read as a decline, and is
 * removed rather than migrated.
 */
export function legacyOfferedFlagPath(userData: string): string {
  return path.join(userData, "cli-install-offered");
}

export function readCliCommandState(userData: string): CliCommandState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFilePath(userData), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return { version: 1 };
    const state = parsed as CliCommandState;
    // Only the field that gates behaviour is validated; an unknown value must not read as
    // a decline and strand the command.
    return {
      ...state,
      version: 1,
      decision: state.decision === "declined" ? "declined" : undefined,
    };
  } catch {
    return { version: 1 };
  }
}

export function writeCliCommandState(userData: string, state: CliCommandState): void {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(stateFilePath(userData), `${JSON.stringify(state, null, 2)}\n`);
    // TODO(compat): drop this line once no 0.2.2–0.2.6 install can still upgrade into this
    // build — it only clears a marker those versions wrote. Owner: whoever prepares 0.3.0.
    fs.rmSync(legacyOfferedFlagPath(userData), { force: true });
  } catch {
    // An unwritable userData must not stop the install itself; the next launch re-derives
    // everything it needs from the target on disk.
  }
}
