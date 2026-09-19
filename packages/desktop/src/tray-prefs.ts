/**
 * The tray preferences — on disk, and on the wire. Pure path, file and frame logic, no
 * Electron imports (unit-tested).
 *
 * Two booleans live in `userData/tray.json`:
 *
 * - `showTrayIcon` — whether the app keeps an icon in the system tray at all. It is the
 *   Web App's Settings › Appearance switch, relayed to the shell over the utilityProcess
 *   message channel the client updater already uses (see main.ts and the server's
 *   services/desktop-update-port.ts).
 * - `closeToTray` — whether closing the main window hides it into the tray instead of
 *   following the platform's default close semantics. It is the tray menu's own checkbox.
 *
 * and one language:
 *
 * - `locale` — the Web App's UI language, reported over the same channel, so the tray menu
 *   reads the way the window does. The shell cannot see that preference itself: it lives in
 *   the browser's localStorage. Null until a page has reported one, and after that it is kept
 *   so a fresh launch draws the right menu before any window has finished loading.
 *
 * Both are conveniences, never a reason for the shell to fail to start — a missing or
 * malformed file reads as the defaults (both on), and a failed write is the caller's line
 * in the log.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  DesktopTrayCommandMessage,
  DesktopTrayStatusMessage,
} from "@prismshadow/penguin-server/api";
import type { TrayLocale } from "./tray-menu.js";

/** Preference file name, inside the app's userData directory. */
export const TRAY_PREFS_FILE = "tray.json";

export interface TrayPrefs {
  /** The tray icon is shown for as long as the app runs. */
  showTrayIcon: boolean;
  /** Closing the main window hides it and leaves the app (and its server) running. */
  closeToTray: boolean;
  /** The Web App's UI language as last reported; null until one has been, meaning follow the device. */
  locale: TrayLocale | null;
}

export const DEFAULT_TRAY_PREFS: TrayPrefs = {
  showTrayIcon: true,
  closeToTray: true,
  locale: null,
};

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
  const at = (key: keyof TrayPrefs): unknown =>
    (parsed as Partial<Record<keyof TrayPrefs, unknown>>)[key];
  const bool = (key: "showTrayIcon" | "closeToTray"): boolean => {
    const value = at(key);
    return typeof value === "boolean" ? value : DEFAULT_TRAY_PREFS[key];
  };
  const locale = at("locale");
  return {
    showTrayIcon: bool("showTrayIcon"),
    closeToTray: bool("closeToTray"),
    // Anything else, including the absence this file had before the field existed, means
    // nothing has been reported yet and the device language decides.
    locale: locale === "en" ? locale : null,
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

/**
 * Read-modify-write of one field. Both writers (the Appearance switch and the tray menu's
 * checkbox) go through this, so neither can clobber the other's value with a snapshot it
 * read before the other wrote.
 */
export function updateTrayPrefs(userDataDir: string, patch: Partial<TrayPrefs>): TrayPrefs {
  const next = { ...readTrayPrefs(userDataDir), ...patch };
  writeTrayPrefs(userDataDir, next);
  return next;
}

// --- the wire, to and from the Web App's Appearance settings -----------------

/** Wraps what the tray is currently doing for the port push. */
export function trayStatusMessage(
  showTrayIcon: boolean,
  locale: TrayLocale,
): DesktopTrayStatusMessage {
  return { type: "desktop-tray-status", status: { showTrayIcon, locale } };
}

/**
 * Validates one server-relayed tray command off the port. Null when the frame is not one, and
 * an empty patch when it is one carrying nothing this build understands — a distinction the
 * caller needs, because a frame it cannot read is not a frame it should treat as a tray push.
 */
export function parseTrayCommand(data: unknown): TrayCommand | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopTrayCommandMessage>;
  if (msg.type !== "desktop-tray-command") return null;
  const patch: TrayCommand = {};
  if (typeof msg.showTrayIcon === "boolean") patch.showTrayIcon = msg.showTrayIcon;
  if (msg.locale === "en") patch.locale = msg.locale;
  return patch;
}

/** What one relayed command asks the shell to change; every field optional, as the route's patch is. */
export interface TrayCommand {
  showTrayIcon?: boolean;
  locale?: TrayLocale;
}
