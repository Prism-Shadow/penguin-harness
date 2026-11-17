import { existsSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { describe, it } from "vitest";

/**
 * End to end: test the sample plugin against a real harness shell — the declarative
 * shape a plugin author writes. The driver runs the whole lifecycle; this test only
 * declares the units. Skips itself when no display is available (Linux CI runs it under
 * Xvfb) — it never fails red for lack of a head.
 */
const display = process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY;
const available = process.platform !== "linux" || display !== undefined;

describe.skipIf(!available)("penguin-testing-electron e2e", () => {
  it("tests the sample plugin end to end, declaratively", async () => {
    const { testPlugin } = await import("../../src/driver.js");
    const sample = path.join(import.meta.dirname, "sample-plugin");

    const results = await testPlugin({
      pluginDir: sample,
      units: {
        "instance-data-exists": {
          description: "The instance's home and browser data exist on disk.",
          run: async () => {
            expect(existsSync(path.join(process.cwd(), ".data/penguin-testing-electron/penguin"))).toBe(true);
          },
        },
        "window-renders": {
          description: "The shell's first window renders the app root.",
          run: async ({ window }) => {
            await window.waitForLoadState("domcontentloaded");
            expect(window.isClosed()).toBe(false);
          },
        },
      },
    });

    expect(results.map((r) => `${r.unit}:${r.ok}`)).toEqual([
      "instance-data-exists:true",
      "window-renders:true",
    ]);
  }, 120_000);
});

describe("penguin-testing-electron sample plugin", () => {
  it("declares its test unit in its component", async () => {
    const sample = path.join(import.meta.dirname, "sample-plugin");
    const unit = path.join(sample, "src/index.ts");
    expect(existsSync(unit)).toBe(true);
    const source = await import("node:fs").then((fs) => fs.promises.readFile(unit, "utf8"));
    expect(source).toContain("PluginTestUnits.units");
  });
});
