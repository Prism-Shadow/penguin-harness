/**
 * The plugin store (src/plugin/store.ts): one content-addressed entry per packed plugin under
 * `<root>/plugin-store/<name>/<version>/<hash16>/`, complete only once `.stored` is written.
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
  readStore,
  storePackage,
} from "../src/plugin/store.js";
import { archiveIntegrity, packageIntegrity } from "../../../scripts/plugin-entry.mjs";

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
      path.join(pluginStoreDir(root), "@acme", "sandbox-x", "1.0.0", entry.integrity.slice(7, 23)),
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
