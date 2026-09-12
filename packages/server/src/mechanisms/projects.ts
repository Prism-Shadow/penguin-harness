/**
 * The projects mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AccessibleProjectRow, ProjectRow } from "../db/repos/projects.js";
import type { MemberRow } from "../db/repos/members.js";
import type { AgentRow } from "../db/repos/agents.js";
import type {
  ChatDefaultsDto,
  CommandPolicyDto,
  EndpointModelListRequest,
  EndpointModelListResponse,
  MemberInfo,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  ModelRefDto,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  ModelsResponse,
  ModelsUpdateRequest,
  ProjectRole,
  ProjectSummary,
} from "../api/types.js";
import type { UserRow } from "../db/repos/users.js";
import type { RawTable } from "../services/project-config-service.js";
import type { ListEndpointModelsOptions, ModelRef, ProjectConfig } from "@prismshadow/penguin-core";
import type { TieredRates } from "../services/usage-service.js";
import type {
  ModelOAuthErrorCode,
  ModelOAuthMode,
  ModelOAuthStartResult,
  ModelOAuthStatus,
} from "../services/model-oauth-service.js";

/** Projects: the mechanism ProjectsRepo implements. */
export abstract class Projects extends Interface<{
  insert(row: ProjectRow): void;
  findById(projectId: string): ProjectRow | null;
  listAll(): ProjectRow[];
  listAccessible(userId: string): AccessibleProjectRow[];
  listByOwner(userId: string): ProjectRow[];
  delete(projectId: string): void;
}>() {}

/** Members: the mechanism MembersRepo implements. */
export abstract class Members extends Interface<{
  insert(row: MemberRow): void;
  isMember(projectId: string, userId: string): boolean;
  list(projectId: string): MemberRow[];
  delete(projectId: string, userId: string): void;
}>() {}

/** AgentIndex: the mechanism AgentsRepo implements. */
export abstract class AgentIndex extends Interface<{
  insertOrIgnore(row: AgentRow): void;
  exists(projectId: string, agentId: string): boolean;
  list(projectId: string): AgentRow[];
  delete(projectId: string, agentId: string): void;
  deleteByProject(projectId: string): void;
}>() {}

/** Access: the mechanism ProjectAccess implements. */
export abstract class Access extends Interface<{
  find(userId: string, projectId: string): (ProjectRow & { role: ProjectRole }) | null;
  requireProjectAccess(userId: string, projectId: string): ProjectRow & { role: ProjectRole };
  canAccess(userId: string, projectId: string): boolean;
  requireProjectOwner(userId: string, projectId: string): ProjectRow;
  accessibleProjectIds(userId: string): string[];
  listProjects(userId: string): Promise<ProjectSummary[]>;
}>() {}

/** ProjectLifecycle: the mechanism ProjectService implements. */
export abstract class ProjectLifecycle extends Interface<{
  requireProjectAccess(userId: string, projectId: string): ProjectRow & { role: ProjectRole };
  canAccess(userId: string, projectId: string): boolean;
  requireProjectOwner(userId: string, projectId: string): ProjectRow;
  accessibleProjectIds(userId: string): string[];
  listProjects(userId: string): Promise<ProjectSummary[]>;
  createProject(owner: UserRow, projectId: string, name?: string): Promise<ProjectSummary>;
  provisionInitialProject(user: UserRow, isAdmin: boolean): Promise<void>;
  renameProject(userId: string, projectId: string, name: string): Promise<ProjectSummary>;
  deleteProject(userId: string, projectId: string): Promise<void>;
  destroyProject(projectId: string): Promise<void>;
  listMembers(userId: string, projectId: string): MemberInfo[];
  addMember(userId: string, projectId: string, targetUserId: string): MemberInfo;
  removeMember(userId: string, projectId: string, targetUserId: string): void;
}>() {}

/** ProjectConfigStore: the mechanism ProjectConfigService implements. */
export abstract class ProjectConfigStore extends Interface<{
  readRaw(projectId: string): Promise<RawTable>;
  loadConfig(projectId: string): Promise<ProjectConfig>;
  writeRaw(projectId: string, data: RawTable): Promise<void>;
  writeInitialConfig(projectId: string, name: string): Promise<void>;
  ensurePresetModels(projectId: string): Promise<void>;
  getName(projectId: string): Promise<string | undefined>;
  setName(projectId: string, name: string): Promise<void>;
  getDefaultModelRef(projectId: string): Promise<ModelRef | undefined>;
  setDefaultModelRef(projectId: string, ref: ModelRefDto): Promise<ModelRefDto>;
  getChatDefaults(projectId: string): Promise<ChatDefaultsDto>;
  setChatDefaults(projectId: string, req: ChatDefaultsDto): Promise<ChatDefaultsDto>;
  getCommandPolicy(projectId: string): Promise<CommandPolicyDto>;
  setCommandPolicy(
    projectId: string,
    req: {
      enabled?: boolean;
      rules: { name: string; pattern: string; description?: string; enabled?: boolean }[];
    },
  ): Promise<CommandPolicyDto>;
  getPricing(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<TieredRates | undefined>;
  detectVision(
    projectId: string,
    req: ModelVisionDetectRequest,
  ): Promise<ModelVisionDetectResponse>;
  testModel(projectId: string, req: ModelTestRequest): Promise<ModelTestResponse>;
  detectProtocol(
    projectId: string,
    req: ModelProtocolDetectRequest,
  ): Promise<ModelProtocolDetectResponse>;
  listEndpointModels(
    req: EndpointModelListRequest,
    listImpl?: (options: ListEndpointModelsOptions) => Promise<string[]>,
    timeoutMs?: number,
  ): Promise<EndpointModelListResponse>;
  getModels(projectId: string): Promise<ModelsResponse>;
  updateModels(projectId: string, req: ModelsUpdateRequest): Promise<ModelsResponse>;
  setGroupApiKey(projectId: string, provider: string, apiKey: string): Promise<number>;
}>() {}

/** ModelOAuth: the mechanism ModelOAuthService implements. */
export abstract class ModelOAuth extends Interface<{
  start(input: {
    projectId: string;
    userId: string;
    provider: string;
    mode: ModelOAuthMode;
    callbackOrigin: string;
  }): ModelOAuthStartResult;
  deposit(input: { flowId: string; projectId: string; code: string }): void;
  poll(input: { flowId: string; userId: string; projectId: string }): Promise<{
    status: ModelOAuthStatus;
    provider: string;
    error?: ModelOAuthErrorCode;
    applied?: number;
  }>;
  complete(input: {
    flowId: string;
    userId: string;
    projectId: string;
    code: string;
  }): Promise<{ ok: true; applied: number } | { ok: false; error: ModelOAuthErrorCode }>;
}>() {}
