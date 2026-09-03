/**
 * Plugins are modules: the host holds what the loader paired (manifest ↔ code), the
 * platform boots them as children of its tree at EVERY App creation, and what a module
 * contributes lands on the same slots the built-in modules use.
 */
import { describe, expect, it } from "vitest";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { PluginHost, PLUGINS_RESOURCE_ID, pluginHostFrom } from "../src/plugin/host.js";
import { PENGUIN_FAMILY, RUNTIME_INTERFACES_RESOURCE_ID } from "../src/hmr/capabilities.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { SandboxProvider } from "@prismshadow/penguin-core/plugin";

const provider = (name: string): SandboxProvider => ({
  dimensions: ["fs-write"],
  confine: (argv) => ({
    argv: [name, ...argv],
    enforcement: "full",
    denialSignatures: [],
    runnerFailureRules: [],
  }),
});

/** A backend as a plugin module: one provider contributed to sandbox.providers. */
function backend(name: string, onCreate?: () => void): ModuleDef {
  return {
    manifest: parseManifest({
      name: `ext-${name}`,
      requires: {},
      provides: {},
      contributes: {
        "SandboxModule.providers": [{ id: `ext-${name}.provider`, name, dimensions: ["fs-write"] }],
      },
      children: [],
    }),
    create() {
      onCreate?.();
      return { api: {}, bind: { [`ext-${name}.provider`]: provider(name) } };
    },
  };
}

describe("plugin host", () => {
  it("holds every plugin's modules in load order", () => {
    const host = new PluginHost();
    host.use({ specifier: "a", modules: [backend("a1"), backend("a2")] });
    host.use({ specifier: "b", modules: [backend("b1")] });
    expect(host.modules().map((m) => m.manifest.name)).toEqual(["ext-a1", "ext-a2", "ext-b1"]);
  });

  it("refuses a module name another plugin already loaded, naming both", () => {
    const host = new PluginHost();
    host.use({ specifier: "a", modules: [backend("x")] });
    expect(() => host.use({ specifier: "b", modules: [backend("x")] })).toThrow(
      /plugin 'b': module 'ext-x' is already loaded/,
    );
  });
});

describe("pluginHostFrom", () => {
  it("claims the host the runtime published", () => {
    const resources = new HotResources();
    const host = new PluginHost();
    resources.register(PLUGINS_RESOURCE_ID, host);
    expect(pluginHostFrom(resources)).toBe(host);
  });

  it("falls back to an empty host when nothing was published", () => {
    expect(pluginHostFrom(new HotResources()).modules()).toEqual([]);
  });
});

describe("plugin modules on the real platform", () => {
  /** A bare-kernel boot (no capabilities): the sandbox floor plus whatever plugins contribute. */
  async function bootWith(modules: ModuleDef[]) {
    const resources = new HotResources();
    resources.register(RUNTIME_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
    const host = new PluginHost();
    host.use({ specifier: "test", modules });
    resources.register(PLUGINS_RESOURCE_ID, host);
    return boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, { motd: "m" }),
      resources,
    );
  }

  it("boots an App when the runtime published no host at all", async () => {
    const resources = new HotResources();
    resources.register(RUNTIME_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
    const inst = await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, { motd: "m" }),
      resources,
    );
    expect(inst.api.info()).toMatchObject({ impl: "packaged" });
    inst.dispose();
  });

  it("creates every plugin module per App, so a swap never carries an instance across", async () => {
    let created = 0;
    const a = await bootWith([backend("one", () => created++)]);
    expect(created).toBe(1);
    a.dispose();
    const b = await bootWith([backend("one", () => created++)]);
    expect(created).toBe(2);
    b.dispose();
  });

  it("a contribution to a slot no module declares refuses the boot, naming it", async () => {
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
    await expect(bootWith([stray])).rejects.toThrow(/contributes to 'nowhere.slot'/);
  });
});
