/**
 * Web API DTO contract — request/response types shared between server routes and the
 * frontend SPA (single source of truth).
 *
 * These field definitions are authoritative for the Web API contract. Conventions:
 *   - DTO fields use camelCase; an AMSP record keeps its own shape as-is (snake_case envelope),
 *     no conversion;
 *   - This file holds only types, no implementation; exposed to the frontend via package
 *     exports `"./api"` for type-only import;
 *   - Types are taken only from `@prismshadow/amsp` and core's pure `interfaces` subpath, so the
 *     frontend can safely reference them.
 *
 * Docs: packages/docs/content/server-api.{zh,en}.md (site path /docs/server-api) is the
 * public route/SSE reference for this contract — keep it in sync when changing DTOs.
 */
import type {
  ChatDefaultsDto,
  MemberInfo,
  ProjectSummary,
  ScheduleServerEvent,
  ServerEvent,
  CommandPolicyDto,
  GoalServerEvent,
  ProjectRole,
  CompanyServerEvent,
  SessionTracesResponse,
  MachineServerEvent,
} from "@prismshadow/penguin-library-project";
import type { CompactionMode, AmspRecord, SessionSource, ToolCallPayload } from "@prismshadow/amsp";
import type {
  ElidedBody,
  MCPServerConfig,
  ThinkingLevelName,
  ToolDefinitionConfig,
} from "@prismshadow/penguin-core/interfaces";
// Build/harness identity is not an interface contract — it ships from the barrel (core's version-info.ts).
import type { HarnessInfo, VersionReport, HarnessHistory } from "@prismshadow/penguin-core";
import type { IfacesDiff } from "@prismshadow/penguin-hmr";
import type { AppCenterShortcut, WorkbenchInfo } from "@prismshadow/penguin-library-workbench";
// Vocabulary this file's own DTOs reference and the setting domain library owns (re-exported below).
import type { StoredKeybindings } from "@prismshadow/penguin-library-setting/types";
// The vocabulary whose ownership moved to the domain libraries (the contracts name it):
// the server's own API DTOs reference these, and the Web App reads them through this
// module's exports, so each is imported and re-exported — the server→library direction
// is the allowed one (restack3 rule 4).
import type {
  AgentApiKeyInfo,
  AgentApiSettings,
  AgentApiUpdateRequest,
  ModelRefDto,
} from "@prismshadow/penguin-library-agent-api";
import type {
  DefaultModelOffer,
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelBalanceAmount,
  ModelBalanceErrorCode,
  ModelInfo,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  ModelProtocolProbeDto,
  ModelPricingDto,
  ModelTestRequest,
  ModelTestResponse,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  ModelVisionOutcome,
  ModelsResponse,
  ModelsUpdateRequest,
  PresetSyncMode,
  PresetSyncResponse,
  ProtocolProbeOutcome,
  ProviderConnectionDto,
  ProviderConnectionResponse,
  ProviderConnectionUpdate,
  ModelEffectiveConnection,
  CredentialInfo,
} from "@prismshadow/penguin-library-model";
import type {
  ContextToolShare,
  AgentTraceFileRef,
  AgentTraceSessionGroup,
  AgentTraceDateGroup,
  AgentTraceSessionFile,
  AgentTraceSessionEntry,
  AgentTracesResponse,
  ContextFileShare,
  CostParts,
  HistoryFileFact,
  HistoryFileKey,
  HistoryHeldRange,
  HistoryHave,
  HistoryLinesEvent,
  HistoryLinesFrame,
  HistoryLinesWindow,
  HistoryMessage,
  HistoryPage,
  HistoryPartFrame,
  HistoryProgress,
  HistoryRecords,
  HistorySegment,
  HistoryStreamError,
  HistoryStreamEvent,
  HistoryStub,
  HistoryWindowPart,
  MessagesLiveTail,
  MessagesPageInfo,
  MessagesResponse,
  RequestSpan,
  SessionCategory,
  SessionCategoryCounts,
  SessionContextParts,
  ToolCallSpan,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceImportResponse,
  TraceModelSegment,
  TraceOtherSpan,
  TracePosition,
  TraceTaskStats,
  TraceToolSpan,
  UsageTrendPointInTrace,
} from "@prismshadow/penguin-library-trace";
import type {
  UsageAgentSeries,
  UsageBucket,
  UsageErrors,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupRow,
  UsageModelSeries,
  UsageModelTotals,
  UsageModelTotal,
  UsageResponse,
  UsageSeriesPoint,
  UsageToolRow,
  UsageEntitySeriesCounts,
  UsageErrorCount,
  ErrorContext,
  UsageErrorItem,
  UsageGroupBy,
} from "@prismshadow/penguin-library-observability";
import type {
  SessionStatus,
  PendingSteeringInfo,
  PendingFollowUpInfo,
  SubagentRuntimeInfo,
  SessionSandbox,
  SessionSandboxMode,
  SessionSandboxNetwork,
  SessionSandboxPreset,
  UnavailableSandboxBackend,
  ApprovalReason,
  ApprovalMode,
  SessionBackgroundTasks,
} from "@prismshadow/penguin-library-session";
import type { MessagingChannel } from "@prismshadow/penguin-library-messaging/vocabulary";
import type {
  Employment,
  UnreadableChart,
  OrgCalendarOutcome,
  OrgChannelMessage,
  OrgChannelNotice,
  OrgChannelNoticeKind,
  OrgTicketChange,
  OrgTriggerKind,
} from "@prismshadow/penguin-library-organization/types";
import type { AgentDeletionInfo } from "@prismshadow/penguin-library-agent/types";
import type {
  AgentAuthor,
  AgentMcpServerItem,
  HookItem,
  PluginConfigEntry,
  PluginModuleStatus,
  SkillMetadataItem,
  UnsatisfiedPlugin,
} from "@prismshadow/penguin-library-plugin/types";

// Company mode and the Agent deletions: the DTOs moved to their domain packages, re-exported
// so every import path here keeps resolving (services+routes restack S20).
/**
 * The plugin domain's DTO contract moved to the plugin library package; these are the
 * same names, re-exported from there (the server→library direction is the allowed one).
 */
export type {
  AgentMcpServerItem,
  McpTransport,
  HookItem,
  IconRef,
  MarketPopularity,
  PluginArt,
  MarketImage,
  MarketShot,
  PluginCliCommandOutputFile,
  PluginCliCommandRunRequest,
  PluginCliCommandInputFile,
  PluginCliCommandRunResponse,
  PluginCliCommandsResponse,
  PluginCliCommandInfo,
  PluginConfigBackend,
  PluginIndexEntry,
  PluginIndexChannel,
  PluginConfigEntry,
  PluginConfiguration,
  PluginConfigField,
  PluginConfigOption,
  PluginConfigTableColumn,
  PluginConfigTableRow,
  PluginConfigRowChoice,
  PluginConfigNewRow,
  PluginConfigColumnGroup,
  PluginConfigPinColumn,
  PluginConfigNotice,
  PluginConfigActionDecl,
  PluginConfigUnavailableDecl,
  PluginStatusReport,
  PluginStatusSummary,
  PluginStatusVersion,
  PluginStatusCheck,
  PluginHolder,
  PluginHoldersResponse,
  PluginItem,
  SkillMetadataItem,
  QuickStartItem,
  TaskCreateRequest,
  TaskInputPart,
  AgentCreateRequest,
  AgentAuthor,
  PluginMcpServerItem,
  PluginSetupKeyItem,
  PluginMarketResponse,
  PluginModuleAction,
  PluginModuleRequest,
  PluginModuleState,
  PluginModuleRequestsResponse,
  PluginModuleStatus,
  PluginModuleRequestView,
  PluginServerUninstallResponse,
  PluginUninstallResponse,
  UnsatisfiedPlugin,
  PluginLibraryResponse,
  PluginGroupItem,
  PluginFilesResponse,
  PluginInstallRequest,
  AgentPluginsInstallResponse,
  PluginModuleAskRequest,
  PluginModuleAskResponse,
  PluginModuleDecideRequest,
  PluginIndexResponse,
  PluginReadmeResponse,
  PluginConfigActionResponse
} from "@prismshadow/penguin-library-plugin/types";

export type {
  OrgApprovalMode,
  OrgBudgetAlert,
  OrgCalendarItem,
  OrgCalendarResponse,
  OrgCalendarUpsertRequest,
  OrgCalendarWriteResponse,
  OrgChannelCreateRequest,
  OrgChannelDetail,
  OrgChannelItem,
  OrgChannelMember,
  OrgChannelMemberRequest,
  OrgChannelMessageSendRequest,
  OrgChannelMessagesResponse,
  OrgChannelPatchRequest,
  OrgChannelReadRequest,
  OrgChannelsResponse,
  OrgChartResponse,
  OrgDeskItem,
  OrgDeskResponse,
  OrgEmployeeItem,
  OrgEmployeePatchRequest,
  OrgEmployeeState,
  OrgFinanceEmployee,
  OrgFinanceResponse,
  OrgFinanceTicket,
  OrgHandbookFile,
  OrgHandbookFileResponse,
  OrgHandbookFileWriteRequest,
  OrgHandbookFilesResponse,
  OrgHandbookResponse,
  OrgHireRequest,
  OrgInbox,
  OrgLanguage,
  OrgSessionsResponse,
  OrgSpendSummary,
  OrgStatus,
  OrgTicketAttachRequest,
  OrgTicketBlockRequest,
  OrgTicketCreateRequest,
  OrgTicketDetail,
  OrgTicketHistoryAction,
  OrgTicketHistoryEntry,
  OrgTicketItem,
  OrgTicketMoveRequest,
  OrgTicketPriority,
  OrgTicketProgressRequest,
  OrgTicketSessionItem,
  OrgTicketStartRequest,
  OrgTicketStartResponse,
  OrgTicketStatus,
  OrgTicketUpdateRequest,
  OrgTicketsResponse,
  OrganizationCreateRequest,
  OrganizationDeleteResponse,
  OrganizationDetail,
  OrganizationPatchRequest,
  OrganizationSettings,
  OrganizationSummary,
  OrganizationsResponse,
  SemanticIdKind,
  SemanticIdSuggestReason,
  SemanticIdSuggestRequest,
  SemanticIdSuggestResponse,
  Employment,
  UnreadableChart,
} from "@prismshadow/penguin-library-organization/types";
export { TICKET_SLUG_PATTERN } from "@prismshadow/penguin-library-organization/types";
export type { AgentDeletionInfo, AgentDeleteResponse, AgentDeletionResponse } from "@prismshadow/penguin-library-agent/types";
import type { UserInfo } from "@prismshadow/penguin-library-auth";
import type {
  BrowserBackend,
  BrowserExtensionRecord,
  BrowserHello,
  BuiltinBrowserAction,
  BuiltinBrowserLoadWarning,
  BuiltinBrowserMetrics,
  BuiltinBrowserServerEvent,
  BuiltinBrowserTab,
  BuiltinBrowserTabMetrics,
  ChromeExtensionCookie,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserCookie,
  DesktopBrowserReplyMessage,
} from "@prismshadow/penguin-library-machine";

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

/**
 * Unified error response body and its detail record — the shape lives in the http
 * vocabulary package (services+http+cli restack T0); re-exported here so the API
 * contract keeps spelling it.
 */
export type { ErrorBody, ErrorDetails } from "@prismshadow/penguin-library-http/errors";
import type { ErrorDetails } from "@prismshadow/penguin-library-http/errors";

/** Session approval mode (reuses the CLI enum). */

/**
 * What kind of conversation a Session is (`user` / `api` / `schedule` / `subagent` / `cli` / `company` / `workbench`):
 * core's type, the one definition, re-exported for the DTOs below.
 */
export type { SessionSource };

// ---------------------------------------------------------------------------
// Authentication and users
// ---------------------------------------------------------------------------

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
   * desktop-only routes. "remote" is the one-hour session Penguin Remote exchanged the local
   * API token for; it counts as the person's sign-in. "token" marks the local API token itself,
   * sent as a Bearer header; it cannot perform writes requiring a person's sign-in.
   */
  sessionVia: "password" | "desktop" | "setup" | "remote" | "token";
  /**
   * The upload limits currently in force, so the composer can refuse an oversize pick before
   * reading it and can name the real number in the message. They are admin-settable and ride
   * `/api/me` rather than `/api/admin/settings` because every user's composer needs them, not
   * just an admin's.
   */
  uploadLimits: UploadLimits;
  /**
   * Whether company mode is enabled server-wide (the admin switch in server settings, default
   * on). Off hides the mode switch in every client and 404s every organization route; the
   * user's own preference (`UiPrefs.companyMode`) only hides the switch for that user.
   */
  companyMode: boolean;
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
  terminalMaxOpen: number;
  browserMaxOpen: number;
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
   * Whether external programs may talk to Agents through the Agent API (default on). Off answers
   * every `/api/amsp/v1` request 403 `agent_api_disabled` (a CORS preflight excepted); every
   * Agent's API switch, approval mode and keys are kept, so turning it on again restores them.
   */
  agentApiEnabled: boolean;
}

export interface ServerSettingsResponse {
  settings: ServerSettings;
}

/** PUT body: every field optional, omitted fields keep their current value (mirrors prefs). */
export interface ServerSettingsUpdateRequest {
  terminalMaxOpen?: number;
  browserMaxOpen?: number;
  proxyForApp?: boolean;
  proxyForAgent?: boolean;
  /** Company mode master switch; see `ServerSettings.companyMode`. */
  companyMode?: boolean;
  /** Chrome extension switch; see `ServerSettings.browserExtensionsEnabled`. */
  browserExtensionsEnabled?: boolean;
  /** Agent API switch; see `ServerSettings.agentApiEnabled`. */
  agentApiEnabled?: boolean;
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
   * Notices the user closed, by notice id (a machine's model keys only this server's environment
   * holds: `machine-env-only:<machine id>`), each the SIGNATURE of what it named when closed — its
   * items sorted, one per line — so it comes back when a new item appears (web's
   * `lib/notice-dismissals.ts`). Replaced whole on every write, like `todoDismissed`.
   */
  noticesDismissed?: Record<string, string>;
  /**
   * The draft screen's user-defined shortcuts, in display order. Replaced whole on every write
   * (the merge is shallow, so the array is one field like any other) and bounded on write by
   * services/draft-shortcuts.ts — count, title length and prompt length — because this is the one
   * known key holding user-authored text rather than a flag or an id.
   */
  draftShortcuts?: DraftShortcut[];
  /** Keyboard shortcut overrides, replaced whole on every write and validated by the keybindings validator (the setting domain library). */
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
  // ----- The Settings pages' preferences, which follow the account to every browser. Each is
  // the value the Web App keeps in that browser's cache (see its lib/account-sync), validated on
  // write by services/account-settings.ts for shape only: the Web App decides what a value
  // means and reads anything it does not know as its default. `null` reads as unset.
  /** Light / dark / follow the system. */
  themeMode?: string | null;
  /** Which theme renders the app (a theme id). */
  themeId?: string | null;
  /** The accent preset, or "neutral" for the theme's own. */
  accent?: string | null;
  /** The root text size step. */
  textSize?: string | null;
  /** The Latin face paired over the theme's own ("theme" = keep the theme's). */
  fontLatin?: string | null;
  /** The CJK face paired over the theme's own ("theme" = keep the theme's). */
  fontCjk?: string | null;
  /** Interface language: zh / en / system. */
  lang?: string | null;
  /** Display currency for prices. */
  currency?: string | null;
  /** The terminal's appearance: light / dark / follow the app. */
  terminalTheme?: string | null;
  /** Whether tool cards name the built-in tools by their short alias. */
  toolAliases?: boolean | null;
  /** How the conversation shows thinking and tool steps (the Web App's "standard", "expanded", "compact"). */
  activityDisplayMode?: string | null;
  /** Whether task-completion notifications were asked for (each browser still needs its own OS permission). */
  notifications?: boolean | null;
  /** Whether the floating dock launcher was put away. */
  launcherHidden?: boolean | null;
  /** Mid-run send mode: steer or queue as a follow-up. */
  steerMode?: string | null;
  /** The custom background's display settings; the image itself is GET|PUT /api/me/background-image. */
  background?: BackgroundSettingsDto | null;
  /**
   * Which background image the account holds, as an opaque id that changes whenever the image
   * does; absent or null when it holds none. Written only by PUT /api/me/background-image (PUT
   * /api/me/prefs refuses it): a browser compares it with the image it has cached and fetches the
   * image only when they differ.
   */
  backgroundImageId?: string | null;
  /**
   * The account's own arrangement of each Project's App Center, by Project id. Replaced only by
   * PUT /api/projects/:projectId/app-center/layout (PUT /api/me/prefs refuses it), which checks
   * the arrangement and lets go of those of Projects that no longer exist.
   */
  appCenterLayouts?: Record<string, AppCenterLayout>;
  [key: string]: unknown;
}

/** The custom background's display settings, as the Web App stores them. */
export interface BackgroundSettingsDto {
  /** 0–100: how much of the page colour shows through the image. */
  transparency: number;
  mode: string;
  position: string;
}

/**
 * The background image cap, in characters of the data URL: the same number the Web App encodes
 * against, so the browser and the server cannot disagree about what "too large" means.
 */
export const BACKGROUND_IMAGE_MAX_CHARS = 1024 * 1024;

/**
 * The avatar cap — a user's own and an employee's — in characters of the data URL as it arrives
 * (131072 characters of base64 hold roughly 96 KiB of image): the same number the Web App
 * re-encodes against, so the browser and the server cannot disagree about what "too large"
 * means.
 */

/** GET /api/me/background-image. */
export interface BackgroundImageResponse {
  /** A PNG / JPEG / WebP data URL, or null when the account holds no image. */
  image: string | null;
  imageId: string | null;
}

/** PUT /api/me/background-image: the image to keep, or null to remove it. */
export interface BackgroundImageRequest {
  image: string | null;
}

/** PUT /api/me/background-image's answer: the id the image is now known by (null once removed). */
export interface BackgroundImagePutResponse {
  imageId: string | null;
}

/**
 * The kinds of draft the account keeps, as the first segment of a draft key
 * (`<kind>:<id>`). The id names what the draft belongs to, so the server can drop it with that
 * thing: `chat` — a Project's new-conversation draft (`chat:<projectId>`); `parked` — a
 * Project's parked draft conversations (`parked:<projectId>`); `org` — a Project's
 * create-organization form (`org:<projectId>`); `channel` — a company-mode channel's composer
 * (`channel:<projectId>.<orgId>.<channelId>`); `session` — a Session's composer
 * (`session:<sessionId>`); `a2ui` — a reply's form answers in progress
 * (`a2ui:<sessionId>:<block>`).
 */
export const DRAFT_KINDS = ["chat", "parked", "org", "channel", "session", "a2ui"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** One draft's cap, in characters of its JSON text. */
export const DRAFT_VALUE_MAX_CHARS = 256 * 1024;

/** Draft writes one PATCH may carry. */
export const DRAFTS_PATCH_MAX_ENTRIES = 50;

/** GET /api/me/drafts: every draft the account keeps, by key, as the JSON each was written with. */
export interface DraftsResponse {
  drafts: Record<string, unknown>;
}

/**
 * PATCH /api/me/drafts: drafts to write, by key; `null` removes one. Applied together. When the
 * account then holds more than its bound, its least recently written drafts outside this patch
 * are dropped.
 */
export interface DraftsPatchRequest {
  drafts: Record<string, unknown>;
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

/**
 * One group's `[providers.<id>]` connection as the page reads it: the values the GROUP stores
 * (never the catalog's), the key masked. An absent field is unset: a row with no value of its
 * own then gets the client's default.
 */

/** Where an effective connection value comes from: the row itself, its group, or nowhere (the client's default). */
export type ConnectionSourceDto = "model" | "provider" | "none";

/**
 * What a row is actually used with, after core's effectiveConnection (row -> group -> none,
 * per field; the file's values only — the catalog is not consulted), and where each value
 * came from. The group's key counts only where it reaches the row (core's groupKeyReaches).
 * The row's own values stay in `clientType` / `credential` (what the form edits); this is for
 * display.
 */

/**
 * A change to one group's connection (`PUT /models/providers/:provider`, or a member of
 * `ModelsUpdateRequest.providers`). Omitted fields are kept.
 */

/**
 * A group just became connected (its first group key landed) and the catalog names a model of
 * that group as its connect default (TokenDance's and Penguin Go's DeepSeek V4.1 Flash), while
 * the Project's default sits outside the group or is unset. Reported by the write that stored the
 * key, which leaves the default as it is: the page asks whether to make `model` the default.
 */

/** `PUT /models/providers/:provider`: the table as it now stands, and the default offered, if any. */

/**
 * `POST /models/sync-presets` (owner): `add` adds the catalog's presets the Project lacks
 * (retired rows never), as a new Project stores them, writes the catalog's
 * `[providers.<id>]` table for a group that has neither rows nor a table yet, and seeds the
 * added rows' promotions, touching nothing else; `restore` makes the model configuration a new
 * Project's and keeps only the API keys: the presets in catalog order, the catalog's group
 * tables, default model and promotions, no vision model, and every other row and every
 * user-defined group deleted. Penguin Go included: its platform's next sync brings back the
 * platform's own models and promotions.
 */

export interface PresetSyncRequest {
  mode: PresetSyncMode;
}

/**
 * Connectivity test (POST /api/projects/:p/models/test): the model reference is submitted as
 * a pair in the request body; the rest are optional overrides (for trying out an unsaved
 * config). When the model isn't in the config yet (adding a custom model — test-before-save),
 * all parameters come from this request body.
 */

/**
 * Vision capability probe: sends one 1x1 image and a one-word prompt on this model's
 * credential, to decide whether the models dialog's "supports vision" switch should be
 * turned on. The body mirrors the connectivity test (same paired reference and same
 * not-yet-saved overrides), so an unsaved model can be probed before it exists on disk.
 *
 * Unlike protocol detection this is a real, billed completion — an image request cannot be
 * shaped to cost nothing — so it only ever runs when the user presses the control.
 */

/**
 * Vision probe verdict. `supported` = the model took the image and answered; `unsupported`
 * = it answered specifically that it will not take an image (a definitive negative, not an
 * error); `failed` = the probe never got a usable answer (auth, network, an unrelated
 * error), so nothing about the capability was learned and the setting is left alone.
 */

/** Vision probe result; `message` carries the truncated provider error for the failed case. */

/**
 * Connectivity test result: carries round-trip latency when ok, and a reason on failure
 * (truncated raw provider error). When streamed content was observed, also carries the
 * time-to-first-token and, when usage was reported (completed streams), the output rate.
 */

/**
 * Protocol auto-detection (POST /api/projects/:p/models/detect, owner): probes which of
 * MMSP's generic protocol clients a custom base URL serves — `openai-responses` first,
 * then `ant-messages`, then `openai-chat` — and reports the first hit. Used by the custom
 * model dialog to fill `clientType` from the endpoint itself; costs no tokens (each probe
 * is a minimal invalid request whose error reveals the protocol shape).
 */

/**
 * One probe's outcome: `served` = the route answered in an API shape (including auth
 * failures — 401/403 with a protocol-shaped body proves the route exists);
 * `route_missing` = 404/405; `server_error` = 5xx (proves nothing about the path);
 * `junk` = HTML / non-JSON / JSON matching no API shape; `timeout` / `network_error` =
 * the request itself failed.
 */

/** One probe, for debugging display: the probed URL derives from baseUrl only (never contains the key). */

/**
 * Detection result: probes run sequentially over the candidate base URLs derived from the
 * one that was typed and stop at the first served protocol, so `probes` lists only the
 * ones actually run, in order.
 */

/**
 * Endpoint model listing (POST /api/projects/:p/models/list, owner): given a base URL and
 * the protocol `/detect` reported, returns every model id the endpoint serves (MMSP's
 * `listModels()` on the routed client). Used by the add-group dialog to fill the list the
 * user picks the models to import from; the ids come back in the endpoint's own order.
 */

/** Listing outcome: model ids on success, a truncated provider/SDK reason otherwise. */

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

/**
 * Why a group's balance could not be read:
 * - `unsupported`: the group publishes no balance endpoint (no `balance` descriptor in the catalog);
 * - `no_key`: the group has no API key to ask with — none stored, and no vendor variable that
 *   MMSP's vendor client reads for the group's base URL;
 * - `upstream_failed`: the vendor could not be reached in time, refused the request, or answered
 *   without a readable balance.
 */

/**
 * GET /api/projects/:p/models/balance?provider=<group>[&force=1] (Project member): the account
 * balance behind the group's API key — the stored one, or else the environment key MMSP's
 * vendor client reads for the group's base URL (DeepSeek's DEEPSEEK_API_KEY) — read server-side
 * from the endpoint the catalog's `balance` descriptor names. The key never reaches the browser, and
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
 * back by hand, for the case where that redirect cannot reach the harness — or where the
 * provider would refuse it: only an HTTPS or loopback HTTP origin can be redirected to.
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
  /** Defaults to `callback`; the response says which mode the flow was opened in. */
  mode?: ModelOAuthMode;
}

/** The opaque flow handle plus the page to send the user to. No secret of the flow's is included. */
export interface ModelOAuthStartResponse {
  flowId: string;
  authorizeUrl: string;
  /**
   * The mode the flow was opened in: `manual` for a `callback` request when the origin the
   * request reached this server on is neither HTTPS nor loopback HTTP, which the provider's
   * authorization page refuses as a callback.
   */
  mode: ModelOAuthMode;
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
  /** The default model offered on the minted key (see DefaultModelOffer); on every `done` answer. */
  defaultOffer?: DefaultModelOffer;
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
  /** The default model offered on the minted key (see DefaultModelOffer). */
  defaultOffer?: DefaultModelOffer;
  error?: ModelOAuthErrorCode;
}

// ---------------------------------------------------------------------------
// Penguin Go key authorization (/api/projects/:p/platform-auth, owner)
// ---------------------------------------------------------------------------
//
// The flow wire shapes moved to the model domain package
// (@prismshadow/penguin-library-model/platform-auth-flow, services+http+cli restack S1),
// ModelScope's aliases with them; re-exported here so the API contract keeps spelling them.
export type {
  PlatformAuthStartResponse,
  PlatformAuthFlowErrorCode,
  PlatformAuthFlowStatusResponse,
  ModelScopeAuthStartResponse,
  ModelScopeAuthFlowErrorCode,
  ModelScopeAuthFlowStatusResponse,
} from "@prismshadow/penguin-library-model/platform-auth-flow";
import type { PlatformAuthFlowStatusResponse } from "@prismshadow/penguin-library-model/platform-auth-flow";

/** Result of refreshing Penguin Go's catalog with the Project's stored platform key. */
export interface PlatformModelSyncResponse extends ModelsResponse {
  added: number;
  updated: number;
}

/**
 * ModelScope key authorization (/api/projects/:p/modelscope-auth, owner): its wire shapes are
 * Penguin Go's, deliberately — both flows create a request, poll it, and report the same six
 * states and the same seven failure codes, so the App drives both with one dialog. They moved
 * beside Penguin Go's to the model domain package (platform-auth-flow), aliases included.
 */

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

// ---------------------------------------------------------------------------
// Sandbox command policy (Project-level: the [command_policy] block)
// ---------------------------------------------------------------------------

/**
 * What a command-policy hit does: `deny` refuses the call outright; `ask` puts it to a person
 * whatever the approval mode (deny-all still denies).
 */
export type CommandPolicyActionDto = "deny" | "ask";

/**
 * One rule of the sandbox command policy — plain project-editable data. The factory rules
 * are seeded into new projects and carry no special status thereafter: every rule can be
 * edited, disabled, or deleted.
 */
export interface CommandPolicyRuleDto {
  name: string;
  /** JavaScript regex source, matched against the whitespace-normalized command. */
  pattern: string;
  /** What the rule catches (free text). */
  description?: string;
  /** Per-rule switch, effective value (defaults on). */
  enabled: boolean;
  /** What a hit does; absent = `deny` (served only for an `ask` rule, as it is stored). */
  action?: CommandPolicyActionDto;
  /**
   * Read-only, served only for a stored rule whose pattern this server's engine cannot
   * compile: the engine's reason. Such a rule is skipped when commands are matched, so the
   * settings page marks it; a PUT ignores the field (and refuses the pattern).
   */
  patternError?: string;
}

/**
 * Per-Project sandbox command policy: rules for shell commands, evaluated ahead of the
 * approval mode (a `deny` hit is refused and an `ask` hit is put to a person even under
 * allow-all). Serves as the GET response and the PUT response. The PUT request body carries
 * `enabled?` plus the full `rules` list (required — a PUT always materializes the list into
 * the config, model-presets style); per-rule `enabled` may be omitted there and defaults to
 * on, per-rule `action` likewise and defaults to `deny`. Owner-only to write; any member may
 * read. A PUT with a pattern this server's engine cannot compile answers 400
 * `invalid_rule_pattern`, whose `details` name the rule (`rule`), its 0-based place in the
 * list (`index`) and the engine's reason (`reason`).
 */

/**
 * Why an `approval_request` asks when its approval mode did not send it: a command-policy
 * `ask` rule matched the call (`rule` is its name). Core's own type, the reason its policy
 * wrapper hands the approve callback, carried to the card as it is.
 */
// ApprovalReason is the sessions library's alias of core's CoreApprovalReason (imported and re-exported below).

// ---------------------------------------------------------------------------
// Vault environment variables (Agent-level: agent_state/.vault.toml)
// ---------------------------------------------------------------------------

// The vault, agent-config and memory vocabulary moved to the agent domain library
// (services+http+cli restack S3); these re-exports keep the API's export surface whole.
export type {
  StoredKeybindings,
  ThemePackMode,
  ThemePackBase,
  ThemePackSwatch,
  ThemePackAccentPreset,
  ThemePackDto,
  ThemePacksResponse,
  ThemePackImportResponse,
  ThemePackErrorCode,
  ThemeInvalidDetails,
  DesktopUpdateStatus,
  DesktopUpdateStatusResponse,
  DesktopUpdaterStatusMessage,
  DesktopUpdaterCommandMessage,
  DesktopTrayLocale,
  DesktopTrayStatus,
  DesktopTrayPatch,
  DesktopTrayStatusResponse,
  DesktopTrayStatusMessage,
  DesktopTrayCommandMessage,
  DesktopFolderAccessResult,
  DesktopFolderAccessMessage,
  DesktopFolderAccessResultMessage,
  DirAccessResponse,
  DesktopPrivacyPane,
  DesktopOpenPrivacySettingsMessage,
  DesktopOpenWindowMessage,
  HostCommand,
  HostCommandOffer,
  HostCommandsMessage,
  HostCommandsResponse,
  HostCommandMessage,
} from "@prismshadow/penguin-library-setting/types";
export { HOST_COMMANDS, LEGACY_HOST_COMMANDS } from "@prismshadow/penguin-library-setting/types";
export type {
  AgentArchiveQuery,
  AgentCompactionConfigDto,
  AgentConfigDto,
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentHooksConfigDto,
  AgentKernelUpdateResponse,
  AgentMemoryConfigDto,
  AgentModelConfigDto,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentVaultConfigDto,
  MemoryFileInfo,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryFolderFile,
  MemoryImportMode,
  MemoryImportRequest,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MemoryScopeInfo,
  MemoryTransferFile,
  VaultEntryInfo,
  VaultEntryUpdate,
  VaultResponse,
  VaultUpdateRequest,
} from "@prismshadow/penguin-library-agent/types";
export { AVATAR_MAX_CHARS } from "@prismshadow/penguin-library-agent/types";

/** One library plugin an Agent's installed copy is behind on — one of its skills or its hook package carries an older dated version than the library's same part (see {@link AgentSummary.pluginUpdates}). */
export interface PluginUpdateRef {
  /** Plugin name — what `POST …/plugins` reinstalls to bring the Agent up to date. */
  name: string;
  /**
   * The LIBRARY's content version: the newest dated version (`YYYY.MM.DD.N`) among the plugin's
   * parts, i.e. the date of what installing again would bring, not what is on disk. A label —
   * it moves whenever any part changes, so a dismissed update comes back for the next one.
   */
  version: string;
}

export interface AgentSummary {
  agentId: string;
  name?: string;
  description?: string;
  /**
   * The system Agent (PRFC-0033): the owner of the system apps, which runs no Session, takes no
   * plugin and keeps its identity. Present only on it, so a list from an older server (a
   * machine) has none. The Web App shows its name and description from its own dictionary.
   */
  system?: true;
  /** Who made the Agent, as its config reads (absent there = `user`); the Agents page groups by it. This server always sends it; absent (a machine on an older server) reads as `user`. */
  author?: AgentAuthor;
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
  /** Schedule count (number of .toml files directly under agent_state/schedule/, including invalid ones; archived files under schedule/expired/ are not counted). */
  scheduleCount: number;
  /** Workbench folders with a manifest, including ones with a load error. */
  workbenchCount: number;
  /** Distinct installed plugin packages on this Agent. Older servers and unreadable configurations omit it. */
  pluginCount?: number;
  /** Installed Skill count (number of agent_state/skills/<name>/ directories with a SKILL.md). */
  skillCount: number;
  /** Installed hook-package count (number of agent_state/hooks/<name>/ directories with a hooks.json). */
  hookCount: number;
  /**
   * Installed plugins the built-in library has moved past — a skill or a hook package whose
   * on-disk dated version is behind the library's same part (compared part by part, never
   * against the plugin's npm version) — each with the library's content version on offer: the
   * plugin-library update gate, riding along on the Agent list so a badge over that page costs
   * no request of its own. Empty when nothing is behind. Skills the library does not carry
   * (installed from a zip or a picked directory) are never listed: there is no library version
   * for them to be behind.
   */
  pluginUpdates: PluginUpdateRef[];
  /** Memory count (topic files summed over the scope directories under agent_state/memory/, independent of the memory switch). */
  memoryCount: number;
  /** Whether the Agent's API tab switch is on (this server's web.db, see AgentApiSettings.enabled): the list card's API mark. */
  apiEnabled: boolean;
  /**
   * The organizations of this Project that employ the Agent, one entry per organization:
   * every organization directory the Project holds, paused ones included, plus the CEO id of
   * an organization whose chart does not parse. Absent or empty = not an employee. An
   * employed Agent cannot be deleted (`DELETE` answers 409 `agent_employed`) until it leaves
   * every one of them; development mode lists employees in a section of their own.
   */
  employments?: Employment[];
  /**
   * Present when the Agent has a picture of its own (`agent_state/avatar.<png|jpg|webp>`): its
   * content revision. The image is served at `GET …/agents/:agentId/avatar` (append it as
   * `?rev=` — the image is cached for good). Absent, surfaces draw the default avatar.
   */
  avatarRev?: string;
}

export interface AgentsResponse {
  agents: AgentSummary[];
  /**
   * The Project's organizations whose `org_chart.yaml` is missing or does not parse; absent when
   * none. Beyond its CEO, whom such an organization employs is unknown, so `employments` may miss
   * it — and deleting another organization with its Agents keeps them all (`employment_unknown`).
   */
  unreadableCharts?: UnreadableChart[];
}

export interface AgentCreateResponse {
  agent: AgentSummary;
}
/**
 * POST …/config/mcp-test result: reachability of one MCP Server entry. Its `${KEY}` references
 * are filled in from the Agent's vault only when the entry is saved on the Agent exactly as
 * tested (same name, same config — the user's rule); a new or changed entry that references the
 * vault is not filled in and not contacted (`saveFirst`).
 */
export interface McpServerTestResponse {
  ok: boolean;
  /** Discovered tool names (`mcp__<server>__<tool>`), present on success. */
  tools?: string[];
  /** Failure detail (connect error, timeout, server stderr tail; "needs setup: …" naming a vault key a saved entry references and the vault lacks, with nothing contacted), present on failure. */
  error?: string;
  /** The entry references the vault and is not saved as it is: nothing was filled in or contacted — save it, then test (`error` says so in English). */
  saveFirst?: boolean;
  /** Connect + discovery wall time (both outcomes) — the models test reports latency, this matches. */
  latencyMs?: number;
}

export type {
  AgentApiKeyInfo,
  AgentApiSettings,
  AgentApiUpdateRequest,
  ModelRefDto,
  ScheduleServerEvent,
  ServerEvent,
  CommandPolicyDto,
  GoalServerEvent,
  MachineServerEvent,
  ChatDefaultsDto,
  ProjectRole,
  ProjectSummary,
  MemberInfo,
  AgentTraceSessionEntry,
  AgentTracesResponse,
  ContextToolShare,
  AgentTraceFileRef,
  AgentTraceSessionGroup,
  AgentTraceDateGroup,
  AgentTraceSessionFile,
  ContextFileShare,
  CostParts,
  HistoryFileFact,
  HistoryFileKey,
  HistoryHeldRange,
  HistoryHave,
  HistoryLinesEvent,
  HistoryLinesFrame,
  HistoryLinesWindow,
  HistoryMessage,
  HistoryPage,
  HistoryPartFrame,
  HistoryProgress,
  HistoryRecords,
  HistorySegment,
  HistoryStreamError,
  HistoryStreamEvent,
  HistoryStub,
  HistoryWindowPart,
  MessagesLiveTail,
  MessagesPageInfo,
  MessagesResponse,
  RequestSpan,
  SessionCategory,
  SessionCategoryCounts,
  SessionContextParts,
  SessionTracesResponse,
  ToolCallSpan,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceImportResponse,
  TraceModelSegment,
  TraceOtherSpan,
  TracePosition,
  TraceTaskStats,
  TraceToolSpan,
  UsageErrorItem,
  UsageGroupBy,
  UsageTrendPointInTrace,
  UsageAgentSeries,
  UsageBucket,
  UsageErrors,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupRow,
  UsageModelSeries,
  UsageModelTotals,
  UsageModelTotal,
  UsageResponse,
  UsageSeriesPoint,
  UsageToolRow,
  OrgChannelMessage,
  OrgChannelNotice,
  OrgChannelNoticeKind,
  OrgTriggerKind,
  CompanyServerEvent,
  BrowserBackend,
  BrowserExtensionRecord,
  BrowserHello,
  BuiltinBrowserAction,
  BuiltinBrowserLoadWarning,
  BuiltinBrowserMetrics,
  BuiltinBrowserServerEvent,
  BuiltinBrowserTab,
  BuiltinBrowserTabMetrics,
  ChromeExtensionCookie,
  DesktopBrowserCommand,
  DesktopBrowserCommandMessage,
  DesktopBrowserCookie,
  DesktopBrowserReplyMessage,
  UsageEntitySeriesCounts,
  UsageErrorCount,
  ErrorContext,
  UserInfo,
  ApprovalMode,
  SessionStatus,
  PendingSteeringInfo,
  PendingFollowUpInfo,
  SubagentRuntimeInfo,
  SessionSandbox,
  SessionSandboxMode,
  SessionSandboxNetwork,
  SessionSandboxPreset,
  UnavailableSandboxBackend,
  ApprovalReason,
  OrgCalendarOutcome,
  OrgTicketChange,
  DefaultModelOffer,
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelBalanceAmount,
  ModelBalanceErrorCode,
  ModelInfo,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  ModelProtocolProbeDto,
  ModelPricingDto,
  ModelTestRequest,
  ModelTestResponse,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  ModelVisionOutcome,
  ModelsResponse,
  ModelsUpdateRequest,
  PresetSyncMode,
  PresetSyncResponse,
  ProtocolProbeOutcome,
  ProviderConnectionDto,
  ProviderConnectionResponse,
  ProviderConnectionUpdate,
  ModelEffectiveConnection,
  CredentialInfo,
};

// ---------------------------------------------------------------------------
// Agent API (/api/projects/:projectId/agents/:agentId/api; the stream itself is AMSP,
// /api/amsp/v1, whose snake_case wire types live in @prismshadow/amsp)
// ---------------------------------------------------------------------------

export interface AgentApiResponse {
  api: AgentApiSettings;
  /**
   * The admin's server-wide switch (`ServerSettings.agentApiEnabled`), which only an admin can
   * read through /api/admin/settings: off, every Agent's API is refused (403) whatever `api` says.
   */
  serverEnabled: boolean;
}

/** PUT body (owner only): every field optional, omitted fields keep their current value. */

/** POST …/api/keys body (owner only). */
export interface AgentApiKeyCreateRequest {
  /** 1-64 characters. */
  name: string;
}

/** The one response that carries the secret (`penguin_` + 43 base64url characters); only its hash is stored. */
export interface AgentApiKeyCreateResponse {
  key: AgentApiKeyInfo;
  secret: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
  projectId: string;
  agentId: string;
  /**
   * Provider group of the session's **current** model (paired with `modelId` to form a model
   * reference). It moves with each in-session switch (`POST /api/sessions/:id/switch-model`).
   */
  provider: string;
  /** Last confirmed target while it waits for, or is carrying out, a model handoff. */
  pendingModel?: ModelRefDto;
  /** Single-Session GET: the latest accepted switch that later failed, while its live channel exists. */
  modelSwitchFailure?: ModelRefDto & { id: string };
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
  /**
   * What kind of conversation this is, read from core session_meta — the single source of
   * truth (the DB stores no source). With the user's marks it decides where the Session is
   * listed (`archived`): a `user` Session is in the sidebar until archived; an `api`,
   * `schedule`, `cli` or `workbench` Session is archived until the user keeps it, and in the sidebar marked
   * with its source once kept; a `subagent` or `company` Session is in no list — its parent's
   * Agent panel and company mode's own views open them. A Trace head that records no source
   * (written before it was required) reads as `company` for a row the organization runtime
   * opened (`client: "org"`), else as `user`; so does such a row before its first run. Absent
   * only while any other row is not yet classified (its Trace head has not been read yet),
   * which renders as `user`.
   */
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
  /**
   * Whether the Session is archived — the listing rule's answer, never the bare mark: the user
   * archived it, or a program opened it (source `api`, `schedule`, `cli` or `workbench`) and the user has
   * not kept it. An archived Session is left out of the sidebar and listed on the archive page
   * (`/api/me/archived-sessions`). Always false for a `subagent` or `company` Session, which is
   * in no list.
   */
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
   * runtime (a desk or a ticket session, and every sub-session one of those spawns), "api"
   * from an Agent API run (the only Sessions the API may continue), "web" otherwise. Absent
   * only on a row that predates the column, which reads as "web". Unlike
   * {@link SessionInfo.orgId} — projected from the organization caches, so it disappears with
   * the organization and is not read while company mode is off — this is a durable stamp on
   * the row: development mode's list hides an "org" Session either way.
   */
  client?: "web" | "cli" | "org" | "api" | "workbench";
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

/** The background-task counts moved to @prismshadow/penguin-library-session (the AgentState
 * closed shape reaches them); re-exported here for the `@prismshadow/penguin-server/api` path. */
export type { SessionBackgroundTasks };

/**
 * Session list category, the listing rule applied server-side: `archived` when the user
 * archived the Session, or when a program opened it (source `api`, `schedule`, `cli` or `workbench`) and the
 * user has not kept it — unarchiving keeps it; otherwise `active`. A `subagent` or `company`
 * Session belongs to neither, whatever its marks: the list leaves it out of every category and
 * every total (a parent's Agent panel and company mode's own views open them).
 */

/** Per-category totals across an Agent's whole Session list (returned when the list is requested with counts). */

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
 *   whole-list totals below, which no cursor or offset narrows. A request with `category`,
 *   `workspaceGroup` or `counts=1` leaves every `subagent` and `company` Session out of the page
 *   and the totals (they are in no category); one with none of them serves every row.
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
   * group's existence and "More" from its own active share, so a group never advertises
   * content that lives in other Workspaces.
   */
  workspaceCounts?: Record<string, SessionCategoryCounts>;
  /**
   * Present with `counts`: each Workspace path's newest Session (any category), as its
   * `createdAt` — the Workspace picker's "recently used", which counts every Session that
   * worked there.
   */
  workspaceLatest?: Record<string, string>;
  /**
   * Present with `counts`: each Workspace path's newest `active` Session, as its `createdAt`
   * (a path holding none is absent). With `workspaceCounts` this is what lets the sidebar list
   * every Workspace that holds conversations and place the groups by recency before — or
   * without — loading any of their rows; an archived Session does not move a group it is not
   * shown in.
   */
  workspaceLatestActive?: Record<string, string>;
}

/**
 * The archive page's source filter: `user` is a conversation the user archived by hand (source
 * `user`, or a row whose Trace has not been read yet); the other three are what a program
 * opened. `subagent` and `company` Sessions are never archived, so never listed.
 */
export type ArchivedSessionSource = "user" | "api" | "schedule" | "cli" | "workbench";

/** Query of GET /api/me/archived-sessions/groups, and the part every archive query shares. */
export interface ArchivedSessionsQuery {
  /** Case-insensitive substring of the title (the DB title, else the Trace's first-prompt title); at most 200 characters. */
  q?: string;
  source?: ArchivedSessionSource;
  /** One Project the user can open (404 `project_not_found` otherwise); absent = every Project they own or are a member of. */
  projectId?: string;
}

/**
 * Which servers' groups GET /api/me/archived-sessions/groups answers with: `here` this server's
 * alone, never waiting on a machine; `machines` the machines' alone. Absent: both, in one answer.
 * The Web App asks the two apart, so a machine that answers nothing never holds this server's.
 */
export type ArchivedSessionGroupServers = "here" | "machines";

/** One group of the archive page: one Workspace of one Project, on this server or on one machine. */
export interface ArchivedSessionGroup {
  projectId: string;
  projectName: string;
  /** The Workspace path, as the sidebar groups it; `temp` for the merged temporary Workspaces. */
  workspace: string;
  /** Archived Sessions in the group matching the query. */
  count: number;
  /** The newest `lastActiveAt` in the group — the order the groups come in, newest first. */
  latest: string;
  /** The machine the group's Sessions live on (its own id); absent on this server's groups. */
  machineId?: string;
  /** That machine's ssh alias, for the group's header. */
  machineAlias?: string;
  /** That machine's own time when it counted the group: a batch on the whole group passes it as `until`. */
  asOf?: string;
}

/** GET /api/me/archived-sessions/groups. */
export interface ArchivedSessionGroupsResponse {
  groups: ArchivedSessionGroup[];
  /** Sum of the groups' counts. */
  total: number;
  /**
   * The server's time when these counts were taken (ISO). A group's batch passes it as its
   * filter's `until`, so it acts on the Sessions the count saw and on none that came after.
   */
  asOf: string;
  /** Machines the user's Projects use whose archive could not be read (not connected, or no answer). */
  unreachable?: Array<{ machineId: string; alias: string }>;
}

/** Query of GET /api/me/archived-sessions: one group's page, newest activity first. */
export interface ArchivedSessionsRowsQuery extends ArchivedSessionsQuery {
  projectId: string;
  /** The group's `workspace` (a path, or `temp`). */
  workspace: string;
  /** 1–100. */
  limit: number;
  /** `<lastActiveAt>,<sessionId>` of the last row held, as the Session list's cursor. */
  before?: string;
  /** The group's machine (`ArchivedSessionGroup.machineId`): the page is read from it. */
  machineId?: string;
}

/** GET /api/me/archived-sessions. */
export interface ArchivedSessionsResponse {
  /** `title` falls back to the Trace's first-prompt title when the row has none. */
  sessions: SessionInfo[];
  hasMore: boolean;
}

/**
 * What an archive-page batch acts on: explicit ids (1–500), or every archived row a filter
 * matches — on this server, or with `machineId` on that machine (the filter then names its Project).
 */
export type ArchivedSessionsBatch = (
  { sessionIds: string[] } | { filter: ArchivedSessionsBatchFilter }
) & { machineId?: string };

/** A batch's filter: the archive query, one group's Workspace, and the snapshot it was counted at. */
export interface ArchivedSessionsBatchFilter extends ArchivedSessionsQuery {
  workspace?: string;
  /**
   * The groups response's `asOf` the user acted on (ISO): only Sessions archived by then and
   * not active since are acted on, so one archived or run after the count is left alone.
   */
  until?: string;
  /** Sessions left out although the filter matches them — rows unticked after Select all (1–500). */
  exclude?: string[];
}

/** POST /api/me/archived-sessions/unarchive and /delete. */
export interface ArchivedSessionsBatchResponse {
  /**
   * Sessions acted on. Unarchive counts only the ones that were archived. Delete counts every
   * named one; a filter's delete leaves a running Session alone (it is not aborted) and does not
   * count it.
   */
  done: number;
  /** Ids that name nothing the user can open (the ids form only; a filter never reports any). */
  missing: string[];
}

/**
 * One page request inside POST /api/projects/:p/sessions/batch — the same knobs the
 * Agent-level list takes, carried per entry so one call can stand in for a whole sidebar
 * reload (one first page per Agent, plus every other page pair already open).
 */
export interface SessionBatchPageRequest {
  agentId: string;
  /** Rows per page, 1–1000. */
  limit: number;
  /** `activity`: last activity first — the sidebar's order. Omitted: creation order. */
  order?: "created" | "activity";
  /** Rows to skip from the top (default 0). Not beside `before`. */
  offset?: number;
  /**
   * Activity order only: rows strictly below this cursor — the last row of the previous page
   * (`lastActiveAt` + `sessionId`, the pair the list endpoint's `before` param carries).
   */
  before?: { lastActiveAt: string; sessionId: string };
  category?: SessionCategory;
  workspaceGroup?: string;
  /**
   * Totals per category over the Agent's whole list, with the per-Workspace counts and newest
   * stamps beside them (`counts=1` on the Agent-level list).
   */
  withCounts?: boolean;
  /** The user's own rows only: leave an organization's own sessions out of page and totals. */
  excludeOrg?: boolean;
}

/**
 * One entry's answer. `ok: false` is a real answer about THAT Agent, never about the batch:
 * `absent` is an Agent this server does not host (its rows come from the machine that does),
 * `error` is a failure to answer at all — which the caller must not read as "no rows".
 */
export type SessionBatchResult =
  | ({ agentId: string; ok: true } & SessionsResponse)
  | { agentId: string; ok: false; reason: "absent" | "error" };

export interface SessionsBatchRequest {
  requests: SessionBatchPageRequest[];
}

export interface SessionsBatchResponse {
  /** One entry per requested page, in request order (repeated Agent ids stay repeated). */
  results: SessionBatchResult[];
}

/** POST /api/projects/:p/sessions/archive — archives every active Session of one Workspace group. */
export interface SessionsArchiveRequest {
  /** The group's path, or the merged temporary group's sentinel (`temp`) — the list's `workspaceGroup`. */
  workspaceGroup: string;
}

export interface SessionsArchiveResponse {
  /** Sessions this call archived. */
  done: number;
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
   * The Session's source, when it is not a person's conversation: only `cli` is accepted from
   * a client (`penguin run` sends it); every other source is the server's own to write, and
   * absent means `user`. The retired `benchmark` is still accepted, as `cli`, until 0.3.0, for
   * an older CLI or Web App that still sends it.
   */
  source?: "cli";
}

export interface SessionCreateResponse {
  session: SessionInfo;
}

/** Immutable location of one record in a Session's append-only Trace. */

/**
 * History-only transport metadata; neither field is ever persisted into Trace JSONL.
 * `elided` names the bulky values the `history` stream sent as a preview (core's
 * history-elision.ts); `GET …/trace-body?ref=` returns each one whole.
 */

export type { ElidedBody };

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
  /**
   * `true` archives (clears the keep mark); `false` unarchives and writes the keep mark, so a
   * background Session stays in the sidebar through later runs. Announced as `session_archived`.
   * 409 `session_not_listed` on a `subagent` or `company` Session, which is in no list.
   */
  archived?: boolean;
  /** Manual rename; non-empty string, overrides the auto-generated title. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Task run, approval, interruption, compaction
// ---------------------------------------------------------------------------

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
 *   and the switch's `session_update`: its `provider` / `model_id` name the model the Session
 *   now runs on, the Session reads report that pair from this record on, and `task_state`
 *   turns idle after the switch. The new context's `session_meta` streams with the next
 *   message, when its Trace file opens.
 *   When the summary cannot be had — the model the Session is on is no longer configured or
 *   has no credential (it is then sent nothing, and no pair streams), or the compaction ends
 *   without a summary — the switch still completes, by Trace handoff: right
 *   after the `session_update` comes a user text that is one whole `[model_switch_from]` block
 *   whose `session` is this Session, naming the Trace file of the context it left. Only a
 *   stopped compaction (`aborted`), or a `fatal` one (the next context could not be opened on the
 *   target; its `error_message` says why), means no switch: no `session_update` follows and the
 *   Session keeps its model and its context.
 * - **200** {@link SessionResponse} — a Session that never ran has no context to close: it
 *   switched inside the request, and nothing is streamed.
 * - **409**, one code per refusal, before any event: `task_in_progress` / `compacting` (busy),
 *   `same_model`, `model_not_configured` (the target is not in the Project config), and
 *   `model_unavailable` (its client cannot be constructed, e.g. no credential). Both are about
 *   the target: a Session whose own model can no longer be reached is loaded for the switch
 *   anyway, and hands its history over.
 */
export interface SessionSwitchModelRequest {
  /** Provider group of the target model. */
  provider: string;
  /** Upstream model_id of the target model. */
  modelId: string;
  /** Wait for an idle boundary if busy. A later confirmed pick replaces the waiting target. */
  whenIdle?: boolean;
}

export interface TaskCreateResponse {
  /** Current actual session_id: a Trace-less invalid Session self-heals and returns a new id; the frontend updates its route accordingly. */
  sessionId: string;
  /** True when `queueIfBusy`, `interrupt` or `steerIfBusy` enqueued the input instead of starting it (absent/false: the task started). */
  queued?: boolean;
  /** True when `steerIfBusy` gave the input to the running Task as steering (no new Task). */
  steered?: boolean;
}

/**
 * POST /api/sessions/:id/interrupt: send one waiting message now — the queued follow-up
 * `followUpId` names, or the undelivered steering message `steerId` names (exactly one; 400
 * otherwise). It goes to the head of the follow-up queue and the run is aborted (see
 * TaskCreateRequest.interrupt); a follow-up keeps its id. 202; 409 `follow_up_started` when
 * the follow-up already started, 409 `not_pending` when the steering already reached the model.
 */
export type InterruptRequest = { followUpId: string } | { steerId: string };

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
// Messaging bindings (/api/sessions/:sessionId/messaging/*) and enabled bot accounts
// ---------------------------------------------------------------------------

/**
 * The messaging vocabulary moved to the messaging domain package
 * (@prismshadow/penguin-library-messaging/vocabulary, services+http+cli restack S8) — the
 * routes read and write it; re-exported here so the API contract keeps spelling it.
 */
export type {
  MessagingChannel,
  MessagingRuntimeState,
  MessagingDeliveryError,
  MessagingRuntimeStatus,
  MessagingBindingCommon,
  FeishuBindingInfo,
  TelegramBindingInfo,
  QQBindingInfo,
  WeChatBindingInfo,
  MessagingBindingInfo,
  MessagingChannelState,
  MessagingBindingsResponse,
  FeishuBindingResponse,
  TelegramBindingResponse,
  QQBindingResponse,
  WeChatBindingResponse,
  MessagingDeliveryPatch,
  FeishuBindingPutRequest,
  TelegramBindingPutRequest,
  QQBindingPutRequest,
  WeChatBindingPutRequest,
  MessagingBindingStateRequest,
  FeishuTestRequest,
  FeishuTestResponse,
  TelegramTestRequest,
  TelegramTestResponse,
  QQTestRequest,
  QQTestResponse,
  QQScanStartResponse,
  QQScanPollResponse,
  WeChatTestResponse,
  WeChatScanStartResponse,
  WeChatScanStatus,
  WeChatScanPollResponse,
  WeChatScanVerifyRequest,
  MessagingTestMessageResponse,
  MessagingAccount,
  MessagingAccountsResponse,
  MessagingAccountHolder,
  MessagingUnreachableReason,
  MessagingUnreachableMachine,
  MessagingAccountHoldersResponse,
} from "@prismshadow/penguin-library-messaging/vocabulary";
// ---------------------------------------------------------------------------
// SSE server events (records use the default event, only server_event here)
// ---------------------------------------------------------------------------

/** Docs: /docs/server-api § "Streaming (SSE)". */

/** One tool's share of the context: its calls plus their results. Its *definition* is counted in `toolDefs`, not here. */

/**
 * One file's share of the context: its `read_file` / `edit_file` / `write_file` calls plus their
 * results, keyed by the file each call named.
 */

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

/** Duration span of a single LLM Request (request_begin/request_end paired by proximity). */

/**
 * Per-Task Token / duration figures (aggregated server-side over the **entire** Trace file,
 * aligned with the Chat page's task-stats).
 *
 * Provided separately instead of letting the frontend aggregate `requests` + events itself:
 * the frontend's events are paginated (only the first N), so self-aggregation would mismatch
 * a numerator covering only the first N against a denominator covering the whole file.
 */

/** Duration span of a single tool call (complete tool_call message → paired tool_call_output). */

// The workspace files vocabulary moved to the workspace domain library
// (services+http+cli restack S4); these re-exports keep the API's export surface whole.
export type {
  FilesCreateRequest,
  FilesMoveRequest,
  FilesStatRequest,
  FilesStatResponse,
  FilesWriteRequest,
  WorkspaceFileEntry,
  WorkspaceFilesResponse,
  WorkspaceSearchHit,
  WorkspaceSearchResponse,
} from "@prismshadow/penguin-library-workspace/types";

/**
 * Model serial segments (autoregressive decoding): Trace records completion times, so each
 * segment's duration = its own time − the previous event's time (the request's first segment
 * is based on request_begin; user input is treated as sent instantaneously and takes no
 * segment).
 */

/**
 * Tool full lifecycle (parallel to model decoding): initiated (callTs) → approved
 * (approvalTs) → output (outputTs). Unclosed fields are unset (approval pending / executing /
 * file truncated).
 */

/**
 * Non-tool auxiliary phase on the timeline: rendered in its own lane under the "other"
 * legend category — deliberately not a tool span, since nothing was called. Currently the
 * first run's MCP connect + discovery (from the mcp_connect_begin/end event pair).
 */

/** One Trace file in the session-centric listing (`date` carried per file: one Session's shards can span date directories). */

/** One Session's Trace files merged across date directories (the paginated listing's unit). */

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

export interface TraceImportRequest {
  /** Base64 of the Trace file content (JSON Lines; the first record must be `session_meta`). */
  dataBase64: string;
}

// ---------------------------------------------------------------------------
// Usage and cost statistics
// ---------------------------------------------------------------------------

/**
 * A cost split by the three pricing buckets, in USD: cached input (`cacheRead`), uncached input
 * (`cacheWrite`, input Tokens on a cache miss) and output. Each part is its bucket's Tokens at the
 * rate the whole cost was priced at, so the three sum to the cost they accompany (up to
 * floating-point rounding).
 */

/** Time-series precision for the usage series (`granularity` query parameter). `minute` requires the `fromTs`/`toTs` window bounds. */

/**
 * One bucket of the usage time series (for the cost center's time-series charts).
 * Buckets are zero-filled across the whole requested range, so consecutive points
 * are always adjacent in time. Bucket keys by granularity: minute
 * `yyyy-mm-ddThh:mm` and hour `yyyy-mm-ddThh:00` (server-local clock), day
 * `yyyy-mm-dd`, week the ISO week's Monday `yyyy-mm-dd`, month `yyyy-mm`.
 */

/** Per-Agent counts per bucket. */

/** Per-Model counts per bucket (entity identity is the (provider, modelId) pair). */

/**
 * Lifetime Token total for one Model, keyed by the (provider, modelId) pair. Deliberately
 * unfiltered — no date range, no Agent: it answers "how much has this model been used", a
 * question with no window attached, and the models page that shows it carries no filters of its
 * own to honour. Models never used are absent rather than zero.
 */

/** Response of `GET /usage/model-totals`. */

/**
 * The two categories an error record is filed under: `unexpected` is a 500 or an unforeseen
 * runtime exception, `expected` an HttpError / business 4xx. The panel separates them by
 * colour, and `GET /usage/errors` takes one of them as its `kind` filter.
 */
export type UsageErrorKind = "unexpected" | "expected";

/**
 * One row of the stats center's error panel table: the records of one calendar day that share
 * a source, code, kind and message. The day is the viewer's when the request carried
 * `utcOffsetMinutes`, and the server's own otherwise.
 */

/**
 * Server-side error capture stats: not affected by the model
 * filter (HTTP / process errors have no Model dimension), but affected by date and agent
 * filters. Errors with no Project attribution (login, process-level) are counted in every
 * Project's view. The stats center presents this as "summary stats + detail table" with no
 * chart, so it only has a total count, the most common error code, and the most recent N
 * items.
 */

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

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * The schedule vocabulary moved to the session domain package
 * (@prismshadow/penguin-library-session/schedules, services+http+cli restack S7) — the
 * routes read and write it; re-exported here so the API contract keeps spelling it.
 */
export type {
  ScheduleStatus,
  ScheduleItem,
  SchedulesResponse,
  ProjectScheduleItem,
  ProjectSchedulesResponse,
  ScheduleUpsertRequest,
} from "@prismshadow/penguin-library-session/schedules";
import type { ScheduleStatus } from "@prismshadow/penguin-library-session/schedules";

// ---------------------------------------------------------------------------
// Agent export and import: the zip is the Agent's directory
// ---------------------------------------------------------------------------
//   GET  /api/projects/:projectId/agents/:agentId/archive?<AgentArchiveQuery>
//        → `<agentId>-<yyyymmdd>.zip` attachment (any member; 413 archive_too_large past the
//        import caps)
//   POST /api/projects/:projectId/agents/import?agentId=<id>&overwrite=1, the body the raw
//        `.zip` (or a `.tar.gz` snapshot package exported before) sent as
//        `application/octet-stream` → 201 AgentArchiveImportResponse (any member creates;
//        a taken id is 409 `agent_exists` with `details.agentId`; overwrite is the owner's)

export interface AgentArchiveImportResponse {
  agent: Pick<AgentSummary, "agentId" | "name" | "description">;
  mode: "created" | "overwritten";
  /** The Agent State version the package carried. */
  version: number;
  /** Overwrite only: the snapshot of the replaced State, a file name in the Agent's `snapshots/`. */
  backup?: string;
  sessions: {
    /** Sessions whose Traces landed as Sessions of this Agent. */
    imported: number;
    /** The package's Sessions this install already has, by id: their Traces were not imported. */
    skipped: string[];
  };
}

/** PUT /api/projects/:projectId/agents/:agentId/avatar. */
export interface AgentAvatarRequest {
  /** A png, jpeg or webp data URL of at most 131072 characters; `null` removes the picture. */
  avatar: string | null;
}

/** What PUT …/avatar answers: the picture's new revision, absent once it was removed. */
export interface AgentAvatarResponse {
  avatarRev?: string;
}

// ---------------------------------------------------------------------------
// Benchmark scoring (display), manual creation and deletion
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The benchmark domain's vocabulary moved to the benchmark domain package
// (@prismshadow/penguin-library-benchmark/types, services+http+cli restack S2); re-exported
// here so the API contract keeps spelling them.
// ---------------------------------------------------------------------------
export type {
  BenchmarkArchiveGitOrigin,
  BenchmarkCaseScore,
  BenchmarkCaseSummary,
  BenchmarkCasesResponse,
  BenchmarkCreateCase,
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
  BenchmarkEvaluation,
  BenchmarkManifestProblem,
  BenchmarkOrigin,
  BenchmarkOriginKind,
  BenchmarkRunScore,
  BenchmarkStatus,
  BenchmarkSummary,
  BenchmarksResponse,
  BenchmarkArchiveImportRequest,
  BenchmarkArchiveImportResponse,
  CaseMaterial,
} from "@prismshadow/penguin-library-benchmark/types";

// ---------------------------------------------------------------------------
// Plugin library, and an Agent's installed skills and hooks
// ---------------------------------------------------------------------------

/** GET /api/projects/:p/agents/:a/mcp-servers: the Agent's MCP servers in config order; DELETE …/mcp-servers/:name removes one (204, 404 `unknown_mcp_server`). */
export interface AgentMcpServersResponse {
  servers: AgentMcpServerItem[];
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

/**
 * POST /api/projects/:p/agents/:a/workbenches/archive: import one workbench's source from an
 * uploaded zip. Layout: package.json at the zip root (its `name` is then the id), or under exactly
 * one top-level directory (the directory name is then the id); source only — `state.json`, dot
 * entries and `node_modules/` are refused. An id whose folder has a package.json is 409
 * `workbench_exists` (`details.workbenchId` names it) unless `overwrite`. GET
 * …/workbenches/:id/archive is the matching export, which round-trips through this POST.
 */
export interface WorkbenchArchiveInstallRequest {
  /** Base64-encoded zip archive (decoded size capped at 14MB, like the skill archive). */
  dataBase64: string;
  /** Replace the source of a workbench with that id (its state.json stays) instead of answering 409. */
  overwrite?: boolean;
}

/** 201 of the workbench archive import: the workbench as its load left it (`error` set when the files do not load). */
export interface WorkbenchArchiveInstallResponse {
  workbench: WorkbenchInfo;
}

/**
 * PATCH /api/projects/:p/agents/:a/workbenches/:id/app-center: the App Center switch. Sets
 * `penguin.appCenter.show` in the workbench's package.json (nothing else of it) and reloads it;
 * 409 `workbench_manifest_invalid` when the package.json is not a JSON object to edit.
 */
export interface WorkbenchAppCenterRequest {
  show: boolean;
}

/** The workbench as the reload after the switch left it, `appCenter` read back from the file. */
export interface WorkbenchAppCenterResponse {
  workbench: WorkbenchInfo;
}

/**
 * One viewer's arrangement of a Project's App Center: the grid in order, each item an app by its
 * `<agentId>/<workbenchId>` key or a folder of apps. Kept per account in
 * `ui_prefs.appCenterLayouts`, by Project id, and written only through
 * PUT /api/projects/:projectId/app-center/layout.
 */
export interface AppCenterLayout {
  v: 1;
  items: AppCenterLayoutItem[];
}
export type AppCenterLayoutItem =
  { type: "app"; app: string } | { type: "folder"; id: string; name: string; apps: string[] };

export interface AppCenterUnavailable {
  /** The catalog could not read these Agents or their workbench switch is off. */
  agents: string[];
  /** Installed workbenches temporarily unable to contribute a tile. */
  apps: string[];
}

/**
 * GET /api/projects/:p/app-center: a shortcut for every workbench of the Project's Agents on this
 * server whose manifest asks to be shown, in Agent list order and by title within an Agent. Read
 * from the manifests, load status and the loads under way; nothing is compiled.
 */
export interface AppCenterResponse {
  unavailable?: AppCenterUnavailable;
  shortcuts: AppCenterShortcut[];
  /** The viewer's arrangement for this Project; null when they have none (the server's order). */
  layout: AppCenterLayout | null;
}

/**
 * PUT /api/projects/:p/app-center/layout: replaces the viewer's arrangement of the Project's App
 * Center; `null` restores the server's order. 400 naming the rule a layout breaks, and nothing is
 * stored: at most 500 items and 1000 app keys in all, each app key `<agentId>/<workbenchId>` (at
 * most 200 characters) once, folder ids `[A-Za-z0-9_-]{1,32}` once each, folder names 1–40
 * characters once trimmed (stored trimmed), up to 500 apps per folder. A lone app is promoted; an empty folder is omitted.
 */
export interface AppCenterLayoutRequest {
  layout: AppCenterLayout | null;
}
export interface AppCenterLayoutResponse {
  layout: AppCenterLayout | null;
}

/**
 * GET /api/projects/:p/agents/:a/workbenches: every workbench of the Agent, disabled ones
 * included (each says so in `enabled`).
 */
export interface WorkbenchesResponse {
  workbenches: WorkbenchInfo[];
  /**
   * The Agent-wide switch: false while `agent_state/workbenches/.disabled` exists, and then no
   * workbench of the Agent runs, whatever its own switch says. Absent from a server that
   * predates the switches.
   */
  enabled?: boolean;
}

/**
 * GET /api/projects/:p/agents/:a/workbenches?view=sidebar: the rows of the Agent's sidebar list, a
 * shortcut (the App Center tile's shape) for every workbench that runs, has at least one tab and
 * carries no `.hidden-from-sidebar` marker, by title; none while the Agent-wide switch is off.
 * Read from the manifests, load status and the loads under way; nothing is compiled. A server
 * older than the setting ignores `view` and answers `WorkbenchesResponse`.
 */
export interface WorkbenchSidebarResponse {
  apps: AppCenterShortcut[];
}

/**
 * PATCH /api/projects/:p/agents/:a/workbenches/:id/sidebar: the sidebar setting, any member of
 * the Project. `show: false` writes the installation's `.hidden-from-sidebar` marker and `true`
 * removes it; the source, its versions and its App Center declaration are untouched.
 */
export interface WorkbenchSidebarRequest {
  show: boolean;
}

/** The workbench with its `showInSidebar` read back. */
export interface WorkbenchSidebarSetResponse {
  workbench: WorkbenchInfo;
}

/**
 * PUT /api/projects/:p/agents/:a/workbenches/enabled (the Agent-wide switch; answers
 * `WorkbenchesResponse`) and PUT …/workbenches/:id/enabled (one workbench's switch; answers
 * `{ workbench: WorkbenchInfo }`). Owner only. Turning a switch off unloads what it covers at
 * once; turning it on loads it.
 */
export interface WorkbenchEnabledRequest {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Plugin registry index
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
  AppCenterShortcut,
  WorkbenchAppCenter,
  WorkbenchInfo,
  WorkbenchVersion,
  WorkbenchRequest,
  WorkbenchResponse,
  WorkbenchRecord,
} from "@prismshadow/penguin-library-workbench";

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

/**
 * Route id for a draft chat (`/chat/new`): the Session hasn't been persisted yet — the user may
 * still want to change the model or configure a key first. The actual Session is only created
 * once **the first message is sent**. Real session ids always start with `session-`, so there's
 * no collision; nor with parked draft conversations, whose route ids start with `draft-`.
 * Shared so the desktop tray's "New Session" opens the same draft route the Web App uses.
 */
export const DRAFT_SESSION_ID = "new";

/**
 * The session cookie's name as every non-browser client spells it (a browser's carries the
 * server's port; auth/middleware.ts): the CLI, a server speaking to a machine it holds, and the
 * desktop shell that mints its window's session. Shared so they all write the cookie the server
 * reads.
 */
export { SESSION_COOKIE } from "@prismshadow/penguin-library-auth/middleware";

/**
 * The API socket (PRFC-0011): one WebSocket per tab, every frame a call to an existing
 * endpoint. It has its own upgrade route, {@link API_SOCKET_PATH}: the runtime's websocket
 * seam authenticates the cookie and the Origin there and hands the socket to the platform,
 * which serves the protocol as the signed-in user (server: socket/ref.ts). Shared so the Web
 * App and anything else that speaks to another server spell the address the same way.
 */
export const API_SOCKET_PATH = "/api/socket";

/**
 * Paths whose answer depends on the KIND of session behind the request — the desktop shell's
 * own window (`sessionVia === "desktop"`: its update, tray and privacy relays, folder access,
 * revealing a file) or a first-login link (a password change without the old password). The
 * socket's handshake does not say how the cookie behind it was minted, so these are made over
 * HTTP: the socket answers them 421 `not_on_socket` and the Web App never sends them there.
 */
export function sessionKindPath(pathname: string): boolean {
  return (
    pathname === "/api/me/password" ||
    pathname === "/api/desktop" ||
    pathname.startsWith("/api/desktop/") ||
    /^\/api\/projects\/[^/]+\/dirs\/access$/.test(pathname) ||
    (pathname.startsWith("/api/") && pathname.endsWith("/reveal"))
  );
}
/** The API socket's address. No id is involved: the handshake's cookie names the user. */
export function apiSocketPath(): string {
  return API_SOCKET_PATH;
}

/**
 * The outcome of one self-update run (`penguin update --yes` on the server host), carried
 * by {@link UpdateJobStatus.result}. `unsupported` covers both a server not launched via
 * the CLI and the CLI's own refusals (source checkout, unrecognized install layout, Windows).
 */
/**
 * English fragments of the CLI's `penguin update` refusals (packages/cli/src/i18n.ts
 * `update.*`), one per refusal reason: a clean exit whose output carries one is "unsupported".
 * The CLI's own tests read this list, so a refusal reworded without its marker fails there.
 * `needsYes` / `cancelled` are omitted: `--yes` makes the confirmation gate proceed
 * unconditionally, so neither can occur under the server.
 */
export const UPDATE_REFUSAL_MARKERS: readonly string[] = [
  "runs from a source checkout", // sourceCheckout
  "Cannot tell how this penguin was installed", // unknownInstall
  "could not be identified", // npmUnknownManager
  "does not run on Windows", // windowsUnsupported
  "cannot run your package manager for you", // windowsGlobalInstall
];

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
   * when the machine answered the handshake with a status (a program predating the socket),
   * `unanswered` when its server answers HTTP and never answered the handshake, and `failed` when
   * the dial did not complete or a socket that was up closed.
   *
   * `unanswered` is a server PROCESS older than the socket: an update handed to a running server
   * swaps its platform and never the process that takes the upgrade, so the machine reports the
   * current build and still has no socket: it is not running this server's version, which a remote
   * machine must. A restart of its server, and failing that an update or a reinstall, brings it
   * there; the Machines page reads the state as needing a restart. It lasts until a handshake
   * completes: a
   * machine dialled again keeps it while the dial is outstanding, instead of reading `dialling`.
   */
  state: "connected" | "dialling" | "refused" | "unanswered" | "failed";
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
  /** This server signs in to the machine with a password it stores for the alias, not a key. */
  passwordSaved?: true;
  /**
   * In this Project's list: the Machines page shows a card for it. A machine joins the list when
   * it is added (`POST …/machines/add`, which installs nothing) or when an install or a use for
   * this Project runs on it, and leaves it with stop-using or release. Absent for a host that is
   * only in the ssh config, or only in another Project's list; never set on `local`, which is
   * always shown.
   */
  member?: true;
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
   * Present while this server is bringing a machine it keeps connected back — the connection
   * dropped, its server stopped or restarted, or this server itself just started — and absent
   * otherwise. A machine is kept connected from the moment it is enabled until it is stopped
   * (`POST …/stop`) or deleted (`POST …/stop-using`); see machines/service.ts's supervision.
   */
  reconnect?: MachineReconnect;
  /**
   * This server keeps a connection to it: it was enabled, or started, and has not been stopped
   * or deleted since. Absent otherwise — a machine only added, one whose server was stopped
   * here, one that never got as far as a connection.
   */
  keepConnected?: true;
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
   * What the last time this server handed it the Project config came to: at a connect, a Sync
   * config job, or an automatic sync after a config edit here. Absent until the first one since
   * this server started; kept in memory only.
   */
  configSync?: MachineConfigSync;
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
 * One config sync to a machine: when it ended, whether every part of it reached the machine for
 * every Project using it, and what did not, in the far side's words.
 */
export interface MachineConfigSync {
  /** ISO timestamp the sync ended. */
  at: string;
  ok: boolean;
  /** The parts that did not go through, one per line; absent when `ok`. */
  detail?: string;
  /**
   * The values the Project's models take from this server's environment variables rather than
   * its config (an API key, or a base URL), which no sync can carry: one row per variable. On
   * the list answered for a Project, that Project's rows only.
   */
  envOnly: MachineEnvOnly[];
  /**
   * The model entries the machine refused by name — a hand-added model in a group that takes
   * only its built-in ones there — left out while the rest of the table went. On the list
   * answered for a Project, that Project's rows only.
   */
  skipped: MachineSkippedModel[];
}

/** A model entry a machine would not take: its error code and its own words for why. */
export interface MachineSkippedModel {
  projectId: string;
  provider: string;
  modelId: string;
  /** The far side's error code (`model_not_addable`, `model_not_routable`). */
  code: string;
  reason: string;
  /**
   * The entry is one of this server's built-in models for its group, which the machine refused
   * as not addable: the machine's build does not list it yet, so updating the machine, then
   * syncing again, carries it. Absent for any other refusal.
   */
  builtInHere?: true;
}

/** A model entry that takes `variable` from this server's environment. */
export interface MachineEnvOnly {
  projectId: string;
  provider: string;
  modelId: string;
  variable: string;
}

/**
 * A machine this server keeps connected, while it is being brought back. Attempts back off
 * from 15 s, doubling, and stop after `maxAttempts` failures in a row — or after the first, when
 * ssh refused in a way no retry fixes, or when a person asks to stop
 * (`POST …/machines/:machineId/stop-reconnecting`) — until a person asks for a Retry
 * (`POST …/machines/:machineId/reconnect`). After three failures in a row the connection check
 * runs on its own, and its answer is what the page shows as the explanation.
 */
export interface MachineReconnect {
  /** When this streak began: the moment the machine was found not connected, or the Retry that began it again. */
  since: string;
  /** Attempts that failed in this streak; 0 while the first is still to run or running. */
  attempts: number;
  /** How many failures in a row end the streak: the page says "attempt n of this". */
  maxAttempts: number;
  /** When the next attempt runs; null while one is running, and once the streak stopped. */
  nextAt: string | null;
  /**
   * The streak stopped, and nothing runs until a person asks for a Retry, which begins a new
   * one: `attempts` — `maxAttempts` failed in a row; `ssh` — ssh refused in a way retrying
   * cannot fix (a host key unknown or changed, an unusable key file, a key refused, a broken
   * ssh config), said by `sshReason`; `cancelled` — a person stopped it. An attempt that was
   * under way when it was stopped runs out: it may still connect the machine, and its failure
   * is the `lastError`.
   */
  gaveUp?: "attempts" | "ssh" | "cancelled";
  /** The last attempt's failure in the far side's words; null before the first one fails. */
  lastError: string | null;
  /** Why ssh refused, when the last failure was ssh's own — for the page to say in its language. */
  sshReason?: MachineSshFailure;
  /** The connection check run after three failures in a row; null until then. */
  diagnosis: MachineDiagnosis | null;
  /**
   * The password stored for the machine was refused, or its host takes none (`sshReason`
   * says which): no attempt runs until a password is saved for it again or removed, since
   * retrying could lock the account. `nextAt` is null meanwhile.
   */
  waitsForPassword?: true;
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
  /**
   * `use` is the whole pipeline — install if needed, hand over, connect, sync — as one job;
   * `connect` is what the page calls Start service; `stop` stops the machine's server and stops
   * keeping it connected; `uninstall` stops it and removes the program, and the data directory
   * when asked; `sync` hands a connected machine the Project config.
   */
  kind: "install" | "connect" | "restart" | "use" | "stop" | "uninstall" | "sync";
  machineId: string;
  alias: string;
  /** Waiting its turn: a few machines are worked on at once, and a batch queues the rest. */
  queued: boolean;
  running: boolean;
  /**
   * The steps this job goes through, in order — what the page draws as its stepper. Fixed when
   * the job is queued; a step the job turns out not to need is passed over, never revisited.
   */
  steps: MachinePhase[];
  /**
   * Which of `steps` the job is on. Only moves forward. Null until the first step is named; a
   * finished job keeps its last phase.
   */
  phase: MachinePhase | null;
  log: string[];
  /**
   * The connection check run after the job failed at a step it can explain — checking,
   * installing, connecting: running, then its answer. Absent for every other job.
   */
  diagnosis?: { state: "running" } | ({ state: "done" } & MachineDiagnosis);
  result:
    | null
    | { ok: true; installed: "installed" | "already-installed"; version: string | null }
    | { ok: true; connected: true }
    /** The machine's server is stopped and stays so until it is started again. */
    | { ok: true; stopped: true }
    /** The program is gone from the machine; `dataRemoved` says whether its data root went too. */
    | { ok: true; uninstalled: true; dataRemoved: boolean }
    /** Every part of the Project config reached the machine (its `configSync` says the same). */
    | { ok: true; synced: true }
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
        /**
         * Why ssh refused, when the failure is ssh's own (a host key, a key, a host name, a
         * route), for the page to say in its language; `message` says it in English, with
         * ssh's own words after `(ssh: …)`.
         */
        sshReason?: MachineSshFailure;
      };
}

/**
 * A source checkout's install image (machines/checkout-image.ts), built from the checkout
 * again at each install or use: not built yet, building, built, or failed with the build's
 * own last words.
 */
export type MachinesCheckoutImage =
  | { state: "unbuilt" }
  | { state: "building" }
  | { state: "built" }
  | { state: "failed"; detail: string };

/** GET /api/machines, and the 202 body of POST /api/machines/:machineId/install. */
export interface MachinesResponse {
  machines: MachineInfo[];
  /**
   * The version an install would leave on the remote — the base release, plus a `+hmr.<sha>`
   * suffix when this server carries a pushed version to replicate. A source checkout answers
   * with the image it last built, and null before its first build (see `checkoutImage`).
   * Null otherwise only for a server that carries no image and builds none.
   */
  imageVersion: string | null;
  /**
   * Present only when this server runs from a source checkout: it builds its install image
   * from the checkout at each install or use, so no image yet is not a reason to refuse one.
   */
  checkoutImage?: MachinesCheckoutImage;
  /** The most recently started job, running or finished. */
  job: MachineJob | null;
  /**
   * Every job worth showing this generation: the queued ones, the running one, and the last
   * finished one per machine — so a batch reads as a list of rows each saying where it is.
   */
  jobs: MachineJob[];
}

/**
 * Every step a job may name, in the order they can occur. A job lists its own subset as
 * `MachineJob.steps`: a source checkout's enable starts by building its install image
 * (`build`); a stop is `check`, `stop`; an uninstall `check`, `stop`, `remove`; a config sync
 * `check`, `sync`.
 */
export const MACHINE_PHASES = [
  "build",
  "check",
  "install",
  "handover",
  "restart",
  "connect",
  "sync",
  "stop",
  "remove",
] as const;
export type MachinePhase = (typeof MACHINE_PHASES)[number];

/** `POST /api/projects/:projectId/machines/:machineId/uninstall`. */
export interface MachineUninstallRequest {
  /** Remove the machine's data root too — its Sessions, Agents and config there. Default false. */
  removeData?: boolean;
}

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
  /**
   * Sign in with this password instead of a key: stored on this server in a 0600 file under its
   * data root, never in the ssh config, and never sent back. On a PUT, `null` deletes the stored
   * one (back to key sign-in) and leaving it out keeps it. A PUT on a block written by hand may
   * set it when the other fields are the block as it stands. 400 `ssh_password_invalid` for an
   * empty or multi-line one; 409 `ssh_password_unsupported` (`details.ssh`: what `ssh -V` said)
   * when this computer's ssh cannot be handed a password.
   */
  password?: string | null;
}

/**
 * `GET /api/projects/:projectId/machines/ssh-hosts/:alias`: a host's block read back, and
 * whether this app wrote it. Only a block this app wrote may be rewritten
 * (`PUT …/ssh-hosts/:alias`, the same fields less the alias): a hand-written one may carry
 * options this app does not know, and rewriting it would drop them.
 */
export interface SshHostResponse extends Omit<SshHostRequest, "password"> {
  editable: boolean;
  /** A password is stored for this host, which then signs in with it rather than with a key. */
  passwordSaved?: true;
}

/**
 * `GET /api/projects/:projectId/machines/ssh-hosts`: every host this server's ssh config declares,
 * its included files' too, with what each one's own block says about reaching it — the literal
 * lines, not what ssh resolves (no `ssh -G`): a `Host *` default or a `Match` block is not
 * applied. For the add dialog's rows; an option the block leaves out is absent.
 */
export interface SshHostSummary {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
}

export interface SshHostsResponse {
  hosts: SshHostSummary[];
}

/**
 * `POST /api/projects/:projectId/machines/add`: put these machines in this Project's list without
 * installing anything there — each then has a card whose one thing to do is enabling it. Answers
 * like `…/use`, refusals by id (`unknown-machine`, `self`).
 */
export interface MachinesAddRequest {
  machines: string[];
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

/**
 * Why ssh could not get a session to a machine, read from its own diagnostic
 * (machines/ssh-failure.ts); `other` when it printed none of the ones with a fixed meaning.
 */
export type MachineSshFailure =
  | "host-key-unknown"
  | "host-key-changed"
  | "key-file"
  | "auth"
  | "password-rejected"
  | "password-not-offered"
  | "host-not-found"
  | "refused"
  | "timeout"
  | "closed"
  | "ssh-config"
  | "other";

/** Whether a machine reaches one release source: the package is there, the source answered without it, or no answer. */
export type MachineSourceReach = "ok" | "missing" | "unreachable";

/**
 * One check of a machine (machines/diagnose.ts), as facts for the page to word. `pass` is
 * fine, `warn` works with a caveat, `fail` stops an install or a connect, `skip` could not be
 * asked (an earlier check failed, or it does not apply).
 */
export type MachineCheck =
  /** A session came up (keys, or the stored password), as this account on that host. */
  | { id: "ssh"; state: "pass"; user: string; host: string }
  /** It did not; `said` is ssh's own words, led by what they mean. */
  | { id: "ssh"; state: "fail"; reason: MachineSshFailure; said: string }
  /**
   * `warn` for Windows (installable, not connectable yet), and for a Linux whose glibc runs the
   * release but is older than `terminalsNeed`, the one its terminal binding loads on.
   */
  | {
      id: "platform";
      state: "pass" | "warn";
      os: string;
      arch: string;
      glibc?: string;
      terminalsNeed?: string;
    }
  /**
   * What the release's Node cannot run on: an OS or architecture no release is published for
   * (`unsupported`, `said` what the machine answered), a glibc older than `need` (`glibc`), or
   * a musl libc such as Alpine's (`musl`).
   */
  | {
      id: "platform";
      state: "fail";
      reason: "unsupported" | "glibc" | "musl";
      os?: string;
      arch?: string;
      glibc?: string;
      need?: string;
      said?: string;
    }
  /**
   * What the release installer needs and the machine lacks. `warn` when curl alone is missing:
   * the release is then sent over ssh rather than downloaded there.
   */
  | { id: "tools"; state: "pass" | "warn" | "fail"; missing: string[] }
  /**
   * Whether the machine itself reaches release `version` for its platform. `warn`: out of
   * reach, so an install cannot download it there; `fail`: both sources answered and neither
   * has it (not published).
   */
  | {
      id: "download";
      state: "pass" | "warn" | "fail";
      version: string;
      github: MachineSourceReach;
      oss: MachineSourceReach;
    }
  /** Free space in the machine's home against what an install needs, in MB. */
  | { id: "disk"; state: "pass" | "warn" | "fail"; freeMb: number; needMb: number }
  /** The port its server would start on: free, already its PenguinHarness server's, or taken by something else. */
  | { id: "port"; state: "pass" | "fail"; port: number; holder: "free" | "penguin" | "other" }
  | { id: "platform" | "tools" | "download" | "disk" | "port"; state: "skip" };

/**
 * `POST /api/projects/:projectId/machines/:machineId/diagnose`: the checks, in order. Nothing
 * is written on the machine; 409 `job_running` while a job works on it.
 */
export interface MachineDiagnosis {
  machineId: string;
  checkedAt: string;
  checks: MachineCheck[];
}

export interface MachinesUseResponse extends MachinesResponse {
  refused: { machineId: string; why: MachineUseRefusal }[];
}

/** `POST /api/projects/:projectId/machines/stop-using`: let go of these machines — connection dropped, Project membership released; the install stays. */
export interface MachinesStopUsingRequest {
  machines: string[];
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

/**
 * The data of one `WebModule.pages` contribution: its route, where it sits (`main` = the
 * development nav; `org` = a company-mode page — its path is relative to
 * `/org/:projectId/:orgId/` and it gets a nav row after the organization's own; `none` =
 * reachable by URL only), whether it is admin-only, its renderer; its nav row's name in English
 * and Chinese and its glyph (a name in the web UI's icon registry); and the key of the page it
 * sits under, if any — one level only, and a page whose parent is absent is not shown.
 *
 * A page with `app` is a system app of the system Agent: a tile in the App Center named and drawn
 * by the page's `title` / `titleZh` / `icon`, opening the page's path, shown to whom `admin`
 * allows, placed by `app.order` among the system apps. A page whose `order` is not a finite
 * number, or that names no `title`, is no app (it stays reachable by its path).
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
  app?: { order: number };
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

/**
 * The data of one `StartPageModule.metrics` contribution: a count on the start page, fixed when
 * its package was built. `key` names the count; `title` / `titleZh` are its label in English and
 * Chinese and `icon` its glyph (a name in the web UI's icon registry); `order` places it among
 * the contributed counts, which follow the start page's own; `app` is the page key of the system
 * app a click opens (absent: the count opens nothing).
 */
export type StartMetricData = {
  key: string;
  title: string;
  titleZh?: string;
  icon?: string;
  order: number;
  value: number;
  app?: string;
};

/** A start-page count as GET /api/contributions answers it. */
export type StartMetricContribution = WebContribution & StartMetricData;

export interface ContributionsResponse {
  pages: WebPageContribution[];
  fileRenderers: WebFileRendererContribution[];
  pageRemovals: WebPageRemovalContribution[];
  agentTabs: WebContribution[];
  sessionTabs: WebContribution[];
  /**
   * The server modules plugins provide that this generation runs, by name: a web module that
   * declared one of them (`WebAppModule.serverModules`) is drawn only while it is listed. A
   * plugin left out of this generation because the build cannot satisfy it lists nothing; the
   * platform's own modules always run and are not listed. Absent from a server older than it.
   */
  modules?: string[];
  /** The start page's contributed counts; this server always sends the list, an older one none. */
  startMetrics?: StartMetricContribution[];
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
   * The prefix resolves this name through a link `penguin plugin link` parked: the package is
   * the author's directory, read fresh from disk every time.
   */
  linked?: true;
  /** The author directory the link points at (when `linked`). */
  linkPath?: string;
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
}

/** What an install put on this server (POST …/plugins/installed and …/installed/archive). */
export interface PluginInstallOutcome {
  /** The package name npm installed — for a link, the name its package.json carries. */
  name: string;
  version: string | null;
  /** It carries skills, a hook package or MCP servers: the library lists it, and nothing loads it. */
  library: boolean;
  /** It carries server modules: the Project's list loads it. */
  modules: boolean;
  /** The zip held the version already installed: nothing was installed. */
  unchanged?: boolean;
  /**
   * Where the package came from, for an install by name or link: the npm registry, the link npm
   * fetched, the published index's github channel, or the offline archive the build carries
   * (05 「插件库」 「安装从不卡住」). Absent for a zip import and on older servers.
   */
  from?: "registry" | "link" | "channel" | "offline";
}

/** POST /api/projects/:projectId/plugins/installed/archive (admin): a plugin package zip, base64. */
export interface PluginArchiveImportRequest {
  dataBase64: string;
  /** Replace another installed version of the package (the 409 `plugin_exists` question). */
  overwrite?: boolean;
}

export interface InstalledPluginsResponse {
  plugins: InstalledPlugin[];
  /** After an install: what landed on this server. */
  installed?: PluginInstallOutcome;
  /**
   * After an install: the App was still re-assembling on what it listed when the answer stopped
   * waiting (60 s) — a module is starting; its row says how it stands once it has.
   */
  loading?: true;
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
  /** Every library plugin that ships server modules, as it stands on this server for this Project (PRFC-0031); absent from a server older than that. */
  modules?: PluginModuleStatus[];
}

/**
 * What a backend's link can do. The shell cannot create tabs (the Web App's <webview> does) and
 * throttles and measures its guests; the extension creates, closes and focuses tabs itself and
 * has no cookie store the server may touch.
 */
export interface BrowserLinkCapabilities {
  /** `open-tab`, `close-tab` and `activate-tab` are answered (chrome). */
  createsTabs: boolean;
  /** `throttle` and the `metrics` events (builtin). */
  throttles: boolean;
  /** `set-cookies` and `clear-data` (builtin). */
  cookieStore: boolean;
}

/**
 * Why the agent browser cannot be driven. Built-in: not under the desktop shell, a shell too old
 * to host it, or no app window to host a new tab. Chrome: this user has no paired extension, it
 * is paired but not connected now, or an admin switched Chrome connections off server-wide. On a
 * machine (a server another one started as its machine): the browser is the person's own on the
 * server that added it, and that server is not connected to this machine now
 * (`hub_disconnected`).
 */
export type BuiltinBrowserUnavailableReason =
  | "not_desktop"
  | "shell_unsupported"
  | "no_window"
  | "extension_not_paired"
  | "extension_disconnected"
  | "extension_disabled"
  | "hub_disconnected";

/** One backend as GET /status lists it for the caller. */
export interface BrowserBackendInfo {
  backend: BrowserBackend;
  available: boolean;
  reason?: BuiltinBrowserUnavailableReason;
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
  backend: BrowserBackend;
  backends: BrowserBackendInfo[];
  tabs: BuiltinBrowserTab[];
  activeTabId: number | null;
  /** The shell's latest measurement of the built-in browser's load; absent before its first one, and on chrome. */
  metrics?: BuiltinBrowserMetrics;
}

/** GET / PUT /api/builtin-browser/backend: the caller's backend and the ones they may choose. */
export interface BrowserBackendResponse {
  backend: BrowserBackend;
  choices: BrowserBackend[];
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
  /**
   * The address the browser reaches this server at, which the extension pairs with: the public
   * origin (scheme, host and port; from the forwarded headers when the server trusts a proxy).
   * Null only from an older server, which echoed the request's `Origin` and had none to echo for
   * a call that carried no `Origin`.
   */
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
  /**
   * How the source is read. Absent: the profile's own files on this computer. `extension`: the
   * user's connected Chrome extension (id `chrome-extension`), which hands over the cookies of
   * the Chrome profile it runs in once the user allows it in Chrome; cookies only, and
   * `profile` / `profileName` name the extension's Chrome.
   */
  via?: "extension";
}

export interface BuiltinBrowserImportSourcesResponse {
  sources: BuiltinBrowserImportSource[];
  /**
   * Why the user's Chrome extension is not among `sources`: none is paired, the paired one is not
   * connected now, or an admin switched Chrome connections off. Absent when it is listed, and on
   * a server that offers no Chrome backend at all.
   */
  extension?: "extension_not_paired" | "extension_disconnected" | "extension_disabled";
}

/** POST /api/builtin-browser/import. */
export interface BuiltinBrowserImportRequest {
  sessionId?: string;
  projectId?: string;
  sourceId: string;
  cookies?: boolean;
  history?: boolean;
  /** Only cookies of these sites (a domain matches itself and its subdomains). */
  domains?: string[];
}

/**
 * Why a cookie the import found stayed behind. `app_bound`: Chrome's app-bound encryption
 * (Chrome 127+ on Windows), which only Chrome itself can undo. `dpapi`, `keychain`, `keyring`:
 * the platform would not give up the browser's cookie key (Windows DPAPI, the macOS Keychain,
 * the Linux desktop keyring). `undecryptable`: no key at hand fits the value. `partitioned`: it
 * belongs to one context only — a partitioned (CHIPS) cookie kept for one top-level site, or a
 * Firefox container's. `expired`: past its expiry.
 */
export type BuiltinBrowserCookieSkipReason =
  "app_bound" | "dpapi" | "keychain" | "keyring" | "undecryptable" | "partitioned" | "expired";

export interface BuiltinBrowserCookieSkip {
  reason: BuiltinBrowserCookieSkipReason;
  count: number;
}

/**
 * What else an import reports, as a code (and counts) the Web App and the CLI word in the
 * reader's language; the server sends no prose. `store`: which of the profile's stores.
 */
export type BuiltinBrowserImportNote =
  /** The profile holds no cookie store. */
  | { code: "no_cookie_store" }
  /** The profile holds no history (an extension source never does). */
  | { code: "no_history" }
  /** The browser holds the store open (Windows): closing it lets the import read it. */
  | { code: "store_busy"; store: "cookies" | "history" }
  /** The store could not be copied or opened. */
  | { code: "store_unreadable"; store: "cookies" | "history" }
  /** The built-in browser refused `count` cookies; `errors` holds up to three of its messages, verbatim. */
  | { code: "cookies_not_set"; count: number; errors: string[] };

export interface BuiltinBrowserImportResult {
  sourceId: string;
  /** The browser imported from, as the source names it ("Chrome", "Firefox"). */
  browserName: string;
  cookies?: {
    found: number;
    imported: number;
    skipped: number;
    failed: number;
    /** Why the skipped cookies stayed behind: one entry per reason that occurred; the counts add up to `skipped`. */
    skips: BuiltinBrowserCookieSkip[];
  };
  history?: { found: number; imported: number };
  notes: BuiltinBrowserImportNote[];
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
 * that is read and written without the desktop shell. PUT takes the whole object.
 */
export interface BuiltinBrowserSettings {
  /**
   * The page a new tab opens when it is given no address — the panel's "+", an agent's new tab
   * — and the toolbar's Home button goes to: an http(s) address, or null for none (a new tab is
   * then blank). PUT takes a bare host too and answers the address as stored.
   */
  homepage: string | null;
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
