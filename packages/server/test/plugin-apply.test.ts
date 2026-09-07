/**
 * Applying a plugin change, after the loading moved below the seam.
 *
 * The host every surface reads from must always describe the tree that is actually running.
 * That used to be enforced by hand — the apply rebuilt a host, registered it, asked for a
 * reload, and put the old one back when the reload did not happen — and the hand-written
 * version had the bug: on a live deployment whose runtime was too old to offer `reload`, a
 * plugin read as active while nothing in the running tree contained it.
 *
 * Now the platform's own create() reads the closure and imports it, and only a create() that
 * succeeded writes the registry. So the apply carries no plugin knowledge at all, and the
 * property holds by construction — which is what these tests pin.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HotResources } from "../src/hmr/resources.js";
import { PLUGINS_RESOURCE_ID, PluginHost, pluginHostFrom } from "../src/plugin/host.js";
import { loadPluginHost } from "../src/plugin/loader.js";
import { applyPluginClosure } from "../src/http/routes/plugins-installed.js";
import type { Hmr } from "../src/hmr/capabilities.js";
import type { LoadedPlugin } from "../src/plugin/host.js";

/** A data root whose one Project asks for these specifiers. */
async function rootAsking(specifiers: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "penguin-apply-"));
  await mkdir(path.join(root, "p1"), { recursive: true });
  await writeFile(
    path.join(root, "p1", ".project_config.toml"),
    `plugins = ${JSON.stringify(specifiers)}\nmodels = []\n`,
    "utf8",
  );
  return root;
}

function hmrWith(resources: HotResources, reload?: () => Promise<boolean>): Hmr {
  return { resources, ...(reload === undefined ? {} : { reload }) } as unknown as Hmr;
}

/** An entry as an earlier App would have left it: one module, already imported. */
const entry = (specifier: string, name: string): LoadedPlugin => ({
  specifier,
  modules: [
    {
      manifest: { name, requires: {}, provides: {}, contributes: {}, children: [] },
      create: () => ({ api: {} }),
    },
  ],
  replaces: [],
});

describe("applyPluginClosure", () => {
  it("asks for a re-assembly and touches nothing else", async () => {
    const root = await rootAsking(["@acme/not-installed"]);
    try {
      const resources = new HotResources();
      const running = new PluginHost();
      resources.register(PLUGINS_RESOURCE_ID, running);

      // A runtime older than this capability declares no `reload` at all: nothing was
      // applied, and the registry still describes the tree that is running.
      expect(await applyPluginClosure(root, hmrWith(resources))).toBe(false);
      expect(pluginHostFrom(resources)).toBe(running);

      // A re-assembly that happened is reported as such — and still writes nothing here:
      // the new create() is what registers its host.
      expect(
        await applyPluginClosure(
          root,
          hmrWith(resources, async () => true),
        ),
      ).toBe(true);
      expect(pluginHostFrom(resources)).toBe(running);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loadPluginHost", () => {
  it("keeps what the closure still asks for, by identity, and drops the rest", async () => {
    const root = await rootAsking(["@acme/kept"]);
    try {
      const resources = new HotResources();
      const inherited = new PluginHost();
      const kept = entry("@acme/kept", "Kept");
      inherited.use(kept);
      inherited.use(entry("@acme/dropped", "Dropped"));
      resources.register(PLUGINS_RESOURCE_ID, inherited);

      const host = await loadPluginHost(resources, root);

      // Reused, not imported again — the objects keep their identity across the swap.
      expect(host.entries().get("@acme/kept")).toBe(kept);
      // And a plugin the closure no longer names is simply not in the new host.
      expect([...host.entries().keys()]).toEqual(["@acme/kept"]);
      // Registering is the caller's, at its commit: a create() that throws must leave the
      // previous App's host in place.
      expect(pluginHostFrom(resources)).toBe(inherited);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips a specifier it cannot import instead of failing the boot", async () => {
    const root = await rootAsking(["@acme/not-installed"]);
    try {
      const resources = new HotResources();
      const host = await loadPluginHost(resources, root);
      expect([...host.entries().keys()]).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
