/**
 * Built-in model catalog unit tests: unique ids, valid provider references, positive
 * three-bucket pricing, lookups, and preset entry generation.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  MODEL_PROVIDERS,
  modelHomepageUrl,
  catalogEntryFor,
  presetModelEntries,
  providerInfo,
  resolveModelEnv,
} from "../src/state/index.js";

describe("model-catalog", () => {
  it("(provider, model_id) pairs are unique; DeepSeek comes first (the default model's provider)", () => {
    // Bare model ids may repeat across providers (a gateway reselling a vendor model keeps the
    // vendor's upstream id, e.g. Qwen Token Plan's glm-5.2 / deepseek-v4-pro) — uniqueness is
    // the (provider, model_id) pair, matching the catalog's sole lookup key (catalogEntryFor).
    const pairs = MODEL_CATALOG.map((m) => `${m.provider}\0${m.modelId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const ids = MODEL_CATALOG.map((m) => m.modelId);
    expect(MODEL_CATALOG[0]!.provider).toBe("deepseek");
    // Group order: DeepSeek first, followed by the OpenRouter, SiliconFlow, and Qwen Token
    // Plan gateways, then Google Gemini before Anthropic, with custom last.
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "deepseek",
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
      "google",
      "anthropic",
      "openai",
      "zhipu",
      "moonshot",
      "custom",
    ]);
    expect(providerInfo("siliconflow")!.label).toBe("SiliconFlow");
    // The catalog no longer includes GLM-5-Turbo.
    expect(ids).not.toContain("glm-5-turbo");
  });

  it("every provider is in MODEL_PROVIDERS (custom only groups user-defined models; the catalog never uses it)", () => {
    const providerIds = new Set(MODEL_PROVIDERS.map((p) => p.id));
    for (const m of MODEL_CATALOG) {
      expect(providerIds.has(m.provider)).toBe(true);
      expect(m.provider).not.toBe("custom");
    }
    // Except for custom, every provider gives a console link to "get an API key" (shown in the
    // frontend's group header) and a model list / docs link to "get a model id" (shown in the add-model dialog).
    for (const p of MODEL_PROVIDERS) {
      if (p.id === "custom") {
        expect(p.apiKeyUrl).toBeUndefined();
        expect(p.modelsUrl).toBeUndefined();
      } else {
        expect(p.apiKeyUrl).toMatch(/^https:\/\//);
        expect(p.modelsUrl).toMatch(/^https:\/\//);
      }
    }
    // Provider ids are also unique, and each provider has an API key / base URL env var name.
    expect(new Set([...providerIds]).size).toBe(MODEL_PROVIDERS.length);
    for (const p of MODEL_PROVIDERS) {
      expect(p.envKey).toMatch(/_API_KEY$/);
      expect(p.envBaseUrlKey).toMatch(/_BASE_URL$/);
    }
  });

  it("price buckets are positive (preview models without a list price omit pricing); context_window is a positive integer (the free router omits it)", () => {
    // Models with no obtainable published price. qwen3.8-max-preview: the plan runs a
    // quota-multiplier promotion instead of a per-token list price. The three SiliconFlow
    // entries: AgentHub's registry publishes no pricing for them and SiliconFlow's price list
    // is only reachable with an authenticated token, so no number can be sourced. All of them
    // carry no pricing and their costs read as 0, same as unpriced user models.
    const UNPRICED = new Set([
      "qwen-token-plan\0qwen3.8-max-preview",
      "siliconflow\0Pro/moonshotai/Kimi-K2.6",
      "siliconflow\0Pro/zai-org/GLM-5.1",
      "siliconflow\0Qwen/Qwen3.6-35B-A3B",
    ]);
    for (const m of MODEL_CATALOG) {
      if (UNPRICED.has(`${m.provider}\0${m.modelId}`)) {
        expect(m.pricing, m.modelId).toBeUndefined();
      } else if (m.modelId.endsWith(":free") || m.modelId.endsWith("/free")) {
        // Free-tier gateway model (:free variants and the openrouter/free router): a genuine
        // $0 price (not "unknown"), so costs compute to 0.
        expect(m.pricing, m.modelId).toBeDefined();
        expect([m.pricing!.cache_read, m.pricing!.cache_write, m.pricing!.output]).toEqual([
          0, 0, 0,
        ]);
      } else {
        expect(m.pricing, m.modelId).toBeDefined();
        expect(m.pricing!.unit).toBe("usd_per_mtok");
        expect(m.pricing!.cache_read).toBeGreaterThan(0);
        expect(m.pricing!.cache_write).toBeGreaterThan(0);
        expect(m.pricing!.output).toBeGreaterThan(0);
      }
      if (m.modelId === "openrouter/free") {
        // The Free Models Router's target (and thus its effective context window) changes per
        // request, so the catalog records none.
        expect(m.contextWindow).toBeUndefined();
      } else {
        expect(Number.isInteger(m.contextWindow)).toBe(true);
        expect(m.contextWindow!).toBeGreaterThan(0);
      }
    }
  });

  it("providerInfo matches by id; unknown ids return undefined", () => {
    expect(providerInfo("moonshot")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(providerInfo("nonexistent")).toBeUndefined();
  });

  it("catalogEntryFor is the sole lookup and always takes the (provider, model_id) pair", () => {
    // It matches on (group, upstream id) pairs, so an identically named upstream id never
    // matches across the wrong group. There is no bare-id lookup at all: a gateway reselling a
    // vendor model keeps the vendor's upstream id, so a bare id names no single catalog entry
    // and the catalog never offers to pick one (`glm-5.2`, `qwen3.7-max`, `qwen3.7-plus` and
    // `deepseek-v4-pro` each appear under two groups).
    expect(catalogEntryFor("anthropic", "claude-sonnet-4-6")?.displayName).toBe(
      "Claude Sonnet 4.6",
    );
    expect(catalogEntryFor("openai", "claude-sonnet-4-6")).toBeUndefined();
    // The upstream id itself may contain / (gateway models); it is never split apart.
    expect(catalogEntryFor("openrouter", "xiaomi/mimo-v2.5")?.displayName).toBe("MiMo-V2.5");
    expect(catalogEntryFor("custom", "my-own")).toBeUndefined();
    // Each group's entry for a resold id is reached only through that group.
    expect(catalogEntryFor("zhipu", "glm-5.2")?.contextWindow).toBe(1000000);
    expect(catalogEntryFor("qwen-token-plan", "glm-5.2")?.contextWindow).toBe(1048576);
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro")?.provider).toBe("deepseek");
    expect(catalogEntryFor("qwen-token-plan", "deepseek-v4-pro")?.provider).toBe("qwen-token-plan");
  });

  it("presetModelEntries: provider and bare upstream model_id are separate fields; gateway models inline base_url", () => {
    const entries = presetModelEntries();
    expect(entries).toHaveLength(MODEL_CATALOG.length);
    for (const [i, entry] of entries.entries()) {
      const cat = MODEL_CATALOG[i]!;
      expect(entry.provider).toBe(cat.provider);
      expect(entry.model_id).toBe(cat.modelId);
      expect(entry.context_window).toBe(cat.contextWindow);
      expect(entry.pricing).toEqual(cat.pricing);
      expect(entry.vision).toBe(cat.supportsVision ? undefined : false);
      // Models that AgentHub can auto-route leave client_type unset; OpenRouter gateway models set it to openai.
      expect(entry.client_type).toBe(cat.clientType);
      // Gateway models inline a preset base URL (no credentials); other models carry no credential at all.
      expect(entry.base_url).toBe(cat.baseUrl);
      expect(entry.api_key).toBeUndefined();
      // The concatenated storage id and request_model_id have been removed and no longer appear.
      expect(Object.hasOwn(entry, "request_model_id")).toBe(false);
    }
  });

  it("gateway models (OpenRouter / SiliconFlow / Qwen Token Plan): openai protocol + preset base URL; env fallback is OPENAI_API_KEY", () => {
    const or = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
    // Dictionary order, newer versions of a series first (gpt-5.6-* before gpt-5.5,
    // opus-4.8 before 4.7) — precomputed in the catalog, no runtime sorting.
    expect(or.map((m) => m.modelId)).toEqual([
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-4.8",
      "anthropic/claude-opus-4.7",
      "anthropic/claude-sonnet-5",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "google/gemini-3.6-flash",
      "google/gemini-3.5-flash",
      "google/gemini-3.5-flash-lite",
      "inclusionai/ling-3.0-flash:free",
      "minimax/minimax-m3",
      "moonshotai/kimi-k3",
      "moonshotai/kimi-k2.6",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.5",
      "openrouter/free",
      "qwen/qwen3.6-35b-a3b",
      "stepfun/step-3.7-flash",
      "tencent/hy3",
      "x-ai/grok-4.5",
      "xiaomi/mimo-v2.5",
      "z-ai/glm-5.2",
      "z-ai/glm-5.1",
    ]);
    for (const m of or) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://openrouter.ai/api/v1");
    }
    const fw = MODEL_CATALOG.filter((m) => m.provider === "fireworks");
    expect(fw.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["accounts/fireworks/models/deepseek-v4-flash", false],
      ["accounts/fireworks/models/deepseek-v4-pro", false],
      ["accounts/fireworks/models/glm-5p2", false],
      ["accounts/fireworks/models/kimi-k2p7-code", true],
      ["accounts/fireworks/models/minimax-m3", true],
    ]);
    for (const m of fw) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://api.fireworks.ai/inference/v1");
    }
    const sf = MODEL_CATALOG.filter((m) => m.provider === "siliconflow");
    // Dictionary order is case-insensitive (as in qwen-pay-as-you-go, where ZHIPU/GLM-5.2
    // sorts last): Pro/ and Qwen/ fall between moonshotai/ and zai-org/.
    expect(sf.map((m) => m.modelId)).toEqual([
      "deepseek-ai/DeepSeek-V4-Flash",
      "deepseek-ai/DeepSeek-V4-Pro",
      "meituan-longcat/LongCat-2.0",
      "moonshotai/Kimi-K2.7-Code",
      "Pro/moonshotai/Kimi-K2.6",
      "Pro/zai-org/GLM-5.1",
      "Qwen/Qwen3.6-35B-A3B",
      "zai-org/GLM-5.2",
    ]);
    for (const m of sf) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://api.siliconflow.cn/v1");
    }
    const qtp = MODEL_CATALOG.filter((m) => m.provider === "qwen-token-plan");
    expect(qtp.map((m) => m.modelId)).toEqual([
      "deepseek-v4-pro",
      "glm-5.2",
      "qwen3.8-max-preview",
      "qwen3.7-max",
      "qwen3.7-plus",
    ]);
    for (const m of qtp) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    }
    // Vision flags per the plan's supported-model table: 3.8-max-preview and 3.7-plus see images.
    expect(qtp.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["deepseek-v4-pro", false],
      ["glm-5.2", false],
      ["qwen3.8-max-preview", true],
      ["qwen3.7-max", false],
      ["qwen3.7-plus", true],
    ]);
    const qpayg = MODEL_CATALOG.filter((m) => m.provider === "qwen-pay-as-you-go");
    expect(qpayg.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["kimi/kimi-k3", true],
      ["qwen3.7-max", false],
      ["qwen3.7-plus", true],
      ["ZHIPU/GLM-5.2", false],
    ]);
    for (const m of qpayg) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    }
    // Routed through AgentHub's OpenAI client -> when the credential is left blank it reads OPENAI_API_KEY (not the provider's own env var name).
    for (const id of [
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
      "custom",
    ]) {
      expect(providerInfo(id)!.envKey).toBe("OPENAI_API_KEY");
      expect(providerInfo(id)!.envBaseUrlKey).toBe("OPENAI_BASE_URL");
    }
    // gatewayBaseUrl (prefilled by group in the frontend's "add model" dialog) is only carried by the gateway providers.
    expect(providerInfo("openrouter")!.gatewayBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(providerInfo("siliconflow")!.gatewayBaseUrl).toBe("https://api.siliconflow.cn/v1");
    expect(providerInfo("qwen-token-plan")!.gatewayBaseUrl).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    );
    expect(providerInfo("qwen-pay-as-you-go")!.gatewayBaseUrl).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(providerInfo("fireworks")!.gatewayBaseUrl).toBe("https://api.fireworks.ai/inference/v1");
    const GATEWAYS = [
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
    ];
    for (const p of MODEL_PROVIDERS) {
      if (!GATEWAYS.includes(p.id)) {
        expect(p.gatewayBaseUrl, p.id).toBeUndefined();
      }
    }
    const gateway = [...or, ...fw, ...sf, ...qtp, ...qpayg];
    // Pricing (USD): MiMo v2.5 and Hy3.
    const mimo = MODEL_CATALOG.find((m) => m.modelId === "xiaomi/mimo-v2.5")!.pricing!;
    expect([mimo.cache_read, mimo.cache_write, mimo.output]).toEqual([0.0028, 0.14, 0.28]);
    const hy3 = MODEL_CATALOG.find((m) => m.modelId === "tencent/hy3")!.pricing!;
    expect([hy3.cache_read, hy3.cache_write, hy3.output]).toEqual([0.035, 0.14, 0.58]);
    // Gemini 3.6 Flash and 3.5 Flash Lite: upstream publishes a cache-hit price, so cache_read
    // stores the real discounted price (not the input price) — cache_read is its own billing
    // bucket in the cost center. cache_write repeats input (no per-token cache-write fee).
    const g36 = catalogEntryFor("openrouter", "google/gemini-3.6-flash")!;
    expect([g36.contextWindow, g36.supportsVision]).toEqual([1048576, true]);
    expect([g36.pricing!.cache_read, g36.pricing!.cache_write, g36.pricing!.output]).toEqual([
      0.15, 1.5, 7.5,
    ]);
    const g35lite = catalogEntryFor("openrouter", "google/gemini-3.5-flash-lite")!;
    expect([g35lite.contextWindow, g35lite.supportsVision]).toEqual([1048576, true]);
    expect([
      g35lite.pricing!.cache_read,
      g35lite.pricing!.cache_write,
      g35lite.pricing!.output,
    ]).toEqual([0.03, 0.3, 2.5]);
    // The gateway row for gemini-3.5-flash reports the same context window as the
    // direct-vendor row for that model (and as AgentHub's registry): 1048576, not 1000000.
    expect(catalogEntryFor("openrouter", "google/gemini-3.5-flash")!.contextWindow).toBe(1048576);
    expect(catalogEntryFor("google", "gemini-3.5-flash")!.contextWindow).toBe(1048576);

    // In preset entries, exactly the gateway models (and only them) inline base_url (no credentials).
    const withBaseUrl = presetModelEntries().filter((e) => e.base_url !== undefined);
    expect(withBaseUrl.map((e) => [e.provider, e.model_id]).sort()).toEqual(
      gateway.map((m) => [m.provider, m.modelId]).sort(),
    );
  });

  it("direct-vendor groups: auto-routed (no client_type / base_url), newest series first", () => {
    // These groups' ids are auto-routed by AgentHub, so they carry neither client_type nor a
    // preset base URL — the opposite of the gateway groups above.
    for (const id of ["google", "anthropic", "moonshot"]) {
      for (const m of MODEL_CATALOG.filter((e) => e.provider === id)) {
        expect(m.clientType, m.modelId).toBeUndefined();
        expect(m.baseUrl, m.modelId).toBeUndefined();
      }
    }
    // Dictionary order by tier with newer versions of a tier first (same rule the OpenRouter
    // block follows for the identical Claude line-up).
    expect(MODEL_CATALOG.filter((m) => m.provider === "google").map((m) => m.modelId)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
    ]);
    expect(MODEL_CATALOG.filter((m) => m.provider === "anthropic").map((m) => m.modelId)).toEqual([
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
    ]);
    expect(MODEL_CATALOG.filter((m) => m.provider === "moonshot").map((m) => m.modelId)).toEqual([
      "kimi-k3",
      "kimi-k2.6",
      "kimi-k2.5",
    ]);
    // Anthropic keeps its cache_write = 1.25 x input convention for the Claude 5 line too
    // (registry input 10 and 2 -> 12.5 and 2.5), unlike every other group where cache_write
    // repeats the input price.
    const fable = catalogEntryFor("anthropic", "claude-fable-5")!;
    expect([fable.pricing!.cache_read, fable.pricing!.cache_write, fable.pricing!.output]).toEqual([
      1, 12.5, 50,
    ]);
    const sonnet5 = catalogEntryFor("anthropic", "claude-sonnet-5")!;
    expect([
      sonnet5.pricing!.cache_read,
      sonnet5.pricing!.cache_write,
      sonnet5.pricing!.output,
    ]).toEqual([0.2, 2.5, 10]);
    // The same model resold by a gateway keeps one display name across groups.
    for (const [directProvider, directId, gatewayProvider, gatewayId] of [
      ["anthropic", "claude-fable-5", "openrouter", "anthropic/claude-fable-5"],
      ["anthropic", "claude-sonnet-5", "openrouter", "anthropic/claude-sonnet-5"],
      ["google", "gemini-3.5-flash-lite", "openrouter", "google/gemini-3.5-flash-lite"],
      ["moonshot", "kimi-k3", "openrouter", "moonshotai/kimi-k3"],
      ["moonshot", "kimi-k2.6", "openrouter", "moonshotai/kimi-k2.6"],
      ["moonshot", "kimi-k2.6", "siliconflow", "Pro/moonshotai/Kimi-K2.6"],
      ["zhipu", "glm-5.1", "openrouter", "z-ai/glm-5.1"],
      ["zhipu", "glm-5.1", "siliconflow", "Pro/zai-org/GLM-5.1"],
    ] as const) {
      expect(
        catalogEntryFor(gatewayProvider, gatewayId)!.displayName,
        `${gatewayProvider}/${gatewayId}`,
      ).toBe(catalogEntryFor(directProvider, directId)!.displayName);
    }
  });

  it("DeepSeek and Kimi are initialized from official CNY prices (stored in USD; x7 recovers the official price)", () => {
    const cnyOf = (usdV: number) => Math.round(usdV * 7 * 1000) / 1000;
    const pro = MODEL_CATALOG.find((m) => m.modelId === "deepseek-v4-pro")!.pricing!;
    expect([cnyOf(pro.cache_read), cnyOf(pro.cache_write), cnyOf(pro.output)]).toEqual([
      0.025, 3, 6,
    ]);
    const k3 = MODEL_CATALOG.find(
      (m) => m.provider === "moonshot" && m.modelId === "kimi-k3",
    )!.pricing!;
    expect([cnyOf(k3.cache_read), cnyOf(k3.cache_write), cnyOf(k3.output)]).toEqual([2, 20, 100]);
    const k26 = MODEL_CATALOG.find((m) => m.modelId === "kimi-k2.6")!.pricing!;
    expect([cnyOf(k26.cache_read), cnyOf(k26.cache_write), cnyOf(k26.output)]).toEqual([
      1.1, 6.5, 27,
    ]);
  });
});

describe("resolveModelEnv (PRN-021: env fallback resolved by AgentHub routing rules)", () => {
  it("first-party provider ids route by substring to the provider client's env var", () => {
    expect(resolveModelEnv("deepseek-v4-pro")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("claude-opus-4-8")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-4-6")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gpt-5.5-pro")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("glm-5.2")?.envKey).toBe("ZAI_API_KEY");
    expect(resolveModelEnv("kimi-k2.6")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    // agenthub 0.4.1 routes these to their own clients; both read the same env pair as the
    // family they belong to, so the id must still resolve (kimi-k3 matches no k2.x substring).
    expect(resolveModelEnv("kimi-k3")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(resolveModelEnv("kimi-k3")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    expect(resolveModelEnv("gemini-3.6-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash-lite")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("claude-fable-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-5")?.envKey).toBe("ANTHROPIC_API_KEY");
  });

  it("explicit client_type beats id: the openai protocol always uses OPENAI_* (independent of grouping)", () => {
    expect(resolveModelEnv("deepseek-v4-pro", "openai")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("zai-org/GLM-5.2", "openai")?.envKey).toBe("OPENAI_API_KEY");
  });

  it("unroutable ids return undefined (AgentHub would reject; needs explicit client_type or an OpenAI-protocol grouping)", () => {
    expect(resolveModelEnv("totally-unknown-model")).toBeUndefined();
    expect(resolveModelEnv("xiaomi/mimo-v2.5")).toBeUndefined();
  });

  it("catalog invariant: entries without client_type route by id with envKey matching the provider; gateway entries resolve to OPENAI_* via client_type", () => {
    for (const m of MODEL_CATALOG) {
      const env = resolveModelEnv(m.modelId, m.clientType);
      expect(env, `${m.provider}/${m.modelId}`).toBeDefined();
      if (m.clientType === undefined) {
        expect(env!.envKey, m.modelId).toBe(providerInfo(m.provider)!.envKey);
      } else {
        expect(env!.envKey, m.modelId).toBe("OPENAI_API_KEY");
      }
    }
  });

  it("modelHomepageUrl: gateway per-model pages, vendor docs fallback, none for custom groups", () => {
    // Gateway URL patterns work for user-added ids in those groups too (not catalog-gated).
    expect(modelHomepageUrl("openrouter", "anthropic/claude-fable-5")).toBe(
      "https://openrouter.ai/anthropic/claude-fable-5",
    );
    expect(modelHomepageUrl("openrouter", "someone/new-model")).toBe(
      "https://openrouter.ai/someone/new-model",
    );
    expect(modelHomepageUrl("qwen-token-plan", "qwen3.7-plus")).toBe(
      "https://www.qianwenai.com/models/qwen3.7-plus",
    );
    // Fireworks maps the accounts/<owner>/models/<slug> API id to its page path; other ids
    // fall back to the models listing.
    expect(modelHomepageUrl("fireworks", "accounts/fireworks/models/glm-5p2")).toBe(
      "https://app.fireworks.ai/models/fireworks/glm-5p2",
    );
    expect(modelHomepageUrl("fireworks", "my-own-id")).toBe("https://app.fireworks.ai/models");
    // Pay-as-you-go resells third-party models under slash-prefixed ids: the id is URL-encoded.
    expect(modelHomepageUrl("qwen-pay-as-you-go", "ZHIPU/GLM-5.2")).toBe(
      "https://www.qianwenai.com/models/ZHIPU%2FGLM-5.2",
    );
    // The preview model has no dedicated page: falls back to the plan's model overview.
    expect(modelHomepageUrl("qwen-token-plan", "qwen3.8-max-preview")).toBe(
      providerInfo("qwen-token-plan")!.modelsUrl,
    );
    // Direct vendors link to the vendor's model docs page.
    expect(modelHomepageUrl("deepseek", "deepseek-v4-pro")).toBe(
      "https://api-docs.deepseek.com/quick_start/pricing",
    );
    // Z.AI and Moonshot have per-model pages (Moonshot drops the dot: kimi-k2.6 -> chat-k26).
    expect(modelHomepageUrl("zhipu", "glm-5.2")).toBe("https://docs.z.ai/guides/llm/glm-5.2");
    expect(modelHomepageUrl("moonshot", "kimi-k2.6")).toBe(
      "https://platform.kimi.com/docs/pricing/chat-k26",
    );
    expect(modelHomepageUrl("moonshot", "kimi-k2.5")).toBe(
      "https://platform.kimi.com/docs/pricing/chat-k25",
    );
    expect(modelHomepageUrl("moonshot", "my-own")).toBe("https://platform.kimi.com/docs/pricing");
    // Custom and user-defined groups have no page to vouch for.
    expect(modelHomepageUrl("custom", "my-model")).toBeUndefined();
    expect(modelHomepageUrl("my-own-gateway", "x")).toBeUndefined();
  });
});
