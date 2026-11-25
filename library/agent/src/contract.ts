/**
 * The agent domain's mechanisms: AgentConfig (what AgentConfigService implements), Memory
 * (what MemoryService implements), Snapshots (what SnapshotService implements) and
 * AgentLifecycle (what AgentService implements). Moved from the server's mechanisms/agents.ts
 * so the contracts live beside their implementations (services+http+cli restack S3 and S10).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentAuthor } from "@prismshadow/penguin-core";
import type {
  AgentCreation,
  AgentConfigUpdateRequest,
  AgentConfigView,
  AgentDeletionInfo,
  AgentKernelUpdateResponse,
  AgentListItem,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeInfo,
  VaultResponse,
  VaultUpdateRequest,
} from "./types.js";

/** AgentConfig: the mechanism AgentConfigService implements. */
@Interface()
export abstract class AgentConfig {
  abstract exists(projectId: string, agentId: string): Promise<boolean>;
  abstract requireExists(projectId: string, agentId: string): Promise<void>;
  /** Whether the Agent is the Project's system Agent (core state/system-agent.ts). */
  abstract isSystemAgent(projectId: string, agentId: string): Promise<boolean>;
  /** Whether the Agent is built in, and so never deleted: the system Agent counts only as itself. */
  abstract isBuiltinAgent(projectId: string, agentId: string): Promise<boolean>;
  abstract readCardMeta(
    projectId: string,
    agentId: string,
  ): Promise<{
    name?: string;
    description?: string;
    author: AgentAuthor;
    toolCount: number;
    /** Package owners from valid stored MCP entries, omitted if the config could not be read. */
    mcpPluginNames?: string[];
    version: number;
    kernelOutdated: boolean;
    system?: true;
  }>;
  abstract getConfig(projectId: string, agentId: string): Promise<AgentConfigView>;
  abstract updateConfig(
    projectId: string,
    agentId: string,
    req: AgentConfigUpdateRequest,
  ): Promise<void>;
  /** Writes `author` only into a config that has none; false when it had one or there is no config. */
  abstract stampMissingAuthor(
    projectId: string,
    agentId: string,
    author: AgentAuthor,
  ): Promise<boolean>;
  abstract resetConfig(projectId: string, agentId: string): Promise<void>;
  abstract kernelUpdate(projectId: string, agentId: string): Promise<AgentKernelUpdateResponse>;
  abstract insertTemplatePlaceholder(
    projectId: string,
    agentId: string,
    feature: "vault" | "skills" | "schedules",
  ): Promise<AgentConfigView>;
  abstract getVault(projectId: string, agentId: string): Promise<VaultResponse>;
  abstract updateVault(
    projectId: string,
    agentId: string,
    req: VaultUpdateRequest,
  ): Promise<VaultResponse>;
}

/** Memory: the mechanism MemoryService implements. */
@Interface()
export abstract class Memory {
  abstract overview(projectId: string, agentId: string): Promise<MemoryOverviewResponse>;
  abstract insertTemplatePlaceholder(
    projectId: string,
    agentId: string,
  ): Promise<MemoryOverviewResponse>;
  abstract listScopes(projectId: string, agentId: string): Promise<MemoryScopeInfo[]>;
  abstract listFiles(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryFilesResponse>;
  /** `filePath` is the file's place in the scope: a topic's name, or `<folder>/<path>` for a file it keeps. */
  abstract readFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<MemoryFileResponse>;
  /** The scope folder as a zip. */
  abstract exportScope(projectId: string, agentId: string, scopeKey: string): Promise<Uint8Array>;
  abstract importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload?: unknown; dataBase64?: string },
  ): Promise<MemoryImportResponse>;
  /** `filePath` as in `readFile`; a topic goes together with the folder of files it keeps. */
  abstract deleteFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    filePath: string,
  ): Promise<void>;
}

/** A package an import swaps in: a zip of the Agent's directory, or a `.tar.gz` snapshot. */
export interface AgentPackage {
  bytes: Buffer<ArrayBufferLike>;
  /** Given the package's `traces/` once its State is in place, before the staging goes. */
  landTraces?: (dir: string) => Promise<void>;
}

/** Snapshots: the mechanism SnapshotService implements. */
@Interface()
export abstract class Snapshots {
  abstract currentVersion(projectId: string, agentId: string): Promise<number>;
  abstract importArchive(
    projectId: string,
    agentId: string,
    pkg: AgentPackage,
    opts: { preSnapshot: boolean },
  ): Promise<{ version: number; backup?: string }>;
}

/** AgentLifecycle: the mechanism AgentService implements — the list, the creation, the delete and the plugin update surface. */
@Interface()
export abstract class AgentLifecycle {
  abstract listAgents(projectId: string): Promise<AgentListItem[]>;
  /** Every id `createAgent` refuses as taken, as names only, including a folder that does not list. */
  abstract takenAgentIds(projectId: string): Promise<string[]>;
  /**
   * Moves the Agent's folder out of the agents directory in one rename and drops its index row,
   * so it is gone from every list and route at once; its files are then removed in the background,
   * as the returned deletion reports. Refuses a built-in Agent, and a folder another program
   * holds open (409 `agent_folder_busy`, nothing deleted).
   */
  abstract deleteAgent(projectId: string, agentId: string): Promise<AgentDeletionInfo>;
  /** Where one deletion stands; null once it is unknown here (finished long ago, or never was). */
  abstract agentDeletion(projectId: string, deletionId: string): AgentDeletionInfo | null;
  /** Removes whatever deleted Agents left behind when the server last stopped mid-removal. */
  abstract resumeDeletions(): Promise<void>;
  abstract createAgent(
    projectId: string,
    agentId: string,
    creation?: AgentCreation,
  ): Promise<AgentListItem>;
  abstract pluginVersion(
    projectId: string,
    agentId: string,
    pluginName: string,
  ): Promise<{ installed: string | null; library: string | null }>;
  abstract updatePlugin(projectId: string, agentId: string, pluginName: string): Promise<void>;
}
