import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  resolveTrayIcon,
  resolveWindowIcon,
  trayIconPathFor,
  trayIconRelPath,
  WINDOW_ICON_RELPATH,
  windowIconPathFor,
} from "../src/app-icon.js";

describe("windowIconPathFor", () => {
  it("is null on macOS (window icons are ignored; the bundle icns owns the Dock)", () => {
    expect(windowIconPathFor("/app", "darwin")).toBeNull();
  });

  it("resolves dist/icon.png inside the app dir on Linux and Windows", () => {
    expect(windowIconPathFor("/app", "linux")).toBe(path.join("/app", ...WINDOW_ICON_RELPATH));
    expect(windowIconPathFor("C:\\app", "win32")).toBe(
      path.join("C:\\app", ...WINDOW_ICON_RELPATH),
    );
  });
});

describe("resolveWindowIcon", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-desktop-icon-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("returns the path only when the file exists", () => {
    const iconPath = path.join(tmp, ...WINDOW_ICON_RELPATH);
    expect(resolveWindowIcon(tmp, "linux")).toBeNull();
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "png");
    expect(resolveWindowIcon(tmp, "linux")).toBe(iconPath);
    expect(resolveWindowIcon(tmp, "darwin")).toBeNull();
  });

  it("has a committed master for scripts/build-assets.mjs to copy into the app dir", () => {
    const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(fs.existsSync(path.join(pkgDir, "build", "icon.png"))).toBe(true);
  });
});

describe("packaged app icons", () => {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  it("keeps a dedicated macOS master with the platform safe-area margin", () => {
    const builderConfig = fs.readFileSync(path.join(pkgDir, "electron-builder.yml"), "utf8");
    expect(builderConfig).toMatch(/mac:[\s\S]*?icon: build\/icon-mac\.png/);
    expect(fs.existsSync(path.join(pkgDir, "build", "icon-mac.png"))).toBe(true);
  });
});

describe("trayIconRelPath", () => {
  it("takes the monochrome template image on macOS and the colour one elsewhere", () => {
    expect(trayIconRelPath("darwin")).toEqual(["dist", "tray", "trayTemplate.png"]);
    expect(trayIconRelPath("linux")).toEqual(["dist", "tray", "tray.png"]);
    expect(trayIconRelPath("win32")).toEqual(["dist", "tray", "tray.png"]);
  });

  it("resolves inside the app dir", () => {
    expect(trayIconPathFor("/app", "darwin")).toBe(path.join("/app", ...trayIconRelPath("darwin")));
  });
});

describe("resolveTrayIcon", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-desktop-tray-icon-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("returns the path only when the file exists, on every platform", () => {
    expect(resolveTrayIcon(tmp, "linux")).toBeNull();
    expect(resolveTrayIcon(tmp, "darwin")).toBeNull();
    const iconPath = path.join(tmp, ...trayIconRelPath("linux"));
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.writeFileSync(iconPath, "png");
    expect(resolveTrayIcon(tmp, "linux")).toBe(iconPath);
    // The macOS template image is a separate file: still missing, still null.
    expect(resolveTrayIcon(tmp, "darwin")).toBeNull();
  });
});

describe("committed tray masters", () => {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  /** Width and height out of a PNG's IHDR chunk, which starts at a fixed offset. */
  function pngSize(file: string): [number, number] {
    const header = fs.readFileSync(file).subarray(16, 24);
    return [header.readUInt32BE(0), header.readUInt32BE(4)];
  }

  it.each<[string, number]>([
    ["tray.png", 32],
    ["tray@2x.png", 64],
    ["trayTemplate.png", 16],
    ["trayTemplate@2x.png", 32],
  ])("ships %s at %ipx for scripts/build-assets.mjs to stage", (name, size) => {
    expect(pngSize(path.join(pkgDir, "build", "tray", name))).toEqual([size, size]);
  });
});
