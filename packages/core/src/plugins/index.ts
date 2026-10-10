/**
 * PenguinHarness plugin library: the built-in plugins and the loader that reads them (part
 * of core — hooks, skills and their loading all live in one SDK).
 *
 * A plugin is its own npm package (`@penguinharness/<name>`, `plugins/<name>/` in the repo;
 * resolved through Node from the host package's dependency list — see pluginRoots): a
 * directory carrying a `plugin.json` manifest, an `icon.svg` beside it (every built-in plugin
 * ships one; it is the icon of everything the plugin ships), and any of two kinds of content:
 * skills (`skills/<name>/SKILL.md`, installed into an Agent's `agent_state/skills/`) and a
 * hook package (`hooks/*.mjs`, installed into `agent_state/hooks/<plugin>/` together with a
 * generated `hooks.json`). The files are the runtime source of truth — read and parsed on
 * every call, no caching (files are small, calls are infrequent) — so editing a file takes
 * effect immediately. They are committed content reached through declared dependencies, so
 * anything that fails to load is a broken install or a broken plugin and throws with the
 * path — never a silently smaller library. Only the category manifest (id and titles) is
 * code; install / uninstall / scan live in core's state layer.
 *
 * A plugin's version is its npm version: the `version` of the `package.json` beside
 * `plugin.json`, which follows the release. Dated versions, `YYYY.MM.DD.N` (see
 * PLUGIN_VERSION_PATTERN, parsePluginVersion and comparePluginVersions), belong to what an Agent
 * may edit locally once installed: each skill carries its own in its SKILL.md frontmatter, and a
 * hook package carries `plugin.json`'s `hooks.version`, which the installer writes into
 * hooks.json. A `version` left in plugin.json is ignored. plugin.json holds the rest of the
 * metadata: a library SKILL.md's frontmatter carries `name`, `description` and `version`, and the
 * loader stamps the plugin's UI short descriptions into each skill's metadata and installable
 * content (the installed copy carries the full frontmatter, generated — the way hooks.json is).
 *
 * Besides the packages this build ships, the library lists what the operator installed on the
 * server: the packages of the data root's plugin prefix (see useInstalledPluginPrefix) that carry
 * a plugin.json beside skills or a hook package. Those are the operator's, not the build's, so
 * one that will not read is left out with a warning instead of failing the library.
 *
 * Docs: packages/docs/content/skills.{zh,en}.md (site path /docs/skills) documents the plugin
 * format, the versions and the built-in library.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/** A skill's metadata. A library SKILL.md's frontmatter carries `name`, `description` and the skill's own `version`; the short descriptions are stamped from plugin.json by the loader (installed copies then carry the full generated frontmatter, which is what the installed-side readers parse). */
export interface SkillMetadata {
  /** Skill name (matches its containing directory name). */
  name: string;
  /** One-line description; injected into the model prompt via `{{SKILL_METADATA}}`. */
  description: string;
  /** UI short description (frontmatter `short_description`, optional): preferred in compact spots like cards, falls back to the full description if missing; not injected into the prompt. */
  shortDescription?: string;
  /** Chinese short description (frontmatter `short_description_zh`, optional). */
  shortDescriptionZh?: string;
  /** The skill's own version, `YYYY.MM.DD.N` (an installed copy may still carry the legacy `YYYY-MM-DD.N`); an absent or malformed frontmatter version reads as "" (older than any real version). A library skill always carries a real one. */
  version: string;
}

/** A skill in the library: metadata + full SKILL.md content (including frontmatter, written as-is on install). */
export interface LibrarySkill extends SkillMetadata {
  content: string;
  /** The plugin's raw `icon.svg`, stamped onto every skill by the loader — a skill has no icon of its own — and written as `icon.svg` beside SKILL.md on install, so the installed copy carries it; absent when the plugin ships none. */
  icon?: string;
  /**
   * Optional auxiliary files the SKILL.md references (e.g. `reference/API.md`), keyed by
   * POSIX-relative path within the skill directory; every entry except the top-level SKILL.md
   * (its own field) and a top-level icon.svg (reserved: the plugin's icon is what installs
   * there). Written alongside SKILL.md on install (subdirectories preserved). Read as UTF-8
   * text — library content is committed text; the field is omitted when a skill has no extra
   * files.
   */
  files?: Record<string, string>;
}

/**
 * When a `user_prompt` command runs: `prompt` on every Prompt the user submits, `host` only
 * when the host starts the package's flow by name (`Session.runUserPromptHook` — goal mode's
 * start). Meaningless at the other hook points.
 */
export type UserPromptTrigger = "prompt" | "host";

/** One hook script entry: `command` is a path relative to the plugin's `hooks/` directory, run with Node; `timeout` in seconds (core's default applies when absent); `trigger` says when a `user_prompt` command runs (see {@link userPromptTrigger} for the default). */
export interface HookCommand {
  command: string;
  timeout?: number;
  trigger?: UserPromptTrigger;
}

/**
 * The manifest an installed hook package carries (`agent_state/hooks/<plugin>/hooks.json`),
 * generated by the installer from plugin.json: identity and display fields plus one script
 * list per hook point (`stop`, `pre_tool_use`, `user_prompt`). Whether a Session runs hooks
 * at all is an Agent-level decision (`hooks.enabled` in system_config.yaml), not a per-package
 * one. The plugin's icon is not part of it: the installer writes `icon.svg` beside the
 * manifest instead. Unknown keys are ignored rather than rejected.
 */
export interface HookManifest {
  name: string;
  description: string;
  description_zh?: string;
  /** The package's own version, `YYYY.MM.DD.N` — a library plugin's `hooks.version` (an installed copy may carry the legacy `YYYY-MM-DD.N`, a hand-written one anything). */
  version: string;
  /** Stop commands, consulted after every Task of a run. */
  stop: HookCommand[];
  /** Pre-tool-use commands, consulted before each tool call's approval. */
  pre_tool_use: HookCommand[];
  /** User-prompt expansion commands: run on every Prompt the user submits, or — `trigger: "host"` — only when the host starts the flow the package owns (goal mode's start). */
  user_prompt: HookCommand[];
}

/** A plugin's hook package as read from the library: the manifest to install and the `hooks/` files (relative path → text). */
export interface LibraryHooks {
  manifest: HookManifest;
  files: Record<string, string>;
}

/**
 * A plugin's quick start (plugin.json `quick_start`): the demo a person runs to see what the
 * plugin does — a prompt the Plugins page pre-fills into a new-chat draft, never sends.
 */
export interface QuickStart {
  prompt: string;
  promptZh?: string;
  /** Skills of this plugin to pre-select in the draft. */
  skills?: string[];
  /** Open the draft in goal mode (the prompt is the objective). */
  goal?: boolean;
}

/** A plugin in the library: the manifest fields plus the content it ships. */
export interface LibraryPlugin {
  /** Plugin name: its package name without the scope (`a2ui` for `@penguinharness/a2ui`). */
  name: string;
  /** The npm package the plugin is, e.g. `@penguinharness/a2ui`. */
  packageName: string;
  /** `installed` for a package the operator installed on the server (see useInstalledPluginPrefix); absent for one this build ships. */
  source?: "installed";
  /** English one-line description (plugin.json `description`). */
  description: string;
  /** Chinese description (plugin.json `description_zh`, optional). */
  descriptionZh?: string;
  /** UI short descriptions (plugin.json `short_description(_zh)`, optional). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /**
   * The plugin's npm version: `package.json`'s `version`, beside plugin.json (it follows the
   * release). What an installed copy is compared against is not this but the dated version of
   * each part — every skill's, and the hook package's (see pluginContentVersion).
   */
  version: string;
  /** Category id (see PLUGIN_CATEGORIES); absent or unknown → the "other" group. */
  category?: string;
  /** Whether default_agent gets this plugin at creation (plugin.json `preinstall`, default true; always false for an installed package — the operator chose it for the server, not for every new Project). */
  preinstall: boolean;
  /** Raw `icon.svg` beside plugin.json — every built-in plugin ships one. It is the icon of everything the plugin ships: stamped onto each skill and written beside an installed hook package. */
  icon?: string;
  skills: LibrarySkill[];
  hooks?: LibraryHooks;
  /** The demo the Plugins page's quick start pre-fills (plugin.json `quick_start`, optional). */
  quickStart?: QuickStart;
}

/** Category manifest entry: id and titles (Chinese optional, displayed per UI language). */
export interface PluginCategory {
  id: string;
  title: string;
  titleZh?: string;
}

/** Grouping result: category metadata + member plugins read from library files. */
export interface ResolvedPluginGroup extends PluginCategory {
  plugins: LibraryPlugin[];
}

/** Character rule for plugin, skill and hook names (directory names): prevents path traversal (exported for the server's archive-install validation). */
export const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Dated version format: a dotted date and a sequence number, e.g. `2026.08.29.1`. What every library skill and hook package must carry. */
export const PLUGIN_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

/** The spelling used before this format, `2026-08-29.1`: still read wherever an installed copy carries it (see parsePluginVersion). */
const LEGACY_PLUGIN_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/**
 * Reads either spelling of a version — the current `YYYY.MM.DD.N` and the legacy
 * `YYYY-MM-DD.N` — into the date and sequence number both denote, or null when the string is
 * not a version at all. The two spellings of one version parse to the same key, so a copy
 * installed before the rename compares equal to the library's copy of that same version:
 * installed copies predate the rename, and reinstalling every one of them over a spelling
 * would put noise in the update badges instead of information.
 */
export function parsePluginVersion(version: string): { date: string; seq: number } | null {
  if (!PLUGIN_VERSION_PATTERN.test(version) && !LEGACY_PLUGIN_VERSION_PATTERN.test(version)) {
    return null;
  }
  const dot = version.lastIndexOf(".");
  return { date: version.slice(0, dot).replace(/-/g, "."), seq: Number(version.slice(dot + 1)) };
}

/**
 * Orders two versions: by date, then by sequence number (numeric, so `.10` follows `.9`). Both
 * spellings are read (see parsePluginVersion), so the legacy and current spellings of one
 * version compare equal. A string that is not a version (the empty string an unversioned
 * install reads as, a legacy natural number) sorts before every real version, so anything in
 * the library counts as newer.
 */
export function comparePluginVersions(a: string, b: string): number {
  const va = parsePluginVersion(a);
  const vb = parsePluginVersion(b);
  if (!va || !vb) return Number(va !== null) - Number(vb !== null);
  if (va.date !== vb.date) return va.date < vb.date ? -1 : 1;
  return va.seq - vb.seq;
}

/**
 * The newest dated version among a library plugin's parts — its skills and its hook package:
 * the date of the last change to what an install writes. Only a label (the update badge's
 * "which update" and the update dialog's "new"); whether an installed copy is behind is decided
 * part by part. "" for a plugin with no parts.
 */
export function pluginContentVersion(plugin: Pick<LibraryPlugin, "skills" | "hooks">): string {
  let newest = "";
  for (const version of [
    ...plugin.skills.map((s) => s.version),
    ...(plugin.hooks !== undefined ? [plugin.hooks.manifest.version] : []),
  ]) {
    if (comparePluginVersions(version, newest) > 0) newest = version;
  }
  return newest;
}

/**
 * The first manifest version written for a harness that runs `user_prompt` commands on every
 * Prompt. See {@link userPromptTrigger}.
 */
export const USER_PROMPT_EVERY_PROMPT_SINCE = "2026.09.29.1";

/**
 * When one `user_prompt` command of a manifest runs. A command that says so decides; one
 * that does not runs on every Prompt.
 *
 * COMPAT (remove at 0.3.0 release preparation; the release notes must first require
 * updating the goal plugin): the point used to be reached by name only, and the goal
 * package installed before this version starts an unbudgeted goal whenever its `start.mjs`
 * runs without a budget. A manifest carrying a real plugin version older than
 * {@link USER_PROMPT_EVERY_PROMPT_SINCE} therefore keeps the by-name reading for the
 * commands that name no trigger. A manifest with no version, or one that is not a plugin
 * version (a hand-written package), is not affected.
 */
export function userPromptTrigger(
  manifestVersion: string,
  command: HookCommand,
): UserPromptTrigger {
  if (command.trigger !== undefined) return command.trigger;
  return predatesEveryPromptHooks(manifestVersion) ? "host" : "prompt";
}

/** Whether a manifest version is a real plugin version from before `user_prompt` commands ran on every Prompt (the compatibility rule of {@link userPromptTrigger}). */
export function predatesEveryPromptHooks(manifestVersion: string): boolean {
  return (
    parsePluginVersion(manifestVersion) !== null &&
    comparePluginVersions(manifestVersion, USER_PROMPT_EVERY_PROMPT_SINCE) < 0
  );
}

/**
 * Parses the frontmatter at the start of SKILL.md: only recognizes `key: value` lines inside the
 * first `---` block (split on the first colon, value trimmed, values may themselves contain colons);
 * all fields are scalars, no YAML dependency needed.
 * Error tolerance: returns null if the `---` block or name is missing; a version in neither the
 * current `YYYY.MM.DD.N` nor the legacy `YYYY-MM-DD.N` spelling reads as "".
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  // Strip a possible UTF-8 BOM (may be introduced by editors when manually editing an installed SKILL.md); CRLF is handled by \r?\n.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^﻿/, ""));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  const name = fields["name"];
  if (!name) return null;
  const version = fields["version"] ?? "";
  const shortDescription = fields["short_description"];
  const shortDescriptionZh = fields["short_description_zh"];
  return {
    name,
    description: fields["description"] ?? "",
    // short_description(_zh) is optional: omitted when absent (undefined keys aren't set).
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    // An installed copy may carry either spelling; both are real versions (see parsePluginVersion).
    version: parsePluginVersion(version) !== null ? version : "",
  };
}

/** npm-name prefix of the per-plugin packages (the host package's dependencies name them). */
const PLUGIN_PKG_PREFIX = "@penguinharness/";

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
 * takes at install time and refreshes only after the package's `build` script runs — which
 * plugins have none of), so `require.resolve` lands on a copy that misses every file added
 * since the last install, and a skill's edited `version` stays invisible to a running
 * `pnpm dev`. The plugin directory itself is the source of truth in a checkout, so that is
 * what a checkout reads; nothing changes for an npm install or the packed desktop app,
 * which have no workspace file above them and keep resolving their own copy.
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

/**
 * The host package: the package whose `dependencies` name the plugin packages. The library a
 * hot push carried comes first when the platform named one (usePushedPluginLibrary); then two
 * fixed starting points, tried in this order, each walked upward to the first package.json
 * that names a plugin package:
 *
 * 1. the installation this module sits in — `packages/core` from source or dist, the
 *    bundling package's own root wherever core is inlined (the CLI bundle, the desktop
 *    server bundle);
 * 2. the installation of the running program (`process.argv[1]`, symlinks resolved) — the
 *    one that matters for a hot-pushed platform bundle, which sits in the data root's store
 *    where nothing above it is a package, and whose plugins are the ones installed with the
 *    program that booted it.
 *
 * A package.json on the way up that does not name a plugin package is skipped, and so is
 * one that cannot be read or parsed (somebody else's file, not this one's answer); neither
 * stops the walk from reaching the host above it. There is no fallback to whichever
 * package.json was read first: when neither starting point leads to a host, the library
 * call fails naming both.
 *
 * Determined on first use and never at import: the bundle has to LOAD on a machine that has
 * no host package, and the library call is then what fails.
 */
interface HostPackage {
  root: string;
  /** Resolves the plugin packages the way a `require` from the host package would. */
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
 * outranks the other two places: the plugins a pushed platform offers are the ones it was
 * BUILT with, not the ones installed beside whatever program happened to boot it.
 */
let pushedLibrary: string | null = null;

/**
 * Points the library at the copy a hot push carried in its assets: a directory holding a
 * `package.json` whose `dependencies` name the plugin packages, and their `node_modules`.
 * `null` goes back to looking above this module and above the running program.
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

let host: HostPackage | null | undefined;
function hostPackage(): HostPackage {
  const program = programDir();
  if (host === undefined)
    host =
      (pushedLibrary === null ? null : hostPackageAbove(pushedLibrary)) ??
      hostPackageAbove(LOADER_DIR) ??
      (program === null ? null : hostPackageAbove(program));
  if (host === null) {
    throw new Error(
      `No package.json naming a ${PLUGIN_PKG_PREFIX} plugin package above the plugin loader at ${LOADER_DIR}` +
        (program === null
          ? " (no running program to look above: process.argv[1] is empty)"
          : ` or above the program at ${program}`),
    );
  }
  return host;
}

/** The host package's `dependencies`, read fresh — the same file its own `require` resolves from. */
function readDependencies(pkg: HostPackage): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(path.join(pkg.root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return parsed.dependencies ?? {};
}

/**
 * Where the plugin directories live, name → absolute root. Each plugin is its own npm package
 * (`@penguinharness/<name>`, `plugins/<name>/` in the repo): the host package's `dependencies`
 * name them (core, the CLI, and the desktop app — whose packaged manifest keeps that field
 * and nothing else, so `devDependencies` would not survive into an installer), and each is
 * resolved through Node from the host package (hostPackage), so the lookup walks the same
 * `node_modules` chain a `require` from there would: the workspace, an npm install, the
 * packed desktop app (electron-builder collects the declared packages into its node_modules)
 * and the program a hot-pushed platform booted from all land on their own copy, and a workspace
 * checkout is redirected to its `plugins/<name>/` directory (see workspacePluginRoot). Read
 * fresh on every call, like the plugin files themselves.
 */
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

/** Where one library plugin is read from, and whether the operator installed it. */
interface LibraryRoot {
  dir: string;
  packageName: string;
  installed: boolean;
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

/**
 * Whether a package directory is a library plugin: a plugin.json beside skills or a hook
 * package. A package of server modules carries a plugin.json too, for its card, and is not one —
 * it has nothing to install into an Agent.
 */
export function isLibraryPackage(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "plugin.json")) &&
    (fs.existsSync(path.join(dir, "skills")) || fs.existsSync(path.join(dir, "hooks")))
  );
}

/** The plugin name a package is listed under: its name without the scope. */
function unscoped(packageName: string): string {
  return packageName.slice(packageName.lastIndexOf("/") + 1);
}

/**
 * The installed library plugins, name → root. A name the build ships stays the build's, and of
 * two installed packages under one name (`@a/x`, `@b/x`) the first in name order is listed.
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
    const name = unscoped(packageName);
    if (!PLUGIN_NAME_PATTERN.test(name) || shipped.has(name) || roots.has(name)) continue;
    const dir = path.join(installedPrefix, "node_modules", ...packageName.split("/"));
    if (!isLibraryPackage(dir)) continue;
    roots.set(name, { dir, packageName, installed: true });
  }
  return roots;
}

/** Every library plugin's root: the shipped ones, then the installed ones. */
function libraryRoots(): Map<string, LibraryRoot> {
  const shipped = pluginRoots();
  return new Map([...shipped, ...installedPluginRoots(shipped)]);
}

/** Reads one root: a shipped plugin that will not read throws; an installed one is left out (null) with a warning. */
function readRoot(name: string, root: LibraryRoot): LibraryPlugin | null {
  if (!root.installed) return readPluginDir(name, root);
  try {
    return readPluginDir(name, root);
  } catch (err) {
    console.warn(
      `[plugins] ${root.packageName} is installed but not listed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Recursively collects a directory's files as text keyed by POSIX-relative path, skipping the
 * names in `except` at the top level. Symlinks and other non-regular entries are skipped.
 * Returns undefined when the directory has no such files.
 */
function readDirFiles(dir: string, except: readonly string[]): Record<string, string> | undefined {
  const files: Record<string, string> = {};
  const walk = (abs: string, rel: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(abs, entry.name), childRel);
      } else if (entry.isFile()) {
        if (rel === "" && except.includes(entry.name)) continue;
        files[childRel] = fs.readFileSync(path.join(abs, entry.name), "utf8");
      }
    }
  };
  walk(dir, "");
  return Object.keys(files).length > 0 ? files : undefined;
}

/**
 * Reads one skill directory: name from the directory (overriding frontmatter), SKILL.md verbatim,
 * and every other file as auxiliary content. The icon is not read here: a skill has none of
 * its own, and stampSkill gives it the plugin's. A library skill must carry its own dated
 * `version` in the current spelling — it is what an installed copy is compared against.
 */
function readSkillDir(dir: string, name: string): LibrarySkill {
  const file = path.join(dir, "SKILL.md");
  const content = fs.readFileSync(file, "utf8");
  const meta = parseSkillFrontmatter(content);
  if (!meta) throw new Error(`Library skill ${file} has no frontmatter with a name`);
  if (!PLUGIN_VERSION_PATTERN.test(meta.version)) {
    throw new Error(`Library skill ${file}: version must be YYYY.MM.DD.N`);
  }
  const files = readDirFiles(dir, ["SKILL.md", "icon.svg"]);
  return { ...meta, name, content, ...(files !== undefined ? { files } : {}) };
}

/**
 * Resolves a library skill against its plugin: the plugin's UI short descriptions are the
 * skill's, its icon becomes the skill's, and the installable `content` gets the full frontmatter
 * regenerated in canonical field order, carrying the skill's own `version` — the installed copy
 * is self-describing (update checks read its `version`, the UI its short descriptions and icon)
 * the same way an installed hook package's hooks.json is generated.
 */
function stampSkill(
  skill: LibrarySkill,
  plugin: {
    shortDescription?: string;
    shortDescriptionZh?: string;
    icon?: string;
  },
): LibrarySkill {
  const { shortDescription, shortDescriptionZh } = plugin;
  const front = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    ...(shortDescription !== undefined ? [`short_description: ${shortDescription}`] : []),
    ...(shortDescriptionZh !== undefined ? [`short_description_zh: ${shortDescriptionZh}`] : []),
    `version: ${skill.version}`,
    "---",
  ].join("\n");
  const body = skill.content.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---/, "");
  return {
    ...skill,
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
    content: `${front}${body}`,
  };
}

/**
 * The plugin.json shape: the plugin's metadata besides its version (see the module header). A
 * top-level `version`, which manifests carried before the npm version became the plugin's, is
 * ignored rather than refused, so a plugin written for an older harness still loads.
 */
interface PluginManifestFile {
  description: string;
  description_zh?: string;
  short_description?: string;
  short_description_zh?: string;
  category?: string;
  /** Default true. */
  preinstall?: boolean;
  quick_start?: { prompt?: unknown; prompt_zh?: unknown; skills?: unknown; goal?: unknown };
  /** The hook package: its dated version and one command list per hook point it answers at. */
  hooks?: {
    /** `YYYY.MM.DD.N`, required when the plugin ships `hooks/`; the installer writes it into hooks.json. */
    version?: string;
    stop?: HookCommand[];
    pre_tool_use?: HookCommand[];
    user_prompt?: HookCommand[];
  };
}

/** The `version` of the plugin's own npm manifest, the `package.json` beside plugin.json. */
function readPackageVersion(dir: string): string {
  const file = path.join(dir, "package.json");
  const version = (JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown }).version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`${file}: the plugin's package carries no version`);
  }
  return version;
}

/** Reads one plugin directory. */
function readPluginDir(name: string, root: LibraryRoot): LibraryPlugin {
  const { dir } = root;
  const manifestFile = path.join(dir, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as PluginManifestFile;
  const {
    description,
    description_zh: descriptionZh,
    short_description: shortDescription,
    short_description_zh: shortDescriptionZh,
  } = manifest;
  const version = readPackageVersion(dir);
  const skills: LibrarySkill[] = [];
  const skillsDir = path.join(dir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory())
        skills.push(readSkillDir(path.join(skillsDir, entry.name), entry.name));
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
  }
  let icon: string | undefined;
  try {
    icon = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
  } catch {
    // Built-in plugins all ship one; a plugin without it falls back to the kind's glyph in the UI.
  }
  const hooksDir = path.join(dir, "hooks");
  const hookFiles = fs.existsSync(hooksDir) ? readDirFiles(hooksDir, []) : undefined;
  let hooks: LibraryHooks | undefined;
  if (hookFiles !== undefined) {
    // The package's own dated version: what an installed hooks.json is compared against.
    const hooksVersion = manifest.hooks?.version;
    if (typeof hooksVersion !== "string" || !PLUGIN_VERSION_PATTERN.test(hooksVersion)) {
      throw new Error(`${manifestFile}: hooks.version must be YYYY.MM.DD.N, got ${hooksVersion}`);
    }
    hooks = {
      manifest: {
        name,
        description,
        ...(descriptionZh !== undefined ? { description_zh: descriptionZh } : {}),
        version: hooksVersion,
        stop: manifest.hooks?.stop ?? [],
        pre_tool_use: manifest.hooks?.pre_tool_use ?? [],
        user_prompt: manifest.hooks?.user_prompt ?? [],
      },
      files: hookFiles,
    };
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`${manifestFile}: description must be a non-empty string`);
  }
  return {
    name,
    packageName: root.packageName,
    ...(root.installed ? { source: "installed" as const } : {}),
    description,
    ...(descriptionZh !== undefined ? { descriptionZh } : {}),
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    version,
    ...(manifest.category !== undefined ? { category: manifest.category } : {}),
    preinstall: !root.installed && manifest.preinstall !== false,
    ...(icon !== undefined ? { icon } : {}),
    skills: skills.map((skill) =>
      stampSkill(skill, {
        ...(shortDescription !== undefined ? { shortDescription } : {}),
        ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
        ...(icon !== undefined ? { icon } : {}),
      }),
    ),
    ...(hooks !== undefined ? { hooks } : {}),
    ...(manifest.quick_start !== undefined
      ? { quickStart: parseQuickStart(manifest.quick_start, skills, manifestFile) }
      : {}),
  };
}

/**
 * plugin.json `quick_start`, checked: a prompt is required, and the skills it pre-selects
 * must be this plugin's own — a demo naming a skill the plugin does not ship would open a draft
 * with nothing selected.
 */
function parseQuickStart(
  raw: NonNullable<PluginManifestFile["quick_start"]>,
  skills: readonly LibrarySkill[],
  where: string,
): QuickStart {
  if (typeof raw.prompt !== "string" || raw.prompt.trim() === "") {
    throw new Error(`${where}: quick_start.prompt must be a non-empty string`);
  }
  if (raw.prompt_zh !== undefined && typeof raw.prompt_zh !== "string") {
    throw new Error(`${where}: quick_start.prompt_zh must be a string`);
  }
  let picked: string[] | undefined;
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills) || raw.skills.some((s) => typeof s !== "string")) {
      throw new Error(`${where}: quick_start.skills must be a list of skill names`);
    }
    const unknown = (raw.skills as string[]).filter((n) => !skills.some((s) => s.name === n));
    if (unknown.length > 0) {
      throw new Error(
        `${where}: quick_start.skills names skills the plugin does not ship: ${unknown.join(", ")}`,
      );
    }
    picked = raw.skills as string[];
  }
  if (raw.goal !== undefined && typeof raw.goal !== "boolean") {
    throw new Error(`${where}: quick_start.goal must be a boolean`);
  }
  return {
    prompt: raw.prompt,
    ...(typeof raw.prompt_zh === "string" ? { promptZh: raw.prompt_zh } : {}),
    ...(picked !== undefined ? { skills: picked } : {}),
    ...(raw.goal === true ? { goal: true } : {}),
  };
}

/** Reads every plugin in the library (one per plugin package: the shipped ones, see pluginRoots, and the installed ones, see useInstalledPluginPrefix), sorted by name. */
export function loadLibraryPlugins(): LibraryPlugin[] {
  return [...libraryRoots()]
    .map(([name, root]) => readRoot(name, root))
    .filter((plugin): plugin is LibraryPlugin => plugin !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The plugins default_agent installs at initialization: every library plugin except those whose manifest sets `preinstall: false`. */
export function loadPreinstalledPlugins(): LibraryPlugin[] {
  return loadLibraryPlugins().filter((plugin) => plugin.preinstall);
}

/** Reads a single library plugin by name; undefined when the library has no such plugin (names are looked up, never joined into a path). */
export function libraryPlugin(name: string): LibraryPlugin | undefined {
  const root = libraryRoots().get(name);
  return root !== undefined ? (readRoot(name, root) ?? undefined) : undefined;
}

/**
 * Where a library plugin's package is on this machine, with its npm name and version — what an
 * export zips. Undefined when the library has no such plugin.
 */
export function libraryPluginPackage(
  name: string,
): { dir: string; packageName: string; version: string } | undefined {
  const root = libraryRoots().get(name);
  if (root === undefined) return undefined;
  return { dir: root.dir, packageName: root.packageName, version: readPackageVersion(root.dir) };
}

/**
 * Reads a package directory as the library would read it once installed — the check an
 * uploaded plugin passes before anything is installed. Throws, naming the file, on what the
 * library would refuse: no package.json name, a name that is not a plugin name, a malformed
 * plugin.json, a skill without its dated version, a hook package without `hooks.version`.
 */
export function readLibraryPackage(dir: string): LibraryPlugin {
  const file = path.join(dir, "package.json");
  const packageName = (JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown }).name;
  if (typeof packageName !== "string" || packageName === "") {
    throw new Error(`${file}: the package carries no name`);
  }
  const name = unscoped(packageName);
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw new Error(
      `${file}: ${JSON.stringify(name)} is not a plugin name (letters, digits, "_" and "-")`,
    );
  }
  return readPluginDir(name, { dir, packageName, installed: true });
}

/**
 * The README.md at a library plugin's package root, as npm ships it: undefined when the
 * library has no such plugin, null when the package has no readme. Read on request rather than
 * with the listing — a readme is long and wanted only for the plugin someone opened.
 */
export function libraryPluginReadme(name: string): string | null | undefined {
  const root = libraryRoots().get(name);
  if (root === undefined) return undefined;
  try {
    return fs.readFileSync(path.join(root.dir, "README.md"), "utf8");
  } catch {
    return null;
  }
}

/** Finds a library skill by its own name (across every plugin), with the plugin that ships it. */
export function librarySkill(
  name: string,
): { plugin: LibraryPlugin; skill: LibrarySkill } | undefined {
  for (const plugin of loadLibraryPlugins()) {
    const skill = plugin.skills.find((s) => s.name === name);
    if (skill) return { plugin, skill };
  }
  return undefined;
}

/**
 * Category manifest, in display order. Categories group by audience, not by technology: a
 * hook-only plugin sits with the skills it serves the same audience as (goal mode and
 * continual learning are office productivity, and so is company mode), and agent tuning is AI
 * app development. The last one, `sandbox`, is where the server modules that confine every
 * Agent command sit — the sandbox backends, whose index rows name it (`categories: ["sandbox"]`).
 * Docs: /docs/skills § "Built-in library".
 */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { id: "office-productivity", title: "Office Productivity", titleZh: "办公效率" },
  { id: "software-development", title: "Software Development", titleZh: "软件开发" },
  { id: "ai-app-development", title: "AI App Development", titleZh: "AI 应用开发" },
  { id: "sandbox", title: "Agent Sandbox", titleZh: "Agent 运行沙箱" },
];

/**
 * Groups plugins by category in PLUGIN_CATEGORIES order (members sorted by name; an empty
 * category is omitted); plugins with no or an unknown category land in an Other group appended
 * at the end (only when non-empty). A pure function, the testable core of loadPluginGroups.
 */
export function groupPlugins(all: LibraryPlugin[]): ResolvedPluginGroup[] {
  const groups: ResolvedPluginGroup[] = [];
  const known = new Set(PLUGIN_CATEGORIES.map((c) => c.id));
  for (const category of PLUGIN_CATEGORIES) {
    const members = all
      .filter((p) => p.category === category.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (members.length > 0) groups.push({ ...category, plugins: members });
  }
  const others = all
    .filter((p) => p.category === undefined || !known.has(p.category))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (others.length > 0) {
    groups.push({ id: "other", title: "Other", titleZh: "其他", plugins: others });
  }
  return groups;
}

/** Reads the library and groups it (see groupPlugins). */
export function loadPluginGroups(): ResolvedPluginGroup[] {
  return groupPlugins(loadLibraryPlugins());
}
