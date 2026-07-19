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
import { HttpError } from "../http/errors.js";
import {
  agentDir,
  agentsDir,
  agentsMdPath,
  BUILTIN_AGENT_IDS,
  createAgent as coreCreateAgent,
  isValidId,
  loadAgentVault,
  scheduleDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import type { AgentsRepo } from "../db/repos/agents.js";
import { SEMANTIC_ID_PATTERN, SEMANTIC_ID_RULE } from "./ids.js";
import type { AgentConfigService } from "./agent-config-service.js";

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
  /** Number of vault keys. */
  vaultKeyCount: number;
  /** Number of scheduled tasks (count of .toml files under schedule/, including invalid ones). */
  scheduleCount: number;
}

export class AgentService {
  constructor(
    private readonly root: string,
    private readonly agents: AgentsRepo,
    private readonly agentConfig: AgentConfigService,
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
        const [meta, updatedAt, vaultKeyCount, scheduleCount] = await Promise.all([
          this.agentConfig.readCardMeta(projectId, row.agentId),
          this.configUpdatedAt(projectId, row.agentId),
          this.vaultKeyCount(projectId, row.agentId),
          this.scheduleCount(projectId, row.agentId),
        ]);
        return {
          agentId: row.agentId,
          ...meta,
          createdAt: row.createdAt,
          ...(updatedAt !== undefined ? { updatedAt } : {}),
          vaultKeyCount,
          scheduleCount,
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
        "内置 Agent（default_agent）随 Project 供给，不能从 Web 删除。",
      );
    }
    await fs.rm(agentDir(this.root, projectId, agentId), { recursive: true, force: true });
    this.agents.delete(projectId, agentId);
  }

  /**
   * Create an Agent: the id is chosen by the creator (a semantic id, checked for
   * duplicates against both the DB and the directory within the Project — a 409
   * if taken, which naturally also blocks built-in Agent ids) → initialize State →
   * write name/description (name defaults to the id).
   */
  async createAgent(
    projectId: string,
    agentId: string,
    name?: string,
    description?: string,
  ): Promise<AgentListItem> {
    if (!SEMANTIC_ID_PATTERN.test(agentId)) {
      throw new HttpError(400, "invalid_agent_id", `Agent id 须为 2~64 位：${SEMANTIC_ID_RULE}。`);
    }
    const taken =
      this.agents.exists(projectId, agentId) ||
      (await fs.stat(agentDir(this.root, projectId, agentId)).then(
        () => true,
        () => false,
      ));
    if (taken) {
      throw new HttpError(409, "agent_exists", `Agent id 已被占用：${agentId}。`);
    }
    const displayName = name ?? agentId;
    await coreCreateAgent({ root: this.root, projectId, agentId });
    try {
      await this.agentConfig.updateConfig(projectId, agentId, {
        config: { name: displayName, ...(description !== undefined ? { description } : {}) },
      });
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
    // The init template ships with a default toolset and version number; read back the actual values.
    const meta = await this.agentConfig.readCardMeta(projectId, agentId);
    return {
      agentId,
      name: displayName,
      ...(description !== undefined ? { description } : {}),
      createdAt,
      updatedAt: createdAt,
      toolCount: meta.toolCount,
      version: meta.version,
      vaultKeyCount: 0,
      scheduleCount: 0,
    };
  }
}
