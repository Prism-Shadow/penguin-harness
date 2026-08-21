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
  AgentSkillsResponse,
  AgentVaultConfigDto,
  AgentsResponse,
  AgentTracesResponse,
  ApprovalDecisionRequest,
  AuthLoginRequest,
  AuthResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
  CaseMaterial,
  ChatDefaultsDto,
  DefaultModelResponse,
  DefaultModelUpdateRequest,
  DirListResponse,
  FilesStatRequest,
  FilesStatResponse,
  GoalResponse,
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
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
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
  SessionCreateRequest,
  SessionCreateResponse,
  SessionForkRequest,
  SessionForkResponse,
  SessionPatchRequest,
  SessionResponse,
  SessionProcessesResponse,
  SessionsResponse,
  SessionTracesResponse,
  SkillArchiveInstallRequest,
  SkillInstallRequest,
  SkillLibraryResponse,
  RecalledMessageResponse,
  RetryNowResponse,
  SteerRequest,
  TaskCreateRequest,
  TaskCreateResponse,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceImportRequest,
  TraceImportResponse,
  UiPrefs,
  UpdateCheckResponse,
  UpdateRunResponse,
  UsageErrorsPage,
  UsageGroupBy,
  UsageResponse,
  VaultResponse,
  VaultUpdateRequest,
  VersionResponse,
  WorkspaceFilesResponse,
} from "@prismshadow/penguin-server/api";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import { apiFetch, apiFetchWithMeta } from "./client";

// Auth & user -----------------------------------------------------------------

export const login = (body: AuthLoginRequest) =>
  apiFetch<AuthResponse>("/api/auth/login", { method: "POST", body });

export const logout = () => apiFetch<void>("/api/auth/logout", { method: "POST", body: {} });

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

/** Vision probe: sends one 1x1 image on this model's credential and reports whether it was accepted (a real, billed completion — unlike the protocol probes). */
export const detectVision = (projectId: string, body: ModelVisionDetectRequest) =>
  apiFetch<ModelVisionDetectResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/models/detect-vision`,
    { method: "POST", body },
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

export const listAgents = (projectId: string) =>
  apiFetch<AgentsResponse>(`/api/projects/${encodeURIComponent(projectId)}/agents`);

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

/**
 * Optional paging (absent = the legacy full date-grouped response): pages Session groups
 * newest-first; a paged response answers with `sessions` (titles + category/workspace),
 * `totalSessions`, and per-category `counts` / `workspaceCounts`. `category` filters to
 * one sidebar bucket (paging applies within it, mirroring the sessions list); `cli`
 * includes CLI-origin Sessions (the "show CLI sessions" preference, default off — same
 * parameter convention as listSessions). The Trace page requests `limit+1` per page to
 * detect "has more" (splitPage).
 */
export const getAgentTraces = (
  projectId: string,
  agentId: string,
  paging?: { offset: number; limit: number; category?: SessionCategory; cli?: boolean },
) =>
  apiFetch<AgentTracesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/traces${
      paging
        ? `?limit=${paging.limit}&offset=${paging.offset}` +
          (paging.category ? `&category=${paging.category}` : "") +
          (paging.cli ? "&cli=1" : "")
        : ""
    }`,
  );

// Session ---------------------------------------------------------------------

/**
 * Optional paging (absent = full unfiltered list): the store requests `limit+1` per page to
 * detect "has more". `category` filters server-side (paging applies within the category);
 * `withCounts` asks for per-category totals over the whole list alongside the page.
 */
export const listSessions = (
  projectId: string,
  agentId: string,
  opts?: {
    offset: number;
    limit: number;
    category?: SessionCategory;
    withCounts?: boolean;
    /** Also list CLI-created Sessions (Trace discovery + adoption); default = web rows straight from the DB. */
    cli?: boolean;
  },
) => {
  const qs = opts
    ? `?limit=${opts.limit}&offset=${opts.offset}` +
      (opts.category ? `&category=${opts.category}` : "") +
      (opts.withCounts ? "&counts=1" : "") +
      (opts.cli ? "&cli=1" : "")
    : "";
  return apiFetch<SessionsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions${qs}`,
  );
};

/** Server directory browsing: `path` is an absolute path; empty means start from the server's home directory. */
export const listDirs = (projectId: string, path = "") =>
  apiFetch<DirListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/dirs?path=${encodeURIComponent(path)}`,
  );

export const createSession = (projectId: string, agentId: string, body: SessionCreateRequest) =>
  apiFetch<SessionCreateResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sessions`,
    { method: "POST", body },
  );

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

/** Recall an undelivered steering message back to the composer (#287): returns its original content; 409 not_pending once it was delivered to the model. */
export const recallSteer = (sessionId: string, steerId: string) =>
  apiFetch<RecalledMessageResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/steer/${encodeURIComponent(steerId)}`,
    { method: "DELETE" },
  );

/** Recall a queued follow-up task back to the composer (#287): returns its original content (+ queued thinking level); 409 not_pending once it already auto-started. */
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
  apiFetch<TraceEventsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
      `/traces/${encodeURIComponent(sessionId)}/${index}`,
    { query: { offset, limit } },
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
  );

/** Trace file download URL: the server sets Content-Disposition attachment, usable directly in <a download>. */
export const agentTraceDownloadUrl = (
  projectId: string,
  agentId: string,
  sessionId: string,
  index: number,
): string =>
  `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}` +
  `/traces/${encodeURIComponent(sessionId)}/${index}/download`;

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
  params: { offset: number; limit: number; from?: string; to?: string; agentId?: string },
) =>
  apiFetch<UsageErrorsPage>(`/api/projects/${encodeURIComponent(projectId)}/usage/errors`, {
    query: {
      offset: String(params.offset),
      limit: String(params.limit),
      from: params.from,
      to: params.to,
      agentId: params.agentId,
    },
  });

export const getUsage = (
  projectId: string,
  params: {
    from?: string;
    to?: string;
    groupBy: UsageGroupBy;
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
      groupBy: params.groupBy,
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
export const workspaceFileUrl = (sessionId: string, path: string, download = false): string =>
  `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

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

// Skill library & Agent-installed Skills ------------------------------------------------------

/** Skill library (available to any logged-in user): groups and metadata, excludes SKILL.md body content. */
export const getSkillLibrary = () => apiFetch<SkillLibraryResponse>("/api/skills");

export const getAgentSkills = (projectId: string, agentId: string) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills`,
  );

/** Installs (if already installed, overwrites with the library content); 201 returns the Agent's latest installed list. */
export const installAgentSkills = (projectId: string, agentId: string, names: string[]) =>
  apiFetch<AgentSkillsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/skills`,
    { method: "POST", body: { names } satisfies SkillInstallRequest },
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

// Version & self-update ----------------------------------------------------------------

export const getVersion = () => apiFetch<VersionResponse>("/api/version");

/** `force` (the manual "check for updates" action) bypasses the server's TTL cache. */
export const checkUpdate = (force = false) =>
  apiFetch<UpdateCheckResponse>(`/api/version/update-check${force ? "?force=1" : ""}`);

/** Admin only: runs `penguin update` on the server host (long request — up to 10 minutes). */
export const runUpdate = () =>
  apiFetch<UpdateRunResponse>("/api/version/update", { method: "POST", body: {} });
