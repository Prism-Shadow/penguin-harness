/**
 * Where a machine's plugins are: prefixes, each `<dir>/node_modules/<name>/` holding a package
 * unpacked from its npm tarball, with `.integrity` beside its package.json recording that
 * tarball's integrity, and an `index.json` of what the prefix carries or lists. Two are read:
 *
 *   - the running build's (`buildPrefix`): the push's `plugins/` when one is committed, else
 *     the installation's, one directory above the program's real entry;
 *   - the data root's, `<root>/plugins/` (`pluginsPrefix`), where downloads go (plugin/install.ts).
 *
 * A plugin stays in the prefix it arrived in; nothing is copied between them except when a
 * retained push is about to take the last copy with it (plugin/install.ts `adoptRetained`).
 * Design: PRFC-0006.
 */
import fs from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";
import { pickEntry } from "../api/plugin-pick.js";
import type { PluginAsk } from "../api/plugin-pick.js";
import { INDEX_FILE, INTEGRITY, INTEGRITY_FILE } from "../../../../scripts/plugin-entry.mjs";

/** `<root>/plugins`: the prefix downloads are unpacked into. */
export function pluginsPrefix(root: string): string {
  return path.join(root, "plugins");
}

/**
 * The program's entry file with its links resolved: the Docker image and npm's global `bin/`
 * start the program through a link, and the installation is where the target sits.
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
 * The running build's prefix: the push's when its assets carry one, else the installation's —
 * the first of them holding an `index.json`. Null when neither does (a server run from source
 * before its dev build staged one).
 */
export function buildPrefix(
  assetsDir: string | null,
  entry: string | undefined = process.argv[1],
): string | null {
  const candidates: string[] = [];
  if (assetsDir !== null) candidates.push(path.join(unpackedAssetsDir(assetsDir), "plugins"));
  const program = programEntry(entry);
  if (program !== undefined) candidates.push(path.join(path.dirname(program), "..", "plugins"));
  return candidates.find((dir) => fs.existsSync(path.join(dir, INDEX_FILE))) ?? null;
}

/** A prefix's `index.json` as written (the registry validates it), or null when it has none. */
export function readPrefixIndex(dir: string): unknown[] | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, INDEX_FILE), "utf8");
  } catch {
    return null;
  }
  const rows = JSON.parse(text) as unknown;
  if (!Array.isArray(rows)) throw new Error(`${path.join(dir, INDEX_FILE)}: not an array`);
  return rows;
}

/** One package in a prefix, as the pick reads it. */
export interface LocalPackage {
  name: string;
  version: string;
  /** The tarball's integrity it was unpacked from; absent for a package `npm install` put there. */
  integrity?: string;
  dir: string;
}

/** A bare package name, scoped or not — never a subpath, a path, a URL or a version range. */
export const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** The directory a package name has under a prefix. */
export function packageDir(prefix: string, name: string): string {
  return path.join(prefix, "node_modules", ...name.split("/"));
}

/** The package `name` under `prefix`, or null when there is none (or its package.json is unreadable). */
export function localPackage(prefix: string, name: string): LocalPackage | null {
  const dir = packageDir(prefix, name);
  let version: unknown;
  try {
    version = (
      JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
        version?: unknown;
      }
    ).version;
  } catch {
    return null;
  }
  if (typeof version !== "string") return null;
  let integrity: string | undefined;
  try {
    const text = fs.readFileSync(path.join(dir, INTEGRITY_FILE), "utf8").trim();
    if (INTEGRITY.test(text)) integrity = text;
  } catch {
    // Not recorded: loadable by version, never by a pin.
  }
  return { name, version, ...(integrity !== undefined ? { integrity } : {}), dir };
}

/** A prefix a load looks in; `builtin` marks the build's, preferred within one version. */
export interface PluginBase {
  dir: string;
  builtin: boolean;
}

/** Where a load looks: the data root's prefix and the running build's. */
export function pluginBases(root: string | undefined, assetsDir: string | null): PluginBase[] {
  const bases: PluginBase[] = [];
  if (root !== undefined && root !== "") bases.push({ dir: pluginsPrefix(root), builtin: false });
  const build = buildPrefix(assetsDir);
  if (build !== null) bases.push({ dir: build, builtin: true });
  return bases;
}

/**
 * The package `asks` resolve `name` to among the bases (`pickEntry`): a pin takes that content
 * only; otherwise the highest version every ask admits, the build's within one version.
 */
export function pickLocal(
  bases: readonly PluginBase[],
  name: string,
  asks: readonly PluginAsk[] = [],
): (LocalPackage & { base: PluginBase }) | { refused: string } {
  const found = bases.flatMap((base) => {
    const p = localPackage(base.dir, name);
    return p === null ? [] : [{ ...p, base }];
  });
  return pickEntry(found, name, asks, {
    where: "this machine's plugins",
    preferred: (p) => p.base.builtin,
    checked: false,
  });
}

/** Every package name under a prefix's `node_modules`, scoped or not, sorted. */
export function prefixNames(prefix: string): string[] {
  const top = path.join(prefix, "node_modules");
  const dirs = (dir: string) => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch {
      return [];
    }
  };
  const out: string[] = [];
  for (const name of dirs(top)) {
    if (name.startsWith("@")) out.push(...dirs(path.join(top, name)).map((n) => `${name}/${n}`));
    else out.push(name);
  }
  return out.sort();
}

/**
 * The names the running build carries — listed in its index and unpacked beside it — so that
 * enabling one needs no download. A name it only lists (the CLI's npm package) is not here.
 */
export function shippedNames(assetsDir: string | null): string[] {
  const prefix = buildPrefix(assetsDir);
  if (prefix === null) return [];
  let rows: unknown[] | null;
  try {
    rows = readPrefixIndex(prefix);
  } catch {
    return [];
  }
  const listed = new Set(
    (rows ?? []).map((r) => (r as { name?: unknown })?.name).filter((n) => typeof n === "string"),
  );
  return prefixNames(prefix).filter((n) => listed.has(n));
}

/**
 * The packages the HOST lends a plugin rather than the plugin shipping them: the SDK a plugin's
 * bundle keeps external (discord-bot imports `@prismshadow/penguin-core` at run time).
 */
const HOST_PACKAGES = /^@prismshadow\/penguin-core(\/|$)/;

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
  /** `file:` URLs of plugin prefixes, each ending in a separator. */
  roots: Set<string>;
  retry: (specifier: string, context: Resolve[1], next: Resolve[2], err: unknown) => Resolved;
}

/**
 * Lets a plugin under the data root's prefix import the host SDK: nothing above the data root
 * holds it, so a HOST_PACKAGES import the plugin cannot resolve itself is retried from the
 * program's real entry. Anything the plugin carries wins. Without `module.registerHooks`: logs
 * once.
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
  slot.roots.add(pathToFileURL(path.join(pluginsPrefix(root), path.sep)).href);
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
      "[plugins] this Node has no module.registerHooks: a downloaded plugin that keeps the host SDK external will not resolve it",
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
