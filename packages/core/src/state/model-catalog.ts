/**
 * Built-in model catalog (single source of truth): official chat models that AgentHub can
 * auto-route, shared by core's default config, server's initial config, and web/cli display.
 * Data verified as of 2026-07-10 (Qwen Token Plan entries: 2026-07-20; MiniMax: 2026-08-03;
 * DeepSeek, Gemini 3.7, GLM-5.3 and the whole OpenAI line-up (direct + OpenRouter):
 * 2026-08-18; the direct Anthropic group: 2026-08-20; the DeepSeek V4 Flash Vision Exp rows:
 * 2026-08-21; the GLM-5.3 Flash rows (direct + OpenRouter) and qwen3.8-flash: 2026-08-26 —
 * per each provider's docs).
 * Docs: packages/docs/content/models.{zh,en}.md (site path /docs/models) documents the
 * provider groups and credential resolution described here.
 *
 * Three-bucket pricing convention (USD per million tokens, matching usageToTokenCounts'
 * token-to-bucket mapping):
 * - cache_read: the vendor's "cache hit" price;
 * - cache_write: the vendor's "cache write" price (e.g. Anthropic uses 1.25 x input); vendors
 *   without a separate cache-write fee use the standard input price;
 * - output: output price (thinking + reply).
 * OpenAI charges extra for >272K input, Gemini 3.1 Pro for >200K input, and MiniMax M3 doubles
 * every rate above 512K input; this catalog records their base tier (the cost center uses a
 * single rate, so long-context usage will be underestimated).
 *
 * Scope: excludes deepseek-chat / deepseek-reasoner legacy aliases that AgentHub cannot
 * auto-route (deprecated 2026-07-24), glm-5v-turbo (image input unsupported by AgentHub's GLM
 * client), the OpenRouter z-ai/glm-5.1 and SiliconFlow Pro/zai-org/GLM-5.1 gateway listings
 * (delisted 2026-08-06; the Z.AI direct glm-5.1 remains), the OpenRouter
 * inclusionai/ling-3.0-flash:free listing (delisted from OpenRouter, removed 2026-08-18),
 * non-chat models (embedding / image generation / TTS), and Bedrock. Direct-vendor ids are
 * auto-routed by AgentHub and leave client_type unset; the five gateway groups (OpenRouter,
 * Fireworks AI, SiliconFlow, Qwen Token Plan, Qwen Pay-As-You-Go) can't be auto-routed, so
 * every gateway row **always pins an explicit client_type** and inlines its preset base URL.
 * That pin is load-bearing, not decoration: AgentHub's AutoLLMClient matches raw substrings
 * against `client_type || model_id` and never looks at base_url, so an unpinned gateway id
 * would be routed by its own spelling — `openai/gpt-5.6-sol` would reach the first-party
 * GPT-5.6 client aimed at a gateway, and `anthropic/claude-opus-4.8` would throw outright
 * (dotted "4.8" matches neither "4-8" nor "-5"). Two protocols are pinned:
 * - `openai-chat` for most rows (AgentHub 0.4.2's canonical name for the generic Chat
 *   Completions client — the bare "openai" spelling is a deprecated upstream alias, see
 *   canonicalClientType);
 * - `openai-responses` for the OpenRouter `openai/*` rows, whose upstream really is an
 *   OpenAI Responses server (see the OpenRouter block comment for why only those rows).
 * The MiniMax M3 preset pins AgentHub's first-party `minimax-m3` protocol and direct API
 * endpoint.
 *
 * This file imports no Node built-ins (type-only imports only), so it can be bundled directly
 * for the browser.
 */
import type { ModelEntry, ModelPricing } from "./project-config.js";

/** Model provider info (used for web grouping/logo and the "API key blank falls back to env var" hint). */
export interface ModelProviderInfo {
  id: string;
  /** Display name (brand name, shared by Chinese and English UI). */
  label: string;
  /** API key env var name (AgentHub reads this automatically when credential is blank). */
  envKey: string;
  /** base URL env var name. */
  envBaseUrlKey: string;
  /** Console URL for obtaining an API key (frontend links this in the group header); none for custom. */
  apiKeyUrl?: string;
  /** Vendor's model list / docs page URL (frontend's "add model" dialog links this as "get model id"); none for custom. */
  modelsUrl?: string;
  /**
   * Gateway's OpenAI-compatible endpoint (openrouter / siliconflow / qwen-token-plan): used by
   * the frontend's "add model" dialog to prefill base URL by group; left blank for direct
   * vendors and custom.
   */
  gatewayBaseUrl?: string;
}

/** A single built-in model's catalog entry (`modelId` is the upstream id; paired with `provider` it forms the catalog's unique key). */
export interface ModelCatalogEntry {
  modelId: string;
  displayName: string;
  /** Provider id (one of MODEL_PROVIDERS). */
  provider: string;
  contextWindow?: number;
  pricing?: ModelPricing;
  /** Whether image input (vision modality) is supported. */
  supportsVision: boolean;
  /** AgentHub client protocol: required when an id cannot be auto-routed or a shared protocol must be pinned. */
  clientType?: string;
  /** Preset base URL: inlined into gateway and direct MiniMax entries so only an API key is required. */
  baseUrl?: string;
}

/** Preset provider endpoints; only OpenAI-compatible gateways expose theirs as gatewayBaseUrl. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
const QWEN_TOKEN_PLAN_BASE_URL =
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
const QWEN_PAYG_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
const MINIMAX_BASE_URL = "https://api.minimax.io/v1";

/**
 * Provider list (web model page groups in this order): DeepSeek first (the default model's
 * provider), followed by the five gateways (OpenRouter, Fireworks AI, SiliconFlow, Qwen Token
 * Plan, Qwen Pay-As-You-Go), then the first-party providers Google Gemini, Anthropic, OpenAI,
 * Z.AI (GLM), Moonshot (Kimi), and MiniMax; custom groups custom OpenAI-protocol models and
 * comes last.
 */
export const MODEL_PROVIDERS: ModelProviderInfo[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    envBaseUrlKey: "DEEPSEEK_BASE_URL",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    modelsUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  // Gateways (their model ids can't be auto-routed by AgentHub, so they always pin an
  // explicit client_type + a preset base URL): they go through one of AgentHub's generic
  // OpenAI-protocol clients - openai-chat (Chat Completions) for most rows, openai-responses
  // for the OpenRouter openai/* rows - and *both* read **OPENAI_API_KEY / OPENAI_BASE_URL**
  // when the credential is blank (not the provider's own var names), so the env fallback hint
  // is the same either way and must reflect that accurately.
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://openrouter.ai/workspaces/default/keys",
    modelsUrl: "https://openrouter.ai/models",
    gatewayBaseUrl: OPENROUTER_BASE_URL,
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://app.fireworks.ai/settings/users/api-keys",
    modelsUrl: "https://app.fireworks.ai/models",
    gatewayBaseUrl: FIREWORKS_BASE_URL,
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://cloud.siliconflow.cn/me/account/ak",
    modelsUrl: "https://cloud.siliconflow.cn/models",
    gatewayBaseUrl: SILICONFLOW_BASE_URL,
  },
  {
    id: "qwen-token-plan",
    label: "Qwen Token Plan",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://platform.qianwenai.com/pricing/token-plan",
    modelsUrl:
      "https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview",
    gatewayBaseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    id: "qwen-pay-as-you-go",
    label: "Qwen Pay-As-You-Go",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://platform.qianwenai.com/docs/api-reference/preparation/api-key",
    modelsUrl: "https://www.qianwenai.com/models",
    gatewayBaseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    id: "google",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    envBaseUrlKey: "GEMINI_BASE_URL",
    apiKeyUrl: "https://aistudio.google.com/api-keys",
    modelsUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    envBaseUrlKey: "ANTHROPIC_BASE_URL",
    apiKeyUrl: "https://platform.claude.com/settings/keys",
    modelsUrl: "https://docs.claude.com/en/docs/about-claude/models/overview",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    modelsUrl: "https://platform.openai.com/docs/models",
  },
  {
    id: "zhipu",
    label: "Z.AI (GLM)",
    envKey: "ZAI_API_KEY",
    envBaseUrlKey: "ZAI_BASE_URL",
    apiKeyUrl: "https://open.bigmodel.cn/apikey/platform",
    modelsUrl: "https://docs.z.ai/guides/overview/pricing",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    envKey: "MOONSHOT_API_KEY",
    envBaseUrlKey: "MOONSHOT_BASE_URL",
    apiKeyUrl: "https://platform.kimi.com/console/api-keys",
    modelsUrl: "https://platform.kimi.com/docs/pricing",
  },
  {
    id: "minimax",
    label: "MiniMax",
    envKey: "MINIMAX_API_KEY",
    envBaseUrlKey: "MINIMAX_BASE_URL",
    // The pay-as-you-go key page; a Token Plan Subscription Key (Billing > Token Plan) works
    // against the same endpoint, so the group is not tied to either billing mode.
    apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    modelsUrl: "https://platform.minimax.io/docs/guides/models-intro",
  },
  { id: "custom", label: "Custom", envKey: "OPENAI_API_KEY", envBaseUrlKey: "OPENAI_BASE_URL" },
];

/** Three-bucket price literal (unit fixed to usd_per_mtok). */
/**
 * Converts official CNY pricing to USD for storage (prices are always persisted in USD). The
 * conversion rate matches the web display's 7:1 convention, so switching the UI to CNY shows
 * exactly the vendor's official CNY price.
 */
function cny(cacheRead: number, cacheWrite: number, output: number): ModelPricing {
  const r = (v: number): number => Math.round((v / 7) * 1e6) / 1e6;
  return usd(r(cacheRead), r(cacheWrite), r(output));
}

function usd(cacheRead: number, cacheWrite: number, output: number): ModelPricing {
  return { unit: "usd_per_mtok", cache_read: cacheRead, cache_write: cacheWrite, output };
}

/**
 * Built-in model catalog, clustered by provider. Within each provider, entries are in
 * dictionary order by model id, except that newer versions of the same series come first
 * (e.g. gpt-5.6-* before gpt-5.5, claude-opus-4.8 before 4.7, glm-5.2 before glm-5). The
 * order is precomputed by hand right here — no runtime sorting anywhere.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // -- DeepSeek (official CNY pricing: cache hit / cache miss / output). Re-read 2026-08-18
  // from api-docs.deepseek.com/quick_start/pricing after the official price increase
  // introduced time-based tiers: the rows store the OFF-PEAK tier (the lower published
  // price, issue #313's display choice); peak hours (Beijing 9:00-12:00 and 14:00-18:00)
  // bill exactly double every bucket, so peak usage is underestimated 2x (same single-rate
  // limitation as the long-context surcharges in the file header). --
  {
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.05, 1.5, 4.5),
    supportsVision: false,
  },
  {
    // The experimental vision revision of V4 Flash (added 2026-08-21): image input on top of
    // the base model's text capabilities, at the same published price.
    modelId: "deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.05, 1.5, 4.5),
    supportsVision: true,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.15, 4.5, 13.5),
    supportsVision: false,
  },
  // -- OpenRouter (gateway: OpenAI-compatible protocol, preset base URL). Prices re-read in
  // one pass on 2026-08-07 from the models API (/api/v1/models; the API is authoritative
  // where a model's web page disagrees); the DeepSeek rows, the rows added on 2026-08-18
  // (gemini-3.7-flash, grok-4.6, deepseek-v4-pro-0813, glm-5.3, the openai/* additions) and
  // every pre-existing openai/* and google/* row were re-read on 2026-08-18 from the model
  // pages and the per-model endpoints API.
  //
  // Protocol: rows pin `openai-chat` except the `openai/*` rows, which pin
  // `openai-responses` - OpenRouter serves the Responses API at {base}/responses (the same
  // https://openrouter.ai/api/v1 base URL these rows already carry), and AgentHub 0.4.2
  // verified that pairing live. The switch is deliberately limited to the OpenAI family:
  // OpenRouter will translate /responses for any upstream, but the Responses client leans on
  // OpenAI-specific reasoning-item round-tripping (replaying encrypted_content / signature /
  // summary and the assistant `phase`), which is only guaranteed when the upstream is
  // genuinely OpenAI. Non-OpenAI rows therefore stay on Chat Completions.
  //
  // Price buckets: cache_read stores the published input_cache_read
  // (falling back to the input price for the rows without one — the :free rows and the
  // GPT Pro tiers, which publish no cache discount); cache_write stores
  // input_cache_write only when it is a genuine per-token write premium (the Anthropic, GPT
  // and qwen3.8-max rows, 1.25x input) —
  // Gemini's field is an hourly cache-STORAGE rate, not a per-token price, so those rows
  // keep the input price — and otherwise also carries the input price. The :free tier and
  // the openrouter/free Free Models Router store a genuine $0 price (not "unknown"), so
  // costs correctly compute to 0. GPT models are uniformly vision-capable (OpenAI
  // product-line policy) even where the gateway page omits the modality.
  //
  // Discounts: these rows store what OpenRouter actually BILLS, so an active promotion is
  // stored at its discounted rate (unlike the direct-vendor rows, which keep the list price).
  // The endpoints API exposes the running promotion as `pricing.discount` on the default
  // endpoint; rows sitting on one say so and name the rate to restore, because a lapsed
  // promotion silently doubles the real cost — that is exactly how the gpt-5.6-terra and
  // gpt-5.6-luna rows drifted 2x low before the 2026-08-18 re-read. --
  {
    modelId: "anthropic/claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-5",
    displayName: "Claude Opus 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.8",
    displayName: "Claude Opus 4.8",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.2, 2.5, 10),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.0157192, 0.078596, 0.157192),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.0168, 0.0679, 0.168),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // DeepSeek serves this one alone on OpenRouter, so the stored rates are its own published
    // USD list ($0.22 / $0.66 / $0.007 cache read), and the context window is that endpoint's
    // 1,048,576. Like the direct group, the price is the OFF-PEAK tier: the models API exposes
    // the peak windows as `pricing.overrides` billing exactly double.
    modelId: "deepseek/deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.007, 0.22, 0.66),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The 0813 general-availability release of DeepSeek V4 Pro (OpenRouter listing dated
    // 2026-08-12); the default routed endpoint is DeepSeek's own API, so the price matches
    // the official USD list, and the context window is the default endpoint's 1,048,576.
    modelId: "deepseek/deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro 0813",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.022, 0.66, 1.98),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.022, 0.66, 1.98),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Same Gemini cache conventions as the gemini-3.6-flash row below. The stored rates are
    // what OpenRouter currently bills: the default Google endpoint runs `discount: 0.75` off
    // the $0.15/$1.50/$7.50 list price (Google's launch discount through 2026-12-31, which
    // OpenRouter deepens further), so it bills $0.0375/$0.375/$1.875 — re-read when the
    // discount ends, and restore the $0.15/$1.50/$7.50 list then (the direct-vendor row
    // stores that list price already).
    modelId: "google/gemini-3.7-flash",
    displayName: "Gemini 3.7 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0375, 0.375, 1.875),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // cache_read is billed as its own bucket in the cost center, and an input-priced
    // cache_read would overstate cache-heavy Gemini spend 10x; cache_write repeats the input
    // price (see the block comment — Gemini publishes storage-per-hour, not per-token write),
    // matching the direct-vendor Gemini rows below.
    modelId: "google/gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "google/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 9),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Same published-cache-price convention as gemini-3.6-flash above (2026-07-22: $0.03/mtok
    // cache hit, $0.30 input, $2.50 output).
    modelId: "google/gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.03, 0.3, 2.5),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // No official separate cache price published: cache_read uses the standard input price (no discount assumed).
    modelId: "minimax/minimax-m3",
    displayName: "MiniMax M3",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.0992, 0.589, 2.48),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    displayName: "Nemotron 3 Ultra (free)",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  // The openai/* rows below mirror the direct OpenAI group one-for-one, and are the only
  // gateway rows on the Responses protocol (see the block comment). Their context windows
  // are OpenRouter's published 1,050,000 / 400,000, matching the direct rows.
  {
    // The 50% promotion this row used to store has ended: OpenRouter now bills the full
    // $0.20/$1.20 rate (endpoints API `discount: 0`), so the stored rates doubled on the
    // 2026-08-18 re-read.
    modelId: "openai/gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.02, 0.25, 1.2),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Running a `discount: 0.5` promotion as of 2026-08-18, so OpenRouter bills half the
    // $0.50/$6.25/$30 list price — restore the list rates when the promotion ends.
    modelId: "openai/gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.25, 3.125, 15),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Same lapsed promotion as the luna row: now billed at the full $2/$12 rate.
    modelId: "openai/gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.2, 2.5, 12),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.5",
    displayName: "GPT-5.5",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.5, 5, 30),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // No published cache discount (the Pro tiers bill cached input at the standard rate), so
    // cache_read carries the input price — same convention as the direct gpt-5.5-pro row.
    modelId: "openai/gpt-5.5-pro",
    displayName: "GPT-5.5 Pro",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(30, 30, 180),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.4",
    displayName: "GPT-5.4",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.25, 2.5, 15),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    provider: "openrouter",
    contextWindow: 400000,
    pricing: usd(0.075, 0.75, 4.5),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.4-nano",
    displayName: "GPT-5.4 nano",
    provider: "openrouter",
    contextWindow: 400000,
    pricing: usd(0.02, 0.2, 1.25),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // No published cache discount, as with gpt-5.5-pro above.
    modelId: "openai/gpt-5.4-pro",
    displayName: "GPT-5.4 Pro",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(30, 30, 180),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // OpenRouter's unified Free Models Router: each request is routed to a random free model
    // currently on OpenRouter, filtered by the features the request needs (tool calling,
    // structured outputs, ...). Routed targets vary, so the context window is a deliberately
    // conservative figure rather than any single target's real window: it keeps the 75%
    // compaction clamp meaningful (compaction fires at 96000) and reduces hard context-length
    // 400s on small-window targets. supportsVision stays false deliberately: the harness must
    // not send images to a router whose target may be text-only.
    modelId: "openrouter/free",
    displayName: "Free Models Router",
    provider: "openrouter",
    contextWindow: 128000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.25, 2.5, 6),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.6-35b-a3b",
    displayName: "Qwen 3.6 35B A3B",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.05, 0.14, 1),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // No official separate cache price published: cache_read uses the standard input price.
    modelId: "stepfun/step-3.7-flash",
    displayName: "Step 3.7 Flash",
    provider: "openrouter",
    contextWindow: 256000,
    pricing: usd(0.04, 0.2, 1.15),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "tencent/hy3",
    displayName: "Hy3",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.033, 0.132, 0.528),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Thinking Machines Lab's Inkling (released 2026-07-14): multimodal (image + audio
    // input). Specs from its OpenRouter page; pricing from the models API (2026-08-07),
    // which publishes $1 input (the page shows $0.95) and a $0.17 cached-input price.
    modelId: "thinkingmachines/inkling",
    displayName: "Inkling",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.17, 1, 4.05),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // xAI's Grok 4.6 (OpenRouter listing dated 2026-08-12): same $2/$6 input/output rates as
    // Grok 4.5 with a raised $0.50 cache-hit price.
    modelId: "x-ai/grok-4.6",
    displayName: "Grok 4.6",
    provider: "openrouter",
    contextWindow: 500000,
    pricing: usd(0.5, 2, 6),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "x-ai/grok-4.5",
    displayName: "Grok 4.5",
    provider: "openrouter",
    contextWindow: 500000,
    pricing: usd(0.3, 2, 6),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "xiaomi/mimo-v2.5",
    displayName: "MiMo-V2.5",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0028, 0.14, 0.28),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The gateway listing of the direct glm-5.3 row below; OpenRouter's single Z.AI endpoint
    // passes Z.AI's published price straight through (no discount), which is why the two
    // rows agree to the cent. Text-only, per the listing's modalities.
    modelId: "z-ai/glm-5.3",
    displayName: "GLM-5.3",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The gateway listing of the direct glm-5.3-flash row below, sitting on a 50%-off ZAI
    // promotion through 2026-09-09 16:00 UTC (Z.AI's own price list names the same window as
    // 24:00 on 2026-09-09, UTC+8). Stored at the discounted rate the gateway actually bills;
    // when it lapses, restore 0.03 / 0.15 / 0.5. Unlike the direct row, this one carries
    // vision: the listing takes text, images and video, and the generic openai-chat client it
    // pins does convert image_url parts.
    modelId: "z-ai/glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.015, 0.075, 0.25),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "z-ai/glm-5.2",
    displayName: "GLM-5.2",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.1261, 0.679, 2.134),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENROUTER_BASE_URL,
  },
  // -- Fireworks AI (gateway, standard serverless USD pricing: cached input / uncached
  // input / output from each model's page; API ids use the accounts/fireworks/models/<slug>
  // form) --
  {
    modelId: "accounts/fireworks/models/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.028, 0.14, 0.28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.03, 0.14, 0.28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.15, 1.74, 3.48),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/glm-5p2",
    displayName: "GLM-5.2",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.14, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    // Thinking Machines Lab's Inkling (released 2026-07-14): multimodal (image + audio
    // input); specs and serverless pricing from its Fireworks model page (2026-08-06).
    modelId: "accounts/fireworks/models/inkling",
    displayName: "Inkling",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.17, 1, 4.05),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/kimi-k3",
    displayName: "Kimi K3",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/kimi-k2p7-code",
    displayName: "Kimi K2.7 Code",
    provider: "fireworks",
    contextWindow: 262144,
    pricing: usd(0.19, 0.95, 4),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/minimax-m3",
    displayName: "MiniMax M3",
    provider: "fireworks",
    contextWindow: 524288,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  // -- SiliconFlow (gateway, official CNY pricing: cache hit / input / output) --
  {
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    displayName: "DeepSeek V4 Flash",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(0.02, 1, 2),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "deepseek-ai/DeepSeek-V4-Pro",
    displayName: "DeepSeek V4 Pro",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(0.1, 12, 24),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "meituan-longcat/LongCat-2.0",
    displayName: "LongCat 2.0",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(0.1, 5, 20),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "moonshotai/Kimi-K2.7-Code",
    displayName: "Kimi K2.7 Code",
    provider: "siliconflow",
    contextWindow: 262144,
    pricing: cny(1.3, 6.5, 27),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  // The Pro/ and Qwen/ entries below were unpriced until 2026-08-03 (SiliconFlow's price
  // list sits behind an authenticated console); prices below are its official CNY list
  // prices.
  {
    modelId: "Pro/moonshotai/Kimi-K2.6",
    displayName: "Kimi K2.6",
    provider: "siliconflow",
    contextWindow: 262144,
    pricing: cny(1.1, 6.5, 27),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    // No cache-hit price on the list, so cache_read carries the input price.
    modelId: "Qwen/Qwen3.6-35B-A3B",
    displayName: "Qwen 3.6 35B A3B",
    provider: "siliconflow",
    contextWindow: 262144,
    pricing: cny(1.8, 1.8, 10.8),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "zai-org/GLM-5.2",
    displayName: "GLM-5.2",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  // -- Qwen Token Plan (subscription gateway; vision flags per the plan's supported-model
  // table). Pricing and context windows from each model's page at
  // www.qianwenai.com/models/<id> (official CNY list prices; limited-time promotions such as
  // the 20%/50% off discounts are not stored). Lineup updated 2026-08-03: qwen3.8-max and
  // deepseek-v4-flash-0731 join; qwen3.8-max-preview and qwen3.7-max leave the plan. --
  {
    modelId: "deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.2, 1, 2),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(1, 12, 24),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "glm-5.2",
    displayName: "GLM-5.2",
    provider: "qwen-token-plan",
    contextWindow: 1048576,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(1.5, 12, 36),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.4, 2, 8),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  // -- Qwen Pay-As-You-Go (DashScope's OpenAI-compatible pay-per-token marketplace; official
  // CNY list prices and specs from each model's page at www.qianwenai.com/models/<id> —
  // resold third-party models keep their upstream ids exactly as the page lists them: kimi/
  // and ZHIPU/ carry vendor prefixes, DeepSeek is listed bare) --
  {
    modelId: "deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.2, 1, 2),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "kimi/kimi-k3",
    displayName: "Kimi K3",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1048576,
    pricing: cny(2, 20, 100),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    // Official CNY list price from www.qianwenai.com/models/qwen3.8-flash: CNY 1 input /
    // CNY 0.1 cache hit / CNY 3 output per MTok, over a 1M-token input window with a 131K
    // output cap. Its input modalities include images and video, and this group's
    // openai-chat client converts image parts.
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.1, 1, 3),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(1.5, 12, 36),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.4, 2, 8),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "ZHIPU/GLM-5.2",
    displayName: "GLM-5.2",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1048576,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  // -- MiniMax (direct M3 Responses client; official USD pay-as-you-go list prices, standard
  // tier at <=512K input — every rate doubles above 512K, and the priority tier is 1.5x). --
  {
    modelId: "MiniMax-M3",
    displayName: "MiniMax M3",
    provider: "minimax",
    contextWindow: 1000000,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
    clientType: "minimax-m3",
    baseUrl: MINIMAX_BASE_URL,
  },
  // -- Google Gemini (official USD pricing) --
  {
    // Official list price, identical to gemini-3.6-flash (per AgentHub 0.4.2's registry and
    // Google's price page). Google halves all three rates as a launch discount through
    // 2026-12-31; like other limited-time promotions the discount is not stored (the
    // OpenRouter row bills — and stores — the halved rates instead).
    modelId: "gemini-3.7-flash",
    displayName: "Gemini 3.7 Flash",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    supportsVision: true,
  },
  {
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    supportsVision: true,
  },
  {
    modelId: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 9),
    supportsVision: true,
  },
  {
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.03, 0.3, 2.5),
    supportsVision: true,
  },
  {
    modelId: "gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash-Lite",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.025, 0.25, 1.5),
    supportsVision: true,
  },
  {
    // ≤200K input tier; >200K has official surcharge pricing (see file header comment).
    modelId: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro (Preview)",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.2, 2, 12),
    supportsVision: true,
  },
  {
    modelId: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash (Preview)",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.05, 0.5, 3),
    supportsVision: true,
  },
  // -- Anthropic (official USD pricing; cache write = 1.25 x input). Re-read 2026-08-20 from
  // platform.claude.com/docs/en/about-claude/pricing. Sonnet 5's $2 input / $10 output is its
  // standard rate rather than an introductory one, so it prices below Sonnet 4.6 — that
  // inversion is Anthropic's list, not a transcription slip. Anthropic bills the full 1M
  // window at a single rate, so none of the long-context tiers named in the file header apply
  // here, and the fast-mode premium on Opus 5 / Opus 4.8 ($10 input / $50 output) is a
  // separate tier these rows do not record. --
  {
    modelId: "claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
  },
  {
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
  },
  {
    modelId: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
  },
  {
    modelId: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
  },
  {
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.2, 2.5, 10),
    supportsVision: true,
  },
  {
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.3, 3.75, 15),
    supportsVision: true,
  },
  // -- OpenAI (official USD pricing) --
  {
    // The bare gpt-5.6 id routes to gpt-5.6-sol upstream and is priced as that tier, so the
    // row names the Sol codename its siblings and the openai/gpt-5.6-sol row already show —
    // the id stays bare, only the label says which variant this is; served by AgentHub
    // 0.4.2's native gpt-5.6 client. The three rows here mirror the openai/*
    // OpenRouter rows above, which carry the gateway's (currently discounted) rates instead
    // of this list price.
    modelId: "gpt-5.6",
    displayName: "GPT-5.6 Sol",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.5, 5, 30),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.02, 0.2, 1.2),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.2, 2, 12),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.5",
    displayName: "GPT-5.5",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.5, 5, 30),
    supportsVision: true,
  },
  {
    // No official cache discount: cache_read uses the standard input price.
    modelId: "gpt-5.5-pro",
    displayName: "GPT-5.5 Pro",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(30, 30, 180),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.4",
    displayName: "GPT-5.4",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.25, 2.5, 15),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    provider: "openai",
    contextWindow: 400000,
    pricing: usd(0.075, 0.75, 4.5),
    supportsVision: true,
  },
  {
    modelId: "gpt-5.4-nano",
    displayName: "GPT-5.4 nano",
    provider: "openai",
    contextWindow: 400000,
    pricing: usd(0.02, 0.2, 1.25),
    supportsVision: true,
  },
  {
    // No official cache discount: cache_read uses the standard input price.
    modelId: "gpt-5.4-pro",
    displayName: "GPT-5.4 Pro",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(30, 30, 180),
    supportsVision: true,
  },
  // -- Z.AI (GLM) --
  {
    // Announced 2026-08-14 and served by AgentHub 0.4.2's unified GLM client. Z.AI's price
    // list (docs.z.ai/guides/overview/pricing, read 2026-08-18) publishes the same USD rates
    // as glm-5.2 / glm-5.1.
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    provider: "zhipu",
    contextWindow: 1000000,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
  },
  {
    // Z.AI's price list (docs.z.ai/guides/overview/pricing) publishes $0.15 input / $0.03
    // cached input / $0.50 output; a 50% promotion halves all three through 24:00 on
    // 2026-09-09 (UTC+8). Direct-vendor rows record the vendor's list price, so that is what
    // is stored here — the OpenRouter z-ai/glm-5.3-flash row above carries the promotional
    // rate it is actually billed at.
    //
    // Vision stays off even though the model is natively multimodal (docs.z.ai/guides/vlm/
    // glm-5.3-flash: images, video and files): AgentHub's GLM client rejects image parts
    // outright — "GLM-5 does not support image inputs." — which is the same limitation that
    // keeps glm-5v-turbo out of this catalog entirely. Flip this to true once the pinned
    // @prismshadow/agenthub range resolves to a release whose glm5_3 client forwards
    // image_url parts.
    modelId: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "zhipu",
    contextWindow: 1000000,
    pricing: usd(0.03, 0.15, 0.5),
    supportsVision: false,
  },
  {
    modelId: "glm-5.2",
    displayName: "GLM-5.2",
    provider: "zhipu",
    contextWindow: 1000000,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
  },
  {
    modelId: "glm-5.1",
    displayName: "GLM-5.1",
    provider: "zhipu",
    contextWindow: 200000,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
  },
  {
    modelId: "glm-5",
    displayName: "GLM-5",
    provider: "zhipu",
    contextWindow: 200000,
    pricing: usd(0.2, 1, 3.2),
    supportsVision: false,
  },
  // -- Moonshot (Kimi) (official CNY pricing) --
  {
    modelId: "kimi-k3",
    displayName: "Kimi K3",
    provider: "moonshot",
    contextWindow: 1048576,
    pricing: cny(2, 20, 100),
    supportsVision: true,
  },
  {
    modelId: "kimi-k2.6",
    displayName: "Kimi K2.6",
    provider: "moonshot",
    contextWindow: 262144,
    pricing: cny(1.1, 6.5, 27),
    supportsVision: true,
  },
  {
    modelId: "kimi-k2.5",
    displayName: "Kimi K2.5",
    provider: "moonshot",
    contextWindow: 262144,
    pricing: cny(0.7, 4, 21),
    supportsVision: true,
  },
];

/**
 * Canonical spelling of an AgentHub client-type string. AgentHub 0.4.2 renamed the generic
 * Chat Completions client from `openai` to `openai-chat`; the bare `openai` spelling still
 * routes upstream as a deprecated alias, but the harness converges on the canonical name —
 * config reads/writes and API request handling all normalize through here, so configs saved
 * before the rename keep working while comparisons (legacy-protocol display, catalog sync)
 * see one spelling. Any other value (including `openai-responses` / `openai-embedding`,
 * which merely contain "openai") passes through unchanged.
 */
export function canonicalClientType(clientType: string | undefined): string | undefined {
  if (clientType === undefined) return undefined;
  return clientType.trim().toLowerCase() === "openai" ? "openai-chat" : clientType;
}

/** Looks up a catalog entry by (provider, upstream id) pair (**the sole catalog-matching entry point**); returns undefined if not in the catalog. */
export function catalogEntryFor(
  provider: string,
  upstreamId: string,
): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.modelId === upstreamId);
}

/** Looks up provider info by provider id; returns undefined for an unknown id. */
export function providerInfo(providerId: string): ModelProviderInfo | undefined {
  return MODEL_PROVIDERS.find((p) => p.id === providerId);
}

/** Env var fallback for a single model (the var names AgentHub's client actually reads when api_key / base_url is blank). */
export interface ModelEnvInfo {
  envKey: string;
  envBaseUrlKey: string;
}

/**
 * Resolves the env var fallback for a model: mirrors AgentHub's
 * AutoLLMClient routing rules - an explicit client_type takes priority; otherwise the lowercase
 * model_id is matched by the same exact or family-specific rules, returning the var pair that
 * client reads. Branch order matches AutoLLMClient.
 * Returns undefined on no match (AgentHub will reject that id: it needs an explicit
 * client_type, or should be added under custom / a self-built group via the OpenAI protocol).
 */
export function resolveModelEnv(modelId: string, clientType?: string): ModelEnvInfo | undefined {
  const explicitClientType = clientType?.toLowerCase();
  const t = explicitClientType || modelId.toLowerCase();
  const env = (prefix: string): ModelEnvInfo => ({
    envKey: `${prefix}_API_KEY`,
    envBaseUrlKey: `${prefix}_BASE_URL`,
  });
  if (t.includes("gemini-3") || t.includes("gemini-embedding")) return env("GEMINI");
  if (
    t.includes("claude") &&
    (t.includes("4-7") || t.includes("4-8") || t.includes("-5") || t.includes("4-6"))
  ) {
    return env("ANTHROPIC");
  }
  if (t.includes("gpt-5.4") || t.includes("gpt-5.5") || t.includes("gpt-5.6")) {
    return env("OPENAI");
  }
  // agenthub 0.4.2's unified GLM client serves the whole glm-5 series (5.3 included).
  if (t.includes("glm-5")) return env("ZAI");
  // agenthub 0.4.2's unified Kimi client serves the whole K2.5+ series; every spelling reads
  // the same MOONSHOT_* pair.
  if (t.includes("kimi-k3") || t.includes("kimi-k2.5") || t.includes("kimi-k2.6")) {
    return env("MOONSHOT");
  }
  if (t === "minimax-m3" && modelId.toLowerCase() === "minimax-m3") {
    return env("MINIMAX");
  }
  if (t.includes("deepseek-v4")) return env("DEEPSEEK");
  // agenthub 0.4.2's generic Anthropic Messages protocol client reads the ANTHROPIC_* pair.
  // Order mirrors AutoLLMClient: ant-messages before the openai substring match.
  if (t.includes("ant-messages")) return env("ANTHROPIC");
  // The generic OpenAI-protocol clients — openai-chat (canonical since agenthub 0.4.2, with
  // bare "openai" as a deprecated alias), openai-responses and openai-embedding — all read
  // the OPENAI_* pair.
  if (t.includes("openai")) return env("OPENAI");
  return undefined;
}

/**
 * The wire protocol that would carry AgentHub's `fast_mode` for a model: `"openai"` for the
 * OpenAI-protocol clients (openai_chat / openai_responses / gpt5_6 / minimax_m3), which send
 * `service_tier: "priority"`, and `"anthropic"` for the Anthropic-protocol ones (ant_messages
 * / claude5), which send `speed: "fast"` plus the `fast-mode-2026-02-01` beta header. The two
 * differ in what the user must be warned about, not just in wire shape (see fastModeProtocol).
 */
export type FastModeProtocol = "openai" | "anthropic";

/**
 * Whether a model can carry fast mode at all, and on which protocol - `undefined` means no.
 *
 * The fast tier is a property of the **client AgentHub routes to**, never of the catalog row:
 * the registry carries no fast-tier capability flag, but the routing is deterministic, so the
 * answer is too. This mirrors AutoLLMClient's branch order exactly (the same discipline as
 * resolveModelEnv above) and reports what the selected client does with the parameter:
 *
 * - maps it -> the protocol, and the toggle may be offered;
 * - raises UnsupportedParameterError (gemini3_7, glm5_3, kimi_k3, deepseek_v4,
 *   openai_embedding, and claude5 on Bedrock or a Claude 4.6 id) -> `undefined`;
 * - routes nowhere (AutoLLMClient throws for an id it cannot place; there is no openai_chat
 *   fallback) -> `undefined` as well, since a model that cannot run has no fast tier either.
 *
 * A rule rather than a per-model list on purpose: catalog rows added later inherit the right
 * answer without anyone remembering to update a table.
 *
 * Routing reads `(clientType || modelId).toLowerCase()`, exactly as AutoLLMClient resolves it,
 * so an entry that pins no client_type self-routes on its model id - which does not always
 * agree with its provider group (`anthropic/claude-fable-5` with a blank client_type reaches
 * the native claude5 client, not openai_chat, and the dotted `anthropic/claude-opus-4.8`
 * matches no branch at all). The two claude5 carve-outs are therefore checked against the raw
 * `modelId` / `baseUrl`, not against the routing token: the client tests its own `_model` for
 * `"4-6"` and its base URL for the `bedrock://` prefix.
 *
 * `"anthropic"` is reported for every Claude the client serves, including ids outside the
 * research preview's Opus allowlist: Anthropic answers those with a 429 at request time, which
 * is something to warn about before enabling, not grounds to hide the setting.
 *
 * Two runtime inputs stay invisible to a pure function of the config and can still flip the
 * answer: the server's `CLIENT_TYPE` env var overrides the entry's client type, and
 * `ANTHROPIC_BASE_URL` supplies the base URL when the entry leaves it blank (so a `bedrock://`
 * there sends Claude to Bedrock, which has no fast tier). Third-party OpenAI-compatible
 * endpoints are a third: they accept `service_tier` and may quietly serve the standard tier.
 * That residue is why llm/generative-model.ts still handles the rejection at runtime.
 */
export function fastModeProtocol(
  modelId: string,
  clientType?: string,
  baseUrl?: string,
): FastModeProtocol | undefined {
  const t = clientType?.toLowerCase() || modelId.toLowerCase();
  // Branch order mirrors AutoLLMClient. Every test is a substring of `t` except minimax-m3,
  // which the router matches by exact equality; no trimming, matching the router.
  if (t === "minimax-m3") return "openai";
  if (t.includes("gemini-3") || t.includes("gemini-embedding")) return undefined;
  if (
    t.includes("claude") &&
    (t.includes("4-6") || t.includes("4-7") || t.includes("4-8") || t.includes("-5"))
  ) {
    // claude5 refuses fast mode on Bedrock and across the Claude 4.6 family; both tests run
    // against what the client was constructed with, not against the routing token.
    if (baseUrl?.startsWith("bedrock://")) return undefined;
    if (modelId.includes("4-6")) return undefined;
    return "anthropic";
  }
  if (t.includes("gpt-5.4") || t.includes("gpt-5.5") || t.includes("gpt-5.6")) return "openai";
  if (t.includes("glm-5")) return undefined;
  if (t.includes("kimi-k3") || t.includes("kimi-k2.5") || t.includes("kimi-k2.6")) return undefined;
  if (t.includes("deepseek-v4")) return undefined;
  if (t.includes("ant-messages")) return "anthropic";
  if (t.includes("openai-responses")) return "openai";
  if (t.includes("openai") && t.includes("embedding")) return undefined;
  if (t.includes("openai")) return "openai";
  return undefined;
}

/**
 * Catalog -> preset ModelEntry list (shared by defaultProjectConfig and the server's initial
 * config, avoiding duplicate hand-written copies). `provider` and `model_id` are persisted as
 * separate fields (`model_id` is the plain upstream id); models whose upstream id can be
 * auto-routed by AgentHub leave client_type unset; gateway models (OpenRouter / SiliconFlow)
 * always pin a client_type — openai-chat, or openai-responses for the OpenRouter openai/*
 * rows — and inline a preset base_url. The direct MiniMax M3 entry also pins its protocol and
 * endpoint. No secrets are included, so only an API key is needed.
 */
export function presetModelEntries(): ModelEntry[] {
  return MODEL_CATALOG.map((m) => ({
    provider: m.provider,
    model_id: m.modelId,
    ...(m.contextWindow !== undefined ? { context_window: m.contextWindow } : {}),
    ...(m.clientType !== undefined ? { client_type: m.clientType } : {}),
    ...(m.pricing ? { pricing: { ...m.pricing } } : {}),
    // ModelEntry.vision defaults to supported: only models that don't support images
    // explicitly persist false (drives the read_image / describe_image choice and input
    // image hand-off, see project-config.ts).
    ...(m.supportsVision ? {} : { vision: false }),
    ...(m.baseUrl !== undefined ? { base_url: m.baseUrl } : {}),
  }));
}

/**
 * The model's own homepage/detail page for the frontend's model-card link. Gateway groups
 * have a stable per-model URL pattern (works for user-added ids in those groups too);
 * direct-vendor models link to the vendor's model list/docs page; custom and user-defined
 * groups have no page to vouch for.
 */
export function modelHomepageUrl(provider: string, modelId: string): string | undefined {
  if (provider === "openrouter") return `https://openrouter.ai/${modelId}`;
  if (provider === "qwen-token-plan") {
    return `https://www.qianwenai.com/models/${modelId}`;
  }
  if (provider === "fireworks") {
    // API id "accounts/<owner>/models/<slug>" -> page "app.fireworks.ai/models/<owner>/<slug>";
    // nonconforming (user-added) ids fall back to the models listing.
    const m = /^accounts\/([^/]+)\/models\/(.+)$/.exec(modelId);
    return m
      ? `https://app.fireworks.ai/models/${m[1]}/${m[2]}`
      : providerInfo(provider)?.modelsUrl;
  }
  if (provider === "qwen-pay-as-you-go") {
    return `https://www.qianwenai.com/models/${encodeURIComponent(modelId)}`;
  }
  if (provider === "zhipu") {
    // Z.AI's per-model guide pages use the bare model id as the slug.
    return `https://docs.z.ai/guides/llm/${modelId}`;
  }
  if (provider === "moonshot") {
    // Moonshot's pricing pages: kimi-k2.6 -> chat-k26 (dot dropped); other ids fall back.
    const m = /^kimi-k(\d+)\.(\d+)$/.exec(modelId);
    return m
      ? `https://platform.kimi.com/docs/pricing/chat-k${m[1]}${m[2]}`
      : providerInfo(provider)?.modelsUrl;
  }
  if (provider === "custom") return undefined;
  return providerInfo(provider)?.modelsUrl;
}
