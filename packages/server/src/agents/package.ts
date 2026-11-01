/**
 * The Agent definition a plugin package registers, and what installing does with it.
 *
 * The package registers the contribution in its own manifest: `"penguin": { "agent": true }`
 * in its package.json — the same block the hook package and the MCP servers are declared in.
 * The harness reads that one line; the definition's content lives in the package's
 * `agent_state/` directory, the way a skill's lives in `skills/<name>/SKILL.md`. Installing
 * the package copies that directory into the Project's agents/ as data: nothing in the
 * package runs at copy time, no credentials are written, nothing is registered anywhere.
 * The Agent's lived history (memory, traces, snapshots, workspaces, scratchpad, the vault)
 * is runtime state and never travels in a package.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, agentDir, unscopedPackageName } from "@prismshadow/penguin-core";

/** The package directory that holds a registered Agent definition (the Agent's own agent_state). */
export const AGENT_STATE_DIR = "agent_state";

/** Directories inside `agent_state/` that are the Agent's lived history, never its definition. */
export const RUNTIME_STATE_DIRS = ["memory", "traces", "snapshots", "workspaces", "scratchpad"];

export class AgentCopyError extends Error {}

/**
 * Whether a parsed package.json registers an Agent definition: `penguin.agent === true`, the
 * one form the manifest reader accepts. Anything else is the manifest reader's business —
 * it warns and ignores — and reads as no registration here.
 */
export function registersAgent(packageJson: unknown): boolean {
  const penguin =
    typeof packageJson === "object" && packageJson !== null
      ? (packageJson as { penguin?: { agent?: unknown } }).penguin
      : undefined;
  return typeof penguin === "object" && penguin !== null && penguin.agent === true;
}

/** Whether an installed package directory registers one: its package.json, as parsed. */
export async function registeredAgent(dir: string): Promise<boolean> {
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
  } catch {
    return false; // no readable manifest
  }
  return registersAgent(packageJson);
}

/**
 * One definition entry of a package (package-relative POSIX path): `agent_state/…`, minus
 * the lived-history directories and dot-prefixed entries — the vault above all: a secret
 * never travels in a package. Everything else in the package is not part of the definition.
 */
export function agentDefinitionEntry(rel: string): string | null {
  const parts = rel.split("/");
  if (parts[0] !== AGENT_STATE_DIR || parts.length < 2) return null;
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  const inner = parts[1]!;
  if (inner.startsWith(".") || RUNTIME_STATE_DIRS.includes(inner)) return null;
  return rel;
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
 * Copies a registered Agent definition into the Project: `agents/<unscoped>/agent_state/…`,
 * as data — nothing runs, nothing is registered, no credentials are written. The Agent is
 * named by the package's unscoped name. Reinstalling updates the definition files in place
 * (the way a skill reinstall does); files the package does not carry are left as they are,
 * and the Agent's lived state is never in the package.
 */
export async function copyAgentDefinition(opts: {
  root: string;
  projectId: string;
  /** The npm package name (`name` or `@scope/name`); the unscoped part names the Agent. */
  packageName: string;
  files: ReadonlyMap<string, Uint8Array>;
}): Promise<{ agentId: string; copied: string[] }> {
  const agentId = unscopedPackageName(opts.packageName);
  if (!PLUGIN_NAME_PATTERN.test(agentId)) {
    throw new AgentCopyError(
      `The package name's unscoped part '${agentId}' cannot name an Agent directory.`,
    );
  }
  const dir = agentDir(opts.root, opts.projectId, agentId);
  const copied: string[] = [];
  for (const [rel, bytes] of opts.files) {
    if (agentDefinitionEntry(rel) === null) continue;
    const file = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    copied.push(rel);
  }
  return { agentId, copied };
}
