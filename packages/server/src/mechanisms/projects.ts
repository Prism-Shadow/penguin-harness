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
@Interface()
export abstract class Projects {
  abstract insert(row: ProjectRow): void;
  abstract findById(projectId: string): ProjectRow | null;
  abstract listAll(): ProjectRow[];
  abstract listAccessible(userId: string): AccessibleProjectRow[];
  abstract listByOwner(userId: string): ProjectRow[];
  abstract delete(projectId: string): void;
}

/** Members: the mechanism MembersRepo implements. */
@Interface()
export abstract class Members {
  abstract insert(row: MemberRow): void;
  abstract isMember(projectId: string, userId: string): boolean;
  abstract list(projectId: string): MemberRow[];
  abstract delete(projectId: string, userId: string): void;
}

/** AgentIndex: the mechanism AgentsRepo implements. */
@Interface()
export abstract class AgentIndex {
  abstract insertOrIgnore(row: AgentRow): void;
  abstract exists(projectId: string, agentId: string): boolean;
  abstract list(projectId: string): AgentRow[];
  abstract delete(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** Access: the mechanism ProjectAccess implements. */
@Interface()
export abstract class Access {
  abstract find(userId: string, projectId: string): (ProjectRow & { role: ProjectRole }) | null;
  abstract requireProjectAccess(
    userId: string,
    projectId: string,
  ): ProjectRow & { role: ProjectRole };
  abstract canAccess(userId: string, projectId: string): boolean;
  abstract requireProjectOwner(userId: string, projectId: string): ProjectRow;
  abstract accessibleProjectIds(userId: string): string[];
  abstract listProjects(userId: string): Promise<ProjectSummary[]>;
}

/** ProjectLifecycle: the mechanism ProjectService implements. */
@Interface()
export abstract class ProjectLifecycle {
  abstract requireProjectAccess(
    userId: string,
    projectId: string,
  ): ProjectRow & { role: ProjectRole };
  abstract canAccess(userId: string, projectId: string): boolean;
  abstract requireProjectOwner(userId: string, projectId: string): ProjectRow;
  abstract accessibleProjectIds(userId: string): string[];
  abstract listProjects(userId: string): Promise<ProjectSummary[]>;
  abstract createProject(owner: UserRow, projectId: string, name?: string): Promise<ProjectSummary>;
  /** Every id `createProject` refuses as taken, as names only: the rows and the data root's entries. */
  abstract takenProjectIds(): Promise<string[]>;
  abstract provisionInitialProject(user: UserRow, isAdmin: boolean): Promise<void>;
  abstract renameProject(userId: string, projectId: string, name: string): Promise<ProjectSummary>;
  abstract deleteProject(userId: string, projectId: string): Promise<void>;
  abstract destroyProject(projectId: string): Promise<void>;
  abstract listMembers(userId: string, projectId: string): MemberInfo[];
  abstract addMember(userId: string, projectId: string, targetUserId: string): MemberInfo;
  abstract removeMember(userId: string, projectId: string, targetUserId: string): void;
}

/** ProjectConfigStore: the mechanism ProjectConfigService implements. */
@Interface()
export abstract class ProjectConfigStore {
  abstract readRaw(projectId: string): Promise<RawTable>;
  abstract loadConfig(projectId: string): Promise<ProjectConfig>;
  abstract writeRaw(projectId: string, data: RawTable): Promise<void>;
  abstract writeInitialConfig(projectId: string, name: string): Promise<void>;
  abstract ensurePresetModels(projectId: string): Promise<boolean>;
  abstract seedPresetPromotions(projectId: string): Promise<void>;
  abstract getName(projectId: string): Promise<string | undefined>;
  abstract setName(projectId: string, name: string): Promise<void>;
  abstract getDefaultModelRef(projectId: string): Promise<ModelRef | undefined>;
  abstract setDefaultModelRef(projectId: string, ref: ModelRefDto): Promise<ModelRefDto>;
  abstract getChatDefaults(projectId: string): Promise<ChatDefaultsDto>;
  abstract setChatDefaults(projectId: string, req: ChatDefaultsDto): Promise<ChatDefaultsDto>;
  /** The `[plugins]` table this Project asks for: package name → requirement, in the file's order. */
  abstract getPlugins(projectId: string): Promise<PluginTable>;
  /** Replaces the table (a declarative PUT); answers what was written. */
  abstract setPlugins(projectId: string, plugins: PluginTable): Promise<PluginTable>;
  abstract getCommandPolicy(projectId: string): Promise<CommandPolicyDto>;
  abstract setCommandPolicy(
    projectId: string,
    req: {
      enabled?: boolean;
      rules: { name: string; pattern: string; description?: string; enabled?: boolean }[];
    },
  ): Promise<CommandPolicyDto>;
  abstract getPricing(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<TieredRates | undefined>;
  abstract detectVision(
    projectId: string,
    req: ModelVisionDetectRequest,
  ): Promise<ModelVisionDetectResponse>;
  abstract testModel(projectId: string, req: ModelTestRequest): Promise<ModelTestResponse>;
  abstract detectProtocol(
    projectId: string,
    req: ModelProtocolDetectRequest,
  ): Promise<ModelProtocolDetectResponse>;
  abstract listEndpointModels(
    req: EndpointModelListRequest,
    listImpl?: (options: ListEndpointModelsOptions) => Promise<string[]>,
    timeoutMs?: number,
  ): Promise<EndpointModelListResponse>;
  abstract getModels(projectId: string): Promise<ModelsResponse>;
  abstract updateModels(projectId: string, req: ModelsUpdateRequest): Promise<ModelsResponse>;
  abstract setGroupApiKey(projectId: string, provider: string, apiKey: string): Promise<number>;
  abstract getGroupApiKey(projectId: string, provider: string): Promise<string | undefined>;
  abstract mergePlatformModels(
    projectId: string,
    provider: string,
    catalog: PlatformModelCatalog,
    apiKey: string,
    applyKeyToExisting: boolean,
  ): Promise<PlatformModelApplyResult>;
  abstract completeOnce(projectId: string, prompt: string): Promise<UtilityCompletion>;
}

export interface ModelPromotion {
  provider: string;
  modelId: string;
  discount: number;
}

/** Per-Project model promotions (web.db `model_promotions`). */
@Interface()
export abstract class ModelPromotions {
  abstract get(projectId: string, provider: string, modelId: string): number | undefined;
  abstract list(projectId: string): ModelPromotion[];
  /** Replaces every promotion of the Project, in one transaction. */
  abstract replaceAll(projectId: string, rows: readonly ModelPromotion[]): void;
  /** Replaces the promotions of one provider group, in one transaction. */
  abstract replaceProvider(
    projectId: string,
    provider: string,
    rows: readonly ModelPromotion[],
  ): void;
}

/** ModelOAuth: the mechanism ModelOAuthService implements. */
@Interface()
export abstract class ModelOAuth {
  abstract start(input: {
    projectId: string;
    userId: string;
    provider: string;
    mode: ModelOAuthMode;
    callbackOrigin: string;
  }): ModelOAuthStartResult;
  abstract deposit(input: { flowId: string; projectId: string; code: string }): void;
  abstract poll(input: { flowId: string; userId: string; projectId: string }): Promise<{
    status: ModelOAuthStatus;
    provider: string;
    error?: ModelOAuthErrorCode;
    applied?: number;
  }>;
  abstract complete(input: {
    flowId: string;
    userId: string;
    projectId: string;
    code: string;
  }): Promise<{ ok: true; applied: number } | { ok: false; error: ModelOAuthErrorCode }>;
}
