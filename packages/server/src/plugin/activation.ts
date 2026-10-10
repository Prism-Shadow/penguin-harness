/**
 * Plugin activation: the one directory a process loads plugins from.
 *
 * `<root>/plugins/` holds GENERATIONS. `plugins/current` is a pointer file naming one of them,
 * `plugins/<gen>/`, an npm prefix:
 *
 *   package.json              `dependencies` name → version (the prefix npm would write), and
 *                             `plugins` name → { version, integrity }, what the generation is
 *   node_modules/<name>       a link to the plugin store entry's `package/` (a symlink on
 *                             POSIX, a junction on Windows; a copy where neither can be made)
 *   .complete                 written last, before the directory is renamed into place
 *
 * A generation's key is the hash of the (name, integrity) list it holds, so the same selection is
 * the same directory. Writing one is atomic for a reader: it is built in `plugins/.tmp-<pid>/`,
 * marked complete, renamed to `plugins/<gen>/`, and only then is `current` flipped — by writing a
 * temporary file and renaming it over the pointer. A reader sees the whole old generation or the
 * whole new one, never a half. The generation current before a flip is the one a failed boot
 * points back at (hmr/platform.ts), and the other one the sweep keeps.
 *
 * A generation is RESOLVED from the closure (every Project's table for this machine): for each
 * name, the entry a Project pinned (`integrity`), or else the store entries whose version
 * satisfies what every Project asks; among those the highest version, and within one version
 * the content the running build carries (its hot push set, or the prefix the installation
 * ships) before one fetched from the registry. A push that brings new content under an
 * unchanged name and version therefore wins at the next activation, with nothing else to do.
 *
 * Activation runs at every App boot — the first, a hot push's, and every re-assembly, which
 * the platform serializes on its one queue (hmr/platform.ts), so two admins' edits never
 * interleave. A boot that fails after activating flips the pointer back to the generation
 * before it. After the flip the loader sweeps (plugin/gc.ts): generations other than these
 * two go. What is in `<root>/plugins/` besides generations (the npm
 * prefix older builds installed into) is neither read nor removed.
 *
 * A name can also be linked to a LOCAL directory (plugin/links.ts): the link record is a
 * machine-level input like the store, and activation answers such a name from it — the
 * generation's `node_modules/<name>` points at the directory, so a rebuild of the source
 * reaches the next boot through the unchanged link. A local entry has no integrity: its
 * key names the path (and the version the directory's package.json reads), an integrity pin
 * on it is refused, and the sweep never touches the source, which is not under `<root>/`.
 *
 * A linked plugin runs from its own directory, so the host SDK it keeps external is
 * resolved from there — a checkout finds the workspace's `node_modules` above it; the
 * lending hook (`lendHostPackages`) serves store entries only.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PACKAGE_DIR,
  pluginStoreDir,
  programEntry,
  readStore,
  storeEntryDir,
  syncPluginStore,
} from "./store.js";
import type { StoreIndexEntry } from "./store.js";
import { readPluginLinks, resolveLocalEntry } from "./links.js";
import { compareVersions, satisfies } from "../api/plugin-pick.js";

/** `<root>/plugins`: the activation directory. */
export const PLUGINS_DIR = "plugins";
/** The pointer file naming the current generation. */
export const CURRENT_FILE = "current";
/** A generation's completion marker, written before it is renamed into place. */
export const COMPLETE_FILE = ".complete";

/** A generation's directory name. */
export const GENERATION = /^[0-9a-f]{16}$/;

export function pluginsDir(root: string): string {
  return path.join(root, PLUGINS_DIR);
}

/** What a Project asks of one name: a version range, and optionally the exact content. */
export interface PluginAsk {
  version?: string;
  /** npm's integrity, `sha512-<base64>`: this content and no other. */
  integrity?: string;
}

/**
 * One plugin of a generation: a store entry, keyed by npm's integrity — or a local
 * directory the name is linked to (plugin/links.ts), which has none: what its directory
 * holds is what runs, and the key names the path.
 */
export type GenerationEntry =
  | { name: string; version: string; integrity: string }
  | { name: string; version: string; local: string };

/** The generation `current` names, when the pointer and a complete generation behind it exist. */
export function currentGeneration(root: string): string | null {
  let gen: string;
  try {
    gen = fs.readFileSync(path.join(pluginsDir(root), CURRENT_FILE), "utf8").trim();
  } catch {
    return null;
  }
  if (!GENERATION.test(gen)) return null;
  return fs.existsSync(path.join(pluginsDir(root), gen, COMPLETE_FILE)) ? gen : null;
}

/** The directory of the current generation, or null. */
export function currentGenerationDir(root: string): string | null {
  const gen = currentGeneration(root);
  return gen === null ? null : path.join(pluginsDir(root), gen);
}

/** The plugins a generation holds, from its package.json; null when it is not a generation. */
export async function readGeneration(root: string, gen: string): Promise<GenerationEntry[] | null> {
  let manifest: { plugins?: unknown };
  try {
    manifest = JSON.parse(
      await fsp.readFile(path.join(pluginsDir(root), gen, "package.json"), "utf8"),
    ) as { plugins?: unknown };
  } catch {
    return null;
  }
  const table = manifest.plugins;
  if (table === null || typeof table !== "object") return null;
  const out: GenerationEntry[] = [];
  for (const [name, row] of Object.entries(table as Record<string, unknown>)) {
    const r = row as { version?: unknown; integrity?: unknown; local?: unknown };
    if (typeof r.version !== "string") continue;
    // A store entry names its integrity; a local link names the directory it points at.
    if (typeof r.integrity === "string") {
      out.push({ name, version: r.version, integrity: r.integrity });
    } else if (typeof r.local === "string") {
      out.push({ name, version: r.version, local: r.local });
    }
  }
  return out;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The key of a selection: the hash of its sorted (name, content) list, 16 hex digits. A
 * store entry's content is its integrity; a local link's is its path, with the version the
 * directory's package.json read when the generation was written.
 */
export function generationKey(entries: readonly GenerationEntry[]): string {
  const pairs = entries
    .map((e) => [e.name, "integrity" in e ? e.integrity : `local:${e.local}@${e.version}`] as const)
    .sort(([a], [b]) => byCodeUnit(a, b));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex").slice(0, 16);
}

/**
 * `node_modules/<name>` → the store entry's package. A junction on Windows (no privilege
 * needed), a directory symlink elsewhere; a copy when the filesystem allows neither.
 */
async function linkPackage(target: string, link: string): Promise<void> {
  await fsp.mkdir(path.dirname(link), { recursive: true });
  try {
    await fsp.symlink(target, link, "junction");
  } catch {
    await fsp.cp(target, link, { recursive: true });
  }
}

/**
 * Writes the generation holding `entries` — unless it already exists — and answers its key.
 * Built in `plugins/.tmp-<pid>/`, marked complete, then renamed into place.
 */
export async function writeGeneration(
  root: string,
  entries: readonly GenerationEntry[],
): Promise<string> {
  const gen = generationKey(entries);
  const dest = path.join(pluginsDir(root), gen);
  if (fs.existsSync(path.join(dest, COMPLETE_FILE))) return gen;
  const tmp = path.join(pluginsDir(root), `.tmp-${process.pid}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const sorted = [...entries].sort((a, b) => byCodeUnit(a.name, b.name));
    const manifest = {
      name: "penguin-plugins-generation",
      private: true,
      version: "0.0.0",
      dependencies: Object.fromEntries(sorted.map((e) => [e.name, e.version])),
      plugins: Object.fromEntries(
        sorted.map((e) => [
          e.name,
          "integrity" in e
            ? { version: e.version, integrity: e.integrity }
            : { version: e.version, local: e.local },
        ]),
      ),
    };
    await fsp.writeFile(path.join(tmp, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const e of sorted) {
      // A store entry runs from its entry's package; a local link runs from the directory
      // itself, so a rebuild of the source reaches the next boot through the link.
      const target =
        "integrity" in e
          ? path.join(storeEntryDir(root, e.name, e.version, e.integrity), PACKAGE_DIR)
          : e.local;
      await linkPackage(target, path.join(tmp, "node_modules", ...e.name.split("/")));
    }
    await fsp.writeFile(path.join(tmp, COMPLETE_FILE), `${new Date().toISOString()}\n`);
    // A directory without the marker is a write that did not finish: replaced, not trusted.
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(tmp, dest);
    return gen;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/** Points `current` at `gen` — a temporary file renamed over the pointer — or removes it (null). */
export async function pointCurrent(root: string, gen: string | null): Promise<void> {
  const file = path.join(pluginsDir(root), CURRENT_FILE);
  if (gen === null) {
    await fsp.rm(file, { force: true });
    return;
  }
  await fsp.mkdir(pluginsDir(root), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${gen}\n`);
  await fsp.rename(tmp, file);
}

/**
 * The store entry a name resolves to, or why none does: a pinned integrity takes that entry;
 * otherwise, among the entries every ask's version admits, the highest version — and within
 * one version, what the running build carries (`shipped`, by integrity) before any other
 * content, so a push that brings new content under an unchanged version wins.
 */
export function chooseEntry(
  name: string,
  asks: readonly PluginAsk[],
  stored: readonly StoreIndexEntry[],
  shipped: ReadonlySet<string>,
): StoreIndexEntry | { missing: string } {
  const mine = stored.filter((e) => e.name === name);
  if (mine.length === 0) {
    return {
      missing: `'${name}' is not in the plugin store: install it, or ship it with the build`,
    };
  }
  const pins = [...new Set(asks.map((a) => a.integrity).filter((i): i is string => !!i))];
  if (pins.length > 1) {
    return {
      missing: `'${name}' is pinned to ${pins.length} different contents: ${pins.join(", ")}`,
    };
  }
  const fits = mine.filter(
    (e) =>
      asks.every((a) => satisfies(e.version, a.version)) &&
      (pins.length === 0 || e.integrity === pins[0]),
  );
  if (fits.length === 0) {
    const wanted = asks.map((a) => a.integrity ?? a.version ?? "*").join(", ");
    return {
      missing: `no stored '${name}' satisfies ${wanted} (stored: ${mine.map((e) => e.version).join(", ")})`,
    };
  }
  return [...fits].sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      Number(shipped.has(b.integrity)) - Number(shipped.has(a.integrity)) ||
      byCodeUnit(a.integrity, b.integrity),
  )[0]!;
}

/** What one activation did: the generation before it, the one now current, and what could not be placed in it. */
export interface Activation {
  previous: string | null;
  current: string;
  /** name → why it is not in the generation. */
  missing: Map<string, string>;
}

/**
 * Resolves the closure against the store, writes that generation if it is new and points
 * `current` at it. The store is brought up to date with this boot's own sources first (their
 * entries are what "the running build carries" means). `asks` maps each listed package name to
 * what every Project asks of it; a name that is linked to a local directory (plugin/links.ts)
 * is answered by the link — before the store, since the link is the machine's own answer for
 * the name — and a name neither a link nor the store answers is reported by the loader with
 * its reason.
 */
export async function activatePlugins(
  root: string,
  asks: ReadonlyMap<string, readonly PluginAsk[]>,
  assetsDir: string | null,
): Promise<Activation> {
  const shipped = await syncPluginStore(root, assetsDir);
  const stored = await readStore(root);
  const linked = await readPluginLinks(root);
  const chosen: GenerationEntry[] = [];
  const missing = new Map<string, string>();
  for (const [name, list] of asks) {
    const link = linked.get(name);
    if (link !== undefined) {
      const pick = await resolveLocalEntry(name, link, list);
      if ("missing" in pick) missing.set(name, pick.missing);
      else chosen.push(pick);
      continue;
    }
    const pick = chooseEntry(name, list, stored, shipped);
    if ("missing" in pick) missing.set(name, pick.missing);
    else chosen.push({ name: pick.name, version: pick.version, integrity: pick.integrity });
  }
  const previous = currentGeneration(root);
  const current = await writeGeneration(root, chosen);
  if (current !== previous) await pointCurrent(root, current);
  return { previous, current, missing };
}

/**
 * The packages the HOST lends a plugin rather than the plugin shipping them: the SDK a plugin's
 * bundle keeps external (discord-bot imports `@prismshadow/penguin-core` at run time).
 */
export const HOST_PACKAGES = /^@prismshadow\/penguin-core(\/|$)/;

type Resolve = Parameters<NonNullable<Parameters<typeof nodeModule.registerHooks>[0]["resolve"]>>;
type Resolved = ReturnType<Resolve[2]>;

/**
 * The process-wide half: installed once, by whichever copy of this file runs first (the
 * runtime's own bundle, or a pushed platform's), and holding nothing but a slot. What it does
 * on a failed resolution is the `retry` the LATEST caller put there — so the policy travels by
 * push like the rest of this file, while Node's hook chain gets exactly one entry.
 */
const HOST_LENDING = Symbol.for("penguin.plugins.hostLending");
interface HostLending {
  installed: boolean;
  /** `file:` URLs of plugin stores, each ending in a separator. */
  roots: Set<string>;
  retry: (specifier: string, context: Resolve[1], next: Resolve[2], err: unknown) => Resolved;
}

/**
 * Lets a plugin loaded from `root`'s store resolve a host package the way the running program
 * does. A plugin imported through a generation's link runs from its store entry, and Node
 * resolves its imports from there — under the data root, where no `node_modules` holds the
 * host's SDK; from the installation's prefix it used to find the program's copy by walking up.
 * Only a HOST_PACKAGES import the plugin's own package cannot resolve is retried, from the
 * program's entry (`process.argv[1]`, its links resolved: from the Docker image's
 * `/usr/local/bin/penguin` no `node_modules` holds the SDK); anything the package carries
 * itself wins. A runtime
 * without `module.registerHooks` logs once and resolves as Node does.
 */
export function lendHostPackages(root: string): void {
  const g = globalThis as { [HOST_LENDING]?: HostLending };
  const slot = (g[HOST_LENDING] ??= {
    installed: false,
    roots: new Set(),
    retry: (_s, _c, _n, err) => {
      throw err;
    },
  });
  slot.roots.add(pathToFileURL(path.join(pluginStoreDir(root), path.sep)).href);
  slot.retry = (specifier, context, next, err) => {
    const parent = context.parentURL;
    const entry = programEntry();
    if (
      (err as { code?: string }).code !== "ERR_MODULE_NOT_FOUND" ||
      !HOST_PACKAGES.test(specifier) ||
      parent === undefined ||
      typeof entry !== "string" ||
      ![...slot.roots].some((r) => parent.startsWith(r))
    ) {
      throw err;
    }
    return next(specifier, { ...context, parentURL: pathToFileURL(entry).href });
  };
  if (slot.installed) return;
  slot.installed = true;
  const register = (nodeModule as { registerHooks?: typeof nodeModule.registerHooks })
    .registerHooks;
  if (typeof register !== "function") {
    console.warn(
      "[plugins] this Node has no module.registerHooks: a stored plugin that keeps the host SDK external will not resolve it",
    );
    return;
  }
  register({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        return slot.retry(specifier, context, nextResolve, err);
      }
    },
  });
}
