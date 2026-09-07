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
const entry = (specifier: string, name: string, file?: string): LoadedPlugin => ({
  specifier,
  ...(file === undefined ? {} : { file }),
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
      // Held from a file that no longer resolves (nothing installs @acme/kept here): the
      // held file and the resolved one are both absent-or-different, so this is the case
      // where an entry is NOT reused. Kept for the drop half of the assertion.
      const kept = entry("@acme/kept", "Kept");
      inherited.use(kept);
      inherited.use(entry("@acme/dropped", "Dropped"));
      resources.register(PLUGINS_RESOURCE_ID, inherited);

      const host = await loadPluginHost(resources, root);

      // A plugin the closure no longer names is simply not in the new host.
      expect([...host.entries().keys()]).toEqual([]);
      // Registering is the caller's, at its commit: a create() that throws must leave the
      // previous App's host in place.
      expect(pluginHostFrom(resources)).toBe(inherited);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses an entry only while the same file is behind the name", async () => {
    // The push this rule exists for: a hot update writes the builtin plugins to a NEW assets
    // directory, so an entry held by specifier alone would keep running the previous build's
    // plugin code — the push would land everywhere except the plugins. Seen for real: a fixed
    // claude-code plugin shipped to a machine and the old one kept spawning.
    const root = await rootAsking(["@acme/real"]);
    try {
      const dir = path.join(root, "plugins", "node_modules", "@acme", "real");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "@acme/real",
          main: "./index.js",
          penguin: {
            modules: [{ name: "AcmeReal", requires: {}, provides: {}, children: [] }],
          },
        }),
      );
      await writeFile(
        path.join(dir, "index.js"),
        "export default { modules: { AcmeReal: { create: () => ({ api: {} }) } } };\n",
      );

      const resources = new HotResources();
      const first = await loadPluginHost(resources, root);
      const held = first.entries().get("@acme/real");
      expect(held?.file).toBe(path.join(dir, "index.js"));

      // Same file behind the name: the same object, not a second import.
      resources.register(PLUGINS_RESOURCE_ID, first);
      const again = await loadPluginHost(resources, root);
      expect(again.entries().get("@acme/real")).toBe(held);

      // A different file behind it — what a push produces — is imported again.
      const moved = new PluginHost();
      moved.use({ ...held!, file: path.join(root, "old-assets", "index.js") });
      resources.register(PLUGINS_RESOURCE_ID, moved);
      const afterPush = await loadPluginHost(resources, root);
      expect(afterPush.entries().get("@acme/real")).not.toBe(held);
      expect(afterPush.entries().get("@acme/real")?.file).toBe(path.join(dir, "index.js"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the assets it is BOOTING with, not the ones already committed", async () => {
    // A hot upgrade materializes the new assets and publishes them before create() runs, but
    // commits harness.json only after that boot succeeds. A loader reading the committed
    // pointer therefore reads the version it is replacing — and every push would ship plugins
    // one version stale. Seen exactly that way on a machine: a corrected plugin arrived and
    // the previous build's copy kept running until the next push.
    const root = await rootAsking(["@acme/shipped"]);
    try {
      const build = async (dir: string, marker: string) => {
        const pkg = path.join(dir, "plugins", "node_modules", "@acme", "shipped");
        await mkdir(pkg, { recursive: true });
        await writeFile(
          path.join(pkg, "package.json"),
          JSON.stringify({
            name: "@acme/shipped",
            main: "./index.js",
            penguin: { modules: [{ name: marker, requires: {}, provides: {}, children: [] }] },
          }),
        );
        await writeFile(
          path.join(pkg, "index.js"),
          `export default { modules: { ${marker}: { create: () => ({ api: {} }) } } };\n`,
        );
      };
      const committed = path.join(root, "hmr", "store", "assets", "old");
      const booting = path.join(root, "hmr", "store", "assets", "new");
      await build(committed, "Old");
      await build(booting, "New");
      await mkdir(path.join(root, "hmr"), { recursive: true });
      await writeFile(
        path.join(root, "hmr", "harness.json"),
        JSON.stringify({ assets: { dir: "store/assets/old" } }),
      );

      // What harness.json names, when nobody says otherwise.
      const committedHost = await loadPluginHost(new HotResources(), root);
      expect(committedHost.modules().map((m) => m.manifest.name)).toEqual(["Old"]);

      // What the booting version carries, when the host says which assets those are.
      const bootingHost = await loadPluginHost(new HotResources(), root, booting);
      expect(bootingHost.modules().map((m) => m.manifest.name)).toEqual(["New"]);
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
