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
// Build/harness identity is not an interface contract — it ships from the barrel (core's version-info.ts).
import type { HarnessInfo, VersionReport } from "@prismshadow/penguin-core";

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

/**
 * GET /api/install — the identity of the data root this server is serving (install-id.ts),
 * read by the web app before it mounts so state persisted against a DIFFERENT root can be
 * swept. Public, like the login route it sits next to.
 */
export interface InstallResponse {
  /**
   * Opaque per-data-root id, or null when the server could not establish one (an
   * unreadable or unwritable root). Null means "unknown", and a client must change
   * nothing on it — never treat it as a new install.
   */
  installId: string | null;
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
   * initial-password banner and the self-update entry.
   */
  desktopMode: boolean;
  /**
   * How THIS session was established — distinct from desktopMode, which describes the
   * server: a browser signed into a desktop-mode server holds a "password" session.
   * "desktop" is the shell's own window (one-shot token); "setup" was claimed through the
   * first-login link on a server whose admin password has never been set. Both may set a
   * password without the old one (it is random and was never shown); only "desktop" opens
   * desktop-only routes. "token" marks a request authenticated by the local API token's
   * Bearer header (the CLI and agent-driven calls) — no stored session at all.
   */
  sessionVia: "password" | "desktop" | "setup" | "token";
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
  /** Omitted only by a "desktop" or "setup" session (see {@link MeResponse.sessionVia}); required otherwise. */
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
  /** The initial-password notice banner (app layout) was permanently dismissed by the user. */
  initialPasswordBannerDismissed?: boolean;
  /**
   * "I have dealt with this" markers for the dismissible to-do badges, per Project id and then
   * per trail (`skills` / `models` / `errors`). Each value is the SIGNATURE of what was waved
   * away rather than a hidden flag, so anything new raises the dot again (web's
   * `lib/todo-badges.ts`). Replaced whole on every write, like `draftShortcuts`: the merge is
   * shallow, so this whole map is one field.
   */
  todoDismissed?: Record<string, Record<string, string>>;
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
// Provider key-minting flows (/api/projects/:p/model-oauth, owner)
// ---------------------------------------------------------------------------

/**
 * How the authorization code travels back. `callback` sends the browser to a harness URL
 * the provider redirects to; `manual` asks the provider for a one-time code the user copies
 * back by hand, for the case where that redirect cannot reach the harness.
 */
export type ModelOAuthMode = "callback" | "manual";

/**
 * POST /api/projects/:p/model-oauth/start (owner): opens a flow for one provider group.
 * The group must declare an authorization flow in the built-in catalog — the endpoints it
 * uses come from there, never from this request.
 */
export interface ModelOAuthStartRequest {
  /** Provider group id (must be a catalog group that publishes a key-minting flow). */
  provider: string;
  /** Defaults to `callback`. */
  mode?: ModelOAuthMode;
}

/** The opaque flow handle plus the page to send the user to. No secret of the flow's is included. */
export interface ModelOAuthStartResponse {
  flowId: string;
  authorizeUrl: string;
}

/** Why a flow failed, as a code the frontend phrases; never carries a code, a verifier or a key. */
export type ModelOAuthErrorCode =
  "invalid_request" | "code_rejected" | "upstream_failed" | "unreachable" | "apply_failed";

/**
 * GET /api/projects/:p/model-oauth/:flowId (owner): where a flow stands. Unknown, expired,
 * and other users' flows are all 404 alike.
 */
export interface ModelOAuthStatusResponse {
  status: "pending" | "done" | "error";
  /** The provider group the flow mints a key for. */
  provider: string;
  /**
   * How many models the minted key was written to — set on the `done` answer, the way
   * {@link ModelOAuthCodeResponse} sets it on a redemption. The dialog reports this number, so
   * it has to be the server's own: the caller's model table can outlive a rejected save and
   * would otherwise name a count the server never wrote.
   */
  applied?: number;
  error?: ModelOAuthErrorCode;
}

/**
 * POST /api/projects/:p/model-oauth/:flowId/code (owner): redeems a code the user pasted,
 * the manual counterpart of the redirect callback. A flow is single-use either way.
 */
export interface ModelOAuthCodeRequest {
  code: string;
}

/** Redemption outcome; `applied` counts the models the minted key was written to. */
export interface ModelOAuthCodeResponse {
  ok: boolean;
  applied?: number;
  error?: ModelOAuthErrorCode;
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

/** One installed plugin (a skill or a hook package) the library carries a higher version of (see {@link AgentSummary.pluginUpdates}). */
export interface PluginUpdateRef {
  /** Plugin name — what `POST …/plugins` reinstalls to bring the Agent up to date. */
  name: string;
  /** The LIBRARY's version (`YYYY-MM-DD.N`), i.e. what installing again would bring, not what is on disk. */
  version: string;
}

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
  /** Installed hook-package count (number of agent_state/hooks/<name>/ directories with a hooks.json). */
  hookCount: number;
  /**
   * Installed plugins the built-in library has moved past — a skill or a hook package whose
   * on-disk version is behind the library plugin that ships it — each with the library version
   * on offer: the plugin-library update gate, riding along on the Agent list so a badge over
   * that page costs no request of its own. Empty when nothing is behind. Skills the library
   * does not carry (installed from a zip or a picked directory) are never listed: there is no
   * library version for them to be behind.
   */
  pluginUpdates: PluginUpdateRef[];
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
   * Library plugin names installed into the new Agent, seeding it at creation — each plugin's
   * skills and hook package. Every name must exist in the library (404 `unknown_plugin`
   * otherwise, before anything is created); omitted or empty leaves the Agent with nothing
   * installed, which is what a plain Agent gets by default.
   */
  plugins?: string[];
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
   * seeding (`plugins` / `skillsDirectory`) — the package carries its own skills and hooks.
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
   * Unset = never pinned: each model context the Session opens reads the Agent config's
   * `model.thinking_level`, so config edits keep taking effect. Once pinned it survives
   * reloads and applies from the Session's very next LLM request — the thinking level is
   * the soft-limited runtime parameter, changeable mid-context at the cost of the
   * provider's cached context (the picker advises compacting first) — and every later
   * context opens at it; an Agent-config change no longer moves it.
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
  /** Present when the Session has an ENABLED messaging binding: its channel (the sidebar row's per-channel indicator). */
  messagingChannel?: MessagingChannel;
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
  /**
   * Creating-client hint stored on the Session row: "cli" when the CLI creates the
   * Session through the API; defaults to "web". Informational provenance only — lists
   * serve every row regardless of client.
   */
  client?: "web" | "cli";
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
   * is a 400). It replaces the Agent-config fallback for this Session and applies from the
   * very next LLM request — soft-limited: a mid-context change is allowed, at the cost of
   * the provider's cached context, which is why the picker advises compacting first. There
   * is no unpin: the picker only offers concrete levels.
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
   * Queue instead of 409 when a Task/compaction is already in progress: the input is held
   * server-side and auto-starts as an ordinary next task once the session returns to idle
   * (in queue order, one at a time). The response then carries `queued: true`.
   */
  queueIfBusy?: boolean;
  /**
   * Present = goal mode: the input's text becomes the objective (leading `[use_skills]`
   * blocks and the like are stripped from the recorded objective; the round-1 message keeps
   * them) and the Session's installed `goal` hook package drives round after round until the
   * goal reaches a terminal state. `budget` is the token budget (uncached input + output);
   * omitted or -1 = unlimited. Requires the goal plugin installed on the Agent — 409
   * `goal_plugin_not_installed` otherwise.
   */
  goal?: { budget?: number };
}

/** Goal-mode run state, read from the Session's GOAL.json — the goal plugin's file (the chat page's banner restores from it; a live status on an idle Session reads as `aborted`). */
export interface GoalStateView {
  objective: string;
  status: "active" | "complete" | "blocked" | "budget_limited" | "aborted";
  /** Token budget; -1 = unlimited. */
  budget: number;
  used: number;
  rounds: number;
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
 * disappeared meanwhile is omitted rather than failing the recall. 409 when the entry is no
 * longer queued, with a code per endpoint because the reasons read differently to the user:
 * `not_pending` — the steering message already reached the model; `follow_up_started` — the
 * follow-up already auto-started as a task of its own (unknown ids land on the same code).
 */
export interface RecalledMessageResponse {
  text: string;
  /** The images as submitted (`data:` / http(s) URLs). */
  images: string[];
  /** The file attachments, re-encoded as base64 data URLs (the shape the composer submits them in). */
  files: { fileName: string; dataUrl: string }[];
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
// Messaging bindings (/api/sessions/:sessionId/messaging/*)
// ---------------------------------------------------------------------------

/** Messaging channels a Session can bind to. */
export type MessagingChannel = "feishu" | "telegram" | "qq" | "wechat";

/** Event-connection runtime state of one binding (kept in memory, not persisted). */
export type MessagingRuntimeState = "disconnected" | "connecting" | "connected" | "error";

/**
 * A failure that happened AFTER an inbound message was accepted — as opposed to a
 * connection failure, which `MessagingRuntimeStatus.lastError` reports.
 *
 * The two stages fail in completely different places and lead to different actions, and
 * from the chat they are indistinguishable (both produce silence), which is why the stage
 * is stated rather than folded into one message.
 */
export interface MessagingDeliveryError {
  /** ISO 8601 timestamp of the failure. */
  at: string;
  /** `inbound` — the message arrived and its Task never started; `send` — a reply never reached the chat. */
  stage: "inbound" | "send";
  /** The failure's own message, as the channel or the Session reported it. */
  detail: string;
}

export interface MessagingRuntimeStatus {
  state: MessagingRuntimeState;
  /** Failure detail; present only in the `error` state. */
  lastError?: string;
  /** When the state last changed (ISO 8601); absent for a binding that never connected. */
  changedAt?: string;
  /**
   * When this binding last accepted an inbound message (ISO 8601).
   *
   * "Connected, and nothing has arrived" is the answer to the one question a chat cannot
   * answer for itself — whether the platform is delivering anything at all. A channel that
   * withholds messages (Telegram's group privacy, a bot that is not a member) produces
   * exactly that, with no error anywhere.
   *
   * In-process AND scoped to one connection: it starts empty on every (re)connect, and a
   * re-enable or a credential save opens a new one. So an absent field means "nothing since
   * this connection opened", never "nothing ever" — anything reporting it has to say which,
   * or it sends a reader off to fix a channel that is working.
   */
  lastInboundAt?: string;
  /**
   * The most recent post-acceptance failure; absent when none has happened since this
   * connection opened, and never cleared by a later success — an intermittent failure would
   * otherwise be erased by the next ordinary message. `at` is what says how stale it is.
   */
  lastDeliveryError?: MessagingDeliveryError;
  /**
   * The most recent CONNECTION failure, kept after the connection recovers — unlike
   * `lastError`, which belongs to the `error` state and is gone the moment the state leaves it.
   *
   * A connection that fails and recovers repeatedly (a second program polling the same bot
   * token takes turns with this one) reads as `connected` in any snapshot taken between
   * flaps, with nothing at all to show for the failures in between. This is what is left
   * behind — for the life of the connection, like the two above it.
   */
  lastConnectionError?: { at: string; detail: string };
}

/**
 * What a messaging binding carries whatever channel it is: the connection intent, the three
 * delivery preferences, whether a chat is known, and the row's identity and timestamps.
 *
 * Split out because this is the half that grows. Three delivery preferences arrived in one
 * release, and each would otherwise have been written into three interfaces — the credential
 * slice is the only thing a channel genuinely differs in, and it is what stays per-channel.
 *
 * `channel` is NOT here: a discriminated union discriminates on a literal the member itself
 * declares, so each interface keeps its own.
 *
 * A channel may RE-DECLARE a field below when it has more to say about it — QQ does, for all
 * three preferences, because the platform's passive-reply budget and its expiring window
 * change what setting one costs there. The re-declared type must be identical, which the
 * compiler enforces, so the redeclaration can only add documentation and never a contract.
 */
export interface MessagingBindingCommon {
  sessionId: string;
  /** Connection INTENT (the state toggle's value); new bindings start disabled, and at most one of a Session's channels is enabled. */
  enabled: boolean;
  /**
   * Send each non-blank line of a relayed assistant reply as its own message instead of one
   * message per reply. Off by default; off is the original one-message-per-reply behaviour.
   */
  linePerMessage: boolean;
  /**
   * Relay only the LAST completed assistant message of a run, delivered when the run ends,
   * instead of mirroring each completed message as it completes. Off by default; off is the
   * original every-message behaviour. Independent of `linePerMessage`, which then applies to
   * that one final message. The approval notice is not a reply and is unaffected.
   */
  finalReplyOnly: boolean;
  /**
   * Render a relayed reply's Markdown in this channel's own markup instead of sending its
   * characters as written. ON by default. Each channel shows what it can — Telegram has no
   * headings, lists or tables, QQ has no code or tables, Feishu has all of them, and WeChat
   * reads Markdown itself so the render is a subtraction rather than a translation — and a
   * rendering the channel refuses falls back to the plain source, so this can cost
   * formatting and never a message.
   */
  renderMarkdown: boolean;
  /**
   * Whether an inbound chat is known (the bot has been messaged at least once). Replies and
   * test messages target that chat; until it exists nothing can be sent.
   */
  lastChatKnown: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The stored Feishu config, secret masked (plaintext never leaves the server). */
export interface FeishuBindingInfo extends MessagingBindingCommon {
  channel: "feishu";
  appId: string;
  /**
   * Masked app secret (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no secret is stored (never entered, or cleared) — the binding cannot be
   * enabled until one is saved.
   */
  appSecretMasked?: string;
  baseDomain: string;
}

/** The stored Telegram config, token masked (plaintext never leaves the server). */
export interface TelegramBindingInfo extends MessagingBindingCommon {
  channel: "telegram";
  /** The numeric bot id (the token's half before the colon) — the channel-scoped account identity, never secret. */
  botId: string;
  /**
   * Masked bot token (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no token is stored (cleared) — the binding cannot be enabled until one
   * is saved.
   */
  botTokenMasked?: string;
}

/**
 * The stored QQ config, secret masked (plaintext never leaves the server).
 *
 * The three preference fields are re-declared unchanged: every one of them costs something
 * different here, and the platform's reply budget is what a reader setting one needs to know.
 */
export interface QQBindingInfo extends MessagingBindingCommon {
  channel: "qq";
  /** The bot's App ID — the channel-scoped account identity, never secret. */
  appId: string;
  /**
   * Masked App Secret (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no secret is stored (never entered, or cleared) — the binding cannot be
   * enabled until one is saved.
   */
  appSecretMasked?: string;
  /**
   * Send each non-blank line of a relayed assistant reply as its own message instead of one
   * message per reply. Off by default. On QQ the split is additionally capped at the
   * platform's passive-reply budget rather than the channel-neutral ceiling, so it yields
   * far fewer messages here than on the other channels.
   */
  linePerMessage: boolean;
  /**
   * Relay only the LAST completed assistant message of a run, delivered when the run ends.
   * Off by default.
   *
   * On QQ it cuts both ways, which is worth knowing before setting it here. It spends the
   * least of the platform's passive-reply budget a run can spend — one message, where an
   * every-message relay spends one per completed message. But a passive reply is accepted
   * only for a few minutes after the inbound message that funds it, and holding the reply
   * to the run's end spends that window on the run: a run that outlives it delivers nothing
   * at all, where the every-message relay would have sent whatever completed inside it.
   */
  finalReplyOnly: boolean;
  /**
   * Render a relayed reply's Markdown in this channel's own markup. ON by default. QQ's own
   * subset is the widest for prose and the narrowest for code: headings, lists, blockquotes
   * and rules render, while inline code, fenced code and tables have no syntax at all here —
   * a code block arrives as plain escaped lines. A rendering the platform refuses falls back
   * to the plain source, at the cost of one more slot from the passive-reply budget.
   */
  renderMarkdown: boolean;
  /**
   * Whether an inbound QQ chat is known (the bot has been messaged at least once). Weaker
   * than it looks on this channel: QQ accepts only replies to a recent message, so a known
   * chat is necessary but not sufficient for anything to be deliverable right now.
   */
  lastChatKnown: boolean;
}

/**
 * The stored WeChat config, token masked (plaintext never leaves the server).
 *
 * No preference field is re-declared. The three delivery preferences cost exactly what they
 * cost on Feishu and Telegram here — this channel has no reply budget and no expiring reply
 * window — and re-declaring a field to say nothing new about it would only invite the next
 * reader to look for the difference.
 */
export interface WeChatBindingInfo extends MessagingBindingCommon {
  channel: "wechat";
  /** The bot id a scan issued — the channel-scoped account identity, never secret. */
  botId: string;
  /**
   * Masked bot token (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when none is stored (cleared, or a scan that never completed) — the binding
   * cannot be enabled until a scan saves one.
   */
  botTokenMasked?: string;
}

/** A Session's saved config for one messaging channel (`channel` is the discriminant). */
export type MessagingBindingInfo =
  FeishuBindingInfo | TelegramBindingInfo | QQBindingInfo | WeChatBindingInfo;

/** One saved channel config with its event-connection runtime status. */
export interface MessagingChannelState {
  binding: MessagingBindingInfo;
  /** Only the enabled channel's connection is ever anything but disconnected. */
  status: MessagingRuntimeStatus;
}

/**
 * GET …/messaging response — the channel-agnostic read the channel-aware binding editor
 * loads: EVERY saved channel config (masked) with its runtime status. A Session may keep
 * both channels saved; at most one of them is enabled.
 */
export interface MessagingBindingsResponse {
  bindings: MessagingChannelState[];
}

/** GET / PUT …/messaging/feishu response: the Feishu config (null = not saved) plus its runtime status. */
export interface FeishuBindingResponse {
  binding: FeishuBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/telegram response (the Telegram narrowing of the same envelope). */
export interface TelegramBindingResponse {
  binding: TelegramBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/qq response (the QQ narrowing of the same envelope). */
export interface QQBindingResponse {
  binding: QQBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/** GET / PUT …/messaging/wechat response (the WeChat narrowing of the same envelope). */
export interface WeChatBindingResponse {
  binding: WeChatBindingInfo | null;
  status: MessagingRuntimeStatus;
}

/**
 * PUT …/messaging/feishu — saves credentials/config ONLY, never flipping the connection
 * (exception: an enabled binding's connector restarts with the new credentials so stored
 * config and live connection never diverge). The connection toggle is POST …/state.
 */
/**
 * The delivery preferences any channel's PUT may set. Each is optional and each behaves the
 * same way on every channel: an omitted field keeps the stored value, so a client that knows
 * about one preference can save it without having to send the others back. Their meanings are
 * on {@link MessagingBindingCommon}, and where a channel charges differently for one, on that
 * channel's own `*BindingInfo`.
 *
 * The defaults a binding created without them starts from: `linePerMessage` off,
 * `finalReplyOnly` off, `renderMarkdown` ON.
 */
export interface MessagingDeliveryPatch {
  linePerMessage?: boolean;
  finalReplyOnly?: boolean;
  renderMarkdown?: boolean;
}

export interface FeishuBindingPutRequest extends MessagingDeliveryPatch {
  appId: string;
  /** Omitted or blank keeps the stored secret (the masked value never round-trips). */
  appSecret?: string;
  /** Defaults to https://open.feishu.cn when omitted or blank. */
  baseDomain?: string;
  /**
   * Drops the STORED secret (the models-page clear idiom; a typed `appSecret` wins over
   * it). Refused with 409 `messaging_disable_before_clear` while the binding is enabled.
   */
  clearAppSecret?: boolean;
}

/**
 * PUT …/messaging/telegram — saves the credential ONLY, same contract as the Feishu PUT
 * (an enabled binding's connector restarts with the new token; the connection toggle is
 * POST …/state). Saving never conflicts across Sessions: the same bot may sit saved on
 * several, and only enabling it is exclusive.
 */
export interface TelegramBindingPutRequest extends MessagingDeliveryPatch {
  /** Omitted or blank keeps the stored token (the masked value never round-trips). */
  botToken?: string;
  /**
   * Drops the STORED token (the models-page clear idiom; a typed `botToken` wins over
   * it — and the row keeps its bot identity). Refused with 409
   * `messaging_disable_before_clear` while the binding is enabled.
   */
  clearBotToken?: boolean;
}

/**
 * PUT …/messaging/qq — saves the credential pair ONLY, same contract as the Feishu PUT
 * (an enabled binding's connector restarts with the new credentials; the connection toggle
 * is POST …/state). The App ID is the account identity, so changing it rebinds the row to
 * a different bot and drops the remembered chat.
 */
export interface QQBindingPutRequest extends MessagingDeliveryPatch {
  appId: string;
  /** Omitted or blank keeps the stored secret (the masked value never round-trips). */
  appSecret?: string;
  /**
   * Drops the STORED secret (the models-page clear idiom; a typed `appSecret` wins over
   * it). Refused with 409 `messaging_disable_before_clear` while the binding is enabled.
   */
  clearAppSecret?: boolean;
}

/**
 * PUT …/messaging/wechat — the delivery preferences ONLY.
 *
 * The one PUT on this router that carries no credential, because there is none to carry: a
 * WeChat bot token exists only where a scan put it, and there is no console to copy one out
 * of. Saving therefore presupposes a binding — a PUT before any scan answers 400
 * `wechat_token_required` rather than creating an empty row — and the connection toggle
 * stays POST …/state, as on every channel.
 */
export interface WeChatBindingPutRequest extends MessagingDeliveryPatch {
  /**
   * Drops the STORED token (the models-page clear idiom). Refused with 409
   * `messaging_disable_before_clear` while the binding is enabled. The row and its bot
   * identity stay; only a fresh scan can make it connectable again.
   */
  clearBotToken?: boolean;
}

/**
 * POST …/messaging/<channel>/state — enable connects with the STORED credentials,
 * disable terminates. Enabling is what binds the bot account to this Session, and it is
 * mutually exclusive twice over: while another channel of the same Session is enabled it
 * answers 409 `another_channel_enabled`, and while another SESSION has the same account
 * enabled it answers 409 `account_enabled_elsewhere` (both say: turn that one off first).
 * A config whose secret is missing answers its channel's 400 `*_required`.
 */
export interface MessagingBindingStateRequest {
  enabled: boolean;
}

/** POST …/messaging/feishu/test — draft values; each omitted field falls back to the stored binding. */
export interface FeishuTestRequest {
  appId?: string;
  appSecret?: string;
  baseDomain?: string;
}

/** Credential-test outcome (an unreachable/rejected credential is `ok:false`, not an HTTP error). */
export interface FeishuTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** POST …/messaging/telegram/test — a draft token, falling back to the stored binding when omitted. */
export interface TelegramTestRequest {
  botToken?: string;
}

/** Telegram credential-test outcome: success additionally names the bot the token signs in as. */
export interface TelegramTestResponse {
  ok: boolean;
  latencyMs?: number;
  /** The bot's `@username`, when the API reports one. */
  botUsername?: string;
  /**
   * True when @BotFather's **Group Privacy** is ON for this bot, which is the default. In
   * every group where the bot is not an administrator it then receives only a command
   * addressed to it or a reply to one of its own messages — an ordinary sentence is never
   * delivered, so a binding that answers fine in a direct chat stays silent there. The
   * setting is account-wide and Telegram overrides it for a group the bot administers, so
   * this reports the setting and never the outcome in any particular group. Absent when the
   * API did not report the setting; never inferred.
   */
  groupPrivacy?: boolean;
  error?: string;
}

/** POST …/messaging/qq/test — draft values; each omitted field falls back to the stored binding. */
export interface QQTestRequest {
  appId?: string;
  appSecret?: string;
}

/**
 * QQ credential-test outcome. There is no account label: the platform's only credential
 * call is the access-token exchange, which identifies nothing beyond the App ID that was
 * sent to it.
 */
export interface QQTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * POST …/messaging/qq/scan — starts a scan-to-connect flow: the server registers a bind
 * task under a fresh AES key it keeps to itself, and answers with what the browser may
 * know. The key is absent from this type on purpose — it decrypts the App Secret, so it
 * never leaves the server (the same rule that keeps a stored secret from round-tripping).
 */
export interface QQScanStartResponse {
  /** Opaque bind-task handle, passed back to the poll endpoint. */
  taskId: string;
  /** The URL to ENCODE into a QR code. It is opened by the QQ app, never fetched by the browser. */
  qrUrl: string;
  /** How often to poll, in milliseconds (the interval the protocol is designed around). */
  pollMs: number;
}

/**
 * POST …/messaging/qq/scan/poll — one step of the scan. `pending` means keep polling,
 * `expired` means start a new task and show a new QR, and `completed` means the server has
 * already decrypted the App Secret and SAVED the binding: `appId` names the bot that landed.
 * Saving is all it does — enabling the connection stays the separate, exclusive act it is on
 * every channel. A task id that is unknown, belongs to another Session, was already
 * resolved, or is being resolved by a poll still in flight answers 404
 * `qq_scan_task_unknown`: the task is claimed by one poll, so a client whose interval fires
 * before the previous request came back binds once rather than once per overlapping poll.
 */
export interface QQScanPollResponse {
  status: "none" | "pending" | "completed" | "expired";
  /** The bound bot's App ID; present only on `completed`. Never the secret. */
  appId?: string;
  /** The saved binding, present on `completed` so the editor refreshes without a second GET. */
  binding?: QQBindingInfo;
}

/**
 * WeChat credential-test outcome. There is no request body and no draft to probe: this
 * channel's credential exists only where a scan put it, so the test always probes the STORED
 * binding. It answers 400 `wechat_token_required` when there is none.
 *
 * No account label, for the same reason QQ has none: the probe (`getconfig`) reports the
 * bot's settings and names neither the bot nor the person.
 */
export interface WeChatTestResponse {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * POST …/messaging/wechat/scan — starts a scan-to-connect flow, which on this channel is the
 * ONLY way to bind: the bot token has no console to be copied out of.
 *
 * The server registers a code and answers with what the browser may know. The platform's own
 * poll handle is absent from this type on purpose — it is what collects the bot token, so it
 * never leaves the server, and `taskId` is a handle this server mints in its place.
 */
export interface WeChatScanStartResponse {
  /** Opaque scan handle, passed back to the poll, verify and cancel endpoints. */
  taskId: string;
  /** The URL to ENCODE into a QR code. It is opened by WeChat, never fetched by the browser. */
  qrUrl: string;
  /** How often to poll, in milliseconds. */
  pollMs: number;
}

/**
 * Where a WeChat scan stands. Richer than QQ's four states because the flow is: WeChat
 * separates scanning from confirming, and may interpose a pairing code shown on the phone.
 *
 * - `pending` — the code is up and nothing has happened; keep polling.
 * - `scanned` — scanned; the phone is showing the confirmation prompt.
 * - `need_verify_code` — the phone is showing digits that must be sent to the verify
 *   endpoint before the bind proceeds.
 * - `blocked` — too many wrong pairing codes; the code is spent and a new scan is needed.
 * - `expired` — the code lapsed before it was used; show a new one.
 * - `already_bound` — this bot is already bound to this server, so no new credentials were
 *   issued and nothing was saved. Not a failure: the existing binding still works.
 * - `completed` — the server has already SAVED the binding; `botId` names the bot.
 */
export type WeChatScanStatus =
  | "pending"
  | "scanned"
  | "need_verify_code"
  | "blocked"
  | "expired"
  | "already_bound"
  | "completed";

/**
 * POST …/messaging/wechat/scan/poll — one step of the scan.
 *
 * `completed` means the server has decrypted nothing and stored everything: the credentials
 * went from the platform into storage without passing through the browser. Saving is all it
 * does — enabling the connection stays the separate, exclusive act it is on every channel. A
 * task id that is unknown, belongs to another Session, or was already resolved answers 404
 * `wechat_scan_task_unknown`.
 *
 * Unlike QQ's poll, an overlapping request answers `pending` rather than 404: the upstream
 * call is a LONG poll, so one of them spans several of the client's intervals, and that
 * overlap is the normal rhythm rather than a replay.
 */
export interface WeChatScanPollResponse {
  status: WeChatScanStatus;
  /** The bound bot's id; present only on `completed`. Never the token. */
  botId?: string;
  /** The saved binding, present on `completed` so the editor refreshes without a second GET. */
  binding?: WeChatBindingInfo;
}

/**
 * POST …/messaging/wechat/scan/verify — the digits WeChat showed on the phone.
 *
 * They ride the NEXT poll rather than a request of their own, because the platform takes the
 * pairing code as a parameter of the status call: this endpoint records them and answers
 * 204. A wrong code is not reported here — the next poll asks for one again, which is how
 * the platform reports it.
 */
export interface WeChatScanVerifyRequest {
  taskId: string;
  verifyCode: string;
}

/**
 * POST …/messaging/<channel>/test-message — sent to the last known chat (409
 * `feishu_no_chat` / `telegram_no_chat` / `qq_no_chat` before one exists). On QQ this can
 * still fail with 502 afterwards: the platform accepts only replies to a message sent from
 * QQ minutes earlier, so a known chat does not mean a deliverable one.
 */
export interface MessagingTestMessageResponse {
  ok: true;
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
 * What the Session's current model context is made of — the part derived from its messages.
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
export interface SessionContextParts {
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

/** `GET /api/sessions/:id/context`: the message-derived composition plus where compaction will fire. */
export interface SessionContextResponse extends SessionContextParts {
  /**
   * Occupancy (tokens) at which this Session's next Request triggers context compaction: the
   * Agent's configured `compaction.max_context_length`, capped by what the model's context window
   * leaves room for. Null when compaction is disabled, when the Agent's config could not be read,
   * or when the derived threshold is not below the window — nothing to mark inside the gauge.
   */
  compactionThreshold: number | null;
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

/**
 * Lifetime Token total for one Model, keyed by the (provider, modelId) pair. Deliberately
 * unfiltered — no date range, no Agent: it answers "how much has this model been used", a
 * question with no window attached, and the models page that shows it carries no filters of its
 * own to honour. Models never used are absent rather than zero.
 */
export interface UsageModelTotal {
  provider: string;
  modelId: string;
  /** The three buckets summed (cache read + cache write + output), matching the cost center's Token figure. */
  tokens: number;
  requests: number;
}

/** Response of `GET /usage/model-totals`. */
export interface UsageModelTotals {
  totals: UsageModelTotal[];
}

/**
 * The two categories an error record is filed under: `unexpected` is a 500 or an unforeseen
 * runtime exception, `expected` an HttpError / business 4xx. The panel separates them by
 * colour, and `GET /usage/errors` takes one of them as its `kind` filter.
 */
export type UsageErrorKind = "unexpected" | "expected";

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
  /**
   * How many of {@link total} a clear would actually take (see {@link UsageErrorsClearResponse}).
   *
   * The same as `total` for an ordinary member, and smaller for an admin, whose reads include
   * unattributed rows that no Project-scoped clear removes. The confirmation is the only place
   * this matters, and it is the place it matters most: an irreversible delete has to name the
   * number that will really go, not the number on screen.
   */
  clearable: number;
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
 * date/agent filter as the dashboard, so a page never widens what the summary counted, plus
 * an optional `kind` ({@link UsageErrorKind}) narrowing to one of the two categories — which
 * is how the cost-center badge asks "are there unexpected errors, and how new is the newest"
 * with `limit=1` instead of pulling the whole dashboard aggregate.
 */
export interface UsageErrorsPage {
  items: UsageErrorItem[];
  /** Filtered row count, so the caller knows when it has reached the end. */
  total: number;
}

/**
 * DELETE /api/projects/:projectId/usage/errors — empties the error table for the filter the
 * panel is showing (its date range and Agent), Project owner only.
 *
 * Scoped to the filter rather than the Project's whole history, so a clear takes exactly the
 * rows on screen. Errors with no Project attribution are never included, whoever asks: they
 * belong to no Project and are surfaced in every Project's admin view.
 */
export interface UsageErrorsClearResponse {
  /** How many rows were deleted, so the caller can say what went instead of guessing. */
  deleted: number;
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
// Plugin library, and an Agent's installed skills and hooks
// ---------------------------------------------------------------------------

export interface SkillMetadataItem {
  /** Skill directory name (the identity key for install / uninstall / Prompt addressing). */
  name: string;
  description: string;
  /** Short description for frontend display (frontmatter short_description, optional; falls back to description if missing). */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /**
   * Raw icon.svg text from the installed skill directory: the plugin's icon for a library
   * install (written beside SKILL.md at install time), a custom one for a user-authored skill.
   * Only installed lists carry it — the library listing's skills share their plugin's icon,
   * which the plugin item carries once. Absent, the frontend draws the book glyph.
   */
  icon?: string;
  /** Version (`YYYY-MM-DD.N`, frontmatter version); an empty string when the frontmatter carries none or a malformed one. */
  version: string;
}

/** One installed hook package (`agent_state/hooks/<name>/`): its manifest, without the scripts. */
export interface HookItem {
  /** Hook package name — the plugin that shipped it (the identity uninstall addresses it by). */
  name: string;
  description: string;
  descriptionZh?: string;
  /** Version (`YYYY-MM-DD.N`); an empty string when the manifest carries none. */
  version: string;
  /** The hook points the package answers at, e.g. `["stop"]`. */
  events: string[];
  /** The plugin's raw icon.svg, written beside the manifest at install time; absent when the plugin ships none (the frontend draws the hook glyph). */
  icon?: string;
}

/** One library plugin as the listing describes it: the manifest fields plus what it ships (skill bodies and scripts are never sent). */
export interface PluginItem {
  name: string;
  description: string;
  descriptionZh?: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
  /** `YYYY-MM-DD.N`. */
  version: string;
  /** The plugin's skills (metadata only). */
  skills: SkillMetadataItem[];
  /** The hook points the plugin's hook package answers at (`[]` without one). */
  hooks: string[];
  /** The plugin's raw icon.svg (beside plugin.json — every built-in plugin ships one), the icon of everything it ships; the frontend draws the puzzle-piece plugin glyph without it. */
  icon?: string;
}

export interface PluginGroupItem {
  id: string;
  title: string;
  /** Chinese category title (optional; the UI displays it per language). */
  titleZh?: string;
  plugins: PluginItem[];
}

/** GET /api/plugins: the library by category (any logged-in user). */
export interface PluginLibraryResponse {
  groups: PluginGroupItem[];
}

/**
 * GET /api/plugins/:plugin/files: everything a library plugin ships, for the detail view's file
 * browser — each skill's installable SKILL.md and auxiliary files under `skills/<name>/`, the
 * hook package's scripts under `hooks/` — keyed by path relative to the plugin directory. The
 * manifest and the icon are not among them: the listing already carries both.
 */
export interface PluginFilesResponse {
  files: Record<string, string>;
}

/**
 * POST /api/projects/:p/agents/:a/plugins: install library plugins by name — each one's skills
 * and hook package; already-installed ones are overwritten with library content (i.e. updated).
 * Every name must be in the library (404 `unknown_plugin`, nothing written). 201 returns the
 * refreshed installed lists.
 */
export interface PluginInstallRequest {
  names: string[];
}

export interface AgentPluginsInstallResponse {
  skills: SkillMetadataItem[];
  hooks: HookItem[];
}

/** GET /api/projects/:p/agents/:a/skills: Skills installed on this Agent. */
export interface AgentSkillsResponse {
  skills: SkillMetadataItem[];
}

/** GET /api/projects/:p/agents/:a/hooks: hook packages installed on this Agent; DELETE …/hooks/:name uninstalls one (204). */
export interface AgentHooksResponse {
  hooks: HookItem[];
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

/**
 * GET /api/version: the running build's identity plus this root's pushed harness, verbatim
 * from `versionReport()` — the same record `penguin version --json` prints, so the two
 * cannot drift apart. Field meanings live on {@link VersionReport} and {@link HarnessInfo};
 * the ones the web reads are `version` and `buildDate` (the stamped release date behind the
 * sidebar's "last updated", needing no network, and null for a source build or a release
 * predating the stamping — v0.1.2 and earlier — where the UI shows the version alone).
 */
export type VersionResponse = VersionReport;

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
 * The shell never downloads on its own: a check ends in `available`, and the download
 * starts only on the page's (or the native dialog's) say-so — the `download` command. A
 * `downloaded` build stays the reported state until it is installed: a later periodic
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
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  /** The newer release: offered (`available`), being fetched (`downloading`) or ready to install (`downloaded`). */
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

/**
 * Server → shell command over the utilityProcess message channel (relayed from
 * POST /api/desktop/update/check|download|install): look for a release, fetch the one
 * offered, or restart into the one downloaded.
 */
export interface DesktopUpdaterCommandMessage {
  type: "desktop-updater-command";
  action: "check" | "download" | "install";
}

/**
 * The outcome of one self-update run (`penguin update --yes` on the server host), carried
 * by {@link UpdateJobStatus.result}. `unsupported` covers both a server not launched via
 * the CLI and the CLI's own refusals (source checkout, unrecognized install layout, Windows).
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

/**
 * Where a running self-update is: resolving the release and fetching the installer,
 * downloading the bundle (the one phase with a percentage), or verifying and installing it.
 */
export type UpdateJobPhase = "resolving" | "downloading" | "installing";

/**
 * GET / POST /api/version/update (admin only): the self-update job. POST starts a run when
 * none is in flight — a finished run may be started again, which is how a failed one is
 * retried — and answers with the status exactly as GET does; the page polls GET while
 * `state` is `running`. One job per process: two admins clicking at once share the one run,
 * and the finished status stays readable until the next start.
 */
export interface UpdateJobStatus {
  state: "idle" | "running" | "done";
  /** The release the run targets — the update check's newest version when the run started; null when none was known. */
  targetVersion: string | null;
  /** Running only. */
  phase?: UpdateJobPhase;
  /** Running, `downloading` only: 0–100 read off the installer's progress bar; null until its first tick. */
  percent?: number | null;
  /** Tail of the update command's combined stdout+stderr so far (capped; empty when nothing ran). */
  output: string;
  /** Done only. */
  result?: UpdateRunResponse;
  startedAt?: string;
  finishedAt?: string;
}

/**
 * POST /api/version/restart (admin only): asks the process to exit with the supervisor's
 * restart code after a graceful shutdown, so `penguin server|web` relaunches it on the
 * installed release. `restarting: false` when nothing supervises this process — it was
 * started some other way than through the CLI, or it is a dev run — and the page shows the
 * manual restart hint instead.
 */
export interface RestartResponse {
  restarting: boolean;
  reason?: "no_supervisor";
}

/** One `Host` entry of the server's `~/.ssh/config`, as the Machines page lists it. */
export interface MachineInfo {
  /** `ssh:<alias>` — the id the install route is asked for. */
  id: string;
  /**
   * The alias exactly as written in the config. The list is the config text and nothing
   * else — no `ssh -G`, no processes, no network — so a config declaring hundreds of hosts
   * costs one file read; an alias is resolved only when it is actually installed to.
   */
  alias: string;
  /**
   * The last install THIS server carried out there, remembered on disk so it survives a
   * restart, a hot push, and installing on some other machine. Null when this server has
   * never installed there.
   *
   * A record of what was done, not a survey of the far side: a machine wiped by hand still
   * reads as installed until the next install probes it and corrects the record. Asking the
   * remote instead would cost an ssh round trip per host at page load, which is the price
   * the config-text list exists to avoid.
   */
  installed: { version: string; at: string } | null;
}

/**
 * The running or last install, polled by GET /api/machines while one runs. `log` carries the
 * far side's own words where there are any: ssh's diagnostics and the remote installer's
 * output say more about a refused key or an unusable Node than a paraphrase would.
 */
export interface MachineInstallJob {
  machineId: string;
  alias: string;
  running: boolean;
  log: string[];
  result:
    | null
    | { ok: true; kind: "installed" | "already-installed"; version: string | null }
    | { ok: false; step: string; message: string };
}

/** GET /api/machines, and the 202 body of POST /api/machines/:machineId/install. */
export interface MachinesResponse {
  machines: MachineInfo[];
  /**
   * The version an install would leave on the remote — the base release, plus a `+hmr.<sha>`
   * suffix when this server carries a pushed version to replicate. Null for a development
   * checkout, which stands on no release the remote could download.
   */
  imageVersion: string | null;
  job: MachineInstallJob | null;
}
