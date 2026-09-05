/**
 * Built-in model catalog unit tests: unique ids, valid provider references, positive
 * three-bucket pricing, lookups, and preset entry generation.
 */
import { describe, expect, it } from "vitest";
import {
  APP_URL,
  MODEL_CATALOG,
  MODEL_PROVIDERS,
  canonicalClientType,
  modelHomepageUrl,
  catalogEntryFor,
  attributionHeaders,
  effectivePricing,
  offPeakAt,
  DEEPSEEK_OFF_PEAK,
  presetModelEntries,
  providerInfo,
  fastModeProtocol,
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
    // Group order is hand-curated, interleaving gateways and first-party vendors: TokenDance
    // first (the recommended group), DeepSeek next (the default model's provider) and custom
    // always last. This is the page's DEFAULT only — a Project that has reordered its groups
    // stores every key and keeps its own arrangement (web's model-group-order.ts).
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "tokendance",
      "deepseek",
      "openrouter",
      "fireworks",
      "google",
      "openai",
      "anthropic",
      "siliconflow",
      "zhipu",
      "moonshot",
      "minimax",
      "qwen-pay-as-you-go",
      "qwen-token-plan",
      "custom",
    ]);
    // Exactly one group is marked recommended, and it is the one that leads the default
    // order: the caption and the placement are two statements of the same curation.
    expect(MODEL_PROVIDERS.filter((p) => p.recommended).map((p) => p.id)).toEqual(["tokendance"]);
    expect(MODEL_PROVIDERS[0]!.recommended).toBe(true);
    expect(providerInfo("siliconflow")!.label).toBe("SiliconFlow");
    expect(providerInfo("minimax")!.label).toBe("MiniMax");
    expect(providerInfo("minimax")!.envKey).toBe("MINIMAX_API_KEY");
    // The catalog no longer includes GLM-5-Turbo.
    expect(ids).not.toContain("glm-5-turbo");
    // The OpenRouter and SiliconFlow gateway listings of GLM-5.1 were delisted 2026-08-06;
    // the Z.AI direct glm-5.1 remains in the catalog.
    expect(ids).not.toContain("z-ai/glm-5.1");
    expect(ids).not.toContain("Pro/zai-org/GLM-5.1");
    expect(ids).toContain("glm-5.1");
    // Ling 3.0 Flash's free tier was delisted from OpenRouter (removed 2026-08-18).
    expect(ids).not.toContain("inclusionai/ling-3.0-flash:free");
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

  it("TokenDance is the only group publishing a key-minting flow, and both its endpoints are https", () => {
    const withOAuth = MODEL_PROVIDERS.filter((p) => p.oauth !== undefined).map((p) => p.id);
    expect(withOAuth).toEqual(["tokendance"]);
    const oauth = providerInfo("tokendance")!.oauth!;
    expect(oauth.authorizeUrl).toBe("https://tokendance.space/auth");
    expect(oauth.exchangeUrl).toBe("https://tokendance.space/portal/api/v1/auth/keys");
    // The key's name is also the app name the authorization page shows.
    expect(oauth.keyName).toBe("PenguinHarness");
  });

  it("the app URL a minted key is stamped with is the same one attribution headers carry", () => {
    expect(APP_URL).toBe("https://penguin.ooo/");
    expect(attributionHeaders("https://tokendance.space/gateway/v1")).toEqual({
      "X-App-URL": APP_URL,
    });
  });

  it("every entry has valid three-bucket pricing; context_window is a positive integer", () => {
    for (const m of MODEL_CATALOG) {
      if (m.modelId.endsWith(":free") || m.modelId === "openrouter/free") {
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
      expect(Number.isInteger(m.contextWindow)).toBe(true);
      expect(m.contextWindow!).toBeGreaterThan(0);
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
    // and the catalog never offers to pick one (`glm-5.2`, `deepseek-v4-pro`, `qwen3.8-max`,
    // `qwen3.7-plus` and `deepseek-v4-flash-0731` each appear under two groups).
    expect(catalogEntryFor("anthropic", "claude-sonnet-4-6")?.displayName).toBe(
      "Claude Sonnet 4.6",
    );
    expect(catalogEntryFor("openai", "claude-sonnet-4-6")).toBeUndefined();
    // The upstream id itself may contain / (gateway models); it is never split apart.
    expect(catalogEntryFor("openrouter", "xiaomi/mimo-v2.5")?.displayName).toBe("MiMo-V2.5");
    expect(catalogEntryFor("custom", "my-own")).toBeUndefined();
    // Each group's entry for a resold id is reached only through that group.
    expect(catalogEntryFor("qwen-token-plan", "qwen3.8-max")?.provider).toBe("qwen-token-plan");
    expect(catalogEntryFor("qwen-pay-as-you-go", "qwen3.8-max")?.provider).toBe(
      "qwen-pay-as-you-go",
    );
    // The bare resold id never leaks into the vendor's own group (deepseek's flash revision is
    // sold there as deepseek-v4-flash, without the date suffix).
    expect(catalogEntryFor("deepseek", "deepseek-v4-flash-0731")).toBeUndefined();
    expect(catalogEntryFor("deepseek", "deepseek-v4-flash")?.provider).toBe("deepseek");
    expect(catalogEntryFor("zhipu", "glm-5.2")?.contextWindow).toBe(1000000);
    expect(catalogEntryFor("qwen-token-plan", "glm-5.2")?.contextWindow).toBe(1048576);
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro")?.provider).toBe("deepseek");
    // The vision revision is a model of its own in both the direct group and on OpenRouter,
    // and it is the only vision-capable DeepSeek row in either.
    expect(catalogEntryFor("deepseek", "deepseek-v4-flash-vision-exp")?.supportsVision).toBe(true);
    expect(
      catalogEntryFor("openrouter", "deepseek/deepseek-v4-flash-vision-exp")?.supportsVision,
    ).toBe(true);
    expect(catalogEntryFor("deepseek", "deepseek-v4-flash")?.supportsVision).toBe(false);
    expect(catalogEntryFor("qwen-token-plan", "deepseek-v4-pro")?.provider).toBe("qwen-token-plan");
    expect(catalogEntryFor("minimax", "MiniMax-M3")?.displayName).toBe("MiniMax M3");
  });

  it("presetModelEntries: provider and bare upstream model_id are separate fields; preset endpoints are inlined", () => {
    const entries = presetModelEntries();
    expect(entries).toHaveLength(MODEL_CATALOG.length);
    for (const [i, entry] of entries.entries()) {
      const cat = MODEL_CATALOG[i]!;
      expect(entry.provider).toBe(cat.provider);
      expect(entry.model_id).toBe(cat.modelId);
      expect(entry.context_window).toBe(cat.contextWindow);
      // A Project stores the BILLED rate, not the catalog's list price: the cost center
      // prices only against what is written here, so a promoted row must arrive discounted.
      // The exception is a row on a peak/off-peak schedule, which stores the PEAK price: the
      // rate changes twice a day, so baking one in would make the number on disk depend on the
      // hour the Project happened to be created or re-synced in.
      expect(entry.pricing, entry.model_id).toEqual(
        cat.offPeakDiscount !== undefined ? cat.pricing : effectivePricing(cat),
      );
      expect(entry.vision).toBe(cat.supportsVision ? undefined : false);
      // Gateway and direct MiniMax presets pin a client protocol; other direct models auto-route.
      expect(entry.client_type).toBe(cat.clientType);
      // Gateway and direct MiniMax models inline a preset base URL; no entry carries credentials.
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
      "anthropic/claude-opus-5",
      "anthropic/claude-opus-4.8",
      "anthropic/claude-opus-4.7",
      "anthropic/claude-sonnet-5",
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-flash-vision-exp",
      "deepseek/deepseek-v4-pro-0813",
      "deepseek/deepseek-v4-pro",
      "google/gemini-3.7-flash",
      "google/gemini-3.6-flash",
      "google/gemini-3.5-flash",
      "google/gemini-3.5-flash-lite",
      "minimax/minimax-m3",
      "moonshotai/kimi-k3",
      "moonshotai/kimi-k2.6",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.5",
      "openai/gpt-5.5-pro",
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.4-pro",
      "openrouter/free",
      "qwen/qwen3.8-max",
      "qwen/qwen3.6-35b-a3b",
      "stepfun/step-3.7-flash",
      "tencent/hy4-preview",
      "tencent/hy3",
      "thinkingmachines/inkling",
      "x-ai/grok-4.6",
      "x-ai/grok-4.5",
      "xiaomi/mimo-v2.5",
      "z-ai/glm-5.3",
      "z-ai/glm-5.3-flash",
      "z-ai/glm-5.2",
    ]);
    for (const m of or) {
      // Every gateway row pins a client type — never left to AgentHub's id-substring routing,
      // which would send openai/gpt-5.6-* to the first-party GPT client and throw outright on
      // the dotted anthropic/claude-opus-4.8. The openai/* rows speak the Responses protocol
      // (OpenRouter serves it at {base}/responses); everything else is Chat Completions.
      expect(m.clientType, m.modelId).toBe(
        m.modelId.startsWith("openai/") ? "openai-responses" : "openai-chat",
      );
      expect(m.baseUrl).toBe("https://openrouter.ai/api/v1");
    }
    // Both protocols read the same OPENAI_* pair, so the env-fallback hint is unaffected by
    // the split.
    for (const m of or) {
      expect(resolveModelEnv(m.modelId, m.clientType)?.envKey, m.modelId).toBe("OPENAI_API_KEY");
    }
    const fw = MODEL_CATALOG.filter((m) => m.provider === "fireworks");
    expect(fw.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["accounts/fireworks/models/deepseek-v4-flash-0731", false],
      ["accounts/fireworks/models/deepseek-v4-flash", false],
      ["accounts/fireworks/models/deepseek-v4-pro", false],
      ["accounts/fireworks/models/glm-5p2", false],
      ["accounts/fireworks/models/inkling", true],
      ["accounts/fireworks/models/kimi-k3", true],
      ["accounts/fireworks/models/kimi-k2p7-code", true],
      ["accounts/fireworks/models/minimax-m3", true],
    ]);
    for (const m of fw) {
      expect(m.clientType).toBe("openai-chat");
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
      "Qwen/Qwen3.6-35B-A3B",
      "zai-org/GLM-5.2",
    ]);
    for (const m of sf) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://api.siliconflow.cn/v1");
    }
    const qtp = MODEL_CATALOG.filter((m) => m.provider === "qwen-token-plan");
    expect(qtp.map((m) => m.modelId)).toEqual([
      "deepseek-v4-flash-0731",
      "deepseek-v4-pro",
      "glm-5.2",
      "qwen3.8-max",
      "qwen3.7-plus",
    ]);
    for (const m of qtp) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    }
    // Vision flags per the plan's supported-model table: 3.8-max and 3.7-plus see images.
    expect(qtp.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["deepseek-v4-flash-0731", false],
      ["deepseek-v4-pro", false],
      ["glm-5.2", false],
      ["qwen3.8-max", true],
      ["qwen3.7-plus", true],
    ]);
    const td = MODEL_CATALOG.filter((m) => m.provider === "tokendance");
    // Dictionary order by upstream id; vision flags and context windows from TokenDance's
    // public catalog API.
    expect(td.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["deepseek-v4-flash-0731", 1048576, false],
      ["deepseek-v4-flash-vision-exp", 1000000, true],
      ["deepseek-v4-pro-0813", 1000000, false],
      ["glm-5.3", 1000000, false],
      ["glm-5.3-flash", 1000000, true],
      ["hy4-preview", 1024000, false],
      ["kimi-k3", 1048576, true],
      ["qwen3.8-flash", 1000000, true],
      ["qwen3.8-max", 1000000, true],
      ["seed-2.1-pro", 256000, true],
      ["seed-2.1-turbo", 256000, true],
      ["seed-evolving", 256000, true],
    ]);
    for (const m of td) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://tokendance.space/gateway/v1");
    }
    // The gateway's own CNY LIST rates throughout, promotion or not; a promoted row carries
    // its rate in `discount` and the billed price is DERIVED from the two, never pasted
    // beside them. Reading the CNY prices back out of effectivePricing is what pins that:
    // change a list price or a discount alone and the recovered rate stops matching what
    // TokenDance publishes. cache_write carries the input price (no separate cache-write fee
    // on this gateway), so the published input / output / cache-hit triple is NOT in the
    // catalog's cny(cacheRead, cacheWrite, output) argument order.
    const CNY_PER_USD = 7;
    const billedCny = (modelId: string): [number, number, number] => {
      const billed = effectivePricing(td.find((m) => m.modelId === modelId)!)!;
      // input, output, cache hit — the order TokenDance's own price list uses.
      return [
        billed.cache_write * CNY_PER_USD,
        billed.output * CNY_PER_USD,
        billed.cache_read * CNY_PER_USD,
      ];
    };
    const discounted: Array<[string, number, [number, number, number]]> = [
      ["glm-5.3-flash", 0.5, [0.4, 1.4, 0.115]],
      ["glm-5.3", 0.1, [7.2, 25.2, 1.8]],
      ["deepseek-v4-pro-0813", 0.5, [4.5, 13.5, 0.15]],
      ["deepseek-v4-flash-0731", 0.5, [1.5, 4.5, 0.05]],
      ["kimi-k3", 0.2, [16, 80, 1.6]],
      ["qwen3.8-max", 0.1, [10.8, 32.4, 1.35]],
      ["seed-2.1-pro", 0.5, [3, 15, 0.6]],
      ["seed-2.1-turbo", 0.5, [1.5, 7.5, 0.3]],
      ["seed-evolving", 0.5, [3, 15, 0.6]],
    ];
    for (const [modelId, discount, cnyBilled] of discounted) {
      const entry = td.find((m) => m.modelId === modelId)!;
      expect(entry.discount, modelId).toBe(discount);
      const [input, output, cacheHit] = billedCny(modelId);
      expect(input, `${modelId} input`).toBeCloseTo(cnyBilled[0], 4);
      expect(output, `${modelId} output`).toBeCloseTo(cnyBilled[1], 4);
      expect(cacheHit, `${modelId} cache hit`).toBeCloseTo(cnyBilled[2], 4);
    }
    // Exactly those nine are promoted; every other row bills its list price unchanged.
    expect(
      td
        .filter((m) => m.discount !== undefined)
        .map((m) => m.modelId)
        .sort(),
    ).toEqual(discounted.map(([id]) => id).sort());
    for (const m of td.filter((x) => x.discount === undefined)) {
      expect(effectivePricing(m), m.modelId).toEqual(m.pricing);
    }
    // The stored list prices themselves, in the catalog's own argument order.
    const tdQwen = td.find((m) => m.modelId === "qwen3.8-max")!.pricing!;
    expect([tdQwen.cache_read, tdQwen.cache_write, tdQwen.output]).toEqual([
      0.214286, 1.714286, 5.142857,
    ]);
    const tdFlash = td.find((m) => m.modelId === "glm-5.3-flash")!.pricing!;
    expect([tdFlash.cache_read, tdFlash.cache_write, tdFlash.output]).toEqual([
      0.032857, 0.114286, 0.4,
    ]);
    // qwen3.8-flash at 0.1 / 0.8 / 2.7 CNY, undiscounted. The same id also sits in the
    // qwen-pay-as-you-go group at Qwen's own 0.1 / 1 / 3, and the pair is the point: one
    // model reached two ways, priced by whoever is selling it, so the two rows must not
    // silently converge.
    const tdQwenFlash = td.find((m) => m.modelId === "qwen3.8-flash")!.pricing!;
    expect([tdQwenFlash.cache_read, tdQwenFlash.cache_write, tdQwenFlash.output]).toEqual([
      0.014286, 0.114286, 0.385714,
    ]);
    const payggFlash = MODEL_CATALOG.find(
      (m) => m.provider === "qwen-pay-as-you-go" && m.modelId === "qwen3.8-flash",
    )!.pricing!;
    expect(payggFlash.cache_write).toBeGreaterThan(tdQwenFlash.cache_write);
    expect(payggFlash.output).toBeGreaterThan(tdQwenFlash.output);
    expect(payggFlash.cache_read).toEqual(tdQwenFlash.cache_read);
    // hy4-preview is the same upstream model as OpenRouter's tencent/hy4-preview, sold twice.
    // Same rule as the qwen3.8-flash pair: each row carries its own seller's price and its own
    // published context window, so the two must stay apart rather than converge on one number.
    const tdHy4 = td.find((m) => m.modelId === "hy4-preview")!;
    expect(tdHy4.discount).toBeUndefined();
    expect(billedCny("hy4-preview")[0]).toBeCloseTo(6, 4);
    expect(billedCny("hy4-preview")[1]).toBeCloseTo(18, 4);
    expect(billedCny("hy4-preview")[2]).toBeCloseTo(0.3, 4);
    const orHy4 = catalogEntryFor("openrouter", "tencent/hy4-preview")!;
    expect([orHy4.pricing!.cache_read, orHy4.pricing!.cache_write, orHy4.pricing!.output]).toEqual([
      0.042, 0.834, 2.501,
    ]);
    expect(tdHy4.pricing!.cache_write).toBeGreaterThan(orHy4.pricing!.cache_write);
    expect(tdHy4.pricing!.output).toBeGreaterThan(orHy4.pricing!.output);
    expect(tdHy4.pricing!.cache_read).toBeGreaterThan(orHy4.pricing!.cache_read);
    expect(tdHy4.contextWindow).not.toBe(orHy4.contextWindow);
    // Text-only on both sellers, and neither is on a promotion.
    expect([tdHy4.supportsVision, orHy4.supportsVision]).toEqual([false, false]);
    expect(orHy4.discount).toBeUndefined();
    const qpayg = MODEL_CATALOG.filter((m) => m.provider === "qwen-pay-as-you-go");
    expect(qpayg.map((m) => [m.modelId, m.supportsVision])).toEqual([
      ["deepseek-v4-flash-0731", false],
      ["kimi/kimi-k3", true],
      ["qwen3.8-flash", true],
      ["qwen3.8-max", true],
      ["qwen3.7-plus", true],
      ["ZHIPU/GLM-5.2", false],
    ]);
    for (const m of qpayg) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    }
    const minimax = MODEL_CATALOG.filter((m) => m.provider === "minimax");
    expect(
      minimax.map((m) => [
        m.modelId,
        m.contextWindow,
        m.supportsVision,
        m.clientType,
        m.baseUrl,
        m.pricing,
      ]),
    ).toEqual([
      [
        "MiniMax-M3",
        1000000,
        true,
        "minimax-m3",
        "https://api.minimax.io/v1",
        // Standard tier at <=512K input: cache read 0.06, input 0.30, output 1.20 USD/Mtok.
        { unit: "usd_per_mtok", cache_read: 0.06, cache_write: 0.3, output: 1.2 },
      ],
    ]);
    expect(providerInfo("minimax")!.envBaseUrlKey).toBe("MINIMAX_BASE_URL");
    expect(providerInfo("minimax")!.gatewayBaseUrl).toBeUndefined();
    // Routed through AgentHub's OpenAI client -> when the credential is left blank it reads OPENAI_API_KEY (not the provider's own env var name).
    for (const id of [
      "openrouter",
      "fireworks",
      "siliconflow",
      "tokendance",
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
    expect(providerInfo("tokendance")!.gatewayBaseUrl).toBe("https://tokendance.space/gateway/v1");
    const GATEWAYS = [
      "openrouter",
      "fireworks",
      "siliconflow",
      "tokendance",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
    ];
    for (const p of MODEL_PROVIDERS) {
      if (!GATEWAYS.includes(p.id)) {
        expect(p.gatewayBaseUrl, p.id).toBeUndefined();
      }
    }
    const gateway = [...or, ...fw, ...sf, ...td, ...qtp, ...qpayg];
    // Pricing (USD, per the 2026-08-03 models-API re-read): MiMo v2.5 and Hy3 publish a real
    // cache-hit price and no per-token write premium, so cache_write carries the input price.
    const mimo = MODEL_CATALOG.find((m) => m.modelId === "xiaomi/mimo-v2.5")!.pricing!;
    expect([mimo.cache_read, mimo.cache_write, mimo.output]).toEqual([0.0028, 0.14, 0.28]);
    const hy3 = MODEL_CATALOG.find((m) => m.modelId === "tencent/hy3")!.pricing!;
    expect([hy3.cache_read, hy3.cache_write, hy3.output]).toEqual([0.033, 0.132, 0.528]);
    // Anthropic/GPT rows publish a genuine 1.25x per-token cache-write premium; it is stored
    // as-is (cache_write > input would be wrong to collapse back to input).
    const sonnet5 = catalogEntryFor("openrouter", "anthropic/claude-sonnet-5")!.pricing!;
    expect([sonnet5.cache_read, sonnet5.cache_write, sonnet5.output]).toEqual([0.2, 2.5, 10]);
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

    // In preset entries, every gateway model and the direct MiniMax client inline base_url (no credentials).
    const withBaseUrl = presetModelEntries().filter((e) => e.base_url !== undefined);
    expect(withBaseUrl.map((e) => [e.provider, e.model_id]).sort()).toEqual(
      [...gateway, ...minimax].map((m) => [m.provider, m.modelId]).sort(),
    );
  });

  it("direct-vendor groups: auto-routed (no client_type / base_url), newest series first", () => {
    // These groups' ids are auto-routed by AgentHub, so they carry neither client_type nor a
    // preset base URL — the opposite of the gateway groups above.
    for (const id of ["google", "anthropic", "zhipu", "moonshot"]) {
      for (const m of MODEL_CATALOG.filter((e) => e.provider === id)) {
        expect(m.clientType, m.modelId).toBeUndefined();
        expect(m.baseUrl, m.modelId).toBeUndefined();
      }
    }
    // Dictionary order by tier with newer versions of a tier first (same rule the OpenRouter
    // block follows for the identical Claude line-up).
    expect(MODEL_CATALOG.filter((m) => m.provider === "google").map((m) => m.modelId)).toEqual([
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
    ]);
    expect(MODEL_CATALOG.filter((m) => m.provider === "zhipu").map((m) => m.modelId)).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.2",
      "glm-5.1",
      "glm-5",
    ]);
    // Gemini 3.7 Flash: the direct row stores Google's official list price (the launch
    // discount that halves it through 2026-12-31 is not stored, matching the catalog's
    // no-promotions policy), while the OpenRouter row stores what the gateway actually
    // bills — a `discount: 0.75` off that same list price, i.e. a quarter of it.
    const g37 = catalogEntryFor("google", "gemini-3.7-flash")!;
    expect([g37.contextWindow, g37.supportsVision]).toEqual([1048576, true]);
    expect([g37.pricing!.cache_read, g37.pricing!.cache_write, g37.pricing!.output]).toEqual([
      0.15, 1.5, 7.5,
    ]);
    const g37or = catalogEntryFor("openrouter", "google/gemini-3.7-flash")!;
    expect([g37or.contextWindow, g37or.supportsVision]).toEqual([1048576, true]);
    expect([g37or.pricing!.cache_read, g37or.pricing!.cache_write, g37or.pricing!.output]).toEqual([
      0.0375, 0.375, 1.875,
    ]);
    // GLM-5.3 is listed both directly and on OpenRouter; the gateway runs no discount, so
    // the two rows agree on price and differ only in context window and protocol pin.
    const glm53or = catalogEntryFor("openrouter", "z-ai/glm-5.3")!;
    expect([glm53or.contextWindow, glm53or.supportsVision]).toEqual([1048576, false]);
    expect([
      glm53or.pricing!.cache_read,
      glm53or.pricing!.cache_write,
      glm53or.pricing!.output,
    ]).toEqual([0.26, 1.4, 4.4]);
    // GLM-5.3 (AgentHub 0.4.2's unified GLM client): text-only, 1M context, and Z.AI's
    // published USD price — identical to glm-5.2.
    const glm53 = catalogEntryFor("zhipu", "glm-5.3")!;
    expect([glm53.contextWindow, glm53.supportsVision]).toEqual([1000000, false]);
    expect(glm53.pricing).toEqual(catalogEntryFor("zhipu", "glm-5.2")!.pricing);
    // GLM-5.3 Flash is listed both directly and on OpenRouter, and the two rows deliberately
    // disagree on price: the direct row keeps Z.AI's list price while the gateway row stores
    // the 50%-off rate OpenRouter actually bills through 2026-09-09, so the gateway figures
    // are exactly half the direct ones.
    const glm53f = catalogEntryFor("zhipu", "glm-5.3-flash")!;
    expect([glm53f.contextWindow, glm53f.supportsVision]).toEqual([1000000, true]);
    expect([
      glm53f.pricing!.cache_read,
      glm53f.pricing!.cache_write,
      glm53f.pricing!.output,
    ]).toEqual([0.03, 0.15, 0.5]);
    const glm53for = catalogEntryFor("openrouter", "z-ai/glm-5.3-flash")!;
    expect([glm53for.contextWindow, glm53for.supportsVision]).toEqual([1048576, true]);
    expect([
      glm53for.pricing!.cache_read,
      glm53for.pricing!.cache_write,
      glm53for.pricing!.output,
    ]).toEqual([0.015, 0.075, 0.25]);
    // Vision agrees on both routes: the direct row's AgentHub GLM client forwards image_url
    // parts for this one id, and the gateway row's generic openai-chat client carries them
    // for any id. It is the only vision-capable row in the direct Z.AI group.
    expect(glm53f.clientType).toBeUndefined();
    expect(glm53for.clientType).toBe("openai-chat");
    for (const m of MODEL_CATALOG.filter((m) => m.provider === "zhipu")) {
      expect(m.supportsVision, m.modelId).toBe(m.modelId === "glm-5.3-flash");
    }
    // Both rows share one display name, as the other dual-listed models do.
    expect(glm53f.displayName).toBe("GLM-5.3 Flash");
    expect(glm53for.displayName).toBe("GLM-5.3 Flash");
    // Qwen 3.8 Flash: official CNY list price (1 / 0.1 / 3 per MTok) at the catalog's 7:1
    // display rate, 1M context, vision through the group's openai-chat client.
    const q38f = catalogEntryFor("qwen-pay-as-you-go", "qwen3.8-flash")!;
    expect([q38f.contextWindow, q38f.supportsVision, q38f.displayName]).toEqual([
      1000000,
      true,
      "Qwen 3.8 Flash",
    ]);
    expect([q38f.pricing!.cache_read, q38f.pricing!.cache_write, q38f.pricing!.output]).toEqual([
      0.014286, 0.142857, 0.428571,
    ]);
    // Grok 4.6 keeps Grok 4.5's input/output rates with a raised cache-hit price.
    const grok46 = catalogEntryFor("openrouter", "x-ai/grok-4.6")!;
    expect([grok46.contextWindow, grok46.supportsVision]).toEqual([500000, true]);
    expect([
      grok46.pricing!.cache_read,
      grok46.pricing!.cache_write,
      grok46.pricing!.output,
    ]).toEqual([0.5, 2, 6]);
    expect(MODEL_CATALOG.filter((m) => m.provider === "anthropic").map((m) => m.modelId)).toEqual([
      "claude-fable-5",
      "claude-opus-5",
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
    // Opus 5 sits at the Opus tier ($5 input -> 6.25 cache write, $0.50 cache hit, $25
    // output) and carries the same 1M window and vision support as its gateway twin.
    const opus5 = catalogEntryFor("anthropic", "claude-opus-5")!;
    expect([opus5.contextWindow, opus5.supportsVision]).toEqual([1000000, true]);
    expect([opus5.pricing!.cache_read, opus5.pricing!.cache_write, opus5.pricing!.output]).toEqual([
      0.5, 6.25, 25,
    ]);
    // Sonnet 5 prices below Sonnet 4.6 because that is Anthropic's list, not a slip.
    expect(catalogEntryFor("anthropic", "claude-sonnet-4-6")!.pricing).toEqual({
      unit: "usd_per_mtok",
      cache_read: 0.3,
      cache_write: 3.75,
      output: 15,
    });
    // The same model resold by a gateway keeps one display name across groups. The bare
    // `gpt-5.6` id is the same tier OpenRouter spells `openai/gpt-5.6-sol`, so it displays
    // that codename too rather than leaving the variant unnamed.
    for (const [directProvider, directId, gatewayProvider, gatewayId] of [
      ["openai", "gpt-5.6", "openrouter", "openai/gpt-5.6-sol"],
      ["openai", "gpt-5.6-luna", "openrouter", "openai/gpt-5.6-luna"],
      ["openai", "gpt-5.6-terra", "openrouter", "openai/gpt-5.6-terra"],
      ["anthropic", "claude-fable-5", "openrouter", "anthropic/claude-fable-5"],
      ["anthropic", "claude-opus-5", "openrouter", "anthropic/claude-opus-5"],
      ["anthropic", "claude-sonnet-5", "openrouter", "anthropic/claude-sonnet-5"],
      ["google", "gemini-3.5-flash-lite", "openrouter", "google/gemini-3.5-flash-lite"],
      ["moonshot", "kimi-k3", "openrouter", "moonshotai/kimi-k3"],
      ["moonshot", "kimi-k2.6", "openrouter", "moonshotai/kimi-k2.6"],
      ["moonshot", "kimi-k2.6", "siliconflow", "Pro/moonshotai/Kimi-K2.6"],
    ] as const) {
      expect(
        catalogEntryFor(gatewayProvider, gatewayId)!.displayName,
        `${gatewayProvider}/${gatewayId}`,
      ).toBe(catalogEntryFor(directProvider, directId)!.displayName);
    }
    // Inkling has no direct-vendor group (Thinking Machines Lab is gateway-only); its two
    // gateway listings still share one display name, with the vendor prefix stripped.
    expect(catalogEntryFor("openrouter", "thinkingmachines/inkling")!.displayName).toBe("Inkling");
    expect(catalogEntryFor("fireworks", "accounts/fireworks/models/inkling")!.displayName).toBe(
      "Inkling",
    );
  });

  it("DeepSeek and Kimi are initialized from official CNY prices (stored in USD; x7 recovers the official price)", () => {
    const cnyOf = (usdV: number) => Math.round(usdV * 7 * 1000) / 1000;
    // DeepSeek rows carry the official PEAK tier — re-read 2026-08-18 after the official price
    // increase introduced time-based tiers. The off-peak tier is exactly half, and is applied
    // from the row's schedule rather than stored (see the off-peak schedules block below).
    const flash = catalogEntryFor("deepseek", "deepseek-v4-flash")!.pricing!;
    expect([cnyOf(flash.cache_read), cnyOf(flash.cache_write), cnyOf(flash.output)]).toEqual([
      0.1, 3, 9,
    ]);
    const pro = catalogEntryFor("deepseek", "deepseek-v4-pro")!.pricing!;
    expect([cnyOf(pro.cache_read), cnyOf(pro.cache_write), cnyOf(pro.output)]).toEqual([
      0.3, 9, 27,
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

  it("OpenRouter DeepSeek rows carry the gateway's own 2026-08-18 prices (the 0813 GA release bills the official USD list)", () => {
    const pro0813 = catalogEntryFor("openrouter", "deepseek/deepseek-v4-pro-0813")!;
    expect([pro0813.contextWindow, pro0813.supportsVision]).toEqual([1048576, false]);
    expect([
      pro0813.pricing!.cache_read,
      pro0813.pricing!.cache_write,
      pro0813.pricing!.output,
    ]).toEqual([0.022, 0.66, 1.98]);
    // The undated pro listing routes to the same officially priced endpoints.
    const pro = catalogEntryFor("openrouter", "deepseek/deepseek-v4-pro")!.pricing!;
    expect([pro.cache_read, pro.cache_write, pro.output]).toEqual([0.022, 0.66, 1.98]);
    const flash = catalogEntryFor("openrouter", "deepseek/deepseek-v4-flash")!.pricing!;
    expect([flash.cache_read, flash.cache_write, flash.output]).toEqual([0.0168, 0.0679, 0.168]);
    const flash0731 = catalogEntryFor("openrouter", "deepseek/deepseek-v4-flash-0731")!.pricing!;
    expect([flash0731.cache_read, flash0731.cache_write, flash0731.output]).toEqual([
      0.0157192, 0.078596, 0.157192,
    ]);
  });

  it("the OpenAI line-up is listed both directly and on OpenRouter, and only the gateway rows speak Responses", () => {
    // Every direct OpenAI model has an OpenRouter counterpart and vice versa: `openai/<id>`
    // is exactly the gateway spelling, so the two groups must stay in lockstep when either
    // gains a model.
    const direct = MODEL_CATALOG.filter((m) => m.provider === "openai").map((m) => m.modelId);
    expect(direct).toEqual([
      "gpt-5.6",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.4-pro",
    ]);
    const gateway = MODEL_CATALOG.filter(
      (m) => m.provider === "openrouter" && m.modelId.startsWith("openai/"),
    ).map((m) => m.modelId);
    // The bare `gpt-5.6` alias has no gateway listing of its own — OpenRouter spells that
    // tier out as `openai/gpt-5.6-sol`, which is what the alias resolves to upstream.
    expect([...gateway].sort()).toEqual(
      [...direct.map((id) => (id === "gpt-5.6" ? "openai/gpt-5.6-sol" : `openai/${id}`))].sort(),
    );
    // Because it is that tier, the alias is labelled with the sol codename its siblings and
    // its gateway listing carry; the id users send stays bare.
    expect(catalogEntryFor("openai", "gpt-5.6")!.displayName).toBe("GPT-5.6 Sol");
    // Direct rows are auto-routed by id (AgentHub 0.4.2's native gpt-5.6 client); only the
    // gateway rows pin a protocol, and they pin Responses.
    for (const m of MODEL_CATALOG.filter((m) => m.provider === "openai")) {
      expect(m.clientType, m.modelId).toBeUndefined();
      expect(m.baseUrl, m.modelId).toBeUndefined();
      expect(m.supportsVision, m.modelId).toBe(true);
    }
    // Direct rows carry OpenAI's list price; the two 5.6 tiers below sol were re-read from
    // OpenRouter's undiscounted OpenAI/Azure endpoints, which agree with the list.
    const price = (provider: string, id: string): number[] => {
      const p = catalogEntryFor(provider, id)!.pricing!;
      return [p.cache_read, p.cache_write, p.output];
    };
    expect(price("openai", "gpt-5.6")).toEqual([0.5, 5, 30]);
    expect(price("openai", "gpt-5.6-terra")).toEqual([0.2, 2, 12]);
    expect(price("openai", "gpt-5.6-luna")).toEqual([0.02, 0.2, 1.2]);
    // Gateway rows store what OpenRouter bills, so they diverge from the list price wherever
    // a promotion is running: sol is at `discount: 0.5`, terra and luna are back at full rate
    // after theirs lapsed (the 2x drift this re-read corrected).
    expect(price("openrouter", "openai/gpt-5.6-sol")).toEqual([0.25, 3.125, 15]);
    expect(price("openrouter", "openai/gpt-5.6-terra")).toEqual([0.2, 2.5, 12]);
    expect(price("openrouter", "openai/gpt-5.6-luna")).toEqual([0.02, 0.25, 1.2]);
    // The 5.4/5.5 rows run no promotion, so gateway and direct agree except on cache_write,
    // where the gateway publishes GPT's genuine 1.25x write premium and the direct rows use
    // the standard input price.
    for (const id of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]) {
      const [dr, , dOut] = price("openai", id);
      const [gr, , gOut] = price("openrouter", `openai/${id}`);
      expect([gr, gOut], id).toEqual([dr, dOut]);
    }
    // The Pro tiers publish no cache discount at all, so cache_read carries the input price.
    for (const p of [price("openai", "gpt-5.5-pro"), price("openrouter", "openai/gpt-5.5-pro")]) {
      expect(p).toEqual([30, 30, 180]);
    }
    expect(price("openrouter", "openai/gpt-5.4-pro")).toEqual([30, 30, 180]);
    // Context windows match OpenRouter's published values and the direct rows.
    expect(catalogEntryFor("openrouter", "openai/gpt-5.4-mini")!.contextWindow).toBe(400000);
    expect(catalogEntryFor("openrouter", "openai/gpt-5.5")!.contextWindow).toBe(1050000);
  });

  it("canonicalClientType: the deprecated bare openai alias converges on openai-chat; everything else passes through", () => {
    expect(canonicalClientType("openai")).toBe("openai-chat");
    // Case/whitespace-insensitive match (AgentHub lowercases client types before routing).
    expect(canonicalClientType(" OpenAI ")).toBe("openai-chat");
    expect(canonicalClientType("openai-chat")).toBe("openai-chat");
    // Other client types containing "openai" are different protocols and must pass through.
    expect(canonicalClientType("openai-responses")).toBe("openai-responses");
    expect(canonicalClientType("openai-embedding")).toBe("openai-embedding");
    expect(canonicalClientType("ant-messages")).toBe("ant-messages");
    expect(canonicalClientType("minimax-m3")).toBe("minimax-m3");
    expect(canonicalClientType(undefined)).toBeUndefined();
  });
});

describe("resolveModelEnv (PRN-021: env fallback resolved by AgentHub routing rules)", () => {
  it("first-party model ids route to the provider client's env var", () => {
    expect(resolveModelEnv("deepseek-v4-pro")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("claude-opus-4-8")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-4-6")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gpt-5.5-pro")?.envKey).toBe("OPENAI_API_KEY");
    // The GPT-5.6 generation (agenthub 0.4.2) reads the same OPENAI_* pair.
    expect(resolveModelEnv("gpt-5.6-luna")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("glm-5.2")?.envKey).toBe("ZAI_API_KEY");
    // glm-5.3 is served by agenthub 0.4.2's unified GLM client (same ZAI_* pair).
    expect(resolveModelEnv("glm-5.3")?.envKey).toBe("ZAI_API_KEY");
    // glm-5.3-flash carries the glm-5 substring, so it reaches the same client and pair.
    expect(resolveModelEnv("glm-5.3-flash")?.envKey).toBe("ZAI_API_KEY");
    expect(resolveModelEnv("glm-5.3-flash")?.envBaseUrlKey).toBe("ZAI_BASE_URL");
    expect(resolveModelEnv("kimi-k2.6")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    // agenthub 0.4.2 unified the Kimi clients; every spelling reads the same env pair
    // (kimi-k3 matches no k2.x substring, so it must resolve on its own).
    expect(resolveModelEnv("kimi-k3")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(resolveModelEnv("kimi-k3")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    expect(resolveModelEnv("gemini-3.6-flash")?.envKey).toBe("GEMINI_API_KEY");
    // The Gemini 3.7 generation is served by the same unified client (gemini-3 substring).
    expect(resolveModelEnv("gemini-3.7-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash-lite")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("claude-fable-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-opus-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("MiniMax-M3")?.envKey).toBe("MINIMAX_API_KEY");
    expect(resolveModelEnv("MiniMax-M3")?.envBaseUrlKey).toBe("MINIMAX_BASE_URL");
  });

  it("explicit client_type selects the protocol, while model-scoped clients still validate the id", () => {
    expect(resolveModelEnv("deepseek-v4-pro", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("zai-org/GLM-5.2", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    // The deprecated bare "openai" alias (pre-0.4.2 configs) still resolves the same pair.
    expect(resolveModelEnv("deepseek-v4-pro", "openai")?.envKey).toBe("OPENAI_API_KEY");
    // agenthub 0.4.2's generic protocol clients: openai-responses reads OPENAI_*,
    // ant-messages reads ANTHROPIC_* (matching the client implementations).
    expect(resolveModelEnv("deepseek-v4-pro", "openai-responses")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("deepseek-v4-pro", "ant-messages")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("deepseek-v4-pro", "ant-messages")?.envBaseUrlKey).toBe(
      "ANTHROPIC_BASE_URL",
    );
    expect(resolveModelEnv("MiniMax-M3", "minimax-m3")?.envBaseUrlKey).toBe("MINIMAX_BASE_URL");
    expect(resolveModelEnv("custom-model", "minimax-m3")).toBeUndefined();
  });

  it("generic protocol client types (agenthub 0.4.2) resolve regardless of the model id: ant-messages reads ANTHROPIC_*, openai-responses / openai-chat read OPENAI_*", () => {
    expect(resolveModelEnv("any-model", "ant-messages")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("any-model", "ant-messages")?.envBaseUrlKey).toBe("ANTHROPIC_BASE_URL");
    expect(resolveModelEnv("any-model", "openai-responses")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("any-model", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("any-model", "openai-chat")?.envBaseUrlKey).toBe("OPENAI_BASE_URL");
  });

  it("unroutable ids return undefined (AgentHub would reject; needs explicit client_type or an OpenAI-protocol grouping)", () => {
    expect(resolveModelEnv("totally-unknown-model")).toBeUndefined();
    expect(resolveModelEnv("xiaomi/mimo-v2.5")).toBeUndefined();
    expect(resolveModelEnv("minimax-m3-preview")).toBeUndefined();
    expect(resolveModelEnv("MiniMax-M4")).toBeUndefined();
    expect(resolveModelEnv("MiniMax-M4", "minimax-m3")).toBeUndefined();
  });

  it("catalog invariant: each model's resolved client uses its provider's documented environment variables", () => {
    for (const m of MODEL_CATALOG) {
      const env = resolveModelEnv(m.modelId, m.clientType);
      const provider = providerInfo(m.provider)!;
      expect(env, `${m.provider}/${m.modelId}`).toBeDefined();
      expect(env!.envKey, m.modelId).toBe(provider.envKey);
      expect(env!.envBaseUrlKey, m.modelId).toBe(provider.envBaseUrlKey);
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
    // Token Plan models link to their qianwenai model page (bare ids, no encoding needed).
    expect(modelHomepageUrl("qwen-token-plan", "qwen3.8-max")).toBe(
      "https://www.qianwenai.com/models/qwen3.8-max",
    );
    expect(modelHomepageUrl("tokendance", "glm-5.3")).toBe(
      "https://tokendance.space/models/glm-5.3",
    );
    // Direct vendors link to the vendor's model docs page.
    expect(modelHomepageUrl("deepseek", "deepseek-v4-pro")).toBe(
      "https://api-docs.deepseek.com/quick_start/pricing",
    );
    expect(modelHomepageUrl("minimax", "MiniMax-M3")).toBe(
      "https://platform.minimax.io/docs/guides/models-intro",
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

describe("fastModeProtocol (which models may be offered AgentHub's fast_mode, and on which protocol)", () => {
  it("OpenAI-protocol clients carry it: openai_chat / openai_responses / gpt5_6 / minimax_m3", () => {
    // Bare "openai" is the alias the web pins on custom, user-defined and gateway rows.
    expect(fastModeProtocol("anything-at-all", "openai")).toBe("openai");
    expect(fastModeProtocol("local-qwen", "openai-responses")).toBe("openai");
    // minimax-m3 is the one branch AgentHub matches by exact equality, not substring.
    expect(fastModeProtocol("MiniMax-M3", "minimax-m3")).toBe("openai");
    expect(fastModeProtocol("MiniMax-M3")).toBe("openai");
    // The gpt-5.x branch precedes the openai catch-all, and both map service_tier.
    expect(fastModeProtocol("gpt-5.5-pro")).toBe("openai");
    expect(fastModeProtocol("gpt-5.4-mini")).toBe("openai");
    expect(fastModeProtocol("gpt-5.6")).toBe("openai");
  });

  it("Anthropic-protocol clients carry it as speed=fast", () => {
    expect(fastModeProtocol("claude-fable-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-opus-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-sonnet-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-opus-4-8")).toBe("anthropic");
    expect(fastModeProtocol("some-proxy-id", "ant-messages")).toBe("anthropic");
    // Outside the research preview's Opus allowlist the client still sends it and Anthropic
    // answers 429 — a warning before enabling, not a reason to withhold the setting.
    expect(fastModeProtocol("claude-opus-4-7")).toBe("anthropic");
  });

  it("clients that reject the parameter get no toggle: Gemini, GLM, Kimi, DeepSeek, embeddings", () => {
    expect(fastModeProtocol("gemini-3.5-flash")).toBeUndefined();
    expect(fastModeProtocol("gemini-3.1-pro-preview")).toBeUndefined();
    expect(fastModeProtocol("gemini-embedding-001")).toBeUndefined();
    expect(fastModeProtocol("glm-5.2")).toBeUndefined();
    expect(fastModeProtocol("kimi-k3")).toBeUndefined();
    expect(fastModeProtocol("kimi-k2.6")).toBeUndefined();
    expect(fastModeProtocol("kimi-k2.5")).toBeUndefined();
    expect(fastModeProtocol("deepseek-v4-pro")).toBeUndefined();
    expect(fastModeProtocol("text-embedding-3-large", "openai-embedding")).toBeUndefined();
    // A future first-party generation inherits the verdict from its family substring, so a
    // catalog row added later needs no change here (agenthub routes glm-5.3 / gemini-3.7 to
    // the same rejecting clients).
    expect(fastModeProtocol("glm-5.3")).toBeUndefined();
    expect(fastModeProtocol("gemini-3.7-pro")).toBeUndefined();
  });

  it("claude5 carve-outs are tested against the model id and base URL, not the routing token", () => {
    // Claude 4.6 is refused by name even though claude5 serves the family.
    expect(fastModeProtocol("claude-sonnet-4-6")).toBeUndefined();
    expect(fastModeProtocol("Claude-Sonnet-4-6")).toBeUndefined();
    // Routing may come from client_type while the 4-6 refusal reads the model id...
    expect(fastModeProtocol("my-claude-sonnet-4-6-proxy", "claude-5")).toBeUndefined();
    // ...and conversely a 4-6 client_type with a served model id keeps fast mode.
    expect(fastModeProtocol("claude-sonnet-5", "claude-4-6")).toBe("anthropic");
    // Bedrock has no fast tier; the prefix lives in the base URL, which is why the rule needs it.
    expect(fastModeProtocol("claude-fable-5", undefined, "bedrock://us-east-1")).toBeUndefined();
    expect(fastModeProtocol("claude-fable-5", undefined, "https://api.anthropic.com")).toBe(
      "anthropic",
    );
  });

  it("an id AgentHub cannot route gets no toggle either (no client, so no fast tier)", () => {
    // AutoLLMClient throws for an unmatched token — there is no openai_chat fallback.
    expect(fastModeProtocol("totally-unknown-model")).toBeUndefined();
    expect(fastModeProtocol("MiniMax-M4")).toBeUndefined();
    // Dotted OpenRouter Anthropic ids match no branch at all when no client_type is pinned
    // (neither "4-8" nor "-5"), unlike their dashed first-party spellings.
    expect(fastModeProtocol("anthropic/claude-opus-4.8")).toBeUndefined();
    // The same row as the catalog ships it — client_type pinned — is served over openai_chat.
    expect(fastModeProtocol("anthropic/claude-opus-4.8", "openai")).toBe("openai");
    // Self-routing can disagree with the provider group: a blank client_type sends this id to
    // the native claude5 client, flipping the protocol that would carry the parameter.
    expect(fastModeProtocol("anthropic/claude-fable-5")).toBe("anthropic");
    expect(fastModeProtocol("anthropic/claude-fable-5", "openai")).toBe("openai");
  });

  it("catalog invariant: every built-in row's verdict follows its client family", () => {
    for (const m of MODEL_CATALOG) {
      const verdict = fastModeProtocol(m.modelId, m.clientType, m.baseUrl);
      if (m.clientType === "openai") {
        // Every gateway row pins the OpenAI protocol, which always carries service_tier.
        expect(verdict, `${m.provider}/${m.modelId}`).toBe("openai");
      } else if (["google", "zhipu", "moonshot", "deepseek"].includes(m.provider)) {
        // These groups' first-party clients have no fast tier at all: rows added to them
        // later (a new Gemini or GLM generation) stay excluded without touching this rule.
        expect(verdict, `${m.provider}/${m.modelId}`).toBeUndefined();
      }
    }
    // The direct first-party rows that do serve it, named so a regression is legible.
    const verdictOf = (provider: string, modelId: string) => {
      const m = catalogEntryFor(provider, modelId)!;
      return fastModeProtocol(m.modelId, m.clientType, m.baseUrl);
    };
    expect(verdictOf("anthropic", "claude-fable-5")).toBe("anthropic");
    expect(verdictOf("anthropic", "claude-opus-5")).toBe("anthropic");
    expect(verdictOf("anthropic", "claude-sonnet-5")).toBe("anthropic");
    expect(verdictOf("anthropic", "claude-opus-4-8")).toBe("anthropic");
    expect(verdictOf("anthropic", "claude-opus-4-7")).toBe("anthropic");
    // The one Anthropic row the client refuses by name.
    expect(verdictOf("anthropic", "claude-sonnet-4-6")).toBeUndefined();
    expect(verdictOf("openai", "gpt-5.5")).toBe("openai");
    expect(verdictOf("openai", "gpt-5.4-pro")).toBe("openai");
    expect(verdictOf("minimax", "MiniMax-M3")).toBe("openai");
  });
});

describe("attributionHeaders (how the harness names itself to the gateways that read it)", () => {
  it("OpenRouter gets its three attribution headers, on the preset base URL and on any custom one", () => {
    const expected = {
      "HTTP-Referer": "https://penguin.ooo/",
      "X-OpenRouter-Title": "PenguinHarness",
      "X-OpenRouter-Categories": "cli-agent,personal-agent",
    };
    expect(attributionHeaders(providerInfo("openrouter")!.gatewayBaseUrl)).toEqual(expected);
    // The host decides, not the catalog: an entry filed under custom that points at the same
    // gateway is the same app calling it.
    expect(attributionHeaders("https://openrouter.ai/api/v1/")).toEqual(expected);
    // `URL` keeps a fully-qualified trailing dot in `hostname`; it names the same server.
    expect(attributionHeaders("https://openrouter.ai./api/v1")).toEqual(expected);
    // OpenRouter accepts at most two categories per request and drops anything unrecognised.
    expect(expected["X-OpenRouter-Categories"].split(",")).toHaveLength(2);
  });

  it("TokenDance gets the single X-App-URL header", () => {
    expect(attributionHeaders(providerInfo("tokendance")!.gatewayBaseUrl)).toEqual({
      "X-App-URL": "https://penguin.ooo/",
    });
  });

  it("every other endpoint gets no extra headers, and a blank or unparseable base URL is inert", () => {
    expect(attributionHeaders("https://api.deepseek.com")).toBeUndefined();
    expect(attributionHeaders("https://api.siliconflow.cn/v1")).toBeUndefined();
    expect(attributionHeaders(undefined)).toBeUndefined();
    expect(attributionHeaders("   ")).toBeUndefined();
    expect(attributionHeaders("not a url")).toBeUndefined();
    // Suffix-anchored host matching: a lookalike domain is not the gateway.
    expect(attributionHeaders("https://notopenrouter.ai/api/v1")).toBeUndefined();
    expect(attributionHeaders("https://tokendance.space.example.com/v1")).toBeUndefined();
    // Stripping the trailing dot must not widen that anchoring.
    expect(attributionHeaders("https://openrouter.ai.attacker.com./v1")).toBeUndefined();
  });

  it("catalog invariant: every gateway row whose host runs an attribution scheme carries it", () => {
    for (const m of MODEL_CATALOG) {
      const headers = attributionHeaders(m.baseUrl);
      if (m.provider === "openrouter") {
        expect(headers?.["HTTP-Referer"], m.modelId).toBe("https://penguin.ooo/");
      } else if (m.provider === "tokendance") {
        expect(headers?.["X-App-URL"], m.modelId).toBe("https://penguin.ooo/");
      } else {
        expect(headers, `${m.provider}/${m.modelId}`).toBeUndefined();
      }
    }
  });
});

describe("off-peak schedules", () => {
  const S = DEEPSEEK_OFF_PEAK;
  /** Beijing is UTC+8 with no DST, so a Beijing wall clock is the UTC one minus 8 hours. */
  const beijing = (iso: string): Date => new Date(`${iso}+08:00`);

  it("the DeepSeek rows store the peak price and declare the schedule", () => {
    const rows = MODEL_CATALOG.filter((m) => m.provider === "deepseek");
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) {
      expect(m.offPeakDiscount, m.modelId).toBe(S);
      // Peak is exactly double the off-peak tier DeepSeek publishes. Compared at 1e-5: both
      // sides round to six decimals independently, so the last digit can differ by one.
      expect(effectivePricing(m, beijing("2026-08-31T22:00"))!.output * 2).toBeCloseTo(
        m.pricing!.output,
        5,
      );
    }
    // The published peak figures themselves: CNY 0.1 / 3 / 9 per million, at the catalog's 7:1
    // display convention, which is DeepSeek's off-peak 0.05 / 1.5 / 4.5 doubled.
    const flash = MODEL_CATALOG.find((m) => m.modelId === "deepseek-v4-flash")!.pricing!;
    expect([flash.cache_read, flash.cache_write, flash.output]).toEqual([
      0.014286, 0.428571, 1.285714,
    ]);
  });

  it("peak is Monday to Friday, 09:00-12:00 and 14:00-18:00 Beijing", () => {
    // 2026-08-31 is a Monday.
    expect(offPeakAt(S, beijing("2026-08-31T09:00"))).toBe(false);
    expect(offPeakAt(S, beijing("2026-08-31T11:59"))).toBe(false);
    expect(offPeakAt(S, beijing("2026-08-31T14:00"))).toBe(false);
    expect(offPeakAt(S, beijing("2026-08-31T17:59"))).toBe(false);
    // Outside them, including the lunch gap and both ends of the day.
    expect(offPeakAt(S, beijing("2026-08-31T08:59"))).toBe(true);
    expect(offPeakAt(S, beijing("2026-08-31T13:00"))).toBe(true);
    expect(offPeakAt(S, beijing("2026-08-31T18:00"))).toBe(true);
    expect(offPeakAt(S, beijing("2026-08-31T03:00"))).toBe(true);
    // The window ends are exclusive, so noon and 18:00 are already off-peak.
    expect(offPeakAt(S, beijing("2026-08-31T12:00"))).toBe(true);
  });

  it("weekends are off-peak all day", () => {
    // 2026-09-05 is a Saturday, 2026-09-06 a Sunday — the ISO day 7 the schedule must not
    // confuse with getUTCDay's 0.
    expect(offPeakAt(S, beijing("2026-09-05T10:00"))).toBe(true);
    expect(offPeakAt(S, beijing("2026-09-06T10:00"))).toBe(true);
    expect(offPeakAt(S, beijing("2026-09-07T10:00"))).toBe(false);
  });

  it("the answer is the vendor's clock, not the host's", () => {
    // One instant, asked in two ways: 01:30 UTC is 09:30 in Beijing, i.e. peak, whatever zone
    // the server runs in. The Date is absolute, so this pins that no local-time call is used.
    expect(offPeakAt(S, new Date("2026-08-31T01:30:00Z"))).toBe(false);
    expect(offPeakAt(S, new Date("2026-08-31T16:30:00Z"))).toBe(true);
  });

  it("effectivePricing halves every bucket off-peak and leaves them at peak", () => {
    const m = MODEL_CATALOG.find((x) => x.modelId === "deepseek-v4-pro")!;
    expect(effectivePricing(m, beijing("2026-08-31T10:00"))).toEqual(m.pricing);
    const off = effectivePricing(m, beijing("2026-08-31T20:00"))!;
    for (const k of ["cache_read", "cache_write", "output"] as const) {
      expect(off[k], k).toBeCloseTo(m.pricing![k] / 2, 5);
    }
    // And the concrete off-peak figures, which are DeepSeek's published CNY 0.15 / 4.5 / 13.5.
    const cnyOf = (usdV: number): number => Math.round(usdV * 7 * 1000) / 1000;
    expect([cnyOf(off.cache_read), cnyOf(off.cache_write), cnyOf(off.output)]).toEqual([
      0.15, 4.5, 13.5,
    ]);
  });
  it("no entry declares both a flat discount and a schedule", () => {
    // effectivePricing, discountedPrice and presetModelEntries all silently prefer the schedule,
    // so a row declaring both would be billed at its list price during peak with nothing failing.
    // The rule is stated in the field's doc; this is what makes it true.
    const both = MODEL_CATALOG.filter(
      (m) => m.discount !== undefined && m.offPeakDiscount !== undefined,
    ).map((m) => `${m.provider}/${m.modelId}`);
    expect(both).toEqual([]);
  });
});
