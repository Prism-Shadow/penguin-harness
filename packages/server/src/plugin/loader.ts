/**
 * Plugin loading: WHICH plugins a deployment runs is CONFIGURATION, not capability
 * baked into the platform.
 *
 * The configuration is per PROJECT (the `[plugins]` table in `.project_config.toml`), because machines
 * are lent to Projects and that is what says which machines a plugin has to reach. Loading
 * is per PROCESS, though — there is one module tree — so what a deployment runs is the
 * CLOSURE: the union over its Projects. A plugin any Project asks for is in the tree, and
 * what it contributes is visible to all of them.
 *
 * The closure is read from the FILES, without the database: this runs at boot, before the
 * platform exists, and a Project is a directory holding a `.project_config.toml`.
 *
 * A name resolves in ONE place: the current generation under `<root>/plugins/`, which the
 * closure is resolved to against the plugin store before anything is imported
 * (plugin/activation.ts). Nothing else: a plugin is named by its package, never by a path — a
 * source checkout gets its plugins the way the CLI bundle does, through its bundled plugin
 * directory (scripts/dev-prebuild.mjs).
 *
 * Failure is per-entry and non-fatal: an unresolvable or malformed plugin is reported
 * and skipped, leaving its capability unavailable rather than failing the boot. A
 * plugin is a set of modules (core plugin/index.ts): decorated classes, named by the
 * default export, whose manifests the package's generated `ifaces.json` carries.
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { parse as parseToml } from "smol-toml";
import {
  effectivePluginTable,
  parsePluginTables,
  projectConfigPath,
  type PluginTable,
  type PluginTables,
} from "@prismshadow/penguin-core";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  IfaceTable,
  ManifestTable,
  ModuleClass,
  ModuleDef,
  Resources,
} from "@prismshadow/penguin-core/kernel";
import { moduleDefOf, parseManifest } from "@prismshadow/penguin-core/kernel";
import {
  activatePlugins,
  currentGenerationDir,
  lendHostPackages,
  type Activation,
  type PluginAsk,
} from "./activation.js";
import { shippedNames, storeSources } from "./store.js";
import { sweepPlugins, type PluginPin } from "./gc.js";
import { readManifest } from "../hmr/manifest.js";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { LoadedPlugin } from "./host.js";
import { PluginHost, pluginHostFrom } from "./host.js";
import platformTable from "../ifaces.json" with { type: "json" };
import { checkIfaces, ifaceQuestions } from "./iface-check.js";
import { loadTypeScript, TypeScriptUnavailable, type TypeScript } from "./typescript.js";

/**
 * Where a Project's list lives, for a surface that has to name the file. The data root's
 * old `plugins.json` is NOT read any more: the list moved into Project config, deliberately
 * without a migration (PRFC-0010), so a deployment that had one starts with no plugins
 * until each Project asks again.
 */
export const PLUGINS_FILE = ".project_config.toml";

export type { LoadedPlugin } from "./host.js";

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  /** specifier → why it was skipped. */
  failed: Map<string, string>;
  /** The generation this load activated, or null when activation failed and the current one was kept. */
  activation: Activation | null;
}
/** The Project ids of a data root: every directory holding a `.project_config.toml`. */
export async function listProjectIds(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      await fs.access(projectConfigPath(root, entry.name));
      ids.push(entry.name);
    } catch {
      // Not a Project directory: `hmr`, `store`, whatever else lives beside them.
    }
  }
  return ids.sort();
}

/**
 * What one Project asks `machineId` to run, in the order it wrote them; empty when it asks
 * for none. `machineId` is the machine's own id — this server's, for what it loads itself —
 * and null reads the shared table alone.
 */
export async function readProjectPluginList(
  root: string,
  projectId: string,
  machineId: string | null = null,
): Promise<string[]> {
  return Object.keys(await readProjectPluginTable(root, projectId, machineId));
}

/** What one Project asks `machineId` to run, name → requirement, in the order it wrote them. */
async function readProjectPluginTable(
  root: string,
  projectId: string,
  machineId: string | null,
): Promise<PluginTable> {
  const tables = await readProjectPluginTables(root, projectId);
  return tables === undefined ? {} : effectivePluginTable(tables, machineId);
}

/** One Project's whole `[plugins]` key — the shared table and every machine's — or undefined. */
async function readProjectPluginTables(
  root: string,
  projectId: string,
): Promise<PluginTables | undefined> {
  let text: string;
  try {
    text = await fs.readFile(projectConfigPath(root, projectId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    // A Project whose config cannot be read (permissions, a directory in its place) is a
    // configuration fault, but not this one's to fail the boot over: its models are just as
    // unreadable, and the deployment must still come up for every other Project. The list
    // view reports the fault on that Project (routes/plugins-installed.ts).
    console.warn(
      `[plugins] ${projectId}: .project_config.toml could not be read, its plugins are skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    // The same for one that does not parse.
    console.warn(
      `[plugins] ${projectId}: .project_config.toml is not valid TOML, its plugins are skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
  return parsePluginTables((parsed as { plugins?: unknown }).plugins);
}

/**
 * Every content a Project pins, in any of its tables — the shared one or any machine's: what
 * the sweep keeps in the store whatever this machine runs (plugin/gc.ts).
 */
export async function readPluginPins(root: string): Promise<PluginPin[]> {
  const out: PluginPin[] = [];
  for (const projectId of await listProjectIds(root)) {
    const tables = await readProjectPluginTables(root, projectId);
    if (tables === undefined) continue;
    for (const table of [tables.all, ...Object.values(tables.machines)]) {
      for (const [name, ask] of Object.entries(table)) {
        if (ask.integrity !== undefined) out.push({ name, integrity: ask.integrity });
      }
    }
  }
  return out;
}

/**
 * The roots this process has swept at its first activation, across every copy of this file a
 * push loads — so "once at startup" means once per process, not once per bundle.
 */
const SWEPT = Symbol.for("penguin.plugins.swept");
function sweptRoots(): Set<string> {
  const g = globalThis as { [SWEPT]?: Set<string> };
  return (g[SWEPT] ??= new Set());
}

/**
 * The closure with what each Project asks of every name in it, first-asked order: the input a
 * generation is resolved from (plugin/activation.ts).
 */
export async function readPluginAsks(
  root: string,
  machineId: string | null = null,
): Promise<Map<string, PluginAsk[]>> {
  const out = new Map<string, PluginAsk[]>();
  for (const projectId of await listProjectIds(root)) {
    for (const [name, ask] of Object.entries(
      await readProjectPluginTable(root, projectId, machineId),
    )) {
      out.set(name, [...(out.get(name) ?? []), ask]);
    }
  }
  return out;
}

/**
 * The closure a machine runs: the union over this root's Projects of what each asks THAT
 * machine for, first-asked order. One process, one module tree — so with this server's own
 * id it is what `loadPlugins` loads, whoever asked for it; a plugin every Project lists only
 * for other machines is neither loaded nor installed here.
 */
export async function readPluginClosure(
  root: string,
  machineId: string | null = null,
): Promise<string[]> {
  return [...(await readPluginAsks(root, machineId)).keys()];
}

/**
 * An npm prefix a package name is looked up in (`<dir>/package.json` + `<dir>/node_modules/…`),
 * under its own `node_modules` only.
 *
 * The loader has ONE: the current generation under `<root>/plugins/` (plugin/activation.ts).
 * The bundled plugin directories a hot push and the installation carry are sources of the
 * plugin store, not lookup locations.
 * `builtin` marks a prefix the harness ships; whether a package in a generation is one the build
 * ships is the shipped list's (`shippedPlugins`).
 */
export interface PluginBase {
  file: string;
  builtin: boolean;
}

/** A bare package name, scoped or not — never a subpath, a path, a URL or a version range. */
export const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Why a specifier cannot name a plugin, or null when it is a package name. */
export function specifierFault(specifier: string): string | null {
  if (PACKAGE_NAME.test(specifier)) return null;
  if (path.isAbsolute(specifier)) {
    return `'${specifier}' is a path: a plugin is named by its package, and reaches a machine through its plugin store — build it into the bundled plugin directory of a dev build`;
  }
  return `'${specifier}' is not a package name: a plugin is named by its package, never by a subpath, a URL or a version range`;
}

/** Where a package name is looked up: the current generation, or nowhere before the first activation. */
export function pluginBases(root: string | undefined): PluginBase[] {
  if (root === undefined || root === "") return [];
  const dir = currentGenerationDir(root);
  return dir === null ? [] : [{ file: path.join(dir, "package.json"), builtin: false }];
}

/**
 * The prefixes this build ships (the push's, the installation's): where the registry reads a
 * shipped package's readme. Not a lookup location — nothing is loaded from them.
 */
export function shippedBases(assetsDir: string | null): PluginBase[] {
  return storeSources(assetsDir).map((dir) => ({
    file: path.join(dir, "package.json"),
    builtin: true,
  }));
}

/** The assets directory of the committed version, read from harness.json without a host. */
export async function committedAssetsDir(root: string): Promise<string | null> {
  const manifest = await readManifest(root);
  const dir = manifest?.assets?.dir;
  return typeof dir === "string" ? path.join(root, "hmr", dir) : null;
}

/**
 * The package a bare name names under a base's own `node_modules`: its directory, its
 * manifest, and the base that found it — or null. Nothing about the package is assumed: it is
 * whatever the prefix holds there (in a generation, a link to a store entry's package).
 */
export function resolvePluginPackage(
  specifier: string,
  bases: readonly PluginBase[],
): { dir: string; manifest: string; base: PluginBase } | null {
  if (!PACKAGE_NAME.test(specifier)) return null;
  for (const base of bases) {
    const dir = path.join(path.dirname(base.file), "node_modules", ...specifier.split("/"));
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) return { dir, manifest, base };
  }
  return null;
}

/**
 * The file an `import "<name>"` of the package would load: `exports["."]` — a string, or its
 * `import` / `node` / `default` condition — else `main` (with `.js` supplied when it is
 * written without one), else `index.js`. The packages are ESM and name one entry, which is
 * all this reads; anything richer is the package's own business once Node imports it.
 */
function packageEntry(dir: string, manifest: string): string | null {
  let pkg: { exports?: unknown; main?: unknown };
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8")) as typeof pkg;
  } catch {
    return null;
  }
  const condition = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    return condition(v.import) ?? condition(v.node) ?? condition(v.default) ?? null;
  };
  let rel: string | null = null;
  const exp = pkg.exports;
  if (typeof exp === "string") rel = exp;
  else if (exp !== null && typeof exp === "object") {
    const table = exp as Record<string, unknown>;
    rel = condition("." in table ? table["."] : table);
  }
  rel ??= typeof pkg.main === "string" ? pkg.main : "./index.js";
  const file = path.resolve(dir, rel);
  if (!existsSync(file) && path.extname(file) === "" && existsSync(`${file}.js`)) {
    return `${file}.js`;
  }
  return file;
}

/** Where a specifier resolves from — the entry file and the base that found it — or null. */
function resolvePlugin(
  specifier: string,
  bases: readonly PluginBase[],
): { file: string; base: PluginBase } | null {
  // A subpath would resolve to the PACKAGE (findPackageJSON finds its manifest) and load its
  // root entry — the wrong module, silently. Refused up front, by name.
  if (!PACKAGE_NAME.test(specifier)) return null;
  const found = resolvePluginPackage(specifier, bases);
  if (found === null) return null;
  const file = packageEntry(found.dir, found.manifest);
  if (file === null) return null;
  // Through the generation's link, to the store entry: one content is one file, whichever
  // generation names it, so a re-activation that keeps a package keeps its imported module.
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    // Missing: importPlugin says so.
  }
  return { file: real, base: found.base };
}

/**
 * The plugins this build SHIPS: the names the running build's `index.json` lists (plugin/store.ts
 * `readShippedIndex`; what npm installed beside them, their dependencies, is not offered). Being shipped means
 * installing one needs no download — it does not mean it is installed. Nothing here loads;
 * the list is what marks an index entry as available offline and lets an install skip npm.
 */
export async function shippedPlugins(assetsDir: string | null): Promise<string[]> {
  return shippedNames(assetsDir);
}

/**
 * The entry file's modification time, the part of its identity a path alone misses: a
 * package updated in place keeps its path, and Node's module cache would keep serving the
 * code it loaded first. Null when the file cannot be stat'ed (the import then says why).
 */
function entryStamp(file: string): number | null {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Resolved against the data root and the installation, never the bundle's location. The
 * import URL carries the entry's stamp, so a file rewritten in place is evaluated again
 * rather than answered from the module cache. (Only the entry: what it imports by relative
 * path stays cached, which a bundled plugin — one file — does not notice.)
 */
async function importPlugin(
  specifier: string,
  bases: readonly PluginBase[],
): Promise<{ module: unknown; file: string | null; stamp: number | null }> {
  const resolved = resolvePlugin(specifier, bases);
  if (resolved !== null) {
    if (!existsSync(resolved.file)) {
      throw new Error(`the package's entry file does not exist: ${resolved.file}`);
    }
    const stamp = entryStamp(resolved.file);
    const url = pathToFileURL(resolved.file).href + (stamp === null ? "" : `?v=${stamp}`);
    return { module: await import(url), file: resolved.file, stamp };
  }
  return { module: await import(specifier), file: null, stamp: null };
}

/** The generated table a plugin package ships beside its package.json. */
export const IFACES_FILE = "ifaces.json";

/** The `plugin` entry of a package's table: the names its default export lists, read statically by the generator. */
export interface PluginDeclaration {
  modules: readonly string[];
  replaces: readonly string[];
}

/**
/**
 * What a listed specifier DECLARES, read from its generated table alone — the package is never
 * imported. Lets a surface say which plugin a loaded module came from, and why a listed one is
 * not there, without the runtime having to publish its load report.
 */
export async function readPluginDeclaration(
  specifier: string,
  bases: readonly PluginBase[],
): Promise<
  { modules: string[]; replaces: string[]; builtin: boolean; version?: string } | { error: string }
> {
  const fault = specifierFault(specifier);
  if (fault !== null) return { error: fault };
  const resolved = resolvePlugin(specifier, bases);
  if (resolved === null) {
    return {
      error: `'${specifier}' is not installed on this machine (the current plugin generation under <root>/plugins does not hold it)`,
    };
  }
  if (!existsSync(resolved.file)) {
    return { error: `the package's entry file does not exist: ${resolved.file}` };
  }
  let read: Awaited<ReturnType<typeof readPackageTable>>;
  try {
    read = await readPackageTable(resolved.file);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (read === null) return { error: `no package.json above ${resolved.file}` };
  const version = await readManifestVersion(read.where);
  return {
    modules: [...read.plugin.modules],
    replaces: [...read.plugin.replaces],
    builtin: resolved.base.builtin,
    ...(version === undefined ? {} : { version }),
  };
}

/** The `version` a package.json states, or undefined when it states none or cannot be read. */
async function readManifestVersion(manifest: string): Promise<string | undefined> {
  try {
    const { version } = JSON.parse(await fs.readFile(manifest, "utf8")) as { version?: unknown };
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The package's generated table (`ifaces.json` beside its `package.json`, the nearest one
 * above the resolved entry file): the manifest of every decorated class, the signature of
 * every interface they name. A package is a plugin by being listed; the table is its
 * MODULE payload, and a package without one ships no modules (`manifests` empty). Null
 * only when no `package.json` is above the file at all.
 */
async function readPackageTable(file: string | null): Promise<{
  where: string;
  ifaces: IfaceTable;
  manifests: ManifestTable;
  /** What the default export names, as the generator read it: the modules added and the nodes stood in for. */
  plugin: PluginDeclaration;
} | null> {
  if (file === null) return null;
  let dir = path.dirname(file);
  for (;;) {
    const where = path.join(dir, "package.json");
    try {
      await fs.access(where);
      const tableFile = path.join(dir, IFACES_FILE);
      let text: string;
      try {
        text = await fs.readFile(tableFile, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return {
          where,
          ifaces: { ifaces: {}, types: {} },
          manifests: {},
          plugin: { modules: [], replaces: [] },
        };
      }
      const table = JSON.parse(text) as {
        ifaces?: unknown;
        types?: unknown;
        modules?: unknown;
        plugin?: unknown;
      };
      const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
      if (!isRecord(table.ifaces) || !isRecord(table.types) || !isRecord(table.modules)) {
        throw new Error(`${tableFile}: expected { ifaces, types, modules } (gen-ifaces output)`);
      }
      const names = (v: unknown) => Array.isArray(v) && v.every((n) => typeof n === "string");
      const plugin = (table.plugin ?? {}) as { modules?: unknown; replaces?: unknown };
      if (!isRecord(plugin) || !names(plugin.modules ?? []) || !names(plugin.replaces ?? [])) {
        throw new Error(
          `${tableFile}#plugin: expected { modules: [<name>, …], replaces: [<name>, …] }`,
        );
      }
      const manifests: Record<string, ModuleDef["manifest"]> = {};
      for (const [name, doc] of Object.entries(table.modules as Record<string, unknown>)) {
        manifests[name] = parseManifest(doc, `${tableFile}#modules.${name}`);
      }
      return {
        where,
        ifaces: { ifaces: table.ifaces, types: table.types } as IfaceTable,
        manifests,
        plugin: {
          modules: (plugin.modules ?? []) as string[],
          replaces: (plugin.replaces ?? []) as string[],
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether the host interfaces this package compiled against — its own table copies them —
 * still fit this platform's, both for what its modules require and for what they provide.
 * The tree check cannot say: it looks a key up in one merged table, where the host's entry
 * stands, so it would compare the platform's declaration with itself.
 *
 * Two things can leave an interface uncompared, and neither fails the load — a pushed
 * platform must not take plugins away from a machine for something the plugin did not do:
 * a table that carries no copy of a host interface (the generator only writes the
 * interfaces a package DECLARES, so today that is every host interface a plugin requires),
 * and an installation whose program predates the compiler being a dependency. Both are
 * logged; an interface the table does carry, and that no longer fits, fails the load.
 */
let compilerMissingLogged = false;
async function interfaceMisfits(
  specifier: string,
  own: IfaceTable,
  defs: readonly ModuleDef[],
  assets: string | null,
): Promise<string[]> {
  const questions = ifaceQuestions(defs.map((d) => d.manifest));
  if (questions.length === 0) return [];
  let ts: TypeScript;
  try {
    ts = await loadTypeScript(assets);
  } catch (err) {
    if (!(err instanceof TypeScriptUnavailable)) throw err;
    if (!compilerMissingLogged) console.warn(`[plugins] interfaces not compared: ${err.message}`);
    compilerMissingLogged = true;
    return [];
  }
  const fit = checkIfaces(ts, platformTable as unknown as IfaceTable, own, questions);
  if (fit.uncompared.length > 0) {
    console.warn(
      `[plugins] ${specifier}: ${fit.uncompared.length} interface(s) not compared — its table carries no copy of them`,
    );
  }
  return fit.problems;
}

/** The package's default export as a Plugin, or null when it is not one. */
function asPlugin(module: unknown): Plugin | null {
  const def = (module as { default?: unknown }).default;
  const d = def as { modules?: unknown; replaces?: unknown } | null;
  const classes = (v: unknown) => Array.isArray(v) && v.every((m) => typeof m === "function");
  if (d === null || typeof d !== "object") return null;
  if (d.modules === undefined && d.replaces === undefined) return null;
  if (
    (d.modules !== undefined && !classes(d.modules)) ||
    (d.replaces !== undefined && !classes(d.replaces))
  )
    return null;
  return def as Plugin;
}

/**
 * Loads every configured plugin.
 *
 * Every failure is per entry, collected and skipped: an unresolvable specifier, a missing
 * table, a throw at import — that capability is unavailable, which a deployment can recover
 * from, and the reason is kept on the host for the list view. A Project whose config cannot
 * be read or parsed contributes nothing (readProjectPluginList): the deployment comes up for
 * every other Project, and that one's list view reports the fault.
 */
export async function loadPlugins(
  root: string,
  /**
   * The assets of the version being booted, or undefined to read the COMMITTED one.
   *
   * The distinction is the difference between loading this push's plugins and the previous
   * one's. A hot upgrade materializes its assets and publishes them BEFORE the new platform's
   * create() runs, but commits `harness.json` only after that boot succeeds — so a create()
   * that reads the committed pointer is reading the version it is replacing, and every push
   * would ship plugins one version stale. Seen exactly that way: a corrected plugin arrived
   * on a machine and the previous build's copy kept running until the NEXT push.
   */
  assetsDir?: string | null,
  /**
   * Entries an earlier App already imported, by specifier. Reused when the specifier still
   * resolves to the FILE that entry came from, unchanged since — the objects then keep their
   * identity across a swap, which is what the plugin host is parked for. A different file
   * (the generation now links another store entry) or a file rewritten in place (a dev
   * checkout's plugin) means different code, and that is imported.
   */
  reuse: ReadonlyMap<string, LoadedPlugin> = new Map(),
  /** This server's own machine id, which selects its `[plugins.<id>]` tables; null reads the shared tables alone. */
  machineId: string | null = null,
): Promise<PluginLoadResult> {
  const failed = new Map<string, string>();
  const pushedAssets = assetsDir === undefined ? await committedAssetsDir(root) : assetsDir;
  // The closure over this root's Projects, and nothing else. A plugin the BUILD ships is
  // available without a download — that is what `builtin` means — but availability is not
  // consent: it loads when a Project asks for it, like every other plugin.
  const asks = await readPluginAsks(root, machineId);
  // The generation the closure resolves to becomes current before anything is imported. When
  // activation itself fails, whatever generation was current stays so and is loaded.
  let activation: Activation | null = null;
  try {
    activation = await activatePlugins(root, asks, pushedAssets);
  } catch (err) {
    console.warn(
      `[plugins] activation failed, the current generation is kept: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // The sweep follows the flip, in this boot — so on the assembly queue, never beside a
  // generation being written — and runs once at the first activation of the process.
  if (activation !== null) {
    const first = !sweptRoots().has(root);
    if (first || activation.current !== activation.previous) {
      sweptRoots().add(root);
      await sweepPlugins(root, {
        keep: [activation.current, ...(activation.previous !== null ? [activation.previous] : [])],
        pins: await readPluginPins(root),
      });
    }
  }
  const bases = pluginBases(root);
  // A stored plugin runs from its store entry; the host SDK it keeps external is lent to it.
  lendHostPackages(root);
  const loaded: LoadedPlugin[] = [];
  for (const specifier of asks.keys()) {
    // Reused only when the SAME FILE is behind the name. A push brings new content to a new
    // store entry, so keeping an entry by specifier alone would run the previous build's
    // plugin code forever — the push would land everywhere except the plugins.
    const fault = specifierFault(specifier);
    if (fault !== null) {
      failed.set(specifier, fault);
      continue;
    }
    const missing = activation?.missing.get(specifier);
    if (missing !== undefined) {
      failed.set(specifier, missing);
      continue;
    }
    const held = reuse.get(specifier);
    const heldFile = held?.file;
    if (
      held !== undefined &&
      heldFile != null &&
      heldFile === resolvePlugin(specifier, bases)?.file &&
      held.stamp === entryStamp(heldFile)
    ) {
      loaded.push(held);
      continue;
    }
    try {
      const { module, file, stamp } = await importPlugin(specifier, bases);
      const read = await readPackageTable(file);
      if (read === null) {
        failed.set(specifier, `no package.json above ${file}`);
        continue;
      }
      const plugin = asPlugin(module);
      if (plugin === null) {
        failed.set(
          specifier,
          "the default export is not a Plugin ({ modules?: [<@Component or @Module class>, …], replaces?: [<class>, …] })",
        );
        continue;
      }
      const named = (plugin.modules?.length ?? 0) + (plugin.replaces?.length ?? 0);
      if (named > 0 && Object.keys(read.manifests).length === 0) {
        // Classes named, no table: the package was not built (gen-ifaces runs in its build).
        throw new Error(
          `the default export names module classes, but ${path.join(path.dirname(read.where), IFACES_FILE)} is missing — build the package`,
        );
      }
      // Each class is checked against its generated manifest here (a stale table is a
      // named error); the manifest is checked against the tree at boot.
      const seen = new Set<string>();
      const pair = (classes: readonly ModuleClass[] | undefined): ModuleDef[] =>
        (classes ?? []).map((cls) => {
          const def = moduleDefOf(cls, { manifests: read.manifests });
          if (seen.has(def.manifest.name)) {
            throw new Error(`the default export lists '${def.manifest.name}' twice`);
          }
          seen.add(def.manifest.name);
          return def;
        });
      const modules = pair(plugin.modules);
      const replaces = pair(plugin.replaces);
      const misfits = await interfaceMisfits(
        specifier,
        read.ifaces,
        [...modules, ...replaces],
        pushedAssets,
      );
      if (misfits.length > 0) throw new Error(misfits.join("\n"));
      loaded.push({ specifier, file, stamp, modules, replaces, ifaces: read.ifaces });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed, activation };
}

/**
 * The plugin host THIS App runs — built by the PLATFORM, at its own boot (hmr/platform.ts).
 *
 * This is the point of the whole file living below the seam: which plugins a deployment runs
 * is configuration, and how that configuration is read is policy. Both therefore travel by
 * push. A machine whose program predates a new rule — the Project closure replacing the data
 * root's plugins.json, say — learns it from the pushed platform, instead of being unable to
 * act on a list it has already been given until someone restarts it.
 *
 * What the registry keeps is the imported objects, claimed here and handed back at the
 * commit: state, not a capability. An entry the closure no longer asks for is simply not in
 * the new host; its modules leave the tree with the App that had them.
 */
export async function loadPluginHost(
  resources: Resources,
  root: string,
  /** The booting version's assets (hmr.assetsDir()), not the committed ones — see loadPlugins. */
  assetsDir?: string | null,
  /** This server's own machine id (see loadPlugins). */
  machineId: string | null = null,
): Promise<PluginHost> {
  const inherited = pluginHostFrom(resources);
  // An older generation's host may predate `entries()`; then nothing is reused and every
  // specifier is imported again, which the ESM cache makes cheap.
  const reuse =
    typeof inherited.entries === "function" ? inherited.entries() : new Map<string, LoadedPlugin>();
  const result = await loadPlugins(root, assetsDir, reuse, machineId);
  const host = new PluginHost();
  for (const entry of result.loaded) {
    // A module name clash is a LOAD failure, isolated per entry like an import failure.
    try {
      host.use(entry);
    } catch (err) {
      result.failed.set(entry.specifier, err instanceof Error ? err.message : String(err));
    }
  }
  // The reason stays on the host, not only in the log: the installed-plugins page reads it
  // there, so a plugin that failed to load is shown with why rather than as a restart that
  // would not help.
  for (const [specifier, reason] of result.failed) {
    host.skip(specifier, reason);
    console.warn(`[plugins] skipped ${specifier}: ${reason}`);
  }
  return host;
}
