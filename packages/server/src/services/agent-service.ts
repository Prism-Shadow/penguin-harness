/**
 * Agent service.
 *
 * The list is the union of "DB index ∪ directory scan": a subdirectory under
 * `<project>/` containing `agent_state/system_config.yaml` is treated as an Agent;
 * unmanaged ones found are backfilled into the DB — this handles Agents created
 * directly via the CLI.
 * Create: generate agent-<8hex>, initialize Agent State via core's `createAgent`,
 * then write name/description into system_config.yaml (parseDocument preserves the
 * template's comments).
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import {
  agentDir,
  agentsDir,
  agentsMdPath,
  BUILTIN_AGENT_IDS,
  createAgent as coreCreateAgent,
  installSkill,
  isValidId,
  loadAgentVault,
  memoryDir,
  scheduleDir,
  skillsDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { librarySkill, parseSkillFrontmatter } from "@prismshadow/penguin-skills";
import type { AgentsRepo } from "../db/repos/agents.js";
import { SEMANTIC_ID_PATTERN, SEMANTIC_ID_RULE } from "./ids.js";
import type { AgentConfigService } from "./agent-config-service.js";
import type { SnapshotService } from "./snapshot-service.js";
import { isTopicFileName } from "./memory-service.js";
import type { SkillUpdateRef } from "../api/types.js";
import { resolveLibrarySkills } from "./skill-library.js";
import { resolveDirectorySkills } from "./directory-skills.js";

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
  /** Number of scheduled tasks (count of .toml files under schedule/, including invalid ones). */
  scheduleCount: number;
  /** Number of installed Skills (count of skills/<name>/ directories that contain a SKILL.md). */
  skillCount: number;
  /** Installed Skills the library has a newer version of, each carrying that library version. */
  skillUpdates: SkillUpdateRef[];
  /** Number of memory topic files across every scope directory under memory/ (independent of the memory switch, like skillCount). */
  memoryCount: number;
}

export class AgentService {
  constructor(
    private readonly root: string,
    private readonly agents: AgentsRepo,
    private readonly agentConfig: AgentConfigService,
    private readonly snapshots: SnapshotService,
  ) {}

  /** Union of DB index ∪ directory scan; unmanaged directory Agents are backfilled into the DB. */
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

    // Meta reads and mtime stats for each Agent run in parallel (Promise.all preserves the sorted order).
    const sorted = [...known.values()].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.agentId.localeCompare(b.agentId)
        : a.createdAt < b.createdAt
          ? -1
          : 1,
    );
    return Promise.all(
      sorted.map(async (row) => {
        const [meta, updatedAt, vaultKeyCount, scheduleCount, skills, memoryCount] =
          await Promise.all([
            this.agentConfig.readCardMeta(projectId, row.agentId),
            this.configUpdatedAt(projectId, row.agentId),
            this.vaultKeyCount(projectId, row.agentId),
            this.scheduleCount(projectId, row.agentId),
            this.installedSkills(projectId, row.agentId),
            this.memoryCount(projectId, row.agentId),
          ]);
        return {
          agentId: row.agentId,
          ...meta,
          createdAt: row.createdAt,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
          vaultKeyCount,
          scheduleCount,
          skillCount: skills.count,
          skillUpdates: skills.updates,
          memoryCount,
        };
      }),
    );
  }

  /** Number of vault keys (falls back to 0 on read failure). */
  private async vaultKeyCount(projectId: string, agentId: string): Promise<number> {
    try {
      return Object.keys(await loadAgentVault(this.root, projectId, agentId)).length;
    } catch {
      return 0;
    }
  }

  /** Number of scheduled tasks: count of .toml files under schedule/ (0 if the directory doesn't exist). */
  private async scheduleCount(projectId: string, agentId: string): Promise<number> {
    try {
      const names = await fs.readdir(scheduleDir(this.root, projectId, agentId));
      return names.filter((n) => n.endsWith(".toml")).length;
    } catch {
      return 0;
    }
  }

  /**
   * One pass over `skills/`, answering both card questions: how many Skills are installed
   * (directories containing a SKILL.md) and which of them the library has moved past.
   *
   * The two are read together because the second needs what the first was already opening:
   * counting only asked whether SKILL.md exists, and the version lives in its frontmatter.
   * Splitting them into two passes would walk the same directories twice.
   *
   * Only the HEAD of each SKILL.md is read, and that bound is load-bearing rather than a
   * micro-optimization: a preinstalled library is ~180 KB of SKILL.md across seventeen files
   * per Agent, so a Project of ten Agents would move ~2 MB through every `GET /agents` — and
   * the Skills page reloads that list after each update. The frontmatter block is at the head
   * by definition (the parser's regex is anchored there) and the largest one in the library is
   * under 1 KB, so {@link SKILL_HEAD_BYTES} covers it many times over; a block that somehow
   * overran it would be truncated, fail to parse, and read as version 1 — the same fallback an
   * unparseable file already takes.
   *
   * The directory name is the Skill's identity (core's `listInstalledSkills` says so, and
   * install/uninstall address by it), so that — not the frontmatter's `name` — is what the
   * library is looked up by. A Skill the library does not carry (installed from a zip or from a
   * picked directory) has no library version to be behind and is never an update; an
   * unparseable or version-less SKILL.md reads as version 1, the same fallback the parser
   * applies everywhere else. Every failure degrades to "not installed" / "no update": a card
   * hint must not be the thing that makes the Agent list fail.
   */
  private async installedSkills(
    projectId: string,
    agentId: string,
  ): Promise<{ count: number; updates: SkillUpdateRef[] }> {
    const base = skillsDir(this.root, projectId, agentId);
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(base, { withFileTypes: true });
    } catch {
      return { count: 0, updates: [] };
    }
    const installed = await Promise.all(
      dirents
        // Dot-prefixed directories are install staging, never a Skill (a Skill name has no dot).
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map(async (d) => {
          try {
            const head = await readHead(path.join(base, d.name, "SKILL.md"), SKILL_HEAD_BYTES);
            return { name: d.name, version: parseSkillFrontmatter(head)?.version ?? 1 };
          } catch {
            return null;
          }
        }),
    );
    const updates: SkillUpdateRef[] = [];
    for (const skill of installed) {
      if (skill === null) continue;
      const version = librarySkill(skill.name)?.version;
      if (version !== undefined && version > skill.version) {
        updates.push({ name: skill.name, version });
      }
    }
    return { count: installed.filter((s) => s !== null).length, updates };
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
   * Delete an Agent: the sole built-in Agent
   * default_agent (shared with the CLI, the default conversation Agent) cannot be
   * deleted; callers must first drain any active run via manager.abortAgent.
   * The directory is deleted recursively (including Trace), and the DB's
   * agents/sessions index rows are removed along with it; usage records are kept
   * (historical stats are unaffected).
   */
  async deleteAgent(projectId: string, agentId: string): Promise<void> {
    if (BUILTIN_AGENT_IDS.includes(agentId)) {
      throw new HttpError(
        409,
        "cannot_delete_builtin_agent",
        "Built-in Agents (default_agent) are provisioned with the Project and cannot be deleted from the web.",
      );
    }
    await fs.rm(agentDir(this.root, projectId, agentId), { recursive: true, force: true });
    this.agents.delete(projectId, agentId);
  }

  /**
   * Create an Agent: the id is chosen by the creator (a semantic id, checked for
   * duplicates against both the DB and the directory within the Project — a 409
   * if taken, which naturally also blocks built-in Agent ids) → initialize State →
   * write name/description (name defaults to the id) → install the seed Skills.
   *
   * `skillNames` are library Skill names picked at creation; they go through the same
   * `installSkill` writer the Skills tab uses, inside the same cleanup window as the rest of
   * initialization, so an Agent never survives with only part of its picked set. They are
   * resolved before anything is created, so an unknown name creates no directory at all.
   *
   * `archive` is an exported Agent State snapshot package: the fresh Agent is seeded from
   * it instead of the default template (explicit name/description override the package's
   * values, absent ones keep them — no id fallback). Mutually exclusive with skill seeding:
   * the package carries its own skills. An invalid package fails the whole creation inside
   * the same cleanup window, leaving no empty Agent behind.
   */
  async createAgent(
    projectId: string,
    agentId: string,
    name?: string,
    description?: string,
    skillNames?: readonly string[],
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
    if (archive !== undefined && (skillNames?.length || directory)) {
      throw new HttpError(
        400,
        "snapshot_with_skills",
        "Snapshot initialization and skill seeding are mutually exclusive: the package carries its own skills.",
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
    // installed after the library ones and so win a name collision: the user picked that directory
    // for this Agent specifically, which is a narrower intent than "install the built-in one".
    const librarySeed = resolveLibrarySkills(skillNames ?? []);
    const directorySeed = directory
      ? await resolveDirectorySkills(directory.path, directory.names)
      : [];
    const seedSkills = [...librarySeed, ...directorySeed];
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
      for (const skill of seedSkills) {
        await installSkill(this.root, projectId, agentId, skill);
      }
    } catch (err) {
      // If initialization fails partway through, clean up the directory: an orphaned
      // directory would make retries with this agent id 409 forever.
      await fs
        .rm(agentDir(this.root, projectId, agentId), { recursive: true, force: true })
        .catch(() => {});
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
    const skills = await this.installedSkills(projectId, agentId);
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
      skillCount: skills.count,
      skillUpdates: skills.updates,
      memoryCount: await this.memoryCount(projectId, agentId),
    };
  }
}
