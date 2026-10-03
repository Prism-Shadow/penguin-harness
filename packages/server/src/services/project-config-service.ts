/**
 * `.project_config.toml` read/write (single hidden config file).
 *
 * Doesn't reuse core's loadProjectConfig/saveProjectConfig (they only keep known
 * fields): reads and writes the complete object directly via smol-toml, preserving
 * extension fields like `name`. Connection values (api_key / base_url / client_type) live in
 * two layers of the same file: once per group in `[providers.<id>]`, and on a model entry
 * only where that model overrides its group (core's effectiveConnection resolves them, row ->
 * group -> none, per field). The built-in catalog is a reference written into the file — a new
 * Project, "Add new models", "Restore defaults" — and never read when a request is built: the
 * file is the only truth. There's no supplementary section or secrets file; since the
 * file contains secrets, it's always written with mode 0600. Plaintext only ever hits disk,
 * and is always masked in responses.
 *
 * Model references are **fully split into separate fields**: an entry is
 * stored as two independent fields, `provider` and `model_id`; the `(provider,
 * model_id)` pair is the entry's unique key. `model_id` is the upstream request id,
 * sent to MMSP verbatim — string concatenation like `<provider>/<id>` is
 * forbidden everywhere in the pipeline. `default_model` / `vision_model` are `{
 * provider, model_id }` paired references (TOML tables).
 *
 * Reads are memoized on the file's mtime (see readTable): every consumer of this
 * service — scheduler model-ref validation, the models/schedules routes, usage
 * pricing — shares one parsed table per on-disk version instead of re-reading and
 * re-parsing the TOML per call. The service's own writes all funnel through
 * `writeRaw`, which invalidates synchronously; external edits (CLI, hand edits) are
 * caught by the stat. The cached table is shared between callers and must be treated
 * as immutable — every mutating method here copies before changing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CHAT_APPROVAL_MODES,
  atomicWriteFile,
  DEFAULT_CHAT_THINKING_LEVELS,
  DEFAULT_COMMAND_POLICY_RULES,
  effectiveCommandPolicyRules,
  parseCommandPolicy,
  parsePluginTables,
  pluginTablesToToml,
  GenerativeModel,
  canonicalClientType,
  listEndpointModels as coreListEndpointModels,
  MODELSCOPE_PROVIDER_ID,
  PENGUIN_GO_PROVIDER_ID,
  catalogEntryFor,
  catalogModelEntries,
  catalogGroupConnection,
  defaultProjectConfig,
  effectiveConnection,
  groupKeyReaches,
  imageUrlMessage,
  metaMaxTokens,
  migrateProjectConfigTable,
  parseProviderTable,
  presetModelEntries,
  presetPromotions,
  presetProviderTable,
  projectConfigFromTable,
  projectConfigPath,
  providerConnectionShape,
  renderProjectConfigToml,
  modelEnvFallback,
  modelEnvPreviewKey,
  resolveEntryCredential,
  userText,
} from "@prismshadow/penguin-core";
import {
  VENDOR_ENDPOINTS,
  isAddableGroup,
  providerInfo,
  sameClientType,
  sameEndpoint,
  unaddableModel,
  unroutableVendorModel,
} from "@prismshadow/penguin-core/model-catalog";
import type {
  PluginTables,
  CommandPolicyRule,
  GenerativeModelConfig,
  LLMOutcome,
  ModelRequestContext,
  ModelRef,
  OmniMessage,
  ModelEntry,
  ProjectConfig,
  ProviderConnection,
  ProviderConnectionShape,
  ProviderTable,
} from "@prismshadow/penguin-core";
import type {
  ChatDefaultsDto,
  CommandPolicyDto,
  CommandPolicyRuleDto,
  EndpointModelListRequest,
  EndpointModelListResponse,
  ModelEffectiveConnection,
  ModelInfo,
  ModelPricingDto,
  ModelProtocolDetectRequest,
  ModelProtocolDetectResponse,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelTestResponse,
  ModelVisionDetectRequest,
  ModelVisionDetectResponse,
  PresetSyncMode,
  PresetSyncResponse,
  ProviderConnectionDto,
  ProviderConnectionUpdate,
} from "../api/types.js";
import { badRequest } from "../http/validate.js";
import { HttpError } from "../http/errors.js";
import { cacheable } from "../internal/mtime-gate.js";
import type {
  PlatformCatalogPricing,
  PlatformModelApplyResult,
  PlatformModelCatalog,
} from "./platform-auth-types.js";
import { detectModelProtocol } from "./protocol-detect.js";
import {
  VISION_PROBE_IMAGE,
  VISION_PROBE_MAX_TOKENS,
  VISION_PROBE_PROMPT,
  VISION_PROBE_TIMEOUT_MS,
  classifyVisionProbe,
  classifyVisionProbeError,
} from "./vision-detect.js";
import type { PricingRates, TieredRates } from "./usage-service.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Config, Paths } from "../hmr/capabilities.js";
import type {
  ModelPromotion,
  ModelProviderAuthToken,
  ModelProviderAuthTokens,
  ModelPromotions,
  ProjectConfigStore,
} from "../mechanisms/projects.js";

export type RawTable = Record<string, unknown>;

/**
 * API key masking: length <=12 -> `***`, otherwise `first4…last4`; plaintext is
 * never sent to the client. The 12-char threshold: `first4…last4` exposes 8
 * characters, which for a 9-12 character short secret would leak more than half of
 * it, so those are masked in full instead.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) return "***";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function asTable(v: unknown): RawTable {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RawTable) : {};
}

function asArray(v: unknown): RawTable[] {
  return Array.isArray(v) ? v.map(asTable) : [];
}

function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function platformPricingTable(pricing: PlatformCatalogPricing): RawTable {
  return {
    unit: pricing.unit,
    cache_read: pricing.cacheRead,
    cache_write: pricing.cacheWrite,
    output: pricing.output,
  };
}

function platformPricingMatches(value: unknown, pricing: PlatformCatalogPricing): boolean {
  const stored = asTable(value);
  return (
    stored.unit === pricing.unit &&
    stored.cache_read === pricing.cacheRead &&
    stored.cache_write === pricing.cacheWrite &&
    stored.output === pricing.output
  );
}

/**
 * A stored `pricing` table as the three buckets, or undefined when it holds none: one present
 * bucket is a price, and a missing one reads as 0.
 */
function pricingDtoOf(value: unknown): ModelPricingDto | undefined {
  const pricing = asTable(value);
  const cacheRead = optNum(pricing.cache_read);
  const cacheWrite = optNum(pricing.cache_write);
  const output = optNum(pricing.output);
  if (cacheRead === undefined && cacheWrite === undefined && output === undefined) {
    return undefined;
  }
  return { cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0, output: output ?? 0 };
}

/** The same three numbers, or both absent. */
function samePricing(a: ModelPricingDto | undefined, b: ModelPricingDto | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.output === b.output;
}

/** A promotion's fraction off every bucket, rounded to six decimals the way `tieredRates` rounds. */
function promotedRates(rates: PricingRates, discount: number): PricingRates {
  const off = (v: number): number => Math.round(v * (1 - discount) * 1e6) / 1e6;
  return {
    cacheRead: off(rates.cacheRead),
    cacheWrite: off(rates.cacheWrite),
    output: off(rates.output),
  };
}

/**
 * Both tiers of a price read from a Project's config.
 *
 * A scheduled row stores its PEAK price — the one number that is true whatever hour it is
 * written — and the reduced rate is derived here. Both are returned rather than one of them
 * chosen, because the caller prices a RANGE: a week that straddles a boundary holds Tokens of
 * both kinds, and each is billed at the rate it actually ran at. Choosing here would mean
 * pricing a finished week at whichever tier happened to be in force when someone opened the
 * page, which moves a settled number twice a day.
 *
 * The two tiers differ only while the stored price is still exactly the catalog's peak: once
 * the user has typed their own number, nothing here knows whether it is a peak rate, and
 * halving it would invent a discount. The models page's badge bails on the same condition, so
 * the card and the bill always agree about what this row costs.
 */
function tieredRates(provider: string, modelId: string, rates: PricingRates): TieredRates {
  const entry = catalogEntryFor(provider, modelId);
  const schedule = entry?.offPeakDiscount;
  if (schedule === undefined || entry?.pricing === undefined)
    return { peak: rates, offPeak: rates };
  const peak = entry.pricing;
  const untouched =
    rates.cacheRead === peak.cache_read &&
    rates.cacheWrite === peak.cache_write &&
    rates.output === peak.output;
  if (!untouched) return { peak: rates, offPeak: rates };
  const off = (v: number): number => Math.round(v * (1 - schedule.rate) * 1e6) / 1e6;
  return {
    peak: rates,
    offPeak: {
      cacheRead: off(rates.cacheRead),
      cacheWrite: off(rates.cacheWrite),
      output: off(rates.output),
    },
  };
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Command-policy rules as DTOs: per-rule `enabled` made explicit (stored absence = on). */
function toCommandPolicyRuleDtos(rules: readonly CommandPolicyRule[]): CommandPolicyRuleDto[] {
  return rules.map((r) => ({
    name: r.name,
    pattern: r.pattern,
    ...(r.description !== undefined ? { description: r.description } : {}),
    enabled: r.enabled !== false,
  }));
}

/** Leniently reads a paired reference table (default_model / vision_model); returns undefined on a shape mismatch (including the old string format). */
function optRef(v: unknown): ModelRef | undefined {
  const t = asTable(v);
  const provider = optStr(t.provider);
  const modelId = optStr(t.model_id);
  return provider !== undefined && modelId !== undefined
    ? { provider, model_id: modelId }
    : undefined;
}

/** Whether an entry matches a paired reference (the entry's provider / model_id fields must be strings). */
function entryMatches(m: RawTable, provider: string, modelId: string): boolean {
  return m.provider === provider && m.model_id === modelId;
}

/** In-process Map/Set key for a paired reference (\0-separated to avoid concatenation ambiguity; never persisted, not an id format). */
function refKey(provider: string, modelId: string): string {
  return `${provider}\0${modelId}`;
}

/** Display form of a paired reference (for error messages; display only, not a storage format). */
function showRef(provider: string, modelId: string): string {
  return `(provider=${provider}, model_id=${modelId})`;
}

/**
 * The `[providers]` table as the resolver reads it — core's lenient narrowing, so this service
 * and a Session can never disagree about a group's connection; `{}` when the file sets none.
 */
function providerTableOf(raw: RawTable): ProviderTable {
  return parseProviderTable(raw.providers) ?? {};
}

/** One group's stored connection in the resolver's shape; undefined when the group stores none. */
function providerShapeOf(raw: RawTable, provider: string): ProviderConnectionShape | undefined {
  return providerConnectionShape(providerTableOf(raw)[provider]);
}

/** A row's own connection fields — its overrides of the group's — in the resolver's shape. */
function ownConnection(
  m: RawTable,
  provider: string,
  modelId: string,
): { provider: string; modelId: string; clientType?: string; baseUrl?: string; apiKey?: string } {
  return {
    provider,
    modelId,
    clientType: canonicalClientType(optStr(m.client_type)),
    baseUrl: optStr(m.base_url),
    apiKey: optStr(m.api_key),
  };
}

/**
 * The connection a probe of one row's form draft is built with (the connectivity, speed and
 * vision probes): the draft's own values — the request's, else the stored row's — then the
 * group's `[providers.<id>]` table, then the client's defaults, under core's credential rule
 * (resolveEntryCredential, which throws where a Session would be refused). A row not stored
 * yet is probed from the request alone. "Clear" drops the row's own key and a `null` base URL
 * its own endpoint: the draft then follows its group, as the saved row would.
 */
function draftCredential(
  raw: RawTable,
  req: {
    provider: string;
    modelId: string;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl?: string | null;
    clientType?: string;
  },
): { apiKey?: string; baseUrl?: string; clientType?: string } {
  const entry = asArray(raw.models).find((m) => entryMatches(m, req.provider, req.modelId)) ?? {};
  return resolveEntryCredential(
    {
      provider: req.provider,
      model_id: req.modelId,
      // The pre-0.4.2 "openai" spelling (request or stored entry) is normalized to the
      // canonical "openai-chat" (deprecated upstream alias; see canonicalClientType).
      client_type: canonicalClientType(req.clientType ?? optStr(entry.client_type)),
      base_url: req.baseUrl === null ? undefined : (req.baseUrl ?? optStr(entry.base_url)),
      api_key: req.clearApiKey ? undefined : (req.apiKey ?? optStr(entry.api_key)),
    },
    providerShapeOf(raw, req.provider),
  );
}

/**
 * How many of a group's rows follow its group key: the ones that hold no key of their own and
 * that the key reaches (core's groupKeyReaches — no base URL of their own, or one on the
 * group's origin; custom's Atria, on its own host, is not one of them).
 */
function rowsFollowingGroupKey(raw: RawTable, provider: string): number {
  const groupBaseUrl = providerTableOf(raw)[provider]?.base_url;
  return asArray(raw.models).filter(
    (m) =>
      m.provider === provider &&
      typeof m.model_id === "string" &&
      groupKeyReaches(optStr(m.base_url), groupBaseUrl) &&
      (optStr(m.api_key)?.trim() ?? "") === "",
  ).length;
}

/** A group's stored connection as the page reads it: the group's own values, the key masked. */
function providerDto(p: ProviderConnection): ProviderConnectionDto {
  return {
    ...(p.base_url !== undefined ? { baseUrl: p.base_url } : {}),
    ...(p.client_type !== undefined ? { clientType: p.client_type } : {}),
    ...(p.api_key !== undefined ? { apiKeyMasked: maskApiKey(p.api_key) } : {}),
    ...(p.created_at !== undefined ? { createdAt: p.created_at } : {}),
  };
}

/**
 * Applies one group's connection change to a copy of the raw `[providers]` table, per field:
 * a value sets it, `null` (or a blank string) clears it, absent keeps it; a key stamps
 * `created_at`, clearing it removes that too. A member left with nothing is dropped. Rows are
 * not touched: a model with its own value keeps it — a row's own protocol always wins over its
 * group's, so any group takes one (Penguin Go's and OpenCode Go's rows each store theirs).
 *
 * Returns the new table and whether the group key was written or cleared by hand.
 */
function patchProviderTable(
  providers: RawTable,
  provider: string,
  patch: ProviderConnectionUpdate,
): { table: RawTable; keyChanged: boolean } {
  const clientType = patch.clientType?.trim();
  const member: RawTable = { ...asTable(providers[provider]) };
  if (patch.baseUrl !== undefined) {
    const baseUrl = patch.baseUrl?.trim();
    if (baseUrl) member.base_url = baseUrl;
    else delete member.base_url;
  }
  if (patch.clientType !== undefined) {
    if (clientType) member.client_type = canonicalClientType(clientType);
    else delete member.client_type;
  }
  let keyChanged = false;
  if (patch.clearApiKey === true) {
    delete member.api_key;
    delete member.created_at;
    keyChanged = true;
  }
  const apiKey = patch.apiKey?.trim();
  if (apiKey) {
    member.api_key = apiKey;
    member.created_at = new Date().toISOString();
    keyChanged = true;
  }
  const table: RawTable = { ...providers };
  if (Object.keys(member).length > 0) table[provider] = member;
  else delete table[provider];
  return { table, keyChanged };
}

/** Whether two parsed TOML values hold the same data, key order ignored. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameValue(v, b[i]))
    );
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const ta = a as RawTable;
  const tb = b as RawTable;
  const keys = Object.keys(ta);
  return (
    keys.length === Object.keys(tb).length &&
    keys.every((k) => Object.hasOwn(tb, k) && sameValue(ta[k], tb[k]))
  );
}

/**
 * What the catalog adds to an existing file — "Add new models", and the preset backfill of a
 * Project with no models: the non-retired presets the file lacks, and a catalog table for a
 * group the file has never heard of. Only additions: no existing row or table changes.
 *
 * Each added row's protocol and endpoint are stored against the file's own group table, per
 * field, so the row runs where the file says its group runs and never falls to the client's
 * default with the group's key:
 *
 * - the table HAS the field: the row stores only its catalog row's own difference from the
 *   catalog's group value, as a new Project's row does — a group the user pointed at a proxy
 *   takes its new rows along (OpenCode Go's Messages rows still carry their own endpoint);
 * - the table LACKS the field (the user cleared it, or the one-time migration did not hoist
 *   it): the row stores the field's full catalog value (its own pin, else its group's);
 * - a group with neither rows nor a table gets the catalog's table (catalogGroupConnection),
 *   and its rows are stored against that, as at init. A group with rows but no table gets none.
 *
 * Returns the `[providers]` table to write (the file's, plus the new tables) and the rows to
 * append, in catalog order.
 */
function presetAdditions(raw: RawTable): { providers: RawTable; added: ModelEntry[] } {
  const current = asArray(raw.models);
  const stored = new Set(current.map((m) => refKey(String(m.provider), String(m.model_id))));
  const groupsWithRows = new Set(current.map((m) => String(m.provider)));
  const fileTables = providerTableOf(raw);
  const missing = presetModelEntries().filter((m) => !stored.has(refKey(m.provider, m.model_id)));
  const providers: RawTable = { ...asTable(raw.providers) };
  // The table each group's added rows are stored against, field by field (see above).
  const reference: ProviderTable = {};
  for (const provider of new Set(missing.map((m) => m.provider))) {
    const catalog = catalogGroupConnection(provider);
    if (catalog === undefined) continue; // custom and the vendors: the rows' own values, whole.
    const file = fileTables[provider];
    if (file === undefined && !groupsWithRows.has(provider)) {
      providers[provider] = { ...catalog };
      reference[provider] = catalog;
      continue;
    }
    reference[provider] = {
      ...(file?.base_url !== undefined && catalog.base_url !== undefined
        ? { base_url: catalog.base_url }
        : {}),
      ...(file?.client_type !== undefined && catalog.client_type !== undefined
        ? { client_type: catalog.client_type }
        : {}),
    };
  }
  const added = presetModelEntries(reference).filter(
    (m) => !stored.has(refKey(m.provider, m.model_id)),
  );
  return { providers, added };
}

/**
 * The one value every model the platform advertises shares (an endpoint or a protocol, compared
 * with `same`) — the platform's value for its group, as the catalog derives a group's from its
 * rows — or undefined when they differ or there are none.
 */
function sharedPlatformValue(
  values: readonly string[],
  same: (a: string, b: string) => boolean,
): string | undefined {
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((v) => same(v, first)) ? first : undefined;
}

/** The latest of some ISO 8601 timestamps (an unparseable one loses), or undefined when there are none. */
function latestTimestamp(values: readonly unknown[]): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const [t, l] = [Date.parse(value), latest === undefined ? NaN : Date.parse(latest)];
    if (latest === undefined || Number.isNaN(l) || (!Number.isNaN(t) && t > l)) latest = value;
  }
  return latest;
}

/**
 * "Restore defaults"' last step: a key held on a group's rows moves to the group when that is
 * where it belongs — a built-in group (custom excepted: its rows each reach their own endpoint)
 * with no group key, whose keyed rows all hold one and the same key, and that key, as the
 * group's, would reach every one of them (groupKeyReaches, against the group's restored base
 * URL). The group takes it with the latest of the rows' `created_at`, and the rows hold it no
 * more; every row runs on the key it ran on. Rows with differing keys, or one the group key
 * would not reach, keep theirs. A key is never deleted. Returns new tables and rows; the
 * inputs are not changed.
 */
function relocateSharedKeys(
  providers: RawTable,
  models: readonly RawTable[],
): { providers: RawTable; models: RawTable[] } {
  const tables: RawTable = { ...providers };
  const rows = [...models];
  for (const provider of new Set(rows.map((m) => m.provider))) {
    if (typeof provider !== "string" || providerInfo(provider) === undefined) continue;
    if (provider === "custom") continue;
    const table = asTable(tables[provider]);
    if (optStr(table.api_key)?.trim()) continue;
    const keyed = rows.flatMap((m, i) =>
      m.provider === provider && optStr(m.api_key)?.trim() ? [i] : [],
    );
    const key = keyed.length > 0 ? rows[keyed[0]!]!.api_key : undefined;
    const groupBaseUrl = optStr(table.base_url);
    if (
      typeof key !== "string" ||
      !keyed.every(
        (i) => rows[i]!.api_key === key && groupKeyReaches(optStr(rows[i]!.base_url), groupBaseUrl),
      )
    ) {
      continue;
    }
    const createdAt = latestTimestamp(keyed.map((i) => rows[i]!.created_at));
    tables[provider] = {
      ...table,
      api_key: key,
      ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    };
    for (const i of keyed) {
      const { api_key: _key, created_at: _createdAt, ...rest } = rows[i]!;
      rows[i] = rest;
    }
  }
  return { providers: tables, models: rows };
}

/** The fields a catalog row's facts and connection live in — what "Restore defaults" resets. */
const RESTORED_ROW_FIELDS = new Set([
  "context_window",
  "pricing",
  "vision",
  "display_name",
  "max_tokens",
  "fast_mode",
  "base_url",
  "client_type",
  "request_model_id",
]);

/**
 * Connectivity probe prompt: asks for one word, so the whole exchange fits in a
 * single-digit output budget. The wording discourages reasoning and the trailing empty
 * <think></think> makes many reasoning models treat their thinking phase as already
 * closed - keeping the probe's tiny budget on actual output instead of burning it on
 * thinking.
 */
const PROBE_PROMPT =
  'ping - reply with the single word "pong" and nothing else. Do not think or explain.\n<think></think>';

/**
 * Endpoint model-listing bound: the SDK paginates `/models` under the hood, so one slow
 * or endless gateway must not pin the add-group dialog — 20s matches the connectivity
 * test's request timeout.
 */
const LIST_MODELS_TIMEOUT_MS = 20_000;

/**
 * Speed probe prompt: a one-word answer can't be timed (a compliant model emits 1-3
 * tokens, and the window is then dominated by the final usage chunk's round trip), so
 * speed mode asks for something long enough to run into its raised cap. Counting to 50 is
 * deterministic and needs no knowledge, so every model produces the same token stream at
 * its own decoding rate. Carries the same anti-thinking hint as the connectivity prompt.
 */
const SPEED_PROBE_PROMPT =
  "Count from 1 to 50 as a comma-separated list, and nothing else. Do not think or explain.\n<think></think>";

/**
 * Bounds for a one-off utility completion (see completeOnce). The budget is core's own
 * meta-request budget, the one `createBareLLM` sizes session titles and vision descriptions
 * with, tightened by the entry's pinned per-model cap: an identifier is a handful of tokens,
 * but on a reasoning model the thinking is spent out of the same cap, and a budget cut to the
 * size of the answer leaves the answer itself with nothing (`finish_reason=length` before a
 * single text token — the failure the connectivity probe's `probeVerdict` tolerates by name).
 * The caller is a dialog waiting on the answer, so the wait stays short.
 */
const UTILITY_COMPLETION_BUDGET = 300;
const UTILITY_COMPLETION_TIMEOUT_MS = 15_000;

/**
 * What one utility completion produced: the model's text, or why there is none. A bare null
 * would say "no answer" and nothing else — and every one of these failures (no model
 * configured, a missing credential, a provider rejection, a timeout, an answer that was all
 * thinking) is one the user can act on, so the reason travels to the caller, which records it.
 */
export type UtilityCompletion =
  | { ok: true; text: string }
  | {
      ok: false;
      /** `no_model`: the Project names no default model, or names one it has no entry for — nothing was asked. `failed`: the model was asked and produced no text. */
      cause: "no_model" | "failed";
      error: string;
    };

/** How much of a failure detail is kept for display; the error recorder truncates again at its own bound. */
const MAX_FAILURE_DETAIL = 300;

/**
 * What a request that did not complete has to say: the provider's own message when the outcome
 * carries one, and the bare status (`aborted`, a `retryable` idle timeout) when it does not.
 */
function outcomeDetail(outcome: LLMOutcome): string {
  const detail = outcome.errorMessage ? outcome.errorMessage : outcome.status;
  return String(detail).slice(0, MAX_FAILURE_DETAIL);
}

/**
 * The model config one utility completion runs with, built from the Project's default model
 * entry. Exported because two of its fields decide whether an answer arrives at all, and
 * reading them here costs no network:
 *
 * - `thinkingLevel: "none"`, the level core's own out-of-band requests use. Every provider the
 *   product ships works with it; a level that leaves thinking on spends the budget below on
 *   reasoning nobody reads.
 * - `maxTokens`: the shared meta budget, tightened by the entry's pinned per-model cap — never
 *   a budget cut to the size of an identifier. A reasoning model spends its thinking out of the
 *   same cap, so a budget that small ends the request at `finish_reason=length` with the answer
 *   never started (see `probeVerdict`, which tolerates exactly that ending for the probe).
 */
export function utilityCompletionConfig(
  modelId: string,
  entry: Record<string, unknown>,
  provider?: ProviderConnection,
): GenerativeModelConfig {
  // The connection is the entry's effective one — its own values, then its group's
  // `[providers.<id>]` table, then the client's defaults — under the same credential rule as
  // every other client the harness builds (core's resolveEntryCredential): a keyless entry
  // pointed away from its vendor throws here, which completeOnce reports as the failure it is.
  const { clientType, ...credential } = resolveEntryCredential(
    {
      provider: optStr(entry.provider) ?? "",
      model_id: modelId,
      client_type: canonicalClientType(optStr(entry.client_type)),
      base_url: optStr(entry.base_url),
      api_key: optStr(entry.api_key),
    },
    providerConnectionShape(provider),
  );
  return {
    modelId,
    ...credential,
    ...(clientType ? { clientType } : {}),
    tools: [],
    thinkingLevel: "none",
    maxTokens: metaMaxTokens(UTILITY_COMPLETION_BUDGET, optNum(entry.max_tokens)),
    requestTimeoutMs: UTILITY_COMPLETION_TIMEOUT_MS,
  };
}

/**
 * Drains a model stream into the answer's text, or the reason there is none.
 *
 * Complete `text` messages only. Every partial fragment is backfilled into one complete `text`
 * message when the stream ends — on a normal finish and on an interrupted one alike (the
 * translator's `finish` and `finishInterrupted` both flush the text buffer) — so counting both
 * would return the answer twice, and counting only the partials would drop nothing but gain
 * nothing either. A stream that carried only thinking leaves the buffer empty, and the
 * terminal outcome is then what has something to say about why.
 */
export async function collectUtilityCompletion(
  stream: AsyncGenerator<OmniMessage, LLMOutcome>,
): Promise<UtilityCompletion> {
  let text = "";
  for (;;) {
    const step = await stream.next();
    if (step.done) {
      if (text.trim() !== "") return { ok: true, text };
      return { ok: false, cause: "failed", error: outcomeDetail(step.value) };
    }
    const p = step.value.payload as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") text += p.text;
  }
}

@Component()
export class ProjectConfigService implements ProjectConfigStore {
  /**
   * Parsed-table cache, one entry per Project, keyed by the config file's mtime as
   * recorded at read time (a fresh mtime is stored as a never-matching sentinel, see
   * mtime-gate). A repeat read while the stat still matches costs one stat and zero
   * parses; a mismatch (external edit) or a service write (writeRaw deletes the
   * entry) falls back to a full read.
   */
  private readonly cache = new Map<string, { mtimeMs: number; table: RawTable }>();
  private readonly providerCredentialLocks = new Map<string, Promise<unknown>>();
  private modelApiKeyResolver:
    ((context: ModelRequestContext) => Promise<string | undefined>) | undefined;

  @Use() private readonly paths!: Paths;
  /** Optional for narrow service tests; the production Projects module always provides it. */
  @Use() private readonly promotions?: ModelPromotions;
  /** Optional for narrow service tests; OAuth refresh metadata lives in web.db, not TOML. */
  @Use() private readonly providerAuthTokens?: ModelProviderAuthTokens;
  private get root(): string {
    return this.paths.root;
  }

  private filePath(projectId: string): string {
    return projectConfigPath(this.root, projectId);
  }

  setModelApiKeyResolver(
    resolver: (context: ModelRequestContext) => Promise<string | undefined>,
  ): void {
    this.modelApiKeyResolver = resolver;
  }

  private requestApiKeyResolver(
    projectId: string,
    provider: string,
    modelId: string,
    enabled = true,
  ): Pick<GenerativeModelConfig, "resolveApiKey"> | Record<string, never> {
    if (!enabled || this.modelApiKeyResolver === undefined) return {};
    return {
      resolveApiKey: () => this.modelApiKeyResolver!({ projectId, provider, modelId }),
    };
  }

  private async withProviderCredentialLock<T>(
    projectId: string,
    provider: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = `${projectId}\0${provider}`;
    const previous = this.providerCredentialLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const current = previous.catch(() => undefined).then(() => gate);
    this.providerCredentialLocks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.providerCredentialLocks.get(key) === current)
        this.providerCredentialLocks.delete(key);
    }
  }

  /**
   * When the Project config (models/credentials) last changed: the config file's mtime as
   * ISO — an honest persistent source that survives server restarts (every models update
   * rewrites the file). undefined when the file doesn't exist yet.
   */
  private async configUpdatedAt(projectId: string): Promise<string | undefined> {
    try {
      const st = await fs.stat(this.filePath(projectId));
      return st.mtime.toISOString();
    } catch {
      return undefined;
    }
  }

  /** Reads the raw TOML object; returns an empty object if the file doesn't exist (does not write to disk). */
  async readRaw(projectId: string): Promise<RawTable> {
    return (await this.readTable(projectId)) ?? {};
  }

  /**
   * mtime-gated read of the parsed table; null when the file doesn't exist (readRaw
   * flattens that to `{}`, loadConfig to the preset default config — the two
   * pre-existing missing-file behaviors). Serving the shared cached object is safe
   * because no consumer mutates it (see the class header).
   */
  private async readTable(projectId: string): Promise<RawTable | null> {
    const file = this.filePath(projectId);
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(file)).mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.cache.delete(projectId); // Config deleted (or the whole Project): drop the stale entry.
      return null;
    }
    const cached = this.cache.get(projectId);
    if (cached && cached.mtimeMs === mtimeMs) return cached.table;
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.cache.delete(projectId); // Vanished between stat and read: same as never existing.
      return null;
    }
    const table = asTable(parseToml(raw));
    if (migrateProjectConfigTable(table)) {
      // A file from before MMSP 0.5.0 or before group-level connections (core's
      // migrateProjectConfigTable): rewritten once, before it is served; the next read parses
      // the rewritten file (writeRaw drops the cache). Every file writeRaw renders carries a
      // `[providers]` table, which is what keeps the key hoist from ever running on it again.
      // Removed with the two migrations at the 0.3.0 release preparation.
      await this.writeRaw(projectId, table);
      return table;
    }
    this.cache.set(projectId, { mtimeMs: cacheable(mtimeMs), table });
    return table;
  }

  /**
   * Typed view of the same cached table — byte-for-byte the semantics of core's
   * `loadProjectConfig` (missing file → preset default config; legacy format → the
   * same error, via core's shared narrowing) without its per-call readFile + parse.
   * Serves the scheduler's model-ref validation (see schedule-store).
   */
  async loadConfig(projectId: string): Promise<ProjectConfig> {
    const table = await this.readTable(projectId);
    if (table === null) return defaultProjectConfig();
    return projectConfigFromTable(this.filePath(projectId), table);
  }

  /**
   * Writes the whole object to disk: the file inlines secrets like api_key, always
   * written with mode 0600, and replaced atomically so a crash mid-write cannot
   * truncate it — matching core's saveProjectConfig behavior.
   */
  async writeRaw(projectId: string, data: RawTable): Promise<void> {
    const file = this.filePath(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Rendering goes through core's single writer: paired references become inline
    // tables, models is placed last — matching the CLI's output format exactly
    // (the same file should never have two formats).
    await atomicWriteFile(file, renderProjectConfigToml(data), {
      mode: 0o600,
      followSymlinks: true,
    });
    // Every service write funnels through here: invalidate synchronously so the next
    // read re-parses (external writers are caught by readTable's stat instead).
    this.cache.delete(projectId);
  }

  /**
   * Initial config for a newly created Project: display name + preset built-in
   * model catalog (the default model, each built-in group's endpoint and protocol in
   * `[providers.<id>]`, and all preset entries, sourced from the same core
   * defaultProjectConfig; an entry stores its catalog facts, plus a protocol or endpoint only
   * where it differs from its group's table — and no key). From here on the file alone says
   * where every request goes; the catalog is not read again when one is built. Users only need
   * to fill in an API key as needed, once per group (leave it blank to fall back to the
   * provider's environment variable).
   */
  async writeInitialConfig(projectId: string, name: string): Promise<void> {
    const preset = defaultProjectConfig();
    await this.writeRaw(projectId, {
      name,
      ...(preset.default_model !== undefined ? { default_model: preset.default_model } : {}),
      // The factory command-policy rules are seeded exactly like the model presets:
      // copied in at creation, owned by the project from then on.
      ...(preset.command_policy !== undefined ? { command_policy: preset.command_policy } : {}),
      ...(preset.providers !== undefined ? { providers: preset.providers } : {}),
      models: preset.models,
    });
  }

  /**
   * Backfills preset models (for onboarding an existing Project, e.g. the
   * `default_project` shared with the CLI when the first user is onboarded — its
   * directory already existed and never went through `writeInitialConfig`, so it
   * previously had no models and no default model).
   *
   * **Only backfills when there are no models at all**: a Project that already has
   * models configured (via the CLI or edited by the user) is left as-is, and its
   * other fields (name, etc.) are preserved too — existing config is never
   * overwritten. The built-in groups' tables come with the rows, as at init, except that a
   * table the file already holds is kept as it is and the rows are stored against it
   * (presetAdditions). Returns whether it wrote the presets, which is when their promotions
   * are to be seeded too (seedPresetPromotions).
   */
  async ensurePresetModels(projectId: string): Promise<boolean> {
    const raw = await this.readRaw(projectId);
    if (asArray(raw.models).length > 0) return false;
    const preset = defaultProjectConfig();
    const { providers, added } = presetAdditions(raw);
    await this.writeRaw(projectId, {
      ...raw,
      // Also reset to the preset default_model if the existing one points at a now-deleted model, to keep the default model valid.
      ...(preset.default_model !== undefined ? { default_model: preset.default_model } : {}),
      providers,
      models: added,
    });
    return true;
  }

  /**
   * Stores the built-in catalog's flat promotions for a Project just seeded with the preset
   * models: the file carries their list prices, and these fractions are the rest of what the
   * presets bill. The rows reference the Project's `projects` row (foreign keys are enforced),
   * so this runs once that row exists.
   */
  async seedPresetPromotions(projectId: string): Promise<void> {
    this.promotions?.replaceAll(projectId, presetPromotions());
  }

  /** Project display name (the toml's name; returns undefined if unset, the frontend falls back to displaying the id). */
  async getName(projectId: string): Promise<string | undefined> {
    const raw = await this.readRaw(projectId);
    return typeof raw.name === "string" ? raw.name : undefined;
  }

  /**
   * Rewrites the display name, preserving every other field (models, credentials, default
   * model): read-modify-write of the same toml, like ensurePresetModels. The id itself is
   * immutable — only this label changes.
   */
  async setName(projectId: string, name: string): Promise<void> {
    const raw = await this.readRaw(projectId);
    await this.writeRaw(projectId, { ...raw, name });
  }

  /** Paired reference of the default Model; returns undefined if unconfigured (or in the old string format). */
  async getDefaultModelRef(projectId: string): Promise<ModelRef | undefined> {
    const raw = await this.readRaw(projectId);
    return optRef(raw.default_model);
  }

  /**
   * Sets the default Model to an already-configured entry (the narrow
   * PUT /models/default route): rewrites only the top-level `default_model` — the SAME key
   * the models page's whole-table PUT maintains, so the two surfaces stay single-sourced —
   * preserving every other field via read-modify-write. The pair must name an entry in
   * `models` (the identical rule updateModels applies to `defaultModel`); a reference
   * outside the config is a 400, since createSession would error on it immediately. No
   * runtime invalidation: existing Sessions pin their model at creation, and this route
   * never touches credentials.
   */
  async setDefaultModelRef(projectId: string, ref: ModelRefDto): Promise<ModelRefDto> {
    const raw = await this.readRaw(projectId);
    if (!asArray(raw.models).some((m) => entryMatches(m, ref.provider, ref.modelId))) {
      throw badRequest(
        `defaultModel must be included in models: ${showRef(ref.provider, ref.modelId)}.`,
      );
    }
    await this.writeRaw(projectId, {
      ...raw,
      default_model: { provider: ref.provider, model_id: ref.modelId },
    });
    return { provider: ref.provider, modelId: ref.modelId };
  }

  /**
   * New-chat defaults (`[default_chat]`): read leniently — same tolerance as core's
   * loadProjectConfig (an invalid value drops that key; a missing/malformed block reads as
   * empty). Members may read; only the fields present in the file appear in the DTO.
   */
  async getChatDefaults(projectId: string): Promise<ChatDefaultsDto> {
    const raw = await this.readRaw(projectId);
    const t = asTable(raw.default_chat);
    const agentId = optStr(t.agent_id);
    const workspace = optStr(t.workspace);
    const approval = optStr(t.approval_mode);
    const thinking = optStr(t.thinking_level);
    return {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(approval !== undefined && (CHAT_APPROVAL_MODES as readonly string[]).includes(approval)
        ? { approvalMode: approval as ChatDefaultsDto["approvalMode"] }
        : {}),
      ...(thinking !== undefined &&
      (DEFAULT_CHAT_THINKING_LEVELS as readonly string[]).includes(thinking)
        ? { thinkingLevel: thinking as ChatDefaultsDto["thinkingLevel"] }
        : {}),
    };
  }

  /**
   * Replaces the whole `[default_chat]` block (declarative PUT: an omitted key clears it;
   * an empty request removes the block entirely, restoring the pre-existing behavior).
   * Field validation (enums / agent existence) happens at the route; this is a
   * read-modify-write like setName — every other field (models, credentials, name, the
   * default model) is preserved. Returns the stored block as re-read from disk.
   */
  async setChatDefaults(projectId: string, req: ChatDefaultsDto): Promise<ChatDefaultsDto> {
    const raw = await this.readRaw(projectId);
    const block: RawTable = {
      ...(req.agentId !== undefined ? { agent_id: req.agentId } : {}),
      ...(req.workspace !== undefined ? { workspace: req.workspace } : {}),
      ...(req.approvalMode !== undefined ? { approval_mode: req.approvalMode } : {}),
      ...(req.thinkingLevel !== undefined ? { thinking_level: req.thinkingLevel } : {}),
    };
    const next: RawTable = { ...raw };
    if (Object.keys(block).length > 0) next.default_chat = block;
    else delete next.default_chat;
    await this.writeRaw(projectId, next);
    return this.getChatDefaults(projectId);
  }

  /**
   * Sandbox command policy (`[command_policy]`): read leniently, mirroring core's
   * loadProjectConfig tolerance — a non-boolean `enabled` reads as true (the default), a
   * rule missing name or pattern is dropped, and an absent (or non-array) `rules` value
   * serves the factory set: a project from before the block was seeded behaves as the
   * defaults until its first saved edit materializes them. The factory set also rides
   * along as `defaultRules` for the settings UI's "restore defaults".
   */
  async getCommandPolicy(projectId: string): Promise<CommandPolicyDto> {
    const raw = await this.readRaw(projectId);
    // Core's shared narrowing + the single "absent = factory set" fallback: this GET can
    // never disagree with what the Environment snapshot will enforce.
    const policy = parseCommandPolicy(raw.command_policy);
    return {
      enabled: policy?.enabled !== false,
      rules: toCommandPolicyRuleDtos(effectiveCommandPolicyRules(policy)),
      defaultRules: toCommandPolicyRuleDtos(DEFAULT_COMMAND_POLICY_RULES),
    };
  }

  /**
   * Replaces the `[command_policy]` block (declarative PUT, validated at the route). A PUT
   * always materializes the full rule list into the file — model-presets style: once
   * written, later factory changes never rewrite it — storing per field only what departs
   * from the defaults (`enabled = false`, a rule's `enabled = false`, a non-empty
   * description). Read-modify-write like setChatDefaults, preserving every other key.
   * Returns the block as re-read.
   */
  async setCommandPolicy(
    projectId: string,
    req: {
      enabled?: boolean;
      rules: { name: string; pattern: string; description?: string; enabled?: boolean }[];
    },
  ): Promise<CommandPolicyDto> {
    const raw = await this.readRaw(projectId);
    const block: RawTable = {};
    if (req.enabled === false) block.enabled = false;
    block.rules = req.rules.map((r) => ({
      name: r.name,
      pattern: r.pattern,
      ...(r.description !== undefined && r.description !== ""
        ? { description: r.description }
        : {}),
      ...(r.enabled === false ? { enabled: false } : {}),
    }));
    await this.writeRaw(projectId, { ...raw, command_policy: block });
    return this.getCommandPolicy(projectId);
  }

  /**
   * The `[plugins]` key this Project writes: the shared table and each machine's own, in the
   * file's order; both empty when it asks for none.
   */
  async getPluginTables(projectId: string): Promise<PluginTables> {
    return parsePluginTables((await this.readRaw(projectId)).plugins) ?? { all: {}, machines: {} };
  }

  /**
   * Replaces this Project's plugin tables (a declarative PUT, validated at the route).
   * Read-modify-write like setCommandPolicy, so every other key survives. An empty table is
   * written as an empty table rather than removed: "this Project asks for none" is a
   * decision, and a reader cannot tell it from "never configured" if the key vanishes.
   */
  async setPluginTables(projectId: string, tables: PluginTables): Promise<PluginTables> {
    const raw = await this.readRaw(projectId);
    await this.writeRaw(projectId, { ...raw, plugins: pluginTablesToToml(tables) });
    return this.getPluginTables(projectId);
  }

  /**
   * Pricing lookup for usage-recorder: the current pricing for this paired reference (undefined
   * if none -> cost is NULL). The file holds the list price; a stored promotion takes its
   * fraction off both tiers, so a scheduled row on a promotion bills the two factors multiplied.
   */
  async getPricing(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<TieredRates | undefined> {
    const raw = await this.readRaw(projectId);
    const entry = asArray(raw.models).find((m) => entryMatches(m, provider, modelId));
    const rates = pricingDtoOf(entry?.pricing);
    if (rates === undefined) return undefined;
    const tiered = tieredRates(provider, modelId, rates);
    const discount = this.promotions?.get(projectId, provider, modelId);
    if (discount === undefined) return tiered;
    return {
      peak: promotedRates(tiered.peak, discount),
      offPeak: promotedRates(tiered.offPeak, discount),
    };
  }

  /**
   * Model connectivity test: the model reference `(provider, modelId)` is submitted
   * as a pair in the request body; sends one minimal request using that model's
   * config (optionally overridden with an unsaved apiKey / baseUrl) — no tools, no
   * system prompt, thinking at the lowest level, a tiny output cap, 20s timeout —
   * just to see whether the endpoint answers. The model id sent to MMSP is
   * `modelId` itself (the upstream id verbatim; without a client_type, MMSP routes it
   * by the vendor family the id begins with).
   *
   * A reasoning-heavy model can spend the whole tiny output cap on thinking
   * (finish_reason=length with no text — MMSP raises EmptyResponseError,
   * collapsed to a malformed outcome): the endpoint demonstrably streamed model
   * output, which is everything a connectivity test proves, so that case counts as
   * ok too (see probeVerdict).
   *
   * Never throws: the LLM layer collapses auth/parameter/network errors into an
   * `LLMOutcome`, which is translated here into ok / message. Consumes very few
   * Tokens (single-digit output; speed mode spends up to its 64-token cap to have a
   * window worth timing), and writes no Trace and records no usage.
   */
  /**
   * Vision capability probe: sends one 1x1 PNG plus a one-word prompt and reports whether
   * the model took it (see services/vision-detect.ts for the verdict rules and why this
   * one costs real money, unlike the protocol probes).
   *
   * Credential resolution is the connectivity test's, verbatim — the draft row (the request's
   * key, else the row's own unless "clear" is checked), then the group's `[providers.<id>]`
   * connection, then the environment where core's credential rule allows it
   * (the vendor's own endpoint; never a gateway's). Nothing secret is returned; the failure
   * message is the provider's own text, truncated.
   */
  async detectVision(
    projectId: string,
    req: ModelVisionDetectRequest,
  ): Promise<ModelVisionDetectResponse> {
    const raw = await this.readRaw(projectId);
    try {
      // Inside the try for the same reason as testModel: both the credential rule's refusal
      // and the SDK's own missing-credential throw at construction must read as "probe
      // failed", not a 500.
      const { clientType, ...credential } = draftCredential(raw, req);
      const llm = new GenerativeModel({
        modelId: req.modelId,
        ...credential,
        ...this.requestApiKeyResolver(
          projectId,
          req.provider,
          req.modelId,
          req.apiKey === undefined && req.clearApiKey !== true,
        ),
        ...(clientType ? { clientType } : {}),
        tools: [],
        // The lowest real level, not "none": several reasoning endpoints reject a request
        // that disables thinking outright, and a probe must not fail on the knob it sends.
        thinkingLevel: "low",
        maxTokens: VISION_PROBE_MAX_TOKENS,
        requestTimeoutMs: VISION_PROBE_TIMEOUT_MS,
      });
      // Both parts must carry role "user" — a mixed-role batch is rejected before it is
      // sent (see generative-model's UniMessage merge).
      const gen = llm.streamGenerate({
        newMessages: [userText(VISION_PROBE_PROMPT), imageUrlMessage(VISION_PROBE_IMAGE)],
      });
      let sawContent = false;
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          const outcome = classifyVisionProbe(step.value, sawContent);
          if (outcome !== "failed") return { outcome };
          return { outcome, message: outcomeDetail(step.value) };
        }
        if (isProbeContent(step.value)) sawContent = true;
      }
    } catch (err) {
      const outcome = classifyVisionProbeError(err);
      if (outcome !== "failed") return { outcome };
      return {
        outcome,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    }
  }

  /**
   * One short completion on the Project's **default** model, for utility asks that belong to
   * no Session — today the English identifier a display name is translated into. Everything
   * comes from the stored default entry (credential, base URL, pinned protocol), and the
   * answer is the model's plain text. Nothing throws: no default model, no entry for it, a
   * construction that throws on a missing credential, a refusal, a timeout, or an answer with
   * no text all come back as `{ ok: false }` carrying the reason, which the caller records so
   * the errors panel can say why the ask produced nothing. Callers must still have a result
   * that works without it. The request is not metered — it carries no Session to attribute
   * it to.
   *
   * Thinking is off and the budget is the shared meta budget, for the same reason core's own
   * out-of-band requests set them that way: a reasoning model spends thinking out of
   * `maxTokens`, so a budget the size of the answer ends the request at `finish_reason=length`
   * with no text at all.
   */
  async completeOnce(projectId: string, prompt: string): Promise<UtilityCompletion> {
    const raw = await this.readRaw(projectId);
    const ref = optRef(raw.default_model);
    if (ref === undefined) {
      return { ok: false, cause: "no_model", error: "the Project names no default model" };
    }
    const entry = asArray(raw.models).find((m) => entryMatches(m, ref.provider, ref.model_id));
    if (entry === undefined) {
      return {
        ok: false,
        cause: "no_model",
        error: `the default model ${ref.provider}/${ref.model_id} has no entry in the Project config`,
      };
    }
    try {
      // Inside the try for the same reason as the probes: the SDK throws during
      // construction when a credential is missing, and that must read as a failure with a
      // reason rather than an exception out of a dialog's helper.
      const llm = new GenerativeModel({
        ...utilityCompletionConfig(ref.model_id, entry, providerTableOf(raw)[ref.provider]),
        ...this.requestApiKeyResolver(projectId, ref.provider, ref.model_id),
      });
      return await collectUtilityCompletion(
        llm.streamGenerate({ newMessages: [userText(prompt)] }),
      );
    } catch (err) {
      return {
        ok: false,
        cause: "failed",
        error: (err instanceof Error ? err.message : String(err)).slice(0, MAX_FAILURE_DETAIL),
      };
    }
  }

  async testModel(projectId: string, req: ModelTestRequest): Promise<ModelTestResponse> {
    const raw = await this.readRaw(projectId);
    // Testable even if the model isn't in the config yet (validate before saving when adding a custom model): in that case all parameters come from the request body.
    const entry = asArray(raw.models).find((m) => entryMatches(m, req.provider, req.modelId)) ?? {};
    // Fast mode follows the form draft like baseUrl (the frontend always sends the current
    // toggle), falling back to the stored annotation: the probe then exercises exactly the
    // serving tier sessions would use, so a model rejecting fast_mode fails the test with
    // the actionable message before the config is saved.
    const fastMode = req.fastMode ?? entry.fast_mode === true;

    const startedAt = Date.now();
    try {
      // Credential resolution and construction must both be inside the try block: core's
      // credential rule refuses a keyless entry pointed away from its vendor (a gateway row
      // never borrows OPENAI_API_KEY / ANTHROPIC_API_KEY from the server environment — the
      // group speed test runs through here too), and the provider SDK can throw during
      // **client construction** itself when a credential is missing. The whole point of a
      // connectivity test is to collapse that kind of failure into `{ ok:false }`; outside
      // the try, a missing-key test would bubble up as a 500.
      //
      // Always tests against the **current form draft** (draftCredential): checking "clear"
      // means the row's saved key is not fallen back to, and an explicit null base URL means
      // the row has none of its own — either way the row then follows its group's connection,
      // else the client's defaults, exactly as it would once saved.
      const { clientType, ...credential } = draftCredential(raw, req);
      const llm = new GenerativeModel({
        modelId: req.modelId,
        ...credential,
        ...this.requestApiKeyResolver(
          projectId,
          req.provider,
          req.modelId,
          req.apiKey === undefined && req.clearApiKey !== true,
        ),
        ...(clientType ? { clientType } : {}),
        ...(fastMode ? { fastMode: true } : {}),
        tools: [],
        // The lowest real level, not "none": several reasoning endpoints reject a request
        // that disables thinking outright, and a probe must not fail on the knob it sends.
        thinkingLevel: "low",
        // Speed mode pairs a raised cap with a prompt that keeps generating (see
        // SPEED_PROBE_PROMPT), so the stream lasts long enough for TTFT/TPS to describe
        // decoding rather than one round trip; the plain connectivity test keeps the
        // single-digit-token budget.
        maxTokens: req.speed ? 64 : 16,
        requestTimeoutMs: 20_000,
      });
      const gen = llm.streamGenerate({
        newMessages: [userText(req.speed ? SPEED_PROBE_PROMPT : PROBE_PROMPT)],
      });
      let sawContent = false;
      let firstContentAt: number | null = null;
      let outputTokens = 0;
      for (;;) {
        const step = await gen.next();
        if (step.done) {
          const verdict = probeVerdict(step.value, sawContent);
          if (!verdict.ok) return verdict;
          const res: ModelTestResponse = { ok: true, latencyMs: Date.now() - startedAt };
          if (firstContentAt !== null) {
            res.ttftMs = firstContentAt - startedAt;
            // Output rate over the streaming window (first content -> stream end), dropped
            // when the sample is too small to mean anything (see probeTps): usage is only
            // reported on completed streams, so thinking-only malformed endings carry TTFT
            // but no rate, and so does a model that answers in a couple of tokens.
            const tps = probeTps(outputTokens, Date.now() - firstContentAt);
            if (tps !== undefined) res.tps = tps;
          }
          return res;
        }
        if (isProbeContent(step.value)) {
          sawContent = true;
          if (firstContentAt === null) firstContentAt = Date.now();
        }
        const p = step.value.payload as { type?: string; request?: { output?: number } };
        if (p.type === "token_usage" && typeof p.request?.output === "number") {
          outputTokens = p.request.output;
        }
      }
    } catch (err) {
      // Defensive: an unexpected exception during construction/iteration (the LLM layer promises not to throw; this is a fallback).
      return {
        ok: false,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    }
  }

  /**
   * Protocol detection for a custom base URL (see services/protocol-detect.ts for the
   * probe order and classification). Credential resolution has four layers, in order:
   *   1. the request body's key (what the user just typed in the dialog);
   *   2. otherwise, when the optional paired reference names a stored entry and "clear"
   *      isn't checked, that entry's own saved key (the frontend only ever sees the mask);
   *   3. otherwise the group's key (`[providers.<id>]`) — for a row whose own key is absent
   *      or cleared, since that row then follows its group, and for a request naming the
   *      group alone (the group settings dialog has no model), unless "clear" is checked
   *      there, which clears the group key itself;
   *   4. otherwise the environment: a provider-scoped variable (the Penguin Go relay's
   *      PENGUIN_GO_API_KEY) resolved here for the group's rows, and otherwise the variable
   *      of whichever protocol each probe speaks, resolved inside detectModelProtocol
   *      because the protocol is the thing being determined — and only for a URL that is
   *      the vendor's own (see core's endpointEnvApiKey), never for a gateway or a private
   *      server.
   * Layers 2 to 4 are read server-side only and never travel back to the browser.
   * Detection still runs with no credential at all: a protocol-shaped 401/403 proves the
   * route. Never throws on probe failures — every outcome is reported per probe.
   */
  async detectProtocol(
    projectId: string,
    req: ModelProtocolDetectRequest,
  ): Promise<ModelProtocolDetectResponse> {
    let apiKey = req.apiKey;
    let savedClientType: string | undefined;
    if (apiKey === undefined && req.provider) {
      const raw = await this.readRaw(projectId);
      const group = providerTableOf(raw)[req.provider];
      if (req.modelId) {
        const entry = asArray(raw.models).find((m) =>
          entryMatches(m, req.provider as string, req.modelId as string),
        );
        // The key the row is used with — its own unless the clear box is ticked, else its
        // group's where the group reaches it (core's effectiveConnection decides both).
        const { apiKey: ownKey, ...own } = ownConnection(entry ?? {}, req.provider, req.modelId);
        const effective = effectiveConnection(
          req.clearApiKey ? own : { ...own, apiKey: ownKey },
          providerConnectionShape(group),
        );
        apiKey = effective.apiKey;
        savedClientType = effective.clientType;
      } else if (!req.clearApiKey) {
        apiKey = group?.api_key;
      }
    }
    if (apiKey === undefined && req.provider) {
      // A provider-scoped pair (the relay's) is the harness's to read, for any URL in that
      // group; a vendor pair is left to the per-probe rule in detectModelProtocol. Without a
      // relay key, anonymous probing is still safe and can identify a route from its 401.
      const fallback = modelEnvFallback({
        provider: req.provider,
        modelId: req.modelId ?? "",
        clientType: savedClientType,
      });
      if (fallback !== undefined && !fallback.readByClient) {
        apiKey = process.env[fallback.envKey]?.trim() || undefined;
      }
    }
    return detectModelProtocol({
      baseUrl: req.baseUrl,
      ...(apiKey ? { apiKey } : {}),
    });
  }

  /**
   * Endpoint model listing for the add-group import (see EndpointModelListRequest). All
   * parameters come from the request — a group being created has no stored entry to fall
   * back to; an omitted key is lent the protocol's environment variable only when the URL is
   * that vendor's own (core's endpointEnvApiKey), and refused otherwise. Never throws: SDK
   * construction
   * and request failures collapse into `{ ok:false, message }`, an MMSP
   * UnsupportedOperationError additionally sets `unsupported` so the dialog can point at
   * the manual path, and a listing that outlives LIST_MODELS_TIMEOUT_MS is reported as
   * timed out. Nothing cancels the request behind it: the race only stops waiting, and a
   * later rejection is already handled by the race itself. The listing is returned
   * verbatim; dedup against the config is the caller's policy, exactly like the probe
   * routes never write anything either.
   */
  async listEndpointModels(
    req: EndpointModelListRequest,
    listImpl: typeof coreListEndpointModels = coreListEndpointModels,
    timeoutMs: number = LIST_MODELS_TIMEOUT_MS,
  ): Promise<EndpointModelListResponse> {
    const clientType = canonicalClientType(req.clientType) ?? req.clientType;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const listing = listImpl({
        clientType,
        baseUrl: req.baseUrl,
        ...(req.apiKey ? { apiKey: req.apiKey } : {}),
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("model listing timed out")), timeoutMs);
        timer.unref?.();
      });
      const models = await Promise.race([listing, timeout]);
      return { ok: true, models };
    } catch (err) {
      const unsupported = err instanceof Error && err.name === "UnsupportedOperationError";
      return {
        ok: false,
        ...(unsupported ? { unsupported: true } : {}),
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * GET models view: masks credentials (the groups' and the rows' own), flags the default
   * Model; the group is the entry's `provider` field. The built-in catalog labels a row it
   * knows (`displayName`, when the file stores none) and nothing else. `vision` is the TOML
   * annotation only — absent = supported (a new Project writes `false` where the catalog says
   * so); the catalog is not consulted. `pricing` is the file's list price, and a row with a
   * stored promotion reports its fraction as `discount`.
   *
   * Two layers of connection are reported: `providers` (each group's stored
   * `[providers.<id>]` values) and, per row, its own values (`clientType`, `credential`)
   * beside `effective` — what the row is actually used with after core's effectiveConnection
   * (row -> group -> none, per field; the file's values only), with where each value came
   * from. The environment fallback (`envKey`, `envKeyMasked`, an `env` key source) is judged
   * on that effective shape, so a group pointed at a proxy is never shown a vendor's variable.
   */
  async getModels(projectId: string): Promise<ModelsResponse> {
    const raw = await this.readRaw(projectId);
    const defaultRef = optRef(raw.default_model);
    const visionRef = optRef(raw.vision_model);
    const providers = providerTableOf(raw);
    const discounts = new Map(
      (this.promotions?.list(projectId) ?? []).map((p) => [
        refKey(p.provider, p.modelId),
        p.discount,
      ]),
    );
    const models: ModelInfo[] = asArray(raw.models)
      // An entry is valid only if both provider and model_id are strings (an entry in the old concatenated format lacks provider and is ignored).
      .filter((m) => typeof m.provider === "string" && typeof m.model_id === "string")
      .map((m) => {
        const provider = m.provider as string;
        const modelId = m.model_id as string;
        const pricingDto = pricingDtoOf(m.pricing);
        const discount = discounts.get(refKey(provider, modelId));
        // Normalized on read: entries stored before AgentHub 0.4.2's openai -> openai-chat
        // rename report the canonical spelling without a disk rewrite (the next models PUT
        // persists it).
        const own = ownConnection(m, provider, modelId);
        const clientType = own.clientType;
        const cat = catalogEntryFor(provider, modelId);
        const credBaseUrl = own.baseUrl;
        const group = providers[provider];
        const eff = effectiveConnection(own, providerConnectionShape(group));
        const effectiveShape = {
          provider,
          modelId,
          clientType: eff.clientType,
          baseUrl: eff.baseUrl,
        };
        // The env fallback the entry is actually allowed (core's modelEnvFallback), on the
        // EFFECTIVE shape: the variable MMSP's routed client reads — the effective client type
        // takes priority, otherwise the id routes by the vendor family it begins with — but
        // only while the effective endpoint is the vendor's own. A gateway, custom or vLLM row
        // with its own (or its group's) endpoint gets no envKey at all: reporting a name there
        // would promise a fallback the harness refuses. Nor does a row its group's key
        // reaches (core's groupKeyReaches): a blank key on it follows the group's, never the
        // environment.
        const envKey =
          group?.api_key === undefined || !groupKeyReaches(own.baseUrl, group.base_url)
            ? modelEnvFallback(effectiveShape)?.envKey
            : undefined;
        // The file's annotation only: absent = supported, whatever the catalog says.
        const vision = typeof m.vision === "boolean" ? m.vision : undefined;
        // Output cap: TOML annotation only (user-owned; the built-in catalog never presets it).
        const maxTokens = optNum(m.max_tokens);
        // Fast mode: TOML annotation only (user-owned); only `true` is reported — absent = off.
        const fastMode = m.fast_mode === true ? true : undefined;
        // Display name: the explicit TOML field (user-edited) takes priority, then the built-in
        // catalog's label (a name, never sent anywhere). An empty string is not the same as an
        // absent field — absent means "inherit whatever the catalog calls this model", empty
        // means the user cleared the name on a model the catalog does name, and inheriting
        // there would hand the name straight back.
        // The distinction is reported rather than flattened, because the whole table comes back
        // on the next PUT: a cleared name that arrived as "no name" would be written back as
        // "inherit" and undo itself. Clients render the empty string as the model id.
        const displayName =
          m.display_name === "" ? "" : (optStr(m.display_name) ?? cat?.displayName);
        // The row's own credential (its overrides of the group's): a credential block is
        // emitted if either api_key or base_url is present on the row itself.
        const apiKey = own.apiKey;
        const createdAt = optStr(m.created_at);
        // Masked env-fallback preview, for the entries the UI may present as covered (core's
        // modelEnvPreviewKey — the dialog's hint reads the same function), on the effective
        // shape and only when neither the row nor its group holds a key: a row on a vendor
        // endpoint, or a keyless row in a group whose defaults are the vendor's. A vLLM preset
        // or a custom row with no base URL does fall back under the rule, but is not shown as
        // configured. Presence is implied by the field, the plaintext never leaves the server,
        // and an empty variable counts as absent — it would not authenticate either. Read from
        // this process's env, which on the desktop already includes the imported login-shell
        // variables.
        const previewKey =
          eff.apiKeySource === "none" ? modelEnvPreviewKey(effectiveShape) : undefined;
        const envValue = previewKey !== undefined ? (process.env[previewKey] ?? "") : "";
        const envKeyMasked = envValue !== "" ? maskApiKey(envValue) : undefined;
        const effective: ModelEffectiveConnection = {
          ...(eff.baseUrl !== undefined ? { baseUrl: eff.baseUrl } : {}),
          baseUrlSource: eff.baseUrlSource,
          ...(eff.clientType !== undefined ? { clientType: eff.clientType } : {}),
          clientTypeSource: eff.clientTypeSource,
          apiKeySource:
            eff.apiKeySource !== "none"
              ? eff.apiKeySource
              : envKeyMasked !== undefined
                ? "env"
                : "none",
          ...(eff.apiKey !== undefined
            ? { apiKeyMasked: maskApiKey(eff.apiKey) }
            : envKeyMasked !== undefined
              ? { apiKeyMasked: envKeyMasked }
              : {}),
        };
        const info: ModelInfo = {
          provider,
          modelId,
          ...(displayName !== undefined ? { displayName } : {}),
          isDefault:
            defaultRef !== undefined &&
            defaultRef.provider === provider &&
            defaultRef.model_id === modelId,
          ...(optNum(m.context_window) !== undefined
            ? { contextWindow: optNum(m.context_window)! }
            : {}),
          ...(clientType ? { clientType } : {}),
          ...(vision !== undefined ? { vision } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          ...(fastMode !== undefined ? { fastMode } : {}),
          ...(envKey ? { envKey } : {}),
          ...(envKeyMasked !== undefined ? { envKeyMasked } : {}),
          ...(pricingDto ? { pricing: pricingDto } : {}),
          ...(discount !== undefined ? { discount } : {}),
          ...(apiKey !== undefined || credBaseUrl !== undefined
            ? {
                credential: {
                  ...(apiKey !== undefined ? { apiKeyMasked: maskApiKey(apiKey) } : {}),
                  ...(credBaseUrl !== undefined ? { baseUrl: credBaseUrl } : {}),
                  ...(createdAt !== undefined ? { createdAt } : {}),
                },
              }
            : {}),
          effective,
        };
        return info;
      });
    const toDto = (ref: ModelRef): ModelRefDto => ({
      provider: ref.provider,
      modelId: ref.model_id,
    });
    const updatedAt = await this.configUpdatedAt(projectId);
    return {
      ...(defaultRef !== undefined ? { defaultModel: toDto(defaultRef) } : {}),
      ...(visionRef !== undefined ? { visionModel: toDto(visionRef) } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      providers: Object.fromEntries(
        Object.entries(providers).map(([id, connection]) => [id, providerDto(connection)]),
      ),
      models,
    };
  }

  /**
   * PUT replaces the whole models table: key =
   * `(provider, modelId)`; model entries that no longer appear are deleted along
   * with their inline credential; omitting apiKey keeps the existing value,
   * providing one overwrites it and records created_at, clearApiKey clears it;
   * baseUrl null clears it / omitted keeps it. A key change (either the group or
   * the upstream id changes) is migrated as a pair via `renamedFrom`: credential and
   * unknown fields migrate along with the base entry, and default/vision pointers
   * follow. Other extension fields in the toml (name, etc.) are preserved.
   *
   * Promotions (web.db) follow the new table once the file is written: a declared
   * `discount` is stored (null clears it); an omitted one keeps the stored promotion unless
   * the entry renames the row or changes its pricing; a row left out of the table takes its
   * promotion with it. A `discount` outside (0, 1) rejects the request before any write.
   *
   * An entry the request adds to a first-party vendor group under a model id MMSP cannot
   * route — judged on the protocol it would actually run on, its own or its group's — is
   * rejected as well (`model_not_routable`), and so is one it adds to a built-in group that
   * takes no hand-added models when it is not one of that group's presets
   * (`model_not_addable`); one already stored under that key is written as it stands. See
   * the loops below for why the two differ.
   *
   * `providers` changes the groups' connections, merged per group and per field like
   * `PUT /models/providers/:provider`; a group absent there keeps its table. Once the rows are
   * settled, a user-defined group with no row left loses its table too — that is how
   * deleting the group cleans up after it.
   */
  async updateModels(projectId: string, req: ModelsUpdateRequest): Promise<ModelsResponse> {
    return this.withProviderCredentialLock(projectId, MODELSCOPE_PROVIDER_ID, () =>
      this.updateModelsUnlocked(projectId, req),
    );
  }

  private async updateModelsUnlocked(
    projectId: string,
    req: ModelsUpdateRequest,
  ): Promise<ModelsResponse> {
    req.models.forEach((entry, i) => {
      const { discount } = entry;
      if (discount === undefined || discount === null) return;
      if (!(Number.isFinite(discount) && discount > 0 && discount < 1)) {
        throw badRequest(`models[${i}].discount must be null or a number above 0 and below 1.`);
      }
    });
    const raw = await this.readRaw(projectId);
    const prevModels = asArray(raw.models);

    // The groups' connections first: the routability rule below judges a new row on the
    // protocol it would run on, which a group's client_type in this same request decides.
    let providersTable: RawTable = { ...asTable(raw.providers) };
    let clearModelScopeProviderAuthToken = false;
    for (const [provider, patch] of Object.entries(req.providers ?? {})) {
      const patched = patchProviderTable(providersTable, provider, patch);
      providersTable = patched.table;
      // A ModelScope key typed by hand replaces the authorized one, whose refresh token
      // would otherwise overwrite it on the next refresh.
      if (patched.keyChanged && provider === MODELSCOPE_PROVIDER_ID) {
        clearModelScopeProviderAuthToken = true;
      }
    }
    const nextProviders = parseProviderTable(providersTable) ?? {};

    // A vendor group decides no protocol: its entries persist no client_type, so MMSP places
    // each one by the vendor family its model id begins with (`gpt-`, `claude-`, `gemini-`,
    // `glm-`, `kimi-`, `deepseek-`, `minimax-`), and an id of no known family fails at request
    // time with a sentence listing client types the user never chose. Refused here, while the
    // request can still be sent somewhere that works.
    //
    // Only an entry this request introduces is judged. The models page replaces the whole
    // table on every save, so an id written before this rule existed would otherwise block
    // every later edit of every other row; such a row is left exactly as it is, and the page
    // marks it. A key change is a different entry — moving a model into a vendor group, or
    // renaming one inside it, is the act of writing it there — so it is judged like a new one.
    // The protocol judged is the effective one: a group whose `[providers.<id>]` table names a
    // protocol routes every id by it, whatever the id begins with.
    for (const entry of req.models) {
      const effectiveClientType = effectiveConnection(
        {
          provider: entry.provider,
          modelId: entry.modelId,
          clientType: canonicalClientType(entry.clientType),
        },
        providerConnectionShape(nextProviders[entry.provider]),
      ).clientType;
      if (!unroutableVendorModel(entry.provider, entry.modelId, effectiveClientType)) continue;
      if (prevModels.some((m) => entryMatches(m, entry.provider, entry.modelId))) continue;
      throw new HttpError(
        400,
        "model_not_routable",
        `Model ${showRef(entry.provider, entry.modelId)} cannot be routed: a vendor group routes a model by the vendor prefix its id begins with (gpt-, claude-, gemini-, glm-, kimi-, deepseek-, minimax-). Add it under a custom group, where its protocol can be picked or detected.`,
      );
    }

    // Only custom, vLLM, OpenRouter, TokenDance, SiliconFlow and user-defined groups take
    // models added by hand (core's isAddableGroup); every other built-in group, the other
    // gateways included, carries its catalog presets and the rows it already stores. The
    // same grandfathering as above: a stored row is written as it stands, hand-added
    // ones from before this rule included, and so is a row renamed inside its own group. A row
    // moved in from another group is being added here, and a preset is always welcome back
    // (the preset sync writes a deleted one again).
    for (const entry of req.models) {
      if (!unaddableModel(entry.provider, entry.modelId)) continue;
      if (prevModels.some((m) => entryMatches(m, entry.provider, entry.modelId))) continue;
      const from = entry.renamedFrom;
      if (
        from !== undefined &&
        from.provider === entry.provider &&
        prevModels.some((m) => entryMatches(m, from.provider, from.modelId))
      ) {
        continue;
      }
      const group = providerInfo(entry.provider)?.label ?? entry.provider;
      throw new HttpError(
        400,
        "model_not_addable",
        `Model ${showRef(entry.provider, entry.modelId)} cannot be added: the ${group} group carries its built-in models only. Add it under a custom group.`,
      );
    }

    const seen = new Set<string>();
    const nextModels: RawTable[] = [];
    // Rename mapping (old reference key -> new reference): default model / vision model pointers follow a key change instead of being lost on a full table replacement.
    const renamed = new Map<string, ModelRefDto>();
    // Each row's promotion, settled against the stored set once the file is written.
    const promotionPlan: Array<{
      provider: string;
      modelId: string;
      declared: number | null | undefined;
      keep: boolean;
    }> = [];
    for (const entry of req.models) {
      const key = refKey(entry.provider, entry.modelId);
      if (seen.has(key)) {
        throw badRequest(
          `models contains a duplicate model reference: ${showRef(entry.provider, entry.modelId)}.`,
        );
      }
      seen.add(key);
      const renamedFrom =
        entry.renamedFrom !== undefined &&
        !(
          entry.renamedFrom.provider === entry.provider &&
          entry.renamedFrom.modelId === entry.modelId
        )
          ? entry.renamedFrom
          : undefined;
      if (renamedFrom !== undefined) {
        renamed.set(refKey(renamedFrom.provider, renamedFrom.modelId), {
          provider: entry.provider,
          modelId: entry.modelId,
        });
      }

      // Model entry: uses the old entry (the entry for the original reference when
      // the key changed) as the base, preserving unknown fields and inline
      // credential; known fields are replaced wholesale per the request (omitted
      // means removed).
      const prevRef = entry.renamedFrom ?? { provider: entry.provider, modelId: entry.modelId };
      const prev = prevModels.find((m) => entryMatches(m, prevRef.provider, prevRef.modelId)) ?? {};
      // An omitted promotion survives only on the row it was taken off, at the price it was
      // taken off: a renamed row is another row, and a changed price is not that price.
      promotionPlan.push({
        provider: entry.provider,
        modelId: entry.modelId,
        declared: entry.discount,
        keep:
          entry.discount === undefined &&
          renamedFrom === undefined &&
          samePricing(entry.pricing, pricingDtoOf(prev.pricing)),
      });
      const next: RawTable = { ...prev, provider: entry.provider, model_id: entry.modelId };
      delete next.context_window;
      delete next.client_type;
      delete next.vision;
      delete next.max_tokens;
      delete next.fast_mode;
      delete next.pricing;
      delete next.display_name;
      // Leftover key from the old concatenated format (request_model_id): defensively stripped, never written to disk again.
      delete next.request_model_id;

      // Display name: **only written to disk when it differs from the built-in
      // catalog (looked up by the paired reference)** — preset models keep the
      // config clean, only user-edited ones (including those not found in the
      // catalog) get written into the TOML.
      //
      // An ABSENT name and an EMPTY one are different requests, and a client that confuses
      // them destroys a name it never meant to touch: absent means "inherit whatever the
      // catalog calls this model" (nothing is written, so the read path falls back to the
      // catalog), empty means "the user cleared it".
      const catNew = catalogEntryFor(entry.provider, entry.modelId);
      if (entry.displayName && entry.displayName !== catNew?.displayName) {
        next.display_name = entry.displayName;
      } else if (entry.displayName === "" && catNew?.displayName !== undefined) {
        // Cleared on a model the catalog names. Writing nothing would leave the field absent,
        // which reads as "inherit" — so the name the user just deleted would come back on the
        // next load. The empty string is what records the deletion. Only reached for a catalog
        // model: a custom one has no name to inherit, so absence already says it.
        next.display_name = "";
      }
      if (entry.contextWindow !== undefined) next.context_window = entry.contextWindow;
      // Stored canonically: a client sending the deprecated "openai" alias persists
      // "openai-chat" (see canonicalClientType).
      if (entry.clientType) next.client_type = canonicalClientType(entry.clientType);
      // Treated as supported by default: only written to disk when explicitly annotated (both true/false are kept; false drives a frontend blocking hint).
      if (entry.vision !== undefined) next.vision = entry.vision;
      // Inherit-the-Agent-value by default: only written to disk when explicitly annotated (omitted on a full-table PUT = the annotation is cleared).
      if (entry.maxTokens !== undefined) next.max_tokens = entry.maxTokens;
      // Off by default: only `true` is written to disk (absent = off); omitted or false clears the annotation.
      if (entry.fastMode === true) next.fast_mode = true;
      if (entry.pricing !== undefined) {
        next.pricing = {
          unit: "usd_per_mtok",
          cache_read: entry.pricing.cacheRead,
          cache_write: entry.pricing.cacheWrite,
          output: entry.pricing.output,
        };
      }
      // The row's own credential — an override of its group's — added/removed on top of the
      // old value per the request (migrates automatically with the base entry when the key
      // changes). It never touches the group's key, nor the ModelScope group's authorization,
      // which belongs to the group key.
      if (entry.clearApiKey) {
        delete next.api_key;
        delete next.created_at;
      }
      if (entry.apiKey !== undefined) {
        next.api_key = entry.apiKey;
        next.created_at = new Date().toISOString();
      }
      if (entry.baseUrl === null) delete next.base_url;
      else if (entry.baseUrl !== undefined) next.base_url = entry.baseUrl;
      nextModels.push(next);
    }

    // A user-defined group exists by its rows: once none is left, its connection goes too.
    // Built-in groups keep theirs — the group is still on the page, and its key with it.
    for (const provider of Object.keys(providersTable)) {
      if (providerInfo(provider) !== undefined) continue;
      if (nextModels.some((m) => m.provider === provider)) continue;
      delete providersTable[provider];
    }

    // default_model: when provided it must be present in models; when omitted the previous value is kept (the pointer follows a key rename; if it was deleted, it's removed).
    let defaultModel: ModelRefDto | undefined;
    if (req.defaultModel !== undefined) {
      if (!seen.has(refKey(req.defaultModel.provider, req.defaultModel.modelId))) {
        throw badRequest(
          `defaultModel must be included in models: ${showRef(req.defaultModel.provider, req.defaultModel.modelId)}.`,
        );
      }
      defaultModel = req.defaultModel;
    } else {
      const prevRef = optRef(raw.default_model);
      if (prevRef !== undefined) {
        const prevKey = refKey(prevRef.provider, prevRef.model_id);
        const followed = renamed.get(prevKey) ?? {
          provider: prevRef.provider,
          modelId: prevRef.model_id,
        };
        if (seen.has(refKey(followed.provider, followed.modelId))) defaultModel = followed;
      }
    }

    // vision_model: same semantics as default_model; additionally must not be annotated vision=false (can't proxy-read images if unsupported).
    const targetOf = (ref: ModelRefDto) =>
      req.models.find((m) => m.provider === ref.provider && m.modelId === ref.modelId);
    let visionModel: ModelRefDto | undefined;
    if (req.visionModel !== undefined) {
      if (!seen.has(refKey(req.visionModel.provider, req.visionModel.modelId))) {
        throw badRequest(
          `visionModel must be included in models: ${showRef(req.visionModel.provider, req.visionModel.modelId)}.`,
        );
      }
      if (targetOf(req.visionModel)?.vision === false) {
        throw badRequest(
          `visionModel must not point to a model annotated as not supporting images: ${showRef(req.visionModel.provider, req.visionModel.modelId)}.`,
        );
      }
      visionModel = req.visionModel;
    } else {
      const prevRef = optRef(raw.vision_model);
      if (prevRef !== undefined) {
        const prevKey = refKey(prevRef.provider, prevRef.model_id);
        const followed = renamed.get(prevKey) ?? {
          provider: prevRef.provider,
          modelId: prevRef.model_id,
        };
        if (seen.has(refKey(followed.provider, followed.modelId))) {
          // The former vision model is now annotated as not supporting images: the annotation takes priority, and the pointer is dropped as invalid.
          if (targetOf(followed)?.vision !== false) visionModel = followed;
        }
      }
    }

    const toRaw = (ref: ModelRefDto): RawTable => ({
      provider: ref.provider,
      model_id: ref.modelId,
    });
    const next: RawTable = { ...raw, providers: providersTable, models: nextModels };
    if (defaultModel !== undefined) next.default_model = toRaw(defaultModel);
    else delete next.default_model;
    if (visionModel !== undefined) next.vision_model = toRaw(visionModel);
    else delete next.vision_model;
    const commit = async (): Promise<ModelsResponse> => {
      await this.writeRaw(projectId, next);
      if (this.promotions !== undefined) {
        const stored = new Map(
          this.promotions.list(projectId).map((p) => [refKey(p.provider, p.modelId), p.discount]),
        );
        const rows: ModelPromotion[] = [];
        for (const { provider, modelId, declared, keep } of promotionPlan) {
          const discount = keep ? stored.get(refKey(provider, modelId)) : declared;
          if (discount !== undefined && discount !== null)
            rows.push({ provider, modelId, discount });
        }
        // Built from the new table alone, so a dropped row's promotion is gone with it.
        this.promotions.replaceAll(projectId, rows);
      }
      if (clearModelScopeProviderAuthToken) {
        this.providerAuthTokens?.delete(projectId, MODELSCOPE_PROVIDER_ID);
      }
      return this.getModels(projectId);
    };
    return commit();
  }

  /**
   * Changes one group's connection (`PUT /models/providers/:provider`): `[providers.<id>]`,
   * merged per field (see patchProviderTable). No row is touched: a model with its own base
   * URL, protocol or key keeps it. A ModelScope key set or cleared here is the user's own, so
   * the group's authorization (its refresh token) goes with the old one — "Disconnect" is
   * `{ clearApiKey: true }` here, and for ModelScope it ends the authorization too. Returns the
   * models view as it now stands.
   */
  async setProviderConnection(
    projectId: string,
    provider: string,
    patch: ProviderConnectionUpdate,
  ): Promise<ModelsResponse> {
    return this.withProviderCredentialLock(projectId, MODELSCOPE_PROVIDER_ID, async () => {
      const raw = await this.readRaw(projectId);
      const { table, keyChanged } = patchProviderTable(asTable(raw.providers), provider, patch);
      await this.writeRaw(projectId, { ...raw, providers: table });
      if (keyChanged && provider === MODELSCOPE_PROVIDER_ID) {
        this.providerAuthTokens?.delete(projectId, MODELSCOPE_PROVIDER_ID);
      }
      return this.getModels(projectId);
    });
  }

  /**
   * Writes one API key as a group's key (`[providers.<id>].api_key` + `created_at`) — what
   * Enter key, the Connect flows and the ModelScope refresh all land on. No row is read or
   * replaced: a model with its own key keeps it (and keeps billing the account it was given),
   * and a caller that never saw the rest of the table cannot flatten it. A group with no rows
   * still takes the key.
   *
   * Returns how many of the group's rows now use it — the ones without a key of their own.
   */
  async setGroupApiKey(projectId: string, provider: string, apiKey: string): Promise<number> {
    if (provider === MODELSCOPE_PROVIDER_ID) {
      return this.withProviderCredentialLock(projectId, provider, async () => {
        const applied = await this.setGroupApiKeyUnlocked(projectId, provider, apiKey);
        // Written by hand: the authorization's refresh token belongs to the key it replaced.
        this.providerAuthTokens?.delete(projectId, MODELSCOPE_PROVIDER_ID);
        return applied;
      });
    }
    return this.setGroupApiKeyUnlocked(projectId, provider, apiKey);
  }

  /**
   * setGroupApiKey plus the authorization's refresh material (web.db), in one critical
   * section with the other ModelScope writers. With `expectedRefreshToken` (a refresh), nothing
   * is written and 0 returned when the stored refresh token changed meanwhile — a newer
   * authorization won.
   */
  async setGroupApiKeyWithProviderAuthToken(
    projectId: string,
    provider: string,
    apiKey: string,
    token: Omit<ModelProviderAuthToken, "provider" | "updatedAt">,
    options: { expectedRefreshToken?: string } = {},
  ): Promise<number> {
    return this.withProviderCredentialLock(projectId, provider, async () => {
      if (options.expectedRefreshToken !== undefined) {
        const current = this.providerAuthTokens?.get(projectId, provider);
        if (current?.refreshToken !== options.expectedRefreshToken) return 0;
      }
      const applied = await this.setGroupApiKeyUnlocked(projectId, provider, apiKey);
      this.providerAuthTokens?.upsert(projectId, {
        provider,
        refreshToken: token.refreshToken,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
      });
      return applied;
    });
  }

  private async setGroupApiKeyUnlocked(
    projectId: string,
    provider: string,
    apiKey: string,
  ): Promise<number> {
    const raw = await this.readRaw(projectId);
    const { table } = patchProviderTable(asTable(raw.providers), provider, { apiKey });
    await this.writeRaw(projectId, { ...raw, providers: table });
    return rowsFollowingGroupKey(raw, provider);
  }

  /** A group's key (`[providers.<id>].api_key`), never a row's own; never sent over HTTP. */
  async getGroupApiKey(projectId: string, provider: string): Promise<string | undefined> {
    return providerTableOf(await this.readRaw(projectId))[provider]?.api_key;
  }

  /** One row's own key — its override of the group's — or undefined; never sent over HTTP. */
  async getModelApiKey(
    projectId: string,
    provider: string,
    modelId: string,
  ): Promise<string | undefined> {
    const raw = await this.readRaw(projectId);
    const entry = asArray(raw.models).find((m) => entryMatches(m, provider, modelId));
    const apiKey = entry === undefined ? undefined : optStr(entry.api_key);
    return apiKey?.trim() ? apiKey : undefined;
  }

  /**
   * The key a group's account balance is read with (the catalog's `balance` descriptor names
   * the endpoint): the group's key, and never a row's own — a model keyed to another account
   * says nothing about this group's balance. Without a group key, the environment key a
   * Session on one of the group's rows would use if the row held no key: core's
   * modelEnvFallback decides, on the row's EFFECTIVE shape (its own base URL and protocol, then
   * the group's table's, then none — so a group pointed at a proxy is lent nothing), and its
   * variable is read from this process's env as the routed client itself would read it. One
   * more condition, because the balance request is the server's own rather than the routed
   * client's: the variable's official endpoint must be the balance endpoint's host, so a vendor
   * key never reaches another vendor. A DeepSeek group on DeepSeek's endpoint qualifies; a
   * gateway's rows (TokenDance) get no fallback at all. Never returned to the browser.
   */
  async getGroupBalanceKey(projectId: string, provider: string): Promise<string | undefined> {
    const raw = await this.readRaw(projectId);
    const group = providerTableOf(raw)[provider];
    if (group?.api_key !== undefined) return group.api_key;
    const balanceUrl = providerInfo(provider)?.balance?.url;
    if (balanceUrl === undefined) return undefined;
    const origin = (url: string): string | undefined => {
      try {
        return new URL(url).origin;
      } catch {
        return undefined;
      }
    };
    const balanceOrigin = origin(balanceUrl);
    for (const model of asArray(raw.models)) {
      if (model.provider !== provider) continue;
      const modelId = optStr(model.model_id);
      if (modelId === undefined) continue;
      const { apiKey: _ownKey, ...own } = ownConnection(model, provider, modelId);
      const eff = effectiveConnection(own, providerConnectionShape(group));
      const fallback = modelEnvFallback({
        provider,
        modelId,
        clientType: eff.clientType,
        baseUrl: eff.baseUrl,
      });
      if (fallback === undefined) continue;
      const endpoints = VENDOR_ENDPOINTS[fallback.envKey] ?? [];
      if (!endpoints.some((own) => origin(own) === balanceOrigin)) continue;
      const value = process.env[fallback.envKey]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  /**
   * Penguin Go's catalog, merged into its group. Only what is new arrives: a model the
   * platform advertises and the group lacks is added with the platform's list price, context
   * window, vision flag, display name and routing, and its promotion is stored beside it
   * (web.db). Its protocol and endpoint are stored per field against the group's
   * `[providers.penguin-go]` table in the file (the built-in catalog is not consulted): a field
   * the table holds is followed, the row storing only where it differs from the platform's
   * group value (the relay URL every model shares); a field the table lacks is written on the
   * row in full. A row the group
   * already holds is never rewritten — not its price, not its protocol, not its promotion: the
   * user may have changed them, and only "Restore defaults", behind its confirmation, puts
   * existing rows back.
   *
   * Authorization (`applyKeyToExisting`) also writes the delivered key once, as the group's
   * key (`[providers.penguin-go]`); new rows carry no key of their own and follow it.
   *
   * Returns how many rows were added, `updated` (always 0 — nothing existing is refreshed),
   * and `applied`: on authorization, how many of the group's rows now use the group key;
   * otherwise the rows added.
   */
  async mergePlatformModels(
    projectId: string,
    provider: string,
    catalog: PlatformModelCatalog,
    apiKey: string,
    applyKeyToExisting: boolean,
  ): Promise<PlatformModelApplyResult> {
    const raw = await this.readRaw(projectId);
    const current = asArray(raw.models);
    const known = new Set(
      current.flatMap((model) =>
        model.provider === provider && typeof model.model_id === "string" ? [model.model_id] : [],
      ),
    );
    // Per field, as "Add new models" stores a catalog row against the file (presetAdditions):
    // where the group's table in the file HAS the field, a new row stores only its difference
    // from the platform's group value (the one endpoint or protocol every advertised model
    // shares — the relay URL), so a group the user pointed at a proxy takes the row along;
    // where the table LACKS it, the row stores the platform's full value, never falling to the
    // client's default with the group's key.
    const group = providerTableOf(raw)[provider];
    const platformBaseUrl = sharedPlatformValue(
      catalog.models.map((m) => m.baseUrl),
      sameEndpoint,
    );
    const platformClientType = sharedPlatformValue(
      catalog.models.map((m) => m.clientType),
      sameClientType,
    );
    const added: RawTable[] = [];
    for (const model of catalog.models) {
      if (known.has(model.modelId)) continue;
      known.add(model.modelId);
      added.push({
        provider,
        model_id: model.modelId,
        display_name: model.displayName,
        context_window: model.contextWindow,
        vision: model.supportsVision,
        pricing: platformPricingTable(model.pricing),
        ...(group?.client_type === undefined ||
        platformClientType === undefined ||
        !sameClientType(model.clientType, platformClientType)
          ? { client_type: model.clientType }
          : {}),
        ...(group?.base_url === undefined ||
        platformBaseUrl === undefined ||
        !sameEndpoint(model.baseUrl, platformBaseUrl)
          ? { base_url: model.baseUrl }
          : {}),
      });
    }

    const nextModels = [...current, ...added];
    if (added.length > 0 || applyKeyToExisting) {
      const providers = applyKeyToExisting
        ? patchProviderTable(asTable(raw.providers), provider, { apiKey }).table
        : raw.providers;
      await this.writeRaw(projectId, {
        ...raw,
        ...(providers !== undefined ? { providers } : {}),
        models: nextModels,
      });
    }
    // After the file write, so a promotion never lands for a row the file failed to take; the
    // group's existing promotions are kept as they are.
    const addedIds = new Set(added.map((row) => row.model_id));
    const promoted = catalog.models.flatMap((model) =>
      model.discount !== undefined && addedIds.has(model.modelId)
        ? [{ provider, modelId: model.modelId, discount: model.discount }]
        : [],
    );
    if (this.promotions !== undefined && promoted.length > 0) {
      const kept = this.promotions
        .list(projectId)
        .filter((p) => p.provider === provider && !addedIds.has(p.modelId));
      this.promotions.replaceProvider(projectId, provider, [...kept, ...promoted]);
    }
    const applied = applyKeyToExisting
      ? rowsFollowingGroupKey({ providers: raw.providers, models: nextModels }, provider)
      : added.length;
    return { added: added.length, updated: 0, applied };
  }

  /**
   * "Sync presets", in its two modes (`POST /models/sync-presets`):
   *
   * - `add`: the catalog's presets the table lacks — retired rows never — are appended, in
   *   catalog order, each stored against its group's table in the file field by field
   *   (presetAdditions), and their promotions are stored. A group the file has neither rows
   *   nor a table for gets the catalog's table. Nothing else moves: no existing row, group
   *   table, promotion, key or reference.
   * - `restore`: every built-in row (a catalog pair, retired included) goes back to the shape
   *   a new Project stores — context window, price and vision from the catalog; display name,
   *   output cap and fast mode dropped; a protocol and endpoint only where its catalog row
   *   differs from its group's — while its own key stays. Deleted presets are appended. Every
   *   built-in group but custom gets the catalog's endpoint and protocol back in its
   *   `[providers.<id>]` table (created when missing; a value the catalog does not set is
   *   removed) and keeps its key — except that a self-hosted one (vLLM: no catalog endpoint,
   *   models added by hand) keeps its base URL, the user's own server; custom and user-defined
   *   groups keep their tables, since the rows the user added there depend on them. Rows the
   *   user added are kept verbatim, but for
   *   a key relocated as below. Promotions become the catalog's, except that Penguin Go's (the
   *   platform's) and those on the user's own rows are kept. The default model is kept while
   *   it names a row, else it becomes the catalog's default; the vision model is kept while it
   *   names a row that takes images, else it is removed.
   *
   *   Keys are relocated, never deleted: a built-in group (custom excepted) with no group key
   *   whose keyed rows all hold the same key, one the group key would reach on every one of
   *   them (core's groupKeyReaches), gets that key as its group key, with the latest of the
   *   rows' `created_at`, and the rows hold it no more. Rows with differing keys keep them.
   *
   * Returns the models view with `added` (rows appended) and `restored` (existing built-in
   * rows `restore` actually changed; 0 for `add`). Nothing is written when nothing changes.
   */
  async syncPresets(projectId: string, mode: PresetSyncMode): Promise<PresetSyncResponse> {
    return this.withProviderCredentialLock(projectId, MODELSCOPE_PROVIDER_ID, () =>
      mode === "add" ? this.addPresets(projectId) : this.restorePresets(projectId),
    );
  }

  private async addPresets(projectId: string): Promise<PresetSyncResponse> {
    const raw = await this.readRaw(projectId);
    const { providers, added } = presetAdditions(raw);
    if (added.length > 0) {
      await this.writeRaw(projectId, {
        ...raw,
        providers,
        models: [...asArray(raw.models), ...added],
      });
      if (this.promotions !== undefined) {
        const addedRefs = new Set(added.map((m) => refKey(m.provider, m.model_id)));
        const isAdded = (p: { provider: string; modelId: string }) =>
          addedRefs.has(refKey(p.provider, p.modelId));
        this.promotions.replaceAll(projectId, [
          ...this.promotions.list(projectId).filter((p) => !isAdded(p)),
          ...presetPromotions().filter(isAdded),
        ]);
      }
    }
    return { ...(await this.getModels(projectId)), added: added.length, restored: 0 };
  }

  private async restorePresets(projectId: string): Promise<PresetSyncResponse> {
    const raw = await this.readRaw(projectId);
    const current = asArray(raw.models);
    // Every catalog row as a stored entry, retired ones included (a Project still carrying a
    // retired row has it put back like any other built-in row; it is never added, though), in
    // the shape a new Project stores: a protocol or endpoint only where the row's differs from
    // its group's catalog table — the table every built-in group gets back below.
    const catalogRows = new Map(
      catalogModelEntries().map((m) => [refKey(m.provider, m.model_id), m] as const),
    );
    const isCatalogRow = (row: RawTable): boolean =>
      catalogRows.has(refKey(String(row.provider), String(row.model_id)));
    const reset = current.map((row): RawTable => {
      const catalogRow = catalogRows.get(refKey(String(row.provider), String(row.model_id)));
      if (catalogRow === undefined) return row;
      const rest = Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => key !== "provider" && key !== "model_id" && !RESTORED_ROW_FIELDS.has(key),
        ),
      );
      return { ...catalogRow, ...rest };
    });
    const stored = new Set(reset.map((m) => refKey(String(m.provider), String(m.model_id))));
    const added = presetModelEntries().filter((m) => !stored.has(refKey(m.provider, m.model_id)));

    // Built-in groups go back to the catalog's endpoint and protocol and keep their key (and
    // anything else they hold); custom and user-defined groups have nothing in the catalog to
    // go back to, and the rows the user added to them reach their endpoint through these
    // tables. A self-hosted built-in group (vLLM: the catalog gives it no endpoint, and it takes
    // models added by hand) keeps its base URL too — that is the user's own server, and the
    // client's default endpoint is no default for it; only its protocol is the catalog's.
    const catalogTables = presetProviderTable();
    const tables: RawTable = {};
    for (const [id, value] of Object.entries(asTable(raw.providers))) {
      if (providerInfo(id) === undefined || id === "custom") {
        tables[id] = value;
        continue;
      }
      const { base_url: baseUrl, client_type: _clientType, ...member } = asTable(value);
      const selfHosted = catalogGroupConnection(id)?.base_url === undefined && isAddableGroup(id);
      const restoredTable = {
        ...(selfHosted && baseUrl !== undefined ? { base_url: baseUrl } : {}),
        ...catalogTables[id],
        ...member,
      };
      if (Object.keys(restoredTable).length > 0) tables[id] = restoredTable;
    }
    for (const [id, connection] of Object.entries(catalogTables)) {
      if (!Object.hasOwn(tables, id)) tables[id] = { ...connection };
    }
    const { providers, models: nextModels } = relocateSharedKeys(tables, [
      ...reset,
      ...added.map((m): RawTable => ({ ...m })),
    ]);
    let restored = 0;
    current.forEach((row, i) => {
      if (isCatalogRow(row) && !sameValue(row, nextModels[i])) restored += 1;
    });

    const refs = new Set(nextModels.map((m) => refKey(String(m.provider), String(m.model_id))));
    const named = (ref: ModelRef | undefined): ref is ModelRef =>
      ref !== undefined && refs.has(refKey(ref.provider, ref.model_id));
    const prevDefault = optRef(raw.default_model);
    const defaultModel = named(prevDefault) ? prevDefault : defaultProjectConfig().default_model;
    const prevVision = optRef(raw.vision_model);
    const visionTarget = named(prevVision)
      ? nextModels.find((m) => entryMatches(m, prevVision.provider, prevVision.model_id))
      : undefined;
    const visionModel =
      visionTarget?.vision !== false && named(prevVision) ? prevVision : undefined;

    const next: RawTable = { ...raw, providers, models: nextModels };
    if (defaultModel !== undefined) next.default_model = defaultModel;
    else delete next.default_model;
    if (visionModel !== undefined) next.vision_model = visionModel;
    else delete next.vision_model;
    const changed =
      !sameValue(current, nextModels) ||
      !sameValue(asTable(raw.providers), providers) ||
      !sameValue(optRef(raw.default_model), defaultModel) ||
      !sameValue(prevVision, visionModel);
    if (changed) await this.writeRaw(projectId, next);

    if (this.promotions !== undefined) {
      // The catalog's promotions, except where the stored one is not the catalog's to reset:
      // Penguin Go's come from the platform, and the user's own rows have no catalog entry.
      const keep = this.promotions
        .list(projectId)
        .filter(
          (p) =>
            refs.has(refKey(p.provider, p.modelId)) &&
            (p.provider === PENGUIN_GO_PROVIDER_ID ||
              !catalogRows.has(refKey(p.provider, p.modelId))),
        );
      const kept = new Set(keep.map((p) => refKey(p.provider, p.modelId)));
      this.promotions.replaceAll(projectId, [
        ...keep,
        ...presetPromotions().filter(
          (p) =>
            refs.has(refKey(p.provider, p.modelId)) && !kept.has(refKey(p.provider, p.modelId)),
        ),
      ]);
    }
    return { ...(await this.getModels(projectId)), added: added.length, restored };
  }
}

/**
 * Whether a streamed message carries genuine model content (thinking or text, partial delta
 * or complete backfill) — the probe's "the endpoint really answered" signal. Tool calls and
 * event messages don't count (the probe declares no tools).
 */
export function isProbeContent(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; thinking?: string; text?: string };
  if (p.type === "partial_thinking" || p.type === "thinking") return Boolean(p.thinking);
  if (p.type === "partial_text" || p.type === "text") return Boolean(p.text);
  return false;
}

/**
 * Probe verdict from the terminal LLM outcome. `completed` always passes. A `malformed`
 * ending after genuine streamed content also passes: the typical case is a reasoning-heavy
 * model that spends the probe's tiny max_tokens entirely on thinking (finish_reason=length ->
 * MMSP's EmptyResponseError, a `retryable` outcome that still streamed content) — the
 * endpoint, credential, and model id all demonstrably work, which is what a connectivity
 * test measures. Everything else (fatal rejections, and retryable failures with nothing
 * received) fails with the outcome's message.
 */
export function probeVerdict(
  outcome: LLMOutcome,
  sawContent: boolean,
): { ok: true } | { ok: false; message: string } {
  if (outcome.status === "completed") return { ok: true };
  if (outcome.status === "retryable" && sawContent) return { ok: true };
  return { ok: false, message: outcomeDetail(outcome) };
}

/**
 * Sample floors below which the streaming window says nothing about decoding rate. The
 * speed probe's 64-token cap clears both by a wide margin, so hitting a floor means the
 * model didn't really stream (a one-word answer, or usage that never arrived).
 */
const PROBE_TPS_MIN_TOKENS = 16;
const PROBE_TPS_MIN_WINDOW_MS = 100;

/**
 * Output rate (tokens/s) over the probe's streaming window (first content -> stream end),
 * rounded to 1dp; undefined when the sample is too small to be meaningful. A stream's
 * closing usage chunk costs a round trip on its own, so a two-token answer measures network
 * jitter and nothing else — 2 tokens in 30ms reads as 66.7 tok/s and the same model 30ms
 * later reads as 33.3, which the card badges would paint green vs yellow. Callers report
 * TTFT alone rather than a fabricated rate; a malformed ending carries no usage at all and
 * lands here as 0 tokens.
 */
export function probeTps(outputTokens: number, windowMs: number): number | undefined {
  if (outputTokens < PROBE_TPS_MIN_TOKENS || windowMs <= PROBE_TPS_MIN_WINDOW_MS) return undefined;
  return Math.round((outputTokens / (windowMs / 1000)) * 10) / 10;
}
