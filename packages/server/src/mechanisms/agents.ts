/**
 * The agents mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AgentConfigView } from "../services/agent-config-service.js";
import type {
  AgentConfigUpdateRequest,
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
import type { BenchmarkCreateInput } from "../services/benchmark-service.js";

/** AgentConfig: the mechanism AgentConfigService implements. */
export abstract class AgentConfig extends Interface<{
  exists(projectId: string, agentId: string): Promise<boolean>;
  requireExists(projectId: string, agentId: string): Promise<void>;
  readCardMeta(
    projectId: string,
    agentId: string,
  ): Promise<{
    name?: string;
    description?: string;
    toolCount: number;
    version: number;
    kernelOutdated: boolean;
  }>;
  getConfig(projectId: string, agentId: string): Promise<AgentConfigView>;
  updateConfig(projectId: string, agentId: string, req: AgentConfigUpdateRequest): Promise<void>;
  resetConfig(projectId: string, agentId: string): Promise<void>;
  kernelUpdate(projectId: string, agentId: string): Promise<AgentKernelUpdateResponse>;
  insertTemplatePlaceholder(
    projectId: string,
    agentId: string,
    feature: "vault" | "skills" | "schedules",
  ): Promise<AgentConfigView>;
  getVault(projectId: string, agentId: string): Promise<VaultResponse>;
  updateVault(projectId: string, agentId: string, req: VaultUpdateRequest): Promise<VaultResponse>;
}>() {}

/** Snapshots: the mechanism SnapshotService implements. */
export abstract class Snapshots extends Interface<{
  currentVersion(projectId: string, agentId: string): Promise<number>;
  ensureSnapshot(projectId: string, agentId: string): Promise<{ version: number; file: string }>;
  exportArchive(
    projectId: string,
    agentId: string,
  ): Promise<{ version: number; file: string; fileName: string }>;
  importArchive(
    projectId: string,
    agentId: string,
    archive: Buffer<ArrayBufferLike>,
    opts: { confirm: boolean; preSnapshot?: boolean },
  ): Promise<{ version: number }>;
}>() {}

/** Memory: the mechanism MemoryService implements. */
export abstract class Memory extends Interface<{
  overview(projectId: string, agentId: string): Promise<MemoryOverviewResponse>;
  insertTemplatePlaceholder(projectId: string, agentId: string): Promise<MemoryOverviewResponse>;
  listScopes(projectId: string, agentId: string): Promise<MemoryScopeInfo[]>;
  listFiles(projectId: string, agentId: string, scopeKey: string): Promise<MemoryFilesResponse>;
  readFile(
    projectId: string,
    agentId: string,
    scopeKey: string,
    fileName: string,
  ): Promise<MemoryFileResponse>;
  exportScope(projectId: string, agentId: string, scopeKey: string): Promise<MemoryScopeExport>;
  importScope(
    projectId: string,
    agentId: string,
    scopeKey: string,
    request: { mode: MemoryImportMode; confirm: boolean; payload: unknown },
  ): Promise<MemoryImportResponse>;
  deleteFile(projectId: string, agentId: string, scopeKey: string, fileName: string): Promise<void>;
}>() {}

/** Benchmarks: the mechanism BenchmarkService implements. */
export abstract class Benchmarks extends Interface<{
  list(projectId: string): Promise<BenchmarksResponse>;
  /** Every id `create` refuses as taken, as names only, including a folder that does not list. */
  takenIds(projectId: string): Promise<string[]>;
  create(projectId: string, input: BenchmarkCreateInput): Promise<BenchmarkSummary>;
  remove(projectId: string, benchmarkId: string): Promise<void>;
  listCases(projectId: string, benchmarkId: string): Promise<BenchmarkCasesResponse>;
  listCaseFiles(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
  ): Promise<WorkspaceFilesResponse>;
  readCaseFile(
    projectId: string,
    benchmarkId: string,
    caseId: string,
    rel: string,
    material: CaseMaterial,
    options?: WorkspaceFileReadOptions,
  ): Promise<WorkspaceFileContent>;
}>() {}

/** AgentLifecycle: the mechanism AgentService implements. */
export abstract class AgentLifecycle extends Interface<{
  listAgents(projectId: string): Promise<AgentListItem[]>;
  /** Every id `createAgent` refuses as taken, as names only, including a folder that does not list. */
  takenAgentIds(projectId: string): Promise<string[]>;
  deleteAgent(projectId: string, agentId: string): Promise<void>;
  createAgent(
    projectId: string,
    agentId: string,
    name?: string,
    description?: string,
    skillNames?: readonly string[],
    directory?: { path: string; names: readonly string[] },
    archive?: Buffer<ArrayBufferLike>,
  ): Promise<AgentListItem>;
  pluginVersion(
    projectId: string,
    agentId: string,
    pluginName: string,
  ): Promise<{ installed: string | null; library: string | null }>;
  updatePlugin(projectId: string, agentId: string, pluginName: string): Promise<void>;
}>() {}
