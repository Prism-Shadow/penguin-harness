/**
 * The Agent definition a plugin package contributes, and what loading does with it.
 *
 * The package contributes the definition the way it contributes a sandbox provider: a
 * module in its entry file whose manifest (generated into `ifaces.json`) contributes to
 * the agents mechanism's `definitions` slot — the static half names the Agent and lists
 * the definition's files, the package's `agent_state/` content as the manifest lists it.
 * Nothing here imports the package: the table is the package's static description, read
 * and checked WITHOUT executing the module. When a package loads (a boot, a Project's
 * apply after an install), the listed files are copied into the agents/ of every Project
 * that lists the package — as data: nothing in the package runs at copy time, no
 * credentials are written, nothing is registered anywhere. The Agent's lived history
 * (memory, traces, snapshots, workspaces, scratchpad, the vault) is runtime state and
 * never travels in a package.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, agentDir } from "@prismshadow/penguin-core";

/** The package directory that holds a contributed definition (the Agent's own agent_state). */
export const AGENT_STATE_DIR = "agent_state";

/** Directories inside `agent_state/` that are the Agent's lived history, never its definition. */
export const RUNTIME_STATE_DIRS = ["memory", "traces", "snapshots", "workspaces", "scratchpad"];

/** The slot the agents mechanism opens to plugin packages (`AgentConfigService.definitions`). */
export const AGENT_DEFINITIONS_SLOT = "AgentConfigService.definitions";

export class AgentCopyError extends Error {}

/**
 * One Agent definition a package contributes, read from its ifaces.json without importing
 * the package: the contribution's static half — the Agent id the copy lands under, a
 * display name, and the definition's files, package-relative as the manifest lists them.
 */
export interface AgentDefinition {
  /** The Agent's id: the directory the copy lands under, as the contribution names it. */
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

/** The shape one manifest's `contributes` entry takes in the table, as read here. */
type ModuleTable = {
  contributes?: Record<string, ReadonlyArray<Record<string, unknown>>>;
};

/** One definition per table entry: the slot's data half, as the manifest carries it. */
function definitionOf(entry: Record<string, unknown>): AgentDefinition | null {
  const agentId = entry.agentId;
  const name = entry.name;
  const agentState = entry.agentState;
  if (typeof agentId !== "string" || agentId.length === 0) return null;
  if (!PLUGIN_NAME_PATTERN.test(agentId)) return null;
  if (!Array.isArray(agentState) || !agentState.every((f) => typeof f === "string")) return null;
  return {
    agentId,
    ...(typeof name === "string" && name.length > 0 ? { name } : {}),
    files: agentState.filter((f) => f !== ""),
  };
}

/** The definitions a parsed ifaces.json table carries: every module's contribution to the slot. */
export function agentDefinitionsFromTable(table: unknown): AgentDefinition[] {
  const modules = (table as { modules?: unknown } | null)?.modules;
  if (typeof modules !== "object" || modules === null) return [];
  const out: AgentDefinition[] = [];
  for (const moduleTable of Object.values(modules as Record<string, ModuleTable | undefined>)) {
    const contributions = moduleTable?.contributes?.[AGENT_DEFINITIONS_SLOT];
    if (!Array.isArray(contributions)) continue;
    for (const entry of contributions) {
      if (typeof entry !== "object" || entry === null) continue;
      const definition = definitionOf(entry);
      if (definition !== null) out.push(definition);
    }
  }
  return out;
}

/**
 * The Agent definitions a package directory contributes, read from its ifaces.json. Nothing
 * is imported — the table is the package's static description, generated beside its
 * package.json.
 */
export async function contributedAgentDefinitions(dir: string): Promise<AgentDefinition[]> {
  let table: unknown;
  try {
    table = JSON.parse(await fs.readFile(path.join(dir, "ifaces.json"), "utf8"));
  } catch {
    return []; // no table — the package contributes no modules at all
  }
  return agentDefinitionsFromTable(table);
}

/**
 * The Agent definitions a package contributes, read from an in-memory file map (a loaded
 * package's files, package-relative): its ifaces.json, as the table reads.
 */
export function agentDefinitionsFromFiles(
  files: ReadonlyMap<string, Uint8Array>,
): AgentDefinition[] {
  const tableFile = files.get("ifaces.json");
  if (tableFile === undefined) return [];
  let table: unknown;
  try {
    table = JSON.parse(new TextDecoder().decode(tableFile));
  } catch {
    return []; // a broken table contributes nothing — the module load is the surface that refuses it
  }
  return agentDefinitionsFromTable(table);
}

/**
 * Copies one contributed definition into the Project: `agents/<agentId>/…`, as data —
 * nothing runs, nothing is registered, no credentials are written. Reinstalling updates
 * the definition files in place (the way a skill reinstall does); files the package does
 * not carry are left as they are, and the Agent's lived state is never in the package.
 */
export async function copyAgentDefinition(opts: {
  root: string;
  projectId: string;
  definition: AgentDefinition;
  /** The package's files, package-relative → bytes. */
  files: ReadonlyMap<string, Uint8Array>;
}): Promise<string[]> {
  const { agentId } = opts.definition;
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
  return copied;
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
