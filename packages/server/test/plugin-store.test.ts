/**
 * The plugin store (src/plugin/store.ts): one content-addressed entry per packed plugin under
 * `<root>/plugin-store/<name>/<version>/<hash16>/`, written by three sources through one path,
 * complete only once `.stored` is written, and indexed by an `index.json` rebuilt from the tree.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import * as tar from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePluginIndex } from "../src/plugin/registry.js";
import {
  fetchIntoStore,
  importPrefix,
  PluginIntegrityMismatch,
  pluginStoreDir,
  readStore,
  rebuildStoreIndex,
  storeEntryDir,
  storeSources,
  syncPluginStore,
} from "../src/plugin/store.js";
import {
  archiveChunks,
  archiveIntegrity,
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
 * the plugin under node_modules, and the plugin's dependency hoisted beside it.
 */
async function prefix(
  at: string,
  { version = "1.0.0", body = "export default {};", mode = 0o644 } = {},
): Promise<string> {
  await write(
    at,
    {
      "package.json": JSON.stringify({
        name: "penguin-builtin-plugins",
        private: true,
        dependencies: { "@acme/sandbox-x": version },
      }),
      "node_modules/@acme/sandbox-x/package.json": JSON.stringify({
        name: "@acme/sandbox-x",
        version,
        description: "A sandbox backend",
        author: { name: "Ada", email: "ada@example.com" },
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/acme/x.git" },
        keywords: ["linux"],
        categories: ["sandbox"],
        dependencies: { native: "^2.0.0" },
        optionalDependencies: { "native-win32-x64": "2.0.0" },
      }),
      "node_modules/@acme/sandbox-x/dist/index.js": body,
      "node_modules/@acme/sandbox-x/vendor/x64/bin/tool": "#!/bin/sh\n",
      "node_modules/native/package.json": JSON.stringify({ name: "native", version: "2.0.1" }),
      "node_modules/native/index.js": "module.exports = 1;",
      // Installed beside, but named by nobody the plugin depends on: not copied.
      "node_modules/unrelated/package.json": JSON.stringify({
        name: "unrelated",
        version: "1.0.0",
      }),
    },
    mode,
  );
  return at;
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
 * the two archivers have to produce one byte stream. The set covers what the format spells
 * out: sort order, an executable, a path too long for the ustar name field (split into the
 * prefix field), and a non-ASCII path (a pax header).
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
  it("hashes a package the way the index repository does: one archive, one integrity", async () => {
    const src = path.join(dir, "src");
    await write(src, PARITY_FILES);
    const files = Object.keys(PARITY_FILES).map((rel) => ({
      rel,
      abs: path.join(src, ...rel.split("/")),
      exec: rel.endsWith("/bin/tool"),
    }));
    expect(await archiveIntegrity(files)).toBe(PARITY_INTEGRITY);
    // And the store's own path to it: `package/` of an entry, exec bits read off the files.
    expect(await packageIntegrity(src)).toBe(PARITY_INTEGRITY);
  });

  it("the archive is a tar any reader unpacks, file for file", async () => {
    const src = path.join(dir, "src");
    await write(src, PARITY_FILES);
    const files = Object.keys(PARITY_FILES).map((rel) => ({
      rel,
      abs: path.join(src, ...rel.split("/")),
      exec: rel.endsWith("/bin/tool"),
    }));
    const chunks: Buffer[] = [];
    for await (const chunk of archiveChunks(files)) chunks.push(chunk);
    const out = path.join(dir, "out");
    await fs.mkdir(out);
    await fs.writeFile(path.join(dir, "out.tar"), Buffer.concat(chunks));
    await tar.x({ file: path.join(dir, "out.tar"), cwd: out });
    for (const [rel, text] of Object.entries(PARITY_FILES)) {
      expect(await fs.readFile(path.join(out, ...rel.split("/")), "utf8"), rel).toBe(text);
    }
    expect((await fs.stat(path.join(out, "package", "bin", "tool"))).mode & 0o111).not.toBe(0);
  });

  it("stores a shipped package as one complete entry, its hoisted dependencies inside it", async () => {
    const { stored, failed } = await importPrefix(
      root,
      await prefix(path.join(dir, "a")),
      "builtin",
    );
    expect(failed.size).toBe(0);
    expect(stored).toHaveLength(1);
    const [entry] = stored;
    expect(entry!.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    // The path spells the entry: name (two directories when scoped), version, 16 hex digits.
    expect(entry!.dir).toBe(
      path.join(pluginStoreDir(root), "@acme", "sandbox-x", "1.0.0", entry!.integrity.slice(7, 23)),
    );
    const pkg = path.join(entry!.dir, "package");
    expect(await exists(path.join(pkg, "dist", "index.js"))).toBe(true);
    expect(await exists(path.join(pkg, "node_modules", "native", "index.js"))).toBe(true);
    expect(await exists(path.join(pkg, "node_modules", "unrelated"))).toBe(false);
    expect((await fs.stat(path.join(pkg, "vendor", "x64", "bin", "tool"))).mode & 0o777).toBe(
      0o755,
    );
    expect((await fs.stat(path.join(pkg, "dist", "index.js"))).mode & 0o777).toBe(0o644);

    const manifest = parseToml(await fs.readFile(path.join(entry!.dir, "manifest.toml"), "utf8"));
    expect(manifest).toEqual({
      name: "@acme/sandbox-x",
      version: "1.0.0",
      description: "A sandbox backend",
      authors: ["Ada <ada@example.com>"],
      license: "MIT",
      repository: "https://github.com/acme/x.git",
      keywords: ["linux"],
      categories: ["sandbox"],
      integrity: entry!.integrity,
    });
    // The key is the package's content, hashed the index repository's way.
    expect(await packageIntegrity(entry!.dir)).toBe(entry!.integrity);
    const lock = JSON.parse(await fs.readFile(path.join(entry!.dir, "package-lock.json"), "utf8"));
    expect(lock.lockfileVersion).toBe(3);
    expect(Object.keys(lock.packages)).toEqual([
      "",
      "node_modules/@acme/sandbox-x",
      "node_modules/@acme/sandbox-x/node_modules/native",
    ]);
    expect(lock.packages["node_modules/@acme/sandbox-x/node_modules/native"].version).toBe("2.0.1");
    const stamp = parseToml(await fs.readFile(path.join(entry!.dir, ".stored"), "utf8"));
    expect(stamp.source).toBe("builtin");
    expect(typeof stamp.storedAt).toBe("string");
    // Nothing of the work in progress is left behind.
    expect(await fs.readdir(path.join(pluginStoreDir(root), ".staging"))).toEqual([]);
  });

  it("keys by content: one content is stored once, whatever its source, file modes or mtimes", async () => {
    const first = await importPrefix(root, await prefix(path.join(dir, "a")), "builtin");
    await new Promise((r) => setTimeout(r, 1100)); // a later mtime on disk must not show
    const again = await importPrefix(
      root,
      await prefix(path.join(dir, "b"), { mode: 0o664 }),
      "push",
    );
    expect(again.stored[0]!.integrity).toBe(first.stored[0]!.integrity);
    // Not rewritten: the entry still says where it first came from.
    const stamp = parseToml(await fs.readFile(path.join(first.stored[0]!.dir, ".stored"), "utf8"));
    expect(stamp.source).toBe("builtin");

    // Same version, other content; and another version: an entry each.
    const other = await importPrefix(
      root,
      await prefix(path.join(dir, "c"), { body: "x" }),
      "push",
    );
    const next = await importPrefix(
      root,
      await prefix(path.join(dir, "d"), { version: "1.1.0" }),
      "push",
    );
    expect(other.stored[0]!.integrity).not.toBe(first.stored[0]!.integrity);
    const rows = await readStore(root);
    expect(rows.map((r) => `${r.name}@${r.version}:${r.integrity}`)).toEqual(
      [
        `@acme/sandbox-x@1.0.0:${first.stored[0]!.integrity}`,
        `@acme/sandbox-x@1.0.0:${other.stored[0]!.integrity}`,
        `@acme/sandbox-x@1.1.0:${next.stored[0]!.integrity}`,
      ].sort(),
    );
  });

  it("an entry without its completion marker does not exist, and the next write replaces it", async () => {
    const { stored } = await importPrefix(root, await prefix(path.join(dir, "a")), "builtin");
    const entry = stored[0]!;
    await fs.rm(path.join(entry.dir, ".stored"));
    await fs.writeFile(path.join(entry.dir, "package", "dist", "index.js"), "half written");
    expect(await readStore(root)).toEqual([]);
    expect(await rebuildStoreIndex(root)).toEqual([]);

    await importPrefix(root, await prefix(path.join(dir, "b")), "push");
    expect(await exists(path.join(entry.dir, ".stored"))).toBe(true);
    expect(await fs.readFile(path.join(entry.dir, "package", "dist", "index.js"), "utf8")).toBe(
      "export default {};",
    );
  });

  it("rebuilds index.json from the tree, in the index's shape with integrity", async () => {
    await importPrefix(root, await prefix(path.join(dir, "a")), "builtin");
    await importPrefix(root, await prefix(path.join(dir, "b"), { version: "0.9.0" }), "push");
    const written = await rebuildStoreIndex(root);
    const file = JSON.parse(
      await fs.readFile(path.join(pluginStoreDir(root), "index.json"), "utf8"),
    );
    expect(file).toEqual(written);
    // The same validator a remote index goes through accepts it.
    expect(parsePluginIndex(file, "store").map((e) => e.version)).toEqual(["0.9.0", "1.0.0"]);
    expect(file.every((e: { integrity: string }) => /^sha256-/.test(e.integrity))).toBe(true);
  });

  it("a registry fetch stages under .staging/<pid>/, keeps npm's lock, and removes the staging directory", async () => {
    let cwdSeen = "";
    const install = async (specifier: string, cwd: string) => {
      cwdSeen = cwd;
      expect(specifier).toBe("@acme/sandbox-x@^1");
      await prefix(cwd); // what npm would have put there (it rewrites package.json too)
      await fs.writeFile(path.join(cwd, "package-lock.json"), '{"lockfileVersion":3,"npm":true}\n');
    };
    const entry = await fetchIntoStore(root, "@acme/sandbox-x@^1", { install });
    expect(path.dirname(path.dirname(cwdSeen))).toBe(path.join(pluginStoreDir(root), ".staging"));
    expect(path.basename(path.dirname(cwdSeen))).toBe(String(process.pid));
    expect(await exists(cwdSeen)).toBe(false);
    expect(await fs.readFile(path.join(entry.dir, "package-lock.json"), "utf8")).toContain(
      '"npm":true',
    );
    const stamp = parseToml(await fs.readFile(path.join(entry.dir, ".stored"), "utf8"));
    expect(stamp.source).toBe("registry");
    // The index was rebuilt with it.
    const index = JSON.parse(
      await fs.readFile(path.join(pluginStoreDir(root), "index.json"), "utf8"),
    );
    expect(index.map((e: { integrity: string }) => e.integrity)).toEqual([entry.integrity]);
    // And the same content fetched against its index integrity is accepted.
    await expect(
      fetchIntoStore(root, "@acme/sandbox-x@^1", { install, expected: entry.integrity }),
    ).resolves.toMatchObject({ integrity: entry.integrity });
  });

  it("a fetched package whose integrity is not the index's is refused, and nothing is stored", async () => {
    const install = async (_: string, cwd: string) => {
      await prefix(cwd);
    };
    const expected = `sha256-${"0".repeat(64)}`;
    const err = await fetchIntoStore(root, "@acme/sandbox-x", { install, expected }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PluginIntegrityMismatch);
    expect((err as Error).message).toContain(expected);
    expect((err as PluginIntegrityMismatch).actual).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(await readStore(root)).toEqual([]);
    expect(await exists(path.join(pluginStoreDir(root), "@acme"))).toBe(false);
    expect(await fs.readdir(path.join(pluginStoreDir(root), ".staging"))).toEqual([]);
  });

  it("syncs a boot's prefixes once each, again when an entry they yielded is gone, and logs a failure instead of throwing", async () => {
    const good = await prefix(path.join(dir, "a"));
    const broken = path.join(dir, "broken");
    await write(broken, {
      "package.json": JSON.stringify({ dependencies: { "@acme/gone": "1.0.0" } }),
    });
    const logged: string[] = [];
    await syncPluginStore(
      root,
      [
        { dir: good, source: "builtin" },
        { dir: broken, source: "push" },
        { dir: path.join(dir, "absent"), source: "push" },
      ],
      (m) => logged.push(m),
    );
    expect(logged).toEqual([expect.stringContaining("push @acme/gone")]);
    const [row] = await readStore(root);
    expect(
      JSON.parse(await fs.readFile(path.join(pluginStoreDir(root), "index.json"), "utf8")),
    ).toEqual([row]);
    // Already imported by this process: a second boot of the same prefix does not copy it again.
    const entry = storeEntryDir(root, row!.name, row!.version, row!.integrity);
    const marker = path.join(entry, ".stored");
    const written = (await fs.stat(marker)).mtimeMs;
    await syncPluginStore(root, [{ dir: good, source: "builtin" }], (m) => logged.push(m));
    expect((await fs.stat(marker)).mtimeMs).toBe(written);
    // Unless an entry it yielded is gone (the sweep took it): then it is stored again.
    await fs.rm(entry, { recursive: true });
    await syncPluginStore(root, [{ dir: good, source: "builtin" }], (m) => logged.push(m));
    expect(await exists(marker)).toBe(true);
    expect(logged).toHaveLength(1);
  });

  it("names the push's unpacked prefix and the installation's as a boot's sources", () => {
    const sources = storeSources(null, path.join(dir, "install", "dist", "main.js"));
    expect(sources).toEqual([{ dir: path.join(dir, "install", "plugins"), source: "builtin" }]);
  });
});
