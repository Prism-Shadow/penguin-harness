/**
 * The models domain vocabulary: the DTOs the models routes return and take (the Web App's
 * models page is their consumer), the platform catalog's shapes, the OAuth flow's words, and
 * the pricing/balance types. Declared apart from what implements them — the server's
 * ProjectConfigStore and model services implement the reads and writes these name.
 */
import type { ModelRefDto } from "@prismshadow/penguin-library-agent-api";

// ---------------------------------------------------------------------------
// Pricing (per-model list price and its promotion fractions)
// ---------------------------------------------------------------------------

export interface PricingRates {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** Peak/off-peak pricing. */
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

/** One model's stored price (from .project_config.toml's `[models.<id>]`). */
export interface ModelPricingDto {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

// ---------------------------------------------------------------------------
// The platform catalog (platform-auth-types.ts's normalized shapes)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The models page's DTOs (GET/PUT /api/projects/:p/models and friends)
// ---------------------------------------------------------------------------

export interface ModelInfo {
  /** Provider group id (anthropic / openai / …, see core's MODEL_PROVIDERS; custom models use `custom`). */
  provider: string;
  /** Upstream model id (the request id actually sent to MMSP); paired with `provider` forms the entry's unique key. */
  modelId: string;
  /**
   * False for a model the catalog marks as a tool model (an image, speech or web model a plugin's
   * tool binds): the chat model pickers do not offer it. Absent for every other model.
   */
  chatEligible?: boolean;
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
   * ANTHROPIC_API_KEY): only for a row with no key in the file whose routed MMSP client reads
   * that variable for its endpoint — no base URL on the row or its group, or the client's own
   * default endpoint. Unset for a row with a key (its own or a group key that reaches it), a row
   * sent to any other base URL (a gateway, Penguin Go, ModelScope, a vendor's second host or a
   * proxy), or an id nothing routes.
   */
  envKey?: string;
  /**
   * Masked preview (same rule as `credential.apiKeyMasked`) of the value the server process
   * currently holds for `envKey` — the plaintext is never serialized. Absent = the variable is
   * unset or empty, or the entry gets no fallback. Reported only when no row or group key
   * reaches the row.
   */
  envKeyMasked?: string;
  /** The row's OWN key (masked) and base URL — overrides of its group's; see `effective`. */
  credential?: CredentialInfo;
  /** The connection the row is actually used with, and where each value comes from. */
  effective: ModelEffectiveConnection;
  isDefault: boolean;
}

/** Read-only credential display: masked key and creation time; plaintext is never sent. */
export interface CredentialInfo {
  apiKeyMasked?: string;
  baseUrl?: string;
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
  /**
   * `env` = no key in the file, and MMSP's routed client reads its own variable for the row's
   * endpoint (no base URL, or the client's default endpoint) — reported when that variable
   * holds a value here (`envKeyMasked`), `none` otherwise.
   */
  apiKeySource: "model" | "provider" | "env" | "none";
  /** Mask of the key the row would use, whichever source; absent when none. */
  apiKeyMasked?: string;
}

export interface ModelsResponse {
  /** Paired reference to the default Model. */
  defaultModel?: ModelRefDto;
  /** Vision model used as a proxy reader for read_file (describes images when the session model has vision=false). */
  visionModel?: ModelRefDto;
  /** The `[tools]` bindings, by key: only those naming a configured model; absent when none does. */
  toolModels?: Record<string, ModelRefDto>;
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
  /** Vision model used as a proxy reader for read_file: must be included in models and not annotated vision=false; omitted keeps the existing value, null clears it. */
  visionModel?: ModelRefDto | null;
  /**
   * The whole `[tools]` table, by key: present, the table becomes exactly this (each model must be
   * included in models); omitted, the stored bindings are kept, following a renamed model and
   * dropped with a removed one. The machine sync sends it; the models page does not.
   */
  toolModels?: Record<string, ModelRefDto>;
  /** Group connection changes, merged per provider; a provider absent here keeps its table. */
  providers?: Record<string, ProviderConnectionUpdate>;
  models: ModelUpdateEntry[];
}

/**
 * One tool-model binding as `GET …/models/tool-bindings` lists it: a plugin's declaration
 * (`ToolModelBindingsProvider.bindings`) joined with the Project's `[tools]` entry.
 */
export interface ToolModelBindingView {
  /** The `[tools]` key the plugin declared. */
  key: string;
  /** Its name, per language. */
  title: { en: string; zh: string };
  /** The plugin package that declares it. */
  package: string;
  /** The bound model; absent when none is, or the one bound is no longer configured. */
  model?: ModelRefDto;
  /** The configured models the binding accepts, in the models table's order. */
  candidates: ModelRefDto[];
}

/** GET / PATCH `…/models/tool-bindings`: every declared binding, in load order. */
export interface ToolModelBindingsResponse {
  bindings: ToolModelBindingView[];
}

/** PATCH `…/models/tool-bindings`: bind one key, or with `model: null` unbind it. */
export interface ToolModelBindingUpdate {
  key: string;
  model: ModelRefDto | null;
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

export interface ProviderConnectionResponse extends ModelsResponse {
  defaultOffer?: DefaultModelOffer;
}

export type PresetSyncMode = "add" | "restore";

export interface PresetSyncResponse extends ModelsResponse {
  /** Preset rows added (both modes). */
  added: number;
  /** Preset rows the Project already had that `restore` changed (0 for `add`). */
  restored: number;
}

/** A group just became connected and the catalog names a model of that group as its connect default; the write leaves the default as it is and offers this. */
export interface DefaultModelOffer {
  /** The model offered as the default. */
  model: ModelRefDto;
  /** The default the Project stores now, outside the group; absent when it has none. */
  current?: ModelRefDto;
}

/** A group key written: how many of the group's rows use it, and the default it offers, if any. */
export interface GroupKeyApplied {
  applied: number;
  defaultOffer?: DefaultModelOffer;
}

// ---------------------------------------------------------------------------
// Connectivity test, vision probe, protocol detection, endpoint listing
// ---------------------------------------------------------------------------

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

export type ModelVisionOutcome = "supported" | "unsupported" | "failed";

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

/** Vision probe result; `message` carries the truncated provider error for the failed case. */
export interface ModelVisionDetectResponse {
  outcome: ModelVisionOutcome;
  message?: string;
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

/**
 * One probe's outcome: `served` = the route gave evidence for the probed protocol;
 * `route_missing` = 404/405; `server_error` = 5xx (proves nothing about the path);
 * `junk` = HTML / non-JSON / JSON matching no API shape; `timeout` / `network_error` =
 * the request itself failed.
 */
export type ProtocolProbeOutcome =
  "served" | "route_missing" | "server_error" | "junk" | "timeout" | "network_error";

/** One probe, for debugging display: the probed URL derives from baseUrl only (never contains the key). */
export interface ModelProtocolProbeDto {
  /** MMSP client type this probe stands for. */
  clientType: string;
  /** Full URL probed (base URL + the protocol's path). */
  url: string;
  outcome: ProtocolProbeOutcome;
  /** HTTP status, when a response arrived at all. */
  status?: number;
}

export interface ModelProtocolDetectResponse {
  /** The first protocol an endpoint serves (an MMSP client type); absent when none matched. */
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

// ---------------------------------------------------------------------------
// Balance (the group key's vendor account, read server-side)
// ---------------------------------------------------------------------------

export interface ModelBalanceAmount {
  /** Decimal string in `currency`'s major unit, as the vendor states it (TokenDance's micro-yuan are converted to yuan). */
  amount: string;
  /** ISO 4217 code: `CNY`, `USD`, … */
  currency: string;
}

/**
 * Why a group's balance could not be read:
 * - `unsupported`: the group publishes no balance endpoint (no `balance` descriptor in the catalog);
 * - `no_key`: the group has no API key to ask with — none stored, and no vendor variable that
 *   MMSP's vendor client reads for the group's base URL;
 * - `upstream_failed`: the vendor could not be reached in time, refused the request, or answered
 *   without a readable balance.
 */
export type ModelBalanceErrorCode = "unsupported" | "no_key" | "upstream_failed";

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
// The OAuth flow (model-oauth-service.ts's words and its mechanism)
// ---------------------------------------------------------------------------

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

/**
 * Lifetime of a flow. The upstream one-time code is valid for ten minutes, so a flow that
 * outlived that window can only ever fail — expiring it here keeps the verifier's residency
 * in memory bounded by the same figure.
 */
export const FLOW_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Promotions and refresh tokens (the rows web.db keeps for the models plumbing)
// ---------------------------------------------------------------------------

export interface ModelPromotion {
  provider: string;
  modelId: string;
  discount: number;
}

export interface ModelProviderAuthToken {
  provider: string;
  refreshToken: string;
  accessTokenExpiresAt?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mechanisms (what the server's services implement)
// ---------------------------------------------------------------------------

import { Interface } from "@prismshadow/penguin-core/kernel";

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
