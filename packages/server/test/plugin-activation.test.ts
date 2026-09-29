/**
 * Plugin activation: a process loads plugins from one place, the generation `<root>/plugins/current`
 * names, which links store entries; the generation is resolved from the closure and written so
 * that a reader only ever sees a complete one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  activatePlugins,
  chooseEntry,
  COMPLETE_FILE,
  compareVersions,
  currentGeneration,
  generationKey,
  pointCurrent,
  readGeneration,
  satisfies,
  writeGeneration,
} from "../src/plugin/activation.js";
import type { PluginAsk } from "../src/plugin/activation.js";
import { storeEntryDir, storePackage } from "../src/plugin/store.js";
import type { StoreIndexEntry } from "../src/plugin/store.js";
import { writeClassPackage } from "./plugin-fixtures.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "penguin-activation-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A package in an assets directory's `plugins/` prefix, named in its manifest: what a push ships. */
async function ship(assets: string, name: string, module: string, version = "1.0.0") {
  const prefix = path.join(assets, "plugins");
  await writeClassPackage(path.join(prefix, "node_modules", ...name.split("/")), {
    name,
    module,
    version,
  });
  const file = path.join(prefix, "package.json");
  const manifest = JSON.parse(
    await readFile(file, "utf8").catch(() => '{"name":"prefix","private":true}'),
  ) as { dependencies?: Record<string, string> };
  manifest.dependencies = { ...manifest.dependencies, [name]: version };
  await writeFile(file, JSON.stringify(manifest));
}

/** A package fetched from the registry, stored the way a fetch stores it. */
async function fetched(name: string, module: string, version: string) {
  const prefix = path.join(root, "fetched", `${module}-${version}`);
  await writeFile(path.join(await mkdirp(prefix), "package.json"), "{}");
  const dir = path.join(prefix, "node_modules", ...name.split("/"));
  await writeClassPackage(dir, { name, module, version });
  return storePackage(root, dir, prefix, "registry");
}

async function mkdirp(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

const asks = (entries: Record<string, PluginAsk[]>) => new Map(Object.entries(entries));

describe("a generation", () => {
  it("is an npm prefix of links to store entries, written complete and then pointed at", async () => {
    const assets = path.join(root, "hmr", "store", "assets", "a");
    await ship(assets, "@acme/one", "One");
    const { previous, current, missing } = await activatePlugins(
      root,
      asks({ "@acme/one": [{}] }),
      assets,
    );
    expect(previous).toBeNull();
    expect(missing.size).toBe(0);
    expect((await readFile(path.join(root, "plugins", "current"), "utf8")).trim()).toBe(current);
    const gen = path.join(root, "plugins", current);
    const manifest = JSON.parse(await readFile(path.join(gen, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      plugins: Record<string, { version: string; sha256: string }>;
    };
    expect(manifest.dependencies).toEqual({ "@acme/one": "1.0.0" });
    const row = manifest.plugins["@acme/one"]!;
    expect(row.version).toBe("1.0.0");
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The key is the (name, sha256) list's hash.
    expect(current).toBe(
      generationKey([{ name: "@acme/one", version: "1.0.0", integrity: `sha256-${row.sha256}` }]),
    );
    // node_modules/<name> is a link to the entry's package/, not a copy.
    const link = path.join(gen, "node_modules", "@acme", "one");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(link)).toBe(
      await realpath(
        path.join(storeEntryDir(root, "@acme/one", "1.0.0", `sha256-${row.sha256}`), "package"),
      ),
    );
    await stat(path.join(gen, COMPLETE_FILE));
    // Nothing of the write is left behind.
    expect((await readdir(path.join(root, "plugins"))).sort()).toEqual([current, "current"].sort());
  });

  it("is keyed by its content: the same selection is the same directory, another is a new one", async () => {
    const assets = path.join(root, "hmr", "store", "assets", "a");
    await ship(assets, "@acme/one", "One");
    await ship(assets, "@acme/two", "Two");
    const first = await activatePlugins(root, asks({ "@acme/one": [{}] }), assets);
    const marker = path.join(root, "plugins", first.current, COMPLETE_FILE);
    const written = (await stat(marker)).mtimeMs;
    const same = await activatePlugins(root, asks({ "@acme/one": [{}] }), assets);
    expect(same).toMatchObject({ previous: first.current, current: first.current });
    expect((await stat(marker)).mtimeMs).toBe(written);

    const both = await activatePlugins(
      root,
      asks({ "@acme/two": [{}], "@acme/one": [{}] }),
      assets,
    );
    expect(both.previous).toBe(first.current);
    expect(both.current).not.toBe(first.current);
    expect(currentGeneration(root)).toBe(both.current);
    // The previous generation is still there to point back at.
    expect((await readGeneration(root, first.current))?.map((e) => e.name)).toEqual(["@acme/one"]);
    await pointCurrent(root, first.current);
    expect(currentGeneration(root)).toBe(first.current);
  });

  it("is not current until complete, and an incomplete one is replaced by the next write", async () => {
    const entries = [
      { name: "@acme/one", version: "1.0.0", integrity: `sha256-${"a".repeat(64)}` },
    ];
    const key = generationKey(entries);
    // A generation that died before its marker, and a pointer already naming it.
    await mkdir(path.join(root, "plugins", key, "node_modules"), { recursive: true });
    await writeFile(path.join(root, "plugins", key, "package.json"), "{}");
    await pointCurrent(root, key);
    expect(currentGeneration(root)).toBeNull();
    expect(await writeGeneration(root, entries)).toBe(key);
    expect(currentGeneration(root)).toBe(key);
    expect((await readGeneration(root, key))?.map((e) => e.integrity)).toEqual([
      entries[0]!.integrity,
    ]);
  });

  it("switches to the content a push brings under an unchanged name and version", async () => {
    const before = path.join(root, "hmr", "store", "assets", "before");
    const after = path.join(root, "hmr", "store", "assets", "after");
    await ship(before, "@acme/one", "Before");
    await ship(after, "@acme/one", "After");
    const first = await activatePlugins(root, asks({ "@acme/one": [{}] }), before);
    const second = await activatePlugins(root, asks({ "@acme/one": [{}] }), after);
    expect(second.current).not.toBe(first.current);
    const [a] = (await readGeneration(root, first.current))!;
    const [b] = (await readGeneration(root, second.current))!;
    expect([a!.version, b!.version]).toEqual(["1.0.0", "1.0.0"]);
    expect(b!.integrity).not.toBe(a!.integrity);
    const index = await readFile(
      path.join(root, "plugins", second.current, "node_modules", "@acme", "one", "index.js"),
      "utf8",
    );
    expect(index).toContain("After");
  });

  it("reports what it cannot place, and places the rest", async () => {
    await fetched("@acme/old", "Old", "1.0.0");
    const { current, missing } = await activatePlugins(
      root,
      asks({
        "@acme/old": [{ version: "^2.0.0" }],
        "@acme/absent": [{}],
        "/dev/checkout/x.js": [{}],
      }),
      null,
    );
    expect(missing.get("@acme/absent")).toMatch(/not in the plugin store/);
    expect(missing.get("@acme/old")).toMatch(
      /no stored '@acme\/old' satisfies \^2\.0\.0 \(stored: 1\.0\.0\)/,
    );
    // A path is the loader's, not the store's.
    expect(missing.has("/dev/checkout/x.js")).toBe(false);
    expect(await readGeneration(root, current)).toEqual([]);
  });
});

describe("choosing an entry", () => {
  const entry = (version: string, hex: string): StoreIndexEntry => ({
    name: "@acme/p",
    version,
    description: "",
    authors: [],
    license: "",
    integrity: `sha256-${hex.repeat(64)}`,
  });
  const v1 = entry("1.0.0", "1");
  const v12 = entry("1.2.0", "2");
  const v2 = entry("2.0.0", "3");
  const stored = [v1, v12, v2];

  it("takes the highest version every Project's ask admits", () => {
    expect(chooseEntry("@acme/p", [{}], stored, new Set())).toBe(v2);
    expect(chooseEntry("@acme/p", [{ version: "^1.0.0" }], stored, new Set())).toBe(v12);
    expect(
      chooseEntry("@acme/p", [{ version: "^1.0.0" }, { version: "<1.2.0" }], stored, new Set()),
    ).toBe(v1);
  });

  it("prefers what the running build carries over a higher fetched version", () => {
    expect(chooseEntry("@acme/p", [{}], stored, new Set([v12.integrity]))).toBe(v12);
  });

  it("takes a pinned content and no other", () => {
    expect(
      chooseEntry("@acme/p", [{ integrity: v1.integrity }], stored, new Set([v2.integrity])),
    ).toBe(v1);
    expect(
      chooseEntry(
        "@acme/p",
        [{ integrity: v1.integrity }, { integrity: v2.integrity }],
        stored,
        new Set(),
      ),
    ).toMatchObject({ missing: expect.stringMatching(/pinned to 2 different contents/) });
  });
});

describe("versions", () => {
  it("orders and matches the way npm's common ranges do", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(satisfies("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfies("0.2.5", "^0.2.1")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.1")).toBe(false);
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("1.2.3", ">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfies("1.2.3", "*")).toBe(true);
    expect(satisfies("1.0.0-rc.1", "^1.0.0")).toBe(false);
    expect(satisfies("1.0.0", "1.x || 2.x")).toBe(false);
  });
});
