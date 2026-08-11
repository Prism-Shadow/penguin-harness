/**
 * Web API DTO contract — request/response types shared between server routes and the
 * frontend SPA (single source of truth).
 *
 * These field definitions are authoritative for the Web API contract. Conventions:
 *   - DTO fields use camelCase; OmniMessage keeps the core protocol as-is (snake_case shell),
 *     no conversion;
 *   - This file holds only types, no implementation; exposed to the frontend via package
 *     exports `"./api"` for type-only import;
 *   - Types are taken only from core's pure subpaths (omnimessage / interfaces), so the
 *     frontend can safely reference them.
 *
 * Docs: packages/docs/content/server-api.{zh,en}.md (site path /docs/server-api) is the
 * public route/SSE reference for this contract — keep it in sync when changing DTOs.
 */
import type { OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core/omnimessage";
import type {
  MCPServerConfig,
  ThinkingLevelName,
  ToolDefinitionConfig,
} from "@prismshadow/penguin-core/interfaces";

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

/** Unified error response body; `code` is a machine-readable error code, `message` is a Chinese user-facing message. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** Session approval mode (reuses the CLI enum). */
export type ApprovalMode = "allow-all" | "deny-all" | "read-only" | "always-ask";

/** Session run status: idle / Task in progress / compacting. */
export type SessionStatus = "idle" | "running" | "compacting";

/** Session source marker (default = user-created): triggered by Schedule / registered as a subagent session. */
export type SessionSource = "schedule" | "subagent";

// ---------------------------------------------------------------------------
// Authentication and users
// ---------------------------------------------------------------------------

export interface UserInfo {
  /** Semantic id, i.e. login name: `^[a-z][a-z0-9_-]{1,31}$`, immutable after creation. */
  userId: string;
  /** Built-in admin (seeded at startup). */
  isAdmin: boolean;
  /** Still using the initial password (seeded/set by admin): frontend prompts the user to change it soon. */
  passwordIsInitial: boolean;
  createdAt: string;
}

export interface AuthLoginRequest {
  userId: string;
  password: string;
}

export interface AuthResponse {
  user: UserInfo;
}

export interface MeResponse {
  user: UserInfo;
  /**
   * Whether Workspace HTML previews open on a separate origin (see design §
   * "Workspace 文件预览"). False means this deployment has no usable preview origin —
   * the App is reached on something other than a loopback name and
   * PENGUIN_PREVIEW_ORIGIN is unset — so previews fall back to the same-origin sandbox,
   * where `localStorage`, cookies and third-party embeds do not work. Computed per
   * request, since it depends on the host the caller is using.
   */
  previewIsolated: boolean;
  /**
   * Whether this server runs in desktop mode (spawned by the desktop shell with
   * PENGUIN_DESKTOP_TOKEN). The web app then hides the logout entry, the
   * initial-password banner and the self-update entry, and omits the old-password
   * field when changing the password. See design § "桌面端原型".
   */
  desktopMode: boolean;
  /**
   * How THIS session was established. Distinct from desktopMode: a browser signed into a
   * desktop-mode server holds a "password" session and must still provide the old
   * password when changing it — only "desktop" sessions (opened by the shell's one-shot
   * token) may omit it.
   */
  sessionVia: "password" | "desktop";
}

export interface PasswordChangeRequest {
  /** Omitted only by desktop-established sessions (desktop mode); required otherwise. */
  oldPassword?: string;
  /** At least 8 characters. */
  newPassword: string;
}

// ---------------------------------------------------------------------------
// Admin user backend (admin only)
// ---------------------------------------------------------------------------

export interface AdminUsersResponse {
  users: UserInfo[];
}

export interface AdminUserCreateRequest {
  /** Username, i.e. user_id: `^[a-z][a-z0-9_-]{1,31}$`. */
  userId: string;
  /** Initial password (at least 8 characters), flagged as an initial password. */
  password: string;
}

export interface AdminUserCreateResponse {
  user: UserInfo;
}

export interface AdminPasswordResetRequest {
  /** New initial password (at least 8 characters); resets invalidate all of the user's sessions. */
  password: string;
}

/** Admin-level server-global settings (SQLite server_settings; design § "出网与系统代理"). */
export interface ServerSettings {
  /**
   * "Use system HTTP proxy" (default on): whether the server process and its child
   * processes reach the internet through the proxy named by HTTP_PROXY / HTTPS_PROXY
   * (both spellings). Off = direct connections, with the proxy variables also stripped
   * from agent command subprocess environments. Either way the effective NO_PROXY always
   * includes localhost/127.0.0.1/::1 (loopback is never proxied). Toggling applies to
   * newly initiated connections immediately — no restart.
   */
  useSystemProxy: boolean;
}

export interface ServerSettingsResponse {
  settings: ServerSettings;
}

/** PUT body: every field optional, omitted fields keep their current value (mirrors prefs). */
export interface ServerSettingsUpdateRequest {
  useSystemProxy?: boolean;
}

/** User UI preferences (SQLite ui_prefs, free-form JSON; known keys declared here). */
export interface UiPrefs {
  theme?: "light" | "dark";
  lastProjectId?: string;
  /** Whether the "no API key configured" guide has already been shown: once ever (on first visit to the chat page). */
  credentialGuideSeen?: boolean;
  /**
   * Also list CLI-created Sessions in the sidebar (`cli=1` on the sessions list). Default
   * off: the list then serves web rows straight from the DB, with no Trace-directory
   * scanning (#139).
   */
  showCliSessions?: boolean;
  [key: string]: unknown;
}

export interface PrefsResponse {
  prefs: UiPrefs;
}

// ---------------------------------------------------------------------------
// Project and member authorization
// ---------------------------------------------------------------------------

export type ProjectRole = "owner" | "member";

export interface ProjectSummary {
  projectId: string;
  /** Display name (the `name` in project_config.toml); frontend falls back to projectId when unset. */
  name?: string;
  /** Current user's role in this Project. */
  role: ProjectRole;
  ownerUserId: string;
  createdAt: string;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface ProjectCreateRequest {
  /**
   * Semantic id, specified by the creator: `^[a-z][a-z0-9_-]{1,63}$`, immutable after creation.
   * Non-admins must prefix it with `<username>-` (the web input locks the prefix segment);
   * admins are unrestricted.
   */
  projectId: string;
  /** Display name; defaults to projectId. */
  name?: string;
}

export interface ProjectCreateResponse {
  project: ProjectSummary;
}

export interface ProjectUpdateRequest {
  /** New display name. The projectId itself is immutable — only this label can change. */
  name: string;
}

export interface ProjectUpdateResponse {
  project: ProjectSummary;
}

export interface MemberInfo {
  userId: string;
  role: ProjectRole;
  createdAt: string;
}

export interface MembersResponse {
  members: MemberInfo[];
}

export interface MemberAddRequest {
  /** Username of the user being granted access (owner invites by username). */
  userId: string;
}

export interface MemberAddResponse {
  member: MemberInfo;
}

// ---------------------------------------------------------------------------
// Model and credential config (single .project_config.toml file; credentials are inlined on model entries)
// ---------------------------------------------------------------------------

/**
 * Model reference DTO: `(provider, modelId)` pair.
 * `modelId` is the upstream request id, sent to AgentHub as-is — `<provider>/<id>` string
 * concatenation is forbidden throughout the pipeline.
 */
export interface ModelRefDto {
  provider: string;
  modelId: string;
}

/** Three pricing buckets, in USD per million tokens (unit is fixed at usd_per_mtok; not carried in the DTO). */
export interface ModelPricingDto {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Read-only credential display: masked key and creation time; plaintext is never sent. */
export interface CredentialInfo {
  apiKeyMasked?: string;
  baseUrl?: string;
  createdAt?: string;
}

export interface ModelInfo {
  /** Provider group id (anthropic / openai / …, see core's MODEL_PROVIDERS; custom models use `custom`). */
  provider: string;
  /** Upstream model id (the request id actually sent to AgentHub); paired with `provider` forms the entry's unique key. */
  modelId: string;
  /** Display name: explicit TOML field (user-edited) takes priority, then the built-in catalog; falls back to unset (frontend shows modelId). */
  displayName?: string;
  contextWindow?: number;
  /** AgentHub client protocol (`openai`, etc.); defaults to AgentHub inferring it from modelId. */
  clientType?: string;
  /**
   * Whether image input (vision/multimodal) is supported: the TOML `vision` annotation takes
   * priority, falling back to the built-in catalog annotation; if neither exists, defaults to
   * unset (= treated as supported).
   */
  vision?: boolean;
  /**
   * Per-model max output tokens (TOML `max_tokens` annotation; user-only, never preset by the
   * built-in catalog): when set it wins over the Agent's `system_config.model.max_tokens`;
   * unset = inherit the Agent value. Lets a small-context model cap its output below the
   * seeded per-Agent default (32000), which cannot fit into e.g. a 32k context window.
   */
  maxTokens?: number;
  pricing?: ModelPricingDto;
  /** Environment variable name to fall back to when api_key is empty (e.g. ANTHROPIC_API_KEY); unset if no known fallback. */
  envKey?: string;
  credential?: CredentialInfo;
  isDefault: boolean;
}

export interface ModelsResponse {
  /** Paired reference to the default Model. */
  defaultModel?: ModelRefDto;
  /** Vision model used as a proxy reader for read_image (describes images when the session model has vision=false). */
  visionModel?: ModelRefDto;
  /**
   * When the Project's model/credential config last changed (ISO; the config file's mtime,
   * so it survives restarts). The web's auth-dead gate compares it against the last auth
   * abort: an abort OLDER than the last credential update no longer disables the composer
   * (the key was fixed since). Absent when the Project has no config file yet.
   */
  updatedAt?: string;
  models: ModelInfo[];
}

/** PUT full-table replace semantics: models not present are deleted; omitting apiKey = keep existing value. Key = (provider, modelId). */
export interface ModelUpdateEntry {
  /** Provider group (an independent entry field, always submitted with the request). */
  provider: string;
  /** Upstream model id (sent to AgentHub as-is). */
  modelId: string;
  /** Display name; the server does not persist it when it matches the built-in catalog (keeps the config file clean). */
  displayName?: string;
  /**
   * The pair reference this entry was renamed from (provided when either the group or the
   * upstream id changes): the server uses this to migrate the original entry's credential
   * and unknown fields to the new key — otherwise a full-table replace would delete the
   * original entry along with its credential.
   */
  renamedFrom?: ModelRefDto;
  contextWindow?: number;
  /** Empty string/omitted = unspecified (AgentHub infers it from modelId). */
  clientType?: string;
  /** Whether image input (vision/multimodal) is supported; omitted = supported (not persisted). */
  vision?: boolean;
  /** Per-model max output tokens, a positive integer (wins over the Agent config); omitted = inherit the Agent value (the annotation is cleared). */
  maxTokens?: number;
  pricing?: ModelPricingDto;
  /** Providing it overwrites and updates createdAt; omitting it keeps the existing value. */
  apiKey?: string;
  /** When true, clears the stored api_key. */
  clearApiKey?: boolean;
  /** null clears it; omitted keeps the existing value. */
  baseUrl?: string | null;
}

export interface ModelsUpdateRequest {
  /** Must be included in models (matched by paired reference). */
  defaultModel?: ModelRefDto;
  /** Vision model used as a proxy reader for read_image: must be included in models and not annotated vision=false; omitted keeps the existing value. */
  visionModel?: ModelRefDto;
  models: ModelUpdateEntry[];
}

/**
 * Connectivity test (POST /api/projects/:p/models/test): the model reference is submitted as
 * a pair in the request body; the rest are optional overrides (for trying out an unsaved
 * config). When the model isn't in the config yet (adding a custom model — test-before-save),
 * all parameters come from this request body.
 */
export interface ModelTestRequest {
  /** Provider group of the model under test (paired with modelId). */
  provider: string;
  /** Upstream id of the model under test (sent to AgentHub as-is). */
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
  /** AgentHub client protocol; required for unsaved custom models (otherwise the id can't be auto-routed). */
  clientType?: string;
}

/**
 * Connectivity test result: carries round-trip latency when ok, and a reason on failure
 * (truncated raw provider error). When streamed content was observed, also carries the
 * time-to-first-token and, when usage was reported (completed streams), the output rate.
 */
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

/**
 * PUT /api/projects/:p/models/default (owner): narrow default-model switch — flips the same
 * top-level `default_model` the models page's whole-table PUT writes, without resending the
 * table (and thus without touching credentials). The pair must name a configured model
 * entry, exactly like the whole-table route's defaultModel validation.
 */
export interface DefaultModelUpdateRequest {
  provider: string;
  modelId: string;
}

/** Response mirrors what GET models reports as `defaultModel`. */
export interface DefaultModelResponse {
  defaultModel: ModelRefDto;
}

// ---------------------------------------------------------------------------
// New-chat defaults (the `[default_chat]` block of .project_config.toml)
// ---------------------------------------------------------------------------

/**
 * Per-Project new-chat defaults: prefill for the chat draft page. Every key is optional —
 * an absent key means "not set" (the pre-existing behavior). Serves as the GET response,
 * the PUT request body (whole-block replace: an omitted key clears it) and the PUT
 * response (the stored block). The default MODEL is deliberately not here: it stays the
 * top-level `default_model` served/written via the models routes (single-sourced with the
 * models page).
 */
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
   * "none" — only the four selectable tiers.
   */
  thinkingLevel?: Exclude<ThinkingLevelName, "none">;
}

// ---------------------------------------------------------------------------
// Vault environment variables (Agent-level: agent_state/.vault.toml)
// ---------------------------------------------------------------------------

/** Read-only vault entry display: key name + masked value; plaintext is never sent. */
export interface VaultEntryInfo {
  key: string;
  valueMasked: string;
}

export interface VaultResponse {
  entries: VaultEntryInfo[];
}

/** A single entry under PUT full-table replace semantics: omitting value = keep the existing value (required for new keys). */
export interface VaultEntryUpdate {
  /** Shell environment variable name rule: starts with a letter or underscore, followed by letters/digits/underscores only. */
  key: string;
  /** Non-empty string; omitted keeps the existing value. */
  value?: string;
}

/** PUT full-table replace semantics (same as models): keys not present in the body are deleted. */
export interface VaultUpdateRequest {
  entries: VaultEntryUpdate[];
}

// ---------------------------------------------------------------------------
// Agent and its config (system_config.yaml + AGENTS.md)
// ---------------------------------------------------------------------------

export interface AgentSummary {
  agentId: string;
  name?: string;
  description?: string;
  createdAt?: string;
  /** Last config modification time: the larger mtime of system_config.yaml / AGENTS.md (unset if stat fails). */
  updatedAt?: string;
  /** Number of this Agent's Sessions currently running / compacting. */
  activeSessionCount: number;
  /** Total Session count (DB index ∪ Trace directory discovery, including archived). */
  sessionCount: number;
  /** Daily active Session count for the last 30 days (index 0 = earliest, last = today; active = created that day or has a Trace record that day). */
  sessionActivity: number[];
  /** Tool count: number of tools.builtin + tools.mcpServers config entries (MCP counted per server). */
  toolCount: number;
  /** Agent State version number (the `version` in system_config.yaml; treated as 1 if missing). */
  version: number;
  /** Vault key count (number of keys in agent_state/.vault.toml). */
  vaultKeyCount: number;
  /** Schedule count (number of .toml files under agent_state/schedule/, including invalid ones). */
  scheduleCount: number;
  /** Installed Skill count (number of agent_state/skills/<name>/ directories with a SKILL.md). */
  skillCount: number;
}

export interface AgentsResponse {
  agents: AgentSummary[];
}

export interface AgentCreateRequest {
  /** Semantic id, specified by the creator: `^[a-z][a-z0-9_-]{1,63}$`, unique within the Project, immutable after creation. */
  agentId: string;
  /** Display name; defaults to agentId. */
  name?: string;
  description?: string;
}

export interface AgentCreateResponse {
  agent: AgentSummary;
}

export interface AgentModelConfigDto {
  maxTokens?: number;
  thinkingLevel?: ThinkingLevelName;
  timeoutMs?: number;
}

export interface AgentCompactionConfigDto {
  maxContextLength?: number;
  maxSessionTurns?: number;
  mode?: "summarize" | "discard";
  prompt?: string;
}

/** Structured view of system_config.yaml (for the edit form). */
export interface AgentConfigDto {
  name?: string;
  description?: string;
  /** Agent State version number (treated as 1 if missing; shown in the settings page overview). */
  version: number;
  systemPrompt: string;
  maxTurns?: number;
  model?: AgentModelConfigDto;
  compaction?: AgentCompactionConfigDto;
  toolsBuiltin: ToolDefinitionConfig[];
  mcpServers: MCPServerConfig[];
}

export interface AgentConfigResponse {
  agentsMd: string;
  /** Raw system_config.yaml text (read-only display / diagnostics). */
  systemConfigYaml: string;
  config: AgentConfigDto;
  /** Agent State absolute path. */
  stateDir: string;
  activeSessionCount: number;
}

/** PUT any subset: only provided keys are updated (remaining YAML content and comments preserved); agentsMd overwrites the whole file. */
export interface AgentConfigUpdateRequest {
  agentsMd?: string;
  config?: {
    name?: string;
    description?: string;
    systemPrompt?: string;
    maxTurns?: number;
    model?: AgentModelConfigDto;
    compaction?: AgentCompactionConfigDto;
    toolsBuiltin?: ToolDefinitionConfig[];
    mcpServers?: MCPServerConfig[];
  };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** Provider group of the session's model (paired with `modelId` to form a model reference). */
  provider: string;
  /** Upstream model_id of the session's model (the request id sent to AgentHub). */
  modelId: string;
  workspace: string;
  approvalMode: ApprovalMode;
  /** Short title auto-generated by the model after the first turn; unset until generated (frontend shows "New Chat"). */
  title?: string;
  /** Session source (for list badges/folders), derived from core session_meta — the single source of truth (not stored in the DB); unset for user-created sessions. */
  source?: SessionSource;
  createdAt: string;
  status: SessionStatus;
  /** Number of approvals awaiting human decision (a persisted count outside server events, for list badges). */
  pendingApprovalCount: number;
  /** Number of queued follow-up tasks (`queueIfBusy`) awaiting auto-start once the session is idle. */
  pendingFollowUpCount: number;
  /** Whether a Trace record exists (a Task has been started). */
  hasTrace: boolean;
  /** Whether archived (hidden from the default list, grouped under "Archived"). */
  archived: boolean;
  /**
   * Absolute path of the session's latest Trace file (the current context shard); absent
   * when no Trace exists yet. Populated on the **single-session GET only** — list rows omit
   * it (locating it costs a directory walk per Session). The web's `/model` switch puts it
   * into the new session's `[model_switch_from]` block so the model can read the source
   * history itself when it needs it.
   */
  tracePath?: string;
}

/**
 * Session list category, the sidebar's four-way split applied server-side: archived wins
 * regardless of origin (archiving is an explicit user action), then the origin's bucket,
 * and a Session with no (or an unknown) source is `active` — user-created rows.
 */
export type SessionCategory = "active" | SessionSource | "archived";

/** Per-category totals across an Agent's whole Session list (returned when the list is requested with counts). */
export type SessionCategoryCounts = Record<SessionCategory, number>;

export interface SessionsResponse {
  sessions: SessionInfo[];
  /** Present when the request asked for counts (`counts=1`): totals per category over the full list, not just the returned page. */
  counts?: SessionCategoryCounts;
  /**
   * Present with `counts`: the same totals broken down by Workspace path (only paths
   * with at least one Session appear). The sidebar's workspace grouping decides each
   * group's folders and "More" from its own share, so a group never advertises
   * content that lives in other Workspaces.
   */
  workspaceCounts?: Record<string, SessionCategoryCounts>;
}

/** Server directory browsing (advanced new-Workspace picker): starts from the home directory by default, can navigate up to the root. */
export interface DirEntryInfo {
  name: string;
  /** Absolute path of this subdirectory (can be submitted directly as a Workspace). */
  path: string;
}
export interface DirListResponse {
  /** Absolute path of the current directory (realpath). */
  path: string;
  /** Absolute path of the parent directory; null when already at the root. */
  parent: string | null;
  /** Subdirectory list (sorted by name, files excluded). */
  entries: DirEntryInfo[];
}

export interface SessionCreateRequest {
  /** Upstream id of the session's model; always sent together with provider. Omit both for the Project's default Model. */
  modelId?: string;
  /**
   * Provider group for `modelId`. A model reference is always a complete
   * (provider, modelId) pair — the provider is never inferred, so sending one field
   * without the other returns 400 instead of being resolved.
   */
  provider?: string;
  /** Any existing directory on the server; defaults to auto-creating a temporary Workspace. */
  workspace?: string;
  /** Defaults to allow-all. */
  approvalMode?: ApprovalMode;
}

export interface SessionCreateResponse {
  session: SessionInfo;
}

export interface SessionResponse {
  session: SessionInfo;
}

export interface SessionPatchRequest {
  approvalMode?: ApprovalMode;
  /** Archive / unarchive (default list hides archived). */
  archived?: boolean;
  /** Manual rename; non-empty string, overrides the auto-generated title. */
  title?: string;
}

/**
 * Live in-progress tail of a running Session, carried by `MessagesResponse.live`.
 *
 * Contract (see runtime/live-tail.ts and the GET /messages route): the server captures
 * `cursor` and `fragments` atomically — in one synchronous tick, before starting the
 * trace read — while the Session is running/compacting.
 *   - `cursor`: the Session channel's most recently assigned SSE event id
 *     (`<epoch>-<seq>`); every event published up to and including this id is already
 *     reflected in `fragments`.
 *   - `fragments`: one synthetic `partial_* start` OmniMessage per open streaming
 *     fragment, whose payload carries the full accumulated content so far (text/thinking
 *     prefix, tool-call name + accumulated arguments, tool-output prefix + images), with
 *     the original `origin` chain preserved.
 *
 * Client usage (the bundled Web App's connect-first flow): after applying `messages`,
 * when the cursor's epoch matches the epoch of the SSE events seen on the current
 * connection, drop every buffered **partial** event with seq <= cursor (its content is
 * already inside `fragments`), feed `fragments` through the normal reducer path, then
 * replay the rest of the buffer. Buffered **complete** messages are never dropped by the
 * cursor — the regular overlap dedup decides for them — so nothing is lost even when a
 * complete message's trace append is still in flight at read time.
 */
export interface MessagesLiveTail {
  cursor: string;
  fragments: OmniMessage[];
}

/**
 * Pagination envelope of a windowed `GET /messages` (`tailLimit` / `before` requests
 * only; the parameterless full read never carries it). A window is a run of whole
 * message-bearing units — one unit = one Task in the Web reducer's sense, opened by a
 * main-session user prompt — cut so that no pairing (tool_call/output), compaction span
 * or steering group ever splits across windows.
 */
export interface MessagesPageInfo {
  /**
   * Cursor of this window's first unit (`<shardIndex>:<ordinal>`): pass it back as
   * `before=` to fetch the previous window. Stable across requests and compaction —
   * rotation opens a NEW shard and closed shards are immutable. Absent = this window
   * reaches the very beginning of the transcript (no older history).
   */
  before?: string;
  /**
   * Outline turns (the Web conversation outline's entry rule) opened BEFORE this
   * window: the client offsets its global `第 N 轮` numbering by this, so a partial
   * window never mis-numbers. 0 when the window starts at the beginning.
   */
  earlierTurns: number;
  /**
   * Cumulative stats accrued before this window, seeded into the client's stats
   * tracker so header chips and per-turn cumulative rows equal a full load:
   * finished-Task elapsed, subagent token totals, and the last main-session
   * session/context token readings.
   */
  prior: {
    subagentTokens: number;
    elapsedMs: number;
    sessionTokens: number;
    contextTokens: number;
  };
}

/** Message history: the full messages and events from concatenating all of this Session's Trace files in order (excludes partial_*). */
export interface MessagesResponse {
  messages: OmniMessage[];
  /**
   * Present only while the Session is running/compacting: the in-progress stream tail
   * (open streaming fragments + the channel cursor they cover), so a client joining
   * mid-stream can render the currently streaming message. Omitted when idle. On
   * windowed requests it rides TAIL pages only — a `before` page is immutable history
   * and never carries it.
   */
  live?: MessagesLiveTail;
  /**
   * Present exactly on windowed requests (`tailLimit` / `before`): `messages` is then
   * the requested window (subagent pointers inside it expanded as usual) rather than
   * the full transcript. See MessagesPageInfo.
   */
  page?: MessagesPageInfo;
}

// ---------------------------------------------------------------------------
// Task run, approval, interruption, compaction
// ---------------------------------------------------------------------------

/**
 * A single Prompt's input parts: text, image (data: / http(s) URL), or an uploaded file.
 * Docs: /docs/server-api § "Session-Level Endpoints".
 */
export type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }
  /**
   * File attachment (the composer's "+" menu): `dataUrl` is a base64 `data:` URL of the
   * file's bytes, capped at 10MB each (413 `file_too_large` beyond that; the request as a
   * whole still has to fit the global 20MB body limit). The server writes it into the
   * Session scratchpad under a sanitized name and appends an `[attached file: <path>]` line
   * to the message text — the bytes never enter the conversation, the model opens the file
   * by path. `fileName` is the original name (no path separators, no `..`).
   */
  | { type: "file"; fileName: string; dataUrl: string };

export interface TaskCreateRequest {
  input: TaskInputPart[];
  /**
   * Thinking level for this Task's LLM requests (a per-turn parameter; one of
   * `none | low | medium | high | xhigh`, anything else is a 400). Omitted = falls back to
   * the session's default (the Agent config's `model.thinking_level`). A queued follow-up
   * (`queueIfBusy`) keeps its level and applies it when it auto-starts.
   */
  thinkingLevel?: ThinkingLevelName;
  /**
   * Queue instead of 409 when a Task/compaction is already in progress: the input is held
   * server-side and auto-starts as an ordinary next task once the session returns to idle
   * (in queue order, one at a time). The response then carries `queued: true`.
   */
  queueIfBusy?: boolean;
  /**
   * Present = goal mode: the input's text becomes the objective (leading `[use_skills]`
   * blocks and the like are stripped from the recorded objective; the round-1 message keeps
   * them) and the server loops the Session until the goal reaches a terminal state.
   * `budget` is the token budget (uncached input + output); omitted or -1 = unlimited.
   */
  goal?: { budget?: number };
}

/** Goal-mode run state (from goal_state; the chat page's banner restores from the latest row). */
export interface GoalStateView {
  objective: string;
  status: "active" | "complete" | "blocked" | "budget_limited" | "aborted";
  /** Token budget; -1 = unlimited. */
  budget: number;
  used: number;
  rounds: number;
  updatedAt: string;
}

export interface GoalResponse {
  /** The Session's most recent goal run; null if it never ran one. */
  goal: GoalStateView | null;
}

export interface TaskCreateResponse {
  /** Current actual session_id: a Trace-less invalid Session self-heals and returns a new id; the frontend updates its route accordingly. */
  sessionId: string;
  /** True when `queueIfBusy` enqueued the input as a follow-up instead of starting it (absent/false: the task started). */
  queued?: boolean;
}

/**
 * Mid-run steering (POST /api/sessions/:id/steer): a user message for the **running** Task,
 * delivered by core between turns as a standalone `[user_steering]` user message. 202 on
 * queue; 409 `not_running` when no Task is in progress (the frontend falls back to a normal
 * task POST).
 */
export interface SteerRequest {
  /** Message text (trimmed server-side); may be empty when `images` or `files` carries the message. */
  text: string;
  /**
   * Images sent with the steering message (`data:` or http(s) URLs, same rule as
   * `TaskInputPart.image_url`): delivered as user image messages right behind the
   * `[user_steering]` text. A model without vision receives them as scratchpad path lines
   * instead, exactly as it would a Prompt's images. At least one of `text` / `images` /
   * `files` must be non-empty.
   */
  images?: string[];
  /**
   * File attachments riding the steering message — the same shape, caps and handling as a
   * task input's `{type:"file"}` parts: written into the Session scratchpad and delivered
   * as `[attached file: <path>]` lines on the `[user_steering]` text, so a file-only draft
   * steers exactly like an image-only one instead of falling back to the follow-up queue.
   */
  files?: { fileName: string; dataUrl: string }[];
}

/**
 * One steering message queued on the server but not yet delivered to the model (delivery
 * happens at the next input assembly between turns). Carried on `task_state` events and the
 * SSE subscribe snapshot so the composer's "steering queued" hint — including what was sent —
 * survives reloads; entries leave the list as their `[user_steering]` message appears on the
 * stream, and the whole list drops when the run exits (core discards undelivered steering).
 */
export interface PendingSteeringInfo {
  /** The message text as accepted (trimmed); may be empty when images/files carry the message. */
  text: string;
  /** Number of images that rode along. */
  images: number;
  /** Number of file attachments that rode along. */
  files: number;
}

export interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}

/**
 * POST /api/sessions/:sessionId/retry-now — skip the in-progress reconnect backoff and
 * fire the next retry immediately (the "retry now" button on the reconnect countdown).
 * `skipped: false` is the benign "no reconnect wait in progress" case (idle session, or
 * the wait elapsed in a timing race), not an error.
 */
export interface RetryNowResponse {
  skipped: boolean;
}

// ---------------------------------------------------------------------------
// SSE server events (OmniMessage uses the default event, only server_event here)
// ---------------------------------------------------------------------------

/** Docs: /docs/server-api § "Streaming (SSE)". */
export type ServerEvent =
  /**
   * Approval request escalated to a human: every call under always-ask, plus rw/unknown-permission
   * calls under read-only (see runtime/approvals.ts); pending approvals are resent on reconnect.
   */
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  /** Session run status flip (for toggling the input area and list); `queued` = queued follow-up count (see TaskCreateRequest.queueIfBusy). */
  | {
      type: "task_state";
      state: SessionStatus;
      queued?: number;
      /** Steering messages queued but not yet delivered (absent = none): lets the composer's hint and its content survive reloads. */
      pendingSteering?: PendingSteeringInfo[];
    }
  /** The model-generated title after the first turn has been persisted (for in-place list updates). */
  | { type: "session_title"; sessionId: string; title: string }
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
  /** New session registered (pushed over the parent session's channel for subagent sessions): frontend refreshes the list in place. */
  | {
      type: "session_created";
      projectId: string;
      agentId: string;
      sessionId: string;
      source: SessionSource;
    }
  | ScheduleServerEvent
  | GoalServerEvent;

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
    };

// ---------------------------------------------------------------------------
// Trace browsing and performance analysis
// ---------------------------------------------------------------------------

export interface TraceFileInfo {
  /** Trace file index (one file corresponds to one complete model context). */
  index: number;
  /** Date subdirectory it belongs to (yyyy-mm-dd). */
  date: string;
  sizeBytes: number;
  mtime: string;
}

export interface SessionTracesResponse {
  files: TraceFileInfo[];
}

export interface TraceEventsResponse {
  events: OmniMessage[];
  offset: number;
  limit: number;
  /** Total line count of the file (basis for pagination). */
  total: number;
}

/** Duration span of a single LLM Request (request_begin/request_end paired by proximity). */
export interface RequestSpan {
  beginTs: string;
  endTs?: string;
  durationMs?: number;
  status?: string;
  /** The Task it belongs to (same convention as modelSegments/toolSpans). */
  taskIndex: number;
  /** Compaction request (falls between compaction_begin and compaction_end): excluded from TPS, see TraceTaskStats. */
  compaction?: boolean;
  /**
   * Total human approval wait time within this Request. core does `await approve(tc)` inside
   * the streaming loop — if approval doesn't return, the next chunk isn't consumed and
   * `request_end` can't be emitted either, so the entire human wait falls inside the span
   * (see context-engine's runTurn). Tool **execution** is not included (`void executeOne`,
   * doesn't block the loop).
   */
  approvalWaitMs?: number;
  /** LLM generation duration = durationMs − approvalWaitMs (≥ 0): only this can be used as the TPS denominator, not durationMs. */
  activeMs?: number;
}

/**
 * Per-Task Token / duration figures (aggregated server-side over the **entire** Trace file,
 * aligned with the Chat page's task-stats).
 *
 * Provided separately instead of letting the frontend aggregate `requests` + events itself:
 * the frontend's events are paginated (only the first N), so self-aggregation would mismatch
 * a numerator covering only the first N against a denominator covering the whole file.
 */
export interface TraceTaskStats {
  taskIndex: number;
  /**
   * This turn is a **compaction turn** (compaction forms its own turn); the UI marks it with
   * a "Compaction" badge accordingly. It's treated the same as a user turn: it has Token /
   * cost / duration / TPS, and **counts normally toward global stats** — the global totals are
   * just the sum of the per-turn cards below, the two scopes match, so adding up the per-turn
   * numbers must equal the total.
   */
  compaction?: boolean;
  /**
   * This turn's message index range within the **entire file** (inclusive). A single
   * sequential scan on the server tells which turn each message belongs to; the frontend
   * attributes messages by this, **no longer guessing by timestamp** — the same millisecond
   * can pack "previous turn's last reply + compaction start + compaction prompt + next turn's
   * request_begin", which time boundaries can't separate, misattributing this turn's reply to
   * the next turn.
   */
  messageFrom: number;
  messageTo: number;
  /**
   * This turn's duration span: `startTs` = the moment of this turn's **first `request_begin`**
   * — duration only looks at LLM requests, not the timestamp of user text like the user
   * Prompt / compaction summary (`[context_summary]` is created during compaction but only
   * persisted on the next run; resuming the next day would inflate the first turn by a whole
   * day for no reason); `endTs` = the moment of the last non-session_meta message in the
   * range. For a degenerate turn with no Request at all (interrupted right after sending),
   * `startTs` is an empty string and duration counts as 0.
   */
  startTs: string;
  endTs: string;
  /**
   * Context usage at the end of this Task = the three-bucket Token snapshot of the last
   * **non-compaction** Request (same convention as the Chat page's `contextNow`). Note this
   * must not be the sum of this Task's Requests — each Request's input carries the full
   * history again, so summing double-counts the context, and a few rounds of tool calls
   * would blow past the context window. A pure-compaction Task (no non-compaction Request)
   * has no value here.
   */
  context?: { cacheRead: number; cacheWrite: number; output: number };
  /**
   * This turn's **cumulative** usage (the sum of the three buckets over every Request in this
   * Task), for Token stats and cost conversion. Two different figures from `context`: that one
   * is a snapshot (how much is occupied right now), this one is a ledger (how much this turn
   * spent in total). Includes compaction requests — compaction tokens are real money spent and
   * must be counted; consistent with the Chat page's tokensByBucket.
   */
  tokens: { cacheRead: number; cacheWrite: number; output: number };
  /**
   * Total LLM generation duration for this turn (the denominator for output TPS; human
   * approval wait already deducted). The numerator is simply `tokens.output`: since
   * compaction forms its own turn, each turn's output tokens are just its own Requests'
   * output — there's no second figure to reconcile.
   */
  llmMs: number;
}

/** Duration span of a single tool call (complete tool_call message → paired tool_call_output). */
export interface ToolCallSpan {
  toolCallId: string;
  name: string;
  startTs: string;
  endTs?: string;
  durationMs?: number;
  stopReason?: string;
}

/** Workspace file entry (Files tab). */
export interface WorkspaceFileEntry {
  name: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: string;
}

export interface WorkspaceFilesResponse {
  /** Requested relative path ("" = Workspace root). */
  path: string;
  entries: WorkspaceFileEntry[];
}

/** Batch file existence check (message file cards only list files that actually exist). */
export interface FilesStatRequest {
  /** Paths relative to the Workspace root (≤100 items, each ≤512 characters). */
  paths: string[];
}

export interface FilesStatResponse {
  /** Confirmed existing paths (regular files within bounds), preserving request order and deduplicated; out-of-bounds and resolution failures count as non-existent. */
  existing: string[];
}

/**
 * Model serial segments (autoregressive decoding): Trace records completion times, so each
 * segment's duration = its own time − the previous event's time (the request's first segment
 * is based on request_begin; user input is treated as sent instantaneously and takes no
 * segment).
 */
export interface TraceModelSegment {
  kind: "thinking" | "text" | "tool_call";
  startTs: string;
  endTs: string;
  /** Given when kind=tool_call. */
  toolCallId?: string;
  name?: string;
  /** The Task it belongs to (a single user turn can contain multiple Requests): the frontend groups by this, each Task on its own independent timeline. */
  taskIndex: number;
}

/**
 * Tool full lifecycle (parallel to model decoding): initiated (callTs) → approved
 * (approvalTs) → output (outputTs). Unclosed fields are unset (approval pending / executing /
 * file truncated).
 */
export interface TraceToolSpan {
  toolCallId: string;
  name: string;
  callTs: string;
  approvalTs?: string;
  decision?: string;
  outputTs?: string;
  stopReason?: string;
  /** The Task that initiated this tool (grouped with its tool_call segment): async output belongs to this Task even if it arrives after request_end. */
  taskIndex: number;
}

export interface UsageTrendPointInTrace {
  ts: string;
  requestTotal: number;
  sessionTotal: number;
}

export interface TraceAnalysisResponse {
  /**
   * Sum of all turns' durations (**including compaction turns**, same scope as `tasks` — the
   * global figure is just the sum of the per-turn figures below; gaps between turns where the
   * user is thinking or away are not counted). Computed server-side over the entire file: the
   * frontend's events are paginated, so self-aggregation would undercount.
   */
  elapsedMs: number;
  requests: RequestSpan[];
  /** Token / duration aggregated per Task (used directly by the Trace page's context ring and per-turn TPS). */
  tasks: TraceTaskStats[];
  toolCalls: ToolCallSpan[];
  /** Execution timeline: model serial segments (LLM lane). */
  modelSegments: TraceModelSegment[];
  /** Execution timeline: each tool's approval/execution phases (independent lane, can overlap with model decoding). */
  toolSpans: TraceToolSpan[];
  /** Number of request_end events with status ∈ {timeout, malformed}. */
  reconnectCount: number;
  /** Number of compaction_begin events. */
  compactionCount: number;
  usageTrend: UsageTrendPointInTrace[];
}

export interface AgentTraceFileRef {
  index: number;
  sizeBytes: number;
}

export interface AgentTraceSessionGroup {
  sessionId: string;
  files: AgentTraceFileRef[];
}

export interface AgentTraceDateGroup {
  date: string;
  sessions: AgentTraceSessionGroup[];
}

/** One Trace file in the session-centric listing (`date` carried per file: one Session's shards can span date directories). */
export interface AgentTraceSessionFile {
  index: number;
  date: string;
  sizeBytes: number;
}

/** One Session's Trace files merged across date directories (the paginated listing's unit). */
export interface AgentTraceSessionEntry {
  sessionId: string;
  /**
   * Display title, resolved only for the returned page: the sessions DB title when one
   * exists, else derived from the Session's first user prompt (bounded head-read of the
   * earliest shard); absent when neither yields one (the client falls back to its
   * default title — raw session ids are never rendered).
   */
  title?: string;
  /**
   * Sidebar category of this Session, from the same bounded classification the listing
   * filters and counts with: archived exactly from the DB row; origin from the shared
   * in-process registry / previously observed session_meta; a DB-untracked Session this
   * process has not yet head-read falls into `active` until a page surfaces it (its
   * head-read then registers the true origin for subsequent requests).
   */
  category: SessionCategory;
  /** Workspace path locked at creation (DB row or observed session_meta); "" when unknown — the client's merged temp-group fallback. */
  workspace: string;
  /** Sorted by index ascending (a higher index is newer). */
  files: AgentTraceSessionFile[];
}

/**
 * Agent-level Trace browsing structure. Without `limit` the response is the legacy full
 * drill-down (`dates`: Agent → date → Session → Trace file, reverse chronological) and the
 * paging fields are absent. With `offset`/`limit` the response is session-group-centric:
 * `sessions` carries the requested slice (newest first by sessionId desc — ids embed a
 * timestamp, so that is reverse chronological) with titles and classification,
 * `totalSessions` the session-group count (within `category` when one is given, so paging
 * and the count agree), `counts` / `workspaceCounts` the per-category totals over ALL of
 * the Agent's session groups (folder labels / workspace-mode group headers), and `dates`
 * stays empty (per-file stats are only taken for the returned page).
 */
export interface AgentTracesResponse {
  dates: AgentTraceDateGroup[];
  /** Present only when the request paginates: the requested slice of Session groups, newest first. */
  sessions?: AgentTraceSessionEntry[];
  /** Present only when the request paginates: session-group count of the paged (category-filtered) set. */
  totalSessions?: number;
  /** Present only when the request paginates: per-category totals over all of the Agent's session groups. */
  counts?: SessionCategoryCounts;
  /** Present only when the request paginates: `counts` broken down by Workspace path ("" = unknown). */
  workspaceCounts?: Record<string, SessionCategoryCounts>;
}

export interface TraceImportRequest {
  /** Base64 of the Trace file content (JSON Lines; the first record must be `session_meta`). */
  dataBase64: string;
}

export interface TraceImportResponse {
  /** Session id taken from the imported file's `session_meta`. */
  sessionId: string;
  /** Allocated file index: always 1 — an import creates a new Session (a duplicate session id is rejected with 409 `trace_session_exists`). */
  index: number;
  /** Date directory the file landed in (local yyyy-mm-dd from the first record's timestamp, matching the Trace Writer's convention). */
  date: string;
}

// ---------------------------------------------------------------------------
// Usage and cost statistics
// ---------------------------------------------------------------------------

export type UsageGroupBy = "date" | "agent" | "model" | "session";

export interface UsageBucket {
  total: number;
  requests: number;
  /** Cost converted using current pricing at query time (USD); a partial sum when uncosted Models are included, null if none has pricing. */
  cost: number | null;
  /** Whether any Model has no pricing (its usage isn't included in cost; counted once pricing is added later). */
  hasUncosted: boolean;
}

export interface UsageGroupRow {
  /** Group key: date / agentId / modelId / sessionId. */
  key: string;
  /** Provider group when groupBy=model (rows are broken down by (provider, modelId); unset for other dimensions). */
  provider?: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  requests: number;
  cost: number | null;
  hasUncosted: boolean;
}

export interface UsageTrendPoint {
  date: string;
  total: number;
  cost: number | null;
  /** Daily Token buckets (for the cost center's "Token Changes" stacked chart: cacheRead/cacheWrite/output). */
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Invocation count per Agent (for the cost center's "Agent Invocation Count" chart). */
export interface UsageAgentCount {
  agentId: string;
  requests: number;
  total: number;
}

/** Request success rate per Model (for the cost center's "Model Success Rate" chart; rows broken down by (provider, modelId)). */
export interface UsageSuccessRate {
  provider: string;
  modelId: string;
  /** Number of successful requests. */
  completed: number;
  /** Success rate denominator = all requests − aborted (user-initiated interruption isn't a model failure and shouldn't lower the success rate). */
  total: number;
  /** Count of user interruptions (excluded from success rate, shown separately). */
  aborted: number;
  /** Failure breakdown (shown on hover; unknown statuses count toward total but not these three). */
  failed: number;
  timeout: number;
  malformed: number;
}

/** Occurrence count of an error for a given source · code (the "most common" metric in the stats center's error panel). */
export interface UsageErrorCount {
  source: string;
  code: string;
  kind: string;
  count: number;
}

/** A single error summary (one row in the stats center's error panel table). */
export interface UsageErrorItem {
  ts: string;
  source: string;
  code: string;
  kind: string;
  message: string;
}

/**
 * Server-side error capture stats: not affected by the model
 * filter (HTTP / process errors have no Model dimension), but affected by date and agent
 * filters. Errors with no Project attribution (login, process-level) are counted in every
 * Project's view. The stats center presents this as "summary stats + detail table" with no
 * chart, so it only has a total count, the most common error code, and the most recent N
 * items.
 */
export interface UsageErrors {
  total: number;
  /** Count of unexpected ones (500 / runtime exceptions) among them — the part the frontend highlights. */
  unexpected: number;
  /** The most frequent source · code (null when there are no errors). */
  topCode: UsageErrorCount | null;
  /** Most recent N items (reverse chronological) — the first page; older ones come from `GET /usage/errors`. */
  recent: UsageErrorItem[];
}

/**
 * GET /api/projects/:projectId/usage/errors — one page of the error detail table, newest
 * first. The dashboard response above already carries the first page; this exists so
 * "show me earlier ones" does not have to refetch the whole aggregate. It takes the same
 * date/agent filter as the dashboard, so a page never widens what the summary counted.
 */
export interface UsageErrorsPage {
  items: UsageErrorItem[];
  /** Filtered row count, so the caller knows when it has reached the end. */
  total: number;
}

export interface UsageResponse {
  summary: {
    today: UsageBucket;
    last7d: UsageBucket;
    total: UsageBucket;
  };
  groupBy: UsageGroupBy;
  groups: UsageGroupRow[];
  /** Daily trend for the last 30 days (includes Token buckets and cost; affected by agent/model filters). */
  trend: UsageTrendPoint[];
  /** Invocation count per Agent (affected by date/model filters). */
  byAgent: UsageAgentCount[];
  /** Raw success rate counts per Model (affected by date/agent filters). */
  success: UsageSuccessRate[];
  /** Server-side error capture stats (affected by date/agent filters; unaffected by model filter). */
  errors: UsageErrors;
  /** List of Agent ids that have appeared in this Project (for the filter dropdown; unaffected by current filters). */
  agentIds: string[];
  /** List of Model paired references that have appeared in this Project (for the filter dropdown). */
  models: ModelRefDto[];
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Display-facing schedule status: the file's `enabled` only expresses intent; the rest is derived from runtime state. */
export type ScheduleStatus = "active" | "disabled" | "expired" | "done" | "missed" | "invalid";

export interface ScheduleItem {
  /** Filename (without .toml) is the identifier. */
  name: string;
  prompt: string;
  enabled: boolean;
  /** ISO 8601. */
  startAt: string;
  /** Raw fixed interval (e.g. `30m`); unset means a one-off task. */
  period?: string;
  endAt?: string;
  /** Bound target Session; defaults to creating a new Session each time. */
  sessionId?: string;
  workspace?: string;
  /** Model for new-Session mode (upstream id, always paired with provider); absent means the Project's default reference. */
  modelId?: string;
  /** Provider group for `modelId`; present exactly when `modelId` is — a model reference is always a pair. */
  provider?: string;
  status: ScheduleStatus;
  invalidReason?: string;
  /** Next scheduled fire time (ISO 8601); unset when done/missed/invalid/disabled. */
  nextFireAt?: string;
  /** Most recent actual fire time (ISO 8601). */
  lastFiredAt?: string;
  /** Queued, waiting for the target Session to become idle. */
  queued: boolean;
  creatorUserId?: string;
}

export interface SchedulesResponse {
  schedules: ScheduleItem[];
  /** Files that failed to parse (skipped from scheduling and logged as errors). */
  invalidFiles: Array<{ name: string; error: string }>;
}

export interface ScheduleUpsertRequest {
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  sessionId?: string;
  workspace?: string;
  /** Model for new-Session mode (upstream id); always sent together with provider, omit both for the Project's default reference. */
  modelId?: string;
  /**
   * Provider group for `modelId`. Both fields are sent as a pair (400 otherwise); the
   * pair is checked against the Project config at save/reconciliation time.
   */
  provider?: string;
}

// ---------------------------------------------------------------------------
// Agent State version and snapshots
// ---------------------------------------------------------------------------

export interface AgentImportRequest {
  /** Base64 of the snapshot package (tar.gz). */
  dataBase64: string;
  /** Explicit confirmation is required when the package version is equal to or lower than the current version, otherwise 409. */
  confirm?: boolean;
}

export interface AgentImportResponse {
  /** Agent State version number after import (taken from the package's value). */
  version: number;
}

// ---------------------------------------------------------------------------
// Benchmark scoring (read-only display)
// ---------------------------------------------------------------------------

/** Raw result of a single run (a scoreboard per-case runs[] entry). */
export interface BenchmarkRunScore {
  score: number;
  /** Run cost, or null when unavailable. */
  cost: number | null;
  durationMs: number;
  /** Id of the Session under test in this run (links to Trace). */
  sessionId: string;
}

export interface BenchmarkCaseScore {
  case: string;
  /** Model-written average of this Case's Run scores, on the fixed 0..100 scale. */
  score: number;
  /** Model-written average of known Run costs; null when every Run cost is unknown. */
  cost: number | null;
  /** Model-written average of Run durations, rounded to an integer. */
  durationMs: number;
  /** Raw results per Run. */
  runs: BenchmarkRunScore[];
}

export type BenchmarkRole = "general" | "development" | "promotion";
export type BenchmarkEvaluationKind =
  "formal_baseline" | "development_candidate" | "promotion_candidate";
export type PromotionDecision = "promoted" | "restored";

export interface BenchmarkEvaluation {
  /** Evaluation timestamp (ISO 8601). */
  time: string;
  /** Evaluation summary title (a one-line conclusion; shown separately from the body summary; required when generating, tolerated as unset when displaying). */
  summaryTitle?: string;
  /** Evaluation summary body: how the score was derived, what optimizations were made to the Agent this round (required when generating, tolerated as unset when displaying). */
  summary?: string;
  /** Model actually used for this evaluation round (upstream id, paired with provider; the chart series is split by model). */
  modelId: string;
  /** Provider group for `modelId`. */
  provider: string;
  /** Thinking level read from the unchanged Target Agent configuration. */
  thinkingLevel: string;
  /** Agent State version number under test. */
  version: number;
  /** Optional workflow meaning. Missing on general and pre-contract records. */
  evaluationKind?: BenchmarkEvaluationKind;
  /** Top-level Optimizer Session that produced this Candidate. */
  optimizationSessionId?: string;
  /** Production Agent State version in force before this Optimization Batch. */
  productionReferenceVersion?: number;
  /** Promotion gate result. Only meaningful on a promotion_candidate record. */
  promotionDecision?: PromotionDecision;
  /** Model-written average of Case scores, on the fixed 0..100 scale. */
  score: number;
  /** Model-written average of known Case costs; null when every Case cost is unknown. */
  cost: number | null;
  /** Model-written average of Case durations, rounded to an integer. */
  durationMs: number;
  cases: BenchmarkCaseScore[];
}

export interface BenchmarkSummary {
  /** Directory name is the identifier (semantic naming, e.g. swe-bench-v1). */
  id: string;
  /** Title from benchmark_config.toml; falls back to the directory name if unset. */
  title: string;
  description?: string;
  /** Workflow role; missing and invalid config values are exposed as general. */
  role: BenchmarkRole;
  /** Explicit counterpart used by Development/Promotion workflows. */
  pairedBenchmarkId?: string;
  /** Number of runs per case (the `runs` field in benchmark_config.toml, ≥1; defaults to 1). */
  runs?: number;
  /** Case count (number of case subfolders). */
  caseCount: number;
  /** Time-ordered evaluation records (the evaluations[] in scoreboard.yaml). */
  evaluations: BenchmarkEvaluation[];
}

export interface BenchmarksResponse {
  benchmarks: BenchmarkSummary[];
}

export type CaseMaterial = "statement" | "rubric";

/** Public Benchmark Case metadata. Rubric and Gold content are never included. */
export interface BenchmarkCaseSummary {
  id: string;
  /** First Markdown heading with an optional leading "Case N:" removed; falls back to id. */
  title: string;
}

export interface BenchmarkCasesResponse {
  cases: BenchmarkCaseSummary[];
}

// ---------------------------------------------------------------------------
// Skill library and Agent's installed Skills
// ---------------------------------------------------------------------------

export interface SkillMetadataItem {
  /** Skill directory name (the identity key for install / uninstall / Prompt addressing). */
  name: string;
  description: string;
  /** Short description for frontend display (frontmatter short_description, optional; falls back to description if missing). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /** Custom icon (raw icon.svg text from the skill directory, optional; frontend falls back to a default book icon if missing). */
  icon?: string;
  /** Version number (natural number, frontmatter version; falls back to 1 if invalid). */
  version: number;
  /** Update date (YYYY-MM-DD, frontmatter updated; defaults to an empty string). */
  updated: string;
}

export interface SkillGroupItem {
  id: string;
  title: string;
  /** Chinese group title (optional; the UI displays it per language). */
  titleZh?: string;
  skills: SkillMetadataItem[];
}

/** GET /api/skills: library groups and metadata (excludes body content). */
export interface SkillLibraryResponse {
  groups: SkillGroupItem[];
}

/** GET|POST /api/projects/:p/agents/:a/skills: Skills installed on this Agent. */
export interface AgentSkillsResponse {
  skills: SkillMetadataItem[];
}

/** POST install request: all names must exist in the library; already-installed ones are overwritten with library content (i.e. updated). */
export interface SkillInstallRequest {
  names: string[];
}

/**
 * POST /api/projects/:p/agents/:a/skills/archive: install one Skill from an uploaded zip.
 * Layout: SKILL.md at the zip root, or exactly one top-level directory containing SKILL.md
 * (the directory name is then the Skill name). 201 returns the refreshed installed list
 * (AgentSkillsResponse); an already-installed name without `overwrite` is 409 `skill_exists`.
 */
export interface SkillArchiveInstallRequest {
  /** Base64-encoded zip archive (decoded size capped at 14MB, same as the Agent snapshot import). */
  dataBase64: string;
  /** Replace an already-installed Skill of the same name (deletes its directory first). */
  overwrite?: boolean;
}

// ---------------------------------------------------------------------------
// Version and self-update
// ---------------------------------------------------------------------------

/** GET /api/version: the running server's release identity (from core's VERSION / BUILD_DATE). */
export interface VersionResponse {
  version: string;
  /**
   * The **running** version's release date (UTC yyyy-mm-dd), stamped into core's
   * BUILD_DATE at build time by the release workflow — the web's "last updated" date
   * needs no network. Null for a dev/source build and for releases that predate the
   * stamping (v0.1.2 and earlier): the UI then shows the version alone.
   */
  buildDate: string | null;
}

/**
 * GET /api/version/update-check: newest published release vs the running version.
 * Always HTTP 200 (fail-soft): a lookup failure sets `error` and leaves `latestVersion`
 * null rather than failing the request; results are cached server-side.
 */
export interface UpdateCheckResponse {
  currentVersion: string;
  /** Same as VersionResponse.buildDate: the running version's release date, stamped at build time. */
  buildDate: string | null;
  /** Newest published release (normalized, no leading `v`); null when the lookup failed or checks are disabled. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Release page of the newest release (for the "release notes" link). */
  releaseUrl: string | null;
  /** Publish timestamp of the newest release (ISO 8601). */
  publishedAt: string | null;
  /** When this result was produced (ISO 8601) — a cached result keeps its original timestamp. */
  checkedAt: string;
  /** Present (true) when update checks are turned off via PENGUIN_UPDATE_CHECK=off; no network call was made. */
  disabled?: true;
  /** Why the lookup failed: unreachable network / GitHub rate limit / unusable response. */
  error?: "network" | "rate_limited" | "bad_response";
}

/**
 * POST /api/version/update (admin only): runs the CLI self-update (`penguin update --yes`)
 * on the server host. `unsupported` covers both a server not launched via the CLI and the
 * CLI's own refusals (source checkout, unrecognized install layout, Windows).
 */
export interface UpdateRunResponse {
  status: "updated" | "failed" | "unsupported";
  /** Set when the server cannot run the CLI at all (started without `penguin server|web`). */
  reason?: "not_launched_via_cli";
  /** Tail of the update command's combined stdout+stderr (capped; empty when nothing ran). */
  output: string;
  /** True when the install changed (or was already current): restart the service to run the new version. */
  needsRestart: boolean;
}
