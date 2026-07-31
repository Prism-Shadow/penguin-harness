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
  AgentSkillsResponse,
  AgentsResponse,
  AgentTracesResponse,
  ApprovalDecisionRequest,
  AuthLoginRequest,
  AuthResponse,
  BenchmarkCasesResponse,
  BenchmarksResponse,
  CaseMaterial,
  DirListResponse,
  FilesStatRequest,
  FilesStatResponse,
  GoalResponse,
  MeResponse,
  MemberAddRequest,
  MemberAddResponse,
  MembersResponse,
  MessagesResponse,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
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
  SessionCategory,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionPatchRequest,
  SessionResponse,
  SessionsResponse,
  SessionTracesResponse,
  SkillInstallRequest,
  SkillLibraryResponse,
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

// Model configuration -------------------------------------------------------------------

export const getModels = (projectId: string) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`);

export const putModels = (projectId: string, body: ModelsUpdateRequest) =>
  apiFetch<ModelsResponse>(`/api/projects/${encodeURIComponent(projectId)}/models`, {
    method: "PUT",
    body,
  });

/** Connectivity test: model reference (provider, modelId) is passed in the request body (may include an unsaved apiKey / baseUrl). */
export const testModel = (projectId: string, body: ModelTestRequest) =>
  apiFetch<ModelTestResponse>(`/api/projects/${encodeURIComponent(projectId)}/models/test`, {
    method: "POST",
    body,
  });

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

/** Overwrite system_config.yaml with the current defaults (keeps only name/description/version). */
export const resetAgentConfig = (projectId: string, agentId: string) =>
  apiFetch<AgentConfigResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/config/reset`,
    { method: "POST" },
  );

export const getAgentTraces = (projectId: string, agentId: string) =>
  apiFetch<AgentTracesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/traces`,
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
  opts?: { offset: number; limit: number; category?: SessionCategory; withCounts?: boolean },
) => {
  const qs = opts
    ? `?limit=${opts.limit}&offset=${opts.offset}` +
      (opts.category ? `&category=${opts.category}` : "") +
      (opts.withCounts ? "&counts=1" : "")
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

export const getSession = (sessionId: string) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`);

export const patchSession = (sessionId: string, body: SessionPatchRequest) =>
  apiFetch<SessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body,
  });

export const deleteSession = (sessionId: string) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });

/**
 * History rebuild. Carries the server's clock at read time (see ApiFetchMeta.serverNowMs)
 * alongside the messages: a Task still running has no Trace entry for the event currently in
 * flight, so its elapsed can only be measured by differencing this against the Task's first
 * message timestamp — both server-side values, so no client clock offset enters the result
 * (see pushMessages).
 */
export const getMessages = (sessionId: string) =>
  apiFetchWithMeta<MessagesResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  ).then(({ data, serverNowMs }) => ({ ...data, serverNowMs }));

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

/** Mid-run steering: queues a message for the running Task (delivered between turns as a standalone `[user_steering]` user message); 409 not_running when no Task is in progress. */
export const postSteer = (sessionId: string, body: SteerRequest) =>
  apiFetch<void>(`/api/sessions/${encodeURIComponent(sessionId)}/steer`, {
    method: "POST",
    body,
  });

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
