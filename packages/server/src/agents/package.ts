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
 */
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateDir } from "@prismshadow/penguin-core";

/** The package directory that holds a contributed definition (the Agent's own agent_state). */
export const AGENT_STATE_DIR = "agent_state";

/** The slot the agents mechanism opens to plugin packages (`AgentConfigService.definitions`). */
export const AGENT_DEFINITIONS_SLOT = "AgentConfigService.definitions";

/**
 * Copies the package's definition into an Agent's directory, whole: `from` is the
 * contributor package's own `agent_state/` (it knows where it lives, from its entry
 * module's import.meta.url), `toAgentDir` the target Agent's directory. One `fs.cp` —
 * the kernel's own streaming copier, the tool workbenches, traces and built-in
 * benchmarks already travel by: every file under the directory travels, however big,
 * with nothing of it in memory; a re-install replaces what the definition carries now
 * and touches nothing else.
 */
export async function copyAgentState(opts: { fromDir: string; toAgentDir: string }): Promise<void> {
  await fs.cp(opts.fromDir, path.join(opts.toAgentDir, AGENT_STATE_DIR), {
    recursive: true,
    force: true,
  });
}

/** The Agent directory a definition installs into: `agents/<agentId>` of the Project. */
export function agentTargetDir(root: string, projectId: string, agentId: string): string {
  return path.dirname(agentStateDir(root, projectId, agentId));
}
