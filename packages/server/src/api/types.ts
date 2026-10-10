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
import type { HarnessInfo, VersionReport, HarnessHistory } from "@prismshadow/penguin-core";
import type { IfacesDiff } from "@prismshadow/penguin-hmr";
import type { WorkflowInfo, WorkflowVersion } from "../mechanisms/workflows.js";
import type {
  PackageManifest as PackageManifestType,
  PublishedGist as PublishedGistType,
  PublishMethod as PublishMethodType,
} from "../mechanisms/packages.js";

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

/** Session source marker (default = user-created): triggered by Schedule / registered as a subagent session / created by a Benchmark evaluation or optimization. */
export type SessionSource = "schedule" | "subagent" | "benchmark";

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
  /**
   * Nickname the account chose (1-32 characters), shown wherever the id would otherwise be.
   * Omitted when unset — every account that predates the Profile page starts without one, and
   * a surface with no value falls back to `userId`.
   */
  displayName?: string;
  /**
   * Present when the account has an avatar: the content revision of the image served at
   * `GET /api/me/avatar` (append it as `?rev=` — the image is cached for good). Omitted when
   * unset, and a surface with no value draws the letter placeholder instead.
   */
  avatarRev?: string;
  createdAt: string;
}

/**
 * PUT /api/me/profile — a patch, not a replacement: an absent field keeps what is stored,
 * `null` clears it, a string sets it. A body naming neither field is a 400, since it can only
 * be a mistake.
 */
export interface UpdateProfileRequest {
  displayName?: string | null;
  avatar?: string | null;
}

export interface UpdateProfileResponse {
  user: UserInfo;
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
  /**
   * The commit this server runs: the pushed harness's source revision when a hot update put
   * one here (the sha of its `g<sha>`, as short as the pusher's describe spelt it), else the
   * build's own commit; null when neither is known. Public with the id: it names a commit
   * and nothing about the machine (company-proposals reads it to place a server deployment on
   * the PR graph).
   */
  commit: string | null;
  /** The describe that commit came from (the harness revision, else the build's). */
  describe: string | null;
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
   * How this server wants uploads handled — what a client is asked to do, not what the server
   * enforces. It rides `/api/me` beside the limits because every user's composer needs it.
   */
  uploadPolicy: UploadPolicy;
  /**
   * Whether company mode is enabled server-wide (the admin switch in server settings, default
   * on). Off hides the mode switch in every client and 404s every organization route; the
   * user's own preference (`UiPrefs.companyMode`) only hides the switch for that user.
   */
  companyMode: boolean;
}

/**
 * The upload policy as the web app sees it: what the composer is asked to do with a pick before
 * it is uploaded. Nothing here gates a request — a client that ignores it is not refused.
 */
export interface UploadPolicy {
  /** Per-message file count. Fixed server-side, not admin-settable. */
  attachmentMaxCount: number;
  /** Whether the composer re-encodes an image above the threshold before uploading it. */
  imageCompression: boolean;
  /** The size above which it does, in whole MB. Below it an image is uploaded byte-for-byte. */
  imageCompressionOverMb: number;
  /**
   * The range the threshold may be set to. Carried here so the admin form states the real bounds
   * without compiling its own copy of them.
   */
  imageCompressionMinMb: number;
  imageCompressionMaxMb: number;
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
   * Whether the composer re-encodes an image larger than `imageCompressionOverMb` before
   * uploading it (default on). Applies to the very next upload — a tab reads the policy from
   * `/api/me`, and nothing is snapshotted at boot.
   */
  imageCompression: boolean;
  /**
   * The size above which an image is re-encoded, in whole MB (default 4). Meaningful only while
   * `imageCompression` is on; a smaller image is uploaded byte-for-byte either way.
   */
  imageCompressionOverMb: number;
  /**
   * Company mode master switch (default on). Off stops the organization scheduler (no
   * calendar event or chat mention fires, nothing is backfilled when it is turned on again),
   * every `/api/projects/:projectId/organizations` route answers 404, and `GET /api/me`
   * reports it so clients hide the mode switch. Organizations on disk are untouched.
   */
  companyMode: boolean;
  /**
   * Whether users may drive their own Chrome through the PenguinHarness Browser extension
   * (default on). Off closes every connected extension (close code 4009), refuses new
   * connections, and makes the chrome backend unavailable (`extension_disabled`); pairings are
   * kept, so turning it on again lets the extensions reconnect.
   */
  browserExtensionsEnabled: boolean;
  /**
   * Whether a GitHub token is stored for publishing Agent packages as gists. The token
   * itself never leaves the server: this flag is all any client is told.
   */
  githubTokenSet: boolean;
}

export interface ServerSettingsResponse {
  settings: ServerSettings;
}

/** PUT body: every field optional, omitted fields keep their current value (mirrors prefs). */
export interface ServerSettingsUpdateRequest {
  proxyForApp?: boolean;
  proxyForAgent?: boolean;
  /** Company mode master switch; see `ServerSettings.companyMode`. */
  companyMode?: boolean;
  /** Chrome extension switch; see `ServerSettings.browserExtensionsEnabled`. */
  browserExtensionsEnabled?: boolean;
  /** GitHub token with the `gist` scope, used to publish Agent packages; "" clears it. */
  githubToken?: string;
  /**
   * New proxy address. Accepted forms: any proxy URL undici's dispatcher takes —
   * `http://`, `https://`, `socks5://` / `socks://`, credentials allowed — or bare
   * `host[:port]` (normalized to `http://…`; only normalized values are stored, and the
   * response echoes the stored form). Empty/whitespace-only or null clears the address
   * (follow the environment variables); anything else is 400 `invalid_proxy_url`.
   */
  proxyUrl?: string | null;
  /** New state of the automatic image-compression switch. Anything but a boolean is 400. */
  imageCompression?: boolean;
  /**
   * New compression threshold in whole MB. Must be an integer between 1 and 64; anything else —
   * a fraction, a string, 102400 for "100GB" — is 400 `invalid_image_compression` and writes
   * nothing.
   */
  imageCompressionOverMb?: number;
}

/**
 * The endpoints the proxy reachability probe covers. A fixed list: the route takes a provider
 * id from this set and never a URL, so nothing a caller sends decides what the server fetches.
 *
 * GLM is two entries rather than one because it is two hosts: Z.AI serves the global endpoint
 * and BigModel the mainland one, they are reached over different routes, and a proxy can carry
 * one and not the other.
 */
export type ProxyProbeProvider =
  "openai" | "anthropic" | "gemini" | "deepseek" | "zai" | "bigmodel";

/**
 * One probe's verdict. `reachable` means an HTTP answer arrived, whatever its status — a
 * rejected credential still proves the whole path works. The rest are transport failures,
 * named so a proxy that swallows connections can be told apart from one whose address does
 * not resolve: `timeout` (no answer within the probe's window), `dns` (the name never
 * became an address), `refused` (the connection was refused at the TCP level), `tls` (the
 * handshake or the certificate failed) and `network` (anything else).
 */
export type ProxyProbeOutcome = "reachable" | "timeout" | "dns" | "refused" | "tls" | "network";

/**
 * One probe target. Served before any probe runs so the page can list what it is about to
 * request — the URLs are the concrete answer to "what does no API key mean here".
 */
export interface ProxyProbeTargetDto {
  provider: ProxyProbeProvider;
  /** The exact URL a probe requests, unauthenticated. */
  url: string;
}

/** What the probe endpoint would request, without requesting it. */
export interface ProxyProbeTargetsResponse {
  targets: ProxyProbeTargetDto[];
}

/** One provider's probe result. */
export interface ProxyProbeDto extends ProxyProbeTargetDto {
  outcome: ProxyProbeOutcome;
  /** Wall time in milliseconds until the answer's headers arrived, or until the attempt failed. */
  ms: number;
  /** The HTTP status, present only when `outcome` is `reachable`. */
  status?: number;
}

/**
 * One probe's answer. The route measures a single target per call: the page asks for all of
 * them at once and fills each row the moment its own answer lands, so one black-holed host
 * cannot hold every other result behind its timeout.
 */
export interface ProxyProbeResponse {
  probe: ProxyProbeDto;
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

/**
 * The account's keyboard shortcut overrides, one section per platform (the Web App's `Mod` token
 * is ⌘ on macOS and Ctrl elsewhere, so a deliberate macOS-only binding must not leak to Windows).
 * Each section maps a command id to a chord string ("Mod+Shift+KeyW") or null (explicitly
 * unbound); only rows that differ from the Web App's default are present. Bounded on write by
 * services/keybindings.ts.
 */
export interface StoredKeybindings {
  v: 1;
  mac?: Record<string, string | null>;
  windows?: Record<string, string | null>;
  linux?: Record<string, string | null>;
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
  /** Keyboard shortcut overrides, replaced whole on every write and validated by services/keybindings.ts. */
  keybindings?: StoredKeybindings;
  /** Personal company-mode switch (default on): off only hides this user's mode switch; organizations keep running. */
  companyMode?: boolean;
  /** The work mode the user last chose in the shell: development (default) or company. */
  workMode?: "dev" | "company";
  /** The organization last opened in company mode, as `<projectId>/<orgId>`. */
  lastOrgKey?: string;
  /** The one group balance shown beside the user name (pinned on the models page); null when unpinned. */
  pinnedBalance?: PinnedBalance | null;
  /**
   * The browser this user's agents drive. Written only through PUT /api/builtin-browser/backend
   * (PUT /api/me/prefs refuses it): absent means built-in for an admin on the desktop, chrome
   * everywhere else.
   */
  browserBackend?: BrowserBackend;
  [key: string]: unknown;
}

/** A group balance pinned beside the user name: which Project's key reads which group's balance. */
export interface PinnedBalance {
  projectId: string;
  provider: string;
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
// Model and credential config (single .project_config.toml file; credentials are inlined in it:
// once per group in [providers.<id>], and on a model entry where that model overrides its group)
// ---------------------------------------------------------------------------

/**
 * Model reference DTO: `(provider, modelId)` pair.
 * `modelId` is the upstream request id, sent to MMSP as-is — `<provider>/<id>` string
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

/**
 * One group's `[providers.<id>]` connection as the page reads it: the values the GROUP stores
 * (never the catalog's), the key masked. An absent field is unset: a row with no value of its
 * own then gets the client's default.
 */
export interface ProviderConnectionDto {
  baseUrl?: string;
  clientType?: string;
  apiKeyMasked?: string;
  /** When the group key was written (ISO 8601). */
  createdAt?: string;
}

/** Where an effective connection value comes from: the row itself, its group, or nowhere (the client's default). */
export type ConnectionSourceDto = "model" | "provider" | "none";

/**
 * What a row is actually used with, after core's effectiveConnection (row -> group -> none,
 * per field; the file's values only — the catalog is not consulted), and where each value
 * came from. The group's key counts only where it reaches the row (core's groupKeyReaches).
 * The row's own values stay in `clientType` / `credential` (what the form edits); this is for
 * display.
 */
export interface ModelEffectiveConnection {
  baseUrl?: string;
  baseUrlSource: ConnectionSourceDto;
  clientType?: string;
  clientTypeSource: ConnectionSourceDto;
  /** `env` = no row or group key, and the environment lends one on the effective endpoint (modelEnvFallback). */
  apiKeySource: "model" | "provider" | "env" | "none";
  /** Mask of the key the row would use, whichever source; absent when none. */
  apiKeyMasked?: string;
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
  /** Upstream model id (the request id actually sent to MMSP); paired with `provider` forms the entry's unique key. */
  modelId: string;
  /**
   * Display name: explicit TOML field (user-edited) takes priority, then the built-in catalog;
   * falls back to unset (frontend shows modelId). The empty string is reported as such and
   * means the user cleared the name on a model the catalog does name — render it as modelId,
   * and send it back unchanged, since absent would ask for the catalog's name instead.
   */
  displayName?: string;
  contextWindow?: number;
  /**
   * The row's OWN MMSP client type (`openai-chat`, `openai-responses`, etc.) — an override of
   * its group's; absent = the row follows its group (see `effective`).
   */
  clientType?: string;
  /**
   * Whether image input (vision/multimodal) is supported: the TOML `vision` annotation only
   * (a new Project writes `false` where the catalog says so); absent = unset, treated as
   * supported. The catalog is not consulted.
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
   * tier at premium pricing (MMSP UniConfig `fast_mode`). Only `true` is reported;
   * unset = off. Models without a fast tier reject requests carrying it.
   */
  fastMode?: boolean;
  pricing?: ModelPricingDto;
  /** Running promotion for this row — a fraction in (0, 1) off `pricing`, which is the list price — read from web.db. Absent when the row has none. */
  discount?: number;
  /**
   * Environment variable name the entry falls back to when api_key is empty (e.g.
   * ANTHROPIC_API_KEY); unset when it gets no fallback — an id nothing routes, or an entry
   * whose base URL is not the vendor's own official endpoint (a gateway preset, a custom /
   * vLLM / user-created row with its own endpoint, a vendor row re-pointed at a proxy).
   */
  envKey?: string;
  /**
   * Masked preview (same rule as `credential.apiKeyMasked`) of the value the server process
   * currently holds for `envKey` — the plaintext is never serialized. Reported only where the
   * fallback may be presented as covering the entry (core's modelEnvPreviewKey): a row whose
   * effective base URL is a vendor endpoint (or the Penguin Go relay), or a row with no base URL
   * in a built-in group other than custom, on the client its id's family names. Gateway rows
   * never carry it, and neither do custom / vLLM / user-defined rows with no base URL,
   * although those do fall back. Absent = the variable is unset or empty, or the entry is not
   * previewable. Computed on the effective shape, and only when no row or group key reaches
   * the row.
   */
  envKeyMasked?: string;
  /** The row's OWN key (masked) and base URL — overrides of its group's; see `effective`. */
  credential?: CredentialInfo;
  /** The connection the row is actually used with, and where each value comes from. */
  effective: ModelEffectiveConnection;
  isDefault: boolean;
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

/**
 * A change to one group's connection (`PUT /models/providers/:provider`, or a member of
 * `ModelsUpdateRequest.providers`). Omitted fields are kept.
 */
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

/** PUT full-table replace semantics: models not present are deleted; omitting apiKey = keep existing value. Key = (provider, modelId). */
export interface ModelUpdateEntry {
  /** Provider group (an independent entry field, always submitted with the request). */
  provider: string;
  /** Upstream model id (sent to MMSP as-is). */
  modelId: string;
  /**
   * Display name; the server does not persist it when it matches the built-in catalog (keeps
   * the config file clean). Absent and empty are different requests: absent inherits whatever
   * the catalog calls the model, the empty string records that the user cleared the name.
   */
  displayName?: string;
  /**
   * The pair reference this entry was renamed from (provided when either the group or the
   * upstream id changes): the server uses this to migrate the original entry's credential
   * and unknown fields to the new key — otherwise a full-table replace would delete the
   * original entry along with its credential.
   */
  renamedFrom?: ModelRefDto;
  contextWindow?: number;
  /**
   * Empty string/omitted = the row stores none: it follows its group's protocol, else MMSP
   * routes by the vendor family the modelId begins with.
   */
  clientType?: string;
  /** Whether image input (vision/multimodal) is supported; omitted = supported (not persisted). */
  vision?: boolean;
  /** Per-model max output tokens, a positive integer (wins over the Agent config); omitted = inherit the Agent value (the annotation is cleared). */
  maxTokens?: number;
  /** Per-model fast mode: only `true` is persisted; omitted or `false` clears the annotation (absent = off). */
  fastMode?: boolean;
  pricing?: ModelPricingDto;
  /**
   * Promotion to store for this row, a fraction in (0, 1) off `pricing`; `null` clears it. Omitted
   * keeps the stored promotion — unless this entry renames the row or changes its pricing, which
   * clears it.
   */
  discount?: number | null;
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
  /** Vision model used as a proxy reader for read_file: must be included in models and not annotated vision=false; omitted keeps the existing value. */
  visionModel?: ModelRefDto;
  /** Group connection changes, merged per provider; a provider absent here keeps its table. */
  providers?: Record<string, ProviderConnectionUpdate>;
  models: ModelUpdateEntry[];
}

/**
 * `POST /models/sync-presets` (owner): `add` adds the catalog's presets the Project lacks
 * (retired rows never), as a new Project stores them, writes the catalog's
 * `[providers.<id>]` table for a group that has neither rows nor a table yet, and seeds the
 * added rows' promotions, touching nothing else; `restore` puts every built-in row and
 * built-in group table back to the catalog (facts reset, base URLs and protocols set on models
 * or groups return to the catalog's, keys and the user's own rows and groups kept, promotions
 * reset, deleted presets added back).
 */
export type PresetSyncMode = "add" | "restore";

export interface PresetSyncRequest {
  mode: PresetSyncMode;
}

export interface PresetSyncResponse extends ModelsResponse {
  /** Preset rows added (both modes). */
  added: number;
  /** Built-in rows reset to the catalog (`restore`; 0 for `add`). */
  restored: number;
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
 * MMSP's generic protocol clients a custom base URL serves — `openai-responses` first,
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
  /**
   * Optional paired reference: when it names a stored entry and no apiKey is given, that
   * entry's saved key backs the probes (mirrors the connectivity test), else its group's.
   * `provider` may be sent without `modelId` (the group settings dialog has no model): the
   * group key backs the probes.
   */
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
  /** MMSP client type this probe stands for (`openai-responses` / `ant-messages` / `openai-chat`). */
  clientType: string;
  /** Full URL probed (base URL + the protocol's path). */
  url: string;
  outcome: ProtocolProbeOutcome;
  /** HTTP status, when a response arrived at all. */
  status?: number;
}

/**
 * Detection result: probes run sequentially over the candidate base URLs derived from the
 * one that was typed and stop at the first served protocol, so `probes` lists only the
 * ones actually run, in order.
 */
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

/**
 * Endpoint model listing (POST /api/projects/:p/models/list, owner): given a base URL and
 * the protocol `/detect` reported, returns every model id the endpoint serves (MMSP's
 * `listModels()` on the routed client). Used by the add-group dialog to import a provider's
 * whole listing in one go; the ids come back in the endpoint's own order.
 */
export interface EndpointModelListRequest {
  /** Endpoint base URL (as typed in the add-group dialog). */
  baseUrl: string;
  /** MMSP client type to speak (normally a detected generic protocol; whole-endpoint listings need one). */
  clientType: string;
  /** Newly entered API key (plaintext); omitted = the SDK's environment fallback for the protocol. */
  apiKey?: string;
}

/** Listing outcome: model ids on success, a truncated provider/SDK reason otherwise. */
export interface EndpointModelListResponse {
  ok: boolean;
  /** The model ids the endpoint serves, in the order the endpoint returned them (ok only). */
  models?: string[];
  /** The routed client has no models endpoint (MMSP UnsupportedOperationError) — callers offer the manual path. */
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

/** One balance in one currency. */
export interface ModelBalanceAmount {
  /** Decimal string in `currency`'s major unit, as the vendor states it (TokenDance's micro-yuan are converted to yuan). */
  amount: string;
  /** ISO 4217 code: `CNY`, `USD`, … */
  currency: string;
}

/**
 * Why a group's balance could not be read:
 * - `unsupported`: the group publishes no balance endpoint (no `balance` descriptor in the catalog);
 * - `no_key`: the group has no API key to ask with — none stored, and no environment variable
 *   the credential rule lends its rows for the balance endpoint's host;
 * - `upstream_failed`: the vendor could not be reached in time, refused the request, or answered
 *   without a readable balance.
 */
export type ModelBalanceErrorCode = "unsupported" | "no_key" | "upstream_failed";

/**
 * GET /api/projects/:p/models/balance?provider=<group>[&force=1] (Project member): the account
 * balance behind the group's API key — the stored one, or else the environment key its rows
 * fall back to under the credential rule (DeepSeek's DEEPSEEK_API_KEY) — read server-side from
 * the endpoint the catalog's `balance` descriptor names. The key never reaches the browser, and
 * neither does the vendor's own text. Like the connectivity test, a balance that cannot be read is an answer
 * (`ok: false` with a code), not a failed request. Readings and vendor failures are cached for
 * 60 s per Project and group, for as long as the group's key is the same; `force=1` skips the
 * cache and refreshes it.
 */
export type ModelBalanceResponse = ModelBalanceReading | ModelBalanceFailure;

export interface ModelBalanceReading extends ModelBalanceAmount {
  ok: true;
  provider: string;
  /** Whether the account can make requests right now (DeepSeek's `is_available`); absent when the vendor does not say. */
  available?: boolean;
  /** Further currencies the account holds, after the one in `amount` / `currency`; absent when there is only one. */
  others?: ModelBalanceAmount[];
  /** When the server read it from the vendor (ISO 8601); a cached answer keeps its original time. */
  fetchedAt: string;
}

export interface ModelBalanceFailure {
  ok: false;
  provider: string;
  error: ModelBalanceErrorCode;
  /** The vendor's HTTP status, when it answered with an error. */
  status?: number;
  /** English detail for logs and bug reports; the Web App words each code itself. */
  message: string;
  /** When the answer was settled (ISO 8601). */
  fetchedAt: string;
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
// Penguin Go key authorization (/api/projects/:p/platform-auth, owner)
// ---------------------------------------------------------------------------

export interface PlatformAuthStartResponse {
  flowId: string;
  authorizeUrl: string;
  expiresAt: string;
}

export type PlatformAuthFlowErrorCode =
  | "unreachable"
  | "upstream_failed"
  | "invalid_key"
  | "expired"
  | "locked"
  | "already_delivered"
  | "apply_failed";

export interface PlatformAuthFlowStatusResponse {
  status: "pending" | "applying" | "completed" | "cancelled" | "apply_failed" | "error";
  error?: PlatformAuthFlowErrorCode;
  applied?: number;
}

/** Result of refreshing Penguin Go's catalog with the Project's stored platform key. */
export interface PlatformModelSyncResponse extends ModelsResponse {
  added: number;
  updated: number;
}

// ---------------------------------------------------------------------------
// ModelScope key authorization (/api/projects/:p/modelscope-auth, owner)
// ---------------------------------------------------------------------------

/**
 * The wire shapes are Penguin Go's, deliberately: both flows create a request, poll it, and
 * report the same six states and the same seven failure codes, so the App drives both with one
 * dialog. They are aliases rather than a second declaration because a copy would be the same
 * fields with the same meaning, and a shape that drifted apart in one of the two would be a
 * bug rather than a distinction. The endpoints stay separate regardless — a flow id issued by
 * one is not accepted by the other.
 */
export type ModelScopeAuthStartResponse = PlatformAuthStartResponse;
export type ModelScopeAuthFlowErrorCode = PlatformAuthFlowErrorCode;
export type ModelScopeAuthFlowStatusResponse = PlatformAuthFlowStatusResponse;

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
  /**
   * Read-only, GET only: the sandbox policy a new Session starts with — the server's Sandbox
   * settings. Not part of the Project's block; PUT ignores it.
   */
  sandbox?: SessionSandbox;
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
  /** The LIBRARY's version (`YYYY.MM.DD.N`), i.e. what installing again would bring, not what is on disk. */
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

/**
 * Hook config, edited on the Hooks tab. One Agent-level switch and no prompt: hook packages
 * are scripts run at the loop's hook points, not text injected into the context. `enabled`
 * reports the effective value (a config with no `hooks` section reads as enabled, matching
 * core).
 */
export interface AgentHooksConfigDto {
  /** Whether a Session created from now on runs the installed hook packages (they stay installed either way). */
  enabled: boolean;
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
  hooks: AgentHooksConfigDto;
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
    /** The Agent-level hook switch; it has no prompt half. */
    hooks?: { enabled?: boolean };
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

/** How far a Session's commands may reach the filesystem (the sandbox's confinement mode). */
export type SessionSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * The part of a Session's sandbox policy a person picks from the composer: the filesystem
 * mode and the network level. The Session keeps its own copy — taken from the server's
 * Sandbox settings when it was created — so editing those settings only changes what NEW
 * Sessions start with.
 */
export interface SessionSandbox {
  mode: SessionSandboxMode;
  /** `open` = unrestricted, `local` = only the host's localhost, `none` = no network. */
  network: SessionSandboxNetwork;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `read-only` and `workspace-write` modes. False on a deployment with no backend
   * installed, where either mode would refuse every command: the composer shows them greyed
   * out, saying no backend is installed.
   */
  confinementSupported?: boolean;
  /** Response only, ignored in requests: the same for the `none` network level. */
  noNetworkSupported?: boolean;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `local` level. When false the composer shows it greyed out, and picking it is refused
   * (400 `sandbox_unsupported`).
   */
  localNetworkSupported?: boolean;
  /** Response only, ignored in requests: whether a backend here can enforce `masksPaths`. */
  maskPathsSupported?: boolean;
  /**
   * Response only, ignored in requests: true when this policy hides paths (the Sandbox card's
   * masked paths, kept by every pick). Where `maskPathsSupported` is false, every level then
   * refuses every command, and the composer says so.
   */
  masksPaths?: boolean;
  /**
   * Response only, ignored in requests: the names of the sandbox backends in use here, which the
   * composer names when a level is beyond what they enforce. Absent with none in use.
   */
  backendsInUse?: string[];
  /**
   * Response only, ignored in requests: the sandbox backends that are enabled here but failed
   * to load or failed their check (a WSL distro not set up, a wrong program path), each with
   * why. A backend for another platform is not listed. With none mounted and one listed, the
   * composer marks the confining levels unavailable and gives the first one's reason.
   */
  unavailableBackends?: UnavailableSandboxBackend[];
  /**
   * Response only, ignored in requests: the server's sandbox presets (the Sandbox card's table),
   * in table order, disabled rows included. The composer lists the enabled ones and names the
   * Session's level by the first row matching its mode, network and approval mode. A server
   * that does not report it gets the composer's built-in table.
   */
  presets?: SessionSandboxPreset[];
  /**
   * Response only, ignored in requests: true when this Session's policy holds something the
   * presets do not show — masked paths, or the temp directory not writable.
   */
  advanced?: boolean;
  /**
   * Response only, chat defaults only: the approval mode a new Session starts with when its
   * request names none — the Sandbox card's default preset's, while the switch is on. Absent:
   * the server's own fallback (`allow-all`).
   */
  defaultApprovalMode?: ApprovalMode;
  /**
   * Response only, ignored in requests: the Sandbox card's switch on this server — whether new
   * Sessions start confined. Off, the composer offers the approval modes alone (a Session keeps
   * its own policy either way). A server that does not report it is read as on.
   */
  switchOn?: boolean;
}

/** One sandbox preset: a named mode, network level and approval mode. */
export interface SessionSandboxPreset {
  id: string;
  /** The name an administrator gave it, or its declared English name. */
  name: string;
  /** Its declared Chinese name, while it has not been renamed. */
  nameZh?: string;
  /** Whether the composer's menu lists it. */
  enabled: boolean;
  mode: SessionSandboxMode;
  network: SessionSandboxNetwork;
  approvalMode: ApprovalMode;
  /**
   * Response-only: its file mode or network is wider than the server's sandbox settings (the
   * ceiling for non-admins), so a non-admin's pick of it is refused with `403 sandbox_forbidden`.
   * The same comparison as that refusal; absent when it is within them.
   */
  aboveCeiling?: true;
}

/** An enabled sandbox backend that is not in use on this server, and why. */
export interface UnavailableSandboxBackend {
  name: string;
  reason: string;
}

/** The network levels, widest first. */
export type SessionSandboxNetwork = "open" | "local" | "none";

export interface SessionInfo {
  sessionId: string;
  projectId: string;
  agentId: string;
  /**
   * Provider group of the session's **current** model (paired with `modelId` to form a model
   * reference). It moves with each in-session switch (`POST /api/sessions/:id/switch-model`).
   */
  provider: string;
  /** Upstream model_id of the session's current model (the request id sent to MMSP). */
  modelId: string;
  workspace: string;
  approvalMode: ApprovalMode;
  /** The Session's own sandbox policy (see {@link SessionSandbox}). */
  sandbox: SessionSandbox;
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
  /**
   * For a surface Session, the surface's own answer; otherwise the run state. A surface
   * Session never reports `compacting`.
   */
  status: SessionStatus;
  /**
   * The Session's surface: the `kind` of a plugin-contributed surface (see
   * `ContributionsResponse.sessionSurfaces`); absent for the built-in conversation. A
   * surface Session carries no model reference (`provider` / `modelId` are empty) and takes
   * no Tasks — the chat page renders the surface's renderer in place of the conversation.
   */
  surface?: string;
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
  /**
   * Company mode: the organization that owns this Session — a desk session of one of its
   * employees, or a session contributing to one of its tickets — read from the organization
   * caches. Absent for every ordinary Session. Development mode's list asks the server to
   * leave every such row out (`excludeOrg=1` on the list route — page and totals alike) and
   * still drops one that reaches it by another door; the company sidebar's 工位 group and the
   * tickets are where these Sessions are reached instead.
   */
  orgId?: string;
  /**
   * Which client opened the Session, as stored on the index row: "cli" from the CLI (a
   * Session adopted from a legacy CLI-direct Trace included), "org" from the organization
   * runtime (a desk or a ticket session, and every sub-session one of those spawns), "web"
   * otherwise. Absent only on a row that
   * predates the column, which reads as "web". Unlike {@link SessionInfo.orgId} — projected
   * from the organization caches, so it disappears with the organization and is not read
   * while company mode is off — this is a durable stamp on the row: development mode's list
   * hides an "org" Session either way.
   */
  client?: "web" | "cli" | "org";
  /**
   * Background work the Session's loaded runtime still owns: command sessions running past
   * their yield window (`exec_command` promotions and `run_in_background` launches) and
   * background subagent sessions mid-round. Read from the runtime's in-memory registries —
   * no Trace is consulted — and present only while at least one count is non-zero, so a
   * Session that is not loaded (a resumed entry starts with empty registries) and one with
   * nothing running both omit it. Changes are pushed as `session_background` on the user
   * channel; list rows and the single-session GET carry the same field.
   */
  backgroundTasks?: SessionBackgroundTasks;
}

/** The background-task counts of one Session (see SessionInfo.backgroundTasks). */
export interface SessionBackgroundTasks {
  /** Background command sessions whose process is still running. */
  processes: number;
  /** Background subagent sessions (promoted to a `subagent_id`) currently mid-round. */
  subagents: number;
}

/**
 * Session list category, the sidebar's five-way split applied server-side: archived wins
 * regardless of origin (archiving is an explicit user action), then the origin's bucket,
 * and a Session with no (or an unknown) source is `active` — user-created rows.
 */
export type SessionCategory = "active" | SessionSource | "archived";

/** Per-category totals across an Agent's whole Session list (returned when the list is requested with counts). */
export type SessionCategoryCounts = Record<SessionCategory, number>;

/**
 * GET /api/projects/:projectId/agents/:agentId/sessions. Every query parameter is optional:
 *
 * - `order`: `created` (the default) lists newest creation first; `activity` lists most recent
 *   `lastActiveAt` first, ties broken by `sessionId` descending, both compared as plain strings
 *   (code points, never locale collation) so a client can compute the same order.
 * - `limit` (1–1000) with `offset` (≥ 0): an offset page, in either order. Offsets suit only the
 *   `created` order, which activity never reshuffles.
 * - `before=<lastActiveAt>,<sessionId>` with `limit`: under `order=activity` only, the rows
 *   strictly below that cursor — the key of the last row the client holds. A row that becomes
 *   active between pages moves above the cursor and is not served again, and no other row is
 *   skipped (`session_state` tells the client about the moved one). 400 without
 *   `order=activity`, beside `offset`, without `limit`, or when not a parseable stamp and a
 *   valid id split at the first comma.
 * - `category`, `workspaceGroup`, `excludeOrg=1` filter before paging; `counts=1` adds the
 *   whole-list totals below, which no cursor or offset narrows.
 */
export interface SessionsResponse {
  /**
   * The page. With `excludeOrg=1` on the request, the rows an organization owns — its desk
   * and ticket sessions and the sub-sessions they spawned — are left out of it and of every
   * total below, so a caller drawing the user's own conversations is never handed a total
   * for rows it will not be handed. Without the flag every row is served, whichever client
   * created it.
   */
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
  /**
   * Present with `counts`: each Workspace path's newest Session (any category), as its
   * `createdAt`. With `workspaceCounts` this is what lets the sidebar list every Workspace
   * that holds Sessions and place the groups by recency before — or without — loading any
   * of their rows.
   */
  workspaceLatest?: Record<string, string>;
}

/**
 * One Session's live facts, for the dashboard: where it is, whether it is working, whether it
 * ever ran, and when it last did. The dashboard counts running and to-review from these the
 * way the sidebar draws its glyphs — to-review is "finished since this browser last opened
 * it", a per-browser fact the server cannot know, so it hands over the facts and not a count.
 */
export interface SessionActivityInfo {
  sessionId: string;
  /** The Agent the Session belongs to (SessionInfo.agentId): opening it makes that Agent current. */
  agentId: string;
  /** The Workspace path as the Session carries it (SessionInfo.workspace). */
  workspace: string;
  status: SessionStatus;
  /** Whether a Task has been started (SessionInfo.hasTrace): a Session that never ran has nothing to review. */
  hasTrace: boolean;
  /** SessionInfo.lastActiveAt — what the read/unread marker is compared against. */
  lastActiveAt: string;
  /** SessionInfo.title; absent while none has been generated. */
  title?: string;
  /**
   * SessionInfo.source: how the Session came to be. The dashboard leaves a subagent Session
   * out of its counts — it belongs to the conversation that spawned it, which is the row the
   * sidebar shows and the one a person opens.
   */
  source?: SessionSource;
}

/**
 * `GET /api/projects/:projectId/sessions/overview`: every non-archived Session of the Project,
 * over every Agent, less an organization's (the rows the list's `excludeOrg=1` leaves out).
 */
export interface SessionsOverviewResponse {
  sessions: SessionActivityInfo[];
}

/** Server directory browsing (the Workspace picker): starts from the home directory by default, can navigate up to the root. */
export interface DirEntryInfo {
  name: string;
  /** Absolute path of this entry (a folder's can be submitted directly as a Workspace). */
  path: string;
  /**
   * `file` for anything that is not a folder (a symlink counts as what it points to). Absent
   * means a folder: a machine listed over ssh reports folders only.
   */
  kind?: "dir" | "file";
  /** Last modification, epoch milliseconds; absent when unknown (listings over ssh, an entry stat could not reach). */
  mtime?: number;
  /** Hidden by the machine's own rules beyond the dot-name convention (Windows hidden/system attribute). */
  hidden?: true;
}
/** A storage location the machine offers beside its folders: a Windows drive, a macOS volume, a Linux root or mount. */
export interface DirLocation {
  /** Absolute path it opens (`C:\`, `/`, `/Volumes/USB`, `/media/me/USB`, `/mnt/c`). */
  path: string;
  kind: "drive" | "removable" | "network" | "optical" | "volume" | "root";
  /** The machine's own name for it (volume label, volume name, share `\\nas\media`, WSL `C:`); absent when none. */
  label?: string;
}
/** The platform's standard folders as that machine resolves them; only those that exist. */
export interface DirStandardFolders {
  desktop?: string;
  documents?: string;
  downloads?: string;
  pictures?: string;
}
export interface DirListResponse {
  /** Absolute path of the current directory (realpath). */
  path: string;
  /** Absolute path of the parent directory; null when already at the root. */
  parent: string | null;
  /** Entries sorted by name, hidden ones included (the picker drops them). */
  entries: DirEntryInfo[];
  /** The listed machine's `process.platform`; absent for a machine listed over ssh. */
  platform?: string;
  /** Home request with `places=1` only. */
  standardFolders?: DirStandardFolders;
  /** Home request with `places=1` only, in the order the sidebar lists them. */
  locations?: DirLocation[];
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
   * The Session's sandbox policy; either half omitted takes the server's Sandbox settings.
   * A non-admin may not pick anything looser than those settings (403 `sandbox_forbidden`).
   */
  sandbox?: Partial<SessionSandbox>;
  /**
   * Creating-client hint stored on the Session row: "cli" when the CLI creates the
   * Session through the API, "org" when the organization runtime opened it (a desk or a
   * ticket session — company mode's own, kept out of development mode's lists whether or
   * not the organization still exists); defaults to "web". A REQUEST may send only "web" or
   * "cli": the runtime writes "org" by calling the service directly, so no caller can claim
   * an organization's provenance for its own Session. Lists serve every row regardless of
   * client unless asked for the user's own rows only (`excludeOrg=1`), which is what
   * development mode's session list asks for.
   */
  client?: "web" | "cli" | "org";
  /**
   * Marks the Session as created by a Benchmark evaluation or optimization (the Evaluation
   * Center's Use flows, and the Test Sessions agent-evaluation launches through the CLI). Only
   * this value is accepted from a client: `subagent` and `schedule` are written by the server
   * itself. The Web App files such Sessions into the Evaluations folder of the session list.
   */
  source?: "benchmark";
  /**
   * Create a surface Session of this kind (one of `ContributionsResponse.sessionSurfaces`;
   * 400 `unknown_surface` otherwise). `modelId` / `provider` are ignored: a surface Session
   * has no model. Open it afterwards with `POST /api/sessions/:sessionId/surface`.
   */
  surface?: string;
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
   * Change this Session's sandbox policy; applies from its next command. A non-admin may not
   * pick anything looser than the server's Sandbox settings (403 `sandbox_forbidden`).
   */
  sandbox?: Partial<SessionSandbox>;
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
 * or steering group ever splits across windows. Besides the unit count, a window stops
 * before the unit that would take its serialized messages past 4 MiB, but always holds at
 * least one unit; such a window carries `before` like any other, with fewer units than
 * asked for.
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
    /**
     * Model-API time and tool wall time accrued before this window, the breakdown of
     * `elapsedMs` the chat header shows under it. Seeded together with their total: seeding
     * one alone would put a full elapsed time beside components covering only the window.
     * The two may overlap and do not partition `elapsedMs` (see `TraceTaskStats.toolMs`).
     */
    apiMs: number;
    toolMs: number;
    sessionTokens: number;
    contextTokens: number;
  };
  /**
   * The model of the context this window starts in — what the `session_meta` heading that
   * context's Trace file names. A Session can switch models between contexts, and a window
   * that starts partway into one does not hold that record: the client seeds it, so the Tasks
   * ahead of the window's first `session_meta` have their model, and a switch further down the
   * window is told from a plain rotation. Absent when the Session has no Trace yet.
   */
  contextModel?: ModelRefDto;
}

/** Message history: the full messages and events from concatenating all of this Session's Trace files in order (excludes partial_*). */
export interface MessagesResponse {
  /**
   * On windowed requests, images are served by reference: in every record that carries a
   * `tracePosition`, an inline PNG / JPEG / GIF / WebP `data:` URL — a user `image_url`, or
   * an entry of a tool output's `images` — is replaced by
   * `/api/sessions/<sessionId>/trace-image?file=<fileIndex>&ordinal=<ordinal>[&i=<k>]`
   * (`i` = the index into `images`), an immutable, access-checked image response. Expanded
   * subagent messages, held inputs not yet in the Trace, other image types and the
   * parameterless full read keep their data URLs.
   */
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
   * Bounded only by what the transport can decode. An inline image is written into the Trace
   * and read back on every history page and every resume, so the Web App re-encodes a large
   * one before uploading it (see `uploadPolicy` on `GET /api/me`); an API client sends what it
   * likes and pays that cost as it stands.
   */
  | { type: "image_url"; imageUrl: string }
  /**
   * File attachment (the composer's "+" menu): `dataUrl` is a base64 `data:` URL of the
   * file's bytes. No size limit of its own — one message may carry at most 20 files
   * (413 `too_many_files`), and the request as a whole has to be one this API can decode
   * (413 `payload_too_large`, the platform's string ceiling). The
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

/**
 * `POST /api/sessions/:sessionId/switch-model`: switch this Session to another model in place.
 * The running context is closed on the model it ran on, then the next one opens on the target.
 *
 * - **202** {@link TaskCreateResponse} — the switch streams, the Session status `compacting`.
 *   A context with a completed turn is closed by an ordinary `manual` compaction pair (always
 *   summarize); one without — just compacted, or its first request never finished — has
 *   nothing to summarize and streams no pair. Then come the new context's opener records
 *   and, last, its `session_meta`: its `provider` / `model_id` name the model the Session now
 *   runs on, the Session reads report that pair from this record on, and `task_state` turns
 *   idle after it.
 *   A compaction that ends other than `completed` means no switch — no `session_meta` follows
 *   and the Session keeps its model.
 * - **200** {@link SessionResponse} — a Session that never ran has no context to close: it
 *   switched inside the request, and nothing is streamed.
 * - **409**, one code per refusal, before any event: `task_in_progress` / `compacting` (busy),
 *   `same_model`, `model_not_configured` (the target is not in the Project config),
 *   `model_unavailable` (its client cannot be constructed, e.g. no credential), and
 *   `compaction_not_configured`.
 */
export interface SessionSwitchModelRequest {
  /** Provider group of the target model. */
  provider: string;
  /** Upstream model_id of the target model. */
  modelId: string;
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
export type MessagingChannel = "feishu" | "telegram" | "qq" | "wechat" | "discord";

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

/**
 * The stored Discord config, token masked (plaintext never leaves the server).
 *
 * No preference field is re-declared: the three delivery preferences cost what they cost on
 * Telegram here — no reply budget, no expiring window. The one thing the channel charges
 * differently for is size, and that is the connector's, not a preference's.
 */
export interface DiscordBindingInfo extends MessagingBindingCommon {
  channel: "discord";
  /** The bot's user id, decoded from the token's first segment — the channel-scoped account identity, never secret. */
  botId: string;
  /**
   * Masked bot token (site-wide mask rule: `***`, or `first4…last4` for long values);
   * absent when no token is stored (cleared) — the binding cannot be enabled until one
   * is saved.
   */
  botTokenMasked?: string;
}

/** A Session's saved config for one messaging channel (`channel` is the discriminant). */
export type MessagingBindingInfo =
  FeishuBindingInfo | TelegramBindingInfo | QQBindingInfo | WeChatBindingInfo | DiscordBindingInfo;

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

/** GET / PUT …/messaging/discord response (the Discord narrowing of the same envelope). */
export interface DiscordBindingResponse {
  binding: DiscordBindingInfo | null;
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
 * PUT …/messaging/discord — saves the credential ONLY, the Telegram contract exactly: the
 * whole credential is the one bot token from the developer portal, whose first segment
 * names the bot (400 `discord_token_invalid` when it cannot be read); an enabled binding's
 * connector restarts with the new token; the connection toggle is POST …/state.
 */
export interface DiscordBindingPutRequest extends MessagingDeliveryPatch {
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

/** POST …/messaging/discord/test — the draft token; omitted, the stored one is probed. */
export interface DiscordTestRequest {
  botToken?: string;
}

/** Discord credential-test outcome: success additionally names the bot the token signs in as. */
export interface DiscordTestResponse {
  ok: boolean;
  latencyMs?: number;
  /** The bot's `@username`, as `GET /users/@me` reports it. */
  botUsername?: string;
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
 * `feishu_no_chat` / `telegram_no_chat` / `qq_no_chat` / `wechat_no_chat` / `discord_no_chat`
 * before one exists). On QQ this can
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
   * A plugin's own event to the people of a Project: `plugin` is the package's short name
   * (the id its module contributions carry, e.g. `company-proposals`), `data` whatever it
   * publishes. The platform relays it; only the plugin's page reads it.
   */
  | { type: "plugin"; plugin: string; data: unknown }
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
   * A Session now exists. On the user channel for every creation — the CLI, another tab,
   * a schedule, an agent spawning a child — so the list learns about rows it did not make;
   * and on the parent Session's channel for a subagent, so a tab watching the parent run
   * refreshes in place. `source` is absent for a user-created Session, as it is on the row.
   * `client` is `"org"` when the organization runtime opened it (a desk or ticket session),
   * as it is on the row: a list of the user's own rows (`excludeOrg`) has nothing to fetch.
   */
  | {
      type: "session_created";
      projectId: string;
      agentId: string;
      sessionId: string;
      source?: SessionSource;
      client?: "org";
    }
  | ScheduleServerEvent
  | GoalServerEvent
  | CompanyServerEvent
  | BuiltinBrowserServerEvent;

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
  /** A workflow of the Agent was (re)loaded — its folder changed, a reload was requested, or a version was restored. */
  | { type: "workflow_updated"; projectId: string; agentId: string; workflow: WorkflowInfo }
  /** A workflow's folder is gone — removed from the Web App or deleted on disk. */
  | { type: "workflow_removed"; projectId: string; agentId: string; workflowId: string };

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
 * One file's share of the context: its `read_file` / `edit_file` / `write_file` calls plus their
 * results, keyed by the file each call named.
 */
export interface ContextFileShare {
  /**
   * Workspace-relative when the file is inside the Session's Workspace; otherwise absolute, with
   * the home directory shortened to `~`. Spellings that resolve to the same file are one row.
   */
  path: string;
  tokens: number;
  /** How many calls of each file tool named the file in this context. */
  ops: { read: number; edit: number; write: number };
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
 * recorded in the same Trace shard has no tool to be attributed to). `topFiles` is the same
 * ranking narrowed to the three file tools and keyed by the file each call named.
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
  /** Files ranked by the context their file-tool traffic occupies, descending; at most five. */
  topFiles: ContextFileShare[];
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
  /**
   * Record count of the file (basis for pagination), in the ordinals `tracePosition` and the
   * analysis' `messageFrom` / `messageTo` use: malformed lines are not records.
   */
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
   * This turn's cost in USD: each Request's three buckets at the Project's current rates for
   * the file's model, at the tier that Request's own timestamp fell in — the rule and the
   * price lookup the cost center applies to the usage row the same `token_usage` produced,
   * so this figure, the toolbar's and the cost center's agree on what a request cost. Present
   * on every turn of a priced file (a turn with no Request reads 0); absent when the model has
   * no pricing or the file's head names no provider, and then absent from the response's
   * total as well.
   */
  cost?: number;
  /**
   * Total LLM generation duration for this turn (the denominator for output TPS; human
   * approval wait already deducted). The numerator is simply `tokens.output`: since
   * compaction forms its own turn, each turn's output tokens are just its own Requests'
   * output — there's no second figure to reconcile.
   */
  llmMs: number;
  /**
   * Wall-clock time this turn spent executing tools: the **union** of its tool spans'
   * execution intervals (`approvalTs ?? callTs` to `outputTs`), so tools running in parallel
   * are counted once instead of summed. Two exclusions, both deliberate: the human approval
   * wait (`callTs` to `approvalTs`) is not tool work, and the argument-generation segment is
   * the model streaming arguments, already counted in `llmMs`. A span with no `outputTs` —
   * still running when the file ended, or interrupted — contributes nothing rather than being
   * extrapolated to now.
   *
   * This and `llmMs` may **overlap**: a tool started in the background keeps running while the
   * model decodes. They are two measured components of the turn's duration, not a partition of
   * it, and they need not add up to the turn's span (approval waits and harness overhead belong
   * to neither). Never derive one by subtracting the other from the duration.
   */
  toolMs: number;
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

/**
 * The open pull request whose head is the branch a Session's Workspace is on, or null when
 * there is none to show. Null covers every reason equally on purpose: no PR for the branch,
 * no `gh`, not signed in, not a repository. A header chip reports work, not problems.
 */
export interface WorkspacePullRequestResponse {
  pullRequest: { number: number; title: string; url: string } | null;
}

export interface WorkspaceFilesResponse {
  /** Requested relative path ("" = Workspace root). */
  path: string;
  entries: WorkspaceFileEntry[];
}

/**
 * Write one Workspace file whole (the Upload button, a drop, and the Files panel's editor). A
 * write answers 204 with the written file's version in `ETag` — the marker the next conditional
 * write of the same file carries, so an editor can keep editing after a save.
 */
export interface FilesWriteRequest {
  /** The entire file, base64-encoded (≤14MB decoded). */
  dataBase64: string;
  /**
   * Write precondition: the version marker the caller read off this file's `ETag` on
   * `GET files/content`. The server compares it against the file's state immediately
   * before writing and answers 409 `file_changed` — having written nothing — when they
   * differ, which is what stops the editor's save from quietly dropping what the Agent
   * wrote during the turn. Omitted by a caller that read no version (an upload creates or
   * replaces unconditionally); that absence, not a sentinel value, is what says there was
   * no prior version to match.
   */
  ifVersion?: string;
}

/** Move or rename one Workspace file or folder (the Files panel's context menu). */
export interface FilesMoveRequest {
  /** Source path, relative to the Workspace root. */
  from: string;
  /** Destination path, relative to the Workspace root. Its parent directory is created when missing. */
  to: string;
  /**
   * Move precondition, read exactly like {@link FilesWriteRequest.ifVersion}: the marker the
   * caller got from this file's `ETag` on `GET files/content`, which the file must still
   * carry. It differs on only one point — the marker guards the **source**. The destination
   * has none, because the caller never read it, which is why an occupied destination is
   * refused with 409 `target_exists` rather than overwritten.
   *
   * A directory `from` takes none, and one sent with it is a 400: a directory carries no
   * single version marker, so no precondition can be stated for it. A folder moves whole and
   * unconditionally — nothing is lost that way, since whatever the Agent wrote into it meanwhile
   * moves with it — and is refused only when the destination is occupied or lies inside it.
   */
  ifVersion?: string;
}

/**
 * Create one empty text file or one folder in a Workspace (the Files panel's New menu). Missing
 * parent directories are created as a write creates them. Anything already at `path` — a file,
 * a folder or a link — is refused with 409 `target_exists` and nothing is written.
 */
export interface FilesCreateRequest {
  /** The new entry's path, relative to the Workspace root. */
  path: string;
  kind: "file" | "dir";
}

/**
 * One Workspace search match. `kind`, `sizeBytes` and `mtime` are named and typed exactly as
 * {@link WorkspaceFileEntry} names them: a hit is drawn by the same row renderer as a tree
 * entry, and it can only render identically if it carries the same fields.
 */
export interface WorkspaceSearchHit {
  /** Workspace-relative, "/"-separated, with no leading "./" (a tree entry's `name` is only its last segment). */
  path: string;
  kind: "dir" | "file";
  sizeBytes: number;
  mtime: string;
}

export interface WorkspaceSearchResponse {
  /** Shallowest first, then directories before files, then by name — the order the breadth-first walk produced. */
  hits: WorkspaceSearchHit[];
  /**
   * A cap stopped the walk (200 hits, or 20000 directory entries visited), so this is a
   * partial list. Breadth-first is what makes that degrade well: the hits that survive
   * truncation are the shallowest ones, not the ones that happened to be enumerated first.
   */
  truncated: boolean;
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
  /**
   * The file's model-API time: the sum of the turns' `llmMs` (human approval wait deducted,
   * compaction requests included, so the scope matches `elapsedMs`).
   */
  apiMs: number;
  /**
   * The file's tool wall time: the sum of the turns' `toolMs` (parallel tools counted once
   * within a turn). Summed per turn rather than unioned across the file, so the global figure
   * stays the sum of the per-turn figures, exactly as `elapsedMs` is. May overlap `apiMs` —
   * see `TraceTaskStats.toolMs`.
   */
  toolMs: number;
  /**
   * The file's cost in USD: the sum of the turns' `cost` (compaction turns included, the
   * scope every total here shares). Absent exactly when the turns carry no `cost`.
   */
  cost?: number;
  /**
   * The model's context window as the file's head `session_meta` records it
   * (`model_context_window`), for the context ring. The panel no longer reads every event, so the
   * analysis carries it; absent when the head records none (an older server, or a file without
   * one), and the panel then falls back as it always has.
   */
  modelContextWindow?: number | string;
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

/**
 * One row of the stats center's error panel table: the records of one calendar day that share
 * a source, code, kind and message. The day is the viewer's when the request carried
 * `utcOffsetMinutes`, and the server's own otherwise.
 */
export interface UsageErrorItem {
  /** The latest of the records this row stands for. */
  ts: string;
  source: string;
  code: string;
  kind: string;
  message: string;
  /** How many records this row stands for (the panel's "×N"). */
  count: number;
  /** The earliest of them; equal to `ts` for a single record. */
  firstTs: string;
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
  /** Filtered record count — also what a clear of the same filter takes (see {@link UsageErrorsClearResponse}). */
  total: number;
  /** Count of unexpected ones (500 / runtime exceptions) among them — the part the frontend highlights. */
  unexpected: number;
  /** The most frequent source · code (null when there are no errors). */
  topCode: UsageErrorCount | null;
  /** Most recent N rows (reverse chronological) — the first page; older ones come from `GET /usage/errors`. */
  recent: UsageErrorItem[];
  /** How many rows the table has for this filter (records folded per {@link UsageErrorItem}) — what the pager counts. */
  rows: number;
}

/**
 * GET /api/projects/:projectId/usage/errors — one page of the error detail table, newest
 * first. The dashboard response above already carries the first page; this exists so
 * "show me earlier ones" does not have to refetch the whole aggregate. It takes the same
 * date/agent filter as the dashboard (`fromTs`/`toTs` narrow it to a trailing window, both
 * or neither), so a page never widens what the summary counted, plus an optional `kind`
 * ({@link UsageErrorKind}) narrowing to one of the two categories — which
 * is how the cost-center badge asks "are there unexpected errors, and how new is the newest"
 * with `limit=1` instead of pulling the whole dashboard aggregate. `utcOffsetMinutes` (minutes
 * east of UTC, the dashboard takes it too) says whose calendar day a row's records share.
 */
export interface UsageErrorsPage {
  items: UsageErrorItem[];
  /** Filtered record count — the occurrences, which is what the cost-center badge counts. */
  total: number;
  /** Filtered row count (records folded per {@link UsageErrorItem}), so the caller knows when it has reached the end. */
  rows: number;
}

/**
 * DELETE /api/projects/:projectId/usage/errors — empties the error table for the filter the
 * panel is showing (its date range, the trailing window when one is on, and Agent), Project
 * owner only.
 *
 * Scoped to the filter rather than the Project's whole history, so a clear takes exactly the
 * rows on screen — for an admin, the unattributed rows an admin's panel shows included; a
 * member's panel never shows them and a member's clear never takes them.
 *
 * `from` and `to` are both required (400 otherwise), where the reads treat them as optional:
 * an absent bound is unbounded on that side, which is the whole history rather than a filter.
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

/**
 * One task in the Project-wide listing (GET /api/projects/:projectId/schedules): the agent's
 * item plus the agent whose schedule directory holds it, since the list spans every agent.
 */
export interface ProjectScheduleItem extends ScheduleItem {
  agentId: string;
}

export interface ProjectSchedulesResponse {
  /** Every agent's tasks: agents in id order, each agent's tasks in the order its own listing returns them. */
  schedules: ProjectScheduleItem[];
  /** Files that failed to parse (skipped from scheduling and logged as errors), with the agent that holds each. */
  invalidFiles: Array<{ agentId: string; name: string; error: string }>;
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
// Benchmark scoring (display), manual creation and deletion
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
  /**
   * Agent under test in this round (the `agent_id` field), part of the record's label; `null`
   * when the record carries none, as a Benchmark evaluates whichever Agents it is pointed at.
   */
  agentId: string | null;
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

/**
 * Whether the Skill that builds a Benchmark is done with it, and how it ended; see
 * `BenchmarkSummary.status`.
 */
export type BenchmarkStatus = "draft" | "published" | "failed";

export interface BenchmarkSummary {
  /** Directory name is the identifier (semantic naming, e.g. swe-bench-v1). */
  id: string;
  /** Title from benchmark_config.toml; falls back to the directory name if unset. */
  title: string;
  description?: string;
  /** Number of runs per case (the `runs` field in benchmark_config.toml, ≥1; defaults to 1). */
  runs?: number;
  /**
   * `draft` while the Skill that builds the Benchmark is still writing its cases and
   * calibrating their difficulty — the Web App masks such a Benchmark; `published` once the
   * Benchmark is frozen and its Formal Baseline recorded; `failed` when calibration ended
   * without a Pilot result that could be frozen, which leaves the Benchmark unusable — the Web
   * App masks it too and says it has to be deleted and created again. benchmark_config.toml is
   * read literally: only `draft` is a draft and only `failed` is a failure, so a missing field,
   * or any other value, reads as published.
   */
  status: BenchmarkStatus;
  /** Case count (number of case subfolders). */
  caseCount: number;
  /** Time-ordered evaluation records (the evaluations[] in scoreboard.yaml). */
  evaluations: BenchmarkEvaluation[];
  /**
   * Agents this Benchmark has evaluated: the distinct non-null `agentId`s of `evaluations`, in
   * first-seen order. Empty while nothing has been evaluated — a Benchmark names no Agent of its
   * own.
   */
  agentIds: string[];
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

/**
 * POST /api/projects/:p/benchmarks (owner only): create a Benchmark by hand. The
 * server writes the on-disk layout the evaluation Skills read — `benchmark_config.toml`, a
 * `scoreboard.yaml` holding `evaluations: []`, and one `<case id>/` per case with
 * `statement/README.md` and `rubric/README.md`. 409 `benchmark_exists` when the directory is
 * already there; nothing is merged into an existing Benchmark.
 */
export interface BenchmarkCreateRequest {
  /** Directory name, which is the identifier: letters, digits, `_` and `-` only. */
  id: string;
  title: string;
  description?: string;
  /** Runs per case for the optimization loop (integer ≥ 1; default 1). */
  runs?: number;
  /** At least one case; ids must be unique within the request. */
  cases: BenchmarkCreateCase[];
}

export interface BenchmarkCreateCase {
  /** Case directory name: `CASE-` followed by letters, digits, `_` and `-` (for example `CASE-001-excel-task`). */
  id: string;
  /** Written as the statement README's first heading, which the case list reads back as the case title. */
  title: string;
  /** Statement body (Markdown), written after that heading; the Target Agent sees only this side. */
  statement: string;
  /** Scoring rubric (Markdown, items totalling 100 points), written verbatim as `rubric/README.md`. */
  rubric: string;
}

export interface BenchmarkCreateResponse {
  benchmark: BenchmarkSummary;
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
  /** Version (`YYYY.MM.DD.N`, frontmatter version; a copy installed before that spelling still carries `YYYY-MM-DD.N`); an empty string when the frontmatter carries none or a malformed one. */
  version: string;
}

/** One installed hook package (`agent_state/hooks/<name>/`): its manifest, without the scripts. */
export interface HookItem {
  /** Hook package name — the plugin that shipped it (the identity uninstall addresses it by). */
  name: string;
  description: string;
  descriptionZh?: string;
  /** Version (`YYYY.MM.DD.N`; a copy installed before that spelling still carries `YYYY-MM-DD.N`); an empty string when the manifest carries none. */
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
  /** `YYYY.MM.DD.N`. */
  version: string;
  /** The plugin's skills (metadata only). */
  skills: SkillMetadataItem[];
  /** The hook points the plugin's hook package answers at (`[]` without one). */
  hooks: string[];
  /** The plugin's raw icon.svg (beside plugin.json — every built-in plugin ships one), the icon of everything it ships; the frontend draws the puzzle-piece plugin glyph without it. */
  icon?: string;
  /** The demo the Plugins page's quick start pre-fills (plugin.json `quick_start`); absent = pre-select its first skill. */
  quickStart?: QuickStartItem;
}

/** A quick start: a prompt pre-filled into a new-chat draft — never sent by the page. */
export interface QuickStartItem {
  prompt: string;
  promptZh?: string;
  /** Skills to pre-select (a library plugin's own). */
  skills?: string[];
  /** Open the draft in goal mode. */
  goal?: boolean;
  /** Open a plugin's session surface instead of a conversation (a module plugin's `surface` kind). */
  surface?: string;
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
 * POST /api/projects/:p/agents/:a/hooks/archive: install one hook package from an uploaded zip.
 * Layout: hooks.json and its scripts at the zip root, or exactly one top-level directory
 * containing them (the directory name is then the package name). 201 returns the refreshed
 * installed list (AgentHooksResponse); an already-installed name without `overwrite` is 409
 * `hook_exists`. GET …/hooks/:name/archive is the matching export: the installed directory as
 * a zip attachment, which round-trips through this POST.
 */
export interface HookArchiveInstallRequest {
  /** Base64-encoded zip archive (decoded size capped at 14MB, like the skill archive). */
  dataBase64: string;
  /** Replace an installed package of the same name instead of answering 409. */
  overwrite?: boolean;
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
// Plugin registry index
// ---------------------------------------------------------------------------

/**
 * One published version of a plugin — the index entry format every plugin registry
 * speaks: a flat array of per-version entries, so a plugin published at several
 * versions appears once per version. Installation is out of scope here: an entry's
 * `name` is the package specifier a Project's plugin list names.
 */
export interface PluginIndexEntry {
  /** Package specifier — the string a Project's plugin list names. */
  name: string;
  /** Semantic version of this entry. */
  version: string;
  description: string;
  authors: string[];
  /** SPDX license identifier. */
  license: string;
  /** Source repository URL. */
  repository?: string;
  homepage?: string;
  /** Free-form searchable terms; the Web App renders them as chips (e.g. the target OS). */
  keywords?: string[];
  /** Capability floor(s) the plugin provides on (e.g. "sandbox"). */
  categories?: string[];
  /** Unix timestamp (seconds) of the entry's last update. */
  updatedAt?: number;
  /**
   * npm's `dist.integrity` of the entry's package: `sha512-<base64>` of the published tarball's
   * bytes (scripts/plugin-entry.mjs). A fetch is checked against it — what npm recorded for the
   * tarball it downloaded must be this value — before it enters the store; an entry without
   * one is listed and cannot be installed.
   */
  integrity?: string;
  /** A yanked entry stays in its source as a record and is left out of the listing. */
  yanked?: boolean;
}

/** GET /api/plugins/registry/readme — long-form docs for one entry; `readme` is null when none exists. */
export interface PluginReadmeResponse {
  name: string;
  /** Markdown, rendered by the Web App. Null when this entry has no readme. */
  readme: string | null;
}

/** One content of a plugin name, as its detail page lists it. */
export interface PluginContent {
  version: string;
  /** npm's `sha512-<base64>`; absent for an index entry that names none. */
  integrity?: string;
  /** In this machine's plugin store. */
  stored: boolean;
  /** Linked by the current generation, i.e. what this machine runs under the name. */
  linked: boolean;
}

/**
 * GET /api/plugins/registry/contents?name=… — every content the merged index lists under one
 * name, highest version first. The Plugins page shows a name as one row; this is where the
 * contents behind it are listed.
 */
export interface PluginContentsResponse {
  name: string;
  contents: PluginContent[];
}

// ---------------------------------------------------------------------------
// Plugin-contributed languages
// ---------------------------------------------------------------------------

/**
 * One language a plugin contributes, as the listing reports it. The grammar itself is not
 * here: it is tens to hundreds of kilobytes, and only the languages a conversation actually
 * shows are worth fetching (`GET /api/languages/:id/grammar`).
 */
export interface LanguageSummary {
  /** Canonical id: the fence info string, and the id both endpoints address. */
  id: string;
  displayName: string;
  /** Alternative fence info strings, needed BEFORE the grammar loads (it is what decides to load it). */
  aliases?: string[];
  /** File extensions without the dot, for the Workspace file viewer. */
  extensions?: string[];
}

/** GET /api/languages: every language this App's plugins contributed, by id. */
export interface LanguageIndexResponse {
  languages: LanguageSummary[];
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

export type { HarnessHistoryEntry, IfacesSummary } from "@prismshadow/penguin-core";
export type {
  AgentPackage,
  PackageFile,
  PackageManifest,
  PackagePreview,
  PublishedGist,
  PublishMethod,
} from "../mechanisms/packages.js";
export type {
  WorkflowInfo,
  WorkflowVersion,
  WorkflowRequest,
  WorkflowResponse,
} from "../mechanisms/workflows.js";

/** GET /api/version/history: the harness versions this data root has committed, newest first. */
export type VersionHistoryResponse = HarnessHistory;

/** POST /api/version/history/rollback `{ id }`: the push back has started; the swap follows. */
export interface VersionRollbackResponse {
  started: true;
  id: string;
}

/** GET /api/version/history/diff?from=&to=: what changed between two stored interface tables. */
export type VersionHistoryDiffResponse = IfacesDiff;
export type { IfaceChange, IfacesDiff, MemberChange, ModuleChange } from "@prismshadow/penguin-hmr";

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

// Desktop tray icon (desktop mode only)
//
// The shell keeps an icon in the system tray for as long as the app runs, and Settings ›
// Appearance is where it is turned off and on. The switch rides the same utilityProcess
// message channel as the client updater above: the shell pushes what it currently shows,
// the page reads it at GET /api/desktop/tray and writes through PUT, which is relayed
// back. The window stays a plain browser — no renderer IPC bridge.
//
// The page reports its UI language over the same route, so the tray menu reads in the
// language the window does. The shell cannot see that preference itself: it lives in the
// browser's localStorage, on the other side of a boundary this design keeps one-way.

/** The two languages the Web App has; the shell's tray menu follows whichever is in use. */
export type DesktopTrayLocale = "zh" | "en";

/** What the shell is currently doing about its tray icon. */
export interface DesktopTrayStatus {
  /** Whether an icon is shown in the system tray while the app runs. */
  showTrayIcon: boolean;
  /**
   * The language the tray menu is drawn in. Until a page reports one the shell uses the
   * device language, so this can differ from the Web App's until the first report lands.
   */
  locale: DesktopTrayLocale;
}

/**
 * What one PUT asks the shell to change. Every field is optional and a request must carry at
 * least one: the switch and the language reach this route from different parts of the page.
 */
export interface DesktopTrayPatch {
  showTrayIcon?: boolean;
  locale?: DesktopTrayLocale;
}

/**
 * GET / PUT /api/desktop/tray (desktop-shell sessions only): the tray preference.
 * `status` is null until the shell's first push lands (a beat after server start); a
 * client that finds null reads it as on, which is the shell's own default.
 */
export interface DesktopTrayStatusResponse {
  status: DesktopTrayStatus | null;
}

/** Shell → server push over the utilityProcess message channel. */
export interface DesktopTrayStatusMessage {
  type: "desktop-tray-status";
  status: DesktopTrayStatus;
}

/**
 * Server → shell command over the utilityProcess message channel (relayed from PUT
 * /api/desktop/tray). A patch, not a snapshot: the switch and the language are written by
 * different parts of the page at different moments, and neither should have to restate the
 * other's value to change its own.
 */
export interface DesktopTrayCommandMessage {
  type: "desktop-tray-command";
  showTrayIcon?: boolean;
  locale?: DesktopTrayLocale;
}

/**
 * The API socket (PRFC-0011): one WebSocket per tab, every frame a call to an existing
 * endpoint. It is opened on the terminal-stream upgrade path under a reserved id naming the
 * signed-in user — `api-socket@<userId>` — which the server's terminal lookup answers with a
 * reference the socket protocol is served for (server: socket/ref.ts). Shared here so the
 * Web App and the machine relay spell the address the same way.
 */
export const API_SOCKET_ID_PREFIX = "api-socket@";
export function apiSocketPath(userId: string): string {
  return `/api/terminals/${encodeURIComponent(`${API_SOCKET_ID_PREFIX}${userId}`)}/stream`;
}

// Desktop folder access (desktop mode, macOS)
//
// macOS privacy protection (TCC) guards Desktop, Documents, Downloads and removable and network
// volumes. It asks the user only on behalf of an app it holds responsible for a read, and lists
// under Files and Folders only the apps it has asked about; any other read gets a silent EPERM.
// The Workspace picker's "Allow access" therefore goes to the shell, over the same
// utilityProcess message channel as the updater and tray above: its main process reads the
// folder once in the app's own name and says whether it could, and once the app is allowed its
// children (this server, the agents' shells) read too. The page can also have the shell open
// the Privacy & Security pane to change it. What either outcome means for the user is the
// page's to say; the shell only reports.

/** What the shell's read of one folder came to. */
export interface DesktopFolderAccessResult {
  /** The folder could be read. Always true off macOS, where the shell reads nothing. */
  granted: boolean;
  /** The failed read's errno code (`EPERM`, `EACCES`, `ENOENT`, …); `EINVAL` for a path that is not absolute. */
  code?: string;
  /**
   * Whether the app is a packaged build (Electron's `app.isPackaged`). An unpackaged one is a
   * development instance started from a terminal, and macOS holds that terminal responsible
   * for its reads rather than the app.
   */
  packaged: boolean;
}

/** Server → shell request over the utilityProcess message channel (relayed from POST /api/projects/:projectId/dirs/access). */
export interface DesktopFolderAccessMessage {
  type: "desktop-folder-access";
  /** Pairs the reply with its request. */
  id: string;
  /** The folder to read, as an absolute path. */
  path: string;
}

/** Shell → server reply to one {@link DesktopFolderAccessMessage}, carrying its `id`. */
export interface DesktopFolderAccessResultMessage extends DesktopFolderAccessResult {
  type: "desktop-folder-access-result";
  id: string;
}

/** POST /api/projects/:projectId/dirs/access: the shell's answer, for the picker to act on. */
export interface DirAccessResponse {
  granted: boolean;
  packaged: boolean;
}

/** The Privacy & Security panes the page may open: Files and Folders, and Full Disk Access. */
export type DesktopPrivacyPane = "files" | "fullDisk";

/** Server → shell command over the utilityProcess message channel (relayed from POST /api/desktop/privacy-settings). No reply. */
export interface DesktopOpenPrivacySettingsMessage {
  type: "desktop-open-privacy-settings";
  pane: DesktopPrivacyPane;
}

/** Server → shell command over the utilityProcess message channel (relayed from POST /api/desktop/window). No reply. */
export interface DesktopOpenWindowMessage {
  type: "desktop-open-window";
}

/**
 * A native action the host process can run on the page's behalf — what the desktop shell's
 * application menu used to offer, reached from the command palette instead (the menu bar
 * stays hidden so a lone Alt no longer takes the keyboard). A plain server offers none.
 *
 * `open-devtools` is the same story one step further: the shell's View menu toggles DevTools
 * and the shell binds F12 to it, but neither is visible with the menu bar hidden — so
 * someone reading a console error has to be told a key. Naming it here makes it findable.
 * It stays a HOST command, run by the shell on its own window: the page is a plain browser
 * environment with no bridge of its own, and adding one for this was rejected
 * (packages/desktop/src/main.ts).
 *
 * This list is NOT the set of runnable commands — {@link HostCommandOffer} is, and the host
 * writes it. What this list holds is the ids this build has its OWN words for, so the page
 * can show a better label than the host sent (translated, with search terms). An id absent
 * here is still offered, still runnable, and shown in the host's words.
 */
export const HOST_COMMANDS = ["install-cli", "check-updates", "open-devtools"] as const;
export type HostCommand = (typeof HOST_COMMANDS)[number];

/**
 * One command the host offers, carrying the words to show for it.
 *
 * The words travel WITH the command because the three programs involved ship apart: the
 * shell reaches users through an installer, the server and the page through a hot push. A
 * page that could only render commands it already had words for made the offer list pointless
 * — a host could never offer anything new — and reading words it did not have blanked it.
 *
 * `command` is opaque to both server and page: the host decides what it means and the host
 * runs it. Neither side validates it against a list of its own; the only question either asks
 * is whether the host offered it.
 */
export interface HostCommandOffer {
  command: string;
  label: string;
  /** The same words in Chinese. A host with only one language sends it in both. */
  labelZh: string;
}

/** Shell → server push over the utilityProcess message channel, once per wiring: what this host offers. */
export interface HostCommandsMessage {
  type: "host-commands";
  commands: HostCommandOffer[];
}

/** `GET /api/command` (admin): what the host offers — empty under a plain server, or before the shell's push. */
export interface HostCommandsResponse {
  /**
   * The offered ids this build also has words for, and nothing else.
   *
   * For pages older than `offers`, which look up every id in a table of their own: an id
   * they have never heard of throws while they build the palette, and a throw there blanks
   * the App. So this field stays conservative and the new field carries everything.
   */
  commands: HostCommand[];
  /** Everything the host offers, in the host's words. What a current page renders. */
  offers: HostCommandOffer[];
}

/** Server → shell: run one. `POST /api/command/:command` sends it. */
export interface HostCommandMessage {
  type: "host-command";
  command: string;
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

/**
 * What the API socket this server holds to one machine is doing (machines/machine-sockets.ts) —
 * the fact behind `MachineInfo.socket`. `since` is the instant the state was entered, so the
 * Machines page can say how long a machine has been dialling, failing or connected instead of
 * sending someone to the browser console for it.
 */
export interface MachineSocketFact {
  /**
   * `connected` once the handshake completed, `dialling` while a dial is outstanding, `refused`
   * when the machine answered the handshake with a status (a program predating the socket), and
   * `failed` when the dial did not complete or a socket that was up closed.
   */
  state: "connected" | "dialling" | "refused" | "failed";
  /** When that state was entered (ISO). */
  since: string;
  /** The transport's own words where there are any: a refusal's status, a dial's error. */
  detail?: string;
}

/**
 * One machine's event, as the machines aggregate stream carries it
 * (`GET /api/projects/:projectId/machines/events`): the machine's own `ServerEvent`, with the
 * machine it came from — one stream carries many machines, and the tag is what keeps their
 * events apart (docs: /docs/server-api § "One event stream per machine").
 */
export interface MachineEvent {
  machineId: string;
  event: ServerEvent;
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
   * The last install THIS server carried out there FOR THIS PROJECT, remembered in web.db so
   * it survives a restart, a hot push, and installing on some other machine. Null when this
   * Project has never installed there — a host another Project did is `elsewhere` below.
   *
   * A record of what was done, not a survey of the far side: a machine wiped by hand still
   * reads as installed until the next install probes it and corrects the record. Asking the
   * remote instead would cost an ssh round trip per host at page load, which is the price
   * the config-text list exists to avoid.
   */
  installed: { version: string; at: string } | null;
  /**
   * Installed by this server, but not this Project's machine — another Project's, or nobody's
   * since it was released — and so not a host nobody has touched either. Absent in every
   * other case, including when it IS this Project's (where `installed` carries the same record).
   *
   * Reported rather than folded into `installed` because the two lead to different actions:
   * one is a machine to use, the other is a machine to adopt, which costs a row and no ssh.
   * Reported rather than hidden because a row that silently looked uninstalled would send
   * someone to spend a 30 MB transfer re-doing what is already done.
   */
  elsewhere?: { version: string; at: string };
  /**
   * The machine's OWN id — 16 base64url characters minted by the server that runs there,
   * stable across renames, re-aliasing and reinstalls. Null until a server has started on
   * that machine, since nothing has minted one yet.
   *
   * This is what anything stored should point at; `id` above is an ADDRESS (`ssh:<alias>`),
   * and `alias` is what people read. Two aliases for one host share a `machineId`, and an
   * alias repointed at a different host answers a different one — an id never changes for a
   * machine, so a change of id is a change of machine.
   */
  machineId: string | null;
  /** The host this server itself runs on. Always present, always installed, never a target. */
  local: boolean;
  /**
   * The connection this server holds to it — the one ssh session everything to the machine
   * rides (machines/transport/ssh-session.ts): a fact about a process on THIS side, which
   * outlives the far server. Present means `/server/<id>/api/…` has somewhere to go; whether
   * a server ANSWERS over there is `status`'s word, from the last probe — and the two must not
   * be read for each other: taking the connection for the machine's liveness is the mistake
   * behind the connect loop (#561). Always null for `local`, which needs no connection.
   */
  connection: { pid: number } | null;
  /**
   * The API socket this server holds to that machine — connected, dialling, refused or failed,
   * and since when (machines/machine-sockets.ts). Null for `local`, and until a stream has
   * asked for a socket at all. A fact about one process on THIS side, like `connection` and
   * for the same reason: it says the socket exists and what it is doing, never that the far
   * side is answering. The Machines page reads it so a stuck stream does not have to be found
   * in the browser console.
   */
  socket: MachineSocketFact | null;
  /**
   * The machine's API as last seen by this server's proxy — stamped by traffic passing
   * through, never by a probe of its own. `answeredAt` when the last forwarded request got
   * an HTTP answer (any status: a server that refuses is still answering); `failedAt` and
   * the transport's own words when the connection had nowhere to deliver. Null until a first
   * request flows, and only as fresh as the last one — no traffic, no measurement, which is
   * honest: nothing burns ssh for a page nobody is looking at. Always null for `local`;
   * this server answering the request that fetched this list is that measurement.
   */
  api: { answeredAt: string } | { failedAt: string; detail: string } | null;
  /**
   * What the last probe found over there, or null when none has been taken. Never filled in
   * at list time: a probe costs an ssh round trip per machine, so the list reports the last
   * answer and the page asks for a fresh one when it wants one — on a widening schedule,
   * since each probe is an ssh round trip while the list is only the config's text.
   */
  status: MachineServerStatus | null;
  /**
   * The data root the server there runs on (`PENGUIN_HOME`). This instance's PROFILE decides
   * it — a dev instance names the machine's dev root and never the release one beside it
   * (machines/layout.ts) — which is exactly what a reader looking at two instances of this
   * page needs to tell them apart. Written in that machine's own spelling once its platform
   * is known, and in the POSIX one before that; for `local` it is this process's own root,
   * already resolved to an absolute path.
   */
  root: string;
}

/**
 * One machine's server state. There is deliberately no separate "ssh" status: ssh is the
 * transport, so a machine it cannot reach reads as `unreachable` with OpenSSH's own
 * diagnostic in `detail` rather than as two statuses a reader has to combine.
 */
export interface MachineServerStatus {
  state: "running" | "stopped" | "unreachable";
  /** ISO timestamp of the probe this answer came from. */
  checkedAt: string;
  /** The port it is serving on (`running`). */
  port?: number;
  /** Why the machine could not be reached (`unreachable`) — ssh's own words. */
  detail?: string;
}

/**
 * The running or last job on a machine — an install, or a connect — polled by GET
 * /api/machines while one runs. One at a time. `log` carries the far side's own words where
 * there are any: ssh's diagnostics and the remote installer's output say more about a
 * refused key or an unusable Node than a paraphrase would.
 */
export interface MachineJob {
  /** `use` is the whole pipeline — install if needed, hand over, connect, sync — as one job. */
  kind: "install" | "connect" | "restart" | "use";
  machineId: string;
  alias: string;
  /** Waiting its turn: a few machines are worked on at once, and a batch queues the rest. */
  queued: boolean;
  running: boolean;
  /**
   * Which step of the pipeline the job is on, in `MACHINE_PHASES` order — what the page draws
   * as a stepper. Null until the first step is named; a finished job keeps its last phase.
   */
  phase: MachinePhase | null;
  log: string[];
  result:
    | null
    | { ok: true; installed: "installed" | "already-installed"; version: string | null }
    | { ok: true; connected: true }
    | {
        ok: false;
        step: string;
        message: string;
        /**
         * The failure has a next step this side can take, and it needs saying yes to:
         * installing the PROGRAM over there and restarting it. Every failed install or
         * connect offers it — a failure that leaves no next step leaves a person stuck —
         * except a run that was itself that install, and one this server could not act on
         * (no build of its own to send), which says `false`. Offered rather than done,
         * because it restarts a server this Project does not own alone.
         */
        canReplaceProgram?: boolean;
      };
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
  /** The most recently started job, running or finished. */
  job: MachineJob | null;
  /**
   * Every job worth showing this generation: the queued ones, the running one, and the last
   * finished one per machine — so a batch reads as a list of rows each saying where it is.
   */
  jobs: MachineJob[];
}

/** The steps of bringing a machine into use, in the order a `use` job runs them. A step not needed is skipped, never revisited. */
export const MACHINE_PHASES = [
  "check",
  "install",
  "handover",
  "restart",
  "connect",
  "sync",
] as const;
export type MachinePhase = (typeof MACHINE_PHASES)[number];

/**
 * `POST /api/projects/:projectId/machines/ssh-hosts`: append a host block to this server's
 * `~/.ssh/config`. Answers the machines list (201), or 400 `ssh_host_invalid` naming the
 * field, or 409 `ssh_host_exists`.
 */
export interface SshHostRequest {
  /** The alias — what `ssh <alias>` will take, and the machine's name everywhere here. */
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * `GET /api/projects/:projectId/machines/ssh-hosts/:alias`: a host's block read back, and
 * whether this app wrote it. Only a block this app wrote may be rewritten
 * (`PUT …/ssh-hosts/:alias`, the same fields less the alias): a hand-written one may carry
 * options this app does not know, and rewriting it would drop them.
 */
export interface SshHostResponse extends SshHostRequest {
  editable: boolean;
}

/** `POST /api/projects/:projectId/machines/use`: bring these machines into use, as one queued batch. */
export interface MachinesUseRequest {
  /** Machine ids (`ssh:<alias>`). Every one is queued; refusals come back by id. */
  machines: string[];
  /** Install the program even where its version matches, and restart there — the answer to a job that asked for it. */
  replaceProgram?: boolean;
}

/** Why one machine of a batch was not queued; the rest were. */
export type MachineUseRefusal = "unknown-machine" | "self" | "no-image";

export interface MachinesUseResponse extends MachinesResponse {
  refused: { machineId: string; why: MachineUseRefusal }[];
}

/** `POST /api/projects/:projectId/machines/stop-using`: let go of these machines — connection dropped, Project membership released; the install stays. */
export interface MachinesStopUsingRequest {
  machines: string[];
}

// ---------------------------------------------------------------------------
// Port forwarding (a machine's TCP port on this server's loopback, per Workspace)
// ---------------------------------------------------------------------------

/**
 * One forward, its record and what is known of it right now. The status names which layer
 * speaks — the session, or ssh — and is never one "working" flag.
 */
export interface PortForwardInfo {
  id: string;
  /** That machine's own id. */
  machineId: string;
  /** The Workspace directory on that machine the forward belongs to. */
  workspace: string;
  /** `in`: the machine's port comes here (ssh -L). `out`: our port goes there (ssh -R). */
  direction: "in" | "out";
  /** `127.0.0.1:<remotePort>` over there. */
  remotePort: number;
  /** `127.0.0.1:<localPort>` on this server; fixed once given. */
  localPort: number;
  createdAt: string;
  status:
    /** ssh has it. */
    | { kind: "active" }
    /** The session is up and ssh has not answered yet. */
    | { kind: "pending" }
    /** The machine's session is down; the forward is wanted and waits for it. */
    | { kind: "not-connected" }
    /** ssh said no — in its own words. */
    | { kind: "failed"; detail: string };
}

/** `GET /api/port-forwards?machine=&workspace=` — both filters optional. */
export interface PortForwardsResponse {
  forwards: PortForwardInfo[];
}

/** `POST /api/port-forwards`; 201 with the forward. `localPort` omitted = chosen here, starting at `remotePort`. */
export interface PortForwardCreateRequest {
  machineId: string;
  workspace: string;
  /** Default `in`. */
  direction?: "in" | "out";
  remotePort: number;
  /** `in`: omitted = chosen here, starting at `remotePort`. `out`: required — the service being sent. */
  localPort?: number;
}

// ---------------------------------------------------------------------------
// Company mode: organizations (files are the truth; every DTO here is a projection)
// ---------------------------------------------------------------------------

/**
 * Organization status: `paused` stops every automatic trigger; humans can still talk to any
 * desk. These two values are the whole lifecycle — no route deletes an organization, so a
 * paused one keeps its conversations, employees, desks and tickets.
 */
export type OrgStatus = "active" | "paused";
/** Approval mode for desk and ticket sessions; unattended runs never get always-ask. */
export type OrgApprovalMode = "allow-all" | "read-only" | "deny-all";
/** The five kanban columns, each a directory under `tickets/<yyyy-mm>/`. */
export type OrgTicketStatus = "proposed" | "in_progress" | "review" | "done" | "rejected";
export type OrgTicketPriority = "P0" | "P1" | "P2";
/** Live employee state: running when the desk or any ticket session has a Task in progress; paused when budget-paused. */
export type OrgEmployeeState = "running" | "idle" | "paused";
/**
 * The trigger kinds an `[org_trigger]` block carries. `ticket_notice` is read-only: a ticket
 * change starts no run of its own, so nothing writes that kind any more, and it stays in the
 * union because Traces recorded while it did still carry it.
 */
export type OrgTriggerKind = "init" | "event" | "mention" | "ticket_notice" | "ticket_work";
/** The ticket changes an employee is told about, listed in the body of its next calendar sweep. */
export type OrgTicketChange = "assigned" | "blocked" | "blocker_closed" | "done" | "rejected";
/** What the last evaluation of a calendar event did. */
export type OrgCalendarOutcome = "fired" | "queued" | "paused" | "missed" | "error";
/**
 * The organization's working language: the language its handbook, its CEO's initialization
 * run, every employee brief and every desk and ticket run are written in. Detected from the
 * mission at creation (CJK text → `zh`, anything else → `en`) unless the request names one.
 */
export type OrgLanguage = "zh" | "en";

/** The organization's settings as `org_config.toml` records them. */
export interface OrganizationSettings {
  name: string;
  mission: string;
  status: OrgStatus;
  /** IANA timezone: budget periods (natural months) and chat day files follow it. */
  timezone: string;
  approvalMode: OrgApprovalMode;
  /** Chat @-chain limit: a message whose hop reaches it records its mentions without triggering anyone. */
  mentionChainLimit: number;
  budgetWarnRatio: number;
  budgetPauseRatio: number;
  createdBy: string;
  /** The shared workspace root when it is not the organization's own `workspace/` (absolute path). */
  workspace?: string;
  /** The model desks and ticket sessions run on when the employee names none; absent = the Project default. */
  model?: { provider: string; modelId: string };
  /** The working language (`language` in `org_config.toml`); absent on an organization written before the field existed, which reads as `en`. */
  language?: OrgLanguage;
}

/** Period spend against the CEO's budget (= the whole organization). */
export interface OrgSpendSummary {
  /** `yyyy-mm` in the organization's timezone. */
  period: string;
  cost: number;
  budget?: number;
  /** cost / budget; absent without a budget. */
  ratio?: number;
}

export interface OrganizationSummary {
  projectId: string;
  orgId: string;
  name: string;
  mission: string;
  status: OrgStatus;
  employeeCount: number;
  runningCount: number;
  pausedCount: number;
  /** proposed + in_progress + review. */
  openTickets: number;
  blockedTickets: number;
  createdBy: string;
  spend: OrgSpendSummary;
  /**
   * The machine this organization RUNS on, when that is not the server answering: the one its
   * shared workspace is on. The organization's own requests (`…/organizations/:orgId/…`) are
   * answered there; this server holds a mirror. Absent or null: it runs here.
   */
  machineId?: string | null;
  /** Present when `org_config.toml` / `org_chart.yaml` fail validation: the organization is listed but every automatic trigger is held until it is fixed. */
  invalid?: string;
}

export interface OrganizationsResponse {
  organizations: OrganizationSummary[];
}

export interface OrgEmployeeItem {
  agentId: string;
  /**
   * What this employee goes by in the organization, unique across it: the chart's `name`, else
   * the Agent's display name, else the id — with the id noted (`name (id)`) when the name is
   * not this employee's alone. It is what every surface shows and what works after `@`.
   */
  name: string;
  /** The `name` as written in the chart, for editing; absent when the entry has none. */
  givenName?: string;
  /**
   * Present when the employee has an avatar: the content revision of the image served at
   * `GET …/employees/:agentId/avatar` (append it as `?rev=` — the image is cached for good).
   * Absent, surfaces draw the letter tile.
   */
  avatarRev?: string;
  title: string;
  /** null for the CEO (the root). */
  reportsTo: string | null;
  duties?: string;
  /** As written in the chart: a sub-directory of the shared workspace (`.` = all of it) or an absolute path. */
  workspace: string;
  /** Where that resolves to; absent when the directory does not exist (the entry is then invalid). */
  resolvedWorkspace?: string;
  /** Monthly budget in USD for this employee plus all subordinates; absent = unbounded. */
  budget?: number;
  model?: { provider: string; modelId: string };
  state: OrgEmployeeState;
  desk?: { sessionId: string; workspace: string; openedAt: string };
  /** Period spend: own sessions, and cumulative (own + every subordinate). */
  spend: { own: number; cumulative: number; ratio?: number };
  /** Why the entry cannot be triggered (missing Agent, missing workspace directory). */
  invalid?: string;
}

export interface OrgChartResponse {
  ceoAgentId: string;
  employees: OrgEmployeeItem[];
}

export interface OrgCalendarItem {
  agentId: string;
  name: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  status: ScheduleStatus;
  invalidReason?: string;
  nextFireAt?: string;
  lastFiredAt?: string;
  /** What the most recent evaluation did (absent until the event has been evaluated once). */
  lastOutcome?: OrgCalendarOutcome;
  /** The organization or this employee is paused, so due slots are skipped, not fired. */
  paused: boolean;
}

export interface OrgCalendarResponse {
  events: OrgCalendarItem[];
  invalidFiles: Array<{ agentId: string; name: string; error: string }>;
}

/**
 * One line of a ticket's operation history, kept in the file's frontmatter apart from the
 * progress prose: what was done, by whom (`agent:<id>` / `user:<id>` — an employee is recognised
 * from the Agent id its command subprocesses carry, a person otherwise), and when.
 */
export type OrgTicketHistoryAction =
  | "created"
  | "assigned"
  | "moved"
  | "blocked"
  | "unblocked"
  | "progress"
  | "session_started"
  | "session_attached"
  | "edited";

export interface OrgTicketHistoryEntry {
  at: string;
  by: string;
  action: OrgTicketHistoryAction;
  /** The action's detail: the column moved to, the new owner, the block reason, the session id. */
  note?: string;
}

/**
 * The ticket id's slug: lowercase letters in hyphen-joined words, no digits (the date prefix
 * already carries the numbers), chosen for meaning — derived from an ASCII title, proposed by
 * the Project's model for a title in another language, or passed explicitly.
 */
export const TICKET_SLUG_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

export interface OrgTicketItem {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  /** The ONE responsible principal (`agent:<id>` / `user:<id>`); who filed it is the history's `created` entry. */
  owner: string;
  parent?: string;
  notify: string[];
  priority: OrgTicketPriority;
  due?: string;
  /** Non-empty = blocked; the ticket stays in its column. */
  blocked?: string;
  blockedBy?: string;
  /** Contributing session ids, in the order they were attached. */
  sessions: string[];
  /** Any contributing session has a Task in progress. */
  running: boolean;
  /** Period cost of the contributing sessions (a session attached to n tickets counts 1/n here). */
  cost: number;
  /** Header/column disagreement or a duplicate id: shown with a danger mark, left where it is. */
  invalid?: string;
}

export interface OrgTicketSessionItem {
  sessionId: string;
  agentId: string;
  title?: string;
  status: SessionStatus;
  lastActiveAt?: string;
}

export interface OrgTicketDetail extends OrgTicketItem {
  goal: string;
  acceptanceCriteria: string;
  /** `## Progress` as plain sentences; who wrote one and when is the matching history entry. */
  progress: string[];
  result: string;
  /** The operation history from the frontmatter, oldest first. */
  history: OrgTicketHistoryEntry[];
  /** The whole file, for the Markdown view and for clients that prefer to edit it as text. */
  body: string;
  children: string[];
  /** Own cost plus every descendant's along `Parent`. */
  rolledUpCost: number;
  sessionItems: OrgTicketSessionItem[];
}

export interface OrgTicketsResponse {
  columns: Record<OrgTicketStatus, OrgTicketItem[]>;
  /** Files that failed to parse (skipped; also recorded as errors). */
  invalidFiles: Array<{ path: string; error: string }>;
}

/**
 * What a `system` line records, structured: the kind of event and its parameters, so a client
 * renders the sentence in the reader's language and with the principals' display names instead
 * of showing the English `text` verbatim. `text` stays the English sentence (the CLI, older
 * clients and the file itself read it); `notice` is the same fact for a client that can do better.
 */
export type OrgChannelNoticeKind =
  | "employee_joined"
  | "employee_left"
  | "channel_created"
  | "channel_archived"
  | "channel_unarchived"
  | "channel_joined"
  | "channel_invited"
  | "channel_left"
  | "channel_removed"
  | "budget_warned"
  | "budget_paused"
  /**
   * Legacy, read-only: ticket changes no longer write into a channel — the board is read from
   * the board and the overview's inbox. These three kinds stay so the lines already in an
   * organization's message files keep rendering; nothing writes them any more.
   */
  | "ticket_blocked"
  | "ticket_done"
  | "ticket_rejected";

/**
 * The parameters each kind carries, all strings: principals as `agent:<id>` / `user:<id>`
 * (`agent`, `principal`, `by`, `reportsTo`), a ticket as `ticket` + `title`, a budget event as
 * `agent`, `period`, `percent`, `cost`, `budget`.
 */
export interface OrgChannelNotice {
  kind: OrgChannelNoticeKind;
  params: Record<string, string>;
}

export interface OrgChannelMessage {
  id: string;
  /** ISO 8601 UTC. */
  time: string;
  /** `agent:<id>` / `user:<id>` / `system`. */
  sender: string;
  hop: number;
  text: string;
  /** Principals mentioned, `all` included. */
  mentions: string[];
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /** Present on `system` lines the server wrote with a structured notice; absent on lines from before the field existed. */
  notice?: OrgChannelNotice;
}

/**
 * One channel as the API reports it. The all-hands channel (`default_channel`,
 * `everyone: true`) exists for as long as the organization does and every employee and
 * Project member is in it; every other channel carries the membership its members edit.
 */
export interface OrgChannelItem {
  channelId: string;
  /** As stored; the UI renders the all-hands channel's label itself. */
  name: string;
  /** "" when unset. */
  purpose: string;
  /** True only for `default_channel`: membership is implicit. */
  everyone: boolean;
  /** An archived channel is read-only and folded away. */
  archived: boolean;
  /** `user:<id>` / `agent:<id>` / `system`. */
  createdBy: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** Implicit membership counted for the all-hands channel. */
  memberCount: number;
  /**
   * The default recipients, `agent:<id>` / `user:<id>` each: a message with no @ at all is
   * treated as if it had mentioned them — an employee's desk is triggered, a person sees it
   * counted under "@me". Empty when the channel has none.
   */
  notify: string[];
  /** Whether the caller (person or employee) is a member. */
  isMember: boolean;
  /** People only; 0 for an employee caller. */
  unread: number;
  /** People only; 0 for an employee caller. */
  mentionsMe: number;
  lastMessageAt: string | null;
}

export interface OrgChannelMember {
  /** `agent:<id>` or `user:<id>`. */
  principal: string;
  name: string;
  kind: "agent" | "user";
}

export interface OrgChannelDetail extends OrgChannelItem {
  /** The all-hands channel resolves to every employee plus every Project member. */
  members: OrgChannelMember[];
}

export interface OrgChannelsResponse {
  /** `default_channel` first, then by name. */
  channels: OrgChannelItem[];
}

export interface OrgChannelCreateRequest {
  channelId: string;
  name?: string;
  purpose?: string;
}

export interface OrgChannelPatchRequest {
  name?: string;
  purpose?: string;
  archived?: boolean;
  /**
   * Replaces the default recipients; `[]` clears them. Each entry must be a member of the
   * channel (`agent:<id>` / `user:<id>`), or the whole request is refused with
   * `notify_not_member`.
   */
  notify?: string[];
}

export interface OrgChannelMemberRequest {
  /** `agent:<id>` (an employee) or `user:<id>` (a Project member). */
  principal: string;
}

export interface OrgChannelMessagesResponse {
  /** The channel served. */
  channelId: string;
  /** The day file served (`yyyy-mm-dd` in the organization's timezone). */
  date: string;
  /** The days this channel has a file for, newest first, for paging back. */
  days: string[];
  messages: OrgChannelMessage[];
  /** Messages of this channel after the caller's read cursor in it, across the recent days. */
  unread: number;
  /** Of those, the ones that mention the caller (or all). */
  mentionsMe: number;
  lastReadId?: string;
}

export interface OrgBudgetAlert {
  agentId: string;
  period: string;
  warnedAt?: string;
  pausedAt?: string;
}

export interface OrgFinanceEmployee {
  agentId: string;
  name: string;
  title: string;
  reportsTo: string | null;
  own: number;
  cumulative: number;
  budget?: number;
  ratio?: number;
  warned: boolean;
  paused: boolean;
}

export interface OrgFinanceTicket {
  ticketId: string;
  title: string;
  status: OrgTicketStatus;
  parent?: string;
  cost: number;
  rolledUp: number;
}

export interface OrgFinanceResponse {
  period: string;
  currency: "USD";
  employees: OrgFinanceEmployee[];
  tickets: OrgFinanceTicket[];
  /** Daily cost of the organization's sessions over the period. */
  daily: Array<{ date: string; cost: number }>;
  alerts: OrgBudgetAlert[];
  total: number;
  /** Some usage ran on a model without pricing: tokens were counted, cost is a lower bound. */
  unpriced: boolean;
}

export interface OrgDeskItem {
  agentId: string;
  name: string;
  sessionId: string;
  title?: string;
  status: SessionStatus;
  workspace: string;
  lastActiveAt?: string;
  /**
   * Present when the desk session has an ENABLED messaging binding: its channel, read as
   * `SessionInfo.messagingChannel` is (the company sidebar's desk row draws the same mark as a
   * development row, and the development list never holds a desk).
   */
  messagingChannel?: MessagingChannel;
}

export interface OrgSessionsResponse {
  desks: OrgDeskItem[];
  tickets: Array<{
    ticketId: string;
    title: string;
    status: OrgTicketStatus;
    sessions: OrgTicketSessionItem[];
  }>;
}

export interface OrgDeskResponse {
  agentId: string;
  sessionId: string;
  workspace: string;
  openedAt: string;
  /** True when this call created the desk session. */
  created: boolean;
}

export interface OrganizationDetail extends OrganizationSummary {
  settings: OrganizationSettings;
  board: Record<OrgTicketStatus, number>;
  /** Today's calendar events (organization timezone) with their outcomes. */
  today: OrgCalendarItem[];
  pending: {
    /** Unread messages mentioning the caller (or all). */
    mentions: number;
    reviewTickets: OrgTicketItem[];
    blockedByMe: OrgTicketItem[];
  };
  /** The last messages of the all-hands channel. */
  recentMessages: OrgChannelMessage[];
  alerts: OrgBudgetAlert[];
  /** What the overview's inbox lists; absent only from a server older than the field. */
  inbox?: OrgInbox;
  /** The CEO's desk session once opened (creation opens it). */
  ceoDeskSessionId?: string;
}

/**
 * The overview's inbox: the three things a person is waited on or told about — messages
 * that name them (or `@all`) in the all-hands channel, the tickets that are blocked (all of
 * them, whoever they wait on), and the tickets closed as done this period. Newest first in
 * each list; each capped at a page.
 */
export interface OrgInbox {
  mentions: OrgChannelMessage[];
  blockedTickets: OrgTicketItem[];
  doneTickets: Array<OrgTicketItem & { closedAt?: string }>;
}

export interface OrganizationCreateRequest {
  /** Semantic id, unique within the Project; also the directory name. */
  orgId: string;
  name?: string;
  mission: string;
  timezone?: string;
  /** An existing absolute directory to use as the shared workspace; default = the organization's own `workspace/`. */
  workspace?: string;
  /**
   * The machine `workspace` is on, by its own id (one of the Project's connected machines);
   * absent = this server. The organization RUNS there — that server opens its desks and drives
   * its calendar — and belongs to the Project here, which keeps a mirror of its files.
   */
  workspaceMachine?: string;
  /** The model for desks and ticket sessions (a configured pair); default = the Project default. */
  model?: { provider: string; modelId: string };
  /**
   * The CEO's monthly budget in USD, written as the `budget` of its `org_chart.yaml` entry.
   * Budgets are compared on the cumulative line, so the CEO's is the whole company's.
   * Omitted = 100; 0 is a real (zero) budget, not "unbounded" — only clearing the field
   * later (`PATCH …/employees/:agentId` with `budget: null`) leaves the CEO unbounded.
   */
  ceoBudget?: number;
  /** The working language; omitted = detected from the mission. */
  language?: OrgLanguage;
}

export interface OrganizationPatchRequest {
  name?: string;
  mission?: string;
  status?: OrgStatus;
  approvalMode?: OrgApprovalMode;
  timezone?: string;
  mentionChainLimit?: number;
  budgetWarnRatio?: number;
  budgetPauseRatio?: number;
  /** null returns to the organization's own `workspace/`. */
  workspace?: string | null;
  /** null returns to the Project default. */
  model?: { provider: string; modelId: string } | null;
  language?: OrgLanguage;
}

/**
 * What a proposed semantic id names. Each kind has its own shape — organization and channel
 * ids carry a `co_` / `ch_` prefix, a non-admin's Project id its owner's `<username>-`, a
 * Benchmark id is kebab-case — and its own set of ids to avoid.
 */
export type SemanticIdKind = "org" | "channel" | "project" | "agent" | "benchmark";

/**
 * A semantic id proposed for a display name — every create dialog that names an object with a
 * semantic id (a Project, an Agent, a Benchmark, an organization, a channel) lets the user name
 * the thing first and derive the id from that name. The server asks the Project's default
 * model for a short English id in the kind's spelling (a Chinese name has no mechanical
 * transliteration), falling back to an ASCII slug of the name when the model is unavailable,
 * and to a dated placeholder when neither can name it. The request never fails for a name it
 * cannot translate: a dialog that asked for an id always gets one back.
 */
export interface SemanticIdSuggestRequest {
  /** The display name typed so far (or the mission / description, when nothing else names the thing). */
  name: string;
  /** What the id is for: decides the id's shape, the prompt's examples and the ids avoided. */
  kind: SemanticIdKind;
  /**
   * Ids already in use in the target scope; the proposal avoids them. For a Project, an Agent or
   * a Benchmark, the server also avoids, on its own, every id that kind's create route refuses
   * as taken, a leftover folder no list shows included.
   */
  taken?: string[];
}

/**
 * Why a proposal fell all the way through to a placeholder — what the client tells the user to
 * explain the id it was just handed. `no_default_model`: the Project has no default model to
 * ask. `model_failed`: it was asked and the request failed (no credential, a rejection, a
 * timeout). `unusable_answer`: it answered twice and neither answer yielded an id.
 * `no_ascii`: no model was consulted at all and the name carries no ASCII to transliterate.
 */
export type SemanticIdSuggestReason =
  "no_default_model" | "model_failed" | "unusable_answer" | "no_ascii";

export interface SemanticIdSuggestResponse {
  /**
   * An id the kind's create route accepts, not in `taken`: `^[a-z][a-z0-9_]{1,63}$` for most
   * kinds, `<username>-<suffix>` for a non-admin's Project, kebab-case for a Benchmark.
   */
  id: string;
  /** Who produced it: the model, the ASCII fallback, or the dated placeholder that names nothing. */
  source: "model" | "fallback" | "placeholder";
  /** Present only with `source: "placeholder"`: why the two real paths produced nothing. */
  reason?: SemanticIdSuggestReason;
}

export interface OrgHireRequest {
  /** Employ an existing Agent … */
  agentId?: string;
  /** … or create one (the two are exclusive). Plugins default to agent-company + agent-development. */
  newAgent?: { agentId: string; name?: string; description?: string; plugins?: string[] };
  /**
   * What the organization calls the employee (any script, one line, no `@`, ≤ 64 characters).
   * Omitted, a new Agent's `name` is used; with neither, the Agent's display name stands in.
   */
  name?: string;
  title: string;
  reportsTo: string;
  workspace?: string;
  budget?: number;
  duties?: string;
  model?: { provider: string; modelId: string };
}

export interface OrgEmployeePatchRequest {
  /** null (or an empty string) clears the name: back to the Agent's display name. */
  name?: string | null;
  title?: string;
  reportsTo?: string;
  workspace?: string;
  /** null clears the budget. */
  budget?: number | null;
  duties?: string;
  /** null clears the model (back to the Project default). */
  model?: { provider: string; modelId: string } | null;
}

export interface OrgCalendarUpsertRequest {
  /** POST only: the employee the event belongs to. */
  agentId?: string;
  /** POST only: the file name. */
  name?: string;
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
}

/**
 * What a calendar write answers: the stored event, plus advisory `warnings` — one line each —
 * about the rota: another employee's recurring event on the same start minute, or the same
 * employee already holding a recurring event (desks that fire together compete for the same
 * budget minute and the same tickets). The write succeeds regardless; the CLI prints the
 * lines so the scheduling employee can stagger.
 */
export interface OrgCalendarWriteResponse extends OrgCalendarItem {
  warnings?: string[];
}

export interface OrgTicketCreateRequest {
  title: string;
  /** Overrides the slug derived from the title; lowercase English words joined by hyphens. */
  slug?: string;
  goal?: string;
  acceptanceCriteria?: string;
  /**
   * The whole Markdown body instead of goal + acceptanceCriteria (the frontmatter is still
   * generated): its `## Goal` / `## Acceptance criteria` / `## Progress` / `## Result` sections
   * become the ticket's, other sections are kept as written, and text above the first section
   * heading is a 400. A body without any `## ` heading is all goal.
   */
  body?: string;
  /**
   * The responsible principal: an employee's `agent:<id>` (or bare Agent id) or a member's
   * `user:<id>`. Default = the caller — the session's employee inside a desk or ticket
   * session, else the token's or cookie's user.
   */
  owner?: string;
  parent?: string;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string;
}

export interface OrgTicketUpdateRequest {
  title?: string;
  /** The new responsible principal; never null — a ticket always has an owner. */
  owner?: string;
  parent?: string | null;
  notify?: string[];
  priority?: OrgTicketPriority;
  due?: string | null;
  goal?: string;
  acceptanceCriteria?: string;
  result?: string;
}

export interface OrgTicketMoveRequest {
  status: OrgTicketStatus;
  /** Required when moving into rejected; recorded under Result. */
  reason?: string;
}

export interface OrgTicketBlockRequest {
  reason: string;
  /** A ticket id or a principal. */
  by?: string;
}

export interface OrgTicketProgressRequest {
  text: string;
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID); the session is booked as a contributing
   * session and the history entry is attributed to its employee. Honoured only for a request
   * carrying the local API token — the control environment's credential; a signed-in user's
   * write is attributed to the user.
   */
  sessionId?: string;
  /**
   * The calling employee's Agent id (CLI: PENGUIN_AGENT_ID from the control environment), the
   * identity a write is recorded under; it wins over the session's employee, is honoured only
   * with the local API token, like sessionId, and is ignored — the write falls back to the
   * session's employee, then to the person — when it names no employee.
   */
  agentId?: string;
}

export interface OrgTicketStartRequest {
  /** The employee the ticket session runs as (CLI: PENGUIN_AGENT_ID); defaults to the ticket owner. */
  agentId?: string;
  message?: string;
  /** Another directory inside the shared workspace; defaults to the employee's desk workspace. */
  workspace?: string;
}

export interface OrgTicketStartResponse {
  sessionId: string;
}

export interface OrgTicketAttachRequest {
  sessionId: string;
}

export interface OrgChannelMessageSendRequest {
  text: string;
  refs?: { ticket?: string; session?: string; replyTo?: string };
  /**
   * The calling session (CLI: PENGUIN_SESSION_ID): the message is sent as its Agent and
   * inherits its hop. Honoured only for a request carrying the local API token — the control
   * environment's credential; a signed-in user's message is sent as the user, at hop 0.
   */
  sessionId?: string;
}

export interface OrgChannelReadRequest {
  /** Mark everything up to this message id as read. */
  upTo: string;
}

/** The handbook index (`handbook/README.md`), the file every work run reads first. */
export interface OrgHandbookResponse {
  content: string;
}

/** One file of the organization handbook (`handbook/`, the company's knowledge base); `path` is relative to that directory. */
export interface OrgHandbookFile {
  path: string;
  size: number;
  updatedAt: string;
}

export interface OrgHandbookFilesResponse {
  /** The index first, then the other documents by path. */
  files: OrgHandbookFile[];
}

export interface OrgHandbookFileResponse {
  path: string;
  content: string;
}

export interface OrgHandbookFileWriteRequest {
  content: string;
}

/** Company-mode notifications on the user-level event stream (best effort; the query routes carry the durable state). */
export type CompanyServerEvent =
  /** A work run (desk session) or ticket session was started by the organization scheduler or a ticket start. */
  | {
      type: "org_run";
      projectId: string;
      orgId: string;
      agentId: string;
      sessionId: string;
      kind: OrgTriggerKind;
    }
  /** A new channel message (mentions included, so the client can tell whether it is addressed). */
  | {
      type: "org_channel";
      projectId: string;
      orgId: string;
      channelId: string;
      message: OrgChannelMessage;
    }
  /** A ticket's status, owner, blocked state or contributing sessions changed. */
  | { type: "org_ticket"; projectId: string; orgId: string; ticketId: string; change: string }
  /** Budget warning, pause or resume for an employee. */
  | {
      type: "org_budget";
      projectId: string;
      orgId: string;
      agentId: string;
      state: "warned" | "paused" | "resumed";
      ratio: number;
    };

// ---------------------------------------------------------------------------
// Company proposals (the company-proposals plugin: /api/projects/:p/organizations/:o/proposals)
//
// The plugin owns the store and the routes; the page that draws a proposal is one of the
// web app's builtin renderers, so the data contract lives here beside the other DTOs the
// web build compiles against. Absent the plugin, none of these routes exist.
// ---------------------------------------------------------------------------

/** A proposal's lifecycle; a revision never changes it, a request for changes puts `ready` back to `drafting`. */
export type ProposalStatus = "drafting" | "ready" | "approved" | "merged" | "rejected";

/** One pair of the scope: a file, and optionally a pattern (a regular expression, with capture groups) over the names it touches. */
/** What a scope entry does to its file: edit or delete one that exists, create a new one, or rename `from` to `file`. */
export type ProposalScopeKind = "edit" | "new" | "delete" | "rename";

/**
 * A scope file's state in the working tree, as the owning server finds it when the proposal
 * is read (under the proposal's `root`): `exists`, `missing` (an edit, a delete or a rename's
 * source that is not there), `new` (a new file not written yet), `deleted` (a delete done),
 * `renamed` (a rename whose source is still there and whose target is not yet).
 */
export type ProposalScopeState = "exists" | "new" | "missing" | "deleted" | "renamed";

/**
 * One entry of the scope: a file (relative to the proposal's `root`), what the change does to
 * it, and optionally a pattern (a regular expression, capture groups allowed) over the names
 * it touches. `from` is a rename's old path and appears on renames only.
 */
export interface ProposalScopeEntry {
  kind: ProposalScopeKind;
  file: string;
  from?: string;
  name?: string;
  /** Computed on read (`GET …/:number`), never stored. */
  state?: ProposalScopeState;
}

/** A listed test's state under the proposal's root, computed on read: an existing or deleted test is there or missing; a new one is there already (added to an existing file) or still to be written. */
export type ProposalTestState = "exists" | "new" | "missing";

/**
 * One test that bears on the change: an existing one, one the change adds, or one it removes (`kind`), in a
 * group (`unit`, `integration`, `e2e`, `bench` by convention — any short word is accepted),
 * with a file (relative to `root`), optionally a pattern over the test names in it (a regular
 * expression, like a scope entry's `name`), and a description of what it checks.
 */
export interface ProposalTestEntry {
  kind: "existing" | "new" | "delete";
  file: string;
  name?: string;
  group: string;
  description: string;
  /** Computed on read (`GET …/:number`), never stored. */
  state?: ProposalTestState;
}

/** One paragraph of a section: the unit a comment anchors to. `id` is stable across revisions for unchanged text. */
export interface ProposalParagraph {
  id: string;
  text: string;
}

export interface ProposalSection {
  id: string;
  heading: string;
  paragraphs: ProposalParagraph[];
}

export type ProposalMaterialKind = "pr" | "issue" | "branch" | "doc" | "ticket" | "url";

/** Where a GitHub pull request stands, as read from GitHub when the proposal is read. */
export type ProposalPrStatus = "draft" | "open" | "merged" | "closed";

export interface ProposalMaterial {
  kind: ProposalMaterialKind;
  label: string;
  url: string;
  /** `agent:<id>` or `user:<id>`. */
  by: string;
  at: string;
  /** A `pr` material on GitHub: its state, looked up on read and cached briefly — never stored; absent when unknown. */
  status?: ProposalPrStatus;
  /** When `status` was read. */
  statusCheckedAt?: string;
}

/** A person's comment on one paragraph. Pending (`batchId` null) until the person requests changes; then part of a batch the author works through. */
/**
 * A person's comment on a passage: a range in one section's Markdown source (the section's
 * paragraphs joined by a blank line, see the plugin's `sectionSource`), stored as offsets and
 * re-anchored by its `quote` on every revision — agents never see the offsets, they see the
 * passage wrapped in `⟦<id>⟧…⟦/<id>⟧` markers. Pending (`batchId` null) until the person
 * requests changes; then part of a batch the author works through.
 */
export interface ProposalComment {
  id: string;
  /**
   * What the comment is on, when it is not a passage of a section; absent for a passage (then
   * `sectionId`, `range` and `quote` anchor it). A targeted comment carries `sectionId: ""` and an
   * empty range, and its `quote` is what it was written on: the file for a scope or test entry
   * or a changed file, the lines themselves (joined by `\n`) for a line range.
   */
  target?: ProposalCommentTarget;
  /** The section the range lies in (section ids follow the heading, so they survive revisions). */
  sectionId: string;
  /** Offsets into the section's source, `[start, end)`, of the revision `revision`. */
  range: { start: number; end: number };
  /** The passage the range covered when written — what re-anchors it after a revision. */
  quote: string;
  /**
   * The paragraph the range starts in, derived; absent when the passage is not in the current
   * revision (the comment is then listed as one on revision `revision`).
   */
  paragraphId?: string;
  /** The revision the range refers to: the current one, or the last one the passage was found in. */
  revision: number;
  text: string;
  by: string;
  at: string;
  batchId: string | null;
  resolved?: { by: string; at: string; text: string };
}

export type ProposalEventKind =
  | "created"
  | "revised"
  | "ready"
  | "changes_requested"
  | "implementation_started"
  | "material_added"
  | "feedback"
  | "runtime_feedback"
  | "resolved"
  | "approved"
  | "merged"
  | "rejected"
  /** A channel message the plugin had to send did not go out (the text says to whom, and why). */
  | "notify_failed"
  /** The brief was rewritten (the text is the new brief); the revisions are untouched. */
  | "brief_edited"
  /** The author was replaced (the text is `<before> → <after>`, both agent ids); revisions, comments and approvals are untouched. */
  | "author"
  /** A person opened a discussion with the owner (the text is the owner's agent id). */
  | "discussion_started"
  /** A discussion's conclusion reached the owner's desk (the text is the conclusion). */
  | "discussion_concluded";

/** One thing that happened to a proposal; `seq` orders every write of the organization and is what a read position points at. */
export interface ProposalEvent {
  seq: number;
  at: string;
  kind: ProposalEventKind;
  /** `agent:<id>` or `user:<id>`. */
  by: string;
  /** One line for the timeline: the feedback text, the batch size, the material's label, the reason. */
  text?: string;
  /** The revision a `revised` event produced. */
  revision?: number;
  /** What a `material_added` event added (a material, or the impl PR): its link. */
  url?: string;
}

/** A proposal as the queue lists it. */
export interface ProposalItem {
  number: number;
  title: string;
  status: ProposalStatus;
  revision: number;
  /** The employee that writes it (`agentId`). */
  author: string;
  /** The employee that builds it, once `implement` named one. */
  implementer: string | null;
  /** The principal that started it: `user:<id>` for a person, `agent:<id>` for an employee proposing on its own. */
  delegatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Events after the caller's read position, not counting the caller's own. */
  unread: number;
  /** The caller's pending comments (people only; 0 for an employee). */
  pendingComments: number;
  materials: ProposalMaterial[];
  /** The one pull request the proposal is implemented by (`penguin org proposal impl`): the PR on its impl branch; null until registered, absent from a server older than impl PRs. */
  implPr?: ProposalImplPr | null;
  /** The branch pair the proposal is implemented on; null until registered, absent from a server older than impl branches. */
  impl?: ProposalImplBranch | null;
}

/**
 * One side of an impl branch: a git remote of the proposal's repository that points at GitHub
 * (`origin`), or a GitHub repository written out (`owner/repo`), and a branch on it.
 */
export interface ProposalBranchRef {
  remote: string;
  branch: string;
}

/**
 * A declared side as the proposal views show it: the branch's page on GitHub
 * (`https://github.com/<owner>/<repo>/tree/<branch>`), or why the server cannot name one — the
 * remote is not in the plugin's `origins` setting and not a GitHub remote of the shared
 * workspace. Computed for the view on every read; the registration itself is unchanged. Absent
 * from a server older than branch links.
 */
export interface ProposalImplBranchSide extends ProposalBranchRef {
  url?: string | null;
  /** Why `url` is null; null when there is one. */
  unresolved?: string | null;
}

/**
 * A proposal's implementation: a head branch and the base it is measured against — the patch
 * is the merge base of the two up to the head — and the PR opened for the head, once one is.
 * A registration that named only a PR has `head` and `base` null: they are that PR's, read
 * from GitHub where they are needed.
 */
export interface ProposalImplBranch {
  head: ProposalImplBranchSide | null;
  base: ProposalImplBranchSide | null;
  /** The PR's URL, null until one is registered. */
  pr: string | null;
  /** `agent:<id>` or `user:<id>`: who registered the latest of it. */
  by: string;
  at: string;
}

/**
 * A proposal's impl PR: one per proposal, and a PR is the impl PR of at most one proposal.
 * Registering another replaces it. The `pr` materials stay what they were — the history,
 * the official twin — and are never read to guess this.
 */
export interface ProposalImplPr {
  url: string;
  /** `<owner>/<repo>#<n>`. */
  label: string;
  /** `agent:<id>` or `user:<id>`. */
  by: string;
  at: string;
}

/**
 * `PUT …/:number/impl`: a branch pair (`head` and `base` together), a PR (`url`), or both. A PR
 * registered onto a declared head must have that head; its base replaces the declared one.
 */
export interface ProposalImplRequest {
  url?: string;
  head?: ProposalBranchRef;
  base?: ProposalBranchRef;
  sessionId?: string;
  agentId?: string;
}

/**
 * `POST …/proposals/adopt-impl` (anybody in the organization): every proposal without an impl PR takes the
 * latest `pr` material on the delivery repository as one: for proposals whose PR was attached
 * as a material and never registered as the impl.
 */
export interface ProposalAdoptImplResponse {
  adopted: Array<{ number: number; url: string }>;
  /** Adopted, but more than one `pr` material was on the delivery repository: the latest was taken. */
  ambiguous: Array<{ number: number; urls: string[] }>;
  /** Not adopted: no `pr` material there, or that PR is already another proposal's. */
  skipped: Array<{ number: number; reason: string }>;
}

/** One side of an impl branch as GitHub names it: the remote it was declared with (null when read off a PR), the repository, the branch. */
export interface ProposalResolvedBranch {
  remote: string | null;
  /** `owner/repo`. */
  repo: string;
  branch: string;
}

/** One file of an impl branch's patch, as GitHub's comparison lists it. */
export interface ProposalImplDiffFile {
  path: string;
  /** `added`, `removed`, `modified`, `renamed`, `copied`, `changed` or `unchanged`. */
  status: string;
  /** The path before a rename; null otherwise. */
  from: string | null;
  additions: number;
  deletions: number;
  /** The file's unified hunks; null when GitHub sent none (a binary file, or one too large). */
  patch: string | null;
}

/** `GET …/:number/impl/diff`: the impl branch's patch — the merge base of base and head, up to head. */
export interface ProposalImplDiff {
  head: ProposalResolvedBranch;
  base: ProposalResolvedBranch;
  /** The head commit, full sha. */
  headSha: string;
  mergeBase: string | null;
  /** Commits on head past the merge base, and on base past it. */
  ahead: number;
  behind: number;
  files: ProposalImplDiffFile[];
  /** GitHub lists at most 300 files of a comparison: true when there were more. */
  truncated: boolean;
  /** The comparison on GitHub. */
  compareUrl: string;
  /** The impl PR, null when none is registered. */
  pr: string | null;
}

/** One line of a hunk: added, deleted, or context on both sides. */
export interface ProposalImplDiffLine {
  kind: "add" | "del" | "context";
  text: string;
}

/** One hunk of a file's diff: where it starts on each side and how many lines it spans there. */
export interface ProposalImplHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The text after the second `@@` (the enclosing function, when git found one); empty otherwise. */
  section: string;
  lines: ProposalImplDiffLine[];
}

/** One file of an impl branch's structured diff. */
export interface ProposalImplChangedFile {
  path: string;
  /** The path before a rename; null otherwise. */
  oldPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  /** A binary file: counts are zero and there are no hunks. */
  binary: boolean;
  /**
   * Why the hunks are left out while the counts stay: `tooLarge` — the file is over the per-file
   * cap; `diffLimit` — the whole diff reached its cap before this file; `noPatch` — GitHub sent
   * no patch for it (a binary file or one too large, which GitHub does not tell apart). Null when
   * the hunks are given.
   */
  omitted: "tooLarge" | "diffLimit" | "noPatch" | null;
  hunks: ProposalImplHunk[];
}

/**
 * `GET …/:number/impl/changes[?w=1]`: the impl branch's diff, file by file with hunks — the merge
 * base of base and head, up to head. Read from the delivery repository's mirror, or, when the
 * mirror cannot answer, parsed from GitHub's comparison (`source: "github"`).
 */
export interface ProposalImplChanges {
  head: ProposalResolvedBranch;
  base: ProposalResolvedBranch;
  headSha: string;
  baseSha: string;
  mergeBase: string | null;
  source: "mirror" | "github";
  /** Why the mirror did not answer; null when it did. */
  fallbackReason: string | null;
  /** Whether whitespace changes were ignored: asked for and honoured (GitHub's comparison cannot). */
  ignoreWhitespace: boolean;
  files: ProposalImplChangedFile[];
  /** The sums over `files`. */
  additions: number;
  deletions: number;
  /** GitHub lists at most 300 files of a comparison: true when there were more (`source: "github"` only). */
  truncated: boolean;
  /** The caps the hunks were read under, in bytes: one file's content, and the whole diff's text. */
  limits: { fileBytes: number; diffBytes: number };
  compareUrl: string;
}

/** How one head stands against another: `ahead` = it contains the other and more. */
export type ProposalGraphRelation = "same" | "ahead" | "behind" | "diverged" | "unknown";

/** The PR an origin has on a node's branch, and how its head stands against the node's. */
export interface ProposalGraphOriginPr {
  /** The origin's name, as the settings list it (`fork`, `origin`). */
  origin: string;
  number: number;
  url: string;
  draft: boolean;
  head: string;
  relation: ProposalGraphRelation;
}

/**
 * A merged or closed PR the walk from a node's declared base passed through on its way to the
 * node's parent: the declared base was that PR's head branch, and the walk went on from that PR's
 * own base. A `closed` one was never merged, so its commits are still in the node's layer —
 * dropping them takes a restack of the layer onto the one below.
 */
export interface ProposalGraphVia {
  number: number;
  state: "merged" | "closed";
}

/**
 * Why a node is off the chain:
 * - `old-line`: its head neither contains its parent's head nor forked inside the parent's own layer
 *   (for the bottom layer, whose parent is the base branch: no fork point on the base's history);
 * - `unread`: its edge could not be compared;
 * - `no-base`: its declared base is neither the base branch nor the head branch of a node or of a merged or closed PR, so it is not drawn;
 * - `not-taken`: it stacks on a fork (`at`, a node's key; `""` = the base branch) where another branch keeps going;
 * - `above`: it stacks on `at`, which is off the chain itself;
 * - `cycle`: its declared bases lead back to itself.
 */
export type ProposalGraphOffReason =
  "old-line" | "unread" | "no-base" | "not-taken" | "above" | "cycle";

/**
 * A commit in the graph: an open PR on the delivery repository, or a proposal's impl branch on it
 * that no open PR claims yet (a branch node: `number` and `url` are null). Once a PR is opened on
 * the branch, the same node carries its number.
 */
export interface ProposalGraphNode {
  /**
   * The node's identity: its head branch. A second open PR on a branch name another node has
   * (a PR from another repository) is `<branch>#<number>`. `""` is never a node's key: it names
   * the base branch wherever a key is expected.
   */
  key: string;
  /** The open PR; null for a branch node. */
  number: number | null;
  url: string | null;
  /** The PR's title; a branch node's proposal's title. */
  title: string;
  draft: boolean;
  branch: string;
  head: string;
  /**
   * The declared base branch — the PR's `baseRefName`, or the base a branch node's impl
   * registered: a declaration, checked against ancestry below.
   */
  base: string;
  /** The node the declared base leads to, through the PRs in `via` (its key; `""` = the base branch); null = neither (`off.reason` says why). */
  parent: string | null;
  /** The merged or closed PRs between the declared base and `parent`, nearest first; empty when the base is the parent's branch. */
  via: ProposalGraphVia[];
  /** The head against the parent's head. */
  relation: ProposalGraphRelation;
  /** Commits the head has that the parent's head has not (the layer's size); null when unknown. */
  ahead: number | null;
  behind: number | null;
  /**
   * The edge to the parent holds: the head contains the parent's, or the commits it lacks carry no
   * content, or it forked inside the parent's own layer (then `stale`) — for the bottom layer, on
   * the base branch's history (then `stale`, `behind` = the commits the base gained since).
   */
  stacked: boolean;
  /**
   * Stacked only because it forked inside the parent's own layer, which has moved on since (for the
   * bottom layer: the base branch moved on): a restack is pending.
   */
  stale: boolean;
  /** On the chain: reached from the base branch through stacked edges, taking one branch at each fork. */
  onChain: boolean;
  /** Why the node is off the chain; null when it is on it. */
  off: { reason: ProposalGraphOffReason; at: string | null } | null;
  /** More than one stacked child: the chain forks here. */
  fork: boolean;
  /** The proposal whose impl this is; null for a PR no proposal registered (never for a branch node). */
  proposal: { number: number; title: string; status: ProposalStatus } | null;
  /** The other origins' PRs on the same branch. */
  origins: ProposalGraphOriginPr[];
}

/**
 * Why a proposal's impl is not on the graph:
 * - `counterpart`: an open PR on the delivery repository (`at`) has the impl PR's head branch — the registration names the other one;
 * - `merged`: merged, into `into` (for an impl branch with no PR: the proposal is merged, into the base it registered);
 * - `in-base`: not merged, but its head is already in the base branch;
 * - `closed`: closed without merging, and not in the base branch;
 * - `open-elsewhere`: open, on another repository;
 * - `unread`: GitHub could not be asked about it, or an impl branch's head is not on the delivery repository or could not be read there.
 */
export type ProposalGraphUnplacedReason =
  "counterpart" | "merged" | "in-base" | "closed" | "open-elsewhere" | "unread";

/** A proposal whose impl is on no node of the graph, and why. */
export interface ProposalGraphUnplaced {
  number: number;
  title: string;
  status: ProposalStatus;
  /** The impl PR; null for an impl branch with no PR. */
  implPr: string | null;
  /** The declared head, `<remote>/<branch>`; null when the impl was registered as a PR alone. */
  branch: string | null;
  reason: ProposalGraphUnplacedReason;
  /** The counterpart's number (`counterpart`); null otherwise. */
  at: number | null;
  /** The branch it was merged into (`merged`); null otherwise. */
  into: string | null;
}

/**
 * One row of the drawn graph. `cells` holds one cell per column, two characters each: `│ ` a line
 * passing through, `○ ` a node on the chain, `◌ ` one off it whose edge holds, `× ` one whose edge
 * does not, `├─` and `╯ ` a line joining back into the node below, `~ ` the base branch.
 */
export interface ProposalGraphRow {
  /** `node`: a node's row; `join`: a line joining back; `base`: the base branch, the last row. */
  kind: "node" | "join" | "base";
  /** The node drawn (`""` for the base branch); for a join, the node the line joins into. */
  key: string;
  cells: string[];
  /**
   * The base row: the commits the base branch gained since the bottom layer of the first
   * column's stack was built; null when it has not moved on, and on every other row.
   */
  behind: number | null;
  /**
   * A node without a proposal drawn in `ownRows` only because a proposal's node stacks on it:
   * drawn faded. False on every other row, and always in `rows`.
   */
  connector: boolean;
}

/** `GET …/proposals/graph`: the delivery repository's open PRs as a commit graph. */
export interface ProposalGraphResponse {
  repo: string;
  base: { branch: string; head: string | null; fork: boolean };
  origins: Array<{ name: string; repo: string }>;
  nodes: ProposalGraphNode[];
  /**
   * The chain's last layer (its key), or null when the chain is empty or forks with no single
   * branch that keeps going — choosing there takes the record (the roadmap's order), which the
   * graph does not read.
   */
  top: string | null;
  /**
   * The last layer of every branch the chain walk took (keys, in key order). Every line hanging
   * straight from the base branch is a stack of its own and on the chain; each one's last layer
   * is here, so each is marked as its stack's top.
   */
  tops: string[];
  /**
   * The graph drawn as Sapling's smartlog draws a stack, top to bottom: newest on top, a line
   * forking from a node in the column to its right right above it, joining back with `├─╯`,
   * the base branch the last row. The CLI prints the cells; the page draws the same cells.
   * A node with no row (no parent, or a cycle of declarations) is not drawn.
   */
  rows: ProposalGraphRow[];
  /**
   * The same drawing of the organization's own part, the default view: the nodes that carry one
   * of its proposals and, below them, the nodes without one their lines need (`connector`). The
   * chain was decided over every node; this only leaves the others out of the drawing.
   */
  ownRows: ProposalGraphRow[];
  /** Proposals whose impl is on no node of the graph. */
  unplaced: ProposalGraphUnplaced[];
  /** What could not be read from GitHub; the graph is partial when present. */
  errors: string[];
  /** When the delivery repository was last found to be as this graph shows it. */
  checkedAt: string;
  /** Every registered deployment with the commit it runs and the layer that commit sits on. */
  deployments: ProposalGraphDeployment[];
  /**
   * A refresh of the graph is running: this answer is the stored one, and a later read may
   * show more. Absent from a server older than the field.
   */
  refreshing?: boolean;
}

/**
 * A registered deployment as the graph places it. `at` is the key of the node whose head the
 * deployment's commit is (`relation: "same"`) or contains (`"ahead"`, `ahead` commits past it);
 * `""` is the base branch; null when the commit is unknown or compares with no layer.
 */
export interface ProposalGraphDeployment {
  id: string;
  /** A penguin server deployment's url; null for any other deployment. */
  url: string | null;
  commit: string | null;
  describe: string | null;
  at: string | null;
  relation: "same" | "ahead" | null;
  ahead: number | null;
  /** Why the commit could not be read, when it could not. */
  error: string | null;
}

/**
 * A deployment on the organization's registry: only deployments somebody registered; none
 * registers itself. A penguin server deployment carries its `url` and the install id it
 * answered with; any other deployment carries neither.
 */
export interface ProposalDeployment {
  id: string;
  url: string | null;
  installId: string | null;
  registeredAt: string;
  by: string;
}

/** GET …/proposals/deployments, and the answer to POST …/proposals/deployments. */
export interface ProposalDeploymentsResponse {
  deployments: ProposalDeployment[];
}

/** POST …/proposals/deployments: register one deployment by its id; `url` makes it a penguin server deployment. */
export interface ProposalDeploymentRegisterRequest {
  id: string;
  url?: string;
}

/** Where an ActionRun came from; `notify`: a notice another run sent once its write committed. */
export type ActionRunVia = "web" | "cli" | "session" | "api" | "notify";

/** How an ActionRun ended; null while it runs. */
export type ActionRunOutcome = "succeeded" | "refused" | "failed" | "aborted" | "abandoned";

/**
 * One execution of an Action (company-proposals' Action registry): who ran which Action on
 * what, from where, and how it ended. The Activity is these, newest first.
 */
export interface ActionRunView {
  id: string;
  /** The Action's key, `proposal.approve`. */
  key: string;
  /** The contribution that ran, `company-proposals.action.approve`. */
  contribution: string;
  subjectKind: string;
  /** The subject as written, `proposal:12`. */
  subject: string;
  /** The subject's commit when the run started (a deploy's head); null for a subject without one. */
  commit: string | null;
  params: Record<string, unknown>;
  /** `user:<id>` or `agent:<id>`. */
  by: string;
  via: ActionRunVia;
  sessionId: string | null;
  requestId: string | null;
  startedAt: string;
  /** null while the run has not ended. */
  outcome: ActionRunOutcome | null;
  /** The HTTP status the run answered. */
  status: number | null;
  code: string | null;
  message: string | null;
  /** What the run returned (the proposal after it, a process's exit). */
  result: unknown;
  /** After hooks that failed: the write stands, each failure is listed. */
  hookErrors: string[];
  endedAt: string | null;
}

/** `POST …/actions/:key/runs` and `POST …/actions/by-id/:contribution/runs`. */
export interface ActionRunRequest {
  /** `organization`, `proposal:12`, `comment:12/<id>`, `discussion:12/<session>`, `roadmap:3`, `item:3/<key>`, `branch:<remote>/<branch>`, `pr:<owner>/<repo>#<n>`, `target:<id>`. */
  subject: string;
  params?: Record<string, unknown>;
  /** A retry with the same id answers the first run instead of running again. */
  requestId?: string;
  /** The surface the run is started from (`session` is read off the caller). */
  via?: "web" | "cli";
}

/** The answer to a run: 200 once it ended, 202 while a process it started runs (follow it with `GET …/actions/runs/:id`). */
export interface ActionRunAnswer {
  run: ActionRunView;
  result: unknown;
}

/** `GET …/actions/runs?subject=&by=&key=&before=&limit=`: one page of the Activity, newest first. */
export interface ActionRunsResponse {
  runs: ActionRunView[];
  /** The `before` of the next page; null on the last. */
  next: string | null;
}

/** `GET …/actions/runs/:id?from=`: one run, and its process output from an offset (a bounded tail). */
export interface ActionRunResponse {
  run: ActionRunView;
  output: string;
  /** Where `output` starts: `from`, or later when the earlier output was dropped. */
  from: number;
  /** The offset to ask from next. */
  next: number;
}

/** An Action bound in the organization, and whether the caller may run it on the subject asked about. */
export interface ActionView {
  key: string;
  contribution: string;
  subjects: string[];
  /** Parameter name (`?`: optional) to its type. */
  params: Record<string, string>;
  description: string;
  /** A plugin's own Action rather than a company workflow's. */
  builtin: boolean;
  /** With `?subject=`: the guard's answer for the caller now (parameters not considered). */
  allowed?: boolean;
  refusal?: { status: number; code: string; message: string };
}

/** `GET …/actions[?subject=]`: the organization's Actions (those acting on that subject's kind). */
export interface ActionsResponse {
  actions: ActionView[];
}

/**
 * One contribution to the organization's Action registry: a plugin's own (built in), or one of
 * the organization's company workflows'. A company workflow's `action` or `guard` takes the
 * place of the built-in one on its key.
 */
export interface ActionContributionView {
  id: string;
  kind: "action" | "guard" | "hook" | "subject";
  key: string | null;
  /** The contributing module. */
  from: string;
  builtin: boolean;
  /** The company workflow that contributes it; null for a built-in one. */
  workflow: string | null;
  /** A built-in `action` or `guard` a company workflow's contribution replaces on its key. */
  replaced: boolean;
  subjects: string[];
  when: "before" | "after" | null;
  description: string;
}

/** A key two or more contributions of the same standing answer: ambiguous when invoked. */
export interface ActionConflict {
  key: string;
  kind: "action" | "guard";
  contributions: string[];
}

/** `GET …/actions/contributions`: every contribution, and those the registry left out. */
export interface ActionContributionsResponse {
  contributions: ActionContributionView[];
  skipped: Array<{ id: string; reason: string }>;
}

/** `GET …/actions/check`: the organization's conflicts. */
export interface ActionCheckResponse {
  conflicts: ActionConflict[];
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * A company workflow of an organization (company-proposals): `<org dir>/workflows/<id>/`, an
 * Agent workflow's package scoped to the organization, whose contributions to the Action
 * registry take effect there as soon as it loads.
 */
export interface CompanyWorkflowView {
  id: string;
  name: string;
  version: string | null;
  /** The content revision of the folder on disk. */
  revision: string;
  /** The revision serving: the last one that loaded; null while none has. */
  serving: string | null;
  loadedAt: string | null;
  /** Why the files on disk did not load; the previous instance, if any, keeps serving. */
  error: string | null;
  /** The ids of the serving instance's contributions in force: those the registry took in. */
  contributions: string[];
  /** Its contributions the registry left out, and why (a `workflow.*` key, a clashing id). */
  skipped: Array<{ id: string; reason: string }>;
  files: string[];
}

/** `GET …/organizations/:orgId/workflows`. */
export interface CompanyWorkflowsResponse {
  workflows: CompanyWorkflowView[];
}

/** `GET …/organizations/:orgId/workflows/:id/history`: the recorded versions, newest first. */
export interface CompanyWorkflowHistoryResponse {
  versions: WorkflowVersion[];
}

/** `GET …/organizations/:orgId/workflows/:id/files/<path>`. */
export interface CompanyWorkflowFileResponse {
  path: string;
  content: string;
}

export interface ProposalDetail extends ProposalItem {
  /** The delegation, as the person wrote it — or as the author or a person last rewrote it (`penguin org proposal brief`). */
  brief: string;
  /** The repository's directory relative to the organization's shared workspace ("" = the workspace itself); scope paths are relative to it. */
  root: string;
  /** The absolute directory the scope resolves under, on the server that owns the organization — present on a read and on a publish answer. */
  base?: string;
  /** Notes on the scope a publish accepted but that deserve a look (a `new` file that already exists, a rename target already there) — on the publish answer only. */
  hints?: string[];
  scope: ProposalScopeEntry[];
  /** The tests that bear on the change, existing and new; `[]` on a revision written before tests existed. */
  tests: ProposalTestEntry[];
  sections: ProposalSection[];
  /** Pending comments are the commenter's own until requested: an employee sees only batched ones. */
  comments: ProposalComment[];
  events: ProposalEvent[];
  /** Implementation sessions, in the order they were opened. */
  sessions: string[];
  /** Discussions with the owner, in the order they were opened. */
  discussions: ProposalDiscussion[];
  /**
   * The revision the standing approval covers, or null. An approval covers ONE revision: a
   * later publish puts the proposal back to `ready`, and this stays at the approved one so
   * the page can show what changed since.
   */
  approvedRevision: number | null;
  /** The proposal's latest `seq`: what `POST …/read` should carry to mark everything read. */
  seq: number;
  /** The test groups the proposals plugin's configuration declares, in display order — on a read. */
  testGroups?: ProposalTestGroup[];
  /**
   * The impl branch's `+N/−M`, on a read while an impl is registered: computed in the background
   * and cached by the head and base commits (the cache the diff view reads), so a read never waits
   * for it — `computing` until known, then a plugin event (`impl_stat`) says to read again.
   */
  implStat?: ProposalImplStat;
}

/** An impl branch's totals: computing, known (with the commits they were read at), or why not. */
export type ProposalImplStat =
  | { state: "computing" }
  | {
      state: "ready";
      head: ProposalResolvedBranch;
      base: ProposalResolvedBranch;
      headSha: string;
      baseSha: string;
      files: number;
      additions: number;
      deletions: number;
      compareUrl: string;
    }
  | { state: "unavailable"; reason: string };

/**
 * A discussion: a session of the owner's Agent (the implementer, else the author) that a
 * person opened from the proposal page to talk the proposal over — not the owner's desk. Its
 * conclusion is delivered to the desk once; until then it is open.
 */
export interface ProposalDiscussion {
  sessionId: string;
  /** The owner the session runs as. */
  agentId: string;
  /** The person that opened it (`user:<id>`). */
  by: string;
  at: string;
  /** Set once the conclusion reached the owner's desk. */
  concluded: { by: string; at: string; text: string } | null;
}

/**
 * A test group the proposals plugin's configuration declares (Settings → Plugins, one line
 * `id: description` each; server-wide). A proposal's tests may only use declared groups, and
 * the page shows them in the declared order.
 */
export interface ProposalTestGroup {
  id: string;
  description: string;
}

/** `GET …/organizations/:orgId/proposals/test-groups`. */
export interface ProposalTestGroupsResponse {
  groups: ProposalTestGroup[];
}

/** One revision as it was published: `GET …/:number/revisions/:rev`. */
export interface ProposalRevision {
  revision: number;
  title: string;
  /** The scope's root at this revision ("" = the shared workspace). */
  root: string;
  scope: ProposalScopeEntry[];
  tests: ProposalTestEntry[];
  sections: ProposalSection[];
  /** `agent:<id>` or `user:<id>`. */
  by: string;
  at: string;
}

/** `GET …/:number/revisions`: every revision published, oldest first. */
export interface ProposalRevisionsResponse {
  revisions: Array<{ revision: number; by: string; at: string }>;
}

/**
 * `GET …/:number/file?path=`: one file under the proposal's `base`, read-only, for the page's
 * file panel. `path` is relative to `base` (as the scope and tests write it).
 */
export interface ProposalFileResponse {
  path: string;
  size: number;
  /** A NUL byte in the first 8 KB; `content` is then null. */
  binary: boolean;
  /** Only the first 512 KB is sent. */
  truncated: boolean;
  content: string | null;
  /** The file's extension, lowercase and without the dot ("" when none); the page maps it to a grammar. */
  extension: string;
}

export interface ProposalsResponse {
  proposals: ProposalItem[];
}

export interface ProposalCreateRequest {
  /** The author employee's Agent id; default = the calling employee (a person has to name one). */
  author?: string;
  brief: string;
  title?: string;
  sessionId?: string;
  agentId?: string;
}

/** `PUT …/:number` — a revision: the whole proposal as one Markdown document (frontmatter `title` and `scope`, then the sections). */
export interface ProposalPublishRequest {
  markdown: string;
  sessionId?: string;
  agentId?: string;
}

export interface ProposalImplementRequest {
  /** The employee that builds it; default = the author itself. */
  agentId?: string;
  message?: string;
  workspace?: string;
  sessionId?: string;
  /** The caller's identity claim (the CLI's PENGUIN_AGENT_ID); distinct from `agentId`, the implementer. */
  callerAgentId?: string;
}

/** `POST …/:number/discussions/:sessionId/conclude` — the conclusion, delivered to the owner's desk. */
export interface ProposalConcludeRequest {
  text: string;
  sessionId?: string;
  agentId?: string;
}

export interface ProposalMaterialRequest {
  kind: ProposalMaterialKind;
  url: string;
  label?: string;
  sessionId?: string;
  agentId?: string;
}

export interface ProposalFeedbackRequest {
  text: string;
  /** From the test team's run of the dev branch rather than from building the proposal. */
  runtime?: boolean;
  sessionId?: string;
  agentId?: string;
}

/**
 * What a comment that is not on a passage is on:
 *
 * - `scope` — an entry of the current revision's scope, by its file and kind;
 * - `test` — an entry of the current revision's tests, by its file;
 * - `change-file` — a file of the impl branch's diff;
 * - `change-lines` — lines `start`..`end` (inclusive, 1-based) of a changed file, on the old side
 *   (the merge base) or the new side (the head).
 *
 * A comment on the diff records the head and base commits the diff was read at: once either
 * branch moves, the page marks it outdated and still shows the lines it was written on (its
 * `quote`).
 */
export type ProposalCommentTarget =
  | { kind: "scope"; file: string; scopeKind: ProposalScopeKind }
  | { kind: "test"; file: string }
  | { kind: "change-file"; path: string; headSha: string; baseSha: string }
  | {
      kind: "change-lines";
      path: string;
      side: "old" | "new";
      start: number;
      end: number;
      headSha: string;
      baseSha: string;
    };

/**
 * The `target` param of `proposal.comment`: what to comment on, as the page names it. A diff
 * target carries the commits the page read the diff at; the server refuses it once they are not
 * the current ones, and reads a line range's text itself.
 */
export type ProposalCommentTargetRequest = ProposalCommentTarget;

/**
 * `proposal.comment` — a comment on `[start, end)` of `sectionId`'s source (`quote` must equal
 * that slice), or on a `target` (no section fields then).
 */
export type ProposalCommentRequest =
  | { sectionId: string; start: number; end: number; quote: string; text: string }
  | { target: ProposalCommentTargetRequest; text: string };

/**
 * `GET …/:number/comments[?pending=1]` — the comments the caller may see (`pending`: the
 * batched, unresolved ones — the author's work list), and `text`: the proposal's sections
 * with every listed comment's passage wrapped in `⟦<id>⟧…⟦/<id>⟧`, followed by the comments
 * by id. What an agent reads; it carries no offsets.
 */
export interface ProposalCommentsResponse {
  number: number;
  comments: ProposalComment[];
  text: string;
}

/** `PATCH …/:number/comments/:id` — a pending comment reworded by the person who wrote it. */
export interface ProposalCommentEditRequest {
  text: string;
}

export interface ProposalResolveRequest {
  text?: string;
  sessionId?: string;
  agentId?: string;
}

export interface ProposalRejectRequest {
  reason: string;
}

export interface ProposalReadRequest {
  upTo: number;
}

/** The `data` of the plugin event `company-proposals` publishes after every write. */
export interface ProposalPluginEvent {
  projectId: string;
  orgId: string;
  number: number;
  seq: number;
  /** `impl_stat`: the impl's `+N/−M` (`implStat`) was computed or changed — no write, re-read the detail. */
  kind: ProposalEventKind | "comment" | "impl_stat";
}

// ---------------------------------------------------------------------------
// Web contributions (GET /api/contributions)
// ---------------------------------------------------------------------------

/** How the web app renders a contributed surface: a name from its own registry, or an iframe. */
export type RendererRef = { builtin: string } | { iframe: { src: string; namespace: string } };

/** One contribution to a web slot: its id, the contributing module, and the slot's data. */
export interface WebContribution {
  id: string;
  from: string;
  [key: string]: unknown;
}

/** One session surface a plugin contributes: what "New chat" offers, and what draws a Session of that kind. */
export interface SessionSurfaceSummary {
  id: string;
  /** The contributing module's name. */
  from: string;
  /** The surface's key: `SessionInfo.surface` on every Session of this kind. */
  kind: string;
  label: string;
  labelZh?: string;
  /** `iframe` here carries `src` only; `:sessionId` in it is replaced by the Session id. */
  renderer: { builtin: string } | { iframe: { src: string } };
}

/**
 * The data of one `WebModule.pages` contribution: its route, where it sits (`main` = the
 * development nav; `org` = a company-mode page — its path is relative to
 * `/org/:projectId/:orgId/` and it gets a nav row after the organization's own; `none` =
 * reachable by URL only), whether it is admin-only, its renderer; its nav row's name in English
 * and Chinese and its glyph (a name in the web UI's icon registry); and the key of the page it
 * sits under, if any — one level only, and a page whose parent is absent is not shown.
 */
export type WebPageData = {
  key: string;
  path: string;
  nav: "main" | "org" | "none";
  admin: boolean;
  renderer: RendererRef;
  parent?: string;
  title?: string;
  titleZh?: string;
  icon?: string;
};

/** A page contribution as GET /api/contributions answers it. */
export type WebPageContribution = WebContribution & WebPageData;

/**
 * The data of one `WebModule.fileRenderers` contribution: the Workspace files it draws, by
 * extension (without the dot, compared case-insensitively), and the renderer that draws one.
 * Where the app shows it is the app's own choice (below a reply's paragraph that links the file).
 */
export type WebFileRendererData = {
  extensions: string[];
  renderer: RendererRef;
};

/** A file renderer contribution as GET /api/contributions answers it. */
export type WebFileRendererContribution = WebContribution & WebFileRendererData;

/**
 * The data of one `WebModule.pageRemovals` contribution: the key of a page the web app drops —
 * one of its own or one another plugin contributed. The app drops the routes under the page's
 * path and the pages under it with it, and keeps the page its catch-all leads to.
 */
export type WebPageRemovalData = {
  key: string;
};

/** A page removal as GET /api/contributions answers it. */
export type WebPageRemovalContribution = WebContribution & WebPageRemovalData;

export interface ContributionsResponse {
  pages: WebPageContribution[];
  fileRenderers: WebFileRendererContribution[];
  pageRemovals: WebPageRemovalContribution[];
  agentTabs: WebContribution[];
  sessionTabs: WebContribution[];
  /** Module plugins' quick starts, each named by the module that contributes it (`from`). */
  quickStarts: Array<QuickStartItem & { id: string; from: string }>;
  /** The surfaces this process's plugins contribute; empty without any. */
  sessionSurfaces: SessionSurfaceSummary[];
}

/**
 * GET / POST / DELETE /api/sessions/:sessionId/surface — a surface Session's surface. `opened`
 * false = never opened in this process (nothing to attach to yet; POST opens it); `alive`
 * false with `opened` true = it ran and ended (POST opens it again).
 */
export interface SessionSurfaceResponse {
  kind: string;
  status: SessionStatus;
  opened: boolean;
  alive: boolean;
  /** Renderer-specific; `TerminalSurface` reads `{ terminalId }`. Absent when not opened. */
  view?: Record<string, unknown>;
}

export interface SessionSurfaceOpenRequest {
  /** A first prompt for the surface (the draft page's text); absent = just open it. */
  prompt?: string;
  cols?: number;
  rows?: number;
}

/** GET /api/projects/:p/agents/:a/package — what publishing would send. */
export interface AgentPackageResponse {
  manifest: PackageManifestType;
  bytes: number;
  /** Whether the server has any GitHub identity; false = the publish button explains why not. */
  canPublish: boolean;
  /** Which identity it would publish with: the server machine's `gh` login, or a stored token. */
  publishVia: PublishMethodType;
  /** The gist this Agent was published to before — a republish updates it. */
  publishedGist: PublishedGistType | null;
}

/** POST …/package/publish — the gist it landed in. */
export interface AgentPackagePublishResponse {
  gistId: string;
  url: string;
  files: number;
  bytes: number;
  /** The gist already held exactly this: nothing was written, and no API call was spent. */
  unchanged: boolean;
}

/** How an Agent package source is read (see the server's packages/sources.ts). */
export type AgentPackageSourceKind = "gist" | "npm" | "github-release" | "github" | "git" | "url";

/** POST /api/agent-packages/preview — a source read and validated, nothing written. */
export interface AgentPackagePreviewResponse {
  manifest: PackageManifestType;
  bytes: number;
  /** The resolved origin, for display: `npm:<name>@<version>`, `github:o/r#ref`, a gist URL, … */
  source: string;
  kind: AgentPackageSourceKind;
  /** The manifest's Agent id, or the source's name when the source carries no manifest. */
  suggestedId: string;
}

/**
 * One field of a settings group a module declares (its `PluginConfigProvider.groups`
 * contribution's `properties.<name>`): what the Settings dialog draws for it. `secret` is
 * drawn as a password field and masked on the way out; `enum` is a choice among `options`;
 * `list` is a list of strings, drawn one per line; `table` is a fixed set of `rows`, each a
 * value per one of its `columns`, drawn as a table.
 */
export interface PluginConfigField {
  type: "string" | "secret" | "boolean" | "number" | "enum" | "list" | "table";
  title: string;
  titleZh?: string;
  /** What the field means: disclosed behind a "?" beside its title. */
  description?: string;
  descriptionZh?: string;
  /**
   * The shape a value must take ("one absolute path per line"): shown under the field at all
   * times, since it is read while typing.
   */
  hint?: string;
  hintZh?: string;
  placeholder?: string;
  /** The value a package with nothing stored reads; also what an empty field falls back to. */
  default?: string | number | boolean | string[];
  /**
   * Drawn in the card's Advanced fold, collapsed by default, rather than among the basic
   * fields. Presentation only: it is stored, validated and read like any other field.
   */
  advanced?: boolean;
  /** A save that would leave this field empty is refused. */
  required?: boolean;
  /** `enum` only: the values it may take, in display order. */
  options?: PluginConfigOption[];
  /** `list` only: the most entries a save may leave (after trimming and de-duplicating). */
  maxItems?: number;
  /** `number` only: the smallest and largest value a save may store. */
  minimum?: number;
  maximum?: number;
  /** `string` / `list` only: a regular expression every value (every line) must match. */
  pattern?: string;
  /** What a save refused by `pattern` says, after the field's name (e.g. "must be an absolute path"). */
  patternErrorMessage?: string;
  /**
   * `table` only: its columns, in display order, and its rows, in display order. The table
   * has no `default`: the rows' declared cells are its defaults, and what is stored is only
   * the cells that differ from them — `{ [row id]: { [column]: value } }`.
   */
  columns?: PluginConfigTableColumn[];
  rows?: PluginConfigTableRow[];
  /**
   * `table` only: a single choice of one row — the sandbox's default preset. The choice is
   * stored in `field`, an `enum` field of the same group whose options are the row ids (plus,
   * in an `extensible` table, the ids of the rows added to it); the page draws that field only
   * as its title in brackets after the chosen row's name ("(Default)"), and picks it from a
   * row's "…" menu.
   */
  rowChoice?: PluginConfigRowChoice;
  /**
   * `table` only: rows may be added (and only those deleted, from the row's "…" menu) and every
   * row reordered. A new row
   * starts from these values. What is stored, beside the declared rows' changed cells, is the
   * added rows under `"$added"` (`{ [row id]: { [column]: value } }`, every column present) and
   * the row order under `"$order"` (row ids); neither key can be a row id. A save sends either
   * key whole; a document without them reads as the declared rows in declared order.
   */
  extensible?: PluginConfigNewRow;
  /**
   * `table` only: a header drawn over adjacent columns that belong together (the sandbox's
   * Pin, under "Action"). `columns` names them. When the group ends the columns, the row's drag
   * handle and "…" menu join it.
   */
  columnGroup?: PluginConfigColumnGroup;
  /**
   * `table` only: a `boolean` column drawn as a pin toggle rather than a switch — a row pinned
   * to a list (the sandbox presets in the composer's menu). The texts are its tooltip in each
   * state. Declared on the table, not the column, so every column keeps one shape.
   */
  pin?: PluginConfigPinColumn;
}

/** A table's pin column: which boolean column, and its tooltip pinned and not. */
export interface PluginConfigPinColumn {
  column: string;
  on: string;
  onZh?: string;
  off: string;
  offZh?: string;
}

/**
 * A table's single choice of a row: the `enum` field it stores into, and its title, drawn in
 * brackets after the chosen row's name. The choice may name no row (nothing stored, and the
 * group's `derive` gives none): no row is marked and a save is not refused for it. A save that
 * leaves it naming a row the table no longer has is refused.
 */
export interface PluginConfigRowChoice {
  field: string;
  title: string;
  titleZh?: string;
}

/** One column of a `table` field: a scalar field type (`string`, `boolean`, or an `enum` with `options`). */
export interface PluginConfigTableColumn {
  name: string;
  type: "string" | "boolean" | "enum";
  title: string;
  titleZh?: string;
  /** What the column means: disclosed behind a "?" beside its header. */
  description?: string;
  descriptionZh?: string;
  options?: PluginConfigOption[];
}

/** One row of a `table` field: its id and its declared cells. */
export interface PluginConfigTableRow {
  id: string;
  /** Every column's declared value. */
  values: Record<string, string | boolean>;
  /** A string cell's declared value in Chinese, shown until a save changes the cell. */
  valuesZh?: Record<string, string>;
  /** Columns whose cell in this row a save may not change. */
  locked?: string[];
  /** A row added to an `extensible` table (not declared): the only kind that may be deleted. */
  added?: boolean;
  /**
   * What the row is for, disclosed behind a "?" beside its name while its `enum` cells hold
   * their declared values. A row without one, or whose choices changed, gets a "?" listing its
   * `enum` cells' values and what each does (the options' `description`s).
   */
  description?: string;
  descriptionZh?: string;
}

/** A header over adjacent table columns, with its own "?". */
export interface PluginConfigColumnGroup {
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  columns: string[];
}

/** The values a row added to an `extensible` table starts from. */
export interface PluginConfigNewRow {
  /** The add button's text ("Add preset"). */
  add?: string;
  addZh?: string;
  values: Record<string, string | boolean>;
  /** A string column's starting text in Chinese. */
  valuesZh?: Record<string, string>;
}

/** One choice of an `enum` field. */
export interface PluginConfigOption {
  value: string;
  title: string;
  titleZh?: string;
  /** What picking it does: listed, for a table column's option, in a row's "?" (see the row's `description`). */
  description?: string;
  descriptionZh?: string;
}

/** A declared configuration: a titled group of fields, in declaration order. */
export interface PluginConfiguration {
  title?: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  /**
   * A `boolean` field that turns the group on (the sandbox's `enabled`). While it is off, as
   * drafted, the card draws that field alone: no other field, notice or action, and none of the
   * groups drawn inside it. Turning it on in a group that reports a `backend` it lacks offers
   * to install one.
   */
  switch?: string;
  properties: Record<string, PluginConfigField>;
}

/** A line of live status a contributed group reports beside its fields (e.g. that nothing can enforce it). */
export interface PluginConfigNotice {
  /**
   * `progress` = work the group started is still running (an install, a download): the page
   * reads the groups again every few seconds while any notice says so, and the text is the
   * step it is on.
   */
  tone: "attention" | "muted" | "progress";
  text: string;
  textZh?: string;
  /** More about the notice, disclosed under it on request; lines separated by `\n`. */
  details?: string;
  detailsZh?: string;
}

/** One settings group (GET /api/admin/plugin-config): its schema and its values, secrets masked. */
export interface PluginConfigEntry {
  /** The group's name — the id of the contribution that declared it; also the store key. */
  name: string;
  configuration: PluginConfiguration;
  /** Stored values merged onto the defaults; a secret arrives masked (`first4…last4` or `***`), never in the clear. */
  values: Record<string, unknown>;
  /** Drawn inside that entry's card and saved with it (a sandbox backend's options inside the sandbox's). */
  parent?: string;
  /** Live status beside the fields; absent when there is none. */
  notices?: PluginConfigNotice[];
  /** What this group can DO once, on the machine, drawn as buttons beneath its notices. */
  actions?: PluginConfigActionDecl[];
  /** Enum options this machine cannot honour now: drawn greyed out with the reason; a save choosing one is refused. */
  unavailable?: PluginConfigUnavailableDecl[];
  /**
   * For a group whose settings a backend plugin enforces (the sandbox): whether one that
   * applies to this machine's OS is installed, and which packages this OS defaults to. The card
   * offers to install `recommended` when the group's switch is turned on and none is installed.
   * Asked per read, like the notices; the client never guesses the OS.
   */
  backend?: PluginConfigBackend;
}

/** Whether a backend that applies to this machine is installed, and this OS's default ones. */
export interface PluginConfigBackend {
  /** A backend for this OS is installed: loaded, or installed and failing its check. */
  installed: boolean;
  /**
   * The npm packages this OS defaults to, installed together; absent on an OS with no default
   * backend. Linux names two: bubblewrap, and sandbox-dsh, which confines files through
   * Landlock where bubblewrap is refused.
   */
  recommended?: string[];
}

/** One enum option (or boolean position) a settings group cannot honour on this machine, and why. */
export interface PluginConfigUnavailableDecl {
  field: string;
  /** A `table` field's column: the option is unavailable in every cell of that column. */
  column?: string;
  /** An enum option, or a boolean field's position: "true" or "false". */
  value: string;
  reason: string;
  reasonZh?: string;
}

/** One button under a settings group: what it is called, and what pressing it will do. */
export interface PluginConfigActionDecl {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
}

/** POST /api/admin/plugin-config/action — what running one reported. */
export interface PluginConfigActionResponse {
  ok: boolean;
  message: string;
  messageZh?: string;
  /** The groups as they stand after it ran: a setup that worked changes what the page says. */
  plugins: PluginConfigEntry[];
}

export interface PluginConfigResponse {
  plugins: PluginConfigEntry[];
}

/**
 * PUT /api/admin/plugin-config — one group's update. Every named field is validated
 * against its type; an omitted field keeps its stored value; a secret sent as the masked
 * value keeps the stored one, and `null` or `""` clears any field. 400 `plugin_config_invalid`
 * (with `field`) on a value that does not fit or a required field left empty; 404
 * `plugin_config_unknown` for a name no group answers to.
 */
export interface PluginConfigUpdateRequest {
  name: string;
  values: Record<string, unknown>;
}

/**
 * An installed plugin the running build cannot fully run (plugin/unsatisfied.ts): it
 * contributes to a slot, or wires to a module or interface, that this build does not have.
 * Also what a refused push names (`plugins_unsatisfied`) and a confirmed one reports.
 */
export interface UnsatisfiedPlugin {
  /** The package specifier, as the installed-plugins list spells it. */
  specifier: string;
  /** True when the whole plugin is left out of this generation; false when only the contributions this build has no slot for were dropped and the rest of it runs. */
  disabled: boolean;
  /** What this build lacks, in the platform's own words. */
  reason: string;
}

/**
 * The provenance of a name enabled from a local directory (the local link route): what the
 * link record under the data root holds. A locally linked package has no integrity — what
 * its directory holds is what runs.
 */
export interface LocalPluginLink {
  /** The directory the name is linked to, as it was named when the link was made. */
  path: string;
  /** When the link was made, ISO 8601. */
  linkedAt: string;
  /** Who made it, the operating user's id. */
  by: string;
}

/** One plugin a Project lists (GET /api/projects/:projectId/plugins/installed). */
export interface InstalledPlugin {
  /** The package specifier as written in the file. */
  specifier: string;
  /** Whether the running process holds this package — its modules are in the tree. */
  active: boolean;
  /**
   * Where the package came from: shipped with the build (a hot push's assets, or the
   * installation's own `plugins/`) rather than fetched from npm. A tag on an installed
   * plugin — being shipped is not being installed.
   */
  builtin: boolean;
  /** Module names the package declares it adds. */
  modules: string[];
  /** Node names the package declares it stands in for. */
  replaces: string[];
  /**
   * Why the package is not running: unresolvable, or a load that
   * failed (an import that threw, a module name another plugin already took). Only ever
   * reported for a plugin this server is asked to run (`here`).
   */
  error?: string;
  /**
   * Present when this build cannot fully run the package (see {@link UnsatisfiedPlugin}).
   * With `disabled`, `active` is false and a restart would not load it; without, the package
   * runs minus the contributions this build has no slot for. Only reported for a plugin this
   * server is asked to run (`here`).
   */
  unsatisfied?: Pick<UnsatisfiedPlugin, "disabled" | "reason">;
  /** Listed in the shared `[plugins]` table: every machine runs it. */
  everywhere: boolean;
  /** The machines whose own `[plugins.<machineId>]` table lists it, by machine id. */
  machines: string[];
  /**
   * Whether THIS server is asked to run it — shared, or listed for this server's own id. A
   * plugin listed only for other machines is neither installed nor loaded here, so `active`
   * is false and no `error` is reported for it.
   */
  here: boolean;
  /**
   * The skills this enabled code plugin declares on the server's skills slot, metadata only —
   * installable onto an Agent through the plugin install route, by this package name. Present
   * only while the process runs the package; a plugin no Project lists contributes nothing, so
   * its skills stop being offered — what "disabled" means for a skill's source.
   */
  skills?: SkillMetadataItem[];
  /**
   * Present when the name is linked to a local directory on this machine (enabled through
   * the local link route): where the directory is, when it was linked and by whom — the
   * record the one-step undo takes away. Independent of `active`: the provenance is a fact
   * about the name, not about whether this process runs it.
   */
  local?: LocalPluginLink;
}

export interface InstalledPluginsResponse {
  plugins: InstalledPlugin[];
  /**
   * Specifiers this build SHIPS (the hot push's assets, or the installation's own
   * `plugins/`): installable without a download, and not installed until listed.
   */
  shipped: string[];
  /** The file the list lives in, named for the page that explains where to edit it by hand. */
  file: string;
  /** This server's own machine id — the key of its `[plugins.<machineId>]` table. */
  machineId: string;
  /** A listed plugin neither runs, nor failed to load, nor is one this build cannot run: the App could not be re-assembled around it (the previous one was restored), so a restart is what applies it. */
  restartPending: boolean;
}

// ---------------------------------------------------------------------------
// The agent browser, three backends behind one link (see builtin-browser/): the desktop's
// built-in browser — Electron <webview> guests in the persist:penguin-browser partition,
// driven over CDP by the shell on the server's behalf — the user's own Chrome, driven
// through the PenguinHarness Browser extension over a WebSocket the extension opens, and
// `hosted`: a headless Chrome the server launches on its own machine and drives over a pipe.
// ---------------------------------------------------------------------------

/**
 * The browser an agent drives: the desktop's built-in one, the user's own Chrome, or the
 * headless Chrome the server runs on its own machine (`hosted`).
 */
export type BrowserBackend = "builtin" | "chrome" | "hosted";

/**
 * What a backend's link can do. The shell cannot create tabs (the Web App's <webview> does) and
 * throttles and measures its guests; the extension and the hosted Chrome create, close and
 * focus tabs themselves and have no cookie store the server may touch.
 */
export interface BrowserLinkCapabilities {
  /** `open-tab`, `close-tab` and `activate-tab` are answered (chrome, hosted). */
  createsTabs: boolean;
  /** `throttle` and the `metrics` events (builtin). */
  throttles: boolean;
  /** `set-cookies` and `clear-data` (builtin). */
  cookieStore: boolean;
}

/**
 * One tab of the agent browser. Built-in: a guest page, `id` its webContents id. Chrome: a tab
 * the extension drives (one it created in the Penguin tab group, or one the user added), `id`
 * Chrome's tab id; `canGoBack`/`canGoForward` are always false there (the tabs API cannot read
 * them). Hosted: a page of the server's own Chrome, `id` a number the server gives it (it never
 * carries a `favicon`).
 */
export interface BuiltinBrowserTab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  favicon?: string;
  /**
   * Present while the page's renderer is gone, with Electron's reason (`crashed`, `oom`,
   * `killed`, …): the panel shows the crash until the page is reloaded, and an agent action on
   * the tab answers 409 `tab_crashed`.
   */
  crashed?: string;
}

/**
 * Why the agent browser cannot be driven. Built-in: not under the desktop shell, a shell too old
 * to host it, or no app window to host a new tab. Chrome: this user has no paired extension, it
 * is paired but not connected now, or an admin switched Chrome connections off server-wide.
 * Hosted: no Chrome is installed on the server's machine, or the one found did not start (the
 * `detail` beside the reason is Chrome's own error line).
 */
export type BuiltinBrowserUnavailableReason =
  | "not_desktop"
  | "shell_unsupported"
  | "no_window"
  | "extension_not_paired"
  | "extension_disconnected"
  | "extension_disabled"
  | "hosted_no_chrome"
  | "hosted_launch_failed";

/** One backend as GET /status lists it for the caller. */
export interface BrowserBackendInfo {
  backend: BrowserBackend;
  available: boolean;
  reason?: BuiltinBrowserUnavailableReason;
  /** `hosted_launch_failed`: what Chrome printed as it failed. */
  detail?: string;
  /**
   * hosted: the Chrome found on the server's machine — where it is, its version once it has
   * started during this server's life, and whether it is running now (it starts with the first
   * command that needs it). Absent when none is found.
   */
  chrome?: { path: string; version?: string; running: boolean };
  /** chrome: the caller's connected extension, else the one seen most recently; absent when none is paired. */
  extension?: {
    id: string;
    name: string;
    version: string;
    connected: boolean;
    lastSeenAt: string | null;
  };
}

/**
 * GET /api/builtin-browser/status: the caller's effective backend (`backend`) — whether it can
 * be driven now, its tabs — and every backend this server offers the caller (`backends`).
 */
export interface BuiltinBrowserStatus {
  /** Whether the effective backend can be driven now. */
  available: boolean;
  reason?: BuiltinBrowserUnavailableReason;
  /** `hosted_launch_failed`: what Chrome printed as it failed. */
  detail?: string;
  backend: BrowserBackend;
  backends: BrowserBackendInfo[];
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** The shell's latest measurement of the built-in browser's load; absent before its first one, and on the other backends. */
  metrics?: BuiltinBrowserMetrics;
}

/** GET / PUT /api/builtin-browser/backend: the caller's backend and the ones they may choose. */
export interface BrowserBackendResponse {
  backend: BrowserBackend;
  choices: BrowserBackend[];
}

/** One Chrome paired to the caller's account (a row of `browser_extensions`). */
export interface BrowserExtensionRecord {
  id: string;
  /** As the extension names itself, e.g. "Chrome 130 on macOS". */
  name: string;
  version: string;
  createdAt: string;
  lastSeenAt: string | null;
  /** Whether this one holds the caller's connection now (one at a time per user). */
  connected: boolean;
}

/** GET /api/builtin-browser/extension. */
export interface BrowserExtensionsResponse {
  paired: BrowserExtensionRecord[];
  /** The id of the connected one, when one is. */
  connected?: string;
  /** The admin's server-wide switch (`ServerSettings.browserExtensionsEnabled`). */
  enabled: boolean;
}

/**
 * POST /api/builtin-browser/extension/pairings: a one-time code for the signed-in user, valid
 * for ten minutes, used once; the dialog shows it beside the server address.
 */
export interface BrowserExtensionPairingResponse {
  /** 43 base64url characters. */
  code: string;
  /** ISO time the code stops working. */
  expiresAt: string;
  /** The request's Origin, when it carried one: the address the browser reaches this server at. */
  origin: string | null;
}

/** POST /api/builtin-browser/extension/pair (no cookie: the extension's own request). */
export interface BrowserExtensionPairRequest {
  code: string;
  /** How the extension names this Chrome, e.g. "Chrome 130 on macOS" (1–80 characters). */
  name: string;
  /** The extension's own version (manifest.version). */
  version: string;
}

/** What /extension/pair answers: the long-lived token, shown once and stored only hashed here. */
export interface BrowserExtensionPairResponse {
  extensionId: string;
  /** Rides the WebSocket's subprotocol list as `token.<token>`; never a URL. */
  token: string;
  /** This server's install id (a stable name for the data root); null when it is unknown. */
  installId: string | null;
  user: { userId: string; displayName: string | null };
  serverVersion: string;
}

/**
 * The extension WebSocket's close codes (`/api/builtin-browser/extension/ws`). Besides these the
 * server closes with 1012 when it restarts or hot-swaps (reconnect with the usual backoff).
 *
 * - 4001 replaced: another extension of the same user connected (last connected wins); do not
 *   auto-retry.
 * - 4003 revoked: the pairing was revoked (or the token was); forget this server.
 * - 4005 protocol_mismatch: no `penguin-browser.1` subprotocol, or a hello the server does not
 *   speak; the extension needs updating.
 * - 4008 ping_timeout: two pings (or the hello) went unanswered.
 * - 4009 disabled: an admin switched Chrome connections off; retry hourly.
 */
export type BrowserExtensionCloseCode = 4001 | 4003 | 4005 | 4008 | 4009;

/** One tab's share of the built-in browser's load, as the shell last measured it. */
export interface BuiltinBrowserTabMetrics {
  tabId: number;
  /** The memory held by the processes behind the page (its own and its cross-site frames'), KB. */
  memoryKB: number;
  /** Their CPU use since the previous measurement, in percent of one core. */
  cpuPercent: number;
}

/** Why the built-in browser should be lighter. */
export type BuiltinBrowserLoadWarning =
  /** Its pages together hold more memory than they should. */
  | "memory"
  /** This computer is running out of memory. */
  | "low_system_memory"
  /** More tabs are open than the browser should hold. */
  | "many_tabs";

/**
 * The built-in browser's load: GET /status's `metrics`, and the `builtin_browser_metrics` event
 * after each of the shell's measurements (every ~10 s while tabs are open, and soon after one
 * closes). The thresholds are the server's; the UI and the CLI only word what it concluded.
 */
export interface BuiltinBrowserMetrics {
  /** When the server received the measurement (epoch ms). */
  at: number;
  tabs: BuiltinBrowserTabMetrics[];
  /** All the pages' memory, a process two tabs share counted once, KB. */
  totalKB: number;
  /**
   * This computer's memory, KB. Absent on macOS, whose free count leaves out the memory it would
   * readily hand back, so that "free" there reads as nearly none on a healthy machine.
   */
  system?: { freeKB: number; totalKB: number };
  /** What to warn about now; empty when all is well. */
  warnings: BuiltinBrowserLoadWarning[];
  /** While a memory warning stands: the tabs holding the most memory, heaviest first. */
  heavyTabIds: number[];
}

/** GET /api/builtin-browser/tabs. */
export interface BuiltinBrowserTabsResponse {
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
}

/** POST /api/builtin-browser/tabs/:tab/scan — GenericAgent's web_scan. */
export interface BuiltinBrowserScanResult {
  tab: BuiltinBrowserTab;
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** Simplified HTML, or plain text with `textOnly`. */
  content?: string;
  truncated?: boolean;
}

/** POST /api/builtin-browser/tabs/:tab/exec (and click / type) — GenericAgent's web_execute_js. */
export interface BuiltinBrowserExecResult {
  status: "success" | "failed";
  tabId: number;
  /** The script's JSON-safe return value. */
  value?: unknown;
  error?: string;
  /** The page navigated or reloaded while the script ran. */
  reloaded?: boolean;
  /** Tabs opened while the call ran (popups, target=_blank). */
  newTabs?: { id: number; url: string }[];
  /** Text that appeared during the call and may be gone again (toasts, flashes). */
  transients?: string[];
  diff?: { changed: number; topChange?: string };
  suggestion?: string;
  /** click only: where the trusted click landed. */
  clicked?: { x: number; y: number; tag?: string; text?: string };
  /** The page's dialogs the call answered, in order (see BuiltinBrowserDialog). */
  dialogs?: BuiltinBrowserDialog[];
}

/**
 * A dialog the page opened during an exec, click or type, which the call answered so the page
 * would not block: an alert is accepted, and a confirm, prompt or leave-page dialog dismissed
 * unless the request said `acceptDialogs`.
 */
export interface BuiltinBrowserDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  accepted: boolean;
}

/** POST /api/builtin-browser/tabs/:tab/screenshot. */
export interface BuiltinBrowserScreenshot {
  mime: "image/png";
  /** Base64. */
  data: string;
}

export type BuiltinBrowserImportBrowser =
  "chrome" | "edge" | "brave" | "chromium" | "vivaldi" | "opera" | "arc" | "firefox";

/** One profile of a system browser that can be imported from. */
export interface BuiltinBrowserImportSource {
  /** `<browser>:<profile dir>`, e.g. `chrome:Default`. */
  id: string;
  browser: BuiltinBrowserImportBrowser;
  browserName: string;
  /** The profile's directory name. */
  profile: string;
  /** The profile's display name. */
  profileName: string;
  hasCookies: boolean;
  hasHistory: boolean;
}

export interface BuiltinBrowserImportSourcesResponse {
  sources: BuiltinBrowserImportSource[];
}

/** POST /api/builtin-browser/import. */
export interface BuiltinBrowserImportRequest {
  sourceId: string;
  cookies?: boolean;
  history?: boolean;
  /** Only cookies of these sites (a domain matches itself and its subdomains). */
  domains?: string[];
}

export interface BuiltinBrowserImportResult {
  sourceId: string;
  cookies?: { found: number; imported: number; skipped: number; failed: number };
  history?: { found: number; imported: number };
  warnings: string[];
}

export interface BuiltinBrowserHistoryEntry {
  url: string;
  title: string;
  visitCount: number;
  /** Epoch ms. */
  lastVisitAt: number;
  /** `builtin` for pages visited in the built-in browser, else the browser it was imported from. */
  source: string;
}

export interface BuiltinBrowserHistoryResponse {
  entries: BuiltinBrowserHistoryEntry[];
}

/**
 * GET / PUT /api/builtin-browser/settings: the browser's own settings, a file of the server's
 * that is read and written without the desktop shell. PUT takes the fields to change (at least
 * one); a field left out is kept as it is.
 */
export interface BuiltinBrowserSettings {
  /**
   * The page a new tab opens when it is given no address — the panel's "+", an agent's new tab
   * — and the toolbar's Home button goes to: an http(s) address, or null for none (a new tab is
   * then blank). PUT takes a bare host too and answers the address as stored.
   */
  homepage: string | null;
  /**
   * The Chrome the hosted backend launches: an absolute path on the server's machine, or null to
   * look for one (the known names on PATH, then the standard install locations). An answer
   * leaves it out when none is set.
   */
  chromePath?: string | null;
}

/**
 * One frame of a hosted tab's picture: a `frame` event of GET /api/builtin-browser/tabs/:id/view
 * (an event stream). `data` is a base64 JPEG, `width` and `height` its size in pixels — the
 * space the pointer coordinates of {@link HostedBrowserInputEvent} are given in.
 */
export interface HostedBrowserFrame {
  data: string;
  width: number;
  height: number;
}

/** The size a hosted tab's page is laid out to, in CSS pixels: the viewer's panel. */
export interface HostedBrowserViewport {
  width: number;
  height: number;
}

/**
 * One input event for a hosted tab, as the viewer's panel captured it. `x` and `y` are in the
 * pixels of the frame on screen (the server scales them to the page's CSS pixels); `modifiers`
 * is CDP's bit field (Alt 1, Ctrl 2, Meta 4, Shift 8).
 */
export type HostedBrowserInputEvent =
  | {
      type: "mouse";
      action: "move" | "down" | "up";
      x: number;
      y: number;
      /** The button that changed; `none` (a move's default) for none. A press defaults to `left`. */
      button?: "none" | "left" | "middle" | "right";
      /** The buttons held, as MouseEvent.buttons. */
      buttons?: number;
      /** 1 for a click, 2 for the second press of a double click; 0 for a move. */
      clickCount?: number;
      modifiers?: number;
    }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number; modifiers?: number }
  | {
      type: "key";
      action: "down" | "up";
      /** KeyboardEvent.key and .code. */
      key: string;
      code: string;
      /** KeyboardEvent.keyCode (the Windows virtual key code). */
      keyCode?: number;
      /** The character the press types, when it types one ("\r" for Enter); absent for a key that types nothing. */
      text?: string;
      repeat?: boolean;
      modifiers?: number;
    }
  /** Text inserted at the caret as if typed or pasted (an IME's committed text, a paste). */
  | { type: "text"; text: string }
  /** The toolbar: back and forward through the tab's history, reload, stop loading. */
  | { type: "nav"; action: "back" | "forward" | "reload" | "stop" };

/**
 * POST /api/builtin-browser/tabs/:id/input: a batch of input events, applied in order (at most
 * 200), and optionally the viewer's panel size, applied first. Answers 204.
 */
export interface HostedBrowserInputRequest {
  events?: HostedBrowserInputEvent[];
  viewport?: HostedBrowserViewport;
}

export type BuiltinBrowserAction =
  "navigate" | "scan" | "exec" | "click" | "type" | "screenshot" | "cdp";

/**
 * User-channel events of the agent browser. The built-in and the hosted backend's go to every
 * admin; a chrome backend's go to the user whose Chrome it is, as do `builtin_browser_backend`
 * and `builtin_browser_extension`.
 */
export type BuiltinBrowserServerEvent =
  /**
   * A backend's whole tab list. `backend` names whose: a desktop admin hears both the built-in
   * browser's and their own Chrome's, and the two lists must not overwrite each other.
   */
  | {
      type: "builtin_browser_tabs";
      tabs: BuiltinBrowserTab[];
      activeTabId: number | null;
      backend: BrowserBackend;
    }
  /** Create a guest for `url`, then POST /tabs/claim with `requestId` once it has a webContents id. */
  | {
      type: "builtin_browser_open";
      requestId: string;
      url: string;
      activate: boolean;
      openerTabId?: number;
      sessionId?: string;
    }
  | { type: "builtin_browser_close"; tabId: number }
  | {
      type: "builtin_browser_activity";
      tabId: number;
      busy: boolean;
      action: BuiltinBrowserAction;
      sessionId?: string;
    }
  /** The shell measured the browser's load (see BuiltinBrowserMetrics). */
  | { type: "builtin_browser_metrics"; metrics: BuiltinBrowserMetrics }
  /** The user switched backend (PUT /backend); every window of theirs follows. */
  | { type: "builtin_browser_backend"; backend: BrowserBackend }
  /** The user's Chrome connected, went away, was replaced by another Chrome of theirs, or was revoked. */
  | {
      type: "builtin_browser_extension";
      state: "connected" | "disconnected" | "replaced" | "revoked";
      extension?: BrowserExtensionRecord;
    };

/** A cookie as the shell writes it (Electron's CookiesSetDetails). */
export interface DesktopBrowserCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix seconds; absent = session cookie. */
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * Server → browser link: what the shell (built-in) or the extension (chrome) does with its tabs.
 * Mechanism only — the product logic stays on the server. The names are historical: the same
 * envelopes travel the extension's WebSocket as JSON text frames, and the hosted link answers
 * the same commands itself, by CDP on the Chrome it launched.
 */
export type DesktopBrowserCommand =
  /** Reply: a BrowserHello. An older shell never answers. */
  | { op: "hello" }
  /** Reply: `{ tabs: BuiltinBrowserTab[] }`. */
  | { op: "tabs" }
  /**
   * Reply: the CDP method's result object. `events` names the tab's CDP events the shell relays
   * from then on, as `cdp-event`s: it replaces the list before (empty relays none), and is set
   * before the command runs, so an event the command itself causes is not missed. Without it
   * the list stays as it is.
   */
  | {
      op: "cdp";
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      events?: string[];
    }
  /** Reply: `{ set: number; failed: number; errors: string[] }` (at most 10 errors). */
  | { op: "set-cookies"; cookies: DesktopBrowserCookie[] }
  /** Reply: `{}`. */
  | { op: "clear-data"; storages: ("cookies" | "cache" | "storage")[] }
  /**
   * Reply: `{}`. The tabs whose pages may be throttled while out of sight (Electron's background
   * throttling, applied at once); every other tab runs at full speed. It replaces the list
   * before. A tab is unthrottled until a command lists it, so a server that never sends one
   * changes nothing. A shell older than this command answers `unknown_op`.
   */
  | { op: "throttle"; tabIds: number[] }
  /**
   * Chrome and hosted (the shell answers `unknown_op`). Reply: `{ tab: BuiltinBrowserTab }`. A tab at
   * `url` (http(s) or about:blank, checked by the server) in the extension's Penguin tab group;
   * `activate` asks for it to be the selected tab of its window.
   */
  | { op: "open-tab"; url: string; activate: boolean }
  /** Chrome and hosted. Reply: `{}`. Closes a tab the extension drives. */
  | { op: "close-tab"; tabId: number }
  /** Chrome and hosted. Reply: `{}`. Shows the tab in the user's Chrome (selects it, focuses its window). */
  | { op: "activate-tab"; tabId: number }
  /** Chrome only. Reply: `{}`. Sent every 20 s; the traffic keeps the MV3 service worker alive. */
  | { op: "ping" };

/**
 * The `hello` reply. Built-in: `{ version: 1, partition }` (an older shell sends no `backend`).
 * Chrome: `{ version: 1, backend: "chrome", extension }`; any other version is closed 4005.
 * Hosted: `{ version: 1, backend: "hosted", chrome }`, the launched Chrome's version.
 */
export interface BrowserHello {
  version: 1;
  backend?: BrowserBackend;
  partition?: string;
  extension?: { version: string; chrome: string; name: string };
  chrome?: string;
}

export interface DesktopBrowserCommandMessage {
  type: "desktop-browser-command";
  id: string;
  command: DesktopBrowserCommand;
}

export interface DesktopBrowserReplyMessage {
  type: "desktop-browser-reply";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type DesktopBrowserEvent =
  | { kind: "tab"; tab: BuiltinBrowserTab }
  | { kind: "tab-closed"; tabId: number }
  /**
   * window.open / target=_blank inside a guest (the shell denied it and asks for a tab instead),
   * or the context menu's "Open link in new tab". `background`: the tab should open behind the
   * current one, as a middle-click or that menu entry does in Chrome.
   */
  | { kind: "open-request"; url: string; openerTabId: number; background?: boolean }
  /** One of the tab's CDP events a `cdp` command's `events` asked for. */
  | { kind: "cdp-event"; tabId: number; method: string; params: Record<string, unknown> }
  /**
   * The tab's renderer went away (Electron's render-process-gone reason and exit code). The tab
   * stays; its `tab` events carry `crashed` until the page is reloaded, and the shell refuses
   * CDP commands for it meanwhile (`tab_crashed`).
   */
  | { kind: "tab-crashed"; tabId: number; reason: string; exitCode: number }
  /**
   * The shell's measurement of its guests (every ~10 s while there are any, and once more
   * shortly after one closes, empty after the last): each tab's memory and CPU, and the pages'
   * memory together, a process shared by two tabs counted once.
   */
  | { kind: "metrics"; tabs: BuiltinBrowserTabMetrics[]; totalKB: number }
  /**
   * Chrome only: the tab still exists in Chrome but the agent may no longer drive it — the user
   * pressed Cancel on Chrome's debugging bar (`user`), the debugger went away otherwise
   * (`detached`), or the page is one Chrome lets no extension attach to (`restricted`). The
   * extension fails that tab's pending commands with the error `tab_released`.
   */
  | { kind: "tab-released"; tabId: number; reason: "user" | "detached" | "restricted" };

export interface DesktopBrowserEventMessage {
  type: "desktop-browser-event";
  event: DesktopBrowserEvent;
}

// The rule an install picks an index entry by, shared with the Plugins page (see plugin-pick.ts).
export { compareVersions, pickIndexEntry, satisfies } from "./plugin-pick.js";
