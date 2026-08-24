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
import type {
  CompactionMode,
  OmniMessage,
  ToolCallPayload,
} from "@prismshadow/penguin-core/omnimessage";
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
   * Whether Workspace HTML previews open on a separate origin (the loopback
   * counterpart of the App host, or PENGUIN_PREVIEW_ORIGIN when set). False means this
   * deployment has no usable preview origin —
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
   * field when changing the password.
   */
  desktopMode: boolean;
  /**
   * How THIS session was established. Distinct from desktopMode: a browser signed into a
   * desktop-mode server holds a "password" session and must still provide the old
   * password when changing it — only "desktop" sessions (opened by the shell's one-shot
   * token) may omit it.
   */
  sessionVia: "password" | "desktop";
  /**
   * The upload limits currently in force, so the composer can refuse an oversize pick before
   * reading it and can name the real number in the message. They are admin-settable and ride
   * `/api/me` rather than `/api/admin/settings` because every user's composer needs them, not
   * just an admin's.
   */
  uploadLimits: UploadLimits;
}

/**
 * Upload limits as the web app sees them: whole MB, the same unit the admin form uses, so the
 * number in the error message is the number the admin typed.
 */
export interface UploadLimits {
  /** Per-file cap for composer file attachments. */
  attachmentMaxMb: number;
  /** Per-message total of decoded attachment bytes. */
  attachmentTotalMb: number;
  /** Per-message file count. Fixed server-side, not admin-settable. */
  attachmentMaxCount: number;
  /**
   * Per-image cap for images that ride the conversation inline. Fixed server-side and
   * deliberately far below the attachment cap — an inline image enters the conversation and the
   * Trace, where its size is paid again on every history page and every resume.
   */
  imageMaxMb: number;
  /**
   * The range the two admin-settable limits may be set to. Carried here so the admin form states
   * the real bounds without compiling its own copy of them — the server is the only place that
   * decides how large an upload it can survive.
   */
  attachmentLimitMinMb: number;
  attachmentLimitMaxMb: number;
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

/**
 * Admin-level server-global settings (SQLite server_settings):
 * two independent proxy switches sharing one optional explicit address. In every
 * on-state the effective NO_PROXY always includes localhost/127.0.0.1/::1 (loopback is
 * never proxied), and changes apply to newly initiated connections/spawns immediately —
 * no restart.
 */
export interface ServerSettings {
  /**
   * "Application uses the proxy" (default on): the server's own outbound traffic (LLM
   * requests, the update check, image fetches). On with `proxyUrl` set = that address
   * for both http and https; on without an address = the proxy environment variables
   * HTTP_PROXY / HTTPS_PROXY (both spellings); off = always direct.
   */
  proxyForApp: boolean;
  /**
   * "Agent environment uses the proxy" (default on): agent command subprocess
   * environments. On with `proxyUrl` set = HTTP_PROXY / HTTPS_PROXY (plus lowercase
   * twins) injected as that address with the merged NO_PROXY, overriding inherited
   * values; on without an address = the host environment passes through unchanged;
   * off = the proxy variables are stripped (NO_PROXY kept).
   */
  proxyForAgent: boolean;
  /**
   * The shared explicit proxy address (a canonical URL — http(s):// or socks5:// /
   * socks://), or null = follow the proxy environment variables. When set it takes
   * precedence over HTTP_PROXY / HTTPS_PROXY wherever the owning switch is on.
   */
  proxyUrl: string | null;
  /**
   * Per-file cap for composer file attachments, in whole MB (default 100). Applies to the very
   * next upload — the validators read it per request, nothing is snapshotted at boot.
   */
  attachmentMaxMb: number;
  /**
   * Per-message total of decoded attachment bytes, in whole MB (default 120). Never below
   * `attachmentMaxMb`, so a message may always carry one full-size attachment. The global request
   * body cap is derived from this value (base64 inflates it by 4/3, plus headroom for one inline
   * image and the JSON framing), which is why raising it needs no separate setting.
   */
  attachmentTotalMb: number;
}

export interface ServerSettingsResponse {
  settings: ServerSettings;
}

/** PUT body: every field optional, omitted fields keep their current value (mirrors prefs). */
export interface ServerSettingsUpdateRequest {
  proxyForApp?: boolean;
  proxyForAgent?: boolean;
  /**
   * New proxy address. Accepted forms: any proxy URL undici's dispatcher takes —
   * `http://`, `https://`, `socks5://` / `socks://`, credentials allowed — or bare
   * `host[:port]` (normalized to `http://…`; only normalized values are stored, and the
   * response echoes the stored form). Empty/whitespace-only or null clears the address
   * (follow the environment variables); anything else is 400 `invalid_proxy_url`.
   */
  proxyUrl?: string | null;
  /**
   * New per-file attachment cap in whole MB. Must be an integer between 1 and 200; anything else
   * — a fraction, a string, 102400 for "100GB" — is 400 `invalid_attachment_limit` and writes
   * nothing.
   */
  attachmentMaxMb?: number;
  /**
   * New per-message total attachment cap in whole MB. Same 1..200 integer range, and additionally
   * must not be below the *effective* per-file cap (the value in the same PUT, or the stored one
   * when this PUT does not change it) — a total below the per-file cap would make a legal single
   * attachment unsendable. Violations are 400 `invalid_attachment_limit`.
   */
  attachmentTotalMb?: number;
}

/**
 * One draft-screen shortcut: a prompt the user wrote, filed under a name they chose. Clicking it
 * fills the composer exactly like a built-in example does, and sends nothing. Deliberately holds
 * no Skill list — a saved prompt is not authored against a known Skill catalog the way a shipped
 * example is, and the Agent it will run under is picked after the click.
 */
export interface DraftShortcut {
  /** Stable client-generated id: what an edit or a delete addresses the row by. Unique per user. */
  id: string;
  title: string;
  prompt: string;
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
  /** The initial-password notice banner (app layout) was permanently dismissed by the user. */
  initialPasswordBannerDismissed?: boolean;
  /**
   * The draft screen's user-defined shortcuts, in display order. Replaced whole on every write
   * (the merge is shallow, so the array is one field like any other) and bounded on write by
   * services/draft-shortcuts.ts — count, title length and prompt length — because this is the one
   * known key holding user-authored text rather than a flag or an id.
   */
  draftShortcuts?: DraftShortcut[];
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
  /** AgentHub client protocol (`openai-chat`, `openai-responses`, etc.); defaults to AgentHub inferring it from modelId. */
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
  /**
   * Per-model fast mode (TOML `fast_mode` annotation; user-only, never preset by the
   * built-in catalog): when true, session requests opt into the provider's faster serving
   * tier at premium pricing (AgentHub UniConfig `fast_mode`). Only `true` is reported;
   * unset = off. Models without a fast tier reject requests carrying it.
   */
  fastMode?: boolean;
  pricing?: ModelPricingDto;
  /** Environment variable name to fall back to when api_key is empty (e.g. ANTHROPIC_API_KEY); unset if no known fallback. */
  envKey?: string;
  /**
   * Masked preview (same rule as `credential.apiKeyMasked`) of the value the server process
   * currently holds for `envKey` — the plaintext is never serialized. Reported only for
   * first-party official entries (vendor group, catalog shape unmodified); gateway, custom
   * and user-defined groups never carry it. Absent = the variable is unset or empty, or the
   * entry is not first-party.
   */
  envKeyMasked?: string;
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
  /** Per-model fast mode: only `true` is persisted; omitted or `false` clears the annotation (absent = off). */
  fastMode?: boolean;
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
  /**
   * Test with fast mode (the frontend always sends the form's current value, so an unsaved
   * toggle — either direction — is what gets tested); omitted falls back to the stored
   * annotation. Lets "Test connection" surface a fast-mode rejection before saving.
   */
  fastMode?: boolean;
}

/**
 * Vision capability probe: sends one 1x1 image and a one-word prompt on this model's
 * credential, to decide whether the models dialog's "supports vision" switch should be
 * turned on. The body mirrors the connectivity test (same paired reference and same
 * not-yet-saved overrides), so an unsaved model can be probed before it exists on disk.
 *
 * Unlike protocol detection this is a real, billed completion — an image request cannot be
 * shaped to cost nothing — so it only ever runs when the user presses the control.
 */
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

/**
 * Vision probe verdict. `supported` = the model took the image and answered; `unsupported`
 * = it answered specifically that it will not take an image (a definitive negative, not an
 * error); `failed` = the probe never got a usable answer (auth, network, an unrelated
 * error), so nothing about the capability was learned and the setting is left alone.
 */
export type ModelVisionOutcome = "supported" | "unsupported" | "failed";

/** Vision probe result; `message` carries the truncated provider error for the failed case. */
export interface ModelVisionDetectResponse {
  outcome: ModelVisionOutcome;
  message?: string;
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
 * Protocol auto-detection (POST /api/projects/:p/models/detect, owner): probes which of
 * AgentHub's generic protocol clients a custom base URL serves — `openai-responses` first,
 * then `ant-messages`, then `openai-chat` — and reports the first hit. Used by the custom
 * model dialog to fill `clientType` from the endpoint itself; costs no tokens (each probe
 * is a minimal invalid request whose error reveals the protocol shape).
 */
export interface ModelProtocolDetectRequest {
  /** Base URL to probe (as typed in the form); each probe appends its protocol path. */
  baseUrl: string;
  /** Newly entered API key (plaintext); used for probe auth if provided. Detection also works keyless: a protocol-shaped 401/403 still proves the route. */
  apiKey?: string;
  /** "Clear saved API key" is checked: do not fall back to the stored key (probe the current draft). */
  clearApiKey?: boolean;
  /** Optional paired reference: when it names a stored entry and no apiKey is given, that entry's saved key backs the probes (mirrors the connectivity test). */
  provider?: string;
  modelId?: string;
}

/**
 * One probe's outcome: `served` = the route answered in an API shape (including auth
 * failures — 401/403 with a protocol-shaped body proves the route exists);
 * `route_missing` = 404/405; `server_error` = 5xx (proves nothing about the path);
 * `junk` = HTML / non-JSON / JSON matching no API shape; `timeout` / `network_error` =
 * the request itself failed.
 */
export type ProtocolProbeOutcome =
  "served" | "route_missing" | "server_error" | "junk" | "timeout" | "network_error";

/** One probe, for debugging display: the probed URL derives from baseUrl only (never contains the key). */
export interface ModelProtocolProbeDto {
  /** AgentHub client type this probe stands for (`openai-responses` / `ant-messages` / `openai-chat`). */
  clientType: string;
  /** Full URL probed (base URL + the protocol's path). */
  url: string;
  outcome: ProtocolProbeOutcome;
  /** HTTP status, when a response arrived at all. */
  status?: number;
}

/** Detection result: probes run sequentially and stop at the first served protocol, so `probes` lists only the ones actually run, in order. */
export interface ModelProtocolDetectResponse {
  /** The first protocol the endpoint serves (an AgentHub client type); absent when none of the three matched. */
  detected?: string;
  probes: ModelProtocolProbeDto[];
}

/**
 * Endpoint model listing (POST /api/projects/:p/models/list, owner): given a base URL and
 * the protocol `/detect` reported, returns every model id the endpoint serves (AgentHub's
 * `listModels()` on the routed client). Used by the add-group dialog to import a provider's
 * whole listing in one go; the ids come back in the endpoint's own order.
 */
export interface EndpointModelListRequest {
  /** Endpoint base URL (as typed in the add-group dialog). */
  baseUrl: string;
  /** AgentHub client type to speak (normally a detected generic protocol; whole-endpoint listings need one). */
  clientType: string;
  /** Newly entered API key (plaintext); omitted = the SDK's environment fallback for the protocol. */
  apiKey?: string;
}

/** Listing outcome: model ids on success, a truncated provider/SDK reason otherwise. */
export interface EndpointModelListResponse {
  ok: boolean;
  /** The model ids the endpoint serves, in the order the endpoint returned them (ok only). */
  models?: string[];
  /** The routed client has no models endpoint (AgentHub UnsupportedOperationError) — callers offer the manual path. */
  unsupported?: boolean;
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
   * "none" — only the selectable tiers.
   */
  thinkingLevel?: Exclude<ThinkingLevelName, "none">;
}

// ---------------------------------------------------------------------------
// Sandbox command policy (Project-level: the [command_policy] block)
// ---------------------------------------------------------------------------

/**
 * One deny rule of the sandbox command policy — plain project-editable data. The factory
 * rules are seeded into new projects and carry no special status thereafter: every rule
 * can be edited, disabled, or deleted.
 */
export interface CommandPolicyRuleDto {
  name: string;
  /** JavaScript regex source, matched against the whitespace-normalized command. */
  pattern: string;
  /** What the rule catches (free text). */
  description?: string;
  /** Per-rule switch, effective value (defaults on). */
  enabled: boolean;
}

/**
 * Per-Project sandbox command policy: deny rules for shell commands, evaluated ahead of
 * the approval mode (a hit is denied even under allow-all). Serves as the GET response and
 * the PUT response. The PUT request body carries `enabled?` plus the full `rules` list
 * (required — a PUT always materializes the list into the config, model-presets style);
 * per-rule `enabled` may be omitted there and defaults to on. Owner-only to write; any
 * member may read.
 */
export interface CommandPolicyDto {
  /** Effective master switch; an absent stored value reads as true (the policy defaults on). */
  enabled: boolean;
  /** The effective rule list — the factory set when the project predates seeding and has none stored. */
  rules: CommandPolicyRuleDto[];
  /** The factory set, served for the settings UI's "restore defaults". */
  defaultRules: CommandPolicyRuleDto[];
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
  /** Whether the config's kernel stamp is behind the current defaults generation (a missing stamp counts as outdated) — drives the list card's update hint. */
  kernelOutdated: boolean;
  /** Vault key count (number of keys in agent_state/.vault.toml). */
  vaultKeyCount: number;
  /** Schedule count (number of .toml files under agent_state/schedule/, including invalid ones). */
  scheduleCount: number;
  /** Installed Skill count (number of agent_state/skills/<name>/ directories with a SKILL.md). */
  skillCount: number;
  /** Memory count (topic files summed over the scope directories under agent_state/memory/, independent of the memory switch). */
  memoryCount: number;
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
  /**
   * Library Skill names installed into the new Agent, seeding it at creation. Every name must
   * exist in the library (404 `unknown_skill` otherwise, before anything is created); omitted or
   * empty leaves the Agent with no Skills, which is what a plain Agent gets by default.
   */
  skills?: string[];
  /**
   * Skills imported from a directory on disk instead of the library. `skillsDirectory` is the
   * absolute path the user picked and `directorySkills` are the names to install from it, read
   * back from `.agents/skills` / `.claude/skills` at creation time. Both are required together,
   * and every name must still be there (404 `unknown_skill` otherwise, before anything is
   * created) — the client sends names, never Skill content.
   */
  skillsDirectory?: string;
  directorySkills?: string[];
  /**
   * Base64 of an exported Agent State snapshot package (`.tar.gz`): the new Agent is
   * initialized from the package instead of the default template. Mutually exclusive with
   * skill seeding (`skills` / `skillsDirectory`) — the package carries its own skills.
   * Explicit `name` / `description` override the package's values; absent ones keep them.
   */
  dataBase64?: string;
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

/** Memory config. All fields report effective values (a config with no `memory` section reads as enabled with the built-in prompts, matching core); the prompts are edited on the Memory tab. */
export interface AgentMemoryConfigDto {
  enabled: boolean;
  /** The always-injected half of the `{{MEMORY}}` block (carries `{{USER_MEMORY_INDEX}}`; the User directory is literal text). */
  prompt: string;
  /** Appended only in a persistent Workspace (carries `{{WORKSPACE_MEMORY_INDEX}}` and the rendered `{{WORKSPACE_MEMORY_DIR}}` directory). */
  workspacePrompt: string;
}

/**
 * Vault prompt-injection config, edited on the Vault tab. `enabled` / `prompt` report
 * effective values (a config with no `vault` section reads as enabled with the built-in
 * prompt, matching core); the last two are read-only facts computed from the stored template.
 */
export interface AgentVaultConfigDto {
  /** Whether the Vault section enters the model context (values are injected into subprocesses regardless). */
  enabled: boolean;
  /** The `{{VAULT}}` block (carries `{{VAULT_KEYS}}`). */
  prompt: string;
  /** Whether the stored template carries `{{VAULT}}`; POST …/vault/template-placeholder inserts (or migrates to) it explicitly. */
  templateHasPlaceholder: boolean;
  /** Whether the stored template still carries the legacy hardcoded # Vault section verbatim (a pre-`{{VAULT}}` Agent) — the migration case of the insert endpoint. */
  legacySectionPresent: boolean;
}

/** Skills prompt-injection config, edited on the Skills tab; same field semantics as AgentVaultConfigDto, for `{{SKILLS}}` / `{{SKILL_METADATA}}` and the legacy # Skills section. */
export interface AgentSkillsConfigDto {
  /** Whether the Skills section enters the model context (installed skills remain explicitly invocable regardless). */
  enabled: boolean;
  /** The `{{SKILLS}}` block (carries `{{SKILL_METADATA}}`). */
  prompt: string;
  /** Whether the stored template carries `{{SKILLS}}`; POST …/skills/template-placeholder inserts (or migrates to) it explicitly. */
  templateHasPlaceholder: boolean;
  /** Whether the stored template still carries the legacy hardcoded # Skills section verbatim — the migration case of the insert endpoint. */
  legacySectionPresent: boolean;
}

/** Schedules prompt-injection config, edited on the Schedules tab. No legacy field: Schedules never had a hardcoded template section. */
export interface AgentSchedulesConfigDto {
  /** Whether the Scheduled Tasks section enters the model context (the server fires configured tasks regardless). */
  enabled: boolean;
  /** The `{{SCHEDULES}}` block (carries `{{SCHEDULE_LIST}}`). */
  prompt: string;
  /** Whether the stored template carries `{{SCHEDULES}}`; POST …/schedules/template-placeholder inserts it explicitly. */
  templateHasPlaceholder: boolean;
}

/** Structured view of system_config.yaml (for the edit form). */
export interface AgentConfigDto {
  name?: string;
  description?: string;
  /** Agent State version number (treated as 1 if missing; shown in the settings page overview). */
  version: number;
  /** The stored kernel stamp (`kernel_version`): which defaults generation the config is based on; null when the config predates the kernel-version mechanism. */
  kernelVersion: string | null;
  /** The current defaults generation (core's KERNEL_VERSION) — what a kernel update would stamp. */
  kernelLatest: string;
  /** Whether the stamp is behind kernelLatest (a missing stamp counts as outdated). */
  kernelOutdated: boolean;
  systemPrompt: string;
  maxTurns?: number;
  model?: AgentModelConfigDto;
  compaction?: AgentCompactionConfigDto;
  memory: AgentMemoryConfigDto;
  vault: AgentVaultConfigDto;
  skills: AgentSkillsConfigDto;
  schedules: AgentSchedulesConfigDto;
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

/**
 * POST …/config/kernel-update result: the smart merge's outcome (core's applyKernelUpdate).
 * The entries are Agent settings **tabs** (`prompt`, `runtime`, `tools`, `skills`, `memory`,
 * `vault`, `schedules`) in the settings page's tab order; the client maps them to tab labels.
 */
export interface AgentKernelUpdateResponse {
  /** Tabs advanced to the current defaults (previously absent, or an untouched old default). */
  advanced: string[];
  /** Tabs kept whole because they match no recorded default (customized, kept conservatively). */
  kept: string[];
  /** The kernel stamp written (the current defaults generation). */
  kernelVersion: string;
}

/** POST …/config/mcp-test result: reachability of one MCP Server entry. */
export interface McpServerTestResponse {
  ok: boolean;
  /** Discovered tool names (`mcp__<server>__<tool>`), present on success. */
  tools?: string[];
  /** Failure detail (connect error, timeout, server stderr tail), present on failure. */
  error?: string;
  /** Connect + discovery wall time (both outcomes) — the models test reports latency, this matches. */
  latencyMs?: number;
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
    memory?: Partial<AgentMemoryConfigDto>;
    /** Only the writable half of the DTO — the template facts (templateHasPlaceholder / legacySectionPresent) are computed, never written. */
    vault?: { enabled?: boolean; prompt?: string };
    skills?: { enabled?: boolean; prompt?: string };
    schedules?: { enabled?: boolean; prompt?: string };
    toolsBuiltin?: ToolDefinitionConfig[];
    mcpServers?: MCPServerConfig[];
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** One Memory scope directory: `agent_state/memory/user/` or `agent_state/memory/<workspaceKey>/`. */
export interface MemoryScopeInfo {
  /** Directory name under `memory/`: `user`, or a Workspace's `<safe-basename>-<hash>` key. */
  scopeKey: string;
  /** `user` — the scope every Session reads, temporary Workspaces included; `workspace` — one Workspace's scope. */
  kind: "user" | "workspace";
  /** Workspace path the key was derived from, read from the directory's `.workspace` marker; unset on the user scope (it stands for no path) and for a directory edited by hand. */
  workspacePath?: string;
  /** Number of Markdown topic files in the directory (the `MEMORY.md` index not counted). */
  fileCount: number;
  /** Whether the directory holds a `MEMORY.md` index, so an import confirmation can say whether one would be replaced. */
  hasIndex: boolean;
  /** Most recent topic-file mtime in the directory (ISO 8601); unset when the directory holds no topic file. */
  updatedAt?: string;
}

/** One Memory topic file, as listed (frontmatter only — the body is fetched per file). */
export interface MemoryFileInfo {
  /** File name inside the scope directory, e.g. `prefers-pnpm.md`. */
  name: string;
  /** Frontmatter `name`; falls back to the file name. */
  title: string;
  /** Frontmatter `description`; empty when the file declares none. */
  description: string;
  /** Frontmatter `updated_at`, verbatim. */
  updatedAt?: string;
  /** File size in bytes. */
  size: number;
  /** File mtime (ISO 8601). */
  modifiedAt: string;
}

/** GET …/memory — the tab's landing payload: the switch and every scope group, user scope first. */
export interface MemoryOverviewResponse {
  /** Whether Memory reaches the model context (the Agent-level switch). */
  enabled: boolean;
  /** Whether the prompt template carries the `{{MEMORY}}` placeholder. An Agent created before Memory has none and injects nothing; POST …/memory/template-placeholder inserts it explicitly. */
  templateHasMemory: boolean;
  /** Absolute path of `agent_state/memory/`. */
  memoryDir: string;
  scopes: MemoryScopeInfo[];
}

/** GET …/memory/scopes/:key/files */
export interface MemoryFilesResponse {
  scopeKey: string;
  files: MemoryFileInfo[];
}

/** GET …/memory/scopes/:key/files/:name */
export interface MemoryFileResponse {
  scopeKey: string;
  file: MemoryFileInfo;
  content: string;
}

/** One topic file inside a transfer document: the name it had in its scope, and its whole text. */
export interface MemoryTransferFile {
  /** File name inside the scope directory, e.g. `prefers-pnpm.md` — a name, never a path. */
  name: string;
  /** The file's full Markdown text, frontmatter included. */
  content: string;
}

/**
 * GET …/memory/scopes/:key/export, and the body a POST …/import carries back: everything one
 * scope holds, as one JSON document — the topic files and the scope's own `MEMORY.md`.
 */
export interface MemoryScopeExport {
  /** Format marker, so a foreign JSON file is refused with a clear reason rather than half-imported. */
  format: "penguin-memory-scope";
  /** Document version. A reader accepts exactly this; a later format bumps it and states its own compatibility. */
  version: 1;
  /** The scope this was exported from. Informational: an import writes into the scope its URL names. */
  scopeKey: string;
  kind: MemoryScopeInfo["kind"];
  /** The Workspace the source scope stood for, when it had a `.workspace` marker. */
  workspacePath?: string;
  /** When the document was produced (ISO 8601). */
  exportedAt: string;
  /** The scope's `MEMORY.md`, or null when the scope has none. Only the index reaches the model's context. */
  index: string | null;
  files: MemoryTransferFile[];
}

/**
 * What an import does with a name the target scope already holds:
 *   - `skip` — keep what is on disk, write only names the scope does not have (destroys nothing);
 *   - `overwrite` — replace a same-named file's content;
 *   - `replace` — additionally delete every topic file the document does not carry.
 * The two destructive modes require `confirm`.
 */
export type MemoryImportMode = "skip" | "overwrite" | "replace";

/** POST …/memory/scopes/:key/import */
export interface MemoryImportRequest {
  /** Defaults to `skip`. */
  mode?: MemoryImportMode;
  /** Required by `overwrite` and `replace`; without it they are refused with 409 `memory_import_confirm_required`. */
  confirm?: boolean;
  payload: MemoryScopeExport;
}

/** What one import did, name by name, so the UI can report it rather than claim success. */
export interface MemoryImportResponse {
  scopeKey: string;
  mode: MemoryImportMode;
  /** Names written that the scope did not have. */
  added: string[];
  /** Names whose existing content was replaced. */
  overwritten: string[];
  /** Names left untouched because the scope already had them (`skip` only). */
  skipped: string[];
  /** Names deleted because `replace` dropped everything the document did not carry. */
  removed: string[];
  /** Whether the scope's `MEMORY.md` was written or extended. */
  indexWritten: boolean;
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
  /**
   * Thinking level pinned for this Session (set via PATCH; the Web App's in-chat picker).
   * Unset = never pinned: runs that carry no level of their own fall back to the Agent
   * config's `model.thinking_level`, so config edits keep taking effect. Once pinned it
   * survives reloads and applies to every later run of this Session, and an Agent-config
   * change no longer moves it.
   */
  thinkingLevel?: ThinkingLevelName;
  /** Short title auto-generated by the model after the first turn; unset until generated (frontend shows "New Chat"). */
  title?: string;
  /** Session source (for list badges/folders), derived from core session_meta — the single source of truth (not stored in the DB); unset for user-created sessions. */
  source?: SessionSource;
  createdAt: string;
  /**
   * Last activity the server drove for this Session (ISO 8601, same convention as
   * createdAt), monotonic — it never moves backwards. Set to createdAt at creation, then
   * stamped when a run starts and again when it ends; a run here is one Task, one
   * compaction, or one whole goal loop (every round of a goal belongs to a single run, so
   * an N-round goal stamps twice, not 2N times).
   *
   * Two kinds of row therefore stay at createdAt no matter how busy they look: Sessions
   * adopted from a CLI Trace (this server drives none of their runs) and subagent rows
   * (their work is driven through the parent Session's entry). Reading real activity for
   * those would mean consulting the Trace tree, which this field deliberately does not do.
   *
   * Rows that predate the field are backfilled once at startup from the Session's most
   * recent request timestamp, falling back to createdAt.
   */
  lastActiveAt: string;
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

/** One Skill found in a picked directory: metadata plus which of the two layouts it came from. */
export interface DirectorySkillItem extends SkillMetadataItem {
  /** `.agents/skills` or `.claude/skills` — shown so the origin of an offered Skill is visible. */
  source: string;
}

export interface DirectorySkillsResponse {
  /** Absolute path that was scanned (realpath). */
  path: string;
  /** Installable Skills found under the directory's Skill layouts; empty when it carries none. */
  skills: DirectorySkillItem[];
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

/** Immutable location of one record in a Session's append-only Trace. */
export interface TracePosition {
  /** Trace shard index (`001` on disk becomes `1`). */
  fileIndex: number;
  /** Zero-based record ordinal within the parsed shard. */
  ordinal: number;
}

/** History-only transport metadata; `tracePosition` is never persisted into Trace JSONL. */
export type HistoryMessage = OmniMessage & { tracePosition?: TracePosition };

export interface SessionForkRequest {
  /** The final root assistant text record of the completed Task to keep. */
  position: TracePosition;
}

export interface SessionForkResponse {
  session: SessionInfo;
}

export interface SessionResponse {
  session: SessionInfo;
}

export interface SessionPatchRequest {
  approvalMode?: ApprovalMode;
  /**
   * Pin this Session's thinking level (`none | low | medium | high | xhigh | max`, anything else
   * is a 400). It applies to every later run of the Session that doesn't carry its own
   * level, and replaces the Agent-config fallback for this Session. There is no unpin:
   * the picker only offers concrete levels.
   */
  thinkingLevel?: ThinkingLevelName;
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
   * window: the client offsets its global "round N" numbering by this, so a partial
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
  messages: HistoryMessage[];
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
  /**
   * An image that rides the conversation inline, as a base64 `data:` URL or an http(s) URL.
   * A data URL is capped at 20MB (413 `image_too_large`) — a fixed limit that does NOT follow
   * the admin-settable attachment cap, because an inline image is written into the Trace and
   * read back on every history page and every resume.
   */
  | { type: "image_url"; imageUrl: string }
  /**
   * File attachment (the composer's "+" menu): `dataUrl` is a base64 `data:` URL of the
   * file's bytes, capped per file and per message by the admin-settable upload limits
   * (defaults 100MB / 120MB; 413 `file_too_large` / `payload_too_large` / `too_many_files`,
   * and the request as a whole still has to fit the body cap those limits derive). The
   * server writes it into the Session scratchpad under a sanitized name and appends an
   * `[attached file: <path>]` line to the message text — the bytes never enter the
   * conversation, the model opens the file by path. `fileName` is the original name (no path
   * separators, no `..`).
   */
  | { type: "file"; fileName: string; dataUrl: string };

export interface TaskCreateRequest {
  input: TaskInputPart[];
  /**
   * Thinking level for this Task's LLM requests (a per-turn parameter; one of
   * `none | low | medium | high | xhigh | max`, anything else is a 400). Omitted = falls back to
   * the Session's pinned level (`SessionInfo.thinkingLevel`) and, when that is unset too,
   * to the Agent config's `model.thinking_level`. A queued follow-up (`queueIfBusy`) keeps
   * its level and applies it when it auto-starts.
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
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /steer/:steerId recalls it by. */
  id: string;
  /** The message text as accepted (trimmed); may be empty when images/files carry the message. */
  text: string;
  /** Number of images that rode along. */
  images: number;
  /** Number of file attachments that rode along. */
  files: number;
}

/**
 * One follow-up task queued with `queueIfBusy` but not yet auto-started. Carried on
 * `task_state` events and the SSE subscribe snapshot (like `pendingSteering`) so the
 * composer can show each queued message's content with a recall affordance; entries leave
 * the list when they auto-start on idle — or when DELETE /follow-ups/:followUpId recalls one.
 */
export interface PendingFollowUpInfo {
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /follow-ups/:followUpId recalls it by. */
  id: string;
  /** The queued input's text parts, joined; may be empty when images/files carry the message. */
  text: string;
  /** Number of images in the queued input. */
  images: number;
  /** Number of file attachments in the queued input. */
  files: number;
}

/**
 * One live subagent child of a session's runtime, carried on `task_state` events and the SSE
 * subscribe snapshot: the child Session id (the origin hop the stream already correlates by),
 * its background registry handle (null while it only lives inside a foreground collect
 * window), and whether a round is currently running. Only an ACTIVE parent runtime reports
 * children — after a server restart the in-process children are gone, and the empty list is
 * the truth.
 */
export interface SubagentRuntimeInfo {
  sessionId: string;
  subagentId: string | null;
  running: boolean;
}

/**
 * Response of POST /api/sessions/:sessionId/subagents/:childSessionId/message — a user input
 * on the child, whatever its state: `steered` = queued as a mid-run interjection, `started` =
 * began a follow-up run on the idle child, `resumed` = the released child session was revived
 * (resume-session semantics) and the message began its next round. The failure shapes are
 * HTTP statuses instead: 404 when the child's session record does not exist or cannot be
 * revived, 409 when the child cannot take the message right now.
 */
export interface SubagentMessageResponse {
  outcome: "steered" | "started" | "resumed";
}

/**
 * Response of the two recall endpoints — DELETE /api/sessions/:id/steer/:steerId and
 * DELETE /api/sessions/:id/follow-ups/:followUpId: the withdrawn message's original content,
 * for the composer to restore into the input box for editing and resending (#287). File
 * attachments are read back from the Session scratchpad (then deleted from it); one that
 * disappeared meanwhile is omitted rather than failing the recall. 409 `not_pending` when
 * the entry is no longer queued — steering already delivered to the model, or a follow-up
 * already auto-started (or unknown id either way).
 */
export interface RecalledMessageResponse {
  text: string;
  /** The images as submitted (`data:` / http(s) URLs). */
  images: string[];
  /** The file attachments, re-encoded as base64 data URLs (the shape the composer submits them in). */
  files: { fileName: string; dataUrl: string }[];
  /** Follow-up recall only: the per-turn thinking level the entry was queued with, when one was. */
  thinkingLevel?: ThinkingLevelName;
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

/**
 * One background command process started by the Session (an exec_command promoted past
 * its yield window). Served from the ACTIVE runtime only: a session whose runtime entry
 * is gone truthfully reports an empty list.
 */
export interface SessionProcessInfo {
  processId: string;
  /** OS pid of the process-group leader; null when the spawn itself failed. */
  pid: number | null;
  cmd: string;
  cwd: string;
  startedAt: string;
  running: boolean;
  /** The service the process serves, when detected: the last local URL its output printed, else an origin probed from its listening ports. */
  serviceUrl?: string;
}

export interface SessionProcessesResponse {
  processes: SessionProcessInfo[];
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
   * Published only to the user channels of the Project's owner and members.
   */
  | {
      type: "session_state";
      sessionId: string;
      state: SessionStatus;
      lastActiveAt: string;
      hasTrace: boolean;
    }
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
  /** The served web assets were hot-swapped by a platform upgrade: clients reload to pick them up. */
  | { type: "web_updated"; rev: string }
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

/** One tool's share of the context: its calls plus their results. Its *definition* is counted in `toolDefs`, not here. */
export interface ContextToolShare {
  name: string;
  tokens: number;
}

/**
 * What the Session's current model context is made of (`GET /api/sessions/:id/context`).
 *
 * Every token figure is an **estimate** from a character heuristic, not a tokenizer: the
 * authoritative occupancy is the last `token_usage`'s `request.total`, which says how large the
 * context is but not what fills it. Consumers should present these as shares of that measured
 * occupancy rather than as counts of their own.
 *
 * The six parts partition the context and sum to `total`; `topTools` is a ranking inside
 * `toolRequests + toolResults` and can sum to less than those two (a result whose call was not
 * recorded in the same Trace shard has no tool to be attributed to).
 */
export interface SessionContextResponse {
  systemPrompt: number;
  toolDefs: number;
  userMessages: number;
  assistantMessages: number;
  toolRequests: number;
  toolResults: number;
  /** Sum of the six parts. */
  total: number;
  /** Tools ranked by the context their traffic occupies, descending; at most five. */
  topTools: ContextToolShare[];
  /**
   * A completed compaction closed the context these figures describe, and the next one has not
   * been written yet: the composition is of what was compacted away, not of what the model now
   * carries. The same state in which the chat page's context ring shows `—`.
   */
  contextClosed: boolean;
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
   * a badge accordingly. It's treated the same as a user turn: it has Token /
   * cost / duration / TPS, and **counts normally toward global stats** — the global totals are
   * just the sum of the per-turn cards below, the two scopes match, so adding up the per-turn
   * numbers must equal the total.
   */
  compaction?: boolean;
  /**
   * Which kind of compaction turn it is, from the turn's `compaction_begin`. Additive beside
   * the flag rather than folded into it: `compaction` stays the sole gate on "is this a
   * compaction turn", so a client that only knows the boolean keeps working unchanged, and one
   * that reads this can name the turn for what it did — the two modes are different operations,
   * and only `summarize` actually compacts anything (`discard` drops the old context outright).
   * Absent on a turn analyzed before this field existed, or whose `compaction_begin` carried no
   * mode; treat an absent value as `summarize`, which is what the badge said before the split.
   */
  compactionMode?: CompactionMode;
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

/**
 * Non-tool auxiliary phase on the timeline: rendered in its own lane under the "other"
 * legend category — deliberately not a tool span, since nothing was called. Currently the
 * first run's MCP connect + discovery (from the mcp_connect_begin/end event pair).
 */
export interface TraceOtherSpan {
  /** Unique bar key (e.g. `mcp-connect-<beginTs>`). */
  key: string;
  /** Lane label, e.g. "mcp connect". */
  name: string;
  startTs: string;
  endTs: string;
  /** Attached to the Task that follows the phase (same grouping convention as toolSpans). */
  taskIndex: number;
  /** True when the phase ended with failures (some servers unreachable) or was aborted. */
  failed?: boolean;
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
  /** Execution timeline: non-tool auxiliary phases (their own "other" lanes — currently the first run's MCP connect + discovery). */
  otherSpans: TraceOtherSpan[];
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

/** Time-series precision for the usage series (`granularity` query parameter). `minute` requires the `fromTs`/`toTs` window bounds. */
export type UsageGranularity = "minute" | "hour" | "day" | "week" | "month";

/**
 * One bucket of the usage time series (for the cost center's time-series charts).
 * Buckets are zero-filled across the whole requested range, so consecutive points
 * are always adjacent in time. Bucket keys by granularity: minute
 * `yyyy-mm-ddThh:mm` and hour `yyyy-mm-ddThh:00` (server-local clock), day
 * `yyyy-mm-dd`, week the ISO week's Monday `yyyy-mm-dd`, month `yyyy-mm`.
 */
export interface UsageSeriesPoint {
  bucket: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  /** Cost converted at query time (USD); null when no priced Model contributed. */
  cost: number | null;
  requests: number;
  /** Successful requests in the bucket. */
  completed: number;
  /** Success-rate denominator: all requests minus aborted (a user interruption is not a model failure). */
  denominator: number;
}

/**
 * One entity's per-bucket request and success counts, aligned index-for-index
 * with `series` (the requests-and-success-rate chart draws one such entity —
 * or stacks them all). `denominator` excludes aborted, same as elsewhere.
 */
export interface UsageEntitySeriesCounts {
  requests: number[];
  completed: number[];
  denominator: number[];
}

/** Per-Agent counts per bucket. */
export interface UsageAgentSeries extends UsageEntitySeriesCounts {
  agentId: string;
}

/** Per-Model counts per bucket (entity identity is the (provider, modelId) pair). */
export interface UsageModelSeries extends UsageEntitySeriesCounts {
  provider: string;
  modelId: string;
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
  /** Effective precision of `series` (the validated `granularity` query parameter; defaults to day). */
  granularity: UsageGranularity;
  /**
   * Usage time series over the requested from/to range (defaulting to the last 30
   * days), zero-filled at `granularity`; affected by agent/model filters. Carries
   * everything the time-series charts draw: Token buckets, cost, request count,
   * and per-bucket success counts.
   */
  series: UsageSeriesPoint[];
  /**
   * Per-Agent counts per bucket, aligned index-for-index with `series`, sorted
   * by total requests descending. Unaffected by the agent filter — the by-Agent
   * chart draws the whole breakdown — but affected by date/model filters.
   */
  byAgentSeries: UsageAgentSeries[];
  /**
   * Per-Model counts per bucket, aligned index-for-index with `series`, sorted
   * by total requests descending. Unaffected by the model filter — the by-Model
   * chart draws the whole breakdown — but affected by date/agent filters.
   */
  byModelSeries: UsageModelSeries[];
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

// ---------------------------------------------------------------------------
// Desktop client update (desktop mode only)
// ---------------------------------------------------------------------------

/**
 * The desktop shell's updater snapshot, pushed to the embedded server over the
 * utilityProcess message channel and served at GET /api/desktop/update. `state` is the
 * discriminator; the optional fields belong to the states named on them.
 *
 * A `downloaded` build stays the reported state until it is installed: a later periodic
 * check (or its failure) must not hide the actionable "restart to install" step.
 */
export interface DesktopUpdateStatus {
  /** Installed shell version (Electron app.getVersion()). */
  appVersion: string;
  /**
   * Bumped by the shell on every updater event it folds, whether or not the visible
   * state changed. A row-initiated check settles when the seq has moved past its
   * at-click value and the state is no longer `checking` — snapshot equality can't
   * carry that signal (a check that ends where it started is byte-identical).
   */
  seq?: number;
  state:
    "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error" | "unsupported";
  /** Newer release being fetched / ready to install (`downloading`, `downloaded`). */
  version?: string;
  /** Download progress 0–100 (`downloading`). */
  percent?: number;
  /** Updater failure text (`error`). */
  message?: string;
  /** Why this install form cannot update itself (`unsupported`): dev run, or a Linux install that is not an AppImage (e.g. .deb — the system package manager owns it). */
  reason?: "dev" | "linux-not-appimage";
}

/**
 * GET /api/desktop/update (desktop-shell sessions only): the latest shell snapshot.
 * `status` is null until the shell's first push lands (a beat after server start).
 */
export interface DesktopUpdateStatusResponse {
  status: DesktopUpdateStatus | null;
}

/** Shell → server push over the utilityProcess message channel. */
export interface DesktopUpdaterStatusMessage {
  type: "desktop-updater-status";
  status: DesktopUpdateStatus;
}

/** Server → shell command over the utilityProcess message channel (relayed from POST /api/desktop/update/check|install). */
export interface DesktopUpdaterCommandMessage {
  type: "desktop-updater-command";
  action: "check" | "install";
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
