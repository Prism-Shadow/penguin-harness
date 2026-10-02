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
import {
  fetchIntoStore,
  PluginIntegrityMismatch,
  pluginStoreDir,
  programEntry,
  readStore,
  shippedNames,
  storePackage,
  storeSources,
  readShippedIndex,
  syncPluginStore,
} from "../src/plugin/store.js";
import { createHash } from "node:crypto";
import {
  entryDir,
  entryKey,
  nameSegments,
  tarballIntegrity,
} from "../../../scripts/plugin-entry.mjs";
import { integrityOf } from "./plugin-fixtures.js";

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

/**
 * Stores the plugin of a prefix made by `prefix`, under the integrity its tarball would have:
 * one per version and body, the way two packs of different content differ.
 */
async function store(at: string, options?: Parameters<typeof prefix>[1]) {
  const version = options?.version ?? "1.0.0";
  const integrity = integrityOf("@acme/sandbox-x", version, options?.body ?? "");
  return storePackage(root, await prefix(at, options), at, integrity);
}

/** npm's lockfile for a prefix that installed `@acme/sandbox-x`, recording `integrity` for it. */
async function writeLock(at: string, integrity: string | null): Promise<void> {
  const entry = integrity === null ? { version: "1.0.0" } : { version: "1.0.0", integrity };
  await fs.writeFile(
    path.join(at, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/@acme/sandbox-x": entry } }),
  );
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

describe("plugin store", () => {
  it("integrity is npm's: the sha512 of the tarball's bytes, and the entry key is its first 16 hex digits", async () => {
    const tarball = path.join(dir, "x-1.0.0.tgz");
    await fs.writeFile(tarball, Buffer.from("a tarball's bytes"));
    const digest = createHash("sha512").update("a tarball's bytes").digest();
    const integrity = await tarballIntegrity(tarball);
    expect(integrity).toBe(`sha512-${digest.toString("base64")}`);
    expect(entryKey(integrity)).toBe(digest.toString("hex").slice(0, 16));
    // Anything else is not a key: the sha256 form the store used before, or a truncated value.
    expect(entryKey(`sha256-${"ab".repeat(32)}`)).toBeNull();
    expect(entryKey(integrity.slice(0, -4))).toBeNull();
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
        entryKey(entry.integrity)!,
      ),
    );
    const pkg = path.join(entry.dir, "package");
    expect(await exists(path.join(pkg, "node_modules", "native", "index.js"))).toBe(true);
    expect(await exists(path.join(pkg, "node_modules", "unrelated"))).toBe(false);
    const manifest = parseToml(await fs.readFile(path.join(entry.dir, "manifest.toml"), "utf8"));
    expect(manifest).toMatchObject({ name: "@acme/sandbox-x", integrity: entry.integrity });

    // The same integrity from another source, with other file modes, is the same entry; another
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
    const integrity = `sha512-${Buffer.alloc(64, 0xab).toString("base64")}`;
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

  it("a fetch is checked against the integrity npm recorded: the index's is stored, any other is refused", async () => {
    const recorded = integrityOf("@acme/sandbox-x", "1.0.0", "registry");
    // What npm leaves in the staging prefix: the package, and the lockfile naming what it checked.
    const install = (lock: string | null) => async (_: string, cwd: string) => {
      await prefix(cwd);
      await writeLock(cwd, lock);
    };

    const entry = await fetchIntoStore(root, "@acme/sandbox-x@1.0.0", {
      install: install(recorded),
      expected: recorded,
    });
    expect(entry).toMatchObject({ name: "@acme/sandbox-x", version: "1.0.0", integrity: recorded });
    expect((await readStore(root)).map((e) => e.integrity)).toEqual([recorded]);

    // Another content than the index names, or no record at all: nothing more is stored.
    const other = integrityOf("@acme/sandbox-x", "1.0.0", "other");
    for (const lock of [other, null]) {
      const err = await fetchIntoStore(root, "@acme/sandbox-x@1.0.0", {
        install: install(lock),
        expected: integrityOf("@acme/sandbox-x", "1.0.0", "index"),
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PluginIntegrityMismatch);
    }
    expect((await readStore(root)).map((e) => e.integrity)).toEqual([recorded]);
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
    await prefix(path.join(lib, "plugins"));
    await write(lib, {
      "dist/penguin.js": "",
      "plugins/index.json": JSON.stringify([
        {
          name: "@acme/sandbox-x",
          version: "1.0.0",
          integrity: integrityOf("@acme/sandbox-x", "1.0.0"),
        },
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

  it("of the CLI's npm package lists plugins without carrying them: they are fetched, not shipped", async () => {
    // <pkg>/{dist/penguin.js, plugins/index.json} and no node_modules: what `npm install -g`
    // leaves (scripts/cli-plugin-index.mjs writes the index).
    const pkg = path.join(dir, "global", "lib", "node_modules", "@prismshadow", "penguin-cli");
    const row = {
      name: "@acme/sandbox-x",
      version: "1.0.0",
      integrity: integrityOf("@acme/sandbox-x", "1.0.0"),
    };
    await write(pkg, { "dist/penguin.js": "", "plugins/index.json": JSON.stringify([row]) });
    const entry = path.join(pkg, "dist", "penguin.js");
    const logged: string[] = [];
    // Not shipped: an install of it is a registry fetch, not a copy from the prefix.
    expect(await withEntry(entry, () => shippedNames(null))).toEqual([]);
    // Nothing to store at boot, and nothing to complain about.
    const shipped = await withEntry(entry, () =>
      syncPluginStore(root, null, (m) => logged.push(m)),
    );
    expect([...shipped]).toEqual([]);
    expect(logged).toEqual([]);
    expect(await readStore(root)).toEqual([]);
    // Still listed, with its content: the row a registry fetch is checked against.
    const listed = await withEntry(entry, () => readShippedIndex(null));
    expect(listed?.entries).toEqual([row]);
  });
});
