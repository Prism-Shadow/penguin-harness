/**
 * The Agent definition a plugin package contributes, and what installing does with it.
 *
 * The package contributes the definition the way it contributes a sandbox provider: a
 * module in its entry file whose manifest (generated into `ifaces.json`) contributes to
 * the agents mechanism's `definitions` slot — the static half names the Agent and lists
 * the definition's files, the package's `agent_state/` content as the manifest lists it.
 * The server reads that table without importing the package: the manifest is data, read
 * and checked WITHOUT executing the module. Installing the package copies the listed
 * files into the Project's agents/ as data: nothing in the package runs at copy time, no
 * credentials are written, nothing is registered anywhere. The Agent's lived history
 * (memory, traces, snapshots, workspaces, scratchpad, the vault) is runtime state and
 * never travels in a package.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, agentDir, unscopedPackageName } from "@prismshadow/penguin-core";

/** The package directory that holds a contributed definition (the Agent's own agent_state). */
export const AGENT_STATE_DIR = "agent_state";

/** Directories inside `agent_state/` that are the Agent's lived history, never its definition. */
export const RUNTIME_STATE_DIRS = ["memory", "traces", "snapshots", "workspaces", "scratchpad"];

/** The slot the agents mechanism opens to plugin packages (`AgentConfigService.definitions`). */
export const AGENT_DEFINITIONS_SLOT = "AgentConfigService.definitions";

export class AgentCopyError extends Error {}

/**
 * One Agent definition a package contributes, read from its ifaces.json without importing
 * the package: the contribution's static half (a display name and the definition's files,
 * package-relative as the manifest lists them) plus the entry points naming the Agent.
 */
export interface AgentDefinition {
  /** The Agent's id: the package's unscoped name — the directory the copy lands under. */
  agentId: string;
  /** The contribution's display name, when the manifest carries one. */
  name?: string;
  /** Package-relative definition files: the contribution's `agentState` list, checked. */
  files: string[];
}

/** Whether a definition-file path is one the copy may take: inside `agent_state/`, no traversal, no lived history. */
export function agentDefinitionEntry(rel: string): string | null {
  const parts = rel.split("/");
  if (parts[0] !== AGENT_STATE_DIR || parts.length < 2) return null;
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  const inner = parts[1]!;
  if (inner.startsWith(".") || RUNTIME_STATE_DIRS.includes(inner)) return null;
  return rel;
}

/**
 * The Agent definitions a package directory contributes, read from its ifaces.json: the
 * manifest of every module it carries is scanned for a contribution to the agents
 * mechanism's `definitions` slot. Nothing is imported — the table is the package's static
 * description, generated beside its package.json. `unscoped` is the package name's
 * unscoped part (the Agent id the copy lands under).
 */
export async function contributedAgentDefinitions(
  dir: string,
  unscoped: string,
): Promise<AgentDefinition[]> {
  let table: unknown;
  try {
    table = JSON.parse(await fs.readFile(path.join(dir, "ifaces.json"), "utf8"));
  } catch {
    return []; // no table — the package contributes no modules at all
  }
  return agentDefinitionsFromTable(table, PLUGIN_NAME_PATTERN.test(unscoped) ? unscoped : "");
}

/** The shape one manifest's `contributes` entry takes in the table, as read here. */
type ModuleTable = {
  contributes?: Record<string, ReadonlyArray<Record<string, unknown>>>;
};

/** The definitions a parsed ifaces.json table carries, by the same read as the directory form. */
export function agentDefinitionsFromTable(table: unknown, unscoped: string): AgentDefinition[] {
  const modules = (table as { modules?: unknown } | null)?.modules;
  if (typeof modules !== "object" || modules === null) return [];
  const out: AgentDefinition[] = [];
  for (const moduleTable of Object.values(modules as Record<string, ModuleTable | undefined>)) {
    const contributions = moduleTable?.contributes?.[AGENT_DEFINITIONS_SLOT];
    if (!Array.isArray(contributions)) continue;
    for (const entry of contributions) {
      if (typeof entry !== "object" || entry === null) continue;
      const name = entry.name;
      const agentState = entry.agentState;
      if (typeof name !== "string" || name.length === 0) continue;
      if (!Array.isArray(agentState) || !agentState.every((f) => typeof f === "string")) {
        continue;
      }
      out.push({ agentId: unscoped, name, files: agentState.filter((f) => f !== "") });
    }
  }
  return out;
}

/**
 * The Agent definitions a package contributes, read from an in-memory file map (an
 * uploaded zip's files, package-relative): its ifaces.json, as the table reads.
 */
export function agentDefinitionsFromFiles(
  files: ReadonlyMap<string, Uint8Array>,
  unscoped: string,
): AgentDefinition[] {
  const tableFile = files.get("ifaces.json");
  if (tableFile === undefined) return [];
  let table: unknown;
  try {
    table = JSON.parse(new TextDecoder().decode(tableFile));
  } catch {
    return []; // a broken table contributes nothing — the module load is the surface that refuses it
  }
  return agentDefinitionsFromTable(table, unscoped);
}

/** A package directory as files (relative path → bytes), `node_modules/` and `.git/` left out. */
export async function packageFiles(dir: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const walk = async (at: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const child = path.join(at, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, childRel);
      else if (entry.isFile()) out.set(childRel, new Uint8Array(await fs.readFile(child)));
    }
  };
  await walk(dir, "");
  return out;
}

/**
 * Copies a contributed Agent definition into the Project: `agents/<unscoped>/…`, as data —
 * nothing runs, nothing is registered, no credentials are written. The Agent is named by
 * the package's unscoped name. Reinstalling updates the definition files in place (the way
 * a skill reinstall does); files the package does not carry are left as they are, and the
 * Agent's lived state is never in the package.
 */
export async function copyAgentDefinition(opts: {
  root: string;
  projectId: string;
  /** The npm package name (`name` or `@scope/name`); the unscoped part names the Agent. */
  packageName: string;
  files: ReadonlyMap<string, Uint8Array>;
  /** The contribution as the package's table carries it: the display name and the file list. */
  definition: AgentDefinition;
}): Promise<{ agentId: string; copied: string[] }> {
  const agentId = unscopedPackageName(opts.packageName);
  if (!PLUGIN_NAME_PATTERN.test(agentId)) {
    throw new AgentCopyError(
      `The package name's unscoped part '${agentId}' cannot name an Agent directory.`,
    );
  }
  const dir = agentDir(opts.root, opts.projectId, agentId);
  const copied: string[] = [];
  for (const rel of opts.definition.files) {
    if (agentDefinitionEntry(rel) === null) continue;
    const bytes = opts.files.get(rel);
    if (bytes === undefined) continue;
    const file = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    copied.push(rel);
  }
  return { agentId, copied };
}
