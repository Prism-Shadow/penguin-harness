/**
 * The projects mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { AccessibleProjectRow, ProjectRow } from "./repos/projects.js";
import type { MemberRow } from "./repos/members.js";
import type { AgentRow } from "./repos/agents.js";

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

/** From packages/server (api/types.ts): the project/model plumbing DTOs - the contracts
 * name them, so the types live with the contract. */

export interface CommandPolicyDto {
  /** Effective master switch; an absent stored value reads as true (the policy defaults on). */
  enabled: boolean;
  /** The effective rule list — the factory set when the project predates seeding and has none stored. */
  rules: CommandPolicyRuleDto[];
  /** The factory set, served for the settings UI's "restore defaults". */
  defaultRules: CommandPolicyRuleDto[];
}

export interface ChatDefaultsDto {
  /** Preselected Agent; must reference an existing Agent of the Project (400 unknown_agent). */
  agentId?: string;
  /** Prefilled Workspace directory; absent/empty = a temporary workspace. */
  workspace?: string;
  /** Prefilled approval mode; absent = the built-in "allow-all". */
  approvalMode?: ApprovalMode;
  /**
   * Fallback thinking level for Agents whose config has no explicit `model.thinking_level`
   * (resolution chain: Agent explicit > this project default > built-in "medium"). Never
   * "none" — only the selectable tiers.
   */
  thinkingLevel?: Exclude<ThinkingLevelName, "none">;
  /**
   * Read-only, GET only: the sandbox policy a new Session starts with — the server's Sandbox
   * settings. Not part of the Project's block; PUT ignores it.
   */
  sandbox?: SessionSandbox;
}

export interface DefaultModelOffer {
  /** The model offered as the default. */
  model: ModelRefDto;
  /** The default the Project stores now, outside the group; absent when it has none. */
  current?: ModelRefDto;
}

export interface EndpointModelListRequest {
  /** Endpoint base URL (as typed in the add-group dialog). */
  baseUrl: string;
  /** MMSP client type to speak (normally a detected generic protocol; whole-endpoint listings need one). */
  clientType: string;
  /** Newly entered API key (plaintext); omitted = the SDK's environment fallback for the protocol. */
  apiKey?: string;
}

export interface EndpointModelListResponse {
  ok: boolean;
  /** The model ids the endpoint serves, in the order the endpoint returned them (ok only). */
  models?: string[];
  /** The routed client has no models endpoint (MMSP UnsupportedOperationError) — callers offer the manual path. */
  unsupported?: boolean;
  message?: string;
}

export interface MemberInfo {
  userId: string;
  role: ProjectRole;
  createdAt: string;
}

export interface ModelProtocolDetectRequest {
  /** Base URL to probe (as typed in the form); each probe appends its protocol path. */
  baseUrl: string;
  /** Newly entered API key (plaintext); used for probe auth if provided. Detection also works keyless: a protocol-shaped 401/403 still proves the route. */
  apiKey?: string;
  /** "Clear saved API key" is checked: do not fall back to the stored key (probe the current draft). */
  clearApiKey?: boolean;
  /**
   * Optional paired reference: when it names a stored entry and no apiKey is given, that
   * entry's saved key backs the probes (mirrors the connectivity test), else its group's.
   * `provider` may be sent without `modelId` (the group settings dialog has no model): the
   * group key backs the probes.
   */
  provider?: string;
  modelId?: string;
}

export interface ModelProtocolDetectResponse {
  /** The first protocol an endpoint serves (an MMSP client type); absent when none of the three matched. */
  detected?: string;
  /**
   * The base URL the detected protocol answered at — the typed URL normalized (endpoint
   * path stripped, repeated `/v1` collapsed) and possibly with a trailing `/v1` added or
   * removed, so `https://host/v1/chat/completions` comes back as `https://host/v1`.
   * Present only alongside `detected`; callers write it back into their base URL field,
   * since that is where the protocol is served.
   */
  baseUrl?: string;
  probes: ModelProtocolProbeDto[];
}

export interface ModelTestRequest {
  /** Provider group of the model under test (paired with modelId). */
  provider: string;
  /** Upstream id of the model under test (sent to MMSP as-is). */
  modelId: string;
  /** Newly entered API key (plaintext); used for the test if provided. */
  apiKey?: string;
  /** "Clear saved API key" is checked: the test does **not** fall back to the stored key (tests against the current draft). */
  clearApiKey?: boolean;
  /** Speed-test mode: raises the probe's output cap (16 -> 64 tokens) so TTFT/TPS are measurable; costs a little more quota. */
  speed?: boolean;
  /**
   * base URL (not secret; the frontend always sends the form's current value): a string
   * means use it, `null` means explicitly clear it (no fallback to the stored value),
   * `undefined` means fall back to the stored value only when not provided.
   */
  baseUrl?: string | null;
  /** MMSP client type; required for an unsaved custom model whose id begins with no known vendor family (otherwise it can't be routed). */
  clientType?: string;
  /**
   * Test with fast mode (the frontend always sends the form's current value, so an unsaved
   * toggle — either direction — is what gets tested); omitted falls back to the stored
   * annotation. Lets "Test connection" surface a fast-mode rejection before saving.
   */
  fastMode?: boolean;
}

export interface ModelTestResponse {
  ok: boolean;
  latencyMs?: number;
  /** Time from request start to the first streamed content (thinking or text), ms. */
  ttftMs?: number;
  /**
   * Output tokens per second over the streaming window (first content -> stream end), 1dp.
   * Omitted unless the sample is large enough to mean anything: a reply of a few tokens is
   * dominated by the final chunk's round trip, so the rate it yields tracks network jitter
   * rather than the model. Callers render TTFT alone in that case.
   */
  tps?: number;
  message?: string;
}

export interface ModelVisionDetectRequest {
  provider: string;
  modelId: string;
  /** Newly entered API key (plaintext); the stored one backs the probe when omitted. */
  apiKey?: string;
  /** "Clear saved API key" is checked: do not fall back to the stored key. */
  clearApiKey?: boolean;
  /** Form's current base URL; null means "explicitly none" (as in the connectivity test). */
  baseUrl?: string | null;
  /** Protocol to speak, when the form has one; otherwise the stored/auto-routed client. */
  clientType?: string;
}

export interface ModelVisionDetectResponse {
  outcome: ModelVisionOutcome;
  message?: string;
}

export interface ModelsResponse {
  /** Paired reference to the default Model. */
  defaultModel?: ModelRefDto;
  /** Vision model used as a proxy reader for read_file (describes images when the session model has vision=false). */
  visionModel?: ModelRefDto;
  /**
   * When the Project's model/credential config last changed (ISO; the config file's mtime,
   * so it survives restarts). The web's auth-dead gate compares it against the last auth
   * abort: an abort OLDER than the last credential update no longer disables the composer
   * (the key was fixed since). Absent when the Project has no config file yet.
   */
  updatedAt?: string;
  /** Every group's stored connection (`[providers.<id>]`), keyed by provider id; a group with none is absent. */
  providers: Record<string, ProviderConnectionDto>;
  models: ModelInfo[];
}

export interface ModelsUpdateRequest {
  /** Must be included in models (matched by paired reference). */
  defaultModel?: ModelRefDto;
  /** Vision model used as a proxy reader for read_file: must be included in models and not annotated vision=false; omitted keeps the existing value. */
  visionModel?: ModelRefDto;
  /** Group connection changes, merged per provider; a provider absent here keeps its table. */
  providers?: Record<string, ProviderConnectionUpdate>;
  models: ModelUpdateEntry[];
}

export type PresetSyncMode = "add" | "restore";

export interface ProjectSummary {
  projectId: string;
  /** Display name (the `name` in project_config.toml); frontend falls back to projectId when unset. */
  name?: string;
  /** Current user's role in this Project. */
  role: ProjectRole;
  ownerUserId: string;
  createdAt: string;
}

export interface ProviderConnectionUpdate {
  /** `null` clears it; omitted keeps it. */
  baseUrl?: string | null;
  /**
   * `null` or `""` clears it; omitted keeps it. Any group takes one: a row that stores its own
   * protocol keeps it.
   */
  clientType?: string | null;
  /** A non-empty key; sets `createdAt`. Rows with their own key keep it. */
  apiKey?: string;
  /** When true, clears the group key (rows with their own key keep it). */
  clearApiKey?: boolean;
}

export interface ProviderConnectionDto {
  baseUrl?: string;
  clientType?: string;
  apiKeyMasked?: string;
  /** When the group key was written (ISO 8601). */
  createdAt?: string;
}

export interface ProviderConnectionResponse extends ModelsResponse {
  defaultOffer?: DefaultModelOffer;
}

export interface PresetSyncResponse extends ModelsResponse {
  /** Preset rows added (both modes). */
  added: number;
  /** Preset rows the Project already had that `restore` changed (0 for `add`). */
  restored: number;
}

export type ServerEvent =
  /**
   * Approval request escalated to a human: every call under always-ask, plus rw/unknown-permission
   * calls under read-only, plus — under every mode but deny-all — a call a command-policy `ask`
   * rule matched, which carries `reason` (see runtime/approvals.ts); pending approvals are
   * resent on reconnect.
   */
  | {
      type: "approval_request";
      toolCall: AmspRecord<ToolCallPayload>;
      origin?: string[];
      reason?: ApprovalReason;
    }
  /** Session run status flip (for toggling the input area and list); `queued` = queued follow-up count (see TaskCreateRequest.queueIfBusy). */
  | {
      type: "task_state";
      state: SessionStatus;
      queued?: number;
      /** Steering messages queued but not yet delivered (absent = none): lets the composer's hint and its content survive reloads. */
      pendingSteering?: PendingSteeringInfo[];
      /**
       * Steering the run ended without delivering (absent = none) — an interrupt while a tool
       * was running is the ordinary way to produce one. Handed back rather than discarded: the
       * composer recalls each by the same handle and restores it into the draft, so the typed
       * message returns to the input box instead of being lost.
       */
      returnedSteering?: PendingSteeringInfo[];
      /** Queued follow-up tasks awaiting auto-start (absent = none): per-entry content + recall handle, alongside the `queued` count. */
      pendingFollowUps?: PendingFollowUpInfo[];
      /**
       * Live subagent children of this session's runtime (absent = none): the panel renders
       * child running marks from this structural liveness instead of parsing tool-output
       * text. Refreshed on every child run start/settle.
       */
      subagents?: SubagentRuntimeInfo[];
    }
  /** The model-generated title after the first turn has been persisted (for in-place list updates). */
  | { type: "session_title"; sessionId: string; title: string }
  /**
   * The user-channel counterpart of `task_state`: the same run-state flip, named by
   * `sessionId`, delivered on GET /api/events.
   *
   * `task_state` is session-scoped and deliberately carries no id, so it only ever reaches the
   * one conversation a tab has subscribed to — every OTHER row in that tab's Session list would
   * otherwise keep whatever status its last list fetch returned. This event exists so the list
   * can stay live without polling; the per-Session contract is unchanged.
   *
   * `lastActiveAt` and `hasTrace` are the row's own fields as they stand after the flip, both
   * written just before publishing (`markDriven` at run start sets has_trace and stamps
   * last_active_at; `touchLastActive` stamps again at run end). They are what let a list act on
   * the flip without refetching: the stamp separates "this finished while I was looking
   * elsewhere" from "this finished before I last looked", and `hasTrace` separates a Session
   * that has now run from one that never has — a first run would otherwise settle back into the
   * blank "never ran" row the client still believes in.
   *
   * `projectId` names the Session's Project: a list showing one Project ignores another's flips
   * without a request, and a flip for a Session of its own Project that it holds no row for is a
   * row it is missing — one that became active below its activity cursor (see SessionsResponse) —
   * which it fetches by id.
   *
   * Published only to the user channels of the Project's owner and members.
   */
  | {
      type: "session_state";
      sessionId: string;
      projectId: string;
      state: SessionStatus;
      lastActiveAt: string;
      hasTrace: boolean;
    }
  /**
   * A Session's background-task counts changed: a command promoted to the background, a
   * process that exited or was stopped, a background subagent starting or settling a round,
   * a released session. The counts are the row's `backgroundTasks` as they stand after the
   * change — zeros included, so a list can clear its mark without refetching. Published to
   * the user channels of the Project's owner and members, like `session_state`.
   */
  | { type: "session_background"; sessionId: string; processes: number; subagents: number }
  /**
   * A Session's count of tool calls waiting for a person's approval changed: a call was
   * escalated (every call under always-ask, rw/unknown calls under read-only), answered, or
   * denied by an interrupt. The count is the row's `pendingApprovalCount` as it stands after
   * the change, zeros included, so a list moves its mark without refetching; the calls
   * themselves are on the Session's own stream (`approval_request`, replayed on subscribe).
   * Published to the user channels of the Project's owner and members, like `session_state`.
   */
  | { type: "session_approvals"; sessionId: string; count: number }
  /** Last-Event-ID has been evicted from the buffer: the frontend should re-fetch the history endpoint before continuing to consume this connection. */
  | { type: "resync_required" }
  /**
   * The Project's model credentials changed (PUT /models): cached runtimes have been
   * invalidated server-side, so an auth-dead Session can continue — the frontend clears
   * its auth-dead composer state immediately. Published to every existing Session channel
   * of the Project; tabs without a live channel learn the same fact from the models
   * response's `updatedAt` on their next load.
   */
  | { type: "credentials_updated" }
  /** Placeholder handshake on the user channel (reserved for automated task notifications). */
  | { type: "hello" }
  /**
   * The stream's own beat, written by the endpoint's SSE writer every 20 seconds (http/sse.ts)
   * on `/api/events`, and by the hub on a machine's aggregate stream. The socket's ping and the
   * `: ping` comment line are invisible to a stream's consumer, so without this a stream that
   * stopped while its socket stayed healthy would look alive forever: the hub
   * (machines/event-hub.ts) and the browser (web api/socket.ts) each end a stream that misses
   * two beats and re-issue it with its last event id.
   */
  | { type: "heartbeat" }
  /** The served web assets were hot-swapped by a platform upgrade: clients reload to pick them up. */
  | { type: "web_updated"; rev: string }
  /**
   * The server's imported theme packs changed (one was imported, replaced or removed): every
   * signed-in tab re-reads `GET /api/themes`. No payload; on the user channel of everyone online.
   */
  | { type: "themes_changed" }
  /**
   * A Session now exists. On the user channel for every creation — the CLI, another tab,
   * a schedule, an agent spawning a child — so the list learns about rows it did not make;
   * and on the parent Session's channel for a subagent, which no list shows. `source` is what
   * the new Session's meta records, and it tells a client which list, if any, the row joins.
   */
  | {
      type: "session_created";
      projectId: string;
      agentId: string;
      sessionId: string;
      source: SessionSource;
    }
  /**
   * The user's listing decision on one Session changed (PATCH `archived`, the archive page's
   * batch unarchive): an archived row leaves the sidebar, an unarchived one joins it. One per
   * Session, to the Project's users.
   */
  | {
      type: "session_archived";
      sessionId: string;
      projectId: string;
      agentId: string;
      archived: boolean;
    }
  /**
   * A Session was deleted (DELETE, the subagent children deleted with it, the archive page's
   * batch delete): every client drops the row. One per Session, to the Project's users.
   */
  | { type: "session_deleted"; sessionId: string; projectId: string }
  | ScheduleServerEvent
  | GoalServerEvent
  | CompanyServerEvent
  | BuiltinBrowserServerEvent
  | MachineServerEvent;

/**
 * The machines' events on the user channel, published to admins only — the Machines page,
 * and the `/server/<id>` proxy everything else about a machine goes through, are admin-only.
 */
export type MachineServerEvent =
  /**
   * Something the machines list reports changed — a job queued, started, moved to its next
   * step, logged a line or ended; a connection was held or dropped; a reconnect began, failed
   * or succeeded; a machine joined or left a Project; a checkout's install image started or
   * finished building. No payload: a page re-reads `GET …/machines`, which is its one account
   * of every machine. Coalesced, so a burst of log lines costs a few reads, not one per line.
   */
  | { type: "machines_changed" }
  /**
   * One of a connected machine's own user-channel events, tagged with the machine it came
   * from. They ride the machines aggregate (event-hub.ts, `GET …/machines/events`) — ONE
   * stream for every connected machine, whose per-machine frames have this same shape; the
   * page that re-publishes them on its own channel wraps them this way too. One stream, not
   * a stream per machine: five of those once took the browser's whole HTTP/1.1 allowance of
   * six connections to one origin, and every other request of the page then waited behind
   * them for good.
   */
  | { type: "machine_event"; machineId: string; event: ServerEvent };

/** Goal-mode progress on the session channel (the chat page drives its goal banner from these). */
export type GoalServerEvent =
  /** A goal run began (published before the first round). */
  | { type: "goal_started"; sessionId: string; objective: string; budget: number }
  /** A round is starting; `used` is the runner's accounting up to this point. */
  | { type: "goal_round"; sessionId: string; round: number; used: number; budget: number }
  /** The goal reached a terminal state. */
  | {
      type: "goal_finished";
      sessionId: string;
      outcome: "complete" | "blocked" | "budget_limited" | "aborted";
      rounds: number;
      used: number;
    };

/** Schedule notification (user-level event stream; firing and delivery are notified via /api/events). */
export type ScheduleServerEvent =
  /** Fired and sent (sessionId is the session that received the Prompt; a new session under new-Session mode). */
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  /** Target Session is running; this firing is queued and will be sent once it's idle. */
  | {
      type: "schedule_queued";
      projectId: string;
      agentId: string;
      name: string;
      sessionId: string;
    }
  /**
   * A workbench of the Agent was (re)loaded — its folder changed, a reload was requested, or a
   * version was restored — or switched on or off, by its own switch or the Agent's.
   */
  | { type: "workbench_updated"; projectId: string; agentId: string; workbench: WorkbenchInfo }
  /** A load of a workbench's files has started (the watcher saw an edit, or a list or reload asked for it). */
  | { type: "workbench_building"; projectId: string; agentId: string; workbenchId: string }
  /** A workbench's folder is gone — removed from the Web App or deleted on disk. */
  | { type: "workbench_removed"; projectId: string; agentId: string; workbenchId: string };

// ---------------------------------------------------------------------------
// Trace browsing and performance analysis
// ---------------------------------------------------------------------------



export interface SessionTracesResponse {
  files: TraceFileInfo[];
}

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
