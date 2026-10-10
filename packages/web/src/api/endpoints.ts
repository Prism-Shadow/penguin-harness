/**
 * API endpoint wrappers: one function per API.
 * DTO types come from @prismshadow/penguin-server/api (**type import only**, resolved via
 * tsconfig paths to the server contract file types.ts; must not be a value import — server
 * code must not enter the browser bundle).
 */
import type {
  ActionRunAnswer,
  ActionRunResponse,
  ActionRunsResponse,
  ActionsResponse,
  AdminPasswordResetRequest,
  AdminUserCreateRequest,
  AdminUserCreateResponse,
  AdminUsersResponse,
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentCreateRequest,
  AgentCreateResponse,
  AgentHooksResponse,
  AgentImportRequest,
  AgentImportResponse,
  AgentKernelUpdateResponse,
  AgentPluginsInstallResponse,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentSkillsResponse,
  AgentsResponse,
  AgentVaultConfigDto,
  ApprovalDecisionRequest,
  AuthLoginRequest,
  AuthResponse,
  BenchmarkCasesResponse,
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseMaterial,
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  DefaultModelResponse,
  DefaultModelUpdateRequest,
  DesktopPrivacyPane,
  DesktopUpdateStatusResponse,
  DirAccessResponse,
  DirectorySkillsResponse,
  DirListResponse,
  EndpointModelListRequest,
  EndpointModelListResponse,
  FeishuBindingPutRequest,
  FeishuBindingResponse,
  FeishuTestRequest,
  FeishuTestResponse,
  FilesCreateRequest,
  FilesMoveRequest,
  FilesStatRequest,
  FilesStatResponse,
  FilesWriteRequest,
  GoalResponse,
  InstallResponse,
  MachinesResponse,
  McpServerTestResponse,
  MemberAddRequest,
  MemberAddResponse,
  MembersResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportRequest,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MeResponse,
  MessagesResponse,
  MessagingBindingsResponse,
  MessagingChannel,
  MessagingTestMessageResponse,
  ModelBalanceResponse,
  ModelOAuthCodeResponse,
  ModelOAuthStartRequest,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  PlatformAuthFlowStatusResponse,
  PlatformAuthStartResponse,
  PlatformModelSyncResponse,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  MachinesUseResponse,
  PortForwardCreateRequest,
  PortForwardInfo,
  PortForwardsResponse,
  SshHostRequest,
  SshHostResponse,
  ModelsResponse,
  ModelsUpdateRequest,
  PresetSyncRequest,
  PresetSyncResponse,
  ProviderConnectionUpdate,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  OrganizationCreateRequest,
  OrganizationDetail,
  OrganizationPatchRequest,
  OrganizationSettings,
  OrganizationsResponse,
  OrgCalendarResponse,
  OrgCalendarUpsertRequest,
  OrgCalendarWriteResponse,
  OrgChannelCreateRequest,
  OrgChannelDetail,
  OrgChannelItem,
  OrgChannelMemberRequest,
  OrgChannelMessage,
  OrgChannelMessageSendRequest,
  OrgChannelMessagesResponse,
  OrgChannelPatchRequest,
  OrgChannelReadRequest,
  OrgChannelsResponse,
  OrgChartResponse,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgEmployeePatchRequest,
  OrgFinanceResponse,
  OrgHandbookFileResponse,
  OrgHandbookFilesResponse,
  OrgHandbookResponse,
  OrgHireRequest,
  OrgSessionsResponse,
  OrgTicketAttachRequest,
  OrgTicketBlockRequest,
  OrgTicketCreateRequest,
  OrgTicketDetail,
  OrgTicketMoveRequest,
  OrgTicketProgressRequest,
  OrgTicketsResponse,
  OrgTicketStartRequest,
  OrgTicketStartResponse,
  OrgTicketUpdateRequest,
  ProposalCommentEditRequest,
  ProposalCommentRequest,
  ProposalCreateRequest,
  ProposalDetail,
  ProposalRevision,
  ProposalFileResponse,
  ProposalFeedbackRequest,
  ProposalGraphResponse,
  ProposalImplChanges,
  ProposalImplementRequest,
  ProposalItem,
  ProposalMaterialRequest,
  ProposalPublishRequest,
  ProposalReadRequest,
  ProposalRejectRequest,
  ProposalResolveRequest,
  ProposalsResponse,
  PasswordChangeRequest,
  PluginFilesResponse,
  PluginInstallRequest,
  PluginLibraryResponse,
  PrefsResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectSchedulesResponse,
  ProjectsResponse,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
  QQBindingPutRequest,
  QQBindingResponse,
  QQScanPollResponse,
  QQScanStartResponse,
  QQTestRequest,
  QQTestResponse,
  RecalledMessageResponse,
  RestartResponse,
  RetryNowResponse,
  ScheduleItem,
  SchedulesResponse,
  ScheduleUpsertRequest,
  SemanticIdSuggestRequest,
  SemanticIdSuggestResponse,
  ProxyProbeProvider,
  ProxyProbeResponse,
  ProxyProbeTargetsResponse,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
  SessionCategory,
  SessionContextResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionSurfaceOpenRequest,
  SessionSurfaceResponse,
  SessionForkRequest,
  SessionForkResponse,
  SessionPatchRequest,
  SessionProcessesResponse,
  SessionResponse,
  PluginIndexEntry,
  PluginConfigResponse,
  PluginConfigActionResponse,
  PluginConfigUpdateRequest,
  LanguageIndexResponse,
  PluginContentsResponse,
  PluginReadmeResponse,
  SessionsResponse,
  SessionsOverviewResponse,
  SessionSwitchModelRequest,
  SessionTracesResponse,
  SkillArchiveInstallRequest,
  DiscordBindingPutRequest,
  DiscordBindingResponse,
  DiscordTestRequest,
  DiscordTestResponse,
  SteerRequest,
  SubagentMessageResponse,
  TaskCreateRequest,
  TaskCreateResponse,
  TelegramBindingPutRequest,
  TelegramBindingResponse,
  TelegramTestRequest,
  TelegramTestResponse,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceImportRequest,
  TraceImportResponse,
  UiPrefs,
  UpdateCheckResponse,
  UpdateJobStatus,
  UpdateProfileRequest,
  UpdateProfileResponse,
  DesktopTrayPatch,
  DesktopTrayStatusResponse,
  HostCommand,
  HostCommandsResponse,
  HookArchiveInstallRequest,
  UsageErrorKind,
  UsageErrorsClearResponse,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupBy,
  UsageModelTotals,
  UsageResponse,
  VaultResponse,
  VaultUpdateRequest,
  InstalledPluginsResponse,
  VersionHistoryDiffResponse,
  VersionHistoryResponse,
  WorkflowInfo,
  WorkflowVersion,
  AgentPackageResponse,
  AgentPackagePublishResponse,
  AgentPackagePreviewResponse,
  AgentPackageSourceKind,
  VersionRollbackResponse,
  VersionResponse,
  WeChatBindingPutRequest,
  WeChatBindingResponse,
  WeChatScanPollResponse,
  WeChatScanStartResponse,
  WeChatTestResponse,
  WorkspaceFilesResponse,
  WorkspaceSearchResponse,
  ContributionsResponse,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportRequest,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BrowserBackend,
  BrowserBackendResponse,
  HostedBrowserInputRequest,
  BrowserExtensionPairingResponse,
  BrowserExtensionsResponse,
  DesktopBrowserCommand,
  WorkspacePullRequestResponse,
} from "@prismshadow/penguin-server/api";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import { apiFetch, apiFetchWithMeta } from "./client";
import { rememberSessionsIn, rememberOrgMachine } from "../lib/org-machines";
import { machineForSession, rememberSessionMachine } from "../lib/session-machines";
import { apiUrl } from "../lib/server-context";
import { activityCursorParam } from "../lib/session-grouping";
import type { ActivityKey } from "../lib/session-grouping";

// Auth & user -----------------------------------------------------------------

export const login = (body: AuthLoginRequest) =>
  apiFetch<AuthResponse>("/api/auth/login", { method: "POST", body });

export const logout = () => apiFetch<void>("/api/auth/logout", { method: "POST", body: {} });

/**
 * The data root's install identity (public — no session needed, which is the point: the web
 * app asks before it knows whether anyone is signed in). See lib/install-scope.ts.
 */
export const getInstall = () => apiFetch<InstallResponse>("/api/install");

export const getMe = () => apiFetch<MeResponse>("/api/me");

/** Where the signed-in account's avatar is served from; `rev` (its `avatarRev`) makes the URL the image's own, so it is cached for good. */
export const meAvatarUrl = (rev: string): string => `/api/me/avatar?rev=${encodeURIComponent(rev)}`;

export const changePassword = (body: PasswordChangeRequest) =>
  apiFetch<void>("/api/me/password", { method: "PUT", body });

/**
 * Nickname and avatar, as a patch: an absent field keeps what is stored, `null` clears it.
 * The response carries the updated user, which the caller feeds straight back into the auth
 * state so the sidebar's avatar and name change without a second round trip.
 */
export const updateProfile = (body: UpdateProfileRequest) =>
  apiFetch<UpdateProfileResponse>("/api/me/profile", { method: "PUT", body });

export const getPrefs = () => apiFetch<PrefsResponse>("/api/me/prefs");

export const putPrefs = (prefs: UiPrefs) =>
  apiFetch<PrefsResponse>("/api/me/prefs", { method: "PUT", body: prefs });

// Admin user management (admin only) -----------------------------------------------------

export const adminListUsers = () => apiFetch<AdminUsersResponse>("/api/admin/users");

export const adminCreateUser = (body: AdminUserCreateRequest) =>
  apiFetch<AdminUserCreateResponse>("/api/admin/users", { method: "POST", body });

export const adminResetPassword = (userId: string, body: AdminPasswordResetRequest) =>
  apiFetch<void>(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body,
  });

export const adminDeleteUser = (userId: string) =>
  apiFetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });

/** Server-global settings (admin only): currently the "use system HTTP proxy" switch. */
export const adminGetSettings = () => apiFetch<ServerSettingsResponse>("/api/admin/settings");

/*
 * Plugin configuration is kept by each server in its own database, so `server` names the
 * machine whose settings are read or written — through this server's tunnel to it — and null
 * is this server's own. Nothing copies these values between machines.
 */

/** Every loaded plugin that declares a configuration, with its schema and masked values (admin). */
export const adminGetPluginConfig = (server: string | null = null) =>
  apiFetch<PluginConfigResponse>("/api/admin/plugin-config", { server });

/** One package's update (admin): omitted fields keep their value, a masked secret sent back keeps the stored one. */
export const adminPutPluginConfig = (
  body: PluginConfigUpdateRequest,
  server: string | null = null,
) => apiFetch<PluginConfigResponse>("/api/admin/plugin-config", { method: "PUT", body, server });

/** Runs one settings group's action (admin): what a deployment must DO on the machine, once. */
export const adminRunPluginConfigAction = (
  body: { name: string; action: string },
  server: string | null = null,
) =>
  apiFetch<PluginConfigActionResponse>("/api/admin/plugin-config/action", {
    method: "POST",
    body,
    server,
  });

/** Omitted fields keep their current value; applies immediately (no restart). */
export const adminPutSettings = (body: ServerSettingsUpdateRequest) =>
  apiFetch<ServerSettingsResponse>("/api/admin/settings", { method: "PUT", body });

/**
 * What the reachability probe would request — name and exact URL per provider — without
 * requesting it. Served rather than held as a frontend constant so the listed URLs cannot
 * drift from the ones actually fetched.
 */
export const adminGetProxyProbeTargets = () =>
  apiFetch<ProxyProbeTargetsResponse>("/api/admin/settings/proxy-probe");

/**
 * Measures the server's own outbound path to ONE of those targets, unauthenticated. One
 * request per provider so each row can be filled the moment its own answer arrives; the
 * provider id is the only thing sent, and the server matches it against the same fixed list.
 */
export const adminProbeProxy = (provider: ProxyProbeProvider) =>
  apiFetch<ProxyProbeResponse>(`/api/admin/settings/proxy-probe/${provider}`, { method: "POST" });

// Project & members --------------------------------------------------------------

export const listProjects = () => apiFetch<ProjectsResponse>("/api/projects");

export const createProject = (body: ProjectCreateRequest) =>
  apiFetch<ProjectCreateResponse>("/api/projects", { method: "POST", body });

/** Rename a Project's display name (owner); the id is immutable. */
export const updateProject = (projectId: string, body: ProjectUpdateRequest) =>
  apiFetch<ProjectUpdateResponse>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body,
  });

export const deleteProject = (projectId: string) =>
  apiFetch<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });

export const listMembers = (projectId: string) =>
  apiFetch<MembersResponse>(`/api/projects/${encodeURIComponent(projectId)}/members`);

export const addMember = (projectId: string, body: MemberAddRequest) =>
  apiFetch<MemberAddResponse>(`/api/projects/${encodeURIComponent(projectId)}/members`, {
    method: "POST",
    body,
  });

export const removeMember = (projectId: string, username: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );

/** New-chat defaults ([default_chat]): member-readable prefill for the draft page. */
export const getChatDefaults = (projectId: string) =>
  apiFetch<ChatDefaultsDto>(`/api/projects/${encodeURIComponent(projectId)}/chat-defaults`);

/** Whole-block replace (owner): an omitted key clears it; returns the stored block. */
export const putChatDefaults = (projectId: string, body: ChatDefaultsDto) =>
  apiFetch<ChatDefaultsDto>(`/api/projects/${encodeURIComponent(projectId)}/chat-defaults`, {
    method: "PUT",
    body,
  });

/** Sandbox command policy ([command_policy]): member-readable; carries the factory set for "restore defaults". */
export const getCommandPolicy = (projectId: string) =>
  apiFetch<CommandPolicyDto>(`/api/projects/${encodeURIComponent(projectId)}/command-policy`);

/** Whole-block replace (owner): the full rule list is required and gets materialized into the config. */
export const putCommandPolicy = (
  projectId: string,
  body: { enabled: boolean; rules: CommandPolicyRuleDto[] },
) =>
  apiFetch<CommandPolicyDto>(`/api/projects/${encodeURIComponent(projectId)}/command-policy`, {
    method: "PUT",
    body,
  });

// Model configuration -------------------------------------------------------------------

/** The Project's models on this server, or on the machine named: model config is per server. */
export const getModels = (projectId: string, machineId: string | null = null) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`, {
    server: machineId,
  });

export const putModels = (projectId: string, body: ModelsUpdateRequest) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`, {
    method: "PUT",
    body,
  });

/**
 * One group's connection (`[providers.<id>]`, owner): only the fields the update names change;
 * the models that store none of their own follow it. Answers with the whole table, re-read.
 */
export const putProviderConnection = (
  projectId: string,
  provider: string,
  body: ProviderConnectionUpdate,
) =>
  apiFetch<ModelsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/providers/${encodeURIComponent(provider)}`,
    { method: "PUT", body },
  );

/**
 * The built-in catalog against the table (owner): `add` adds the presets it lacks and touches
 * nothing else; `restore` puts every built-in model back to the catalog, keeping keys and the
 * user's own models. Answers with the table and the two counts.
 */
export const syncPresets = (projectId: string, body: PresetSyncRequest) =>
  apiFetch<PresetSyncResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/sync-presets`,
    { method: "POST", body },
  );

/** Narrow default-model switch (owner): flips the same default_model the models page maintains, without resending the table. */
export const putDefaultModel = (projectId: string, body: DefaultModelUpdateRequest) =>
  apiFetch<DefaultModelResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/default`, {
    method: "PUT",
    body,
  });

/**
 * A group's account balance, read by the server with the group's stored key (the key never
 * comes back). `force` skips the server's 60 s cache — the page's refresh click.
 */
export const getModelBalance = (projectId: string, provider: string, force = false) =>
  apiFetch<ModelBalanceResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/balance?provider=${encodeURIComponent(provider)}${force ? "&force=1" : ""}`,
  );

/** Connectivity test: model reference (provider, modelId) is passed in the request body (may include an unsaved apiKey / baseUrl). */
export const testModel = (projectId: string, body: ModelTestRequest) =>
  apiFetch<ModelTestResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/test`, {
    method: "POST",
    body,
  });

/** Protocol auto-detection for a custom base URL: probes openai-responses → ant-messages → openai-chat and returns the first protocol the endpoint serves. */
export const detectProtocol = (projectId: string, body: ModelProtocolDetectRequest) =>
  apiFetch<ModelProtocolDetectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/detect`,
    { method: "POST", body },
  );

/** Endpoint model listing: given a base URL plus the protocol /detect reported, returns every model id the endpoint serves (the add-group import). */
export const listEndpointModels = (projectId: string, body: EndpointModelListRequest) =>
  apiFetch<EndpointModelListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/list`,
    { method: "POST", body },
  );

/** Vision probe: sends one 1x1 image on this model's credential and reports whether it was accepted (a real, billed completion — unlike the protocol probes). */
export const detectVision = (projectId: string, body: ModelVisionDetectRequest) =>
  apiFetch<ModelVisionDetectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/detect-vision`,
    { method: "POST", body },
  );

// Provider key minting (owner) ----------------------------------------------------------

/**
 * Opens an authorization flow for a provider group that publishes one, and returns the page
 * to send the user to. The PKCE verifier and the key it eventually mints stay on the server;
 * this side only ever holds the flow id.
 */
export const startModelOAuth = (projectId: string, body: ModelOAuthStartRequest) =>
  apiFetch<ModelOAuthStartResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/start`,
    { method: "POST", body },
  );

/** Where a flow stands; 404 once it has expired. */
export const getModelOAuthStatus = (projectId: string, flowId: string) =>
  apiFetch<ModelOAuthStatusResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/${encodeURIComponent(flowId)}`,
  );

/** Redeems a code the user pasted, for when the provider's redirect cannot reach the harness. */
export const submitModelOAuthCode = (projectId: string, flowId: string, code: string) =>
  apiFetch<ModelOAuthCodeResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/model-oauth/${encodeURIComponent(flowId)}/code`,
    { method: "POST", body: { code } },
  );

// Bridge-authorized groups (owner) -----------------------------------------------
//
// Penguin Go and ModelScope both hand a group an API key by creating a server-side flow,
// polling it, and reporting the same six states and seven failure codes; only the route and
// the name of the "this flow is gone" code differ. Each group therefore gets one descriptor
// here rather than four loose exports, and the dialog they share takes one as a prop — a
// third such group is an entry in this section, not a third copy of the dialog.

export interface KeyAuthEndpoints {
  /**
   * The code the server answers with once a flow no longer exists (expired or unknown). The
   * dialog drops its handle on it and offers a fresh start instead of a retry.
   */
  flowNotFoundCode: string;
  start: (projectId: string) => Promise<PlatformAuthStartResponse>;
  status: (projectId: string, flowId: string) => Promise<PlatformAuthFlowStatusResponse>;
  retryApply: (projectId: string, flowId: string) => Promise<PlatformAuthFlowStatusResponse>;
  cancel: (projectId: string, flowId: string) => Promise<{ ok: boolean }>;
}

function keyAuth(route: string, flowNotFoundCode: string): KeyAuthEndpoints {
  const prefix = (projectId: string): string =>
    `/api/projects/${encodeURIComponent(projectId)}/${route}`;
  const flow = (projectId: string, flowId: string): string =>
    `${prefix(projectId)}/${encodeURIComponent(flowId)}`;
  return {
    flowNotFoundCode,
    start: (projectId) =>
      apiFetch<PlatformAuthStartResponse>(`${prefix(projectId)}/start`, {
        method: "POST",
        body: {},
      }),
    status: (projectId, flowId) =>
      apiFetch<PlatformAuthFlowStatusResponse>(`${flow(projectId, flowId)}/status`),
    retryApply: (projectId, flowId) =>
      apiFetch<PlatformAuthFlowStatusResponse>(`${flow(projectId, flowId)}/retry`, {
        method: "POST",
        body: {},
      }),
    cancel: (projectId, flowId) =>
      apiFetch<{ ok: boolean }>(`${flow(projectId, flowId)}/cancel`, { method: "POST", body: {} }),
  };
}

/** Penguin Go's relay authorization. */
export const platformAuthEndpoints = keyAuth("platform-auth", "platform_auth_flow_not_found");

/** ModelScope's, run through the harness's own authorization bridge. */
export const modelScopeAuthEndpoints = keyAuth("modelscope-auth", "modelscope_auth_flow_not_found");

export const syncPlatformModels = (projectId: string) =>
  apiFetch<PlatformModelSyncResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/platform-auth/sync`,
    { method: "POST", body: {} },
  );

// Vault environment variables (Agent-level) -------------------------------------------------------

export const getVault = (projectId: string, agentId: string) =>
  apiFetch<VaultResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault`,
  );

export const putVault = (projectId: string, agentId: string, body: VaultUpdateRequest) =>
  apiFetch<VaultResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault`,
    { method: "PUT", body },
  );

/** Inserts the {{VAULT}} placeholder into the agent's prompt template — migrating a legacy hardcoded # Vault section verbatim when one is present (idempotent, owner-only). */
export const insertVaultPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentVaultConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/vault/template-placeholder`,
    { method: "POST", body: {} },
  );

/** Inserts the {{SKILLS}} placeholder into the agent's prompt template — migrating a legacy hardcoded # Skills section verbatim when one is present (idempotent). */
export const insertSkillsPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentSkillsConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills/template-placeholder`,
    { method: "POST", body: {} },
  );

/** Inserts the {{SCHEDULES}} placeholder into the agent's prompt template (idempotent, owner-only; Schedules has no legacy section to migrate). */
export const insertSchedulesPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<AgentSchedulesConfigDto>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules/template-placeholder`,
    { method: "POST", body: {} },
  );

// Memory (Agent-level, agent_state/memory/) -------------------------------------------------

/** Base path of an Agent's Memory API; the scope key and file name are single path segments (never a path). */
const memoryBase = (projectId: string, agentId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/memory`;

const memoryFilesBase = (projectId: string, agentId: string, scopeKey: string) =>
  `${memoryBase(projectId, agentId)}/scopes/${encodeURIComponent(scopeKey)}/files`;

export const getMemoryOverview = (projectId: string, agentId: string) =>
  apiFetch<MemoryOverviewResponse>(memoryBase(projectId, agentId));

/** Inserts the {{MEMORY}} placeholder into the agent's prompt template (idempotent) — the explicit adoption path for an agent created before Memory. */
export const insertMemoryPlaceholder = (projectId: string, agentId: string) =>
  apiFetch<MemoryOverviewResponse>(`${memoryBase(projectId, agentId)}/template-placeholder`, {
    method: "POST",
    body: {},
  });

export const getMemoryFiles = (projectId: string, agentId: string, scopeKey: string) =>
  apiFetch<MemoryFilesResponse>(memoryFilesBase(projectId, agentId, scopeKey));

export const getMemoryFile = (projectId: string, agentId: string, scopeKey: string, name: string) =>
  apiFetch<MemoryFileResponse>(
    `${memoryFilesBase(projectId, agentId, scopeKey)}/${encodeURIComponent(name)}`,
  );

export const deleteMemoryFile = (
  projectId: string,
  agentId: string,
  scopeKey: string,
  name: string,
) =>
  apiFetch<void>(`${memoryFilesBase(projectId, agentId, scopeKey)}/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });

const memoryScopeBase = (projectId: string, agentId: string, scopeKey: string) =>
  `${memoryBase(projectId, agentId)}/scopes/${encodeURIComponent(scopeKey)}`;

/**
 * One scope as a transfer document. Fetched as ordinary JSON rather than followed as a download
 * link so a failure arrives as an ApiError and reaches the user as a toast — a bare `<a download>`
 * would save the error body as a file (the skills tab hit the same wall). The server still sets
 * Content-Disposition, for anyone opening the URL directly.
 */
export const exportMemoryScope = (projectId: string, agentId: string, scopeKey: string) =>
  apiFetch<MemoryScopeExport>(`${memoryScopeBase(projectId, agentId, scopeKey)}/export`);

/** Writes a transfer document into one scope (owner only); `confirm` is required by the modes that would destroy something. */
export const importMemoryScope = (
  projectId: string,
  agentId: string,
  scopeKey: string,
  body: MemoryImportRequest,
) =>
  apiFetch<MemoryImportResponse>(`${memoryScopeBase(projectId, agentId, scopeKey)}/import`, {
    method: "POST",
    body,
  });

// Agent & its configuration ----------------------------------------------------------------

/**
 * A project's Agents. With a machine, THAT machine's — Agents are per-server, so a Session
 * created on one can only name an Agent that exists there.
 */
export const listAgents = (projectId: string, machineId?: string | null) =>
  apiFetch<AgentsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents`,
    machineId === undefined ? {} : { server: machineId },
  );

export const createAgent = (projectId: string, body: AgentCreateRequest) =>
  apiFetch<AgentCreateResponse>(`/api/projects/${encodeURIComponent(projectId)}/agents`, {
    method: "POST",
    body,
  });

export const getAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config`,
  );

export const putAgentConfig = (
  projectId: string,
  agentId: string,
  body: AgentConfigUpdateRequest,
) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config`,
    { method: "PUT", body },
  );

/** Probes one MCP Server entry's reachability (server-side connect + tool discovery; nothing is saved). */
export const testAgentMcpServer = (projectId: string, agentId: string, body: MCPServerConfig) =>
  apiFetch<McpServerTestResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/mcp-test`,
    { method: "POST", body },
  );

/** Overwrite system_config.yaml with the current defaults (keeps only name/description/version). */
export const resetAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/reset`,
    { method: "POST" },
  );

/** Smart-merge the config up to the current defaults generation (customizations kept and reported); non-destructive sibling of resetAgentConfig. */
export const kernelUpdateAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentKernelUpdateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/kernel-update`,
    { method: "POST" },
  );

// Session ---------------------------------------------------------------------

/**
 * Optional paging (absent = full unfiltered list): the store requests `limit+1` per page to
 * detect "has more". `category` filters server-side (paging applies within the category);
 * `workspaceGroup` narrows the same way to one Workspace group, so a group can page its own
 * stream; `withCounts` asks for per-category totals over the whole list alongside the page.
 *
 * The sidebar pages in activity order with a cursor (`order: "activity"` + `before`), never by
 * offset: activity reorders the list while it is being read, and an offset page would skip a row
 * that moved above it. A server that predates `order` ignores both parameters and answers in
 * creation order — the next page then repeats rows the pool already holds, deduplicated by id.
 */
export const listSessions = (
  projectId: string,
  agentId: string,
  opts?: {
    /** Rows to skip, in creation order. Exclusive with `before`. */
    offset?: number;
    limit: number;
    /** `activity`: last activity first, ties by id descending (code-point order) — the sidebar's order. Omitted: creation order. */
    order?: "created" | "activity";
    /** Activity order only: rows strictly below this key — the last row of the previous page. */
    before?: ActivityKey;
    category?: SessionCategory;
    /** One Workspace group's rows only: its path, or the merged temporary group's sentinel (session-grouping.ts). */
    workspaceGroup?: string;
    withCounts?: boolean;
    /** The user's own rows only: an organization's desk, ticket and sub-sessions leave the page and the totals together (the development list's contract). */
    excludeOrg?: boolean;
  },
  /**
   * Which machine to ask. This path is NOT session-scoped, so nothing about it can be routed
   * from an id — it asks a server which Sessions IT has, and only the caller knows which
   * servers are worth asking. Omitted (or null) means this one.
   */
  machineId?: string | null,
) => {
  const qs = opts
    ? `?limit=${opts.limit}` +
      (opts.offset !== undefined ? `&offset=${opts.offset}` : "") +
      (opts.order ? `&order=${opts.order}` : "") +
      (opts.before ? `&before=${encodeURIComponent(activityCursorParam(opts.before))}` : "") +
      (opts.category ? `&category=${opts.category}` : "") +
      (opts.workspaceGroup ? `&workspaceGroup=${encodeURIComponent(opts.workspaceGroup)}` : "") +
      (opts.withCounts ? "&counts=1" : "") +
      (opts.excludeOrg ? "&excludeOrg=1" : "")
    : "";
  return apiFetch<SessionsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions${qs}`,
    { server: machineId ?? null },
  );
};

/**
 * The dashboard's read: every non-archived Session of the Project over every Agent, as
 * per-Session facts (status, last activity, origin) the page counts from against this
 * browser's seen markers. Asked of one server at a time, like the list — this one with no
 * machine, or a machine by its id.
 */
export const getSessionsOverview = (projectId: string, machineId?: string | null) =>
  apiFetch<SessionsOverviewResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sessions/overview`,
    { server: machineId ?? null },
  );

/** Server directory browsing: `path` is an absolute path; empty means start from the server's home directory. */
/**
 * Browses directories. With no machine, this server's own filesystem; with one, THAT
 * machine's — listed by this server over ssh, so picking a workspace on another machine
 * needs no second login to that machine's own server.
 *
 * `places` asks a home request (empty `path`) for the machine's standard folders and its
 * locations (drives, volumes, mounts) as well. Only this server discovers them, so the flag
 * goes on the local route alone; a machine reached over ssh answers with its folders only.
 */
export const listDirs = (
  projectId: string,
  path = "",
  machineId?: string | null,
  opts?: { places?: boolean },
) => {
  const places = opts?.places === true ? "&places=1" : "";
  return machineId === undefined || machineId === null
    ? apiFetch<DirListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/dirs?path=${encodeURIComponent(path)}${places}`,
      )
    : apiFetch<DirListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/dirs?path=${encodeURIComponent(path)}`,
      );
};

/**
 * Asks the desktop shell to read a folder macOS refused, in the app's own name — what makes
 * macOS ask the user. Always this server: only the shell that started it can be asked. The
 * answer waits on the user's reply to that prompt.
 */
export const requestDirAccess = (projectId: string, path: string) =>
  apiFetch<DirAccessResponse>(`/api/projects/${encodeURIComponent(projectId)}/dirs/access`, {
    method: "POST",
    body: { path },
    server: null,
  });

/**
 * Skills a directory carries under `.agents/skills` / `.claude/skills`: what picking it at Agent
 * creation would offer to install. `path` must be absolute.
 */
export const listDirectorySkills = (projectId: string, path: string) =>
  apiFetch<DirectorySkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/dir-skills?path=${encodeURIComponent(path)}`,
  );

/**
 * Creates a Session on the machine that owns its workspace.
 *
 * The Session is created THERE because that is where its workspace is: that server runs the
 * agent, holds the messages, writes the trace. The id it hands back is recorded against that
 * machine, so every later call about the Session routes itself without any call site knowing
 * (see lib/session-machines.ts).
 *
 * `machineId` is the workspace's, not a preference — a path names a different directory on
 * every machine, so creating a Session for `/srv/app` on the wrong one is not a degraded
 * result, it is a different request.
 */
export const createSession = async (
  projectId: string,
  agentId: string,
  body: SessionCreateRequest,
  machineId?: string | null,
) => {
  const created = await apiFetch<SessionCreateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions`,
    { method: "POST", body, server: machineId ?? null },
  );
  rememberSessionMachine(created.session.sessionId, machineId ?? null);
  return created;
};

export const forkSession = (sessionId: string, body: SessionForkRequest) =>
  apiFetch<SessionForkResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    body,
  });

/**
 * One Session's row. `machineId` names the server to ask when the caller knows and the id map
 * does not yet — a Session the list has never fetched, announced by a machine's own event
 * stream. Omitted, the id routes itself (lib/session-machines.ts).
 */
export const getSession = (sessionId: string, machineId?: string | null) =>
  apiFetch<SessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    machineId === undefined ? {} : { server: machineId },
  );

export const patchSession = (sessionId: string, body: SessionPatchRequest) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body,
  });

export const deleteSession = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });

// Messaging bindings ----------------------------------------------------------

/** The channel-agnostic read: every saved channel config + status (the channel-aware editor's load + poll). */
export const getMessagingBinding = (sessionId: string) =>
  apiFetch<MessagingBindingsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging`);

/** Saves Feishu credentials only — the connection toggle is setMessagingBindingState (an enabled binding restarts on save so config and connection never diverge). */
export const putFeishuBinding = (sessionId: string, body: FeishuBindingPutRequest) =>
  apiFetch<FeishuBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/feishu`,
    { method: "PUT", body },
  );

/** Saves the Telegram token only — the same save/enable split as the Feishu PUT. */
export const putTelegramBinding = (sessionId: string, body: TelegramBindingPutRequest) =>
  apiFetch<TelegramBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/telegram`,
    { method: "PUT", body },
  );

/** Saves the QQ App ID / App Secret pair only — the same save/enable split as the Feishu PUT. */
export const putQQBinding = (sessionId: string, body: QQBindingPutRequest) =>
  apiFetch<QQBindingResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq`, {
    method: "PUT",
    body,
  });

/** Saves the Discord bot token only — the same save/enable split as the Telegram PUT. */
export const putDiscordBinding = (sessionId: string, body: DiscordBindingPutRequest) =>
  apiFetch<DiscordBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/discord`,
    { method: "PUT", body },
  );

/**
 * Saves the WeChat delivery preferences. No credential rides along: this channel's token
 * comes only from a scan, so a PUT before one answers 400 `wechat_token_required`.
 */
export const putWeChatBinding = (sessionId: string, body: WeChatBindingPutRequest) =>
  apiFetch<WeChatBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat`,
    { method: "PUT", body },
  );

/** The connection toggle, which is also the bind/unbind: enable connects with the STORED credentials (409 `another_channel_enabled` while the other channel is enabled, 409 `account_enabled_elsewhere` while another conversation has this bot enabled), disable releases the account. */
export const setMessagingBindingState = (
  sessionId: string,
  channel: MessagingChannel,
  enabled: boolean,
) =>
  apiFetch<
    | FeishuBindingResponse
    | TelegramBindingResponse
    | QQBindingResponse
    | WeChatBindingResponse
    | DiscordBindingResponse
  >(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/${channel}/state`, {
    method: "POST",
    body: { enabled },
  });

/** Feishu credential probe with the form's draft values; omitted fields fall back to the stored binding. */
export const testFeishuBinding = (sessionId: string, body: FeishuTestRequest) =>
  apiFetch<FeishuTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/feishu/test`,
    { method: "POST", body },
  );

/** Discord credential probe (`GET /users/@me`); success additionally names the bot's @username. */
export const testDiscordBinding = (sessionId: string, body: DiscordTestRequest) =>
  apiFetch<DiscordTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/discord/test`,
    { method: "POST", body },
  );

/** Telegram credential probe (`getMe`); success additionally names the bot's @username. */
export const testTelegramBinding = (sessionId: string, body: TelegramTestRequest) =>
  apiFetch<TelegramTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/telegram/test`,
    { method: "POST", body },
  );

/**
 * Starts a QQ scan-to-connect flow. The response carries the URL to render as a QR code and
 * a task handle — never the AES key that decrypts the App Secret, which stays on the server.
 */
export const startQQScan = (sessionId: string) =>
  apiFetch<QQScanStartResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan`,
    {
      method: "POST",
      body: {},
    },
  );

/** One poll of a scan. `completed` means the server already decrypted and SAVED the credentials. */
export const pollQQScan = (sessionId: string, taskId: string) =>
  apiFetch<QQScanPollResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan/poll`,
    { method: "POST", body: { taskId } },
  );

/** Drops a scan the user walked away from, so its key is forgotten rather than left to expire. */
export const cancelQQScan = (sessionId: string, taskId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/scan/cancel`, {
    method: "POST",
    body: { taskId },
  });

/**
 * Starts a WeChat scan-to-connect flow — the ONLY way to bind this channel. The response
 * carries the URL to render as a QR code and a task handle; the platform's own poll handle,
 * which is what collects the bot token, stays on the server.
 */
export const startWeChatScan = (sessionId: string) =>
  apiFetch<WeChatScanStartResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan`,
    { method: "POST", body: {} },
  );

/** One poll of a scan. `completed` means the server has already SAVED the credential. */
export const pollWeChatScan = (sessionId: string, taskId: string) =>
  apiFetch<WeChatScanPollResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/poll`,
    { method: "POST", body: { taskId } },
  );

/**
 * Submits the pairing code WeChat showed on the phone. It rides the NEXT poll rather than a
 * request of its own, so this only records it — a wrong code surfaces as the poll asking again.
 */
export const verifyWeChatScan = (sessionId: string, taskId: string, verifyCode: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/verify`, {
    method: "POST",
    body: { taskId, verifyCode },
  });

/** Drops a scan the user walked away from, so its handle is forgotten rather than left to expire. */
export const cancelWeChatScan = (sessionId: string, taskId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/scan/cancel`, {
    method: "POST",
    body: { taskId },
  });

/** WeChat credential probe of the STORED binding; there is no draft to send and no account label back. */
export const testWeChatBinding = (sessionId: string) =>
  apiFetch<WeChatTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/wechat/test`,
    { method: "POST", body: {} },
  );

/** QQ credential probe (the access-token exchange); the platform names no account, so success carries no label. */
export const testQQBinding = (sessionId: string, body: QQTestRequest) =>
  apiFetch<QQTestResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/messaging/qq/test`, {
    method: "POST",
    body,
  });

/** Short fixed text to the binding's last known chat (409 `<channel>_no_chat` before one exists; on QQ the send can still fail with 502 when no recent QQ message can be replied to). */
export const sendMessagingTestMessage = (sessionId: string, channel: MessagingChannel) =>
  apiFetch<MessagingTestMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/${channel}/test-message`,
    { method: "POST", body: {} },
  );

/** Windowed history request: the newest N units (tail), or the N units before a cursor. */
export type MessagesPageQuery =
  { kind: "tail"; limit: number } | { kind: "before"; cursor: string; limit: number };

/**
 * History rebuild. Carries the server's clock at read time (see ApiFetchMeta.serverNowMs)
 * alongside the messages: a Task still running has no Trace entry for the event currently in
 * flight, so its elapsed can only be measured by differencing this against the Task's first
 * message timestamp — both server-side values, so no client clock offset enters the result
 * (see pushMessages).
 *
 * With `page`, requests a WINDOW instead of the full transcript (tail-first loading /
 * scroll-up backfill — see stream-controller): the response then carries
 * `MessagesResponse.page`. Omitted = the legacy full read (the resync fallback path).
 */
export const getMessages = (sessionId: string, page?: MessagesPageQuery) => {
  const qs =
    page === undefined
      ? ""
      : page.kind === "tail"
        ? `?tailLimit=${page.limit}`
        : `?before=${encodeURIComponent(page.cursor)}&limit=${page.limit}`;
  return apiFetchWithMeta<MessagesResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${qs}`,
  ).then(({ data, serverNowMs }) => ({ ...data, serverNowMs }));
};

// Task execution, approval, abort, compaction ------------------------------------------------------

export const postTask = (sessionId: string, body: TaskCreateRequest) =>
  apiFetch<TaskCreateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`, {
    method: "POST",
    body,
  });

export const getGoal = (sessionId: string) =>
  apiFetch<GoalResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/goal`);

export const postApproval = (
  sessionId: string,
  toolCallId: string,
  body: ApprovalDecisionRequest,
) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(toolCallId)}`,
    { method: "POST", body },
  );

/**
 * Hands one EXECUTING tool call back as a background task, so the turn closes and the
 * conversation carries on (404 tool_call_not_found when the call already finished — a benign
 * race the caller just ignores; 409 tool_not_detachable when the tool has no background form).
 */
export const postToolCallBackground = (sessionId: string, toolCallId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/tool-calls/${encodeURIComponent(toolCallId)}/background`,
    { method: "POST", body: {} },
  );

export const postAbort = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, {
    method: "POST",
    body: {},
  });

/** "Retry now" on the reconnect countdown: skips the remaining backoff wait server-side (skipped:false is the benign "no wait in progress" case — e.g. the timer elapsed in a race — never an error). */
export const postRetryNow = (sessionId: string) =>
  apiFetch<RetryNowResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/retry-now`, {
    method: "POST",
    body: {},
  });

/** Background processes the conversation started (details popover list); an evicted/never-loaded runtime reports an empty list. */
export const getSessionProcesses = (sessionId: string) =>
  apiFetch<SessionProcessesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/processes`);

/** Stops one background process (404 process_not_found when it already exited or the runtime is gone — callers just refresh). */
export const killSessionProcess = (sessionId: string, processId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}/kill`,
    { method: "POST", body: {} },
  );

/** Removes one EXITED background process entry from the list (409 process_running while it still runs — stopping is the kill route's job; 404 when it is already gone — callers just refresh). */
export const removeSessionProcess = (sessionId: string, processId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}`,
    { method: "DELETE" },
  );

/** Mid-run steering: queues a message for the running Task (delivered between turns as a standalone `[user_steering]` user message); 409 not_running when no Task is in progress. */
export const postSteer = (sessionId: string, body: SteerRequest) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    body,
  });

/** Panel message to one subagent child (#272) — a user input on the child, whatever its state: steered mid-run, started on an idle child, resumed when the released session was revived (the child runs at its own Session's thinking level; pin it with patchSession). 404 subagent_gone when nothing can be revived, 409 subagent_busy when the child cannot take it right now. */
export const messageSubagent = (sessionId: string, childSessionId: string, text: string) =>
  apiFetch<SubagentMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(childSessionId)}/message`,
    { method: "POST", body: { text } },
  );

/** Panel stop for one subagent child (#272): aborts only its CURRENT run — the session survives for follow-ups (202 aborted; 204 when already idle/unknown). */
export const abortSubagent = (sessionId: string, childSessionId: string) =>
  apiFetch<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(childSessionId)}/abort`,
    { method: "POST", body: {} },
  );

/** Recall an undelivered steering message back to the composer (#287): returns its original content; 409 not_pending once it was delivered to the model. */
export const recallSteer = (sessionId: string, steerId: string) =>
  apiFetch<RecalledMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/steer/${encodeURIComponent(steerId)}`,
    { method: "DELETE" },
  );

/** Recall a queued follow-up task back to the composer (#287): returns its original content (+ queued thinking level); 409 follow_up_started once it already auto-started. */
export const recallFollowUp = (sessionId: string, followUpId: string) =>
  apiFetch<RecalledMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/follow-ups/${encodeURIComponent(followUpId)}`,
    { method: "DELETE" },
  );

export const postCompact = (sessionId: string) =>
  // Same shape as tasks: the response carries the actual current session_id (a new id after self-healing; the frontend updates its route accordingly).
  apiFetch<TaskCreateResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
    method: "POST",
    body: {},
  });

/**
 * Switch this Session to another model in place. Two success shapes: **202** with a
 * {@link TaskCreateResponse} — the switch compacts on the current model first and streams like
 * `/compact`; the new context's `session_meta` follows a completed compaction, and it is what
 * says the Session switched — or **200** with a {@link SessionResponse} when the Session never
 * ran and switched inside the request. Only the latter carries `session`.
 */
export const switchSessionModel = (sessionId: string, body: SessionSwitchModelRequest) =>
  apiFetch<TaskCreateResponse | SessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/switch-model`,
    { method: "POST", body },
  );

/**
 * Composition of the Session's current model context (the chat page's context-ring detail panel).
 * A snapshot read from the newest Trace shard on each call, not a live counter: the figures are
 * estimates whose value is the *shares* they give the measured occupancy.
 */
export const getSessionContext = (sessionId: string) =>
  apiFetch<SessionContextResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/context`);

// Trace browsing & performance analysis -----------------------------------------------------------

export const getSessionTraces = (sessionId: string) =>
  apiFetch<SessionTracesResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/traces`);

export const getTraceEvents = (sessionId: string, index: number, offset: number, limit: number) =>
  apiFetch<TraceEventsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/traces/${index}`, {
    query: { offset, limit },
  });

export const getTraceAnalysis = (sessionId: string, index: number) =>
  apiFetch<TraceAnalysisResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/traces/${index}/analysis`,
  );

// Agent-level Trace details (read-only, independent of sessions-table registration): the Trace
// page's directory tree comes from an Agent-level scan (including subagent child Sessions and
// Sessions created by the CLI); details go through the Agent-level endpoint to avoid 404s for
// unregistered sessions.

export const getAgentTraceEvents = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
  offset: number,
  limit: number,
) =>
  // These name a Session without SAYING so in a way the routing rule can read: the rule is
  // over the path, and only `/api/sessions/<id>/…` declares its Session. So each of the three
  // Trace calls passes the owner explicitly — sent to this server instead, they asked about a
  // Session that lives on a machine, which truthfully has no such Trace file here, and the
  // panel reported the Trace as gone while it sat on the machine intact.
  apiFetch<TraceEventsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}`,
    { query: { offset, limit }, server: machineForSession(sessionId) },
  );

export const getAgentTraceAnalysis = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
) =>
  apiFetch<TraceAnalysisResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}/analysis`,
    { server: machineForSession(sessionId) },
  );

/** Trace file download URL: the server sets Content-Disposition attachment, usable directly in <a download>. */
export const agentTraceDownloadUrl = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
): string =>
  // A browser-followed URL, so the proxy prefix has to be IN it — there is no request here
  // for the routing rule to act on.
  apiUrl(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}/download`,
    machineForSession(sessionId),
  );

/** Imports a Trace JSONL file (owner only); the response says where the file landed (sessionId / index / date). */
export const importAgentTrace = (projectId: string, agentId: string, body: TraceImportRequest) =>
  apiFetch<TraceImportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/traces/import`,
    { method: "POST", body },
  );

// Usage statistics ----------------------------------------------------------------------

/**
 * The browser's own offset east of UTC, in minutes. The error table folds a day's repeats into
 * one row, and the day it folds by is the reader's rather than the server's.
 */
const viewerUtcOffsetMinutes = (): string => String(-new Date().getTimezoneOffset());

/**
 * One page of the cost center's error table (newest first). The dashboard response already
 * carries the first page; this is for paging back to earlier ones without refetching the
 * whole aggregate. Takes the dashboard's date/agent filter (and its trailing window, when one
 * is on) only — the model filter never applied to errors.
 */
export const getUsageErrors = (
  projectId: string,
  params: {
    offset: number;
    limit: number;
    from?: string;
    to?: string;
    /** The trailing window narrowing those dates; both or neither. */
    fromTs?: string;
    toTs?: string;
    agentId?: string;
    /** Narrow to one category; the cost-center badge asks for `unexpected` with `limit: 1`. */
    kind?: UsageErrorKind;
  },
) =>
  apiFetch<UsageErrorsPage>(`/api/projects/${encodeURIComponent(projectId)}/usage/errors`, {
    query: {
      offset: String(params.offset),
      limit: String(params.limit),
      from: params.from,
      to: params.to,
      fromTs: params.fromTs,
      toTs: params.toTs,
      agentId: params.agentId,
      kind: params.kind,
      utcOffsetMinutes: viewerUtcOffsetMinutes(),
    },
  });

/**
 * Empties the cost center's error table for the filter the panel is showing — the same dates,
 * trailing window and Agent the reads take, so what goes is what was on screen (for an admin,
 * the unattributed rows an admin's panel shows included). Owner only. Answers how many rows
 * were deleted.
 */
export const clearUsageErrors = (
  projectId: string,
  params: { from?: string; to?: string; fromTs?: string; toTs?: string; agentId?: string },
) =>
  apiFetch<UsageErrorsClearResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/usage/errors`,
    {
      method: "DELETE",
      query: {
        from: params.from,
        to: params.to,
        fromTs: params.fromTs,
        toTs: params.toTs,
        agentId: params.agentId,
      },
    },
  );

/**
 * Lifetime Token total per Model, unfiltered. The models page shows each card what it has
 * spent; it is a separate request from the model list so a stats failure costs the figure and
 * not the page.
 */
export const getUsageModelTotals = (projectId: string) =>
  apiFetch<UsageModelTotals>(`/api/projects/${encodeURIComponent(projectId)}/usage/model-totals`);

export const getUsage = (
  projectId: string,
  params: {
    from?: string;
    to?: string;
    /** Trailing-window bounds (ISO timestamps, together or not at all): refine the range down to instants; required for minute granularity. */
    fromTs?: string;
    toTs?: string;
    groupBy: UsageGroupBy;
    /** Time-series precision for the response's `series`; the server defaults to day. */
    granularity?: UsageGranularity;
    agentId?: string;
    /** Model filter is always a whole pair — both fields or neither; a model is never referenced by id alone. */
    provider?: string;
    modelId?: string;
  },
) =>
  apiFetch<UsageResponse>(`/api/projects/${encodeURIComponent(projectId)}/usage`, {
    query: {
      from: params.from,
      to: params.to,
      fromTs: params.fromTs,
      toTs: params.toTs,
      groupBy: params.groupBy,
      granularity: params.granularity,
      agentId: params.agentId,
      provider: params.provider,
      modelId: params.modelId,
      utcOffsetMinutes: viewerUtcOffsetMinutes(),
    },
  });

// Agent deletion & Workspace files --------------------------------------------------

export const deleteAgent = (projectId: string, agentId: string) =>
  apiFetch<void>(`/api/projects/${projectId}/agents/${agentId}`, { method: "DELETE" });

/** The open pull request this Session's Workspace is on, or `{ pullRequest: null }`. */
export const getWorkspacePullRequest = (sessionId: string) =>
  apiFetch<WorkspacePullRequestResponse>(`/api/sessions/${sessionId}/pull-request`);

export const listWorkspaceFiles = (sessionId: string, path: string) =>
  apiFetch<WorkspaceFilesResponse>(`/api/sessions/${sessionId}/files`, { query: { path } });

/** File content URL (inline preview / download=1 triggers download; usable directly in <a>/<img>/fetch). */
/**
 * File content URL (inline preview / download=1 triggers download; usable directly in
 * <a>/<img>/<iframe>/fetch).
 *
 * Routed like every other Session call, by hand: this is a URL, not a call, so it never
 * passes through the fetch wrapper that applies the rule (lib/session-machines.ts). Left
 * bare, every preview, image, PDF and download of a Session that lives on a machine asked
 * THIS server for a Session it does not have — and the workspace browser reports the
 * resulting failure as "preview not supported for this type", since a file it cannot read
 * is indistinguishable from one it cannot render.
 */
export const workspaceFileUrl = (sessionId: string, path: string, download = false): string =>
  apiUrl(
    `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,
    machineForSession(sessionId),
  );

/**
 * "Open in a new tab" for a Workspace html file: an App-origin link that mints a signed
 * token and 302s to the separate preview origin, where the page gets a real origin with
 * working storage, cookies and third-party embeds.
 *
 * A link (not a fetch + `window.open`) on purpose — opening a tab after an await trips
 * popup blockers, and a script-opened window keeps an `opener` handle back to the App,
 * which is precisely the reference the separate origin exists to deny. Use it with
 * `rel="noopener noreferrer"`.
 *
 * Falls back server-side to the sandboxed same-origin preview when the deployment has no
 * usable preview origin; `previewIsolated` from /api/me says so in advance.
 */
export const workspaceFilePreviewUrl = (sessionId: string, path: string): string =>
  `/api/sessions/${sessionId}/files/preview-redirect?path=${encodeURIComponent(path)}`;

/**
 * Opens the file's directory in the machine's own file manager, selecting the file where the
 * platform allows. Only the desktop shell's own window may ask: the server answers 404 when it
 * was not spawned by a shell and 403 `desktop_shell_only` for a browser session beside one,
 * since it cannot tell that browser from a remote one (see lib/account-menu.ts).
 */
export const revealWorkspaceFile = (sessionId: string, path: string) =>
  apiFetch<void>(`/api/sessions/${sessionId}/files/reveal`, { method: "POST", query: { path } });

/**
 * Writes a Workspace file whole. `ifVersion` is the marker a previous read returned in its
 * `ETag`: pass it and the write is refused with 409 `file_changed` unless the file is still
 * the one that was read (the editor's save); leave it out and the write creates or replaces
 * unconditionally (uploads, which read no version).
 *
 * Resolves to the version the write produced — the marker the next save of the same file
 * carries — or null from a server that does not say.
 */
export const uploadWorkspaceFile = (
  sessionId: string,
  path: string,
  dataBase64: string,
  ifVersion?: string,
): Promise<string | null> =>
  apiFetchWithMeta<void>(`/api/sessions/${sessionId}/files/content`, {
    method: "PUT",
    body: { dataBase64, ifVersion } satisfies FilesWriteRequest,
    query: { path },
  }).then((res) => res.etag);

/**
 * Creates one empty text file or one folder. Missing parent directories are made; anything
 * already at the path is refused with 409 `target_exists` and nothing is written.
 */
export const createWorkspaceEntry = (sessionId: string, body: FilesCreateRequest) =>
  apiFetch<void>(`/api/sessions/${sessionId}/files/create`, { method: "POST", body });

/**
 * Moves or renames a Workspace file or folder. `ifVersion` (see {@link uploadWorkspaceFile})
 * guards a file SOURCE: pass it and the move is refused with 409 `file_changed` unless the file
 * is still the one that was read. A folder moves whole and takes none. The destination has no
 * such marker — nothing read it — so an occupied destination is 409 `target_exists` rather than
 * an overwrite, and a folder cannot move into itself. `to`'s parent directory is created when it
 * is missing.
 */
export const moveWorkspaceFile = (sessionId: string, body: FilesMoveRequest) =>
  apiFetch<void>(`/api/sessions/${sessionId}/files/move`, { method: "POST", body });

/**
 * Deletes a Workspace file. `ifVersion` is the same marker a write carries: with it, a file
 * the Agent rewrote since the panel read it is refused with 409 `file_changed` instead of
 * being removed. Files only — a directory is a 400.
 */
export const deleteWorkspaceFile = (sessionId: string, path: string, ifVersion?: string) =>
  apiFetch<void>(`/api/sessions/${sessionId}/files/content`, {
    method: "DELETE",
    query: { path, ifVersion },
  });

/**
 * Searches the whole Workspace by entry name (case-insensitive substring), breadth-first from
 * the root so the shallowest matches come first. `truncated` says a cap stopped the walk: the
 * hits are then the most relevant ones rather than all of them. An empty query is a 400 — the
 * caller decides what an empty search box shows, and it is never "every file".
 */
export const searchWorkspaceFiles = (sessionId: string, q: string) =>
  apiFetch<WorkspaceSearchResponse>(`/api/sessions/${sessionId}/files/search`, { query: { q } });

// Workspace files by directory ----------------------------------------------------------------

/**
 * A directory the Files panel addresses by its absolute path rather than through a Session: the
 * new-chat draft's chosen folder and a sidebar Workspace group, where no Session exists yet.
 * Access is the Project's; the directory must exist. `machineId` is the machine it is on (null:
 * this server) — a path names a directory only together with it.
 */
export interface WorkspaceDir {
  projectId: string;
  workspace: string;
  machineId: string | null;
}

const workspaceDirBase = (dir: WorkspaceDir): string =>
  `/api/projects/${encodeURIComponent(dir.projectId)}/workspace-files`;

export const listWorkspaceDirFiles = (dir: WorkspaceDir, path: string) =>
  apiFetch<WorkspaceFilesResponse>(workspaceDirBase(dir), {
    query: { workspace: dir.workspace, path },
    server: dir.machineId,
  });

/** File content URL, as {@link workspaceFileUrl}; the machine's proxy prefix rides in the URL itself. */
export const workspaceDirFileUrl = (dir: WorkspaceDir, path: string, download = false): string =>
  apiUrl(
    `${workspaceDirBase(dir)}/content?workspace=${encodeURIComponent(dir.workspace)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,
    dir.machineId,
  );

/**
 * "Open in a new tab" for an HTML file of a directory: the same-origin sandboxed preview, since
 * the separate preview origin's tokens name a Session.
 */
export const workspaceDirPreviewUrl = (dir: WorkspaceDir, path: string): string =>
  apiUrl(
    `${workspaceDirBase(dir)}/content?workspace=${encodeURIComponent(dir.workspace)}&path=${encodeURIComponent(path)}&preview=1`,
    dir.machineId,
  );

/** As {@link uploadWorkspaceFile}: resolves to the version written, or null when the server does not say. */
export const writeWorkspaceDirFile = (
  dir: WorkspaceDir,
  path: string,
  dataBase64: string,
  ifVersion?: string,
): Promise<string | null> =>
  apiFetchWithMeta<void>(`${workspaceDirBase(dir)}/content`, {
    method: "PUT",
    body: { dataBase64, ifVersion } satisfies FilesWriteRequest,
    query: { workspace: dir.workspace, path },
    server: dir.machineId,
  }).then((res) => res.etag);

export const createWorkspaceDirEntry = (dir: WorkspaceDir, body: FilesCreateRequest) =>
  apiFetch<void>(`${workspaceDirBase(dir)}/create`, {
    method: "POST",
    body,
    query: { workspace: dir.workspace },
    server: dir.machineId,
  });

export const moveWorkspaceDirFile = (dir: WorkspaceDir, body: FilesMoveRequest) =>
  apiFetch<void>(`${workspaceDirBase(dir)}/move`, {
    method: "POST",
    body,
    query: { workspace: dir.workspace },
    server: dir.machineId,
  });

export const deleteWorkspaceDirFile = (dir: WorkspaceDir, path: string, ifVersion?: string) =>
  apiFetch<void>(`${workspaceDirBase(dir)}/content`, {
    method: "DELETE",
    query: { workspace: dir.workspace, path, ifVersion },
    server: dir.machineId,
  });

export const searchWorkspaceDirFiles = (dir: WorkspaceDir, q: string) =>
  apiFetch<WorkspaceSearchResponse>(`${workspaceDirBase(dir)}/search`, {
    query: { workspace: dir.workspace, q },
    server: dir.machineId,
  });

export const revealWorkspaceDirFile = (dir: WorkspaceDir, path: string) =>
  apiFetch<void>(`${workspaceDirBase(dir)}/reveal`, {
    method: "POST",
    query: { workspace: dir.workspace, path },
    server: dir.machineId,
  });

/** Batch file-existence check (message file cards): both out-of-bounds and missing paths simply don't appear in `existing`; always returns 200. */
export const statSessionFiles = (sessionId: string, paths: string[]) =>
  apiFetch<FilesStatResponse>(`/api/sessions/${sessionId}/files/stat`, {
    method: "POST",
    body: { paths } satisfies FilesStatRequest,
  });

// Scheduled tasks ----------------------------------------------------------------------

export const listSchedules = (projectId: string, agentId: string) =>
  apiFetch<SchedulesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
  );

/** Every agent's scheduled tasks in the Project, each stamped with its agent: what the session list's marks read. */
export const listProjectSchedules = (projectId: string) =>
  apiFetch<ProjectSchedulesResponse>(`/api/projects/${encodeURIComponent(projectId)}/schedules`);

export const createSchedule = (
  projectId: string,
  agentId: string,
  body: ScheduleUpsertRequest & { name: string },
) =>
  apiFetch<ScheduleItem>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
    { method: "POST", body },
  );

export const updateSchedule = (
  projectId: string,
  agentId: string,
  name: string,
  body: ScheduleUpsertRequest,
) =>
  apiFetch<ScheduleItem>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/schedules/${encodeURIComponent(name)}`,
    { method: "PUT", body },
  );

export const deleteSchedule = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/schedules/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

// Plugin library, and an Agent's installed skills and hook packages ----------------------------

/** Plugin library (available to any logged-in user): groups, each plugin's manifest and the metadata of its skills — never SKILL.md bodies or hook scripts. */
export const getPluginLibrary = () => apiFetch<PluginLibraryResponse>("/api/plugins");

/** Everything one library plugin ships as text keyed by path (skills' files, hook scripts), for the plugin detail view's file browser. */
export const getPluginFiles = (plugin: string) =>
  apiFetch<PluginFilesResponse>(`/api/plugins/${encodeURIComponent(plugin)}/files`);

/**
 * Installs whole library plugins — each one's skills and hook package; an already-installed
 * plugin is overwritten with the library content (i.e. updated). 201 returns the Agent's
 * refreshed installed lists.
 */
export const installAgentPlugins = (projectId: string, agentId: string, names: string[]) =>
  apiFetch<AgentPluginsInstallResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/plugins`,
    { method: "POST", body: { names } satisfies PluginInstallRequest },
  );

/** Plugin index (available to any logged-in user): the merged index of every configured registry. */
export const getPluginIndex = () => apiFetch<PluginIndexEntry[]>("/api/plugins/registry");

/** Languages plugins contributed; the grammars themselves are fetched by the highlighter. */
export const getLanguages = () => apiFetch<LanguageIndexResponse>("/api/languages");

export const getPluginReadme = (name: string) =>
  apiFetch<PluginReadmeResponse>(`/api/plugins/registry/readme?name=${encodeURIComponent(name)}`);

/** Every content the index lists under one name, for its detail page. */
export const getPluginContents = (name: string) =>
  apiFetch<PluginContentsResponse>(
    `/api/plugins/registry/contents?name=${encodeURIComponent(name)}`,
  );

export const getAgentSkills = (projectId: string, agentId: string) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills`,
  );

export const getAgentHooks = (projectId: string, agentId: string) =>
  apiFetch<AgentHooksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/hooks`,
  );

/** Uninstalls one hook package (deletes agent_state/hooks/<name>/ whole); 204, 404 not_found when it is not installed. */
export const uninstallAgentHook = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/hooks/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

/** Installs one hook package from an uploaded zip (base64); 409 hook_exists unless overwrite; 201 returns the latest installed list. */
export const installAgentHookArchive = (
  projectId: string,
  agentId: string,
  body: HookArchiveInstallRequest,
) =>
  apiFetch<AgentHooksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/hooks/archive`,
    { method: "POST", body },
  );

/** Zip download URL for one installed hook package (server sets Content-Disposition attachment); the export round-trips through installAgentHookArchive. */
export const agentHookArchiveUrl = (projectId: string, agentId: string, name: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/hooks/${encodeURIComponent(name)}/archive`;

/** Installs one skill from an uploaded zip (base64); 409 skill_exists unless overwrite; 201 returns the latest installed list. */
export const installAgentSkillArchive = (
  projectId: string,
  agentId: string,
  body: SkillArchiveInstallRequest,
) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/skills/archive`,
    { method: "POST", body },
  );

/** Zip download URL for one installed skill (server sets Content-Disposition attachment); the export round-trips through installAgentSkillArchive. */
export const agentSkillArchiveUrl = (projectId: string, agentId: string, name: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/skills/${encodeURIComponent(name)}/archive`;

export const removeAgentSkill = (projectId: string, agentId: string, name: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

// Benchmarks (scores, manual creation and deletion) -------------------------------------------
// Benchmarks sit at the Project level, beside agents rather than under one: a Benchmark can
// evaluate many agents, so no agent id travels in these paths.

/**
 * A Project's Benchmarks as ONE server holds them. A `benchmarks/` directory is written on
 * whichever machine created or evaluated the Benchmark, so the Evaluation Center asks this
 * server and each machine it holds, then merges the answers (lib/benchmark-merge.ts). The path
 * is not Session-scoped, so nothing about it can be routed from an id — the machine is passed.
 */
export const listBenchmarks = (projectId: string, machineId?: string | null) =>
  apiFetch<BenchmarksResponse>(`/api/projects/${encodeURIComponent(projectId)}/benchmarks`, {
    server: machineId ?? null,
  });

export const listBenchmarkCases = (
  projectId: string,
  benchmarkId: string,
  machineId?: string | null,
) =>
  apiFetch<BenchmarkCasesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/benchmarks/${encodeURIComponent(benchmarkId)}` +
      `/cases`,
    { server: machineId ?? null },
  );

/** Creates a Benchmark by hand (owner only); the server writes the on-disk layout. 409 `benchmark_exists` on a taken id. */
export const createBenchmark = (projectId: string, body: BenchmarkCreateRequest) =>
  apiFetch<BenchmarkCreateResponse>(`/api/projects/${encodeURIComponent(projectId)}/benchmarks`, {
    method: "POST",
    body,
  });

/** Removes a Benchmark directory whole — cases, config and scoreboard (owner only; 204). */
export const deleteBenchmark = (projectId: string, benchmarkId: string) =>
  apiFetch<void>(
    `/api/projects/${encodeURIComponent(projectId)}/benchmarks/${encodeURIComponent(benchmarkId)}`,
    { method: "DELETE" },
  );

const benchmarkCaseFilesPath = (
  projectId: string,
  benchmarkId: string,
  caseId: string,
  material: CaseMaterial,
) =>
  `/api/projects/${encodeURIComponent(projectId)}/benchmarks/${encodeURIComponent(benchmarkId)}` +
  `/cases/${encodeURIComponent(caseId)}` +
  `${material === "rubric" ? "/rubric" : ""}/files`;

export const listBenchmarkCaseFiles = (
  projectId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
  machineId?: string | null,
) =>
  apiFetch<WorkspaceFilesResponse>(
    benchmarkCaseFilesPath(projectId, benchmarkId, caseId, material),
    { query: { path }, server: machineId ?? null },
  );

export const benchmarkCaseFileUrl = (
  projectId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
  options?: { download?: boolean; preview?: boolean; machineId?: string | null },
): string => {
  const base = `${benchmarkCaseFilesPath(
    projectId,
    benchmarkId,
    caseId,
    material,
  )}/content?path=${encodeURIComponent(path)}`;
  return (
    // A browser-followed URL (an <img> src, a download link), so the proxy prefix has to be
    // IN it — there is no request here for a routing rule to act on.
    apiUrl(base, options?.machineId ?? null) +
    (options?.download ? "&download=1" : "") +
    (options?.preview && !options.download ? "&preview=1" : "")
  );
};

// Agent State snapshot export / import ------------------------------------------------------

/** Snapshot bundle (tar.gz) download URL: the server sets Content-Disposition attachment, usable directly in <a download>. */
export const agentExportUrl = (projectId: string, agentId: string): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/export`;

export const importAgent = (projectId: string, agentId: string, body: AgentImportRequest) =>
  apiFetch<AgentImportResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/import`,
    { method: "POST", body },
  );

// Machines (admin only) ----------------------------------------------------------------

/**
 * The server's ssh hosts, the version it would install, and the running or last install
 * job. The Machines page polls this while a job runs — the progress lines live on the job,
 * not on the event channel, because they belong to the one page that is waiting for them.
 */
export const getMachines = (projectId: string) =>
  apiFetch<MachinesResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines`);

/**
 * Re-probes the installed machines' servers (one ssh round trip each, server-side) and
 * answers the refreshed list. A POST because it spends those round trips — a GET that
 * spawns processes is one a prefetch or a proxy may fire on its own.
 */
export const probeMachines = (projectId: string) =>
  apiFetch<MachinesResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines/probe`, {
    method: "POST",
    body: {},
  });

/**
 * Starts an install on a machine and gives it to this Project; answers the list with the
 * running job. `replaceProgram` answers a job that came back asking for it — installing the
 * program over there even though its version already matches, and restarting it.
 */
/**
 * Brings machines into use — install or update if needed, start, connect, sync — as one
 * queued batch (202). `refused` names the ones that could be turned down without any ssh.
 * `replaceProgram` answers a job that came back asking for it.
 */
export const useMachines = (projectId: string, machineIds: string[], replaceProgram = false) =>
  apiFetch<MachinesUseResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines/use`, {
    method: "POST",
    body: replaceProgram
      ? { machines: machineIds, replaceProgram: true }
      : { machines: machineIds },
  });

/** Appends a host block to this server's ~/.ssh/config; answers the machines list, which now names it (201). */
export const addSshHost = (projectId: string, host: SshHostRequest) =>
  apiFetch<MachinesResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines/ssh-hosts`, {
    method: "POST",
    body: host,
  });

/** A host's ssh block read back, and whether this app wrote it (only then may it be rewritten). */
export const getSshHost = (projectId: string, alias: string) =>
  apiFetch<SshHostResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/ssh-hosts/${encodeURIComponent(alias)}`,
  );

/** Rewrites a block this app wrote; answers the machines list. */
export const updateSshHost = (
  projectId: string,
  alias: string,
  host: Omit<SshHostRequest, "alias">,
) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/ssh-hosts/${encodeURIComponent(alias)}`,
    { method: "PUT", body: host },
  );

/** Lets machines go: connections dropped, Project membership released; the install stays. */
export const stopUsingMachines = (projectId: string, machineIds: string[]) =>
  apiFetch<MachinesResponse>(`/api/projects/${encodeURIComponent(projectId)}/machines/stop-using`, {
    method: "POST",
    body: { machines: machineIds },
  });

// Port forwarding (admin only) ---------------------------------------------------------
//
// Always THIS server's: a forward is a listener on the server the browser is talking to,
// reaching into a machine — never a request for that machine's own server to answer.

/** A Workspace's forwards (`workspace` given) or every forward of a machine, with what is known of each. */
export const listPortForwards = (machineId: string, workspace?: string) =>
  apiFetch<PortForwardsResponse>(
    `/api/port-forwards?machine=${encodeURIComponent(machineId)}` +
      (workspace === undefined ? "" : `&workspace=${encodeURIComponent(workspace)}`),
  );

export const createPortForward = (forward: PortForwardCreateRequest) =>
  apiFetch<PortForwardInfo>("/api/port-forwards", { method: "POST", body: forward });

export const deletePortForward = (id: string) =>
  apiFetch<void>(`/api/port-forwards/${encodeURIComponent(id)}`, { method: "DELETE" });

export const installOnMachine = (projectId: string, machineId: string, replaceProgram = false) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/install`,
    { method: "POST", body: replaceProgram ? { replaceProgram: true } : {} },
  );

/** Brings that machine's server up and holds a tunnel to it (202, long-running). */
export const connectMachine = (projectId: string, machineId: string) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/connect`,
    { method: "POST", body: {} },
  );

/** Drops a machine from this Project. The install stays — another Project may be using it. */
export const releaseMachine = (projectId: string, machineId: string) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/release`,
    { method: "POST", body: {} },
  );

/** Drops the tunnel; the remote server keeps running. */
/** Restarts that machine's server so what runs there matches what is on its disk. */
export const restartMachine = (projectId: string, machineId: string) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/restart`,
    { method: "POST", body: {} },
  );

export const disconnectMachine = (projectId: string, machineId: string) =>
  apiFetch<MachinesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/disconnect`,
    { method: "POST", body: {} },
  );

// Version & self-update ----------------------------------------------------------------

export const getVersion = () => apiFetch<VersionResponse>("/api/version");
/** The harness versions this data root has committed, newest first, and the current one. */
export const getVersionHistory = () => apiFetch<VersionHistoryResponse>("/api/version/history");
/** Push a kept version back (admin); the swap follows the 202. */
export const rollbackVersion = (id: string) =>
  apiFetch<VersionRollbackResponse>("/api/version/history/rollback", {
    method: "POST",
    body: { id },
  });
/** A recorded interface table by hash — the module tree a version was built from. */
export const getVersionIfacesTable = (hash: string) =>
  apiFetch<unknown>(`/api/version/history/ifaces/${encodeURIComponent(hash)}`);
/** What changed between two stored interface tables; either hash may be "none". */
export const getVersionHistoryDiff = (from: string, to: string) =>
  apiFetch<VersionHistoryDiffResponse>(
    `/api/version/history/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

/** `force` (the manual "check for updates" action) bypasses the server's TTL cache. */
export const checkUpdate = (force = false) =>
  apiFetch<UpdateCheckResponse>(`/api/version/update-check${force ? "?force=1" : ""}`);

/** Admin only: the self-update job's status — polled while it runs. */
export const getUpdateJob = () => apiFetch<UpdateJobStatus>("/api/version/update");

/** Admin only: starts the self-update job (`penguin update` on the server host, in the background) and answers with its status. */
export const startUpdateJob = () =>
  apiFetch<UpdateJobStatus>("/api/version/update", { method: "POST", body: {} });

/** Admin only: asks the supervised server process to restart into the installed release. */
export const restartServer = () =>
  apiFetch<RestartResponse>("/api/version/restart", { method: "POST", body: {} });

// Desktop client update (desktop-shell sessions only) ----------------------------------

export const getDesktopUpdate = () => apiFetch<DesktopUpdateStatusResponse>("/api/desktop/update");

/** The host commands this server's process offers the command palette; empty under a plain server. Admin only. */
export const getHostCommands = () => apiFetch<HostCommandsResponse>("/api/command");

/** Runs one host command; the host answers with its own UI (a dialog, the updater). The id is the host's word — this build need not know it. */
export const runHostCommand = (command: string) =>
  apiFetch<void>(`/api/command/${encodeURIComponent(command)}`, { method: "POST", body: {} });

export const desktopUpdateCheck = () =>
  apiFetch<void>("/api/desktop/update/check", { method: "POST", body: {} });

export const desktopUpdateDownload = () =>
  apiFetch<void>("/api/desktop/update/download", { method: "POST", body: {} });

export const desktopUpdateInstall = () =>
  apiFetch<void>("/api/desktop/update/install", { method: "POST", body: {} });

// ---------------------------------------------------------------------------
// Company mode: organizations (one wrapper per route of routes/organizations.ts)
// ---------------------------------------------------------------------------

/** Base path of one Project's organizations, or of one organization when `orgId` is given. */
const orgBase = (projectId: string, orgId?: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/organizations${
    orgId === undefined ? "" : `/${encodeURIComponent(orgId)}`
  }`;

/**
 * The Project's organizations, from this server. One whose shared workspace is on a machine
 * RUNS there and says so (`machineId`); that is remembered (lib/org-machines.ts), which is what
 * routes every organization-scoped call below without any of them naming a machine.
 */
export const listOrganizations = (projectId: string) =>
  apiFetch<OrganizationsResponse>(orgBase(projectId));

/**
 * Creates the organization in this Project. With `workspaceMachine` it is created ON that
 * machine — its Agents and Sessions are there — and mirrored here; where it runs (and so where
 * its CEO desk Session is, which is what opens next) is remembered before the caller navigates.
 */
export const createOrganization = async (projectId: string, body: OrganizationCreateRequest) => {
  const detail = await apiFetch<OrganizationDetail>(orgBase(projectId), { method: "POST", body });
  rememberOrgMachine(projectId, detail.orgId, detail.machineId ?? null);
  // This answer came from here, not through the machine, so the Sessions it names (the CEO
  // desk) are recorded by hand — the client only does it for answers a machine gave.
  rememberSessionsIn(detail, detail.machineId ?? null);
  return detail;
};

/**
 * A semantic id for a display name — a Project's, an Agent's, a Benchmark's, an organization's or
 * a channel's, by `kind` — from the default model of the Project in the path, with an ASCII
 * fallback and a dated placeholder behind it. `machineId` asks the server the thing will live on
 * (an organization's machine); null is this one.
 */
export const suggestSemanticId = (
  projectId: string,
  body: SemanticIdSuggestRequest,
  machineId: string | null = null,
) =>
  apiFetch<SemanticIdSuggestResponse>(`/api/projects/${encodeURIComponent(projectId)}/suggest-id`, {
    method: "POST",
    body,
    server: machineId,
  });

export const getOrganization = (projectId: string, orgId: string) =>
  apiFetch<OrganizationDetail>(orgBase(projectId, orgId));

export const patchOrganization = (
  projectId: string,
  orgId: string,
  body: OrganizationPatchRequest,
) => apiFetch<OrganizationSettings>(orgBase(projectId, orgId), { method: "PATCH", body });

/**
 * Owner only. The organization itself goes — to the Project's trash, restorable by hand; its
 * employees' Agents and its desk and ticket Sessions are left as they are.
 */
export const deleteOrganization = (projectId: string, orgId: string) =>
  apiFetch<void>(orgBase(projectId, orgId), { method: "DELETE" });

export const getOrgChart = (projectId: string, orgId: string) =>
  apiFetch<OrgChartResponse>(`${orgBase(projectId, orgId)}/chart`);

/**
 * An organization's roadmaps, from the company-roadmaps plugin's own route (present only while
 * that plugin is, which is when the roadmaps page is contributed). The shape is the plugin's;
 * only the fields the sidebar and the channel page read are typed (features/company/roadmaps.ts).
 */
export const listOrgRoadmaps = (
  projectId: string,
  orgId: string,
  filter: { channel?: string; status?: string } = {},
) => {
  const q = new URLSearchParams();
  if (filter.channel !== undefined) q.set("channel", filter.channel);
  if (filter.status !== undefined) q.set("status", filter.status);
  const qs = q.toString();
  return apiFetch<{ roadmaps: OrgRoadmapItem[] }>(
    `${orgBase(projectId, orgId)}/roadmaps${qs === "" ? "" : `?${qs}`}`,
  );
};

/** What the web app reads of one roadmap (the plugin answers more). */
export interface OrgRoadmapItem {
  number: number;
  name: string;
  status: string;
  channelId: string | null;
  createdAt: string;
  events?: ReadonlyArray<{ at: string }>;
}

/** One item of a roadmap's draft: a proposal it delegates, or a roadmap it derives. */
export type OrgRoadmapDraftItem =
  | {
      key: string;
      kind: "proposal";
      title: string;
      brief: string;
      owner: string;
      /** An existing proposal the roadmap took in as it is (adopted). */
      proposal?: number;
    }
  | { key: string; kind: "roadmap"; title: string; brief: string; employees: string[] };

/** Who gave one of a proposal item's approvals, and when. */
export interface OrgRoadmapApproval {
  by: string;
  at: string;
}

/** What an establishment did with one item (the plugin's delegation record, as far as the room's column reads it). */
export interface OrgRoadmapDelegation {
  key: string;
  owner: string;
  /** The derived roadmap's number (a roadmap item). */
  child: number | null;
  /** The proposal linked back (a proposal item). */
  proposal?: number;
  /** A brief waits for its two approvals; absent on lines written before that gate, which read as delegated. */
  stage?: "brief" | "delegated";
  /** The approvals given, by role (`moderator` and `member` unless the organization binds other roles). */
  approvals?: Record<string, OrgRoadmapApproval>;
}

/** One roadmap as the room's column reads it: the list row plus its moderator, body and items. */
export interface OrgRoadmapDetail extends OrgRoadmapItem {
  moderator: string | null;
  body: string;
  items: OrgRoadmapDraftItem[];
  delegations: Record<string, OrgRoadmapDelegation>;
}

export const getOrgRoadmap = (projectId: string, orgId: string, number: number) =>
  apiFetch<OrgRoadmapDetail>(`${orgBase(projectId, orgId)}/roadmaps/${number}`);

/** An approval of one proposal item's brief, in the role the server finds for the caller (the `roadmap.item.approve` Action). */
export const approveOrgRoadmapItem = (
  projectId: string,
  orgId: string,
  number: number,
  key: string,
) =>
  actionResult<{ roadmap: OrgRoadmapDetail; hints: string[] }>(
    projectId,
    orgId,
    "roadmap.item.approve",
    `item:${number}/${key}`,
  );

export const hireOrgEmployee = (projectId: string, orgId: string, body: OrgHireRequest) =>
  apiFetch<OrgEmployeeItem>(`${orgBase(projectId, orgId)}/employees`, { method: "POST", body });

/** Where an employee's avatar is served from; `rev` (its `avatarRev`) makes the URL the image's own, so it is cached for good. */
export const orgEmployeeAvatarUrl = (
  projectId: string,
  orgId: string,
  agentId: string,
  rev: string,
): string =>
  `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}/avatar?rev=${encodeURIComponent(rev)}`;

/** Sets the employee's avatar from a data URL (png, jpeg or webp); `null` removes it. */
export const putOrgEmployeeAvatar = (
  projectId: string,
  orgId: string,
  agentId: string,
  avatar: string | null,
) =>
  apiFetch<OrgEmployeeItem>(
    `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}/avatar`,
    { method: "PUT", body: { avatar } },
  );

export const patchOrgEmployee = (
  projectId: string,
  orgId: string,
  agentId: string,
  body: OrgEmployeePatchRequest,
) =>
  apiFetch<OrgEmployeeItem>(
    `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}`,
    { method: "PATCH", body },
  );

export const leaveOrganization = (projectId: string, orgId: string, agentId: string) =>
  apiFetch<void>(`${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });

/** The employee's desk session, opened on demand (GET creates it when there is none). */
export const getOrgDesk = (projectId: string, orgId: string, agentId: string) =>
  apiFetch<OrgDeskResponse>(
    `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}/desk`,
  );

/** A fresh desk session for the employee (the old one stays as an ordinary Session). */
export const renewOrgDesk = (projectId: string, orgId: string, agentId: string) =>
  apiFetch<OrgDeskResponse>(
    `${orgBase(projectId, orgId)}/employees/${encodeURIComponent(agentId)}/desk`,
    { method: "POST", body: {} },
  );

export const getOrgHandbook = (projectId: string, orgId: string) =>
  apiFetch<OrgHandbookResponse>(`${orgBase(projectId, orgId)}/handbook`);

export const putOrgHandbook = (projectId: string, orgId: string, content: string) =>
  apiFetch<OrgHandbookResponse>(`${orgBase(projectId, orgId)}/handbook`, {
    method: "PUT",
    body: { content },
  });

/** A handbook file's URL: the path is relative to `handbook/`, so each segment is encoded and the `/` between them kept. */
const handbookFileUrl = (projectId: string, orgId: string, path: string) =>
  `${orgBase(projectId, orgId)}/handbook/files/${path.split("/").map(encodeURIComponent).join("/")}`;

export const listOrgHandbookFiles = (projectId: string, orgId: string) =>
  apiFetch<OrgHandbookFilesResponse>(`${orgBase(projectId, orgId)}/handbook/files`);

export const getOrgHandbookFile = (projectId: string, orgId: string, path: string) =>
  apiFetch<OrgHandbookFileResponse>(handbookFileUrl(projectId, orgId, path));

export const putOrgHandbookFile = (
  projectId: string,
  orgId: string,
  path: string,
  content: string,
) =>
  apiFetch<OrgHandbookFileResponse>(handbookFileUrl(projectId, orgId, path), {
    method: "PUT",
    body: { content },
  });

export const deleteOrgHandbookFile = (projectId: string, orgId: string, path: string) =>
  apiFetch<void>(handbookFileUrl(projectId, orgId, path), { method: "DELETE" });

export const listOrgCalendar = (projectId: string, orgId: string) =>
  apiFetch<OrgCalendarResponse>(`${orgBase(projectId, orgId)}/calendar`);

export const createOrgCalendarEvent = (
  projectId: string,
  orgId: string,
  body: OrgCalendarUpsertRequest & { agentId: string; name: string },
) =>
  apiFetch<OrgCalendarWriteResponse>(`${orgBase(projectId, orgId)}/calendar`, {
    method: "POST",
    body,
  });

export const updateOrgCalendarEvent = (
  projectId: string,
  orgId: string,
  agentId: string,
  name: string,
  body: OrgCalendarUpsertRequest,
) =>
  apiFetch<OrgCalendarWriteResponse>(
    `${orgBase(projectId, orgId)}/calendar/${encodeURIComponent(agentId)}/${encodeURIComponent(name)}`,
    { method: "PUT", body },
  );

export const deleteOrgCalendarEvent = (
  projectId: string,
  orgId: string,
  agentId: string,
  name: string,
) =>
  apiFetch<void>(
    `${orgBase(projectId, orgId)}/calendar/${encodeURIComponent(agentId)}/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );

export const listOrgTickets = (projectId: string, orgId: string) =>
  apiFetch<OrgTicketsResponse>(`${orgBase(projectId, orgId)}/tickets`);

export const getOrgTicket = (projectId: string, orgId: string, ticketId: string) =>
  apiFetch<OrgTicketDetail>(`${orgBase(projectId, orgId)}/tickets/${encodeURIComponent(ticketId)}`);

export const createOrgTicket = (projectId: string, orgId: string, body: OrgTicketCreateRequest) =>
  apiFetch<OrgTicketDetail>(`${orgBase(projectId, orgId)}/tickets`, { method: "POST", body });

export const updateOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketUpdateRequest,
) =>
  apiFetch<OrgTicketDetail>(
    `${orgBase(projectId, orgId)}/tickets/${encodeURIComponent(ticketId)}`,
    { method: "PUT", body },
  );

/** `…/tickets/:ticketId/<action>` POST helper shared by the six ticket actions. */
const ticketAction = <T>(
  projectId: string,
  orgId: string,
  ticketId: string,
  action: string,
  body: unknown,
) =>
  apiFetch<T>(`${orgBase(projectId, orgId)}/tickets/${encodeURIComponent(ticketId)}/${action}`, {
    method: "POST",
    body,
  });

export const moveOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketMoveRequest,
) => ticketAction<OrgTicketDetail>(projectId, orgId, ticketId, "move", body);

export const blockOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketBlockRequest,
) => ticketAction<OrgTicketDetail>(projectId, orgId, ticketId, "block", body);

export const unblockOrgTicket = (projectId: string, orgId: string, ticketId: string) =>
  ticketAction<OrgTicketDetail>(projectId, orgId, ticketId, "unblock", {});

export const progressOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketProgressRequest,
) => ticketAction<OrgTicketDetail>(projectId, orgId, ticketId, "progress", body);

export const startOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketStartRequest = {},
) => ticketAction<OrgTicketStartResponse>(projectId, orgId, ticketId, "start", body);

export const attachOrgTicket = (
  projectId: string,
  orgId: string,
  ticketId: string,
  body: OrgTicketAttachRequest,
) => ticketAction<OrgTicketDetail>(projectId, orgId, ticketId, "attach", body);

const channelBase = (projectId: string, orgId: string, channelId: string) =>
  `${orgBase(projectId, orgId)}/channels/${encodeURIComponent(channelId)}`;

/** The organization's channels: the all-hands one first, then by name. */
export const listOrgChannels = (projectId: string, orgId: string) =>
  apiFetch<OrgChannelsResponse>(`${orgBase(projectId, orgId)}/channels`);

export const createOrgChannel = (projectId: string, orgId: string, body: OrgChannelCreateRequest) =>
  apiFetch<OrgChannelItem>(`${orgBase(projectId, orgId)}/channels`, { method: "POST", body });

export const getOrgChannel = (projectId: string, orgId: string, channelId: string) =>
  apiFetch<OrgChannelDetail>(channelBase(projectId, orgId, channelId));

export const patchOrgChannel = (
  projectId: string,
  orgId: string,
  channelId: string,
  body: OrgChannelPatchRequest,
) => apiFetch<OrgChannelItem>(channelBase(projectId, orgId, channelId), { method: "PATCH", body });

export const addOrgChannelMember = (
  projectId: string,
  orgId: string,
  channelId: string,
  body: OrgChannelMemberRequest,
) =>
  apiFetch<OrgChannelDetail>(`${channelBase(projectId, orgId, channelId)}/members`, {
    method: "POST",
    body,
  });

/** Removes a member; `principal` is the literal `agent:<id>` / `user:<id>`, encoded into the path. */
export const removeOrgChannelMember = (
  projectId: string,
  orgId: string,
  channelId: string,
  principal: string,
) =>
  apiFetch<void>(
    `${channelBase(projectId, orgId, channelId)}/members/${encodeURIComponent(principal)}`,
    { method: "DELETE" },
  );

/** One day of a channel (today in the organization's timezone when `date` is omitted). */
export const getOrgChannelMessages = (
  projectId: string,
  orgId: string,
  channelId: string,
  date?: string,
) =>
  apiFetch<OrgChannelMessagesResponse>(`${channelBase(projectId, orgId, channelId)}/messages`, {
    query: { date },
  });

export const sendOrgChannelMessage = (
  projectId: string,
  orgId: string,
  channelId: string,
  body: OrgChannelMessageSendRequest,
) =>
  apiFetch<OrgChannelMessage>(`${channelBase(projectId, orgId, channelId)}/messages`, {
    method: "POST",
    body,
  });

export const readOrgChannel = (
  projectId: string,
  orgId: string,
  channelId: string,
  body: OrgChannelReadRequest,
) => apiFetch<void>(`${channelBase(projectId, orgId, channelId)}/read`, { method: "POST", body });

/** Budget and spend for one `yyyy-mm` period (the current one when omitted). */
export const getOrgFinance = (projectId: string, orgId: string, period?: string) =>
  apiFetch<OrgFinanceResponse>(`${orgBase(projectId, orgId)}/finance`, {
    query: { period },
  });

export const getOrgSessions = (projectId: string, orgId: string) =>
  apiFetch<OrgSessionsResponse>(`${orgBase(projectId, orgId)}/sessions`);
// Desktop tray icon (desktop-shell sessions only) --------------------------------------

/** What the shell last pushed; `status` is null until that first push, which reads as on. */
export const getDesktopTray = () => apiFetch<DesktopTrayStatusResponse>("/api/desktop/tray");

/**
 * Relays a tray change to the shell, which applies it and pushes the new state back.
 *
 * A patch rather than a snapshot: Settings › Appearance writes the switch, and the locale
 * provider writes the UI language whenever it changes, and neither knows the other's value.
 */
export const setDesktopTray = (patch: DesktopTrayPatch) =>
  apiFetch<void>("/api/desktop/tray", { method: "PUT", body: patch });

/** Has the desktop shell open System Settings at a Privacy & Security pane (macOS). */
export const openPrivacySettings = (pane: DesktopPrivacyPane) =>
  apiFetch<void>("/api/desktop/privacy-settings", {
    method: "POST",
    body: { pane },
    server: null,
  });

/** Has the desktop shell open another window of the app (the command palette's New Window). */
export const openDesktopWindow = () =>
  apiFetch<void>("/api/desktop/window", { method: "POST", body: {}, server: null });

// ---- Workflows (an Agent's own extension packages, served as tabs beside the chat) ----
const workflowsBase = (projectId: string, agentId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/workflows`;
/**
 * `machineId` on each of these: an Agent's workflows live where its state directory does, so
 * the workflows of an Agent that only a machine has are asked of THAT machine's server.
 */
export const getWorkflows = (projectId: string, agentId: string, machineId: string | null = null) =>
  apiFetch<{ workflows: WorkflowInfo[] }>(workflowsBase(projectId, agentId), {
    server: machineId,
  });
/** Re-import the folder now (the server also does this whenever a file changes). */
export const reloadWorkflow = (
  projectId: string,
  agentId: string,
  workflowId: string,
  machineId: string | null = null,
) =>
  apiFetch<{ workflow: WorkflowInfo }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/reload`,
    { method: "POST", body: {}, server: machineId },
  );
export const getWorkflowHistory = (
  projectId: string,
  agentId: string,
  workflowId: string,
  machineId: string | null = null,
) =>
  apiFetch<{ versions: WorkflowVersion[] }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/history`,
    { server: machineId },
  );
/** Restore a recorded version's files (state.json is kept) and reload. */
export const rollbackWorkflow = (
  projectId: string,
  agentId: string,
  workflowId: string,
  revision: string,
  machineId: string | null = null,
) =>
  apiFetch<{ workflow: WorkflowInfo }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/rollback`,
    { method: "POST", body: { revision }, server: machineId },
  );
/** Delete the folder and the versions recorded for it; nothing of the workflow is kept. */
export const removeWorkflow = (
  projectId: string,
  agentId: string,
  workflowId: string,
  machineId: string | null = null,
) =>
  apiFetch<void>(`${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
    server: machineId,
  });
// ---- Agent packages (an Agent's definition to a gist and back) ----
export const getAgentPackage = (projectId: string, agentId: string) =>
  apiFetch<AgentPackageResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/package`,
  );
/** Owner only; `gistId` updates that gist instead of creating one. */
export const publishAgentPackage = (
  projectId: string,
  agentId: string,
  body: { gistId?: string; public: boolean },
) =>
  apiFetch<AgentPackagePublishResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/package/publish`,
    { method: "POST", body },
  );
/**
 * Reads and validates a source as a package; writes nothing. A source is a gist link or id,
 * `npm:<name>[@version]`, a GitHub repository or release URL, `github:o/r[#ref]`, a git URL,
 * or an http(s) URL of a tarball; `kind` forces one reading.
 */
export const previewAgentPackage = (source: string, kind?: AgentPackageSourceKind) =>
  apiFetch<AgentPackagePreviewResponse>("/api/agent-packages/preview", {
    method: "POST",
    body: { source, ...(kind === undefined ? {} : { kind }) },
  });
/** Owner only: installs the source as a new Agent of the Project. */
export const installAgentPackage = (body: {
  source: string;
  kind?: AgentPackageSourceKind;
  projectId: string;
  agentId: string;
}) => apiFetch<{ agentId: string }>("/api/agent-packages/install", { method: "POST", body });

// ---- The plugins a Project asks for, and the confinement agent commands run under ----
/**
 * A Project's plugin list. Project-scoped because machines are lent to Projects, so this is
 * what says which machines a plugin has to reach; what the process RUNS is the union over
 * the Projects, since loading is per process (see the server's plugin/loader.ts).
 */
const pluginsPath = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/plugins/installed`;
/**
 * `server` reads a machine's own list through this server's tunnel — what it actually runs —
 * and null reads this server's, which holds the Project's tables for the whole fleet.
 */
export const getInstalledPlugins = (projectId: string, server: string | null = null) =>
  apiFetch<InstalledPluginsResponse>(pluginsPath(projectId), { server });
/** Admin only; applied without a restart where the runtime can re-assemble the App. */
export const putInstalledPlugins = (projectId: string, plugins: readonly string[]) =>
  apiFetch<InstalledPluginsResponse>(pluginsPath(projectId), {
    method: "PUT",
    body: { plugins },
  });
/**
 * Admin only: lists the package in the shared table, or with `machineId` in that machine's
 * own table. The machines that will run it install it — this server npm-installs it into its
 * data root unless the build ships it, and only when it runs it itself — then the App is
 * re-assembled. Slow for a cold registry fetch.
 */
export const installPlugin = (
  projectId: string,
  specifier: string,
  machineId: string | null = null,
) =>
  apiFetch<InstalledPluginsResponse>(pluginsPath(projectId), {
    method: "POST",
    body: machineId === null ? { specifier } : { specifier, machineId },
  });
/**
 * Admin only: drops it from every table of this Project, or with `machineId` from that
 * machine's own table; the package leaves this server's disk once nothing asks it to run here.
 */
export const uninstallPlugin = (
  projectId: string,
  specifier: string,
  machineId: string | null = null,
) =>
  apiFetch<InstalledPluginsResponse>(
    `${pluginsPath(projectId)}?specifier=${encodeURIComponent(specifier)}${
      machineId === null ? "" : `&machineId=${encodeURIComponent(machineId)}`
    }`,
    { method: "DELETE" },
  );
/**
 * Admin only: enables a LOCAL plugin — links the directory into this server's plugin prefix
 * and lists its package for this Project, recording who linked it, when, from where. The
 * directory must be built (its package.json names the package; the entry file a load would
 * import is a build product), and its own package name is what gets listed. The App is
 * re-assembled around the link.
 */
export const enableLocalPlugin = (projectId: string, path: string) =>
  apiFetch<InstalledPluginsResponse>(`${pluginsPath(projectId)}/local`, {
    method: "POST",
    body: { path },
  });
/**
 * Admin only: the one-step undo of a local link — the name leaves every table of this
 * Project and the link record goes with it. 404 `not_linked` when the name is not linked on
 * this machine.
 */
export const cancelLocalPlugin = (projectId: string, specifier: string) =>
  apiFetch<InstalledPluginsResponse>(
    `${pluginsPath(projectId)}/local?specifier=${encodeURIComponent(specifier)}`,
    { method: "DELETE" },
  );

// ---- The agent browser: the desktop's built-in browser, or the user's own Chrome ----
/**
 * The agent browser of one server. The calls the Browser panel makes take the server it belongs
 * to — null for this one, a machine id for the machine a conversation's Workspace lives on,
 * whose own Chrome its agents drive. The rest are always this server's: the built-in browser's
 * pages live in the desktop shell this server was spawned by, with its import, history, data
 * and settings, and a user's Chrome is paired to this server.
 */
const builtinBrowserPath = (rest: string) => `/api/builtin-browser${rest}`;

/** What the storage-clearing route takes (the shell's own clear-data command). */
export type BuiltinBrowserStorage = Extract<
  DesktopBrowserCommand,
  { op: "clear-data" }
>["storages"][number];

/**
 * The caller's backend — whether it can be driven now, its tabs — and every backend the server
 * offers them (`backends`).
 */
export const getBuiltinBrowserStatus = (server: string | null = null) =>
  apiFetch<BuiltinBrowserStatus>(builtinBrowserPath("/status"), { server });
/** The caller's backend and the ones they may choose (both only on the desktop, for an admin). */
export const getBrowserBackend = () =>
  apiFetch<BrowserBackendResponse>(builtinBrowserPath("/backend"), { server: null });
/** Chooses the backend; 409 `action_in_flight` while an agent acts in the one being left. */
export const putBrowserBackend = (backend: BrowserBackend, server: string | null = null) =>
  apiFetch<BrowserBackendResponse>(builtinBrowserPath("/backend"), {
    method: "PUT",
    body: { backend },
    server,
  });
/** A one-time pairing code for the signed-in user (ten minutes, one use; a new one replaces it). */
export const createBrowserPairingCode = () =>
  apiFetch<BrowserExtensionPairingResponse>(builtinBrowserPath("/extension/pairings"), {
    method: "POST",
    server: null,
  });
/** The Chromes paired to the caller's account, the connected one, and the admin's switch. */
export const getBrowserExtensions = () =>
  apiFetch<BrowserExtensionsResponse>(builtinBrowserPath("/extension"), { server: null });
/** Forgets a paired Chrome; its connection closes and it must be paired again. */
export const revokeBrowserExtension = (extensionId: string) =>
  apiFetch<void>(builtinBrowserPath(`/extension/${encodeURIComponent(extensionId)}`), {
    method: "DELETE",
    server: null,
  });
/**
 * A new tab, at `url` or else at the homepage (blank without one). The server asks this window
 * (over the user channel) to create the page, and answers once the page is claimed — so this
 * resolves after the tab exists.
 */
export const openBuiltinBrowserTab = (
  body: { url?: string; activate?: boolean },
  server: string | null = null,
) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath("/tabs"), {
    method: "POST",
    body,
    server,
  });
/** Ties a page this window created to the open request it answers; 409 when another window was first. */
export const claimBuiltinBrowserTab = (requestId: string, tabId: number) =>
  apiFetch<void>(builtinBrowserPath("/tabs/claim"), {
    method: "POST",
    body: { requestId, tabId },
    server: null,
  });
/** The user brought a tab to the front: it is also the one an agent's next command acts on. */
export const activateBuiltinBrowserTab = (tabId: number, server: string | null = null) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath(`/tabs/${tabId}/activate`), {
    method: "POST",
    server,
  });
/** The tab this window shows on screen, or none: the server leaves that one unthrottled. */
export const setBuiltinBrowserOnScreen = (tabId: number | null) =>
  apiFetch<void>(builtinBrowserPath("/tabs/on-screen"), {
    method: "POST",
    body: { tabId },
    server: null,
  });
export const closeBuiltinBrowserTab = (tabId: number, server: string | null = null) =>
  apiFetch<void>(builtinBrowserPath(`/tabs/${tabId}`), { method: "DELETE", server });
/**
 * Loads `url` in a tab through the server, and answers once it loaded: the address bar of a tab
 * this window does not host (one in the user's Chrome, or in a server's own).
 */
export const navigateBuiltinBrowserTab = (
  tabId: number,
  url: string,
  server: string | null = null,
) =>
  apiFetch<{ tab: BuiltinBrowserTab }>(builtinBrowserPath(`/tabs/${tabId}/navigate`), {
    method: "POST",
    body: { url },
    server,
  });
/**
 * What the viewer did in a hosted tab's picture (mouse, wheel, keys, text, the toolbar's
 * history buttons), in order, and optionally the size of the panel showing it.
 */
export const sendHostedBrowserInput = (
  tabId: number,
  body: HostedBrowserInputRequest,
  server: string | null,
) => apiFetch<void>(builtinBrowserPath(`/tabs/${tabId}/input`), { method: "POST", body, server });
/** The system browsers' profiles on this computer that can be imported from. */
export const getBuiltinBrowserImportSources = () =>
  apiFetch<BuiltinBrowserImportSourcesResponse>(builtinBrowserPath("/import/sources"), {
    server: null,
  });
export const importIntoBuiltinBrowser = (body: BuiltinBrowserImportRequest) =>
  apiFetch<BuiltinBrowserImportResult>(builtinBrowserPath("/import"), {
    method: "POST",
    body,
    server: null,
  });
/** The browser's settings — its homepage. The server's own file: no desktop shell needed. */
export const getBuiltinBrowserSettings = () =>
  apiFetch<BuiltinBrowserSettings>(builtinBrowserPath("/settings"), { server: null });
/** Replaces them; answers them as stored (a bare host given its scheme). */
export const putBuiltinBrowserSettings = (settings: BuiltinBrowserSettings) =>
  apiFetch<BuiltinBrowserSettings>(builtinBrowserPath("/settings"), {
    method: "PUT",
    body: settings,
    server: null,
  });
/** History matching `q` (address and title), most visited first. */
export const searchBuiltinBrowserHistory = (q: string, limit: number) =>
  apiFetch<BuiltinBrowserHistoryResponse>(builtinBrowserPath("/history"), {
    query: { q, limit },
    server: null,
  });
export const clearBuiltinBrowserHistory = () =>
  apiFetch<void>(builtinBrowserPath("/history"), { method: "DELETE", server: null });
export const clearBuiltinBrowserData = (storages: BuiltinBrowserStorage[]) =>
  apiFetch<void>(builtinBrowserPath("/clear-data"), {
    method: "POST",
    body: { storages },
    server: null,
  });

// —— Contributions and session surfaces ——

/** What the server's modules and plugins contribute to the App (pages, session surfaces, quick starts); this server's, never a machine's. Read by shell/contributions.tsx alone. */
export const getContributions = () =>
  apiFetch<ContributionsResponse>("/api/contributions", { server: null });

export const getSessionSurface = (sessionId: string) =>
  apiFetch<SessionSurfaceResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/surface`);

/** Opens the surface (idempotent: a live one is returned as it is); `prompt` reaches it only on a fresh open. */
export const openSessionSurface = (sessionId: string, body: SessionSurfaceOpenRequest) =>
  apiFetch<SessionSurfaceResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/surface`, {
    method: "POST",
    body,
  });

export const closeSessionSurface = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/surface`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Company proposals (the company-proposals plugin: routes/proposals under one organization).
// None of these exist without the plugin — the page that calls them is mounted only while the
// contributions carry it — and, like every organization-scoped call, they reach the machine
// the organization runs on.
// ---------------------------------------------------------------------------

const proposalsBase = (projectId: string, orgId: string) =>
  `${orgBase(projectId, orgId)}/proposals`;

const proposalBase = (projectId: string, orgId: string, number: number) =>
  `${proposalsBase(projectId, orgId)}/${number}`;

// ---------------------------------------------------------------------------
// Actions (company-proposals' Action registry): every write to the organization's proposals and
// roadmaps is an Action run, `POST …/actions/<key>/runs`, recorded as an ActionRun.
// ---------------------------------------------------------------------------

const actionsBase = (projectId: string, orgId: string) => `${orgBase(projectId, orgId)}/actions`;

/**
 * Runs the Action `key` on `subject` (`proposal:12`, `comment:12/<id>`, `item:3/<key>`, …). The
 * answer carries the run and its result; a run that started a process answers at once (202)
 * with `result: null`, to be followed with `getOrgActionRun`.
 */
export const runOrgAction = (
  projectId: string,
  orgId: string,
  key: string,
  subject: string,
  params: Record<string, unknown> = {},
) =>
  apiFetch<ActionRunAnswer>(`${actionsBase(projectId, orgId)}/${encodeURIComponent(key)}/runs`, {
    method: "POST",
    body: { subject, params, via: "web" },
  });

/** Runs an Action and answers its result, typed as the write it replaces answered. */
const actionResult = async <T>(
  projectId: string,
  orgId: string,
  key: string,
  subject: string,
  params: Record<string, unknown> = {},
): Promise<T> => (await runOrgAction(projectId, orgId, key, subject, params)).result as T;

/** The Actions bound in the organization; with a subject, those acting on it and whether the caller may run each now. */
export const listOrgActions = (projectId: string, orgId: string, subject?: string) =>
  apiFetch<ActionsResponse>(
    `${actionsBase(projectId, orgId)}${subject === undefined ? "" : `?subject=${encodeURIComponent(subject)}`}`,
  );

/** What the Activity is narrowed by; `before` is the previous page's `next`. */
export interface ActionRunsFilter {
  subject?: string;
  by?: string;
  key?: string;
  before?: string;
  limit?: number;
}

/** One page of the Activity, newest first. */
export const listOrgActionRuns = (
  projectId: string,
  orgId: string,
  filter: ActionRunsFilter = {},
) => {
  const q = new URLSearchParams();
  if (filter.subject) q.set("subject", filter.subject);
  if (filter.by) q.set("by", filter.by);
  if (filter.key) q.set("key", filter.key);
  if (filter.before) q.set("before", filter.before);
  if (filter.limit !== undefined) q.set("limit", String(filter.limit));
  const qs = q.toString();
  return apiFetch<ActionRunsResponse>(
    `${actionsBase(projectId, orgId)}/runs${qs === "" ? "" : `?${qs}`}`,
  );
};

/** One run, and its process output from `from`. */
export const getOrgActionRun = (projectId: string, orgId: string, id: string, from: number) =>
  apiFetch<ActionRunResponse>(
    `${actionsBase(projectId, orgId)}/runs/${encodeURIComponent(id)}?from=${from}`,
  );

const proposalSubject = (number: number) => `proposal:${number}`;
const commentSubject = (number: number, id: string) => `comment:${number}/${id}`;

export const listOrgProposals = (projectId: string, orgId: string) =>
  apiFetch<ProposalsResponse>(proposalsBase(projectId, orgId));

/** The PR graph as the server stores it; `refresh` waits for the server to read the repository again first. */
export const getOrgProposalGraph = (
  projectId: string,
  orgId: string,
  opts: { refresh?: boolean } = {},
) =>
  apiFetch<ProposalGraphResponse>(
    `${proposalsBase(projectId, orgId)}/graph${opts.refresh === true ? "?refresh=1" : ""}`,
  );

export const createOrgProposal = (projectId: string, orgId: string, body: ProposalCreateRequest) =>
  actionResult<ProposalItem>(projectId, orgId, "proposal.create", "organization", {
    ...(body.author !== undefined ? { author: body.author } : {}),
    brief: body.brief,
    ...(body.title !== undefined ? { title: body.title } : {}),
  });

export const getOrgProposal = (projectId: string, orgId: string, number: number) =>
  apiFetch<ProposalDetail>(proposalBase(projectId, orgId, number));

/** The impl branch's diff file by file with hunks; `ignoreWhitespace` is git's `-w`. */
export const getOrgProposalImplChanges = (
  projectId: string,
  orgId: string,
  number: number,
  ignoreWhitespace: boolean,
) =>
  apiFetch<ProposalImplChanges>(
    `${proposalBase(projectId, orgId, number)}/impl/changes${ignoreWhitespace ? "?w=1" : ""}`,
  );

/** One revision as it was published — what the page diffs the head against after an approval. */
export const getOrgProposalRevision = (
  projectId: string,
  orgId: string,
  number: number,
  revision: number,
) => apiFetch<ProposalRevision>(`${proposalBase(projectId, orgId, number)}/revisions/${revision}`);

/** One file under the proposal's base, read-only (`path` relative to it). */
export const getOrgProposalFile = (
  projectId: string,
  orgId: string,
  number: number,
  path: string,
) =>
  apiFetch<ProposalFileResponse>(
    `${proposalBase(projectId, orgId, number)}/file?path=${encodeURIComponent(path)}`,
  );

export const publishOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalPublishRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.publish", proposalSubject(number), {
    markdown: body.markdown,
  });

export const readyOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.ready", proposalSubject(number));

export const approveOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.approve", proposalSubject(number));

export const rejectOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalRejectRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.reject", proposalSubject(number), {
    reason: body.reason,
  });

export const mergedOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.merged", proposalSubject(number));

export const implementOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalImplementRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.implement", proposalSubject(number), {
    ...(body.agentId !== undefined ? { agent: body.agentId } : {}),
    ...(body.message !== undefined ? { message: body.message } : {}),
    ...(body.workspace !== undefined ? { workspace: body.workspace } : {}),
  });

/** A discussion with the owner (the implementer, else the author): the answer names its session. */
export const discussOrgProposal = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail & { sessionId: string }>(
    projectId,
    orgId,
    "proposal.discuss",
    proposalSubject(number),
  );

export const addOrgProposalMaterial = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalMaterialRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.material", proposalSubject(number), {
    kind: body.kind,
    url: body.url,
    ...(body.label !== undefined ? { label: body.label } : {}),
  });

export const sendOrgProposalFeedback = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalFeedbackRequest,
) =>
  actionResult<ProposalDetail>(projectId, orgId, "proposal.feedback", proposalSubject(number), {
    text: body.text,
    ...(body.runtime !== undefined ? { runtime: body.runtime } : {}),
  });

/**
 * A comment on a passage of a section, or on a target (a scope or test entry, a changed file,
 * changed lines); pending (the commenter's own) until `requestOrgProposalChanges` batches it.
 */
export const commentOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalCommentRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment",
    proposalSubject(number),
    "target" in body
      ? { target: body.target, text: body.text }
      : {
          sectionId: body.sectionId,
          start: body.start,
          end: body.end,
          quote: body.quote,
          text: body.text,
        },
  );

/** Every pending comment of the caller becomes one batch, and the author is told. */
export const requestOrgProposalChanges = (projectId: string, orgId: string, number: number) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.requestChanges",
    proposalSubject(number),
  );

export const editOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
  body: ProposalCommentEditRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment.edit",
    commentSubject(number, commentId),
    { text: body.text },
  );

export const deleteOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.comment.withdraw",
    commentSubject(number, commentId),
  );

export const resolveOrgProposalComment = (
  projectId: string,
  orgId: string,
  number: number,
  commentId: string,
  body: ProposalResolveRequest,
) =>
  actionResult<ProposalDetail>(
    projectId,
    orgId,
    "proposal.resolve",
    commentSubject(number, commentId),
    body.text !== undefined ? { text: body.text } : {},
  );

export const readOrgProposal = (
  projectId: string,
  orgId: string,
  number: number,
  body: ProposalReadRequest,
) => apiFetch<void>(`${proposalBase(projectId, orgId, number)}/read`, { method: "POST", body });
