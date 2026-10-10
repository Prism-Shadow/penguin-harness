/**
 * Built-in model catalog (single source of truth): official chat models that MMSP can
 * auto-route, shared by core's default config, server's initial config, and web/cli display.
 * Data verified as of 2026-07-10 (Qwen Token Plan entries: 2026-07-20; MiniMax: 2026-08-03;
 * DeepSeek, GLM-5.3 and the whole OpenAI line-up (direct + OpenRouter):
 * 2026-08-18; the direct Anthropic group: 2026-08-20; the DeepSeek V4 Flash Vision Exp rows:
 * 2026-08-21; the TokenDance group: 2026-08-25, its glm-5.3-flash row: 2026-08-26, its
 * qwen3.8-flash row: 2026-08-27 and its running promotions plus the hy4-preview rows
 * (TokenDance + OpenRouter): 2026-08-28; the GLM-5.3 Flash rows (direct + OpenRouter) and
 * the direct qwen3.8-flash: 2026-08-26; the TokenDance Doubao Seed rows (seed-2.1-pro,
 * seed-2.1-turbo, seed-evolving): 2026-09-02; the vLLM group: 2026-09-03; the GPT-6 Astra
 * rows (direct + OpenRouter): 2026-09-09; the whole Gemini 3.x line-up, direct + OpenRouter —
 * the 3.6 / 3.8 Flash launch discounts declared, every other row re-read and unchanged:
 * 2026-09-09; the OpenRouter and TokenDance V4.1 Flash rows, and TokenDance's running
 * promotions plus its Doubao Seed display names: 2026-09-10; the Penguin Go resale lineup,
 * matched to the relay's current generic-client model export: 2026-09-11, its DeepSeek rows to
 * DeepSeek's own lineup: 2026-09-16; the OpenRouter z-ai/glm-5.3-flash row: 2026-09-16; and
 * the 2026-09-16 refresh — the direct DeepSeek group down to the two names its pricing page
 * lists, TokenDance's deepseek-v4-flash-0731 / deepseek-v4-pro-0813 / kimi-k3 promotions, the
 * OpenRouter qwen/qwen3.8-27b row, the Fireworks AI and SiliconFlow additions, and both Qwen
 * groups' line-ups with their peak/off-peak DeepSeek rows: 2026-09-16; the OpenCode Go group:
 * 2026-09-18 — per each provider's docs; the ModelScope group, whose preset ids were read
 * from public model pages and endpoint listings — their windows, vision flags and prices are
 * NOT verified and say so on the rows themselves: 2026-09-18 and 2026-09-20; and the
 * 2026-10-10 refresh — Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 and GPT-6.1 Sol
 * (direct + OpenRouter) per MMSP 0.5.2's registry and the vendor pages it carries, the whole
 * TokenDance group re-read from its public portal API, the OpenRouter Step 5 Preview, Grok 4.7
 * and MiMo-V2.6-Flash rows, SiliconFlow's GLM-5.3 Flash and Hy4 preview rows, and Gemini 3.7
 * Flash dropped from every group, Google rerouting the id to 3.8 Flash: 2026-10-10).
 * Docs: packages/docs/content/models.{zh,en}.md (site path /docs/models) documents the
 * provider groups and credential resolution described here.
 *
 * Three-bucket pricing convention (USD per million tokens, matching usageToTokenCounts'
 * token-to-bucket mapping):
 * - cache_read: the vendor's "cache hit" price;
 * - cache_write: the vendor's "cache write" price (e.g. Anthropic uses 1.25 x input); vendors
 *   without a separate cache-write fee use the standard input price;
 * - output: output price (thinking + reply).
 * OpenAI charges extra for >272K input, Gemini 3.1 Pro for >200K input, MiniMax M3 doubles
 * every rate above 512K input, and Claude Haiku 5.5 quintuples every rate above 100K; this
 * catalog records their base tier (the cost center uses a single rate, so long-context usage
 * will be underestimated).
 *
 * Scope: excludes deepseek-chat / deepseek-reasoner legacy aliases (deprecated 2026-07-24),
 * glm-5v-turbo (MMSP's Z.AI client forwards images
 * only for glm-5.3-flash, so a vision model cannot do the one thing it exists for), the
 * OpenRouter z-ai/glm-5.1 and SiliconFlow Pro/zai-org/GLM-5.1 gateway listings
 * (delisted 2026-08-06; the Z.AI direct glm-5.1 remains), the OpenRouter
 * inclusionai/ling-3.0-flash:free listing (delisted from OpenRouter, removed 2026-08-18),
 * non-chat models (embedding / image generation / TTS), and Bedrock. Direct-vendor ids are
 * auto-routed by MMSP and leave client_type unset; seven gateway groups (OpenRouter,
 * Fireworks AI, SiliconFlow, TokenDance, OpenCode Go, Qwen Pay-As-You-Go and Qwen Token Plan)
 * can't be auto-routed, so every gateway row **always pins an explicit client_type** and
 * names its preset base URL. ModelScope's rows pin one protocol too (see below).
 * These are reference values, never runtime fallbacks: a new Project's file receives them
 * once — a group's shared endpoint and protocol in its `[providers.<id>]` table
 * (presetProviderTable), a row's own only where it differs from its group's
 * (catalogModelEntry) — as do "Add new models" and "Restore defaults"; from then on the file
 * alone says where a request goes (effectiveConnection reads no catalog).
 * Four groups pin at GROUP level as well (ModelProviderInfo.clientType, read
 * through providerClientType), so that a model the user adds there speaks the same protocol
 * as the presets: vLLM, whose added models have no preset base URL to inherit either, and
 * OpenRouter, TokenDance and SiliconFlow, whose do — see each group's own block comment.
 * That pin is load-bearing, not decoration: MMSP's AutoLLMClient routes an unpinned id by
 * the family its spelling begins with and never looks at base_url (see routedClientType), so
 * an unpinned gateway id would be placed by its own spelling — `deepseek-ai/DeepSeek-V4` would
 * reach DeepSeek's official client aimed at a gateway, and `openai/gpt-5.6-sol` would throw
 * outright (no known family begins with "openai/"). Four protocols are pinned:
 * - `openai-responses` for every OpenRouter row: OpenRouter serves the Responses API for
 *   every upstream at the same base URL the rows already carry, and the group pins the same
 *   protocol so a user-added entry inherits it;
 * - `openai-chat` for the other OpenAI-compatible gateway rows (the generic Chat Completions
 *   client — the bare "openai" spelling is a deprecated upstream alias, see
 *   canonicalClientType);
 * - `openai-chat-vllm-adapter` for the vLLM group, which is Chat Completions on the wire
 *   but maps the thinking level onto the served model's own chat template
 *   (VLLM_CLIENT_TYPE);
 * - `ant-messages` for the OpenCode Go rows its endpoint table serves on the Anthropic
 *   Messages API. That group pins row by row, since its models sit on three protocols: the
 *   rest of it is `openai-chat` and `openai-responses` — see its block comment.
 * ModelScope's rows all pin `openai-responses`: ModelScope serves every preset through its
 * OpenAI Responses endpoint, and the explicit pin keeps a Qwen or DeepSeek id from auto-routing
 * to a vendor client with a different request shape.
 *
 * App attribution (`attributionHeaders`, bottom of this file) rides alongside the protocol
 * pins: it names PenguinHarness to the gateways that read such a header, keyed on the
 * endpoint host rather than on the provider group.
 *
 * This file imports no Node built-ins (type-only imports only), so it can be bundled directly
 * for the browser.
 */
import type {
  ModelEntry,
  ModelPricing,
  ProviderConnection,
  ProviderTable,
} from "./project-config.js";

/** Model provider info (used for web grouping/logo and the "API key blank falls back to env var" hint). */
/**
 * A provider that mints API keys through an authorization page instead of a console visit.
 * Present only on providers that publish such a flow; its absence is what makes the harness
 * refuse to start one.
 */
export interface ModelProviderOAuth {
  /** Authorization page the user is sent to; the flow's parameters ride on its query string. */
  authorizeUrl: string;
  /** Endpoint that trades an authorization code for a newly minted key. */
  exchangeUrl: string;
  /** Name recorded on the minted key, and the app name the authorization page displays. */
  keyName: string;
}

/**
 * A group whose credential the App obtains through its own authorization flow rather than by
 * asking the vendor: the client registers a one-time code and device secret with an external
 * bridge, sends the user to the page that bridge hands back, and polls until the bridge
 * delivers the credential. Distinct from `oauth`, where the App itself speaks the vendor's
 * PKCE page — here the App never reaches the vendor at all, because the bridge holds the
 * client secret that conversation would need.
 *
 * The bridge's own address is deliberately NOT here: this file is bundled for the browser and
 * cannot read configuration, so the App resolves the bridge server-side from its environment
 * (PENGUIN_GO_ORIGIN / MODELSCOPE_BRIDGE_URL), keyed by the group's id.
 */
export interface ModelProviderBridgeAuth {
  /**
   * Which App-side flow serves this group — one route family and one service per value, so
   * the Web App picks from the group's descriptor rather than from its id.
   */
  flow: "penguin-go" | "modelscope";
}

/**
 * An account-balance endpoint the vendor publishes, called with the group's own API key as a
 * Bearer token. The server makes that call (the key never reaches the browser); the endpoint
 * is the vendor's, like the OAuth one above, so it can live in this browser-bundled file.
 */
export interface ModelProviderBalance {
  /** GET endpoint answering the balance of the account the key belongs to. */
  url: string;
  /**
   * How to read the answer, one reader per published response shape:
   * - `tokendance`: `{ balance: { credits, credits_used, balance } }`, integers in micro-yuan
   *   (1 CNY = 1,000,000);
   * - `deepseek`: `{ is_available, balance_infos: [{ currency, total_balance, … }] }`, one entry
   *   per currency the account holds.
   */
  format: "tokendance" | "deepseek";
}

export interface ModelProviderInfo {
  id: string;
  /** Display name (brand name, shared by Chinese and English UI). */
  label: string;
  /**
   * API key env var name: the pair MMSP's client for this group's rows reads when handed no
   * key. Whether a keyless row may actually lean on it is decided per entry by
   * modelEnvFallback — a gateway group records OPENAI_* because that is what its generic
   * client reads, and precisely for that reason its rows never get the fallback.
   */
  envKey: string;
  /** base URL env var name. */
  envBaseUrlKey: string;
  /** Console URL for obtaining an API key (frontend links it beside the API key field of the group key dialog and the model dialog); none for custom. */
  apiKeyUrl?: string;
  /** Vendor's model list / docs page URL (frontend's "add model" dialog links this as "get model id"); none for custom. */
  modelsUrl?: string;
  /**
   * Gateway's OpenAI-compatible endpoint (openrouter / siliconflow / qwen-token-plan / …): what
   * a new Project writes as the group's `[providers.<id>]` base URL (catalogGroupConnection),
   * so every row of the group — a model added by hand included — follows it without storing
   * the address itself. A reference value: nothing reads it when a request is built. Left
   * blank for direct vendors and custom.
   */
  gatewayBaseUrl?: string;
  /**
   * Authorization flow that mints a key for the user (see ModelProviderOAuth); absent for
   * every provider whose keys are only obtainable from its console.
   */
  oauth?: ModelProviderOAuth;
  /**
   * The App-side authorization flow that obtains this group's credential (see
   * ModelProviderBridgeAuth); absent for every group whose credential comes from a console or
   * from the vendor's own page. Declaring it is what puts the "authorize a key" action on the
   * group in the Web App.
   */
  bridgeAuth?: ModelProviderBridgeAuth;
  /**
   * The vendor's account-balance endpoint (see ModelProviderBalance); absent for every group
   * whose vendor publishes none. Declaring it is what puts the balance in the group's header.
   */
  balance?: ModelProviderBalance;
  /**
   * The group takes models the user adds by hand: `custom` and vLLM, whose rows point at an
   * endpoint the catalog cannot know, and the three gateways whose catalogs list a fraction of
   * what they serve — OpenRouter, TokenDance and SiliconFlow — where an added model follows
   * the group's connection (its endpoint, key and protocol) exactly as the presets do. Every
   * other built-in group carries its catalog presets and the rows it already stores, and
   * nothing else. Read it through isAddableGroup, which also answers for user-defined groups.
   */
  addable?: boolean;
  /**
   * The MMSP protocol EVERY entry in this group speaks, models the user adds included.
   *
   * Set it where the group itself decides the answer for a row the catalog does not list:
   * every group that takes hand-added models and speaks one protocol (vLLM, OpenRouter,
   * TokenDance, SiliconFlow). The other gateways hold catalog rows only, each carrying its own
   * pin, and `custom` / user-defined groups deliberately declare nothing — their whole point
   * is that the protocol is detected from the endpoint or picked by hand, and a pin here
   * would take that choice away.
   *
   * Where it IS set, a new Project writes it as the group's `[providers.<id>]` protocol
   * (catalogGroupConnection), and the rows — models added by hand included — follow that
   * table. A reference value like gatewayBaseUrl: what the app reads at runtime is the file's
   * table. Read it through providerClientType rather than reaching for the field.
   */
  clientType?: string;
  /**
   * The group the product recommends, captioned as such on the models page. It marks the
   * GROUP, not a position: a user who drags the group elsewhere keeps the caption with it,
   * and the default sequence below is what places it first for everyone else.
   */
  recommended?: boolean;
}

/** A single built-in model's catalog entry (`modelId` is the upstream id; paired with `provider` it forms the catalog's unique key). */
export interface ModelCatalogEntry {
  modelId: string;
  displayName: string;
  /** Provider id (one of MODEL_PROVIDERS). */
  provider: string;
  contextWindow?: number;
  pricing?: ModelPricing;
  /**
   * Fraction off the list price the seller is currently running (0.5 = 50% off), applied to
   * every bucket. `pricing` stays the LIST price whatever promotion is live, so a lapsed
   * promotion is one field to delete rather than three numbers to reconstruct;
   * effectivePricing is the rate actually billed. A Project stores the list price too: the
   * fraction is seeded beside it as a promotion (presetPromotions), which the cost center
   * applies when it prices usage, so it charges what the seller charges.
   */
  discount?: number;
  /**
   * A discount that is only live outside a weekly set of peak windows — a vendor billing
   * cheaper off-hours. `pricing` holds the PEAK price, the one billed inside the windows, and
   * the rate applies everywhere else.
   *
   * Like `discount`, this one is never baked into a Project, and here there is no choice: it
   * changes twice a day. `presetModelEntries` writes the peak price and the rate is applied
   * when a price is read.
   * A number on disk that silently meant something different at 09:00 than at 08:00 would be
   * unreadable, and re-syncing presets would rewrite prices by the clock. Mutually exclusive
   * with `discount`; an entry declaring both is a catalog error.
   */
  offPeakDiscount?: OffPeakDiscount;
  /** Whether image input (vision modality) is supported. */
  supportsVision: boolean;
  /** MMSP client type: required when an id cannot be auto-routed or a shared protocol must be pinned. */
  clientType?: string;
  /**
   * Preset base URL, so only an API key is required. A new Project stores it once: on the
   * group's `[providers.<id>]` table when it is the group's endpoint (catalogGroupConnection),
   * else on the row itself (catalogModelEntry). Never read when a request is built.
   */
  baseUrl?: string;
  /**
   * The seller no longer offers this row, but Projects created while it did still carry it: a
   * row a Project has is never deleted by "Sync presets", and several of these were the default
   * model of new Projects. A retired row is not a preset — `presetModelEntries` and
   * `presetPromotions` skip it, so a new Project never gets it or a promotion for it, and a sync
   * never adds it — but it is still in `catalogModelEntries`, so a sync keeps updating the row
   * on a Project that carries it, and lookups by `(provider, modelId)` still find it. Those
   * Projects keep its display name and vision flag, and their usage on it is priced on its
   * off-peak schedule whenever the row stores the catalog's price: the tier only applies to that
   * price, and a sync puts back a price an older release stored. The schedule is the part that
   * matters: cost is priced when it is read, so deleting a scheduled row would reprice every
   * off-peak record already on those Projects at the peak rate.
   *
   * Compatibility, not catalog data: remove a retired row only after its seller has stopped
   * accepting the id AND the release notes have told users that usage recorded on it will be
   * priced without its schedule from then on. Whoever does the catalog refresh that finds the
   * id rejected makes that call.
   */
  retired?: true;
}

/**
 * MMSP's client for models served by vLLM's OpenAI-compatible Chat Completions API. It is
 * Chat Completions on the wire, but a distinct client: it maps the thinking level onto the
 * `chat_template_kwargs` the SERVED model's chat template reads, which differs per model
 * family, so `openai-chat` would silently lose that mapping.
 */
const VLLM_CLIENT_TYPE = "openai-chat-vllm-adapter";

/** Preset provider endpoints; only OpenAI-compatible gateways expose theirs as gatewayBaseUrl. */
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
const QWEN_TOKEN_PLAN_BASE_URL =
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
const QWEN_PAYG_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
const TOKENDANCE_BASE_URL = "https://tokendance.space/gateway/v1";
const MINIMAX_BASE_URL = "https://api.minimax.io/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1";
export const PENGUIN_GO_BASE_URL = "https://token.penguin.ooo/api";
/** OpenCode Go's OpenAI-protocol base: the clients append /chat/completions or /responses. */
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
/** OpenCode Go's Anthropic Messages base: the SDK appends /v1/messages itself, so no /v1 here. */
const OPENCODE_GO_MESSAGES_BASE_URL = "https://opencode.ai/zen/go";

/** Provider id for the preconfigured Penguin Go relay group. */
export const PENGUIN_GO_PROVIDER_ID = "penguin-go";

/** Provider id for the ModelScope group. */
export const MODELSCOPE_PROVIDER_ID = "modelscope";

/**
 * Provider list (web model page groups in this order BY DEFAULT — a user's dragged
 * arrangement is stored per Project and wins over this sequence; see the web's
 * model-group-order.ts). The sequence is a hand-curated display order: TokenDance leads as
 * the recommended group, Penguin Go follows, then OpenCode Go, then DeepSeek as the default
 * model's provider, and custom
 * (custom OpenAI-protocol models) is always last; in between, gateways and first-party
 * vendors are interleaved by expected use rather than sorted by kind. Only this default
 * moves when the curation changes: a Project that has ever reordered its groups has every
 * key stored already, so it keeps the arrangement its user built.
 *
 * The seven gateway groups — OpenRouter, Fireworks AI, SiliconFlow, TokenDance, OpenCode Go,
 * Qwen Pay-As-You-Go and Qwen Token Plan — reach their models through MMSP's generic
 * protocol clients (`openai-responses` for OpenRouter, `openai-chat` for the rest, and all
 * three generic clients within OpenCode Go). Those clients read the vendor variables
 * (**OPENAI_API_KEY / OPENAI_BASE_URL**, and ANTHROPIC_* for OpenCode Go's `ant-messages`
 * rows) when the credential is blank, not the gateway's own variable names, so every gateway
 * group records the OPENAI_* pair as the fact it is — and that is exactly why a keyless
 * gateway row is refused the fallback (see modelEnvFallback): the variable holds the user's
 * OpenAI (or Anthropic) key, and a gateway is neither. ModelScope also records the OPENAI_*
 * pair because its group credential is an api-inference access token; its rows are refused
 * the fallback on the same terms.
 */
export const MODEL_PROVIDERS: ModelProviderInfo[] = [
  {
    id: "tokendance",
    label: "TokenDance",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://tokendance.space/keys",
    modelsUrl: "https://tokendance.space/models",
    gatewayBaseUrl: TOKENDANCE_BASE_URL,
    // Every preset speaks Chat Completions, and the group takes models added by hand
    // (`addable`), which follow the group: a new Project's `[providers.tokendance]` carries
    // this pin, so such a row resolves to it.
    clientType: "openai-chat",
    addable: true,
    recommended: true,
    // https://tokendance.space/docs/api-key-oauth
    oauth: {
      authorizeUrl: "https://tokendance.space/auth",
      exchangeUrl: "https://tokendance.space/portal/api/v1/auth/keys",
      keyName: "PenguinHarness",
    },
    // https://tokendance.space/docs/open-api (the account's wallet, in micro-yuan)
    balance: {
      url: "https://tokendance.space/portal/api/v1/user/balance",
      format: "tokendance",
    },
  },
  {
    id: PENGUIN_GO_PROVIDER_ID,
    label: "Penguin Go",
    // The authorization flow writes the relay key once, on the group's `[providers.penguin-go]`
    // table. Keep the env names private to this relay so the UI never suggests using a vendor
    // credential here. Every row names the relay, so a new Project writes that endpoint on the
    // group; its rows sit on two protocols, so each row stores its own.
    envKey: "PENGUIN_GO_API_KEY",
    envBaseUrlKey: "PENGUIN_GO_BASE_URL",
    apiKeyUrl: "https://token.penguin.ooo/",
    modelsUrl: "https://token.penguin.ooo/",
    bridgeAuth: { flow: "penguin-go" },
  },
  {
    // One key serves the whole group, but its models sit on three protocols (see the group's
    // block comment in MODEL_CATALOG), so no group-level pin: a new Project writes each row's
    // protocol on the row, and the Messages base on the seven rows that use it. The env pair
    // records what its Chat Completions majority's client reads. Like every gateway's, a
    // keyless row is refused that fallback (modelEnvFallback): the key goes on the group or
    // the row.
    id: "opencode-go",
    label: "OpenCode Go",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://opencode.ai/auth",
    modelsUrl: "https://opencode.ai/docs/go/",
    gatewayBaseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    envBaseUrlKey: "DEEPSEEK_BASE_URL",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    modelsUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    // https://api-docs.deepseek.com/api/get-user-balance
    balance: { url: `${DEEPSEEK_BASE_URL}/user/balance`, format: "deepseek" },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://openrouter.ai/workspaces/default/keys",
    modelsUrl: "https://openrouter.ai/models",
    gatewayBaseUrl: OPENROUTER_BASE_URL,
    // The whole group speaks the Responses API, which OpenRouter serves at the preset base
    // URL below for every upstream — presets and user-added entries alike.
    clientType: "openai-responses",
    // The catalog lists a fraction of what OpenRouter serves, so the group takes more.
    addable: true,
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
    id: "google",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    envBaseUrlKey: "GEMINI_BASE_URL",
    apiKeyUrl: "https://aistudio.google.com/api-keys",
    modelsUrl: "https://ai.google.dev/gemini-api/docs/models",
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
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    envBaseUrlKey: "ANTHROPIC_BASE_URL",
    apiKeyUrl: "https://platform.claude.com/settings/keys",
    modelsUrl: "https://docs.claude.com/en/docs/about-claude/models/overview",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://cloud.siliconflow.cn/me/account/ak",
    modelsUrl: "https://cloud.siliconflow.cn/models",
    gatewayBaseUrl: SILICONFLOW_BASE_URL,
    // As TokenDance: Chat Completions throughout, and models added by hand follow the group.
    clientType: "openai-chat",
    addable: true,
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
    // ModelScope's own inference service: OpenAI-compatible, reselling other vendors' models
    // under `org/Model-Name` ids. Two things set it apart from the gateways above.
    //
    // Its credential is the account's access token rather than a minted API key, and the
    // group obtains one through the authorization bridge instead of sending the user to copy
    // it out of the console (bridgeAuth below; the console link stays for anyone who already
    // has a token). ModelScope is the vendor here as well as the gateway — the bridge exists
    // because its OAuth requires a client secret the desktop App cannot keep locally, not
    // because inference requests are routed through that bridge.
    //
    // Every preset row names the endpoint and one protocol in the catalog, so a new Project
    // writes both on the group's `[providers.modelscope]` table and the rows follow it.
    id: MODELSCOPE_PROVIDER_ID,
    label: "ModelScope",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    apiKeyUrl: "https://www.modelscope.cn/my/myaccesstoken",
    modelsUrl: "https://www.modelscope.cn/models",
    gatewayBaseUrl: MODELSCOPE_BASE_URL,
    bridgeAuth: { flow: "modelscope" },
  },
  {
    // Self-hosted: the user runs the server, so there is no console to mint a key at
    // (apiKeyUrl) and no endpoint to preset (gatewayBaseUrl). modelsUrl points at the recipe
    // index, which is where the served ids in this group are documented.
    id: "vllm",
    label: "vLLM",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    modelsUrl: "https://recipes.vllm.ai/",
    clientType: VLLM_CLIENT_TYPE,
    // The served ids are the user's own, so this group keeps taking models added by hand.
    addable: true,
  },
  {
    id: "custom",
    label: "Custom",
    envKey: "OPENAI_API_KEY",
    envBaseUrlKey: "OPENAI_BASE_URL",
    addable: true,
  },
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
 * A weekly peak/off-peak billing schedule, written in a fixed-offset zone.
 *
 * Only fixed offsets are expressible, which is the whole of what the catalog needs: the vendors
 * that bill this way publish their windows in a single national zone that does not observe DST
 * (Beijing is UTC+8 year round). A vendor on a DST zone would need a real tz database, and the
 * honest move then is to add one rather than to approximate.
 */
export interface OffPeakDiscount {
  /** Fraction off the peak price outside the windows below (0.5 = half price). */
  rate: number;
  /** Minutes east of UTC the windows are written in (Beijing = 480). */
  utcOffsetMinutes: number;
  /** Days the windows apply to, ISO numbering: 1 = Monday … 7 = Sunday. Days not listed are off-peak all day. */
  peakDays: readonly number[];
  /** Peak windows as [startHour, endHour) in the zone's local hours — end-exclusive, so 12:00 is already off-peak. */
  peakHours: readonly (readonly [number, number])[];
}

/**
 * Whether `now` falls outside every peak window, i.e. whether the discount is live.
 *
 * Computed in UTC arithmetic rather than through the host's local time: the schedule belongs to
 * the vendor's zone, and a server in Los Angeles must reach the same answer as one in Shanghai.
 */
export function offPeakAt(schedule: OffPeakDiscount, now: Date): boolean {
  const local = new Date(now.getTime() + schedule.utcOffsetMinutes * 60_000);
  // getUTCDay is 0 = Sunday; the ISO numbering the schedule uses puts Sunday at 7.
  const isoDay = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  if (!schedule.peakDays.includes(isoDay)) return true;
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  return !schedule.peakHours.some(([from, to]) => hour >= from && hour < to);
}

/** DeepSeek's official off-peak tier: half price outside Beijing weekday 09:00–12:00 and 14:00–18:00. */
export const DEEPSEEK_OFF_PEAK: OffPeakDiscount = {
  rate: 0.5,
  utcOffsetMinutes: 480,
  peakDays: [1, 2, 3, 4, 5],
  peakHours: [
    [9, 12],
    [14, 18],
  ],
};

/**
 * Qwen's off-peak tier on the time-banded models it sells (www.qianwenai.com/models/<id>, read
 * 2026-09-16): half price from 22:00 to 08:00 Beijing time, every day of the week, and the peak
 * price at every other hour. Each model page shows the two tiers as separate price tabs, and
 * every bucket's off-peak figure is exactly half its peak one.
 */
export const QWEN_OFF_PEAK: OffPeakDiscount = {
  rate: 0.5,
  utcOffsetMinutes: 480,
  peakDays: [1, 2, 3, 4, 5, 6, 7],
  peakHours: [[8, 22]],
};

/**
 * The catalog's time-based schedules, each with the references that carry it.
 *
 * The cost center needs this to split an aggregation by tier before it prices anything: the
 * rate a request ran at is a fact about when it ran, and only the catalog knows which rows have
 * two rates at all. Grouped by schedule so a second vendor's windows cost one entry, not a
 * second query.
 */
export function offPeakScheduledRefs(): Array<{
  schedule: OffPeakDiscount;
  refs: Array<{ provider: string; modelId: string }>;
}> {
  const bySchedule = new Map<
    OffPeakDiscount,
    { schedule: OffPeakDiscount; refs: Array<{ provider: string; modelId: string }> }
  >();
  for (const entry of MODEL_CATALOG) {
    const schedule = entry.offPeakDiscount;
    if (schedule === undefined) continue;
    const group = bySchedule.get(schedule) ?? { schedule, refs: [] };
    group.refs.push({ provider: entry.provider, modelId: entry.modelId });
    bySchedule.set(schedule, group);
  }
  return [...bySchedule.values()];
}

/**
 * What the seller actually bills for an entry: its list `pricing` less any running `discount`,
 * on every bucket. Rounded to the six decimals cny() already stores at, so a promotional rate
 * reads as a price rather than as a float artifact. An entry with no discount (or no pricing at
 * all) is returned untouched.
 *
 * Nothing writes this rate into a Project: `presetModelEntries` writes the list price (a
 * scheduled row's peak price), a flat promotion is stored beside it as a fraction, and which
 * tier a request ran in is decided from that request's own timestamp when the usage is
 * aggregated.
 */
export function effectivePricing(
  entry: ModelCatalogEntry,
  now: Date = new Date(),
): ModelPricing | undefined {
  const { pricing } = entry;
  if (pricing === undefined) return pricing;
  // A scheduled discount bills the list price during its peak windows and the reduced rate
  // outside them; a flat one always bills the reduced rate.
  const rate =
    entry.offPeakDiscount !== undefined
      ? offPeakAt(entry.offPeakDiscount, now)
        ? entry.offPeakDiscount.rate
        : 0
      : entry.discount;
  if (rate === undefined || rate === 0) return pricing;
  const off = (v: number): number => Math.round(v * (1 - rate) * 1e6) / 1e6;
  return {
    unit: pricing.unit,
    cache_read: off(pricing.cache_read),
    cache_write: off(pricing.cache_write),
    output: off(pricing.output),
  };
}

/**
 * Built-in model catalog, clustered by provider. Within each provider, entries are in
 * dictionary order by model id, except that newer versions of the same series come first
 * (e.g. gpt-5.6-* before gpt-5.5, claude-opus-4.8 before 4.7, glm-5.2 before glm-5). The
 * order is precomputed by hand right here — no runtime sorting anywhere.
 *
 * The clusters run in their own sequence, which is the row order a new Project's
 * `[[models]]` table is written in. It is not MODEL_PROVIDERS' display order and does not
 * have to track it: nothing renders a catalog row outside its provider group, and the page
 * takes the group sequence from MODEL_PROVIDERS.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // -- DeepSeek (official CNY pricing: cache hit / cache miss / output). Prices and model
  // names re-read 2026-09-16 from api-docs.deepseek.com/zh-cn/quick_start/pricing, which now
  // lists exactly two names, both with a 1M context window and a 384K output cap:
  // `deepseek-flash` (DeepSeek-V4.1-Flash, image input) on the peak tier CNY 0.04 / 2 / 8, and
  // `deepseek-v4-pro` (DeepSeek-V4-Pro-0813, text only) at 0.30 / 9 / 27. The rows store the
  // PEAK tier and declare DEEPSEEK_OFF_PEAK, which halves every bucket outside Beijing weekday
  // 09:00-12:00 and 14:00-18:00 — so both tiers are billed at the rate actually in force,
  // rather than one of them being approximated by the other.
  // The retired V4 Flash names, `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`, are
  // still accepted and served by V4.1 Flash at the Flash price and on the same schedule, but
  // the page no longer lists them: they stay below as retired rows, which are not presets. --
  {
    // DeepSeek's pricing page names this model `deepseek-flash` (model version
    // DeepSeek-V4.1-Flash, released as of the 2026-09-10 read): 1M context, image input, and
    // the Flash series peak price and off-peak schedule.
    modelId: "deepseek-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
  },
  {
    // Retired 2026-09-16 (see ModelCatalogEntry.retired): the default model of new Projects
    // from 0.2.0 to 0.2.8. DeepSeek still accepts the id and serves it from V4.1 Flash at the
    // Flash price, off-peak schedule included. Text only: MMSP's DeepSeek client refuses
    // image parts for this id.
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    retired: true,
  },
  {
    // Retired 2026-09-16 (see ModelCatalogEntry.retired): the default model of new Projects in
    // 0.2.9, served from V4.1 Flash at the Flash price like deepseek-v4-flash above.
    modelId: "deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    retired: true,
  },
  {
    // DeepSeek's pricing page names the model behind this id DeepSeek-V4-Pro-0813 (read
    // 2026-09-16), which is what the display name says — the same 0813 release the gateway
    // groups sell under dated ids. Text only. DeepSeek states that V4 Pro stays available
    // after 2026-09-14 with its billing unchanged, so the row keeps the V4 Pro peak price on
    // the shared off-peak schedule. MMSP's DeepSeek client also matches this bare id against
    // its text-only deny-list /^deepseek-v4-(flash|pro)(-\d{4})?$/, so image parts never
    // leave the harness for it.
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro 0813",
    provider: "deepseek",
    contextWindow: 1000000,
    pricing: cny(0.3, 9, 27),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
  },
  // -- OpenRouter (gateway: OpenAI-compatible protocol, preset base URL). Prices re-read in
  // one pass on 2026-08-07 from the models API (/api/v1/models; the API is authoritative
  // where a model's web page disagrees); the DeepSeek rows, the rows added on 2026-08-18
  // (grok-4.6, deepseek-v4-pro-0813, glm-5.3, the openai/* additions) and every
  // pre-existing openai/* and google/* row were re-read on 2026-08-18 from the model
  // pages and the per-model endpoints API. The rows added on 2026-10-10 — the four Claude 5.x
  // rows, openai/gpt-6.1-sol, stepfun/step-5-preview, x-ai/grok-4.7,
  // xiaomi/mimo-v2.6-flash and xiaomi/mimo-v2.6-pro — were read that day from the models API and the per-model
  // endpoints API, whose default endpoint runs no promotion (`discount: 0`) on any of them;
  // their context windows are the listing's `top_provider.context_length`, as on the
  // mimo-v2.5 and step-3.7-flash rows.
  //
  // Protocol: every row pins `openai-responses`. OpenRouter serves the Responses API at
  // {base}/responses for every upstream, at the same https://openrouter.ai/api/v1 base URL
  // the rows already carry, and the group pins the same protocol, which a new Project writes on
  // `[providers.openrouter]`, so an entry added to it by hand follows it. The generic Responses client sends a text-only tool result as a plain
  // string and replays reasoning items only where the upstream returned them.
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
  // Discounts: what these rows record is what OpenRouter actually BILLS, so a gateway
  // promotion is stored at its discounted rate (unlike the direct-vendor rows, which keep the
  // list price). The Gemini 3.x Flash rows are the exception: the promotion they sit on is
  // Google's own dated launch discount rather than the gateway's, so they keep the list price
  // and declare it in `discount`, exactly as their direct-vendor twins do. The endpoints API
  // exposes the running promotion as `pricing.discount` on the default endpoint; rows sitting
  // on one say so and name the rate to restore, because a lapsed promotion silently doubles
  // the real cost — that is exactly how the gpt-5.6-terra and gpt-5.6-luna rows drifted 2x
  // low before the 2026-08-18 re-read. --
  {
    // $10 input / $12.50 cache write / $0.25 cache read / $50 output, the cache read at 2.5% of
    // input as on Anthropic's own list; 1M window, image input.
    modelId: "anthropic/claude-fable-5.1",
    displayName: "Claude Fable 5.1",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.25, 12.5, 50),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // $0.10 input / $0.125 cache write / $0.01 cache read / $0.50 output for prompts up to
    // 100,000 tokens; the listing's `overrides` bill every rate 5x from 100,000 prompt tokens,
    // Anthropic's own tiering. The base tier is recorded, as for the other tiered rows.
    modelId: "anthropic/claude-haiku-5.5",
    displayName: "Claude Haiku 5.5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.01, 0.125, 0.5),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // $4 input / $5 cache write / $0.20 cache read / $20 output.
    modelId: "anthropic/claude-opus-5.5",
    displayName: "Claude Opus 5.5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.2, 5, 20),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-5",
    displayName: "Claude Opus 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.8",
    displayName: "Claude Opus 4.8",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.5, 6.25, 25),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // $2 input / $2.50 cache write / $0.10 cache read / $10 output. The cache read is half
    // Sonnet 5's $0.20: Anthropic prices it at 5% of input on this generation (MMSP 0.5.2
    // moved its registry row from $0.20), and OpenRouter bills the same.
    modelId: "anthropic/claude-sonnet-5.5",
    displayName: "Claude Sonnet 5.5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.1, 2.5, 10),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "anthropic/claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.2, 2.5, 10),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Listed 2026-09-10 from the models API: the base price is the PEAK tier and
    // `pricing.overrides` bill exactly half on weekends and outside weekday UTC 01:00-04:00 /
    // 06:00-10:00 — DeepSeek's own Beijing windows — so the row stores the peak price and
    // declares DEEPSEEK_OFF_PEAK, exactly as the direct row does. Context window and image
    // input from the same listing.
    modelId: "deepseek/deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.006, 0.3, 1.2),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.0157192, 0.078596, 0.157192),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.0168, 0.0679, 0.168),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // DeepSeek serves this one alone on OpenRouter, so the stored rates are its own published
    // USD list ($0.22 / $0.66 / $0.007 cache read), and the context window is that endpoint's
    // 1,048,576. The row keeps that flat price as the API lists it: as of the 2026-09-10 read
    // the listing carries no `pricing.overrides`, so unlike the deepseek-v4.1-flash row above
    // there is no peak/off-peak split to record here.
    modelId: "deepseek/deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.007, 0.22, 0.66),
    supportsVision: true,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.022, 0.66, 1.98),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Same Gemini cache conventions as the gemini-3.6-flash row below. OpenRouter passes
    // Google's launch discount through, so it bills $0.075/$0.75/$3.75 — the list price less
    // 50%, declared in `discount` so the $0.15/$1.50/$7.50 list survives the promotion (same
    // treatment as the 3.6 row below). Gemini 3.7 Flash is no longer listed beside it: Google
    // retires that id and reroutes it to 3.8 Flash.
    modelId: "google/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    discount: 0.5,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // cache_read is billed as its own bucket in the cost center, and an input-priced
    // cache_read would overstate cache-heavy Gemini spend 10x; cache_write repeats the input
    // price (see the block comment — Gemini publishes storage-per-hour, not per-token write),
    // matching the direct-vendor Gemini rows below. OpenRouter bills $0.075/$0.75/$3.75
    // today (endpoints API, read 2026-09-09): it reports that halved rate as its plain price
    // with `discount: 0`, but it is Google's launch discount passed through and ends with it
    // on 2026-12-31, so this row records the list price and the promotion the way its
    // siblings do.
    modelId: "google/gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    discount: 0.5,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The 3.5 tier's own list price — $1.50 input / $9.00 output / $0.15 cache hit on Google's
    // page, with no launch discount — and OpenRouter's default endpoint bills exactly that
    // (`discount: 0`, read 2026-09-09). The $9 output is the tier, not a promotion to declare.
    modelId: "google/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 9),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Same published-cache-price convention as gemini-3.6-flash above (2026-07-22: $0.03/mtok
    // cache hit, $0.30 input, $2.50 output; re-read 2026-09-09, unchanged and `discount: 0`).
    modelId: "google/gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.03, 0.3, 2.5),
    supportsVision: true,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.0992, 0.589, 2.48),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    displayName: "Nemotron 3 Ultra (free)",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  // The openai/* rows below mirror the direct OpenAI group one-for-one. Their context
  // windows are OpenRouter's published 1,050,000 / 400,000, matching the direct rows.
  {
    // Read 2026-10-10: the default endpoint is OpenAI's own, at $2 input / $0.10 cached input
    // / $2.50 cache write / $10 output with `discount: 0`, OpenAI's list. The listing's
    // `overrides` from 272,000 prompt tokens (2x prompt and cache, 1.5x completion) are the
    // long-context tier, which is not recorded, as on the direct row.
    modelId: "openai/gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(0.1, 2.5, 10),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Read 2026-09-09 from the models API and the per-model endpoints API: the default
    // endpoint is OpenAI's own, listed at $10 input / $1 cached input / $12.5 cache write /
    // $50 output with `discount: 0`, so the list price is what OpenRouter bills. The
    // endpoints API also publishes `overrides` above 272,000 prompt tokens (2x prompt and
    // cache, 1.5x completion); as on the direct row, only the base tier is recorded.
    modelId: "openai/gpt-6-astra",
    displayName: "GPT-6 Astra",
    provider: "openrouter",
    contextWindow: 1050000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Read 2026-09-16 from the models API: $0.214 input / $2.55 output with a published $0.15
    // input_cache_read, a 1,000,000-token context window, and text, image and video input.
    modelId: "qwen/qwen3.8-27b",
    displayName: "Qwen 3.8 27B",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.15, 0.214, 2.55),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.25, 2.5, 6),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "qwen/qwen3.6-35b-a3b",
    displayName: "Qwen 3.6 35B A3B",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.05, 0.14, 1),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // StepFun's own endpoint is the only one: $1 input / $2.70 output with a published $0.05
    // input_cache_read and no write premium, so cache_write carries the input price. 1,000,000
    // window; text, image and video input.
    modelId: "stepfun/step-5-preview",
    displayName: "Step 5 Preview",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.05, 1, 2.7),
    supportsVision: true,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Tencent's Hy4 preview, read 2026-08-28 from its OpenRouter page and the models API:
    // $0.834 input / $2.501 output with a published $0.042 input_cache_read, a 1,048,576
    // context window, and text-only modalities in and out. The same upstream model is sold
    // in the TokenDance group at that gateway's own CNY rate; the two rows are priced by
    // their sellers and are not copies of one another.
    modelId: "tencent/hy4-preview",
    displayName: "Hy4 preview",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.042, 0.834, 2.501),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "tencent/hy3",
    displayName: "Hy3",
    provider: "openrouter",
    contextWindow: 262144,
    pricing: usd(0.033, 0.132, 0.528),
    supportsVision: false,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // Grok 4.7 keeps Grok 4.6's $2 input / $6 output / $0.50 cache hit and its 500,000 window,
    // with image input. The listing's `overrides` double every rate from 200,000 prompt tokens;
    // the base tier is recorded.
    modelId: "x-ai/grok-4.7",
    displayName: "Grok 4.7",
    provider: "openrouter",
    contextWindow: 500000,
    pricing: usd(0.5, 2, 6),
    supportsVision: true,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "x-ai/grok-4.5",
    displayName: "Grok 4.5",
    provider: "openrouter",
    contextWindow: 500000,
    pricing: usd(0.3, 2, 6),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // $0.14 input / $0.28 output with a published $0.0028 input_cache_read, the same rates as
    // MiMo-V2.5; text, image, video and audio input.
    modelId: "xiaomi/mimo-v2.6-flash",
    displayName: "MiMo-V2.6-Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0028, 0.14, 0.28),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // $0.435 input / $0.87 output with a published $0.0036 input_cache_read (models API and
    // the per-model endpoints API, read 2026-10-10: Xiaomi's own endpoint, no discount — the
    // USD face of TokenDance's CNY 0.025 / 3 / 6); text, image, video and audio input.
    modelId: "xiaomi/mimo-v2.6-pro",
    displayName: "MiMo-V2.6-Pro",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0036, 0.435, 0.87),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "xiaomi/mimo-v2.5",
    displayName: "MiMo-V2.5",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.0028, 0.14, 0.28),
    supportsVision: true,
    clientType: "openai-responses",
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
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    // The gateway listing of the direct glm-5.3-flash row below. Stored at the rate OpenRouter's
    // default endpoint bills: DeepInfra (fp4), running `discount: 0.5` on the 0.03 / 0.15 / 0.5
    // list (endpoints API, re-read 2026-09-16) — restore the list rates when that endpoint's
    // promotion ends. Z.AI's own 50% promotion is a different one: it ended at 2026-09-09
    // 16:00 UTC, and the Z.AI endpoint on OpenRouter bills the list price since. The listing
    // takes text, images and video, and the generic Responses client it pins carries image
    // parts through.
    modelId: "z-ai/glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "openrouter",
    contextWindow: 1048576,
    pricing: usd(0.015, 0.075, 0.25),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  {
    modelId: "z-ai/glm-5.2",
    displayName: "GLM-5.2",
    provider: "openrouter",
    contextWindow: 1000000,
    pricing: usd(0.1261, 0.679, 2.134),
    supportsVision: false,
    clientType: "openai-responses",
    baseUrl: OPENROUTER_BASE_URL,
  },
  // -- Fireworks AI (gateway, standard serverless USD pricing: cached input / uncached
  // input / output from each model's page; API ids use the accounts/fireworks/models/<slug>
  // form, where Fireworks spells a version's dot as `p`: deepseek-v4p1-flash, glm-5p3). The
  // DeepSeek V4.1 Flash, DeepSeek V4 Pro 0813, GLM-5.3, GLM-5.3 Flash and Qwen 3.8 Max rows
  // were added 2026-09-16 from their fireworks.ai/models pages. Fireworks publishes no context
  // length for qwen3p8-max, so that row records the vendor's 1M window, as the other
  // qwen3.8-max rows do. --
  {
    // Fireworks' listing of the model DeepSeek serves directly as `deepseek-flash`: 1,048,576
    // context, image input, and the single serverless price its page lists, so no schedule.
    modelId: "accounts/fireworks/models/deepseek-v4p1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "fireworks",
    contextWindow: 1048576,
    pricing: usd(0.007, 0.22, 0.66),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
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
    modelId: "accounts/fireworks/models/deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro 0813",
    provider: "fireworks",
    contextWindow: 1048576,
    pricing: usd(0.044, 1.32, 3.96),
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
    modelId: "accounts/fireworks/models/glm-5p3",
    displayName: "GLM-5.3",
    provider: "fireworks",
    contextWindow: 1048576,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: FIREWORKS_BASE_URL,
  },
  {
    // Natively multimodal like every other GLM-5.3 Flash row, and this group's generic
    // openai-chat client forwards image_url parts, so image input works on this path.
    modelId: "accounts/fireworks/models/glm-5p3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "fireworks",
    contextWindow: 1048576,
    pricing: usd(0.03, 0.15, 0.5),
    supportsVision: true,
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
  {
    modelId: "accounts/fireworks/models/qwen3p8-max",
    displayName: "Qwen 3.8 Max",
    provider: "fireworks",
    contextWindow: 1000000,
    pricing: usd(0.25, 2, 6),
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
    // Added 2026-09-16, both ids confirmed in SiliconFlow's /v1/models listing. Hy4 preview is
    // text only at CNY 6 input / 18 output / 0.3 cache hit, the list price as quoted again on
    // 2026-10-10; siliconflow.cn/pricing shows the same input and output figures and no cache
    // price. Its window is the 1,048,576 tokens that page now publishes for it (the row had
    // borrowed the TokenDance row's 1,024,000). GLM-5.3 below is text only at 8 / 28 / 2, with
    // the same 1M window as zai-org/GLM-5.2.
    modelId: "tencent/Hy4-preview",
    displayName: "Hy4 preview",
    provider: "siliconflow",
    contextWindow: 1048576,
    pricing: cny(0.3, 6, 18),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    modelId: "zai-org/GLM-5.3",
    displayName: "GLM-5.3",
    provider: "siliconflow",
    contextWindow: 1000000,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: SILICONFLOW_BASE_URL,
  },
  {
    // Added 2026-10-10 at the list price quoted that day: CNY 0.23 cache hit / 0.8 input / 2.8
    // output, which is Z.AI's own CNY list for the model and what the TokenDance and Qwen
    // Pay-As-You-Go rows store. siliconflow.cn/pricing currently shows it at CNY 0, beside the
    // platform's free models; a free period is a rate no promotion field can hold, so the row
    // keeps the list price. The window is the 1,048,576 tokens that page publishes. Natively
    // multimodal (`vlm` there), and this group's openai-chat client forwards image_url parts.
    modelId: "zai-org/GLM-5.3-Flash",
    displayName: "GLM-5.3 Flash",
    provider: "siliconflow",
    contextWindow: 1048576,
    pricing: cny(0.23, 0.8, 2.8),
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
  // -- TokenDance (gateway: OpenAI-compatible protocol, preset base URL). Re-read in full on
  // 2026-10-10 from two public APIs that need no credential: the gateway's catalog (GET
  // https://tokendance.space/gateway/v1/models — ids, context windows and supported protocols)
  // and the portal's model list (GET https://tokendance.space/portal/api/models/all — names,
  // input modalities and prices). Prices are the gateway's own CNY rates. The portal publishes
  // what a model bills as `pricing.items` and, while a promotion runs, its list price beside
  // that as `pricing.reference`. TokenDance charges no separate cache-write fee, so cache_write
  // carries the input price. The per-model pages (tokendance.space/models/<id>) render in the
  // browser from the same data.
  //
  // Discounts: every row here stores the official LIST price — the portal's `reference`, or
  // its `items` where no promotion runs — the convention of the two Qwen groups below, and a
  // promoted row declares its rate in `discount` rather than having its price rewritten: a
  // promotion that lapses is then one field to delete, with the rate to return to still on the
  // row. effectivePricing() applies it; a new Project stores the list price and the fraction as
  // a promotion beside it, which the cost center applies, so it charges what the gateway
  // charges. Ten rows are promoted as of 2026-10-10: ling-3.0-flash at 65% off, the three
  // Doubao Seed rows (seed-2.1-pro, seed-2.1-turbo, seed-evolving) at 50%, deepseek-v4-flash
  // and glm-5.2 at 20%, and deepseek-v4-pro, glm-5.3, glm-5.3-flash and qwen3.8-max at 10%.
  //
  // Three DeepSeek rows — deepseek-v4.1-flash, deepseek-v4-flash-0731 and deepseek-v4-pro-0813 —
  // are priced by time instead (`pricing.time_pricing`): a peak price on weekdays 09:00-12:00
  // and 14:00-18:00 Beijing time, DeepSeek's own windows, and half the peak list price at every
  // other hour. They store the peak list price and declare DEEPSEEK_OFF_PEAK, as the direct
  // DeepSeek rows do; so does the retired deepseek-v4-flash-vision-exp row, which is no longer a
  // preset. On top of that schedule the gateway takes 20% off: in both tiers on
  // deepseek-v4.1-flash, and in the peak tier alone on the 0731 and 0813 rows. A row cannot
  // declare a flat discount beside a schedule, so that 20% is not recorded, and the cost center
  // prices those hours 25% above what the gateway bills. The rest of the group carries neither,
  // so list price and billed rate coincide.
  //
  // A running promotion usually also shows in a model's `description`, which opens with a
  // bracketed 限时 ("limited-time") tag. The tag is neither exhaustive nor authoritative on the
  // rate: kimi-k3's still announces an offer that ended 2026-09-30, and the two Seed 2.1 rows'
  // say 20% while their prices are at 50% off. The rows follow the prices.
  //
  // Display names follow the catalog's spelling of a model family where it has one (GLM-5.3,
  // Qwen 3.8 Max, MiMo-V2.5), and otherwise the portal's name without its "Vendor: " prefix
  // (Seed-2.1-Pro, Ling-3.1-flash, Step 5 Preview). Rows are in plain dictionary order by id. --
  {
    // TokenDance sells this id as "DeepSeek V4 Flash Preview", the preview release the dated
    // 0731 row below superseded, and the display name keeps that word: DeepSeek's own API now
    // serves the bare id from V4.1 Flash. Text only, 1,048,576 window. 20% off a CNY 1 input /
    // 2 output / 0.2 cache hit list, so the gateway bills 0.8 / 1.6 / 0.16, at every hour.
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash Preview",
    provider: "tokendance",
    contextWindow: 1048576,
    pricing: cny(0.2, 1, 2),
    discount: 0.2,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Text only, 1,048,576 window. Priced by time (see the block comment): a CNY 3 input / 9
    // output / 0.1 cache hit list, billed at 2.4 / 7.2 / 0.08 in the peak windows and at half
    // the list, 1.5 / 4.5 / 0.05, at every other hour. It had been quoted on 2026-09-16 as a
    // flat CNY 1.5 / 4.5 / 0.15 list at 10% off.
    modelId: "deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash 0731",
    provider: "tokendance",
    contextWindow: 1048576,
    pricing: cny(0.1, 3, 9),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Retired from TokenDance's line-up 2026-09-16 (see ModelCatalogEntry.retired). It was sold
    // on DeepSeek's own peak/off-peak schedule at the peak tier CNY 0.04 / 2 / 8, the price a
    // sync keeps on the Projects still carrying it.
    modelId: "deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
    retired: true,
  },
  {
    // Sold as "DeepSeek V4 Pro Preview", the preview release the 0813 row below superseded.
    // Text only, 1,048,576 window. 10% off a CNY 9 input / 27 output / 0.3 cache hit list, so
    // the gateway bills 8.1 / 24.3 / 0.27 at every hour: unlike the 0813 row it follows no
    // schedule.
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro Preview",
    provider: "tokendance",
    contextWindow: 1048576,
    pricing: cny(0.3, 9, 27),
    discount: 0.1,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Text only, 1,000,000 window. Priced by time like the 0731 row: a CNY 9 input / 27 output
    // / 0.3 cache hit list, DeepSeek's own peak price for V4 Pro 0813, billed at 7.2 / 21.6 /
    // 0.24 in the peak windows and at half the list, 4.5 / 13.5 / 0.15, at every other hour. It
    // had been quoted on 2026-09-16 as a flat CNY 4.5 / 13.5 / 0.45 list at 10% off.
    modelId: "deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro 0813",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.3, 9, 27),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Listed 2026-09-10; the dotted id is the seller's spelling of the model DeepSeek serves
    // directly as `deepseek-flash`. 1M context and native multimodality. Its list follows the
    // vendor's own schedule: the peak tier CNY 0.04 / 2 / 8, the direct row's figures, and half
    // that outside Beijing weekday 09:00-12:00 and 14:00-18:00. The row stores the peak tier
    // and declares DEEPSEEK_OFF_PEAK. The gateway also takes 20% off both tiers, billing
    // 0.032 / 1.6 / 6.4 at peak, which the row cannot declare beside its schedule (see the
    // block comment). Unlike the direct row this one needs no DeepSeek-specific pin — it is
    // reached through this group's generic openai-chat client, which forwards image_url parts.
    modelId: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Dots Studio's (rednote / Xiaohongshu) Dots3-Note Preview: an open-weight MoE, 280B total
    // and 16B active, the lightest of the Dots 3 family. TokenDance lists it as "Dots3-Note
    // Preview（Free）", and the name is kept as the seller spells it, tag and full-width
    // parentheses included, as the OpenRouter `(free)` rows keep theirs. The price is a
    // genuine CNY 0 on every bucket, the same treatment as the OpenRouter `:free` rows, so
    // costs compute to 0 and the free badge shows — over a 512,000-token context window, with
    // openai:chat-completions and anthropic:messages as its supported_protocols (this group's
    // openai-chat pin is a convention here, not the only shape the id serves). The gateway's
    // own listing describes it as covering multimodal understanding, which is what the
    // vision flag records; no image request was sent to it. Read 2026-09-15 from the
    // gateway's /models listing and tokendance.space/models/dots-3-note-preview, and unchanged
    // on 2026-10-10.
    modelId: "dots-3-note-preview",
    displayName: "Dots3-Note Preview（Free）",
    provider: "tokendance",
    contextWindow: 512000,
    pricing: cny(0, 0, 0),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Text only, 1,000,000 window. 20% off a CNY 8 input / 28 output / 2 cache hit list, the
    // same list as glm-5.3, so the gateway bills 6.4 / 22.4 / 1.6.
    modelId: "glm-5.2",
    displayName: "GLM-5.2",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(2, 8, 28),
    discount: 0.2,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(2, 8, 28),
    discount: 0.1,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Natively multimodal per TokenDance's catalog entry, and this group's generic
    // openai-chat client forwards image_url parts, so image input works on this path. Its
    // supported_protocols are openai:chat-completions and anthropic:messages.
    //
    // The 50% promotion this row used to carry ran through 2026-09-09 24:00 (the catalog
    // API's own description said so) and has been replaced by 10% off; the list price is
    // unchanged, only the `discount` fraction moved.
    modelId: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.23, 0.8, 2.8),
    discount: 0.1,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // A faster GLM-5.3 Flash (up to 200 tokens/s, per its listing), natively multimodal like
    // it: text, image and video input, which this group's openai-chat client forwards.
    // 1,000,000 window; CNY 2 input / 7 output / 0.57 cache hit, undiscounted.
    modelId: "glm-5.3-flashx",
    displayName: "GLM-5.3 FlashX",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.57, 2, 7),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // The same upstream model as the OpenRouter `tencent/hy4-preview` row above, reached
    // through a second seller: each row records what its own seller charges, so the two must
    // not be made to agree (the qwen3.8-flash pair below states the same rule). TokenDance
    // sells it at CNY 6 input / 18 output / 0.3 cache hit, undiscounted, over a 1,024,000
    // context window — both figures its own, neither copied from the OpenRouter listing.
    //
    // Text-only: the catalog entry advertises no image modality, matching the OpenRouter
    // listing's text-in/text-out. Its supported_protocols are openai:chat-completions and
    // openai:responses, so the openai-chat pin is this group's convention rather than the
    // only shape the id serves.
    modelId: "hy4-preview",
    displayName: "Hy4 preview",
    provider: "tokendance",
    contextWindow: 1024000,
    pricing: cny(0.3, 6, 18),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // CNY 20 input / 100 output / 2 cache hit, Moonshot's own list, undiscounted as of
    // 2026-10-10. The 40% promotion this row carried (seller's quote 2026-09-16, when the cache
    // hit listed at 1.6) has ended; the description still opens with the tag of an offer that
    // ran to 2026-09-30. Its supported_protocols is openai:chat-completions alone, so the
    // openai-chat pin is the only shape this id serves.
    modelId: "kimi-k3",
    displayName: "Kimi K3",
    provider: "tokendance",
    contextWindow: 1048576,
    pricing: cny(2, 20, 100),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // inclusionAI's Ling-3.0-flash: text only, with the 256,000-token window the listing gives
    // (the model's native length; its description says it extends to 1M). 65% off a CNY 0.4
    // input / 1.2 output / 0.08 cache hit list, so the gateway bills 0.14 / 0.42 / 0.028.
    modelId: "ling-3.0-flash",
    displayName: "Ling-3.0-flash",
    provider: "tokendance",
    contextWindow: 256000,
    pricing: cny(0.08, 0.4, 1.2),
    discount: 0.65,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Text only, 1,000,000 window, at the same CNY 0.4 input / 1.2 output / 0.08 cache hit list
    // as Ling-3.0-flash. Listed 2026-09-30 with a two-week free trial served at 256K, so the
    // portal bills it at 0 until about 2026-10-14. A free period is no `discount`, which is a
    // fraction below 1, and the trial ends before a release carries this row, so the row
    // records the list price and the full window the model is sold at afterwards.
    modelId: "ling-3.1-flash",
    displayName: "Ling-3.1-flash",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.08, 0.4, 1.2),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Xiaomi's MiMo-V2.6 line, the three rows alike: text, image, audio and video input (image
    // parts go through this group's openai-chat client), a 1,000,000 window, no promotion, and
    // openai:chat-completions, openai:responses and anthropic:messages as supported_protocols.
    // Flash at CNY 1 input / 2 output / 0.02 cache hit.
    modelId: "mimo-v2.6-flash",
    displayName: "MiMo-V2.6-Flash",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.02, 1, 2),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // Pro at CNY 3 input / 6 output / 0.025 cache hit.
    modelId: "mimo-v2.6-pro",
    displayName: "MiMo-V2.6-Pro",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.025, 3, 6),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // The Pro model served up to 20x faster, at ten times its price on every bucket: CNY 30
    // input / 60 output / 0.25 cache hit (OpenRouter lists the same rates in USD for
    // xiaomi/mimo-v2.6-pro-ultraspeed). The seller's id drops "pro"; its name keeps it.
    modelId: "mimo-v2.6-ultraspeed",
    displayName: "MiMo-V2.6-Pro-UltraSpeed",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.25, 30, 60),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // One model reached two ways, priced by whoever is selling it: this row carries the
    // gateway's own CNY 0.8 input / 2.7 output / 0.1 cache hit, and the qwen-pay-as-you-go row
    // carries Qwen's direct list price for the same id. The two figures agree since Qwen's
    // 2026-09-16 re-pricing (its page had read 1 / 3 / 0.1), but only because the two sellers
    // do: each row still follows its own seller.
    //
    // Its supported_protocols are openai:chat-completions, openai:responses and
    // anthropic:messages, so the openai-chat pin here is the group's convention rather than the
    // only shape the id serves. Natively multimodal per the catalog entry, and this group's
    // openai-chat client forwards image_url parts, so image input works on this path.
    //
    // Undiscounted, so its list price and its billed rate coincide — unlike the
    // qwen3.8-max row below, which is on 10% off.
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.1, 0.8, 2.7),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(1.5, 12, 36),
    discount: 0.1,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // The three Doubao Seed rows share this note. Priced 2026-09-02 from the seller's quoted
    // 50%-off rates, doubled back to the list price a row stores, and re-read 2026-10-10 from
    // the portal, whose prices still put all three at 50% off a list of CNY 6 / 30 / 1.2
    // (Pro, Evolving) and 3 / 15 / 0.6 (Turbo), input / output / cache hit — although the two
    // 2.1 rows' descriptions announce 20%. Context windows and protocols from the catalog API,
    // whose descriptions call the 2.1 models multimodal Coding/Agent models (this group's
    // openai-chat client forwards image_url parts, so image input works on this path).
    // seed-2.1-pro and seed-2.1-turbo also list openai:responses, so their openai-chat pin is
    // the group's convention rather than the only shape they serve; seed-evolving lists
    // chat-completions alone.
    //
    // Display names are the seller's own, as the catalog API spells them (re-read
    // 2026-10-10): Seed-2.1-Pro, Seed-2.1-Turbo, Seed-Evolving.
    modelId: "seed-2.1-pro",
    displayName: "Seed-2.1-Pro",
    provider: "tokendance",
    contextWindow: 256000,
    pricing: cny(1.2, 6, 30),
    discount: 0.5,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    modelId: "seed-2.1-turbo",
    displayName: "Seed-2.1-Turbo",
    provider: "tokendance",
    contextWindow: 256000,
    pricing: cny(0.6, 3, 15),
    discount: 0.5,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // A rolling id: the catalog API describes it as the newest Seed Coding/Agent model
    // under one stable id — the same model as seed-2.1-pro at the time of reading — and
    // the seller prices it the same.
    modelId: "seed-evolving",
    displayName: "Seed-Evolving",
    provider: "tokendance",
    contextWindow: 256000,
    pricing: cny(1.2, 6, 30),
    discount: 0.5,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  {
    // StepFun's Step 5 Preview: text, image and video input, a 1,000,000 window, and CNY 7
    // input / 20 output / 0.35 cache hit, undiscounted.
    modelId: "step-5-preview",
    displayName: "Step 5 Preview",
    provider: "tokendance",
    contextWindow: 1000000,
    pricing: cny(0.35, 7, 20),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: TOKENDANCE_BASE_URL,
  },
  // -- Penguin Go (mixed-protocol relay). The model ids are the generation rows
  // provisioned by Penguin Go's generic-client authorization contract. Both
  // protocols share the /api base: the google-genai client appends /v1beta itself, while
  // DeepSeek's Responses client appends /responses. The rows carry Penguin Go's current list
  // prices so a new Project is complete before its first authorization, and no `discount`:
  // the platform delivers any promotion it runs at authorization and Sync, and both stay
  // authoritative when the relay later publishes changed metadata. The DeepSeek rows follow
  // DeepSeek's own lineup (re-read 2026-09-16): V4.1 Flash as `deepseek-flash` and V4 Pro 0813
  // as `deepseek-v4-pro`; the two retired V4 Flash ids, served from V4.1 Flash, are not resold.
  // Gemini 3.7 Flash is no longer preset (2026-10-10): Google retires the id and reroutes it to
  // 3.8 Flash, the first row below.
  {
    modelId: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.075, 0.75, 3.75),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.075, 0.75, 3.75),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 9),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.03, 0.3, 2.5),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash-Lite",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.025, 0.25, 1.5),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro (Preview)",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1048576,
    pricing: usd(0.2, 2, 12),
    supportsVision: true,
    clientType: "google-genai",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "deepseek-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1000000,
    pricing: cny(0.04, 2, 8),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "deepseek-official",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro 0813",
    provider: PENGUIN_GO_PROVIDER_ID,
    contextWindow: 1000000,
    pricing: cny(0.3, 9, 27),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    clientType: "deepseek-official",
    baseUrl: PENGUIN_GO_BASE_URL,
  },
  // -- OpenCode Go (subscription gateway). The lineup, model ids, endpoints and per-token rates
  // are from opencode.ai/docs/go (read 2026-09-18), which lists these 27 models. Context
  // windows and input modalities are from the opencode-go provider on models.dev, the model
  // registry OpenCode maintains (hy3 records its input cap instead; see its row). The gateway's
  // /models listing also answers ten older ids the docs page does not list and models.dev
  // marks deprecated (minimax-m2.5, kimi-k2.5, glm-5, deepseek-flash, qwen3.5-plus,
  // mimo-v2-pro, mimo-v2-omni, hy3-preview, grok-4.5, omen-alpha); they are left out. So is
  // union-alpha, a limited-time free model the page listed on 2026-09-17 and dropped by
  // 2026-09-18.
  //
  // Protocol: the docs page's endpoint table puts each model on one path, and each row pins
  // the generic client for it: `openai-chat` for /chat/completions and `openai-responses` for
  // /responses, both on OPENCODE_GO_BASE_URL, and `ant-messages` for /v1/messages on
  // OPENCODE_GO_MESSAGES_BASE_URL. The paths are not interchangeable: /chat/completions refuses
  // grok-4.6 and fails for gpt-5.6-luna. The pins are load-bearing too: unpinned, gpt-5.6-luna,
  // glm-*, kimi-*, deepseek-* and minimax-* would reach their official clients, and the other
  // ids would not route at all. The gateway refuses a request that does
  // not name its conversation (400 "Request is missing x-opencode-session"), which
  // attributionHeaders does for this host on every request: a Session's requests carry its id,
  // and a request outside any Session — a connectivity test, a vision probe — a fresh one.
  //
  // Vision: from models.dev, and checked live on 2026-09-17 and 2026-09-18 by sending an image
  // of a number. Every vision row that could be reached read it back, and the text-only rows
  // refused the image or answered without seeing it. The rows below that could not be reached
  // keep models.dev's flag.
  //
  // Pricing: Go is a monthly subscription whose usage limits are dollar amounts. Each model has
  // a monthly allowance, capped at 20% per 5 hours and 50% per week. A request draws the
  // per-token rates the docs page publishes, and those are what the rows store. So the cost
  // center shows allowance spent, not an invoice, as with the Qwen Token Plan rows, which store
  // per-token list prices rather than the plan's fee. Where the page lists no cached-write rate,
  // cache_write carries the input rate. Four rows are tiered and store their base tier: GPT-5.6
  // Luna above 272K input tokens, Grok 4.6 above 200K, Qwen 3.7 Plus and Qwen 3.6 Plus above
  // 256K. The four DeepSeek rows publish a peak and an off-peak rate on DeepSeek's own windows
  // (peak 01:00-04:00 and 06:00-10:00 UTC on weekdays, i.e. DEEPSEEK_OFF_PEAK), off-peak
  // exactly half, so they store the peak rate and declare that schedule. DeepSeek V4.1 Flash's
  // running "4x" offer (ends 2026-09-20) raises its monthly allowance, not its rates, so no
  // row carries a `discount`.
  //
  // Account opt-in and region: five models answer 403 until the key's OpenCode workspace opts
  // in. The two Muse Spark Contributor models require consent to Meta training on prompts and
  // completions. deepseek-v4.1-flash, deepseek-v4-flash and deepseek-v4-pro require consent to
  // China-hosted serving. Some upstreams also refuse a caller's region: from a mainland China
  // address, gpt-5.6-luna answers 403 unsupported_country_region_territory and both Muse Spark
  // rows 403 "not available in your country", while gpt-5.6-luna passed every check from
  // outside it. The rows that could not be reached follow the docs page and the protocol the
  // other rows on their path proved. --
  {
    modelId: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.006, 0.3, 1.2),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.006, 0.3, 1.2),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.006, 0.3, 1.2),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.044, 1.32, 3.96),
    offPeakDiscount: DEEPSEEK_OFF_PEAK,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.03, 0.15, 0.5),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "glm-5.2",
    displayName: "GLM-5.2",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "glm-5.1",
    displayName: "GLM-5.1",
    provider: "opencode-go",
    contextWindow: 202752,
    pricing: usd(0.26, 1.4, 4.4),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    provider: "opencode-go",
    contextWindow: 1050000,
    pricing: usd(0.02, 0.25, 1.2),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "grok-4.6",
    displayName: "Grok 4.6",
    provider: "opencode-go",
    contextWindow: 500000,
    pricing: usd(0.5, 2, 6),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "hy4-preview",
    displayName: "Hy4 preview",
    provider: "opencode-go",
    contextWindow: 1024000,
    pricing: usd(0.042, 0.834, 2.501),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    // models.dev lists a 256,000-token context for Hy3 but caps its input at 192,000. Compaction
    // derives from this field, so it records the input cap: at 256,000 a Session would keep
    // sending prompts the upstream refuses until it compacted at ~254K.
    modelId: "hy3",
    displayName: "Hy3",
    provider: "opencode-go",
    contextWindow: 192000,
    pricing: usd(0.035, 0.14, 0.58),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "kimi-k3",
    displayName: "Kimi K3",
    provider: "opencode-go",
    contextWindow: 1048576,
    pricing: usd(0.3, 3, 15),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    provider: "opencode-go",
    contextWindow: 262144,
    pricing: usd(0.19, 0.95, 4),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "kimi-k2.6",
    displayName: "Kimi K2.6",
    provider: "opencode-go",
    contextWindow: 262144,
    pricing: usd(0.16, 0.95, 4),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "longcat-2.0",
    displayName: "LongCat 2.0",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.006, 0.3, 1.2),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "mimo-v2.5",
    displayName: "MiMo-V2.5",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.0028, 0.14, 0.28),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "mimo-v2.5-pro",
    displayName: "MiMo-V2.5-Pro",
    provider: "opencode-go",
    contextWindow: 1048576,
    pricing: usd(0.003625, 0.435, 0.87),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "minimax-m3",
    displayName: "MiniMax M3",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "minimax-m2.7",
    displayName: "MiniMax M2.7",
    provider: "opencode-go",
    contextWindow: 204800,
    pricing: usd(0.06, 0.375, 1.2),
    supportsVision: false,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "muse-spark-1.3-contributor",
    displayName: "Muse Spark 1.3 Contributor",
    provider: "opencode-go",
    contextWindow: 1048576,
    pricing: usd(0.002, 0.1, 0.2),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "muse-spark-1.2-contributor",
    displayName: "Muse Spark 1.2 Contributor",
    provider: "opencode-go",
    contextWindow: 1048576,
    pricing: usd(0.002, 0.1, 0.2),
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: OPENCODE_GO_BASE_URL,
  },
  {
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.016, 0.2, 0.47),
    supportsVision: true,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.25, 2.5, 6),
    supportsVision: true,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "qwen3.7-max",
    displayName: "Qwen 3.7 Max",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.5, 3.125, 7.5),
    supportsVision: false,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.04, 0.5, 1.6),
    supportsVision: true,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  {
    modelId: "qwen3.6-plus",
    displayName: "Qwen 3.6 Plus",
    provider: "opencode-go",
    contextWindow: 1000000,
    pricing: usd(0.05, 0.625, 3),
    supportsVision: true,
    clientType: "ant-messages",
    baseUrl: OPENCODE_GO_MESSAGES_BASE_URL,
  },
  // -- Qwen Token Plan (subscription gateway; vision flags per the plan's supported-model
  // table, and for the rows added 2026-09-16 per their model pages' input modalities).
  // Pricing and context windows from each model's page at www.qianwenai.com/models/<id>
  // (official CNY list prices; limited-time promotions such as the 20%/50% off discounts are
  // not stored). Lineup updated 2026-09-16: deepseek-v4.1-flash, deepseek-v4-pro-0813,
  // glm-5.3 and qwen3.8-flash join; deepseek-v4-flash-0731, deepseek-v4-pro and glm-5.2
  // leave the plan.
  //
  // The two DeepSeek rows are priced by time of day: their pages list a peak and an off-peak
  // price, the off-peak one exactly half on every bucket and in force from 22:00 to 08:00
  // Beijing time every day. They store the PEAK price and declare QWEN_OFF_PEAK, the same
  // shape the DeepSeek rows take with DeepSeek's own schedule. --
  {
    // Peak CNY 2 input / 8 output / 0.2 cache hit; off-peak 1 / 4 / 0.1. Text and image input.
    modelId: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.2, 2, 8),
    offPeakDiscount: QWEN_OFF_PEAK,
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    // Peak CNY 9 input / 27 output / 0.9 cache hit; off-peak 4.5 / 13.5 / 0.45. Text only.
    modelId: "deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro 0813",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.9, 9, 27),
    offPeakDiscount: QWEN_OFF_PEAK,
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    provider: "qwen-token-plan",
    contextWindow: 1048576,
    pricing: cny(2, 8, 28),
    supportsVision: false,
    clientType: "openai-chat",
    baseUrl: QWEN_TOKEN_PLAN_BASE_URL,
  },
  {
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    provider: "qwen-token-plan",
    contextWindow: 1000000,
    pricing: cny(0.1, 0.8, 2.7),
    supportsVision: true,
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
  // and ZHIPU/ carry vendor prefixes, DeepSeek is listed bare). Lineup updated 2026-09-16:
  // deepseek-v4.1-flash, kimi/kimi-k2.8-preview and ZHIPU/GLM-5.3-Flash join;
  // deepseek-v4-flash-0731 and ZHIPU/GLM-5.2 leave. The DeepSeek row is priced by time of day
  // on QWEN_OFF_PEAK and stores its peak price, as in the Token Plan group above. --
  {
    // Peak CNY 2 input / 8 output / 0.2 cache hit; off-peak (22:00-08:00 Beijing) 1 / 4 / 0.1.
    // Text and image input, which this group's openai-chat client forwards.
    modelId: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.2, 2, 8),
    offPeakDiscount: QWEN_OFF_PEAK,
    supportsVision: true,
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
    // CNY 6.5 input / 27 output / 1.7 cache hit over a 1M window (1,048,576, as on the
    // kimi/kimi-k3 row); text, image and video input.
    modelId: "kimi/kimi-k2.8-preview",
    displayName: "Kimi K2.8 Preview",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1048576,
    pricing: cny(1.7, 6.5, 27),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  {
    // Official CNY list price from www.qianwenai.com/models/qwen3.8-flash, re-read 2026-09-16:
    // CNY 0.8 input / CNY 0.1 cache hit / CNY 2.7 output per MTok (it had been 1 / 0.1 / 3),
    // over a 1M-token input window with a 131K output cap. Its input modalities include
    // images and video, and this group's openai-chat client converts image parts.
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.1, 0.8, 2.7),
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
    // CNY 0.8 input / 2.8 output / 0.23 cache hit over a 1M window with a 131K output cap;
    // natively multimodal like every other GLM-5.3 Flash row, and this group's openai-chat
    // client forwards image parts.
    modelId: "ZHIPU/GLM-5.3-Flash",
    displayName: "GLM-5.3 Flash",
    provider: "qwen-pay-as-you-go",
    contextWindow: 1000000,
    pricing: cny(0.23, 0.8, 2.8),
    supportsVision: true,
    clientType: "openai-chat",
    baseUrl: QWEN_PAYG_BASE_URL,
  },
  // -- ModelScope (api-inference aggregate, preset base URL). Preset ids keep ModelScope's
  // own `org/Model-Name` spelling; DeepSeek was read from the endpoint's public /v1/models
  // listing (2026-09-18), and the Qwen additions from their public model pages (2026-09-20).
  //
  // ModelScope serves all three presets through its OpenAI Responses endpoint, so every row pins
  // MMSP's generic Responses client. Keeping the protocol explicit also prevents ids from
  // auto-routing to vendor-specific clients with a different request shape.
  //
  // The window and vision flags are NOT read from ModelScope's own docs — its model pages are
  // client-rendered and carry no price. They repeat what other rows of the same models record,
  // because ModelScope serves the same upstream ids.
  //
  // `pricing` is deliberately absent. ModelScope bills for api-inference and does not publish a
  // read-able rate, so an absent pricing — which the catalog reads as "nobody has looked this
  // up", leaving the row unbadged and the group's usage uncosted — is the honest state. A
  // three-zero pricing would be worse than absent here, not better: `isFreeModel` would badge a
  // billed gateway as "Free". Whoever next reads ModelScope's pricing page should fill it in. --
  {
    modelId: "deepseek-ai/DeepSeek-V4.1-Flash",
    displayName: "DeepSeek V4.1 Flash",
    provider: MODELSCOPE_PROVIDER_ID,
    contextWindow: 1000000,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: MODELSCOPE_BASE_URL,
  },
  {
    modelId: "Qwen/Qwen3.8-27B",
    displayName: "Qwen 3.8 27B",
    provider: MODELSCOPE_PROVIDER_ID,
    contextWindow: 262144,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: MODELSCOPE_BASE_URL,
  },
  {
    modelId: "Qwen/Qwen3.8-Flash-Next",
    displayName: "Qwen 3.8 Flash Next",
    provider: MODELSCOPE_PROVIDER_ID,
    contextWindow: 262144,
    supportsVision: true,
    clientType: "openai-responses",
    baseUrl: MODELSCOPE_BASE_URL,
  },
  // -- MiniMax (official USD pay-as-you-go list prices, standard tier at <=512K input — every
  // rate doubles above 512K, and the priority tier is 1.5x). --
  {
    modelId: "MiniMax-M3",
    displayName: "MiniMax M3",
    provider: "minimax",
    contextWindow: 1000000,
    pricing: usd(0.06, 0.3, 1.2),
    supportsVision: true,
  },
  // -- Google Gemini (official USD pricing). Gemini 3.7 Flash left the group on 2026-10-10:
  // Google retires the id and reroutes it to 3.8 Flash, at the same price. --
  {
    // Same list price and same launch discount as the gemini-3.6-flash row below: Google
    // halves all three rates through 2026-12-31. Like that row this one declares the
    // promotion in `discount`, so the list price stays on file — here and in a Project, which
    // is seeded with the fraction beside it — while the cost center bills the 0.075/0.75/3.75
    // Google actually charges today. One field to delete when the promotion lapses.
    modelId: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    discount: 0.5,
    supportsVision: true,
  },
  {
    // Same list price and same launch discount as the 3.8 row: Google halves all three rates
    // through 2026-12-31 (Google's pricing page, read 2026-09-09).
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    provider: "google",
    contextWindow: 1048576,
    pricing: usd(0.15, 1.5, 7.5),
    discount: 0.5,
    supportsVision: true,
  },
  {
    // Google's 3.5 tier list price ($1.50 / $9.00 / $0.15 cache hit), which carries no launch
    // discount — re-read 2026-09-09. The $9 output is what the tier costs, not a promotion.
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
  // -- Anthropic (official USD pricing; cache write = 1.25 x input, the 5-minute write).
  // Re-read 2026-08-20 from platform.claude.com/docs/en/about-claude/pricing; the 5.5 / 5.1
  // generation added 2026-10-10 from MMSP 0.5.2's registry and the copy of that page it
  // carries (llmsdk_docs/claude5_5/docs/pricing.md). Sonnet 5's $2 input / $10 output is its
  // standard rate rather than an introductory one, so it prices below Sonnet 4.6 — that
  // inversion is Anthropic's list, not a transcription slip. The cache-hit multiplier is no
  // longer one figure: 0.025x input on Fable 5.1, 0.05x on Opus 5.5 and Sonnet 5.5, 0.1x on
  // every other row. Anthropic bills the full 1M window at a single rate on every row but
  // Haiku 5.5, which the file header's tier list names; and the fast-mode premium on Opus 5.5
  // ($8 input / $40 output) and Opus 5 / Opus 4.8 ($10 / $50) is a separate tier these rows do
  // not record. Every row takes image input over a 1,000,000-token window. --
  {
    // $10 input / $12.50 cache write / $0.25 cache hit / $50 output.
    modelId: "claude-fable-5-1",
    displayName: "Claude Fable 5.1",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.25, 12.5, 50),
    supportsVision: true,
  },
  {
    modelId: "claude-fable-5",
    displayName: "Claude Fable 5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
  },
  {
    // $0.10 input / $0.125 cache write / $0.01 cache hit / $0.50 output for a prompt of up to
    // 100,000 tokens, counting cache reads and writes; a longer prompt pays 5x on every rate,
    // for the whole request. The base tier is recorded. MMSP 0.5.2 is the first release whose
    // official Anthropic client knows the model: it runs `none` thinking at low effort, refuses
    // a forced tool choice, which Haiku 5.5 answers without thinking, and refuses fast mode,
    // which Haiku 5.5 rejects (fastModeProtocol offers no toggle for it either).
    modelId: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.01, 0.125, 0.5),
    supportsVision: true,
  },
  {
    // $4 input / $5 cache write / $0.20 cache hit / $20 output.
    modelId: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.2, 5, 20),
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
    // $2 input / $2.50 cache write / $0.10 cache hit / $10 output. MMSP 0.5.0 listed the cache
    // hit at $0.20, Sonnet 5's figure; 0.5.2 lowered it to the 0.05x of input that Anthropic's
    // pricing page states for this model.
    modelId: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    provider: "anthropic",
    contextWindow: 1000000,
    pricing: usd(0.1, 2.5, 10),
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
    // OpenAI's list price per MMSP 0.5.2's registry and the model page it carries
    // (llmsdk_docs/gpt6/docs/gpt-6.1-sol.md, read 2026-10-10): $2 input / $0.10 cached input
    // (5% of input) / $2.50 cache write / $10 output, over a 1,050,000-token window with text
    // and image input. As on gpt-6-astra below, cache_write carries the published cache-write
    // price; a prompt above 272K tokens pays 2x input and cache and 1.5x output for the whole
    // request, a tier this row does not record.
    modelId: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(0.1, 2.5, 10),
    supportsVision: true,
  },
  {
    // OpenAI's list price (developers.openai.com/api/docs/models/gpt-6-astra, read
    // 2026-09-09) is $10 input / $1 cached input / $12.5 cache write / $50 output. Per the
    // bucket convention at the top of this file, cache_write carries the published
    // cache-write price of 12.5; the $10 rate applies only to input that is not written to
    // cache, a split the three buckets do not express. Every rate doubles above 272K input
    // tokens (output 1.5x) — the base tier is what this row records, as the header says.
    modelId: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    provider: "openai",
    contextWindow: 1050000,
    pricing: usd(1, 12.5, 50),
    supportsVision: true,
  },
  {
    // The bare gpt-5.6 id routes to gpt-5.6-sol upstream and is priced as that tier, so the
    // row names the Sol codename its siblings and the openai/gpt-5.6-sol row already show —
    // the id stays bare, only the label says which variant this is. This row and the two
    // gpt-5.6 rows below mirror the
    // openai/gpt-5.6-* OpenRouter rows above, which carry the gateway's (currently
    // discounted) rates instead of this list price.
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
    // Announced 2026-08-14. Z.AI's price
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
    // cached input / $0.50 output; a 50% promotion halved all three through 24:00 on
    // 2026-09-09 (UTC+8). Direct-vendor rows record the vendor's list price, so that is what
    // is stored here — the OpenRouter z-ai/glm-5.3-flash row above carries the rate its
    // default endpoint bills, which runs a promotion of its own.
    //
    // The model is natively multimodal (docs.z.ai/guides/vlm/glm-5.3-flash: images, video
    // and files), and it is the one GLM id whose images MMSP's Z.AI client forwards — as
    // image_url parts, in a prompt and in a tool result alike. Every other GLM id refuses
    // one outright ("GLM <id> does not support image inputs."), which is why the rest of
    // this group is vision-off.
    modelId: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    provider: "zhipu",
    contextWindow: 1000000,
    pricing: usd(0.03, 0.15, 0.5),
    supportsVision: true,
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
  // -- vLLM (self-hosted: the models MMSP's openai-chat-vllm-adapter client carries a
  // per-model thinking switch for, as published at recipes.vllm.ai — read 2026-09-03).
  //
  // Every row prices at zero, and omits two other things, all because the user runs the server:
  // - **zero pricing**. There is no seller charging per token: what the deployment costs is
  //   the operator's own hardware, which no catalog rate could express. Three zero buckets are
  //   the same genuine $0 tier the `:free` gateway rows carry, so these models show the free
  //   badge and contribute 0 to the cost center rather than the "unpriced" mark — which is the
  //   truthful reading of a self-hosted endpoint that bills nobody.
  // - **no base URL**. Every deployment has its own; the user supplies it, as in `custom`.
  // - **no auto-routing**. Each row pins openai-chat-vllm-adapter explicitly, and the pin is
  //   load-bearing twice over: `Qwen/*` begins with no family AutoLLMClient knows and would
  //   be rejected outright, while `deepseek-ai/DeepSeek-V4-*` begins with "deepseek-" and
  //   would reach DeepSeek's official Responses client — pointed at a vLLM server.
  //
  // contextWindow is the recipe's NATIVE length, which is the most a deployment can serve
  // without reconfiguration; an operator may serve less (`--max-model-len` below the native
  // limit) or, for the Qwen rows, far more with YaRN rope scaling. The catalog cannot know
  // which, and it derives the compaction thresholds from this number, so the honest default
  // is the checkpoint's own figure — an entry without one would be assumed to be 128000.
  // The DeepSeek rows additionally document `--max-model-len >= 393216` as the floor for
  // their top reasoning levels, which is well inside the window recorded here.
  {
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    displayName: "DeepSeek V4 Flash",
    provider: "vllm",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    // The experimental vision revision: DeepSeek's first multimodal V4, a ViT tower on the
    // same language backbone. Its recipe verifies a 32K deployment and notes the 1M the
    // checkpoint advertises was not what was measured; the window below is the checkpoint's,
    // matching every other DeepSeek V4 row in this catalog.
    modelId: "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    provider: "vllm",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "deepseek-ai/DeepSeek-V4-Pro",
    displayName: "DeepSeek V4 Pro",
    provider: "vllm",
    contextWindow: 1000000,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "Qwen/Qwen3.5-0.8B",
    displayName: "Qwen 3.5 0.8B",
    provider: "vllm",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "Qwen/Qwen3.5-9B",
    displayName: "Qwen 3.5 9B",
    provider: "vllm",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "Qwen/Qwen3.6-35B-A3B",
    displayName: "Qwen 3.6 35B A3B",
    provider: "vllm",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "Qwen/Qwen3.8-27B",
    displayName: "Qwen 3.8 27B",
    provider: "vllm",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  {
    modelId: "Qwen/Qwen3.8-Flash-Next",
    displayName: "Qwen 3.8 Flash Next",
    provider: "vllm",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: true,
    clientType: VLLM_CLIENT_TYPE,
  },
  // -- Custom (the group that otherwise holds only user-defined models). A preset may live
  // here only as a complete row — its own base URL and a pinned generic protocol — because the
  // group implies neither; it is where a vendor with a single preview model and no console
  // of its own goes rather than opening a group for it. Atria Dawn Preview: the Anthropic
  // Messages API at api.atria-asi.ai (the client appends /v1/messages, so the base URL carries
  // no /v1; the endpoint also serves Chat Completions and Responses, but its Responses side
  // rejects the replayed assistant turn of a multi-turn conversation), a 256K window (262144 —
  // the API caps max_output_tokens at that minus the input), text only (the endpoint rejects
  // image input), and no published price yet, so the row records $0 until the vendor prices
  // it. Read 2026-09-15 from api.atria-asi.ai/docs.
  {
    modelId: "Atria-Dawn-Preview",
    displayName: "Atria Dawn Preview",
    provider: "custom",
    contextWindow: 262144,
    pricing: usd(0, 0, 0),
    supportsVision: false,
    clientType: "ant-messages",
    baseUrl: "https://api.atria-asi.ai",
  },
];

/**
 * Canonical spelling of an MMSP client-type string. The generic Chat Completions client was
 * renamed from `openai` to `openai-chat` (AgentHub 0.4.2); the bare `openai` spelling still
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

/**
 * The protocol a group pins on every one of its entries (ModelProviderInfo.clientType), or
 * undefined when the group pins none — an unknown id (a user-defined group) included.
 *
 * Four groups pin: vLLM, whose models are served by the user's own vLLM adapter,
 * OpenRouter, whose models all speak the Responses API OpenRouter serves at its preset base
 * URL, and TokenDance and SiliconFlow, whose models all speak Chat Completions.
 *
 * A reference value, read when a file is written from the catalog (catalogGroupConnection:
 * a new Project, "Add new models" for a group new to the file, "Restore defaults") and by
 * nothing that builds or judges a request: at runtime a group's protocol is its
 * `[providers.<id>]` table's.
 */
export function providerClientType(providerId: string): string | undefined {
  return providerInfo(providerId)?.clientType;
}

/**
 * A first-party vendor group: one this catalog knows, that is not `custom`, carries no
 * gateway endpoint and pins no protocol of its own — DeepSeek, Google, OpenAI, Anthropic,
 * Z.AI, Moonshot, MiniMax, and the Penguin Go relay.
 *
 * What distinguishes it is that nothing in it decides a protocol: its entries persist no
 * `client_type`, so MMSP places every one of them by the spelling of the upstream model
 * id alone — the vendor family it begins with. An id of no known family cannot be started at
 * all, whatever else is configured on the entry (the Penguin Go rows pin their protocol
 * instead: the relay serves Gemini through generateContent, not the API a `gemini-` id routes
 * to). Every
 * surface that has to answer "is this one routable?" reads the group's shape through this one
 * predicate rather than re-deriving it: the models page's cards and its config dialog, the
 * models PUT, and the CLI's `config model add`. Whether a model may be added to the group at
 * all is a separate, wider rule: isAddableGroup.
 *
 * Every other group answers the protocol question by itself and therefore routes any id the
 * endpoint serves: `custom` and user-defined groups detect or pick it, and a gateway's or
 * vLLM's rows speak the protocol their group's `[providers.<id>]` table or the row itself
 * stores (a new Project writes it there).
 */
export function isVendorGroup(providerId: string): boolean {
  const info = providerInfo(providerId);
  return (
    info !== undefined &&
    info.id !== "custom" &&
    info.gatewayBaseUrl === undefined &&
    info.clientType === undefined
  );
}

/**
 * Whether this entry would be written into a vendor group with an id MMSP cannot place —
 * the configuration that produces `No client for model "<id>": its family is not known` on
 * the first request, and nothing before it.
 *
 * `routedClientType` is the authority: it mirrors AutoLLMClient's routing rule and returns
 * undefined on exactly the entries that client rejects. A blank id is not a routing failure —
 * the entry is still being typed, and the required-field validation is what has something
 * to say about it.
 */
export function unroutableVendorModel(
  provider: string,
  modelId: string,
  clientType?: string,
): boolean {
  const id = modelId.trim();
  return id !== "" && isVendorGroup(provider) && routedClientType(id, clientType) === undefined;
}

/**
 * Whether models may be added to this group by hand: `custom`, vLLM, OpenRouter, TokenDance,
 * SiliconFlow (ModelProviderInfo.addable) and every user-defined group, i.e. an id this
 * catalog does not know. Every other built-in group — the first-party vendors and the other
 * gateways — carries its catalog presets and the rows it already stores: the models page
 * offers no add-model entry point there, and the models PUT and the CLI's `config model add`
 * refuse a new row that is not a preset (unaddableModel).
 */
export function isAddableGroup(providerId: string): boolean {
  const info = providerInfo(providerId);
  return info === undefined || info.addable === true;
}

/**
 * Whether writing this pair as a NEW row of its group would add a model by hand where the group
 * takes none: a group isAddableGroup refuses, and a `(provider, model_id)` pair that is not one
 * of the catalog's rows for it. A preset passes, so "Sync presets" can put a deleted one back;
 * a row the table already stores is not a new one, and the callers never ask about it.
 */
export function unaddableModel(provider: string, modelId: string): boolean {
  return !isAddableGroup(provider) && catalogEntryFor(provider, modelId.trim()) === undefined;
}

/** Env var fallback for a single model (the var names MMSP's client actually reads when api_key / base_url is blank). */
export interface ModelEnvInfo {
  envKey: string;
  envBaseUrlKey: string;
}

/**
 * MMSP's routing rule, mirrored: without a client type, the family a model id begins with
 * names its official client (AutoLLMClient's `MODEL_FAMILIES` as of MMSP 0.5.2, which the
 * package does not export), and an id of no known family cannot be started at all.
 */
const MODEL_FAMILIES: readonly (readonly [prefix: string, clientType: string])[] = [
  ["gpt-", "openai-official"],
  ["text-embedding-", "openai-official"],
  ["claude-", "anthropic-official"],
  ["gemini-", "google-official"],
  ["glm-", "zai-official"],
  ["kimi-", "moonshot-official"],
  ["deepseek-", "deepseek-official"],
  ["minimax-", "minimax-official"],
];

/**
 * The wire protocol that carries MMSP's `fast_mode` on a client: `"openai"` for the clients
 * that send `service_tier: "priority"` (the OpenAI protocols, and Google's Interactions API
 * and MiniMax alike), `"anthropic"` for those that send `speed: "fast"` plus the
 * `fast-mode-2026-02-01` beta header. The two differ in what the user must be warned about,
 * not just in wire shape (see fastModeProtocol).
 */
export type FastModeProtocol = "openai" | "anthropic";

/**
 * What the harness mirrors about each MMSP client, in one place: the environment variable
 * prefix it reads its key and base URL from when handed none (an official client its vendor's,
 * a compatible client the vendor's whose wire protocol it speaks), the path it appends to its
 * base URL, the protocol that carries `fast_mode` (absent = the client rejects it, or the
 * harness cannot tell what it does with it), and `openServer` for a client that calls a base
 * URL handed no key with no key at all where every other client refuses it (see
 * keylessEndpoint). A client type this table does not name is one MMSP does not have either.
 */
export const MMSP_CLIENTS: Readonly<
  Record<string, { env: string; path: string; fastMode?: FastModeProtocol; openServer?: true }>
> = {
  "openai-official": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "anthropic-official": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  // compat: MMSP 0.5.2 keeps google-official's earlier name as an alias, and a Project written
  // before it may still pin it, never rewritten; this row goes with the MMSP upgrade that drops
  // the alias (changelog/unreleased/2026-10-10-backward-compatibility.md).
  "gemini-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  "zai-official": { env: "ZAI", path: "/chat/completions" },
  "moonshot-official": { env: "MOONSHOT", path: "/chat/completions" },
  "deepseek-official": { env: "DEEPSEEK", path: "/responses" },
  "minimax-official": { env: "MINIMAX", path: "/responses", fastMode: "openai" },
  "openai-responses": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "openai-chat": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-chat-vllm-adapter": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-embedding": { env: "OPENAI", path: "/embeddings" },
  "ant-messages": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-genai": { env: "GEMINI", path: "/v1beta/models" },
  // MMSP 0.5.1 keeps the 0.5.0 name of google-genai as an alias.
  "gemini-generate-content": { env: "GEMINI", path: "/v1beta/models" },
  // An MMSP server: the client posts to {base}/stream. It forwards `fast_mode` to the server,
  // whose upstream client decides, so the harness offers no toggle it cannot vouch for.
  mmsp: { env: "MMSP", path: "/stream", openServer: true },
};

/**
 * The MMSP client that serves an entry, exactly as AutoLLMClient picks it: the pinned client
 * type (lowercased; the bare `openai` alias canonicalized), else the official client of the
 * family the model id begins with — where `openai-official` hands a `text-embedding-` id to
 * the Embeddings client. `undefined` when MMSP refuses the entry: an id of no known family,
 * or a pin MMSP does not have.
 */
export function routedClientType(modelId: string, clientType?: string): string | undefined {
  const id = modelId.toLowerCase();
  const routed =
    canonicalClientType(clientType)?.trim().toLowerCase() ||
    MODEL_FAMILIES.find(([prefix]) => id.startsWith(prefix))?.[1];
  if (routed === "openai-official" && id.startsWith("text-embedding-")) return "openai-embedding";
  return routed !== undefined && Object.hasOwn(MMSP_CLIENTS, routed) ? routed : undefined;
}

/**
 * Resolves the env var fallback for a model: the pair the client MMSP routes it to reads
 * (see routedClientType). Returns undefined when nothing routes — an id of no known family
 * with no client type, or a client type MMSP does not have — which is exactly when MMSP
 * rejects the entry: it needs an explicit client_type, or should be added under custom / a
 * self-built group via the OpenAI protocol.
 */
export function resolveModelEnv(modelId: string, clientType?: string): ModelEnvInfo | undefined {
  const client = MMSP_CLIENTS[routedClientType(modelId, clientType) ?? ""];
  if (client === undefined) return undefined;
  return { envKey: `${client.env}_API_KEY`, envBaseUrlKey: `${client.env}_BASE_URL` };
}

/**
 * Resolves the credential environment for a configured model entry. Most groups follow the
 * MMSP client selected by model id / protocol. Aggregate groups are deliberately different:
 * Penguin Go's Google and DeepSeek routes share one relay credential, and ModelScope's rows
 * share one api-inference token, so the provider-scoped variable must win over the selected
 * protocol everywhere the harness resolves a key. Whether a keyless row may use
 * that variable is modelEnvFallback's decision: ModelScope's is OPENAI_*, a vendor variable, so
 * its rows get no fallback.
 */
export function resolveProviderModelEnv(
  provider: string,
  modelId: string,
  clientType?: string,
): ModelEnvInfo | undefined {
  if (provider === PENGUIN_GO_PROVIDER_ID || provider === MODELSCOPE_PROVIDER_ID) {
    const group = providerInfo(provider);
    return group === undefined
      ? undefined
      : { envKey: group.envKey, envBaseUrlKey: group.envBaseUrlKey };
  }
  return resolveModelEnv(modelId, clientType);
}

/**
 * The endpoints MMSP's official clients talk to when handed no base URL, per credential
 * variable: the OpenAI and Anthropic SDK defaults, Google's Generative Language host, the
 * defaults the DeepSeek, Z.AI, Moonshot and MiniMax clients carry, plus the second official
 * host where a vendor runs two (Z.AI's mainland bigmodel.cn, Moonshot's international .ai,
 * MiniMax's mainland minimaxi.com). A key taken from the environment is sent only to one of
 * these — see modelEnvFallback.
 */
export const VENDOR_ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  OPENAI_API_KEY: ["https://api.openai.com/v1"],
  ANTHROPIC_API_KEY: ["https://api.anthropic.com"],
  GEMINI_API_KEY: ["https://generativelanguage.googleapis.com"],
  DEEPSEEK_API_KEY: [DEEPSEEK_BASE_URL],
  ZAI_API_KEY: ["https://api.z.ai/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4"],
  MOONSHOT_API_KEY: ["https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1"],
  MINIMAX_API_KEY: [MINIMAX_BASE_URL, "https://api.minimaxi.com/v1"],
  // The mmsp client sends MMSP_API_KEY only to MMSP_BASE_URL (or its default), i.e. only when
  // handed no base URL: no base URL a row names is lent it.
  MMSP_API_KEY: [],
};

/**
 * Endpoint equality for the credential rule: scheme and host compared case-insensitively
 * (with the port), the path without trailing slashes; a value that does not parse as a URL
 * matches nothing.
 */
export function sameEndpoint(a: string, b: string): boolean {
  const norm = (value: string): string | undefined => {
    try {
      const u = new URL(value.trim());
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return undefined;
    }
  };
  const na = norm(a);
  return na !== undefined && na === norm(b);
}

/** Client-type equality as routing sees it: canonical spelling (canonicalClientType), case and surrounding space ignored. */
export function sameClientType(a: string, b: string): boolean {
  const norm = (value: string): string => canonicalClientType(value.trim())!.toLowerCase();
  return norm(a) === norm(b);
}

/** What the credential rule reads off a model entry: the paired reference, the pinned protocol and the endpoint. */
export interface ModelCredentialShape {
  provider: string;
  modelId: string;
  /** Pinned MMSP client type; blank or absent = auto-routed by model id. */
  clientType?: string | undefined;
  /** Inline base URL; blank or absent = the routed client's default endpoint (or its `*_BASE_URL` variable). */
  baseUrl?: string | undefined;
}

/** The environment pair a keyless entry may fall back to, and who reads it. */
export interface ModelEnvFallback extends ModelEnvInfo {
  /**
   * `true`: MMSP's routed client reads this pair itself, so an entry with no base URL is
   * handed no key and the client's own environment lookup — and its own error when the
   * variable is unset — apply unchanged. `false`: a provider-scoped pair no MMSP client knows
   * (the Penguin Go relay's); the harness reads it and passes the value explicitly, refusing
   * when it is unset.
   */
  readByClient: boolean;
}

/**
 * The environment fallback a keyless model entry is allowed, or `undefined` when it gets
 * none and must carry its own key.
 *
 * MMSP's clients read a vendor variable (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) whenever
 * they are handed no key — so a keyless row in a gateway group would send the user's own
 * OpenAI or Anthropic key to the gateway. The rule here is about the **destination**, not the
 * group's label: environment keys are for official endpoints only.
 *
 * - No base URL on the entry: the routed client talks to its own default endpoint, or to the
 *   `*_BASE_URL` the user set beside the key — that pairing is MMSP's own and is left to it
 *   entirely; the client reads the pair itself.
 * - A base URL that is one of that vendor's own official endpoints (VENDOR_ENDPOINTS) —
 *   allowed, the harness reading the variable and passing it explicitly. The mmsp client has
 *   none: MMSP_API_KEY goes only where MMSP_BASE_URL points, to an entry with no base URL.
 * - Anything else — every gateway group's preset endpoint, custom / user-defined / vLLM rows
 *   with their own endpoints, a vendor row re-pointed at a proxy — refused. A row's own base
 *   URL equal to the `*_BASE_URL` variable's value earns no exception either (per the user:
 *   environment keys are for official endpoints only): put the key on the row.
 * - A group with a provider-scoped pair (Penguin Go, whose key no MMSP client reads) is
 *   allowed that pair for every one of its rows, regardless of base URL; the harness reads it.
 *   A group pair that is itself a vendor variable (ModelScope records OPENAI_*) is not
 *   provider-scoped: its rows follow the destination rule like any other gateway's.
 *
 * Pure, so the server and the models page answer the same question for the preview, the
 * dialog hint and the refusal.
 */
export function modelEnvFallback(entry: ModelCredentialShape): ModelEnvFallback | undefined {
  const clientType = entry.clientType?.trim() || undefined;
  const clientPair = resolveModelEnv(entry.modelId, clientType);
  const groupPair = resolveProviderModelEnv(entry.provider, entry.modelId, clientType);
  // VENDOR_ENDPOINTS keys every variable an MMSP client reads (each pair resolveModelEnv
  // can name), so a group pair outside it is one only the harness knows.
  if (
    groupPair !== undefined &&
    groupPair.envKey !== clientPair?.envKey &&
    !Object.hasOwn(VENDOR_ENDPOINTS, groupPair.envKey)
  ) {
    return { ...groupPair, readByClient: false };
  }
  if (clientPair === undefined) return undefined;
  const baseUrl = entry.baseUrl?.trim();
  if (!baseUrl) return { ...clientPair, readByClient: true };
  if ((VENDOR_ENDPOINTS[clientPair.envKey] ?? []).some((own) => sameEndpoint(own, baseUrl))) {
    return { ...clientPair, readByClient: true };
  }
  return undefined;
}

/**
 * The variable a keyless row that follows this group's connection falls back to, or
 * `undefined` when such a row gets none — the group-level key dialog's hint. Judged on the
 * group's `[providers.<id>]` values as the file stores them (`group`), never on the catalog's:
 *
 * - only a first-party vendor group (isVendorGroup) has one at all: gateways, vLLM, custom and
 *   user-defined groups exist to point away from the vendors' own endpoints;
 * - a vendor variable while the group leaves its rows on the vendor's own endpoint (no base
 *   URL, or one of VENDOR_ENDPOINTS') and on a client that reads that variable (no protocol,
 *   or one whose pair it is) — the same destination rule modelEnvFallback applies per row;
 * - a provider-scoped variable (the Penguin Go relay's) while the group names an endpoint:
 *   the relay key never travels to a vendor's default endpoint.
 */
export function providerEnvFallbackKey(
  providerId: string,
  group: ProviderConnectionShape | undefined,
): string | undefined {
  if (!isVendorGroup(providerId)) return undefined;
  const envKey = providerInfo(providerId)!.envKey;
  const baseUrl = group?.baseUrl?.trim() || undefined;
  const official = VENDOR_ENDPOINTS[envKey];
  if (official === undefined) return baseUrl !== undefined ? envKey : undefined;
  const clientType = canonicalClientType(group?.clientType?.trim() || undefined)?.toLowerCase();
  if (clientType !== undefined && `${MMSP_CLIENTS[clientType]?.env}_API_KEY` !== envKey) {
    return undefined;
  }
  if (baseUrl !== undefined && !official.some((own) => sameEndpoint(own, baseUrl))) {
    return undefined;
  }
  return envKey;
}

/**
 * A model entry that cannot be given to an MMSP client as configured: no key, and no
 * environment variable it may use; or a relay row with no endpoint for its relay key. The
 * message names the model and what to do, and says "API key" so hosts that classify
 * credential errors by message (the server's `isMissingCredential`) file it with the SDKs'
 * own missing-credential errors.
 */
export class ModelCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCredentialError";
  }
}

/** What a client is constructed with: an explicit key, or none when the routed client may read its own variable. */
export interface ResolvedModelCredential {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Whether a keyless request to this base URL goes out with no key rather than being refused:
 * MMSP's mmsp client calls a base URL it is handed without a key as an open MMSP server (the
 * `openServer` clients of MMSP_CLIENTS). Every other client lends the environment's key where
 * modelEnvFallback allows it, or needs a key of its own.
 */
export function keylessEndpoint(
  modelId: string,
  clientType: string | undefined,
  baseUrl: string | undefined,
): boolean {
  return (
    Boolean(baseUrl?.trim()) &&
    MMSP_CLIENTS[routedClientType(modelId, clientType) ?? ""]?.openServer === true
  );
}

/**
 * The credential an MMSP client is built with for a **model entry**, applying
 * modelEnvFallback's rule (the one function every path shares): Session creation and resume,
 * the vision describer, the connectivity / speed / vision probes and the utility completion
 * go through here; the endpoint listing and protocol detection, which have a protocol and a
 * URL but no entry, apply the same rule through endpointEnvApiKey.
 *
 * - An inline key (the entry's, or an explicit override) is used as given.
 * - No key, no base URL, fallback allowed and read by the client: nothing is handed over, the
 *   client reads the pair itself — including the SDK's own error when the variable is unset
 *   (an entry with no base URL under a Bedrock `ANTHROPIC_BASE_URL` and no `ANTHROPIC_API_KEY`
 *   stays valid).
 * - No key, fallback allowed, but a base URL on the entry (the vendor's own) or a
 *   provider-scoped pair: the variable's value is passed explicitly — MMSP refuses a base URL
 *   without a key rather than lend the vendor's variable to it — and an unset variable is
 *   refused here.
 * - No key and a base URL on the mmsp client (keylessEndpoint): the base URL alone, so the
 *   client sends no key, which an open MMSP server takes — as MMSP itself does.
 * - No key, no fallback: refused with a ModelCredentialError before any client exists.
 * - A provider-scoped group's row (Penguin Go) is also refused without a base URL, whatever
 *   the key's source: the relay key must not travel to the vendor's default endpoint.
 */
export function resolveModelCredential(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedModelCredential {
  const ref = `${entry.provider}/${entry.modelId}`;
  const baseUrl = entry.baseUrl || undefined;
  const apiKey = entry.apiKey || undefined;
  const fallback = modelEnvFallback(entry);
  if (fallback !== undefined && !fallback.readByClient && !baseUrl?.trim()) {
    throw new ModelCredentialError(
      `Model ${ref} has no base URL. Its API key belongs to the ${providerInfo(entry.provider)?.label ?? entry.provider} endpoint and cannot be sent to the vendor's default endpoint: set the base URL on the model entry.`,
    );
  }
  if (apiKey !== undefined) return { apiKey, ...(baseUrl !== undefined ? { baseUrl } : {}) };
  if (fallback === undefined) {
    if (baseUrl !== undefined && keylessEndpoint(entry.modelId, entry.clientType, baseUrl)) {
      return { baseUrl };
    }
    // A Bedrock region on the entry is not "not the vendor's": it is AWS, whose usual
    // credential is the default provider chain rather than a key. Until MMSP stops
    // letting its Bedrock client attach ANTHROPIC_API_KEY, a keyless row here is refused,
    // and the message says what still works.
    if (baseUrl?.trim().toLowerCase().startsWith("bedrock://")) {
      throw new ModelCredentialError(
        `Model ${ref} has no API key. A Bedrock endpoint set on the model entry cannot fall back to the environment yet: set the entry's AWS key (access,secret), or leave its base URL empty and set ANTHROPIC_BASE_URL=${baseUrl.trim()} in the server environment.`,
      );
    }
    throw new ModelCredentialError(
      `Model ${ref} has no API key. Its endpoint is not the vendor's own, so no environment variable is used for it: set the API key on the model entry.`,
    );
  }
  if (fallback.readByClient && baseUrl === undefined) return {};
  const value = env[fallback.envKey]?.trim();
  if (!value) {
    throw new ModelCredentialError(
      `Model ${ref} has no API key: set one on the model entry, or set ${fallback.envKey} in the server environment.`,
    );
  }
  return { apiKey: value, ...(baseUrl !== undefined ? { baseUrl } : {}) };
}

/**
 * The key the environment lends a bare endpoint spoken to on a generic protocol client —
 * the add-group listing and the protocol probes, which have a base URL and a protocol but no
 * entry yet. Same rule as modelEnvFallback: only a vendor's own endpoint gets the vendor's
 * key; a gateway or a private server gets none.
 */
export function endpointEnvApiKey(
  clientType: string,
  baseUrl: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const fallback = modelEnvFallback({ provider: "custom", modelId: "", clientType, baseUrl });
  if (fallback === undefined) return undefined;
  return env[fallback.envKey]?.trim() || undefined;
}

/**
 * The variable the UI may present as covering a keyless entry — the masked preview on the
 * card, the dialog's "leave empty to use …" hint — or `undefined` when nothing should be
 * promised. Narrower than modelEnvFallback on purpose: a row with no base URL in a group whose
 * defaults point away from the vendor (the vLLM presets, a custom row saved without an
 * endpoint) does fall back to OPENAI_API_KEY under the rule, but presenting that as "key
 * configured" would encourage exactly the misconfiguration that sends the OpenAI key and a
 * self-hosted model id to api.openai.com.
 *
 * `entry` is the row's EFFECTIVE shape (effectiveConnection: the file's values, row then
 * group), and the preview needs one of:
 *
 * - an effective base URL — the fallback rule already guarantees it is the vendor's own (or,
 *   for the Penguin Go relay, that the relay variable goes with it);
 * - no base URL, in a built-in group other than `custom`, on the client the id's family names
 *   anyway (no protocol, or that very client — what a DeepSeek row pinned to
 *   `deepseek-official` speaks): the request goes to the vendor's own endpoint with the
 *   vendor's key. A generic or self-hosted protocol with no endpoint (the vLLM presets, a
 *   custom row) is the misconfiguration above, and a relay variable with no relay endpoint is
 *   refused by resolveModelCredential.
 *
 * The server's `GET /models` preview, the web dialog's hint and the CLI's list read this, so
 * they cannot disagree.
 */
export function modelEnvPreviewKey(entry: ModelCredentialShape): string | undefined {
  const fallback = modelEnvFallback(entry);
  if (fallback === undefined) return undefined;
  if (entry.baseUrl?.trim()) return fallback.envKey;
  if (!fallback.readByClient) return undefined;
  const info = providerInfo(entry.provider);
  if (info === undefined || info.id === "custom") return undefined;
  const pinned = entry.clientType?.trim();
  return !pinned || routedClientType(entry.modelId, pinned) === routedClientType(entry.modelId)
    ? fallback.envKey
    : undefined;
}

/** Where an effective connection value came from: the row, its group's table, or nowhere. */
export type ConnectionSource = "model" | "provider" | "none";

/** A group's `[providers.<id>]` connection as the resolver reads it (providerConnectionShape). */
export interface ProviderConnectionShape {
  baseUrl?: string | undefined;
  clientType?: string | undefined;
  apiKey?: string | undefined;
}

/** The connection a request for one row is built with, and where each value came from. */
export interface EffectiveConnection {
  baseUrl?: string;
  baseUrlSource: ConnectionSource;
  clientType?: string;
  clientTypeSource: ConnectionSource;
  apiKey?: string;
  /** No "env" here: whether the environment lends a key is modelEnvFallback's call, made on this shape afterwards. */
  apiKeySource: ConnectionSource;
}

/** `[providers.<id>]` -> the resolver's shape (snake -> camel); undefined in, undefined out. */
export function providerConnectionShape(
  p: ProviderConnection | undefined,
): ProviderConnectionShape | undefined {
  if (p === undefined) return undefined;
  return { baseUrl: p.base_url, clientType: p.client_type, apiKey: p.api_key };
}

/** The first candidate holding a non-blank value, with its source; blank and absent are the same. */
function firstPresent<S extends string>(
  candidates: ReadonlyArray<readonly [string | undefined, S]>,
): { value?: string; source: S | "none" } {
  for (const [value, source] of candidates) {
    if (value !== undefined && value.trim() !== "") return { value, source };
  }
  return { source: "none" };
}

/** `scheme://host[:port]` of a URL (the port only when not the scheme's default), or undefined when it does not parse. */
function endpointOrigin(value: string): string | undefined {
  try {
    const u = new URL(value.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/**
 * Whether a group's key reaches a row: a key belongs to the endpoint it was issued for (the
 * principle PRN-021 applies to environment keys). It reaches the row when the row has no base
 * URL of its own — the row goes where the group's clients go — or when the row's own base URL
 * has the same origin (scheme, host, port) as the group's: OpenCode Go's Messages rows sit on
 * another path of the host the group's base URL names, and one key serves both. A row with its
 * own base URL in a group that has none, or on another origin (a preset carrying its own host,
 * like custom's Atria; one model re-pointed at a proxy), goes somewhere the group's key was
 * not issued for, and gets none: it needs a key of its own.
 *
 * Blank counts as absent on both sides; a base URL that does not parse matches nothing.
 * effectiveConnection applies it, and the counts that ask "how many rows use the group key"
 * (the server's, the models page's) ask here.
 */
export function groupKeyReaches(
  rowBaseUrl: string | undefined,
  groupBaseUrl: string | undefined,
): boolean {
  const own = rowBaseUrl?.trim();
  if (!own) return true;
  const group = groupBaseUrl?.trim();
  if (!group) return false;
  const origin = endpointOrigin(own);
  return origin !== undefined && origin === endpointOrigin(group);
}

/**
 * The connection a row is actually used with — the file's values and nothing else: per field,
 * the first non-blank value of
 *
 *   base_url:    row -> provider -> none
 *   client_type: row -> provider -> none
 *   api_key:     row -> provider (only where groupKeyReaches) -> none
 *
 * where "provider" is the group's `[providers.<id>]` table (providerConnectionShape) and
 * "none" means the client library's own default: no base URL = the routed client's default
 * endpoint (or its `*_BASE_URL` variable), no client type = MMSP routes by the id's family,
 * no key = the environment, where modelEnvFallback allows it on the EFFECTIVE shape.
 * client_type passes canonicalClientType.
 *
 * The catalog is not a layer here: it is a reference written into a file once (a new Project,
 * "Add new models", "Restore defaults"), and a value the file does not hold is the client's
 * default, whatever the catalog says. A row's own value always wins over its group's, so a
 * group protocol never overrides the protocol a row stores (Penguin Go's and OpenCode Go's
 * rows each store theirs). Pure and browser-safe: the server's `GET /models`, the models page
 * and the CLI read the same answer.
 */
export function effectiveConnection(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): EffectiveConnection {
  const baseUrl = firstPresent([
    [entry.baseUrl, "model"],
    [group?.baseUrl, "provider"],
  ]);
  const clientType = firstPresent([
    [entry.clientType, "model"],
    [group?.clientType, "provider"],
  ]);
  const apiKey = firstPresent([
    [entry.apiKey, "model"],
    [groupKeyReaches(entry.baseUrl, group?.baseUrl) ? group?.apiKey : undefined, "provider"],
  ]);
  return {
    ...(baseUrl.value !== undefined ? { baseUrl: baseUrl.value } : {}),
    baseUrlSource: baseUrl.source,
    ...(clientType.value !== undefined
      ? { clientType: canonicalClientType(clientType.value)! }
      : {}),
    clientTypeSource: clientType.source,
    ...(apiKey.value !== undefined ? { apiKey: apiKey.value } : {}),
    apiKeySource: apiKey.source,
  };
}

/**
 * The credential and protocol a client is built with for a config row: effectiveConnection,
 * then resolveModelCredential on the EFFECTIVE shape — so PRN-021's destination rule judges
 * the endpoint the request really goes to (a group pointed at a proxy gets no vendor key from
 * the environment) — with the effective clientType returned beside it.
 *
 * `override` is the caller's explicit pair (Session creation's apiKey / baseUrl) and sits above
 * the row's own values; blank counts as absent there too. An override base URL is the row's
 * own for groupKeyReaches. Throws ModelCredentialError exactly where resolveModelCredential
 * does.
 */
export function resolveEntryCredential(
  entry: Pick<ModelEntry, "provider" | "model_id" | "client_type" | "base_url" | "api_key">,
  provider: ProviderConnectionShape | undefined,
  override: { apiKey?: string | undefined; baseUrl?: string | undefined } = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): { apiKey?: string; baseUrl?: string; clientType?: string } {
  const effective = effectiveConnection(
    {
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: entry.client_type,
      baseUrl: override.baseUrl?.trim() ? override.baseUrl : entry.base_url,
      apiKey: override.apiKey?.trim() ? override.apiKey : entry.api_key,
    },
    provider,
  );
  const credential = resolveModelCredential(
    {
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: effective.clientType,
      baseUrl: effective.baseUrl,
      apiKey: effective.apiKey,
    },
    env,
  );
  return {
    ...credential,
    ...(effective.clientType !== undefined ? { clientType: effective.clientType } : {}),
  };
}

/**
 * Whether a model can carry fast mode at all, and on which protocol - `undefined` means no.
 *
 * The fast tier is a property of the **client MMSP routes to** (routedClientType), never of
 * the catalog row: the registry carries no fast-tier capability flag, but the routing is
 * deterministic, so the answer is too. This reports what the selected client does with the
 * parameter:
 *
 * - maps it -> the protocol, and the toggle may be offered;
 * - raises UnsupportedParameterError (the Z.AI, Moonshot, DeepSeek, google-genai and
 *   embedding clients, and anthropic-official on Bedrock or for the generations that reject
 *   the `speed` parameter) -> `undefined`;
 * - forwards it to an MMSP server, whose upstream client decides what it does with it (mmsp)
 *   -> `undefined`: the harness cannot say on which protocol, or whether at all;
 * - routes nowhere (AutoLLMClient throws for an id it cannot place) -> `undefined` as well,
 *   since a model that cannot run has no fast tier either.
 *
 * A rule rather than a per-model list on purpose: catalog rows added later inherit the right
 * answer without anyone remembering to update a table.
 *
 * `"anthropic"` is reported for every Claude the client serves, including ids outside the
 * research preview's Opus allowlist: Anthropic answers those with a 429 at request time, which
 * is something to warn about before enabling, not grounds to hide the setting.
 *
 * Two runtime inputs stay invisible to a pure function of the config and can still flip the
 * answer: the server's `CLIENT_TYPE` env var names the client for an entry that pins none, and
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
  const routed = routedClientType(modelId, clientType);
  // Bedrock has no fast tier, and these Claude generations reject the `speed` parameter (MMSP
  // 0.5.2's NO_FAST_MODE); both tests run against what the client was constructed with, as the
  // client's own do.
  if (
    routed === "anthropic-official" &&
    (baseUrl?.startsWith("bedrock://") ||
      ["4-6", "sonnet-5-5", "haiku-5-5", "fable-5-1"].some((generation) =>
        modelId.includes(generation),
      ))
  ) {
    return undefined;
  }
  return MMSP_CLIENTS[routed ?? ""]?.fastMode;
}

/**
 * The value every one of `values` holds, by `same`, or undefined when one lacks it, two
 * differ, or there are none.
 */
function sharedValue(
  values: readonly (string | undefined)[],
  same: (a: string, b: string) => boolean,
): string | undefined {
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((v) => v !== undefined && same(v, first)) ? first : undefined;
}

/**
 * The connection the catalog gives a built-in group when a file is written from it — a new
 * Project, "Add new models" for a group new to the file, "Restore defaults": its gateway
 * endpoint (`gatewayBaseUrl`, else the one base URL every catalog row of the group carries)
 * and its one protocol (the group's pin, providerClientType, else the one pin every catalog
 * row of the group carries; canonical spelling). Retired rows count: "Restore defaults"
 * writes them too, so they must store their difference from the same table.
 *
 * Undefined for `custom` (it holds the user's own endpoints), for an id the catalog does not
 * know, and for a group with neither — the first-party vendors, whose rows go to the
 * client's defaults. A reference value: nothing reads it when a request is built.
 */
export function catalogGroupConnection(
  providerId: string,
): { base_url?: string; client_type?: string } | undefined {
  const info = providerInfo(providerId);
  if (info === undefined || info.id === "custom") return undefined;
  const rows = MODEL_CATALOG.filter((m) => m.provider === providerId);
  const baseUrl =
    info.gatewayBaseUrl ??
    sharedValue(
      rows.map((m) => m.baseUrl),
      sameEndpoint,
    );
  const clientType = canonicalClientType(
    providerClientType(providerId) ??
      sharedValue(
        rows.map((m) => m.clientType),
        sameClientType,
      ),
  );
  if (baseUrl === undefined && clientType === undefined) return undefined;
  return {
    ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
    ...(clientType !== undefined ? { client_type: clientType } : {}),
  };
}

/**
 * `[providers.<id>]` for every built-in group with a catalogGroupConnection, in the catalog's
 * group order — what a new Project's file stores beside presetModelEntries' rows. A fresh
 * object on every call, so a caller may change it.
 */
export function presetProviderTable(): ProviderTable {
  const table: ProviderTable = {};
  for (const p of MODEL_PROVIDERS) {
    const connection = catalogGroupConnection(p.id);
    if (connection !== undefined) table[p.id] = connection;
  }
  return table;
}

/**
 * Catalog -> preset ModelEntry list (shared by defaultProjectConfig and the server's initial
 * config, avoiding duplicate hand-written copies). `provider` and `model_id` are persisted as
 * separate fields (`model_id` is the plain upstream id). The facts a row stores are the
 * context window, the price and `vision = false`, plus the row's protocol and endpoint where
 * they differ from its group's table in `groups` (catalogModelEntry): beside those tables, the
 * file alone says where every request goes, and nothing is left for a resolver to fill from
 * the catalog. `groups` is the `[providers]` table the rows will sit beside — a new Project's
 * (presetProviderTable, the default), or the file's own when "Add new models" adds rows to an
 * existing Project, so each added row resolves to its catalog connection whatever the user
 * has set on its group. No secrets are included, so only an API key is needed.
 *
 * Pricing is written as the LIST price the catalog records (a scheduled row's PEAK price),
 * never a discounted number. What is on disk then stays true whatever promotion is live and
 * whatever hour the Project is created or re-synced in: a flat promotion is stored beside the
 * file as a per-Project fraction (presetPromotions), and both it and an off-peak tier are
 * applied when the price is read, by the models page and by the cost center alike.
 */
export function presetModelEntries(groups: ProviderTable = presetProviderTable()): ModelEntry[] {
  const catalog = presetProviderTable();
  // A retired row stays in the catalog for the Projects that still carry it, and only for them.
  return MODEL_CATALOG.filter((m) => m.retired !== true).map((m) =>
    catalogModelEntry(m, catalog, groups),
  );
}

/**
 * Every catalog row as a ModelEntry, retired rows included, in the shape presetModelEntries
 * writes. This is the list "Restore defaults" puts a Project's built-in rows back to: a sync
 * never adds a retired row, but a restore resets one the Project already carries like any
 * preset, so a price an older release stored returns to the catalog's (see
 * ModelCatalogEntry.retired). `groups` as in presetModelEntries.
 */
export function catalogModelEntries(groups: ProviderTable = presetProviderTable()): ModelEntry[] {
  const catalog = presetProviderTable();
  return MODEL_CATALOG.map((m) => catalogModelEntry(m, catalog, groups));
}

/**
 * One catalog row as the ModelEntry a Project stores (see presetModelEntries): its facts, and
 * `client_type` / `base_url` exactly where the row's catalog connection — per field, the
 * row's own catalog value, else its group's (`catalog`, presetProviderTable) — differs from
 * the table it will sit beside (`groups`): canonical client types compared, endpoints by
 * sameEndpoint, a blank table field counting as absent. A row whose group's table carries the
 * same value stores none and follows the table; a row whose group has no table (custom's
 * Atria) stores its own.
 */
function catalogModelEntry(
  m: ModelCatalogEntry,
  catalog: ProviderTable,
  groups: ProviderTable,
): ModelEntry {
  const group = groups[m.provider];
  const clientType = canonicalClientType(m.clientType ?? catalog[m.provider]?.client_type);
  const groupClientType = group?.client_type?.trim() || undefined;
  const ownClientType =
    clientType !== undefined &&
    (groupClientType === undefined || !sameClientType(clientType, groupClientType))
      ? clientType
      : undefined;
  const baseUrl = m.baseUrl ?? catalog[m.provider]?.base_url;
  const groupBaseUrl = group?.base_url?.trim() || undefined;
  const ownBaseUrl =
    baseUrl !== undefined && (groupBaseUrl === undefined || !sameEndpoint(baseUrl, groupBaseUrl))
      ? baseUrl
      : undefined;
  return {
    provider: m.provider,
    model_id: m.modelId,
    ...(m.contextWindow !== undefined ? { context_window: m.contextWindow } : {}),
    ...(ownClientType !== undefined ? { client_type: ownClientType } : {}),
    ...(m.pricing ? { pricing: { ...m.pricing } } : {}),
    // ModelEntry.vision defaults to supported: only models that don't support images
    // explicitly persist false (drives read_file's hand-off of images to the vision model and input
    // image hand-off, see project-config.ts).
    ...(m.supportsVision ? {} : { vision: false }),
    ...(ownBaseUrl !== undefined ? { base_url: ownBaseUrl } : {}),
  };
}

/**
 * The catalog's flat promotions, as a new Project is seeded with them: every row whose `discount`
 * is a fraction in (0, 1). A retired row is skipped like it is in presetModelEntries: a new
 * Project never carries it, so there is nothing for its promotion to apply to.
 */
export function presetPromotions(): Array<{ provider: string; modelId: string; discount: number }> {
  return MODEL_CATALOG.flatMap((m) =>
    m.retired !== true && m.discount !== undefined && m.discount > 0 && m.discount < 1
      ? [{ provider: m.provider, modelId: m.modelId, discount: m.discount }]
      : [],
  );
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
  if (provider === "tokendance") return `https://tokendance.space/models/${modelId}`;
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
  if (provider === "vllm") {
    // recipes.vllm.ai has a page per model vLLM published a recipe for, which is exactly what
    // this group presets; an id the user serves themselves has no page, so it gets the index.
    return catalogEntryFor(provider, modelId) !== undefined
      ? `https://recipes.vllm.ai/${modelId}`
      : providerInfo(provider)?.modelsUrl;
  }
  if (provider === "custom") return undefined;
  return providerInfo(provider)?.modelsUrl;
}

/**
 * App attribution: how the harness identifies itself to gateways that rank or report the apps
 * calling them. Both values describe PenguinHarness itself, never a model or an account.
 *
 * `APP_URL` is also the `app_url` a provider OAuth flow stamps onto the key it mints, which is
 * why it is exported: a stable app URL is required there, and a second copy would let the two
 * attributions drift apart.
 */
export const APP_URL = "https://penguin.ooo/";
const APP_TITLE = "PenguinHarness";
/**
 * OpenRouter marketplace categories, comma-separated. OpenRouter accepts at most **two per
 * request** from a fixed slug list and silently drops anything else, so this string is
 * exactly two recognised slugs.
 */
const OPENROUTER_CATEGORIES = "cli-agent,personal-agent";

/**
 * Lowercase host of a base URL; undefined when it is blank or unparseable. A fully-qualified
 * trailing dot is stripped: `URL` keeps it in `hostname`, but `openrouter.ai.` names the same
 * server as `openrouter.ai` and has to match the same way. Stripping cannot widen the match —
 * a suffix-anchored comparison rejects `openrouter.ai.attacker.com` with or without the dot.
 */
function endpointHost(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

/** Host equality extended to subdomains; suffix-anchored, so `notopenrouter.ai` never matches. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Attribution headers for a request's base URL, or undefined when that endpoint runs no
 * attribution scheme (every direct vendor, and every gateway that does not read one).
 *
 * Keyed on the endpoint host rather than on the catalog's provider group, because the group
 * is a display bucket while the headers are a property of the server being called: a `custom`
 * entry pointed at OpenRouter is still PenguinHarness talking to OpenRouter and is attributed
 * identically. The flip side is that an entry carrying no `base_url` of its own gets no
 * headers even when `OPENAI_BASE_URL` sends it to a gateway — that variable is read inside
 * MMSP and never reaches this side.
 *
 * - OpenRouter (https://openrouter.ai/docs/app-attribution): `HTTP-Referer` is the identity
 *   that creates the app page and drives the rankings, `X-OpenRouter-Title` is its display
 *   name, `X-OpenRouter-Categories` files it under marketplace categories.
 * - TokenDance (https://tokendance.space/docs/app-attribution): `X-App-URL` alone, and it
 *   takes priority over any App URL recorded on the API key — the same key may be in use by
 *   other tools, so the per-request value is the accurate one.
 * - OpenCode (https://opencode.ai): `x-opencode-session` alone, and it names the conversation
 *   rather than the app — the gateway keys its routing and prompt caching on it, so the value
 *   has to hold still across a conversation's requests and differ between conversations. It
 *   is **always** sent: the gateway refuses a request that names none (400 "Request is missing
 *   x-opencode-session"). A Session's requests carry the Session's id; a request with none (a
 *   connectivity test, a vision probe) gets a fresh random id, making it a conversation of its
 *   own — never a shared constant, which would file every such request under one session. A
 *   caller that sends several requests without a Session computes the headers once and
 *   reuses them (GenerativeModel does, per instance), so they share that one id.
 */
export function attributionHeaders(
  baseUrl: string | undefined,
  sessionId?: string,
): Record<string, string> | undefined {
  const host = endpointHost(baseUrl);
  if (!host) return undefined;
  if (hostMatches(host, "openrouter.ai")) {
    return {
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Title": APP_TITLE,
      "X-OpenRouter-Categories": OPENROUTER_CATEGORIES,
    };
  }
  if (hostMatches(host, "tokendance.space")) return { "X-App-URL": APP_URL };
  if (hostMatches(host, "opencode.ai")) {
    // The global Web Crypto rather than node:crypto: this module is bundled into the web app too.
    return { "x-opencode-session": sessionId || globalThis.crypto.randomUUID() };
  }
  return undefined;
}
