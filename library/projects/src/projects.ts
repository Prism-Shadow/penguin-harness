/**
 * The projects mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AccessibleProjectRow, ProjectRow } from "./repos/projects.js";
import type { MemberRow } from "./repos/members.js";
import type { AgentRow } from "./repos/agents.js";
import type {
  ChatDefaultsDto,
  CommandPolicyDto,
  DefaultModelOffer,
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
  PresetSyncMode,
  PresetSyncResponse,
  ProjectRole,
  ProviderConnectionResponse,
  ProviderConnectionUpdate,
  ProjectSummary,
  ServerEvent,
} from "./repos/projects.js";
import type { UserRow } from "@prismshadow/penguin-library-identity";

import type {
  ListEndpointModelsOptions,
  ModelRequestContext,
  ModelRef,
  PluginTables,
  ProjectConfig,
} from "@prismshadow/penguin-core";




/** From packages/server (services/project-config-service.ts): the raw config table shape. */
export type RawTable = Record<string, unknown>;

/** From packages/server (services/project-config-service.ts): a utility completion's finish reason. */
export type UtilityCompletion =
  | { ok: true; text: string }
  | {
      ok: false;
      /** `no_model`: the Project names no default model, or names one it has no entry for - nothing was asked. `failed`: the model was asked and produced no text. */
      cause: "no_model" | "failed";
      error: string;
    };

/** From packages/server (services/usage-service.ts): the pricing lookup's buckets. */
export interface PricingRates {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** From packages/server (services/usage-service.ts): peak/off-peak pricing. */
export interface TieredRates {
  peak: PricingRates;
  offPeak: PricingRates;
}

/** From packages/server (services/platform-auth-types.ts): the pricing unit row. */
export interface PlatformCatalogPricing {
  unit: "usd_per_mtok";
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** From packages/server (services/platform-auth-types.ts): a platform model, normalized. */
export interface PlatformCatalogModel {
  modelId: string;
  displayName: string;
  contextWindow: number;
  supportsVision: boolean;
  /**
   * List price, which is what a Project stores: the platform's `listPricing` when it runs a
   * promotion on the model, its billed `pricing` otherwise.
   */
  pricing: PlatformCatalogPricing;
  /** Fraction off `pricing` the platform is running (0.5 = half price); absent when none. */
  discount?: number;
  baseUrl: string;
  clientType: "mmsp";
}

/** From packages/server (services/platform-auth-types.ts): the platform's model catalog. */
export interface PlatformModelCatalog {
  models: PlatformCatalogModel[];
}

/** From packages/server (services/platform-auth-types.ts): the catalog merge result. */
export interface PlatformModelApplyResult {
  added: number;
  updated: number;
  applied: number;
  defaultOffer?: DefaultModelOffer;
}

/** From packages/server (services/model-oauth-service.ts): the OAuth flow's vocabulary. */
export type ModelOAuthErrorCode =
  /** The authorization request itself was malformed (bad callback URL, incomplete PKCE). */
  | "invalid_request"
  /** The code is unknown, expired, already redeemed, or was minted for another verifier. */
  | "code_rejected"
  /** The provider answered, but not with a usable key. */
  | "upstream_failed"
  /** The provider could not be reached at all. */
  | "unreachable"
  /** A key was minted but could not be written into the Project's models. */
  | "apply_failed";

export type ModelOAuthMode = "callback" | "manual";

export interface ModelOAuthStartResult {
  flowId: string;
  authorizeUrl: string;
  mode: ModelOAuthMode;
}

export type ModelOAuthStatus = "pending" | "done" | "error";

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
  /** Reads every Project's config once, so what the read path's one-time migrations write back (core's and the server's) is on disk before any Session opens one. */
  abstract migrateStoredConfigs(): Promise<void>;
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
  /** The `[plugins]` key: the shared table and each machine's own, package name → requirement, in the file's order. */
  abstract getPluginTables(projectId: string): Promise<PluginTables>;
  /** Replaces the tables (a declarative PUT); answers what was written. */
  abstract setPluginTables(projectId: string, tables: PluginTables): Promise<PluginTables>;
  abstract getCommandPolicy(projectId: string): Promise<CommandPolicyDto>;
  abstract setCommandPolicy(
    projectId: string,
    req: {
      enabled?: boolean;
      rules: {
        name: string;
        pattern: string;
        description?: string;
        enabled?: boolean;
        action?: "deny" | "ask";
      }[];
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
  /**
   * One group's `[providers.<id>]` connection, merged per field; rows are never touched. The
   * group's first key reports its connect default as `defaultOffer`; the default is untouched.
   */
  abstract setProviderConnection(
    projectId: string,
    provider: string,
    patch: ProviderConnectionUpdate,
  ): Promise<ProviderConnectionResponse>;
  /** "Add new models" (`add`) or "Restore defaults" (`restore`) against the built-in catalog. */
  abstract syncPresets(projectId: string, mode: PresetSyncMode): Promise<PresetSyncResponse>;
  /**
   * Writes the group key; resolves to how many of the group's rows use it (none of their own),
   * and the connect default the group's first key offers as the default model.
   */
  abstract setGroupApiKey(
    projectId: string,
    provider: string,
    apiKey: string,
  ): Promise<GroupKeyApplied>;
  abstract setGroupApiKeyWithProviderAuthToken(
    projectId: string,
    provider: string,
    apiKey: string,
    token: Omit<ModelProviderAuthToken, "provider" | "updatedAt">,
    options?: { expectedRefreshToken?: string },
  ): Promise<number>;
  /** The group key (`[providers.<id>].api_key`), never a row's own. Server-side only. */
  abstract getGroupApiKey(projectId: string, provider: string): Promise<string | undefined>;
  /** One row's own key (its override of the group's), or undefined. Server-side only. */
  abstract getModelApiKey(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<string | undefined>;
  /**
   * The key a group's account balance is read with: the group key (never a row's own), or
   * else the vendor's environment key where MMSP's vendor client reads it for the group's base
   * URL (none, or the vendor's own default endpoint). Server-side only.
   */
  abstract getGroupBalanceKey(projectId: string, provider: string): Promise<string | undefined>;
  abstract setModelApiKeyResolver(
    resolver: (context: ModelRequestContext) => Promise<string | undefined>,
  ): void;
  abstract mergePlatformModels(
    projectId: string,
    provider: string,
    catalog: PlatformModelCatalog,
    apiKey: string,
    applyKeyToExisting: boolean,
  ): Promise<PlatformModelApplyResult>;
  abstract completeOnce(projectId: string, prompt: string): Promise<UtilityCompletion>;
}

/** A group key written: how many of the group's rows use it, and the default it offers, if any. */
export interface GroupKeyApplied {
  applied: number;
  defaultOffer?: DefaultModelOffer;
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

export interface ModelProviderAuthToken {
  provider: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  updatedAt: string;
}

/** Server-side OAuth refresh metadata for provider groups (web.db `model_provider_auth_tokens`). */
@Interface()
export abstract class ModelProviderAuthTokens {
  abstract get(projectId: string, provider: string): ModelProviderAuthToken | undefined;
  abstract upsert(projectId: string, row: Omit<ModelProviderAuthToken, "updatedAt">): void;
  abstract delete(projectId: string, provider: string): void;
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
    defaultOffer?: DefaultModelOffer;
  }>;
  abstract complete(input: {
    flowId: string;
    userId: string;
    projectId: string;
    code: string;
  }): Promise<({ ok: true } & GroupKeyApplied) | { ok: false; error: ModelOAuthErrorCode }>;
}

/**
 * ProjectEvents: the mechanism ProjectNotifier implements — a user-level event to everyone
 * who can see a Project, its owner and its members with GET /api/events open. The runtime
 * publishes a Session's state flips and its generated title this way, and a route
 * publishes a change the list could not otherwise learn of (a rename, a new Session).
 */
@Interface()
export abstract class ProjectEvents {
  abstract notifyProjectUsers(projectId: string, event: ServerEvent): void;
}
