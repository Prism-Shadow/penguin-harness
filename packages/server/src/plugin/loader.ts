/**
 * Plugin loading: WHICH plugins a deployment runs is CONFIGURATION, not capability
 * baked into the platform. They do not ride the platform bundle and no hot push
 * delivers one — `<root>/plugins.json` lists them and each entry resolves against the
 * INSTALLATION, so installing or upgrading one is an install-side action.
 *
 * Resolution is anchored at `process.argv[1]`, for the same reason the packaged
 * bundle's own resolver is: a bundle running from `hmr/store` has no node_modules of
 * its own, so anchoring at the bundle would find nothing.
 *
 * Failure is per-entry and non-fatal: an unresolvable or malformed plugin is reported
 * and skipped, leaving its capability unavailable rather than failing the boot. A
 * plugin is a set of modules (core plugin/index.ts): decorated classes, named by the
 * default export, whose manifests the package's generated `ifaces.json` carries.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  IfaceTable,
  ManifestTable,
  ModuleClass,
  ModuleDef,
} from "@prismshadow/penguin-core/kernel";
import { moduleDefOf, parseManifest } from "@prismshadow/penguin-core/kernel";
import { pluginsPrefix } from "./install.js";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { LoadedPlugin } from "./host.js";

/** The config file's name inside the data root. */
export const PLUGINS_FILE = "plugins.json";

export type { LoadedPlugin } from "./host.js";

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  /** specifier → why it was skipped. */
  failed: Map<string, string>;
}
/**
 * An ABSENT file means "no plugins" — the default deployment shape, not an error. Any
 * other outcome is: a file that exists but cannot be read (a permission, a directory in
 * its place, an I/O fault) is indistinguishable from a malformed one for the operator's
 * purposes — something was configured and this process cannot honor it, so running
 * unconfigured would misrepresent what was asked for.
 */
export async function readPluginList(root: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, PLUGINS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `${PLUGINS_FILE} exists but could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${PLUGINS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
    throw new Error(`${PLUGINS_FILE} must be { "plugins": ["<package specifier>", …] }`);
  }
  return list as string[];
}

/**
 * Where a specifier resolves from, or null when it does not resolve at all.
 *
 * The data root's own prefix comes first (`<root>/plugins`, what the Plugins page installs
 * into): it is the one location the harness can write, and a package there is the one the
 * operator asked this deployment for. The installation is the fallback, which is how a plugin
 * shipped with the build, or installed globally beside it, still resolves.
 */
function resolvePlugin(specifier: string, root?: string): string | null {
  const from: string[] = [];
  if (root !== undefined && root !== "") from.push(path.join(pluginsPrefix(root), "package.json"));
  const entry = process.argv[1];
  if (typeof entry === "string" && entry.length > 0) from.push(entry);
  for (const base of from) {
    try {
      return createRequire(base).resolve(specifier);
    } catch {
      // Try the next base; a dev checkout resolves the specifier directly (see importPlugin).
    }
  }
  return null;
}

/** Resolved against the data root and the installation, never the bundle's location. */
async function importPlugin(
  specifier: string,
  root: string,
): Promise<{ module: unknown; file: string | null }> {
  const resolved = resolvePlugin(specifier, root);
  if (resolved !== null)
    return { module: await import(pathToFileURL(resolved).href), file: resolved };
  return { module: await import(specifier), file: null };
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
  root?: string,
): Promise<{ modules: string[]; replaces: string[] } | { error: string }> {
  const resolved = resolvePlugin(specifier, root);
  if (resolved === null) {
    return {
      error: `'${specifier}' is not installed on this machine (nothing under <root>/plugins or the installation resolves it)`,
    };
  }
  let read: Awaited<ReturnType<typeof readPackageTable>>;
  try {
    read = await readPackageTable(resolved);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (read === null) return { error: `no package.json above ${resolved}` };
  return { modules: [...read.plugin.modules], replaces: [...read.plugin.replaces] };
}

/** Rewrites the list of plugins this deployment installs; the loader reads it at the next boot. */
export async function writePluginList(root: string, plugins: readonly string[]): Promise<void> {
  const file = path.join(root, PLUGINS_FILE);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ plugins }, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
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
 * The two failure classes are deliberately different. A PER-ENTRY failure (unresolvable
 * specifier, no table, a throw at import) is collected and skipped: that
 * capability is unavailable, which a deployment can recover from. A CONFIG-level failure
 * — the list itself unreadable or malformed — THROWS, because there is no honest way to
 * continue: the operator configured something this process cannot even read, and booting
 * with an empty plugin set would present as a healthy server that silently dropped every
 * capability the config asked for.
 */
export async function loadPlugins(root: string): Promise<PluginLoadResult> {
  const failed = new Map<string, string>();
  const specifiers = await readPluginList(root);
  const loaded: LoadedPlugin[] = [];
  for (const specifier of specifiers) {
    try {
      const { module, file } = await importPlugin(specifier, root);
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
      loaded.push({ specifier, modules, replaces, ifaces: read.ifaces });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
