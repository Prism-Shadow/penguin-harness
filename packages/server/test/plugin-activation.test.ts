/**
 * Plugin activation: a process loads plugins from one place, the generation `<root>/plugins/current`
 * names, which links store entries; the generation is resolved from the closure.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  activatePlugins,
  chooseEntry,
  currentGeneration,
  readGeneration,
} from "../src/plugin/activation.js";
import type { PluginAsk } from "../src/plugin/activation.js";
import { storeEntryDir, storePackage } from "../src/plugin/store.js";
import type { StoreIndexEntry } from "../src/plugin/store.js";
import { writePluginLinks } from "../src/plugin/links.js";
import { integrityOf, writeClassPackage, writeShippedIndex } from "./plugin-fixtures.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "penguin-activation-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A package in an assets directory's `plugins/` prefix, listed in its index: what a push ships. */
async function ship(assets: string, name: string, module: string, version = "1.0.0") {
  const prefix = path.join(assets, "plugins");
  await writeClassPackage(path.join(prefix, "node_modules", ...name.split("/")), {
    name,
    module,
    version,
  });
  const file = path.join(prefix, "package.json");
  const manifest = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as {
    dependencies?: Record<string, string>;
  };
  manifest.dependencies = { ...manifest.dependencies, [name]: version };
  await writeFile(file, JSON.stringify(manifest));
  await writeShippedIndex(prefix);
}

/** A package fetched from the registry, stored the way a fetch stores it. */
async function fetched(name: string, module: string, version: string) {
  const prefix = path.join(root, "fetched", `${module}-${version}`);
  await mkdir(prefix, { recursive: true });
  await writeFile(path.join(prefix, "package.json"), "{}");
  const dir = path.join(prefix, "node_modules", ...name.split("/"));
  await writeClassPackage(dir, { name, module, version });
  return storePackage(root, dir, prefix, integrityOf(name, version, `fetched:${module}`));
}

const asks = (entries: Record<string, PluginAsk[]>) => new Map(Object.entries(entries));

describe("a generation", () => {
  it("links store entries, is keyed by its content, and is what current points at", async () => {
    const assets = path.join(root, "hmr", "store", "assets", "a");
    await ship(assets, "@acme/one", "One");
    await ship(assets, "@acme/two", "Two");
    const first = await activatePlugins(root, asks({ "@acme/one": [{}] }), assets);
    expect(currentGeneration(root)).toBe(first.current);
    const [row] = (await readGeneration(root, first.current))!;
    expect(row).toBeDefined();
    // The one entry is a store entry, keyed by its integrity.
    if (row === undefined || !("integrity" in row)) {
      throw new Error("expected the generation to hold a linked store entry");
    }
    const link = path.join(root, "plugins", first.current, "node_modules", "@acme", "one");
    expect(await realpath(link)).toBe(
      await realpath(
        path.join(storeEntryDir(root, row!.name, row!.version, row!.integrity), "package"),
      ),
    );

    const same = await activatePlugins(root, asks({ "@acme/one": [{}] }), assets);
    expect(same.current).toBe(first.current);
    const both = await activatePlugins(
      root,
      asks({ "@acme/one": [{}], "@acme/two": [{}] }),
      assets,
    );
    expect(both).toMatchObject({ previous: first.current });
    expect(both.current).not.toBe(first.current);
  });

  it("switches to the content a push brings under an unchanged name and version", async () => {
    const before = path.join(root, "hmr", "store", "assets", "before");
    const after = path.join(root, "hmr", "store", "assets", "after");
    await ship(before, "@acme/one", "Before");
    await ship(after, "@acme/one", "After");
    const first = await activatePlugins(root, asks({ "@acme/one": [{}] }), before);
    const second = await activatePlugins(root, asks({ "@acme/one": [{}] }), after);
    expect(second.current).not.toBe(first.current);
    const index = await readFile(
      path.join(root, "plugins", second.current, "node_modules", "@acme", "one", "index.js"),
      "utf8",
    );
    expect(index).toContain("After");
  });

  it("reports what it cannot place, and places the rest", async () => {
    await fetched("@acme/old", "Old", "1.0.0");
    const { missing } = await activatePlugins(
      root,
      asks({ "@acme/old": [{ version: "^2.0.0" }], "@acme/absent": [{}] }),
      null,
    );
    expect(missing.get("@acme/absent")).toMatch(/not in the plugin store/);
    expect(missing.get("@acme/old")).toMatch(/no stored '@acme\/old' satisfies \^2\.0\.0/);
  });

  it("answers a linked name from its directory, keyed by the path — and refuses what a link cannot satisfy", async () => {
    // A built package in a directory of its own, and a link record naming it: the second way
    // a name reaches a machine, beside the store.
    const dir = path.join(root, "local", "one");
    await writeClassPackage(dir, { name: "@acme/local", module: "Local" });
    await writePluginLinks(
      root,
      new Map([
        ["@acme/local", { path: dir, linkedAt: "2026-10-10T00:00:00.000Z", by: "admin" }],
      ]),
    );
    const first = await activatePlugins(root, asks({ "@acme/local": [{}] }), null);
    const [row] = (await readGeneration(root, first.current))!;
    // The generation records the link — no integrity, the path is the content's name.
    expect(row).toMatchObject({ name: "@acme/local", version: "1.0.0", local: dir });
    const link = path.join(root, "plugins", first.current, "node_modules", "@acme", "local");
    expect(await realpath(link)).toBe(await realpath(dir));
    // The same record answers the same key: no rebuild, no flip.
    const same = await activatePlugins(root, asks({ "@acme/local": [{}] }), null);
    expect(same.current).toBe(first.current);
    // A version range is checked against the directory's own package.json.
    const asked = await activatePlugins(root, asks({ "@acme/local": [{ version: "^2.0.0" }] }), null);
    expect(asked.missing.get("@acme/local")).toMatch(
      /version 1\.0\.0, which does not satisfy \^2\.0\.0/,
    );
    // An integrity pin is refused outright: a local directory has none.
    const pinned = await activatePlugins(
      root,
      asks({ "@acme/local": [{ integrity: integrityOf("@acme/local", "1.0.0") }] }),
      null,
    );
    expect(pinned.missing.get("@acme/local")).toMatch(/no integrity to pin/);
    // A directory whose entry file is gone (rebuilt away, removed) is reported, not linked.
    const entry = path.join(dir, "index.js");
    const held = await readFile(entry, "utf8");
    await rm(entry);
    const unbuilt = await activatePlugins(root, asks({ "@acme/local": [{}] }), null);
    expect(unbuilt.missing.get("@acme/local")).toMatch(
      /linked locally at .*no longer a loadable plugin package.*build the package first/s,
    );
    await writeFile(entry, held);
  });
});

describe("choosing an entry", () => {
  const entry = (version: string, hex: string): StoreIndexEntry => ({
    name: "@acme/p",
    version,
    description: "",
    authors: [],
    license: "",
    integrity: integrityOf("@acme/p", version, hex),
  });

  it("takes a pin, else the highest version every ask admits, the build's content within one", () => {
    const v1 = entry("1.0.0", "1");
    const v12 = entry("1.2.0", "2");
    const v12fetched = entry("1.2.0", "0");
    const v2 = entry("2.0.0", "3");
    const stored = [v1, v12fetched, v12, v2];
    const none = new Set<string>();
    expect(chooseEntry("@acme/p", [{}], stored, none)).toBe(v2);
    expect(
      chooseEntry(
        "@acme/p",
        [{ version: "^1.0.0" }, { version: "<2.0.0" }],
        stored,
        new Set([v12.integrity]),
      ),
    ).toBe(v12);
    expect(chooseEntry("@acme/p", [{ integrity: v1.integrity }], stored, none)).toBe(v1);
    expect(
      chooseEntry(
        "@acme/p",
        [{ integrity: v1.integrity }, { integrity: v2.integrity }],
        stored,
        none,
      ),
    ).toMatchObject({ missing: expect.stringMatching(/pinned to 2 different contents/) });
  });
});
