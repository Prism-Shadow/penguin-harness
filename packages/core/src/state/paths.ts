/**
 * Local directory layout for Agent State and Project config.
 *
 * Strictly follows the `~/.penguin/data/projects/<project>/agents/<agent>/...` structure: the
 * data root's top level holds the server's own files and folders (`web.db`, `server.lock`,
 * `bin/`, `plugins/`, `app/`, `run/`, …), and every Project is a folder of `projects/`
 * (PRFC-0034), so no Project id shares a name with them.
 * This module only provides constants and pure path functions; it never creates directories or reads/writes files.
 * Docs: /docs/sessions-and-traces § "Data layout".
 */
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { installedWindowsDataLocation } from "./windows-data-location.js";

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
  if (process.env.PENGUIN_HOME !== undefined) return process.env.PENGUIN_HOME;
  const base = installedWindowsDataLocation();
  return base ? path.join(base, "data") : path.join(os.homedir(), ".penguin", "data");
}

/** The name of the data root's folder that holds the Projects, and the one id no new Project takes. */
export const PROJECTS_DIR_NAME = "projects";

/**
 * `<root>/projects`: the folder holding every Project's folder, one per id. The single definition
 * point of where Projects sit, so whatever lists or measures them follows wherever they move.
 */
export function projectsDir(root: string): string {
  return path.join(root, PROJECTS_DIR_NAME);
}

/** `<root>/projects/<projectId>`. */
export function projectDir(root: string, projectId: string): string {
  return path.join(projectsDir(root), projectId);
}

/**
 * `<root>/<projectId>`: where a Project's folder was before the `projects/` level (PRFC-0034).
 * Only the layout migration reads it, and the link it leaves there (state/layout-migration/);
 * both go at 1.0.
 */
export function legacyProjectDir(root: string, projectId: string): string {
  return path.join(root, projectId);
}

/**
 * `<projectDir>/agents` from an already-resolved Project directory path — the single
 * definition point of the agents-container layout.
 */
export function agentsDirFrom(projectDirPath: string): string {
  return path.join(projectDirPath, "agents");
}

/** `<projectDir>/agents`, the container directory holding every Agent in the Project. */
export function agentsDir(root: string, projectId: string): string {
  return agentsDirFrom(projectDir(root, projectId));
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
 * `<agentDir>/shared_env`, the Agent's reusable tool environments, one folder per environment.
 * The system prompt tells the model to keep them here; no code creates the folder.
 */
export function sharedEnvDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "shared_env");
}

/**
 * `<agentDir>/scratchpad/<sessionId>`, one Session's private scratchpad directory. The single
 * Session-scoped storage root shared by every by-product bound to that Session: input images
 * saved as path lines, the goal-mode control file, and Environment's truncated-tool-output
 * recovery files. Deleted together with the Session by the existing scratchpad cleanup path.
 */
export function sessionScratchpadDir(
  root: string,
  projectId: string,
  agentId: string,
  sessionId: string,
): string {
  return path.join(scratchpadDir(root, projectId, agentId), sessionId);
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

/** `<agentStateDir>/memory`, the Memory root (one subdirectory per scope, see state/memory.ts). */
export function memoryDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "memory");
}

/**
 * `<agentStateDir>/memory/<scopeKey>`, one Memory scope's topic-file directory — the `user`
 * scope or one Workspace's key. Each scope carries its own `MEMORY.md` index inside.
 */
export function memoryScopeDir(
  root: string,
  projectId: string,
  agentId: string,
  scopeKey: string,
): string {
  return path.join(memoryDir(root, projectId, agentId), scopeKey);
}

/** `<agentStateDir>/skills`. */
export function skillsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "skills");
}

/** `<agentStateDir>/hooks`: the installed hook packages, one directory per plugin (see agent-state.ts installHook). */
export function hooksDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "hooks");
}

/**
 * `<agentStateDir>/workbenches`: the Agent's workbenches, one folder per workbench id (doesn't
 * exist until the first one is made or installed).
 */
export function workbenchesDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "workbenches");
}

/**
 * `<agentDir>/app`: the data the Agent's workbenches keep, beside its Agent State rather than in
 * it, so a snapshot stays small and one root can be bound writable for the Agent's commands under
 * a `workspace-write` sandbox. Created on first use; doesn't exist until then.
 */
export function agentAppDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "app");
}

/**
 * `<agentDir>/app/data/<workbenchId>`: one workbench's data folder, which its handler reads and
 * writes through the host and the Agent with its file tools. It travels in the Agent export with
 * the workbench's data and is removed with the workbench.
 */
export function workbenchDataDir(
  root: string,
  projectId: string,
  agentId: string,
  workbenchId: string,
): string {
  return path.join(agentAppDir(root, projectId, agentId), "data", workbenchId);
}

/**
 * `<agentDir>/app/cache/<workbenchId>`: one workbench's disposable files, anything that can be
 * made again. Never exported; removed with the workbench.
 */
export function workbenchCacheDir(
  root: string,
  projectId: string,
  agentId: string,
  workbenchId: string,
): string {
  return path.join(agentAppDir(root, projectId, agentId), "cache", workbenchId);
}

/**
 * `<root>/run`: the runtime-only files of the server's workbenches — Unix sockets, pipes, locks.
 * A Unix socket's path holds at most 104 bytes on macOS (108 on Linux), and an Agent's folder is
 * deep (a Project id and an Agent id of up to 64 characters each), so these live at a short path
 * of their own: one fixed-length segment per level, a hash of its id (`runSegment`). Never
 * exported; a level goes when its Project, Agent or workbench does.
 */
export function runDir(root: string): string {
  return path.join(root, "run");
}

/** The fixed-length name an id takes under {@link runDir}: 10 hex characters of its SHA-256. */
export function runSegment(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 10);
}

/** `<root>/run/<project>`: one Project's runtime folder. */
export function projectRunDir(root: string, projectId: string): string {
  return path.join(runDir(root), runSegment(projectId));
}

/** `<root>/run/<project>/<agent>`: one Agent's runtime folder, writable to its sandboxed commands. */
export function agentRunDir(root: string, projectId: string, agentId: string): string {
  return path.join(projectRunDir(root, projectId), runSegment(agentId));
}

/**
 * What a new Project id may not be: `projects`. Its folder is `<root>/projects/projects/`, but an
 * older build run on the same data root after a downgrade takes `<root>/projects` for that
 * Project's folder and writes its config and Agents into the folder holding every Project.
 */
export const RESERVED_PROJECT_IDS: readonly string[] = [PROJECTS_DIR_NAME];

/**
 * `<root>/app`: the server level of a workbench's folders — what every copy of an app installed
 * from a plugin shares across this data root's Projects and Agents (a model's weights, a tool's
 * binaries). Its state folders sit under `<root>/run/server` at a short path.
 */
export function serverAppDir(root: string): string {
  return path.join(root, "app");
}

/**
 * The machine level of a workbench's folders: shared by every data root of this OS user on this
 * computer (the installed app, a dev instance, the CLI's own root), `~/.penguin/machine` unless
 * `PENGUIN_MACHINE_HOME` names another. Never shared between OS users.
 */
export function machineAppDir(): string {
  return process.env.PENGUIN_MACHINE_HOME ?? path.join(os.homedir(), ".penguin", "machine");
}

/**
 * One installed app's folders at a shared level: `<base>/{data,cache}/<plugin>/<workbenchId>`,
 * and its state folder `<runBase>/<runSegment("<plugin>/<workbenchId>")>` at a short path. `base`
 * and `runBase` are the server's (`serverAppDir`, `<root>/run/server`) or the machine's
 * (`machineAppDir`, `<machineAppDir>/run`).
 */
export function sharedWorkbenchDirs(
  base: string,
  runBase: string,
  plugin: string,
  workbenchId: string,
): { dataDir: string; cacheDir: string; stateDir: string } {
  return {
    dataDir: path.join(base, "data", plugin, workbenchId),
    cacheDir: path.join(base, "cache", plugin, workbenchId),
    stateDir: path.join(runBase, runSegment(`${plugin}/${workbenchId}`)),
  };
}

/** `<root>/run/<project>/<agent>/<workbench>`: one workbench's state folder (sockets, pipes, locks). */
export function workbenchStateDir(
  root: string,
  projectId: string,
  agentId: string,
  workbenchId: string,
): string {
  return path.join(agentRunDir(root, projectId, agentId), runSegment(workbenchId));
}

/** `<agentStateDir>/schedule`, the scheduled-task directory (doesn't exist when unconfigured). */
export function scheduleDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentStateDir(root, projectId, agentId), "schedule");
}

/** `<agentDir>/snapshots`, Agent State version snapshots (doesn't exist when unconfigured). */
export function snapshotsDir(root: string, projectId: string, agentId: string): string {
  return path.join(agentDir(root, projectId, agentId), "snapshots");
}
