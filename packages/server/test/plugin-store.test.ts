/**
 * The plugin store (src/plugin/store.ts): one content-addressed entry per packed plugin under
 * `<root>/plugin-store/packages/[<@scope>/]<bucket>/<name>/<version>/<hash16>/`, complete only
 * once `.stored` is written.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activatePlugins, readGeneration } from "../src/plugin/activation.js";
import {
  fetchIntoStore,
  PluginIntegrityMismatch,
  pluginStoreDir,
  programEntry,
  programPackages,
  readStore,
  shippedNames,
  storeEntryDir,
  storePackage,
  storeSources,
  syncPluginStore,
} from "../src/plugin/store.js";
import {
  archiveIntegrity,
  entryDir,
  nameSegments,
  packageIntegrity,
} from "../../../scripts/plugin-entry.mjs";

let dir: string;
let root: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-store-"));
  root = path.join(dir, "root");
  await fs.mkdir(root);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(base: string, files: Record<string, string>, mode = 0o644): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(base, ...rel.split("/"));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text);
    await fs.chmod(abs, rel.endsWith("/bin/tool") ? 0o755 : mode);
  }
}

/**
 * An npm prefix the way build-plugins.mjs leaves one: its own manifest naming what it ships,
 * the plugin under node_modules, and the plugin's dependency hoisted beside it. Answers the
 * plugin's directory.
 */
async function prefix(
  at: string,
  { version = "1.0.0", body = "export default {};", mode = 0o644 } = {},
): Promise<string> {
  await write(
    at,
    {
      "package.json": JSON.stringify({ dependencies: { "@acme/sandbox-x": version } }),
      "node_modules/@acme/sandbox-x/package.json": JSON.stringify({
        name: "@acme/sandbox-x",
        version,
        description: "A sandbox backend",
        author: "Ada <ada@example.com>",
        license: "MIT",
        categories: ["sandbox"],
        dependencies: { native: "^2.0.0" },
      }),
      "node_modules/@acme/sandbox-x/dist/index.js": body,
      "node_modules/native/package.json": JSON.stringify({ name: "native", version: "2.0.1" }),
      "node_modules/native/index.js": "module.exports = 1;",
      // Installed beside, but named by nobody the plugin depends on: not copied.
      "node_modules/unrelated/package.json": JSON.stringify({ name: "unrelated" }),
    },
    mode,
  );
  return path.join(at, "node_modules", "@acme", "sandbox-x");
}

/** Stores the plugin of a prefix made by `prefix`. */
async function store(at: string, options?: Parameters<typeof prefix>[1]) {
  return storePackage(root, await prefix(at, options), at);
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

/**
 * A fixed file set and the integrity the index repository's archiver computes over it
 * (Prism-Shadow/penguin-plugins `packages/plugin-index/src/archive.ts` `archiveIntegrity`, at
 * 5c10e88d9): an index entry's integrity must be the store's key for the same package, so
 * the two archivers have to produce one byte stream. The set covers sort order, an
 * executable, a path too long for the ustar name field, and a non-ASCII path (a pax header).
 */
const PARITY_FILES: Record<string, string> = {
  "package/b.js": "b",
  "package/a/package.json": "{}",
  "package/bin/tool": "#!/bin/sh\n",
  [`package/${"d".repeat(60)}/${"e".repeat(60)}.js`]: "long",
  "package/grüße.txt": "unicode",
};
const PARITY_INTEGRITY = "sha256-92e4a245566237c24ce909fdc9dbb8cf8b43108ec7ab38e86311799ad4e9d2e5";

describe("plugin store", () => {
  it("hashes a package the way the index repository does", async () => {
    const src = path.join(dir, "src");
    await write(src, PARITY_FILES);
    const files = Object.keys(PARITY_FILES).map((rel) => ({
      rel,
      abs: path.join(src, ...rel.split("/")),
      exec: rel.endsWith("/bin/tool"),
    }));
    expect(await archiveIntegrity(files)).toBe(PARITY_INTEGRITY);
    expect(await packageIntegrity(src)).toBe(PARITY_INTEGRITY);
  });

  it("stores a package as one entry keyed by its content, its dependencies inside it", async () => {
    const entry = await store(path.join(dir, "a"));
    expect(entry.dir).toBe(
      path.join(
        pluginStoreDir(root),
        "packages",
        "@acme",
        "sa",
        "nd",
        "sandbox-x",
        "1.0.0",
        entry.integrity.slice(7, 23),
      ),
    );
    const pkg = path.join(entry.dir, "package");
    expect(await exists(path.join(pkg, "node_modules", "native", "index.js"))).toBe(true);
    expect(await exists(path.join(pkg, "node_modules", "unrelated"))).toBe(false);
    expect(await packageIntegrity(entry.dir)).toBe(entry.integrity);
    const manifest = parseToml(await fs.readFile(path.join(entry.dir, "manifest.toml"), "utf8"));
    expect(manifest).toMatchObject({ name: "@acme/sandbox-x", integrity: entry.integrity });

    // The same content from another source, with other file modes, is the same entry; other
    // content under the same version, or another version, is another.
    const again = await store(path.join(dir, "b"), { mode: 0o664 });
    expect(again.integrity).toBe(entry.integrity);
    await store(path.join(dir, "c"), { body: "x" });
    await store(path.join(dir, "d"), { version: "1.1.0" });
    expect((await readStore(root)).map((r) => r.version)).toEqual(["1.0.0", "1.0.0", "1.1.0"]);
  });

  it("files a name under packages/, in the bucket its name spells", () => {
    // The same vectors run in the index repository's tests: one rule, two copies.
    const vectors: Array<[string, string]> = [
      ["a", "packages/1/a"],
      ["ab", "packages/2/ab"],
      ["abc", "packages/3/a/abc"],
      ["abcd", "packages/ab/cd/abcd"],
      ["Sandbox-Bwrap", "packages/sa/nd/Sandbox-Bwrap"],
      ["@penguinharness/x", "packages/@penguinharness/1/x"],
      ["@penguinharness/fs", "packages/@penguinharness/2/fs"],
      ["@penguinharness/git", "packages/@penguinharness/3/g/git"],
      ["@penguinharness/sandbox-bwrap", "packages/@penguinharness/sa/nd/sandbox-bwrap"],
    ];
    for (const [name, want] of vectors) expect(nameSegments(name).join("/")).toBe(want);
    const integrity = `sha256-${"ab".repeat(32)}`;
    expect(entryDir("/t", "@penguinharness/sandbox-bwrap", "0.2.2", integrity)).toBe(
      path.join("/t", "packages/@penguinharness/sa/nd/sandbox-bwrap/0.2.2", "ab".repeat(8)),
    );
  });

  it("reads entries under packages/ alone: one elsewhere, or in the wrong bucket, is not an entry", async () => {
    const entry = await store(path.join(dir, "a"));
    const key = path.basename(entry.dir);
    // An earlier layout's copy at the top of the store, and a copy filed in a bucket its name
    // does not spell: both complete, neither read.
    const storeDir = pluginStoreDir(root);
    const elsewhere = [
      path.join(storeDir, "@acme", "sandbox-x", "1.0.0", key),
      path.join(storeDir, "packages", "@acme", "zz", "zz", "sandbox-x", "1.0.0", key),
    ];
    for (const copy of elsewhere) await fs.cp(entry.dir, copy, { recursive: true });
    expect((await readStore(root)).map((e) => e.integrity)).toEqual([entry.integrity]);
  });

  it("an entry without its completion marker does not exist, and the next write replaces it", async () => {
    const entry = await store(path.join(dir, "a"));
    await fs.rm(path.join(entry.dir, ".stored"));
    await fs.writeFile(path.join(entry.dir, "package", "dist", "index.js"), "half written");
    expect(await readStore(root)).toEqual([]);

    await store(path.join(dir, "b"));
    expect(await fs.readFile(path.join(entry.dir, "package", "dist", "index.js"), "utf8")).toBe(
      "export default {};",
    );
  });

  it("refuses a fetched package whose integrity is not the index's, and stores nothing", async () => {
    const install = async (_: string, cwd: string) => {
      await prefix(cwd);
    };
    const expected = `sha256-${"0".repeat(64)}`;
    const err = await fetchIntoStore(root, "@acme/sandbox-x", { install, expected }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PluginIntegrityMismatch);
    expect(await readStore(root)).toEqual([]);
    expect(await fs.readdir(path.join(pluginStoreDir(root), ".staging"))).toEqual([]);
  });
});

/** Runs `fn` with `process.argv[1]` — the program's entry, where the installation is read — set. */
async function withEntry<T>(entry: string, fn: () => Promise<T>): Promise<T> {
  const argv1 = process.argv[1];
  process.argv[1] = entry;
  try {
    return await fn();
  } finally {
    process.argv[1] = argv1!;
  }
}

describe("the installation's prefix", () => {
  it("is found beside the entry's target, not beside a link to it (the Docker image)", async () => {
    // /opt/penguin/lib/{dist/penguin.js, plugins/}, started as /usr/local/bin/penguin → the entry.
    const lib = path.join(dir, "opt", "penguin", "lib");
    await write(lib, {
      "dist/penguin.js": "",
      "plugins/index.json": JSON.stringify([
        { name: "@acme/sandbox-x", version: "1.0.0", integrity: `sha256-${"1".repeat(64)}` },
      ]),
    });
    const link = path.join(dir, "usr", "local", "bin", "penguin");
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(path.join(lib, "dist", "penguin.js"), link);
    const real = await fs.realpath(lib);
    expect(programEntry(link)).toBe(path.join(real, "dist", "penguin.js"));
    expect(storeSources(null, link)).toEqual([path.join(real, "plugins")]);
    expect(await withEntry(link, () => shippedNames(null))).toEqual(["@acme/sandbox-x"]);
  });
});

describe("an npm global install", () => {
  /**
   * `<prefix>/lib/node_modules/@acme/cli`, its bin linked from `<prefix>/bin/penguin`: the
   * program declares its plugins as optional dependencies, npm nested the one it could get
   * inside the program's own node_modules and hoisted that plugin's dependency one level up.
   */
  async function globalInstall(): Promise<{ bin: string; cli: string }> {
    const cli = path.join(dir, "global", "lib", "node_modules", "@acme", "cli");
    await write(cli, {
      "package.json": JSON.stringify({
        name: "@acme/cli",
        version: "1.0.0",
        dependencies: { commander: "^13.0.0" },
        optionalDependencies: {
          "@acme/sandbox-x": "1.0.0",
          "@acme/sandbox-unpublished": "1.0.0",
          "native-binary": "1.0.0",
        },
      }),
      "dist/penguin.js": "",
      "node_modules/commander/package.json": JSON.stringify({
        name: "commander",
        version: "13.0.0",
      }),
      // An optional package that is not a server plugin (no generated ifaces.json).
      "node_modules/native-binary/package.json": JSON.stringify({
        name: "native-binary",
        version: "1.0.0",
      }),
      "node_modules/@acme/sandbox-x/package.json": JSON.stringify({
        name: "@acme/sandbox-x",
        version: "1.0.0",
        dependencies: { native: "^2.0.0" },
      }),
      "node_modules/@acme/sandbox-x/ifaces.json": "{}",
      "node_modules/@acme/sandbox-x/dist/index.js": "export default {};",
    });
    await write(path.join(dir, "global", "lib"), {
      "node_modules/native/package.json": JSON.stringify({ name: "native", version: "2.0.1" }),
      "node_modules/native/index.js": "module.exports = 1;",
    });
    const bin = path.join(dir, "global", "bin", "penguin");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.symlink(path.join(cli, "dist", "penguin.js"), bin);
    return { bin, cli: await fs.realpath(cli) };
  }

  it("ships the plugins npm installed among the program's optional dependencies, and nothing else", async () => {
    const { bin, cli } = await globalInstall();
    // Not commander (a dependency), not the one npm could not get, not a non-plugin binary.
    expect(programPackages(bin)).toEqual(
      new Map([["@acme/sandbox-x", path.join(cli, "node_modules", "@acme", "sandbox-x")]]),
    );
    const shipped = await withEntry(bin, () => syncPluginStore(root, null));
    const [row] = await readStore(root);
    expect(row).toMatchObject({ name: "@acme/sandbox-x", version: "1.0.0" });
    expect([...shipped]).toEqual([row!.integrity]);
    // Its dependency, hoisted above the program's package, travels inside the entry.
    const entry = storeEntryDir(root, row!.name, row!.version, row!.integrity);
    expect(await exists(path.join(entry, "package", "node_modules", "native", "index.js"))).toBe(
      true,
    );
    expect(await withEntry(bin, () => shippedNames(null))).toEqual(["@acme/sandbox-x"]);
  });

  it("shipped is not enabled: the boot stores what the program ships and activates only what a Project asks for", async () => {
    const { bin } = await globalInstall();
    const { current, missing } = await withEntry(bin, () => activatePlugins(root, new Map(), null));
    expect(missing.size).toBe(0);
    expect((await readStore(root)).map((e) => e.name)).toEqual(["@acme/sandbox-x"]);
    expect(await readGeneration(root, current)).toEqual([]);
  });

  it("leaves a workspace link alone: a dev checkout's source tree is not something the program installed", async () => {
    const cli = path.join(dir, "ws", "packages", "cli");
    await write(cli, {
      "package.json": JSON.stringify({
        name: "@acme/cli",
        version: "1.0.0",
        optionalDependencies: { "@acme/sandbox-x": "workspace:*" },
      }),
      "src/penguin.ts": "",
    });
    const plugin = path.join(dir, "ws", "plugins", "sandbox-x");
    await write(plugin, {
      "package.json": JSON.stringify({ name: "@acme/sandbox-x", version: "1.0.0" }),
      "ifaces.json": "{}",
    });
    await fs.mkdir(path.join(cli, "node_modules", "@acme"), { recursive: true });
    await fs.symlink(plugin, path.join(cli, "node_modules", "@acme", "sandbox-x"));
    expect(programPackages(path.join(cli, "src", "penguin.ts"))).toEqual(new Map());
  });
});
