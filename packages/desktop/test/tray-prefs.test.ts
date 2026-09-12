/**
 * The tray preferences: the two booleans in userData/tray.json, and the two frames that
 * carry the Appearance switch between the shell and the page.
 *
 * Every ill-formed shape reads as ON for both. The shell starts before the window does,
 * and a file it cannot make sense of must leave the app with an icon and a way back into
 * it — never with neither.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRAY_PREFS,
  parseTrayCommand,
  readTrayPrefs,
  TRAY_PREFS_FILE,
  trayPrefsPath,
  trayStatusMessage,
  updateTrayPrefs,
  writeTrayPrefs,
} from "../src/tray-prefs.js";

describe("readTrayPrefs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-tray-prefs-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("defaults to a tray icon that keeps the app running when there is no file", () => {
    expect(DEFAULT_TRAY_PREFS).toEqual({ showTrayIcon: true, closeToTray: true });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
  });

  it("defaults when the directory itself does not exist", () => {
    expect(readTrayPrefs(path.join(dir, "never-created"))).toEqual({
      showTrayIcon: true,
      closeToTray: true,
    });
  });

  it("reads back what was written", () => {
    writeTrayPrefs(dir, { showTrayIcon: false, closeToTray: false });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: false });
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: true });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
  });

  it("writes tray.json into the userData directory, creating it if needed", () => {
    const nested = path.join(dir, "userData");
    writeTrayPrefs(nested, { showTrayIcon: true, closeToTray: false });
    expect(trayPrefsPath(nested)).toBe(path.join(nested, TRAY_PREFS_FILE));
    expect(JSON.parse(fs.readFileSync(trayPrefsPath(nested), "utf8"))).toEqual({
      showTrayIcon: true,
      closeToTray: false,
    });
  });

  it("defaults on malformed JSON", () => {
    fs.writeFileSync(trayPrefsPath(dir), "{ closeToTray: ");
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
  });

  it("defaults per field: an ill-typed one does not take the other down with it", () => {
    fs.writeFileSync(
      trayPrefsPath(dir),
      JSON.stringify({ closeToTray: "no", showTrayIcon: false }),
    );
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify({}));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(null));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(false));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true });
  });

  it("leaves no staging file behind", () => {
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: false });
    expect(fs.readdirSync(dir)).toEqual([TRAY_PREFS_FILE]);
  });
});

describe("updateTrayPrefs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-tray-prefs-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("keeps the field it was not given", () => {
    // The two writers hold snapshots taken at different moments — the tray menu's at
    // install time, the Appearance switch's at click time — so a whole-object write from
    // either would silently revert the other.
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: false });
    expect(updateTrayPrefs(dir, { showTrayIcon: false })).toEqual({
      showTrayIcon: false,
      closeToTray: false,
    });
    expect(updateTrayPrefs(dir, { closeToTray: true })).toEqual({
      showTrayIcon: false,
      closeToTray: true,
    });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: true });
  });
});

describe("the Appearance switch on the wire", () => {
  it("wraps the shown state for the push to the page", () => {
    expect(trayStatusMessage(false)).toEqual({
      type: "desktop-tray-status",
      status: { showTrayIcon: false },
    });
  });

  it("reads a command frame, and nothing else", () => {
    expect(parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: false })).toBe(false);
    expect(parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: true })).toBe(true);
    // The same port carries the updater's frames; a tray reader must not answer to one.
    expect(parseTrayCommand({ type: "desktop-updater-command", action: "check" })).toBeNull();
    expect(parseTrayCommand({ type: "desktop-tray-command" })).toBeNull();
    expect(parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: "yes" })).toBeNull();
    expect(parseTrayCommand(null)).toBeNull();
    expect(parseTrayCommand("desktop-tray-command")).toBeNull();
  });
});
