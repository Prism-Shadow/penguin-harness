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
    expect(DEFAULT_TRAY_PREFS).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
  });

  it("defaults when the directory itself does not exist", () => {
    expect(readTrayPrefs(path.join(dir, "never-created"))).toEqual({
      showTrayIcon: true,
      closeToTray: true,
      locale: null,
    });
  });

  it("reads back what was written", () => {
    writeTrayPrefs(dir, { showTrayIcon: false, closeToTray: false, locale: null });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: false, locale: null });
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: true, locale: null });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
  });

  it("keeps a reported language, and treats anything else as none reported", () => {
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: true, locale: "zh" });
    expect(readTrayPrefs(dir).locale).toBe("zh");
    // A file written before the field existed, and a file with a language this build does not
    // have, both mean the same thing: nothing has been reported, so the device decides.
    for (const stored of [
      '{"showTrayIcon":true,"closeToTray":true}',
      '{"locale":"fr"}',
      '{"locale":7}',
    ]) {
      fs.writeFileSync(trayPrefsPath(dir), stored);
      expect(readTrayPrefs(dir).locale, stored).toBeNull();
    }
  });

  it("writes tray.json into the userData directory, creating it if needed", () => {
    const nested = path.join(dir, "userData");
    writeTrayPrefs(nested, { showTrayIcon: true, closeToTray: false, locale: null });
    expect(trayPrefsPath(nested)).toBe(path.join(nested, TRAY_PREFS_FILE));
    expect(JSON.parse(fs.readFileSync(trayPrefsPath(nested), "utf8"))).toEqual({
      showTrayIcon: true,
      closeToTray: false,
      locale: null,
    });
  });

  it("defaults on malformed JSON", () => {
    fs.writeFileSync(trayPrefsPath(dir), "{ closeToTray: ");
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
  });

  it("defaults per field: an ill-typed one does not take the other down with it", () => {
    fs.writeFileSync(
      trayPrefsPath(dir),
      JSON.stringify({ closeToTray: "no", showTrayIcon: false }),
    );
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: true, locale: null });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify({}));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(null));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(false));
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: true, closeToTray: true, locale: null });
  });

  it("leaves no staging file behind", () => {
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: false, locale: null });
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
    // The three writers hold snapshots taken at different moments — the tray menu's at
    // install time, the Appearance switch's at click time, the page's language report at
    // whatever moment it changes — so a whole-object write from any would revert the others.
    writeTrayPrefs(dir, { showTrayIcon: true, closeToTray: false, locale: null });
    expect(updateTrayPrefs(dir, { showTrayIcon: false })).toEqual({
      showTrayIcon: false,
      closeToTray: false,
      locale: null,
    });
    expect(updateTrayPrefs(dir, { closeToTray: true })).toEqual({
      showTrayIcon: false,
      closeToTray: true,
      locale: null,
    });
    expect(readTrayPrefs(dir)).toEqual({ showTrayIcon: false, closeToTray: true, locale: null });
    // The language is the third writer and goes through the same door.
    expect(updateTrayPrefs(dir, { locale: "zh" })).toEqual({
      showTrayIcon: false,
      closeToTray: true,
      locale: "zh",
    });
    expect(updateTrayPrefs(dir, { showTrayIcon: true }).locale).toBe("zh");
  });
});

describe("the Appearance switch on the wire", () => {
  it("wraps the shown state for the push to the page", () => {
    expect(trayStatusMessage(false, "zh")).toEqual({
      type: "desktop-tray-status",
      status: { showTrayIcon: false, locale: "zh" },
    });
  });

  it("reads a command frame, and nothing else", () => {
    expect(parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: false })).toEqual({
      showTrayIcon: false,
    });
    expect(parseTrayCommand({ type: "desktop-tray-command", locale: "zh" })).toEqual({
      locale: "zh",
    });
    // One frame can carry both: the page sends the switch and the language separately, but
    // nothing in the wire shape says it has to.
    expect(
      parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: true, locale: "en" }),
    ).toEqual({ showTrayIcon: true, locale: "en" });
    // A field this build cannot read is dropped; the frame is still a tray command, and an
    // empty patch simply changes nothing. Only a frame that is not one at all reads as null.
    expect(parseTrayCommand({ type: "desktop-tray-command" })).toEqual({});
    expect(parseTrayCommand({ type: "desktop-tray-command", showTrayIcon: "yes" })).toEqual({});
    expect(parseTrayCommand({ type: "desktop-tray-command", locale: "fr" })).toEqual({});
    // The same port carries the updater's frames; a tray reader must not answer to one.
    expect(parseTrayCommand({ type: "desktop-updater-command", action: "check" })).toBeNull();
    expect(parseTrayCommand(null)).toBeNull();
    expect(parseTrayCommand("desktop-tray-command")).toBeNull();
  });
});
