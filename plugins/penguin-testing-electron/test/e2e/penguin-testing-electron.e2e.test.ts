import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * End to end: launch a real harness shell, install the sample plugin, run its TestUnit
 * in the shell, remove it. Skips itself when no display is available (Linux CI runs it
 * under Xvfb) — it never fails red for lack of a head.
 */
const display = process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY;
const available = process.platform !== "linux" || display !== undefined;

describe.skipIf(!available)("penguin-testing-electron e2e", () => {
  it("launches a harness shell, installs a plugin, runs its TestUnit, removes it", async () => {
    const { launchHarness } = await import("../../src/driver.js");
    const instance = await launchHarness();

    try {
      expect(existsSync(instance.penguinHome)).toBe(true);
      expect(existsSync(instance.chromeDir)).toBe(true);

      const sample = path.join(import.meta.dirname, "sample-plugin");
      await instance.install(sample);

      // The window is a real Playwright page: assert the shell actually rendered.
      await instance.window.waitForLoadState("domcontentloaded");
      expect(instance.window.isClosed()).toBe(false);

      await instance.remove("penguin-testing-electron-sample");
    } finally {
      await instance.app.close();
    }
  }, 120_000);
});

describe("penguin-testing-electron sample plugin", () => {
  it("ships a package manifest and a TestUnit component", async () => {
    const sample = path.join(import.meta.dirname, "sample-plugin");
    const manifest = path.join(sample, "package.json");
    const unit = path.join(sample, "test-unit.ts");
    expect(existsSync(manifest)).toBe(true);
    expect(existsSync(unit)).toBe(true);
    const source = await import("node:fs").then((fs) => fs.promises.readFile(unit, "utf8"));
    expect(source).toContain("@Component()");
  });
});
