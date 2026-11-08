/**
 * What a plugin package carries for an Agent, read from its table: the entries its modules
 * contribute to the five data-only slots of `PluginLibraryModule` (./library.ts). The data is
 * checked here entry by entry, with the policy the npm fields are read with (./package-json.ts):
 * an entry that will not do is dropped with a warning naming it — `<Module>.contributes[<slot>][i]`
 * — and the rest reads on. The library decides what a warning costs (a shipped plugin fails, an
 * installed one lists without the entry). Keys the reader does not use are ignored.
 *
 * Only the modules the package's default export names count, with their children: what a
 * package declares and never boots is not its content.
 */
import path from "node:path";
import { MCP_SERVER_NAME_PATTERN } from "../environment/mcp/config.js";
import type {
  HookCommand,
  PluginCard,
  PluginSetupKey,
  QuickStart,
  SkillContribution,
  WorkbenchContribution,
} from "./library.js";
import { PLUGIN_NAME_PATTERN, PLUGIN_VERSION_PATTERN } from "./package-json.js";
import type { PluginTable } from "./table.js";

/** The five slots, by the key a contribution names. */
export const LIBRARY_SLOTS = {
  cards: "PluginLibraryModule.cards",
  skills: "PluginLibraryModule.skills",
  hooks: "PluginLibraryModule.hooks",
  mcpServers: "PluginLibraryModule.mcpServers",
  workbenches: "PluginLibraryModule.workbenches",
} as const;

/** A hook package as read: its dated version, its directory, one command list per hook point (absent → empty). */
export interface LibraryHooksContribution {
  version: string;
  path: string;
  stop: HookCommand[];
  pre_tool_use: HookCommand[];
  user_prompt: HookCommand[];
}

/**
 * One MCP server a plugin contributes, as the library lists it: the `tools.mcpServers` entry an
 * install writes, its `${KEY}` references and `${PLUGIN_ROOT}` as written.
 */
export interface PluginMcpServer {
  name: string;
  /** Exactly the `config` of a system_config.yaml entry. */
  config: Record<string, unknown>;
  /** The vault keys the user supplies: as the contribution declares them; the loader completes the list with every `${KEY}` the config references (an undeclared one has no label: the key is shown). */
  setup: PluginSetupKey[];
  /** `config.oauth` is present: the server offers OAuth sign-in. */
  oauth: boolean;
}

/** What a package's table contributes to the library, checked. */
export interface LibraryContributions {
  /** The card (every field optional); absent when the package contributes none. `references` is the landing site's and is not read here. */
  card?: Omit<PluginCard, "references">;
  skills: SkillContribution[];
  hooks?: LibraryHooksContribution;
  mcpServers: PluginMcpServer[];
  workbenches: WorkbenchContribution[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The module names the default export reaches: what it lists and stands in for, and their children. */
function bootedModules(table: PluginTable): string[] {
  const out: string[] = [];
  const visit = (name: string) => {
    if (out.includes(name)) return;
    const manifest = table.manifests[name];
    if (manifest === undefined) return;
    out.push(name);
    for (const child of manifest.children) visit(typeof child === "string" ? child : child.keyed);
  };
  for (const name of [...table.plugin.modules, ...table.plugin.replaces]) visit(name);
  return out;
}

/** Every entry the reached modules contribute to one slot, with where it was declared. */
function entriesOf(
  table: PluginTable,
  slot: string,
): Array<{ at: string; entry: Record<string, unknown> }> {
  const out: Array<{ at: string; entry: Record<string, unknown> }> = [];
  for (const name of bootedModules(table)) {
    const entries = table.manifests[name]!.contributes[slot] ?? [];
    entries.forEach((entry, index) =>
      out.push({ at: `${name}.contributes["${slot}"][${index}]`, entry }),
    );
  }
  return out;
}

/** Whether `rel` names a path inside the package: relative, not `.`, never climbing out, on any platform's spelling. */
function insidePackage(rel: string): boolean {
  const normal = path.posix.normalize(rel.replace(/\\/g, "/"));
  return !(
    normal === "." ||
    normal === ".." ||
    normal.startsWith("../") ||
    path.posix.isAbsolute(normal) ||
    /^[A-Za-z]:/.test(normal)
  );
}

/** A directory path as the library keys it: POSIX, normalized, without a trailing slash. */
function normalDir(rel: string): string {
  return path.posix.normalize(rel.replace(/\\/g, "/")).replace(/\/+$/, "");
}

/** A text field: a string, or nothing (blank is nothing; another type is a warning). */
function text(value: unknown, key: string, warnings: string[]): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    warnings.push(`${key} must be a string; ignored`);
    return undefined;
  }
  return value.trim() === "" ? undefined : value;
}

/** The card: at most one per package; each field read on its own. */
function readCard(table: PluginTable, warnings: string[]): LibraryContributions["card"] {
  const entries = entriesOf(table, LIBRARY_SLOTS.cards);
  if (entries.length === 0) return undefined;
  for (const extra of entries.slice(1)) {
    warnings.push(`${extra.at}: a package has one card; ignored`);
  }
  const { at, entry } = entries[0]!;
  const card: NonNullable<LibraryContributions["card"]> = {};
  for (const key of [
    "title",
    "titleZh",
    "descriptionZh",
    "shortDescription",
    "shortDescriptionZh",
    "category",
  ] as const) {
    const value = text(entry[key], `${at}.${key}`, warnings);
    if (value !== undefined) card[key] = value;
  }
  const icon = text(entry.icon, `${at}.icon`, warnings);
  if (icon !== undefined) {
    if (/\.svg$/i.test(icon)) card.icon = icon;
    else warnings.push(`${at}.icon must be the path of an .svg file in the package; ignored`);
  }
  if (entry.preinstall !== undefined) {
    if (typeof entry.preinstall === "boolean") card.preinstall = entry.preinstall;
    else warnings.push(`${at}.preinstall must be true or false; ignored`);
  }
  const quickStart = readQuickStart(entry.quickStart, `${at}.quickStart`, warnings);
  if (quickStart !== undefined) card.quickStart = quickStart;
  return card;
}

/** A card's quick start: a prompt is required; a part of the wrong type is dropped on its own. */
function readQuickStart(value: unknown, at: string, warnings: string[]): QuickStart | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.prompt !== "string" || value.prompt.trim() === "") {
    warnings.push(`${at} needs a prompt; ignored`);
    return undefined;
  }
  const { prompt, promptZh, skills, goal } = value;
  if (promptZh !== undefined && typeof promptZh !== "string") {
    warnings.push(`${at}.promptZh must be a string; ignored`);
  }
  const skillList =
    Array.isArray(skills) && skills.every((s) => typeof s === "string")
      ? (skills as string[])
      : undefined;
  if (skills !== undefined && skillList === undefined) {
    warnings.push(`${at}.skills must be a list of skill names; ignored`);
  }
  if (goal !== undefined && typeof goal !== "boolean") {
    warnings.push(`${at}.goal must be true or false; ignored`);
  }
  return {
    prompt,
    ...(typeof promptZh === "string" && promptZh.trim() !== "" ? { promptZh } : {}),
    ...(skillList !== undefined ? { skills: skillList } : {}),
    ...(goal === true ? { goal: true } : {}),
  };
}

/**
 * Entries that name a directory of the package (`skills`, `workbenches`): `name` passes `pattern`
 * and is the basename of `path`, which stays inside the package; a name used twice keeps its first
 * entry.
 */
function readNamedDirs(
  table: PluginTable,
  slot: string,
  pattern: RegExp,
  what: string,
  warnings: string[],
): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  for (const { at, entry } of entriesOf(table, slot)) {
    const { name, path: rel } = entry;
    if (typeof name !== "string" || !pattern.test(name)) {
      warnings.push(`${at}.name is not a ${what} name (letters, digits, "_" and "-"); ignored`);
      continue;
    }
    if (typeof rel !== "string" || !insidePackage(rel)) {
      warnings.push(`${at}.path must name a directory inside the package; ignored`);
      continue;
    }
    const dir = normalDir(rel);
    if (path.posix.basename(dir) !== name) {
      warnings.push(
        `${at}: the ${what} name "${name}" is not the name of its directory ${dir}; ignored`,
      );
      continue;
    }
    if (out.some((other) => other.name === name)) {
      warnings.push(`${at}: the ${what} "${name}" is declared twice; ignored`);
      continue;
    }
    out.push({ name, path: dir });
  }
  return out;
}

/**
 * One hook point's command list, read the way an installed hooks.json is read: an entry is kept
 * only when it names a script inside the hook package's directory; a `timeout` that is not a
 * positive number and an unknown `trigger` are dropped from the entry. Each thing dropped is a
 * warning.
 */
function hookCommands(value: unknown, at: string, warnings: string[]): HookCommand[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${at} must be a list of commands; ignored`);
    return [];
  }
  const commands: HookCommand[] = [];
  for (const [index, entry] of (value as unknown[]).entries()) {
    const where = `${at}[${index}]`;
    const command = isRecord(entry) ? entry.command : undefined;
    if (typeof command !== "string" || !insidePackage(command)) {
      warnings.push(`${where} must name a script inside the hook package's directory; ignored`);
      continue;
    }
    const { timeout, trigger } = entry as Record<string, unknown>;
    if (timeout !== undefined && !(typeof timeout === "number" && timeout > 0)) {
      warnings.push(`${where}.timeout must be a positive number of seconds; ignored`);
    }
    if (trigger !== undefined && trigger !== "prompt" && trigger !== "host") {
      warnings.push(`${where}.trigger must be "prompt" or "host"; ignored`);
    }
    commands.push({
      command,
      ...(typeof timeout === "number" && timeout > 0 ? { timeout } : {}),
      ...(trigger === "prompt" || trigger === "host" ? { trigger } : {}),
    });
  }
  return commands;
}

/** The hook package: at most one per package (it installs as `hooks/<plugin>/`); its dated version is what makes it one. */
function readHooks(table: PluginTable, warnings: string[]): LibraryHooksContribution | undefined {
  const entries = entriesOf(table, LIBRARY_SLOTS.hooks);
  if (entries.length === 0) return undefined;
  for (const extra of entries.slice(1)) {
    warnings.push(`${extra.at}: a package has one hook package; ignored`);
  }
  const { at, entry } = entries[0]!;
  if (typeof entry.version !== "string" || !PLUGIN_VERSION_PATTERN.test(entry.version)) {
    warnings.push(
      `${at}.version must be YYYY.MM.DD.N, got ${JSON.stringify(entry.version)}; the hook package is ignored`,
    );
    return undefined;
  }
  if (typeof entry.path !== "string" || !insidePackage(entry.path)) {
    warnings.push(
      `${at}.path must name a directory inside the package; the hook package is ignored`,
    );
    return undefined;
  }
  return {
    version: entry.version,
    path: normalDir(entry.path),
    stop: hookCommands(entry.stop, `${at}.stop`, warnings),
    pre_tool_use: hookCommands(entry.pre_tool_use, `${at}.pre_tool_use`, warnings),
    user_prompt: hookCommands(entry.user_prompt, `${at}.user_prompt`, warnings),
  };
}

/** The vault's key rule (shell variable names); `PLUGIN_ROOT` is reserved for the package directory. */
const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The MCP servers: each entry needs a server name (unique in the package) and a `config` object;
 * an `oauth` in it must be an object whose `scopes` is a list of strings and whose `client_id` /
 * `client_secret` are strings. An entry that fails is dropped with a warning, and so is a `setup`
 * item that is not a vault key with optional text fields. Whether the config resolves to a
 * transport is the library's check, with the server resolver.
 */
function readMcpServers(table: PluginTable, warnings: string[]): PluginMcpServer[] {
  const servers: PluginMcpServer[] = [];
  for (const { at, entry } of entriesOf(table, LIBRARY_SLOTS.mcpServers)) {
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

/** A server's `setup` list: each item a vault key with an optional `label`, `labelZh` and `help`. */
function readSetupKeys(value: unknown, at: string, warnings: string[]): PluginSetupKey[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${at} must be a list of { key, label?, labelZh?, help? }; ignored`);
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
    for (const field of ["label", "labelZh", "help"] as const) {
      const value = (item as Record<string, unknown>)[field];
      if (value === undefined) continue;
      if (typeof value === "string" && value.trim() !== "") fields[field] = value;
      else warnings.push(`${at}[${index}].${field} must be a string; ignored`);
    }
    keys.push({ key, ...fields });
  }
  return keys;
}

/** The workbench app id rule (the Agent's `workbenches/<id>/` directory). */
const WORKBENCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** What a package's table contributes to the library, every entry checked (see the module header). */
export function libraryContributions(table: PluginTable, warnings: string[]): LibraryContributions {
  const card = readCard(table, warnings);
  const hooks = readHooks(table, warnings);
  return {
    ...(card !== undefined ? { card } : {}),
    skills: readNamedDirs(table, LIBRARY_SLOTS.skills, PLUGIN_NAME_PATTERN, "skill", warnings),
    ...(hooks !== undefined ? { hooks } : {}),
    mcpServers: readMcpServers(table, warnings),
    workbenches: readNamedDirs(
      table,
      LIBRARY_SLOTS.workbenches,
      WORKBENCH_NAME_PATTERN,
      "workbench",
      warnings,
    ),
  };
}
