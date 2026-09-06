/**
 * Applying a plugin change: the host the surfaces read from must always describe the tree
 * that is actually running.
 *
 * Found on a live deployment whose runtime was too old to offer `reload`: the apply left a
 * rebuilt host in place, so a plugin read as active while nothing in the running tree
 * contained it — and `restartPending`, derived from that, said no restart was needed.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HotResources } from "../src/hmr/resources.js";
import { PLUGINS_RESOURCE_ID, PluginHost, pluginHostFrom } from "../src/plugin/host.js";
import { applyPluginClosure } from "../src/http/routes/plugins-installed.js";
import type { Hmr } from "../src/hmr/capabilities.js";

/** A data root whose one Project asks for a package that does not exist: the load is empty either way. */
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

describe("applyPluginClosure", () => {
  it("puts the previous host back when the runtime cannot re-assemble", async () => {
    const root = await rootAsking(["@acme/not-installed"]);
    try {
      const resources = new HotResources();
      const running = new PluginHost();
      resources.register(PLUGINS_RESOURCE_ID, running);
      // A runtime older than this capability declares no `reload` at all.
      expect(await applyPluginClosure(root, hmrWith(resources))).toBe(false);
      // The host a surface reads from is still the one describing the running tree, so
      // "active" keeps meaning what it says and restartPending stays true.
      expect(pluginHostFrom(resources)).toBe(running);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the rebuilt host when the re-assembly happened", async () => {
    const root = await rootAsking([]);
    try {
      const resources = new HotResources();
      const running = new PluginHost();
      resources.register(PLUGINS_RESOURCE_ID, running);
      expect(
        await applyPluginClosure(
          root,
          hmrWith(resources, async () => true),
        ),
      ).toBe(true);
      expect(pluginHostFrom(resources)).not.toBe(running);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("puts it back when the re-assembly was attempted and failed", async () => {
    // A boot that fails is recovered onto the previous document, so the previous tree is
    // what runs — and the previous host is what describes it.
    const root = await rootAsking([]);
    try {
      const resources = new HotResources();
      const running = new PluginHost();
      resources.register(PLUGINS_RESOURCE_ID, running);
      expect(
        await applyPluginClosure(
          root,
          hmrWith(resources, async () => false),
        ),
      ).toBe(false);
      expect(pluginHostFrom(resources)).toBe(running);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
