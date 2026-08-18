/**
 * Built-in model catalog (single source of truth): official chat models that AgentHub can
 * auto-route, shared by core's default config, server's initial config, and web/cli display.
 * Data verified as of 2026-07-10 (Qwen Token Plan entries: 2026-07-20; MiniMax: 2026-08-03, per each provider's docs).
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
 * (delisted 2026-08-06; the Z.AI direct glm-5.1 remains), non-chat models (embedding / image
 * generation / TTS), and Bedrock. Direct-vendor ids are auto-routed by AgentHub and leave
 * client_type unset; the five gateway groups (OpenRouter, Fireworks AI, SiliconFlow, Qwen
 * Token Plan, Qwen Pay-As-You-Go) can't be auto-routed, so they set `client_type: "openai"`
 * and inline their preset base URL. The MiniMax M3 preset pins AgentHub's first-party
 * `minimax-m3` protocol and direct API endpoint.
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
  // Gateways (their model ids can't be auto-routed by AgentHub, so they always use
  // client_type=openai + a preset base URL): they go through AgentHub's OpenAI client, so when
  // credential is blank the SDK reads **OPENAI_API_KEY / OPENAI_BASE_URL** (not the provider's
  // own var names) - the env fallback hint must reflect that accurately.
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
  // -- DeepSeek (official CNY pricing: cache hit / cache miss / output) --
  {
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.02, 1, 2),
    supportsVision: false,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.025, 3, 6),
    supportsVision: false,
  },
  // -- OpenRouter (gateway: OpenAI-compatible protocol, preset base URL). Prices re-read in
  // one pass on 2026-08-07 from the models API (/api/v1/models; the API is authoritative
  // where a model's web page disagrees): cache_read stores the published input_cache_read
  // (falling back to the input price for the few rows without one — the :free rows); cache_write stores
  // input_cache_write only when it is a genuine per-token write premium (the Anthropic, GPT
  // and qwen3.8-max rows, 1.25x input) —
  // Gemini's field is an hourly cache-STORAGE rate, not a per-token price, so those rows
  // keep the input price — and otherwise also carries the input price. The :free tier and
  // the openrouter/free Free Models Router store a genuine $0 price (not "unknown"), so
  // costs correctly compute to 0. GPT models are uniformly vision-capable (OpenAI
  // product-line policy) even where the gateway page omits the modality. --
  {
    modelId: "anthropic/claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-5",
    displayName: "Claude Opus 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.8",
    displayName: "Claude Opus 4.8",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.2, 2.5, 10),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.018, 0.09, 0.18),
    supportsVision: false,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.01764, 0.0882, 0.1764),
    supportsVision: false,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.003625, 0.435, 0.87),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "google/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 9),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // inclusionAI's free tier of Ling-3.0-flash (released 2026-07-23): 124B-param MoE with
    // ~5.1B active params per token, text-only; context and $0 pricing per the OpenRouter
    // models API (2026-07-24).
    modelId: "inclusionai/ling-3.0-flash:free",
    displayName: "Ling 3.0 Flash (free)",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.0992, 0.589, 2.48),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    displayName: "Nemotron 3 Ultra (free)",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The page shows the $0.10/$0.60 rate under a "50% off" banner; the models API bills the
    // same numbers (with real hit/write prices), so this row stores them — re-read when the
    // promotion ends.
    modelId: "openai/gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.01, 0.125, 0.6),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 30),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.1, 1.25, 6),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "openai/gpt-5.5",
    displayName: "GPT-5.5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 5, 30),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.25, 2.5, 6),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.6-35b-a3b",
    displayName: "Qwen 3.6 35B A3B",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.05, 0.14, 1),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "tencent/hy3",
    displayName: "Hy3",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.033, 0.132, 0.528),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "x-ai/grok-4.5",
    displayName: "Grok 4.5",
    provider: "openrouter",
    contextWindow: 500000,
    pricing: usd(0.3, 2, 6),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "xiaomi/mimo-v2.5",
    displayName: "MiMo-V2.5",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0028, 0.14, 0.28),
    supportsVision: true,
    clientType: "openai",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "z-ai/glm-5.2",
    displayName: "GLM-5.2",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.1261, 0.679, 2.134),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.03, 0.14, 0.28),
    supportsVision: false,
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.15, 1.74, 3.48),
    supportsVision: false,
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/glm-5p2",
    displayName: "GLM-5.2",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.14, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/kimi-k3",
    displayName: "Kimi K3",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/kimi-k2p7-code",
    displayName: "Kimi K2.7 Code",
    provider: "fireworks",
    contextWindow: 262144,
    pricing: usd(0.19, 0.95, 4),
    supportsVision: true,
    clientType: "openai",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    modelId: "accounts/fireworks/models/minimax-m3",
    displayName: "MiniMax M3",
    provider: "fireworks",
    contextWindow: 524288,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "deepseek-ai/DeepSeek-V4-Pro",
    displayName: "DeepSeek V4 Pro",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(0.1, 12, 24),
    supportsVision: false,
    clientType: "openai",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "meituan-longcat/LongCat-2.0",
    displayName: "LongCat 2.0",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(0.1, 5, 20),
    supportsVision: false,
    clientType: "openai",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "moonshotai/Kimi-K2.7-Code",
    displayName: "Kimi K2.7 Code",
    provider: "siliconflow",
    contextWindow: 262144,
    pricing: cny(1.3, 6.5, 27),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "zai-org/GLM-5.2",
    displayName: "GLM-5.2",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(1, 12, 24),
    supportsVision: false,
    clientType: "openai",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "glm-5.2",
    displayName: "GLM-5.2",
    provider: "qwen-token-plan",
    contextWindow: 1048576,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(1.5, 12, 36),
    supportsVision: true,
    clientType: "openai",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.4, 2, 8),
    supportsVision: true,
    clientType: "openai",
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
    clientType: "openai",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "kimi/kimi-k3",
    displayName: "Kimi K3",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1048576,
    pricing: cny(2, 20, 100),
    supportsVision: true,
    clientType: "openai",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(1.5, 12, 36),
    supportsVision: true,
    clientType: "openai",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.4, 2, 8),
    supportsVision: true,
    clientType: "openai",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    modelId: "ZHIPU/GLM-5.2",
    displayName: "GLM-5.2",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1048576,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai",
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
  // -- Anthropic (official USD pricing; cache write = 1.25 x input) --
  {
    modelId: "claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
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
  if (t.includes("gpt-5.4") || t.includes("gpt-5.5")) return env("OPENAI");
  if (t.includes("glm-5")) return env("ZAI");
  // agenthub 0.4.1 routes kimi-k3 to its own client, which reads the same MOONSHOT_* pair.
  if (t.includes("kimi-k3")) return env("MOONSHOT");
  if (t.includes("kimi-k2.5") || t.includes("kimi-k2.6")) return env("MOONSHOT");
  if (t === "minimax-m3" && modelId.toLowerCase() === "minimax-m3") {
    return env("MINIMAX");
  }
  if (t.includes("deepseek-v4")) return env("DEEPSEEK");
  if (t.includes("openai")) return env("OPENAI");
  return undefined;
}

/**
 * Catalog -> preset ModelEntry list (shared by defaultProjectConfig and the server's initial
 * config, avoiding duplicate hand-written copies). `provider` and `model_id` are persisted as
 * separate fields (`model_id` is the plain upstream id); models whose upstream id can be
 * auto-routed by AgentHub leave client_type unset; gateway models (OpenRouter / SiliconFlow)
 * explicitly set client_type=openai and inline a preset base_url. The direct MiniMax M3 entry
 * also pins its protocol and endpoint. No secrets are included, so only an API key is needed.
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
