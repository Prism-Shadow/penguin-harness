/**
 * Tray preferences on disk — pure path and file logic, no Electron imports (unit-tested).
 *
 * One boolean lives in `userData/tray.json`: whether closing the main window hides it into
 * the tray instead of following the platform's default close semantics. It is a convenience,
 * never a reason for the shell to fail to start — a missing or malformed file reads as the
 * default, and a failed write is the caller's line in the log.
 */
import fs from "node:fs";
import path from "node:path";

/** Preference file name, inside the app's userData directory. */
export const TRAY_PREFS_FILE = "tray.json";

export interface TrayPrefs {
  /** Closing the main window hides it and leaves the app (and its server) running. */
  closeToTray: boolean;
}

export const DEFAULT_TRAY_PREFS: TrayPrefs = { closeToTray: true };

/** Location of the preference file for a userData directory. */
export function trayPrefsPath(userDataDir: string): string {
  return path.join(userDataDir, TRAY_PREFS_FILE);
}

/** Reads the preferences; anything unreadable, unparsable or ill-typed reads as the default. */
export function readTrayPrefs(userDataDir: string): TrayPrefs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(trayPrefsPath(userDataDir), "utf8"));
  } catch {
    return { ...DEFAULT_TRAY_PREFS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_TRAY_PREFS };
  const closeToTray = (parsed as { closeToTray?: unknown }).closeToTray;
  return {
    closeToTray: typeof closeToTray === "boolean" ? closeToTray : DEFAULT_TRAY_PREFS.closeToTray,
  };
}

/** Writes the preferences. Throws on failure: the caller decides how to report it. */
export function writeTrayPrefs(userDataDir: string, prefs: TrayPrefs): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = trayPrefsPath(userDataDir);
  // Write-then-rename: a crash mid-write leaves the previous file, not a truncated one that
  // would read as the default and silently forget the preference.
  const staging = `${file}.tmp`;
  fs.writeFileSync(staging, `${JSON.stringify(prefs, null, 2)}\n`);
  fs.renameSync(staging, file);
}
