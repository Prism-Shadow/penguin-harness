import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRAY_PREFS,
  readTrayPrefs,
  TRAY_PREFS_FILE,
  trayPrefsPath,
  writeTrayPrefs,
} from "../src/tray-prefs.js";

describe("readTrayPrefs", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-tray-prefs-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("defaults to keeping the app running when there is no file", () => {
    expect(DEFAULT_TRAY_PREFS.closeToTray).toBe(true);
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
  });

  it("defaults when the directory itself does not exist", () => {
    expect(readTrayPrefs(path.join(dir, "never-created"))).toEqual({ closeToTray: true });
  });

  it("reads back what was written", () => {
    writeTrayPrefs(dir, { closeToTray: false });
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: false });
    writeTrayPrefs(dir, { closeToTray: true });
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
  });

  it("writes tray.json into the userData directory, creating it if needed", () => {
    const nested = path.join(dir, "userData");
    writeTrayPrefs(nested, { closeToTray: false });
    expect(trayPrefsPath(nested)).toBe(path.join(nested, TRAY_PREFS_FILE));
    expect(JSON.parse(fs.readFileSync(trayPrefsPath(nested), "utf8"))).toEqual({
      closeToTray: false,
    });
  });

  it("defaults on malformed JSON", () => {
    fs.writeFileSync(trayPrefsPath(dir), "{ closeToTray: ");
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
  });

  it("defaults when the field is not a boolean, or the file is not an object", () => {
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify({ closeToTray: "no" }));
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify({}));
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(null));
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
    fs.writeFileSync(trayPrefsPath(dir), JSON.stringify(false));
    expect(readTrayPrefs(dir)).toEqual({ closeToTray: true });
  });

  it("leaves no staging file behind", () => {
    writeTrayPrefs(dir, { closeToTray: false });
    expect(fs.readdirSync(dir)).toEqual([TRAY_PREFS_FILE]);
  });
});
