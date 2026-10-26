/**
 * Agent service.
 *
 * The list is the union of "DB index ∪ directory scan", held to the one rule every Agent route
 * applies: an Agent exists while `agents/<id>/agent_state/system_config.yaml` does. Unmanaged
 * directories found are backfilled into the DB — this handles Agents created directly via the
 * CLI — and an index row whose folder no longer has that file is not listed, so a listed Agent
 * can always be opened and deleted.
 * Delete: the folder is renamed into `agents/.deleting/` (one rename, so it leaves every list
 * and route at once) and its contents are removed in the background, the removal reporting how
 * far it got; a server that stops mid-removal resumes it at its next start.
 * Create: generate agent-<8hex>, initialize Agent State via core's `createAgent`,
 * then write name/description into system_config.yaml (parseDocument preserves the
 * template's comments).
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import { countEntries, FsLimiter, purgeTree } from "./tree-purge.js";
import {
  agentDir,
  agentsDir,
  agentsMdPath,
  BUILTIN_AGENT_IDS,
  createAgent as coreCreateAgent,
  installPlugin,
  installSkill,
  McpServerNameTakenError,
  listInstalledHooks,
  isValidId,
  loadAgentVault,
  memoryDir,
  scheduleDir,
  skillsDir,
  systemConfigPath,
  comparePluginVersions,
  libraryPlugin,
  loadLibraryPlugins,
  parseSkillFrontmatter,
  pluginContentVersion,
  listInstalledWorkbenches,
} from "@prismshadow/penguin-core";
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import { SEMANTIC_ID_PATTERN, SEMANTIC_ID_RULE } from "./ids.js";
import { isWorkbenchId, workbenchesDir } from "../workbenches/store.js";
import { isTopicFileName } from "./memory-service.js";
import type { AgentDeletionInfo, PluginUpdateRef } from "../api/types.js";
import { resolveLibraryPlugins } from "./plugin-library.js";
import { resolveDirectorySkills } from "./directory-skills.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Config, Paths } from "../hmr/capabilities.js";
import type { AgentConfig, AgentLifecycle, Snapshots } from "../mechanisms/agents.js";
import type { AgentIndex } from "../mechanisms/projects.js";

/**
 * How much of a SKILL.md is read to answer "which version is installed" (see `installedSkills`).
 * Generous against the largest frontmatter block the library ships (under 1 KB) and still a
 * bounded read of a file whose body can be tens of kilobytes.
 */
const SKILL_HEAD_BYTES = 4096;

/**
 * The first `bytes` of a file as UTF-8. A truncation can split a multi-byte character at the
 * tail, which is harmless for every caller here: what is parsed out of the head is ASCII.
 */
async function readHead(file: string, bytes: number): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * `agents/.deleting/`: where a deleted Agent's folder waits while its contents are removed. A
 * sibling of the Agents, so moving one in is a rename within one directory — never a copy across
 * filesystems — and a dot-name, which no Agent id can be, so nothing that walks `agents/` takes
 * it for one.
 */
export const DELETING_DIR = ".deleting";

/** `<agentsDir>/.deleting`. */
export function deletingDir(root: string, projectId: string): string {
  return path.join(agentsDir(root, projectId), DELETING_DIR);
}

/** A deletion's name, which is its folder's name under `.deleting/`: the Agent id and when. */
const DELETION_NAME = /^(.+)-(\d+)$/;

/**
 * Filesystem calls the background removal keeps in flight, across every deletion at once. libuv
 * gives file I/O four threads by default; holding two leaves the others free for the requests
 * the server is answering meanwhile.
 */
const PURGE_SLOTS = 2;

/** How long a finished deletion stays readable, for a page that polls it a little late. */
const FINISHED_DELETION_TTL_MS = 10 * 60 * 1000;

/**
 * Windows refuses to move a folder while a program holds a file in it open; the hold is often
 * momentary (an indexer, an antivirus scan), so the move is tried a few times before giving up.
 */
const MOVE_RETRIES = 4;
const MOVE_RETRY_STEP_MS = 100;
const MOVE_BUSY = new Set(["EBUSY", "EPERM", "EACCES"]);

/** Refuses deleting a built-in Agent: they are provisioned with the Project. */
export function refuseBuiltinDeletion(agentId: string): void {
  if (BUILTIN_AGENT_IDS.includes(agentId)) {
    throw new HttpError(
      409,
      "cannot_delete_builtin_agent",
      "Built-in Agents are provisioned with the Project and cannot be deleted from the web.",
    );
  }
}

export interface AgentListItem {
  agentId: string;
  name?: string;
  description?: string;
  createdAt?: string;
  /** Last config modification time: the later of system_config.yaml / AGENTS.md mtime. */
  updatedAt?: string;
  /** Tool count: number of tools.builtin + tools.mcpServers entries (MCP counted per server). */
  toolCount: number;
  /** Agent State version number (missing field treated as 1). */
  version: number;
  /** Whether the config's kernel stamp is behind the current defaults generation (missing stamp = outdated) — the list card's update hint. */
  kernelOutdated: boolean;
  /** Number of vault keys. */
  vaultKeyCount: number;
  /** Number of scheduled tasks (count of .toml files directly under schedule/, including invalid ones; archived files under schedule/expired/ are not counted). */
  scheduleCount: number;
  /** Workbench folders with a manifest, including ones with a load error. */
  workbenchCount: number;
  /** Number of installed Skills (count of skills/<name>/ directories that contain a SKILL.md). */
  skillCount: number;
  /** Number of installed hook packages (hooks/<name>/ directories with a hooks.json). */
  hookCount: number;
  /** Installed skills and hook packages the library has a newer version of, by plugin, each carrying that library version. */
  pluginUpdates: PluginUpdateRef[];
  /** Number of memory topic files across every scope directory under memory/ (independent of the memory switch, like skillCount). */
  memoryCount: number;
}

@Component()
export class AgentService implements AgentLifecycle {
  @Use() private readonly paths!: Paths;
  private get root(): string {
    return this.paths.root;
  }
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly snapshots!: Snapshots;

  /** Deletions this process knows, by `${projectId}/${deletionId}`. */
  private readonly deletions = new Map<string, AgentDeletionInfo>();
  /** The removals in flight, by the same key. */
  private readonly running = new Map<string, Promise<void>>();
  /** Shared by every removal, so two deletions at once still hold only PURGE_SLOTS calls. */
  private readonly limiter = new FsLimiter(PURGE_SLOTS);
  /** Ends this generation's removals when it is disposed; the next one resumes them from disk. */
  private readonly stopping = new AbortController();

  setup(ctx: ClassCtx) {
    ctx.effect(() => this.stopping.abort());
  }

  /**
   * Union of DB index ∪ directory scan; unmanaged directory Agents are backfilled into the DB.
   * Only what `AgentConfig.exists` accepts is listed — the rule every route checks.
   */
  async listAgents(projectId: string): Promise<AgentListItem[]> {
    const known = new Map(this.agents.list(projectId).map((r) => [r.agentId, r]));

    let entries: string[] = [];
    try {
      const dirents = await fs.readdir(agentsDir(this.root, projectId), { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      // The Project's agents/ directory doesn't exist yet (no Agent directories): return from the DB index only.
    }
    for (const agentId of entries) {
      if (known.has(agentId) || !isValidId(agentId)) continue;
      const configPath = systemConfigPath(this.root, projectId, agentId);
      let createdAt: string;
      try {
        const stat = await fs.stat(configPath);
        createdAt = (stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime).toISOString();
      } catch {
        continue; // A directory without system_config.yaml is not an Agent (e.g. a temp folder)
      }
      const row = { projectId, agentId, createdAt };
      this.agents.insertOrIgnore(row);
      known.set(agentId, row);
    }

    // The plugin library is read once for the whole list (every Agent is checked against the
    // same files). Meta reads and mtime stats for each Agent run in parallel (Promise.all
    // preserves the sorted order).
    const library = loadLibraryPlugins();
    // An index row is listed only while its folder is an Agent by the routes' own rule: a row
    // whose folder has lost its system_config.yaml would be a card that neither opens nor deletes.
    const present = await Promise.all(
      [...known.values()].map(async (row) =>
        (await this.agentConfig.exists(projectId, row.agentId)) ? row : null,
      ),
    );
    const sorted = present
      .filter((row) => row !== null)
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.agentId.localeCompare(b.agentId)
          : a.createdAt < b.createdAt
            ? -1
            : 1,
      );
    return Promise.all(
      sorted.map(async (row) => {
        const [meta, updatedAt, vaultKeyCount, scheduleCount, installed, memoryCount] =
          await Promise.all([
            this.agentConfig.readCardMeta(projectId, row.agentId),
            this.configUpdatedAt(projectId, row.agentId),
            this.vaultKeyCount(projectId, row.agentId),
            this.scheduleCount(projectId, row.agentId),
            this.installedPlugins(projectId, row.agentId, library),
            this.memoryCount(projectId, row.agentId),
          ]);
        return {
          agentId: row.agentId,
          ...meta,
          createdAt: row.createdAt,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
          vaultKeyCount,
          scheduleCount,
          workbenchCount: await this.workbenchCount(projectId, row.agentId),
          skillCount: installed.skillCount,
          hookCount: installed.hookCount,
          pluginUpdates: installed.updates,
          memoryCount,
        };
      }),
    );
  }

  /** Count installed folders without compiling or walking their UI/runtime assets. */
  private async workbenchCount(projectId: string, agentId: string): Promise<number> {
    const base = workbenchesDir(this.root, projectId, agentId);
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    const present = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && isWorkbenchId(entry.name))
        .map(async (entry) => {
          try {
            return (await fs.stat(path.join(base, entry.name, "package.json"))).isFile();
          } catch {
            return false;
          }
        }),
    );
    return present.filter(Boolean).length;
  }

  /**
   * Every id `createAgent` refuses as taken, as names only: the index rows and every entry under
   * `agents/`. Unlike `listAgents`, this includes a folder with no `system_config.yaml`, and it
   * opens no Agent.
   */
  async takenAgentIds(projectId: string): Promise<string[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(agentsDir(this.root, projectId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return [...new Set([...this.agents.list(projectId).map((r) => r.agentId), ...entries])];
  }

  /** Number of vault keys (falls back to 0 on read failure). */
  private async vaultKeyCount(projectId: string, agentId: string): Promise<number> {
    try {
      return Object.keys(await loadAgentVault(this.root, projectId, agentId)).length;
    } catch {
      return 0;
    }
  }

  /** Number of scheduled tasks: count of .toml files directly under schedule/ (0 if the directory doesn't exist). The expired/ subdirectory of archived files is not a .toml name, so it is never counted. */
  private async scheduleCount(projectId: string, agentId: string): Promise<number> {
    try {
      const names = await fs.readdir(scheduleDir(this.root, projectId, agentId));
      return names.filter((n) => n.endsWith(".toml")).length;
    } catch {
      return 0;
    }
  }

  /**
   * One pass over `skills/` and one over `hooks/`, answering the card's questions: how many
   * skills and hook packages are installed, and which of them the plugin library has moved
   * past — each part against the library's same part (a skill's dated version against that
   * skill's, a hook package's against the plugin's `hooks.version`), reported by plugin, since
   * a plugin is what gets reinstalled to catch up.
   *
   * Only the HEAD of each SKILL.md is read, and that bound is load-bearing rather than a
   * micro-optimization: a preinstalled library is ~180 KB of SKILL.md across seventeen files
   * per Agent, so a Project of ten Agents would move ~2 MB through every `GET /agents` — and
   * the plugin page reloads that list after each update. The frontmatter block is at the head
   * by definition (the parser's regex is anchored there) and the largest one in the library is
   * under 1 KB, so {@link SKILL_HEAD_BYTES} covers it many times over; a block that somehow
   * overran it would be truncated, fail to parse, and read as an empty version — the same
   * fallback an unparseable file already takes, and one that sorts before every real version.
   *
   * The directory name is the identity (core's listings say so, and install/uninstall address
   * by it), so that — not a frontmatter `name` — is what the library is looked up by: a skill
   * by the plugin that ships it, a hook package by the plugin of the same name. A skill the
   * library does not carry (installed from a zip or a picked directory) has no library version
   * to be behind and is never an update. An unreadable skill degrades to "not installed" / "no
   * update": a card hint must not be the thing that makes the Agent list fail. The library is
   * the caller's, read once per listing rather than once per installed skill.
   */
  private async installedPlugins(
    projectId: string,
    agentId: string,
    library: readonly LibraryPlugin[],
  ): Promise<{ skillCount: number; hookCount: number; updates: PluginUpdateRef[] }> {
    const base = skillsDir(this.root, projectId, agentId);
    let dirents: Dirent[] = [];
    try {
      dirents = await fs.readdir(base, { withFileTypes: true });
    } catch {
      // No skills/ directory: nothing installed.
    }
    const skills = await Promise.all(
      dirents
        // Dot-prefixed directories are install staging, never a Skill (a Skill name has no dot).
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map(async (d) => {
          try {
            const head = await readHead(path.join(base, d.name, "SKILL.md"), SKILL_HEAD_BYTES);
            return { name: d.name, version: parseSkillFrontmatter(head)?.version ?? "" };
          } catch {
            return null;
          }
        }),
    );
    const hooks = await listInstalledHooks(this.root, projectId, agentId);
    const byPlugin = new Map(library.map((p) => [p.name, p] as const));
    const bySkill = new Map(
      library.flatMap((p) => p.skills.map((s) => [s.name, { plugin: p, skill: s }] as const)),
    );
    // Part by part: an installed skill against the library's same skill, an installed hook
    // package against the library plugin's hook package. The plugin's own (npm) version says
    // nothing about what an Agent carries.
    const updates = new Map<string, string>();
    for (const skill of skills) {
      if (skill === null) continue;
      const shipped = bySkill.get(skill.name);
      if (shipped && comparePluginVersions(shipped.skill.version, skill.version) > 0) {
        updates.set(shipped.plugin.name, pluginContentVersion(shipped.plugin));
      }
    }
    for (const hook of hooks) {
      const plugin = byPlugin.get(hook.name);
      if (plugin?.hooks && comparePluginVersions(plugin.hooks.manifest.version, hook.version) > 0) {
        updates.set(plugin.name, pluginContentVersion(plugin));
      }
    }
    for (const installed of await listInstalledWorkbenches(this.root, projectId, agentId)) {
      const plugin = byPlugin.get(installed.plugin);
      const workbench = plugin?.workbenches?.find((w) => w.name === installed.name);
      if (plugin && workbench && comparePluginVersions(workbench.version, installed.version) > 0)
        updates.set(plugin.name, pluginContentVersion(plugin));
    }
    return {
      skillCount: skills.filter((s) => s !== null).length,
      hookCount: hooks.length,
      updates: [...updates].map(([name, version]) => ({ name, version })),
    };
  }

  /**
   * Where one library plugin stands on one Agent, as one pair of dated versions of the same
   * part — so `library` newer than `installed` is exactly "some part is behind", the rule
   * {@link installedPlugins} draws the list cards' hints from. Each part the Agent carries (a
   * skill, the hook package) is paired with the library's same part; among the parts that are
   * behind — or, when none is, among all of them — the one with the OLDEST installed version
   * answers. `installed` is null when the Agent carries none of the plugin's parts, with
   * `library` then the plugin's content version; both are null when the library has no such
   * plugin. Only the head of each SKILL.md is read (see SKILL_HEAD_BYTES), so the answer costs
   * one small read per skill the plugin ships.
   *
   * The organization runtime asks this per employee per pass to keep company plugins current.
   * A skill the Agent does not carry — never installed, or removed by hand — counts for
   * nothing: a plugin whose carried skills are all current reads as current even where one of
   * them is missing. Restoring a deleted skill is the Agents page's business, not a pass's.
   */
  async pluginVersion(
    projectId: string,
    agentId: string,
    pluginName: string,
  ): Promise<{ installed: string | null; library: string | null }> {
    const plugin = libraryPlugin(pluginName);
    if (!plugin) return { installed: null, library: null };
    const base = skillsDir(this.root, projectId, agentId);
    const parts: { installed: string; library: string }[] = [];
    for (const skill of plugin.skills) {
      try {
        const head = await readHead(path.join(base, skill.name, "SKILL.md"), SKILL_HEAD_BYTES);
        parts.push({
          installed: parseSkillFrontmatter(head)?.version ?? "",
          library: skill.version,
        });
      } catch {
        // The Agent does not carry this skill: it says nothing about the installed version.
      }
    }
    if (plugin.hooks !== undefined) {
      const hooks = await listInstalledHooks(this.root, projectId, agentId);
      const installedHook = hooks.find((h) => h.name === pluginName);
      if (installedHook) {
        parts.push({ installed: installedHook.version, library: plugin.hooks.manifest.version });
      }
    }
    for (const installed of await listInstalledWorkbenches(this.root, projectId, agentId)) {
      const workbench =
        installed.plugin === pluginName
          ? plugin.workbenches?.find((w) => w.name === installed.name)
          : undefined;
      if (workbench) parts.push({ installed: installed.version, library: workbench.version });
    }
    const behind = parts.filter((p) => comparePluginVersions(p.library, p.installed) > 0);
    let answer: { installed: string; library: string } | null = null;
    for (const part of behind.length > 0 ? behind : parts) {
      if (answer === null || comparePluginVersions(part.installed, answer.installed) < 0) {
        answer = part;
      }
    }
    return answer ?? { installed: null, library: pluginContentVersion(plugin) };
  }

  /**
   * Reinstall one library plugin over an Agent's copy: the same whole-plugin update the
   * Agents page performs, through the same `installPlugin` writer, which overwrites every
   * skill the plugin ships and its hook package with library content. Throws 404
   * `unknown_plugin` when the library does not carry the name. Callers that may hold a cached
   * runtime for the Agent invalidate it afterwards — hook packages are bound when a core
   * Session is built, unlike skills, which are read from disk on demand.
   */
  async updatePlugin(projectId: string, agentId: string, pluginName: string): Promise<void> {
    for (const plugin of resolveLibraryPlugins([pluginName])) {
      await installPlugin(this.root, projectId, agentId, plugin);
    }
  }

  /** Number of memory topic files: regular `*.md` files (minus each scope's MEMORY.md index) summed over the scope directories under memory/ (0 if the directory doesn't exist). */
  private async memoryCount(projectId: string, agentId: string): Promise<number> {
    const base = memoryDir(this.root, projectId, agentId);
    let scopes: Dirent[];
    try {
      scopes = await fs.readdir(base, { withFileTypes: true });
    } catch {
      return 0;
    }
    const counts = await Promise.all(
      scopes
        .filter((d) => d.isDirectory())
        .map(async (d) => {
          try {
            const files = await fs.readdir(path.join(base, d.name), { withFileTypes: true });
            return files.filter((f) => f.isFile() && isTopicFileName(f.name)).length;
          } catch {
            return 0;
          }
        }),
    );
    return counts.reduce((sum, n) => sum + n, 0);
  }

  /** Last config modification time: the later of system_config.yaml and AGENTS.md mtime; omitted if neither is readable. */
  private async configUpdatedAt(projectId: string, agentId: string): Promise<string | undefined> {
    const paths = [
      systemConfigPath(this.root, projectId, agentId),
      agentsMdPath(this.root, projectId, agentId),
    ];
    const times = await Promise.all(
      paths.map(async (p) => {
        try {
          return (await fs.stat(p)).mtime.getTime();
        } catch {
          return 0;
        }
      }),
    );
    const max = Math.max(...times);
    return max > 0 ? new Date(max).toISOString() : undefined;
  }

  /**
   * Delete an Agent: the built-in Agents cannot be deleted; callers must first drain any active
   * run (the session manager's `beginAgentDeletion`) and let go of what holds the folder open.
   *
   * The folder (Agent State, Traces, scratchpads, temporary Workspaces) is moved to
   * `agents/.deleting/<id>-<time>` in one rename and the index row dropped: from then on no list
   * shows the Agent and no route accepts it, and a new Agent may take its id. The move is the
   * whole of what the caller waits for — the contents are removed in the background, reported by
   * the deletion returned (and by `agentDeletion` as it goes). A folder that cannot be moved is
   * refused with nothing deleted (409 `agent_folder_busy`). Usage records are kept (historical
   * stats are unaffected); the caller drops the Agent's other index rows.
   */
  async deleteAgent(projectId: string, agentId: string): Promise<AgentDeletionInfo> {
    refuseBuiltinDeletion(agentId);
    const deletionId = await this.moveAside(projectId, agentId);
    this.agents.delete(projectId, agentId);
    if (deletionId === null) {
      // The folder was already gone: there is nothing to remove.
      return { deletionId: `${agentId}-0`, agentId, phase: "done", total: 0, removed: 0 };
    }
    return this.startPurge(projectId, deletionId, agentId);
  }

  agentDeletion(projectId: string, deletionId: string): AgentDeletionInfo | null {
    const known = this.deletions.get(`${projectId}/${deletionId}`);
    return known ? { ...known } : null;
  }

  /**
   * Every folder left under a Project's `agents/.deleting/` — a deletion the last process did
   * not finish, or one that met an entry it could not remove — is removed again, one after
   * another. Folders a deletion of this process is already removing are left to it.
   */
  async resumeDeletions(): Promise<void> {
    let projects: Dirent[] = [];
    try {
      projects = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const project of projects) {
      if (!project.isDirectory() || !isValidId(project.name)) continue;
      let entries: string[] = [];
      try {
        entries = await fs.readdir(deletingDir(this.root, project.name));
      } catch {
        continue;
      }
      for (const name of entries) {
        if (this.stopping.signal.aborted) return;
        if (!isValidId(name)) continue;
        const known = this.deletions.get(`${project.name}/${name}`);
        if (known && (known.phase === "counting" || known.phase === "removing")) continue;
        const agentId = DELETION_NAME.exec(name)?.[1] ?? name;
        this.startPurge(project.name, name, agentId);
        await this.running.get(`${project.name}/${name}`);
      }
    }
  }

  /**
   * Renames the Agent's folder into `.deleting/`. Null when there was no folder to move; a
   * folder a program keeps holding is refused with nothing moved.
   */
  private async moveAside(projectId: string, agentId: string): Promise<string | null> {
    const from = agentDir(this.root, projectId, agentId);
    const trash = deletingDir(this.root, projectId);
    await fs.mkdir(trash, { recursive: true });
    const deletionId = `${agentId}-${Date.now()}`;
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(from, path.join(trash, deletionId));
        return deletionId;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? "";
        if (code === "ENOENT") return null;
        if (!MOVE_BUSY.has(code)) throw err;
        if (attempt >= MOVE_RETRIES) {
          throw new HttpError(
            409,
            "agent_folder_busy",
            `The agent's folder could not be moved aside (${code}): another program may have a file in it open. Nothing was deleted.`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, MOVE_RETRY_STEP_MS * (attempt + 1)));
      }
    }
  }

  /** Starts removing `.deleting/<deletionId>` in the background; answers its first reading. */
  private startPurge(projectId: string, deletionId: string, agentId: string): AgentDeletionInfo {
    const key = `${projectId}/${deletionId}`;
    const info: AgentDeletionInfo = {
      deletionId,
      agentId,
      phase: "counting",
      total: 0,
      removed: 0,
    };
    this.deletions.set(key, info);
    const dir = path.join(deletingDir(this.root, projectId), deletionId);
    const signal = this.stopping.signal;
    const run = (async () => {
      try {
        const total = await countEntries(dir, {
          limiter: this.limiter,
          signal,
          onCount: (n) => {
            info.total = n;
          },
        });
        if (signal.aborted) return;
        info.total = total;
        info.phase = "removing";
        const failure = await purgeTree(dir, {
          limiter: this.limiter,
          signal,
          onRemoved: () => {
            info.removed += 1;
          },
        });
        if (signal.aborted) return;
        if (failure === null) {
          info.phase = "done";
          // Something added under the folder after it was counted would read past the total.
          info.total = Math.max(info.total, info.removed);
        } else {
          info.phase = "failed";
          info.error = failure.error;
        }
      } catch (err) {
        info.phase = "failed";
        info.error = err instanceof Error ? err.message : String(err);
      } finally {
        this.running.delete(key);
        if (info.phase === "done" || info.phase === "failed") {
          setTimeout(() => {
            if (this.deletions.get(key) === info) this.deletions.delete(key);
          }, FINISHED_DELETION_TTL_MS).unref?.();
        }
      }
    })();
    this.running.set(key, run);
    return { ...info };
  }

  /**
   * Create an Agent: the id is chosen by the creator (a semantic id, checked for
   * duplicates against both the DB and the directory within the Project — a 409
   * if taken, which naturally also blocks built-in Agent ids) → initialize State →
   * write name/description (name defaults to the id) → install the seed plugins.
   *
   * `pluginNames` are library plugin names picked at creation; they go through the same
   * `installPlugin` writer the plugin routes use, inside the same cleanup window as the rest
   * of initialization, so an Agent never survives with only part of its picked set. They are
   * resolved before anything is created, so an unknown name creates no directory at all.
   *
   * `archive` is an exported Agent State snapshot package: the fresh Agent is seeded from
   * it instead of the default template (explicit name/description override the package's
   * values, absent ones keep them — no id fallback). Mutually exclusive with seeding: the
   * package carries its own skills and hooks. An invalid package fails the whole creation
   * inside the same cleanup window, leaving no empty Agent behind.
   */
  async createAgent(
    projectId: string,
    agentId: string,
    name?: string,
    description?: string,
    pluginNames?: readonly string[],
    directory?: { path: string; names: readonly string[] },
    archive?: Buffer,
  ): Promise<AgentListItem> {
    if (!SEMANTIC_ID_PATTERN.test(agentId)) {
      throw new HttpError(
        400,
        "invalid_agent_id",
        `Agent id must be 2–64 characters: ${SEMANTIC_ID_RULE}.`,
      );
    }
    if (archive !== undefined && (pluginNames?.length || directory)) {
      throw new HttpError(
        400,
        "snapshot_with_plugins",
        "Snapshot initialization and seeding are mutually exclusive: the package carries its own skills and hooks.",
      );
    }
    const taken =
      this.agents.exists(projectId, agentId) ||
      (await fs.stat(agentDir(this.root, projectId, agentId)).then(
        () => true,
        () => false,
      ));
    if (taken) {
      throw new HttpError(409, "agent_exists", `Agent id is already taken: ${agentId}.`);
    }
    const displayName = name ?? agentId;
    // Both sources are resolved before a single file is written, so a name that has since left the
    // library or the directory fails while the Agent still does not exist. Directory Skills are
    // installed after the library plugins and so win a name collision: the user picked that
    // directory for this Agent specifically, which is a narrower intent than "install the
    // built-in one".
    const librarySeed = resolveLibraryPlugins(pluginNames ?? []);
    const directorySeed = directory
      ? await resolveDirectorySkills(directory.path, directory.names)
      : [];
    await coreCreateAgent({ root: this.root, projectId, agentId });
    try {
      if (archive !== undefined) {
        // Seed the fresh state from the snapshot package. No pre-import snapshot and no
        // version confirmation: both guards protect existing State, and this Agent has
        // none yet — its template state is not worth preserving.
        await this.snapshots.importArchive(projectId, agentId, archive, {
          confirm: true,
          preSnapshot: false,
        });
        // Explicit name/description override the package's values; absent ones keep them.
        // No id fallback here: the package is the identity being copied in.
        if (name !== undefined || description !== undefined) {
          await this.agentConfig.updateConfig(projectId, agentId, {
            config: {
              ...(name !== undefined ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
            },
          });
        }
      } else {
        await this.agentConfig.updateConfig(projectId, agentId, {
          config: { name: displayName, ...(description !== undefined ? { description } : {}) },
        });
      }
      for (const plugin of librarySeed) {
        await installPlugin(this.root, projectId, agentId, plugin);
      }
      for (const skill of directorySeed) {
        await installSkill(this.root, projectId, agentId, skill);
      }
    } catch (err) {
      // If initialization fails partway through, clean up the directory: an orphaned
      // directory would make retries with this agent id 409 forever.
      await fs
        .rm(agentDir(this.root, projectId, agentId), { recursive: true, force: true })
        .catch(() => {});
      // Two picked plugins carrying an MCP server of the same name: the creator's choice to
      // change, answered as the plugin routes answer it — not an internal error.
      if (err instanceof McpServerNameTakenError) {
        throw new HttpError(409, "mcp_server_name_taken", err.message);
      }
      throw err;
    }
    const createdAt = new Date().toISOString();
    this.agents.insertOrIgnore({ projectId, agentId, createdAt });
    // Read back the actual values: the init template ships a default toolset and version
    // number, and a snapshot seed brings the package's own name, description, version,
    // skills, schedules and memory.
    const meta = await this.agentConfig.readCardMeta(projectId, agentId);
    const cardName = archive !== undefined ? (meta.name ?? agentId) : displayName;
    const cardDescription = archive !== undefined ? meta.description : description;
    const installed = await this.installedPlugins(projectId, agentId, loadLibraryPlugins());
    return {
      agentId,
      name: cardName,
      ...(cardDescription !== undefined ? { description: cardDescription } : {}),
      createdAt,
      updatedAt: createdAt,
      toolCount: meta.toolCount,
      version: meta.version,
      kernelOutdated: meta.kernelOutdated,
      // The vault never travels in a snapshot, so this is 0 either way; the other counts
      // are real reads because a package may carry any of them.
      vaultKeyCount: 0,
      scheduleCount: await this.scheduleCount(projectId, agentId),
      workbenchCount: await this.workbenchCount(projectId, agentId),
      skillCount: installed.skillCount,
      hookCount: installed.hookCount,
      pluginUpdates: installed.updates,
      memoryCount: await this.memoryCount(projectId, agentId),
    };
  }
}
