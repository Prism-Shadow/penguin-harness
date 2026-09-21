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
import type { RawTable, UtilityCompletion } from "../services/project-config-service.js";
import type {
  ListEndpointModelsOptions,
  ModelRequestContext,
  ModelRef,
  PluginTable,
  ProjectConfig,
} from "@prismshadow/penguin-core";
import type { TieredRates } from "../services/usage-service.js";
import type {
  PlatformModelApplyResult,
  PlatformModelCatalog,
} from "../services/platform-auth-types.js";
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
  /** Every id `createProject` refuses as taken, as names only: the rows and the data root's entries. */
  takenProjectIds(): Promise<string[]>;
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
  ensurePresetModels(projectId: string): Promise<boolean>;
  seedPresetPromotions(projectId: string): Promise<void>;
  getName(projectId: string): Promise<string | undefined>;
  setName(projectId: string, name: string): Promise<void>;
  getDefaultModelRef(projectId: string): Promise<ModelRef | undefined>;
  setDefaultModelRef(projectId: string, ref: ModelRefDto): Promise<ModelRefDto>;
  getChatDefaults(projectId: string): Promise<ChatDefaultsDto>;
  setChatDefaults(projectId: string, req: ChatDefaultsDto): Promise<ChatDefaultsDto>;
  /** The `[plugins]` table this Project asks for: package name → requirement, in the file's order. */
  getPlugins(projectId: string): Promise<PluginTable>;
  /** Replaces the table (a declarative PUT); answers what was written. */
  setPlugins(projectId: string, plugins: PluginTable): Promise<PluginTable>;
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
  setGroupApiKeyWithProviderAuthToken(
    projectId: string,
    provider: string,
    apiKey: string,
    token: Omit<ModelProviderAuthToken, "provider" | "updatedAt">,
    options?: { expectedRefreshToken?: string },
  ): Promise<number>;
  getGroupApiKey(projectId: string, provider: string): Promise<string | undefined>;
  setModelApiKeyResolver(
    resolver: (context: ModelRequestContext) => Promise<string | undefined>,
  ): void;
  mergePlatformModels(
    projectId: string,
    provider: string,
    catalog: PlatformModelCatalog,
    apiKey: string,
    applyKeyToExisting: boolean,
  ): Promise<PlatformModelApplyResult>;
  completeOnce(projectId: string, prompt: string): Promise<UtilityCompletion>;
}>() {}

export interface ModelPromotion {
  provider: string;
  modelId: string;
  discount: number;
}

/** Per-Project model promotions (web.db `model_promotions`). */
export abstract class ModelPromotions extends Interface<{
  get(projectId: string, provider: string, modelId: string): number | undefined;
  list(projectId: string): ModelPromotion[];
  /** Replaces every promotion of the Project, in one transaction. */
  replaceAll(projectId: string, rows: readonly ModelPromotion[]): void;
  /** Replaces the promotions of one provider group, in one transaction. */
  replaceProvider(projectId: string, provider: string, rows: readonly ModelPromotion[]): void;
}>() {}

export interface ModelProviderAuthToken {
  provider: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  updatedAt: string;
}

/** Server-side OAuth refresh metadata for provider groups (web.db `model_provider_auth_tokens`). */
export abstract class ModelProviderAuthTokens extends Interface<{
  get(projectId: string, provider: string): ModelProviderAuthToken | undefined;
  upsert(projectId: string, row: Omit<ModelProviderAuthToken, "updatedAt">): void;
  delete(projectId: string, provider: string): void;
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
