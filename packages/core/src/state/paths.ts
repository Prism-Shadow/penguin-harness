/**
 * Local directory layout for Agent State and Project config.
 *
 * Strictly follows the `~/.penguin/data/<project>/agents/<agent>/...` structure.
 * This module only provides constants and pure path functions; it never creates directories or reads/writes files.
 * Docs: /docs/sessions-and-traces § "Data layout".
 */
import os from "node:os";
import path from "node:path";

/** Default Project id used when none is specified. */
export const DEFAULT_PROJECT_ID = "default_project";

/** Default Agent id used when none is specified. */
export const DEFAULT_AGENT_ID = "default_agent";

/**
 * Resolves the local data root directory.
 * Prefers the `PENGUIN_HOME` environment variable, otherwise falls back to `~/.penguin/data`
 * (under the hidden `~/.penguin` home so it never collides with unrelated folders, and in a
 * `data/` subdir kept separate from the installer's binaries under `~/.penguin`).
 */
export function resolveRoot(): string {
  return process.env.PENGUIN_HOME ?? path.join(os.homedir(), ".penguin", "data");
}

/** `<root>/<projectId>`. */
export function projectDir(root: string, projectId: string): string {
  return path.join(root, projectId);
}

/** `<projectDir>/agents`, the container directory holding every Agent in the Project. */
export function agentsDir(root: string, projectId: string): string {
  return path.join(projectDir(root, projectId), "agents");
}

/** `<projectDir>/agents/<agentId>`. */
export function agentDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentsDir(root, projectId), agentId);
}

/** `<agentDir>/agent_state`. */
export function agentStateDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "agent_state");
}

/** `<agentDir>/traces`. */
export function tracesDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "traces");
}

/** `<agentDir>/scratchpad`, the Agent's temporary/draft file directory (the model creates a subdirectory per Session id). */
export function scratchpadDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "scratchpad");
}

/** `<agentDir>/workspaces`. */
export function workspacesDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "workspaces");
}

/**
 * `<agentDir>/scratchpad/<sessionId>/GOAL.yaml`, the goal-mode control file of one Session
 * (sibling of the model's PLAN.md convention; see goal/goal-file.ts for field ownership).
 */
export function goalFilePath(
  root: string,
  projectId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(scratchpadDir(root, projectId, agentId), sessionId, "GOAL.yaml");
}

/**
 * `<projectDir>/.project_config.toml`, the Project's single config file (a hidden file, not
 * shown by default `ls`, written with mode 0600; model entries are inlined with their credential,
 * see state/project-config.ts).
 */
export function projectConfigPath(root: string, projectId: string): string {
  return path.join(projectDir(root, projectId), ".project_config.toml");
}

/** `<agentStateDir>/system_config.yaml`. */
export function systemConfigPath(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "system_config.yaml");
}

/** `<agentStateDir>/AGENTS.md`. */
export function agentsMdPath(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "AGENTS.md");
}

/** `<agentStateDir>/.vault.toml`, the Agent-level environment-variable vault (see state/agent-vault.ts). */
export function agentVaultPath(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), ".vault.toml");
}

/** `<agentStateDir>/tools`, reserved for user-defined Tool config. */
export function toolsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "tools");
}

/** `<agentStateDir>/memory`. */
export function memoryDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "memory");
}

/** `<agentStateDir>/skills`. */
export function skillsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "skills");
}

/** `<agentStateDir>/schedule`, the scheduled-task directory (doesn't exist when unconfigured). */
export function scheduleDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "schedule");
}

/** `<agentDir>/benchmarks`, the capability-evaluation question bank and scores (doesn't exist when unconfigured). */
export function benchmarksDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "benchmarks");
}

/** `<agentDir>/snapshots`, Agent State version snapshots (doesn't exist when unconfigured). */
export function snapshotsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "snapshots");
}
