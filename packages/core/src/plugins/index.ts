/**
 * PenguinHarness plugin library: the built-in plugins and the loader that reads them (part
 * of core — hooks, skills and their loading all live in one SDK).
 *
 * A plugin is its own npm package (`@penguinharness/<name>`, `plugins/<name>/` in the repo;
 * resolved through Node from the host package's dependency list — see pluginRoots): a
 * directory whose `package.json` is its manifest (npm's own fields plus a `penguin` block — see
 * manifest.ts), an icon (`icon.svg` at the package root unless `penguin.icon` names another;
 * every built-in plugin ships one, and it is the icon of everything the plugin ships), and any
 * of two kinds of content: skills (`skills/<name>/SKILL.md`, installed into an Agent's
 * `agent_state/skills/`) and a hook package (`hooks/*.mjs`, installed into
 * `agent_state/hooks/<plugin>/` together with a generated `hooks.json`). The files are the
 * runtime source of truth — read and parsed on every call, no caching (files are small, calls
 * are infrequent) — so editing a file takes effect immediately. The shipped plugins are
 * committed content reached through declared dependencies, so one that fails to load — or
 * whose manifest reads with a warning — is a broken install or a broken plugin and throws with
 * the path, never a silently smaller library. Only the category manifest (id and titles) is
 * code; install / uninstall / scan live in core's state layer.
 *
 * A plugin's version is its npm version, the `version` of its package.json, which follows the
 * release. Dated versions, `YYYY.MM.DD.N` (see PLUGIN_VERSION_PATTERN, parsePluginVersion and
 * comparePluginVersions), belong to what an Agent may edit locally once installed: each skill
 * carries its own in its SKILL.md frontmatter, and a hook package carries
 * `penguin.hooks.version`, which the installer writes into hooks.json. The `penguin` block holds
 * the rest of the metadata: a library SKILL.md's frontmatter carries `name`, `description` and
 * `version`, and the loader stamps the plugin's UI short descriptions into each skill's metadata
 * and installable content (the installed copy carries the full frontmatter, generated — the way
 * hooks.json is).
 *
 * Besides the packages this build ships, the library lists what the operator installed on the
 * server: the packages of the data root's plugin prefix (see useInstalledPluginPrefix) that carry
 * skills or a hook package beside their package.json. Those are the operator's, not the
 * build's, so they are read leniently: one that will not read is left out with a warning
 * instead of failing the library, a field that will not read is missing with a warning, and a
 * skill without a dated version reads as unversioned.
 *
 * Docs: packages/docs/content/skills.{zh,en}.md (site path /docs/skills) documents the plugin
 * format, the versions and the built-in library.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  PLUGIN_NAME_PATTERN,
  PLUGIN_VERSION_PATTERN,
  readPluginIcon,
  readPluginPackage,
  unscopedPackageName,
} from "./manifest.js";
import type { HookCommand, QuickStart, UserPromptTrigger } from "./manifest.js";

export * from "./manifest.js";

/** A skill's metadata. A library SKILL.md's frontmatter carries `name`, `description` and the skill's own `version`; the short descriptions are stamped from the package's `penguin` block by the loader (installed copies then carry the full generated frontmatter, which is what the installed-side readers parse). */
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
   * text: a file that is not valid UTF-8 (an image) is left out, never installed garbled. The
   * field is omitted when a skill has no extra files.
   */
  files?: Record<string, string>;
}

/**
 * The manifest an installed hook package carries (`agent_state/hooks/<plugin>/hooks.json`),
 * generated by the installer from package.json's `penguin.hooks`: identity and display fields
 * plus one script list per hook point (`stop`, `pre_tool_use`, `user_prompt`). Whether a
 * Session runs hooks at all is an Agent-level decision (`hooks.enabled` in system_config.yaml),
 * not a per-package one. The plugin's icon is not part of it: the installer writes `icon.svg`
 * beside the manifest instead. Unknown keys are ignored rather than rejected.
 */
export interface HookManifest {
  name: string;
  description: string;
  description_zh?: string;
  /** The package's own version, `YYYY.MM.DD.N` — a library plugin's `penguin.hooks.version` (an installed copy may carry the legacy `YYYY-MM-DD.N`, a hand-written one anything). */
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

/** A plugin in the library: the manifest fields plus the content it ships. */
export interface LibraryPlugin {
  /** Plugin name: its package name without the scope (`a2ui` for `@penguinharness/a2ui`). */
  name: string;
  /** The npm package the plugin is, e.g. `@penguinharness/a2ui`. */
  packageName: string;
  /** `installed` for a package the operator installed on the server (see useInstalledPluginPrefix); absent for one this build ships. */
  source?: "installed";
  /** Display name (`penguin.title`, optional); the UI shows the plugin name without it. */
  title?: string;
  titleZh?: string;
  /** English one-line description (package.json `description`); "" when the package carries none — every shipped plugin does. */
  description: string;
  /** Chinese description (`penguin.description_zh`, optional). */
  descriptionZh?: string;
  /** UI short descriptions (`penguin.short_description(_zh)`, optional). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /**
   * The plugin's npm version: `package.json`'s `version` (it follows the release). What an
   * installed copy is compared against is not this but the dated version of each part — every
   * skill's, and the hook package's (see pluginContentVersion).
   */
  version: string;
  /** Category id (`penguin.category`, see PLUGIN_CATEGORIES); absent or unknown → the "other" group. */
  category?: string;
  /** Whether default_agent gets this plugin at creation (`penguin.preinstall`, default true; always false for an installed package — the operator chose it for the server, not for every new Project). */
  preinstall: boolean;
  /** The package's npm `author`, `homepage`, `repository` URL and `license`, for the detail dialog (each optional). */
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  /** Raw SVG of the plugin's icon (see readPluginIcon) — every built-in plugin ships one. It is the icon of everything the plugin ships: stamped onto each skill and written beside an installed hook package. */
  icon?: string;
  skills: LibrarySkill[];
  hooks?: LibraryHooks;
  /** The demo the Plugins page's quick start pre-fills (`penguin.quick_start`, optional). */
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
 * Whether a package directory is a library plugin: skills or a hook package beside its
 * package.json. A package of server modules alone is not one — it has nothing to install into
 * an Agent.
 */
export function isLibraryPackage(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "package.json")) &&
    (fs.existsSync(path.join(dir, "skills")) || fs.existsSync(path.join(dir, "hooks")))
  );
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
    const name = unscopedPackageName(packageName);
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

/**
 * What has been said about installed packages, so a listing — read on every request — says each
 * thing once per process rather than on every page load.
 */
const warned = new Set<string>();

/** console.warn, once per distinct message. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** Reads one root: a shipped plugin that will not read throws; an installed one is left out (null) with a warning. */
function readRoot(name: string, root: LibraryRoot): LibraryPlugin | null {
  if (!root.installed) return readPluginDir(name, root);
  try {
    return readPluginDir(name, root);
  } catch (err) {
    warnOnce(
      `[plugins] ${root.packageName} is installed but not listed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Decodes bytes as UTF-8, or null when they are not valid UTF-8 (an image, an archive). */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
function utf8Text(bytes: Uint8Array): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Recursively collects a directory's files as text keyed by POSIX-relative path, skipping the
 * names in `except` at the top level. Symlinks and other non-regular entries are skipped, and so
 * is a file that is not valid UTF-8 — what installs is text, and a binary file read as text
 * would install garbled; each one left out is pushed to `skipped` (the path under `dir`).
 * Returns undefined when the directory has no such files.
 */
function readDirFiles(
  dir: string,
  except: readonly string[],
  skipped: string[],
): Record<string, string> | undefined {
  const files: Record<string, string> = {};
  const walk = (abs: string, rel: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(abs, entry.name), childRel);
      } else if (entry.isFile()) {
        if (rel === "" && except.includes(entry.name)) continue;
        const text = utf8Text(fs.readFileSync(path.join(abs, entry.name)));
        if (text === null) skipped.push(childRel);
        else files[childRel] = text;
      }
    }
  };
  walk(dir, "");
  return Object.keys(files).length > 0 ? files : undefined;
}

/**
 * Reads one skill directory: name from the directory (overriding frontmatter), SKILL.md verbatim,
 * and every other file as auxiliary content. The icon is not read here: a skill has none of
 * its own, and stampSkill gives it the plugin's. A shipped skill must carry its own dated
 * `version` in the current spelling — it is what an installed copy is compared against; an
 * installed package's skill without one reads as unversioned (""), older than any real version
 * and never flagged behind.
 */
function readSkillDir(
  dir: string,
  name: string,
  strict: boolean,
  skipped: string[],
): LibrarySkill {
  const file = path.join(dir, "SKILL.md");
  const content = fs.readFileSync(file, "utf8");
  const meta = parseSkillFrontmatter(content);
  if (!meta) throw new Error(`Library skill ${file} has no frontmatter with a name`);
  if (strict && !PLUGIN_VERSION_PATTERN.test(meta.version)) {
    throw new Error(`Library skill ${file}: version must be YYYY.MM.DD.N`);
  }
  const auxiliary: string[] = [];
  const files = readDirFiles(dir, ["SKILL.md", "icon.svg"], auxiliary);
  skipped.push(...auxiliary.map((rel) => `skills/${name}/${rel}`));
  return { ...meta, name, content, ...(files !== undefined ? { files } : {}) };
}

/**
 * Resolves a library skill against its plugin: the plugin's UI short descriptions are the
 * skill's, its icon becomes the skill's, and the installable `content` gets the full frontmatter
 * regenerated in canonical field order, carrying the skill's own `version` (none for an
 * unversioned one) — the installed copy is self-describing (update checks read its `version`,
 * the UI its short descriptions and icon) the same way an installed hook package's hooks.json is
 * generated.
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
    ...(skill.version !== "" ? [`version: ${skill.version}`] : []),
    "---",
  ].join("\n");
  const body = skill.content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---/, "");
  return {
    ...skill,
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
    content: `${front}${body}`,
  };
}

/**
 * Reads one plugin directory: its package.json (parsePluginPackage), its skills, its icon and
 * its hook package. What the manifest reader warns about, the loader adds to: `hooks/` without a
 * dated `penguin.hooks.version` (no hook package is listed), `penguin.hooks` without `hooks/`, a
 * quick start naming skills the package does not ship (those names are dropped), an icon that
 * will not do, a file left out of a skill for not being text. A shipped plugin must read clean,
 * so for one of those any warning throws; an installed package lists with the field missing,
 * and the warning goes to the log.
 */
function readPluginDir(name: string, root: LibraryRoot): LibraryPlugin {
  const { dir } = root;
  const strict = !root.installed;
  const { manifest, warnings } = readPluginPackage(dir);
  const { penguin } = manifest;
  const skipped: string[] = [];
  const skills: LibrarySkill[] = [];
  const skillsDir = path.join(dir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        skills.push(readSkillDir(path.join(skillsDir, entry.name), entry.name, strict, skipped));
      }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
  }
  const { icon, warnings: iconWarnings } = readPluginIcon(dir, penguin.icon);
  warnings.push(...iconWarnings);
  const hooksDir = path.join(dir, "hooks");
  const hookFiles = fs.existsSync(hooksDir) ? readDirFiles(hooksDir, [], skipped) : undefined;
  let hooks: LibraryHooks | undefined;
  if (hookFiles !== undefined && penguin.hooks !== undefined) {
    hooks = {
      manifest: {
        name,
        description: manifest.description,
        ...(penguin.descriptionZh !== undefined ? { description_zh: penguin.descriptionZh } : {}),
        // The package's own dated version: what an installed hooks.json is compared against.
        version: penguin.hooks.version,
        stop: penguin.hooks.stop,
        pre_tool_use: penguin.hooks.pre_tool_use,
        user_prompt: penguin.hooks.user_prompt,
      },
      files: hookFiles,
    };
  } else if (hookFiles !== undefined) {
    warnings.push(
      "hooks/ is present but package.json declares no penguin.hooks.version; the hook package is not listed",
    );
  } else if (penguin.hooks !== undefined) {
    warnings.push("penguin.hooks is declared but the package carries no hooks/; ignored");
  }
  for (const rel of skipped) warnings.push(`${rel} is not a text file; it is not installed`);
  let quickStart = penguin.quickStart;
  if (quickStart?.skills !== undefined) {
    const unknown = quickStart.skills.filter((n) => !skills.some((s) => s.name === n));
    if (unknown.length > 0) {
      warnings.push(
        `penguin.quick_start.skills names skills the package does not ship (${unknown.join(", ")}); ignored`,
      );
      const { skills: _named, ...rest } = quickStart;
      const known = quickStart.skills.filter((n) => !unknown.includes(n));
      quickStart = known.length > 0 ? { ...rest, skills: known } : rest;
    }
  }
  if (warnings.length > 0) {
    const file = path.join(dir, "package.json");
    if (strict) throw new Error(`${file}: ${warnings.join("; ")}`);
    for (const warning of warnings) warnOnce(`[plugins] ${root.packageName}: ${warning}`);
  }
  const { shortDescription, shortDescriptionZh, descriptionZh } = penguin;
  return {
    name,
    packageName: root.packageName,
    ...(root.installed ? { source: "installed" as const } : {}),
    ...(penguin.title !== undefined ? { title: penguin.title } : {}),
    ...(penguin.titleZh !== undefined ? { titleZh: penguin.titleZh } : {}),
    description: manifest.description,
    ...(descriptionZh !== undefined ? { descriptionZh } : {}),
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    version: manifest.version,
    ...(penguin.category !== undefined ? { category: penguin.category } : {}),
    preinstall: !root.installed && penguin.preinstall !== false,
    ...(manifest.author !== undefined ? { author: manifest.author } : {}),
    ...(manifest.homepage !== undefined ? { homepage: manifest.homepage } : {}),
    ...(manifest.repository !== undefined ? { repository: manifest.repository } : {}),
    ...(manifest.license !== undefined ? { license: manifest.license } : {}),
    ...(icon !== undefined ? { icon } : {}),
    skills: skills.map((skill) =>
      stampSkill(skill, {
        ...(shortDescription !== undefined ? { shortDescription } : {}),
        ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
        ...(icon !== undefined ? { icon } : {}),
      }),
    ),
    ...(hooks !== undefined ? { hooks } : {}),
    ...(quickStart !== undefined ? { quickStart } : {}),
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
  const { version } = readPluginPackage(root.dir).manifest;
  return { dir: root.dir, packageName: root.packageName, version };
}

/**
 * Reads a package directory as the library would read it once installed — the check an
 * uploaded or a local package passes before anything is installed. Throws, naming the file, on
 * what the library would refuse: a package.json without a valid npm name or a release version
 * (PluginManifestError), a name whose unscoped part is not a plugin name, a skill without a
 * SKILL.md frontmatter naming it. Whatever reads with a warning instead (see readPluginDir) is
 * logged, and the package reads with that field missing.
 */
export function readLibraryPackage(dir: string): LibraryPlugin {
  const { manifest } = readPluginPackage(dir);
  return readPluginDir(manifest.pluginName, {
    dir,
    packageName: manifest.name,
    installed: true,
  });
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
