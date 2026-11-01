/**
 * The Agent definition a plugin package contributes, and how its copy travels.
 *
 * The package contributes the definition the way it contributes a sandbox backend: a
 * module in its entry file whose manifest (generated into `ifaces.json`) contributes to
 * the agents mechanism's `definitions` slot. The contribution's static half names the
 * Agent; its CODE half is the contributor copying its own `agent_state/` — the agents
 * mechanism (services/agent-config-service.ts) calls it once per Project that lists the
 * package, and the copy streams file by file, however big the definition is, with nothing
 * of the package read into memory. Nothing here imports the package either: the manifest
 * is data, read and checked WITHOUT executing the module.
 *
 * The Agent's lived history (memory, traces, snapshots, workspaces, scratchpad, the
 * vault) is runtime state and never travels in a package — the copy below skips it, and
 * a contributor's own copy does the same by sharing these helpers.
 */
import fs from "node:fs/promises";
import fsp from "node:fs";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, agentStateDir } from "@prismshadow/penguin-core";

/** The package directory that holds a contributed definition (the Agent's own agent_state). */
export const AGENT_STATE_DIR = "agent_state";

/** Directories inside `agent_state/` that are the Agent's lived history, never its definition. */
export const RUNTIME_STATE_DIRS = ["memory", "traces", "snapshots", "workspaces", "scratchpad"];

/** The slot the agents mechanism opens to plugin packages (`AgentConfigService.definitions`). */
export const AGENT_DEFINITIONS_SLOT = "AgentConfigService.definitions";

export class AgentCopyError extends Error {}

/**
 * Whether a definition-file path is one the copy may take: inside `agent_state/`, no
 * traversal, no lived history, no dot-prefixed entry — the vault above all: a secret
 * never travels in a package.
 */
export function agentDefinitionEntry(rel: string): boolean {
  const parts = rel.split("/");
  if (parts[0] !== AGENT_STATE_DIR || parts.length < 2) return false;
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  const inner = parts[1]!;
  if (inner.startsWith(".") || RUNTIME_STATE_DIRS.includes(inner)) return false;
  return true;
}

/** Whether an Agent id is one the copy may install under: a plugin name. */
export function isAgentId(agentId: string): boolean {
  return PLUGIN_NAME_PATTERN.test(agentId);
}

/**
 * Copies a definition directory into an Agent's state, streaming: `from` is the
 * contributor package's own `agent_state/` (it knows where it lives, from its entry
 * module's import.meta.url), `toAgentDir` the target Agent's directory. Files the
 * definition does not carry are left as they are; the lived history and dot-prefixed
 * entries — the vault above all — are skipped where they sit. Each file is streamed
 * whole (open → pump → close): a multi-gigabyte weight in the definition travels
 * without any of it in memory.
 */
export async function copyAgentState(opts: {
  fromDir: string;
  toAgentDir: string;
}): Promise<string[]> {
  const copied: string[] = [];
  const walk = async (at: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(at, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!agentDefinitionEntry(`${childRel}/x`)) continue; // a skipped top-level dir
        await walk(path.join(at, entry.name), childRel);
        continue;
      }
      if (!entry.isFile() || !agentDefinitionEntry(childRel)) continue;
      const file = path.join(opts.toAgentDir, ...childRel.split("/"));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const source = fsp.createReadStream(path.join(at, entry.name));
        const target = fsp.createWriteStream(file);
        source.on("error", reject);
        target.on("error", reject);
        target.on("finish", () => resolve());
        source.pipe(target);
      });
      copied.push(childRel);
    }
  };
  await walk(opts.fromDir, "");
  return copied;
}

/** The Agent directory a definition installs into: `agents/<agentId>` of the Project. */
export function agentTargetDir(root: string, projectId: string, agentId: string): string {
  return path.dirname(agentStateDir(root, projectId, agentId));
}
