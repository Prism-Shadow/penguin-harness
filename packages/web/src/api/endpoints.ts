/**
 * API endpoint wrappers: one function per API.
 * DTO types come from @prismshadow/penguin-server/api (**type import only**, resolved via
 * tsconfig paths to the server contract file types.ts; must not be a value import — server
 * code must not enter the browser bundle).
 */
import type {
  AdminPasswordResetRequest,
  AdminUserCreateRequest,
  AdminUserCreateResponse,
  AdminUsersResponse,
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentCreateRequest,
  AgentCreateResponse,
  AgentImportRequest,
  AgentImportResponse,
  AgentKernelUpdateResponse,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentHooksResponse,
  AgentPluginsInstallResponse,
  AgentSkillsResponse,
  AgentVaultConfigDto,
  AgentsResponse,
  ApprovalDecisionRequest,
  AuthLoginRequest,
  AuthResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
  CaseMaterial,
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  DefaultModelResponse,
  DefaultModelUpdateRequest,
  DirectorySkillsResponse,
  DirListResponse,
  EndpointModelListRequest,
  EndpointModelListResponse,
  FeishuBindingPutRequest,
  FeishuBindingResponse,
  FeishuTestRequest,
  FeishuTestResponse,
  FilesStatRequest,
  FilesStatResponse,
  GoalResponse,
  InstallResponse,
  McpServerTestResponse,
  MeResponse,
  MemberAddRequest,
  MemberAddResponse,
  MembersResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportRequest,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MessagesResponse,
  MessagingBindingsResponse,
  MessagingChannel,
  MessagingTestMessageResponse,
  ModelOAuthCodeResponse,
  ModelOAuthStartRequest,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  MachinesResponse,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  PasswordChangeRequest,
  PrefsResponse,
  ProjectCreateRequest,
  ProjectCreateResponse,
  ProjectUpdateRequest,
  ProjectUpdateResponse,
  ProjectsResponse,
  ScheduleItem,
  SchedulesResponse,
  ScheduleUpsertRequest,
  ServerSettingsResponse,
  ServerSettingsUpdateRequest,
  SessionCategory,
  SessionContextResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionForkRequest,
  SessionForkResponse,
  SessionPatchRequest,
  SessionResponse,
  SessionProcessesResponse,
  PluginIndexResponse,
  LanguageIndexResponse,
  PluginReadmeResponse,
  SessionsResponse,
  SessionsOverviewResponse,
  SessionTracesResponse,
  SkillArchiveInstallRequest,
  PluginFilesResponse,
  PluginInstallRequest,
  PluginLibraryResponse,
  QQBindingPutRequest,
  QQBindingResponse,
  QQScanPollResponse,
  QQScanStartResponse,
  QQTestRequest,
  QQTestResponse,
  WeChatBindingPutRequest,
  WeChatBindingResponse,
  WeChatScanPollResponse,
  WeChatScanStartResponse,
  WeChatTestResponse,
  RecalledMessageResponse,
  RetryNowResponse,
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
  RestartResponse,
  DesktopUpdateStatusResponse,
  UsageErrorKind,
  UsageErrorsClearResponse,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupBy,
  UsageModelTotals,
  UsageResponse,
  VaultResponse,
  VaultUpdateRequest,
  VersionHistoryDiffResponse,
  VersionHistoryResponse,
  WorkflowInfo,
  WorkflowVersion,
  AgentPackageResponse,
  AgentPackagePublishResponse,
  AgentPackagePreviewResponse,
  AgentPackageSourceKind,
  InstalledPluginsResponse,
  SandboxSettingsResponse,
  VersionRollbackResponse,
  VersionResponse,
  WorkspaceFilesResponse,
  ContributionsResponse,
} from "@prismshadow/penguin-server/api";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import { apiFetch, apiFetchWithMeta } from "./client";
import { machineForSession, rememberSessionMachine } from "../lib/session-machines";
import { apiUrl } from "../lib/server-context";

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

export const changePassword = (body: PasswordChangeRequest) =>
  apiFetch<void>("/api/me/password", { method: "PUT", body });

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

/** Omitted fields keep their current value; applies immediately (no restart). */
export const adminPutSettings = (body: ServerSettingsUpdateRequest) =>
  apiFetch<ServerSettingsResponse>("/api/admin/settings", { method: "PUT", body });

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

export const getModels = (projectId: string) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`);

export const putModels = (projectId: string, body: ModelsUpdateRequest) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`, {
    method: "PUT",
    body,
  });

/** Narrow default-model switch (owner): flips the same default_model the models page maintains, without resending the table. */
export const putDefaultModel = (projectId: string, body: DefaultModelUpdateRequest) =>
  apiFetch<DefaultModelResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/default`, {
    method: "PUT",
    body,
  });

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
 */
export const listSessions = (
  projectId: string,
  agentId: string,
  opts?: {
    offset: number;
    limit: number;
    category?: SessionCategory;
    /** One Workspace group's rows only: its path, or the merged temporary group's sentinel (session-grouping.ts). */
    workspaceGroup?: string;
    withCounts?: boolean;
  },
  /**
   * Which machine to ask. This path is NOT session-scoped, so nothing about it can be routed
   * from an id — it asks a server which Sessions IT has, and only the caller knows which
   * servers are worth asking. Omitted (or null) means this one.
   */
  machineId?: string | null,
) => {
  const qs = opts
    ? `?limit=${opts.limit}&offset=${opts.offset}` +
      (opts.category ? `&category=${opts.category}` : "") +
      (opts.workspaceGroup ? `&workspaceGroup=${encodeURIComponent(opts.workspaceGroup)}` : "") +
      (opts.withCounts ? "&counts=1" : "")
    : "";
  return apiFetch<SessionsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions${qs}`,
    { server: machineId ?? null },
  );
};

/**
 * The dashboard's read: per Workspace, how many Sessions run and how many wait on an
 * approval, over every Agent of the Project. Asked of one server at a time, like the list —
 * this one with no machine, or a machine by its id.
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
 */
export const listDirs = (projectId: string, path = "", machineId?: string | null) =>
  machineId === undefined || machineId === null
    ? apiFetch<DirListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/dirs?path=${encodeURIComponent(path)}`,
      )
    : apiFetch<DirListResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/machines/${encodeURIComponent(machineId)}/dirs?path=${encodeURIComponent(path)}`,
      );

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

export const getSession = (sessionId: string) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);

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
  apiFetch<FeishuBindingResponse | TelegramBindingResponse | QQBindingResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/${channel}/state`,
    { method: "POST", body: { enabled } },
  );

/** Feishu credential probe with the form's draft values; omitted fields fall back to the stored binding. */
export const testFeishuBinding = (sessionId: string, body: FeishuTestRequest) =>
  apiFetch<FeishuTestResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messaging/feishu/test`,
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

/** Short fixed text to the binding's last known chat (409 `feishu_no_chat` / `telegram_no_chat` / `qq_no_chat` before one exists; on QQ the send can still fail with 502 when no recent QQ message can be replied to). */
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
 * One page of the cost center's error table (newest first). The dashboard response already
 * carries the first page; this is for paging back to earlier ones without refetching the
 * whole aggregate. Takes the dashboard's date/agent filter only — the model filter never
 * applied to errors.
 */
export const getUsageErrors = (
  projectId: string,
  params: {
    offset: number;
    limit: number;
    from?: string;
    to?: string;
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
      agentId: params.agentId,
      kind: params.kind,
    },
  });

/**
 * Empties the cost center's error table for the filter the panel is showing — the same
 * date/agent pair the reads take, so what goes is what was on screen. Owner only, and errors
 * with no Project attribution are never included. Answers how many rows were deleted.
 */
export const clearUsageErrors = (
  projectId: string,
  params: { from?: string; to?: string; agentId?: string },
) =>
  apiFetch<UsageErrorsClearResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/usage/errors`,
    {
      method: "DELETE",
      query: { from: params.from, to: params.to, agentId: params.agentId },
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
    },
  });

// Agent deletion & Workspace files --------------------------------------------------

export const deleteAgent = (projectId: string, agentId: string) =>
  apiFetch<void>(`/api/projects/${projectId}/agents/${agentId}`, { method: "DELETE" });

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

export const uploadWorkspaceFile = (sessionId: string, path: string, dataBase64: string) =>
  apiFetch<void>(`/api/sessions/${sessionId}/files/content`, {
    method: "PUT",
    body: { dataBase64 },
    query: { path },
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
export const getPluginIndex = () => apiFetch<PluginIndexResponse>("/api/plugins/registry");

/** Languages plugins contributed; the grammars themselves are fetched by the highlighter. */
export const getLanguages = () => apiFetch<LanguageIndexResponse>("/api/languages");

export const getPluginReadme = (name: string) =>
  apiFetch<PluginReadmeResponse>(`/api/plugins/registry/readme?name=${encodeURIComponent(name)}`);

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

// Benchmark scoring (read-only display) -------------------------------------------------------

export const listBenchmarks = (projectId: string, agentId: string) =>
  apiFetch<BenchmarksResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/benchmarks`,
  );

export const listBenchmarkCases = (projectId: string, agentId: string, benchmarkId: string) =>
  apiFetch<BenchmarkCasesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/benchmarks/${encodeURIComponent(benchmarkId)}/cases`,
  );

const benchmarkCaseFilesPath = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  material: CaseMaterial,
) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/benchmarks/${encodeURIComponent(benchmarkId)}/cases/${encodeURIComponent(caseId)}` +
  `${material === "rubric" ? "/rubric" : ""}/files`;

export const listBenchmarkCaseFiles = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
) =>
  apiFetch<WorkspaceFilesResponse>(
    benchmarkCaseFilesPath(projectId, agentId, benchmarkId, caseId, material),
    { query: { path } },
  );

export const benchmarkCaseFileUrl = (
  projectId: string,
  agentId: string,
  benchmarkId: string,
  caseId: string,
  path: string,
  material: CaseMaterial,
  options?: { download?: boolean; preview?: boolean },
): string => {
  const base = `${benchmarkCaseFilesPath(
    projectId,
    agentId,
    benchmarkId,
    caseId,
    material,
  )}/content?path=${encodeURIComponent(path)}`;
  return (
    base +
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

export const desktopUpdateCheck = () =>
  apiFetch<void>("/api/desktop/update/check", { method: "POST", body: {} });

export const desktopUpdateDownload = () =>
  apiFetch<void>("/api/desktop/update/download", { method: "POST", body: {} });

export const desktopUpdateInstall = () =>
  apiFetch<void>("/api/desktop/update/install", { method: "POST", body: {} });

// ---- Workflows (an Agent's own extension packages, served as tabs beside the chat) ----
const workflowsBase = (projectId: string, agentId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/workflows`;
export const getWorkflows = (projectId: string, agentId: string) =>
  apiFetch<{ workflows: WorkflowInfo[] }>(workflowsBase(projectId, agentId));
/** Re-import the folder now (the server also does this whenever a file changes). */
export const reloadWorkflow = (projectId: string, agentId: string, workflowId: string) =>
  apiFetch<{ workflow: WorkflowInfo }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/reload`,
    { method: "POST", body: {} },
  );
export const getWorkflowHistory = (projectId: string, agentId: string, workflowId: string) =>
  apiFetch<{ versions: WorkflowVersion[] }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/history`,
  );
/** Restore a recorded version's files (state.json is kept) and reload. */
export const rollbackWorkflow = (
  projectId: string,
  agentId: string,
  workflowId: string,
  revision: string,
) =>
  apiFetch<{ workflow: WorkflowInfo }>(
    `${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}/rollback`,
    { method: "POST", body: { revision } },
  );
/** Delete the folder; its recorded versions stay on disk. */
export const removeWorkflow = (projectId: string, agentId: string, workflowId: string) =>
  apiFetch<void>(`${workflowsBase(projectId, agentId)}/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
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

// ---- Plugins this deployment installs, and the confinement agent commands run under ----
export const getInstalledPlugins = () =>
  apiFetch<InstalledPluginsResponse>("/api/plugins/installed");
/** Admin only; the list applies at the next server start (plugins load once per process). */
export const putInstalledPlugins = (plugins: readonly string[]) =>
  apiFetch<InstalledPluginsResponse>("/api/plugins/installed", {
    method: "PUT",
    body: { plugins },
  });
/**
 * Admin only: npm-installs the package into the data root, then lists it. Slow — a cold
 * registry fetch — and listing a package that is not on the machine means nothing, which is
 * why the two happen together.
 */
export const installPlugin = (specifier: string) =>
  apiFetch<InstalledPluginsResponse>("/api/plugins/installed", {
    method: "POST",
    body: { specifier },
  });
/** Admin only: drops it from the list and removes the package from the data root. */
export const uninstallPlugin = (specifier: string) =>
  apiFetch<InstalledPluginsResponse>(
    `/api/plugins/installed?specifier=${encodeURIComponent(specifier)}`,
    { method: "DELETE" },
  );
export const adminGetSandbox = () => apiFetch<SandboxSettingsResponse>("/api/admin/sandbox");
/** Applies to the next command spawn; no restart. */
export const adminPutSandbox = (body: {
  mode: string;
  network: "none" | null;
  maskPaths: string[];
}) => apiFetch<SandboxSettingsResponse>("/api/admin/sandbox", { method: "PUT", body });
