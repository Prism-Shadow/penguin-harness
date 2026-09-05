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
 * and skipped, leaving its capability unavailable rather than failing the boot. An
 * plugin is a set of modules (core plugin/index.ts): `package.json#penguin.modules`
 * carries the manifests, the default export the code, paired by name.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import { pluginsPrefix } from "./install.js";
import { readManifest } from "../hmr/manifest.js";
import type { Plugin, PluginModule } from "@prismshadow/penguin-core/plugin";
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
 * Where plugins are looked for, in order. Each is an npm prefix (`<dir>/package.json` +
 * `<dir>/node_modules/…`) except the installation entry, which resolves as the running
 * program does:
 *
 *   1. `<root>/plugins` — what the Plugins page installs; the operator's explicit choice.
 *   2. `<assets>/plugins` — the BUILTIN plugins the committed hot push carried
 *      (scripts/build-plugins.mjs), i.e. the plugins of the revision that is running.
 *   3. `<installation>/plugins` — the builtin plugins the build shipped (the desktop app
 *      stages them beside `skills/`), for a deployment nothing was ever pushed to.
 *   4. the installation entry — a plugin installed globally beside the program.
 *
 * A prefix marked `builtin` is one the harness ships, not one the operator installed.
 */
export interface PluginBase {
  file: string;
  builtin: boolean;
}

export function pluginBases(root: string | undefined, assetsDir: string | null): PluginBase[] {
  const bases: PluginBase[] = [];
  if (root !== undefined && root !== "") {
    bases.push({ file: path.join(pluginsPrefix(root), "package.json"), builtin: false });
  }
  if (assetsDir !== null) {
    bases.push({ file: path.join(assetsDir, "plugins", "package.json"), builtin: true });
  }
  const entry = process.argv[1];
  if (typeof entry === "string" && entry.length > 0) {
    bases.push({
      file: path.join(path.dirname(entry), "..", "plugins", "package.json"),
      builtin: true,
    });
    bases.push({ file: entry, builtin: false });
  }
  return bases;
}

/** The assets directory of the committed version, read from harness.json without a host. */
export async function committedAssetsDir(root: string): Promise<string | null> {
  const manifest = await readManifest(root);
  const dir = manifest?.assets?.dir;
  return typeof dir === "string" ? path.join(root, "hmr", dir) : null;
}

/** Where a specifier resolves from — the file and the base that found it — or null. */
function resolvePlugin(
  specifier: string,
  bases: readonly PluginBase[],
): { file: string; base: PluginBase } | null {
  for (const base of bases) {
    try {
      return { file: createRequire(base.file).resolve(specifier), base };
    } catch {
      // Try the next base; a dev checkout resolves the specifier directly (see importPlugin).
    }
  }
  return null;
}

/**
 * The plugins a set of bases SHIPS: every package under a builtin prefix's node_modules
 * (scoped or not) whose package.json declares `penguin`. Being shipped means installing one
 * needs no download — it does not mean it is installed. Nothing here loads; the list is what
 * marks a catalogue row as available offline and lets an install skip npm.
 */
export async function discoverBuiltinPlugins(bases: readonly PluginBase[]): Promise<string[]> {
  const names: string[] = [];
  for (const base of bases) {
    if (!base.builtin) continue;
    const modules = path.join(path.dirname(base.file), "node_modules");
    let top: string[];
    try {
      top = await fs.readdir(modules);
    } catch {
      continue;
    }
    const candidates: string[] = [];
    for (const name of top) {
      if (name.startsWith(".")) continue;
      if (name.startsWith("@")) {
        for (const inner of await fs.readdir(path.join(modules, name)).catch(() => [])) {
          candidates.push(`${name}/${inner}`);
        }
      } else {
        candidates.push(name);
      }
    }
    for (const name of candidates) {
      try {
        const raw = JSON.parse(
          await fs.readFile(path.join(modules, ...name.split("/"), "package.json"), "utf8"),
        ) as { penguin?: unknown };
        if (raw.penguin !== undefined && !names.includes(name)) names.push(name);
      } catch {
        // Not a package, or not a plugin one.
      }
    }
  }
  return names.sort();
}

/** Resolved against the data root and the installation, never the bundle's location. */
async function importPlugin(
  specifier: string,
  bases: readonly PluginBase[],
): Promise<{ module: unknown; file: string | null }> {
  const resolved = resolvePlugin(specifier, bases);
  if (resolved !== null) {
    return { module: await import(pathToFileURL(resolved.file).href), file: resolved.file };
  }
  return { module: await import(specifier), file: null };
}

/**
 * What a listed specifier DECLARES, read from its package.json alone — the package is never
 * imported. Lets a surface say which plugin a loaded module came from, and why a listed one is
 * not there, without the runtime having to publish its load report.
 */
export async function readPluginDeclaration(
  specifier: string,
  bases: readonly PluginBase[],
): Promise<{ modules: string[]; replaces: string[]; builtin: boolean } | { error: string }> {
  const resolved = resolvePlugin(specifier, bases);
  if (resolved === null) {
    return {
      error: `'${specifier}' is not installed on this machine (nothing under <root>/plugins, the shipped plugins or the installation resolves it)`,
    };
  }
  let read: Awaited<ReturnType<typeof readPackageManifests>>;
  try {
    read = await readPackageManifests(resolved.file);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (read === null) return { error: "not a plugin package: no package.json#penguin above it" };
  return {
    modules: read.manifests.map((m) => m.name),
    replaces: read.replaces.map((m) => m.name),
    builtin: resolved.base.builtin,
  };
}

/** Rewrites the list of plugins this deployment installs; the loader reads it at the next boot. */
export async function writePluginList(root: string, plugins: readonly string[]): Promise<void> {
  const file = path.join(root, PLUGINS_FILE);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify({ plugins }, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/**
 * The package's manifests (`package.json#penguin.modules`), found by walking up from the
 * resolved entry file. Each entry is one module's static half; its `name` is what the
 * default export's `modules` is keyed by. Absent = not a plugin package.
 */
async function readPackageManifests(file: string | null): Promise<{
  where: string;
  manifests: ModuleDef["manifest"][];
  replaces: ModuleDef["manifest"][];
} | null> {
  if (file === null) return null;
  let dir = path.dirname(file);
  for (;;) {
    const where = path.join(dir, "package.json");
    try {
      const raw = JSON.parse(await fs.readFile(where, "utf8")) as { penguin?: unknown };
      if (raw.penguin === undefined) return null;
      const penguin = raw.penguin as { modules?: unknown; replaces?: unknown };
      const list = penguin.modules ?? [];
      const replaces = penguin.replaces ?? [];
      if (!Array.isArray(list) || !Array.isArray(replaces)) {
        throw new Error(`${where}#penguin: expected { "modules": [ … ], "replaces": [ … ] }`);
      }
      const manifestAt = (doc: unknown, at: string) => {
        const d = (doc ?? {}) as Record<string, unknown>;
        return parseManifest(
          {
            name: d.name,
            requires: d.requires ?? {},
            provides: d.provides ?? {},
            contributes: d.contributes ?? {},
            ...(d.context !== undefined ? { context: d.context } : {}),
            children: d.children ?? [],
            ...(d.exports !== undefined ? { exports: d.exports } : {}),
          },
          at,
        );
      };
      return {
        where,
        manifests: list.map((doc, i) => manifestAt(doc, `${where}#penguin.modules[${i}]`)),
        replaces: replaces.map((doc, i) => manifestAt(doc, `${where}#penguin.replaces[${i}]`)),
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
  const isRecord = (v: unknown) => v !== null && typeof v === "object";
  if (d === null || typeof d !== "object") return null;
  if (d.modules === undefined && d.replaces === undefined) return null;
  if (
    (d.modules !== undefined && !isRecord(d.modules)) ||
    (d.replaces !== undefined && !isRecord(d.replaces))
  )
    return null;
  return def as Plugin;
}

/**
 * Loads every configured plugin.
 *
 * The two failure classes are deliberately different. A PER-ENTRY failure (unresolvable
 * specifier, no `activate` export, a throw at import) is collected and skipped: that
 * capability is unavailable, which a deployment can recover from. A CONFIG-level failure
 * — the list itself unreadable or malformed — THROWS, because there is no honest way to
 * continue: the operator configured something this process cannot even read, and booting
 * with an empty plugin set would present as a healthy server that silently dropped every
 * capability the config asked for.
 */
export async function loadPlugins(root: string): Promise<PluginLoadResult> {
  const failed = new Map<string, string>();
  const bases = pluginBases(root, await committedAssetsDir(root));
  // What plugins.json lists, and nothing else. A plugin the BUILD ships is available without
  // a download — that is what `builtin` means — but availability is not consent: it loads
  // when an operator installs it, like every other plugin.
  const specifiers = await readPluginList(root);
  const loaded: LoadedPlugin[] = [];
  for (const specifier of specifiers) {
    try {
      const { module, file } = await importPlugin(specifier, bases);
      const read = await readPackageManifests(file);
      if (read === null) {
        failed.set(specifier, "not a plugin package: no package.json#penguin above it");
        continue;
      }
      const plugin = asPlugin(module);
      if (plugin === null) {
        failed.set(
          specifier,
          "the default export is not an Plugin ({ modules?: { <name>: { create } }, replaces?: { <name>: { create } } })",
        );
        continue;
      }
      const pair = (
        manifests: ModuleDef["manifest"][],
        impls: Record<string, PluginModule> | undefined,
        kind: "modules" | "replaces",
      ): ModuleDef[] => {
        const out: ModuleDef[] = [];
        for (const manifest of manifests) {
          const impl = impls?.[manifest.name];
          if (impl === undefined || typeof impl.create !== "function") {
            throw new Error(
              `${read.where}#penguin.${kind} names '${manifest.name}', but the default export's ${kind} has no create() for it`,
            );
          }
          out.push({ manifest, ...impl });
        }
        const declared = new Set(manifests.map((m) => m.name));
        for (const name of Object.keys(impls ?? {})) {
          if (!declared.has(name)) {
            throw new Error(
              `the default export's ${kind} has '${name}', which ${read.where}#penguin.${kind} does not declare`,
            );
          }
        }
        return out;
      };
      const modules = pair(read.manifests, plugin.modules, "modules");
      const replaces = pair(read.replaces, plugin.replaces, "replaces");
      loaded.push({ specifier, modules, replaces });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
