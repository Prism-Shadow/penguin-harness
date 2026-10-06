/**
 * The booting side of a push that meets plugins its build cannot run (hmr/push-plugins.ts),
 * with the real platform: what a boot does with the slip a push registered for it, and that a
 * boot nobody is waiting on is never refused for this.
 *
 * A bare kernel is enough — the question is asked before any business module exists. The
 * serving side (the route, the mechanism's refusal, the restore) is push-plugins.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Instance, ModuleDef } from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc, parseManifest, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "@prismshadow/penguin-hmr";
import { HMR_INTERFACES_RESOURCE_ID, PENGUIN_FAMILY } from "../src/hmr/capabilities.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import { openPushSlip, takePushSlip } from "../src/hmr/push-plugins.js";
import { PLUGINS_RESOURCE_ID, PluginHost } from "../src/plugin/host.js";
import { UnsatisfiedPluginsError } from "../src/plugin/unsatisfied.js";

/** A module contributing to a slot nothing declares: the tree runs without the contribution. */
const stray: ModuleDef = {
  manifest: parseManifest({
    name: "ext-stray",
    requires: {},
    provides: {},
    contributes: { "nowhere.slot": [{ id: "ext-stray.x" }] },
    children: [],
  }),
  create: () => ({ api: {} }),
};

/** A module providing an interface no table carries: the tree runs without the module. */
const unmet: ModuleDef = {
  manifest: parseManifest({
    name: "ext-unmet",
    requires: {},
    provides: { Thing: "@acme/unmet#Nope" },
    contributes: {},
    children: [],
  }),
  create: () => ({ api: { Thing: {} } }),
};

/** A bare kernel holding one plugin that is dropped from, and one that is left out. */
function kernelWithUnsatisfied(): { resources: HotResources; host: PluginHost } {
  const resources = new HotResources();
  resources.register(HMR_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
  const host = new PluginHost();
  host.use({ specifier: "@acme/partial", modules: [stray], replaces: [] });
  host.use({ specifier: "@acme/unmet", modules: [unmet], replaces: [] });
  resources.register(PLUGINS_RESOURCE_ID, host);
  return { resources, host };
}

const bootOn = (
  resources: HotResources,
  doc: Parameters<typeof boot>[2] = initialDoc(packagedPlatform.iface, { motd: "m" }),
) =>
  boot(packagedPlatform.impl, packagedPlatform.iface, doc, resources) as Promise<
    Instance<PlatformApi>
  >;

const WHAT = [
  { specifier: "@acme/partial", disabled: false, reason: expect.stringMatching(/nowhere\.slot/) },
  { specifier: "@acme/unmet", disabled: true, reason: expect.stringMatching(/Nope/) },
];

describe("a boot that meets plugins its build cannot run", () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("nobody waiting (a cold start): boots without them and says so on the host and in the log", async () => {
    const warn = quiet();
    const { resources, host } = kernelWithUnsatisfied();
    const inst = await bootOn(resources);
    try {
      expect(inst.api.info()).toMatchObject({ impl: "packaged" });
      expect([...host.unsatisfied().values()]).toEqual(WHAT);
      const said = warn.mock.calls.map((c) => String(c[0]));
      expect(said.some((l) => /plugin '@acme\/unmet' left out of this generation/.test(l))).toBe(
        true,
      );
      expect(said.some((l) => /plugin '@acme\/partial' runs without/.test(l))).toBe(true);
    } finally {
      inst.dispose();
    }
  });

  it("a push whose pusher has not accepted it: refuses, and writes the list back for them", async () => {
    quiet();
    const { resources, host } = kernelWithUnsatisfied();
    const { slip } = openPushSlip(resources, false);
    await expect(bootOn(resources)).rejects.toBeInstanceOf(UnsatisfiedPluginsError);
    expect(slip).toMatchObject({ taken: true, refused: true });
    expect(slip.unsatisfied).toEqual(WHAT);
    // Nothing was booted, so nothing is recorded as running without them.
    expect(host.unsatisfied().size).toBe(0);
  });

  it("the restore after that refusal is not asked the same question", async () => {
    quiet();
    const { resources, host } = kernelWithUnsatisfied();
    const first = await bootOn(resources);
    // The kernel's own swap, as a push runs it: the serving generation registered the slip.
    const { slip } = openPushSlip(resources, false);
    const result = await upgrade({
      current: first,
      impl: packagedPlatform.impl,
      iface: packagedPlatform.iface,
      resources,
    });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.error).toBeInstanceOf(UnsatisfiedPluginsError);
    expect(slip.refused).toBe(true);
    // The slip is still registered while the mechanism restores the previous generation.
    const restored = await bootOn(resources, result.doc);
    try {
      expect(restored.api.info()).toMatchObject({ impl: "packaged" });
      expect([...host.unsatisfied().values()]).toEqual(WHAT);
      // The answer the route gives is still the refusal.
      expect(slip.refused).toBe(true);
    } finally {
      restored.dispose();
    }
  });

  it("a push whose pusher accepted it: boots without them and reports what it left out", async () => {
    quiet();
    const { resources, host } = kernelWithUnsatisfied();
    const { slip } = openPushSlip(resources, true);
    const inst = await bootOn(resources);
    try {
      expect(slip).toMatchObject({ taken: true, refused: false });
      expect(slip.unsatisfied).toEqual(WHAT);
      expect([...host.unsatisfied().values()]).toEqual(WHAT);
    } finally {
      inst.dispose();
    }
  });

  it("a build every plugin fits takes the slip and leaves it empty", async () => {
    const resources = new HotResources();
    resources.register(HMR_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
    const { slip } = openPushSlip(resources, false);
    const inst = await bootOn(resources);
    try {
      expect(slip).toMatchObject({ taken: true, refused: false, unsatisfied: [] });
    } finally {
      inst.dispose();
    }
  });
});

describe("the push slip", () => {
  it("is taken once, and gone once the push has answered", () => {
    const resources = new HotResources();
    expect(takePushSlip(resources)).toBeNull();
    const { slip, close } = openPushSlip(resources, true);
    expect(takePushSlip(resources)).toBe(slip);
    expect(takePushSlip(resources)).toBeNull();
    close();
    expect(takePushSlip(resources)).toBeNull();
  });

  it("reads a slip of an older shape as one with no acceptance on it", () => {
    const resources = new HotResources();
    const old: Record<string, unknown> = {};
    resources.register("platform.pushSlip", old);
    expect(takePushSlip(resources)).toMatchObject({
      leaveOut: false,
      taken: true,
      refused: false,
      unsatisfied: [],
    });
  });
});
