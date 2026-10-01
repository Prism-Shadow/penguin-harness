/**
 * The plugin store: one place under the data root where every packed plugin a machine has
 * received is kept, keyed by its content.
 *
 * `<root>/plugin-store/` has the shape of the tree the build lays out (scripts/build-plugins.mjs)
 * and of the index repository's (penguin-plugins), one path rule for all three
 * (scripts/plugin-entry.mjs): beside `.staging/` there is only `packages/`, and one entry per
 * `packages/[<@scope>/]<bucket>/<name>/<version>/<first 16 hex digits of integrity>/`, holding
 *
 *   manifest.toml      the index manifest (the repository's fields, `integrity` required)
 *   package/           the unpacked package, its dependencies inside its own `node_modules`
 *   .stored            the completion marker, written LAST; its mtime is when it was stored
 *
 * An entry without `.stored` does not exist: it is a write that did not finish, and the next
 * write of the same content replaces it. Nothing outside `packages/` is read: a directory an
 * earlier layout left at the top is neither an entry nor linked.
 *
 * THE KEY IS THE CONTENT. `integrity` is `sha256-<hex>` over `package/` archived by the
 * deterministic ustar archiver of scripts/plugin-entry.mjs — the index repository's algorithm,
 * so the integrity an index entry names is the one this store computes over the package it
 * fetched. Two versions of one name, or two contents of one version, are two entries; one
 * content is stored once.
 *
 * TWO WAYS IN, both through `storePackage`:
 *
 *   - shipped   the plugins the running build carries (a hot push's `plugins/` prefix, else
 *               the installation's — `lib/plugins` of the CLI package and the Docker image,
 *               `plugins/` of the desktop app), each listed with its integrity in the prefix's
 *               `index.json` the build wrote; an entry already stored is not copied again
 *               (`syncPluginStore`);
 *   - registry  a package fetched by npm into `.staging/`, packed, hashed, compared with the
 *               integrity its index entry names, and stored (`fetchIntoStore`).
 *
 * Every write and the sweep take turns on one queue (`onStoreQueue`): a fetch never lands an
 * entry in a directory the sweep is emptying. What the sweep keeps and removes is plugin/gc.ts.
 *
 * The store is not a lookup location. Nothing resolves a module from it by name: the process
 * loads from the current generation under `<root>/plugins/`, whose `node_modules/<name>` links
 * to an entry's `package/` (plugin/activation.ts).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import { PACKAGE_NAME } from "./loader.js";
import { npmInvocation, npmReason, PluginInstallError } from "./install.js";
import {
  entryDir,
  entryKey,
  INDEX_FILE,
  layOutEntry,
  MANIFEST_FILE,
  PACKAGE_DIR,
  readPackageJson,
  sortIndex,
  treeNames,
} from "../../../../scripts/plugin-entry.mjs";
import type { EntryManifest } from "../../../../scripts/plugin-entry.mjs";

export { PACKAGE_DIR };

const execFileAsync = promisify(execFile);

/** `<root>/plugin-store`, relative to the data root. */
export const PLUGIN_STORE_DIR = "plugin-store";
/** Where work in progress lives: one fresh directory per write. */
export const STAGING_DIR = ".staging";
/** The completion marker, written last. */
export const STORED_FILE = ".stored";

/** One complete entry of the store. */
export interface StoredEntry {
  name: string;
  version: string;
  /** `sha256-<64 hex digits>`. */
  integrity: string;
  /** The entry's directory. */
  dir: string;
}

/** One entry as an index lists it: the index repository's manifest, `integrity` included. */
export type StoreIndexEntry = EntryManifest;

export class PluginStoreError extends Error {}

/** The package's hash is not the one its index entry names: nothing was stored. */
export class PluginIntegrityMismatch extends PluginStoreError {
  constructor(
    readonly name: string,
    readonly version: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `${name}@${version}: the fetched package's integrity is ${actual}, the index names ${expected}; nothing was stored`,
    );
  }
}

export function pluginStoreDir(root: string): string {
  return path.join(root, PLUGIN_STORE_DIR);
}

/** An entry's directory: `<store>/packages/…/<name>/<version>/<first 16 hex digits>`. */
export function storeEntryDir(
  root: string,
  name: string,
  version: string,
  integrity: string,
): string {
  if (entryKey(integrity) === null) {
    throw new PluginStoreError(`'${integrity}' is not a sha256 integrity`);
  }
  return entryDir(pluginStoreDir(root), name, version, integrity);
}

/** Is `dir` a complete entry? */
export function isStored(dir: string): boolean {
  return fs.existsSync(path.join(dir, STORED_FILE));
}

/** A fresh directory under `.staging/`; the caller removes it. */
async function stagingDir(root: string): Promise<string> {
  const staging = path.join(pluginStoreDir(root), STAGING_DIR);
  await fsp.mkdir(staging, { recursive: true });
  return fsp.mkdtemp(path.join(staging, "w-"));
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
  expected?: string,
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
  const stage = await stagingDir(root);
  try {
    const laid = await layOutEntry(stage, pkgDir, prefixDir, {
      stringifyToml: (value) => stringifyToml(value),
      check: ({ integrity }) => {
        if (expected !== undefined && expected !== integrity) {
          throw new PluginIntegrityMismatch(name, version, expected, integrity);
        }
      },
    });
    const dest = storeEntryDir(root, name, version, laid.integrity);
    const entry: StoredEntry = { name, version, integrity: laid.integrity, dir: dest };
    if (isStored(dest)) return entry;
    // A directory without the marker is a write that did not finish: replaced, not trusted.
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(stage, dest);
    await fsp.writeFile(path.join(dest, STORED_FILE), "");
    return entry;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
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
    const npm = npmInvocation([
      "install",
      "--install-strategy=nested",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--",
      specifier,
    ]);
    await execFileAsync(npm.command, npm.args, {
      cwd,
      timeout: FETCH_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: npm.env,
      shell: npm.shell,
    });
  } catch (err) {
    if (err instanceof PluginInstallError) throw err;
    throw new PluginInstallError(npmReason((err as { stderr?: string }).stderr, err as Error));
  }
};

/** The bare or scoped name of a specifier, without its version range. */
function nameOf(specifier: string): string {
  const at = specifier.lastIndexOf("@");
  return at > 0 ? specifier.slice(0, at) : specifier;
}

/**
 * Fetches `specifier` from the registry into the store: npm installs it into a staging prefix,
 * the package is packed and hashed, compared with `expected` (the integrity its index entry
 * names) when there is one, and stored; the staging directory is removed whatever happened.
 */
export function fetchIntoStore(
  root: string,
  specifier: string,
  { expected, install = npmInstall }: { expected?: string; install?: RegistryInstall } = {},
): Promise<StoredEntry> {
  return onStoreQueue(async () => {
    const prefix = await stagingDir(root);
    try {
      // A prefix of its own, or npm walks up and installs into whatever package.json is above.
      await fsp.writeFile(
        path.join(prefix, "package.json"),
        `${JSON.stringify({ name: "plugin-store-entry", private: true, version: "0.0.0" }, null, 2)}\n`,
      );
      await install(specifier, prefix);
      const pkgDir = path.join(prefix, "node_modules", ...nameOf(specifier).split("/"));
      return await storePackage(root, pkgDir, prefix, expected);
    } finally {
      await fsp.rm(prefix, { recursive: true, force: true });
    }
  });
}

/** The directories of `dir` whose names do not start with a dot; empty when it cannot be read. */
async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every entry directory of the store, complete or not, with the name, version and key it sits under. */
export async function storeEntryDirs(
  root: string,
): Promise<Array<{ name: string; version: string; key: string; dir: string }>> {
  const out: Array<{ name: string; version: string; key: string; dir: string }> = [];
  for (const { name, dir: nameDir } of await treeNames(pluginStoreDir(root))) {
    for (const version of await subdirs(nameDir)) {
      for (const key of await subdirs(path.join(nameDir, version))) {
        out.push({ name, version, key, dir: path.join(nameDir, version, key) });
      }
    }
  }
  return out;
}

/** Every complete entry in the store, as its manifest. */
export async function readStore(root: string): Promise<StoreIndexEntry[]> {
  const out: StoreIndexEntry[] = [];
  for (const { name, version, key, dir } of await storeEntryDirs(root)) {
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
      entryKey(integrity) !== key
    ) {
      continue;
    }
    out.push(manifest as unknown as StoreIndexEntry);
  }
  return sortIndex(out);
}

/**
 * The program's entry file with its links resolved: the Docker image starts the CLI through
 * `/usr/local/bin/penguin`, a link to `/opt/penguin/lib/dist/penguin.js`, and npm's global
 * `bin/penguin` links into the package the same way — the installation is where the target
 * sits, not where the link does. Unresolvable (gone, or not a file): the path as given.
 */
export function programEntry(entry: string | undefined = process.argv[1]): string | undefined {
  if (typeof entry !== "string" || entry.length === 0) return undefined;
  try {
    return fs.realpathSync(entry);
  } catch {
    return entry;
  }
}

/**
 * The prefixes a build may carry, the running one first: the push's, then the installation's —
 * one directory above the directory of the program's real entry file.
 */
export function storeSources(
  assetsDir: string | null,
  entry: string | undefined = process.argv[1],
): string[] {
  const out: string[] = [];
  if (assetsDir !== null) out.push(path.join(unpackedAssetsDir(assetsDir), "plugins"));
  const program = programEntry(entry);
  if (program !== undefined) out.push(path.join(path.dirname(program), "..", "plugins"));
  return out;
}

/**
 * The plugins the running build carries: the prefix of the first of `storeSources` that has an
 * `index.json` (scripts/build-plugins.mjs writes it), with its rows. Null when none does — a
 * server run from source ships no prefix. The rows are as written; the registry validates them.
 */
export async function readShippedIndex(
  assetsDir: string | null,
): Promise<{ prefix: string; entries: unknown[] } | null> {
  for (const prefix of storeSources(assetsDir)) {
    let text: string;
    try {
      text = await fsp.readFile(path.join(prefix, INDEX_FILE), "utf8");
    } catch {
      continue;
    }
    const entries = JSON.parse(text) as unknown;
    if (!Array.isArray(entries))
      throw new PluginStoreError(`${prefix}/${INDEX_FILE}: not an array`);
    return { prefix, entries };
  }
  return null;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` after every store write and sweep queued before it, and before any queued after:
 * the one order the store's writers and its sweep keep within the process. A failure is the
 * caller's; the queue goes on.
 */
export function onStoreQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * What a listed integrity was stored as, when that differs: a filesystem without execute bits
 * (Windows) hashes a package built elsewhere to another content. Per process, so such a
 * package is copied once, not at every activation.
 */
const storedAs = new Map<string, StoredEntry>();

/**
 * Stores every plugin the running build carries that is not stored yet, and answers the
 * integrities its `index.json` lists together with what each was stored as. On the store's
 * queue, best effort: a failure is logged and never fails the boot — a package that did not
 * reach the store is reported by the activation that cannot find it (plugin/activation.ts).
 */
export async function syncPluginStore(
  root: string,
  assetsDir: string | null,
  log: (message: string) => void = (m) => console.warn(m),
): Promise<Set<string>> {
  const shipped = new Set<string>();
  await onStoreQueue(async () => {
    const index = await readShippedIndex(assetsDir);
    for (const row of index?.entries ?? []) {
      const { name, version, integrity } = row as Partial<Record<string, unknown>>;
      if (typeof name !== "string" || typeof version !== "string") continue;
      if (typeof integrity !== "string" || entryKey(integrity) === null) continue;
      shipped.add(integrity);
      if (isStored(storeEntryDir(root, name, version, integrity))) continue;
      const memo = `${root}\0${integrity}`;
      const known = storedAs.get(memo);
      if (known !== undefined && isStored(known.dir)) {
        shipped.add(known.integrity);
        continue;
      }
      try {
        const pkgDir = path.join(index!.prefix, "node_modules", ...name.split("/"));
        const entry = await storePackage(root, pkgDir, index!.prefix);
        storedAs.set(memo, entry);
        shipped.add(entry.integrity);
      } catch (err) {
        log(`[plugin-store] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }).catch((err: unknown) => {
    log(`[plugin-store] ${err instanceof Error ? err.message : String(err)}`);
  });
  return shipped;
}

/** The names the running build ships. */
export async function shippedNames(assetsDir: string | null): Promise<string[]> {
  const index = await readShippedIndex(assetsDir).catch(() => null);
  const names = (index?.entries ?? []).flatMap((row) => {
    const name = (row as { name?: unknown }).name;
    return typeof name === "string" ? [name] : [];
  });
  return [...new Set(names)].sort();
}
