import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveWindowIcon, WINDOW_ICON_RELPATH, windowIconPathFor } from "../src/app-icon.js";

describe("windowIconPathFor", () => {
  it("is null on macOS (window icons are ignored; the bundle icns owns the Dock)", () => {
    expect(windowIconPathFor("/app", "darwin")).toBeNull();
  });

  it("resolves build/icon.png inside the app dir on Linux and Windows", () => {
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
    expect(resolveWindowIcon(tmp, "linux")).toBeNull();
    fs.mkdirSync(path.join(tmp, "build"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "build", "icon.png"), "png");
    expect(resolveWindowIcon(tmp, "linux")).toBe(path.join(tmp, "build", "icon.png"));
    expect(resolveWindowIcon(tmp, "darwin")).toBeNull();
  });

  it("the committed source icon resolves for a dev run of this package", () => {
    const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(resolveWindowIcon(pkgDir, "linux")).toBe(path.join(pkgDir, "build", "icon.png"));
  });
});
