import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRoot } from "../src/state/paths.js";
import { installedWindowsDataLocation } from "../src/state/windows-data-location.js";

describe.skipIf(process.platform !== "win32")("the installed Windows data location", () => {
  let home: string;
  let control: string;
  let base: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-location-"));
    control = path.join(home, ".penguin");
    base = path.join(home, "Other volume");
    fs.mkdirSync(control);
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("PENGUIN_HOME", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps the standard location until Setup commits both halves of a custom installation", () => {
    expect(resolveRoot()).toBe(path.join(control, "data"));
    fs.mkdirSync(path.join(base, "data"), { recursive: true });
    fs.writeFileSync(path.join(control, "windows-data-location"), "\ufeff" + base, "utf16le");
    expect(() => resolveRoot()).toThrow(/Reconnect the drive/);
    fs.mkdirSync(path.join(base, "desktop"));
    expect(installedWindowsDataLocation()).toBe(base);
    expect(resolveRoot()).toBe(path.join(base, "data"));
    vi.stubEnv("PENGUIN_HOME", path.join(home, "explicit"));
    expect(resolveRoot()).toBe(path.join(home, "explicit"));
  });

  it("keeps an unavailable or corrupt pointer in place", () => {
    const pointer = path.join(control, "windows-data-location");
    fs.writeFileSync(pointer, "\ufeff" + base, "utf16le");
    expect(() => resolveRoot()).toThrow(/Reconnect the drive/);
    expect(fs.existsSync(path.join(control, "data"))).toBe(false);
    expect(fs.readFileSync(pointer, "utf16le")).toBe("\ufeff" + base);
    fs.writeFileSync(pointer, "relative", "utf16le");
    expect(() => resolveRoot()).toThrow(/Invalid Windows data location/);
  });
});
