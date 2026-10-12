/**
 * A plugin's manifest is its own npm `package.json`: the standard fields every package carries
 * (`name`, `version`, `description`, `keywords`, `author`, `homepage`, `repository`, `license`)
 * and one namespaced block, `penguin`, holding every field that is this product's — the display
 * name, the Chinese and the card's descriptions, the category, the icon, whether default_agent
 * preinstalls it, the quick start, the hook package and the MCP servers it contributes. A namespaced block tells a reader (and
 * this reader) exactly which keys are ours, the way `prettier` or `eslintConfig` sit in a
 * package.json, and lets the npm-standard fields keep their npm meaning. A package without the
 * block reads as one with an empty block.
 *
 * Content is found by convention and never declared: `skills/<name>/SKILL.md`, `hooks/*.mjs`,
 * `ifaces.json` (with `dist/`) for server modules, and `README.md` for the detail dialog. An MCP
 * server is a declaration with no file behind it, so it sits in the block: `penguin.mcp_servers`,
 * entries in the shape of system_config.yaml's `tools.mcpServers`, whose `${KEY}` references
 * name the vault values the user supplies (`setup`) and which installing on an Agent merges into
 * that Agent's list.
 *
 * parsePluginPackage is the one reader every surface goes through — core's loader, the check an
 * uploaded or a local package passes (readLibraryPackage), the server's listing. It refuses only
 * what makes a package unusable: no valid npm name, a name whose unscoped part is not a plugin
 * name, no release version. Everything else that is malformed is dropped with a warning naming
 * the key, so a package written elsewhere lists with the field missing rather than not at all —
 * and a missing field stays missing: the UI says so (a placeholder description, the puzzle
 * glyph, the Other group); nothing is invented.
 *
 * Docs: packages/docs/content/skills.{zh,en}.md § "Plugin file format".
 */
import fs from "node:fs";
import path from "node:path";
import { MCP_SERVER_NAME_PATTERN } from "../environment/mcp/config.js";

/** Character rule for plugin, skill and hook names (directory names): prevents path traversal (exported for the server's archive-install validation). */
export const PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Dated version format: a dotted date and a sequence number, e.g. `2026.08.29.1`. What every library skill and hook package must carry. */
export const PLUGIN_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

/** An npm package name, `name` or `@scope/name`: lower case, URL-safe (npm's own rule for new packages). */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** npm refuses longer names. */
const MAX_NPM_NAME_LENGTH = 214;

/** A release version: `1.2.3`, with an optional pre-release and build tag. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * When a `user_prompt` command runs: `prompt` on every Prompt the user submits, `host` only
 * when the host starts the package's flow by name (`Session.runUserPromptHook` — goal mode's
 * start). Meaningless at the other hook points.
 */
export type UserPromptTrigger = "prompt" | "host";

/** One hook script entry: `command` is a path relative to the plugin's `hooks/` directory, run with Node; `timeout` in seconds (core's default applies when absent); `trigger` says when a `user_prompt` command runs (see userPromptTrigger for the default). */
export interface HookCommand {
  command: string;
  timeout?: number;
  trigger?: UserPromptTrigger;
}

/**
 * A plugin's quick start (package.json `penguin.quick_start`): the demo a person runs to see
 * what the plugin does — a prompt the Plugins page pre-fills into a new-chat draft, never sends.
 */
export interface QuickStart {
  prompt: string;
  promptZh?: string;
  /** Skills of this plugin to pre-select in the draft. */
  skills?: string[];
  /** Open the draft in goal mode (the prompt is the objective). */
  goal?: boolean;
}

/** The hook package a manifest declares: its dated version and one command list per hook point. */
export interface PluginHooksDeclaration {
  /** `YYYY.MM.DD.N`: what an installed hooks.json is compared against. */
  version: string;
  stop: HookCommand[];
  pre_tool_use: HookCommand[];
  user_prompt: HookCommand[];
}

/** One vault key a plugin's MCP server needs before it can connect (`penguin.mcp_servers[].setup[]`). */
export interface PluginSetupKey {
  /** The vault key, referenced as `${KEY}` in the server's config. */
  key: string;
  label?: string;
  labelZh?: string;
  /** Where to get the value (a URL), or one sentence. */
  help?: string;
}

/**
 * One MCP server a plugin contributes (`penguin.mcp_servers[]`): the `tools.mcpServers` entry an
 * install writes, its `${KEY}` references and `${PLUGIN_ROOT}` as written.
 */
export interface PluginMcpServer {
  name: string;
  /** Exactly the `config` of a system_config.yaml entry. */
  config: Record<string, unknown>;
  /** The vault keys the user supplies: as the manifest declares them; the loader completes the list with every `${KEY}` the config references (an undeclared one has no label: the key is shown). */
  setup: PluginSetupKey[];
  /** `config.oauth` is present: the server offers OAuth sign-in. */
  oauth: boolean;
}

/** The `penguin` block of a plugin's package.json, as read: every field optional, unknown keys ignored. */
export interface PluginPackageFields {
  /** Display name (`title`); absent → the plugin name. */
  title?: string;
  titleZh?: string;
  descriptionZh?: string;
  /** The card's one-line descriptions; absent → the full description. */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /** A category id (see PLUGIN_CATEGORIES); absent or unknown → the Other group. */
  category?: string;
  /** Path of an `.svg` inside the package; resolved and checked by readPluginIcon. */
  icon?: string;
  /** Whether default_agent gets the plugin at creation; a shipped plugin's default is true. */
  preinstall?: boolean;
  quickStart?: QuickStart;
  /** The hook package, declared beside `hooks/`. */
  hooks?: PluginHooksDeclaration;
  /** The MCP servers the package contributes (`mcp_servers`); absent when it declares none. */
  mcpServers?: PluginMcpServer[];
}

/** A plugin's package.json, read and checked. */
export interface PluginPackageManifest {
  /** The npm name: `@scope/name` or `name`. */
  name: string;
  /** The unscoped part of the name: what the library lists the plugin under. */
  pluginName: string;
  /** The release version (semver): the plugin's own version. */
  version: string;
  /** English one-liner; "" when the package carries none. */
  description: string;
  keywords: string[];
  /** The author's name: the string form without its `<email>` and `(url)`, or `author.name`. */
  author?: string;
  homepage?: string;
  /** The repository's URL: the string form, or `repository.url`. */
  repository?: string;
  /** `repository.directory`, kept apart from the URL: where in the repository the package sits. */
  repositoryDirectory?: string;
  license?: string;
  penguin: PluginPackageFields;
}

/** A package.json that makes the package unusable as a plugin, naming the file. */
export class PluginManifestError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "PluginManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The plugin name a package is listed under: its npm name without the scope. */
export function unscopedPackageName(packageName: string): string {
  return packageName.slice(packageName.lastIndexOf("/") + 1);
}

/** npm's people field as a name: `"Ann <a@b.c> (https://…)"` → `Ann`; `{ name }` → the name. */
function personName(value: unknown): string | null {
  const raw = isRecord(value) ? value.name : value;
  if (typeof raw !== "string") return null;
  const name = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  return name === "" ? null : name;
}

/** Whether a hook command names a path inside `hooks/` — on any platform's spelling of a path. */
function insideHooksDir(command: string): boolean {
  const normal = path.posix.normalize(command.replace(/\\/g, "/"));
  return !(
    normal === "." ||
    normal === ".." ||
    normal.startsWith("../") ||
    path.posix.isAbsolute(normal) ||
    /^[A-Za-z]:/.test(normal)
  );
}

/**
 * One hook point's command list, read the way an installed hooks.json is read: an entry is kept
 * only when it names a script inside `hooks/`; a `timeout` that is not a positive number and an
 * unknown `trigger` are dropped from the entry. Each thing dropped is a warning.
 */
function hookCommands(value: unknown, key: string, warnings: string[]): HookCommand[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${key} must be a list of commands; ignored`);
    return [];
  }
  const commands: HookCommand[] = [];
  for (const [index, entry] of (value as unknown[]).entries()) {
    const at = `${key}[${index}]`;
    const command = isRecord(entry) ? entry.command : undefined;
    if (typeof command !== "string" || !insideHooksDir(command)) {
      warnings.push(`${at} must name a script inside hooks/; ignored`);
      continue;
    }
    const { timeout, trigger } = entry as Record<string, unknown>;
    if (timeout !== undefined && !(typeof timeout === "number" && timeout > 0)) {
      warnings.push(`${at}.timeout must be a positive number of seconds; ignored`);
    }
    if (trigger !== undefined && trigger !== "prompt" && trigger !== "host") {
      warnings.push(`${at}.trigger must be "prompt" or "host"; ignored`);
    }
    commands.push({
      command: command as string,
      ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
      ...(trigger === "prompt" || trigger === "host" ? { trigger } : {}),
    });
  }
  return commands;
}

/**
 * Reads a package.json as a plugin manifest. Throws PluginManifestError only for what makes the
 * package unusable: not a JSON object, no valid npm `name`, an unscoped part that is not a plugin
 * name, no semver `version`. Everything else degrades, with a warning naming the key: a field of
 * the wrong type is dropped, a `quick_start` without a prompt is dropped, a `hooks` block without
 * a dated `version` is dropped (the package then has no hook package), an `icon` that is not an
 * `.svg` path is dropped. A blank text field reads as absent.
 */
export function parsePluginPackage(
  raw: unknown,
  file: string,
): { manifest: PluginPackageManifest; warnings: string[] } {
  if (!isRecord(raw)) throw new PluginManifestError(file, "package.json is not a JSON object");
  const { name, version } = raw;
  if (
    typeof name !== "string" ||
    name.length > MAX_NPM_NAME_LENGTH ||
    !NPM_PACKAGE_NAME.test(name)
  ) {
    throw new PluginManifestError(
      file,
      "the package carries no valid npm name (`name` or `@scope/name`, lower case)",
    );
  }
  const pluginName = unscopedPackageName(name);
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new PluginManifestError(
      file,
      `${JSON.stringify(pluginName)} is not a plugin name (letters, digits, "_" and "-")`,
    );
  }
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new PluginManifestError(
      file,
      "the package carries no release version (`version`, such as 1.2.0)",
    );
  }

  const warnings: string[] = [];
  /** A text field: a string, or nothing (blank is nothing; another type is a warning). */
  const text = (value: unknown, key: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      warnings.push(`${key} must be a string; ignored`);
      return undefined;
    }
    return value.trim() === "" ? undefined : value;
  };

  let keywords: string[] = [];
  if (raw.keywords !== undefined) {
    if (Array.isArray(raw.keywords) && raw.keywords.every((k) => typeof k === "string")) {
      keywords = raw.keywords as string[];
    } else {
      warnings.push("keywords must be a list of strings; ignored");
    }
  }
  let author: string | undefined;
  if (raw.author !== undefined) {
    author = personName(raw.author) ?? undefined;
    if (author === undefined) warnings.push("author must be a name or { name }; ignored");
  }
  let repository: string | undefined;
  let repositoryDirectory: string | undefined;
  if (raw.repository !== undefined) {
    if (isRecord(raw.repository)) {
      repository = text(raw.repository.url, "repository.url");
      repositoryDirectory = text(raw.repository.directory, "repository.directory");
    } else {
      repository = text(raw.repository, "repository");
    }
  }
  const description = text(raw.description, "description") ?? "";
  const homepage = text(raw.homepage, "homepage");
  const license = text(raw.license, "license");

  let block: Record<string, unknown> = {};
  if (raw.penguin !== undefined) {
    if (isRecord(raw.penguin)) block = raw.penguin;
    else warnings.push("penguin must be an object; ignored");
  }
  const penguin: PluginPackageFields = {};
  for (const [from, to] of [
    ["title", "title"],
    ["title_zh", "titleZh"],
    ["description_zh", "descriptionZh"],
    ["short_description", "shortDescription"],
    ["short_description_zh", "shortDescriptionZh"],
    ["category", "category"],
  ] as const) {
    const value = text(block[from], `penguin.${from}`);
    if (value !== undefined) penguin[to] = value;
  }
  const icon = text(block.icon, "penguin.icon");
  if (icon !== undefined) {
    if (/\.svg$/i.test(icon)) penguin.icon = icon;
    else warnings.push("penguin.icon must be the path of an .svg file in the package; ignored");
  }
  if (block.preinstall !== undefined) {
    if (typeof block.preinstall === "boolean") penguin.preinstall = block.preinstall;
    else warnings.push("penguin.preinstall must be true or false; ignored");
  }
  const quickStart = readQuickStart(block.quick_start, warnings);
  if (quickStart !== undefined) penguin.quickStart = quickStart;
  const hooks = readHooks(block.hooks, warnings);
  if (hooks !== undefined) penguin.hooks = hooks;
  const mcpServers = readMcpServers(block.mcp_servers, warnings);
  if (mcpServers.length > 0) penguin.mcpServers = mcpServers;

  return {
    manifest: {
      name,
      pluginName,
      version,
      description,
      keywords,
      ...(author !== undefined ? { author } : {}),
      ...(homepage !== undefined ? { homepage } : {}),
      ...(repository !== undefined ? { repository } : {}),
      ...(repositoryDirectory !== undefined ? { repositoryDirectory } : {}),
      ...(license !== undefined ? { license } : {}),
      penguin,
    },
    warnings,
  };
}

/** `penguin.quick_start`: a prompt is required; a part of the wrong type is dropped on its own. */
function readQuickStart(value: unknown, warnings: string[]): QuickStart | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.prompt !== "string" || value.prompt.trim() === "") {
    warnings.push("penguin.quick_start needs a prompt; ignored");
    return undefined;
  }
  const { prompt, prompt_zh: promptZh, skills, goal } = value;
  if (promptZh !== undefined && typeof promptZh !== "string") {
    warnings.push("penguin.quick_start.prompt_zh must be a string; ignored");
  }
  const skillList =
    Array.isArray(skills) && skills.every((s) => typeof s === "string")
      ? (skills as string[])
      : undefined;
  if (skills !== undefined && skillList === undefined) {
    warnings.push("penguin.quick_start.skills must be a list of skill names; ignored");
  }
  if (goal !== undefined && typeof goal !== "boolean") {
    warnings.push("penguin.quick_start.goal must be true or false; ignored");
  }
  return {
    prompt,
    ...(typeof promptZh === "string" && promptZh.trim() !== "" ? { promptZh } : {}),
    ...(skillList !== undefined ? { skills: skillList } : {}),
    ...(goal === true ? { goal: true } : {}),
  };
}

/** `penguin.hooks`: its dated version is what makes it a hook package; the command lists are read entry by entry. */
function readHooks(value: unknown, warnings: string[]): PluginHooksDeclaration | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warnings.push("penguin.hooks must be an object; ignored");
    return undefined;
  }
  if (typeof value.version !== "string" || !PLUGIN_VERSION_PATTERN.test(value.version)) {
    warnings.push(
      `penguin.hooks.version must be YYYY.MM.DD.N, got ${JSON.stringify(value.version)}; the hook package is ignored`,
    );
    return undefined;
  }
  return {
    version: value.version,
    stop: hookCommands(value.stop, "penguin.hooks.stop", warnings),
    pre_tool_use: hookCommands(value.pre_tool_use, "penguin.hooks.pre_tool_use", warnings),
    user_prompt: hookCommands(value.user_prompt, "penguin.hooks.user_prompt", warnings),
  };
}

/** The vault's key rule (shell variable names); `PLUGIN_ROOT` is reserved for the package directory. */
const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `penguin.mcp_servers`: each entry needs a server name (unique in the package) and a `config`
 * object; an `oauth` in it must be an object whose `scopes` is a list of strings and whose
 * `client_id` / `client_secret` are strings. An entry that fails is dropped with a warning, and
 * so is a `setup` item that is not a vault key with optional text fields. Whether the config
 * resolves to a transport is the loader's check (readPluginDir), with the server resolver.
 */
function readMcpServers(value: unknown, warnings: string[]): PluginMcpServer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push("penguin.mcp_servers must be a list of servers; ignored");
    return [];
  }
  const servers: PluginMcpServer[] = [];
  for (const [index, entry] of (value as unknown[]).entries()) {
    const at = `penguin.mcp_servers[${index}]`;
    if (!isRecord(entry)) {
      warnings.push(`${at} must be an object with a name and a config; ignored`);
      continue;
    }
    const { name, config } = entry;
    if (typeof name !== "string" || !MCP_SERVER_NAME_PATTERN.test(name)) {
      warnings.push(
        `${at}.name must be a server name (letters, digits, "_" and "-", starting with a letter or a digit); ignored`,
      );
      continue;
    }
    if (servers.some((server) => server.name === name)) {
      warnings.push(`${at}: the server name "${name}" is used twice; ignored`);
      continue;
    }
    if (!isRecord(config)) {
      warnings.push(`${at}.config must be an object; ignored`);
      continue;
    }
    if (config.oauth !== undefined && !isOAuthBlock(config.oauth)) {
      warnings.push(
        `${at}.config.oauth must be an object with optional scopes (a list of strings), client_id and client_secret; the server is ignored`,
      );
      continue;
    }
    servers.push({
      name,
      config,
      setup: readSetupKeys(entry.setup, `${at}.setup`, warnings),
      oauth: config.oauth !== undefined,
    });
  }
  return servers;
}

function isOAuthBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { scopes, client_id: clientId, client_secret: clientSecret } = value;
  return (
    (scopes === undefined ||
      (Array.isArray(scopes) && scopes.every((scope) => typeof scope === "string"))) &&
    (clientId === undefined || typeof clientId === "string") &&
    (clientSecret === undefined || typeof clientSecret === "string")
  );
}

/** A server's `setup` list: each item a vault key with an optional `label`, `label_zh` and `help`. */
function readSetupKeys(value: unknown, at: string, warnings: string[]): PluginSetupKey[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${at} must be a list of { key, label?, label_zh?, help? }; ignored`);
    return [];
  }
  const keys: PluginSetupKey[] = [];
  for (const [index, item] of (value as unknown[]).entries()) {
    const key = isRecord(item) ? item.key : undefined;
    if (typeof key !== "string" || !VAULT_KEY_PATTERN.test(key) || key === "PLUGIN_ROOT") {
      warnings.push(
        `${at}[${index}].key must be a vault key (letters, digits and "_", not starting with a digit); ignored`,
      );
      continue;
    }
    if (keys.some((k) => k.key === key)) {
      warnings.push(`${at}[${index}]: the key ${key} is listed twice; ignored`);
      continue;
    }
    const fields: Partial<PluginSetupKey> = {};
    for (const [from, to] of [
      ["label", "label"],
      ["label_zh", "labelZh"],
      ["help", "help"],
    ] as const) {
      const text = (item as Record<string, unknown>)[from];
      if (text === undefined) continue;
      if (typeof text === "string" && text.trim() !== "") fields[to] = text;
      else warnings.push(`${at}[${index}].${from} must be a string; ignored`);
    }
    keys.push({ key, ...fields });
  }
  return keys;
}

/**
 * Reads a package directory's package.json and parses it (parsePluginPackage). A missing or
 * unparseable file is a PluginManifestError like any other unusable manifest.
 */
export function readPluginPackage(dir: string): {
  manifest: PluginPackageManifest;
  warnings: string[];
} {
  const file = path.join(dir, "package.json");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new PluginManifestError(
      file,
      missing ? "the package has no package.json" : "package.json is not valid JSON",
    );
  }
  return parsePluginPackage(raw, file);
}

/** The most an icon may weigh: it is inlined into every card and dialog that shows it. */
export const MAX_PLUGIN_ICON_BYTES = 64 * 1024;

/**
 * What an icon may not contain, case-insensitively, anywhere in its text: script, an embedded
 * document, a reference to anything outside itself (an href of any kind, a CSS `url()` that is not
 * a fragment, an import), an event handler, an entity declaration. A deny-list over the raw text,
 * like the Web App's own check: a false positive costs a puzzle glyph, a miss costs script in the
 * page.
 */
const UNSAFE_SVG: readonly RegExp[] = [
  /<script/i,
  /<foreignobject/i,
  /<iframe/i,
  /<embed/i,
  /<object/i,
  /<use[\s/>]/i,
  /href\s*=/i,
  /javascript:/i,
  /data:text\/html/i,
  /[\s"'/]on[a-z]+\s*=/i,
  /<!entity/i,
  /@import/i,
  /url\(\s*(?!['"]?\s*#)/i,
];

/** An SVG's text from its root element on: no byte-order mark, XML declaration or whitespace before `<svg`. */
function svgFromRoot(text: string): string {
  return text.replace(/^﻿/, "").replace(/^\s*(?:<\?xml[^>]*\?>\s*)?/i, "");
}

/**
 * Whether an SVG may be inlined into the page as a plugin's icon: it begins with `<svg` (after
 * an optional XML declaration and whitespace) and holds nothing UNSAFE_SVG names.
 */
export function isSafeIconSvg(text: string): boolean {
  const body = svgFromRoot(text);
  if (!/^<svg[\s>]/i.test(body)) return false;
  return !UNSAFE_SVG.some((rule) => rule.test(body));
}

/**
 * A package's icon: the SVG `penguin.icon` names, else `icon.svg` at the package root when there
 * is one. Read only when the file stays inside the package (a symlink is not followed), weighs at
 * most MAX_PLUGIN_ICON_BYTES and passes isSafeIconSvg; otherwise no icon (the UI's puzzle glyph),
 * with a warning saying why. A package with no icon at all has none, silently. The icon is the
 * text from its `<svg` root on: the Web App inlines only markup that begins there, so an XML
 * declaration the file opens with is left behind rather than costing the icon.
 */
export function readPluginIcon(
  dir: string,
  declared: string | undefined,
): { icon?: string; warnings: string[] } {
  const rel = declared ?? "icon.svg";
  const key = declared !== undefined ? `penguin.icon (${declared})` : "icon.svg";
  const abs = path.resolve(dir, rel);
  const inside = path.relative(dir, abs);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
    return { warnings: [`${key} is not a file inside the package; ignored`] };
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return { warnings: declared !== undefined ? [`${key} does not exist; ignored`] : [] };
  }
  if (!stat.isFile()) return { warnings: [`${key} is not a plain file; ignored`] };
  if (stat.size > MAX_PLUGIN_ICON_BYTES) {
    return { warnings: [`${key} is larger than ${MAX_PLUGIN_ICON_BYTES / 1024} KiB; ignored`] };
  }
  const icon = svgFromRoot(fs.readFileSync(abs, "utf8"));
  if (!isSafeIconSvg(icon)) {
    return {
      warnings: [
        `${key} is not a plain SVG (script, event handlers, links and external references are refused); ignored`,
      ],
    };
  }
  return { icon, warnings: [] };
}
