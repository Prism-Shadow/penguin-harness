/**
 * The agents mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentConfigView } from "../services/agent-config-service.js";
import type {
  AgentConfigUpdateRequest,
  AgentDeletionInfo,
  AgentKernelUpdateResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
  BenchmarkSummary,
  CaseMaterial,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportMode,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryScopeInfo,
  VaultResponse,
  VaultUpdateRequest,
  WorkspaceFilesResponse,
} from "../api/types.js";
import type {
  WorkspaceFileContent,
  WorkspaceFileReadOptions,
} from "../services/workspace-files-service.js";
import type { AgentListItem } from "../services/agent-service.js";
import type {
  BenchmarkArchive,
  BenchmarkCreateInput,
  BenchmarkImportOptions,
} from "../services/benchmark-service.js";

/** AgentConfig: the mechanism AgentConfigService implements. */
@Interface()
export abstract class AgentConfig {
  abstract exists(projectId: string, agentId: string): Promise<boolean>;
  abstract requireExists(projectId: string, agentId: string): Promise<void>;
  abstract readCardMeta(
    projectId: string,
    agentId: string,
  ): Promise<{
    name?: string;
    description?: string;
    toolCount: number;
    version: number;
    kernelOutdated: boolean;
  }>;
  abstract getConfig(projectId: string, agentId: string): Promise<AgentConfigView>;
  abstract updateConfig(
    projectId: string,
    agentId: string,
    req: AgentConfigUpdateRequest,
  ): Promise<void>;
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

/** Snapshots: the mechanism SnapshotService implements. */
@Interface()
export abstract class Snapshots {
  abstract currentVersion(projectId: string, agentId: string): Promise<number>;
  abstract ensureSnapshot(
    projectId: string,
    agentId: string,
  ): Promise<{ version: number; file: string }>;
  abstract exportArchive(
    projectId: string,
    agentId: string,
  ): Promise<{ version: number; file: string; fileName: string }>;
  abstract importArchive(
    projectId: string,
    agentId: string,
    archive: Buffer<ArrayBufferLike>,
    opts: { confirm: boolean; preSnapshot?: boolean },
  ): Promise<{ version: number }>;
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
  abstract readFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<MemoryFileResponse>;
  abstract exportScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
  ): Promise<MemoryScopeExport>;
  abstract importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload: unknown },
  ): Promise<MemoryImportResponse>;
  abstract deleteFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<void>;
}

/** Benchmarks: the mechanism BenchmarkService implements. */
@Interface()
export abstract class Benchmarks {
  abstract list(projectId: string): Promise<BenchmarksResponse>;
  /** Every id `create` refuses as taken, as names only, including a folder that does not list. */
  abstract takenIds(projectId: string): Promise<string[]>;
  abstract create(projectId: string, input: BenchmarkCreateInput): Promise<BenchmarkSummary>;
  abstract remove(projectId: string, benchmarkId: string): Promise<void>;
  /**
   * Writes the package an uploaded zip holds, with origin `zip` or the git origin `options` names;
   * a taken id is a 409 unless `overwrite`, and an overwrite of one still being evaluated a 409 too.
   */
  abstract importArchive(
    projectId: string,
    archive: Uint8Array,
    options: BenchmarkImportOptions,
  ): Promise<BenchmarkSummary>;
  /** A published Benchmark's package as a zip. */
  abstract exportArchive(projectId: string, benchmarkId: string): Promise<BenchmarkArchive>;
  abstract listCases(projectId: string, benchmarkId: string): Promise<BenchmarkCasesResponse>;
  abstract listCaseFiles(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<WorkspaceFilesResponse>;
  abstract readCaseFile(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
}

/** AgentLifecycle: the mechanism AgentService implements. */
@Interface()
export abstract class AgentLifecycle {
  abstract listAgents(projectId: string): Promise<AgentListItem[]>;
  /** Every id `createAgent` refuses as taken, as names only, including a folder that does not list. */
  abstract takenAgentIds(projectId: string): Promise<string[]>;
  /**
   * Moves the Agent's folder out of the agents directory in one rename and drops its index row,
   * so it is gone from every list and route at once; its files are then removed in the
   * background, as the returned deletion reports. Refuses a built-in Agent, and a folder another
   * program holds open (409 `agent_folder_busy`, nothing deleted).
   */
  abstract deleteAgent(projectId: string, agentId: string): Promise<AgentDeletionInfo>;
  /** Where one deletion stands; null once it is unknown here (finished long ago, or never was). */
  abstract agentDeletion(projectId: string, deletionId: string): AgentDeletionInfo | null;
  /** Removes whatever deleted Agents left behind when the server last stopped mid-removal. */
  abstract resumeDeletions(): Promise<void>;
  abstract createAgent(
    projectId: string,
    agentId: string,
    name?: string,
    description?: string,
    skillNames?: readonly string[],
    directory?: { path: string; names: readonly string[] },
    archive?: Buffer<ArrayBufferLike>,
  ): Promise<AgentListItem>;
  abstract pluginVersion(
    projectId: string,
    agentId: string,
    pluginName: string,
  ): Promise<{ installed: string | null; library: string | null }>;
  abstract updatePlugin(projectId: string, agentId: string, pluginName: string): Promise<void>;
}
