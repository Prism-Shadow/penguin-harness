/**
 * Built-in model catalog unit tests: unique ids, valid provider references, positive
 * three-bucket pricing, lookups, and preset entry generation.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG,
  MODEL_PROVIDERS,
  catalogEntryFor,
  inferProviderForUpstream,
  presetModelEntries,
  providerInfo,
  resolveModelEnv,
} from "../src/state/index.js";

describe("model-catalog", () => {
  it("model ids are globally unique; DeepSeek comes first (the default model's provider)", () => {
    const ids = MODEL_CATALOG.map((m) => m.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MODEL_CATALOG[0]!.provider).toBe("deepseek");
    // Group order: DeepSeek first, followed by the OpenRouter and SiliconFlow gateways,
    // then Google Gemini before Anthropic, with custom last.
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "deepseek",
      "openrouter",
      "siliconflow",
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

  it("all three price buckets are positive; context_window is a positive integer", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.pricing, m.modelId).toBeDefined();
      expect(m.pricing!.unit).toBe("usd_per_mtok");
      expect(m.pricing!.cache_read).toBeGreaterThan(0);
      expect(m.pricing!.cache_write).toBeGreaterThan(0);
      expect(m.pricing!.output).toBeGreaterThan(0);
      expect(Number.isInteger(m.contextWindow)).toBe(true);
      expect(m.contextWindow!).toBeGreaterThan(0);
    }
  });

  it("providerInfo matches by id; unknown ids return undefined", () => {
    expect(providerInfo("moonshot")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(providerInfo("nonexistent")).toBeUndefined();
  });

  it("pair matching and provider-grouping inference: catalogEntryFor / inferProviderForUpstream", () => {
    // catalogEntryFor is the sole catalog lookup entry point: it matches on (group, upstream id)
    // pairs, so an identically named upstream id never matches across the wrong group.
    expect(catalogEntryFor("anthropic", "claude-sonnet-4-6")?.displayName).toBe(
      "Claude Sonnet 4.6",
    );
    expect(catalogEntryFor("openai", "claude-sonnet-4-6")).toBeUndefined();
    // The upstream id itself may contain / (gateway models); it is never split apart.
    expect(catalogEntryFor("openrouter", "xiaomi/mimo-v2.5")?.displayName).toBe("MiMo-V2.5");
    expect(catalogEntryFor("custom", "my-own")).toBeUndefined();

    // Inference for `model add` when --provider is omitted: a catalog hit yields its provider, otherwise custom.
    expect(inferProviderForUpstream("deepseek-v4-pro")).toBe("deepseek");
    expect(inferProviderForUpstream("xiaomi/mimo-v2.5")).toBe("openrouter");
    expect(inferProviderForUpstream("my-own-model")).toBe("custom");
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

  it("gateway models (OpenRouter / SiliconFlow): openai protocol + preset base URL; env fallback is OPENAI_API_KEY", () => {
    const or = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
    expect(or.map((m) => m.modelId)).toEqual([
      "xiaomi/mimo-v2.5",
      "tencent/hy3",
      "minimax/minimax-m3",
      "stepfun/step-3.7-flash",
    ]);
    for (const m of or) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://openrouter.ai/api/v1");
    }
    const sf = MODEL_CATALOG.filter((m) => m.provider === "siliconflow");
    expect(sf.map((m) => m.modelId)).toEqual([
      "zai-org/GLM-5.2",
      "deepseek-ai/DeepSeek-V4-Pro",
      "meituan-longcat/LongCat-2.0",
    ]);
    for (const m of sf) {
      expect(m.clientType).toBe("openai");
      expect(m.baseUrl).toBe("https://api.siliconflow.cn/v1");
    }
    // Routed through AgentHub's OpenAI client -> when the credential is left blank it reads OPENAI_API_KEY (not the provider's own env var name).
    for (const id of ["openrouter", "siliconflow", "custom"]) {
      expect(providerInfo(id)!.envKey).toBe("OPENAI_API_KEY");
      expect(providerInfo(id)!.envBaseUrlKey).toBe("OPENAI_BASE_URL");
    }
    // gatewayBaseUrl (prefilled by group in the frontend's "add model" dialog) is only carried by the two gateway providers.
    expect(providerInfo("openrouter")!.gatewayBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(providerInfo("siliconflow")!.gatewayBaseUrl).toBe("https://api.siliconflow.cn/v1");
    for (const p of MODEL_PROVIDERS) {
      if (p.id !== "openrouter" && p.id !== "siliconflow") {
        expect(p.gatewayBaseUrl, p.id).toBeUndefined();
      }
    }
    const gateway = [...or, ...sf];
    // Pricing (USD): MiMo v2.5 and Hy3.
    const mimo = MODEL_CATALOG.find((m) => m.modelId === "xiaomi/mimo-v2.5")!.pricing!;
    expect([mimo.cache_read, mimo.cache_write, mimo.output]).toEqual([0.0028, 0.14, 0.28]);
    const hy3 = MODEL_CATALOG.find((m) => m.modelId === "tencent/hy3")!.pricing!;
    expect([hy3.cache_read, hy3.cache_write, hy3.output]).toEqual([0.035, 0.14, 0.58]);

    // In preset entries, exactly the gateway models (and only them) inline base_url (no credentials).
    const withBaseUrl = presetModelEntries().filter((e) => e.base_url !== undefined);
    expect(withBaseUrl.map((e) => [e.provider, e.model_id]).sort()).toEqual(
      gateway.map((m) => [m.provider, m.modelId]).sort(),
    );
  });

  it("DeepSeek and Kimi are initialized from official CNY prices (stored in USD; x7 recovers the official price)", () => {
    const cnyOf = (usdV: number) => Math.round(usdV * 7 * 1000) / 1000;
    const pro = MODEL_CATALOG.find((m) => m.modelId === "deepseek-v4-pro")!.pricing!;
    expect([cnyOf(pro.cache_read), cnyOf(pro.cache_write), cnyOf(pro.output)]).toEqual([
      0.025, 3, 6,
    ]);
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
});
