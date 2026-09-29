/**
 * The plugin store: one place under the data root where every packed plugin a machine has
 * received is kept, keyed by its content.
 *
 * `<root>/plugin-store/` has the shape of the `plugins/` subtree of the index repository
 * (penguin-plugins): one entry per `<npm name>/<version>/<first 16 hex digits of integrity>/`,
 * holding
 *
 *   manifest.toml      the index manifest (the repository's fields, `integrity` required)
 *   package-lock.json  the lock of the package's nested dependencies
 *   package/           the unpacked package, its dependencies inside its own `node_modules`
 *   .stored            when, from where — and that the entry is complete; written LAST
 *
 * An entry without `.stored` does not exist: it is a write that did not finish, and the next
 * write of the same content replaces it.
 *
 * THE KEY IS THE CONTENT. `integrity` is `sha256-<hex>` over `package/` packed by the same
 * deterministic archiver the hot push packs with (scripts/asset-archives.mjs): sorted entries,
 * the epoch as every mtime, no owners, 0755 for what executes and 0644 otherwise. It is the hash
 * of the tar stream, before gzip — the bytes gzip produces depend on the zlib that ran it, and
 * this hash is computed by every machine that stores a package. Two versions of one name, or
 * two contents of one version, are two entries; one content is stored once.
 *
 * THREE SOURCES, ONE WAY IN. Everything reaches the store through `storePackage`:
 *
 *   - push      the builtin plugins a hot push carried (its `archives/plugins.*.tgz`, unpacked
 *               by the platform); the push's own prefix manifest stays with the push as that
 *               build's activation list and is not an entry;
 *   - builtin   the prefix the installation ships beside the program, checked entry by entry
 *               at every boot and copied when missing — idempotent;
 *   - registry  a package fetched by npm into `.staging/<pid>/`, packed, hashed, compared with
 *               the integrity its index entry names, stored, and the staging directory removed.
 *
 * The store is not a lookup location. Nothing resolves or imports a module from it; which
 * plugins a process loads, and from where, is unchanged by it. Its own `index.json` is rebuilt
 * from the tree after every write, in the index repository's shape — the machine's local
 * source for the plugin catalogue.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import * as tar from "tar";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import { PACKAGE_NAME } from "./loader.js";
import { npmCommand, npmReason, PluginInstallError } from "./install.js";

const execFileAsync = promisify(execFile);

/** `<root>/plugin-store`, relative to the data root. */
export const PLUGIN_STORE_DIR = "plugin-store";
/** Where work in progress lives, one directory per process: `.staging/<pid>/`. */
export const STAGING_DIR = ".staging";
/** The completion marker, written last. */
export const STORED_FILE = ".stored";
export const MANIFEST_FILE = "manifest.toml";
export const LOCK_FILE = "package-lock.json";
export const PACKAGE_DIR = "package";
export const INDEX_FILE = "index.json";

/** Where a package came from — recorded in `.stored`, never part of the key. */
export type StoreSource = "push" | "builtin" | "registry";

/** One complete entry of the store. */
export interface StoredEntry {
  name: string;
  version: string;
  /** `sha256-<64 hex digits>`. */
  integrity: string;
  /** The entry's directory. */
  dir: string;
}

/** One row of the store's `index.json`: the index repository's entry, plus `integrity`. */
export interface StoreIndexEntry {
  name: string;
  version: string;
  description: string;
  authors: string[];
  license: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
  categories?: string[];
  integrity: string;
}

export class PluginStoreError extends Error {}

/** The package's hash is not the one its index entry names: nothing was stored. */
export class PluginIntegrityMismatch extends PluginStoreError {
  constructor(
    readonly name: string,
    readonly version: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`${name}@${version}: the package's integrity is ${actual}, the index names ${expected}`);
  }
}

export function pluginStoreDir(root: string): string {
  return path.join(root, PLUGIN_STORE_DIR);
}

const INTEGRITY = /^sha256-([0-9a-f]{64})$/;

/** An entry's directory: `<store>/<name>/<version>/<first 16 hex digits>`. */
export function storeEntryDir(
  root: string,
  name: string,
  version: string,
  integrity: string,
): string {
  const hex = INTEGRITY.exec(integrity)?.[1];
  if (hex === undefined) throw new PluginStoreError(`'${integrity}' is not a sha256 integrity`);
  return path.join(pluginStoreDir(root), ...name.split("/"), version, hex.slice(0, 16));
}

/** Files under `dir`, sorted relative posix paths; symlinks (`.bin` shims) are not files. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The deterministic tar of `rels` under `cwd`, into `file` — the archiver the hot push packs
 * with (scripts/asset-archives.mjs `packArchive`), without its gzip: sorted entries, no
 * directory entries, epoch mtimes, no owners. The modes are the files' own, which is why a
 * package is copied into the store with them normalized (see `copyNormalized`) before it is
 * packed.
 */
export async function packTar(cwd: string, rels: readonly string[], file: string): Promise<void> {
  await tar.c(
    { file, cwd, portable: true, mtime: new Date(0), noDirRecurse: true },
    [...rels].sort(byCodeUnit),
  );
}

/** The integrity of the `package/` directory under `entry`: sha256 of its deterministic tar. */
export async function packageIntegrity(entry: string, scratch: string): Promise<string> {
  const rels = (await walk(path.join(entry, PACKAGE_DIR))).map((r) => `${PACKAGE_DIR}/${r}`);
  if (rels.length === 0) throw new PluginStoreError(`${entry}: the package has no files`);
  await packTar(entry, rels, scratch);
  try {
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(scratch)) hash.update(chunk as Buffer);
    return `sha256-${hash.digest("hex")}`;
  } finally {
    await fsp.rm(scratch, { force: true });
  }
}

/** Copies `from`'s files to `to`, each 0755 when anything may execute it and 0644 otherwise. */
async function copyNormalized(from: string, to: string): Promise<void> {
  for (const rel of await walk(from)) {
    const src = path.join(from, ...rel.split("/"));
    const dest = path.join(to, ...rel.split("/"));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    const exec = ((await fsp.stat(src)).mode & 0o111) !== 0;
    await fsp.chmod(dest, exec ? 0o755 : 0o644);
  }
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  contributors?: unknown;
  license?: unknown;
  repository?: unknown;
  homepage?: unknown;
  keywords?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

const names = (table: unknown): string[] =>
  table !== null && typeof table === "object" ? Object.keys(table) : [];

/**
 * The dependencies of the package at `pkgDir` that live OUTSIDE it, in the prefix `prefixDir`
 * it was installed into: what npm hoisted to `<prefix>/node_modules/<dep>`, found the way Node
 * finds a package (`node_modules` upward, stopping at the prefix), for its dependencies and
 * optional dependencies, transitively. A dependency nested inside the package already travels
 * with it; an optional one npm did not install (another platform's binary) is skipped.
 */
async function hoistedDependencies(
  pkgDir: string,
  prefixDir: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const top = path.resolve(prefixDir);
  const inside = (dir: string) => dir === pkgDir || dir.startsWith(pkgDir + path.sep);
  const visit = async (from: string) => {
    const manifest = await readPackageJson(from);
    if (manifest === null) return;
    for (const dep of [...names(manifest.dependencies), ...names(manifest.optionalDependencies)]) {
      let found: string | null = null;
      for (let dir = from; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, "node_modules", ...dep.split("/"));
        if (fs.existsSync(path.join(candidate, "package.json"))) {
          found = candidate;
          break;
        }
        if (dir === top || path.dirname(dir) === dir) break;
      }
      if (found === null || inside(found) || out.has(dep)) continue;
      out.set(dep, found);
      await visit(found);
    }
  };
  await visit(pkgDir);
  return out;
}

/** An `npm install --install-strategy=nested` lock of the package under `stage/package`. */
async function lockOf(stage: string, name: string, version: string): Promise<string> {
  const packages: Record<string, unknown> = {
    "": { name: "plugin-store-entry", version: "0.0.0", dependencies: { [name]: version } },
  };
  const pkgRoot = path.join(stage, PACKAGE_DIR);
  for (const rel of await walk(pkgRoot)) {
    if (rel !== "package.json" && !rel.endsWith("/package.json")) continue;
    const dir = path.posix.dirname(rel);
    // Only a package's own manifest: `node_modules/<name>/package.json`, not a fixture inside it.
    const parent = path.posix.dirname(dir);
    const isPackage =
      dir === "." ||
      path.posix.basename(parent) === "node_modules" ||
      (path.posix.basename(parent).startsWith("@") &&
        path.posix.basename(path.posix.dirname(parent)) === "node_modules");
    if (!isPackage) continue;
    const manifest = await readPackageJson(path.join(pkgRoot, dir));
    if (manifest === null) continue;
    const key = dir === "." ? `node_modules/${name}` : `node_modules/${name}/${dir}`;
    const row: Record<string, unknown> = {
      version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
    };
    if (typeof manifest.license === "string") row.license = manifest.license;
    for (const field of ["dependencies", "optionalDependencies"] as const) {
      if (names(manifest[field]).length > 0) row[field] = manifest[field];
    }
    packages[key] = row;
  }
  const sorted = Object.fromEntries(Object.entries(packages).sort(([a], [b]) => byCodeUnit(a, b)));
  return `${JSON.stringify(
    {
      name: "plugin-store-entry",
      version: "0.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: sorted,
    },
    null,
    2,
  )}\n`;
}

/** An author as the index repository writes one: a display name, optionally `<contact>`. */
function authorOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value.trim();
  if (value === null || typeof value !== "object") return null;
  const a = value as { name?: unknown; email?: unknown; url?: unknown };
  if (typeof a.name !== "string" || a.name.trim() === "") return null;
  const contact = typeof a.email === "string" ? a.email : typeof a.url === "string" ? a.url : null;
  return contact === null ? a.name.trim() : `${a.name.trim()} <${contact}>`;
}

/** The index manifest of a package, from its own package.json, with `integrity`. */
function manifestOf(
  pkg: PackageJson,
  name: string,
  version: string,
  integrity: string,
): StoreIndexEntry {
  const authors = [pkg.author, ...(Array.isArray(pkg.contributors) ? pkg.contributors : [])]
    .map(authorOf)
    .filter((a): a is string => a !== null);
  const repository =
    typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository !== null &&
          typeof pkg.repository === "object" &&
          typeof (pkg.repository as { url?: unknown }).url === "string"
        ? (pkg.repository as { url: string }).url.replace(/^git\+/, "")
        : undefined;
  const keywords = Array.isArray(pkg.keywords)
    ? pkg.keywords.filter((k): k is string => typeof k === "string")
    : [];
  return {
    name,
    version,
    description: typeof pkg.description === "string" ? pkg.description : "",
    authors,
    license: typeof pkg.license === "string" ? pkg.license : "",
    ...(repository !== undefined ? { repository } : {}),
    ...(typeof pkg.homepage === "string" ? { homepage: pkg.homepage } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    integrity,
  };
}

/** Is `dir` a complete entry? */
function isStored(dir: string): boolean {
  return fs.existsSync(path.join(dir, STORED_FILE));
}

let stagingSeq = 0;
/** A fresh directory under `.staging/<pid>/`. */
async function stagingDir(root: string, label: string): Promise<string> {
  stagingSeq += 1;
  const dir = path.join(
    pluginStoreDir(root),
    STAGING_DIR,
    String(process.pid),
    `${label}-${stagingSeq}`,
  );
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** Removes `.staging/<pid>/` once nothing of this process is left in it. */
async function tidyStaging(root: string): Promise<void> {
  const mine = path.join(pluginStoreDir(root), STAGING_DIR, String(process.pid));
  try {
    await fsp.rmdir(mine);
  } catch {
    // Not empty (another write of this process is in flight) or already gone.
  }
}

/**
 * Stores the package at `pkgDir` — installed into the npm prefix `prefixDir`, whose hoisted
 * dependencies of it are copied into its own `node_modules` — and answers the entry. When
 * `expected` is given the package's integrity must equal it, or nothing is stored. A content
 * already stored is not written again.
 */
export async function storePackage(
  root: string,
  pkgDir: string,
  prefixDir: string,
  source: StoreSource,
  { expected, lock }: { expected?: string; lock?: string } = {},
): Promise<StoredEntry> {
  const pkg = await readPackageJson(pkgDir);
  const name = typeof pkg?.name === "string" ? pkg.name : null;
  const version = typeof pkg?.version === "string" ? pkg.version : null;
  if (pkg === null || name === null || version === null || !PACKAGE_NAME.test(name)) {
    throw new PluginStoreError(`${pkgDir}: no package.json with a package name and a version`);
  }
  if (version.includes("/") || version.includes("\\") || version.startsWith(".")) {
    throw new PluginStoreError(`${name}: '${version}' cannot name a directory`);
  }
  const stage = await stagingDir(root, "entry");
  try {
    await copyNormalized(pkgDir, path.join(stage, PACKAGE_DIR));
    for (const [dep, dir] of await hoistedDependencies(path.resolve(pkgDir), prefixDir)) {
      await copyNormalized(dir, path.join(stage, PACKAGE_DIR, "node_modules", ...dep.split("/")));
    }
    const integrity = await packageIntegrity(stage, `${stage}.tar`);
    if (expected !== undefined && expected !== integrity) {
      throw new PluginIntegrityMismatch(name, version, expected, integrity);
    }
    const dest = storeEntryDir(root, name, version, integrity);
    const entry: StoredEntry = { name, version, integrity, dir: dest };
    if (isStored(dest)) return entry;
    await fsp.writeFile(
      path.join(stage, MANIFEST_FILE),
      stringifyToml(
        manifestOf(pkg, name, version, integrity) as unknown as Record<string, unknown>,
      ),
    );
    await fsp.writeFile(path.join(stage, LOCK_FILE), lock ?? (await lockOf(stage, name, version)));
    // A directory without the marker is a write that did not finish: replaced, not trusted.
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(stage, dest);
    await fsp.writeFile(
      path.join(dest, STORED_FILE),
      stringifyToml({ storedAt: new Date().toISOString(), source }),
    );
    return entry;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
    await tidyStaging(root);
  }
}

/**
 * Stores every package an npm prefix SHIPS — the ones its own package.json names, not what npm
 * installed beside them — and answers what was stored and what could not be, by name.
 */
export async function importPrefix(
  root: string,
  prefixDir: string,
  source: StoreSource,
): Promise<{ stored: StoredEntry[]; failed: Map<string, string> }> {
  const stored: StoredEntry[] = [];
  const failed = new Map<string, string>();
  const manifest = await readPackageJson(prefixDir);
  for (const name of names(manifest?.dependencies)) {
    try {
      const pkgDir = path.join(prefixDir, "node_modules", ...name.split("/"));
      stored.push(await storePackage(root, pkgDir, prefixDir, source));
    } catch (err) {
      failed.set(name, err instanceof Error ? err.message : String(err));
    }
  }
  return { stored, failed };
}

/** How a registry fetch installs `specifier` into the npm prefix `cwd`; injectable for tests. */
export type RegistryInstall = (specifier: string, cwd: string) => Promise<void>;

/** Long enough for a cold registry fetch with dependencies; short enough not to hang a request. */
const FETCH_TIMEOUT_MS = 180_000;

/**
 * npm, into a staging prefix, each package's dependencies nested inside it — so the package's
 * directory is the whole of what it runs, the shape an entry's `package/` has.
 */
const npmInstall: RegistryInstall = async (specifier, cwd) => {
  try {
    await execFileAsync(
      npmCommand(),
      [
        "install",
        "--install-strategy=nested",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--",
        specifier,
      ],
      { cwd, timeout: FETCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: process.env },
    );
  } catch (err) {
    throw new PluginInstallError(npmReason((err as { stderr?: string }).stderr, err as Error));
  }
};

/** The bare or scoped name of a specifier, without its version range. */
function nameOf(specifier: string): string {
  const at = specifier.lastIndexOf("@");
  return at > 0 ? specifier.slice(0, at) : specifier;
}

/**
 * Fetches `specifier` from the registry into the store: npm installs it into
 * `.staging/<pid>/`, the package is packed and hashed, compared with `expected` (the integrity
 * its index entry names) when there is one, and stored; the staging directory is removed
 * whatever happened. npm's own lock of the install is the entry's lock.
 */
export async function fetchIntoStore(
  root: string,
  specifier: string,
  { expected, install = npmInstall }: { expected?: string; install?: RegistryInstall } = {},
): Promise<StoredEntry> {
  const prefix = await stagingDir(root, "fetch");
  try {
    // A prefix of its own, or npm walks up and installs into whatever package.json is above.
    await fsp.writeFile(
      path.join(prefix, "package.json"),
      `${JSON.stringify({ name: "plugin-store-entry", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    await install(specifier, prefix);
    const pkgDir = path.join(prefix, "node_modules", ...nameOf(specifier).split("/"));
    let lock: string | undefined;
    try {
      lock = await fsp.readFile(path.join(prefix, LOCK_FILE), "utf8");
    } catch {
      lock = undefined;
    }
    const entry = await storePackage(root, pkgDir, prefix, "registry", { expected, lock });
    await rebuildStoreIndex(root);
    return entry;
  } finally {
    await fsp.rm(prefix, { recursive: true, force: true });
    await tidyStaging(root);
  }
}

/** Every complete entry in the store, by name, version and integrity. */
export async function readStore(root: string): Promise<StoreIndexEntry[]> {
  const store = pluginStoreDir(root);
  const out: StoreIndexEntry[] = [];
  const dirs = async (dir: string) => {
    try {
      return (await fsp.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  // `<name>` is one directory, or two for a scoped one (`@scope/name`).
  const packageNames: string[] = [];
  for (const top of await dirs(store)) {
    if (top.startsWith("@")) {
      for (const sub of await dirs(path.join(store, top))) packageNames.push(`${top}/${sub}`);
    } else packageNames.push(top);
  }
  for (const name of packageNames) {
    const nameDir = path.join(store, ...name.split("/"));
    for (const version of await dirs(nameDir)) {
      for (const key of await dirs(path.join(nameDir, version))) {
        const dir = path.join(nameDir, version, key);
        if (!isStored(dir)) continue;
        let manifest: Record<string, unknown>;
        try {
          manifest = parseToml(await fsp.readFile(path.join(dir, MANIFEST_FILE), "utf8"));
        } catch {
          continue;
        }
        // The path spells the entry: a manifest that disagrees with where it sits is skipped.
        const integrity = manifest.integrity;
        if (
          manifest.name !== name ||
          manifest.version !== version ||
          typeof integrity !== "string" ||
          INTEGRITY.exec(integrity)?.[1]?.slice(0, 16) !== key
        ) {
          continue;
        }
        out.push(manifest as unknown as StoreIndexEntry);
      }
    }
  }
  return out.sort(
    (a, b) =>
      byCodeUnit(a.name, b.name) ||
      byCodeUnit(a.version, b.version) ||
      byCodeUnit(a.integrity, b.integrity),
  );
}

/**
 * Rebuilds `<store>/index.json` from the tree — a flat array of index entries, the shape of the
 * index repository's and of the builtin index — written beside and renamed in.
 */
export async function rebuildStoreIndex(root: string): Promise<StoreIndexEntry[]> {
  const entries = await readStore(root);
  const file = path.join(pluginStoreDir(root), INDEX_FILE);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`);
  await fsp.rename(tmp, file);
  return entries;
}

/** The prefixes a process imports at boot: what the push carried, what the installation ships. */
export function storeSources(
  assetsDir: string | null,
  entry: string | undefined = process.argv[1],
): Array<{ dir: string; source: StoreSource }> {
  const out: Array<{ dir: string; source: StoreSource }> = [];
  if (assetsDir !== null) {
    out.push({ dir: path.join(unpackedAssetsDir(assetsDir), "plugins"), source: "push" });
  }
  if (typeof entry === "string" && entry.length > 0) {
    out.push({ dir: path.join(path.dirname(entry), "..", "plugins"), source: "builtin" });
  }
  return out;
}

/** Prefixes this process already imported: a push's assets never change, nor does the installation. */
const imported = new Set<string>();
let chain: Promise<unknown> = Promise.resolve();

/**
 * Brings the store up to date with the prefixes of this boot (`storeSources`), each once per
 * process, then rebuilds its index. Serialized within the process, best effort: a failure is
 * logged and never fails the boot — the store is not where anything loads from.
 */
export function syncPluginStore(
  root: string,
  sources: ReadonlyArray<{ dir: string; source: StoreSource }>,
  log: (message: string) => void = (m) => console.warn(m),
): Promise<void> {
  const run = async () => {
    let wrote = false;
    for (const { dir, source } of sources) {
      const key = `${root}\0${path.resolve(dir)}`;
      if (imported.has(key) || !fs.existsSync(path.join(dir, "package.json"))) continue;
      const { stored, failed } = await importPrefix(root, dir, source);
      imported.add(key);
      wrote ||= stored.length > 0;
      for (const [name, why] of failed) log(`[plugin-store] ${source} ${name}: ${why}`);
    }
    if (wrote) await rebuildStoreIndex(root);
  };
  const next = chain.then(run).catch((err: unknown) => {
    log(`[plugin-store] ${err instanceof Error ? err.message : String(err)}`);
  });
  chain = next;
  return next;
}
