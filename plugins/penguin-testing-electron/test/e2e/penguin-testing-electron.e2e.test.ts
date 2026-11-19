import path from "node:path";
import { expect } from "@playwright/test";
import { describe, it } from "vitest";

/**
 * End to end: test the sample plugin against a real harness shell — the shape a plugin
 * author writes. Both driver tiers, against the same unit modules:
 *
 * - `testPlugin` — the whole lifecycle in one call.
 * - the low-level tier — one instance, install / assert / remove held by the caller, the
 *   exploratory round a plugin author actually runs.
 *
 * Skips itself outside its platform: the driver's port discovery reads the Linux userData
 * path and the case runs headless under Xvfb — on Linux it skips without a display (CI runs
 * it under Xvfb), on macOS and Windows CI runners it never runs at all. It never fails red
 * for lack of a head or the wrong platform.
 */
const linux = process.platform === "linux";
const available = linux && (process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY) !== undefined;

describe.skipIf(!available)("penguin-testing-electron e2e", () => {
  it("tests the sample plugin end to end, from the units as modules", async () => {
    const { testPlugin } = await import("../../src/driver.js");
    const sample = path.join(import.meta.dirname, "sample-plugin");
    const { InstanceDataExists, WindowRenders } = await import("./sample-plugin/test-unit.js");

    const results = await testPlugin({
      pluginDir: sample,
      // The units are modules — the sample's own @Component classes with a run method.
      units: [InstanceDataExists, WindowRenders],
    });

    expect(results.map((r) => `${r.unit}:${r.ok}`)).toEqual([
      "InstanceDataExists:true",
      "WindowRenders:true",
    ]);
  }, 120_000);

  it("holds the steps by hand on one instance: install, run, remove, another plugin", async () => {
    const driver = await import("../../src/driver.js");
    const sample = path.join(import.meta.dirname, "sample-plugin");
    const { InstanceDataExists, WindowRenders } = await import("./sample-plugin/test-unit.js");

    const harness = await driver.launchHarness();
    try {
      // The window is the caller's from here on — the exploratory round starts.
      await harness.window.waitForLoadState("domcontentloaded");
      expect(harness.window.isClosed()).toBe(false);

      const name = await driver.installPlugin(harness, sample, { force: true });
      await driver.waitForActive(harness, name);

      // Run one unit by hand against the held window.
      const unit = new WindowRenders();
      await unit.run({ window: harness.window });

      // The instance carries the units' data dir — the data-exists unit's subject.
      const data = new InstanceDataExists();
      await data.run({ window: harness.window });

      // Remove and install again on the same instance: the shared shell is the point.
      await driver.removePlugin(harness, name);
      const again = await driver.installPlugin(harness, sample, { force: true });
      expect(again).toBe(name);
      await driver.waitForActive(harness, again);
    } finally {
      await driver.closeHarness(harness);
    }
  }, 120_000);

  it("opens the Settings dialog on the Plugins page through the helper", async () => {
    const driver = await import("../../src/driver.js");
    const sample = path.join(import.meta.dirname, "sample-plugin");

    const harness = await driver.launchHarness({ lang: "en" });
    try {
      // A plugin's config cards live on that page once the plugin is active — the path a
      // plugin author's UI-contribution assertions start from. The install is the same
      // force-free shape a test of a non-shipped plugin uses.
      const name = await driver.installPlugin(harness, sample);
      await driver.waitForActive(harness, name);

      await driver.openSettings(harness, { section: "plugins" });
      await expect(harness.window.getByRole("dialog", { name: "Settings" })).toBeVisible();
      await expect(harness.window.getByRole("heading", { name: "Plugins" })).toBeVisible();
    } finally {
      await driver.closeHarness(harness);
    }
  }, 120_000);
});
