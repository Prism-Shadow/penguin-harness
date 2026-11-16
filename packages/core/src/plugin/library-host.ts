/**
 * Where the plugin library is on this machine: the packages a host package's dependencies name
 * (the shipped library), and the ones an operator installed into the server's plugin prefix.
 *
 * A plugin is its own npm package (`@penguinharness/<name>`, `plugins/<name>/` in the repo). The
 * host package is the one whose `dependencies` name them — the server, the CLI and the desktop
 * app each list the shipped set; core does not (a plugin builds against core, so core naming them
 * would be a cycle). Each is resolved through Node from the host, so the lookup walks the same
 * `node_modules` chain a `require` from there would — the workspace, an npm install, the packed
 * desktop app and the program a hot-pushed platform booted from all land on their own copy — and
 * a workspace checkout is redirected to its `plugins/<name>/` directory (workspacePluginRoot).
 * Read fresh on every call, like the plugin files themselves.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PLUGIN_NAME_PATTERN, unscopedPackageName } from "./package-json.js";
import { hasLibraryContributions } from "./kinds.js";
import { readPluginTable } from "./table.js";
import type { PluginTable } from "./table.js";

/** npm-name prefix of the per-plugin packages (the host package's dependencies name them). */
export const PLUGIN_PKG_PREFIX = "@penguinharness/";

/** Where one library plugin is read from, and whether the operator installed it. */
export interface LibraryRoot {
  dir: string;
  packageName: string;
  installed: boolean;
}

/**
 * What has been said about installed packages, so a listing — read on every request — says each
 * thing once per process rather than on every page load.
 */
const warned = new Set<string>();

/** console.warn, once per distinct message. */
export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * The pnpm workspace root above `from`, or null outside a workspace checkout: the directory
 * holding `pnpm-workspace.yaml`. An npm install and the packed desktop app have none above
 * them, which is what keeps the workspace preference below out of their way.
 */
function workspaceRootAbove(from: string): string | null {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The directory a plugin is read from, given where Node resolved its package: in a workspace
 * checkout, the repo's own `plugins/<name>/` whenever it holds that package; the resolved
 * directory otherwise.
 *
 * The workspace installs every `workspace:*` package as an injected copy (a snapshot pnpm
 * takes at install time and refreshes only after the package's `build` script runs), so
 * `require.resolve` lands on a copy that misses every file edited since the last build, and a
 * skill's edited `version` stays invisible to a running `pnpm dev`. The plugin directory itself
 * is the source of truth in a checkout, so that is what a checkout reads; nothing changes for an
 * npm install or the packed desktop app, which have no workspace file above them and keep
 * resolving their own copy.
 */
export function workspacePluginRoot(
  name: string,
  resolvedDir: string,
  packageRoot: string,
): string {
  const workspace = workspaceRootAbove(packageRoot);
  if (workspace === null) return resolvedDir;
  const candidate = path.join(workspace, "plugins", name);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8")) as {
      name?: unknown;
    };
    return manifest.name === `${PLUGIN_PKG_PREFIX}${name}` ? candidate : resolvedDir;
  } catch {
    return resolvedDir;
  }
}

/** A host package: its root, and a `require` that resolves the way one from there would. */
interface HostPackage {
  root: string;
  require: NodeJS.Require;
}

const LOADER_DIR = path.dirname(fileURLToPath(import.meta.url));

function programDir(): string | null {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return null;
  const resolved = path.resolve(entry);
  // A package manager's bin is a symlink into the installation it belongs to.
  try {
    return path.dirname(fs.realpathSync(resolved));
  } catch {
    return path.dirname(resolved);
  }
}

/**
 * The library a hot push carried, when there is one (see {@link usePushedPluginLibrary}). It
 * outranks every other place: the plugins a pushed platform offers are the ones it was BUILT
 * with, not the ones installed beside whatever program happened to boot it.
 */
let pushedLibrary: string | null = null;

/** The host package an embedder named (see {@link useLibraryHost}). */
let namedHost: string | null = null;

let host: HostPackage | null | undefined;

/**
 * Points the library at the copy a hot push carried in its assets: a directory holding a
 * `package.json` whose `dependencies` name the plugin packages, and their `node_modules`.
 * `null` goes back to the other places.
 *
 * Without it a pushed platform reads the library of the program that booted it — so a machine
 * installed before a plugin existed never gets that plugin, however new its platform is, and
 * a feature that seeds an Agent with it fails with "not in the plugin library". (Creating an
 * organization installs `agent-company` on its CEO; on a program that predates company mode
 * that was every attempt.) Called by the platform at boot, before anything reads the library.
 */
export function usePushedPluginLibrary(dir: string | null): void {
  pushedLibrary = dir;
  host = undefined;
}

/**
 * Names the host package: the directory whose `package.json` `dependencies` are the library —
 * all of it, whatever they name, none included. The server names its own package at boot; an SDK
 * embedder with a library of its own names its package. `null` forgets it. A pushed library
 * (usePushedPluginLibrary) still comes first.
 */
export function useLibraryHost(dir: string | null): void {
  namedHost = dir;
  host = undefined;
}

/** From `start` upward, the first package.json whose `dependencies` name a plugin package. */
function hostPackageAbove(start: string): HostPackage | null {
  for (let dir = start; ;) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const candidate: HostPackage = { root: dir, require: createRequire(file) };
      try {
        if (Object.keys(readDependencies(candidate)).some((d) => d.startsWith(PLUGIN_PKG_PREFIX)))
          return candidate;
      } catch {
        // Unreadable or malformed: walk on.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The host package, in this order: the library a hot push carried (usePushedPluginLibrary); the
 * package an embedder named (useLibraryHost); then two fixed starting points, each walked upward
 * to the first package.json that names a plugin package:
 *
 * 1. the installation this module sits in — the bundling package's own root wherever core is
 *    inlined (the CLI bundle, the desktop server bundle);
 * 2. the installation of the running program (`process.argv[1]`, symlinks resolved).
 *
 * A package.json on the way up that does not name a plugin package is skipped, and so is one
 * that cannot be read or parsed (somebody else's file, not this one's answer). There is no
 * fallback to whichever package.json was read first: when no place leads to a host, the library
 * call fails naming them — an SDK embedder that names no host has no library, and seeding an
 * Agent from it fails rather than installing nothing.
 *
 * Determined on first use and never at import: the bundle has to LOAD on a machine that has
 * no host package, and the library call is then what fails.
 */
function hostPackage(): HostPackage {
  const program = programDir();
  if (host === undefined) host = findHost(program);
  if (host === null) {
    throw new Error(
      `No plugin library: no host package was named (useLibraryHost), and no package.json naming a ${PLUGIN_PKG_PREFIX} plugin package is above the plugin loader at ${LOADER_DIR}` +
        (program === null
          ? " (no running program to look above: process.argv[1] is empty)"
          : ` or above the program at ${program}`),
    );
  }
  return host;
}

/** The first of the places hostPackage names that leads to a host, or null. */
function findHost(program: string | null): HostPackage | null {
  if (pushedLibrary !== null) {
    const pushed = hostPackageAbove(pushedLibrary);
    if (pushed !== null) return pushed;
  }
  if (namedHost !== null) {
    const file = path.join(namedHost, "package.json");
    if (!fs.existsSync(file)) {
      throw new Error(`The plugin library's host package ${namedHost} has no package.json`);
    }
    return { root: namedHost, require: createRequire(file) };
  }
  return hostPackageAbove(LOADER_DIR) ?? (program === null ? null : hostPackageAbove(program));
}

/** The host package's `dependencies`, read fresh — the same file its own `require` resolves from. */
function readDependencies(pkg: HostPackage): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(path.join(pkg.root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return parsed.dependencies ?? {};
}

/** The shipped plugins' roots, name → root: every `@penguinharness/*` dependency of the host, resolved through Node. */
function pluginRoots(): Map<string, LibraryRoot> {
  const roots = new Map<string, LibraryRoot>();
  const pkg = hostPackage();
  for (const dep of Object.keys(readDependencies(pkg))) {
    if (!dep.startsWith(PLUGIN_PKG_PREFIX)) continue;
    let manifest: string;
    try {
      manifest = pkg.require.resolve(`${dep}/package.json`);
    } catch (err) {
      // A declared plugin that Node cannot find is a broken install (the deployment did not
      // carry the package), not a smaller library.
      throw new Error(
        `Plugin package ${dep} is declared in ${pkg.root}/package.json but cannot be resolved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const name = dep.slice(PLUGIN_PKG_PREFIX.length);
    roots.set(name, {
      dir: workspacePluginRoot(name, path.dirname(manifest), pkg.root),
      packageName: dep,
      installed: false,
    });
  }
  return roots;
}

/**
 * The data root's plugin prefix (`<root>/plugins`, an npm prefix), when the server named one.
 * Null — the default, and what a CLI or a test without a server has — reads the shipped
 * library alone.
 */
let installedPrefix: string | null = null;

/**
 * Lets the library list what the operator installed on the server: the packages the prefix's
 * own package.json depends on (what `npm install` put there by name, link or uploaded zip —
 * not the dependencies npm installed beside them) that are library plugins (isLibraryPackage).
 * Called by the server at boot, with the prefix its installs write to.
 */
export function useInstalledPluginPrefix(dir: string | null): void {
  installedPrefix = dir;
}

/** Whether an unbuilt package still carries a manifest the library no longer reads: a `penguin` block in its package.json, or a plugin.json. */
function retiredManifest(dir: string): boolean {
  if (fs.existsSync(path.join(dir, "plugin.json"))) return true;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as unknown;
    return raw !== null && typeof raw === "object" && "penguin" in raw;
  } catch {
    return false;
  }
}

/**
 * The installed library plugins, name → root. A name the build ships stays the build's, and of
 * two installed packages under one name (`@a/x`, `@b/x`) the first in name order is listed. A
 * package without a table that still carries the retired `penguin` manifest is left out with one
 * warning saying so (no compatibility, user decision 2026-11-04), and so is one whose table will
 * not read.
 */
function installedPluginRoots(shipped: ReadonlyMap<string, LibraryRoot>): Map<string, LibraryRoot> {
  const roots = new Map<string, LibraryRoot>();
  if (installedPrefix === null) return roots;
  let deps: Record<string, unknown>;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(installedPrefix, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, unknown> };
    deps = manifest.dependencies ?? {};
  } catch {
    // No prefix yet (nothing was ever installed), or one npm will rewrite: nothing to list.
    return roots;
  }
  for (const packageName of Object.keys(deps).sort()) {
    const name = unscopedPackageName(packageName);
    if (!PLUGIN_NAME_PATTERN.test(name) || shipped.has(name) || roots.has(name)) continue;
    const dir = path.join(installedPrefix, "node_modules", ...packageName.split("/"));
    let table: PluginTable | null;
    try {
      table = readPluginTable(dir);
    } catch (err) {
      warnOnce(
        `[plugins] ${packageName} is installed but not listed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (table === null) {
      if (retiredManifest(dir)) {
        warnOnce(
          `[plugins] ${packageName} uses the retired \`penguin\` manifest and is not listed: port it again with the plugin-porting Skill`,
        );
      }
      continue;
    }
    if (!hasLibraryContributions(table)) continue;
    roots.set(name, { dir, packageName, installed: true });
  }
  return roots;
}

/** Every library plugin's root: the shipped ones, then the installed ones. */
export function libraryRoots(): Map<string, LibraryRoot> {
  const shipped = pluginRoots();
  return new Map([...shipped, ...installedPluginRoots(shipped)]);
}
