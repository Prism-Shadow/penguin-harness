import path from "node:path";
import { expect } from "@playwright/test";
import { describe, it } from "vitest";

/**
 * End to end: test the sample plugin against a real harness shell — the shape a plugin
 * author writes: the units are modules (`@Component` classes with a `run(context)`
 * method) handed to the driver. The driver runs the whole lifecycle; this test only
 * declares the unit classes. Skips itself when no display is available (Linux CI runs it
 * under Xvfb) — it never fails red for lack of a head.
 */
const display = process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY;
const available = process.platform !== "linux" || display !== undefined;

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
});
