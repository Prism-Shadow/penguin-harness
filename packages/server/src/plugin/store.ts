/**
 * The plugin store: one place under the data root where every packed plugin a machine has
 * received is kept, keyed by its content.
 *
 * `<root>/plugin-store/` has the shape of the `plugins/` subtree of the index repository
 * (penguin-plugins) and of the tree the build lays out (scripts/build-plugins.mjs): one entry
 * per `<npm name>/<version>/<first 16 hex digits of integrity>/`, holding
 *
 *   manifest.toml      the index manifest (the repository's fields, `integrity` required)
 *   package-lock.json  the lock of the package's nested dependencies
 *   package/           the unpacked package, its dependencies inside its own `node_modules`
 *   .stored            when, from where — and that the entry is complete; written LAST
 *
 * An entry without `.stored` does not exist: it is a write that did not finish, and the next
 * write of the same content replaces it.
 *
 * THE KEY IS THE CONTENT. `integrity` is `sha256-<hex>` over `package/` archived by the
 * deterministic ustar archiver of scripts/plugin-entry.mjs — the index repository's algorithm,
 * so the integrity an index entry names is the one this store computes over the package it
 * fetched. Two versions of one name, or two contents of one version, are two entries; one
 * content is stored once. How an entry is laid out is that module's too: the build and the
 * store run one copy.
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
 * Every write and the sweep take turns on one queue (`onStoreQueue`): a fetch never lands an
 * entry in a directory the sweep is emptying, and the sweep never removes a content a write
 * has just found already stored. What the sweep keeps and removes is plugin/gc.ts.
 *
 * The store is not a lookup location. Nothing resolves a module from it by name: the process
 * loads from the current generation under `<root>/plugins/`, whose `node_modules/<name>` links
 * to an entry's `package/` (plugin/activation.ts). Its own `index.json` is rebuilt
 * from the tree after every write, in the index repository's shape — the machine's local
 * source for the plugin catalogue.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import { PACKAGE_NAME } from "./loader.js";
import { npmCommand, npmReason, PluginInstallError } from "./install.js";
import {
  entryDir,
  entryKey,
  INDEX_FILE,
  LOCK_FILE,
  layOutEntry,
  MANIFEST_FILE,
  PACKAGE_DIR,
  readPackageJson,
  sortIndex,
} from "../../../../scripts/plugin-entry.mjs";
import type { EntryManifest } from "../../../../scripts/plugin-entry.mjs";

export { INDEX_FILE, LOCK_FILE, MANIFEST_FILE, PACKAGE_DIR };

const execFileAsync = promisify(execFile);

/** `<root>/plugin-store`, relative to the data root. */
export const PLUGIN_STORE_DIR = "plugin-store";
/** Where work in progress lives, one directory per process: `.staging/<pid>/`. */
export const STAGING_DIR = ".staging";
/** The completion marker, written last. */
export const STORED_FILE = ".stored";

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

/** One row of the store's `index.json`: the index repository's entry, `integrity` included. */
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

/** An entry's directory: `<store>/<name>/<version>/<first 16 hex digits>`. */
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

const names = (table: unknown): string[] =>
  table !== null && typeof table === "object" ? Object.keys(table) : [];

/** Is `dir` a complete entry? */
function isStored(dir: string): boolean {
  return fs.existsSync(path.join(dir, STORED_FILE));
}

let stagingSeq = 0;
/** A fresh directory under `.staging/<pid>/`. */
export async function stagingDir(root: string, label: string): Promise<string> {
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
export async function tidyStaging(root: string): Promise<void> {
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
    const laid = await layOutEntry(stage, pkgDir, prefixDir, {
      stringifyToml: (value) => stringifyToml(value),
      lock,
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
export function fetchIntoStore(
  root: string,
  specifier: string,
  { expected, install = npmInstall }: { expected?: string; install?: RegistryInstall } = {},
): Promise<StoredEntry> {
  return onStoreQueue(() => fetchNow(root, specifier, expected, install));
}

async function fetchNow(
  root: string,
  specifier: string,
  expected: string | undefined,
  install: RegistryInstall,
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
          entryKey(integrity) !== key
        ) {
          continue;
        }
        out.push(manifest as unknown as StoreIndexEntry);
      }
    }
  }
  return sortIndex(out);
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

/**
 * Prefixes this process already imported, with the entries each yielded: a push's assets never
 * change, nor does the installation.
 */
const imported = new Map<string, StoredEntry[]>();
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

const importKey = (root: string, dir: string) => `${root}\0${path.resolve(dir)}`;

/**
 * Brings the store up to date with the prefixes of this boot (`storeSources`), each once per
 * process — and again once the sweep has removed an entry one of them yielded — then rebuilds
 * its index. On the store's queue, best effort: a failure is logged and never fails the boot —
 * a package that did not reach the store is reported by the activation that cannot find it
 * (plugin/activation.ts).
 */
export function syncPluginStore(
  root: string,
  sources: ReadonlyArray<{ dir: string; source: StoreSource }>,
  log: (message: string) => void = (m) => console.warn(m),
): Promise<void> {
  const run = async () => {
    let wrote = false;
    for (const { dir, source } of sources) {
      const key = importKey(root, dir);
      // A shipped package no generation holds is swept like any other entry (plugin/gc.ts);
      // the prefix still ships it, so it is stored again the next time it is asked for.
      const held = imported.get(key);
      if (held !== undefined && held.every((e) => isStored(e.dir))) continue;
      if (!fs.existsSync(path.join(dir, "package.json"))) continue;
      const { stored, failed } = await importPrefix(root, dir, source);
      imported.set(key, stored);
      wrote ||= stored.length > 0;
      for (const [name, why] of failed) log(`[plugin-store] ${source} ${name}: ${why}`);
    }
    if (wrote) await rebuildStoreIndex(root);
  };
  return onStoreQueue(run).catch((err: unknown) => {
    log(`[plugin-store] ${err instanceof Error ? err.message : String(err)}`);
  });
}

/**
 * The entries this boot's sources put in the store — what the running build carries — once
 * `syncPluginStore` has imported them.
 */
export async function shippedEntries(
  root: string,
  sources: ReadonlyArray<{ dir: string; source: StoreSource }>,
): Promise<StoredEntry[]> {
  await syncPluginStore(root, sources);
  return sources.flatMap(({ dir }) => imported.get(importKey(root, dir)) ?? []);
}

/** The names the prefixes of `sources` ship: each prefix's own package.json `dependencies`. */
export async function shippedNames(
  sources: ReadonlyArray<{ dir: string; source: StoreSource }>,
): Promise<string[]> {
  const out = new Set<string>();
  for (const { dir } of sources) {
    for (const name of names((await readPackageJson(dir))?.dependencies)) out.add(name);
  }
  return [...out].sort();
}
