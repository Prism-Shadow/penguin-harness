/**
 * Built-in model catalog unit tests: unique ids, valid provider references, positive
 * three-bucket pricing, lookups, and preset entry generation.
 */
import { describe, expect, it } from "vitest";
import { listEndpointModels } from "../src/llm/list-models.js";
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
  offPeakScheduledRefs,
  DEEPSEEK_OFF_PEAK,
  QWEN_OFF_PEAK,
  catalogGroupConnection,
  catalogModelEntries,
  effectiveConnection,
  groupKeyReaches,
  presetModelEntries,
  presetPromotions,
  presetProviderTable,
  providerClientType,
  providerConnectionShape,
  providerInfo,
  fastModeProtocol,
  isAddableGroup,
  isVendorGroup,
  resolveModelEnv,
  routedClientType,
  resolveProviderModelEnv,
  ModelCredentialError,
  PENGUIN_GO_BASE_URL,
  endpointEnvApiKey,
  modelEnvFallback,
  modelEnvPreviewKey,
  providerEnvFallbackKey,
  resolveEntryCredential,
  resolveModelCredential,
  sameEndpoint,
  unaddableModel,
  unroutableVendorModel,
} from "../src/state/index.js";
import type { ModelEntry, ProviderConnection, ProviderTable } from "../src/state/index.js";

/**
 * What a stored row is used with, the way a Session builds it: the row's own values, then its
 * group's table in `table` (a new Project's, presetProviderTable, unless a test says otherwise).
 */
function storedConnection(entry: ModelEntry, table: ProviderTable = presetProviderTable()) {
  return effectiveConnection(
    {
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: entry.client_type,
      baseUrl: entry.base_url,
      apiKey: entry.api_key,
    },
    providerConnectionShape(table[entry.provider]),
  );
}

describe("model-catalog", () => {
  it("(provider, model_id) pairs are unique and provider order keeps the recommendation first", () => {
    // Bare model ids may repeat across providers (a gateway reselling a vendor model keeps the
    // vendor's upstream id, e.g. Qwen Token Plan's glm-5.3 / qwen3.8-max) — uniqueness is
    // the (provider, model_id) pair, matching the catalog's sole lookup key (catalogEntryFor).
    const pairs = MODEL_CATALOG.map((m) => `${m.provider}\0${m.modelId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const ids = MODEL_CATALOG.map((m) => m.modelId);
    expect(MODEL_CATALOG[0]!.provider).toBe("deepseek");
    // Group order is hand-curated, interleaving gateways and first-party vendors: the
    // recommended TokenDance first, the prebuilt Penguin Go group next, OpenCode Go third,
    // DeepSeek after it, and vLLM last
    // among the vendors (self-hosted, so nothing in it runs until the user names a server)
    // and custom always last. This is the page's DEFAULT only — a Project that has reordered
    // its groups stores every key and keeps its own arrangement (web's model-group-order.ts).
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual([
      "tokendance",
      "penguin-go",
      "opencode-go",
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
      "modelscope",
      "vllm",
      "custom",
    ]);
    // Exactly one group is marked recommended, and it is the one that leads the default
    // order: the caption and the placement are two statements of the same curation.
    expect(MODEL_PROVIDERS.filter((p) => p.recommended).map((p) => p.id)).toEqual(["tokendance"]);
    expect(providerInfo("tokendance")!.recommended).toBe(true);
    expect(providerInfo("siliconflow")!.label).toBe("SiliconFlow");
    expect(providerInfo("minimax")!.label).toBe("MiniMax");
    expect(providerInfo("minimax")!.envKey).toBe("MINIMAX_API_KEY");
    expect(providerInfo("penguin-go")!.label).toBe("Penguin Go");
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

  it("every provider is in MODEL_PROVIDERS (a custom preset carries its own base URL and a pinned generic protocol)", () => {
    const providerIds = new Set(MODEL_PROVIDERS.map((p) => p.id));
    for (const m of MODEL_CATALOG) {
      expect(providerIds.has(m.provider)).toBe(true);
      // custom groups user-defined models, so the group implies no endpoint and no protocol:
      // a preset filed there has to say both itself.
      if (m.provider === "custom") {
        expect(["openai-responses", "ant-messages", "openai-chat"]).toContain(m.clientType);
        expect(m.baseUrl).toMatch(/^https:\/\//);
      }
    }
    // Every provider gives a console link to "get an API key" (shown in the frontend's group
    // header) and a model list / docs link to "get a model id" (shown in the add-model
    // dialog) — except where there is no such page to link. custom has neither; vLLM has no
    // console at all (the user runs the server), but its served ids are documented.
    for (const p of MODEL_PROVIDERS) {
      if (p.id === "custom") {
        expect(p.apiKeyUrl).toBeUndefined();
        expect(p.modelsUrl).toBeUndefined();
      } else if (p.id === "vllm") {
        expect(p.apiKeyUrl).toBeUndefined();
        expect(p.modelsUrl).toBe("https://recipes.vllm.ai/");
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

  it("exactly the bridged groups publish an authorization flow, and each names its own", () => {
    // The descriptor is what puts the "authorize a key" action on a group in the Web App, so
    // it has to name the App-side flow rather than the vendor: the Web App picks the service
    // from this value, and the group's id is not a contract.
    const withBridgeAuth = MODEL_PROVIDERS.filter((p) => p.bridgeAuth !== undefined).map((p) => [
      p.id,
      p.bridgeAuth!.flow,
    ]);
    expect(withBridgeAuth).toEqual([
      ["penguin-go", "penguin-go"],
      ["modelscope", "modelscope"],
    ]);
    // No group publishes both flows: a credential comes from one place.
    for (const p of MODEL_PROVIDERS) {
      expect(p.oauth === undefined || p.bridgeAuth === undefined).toBe(true);
    }
  });

  it("exactly TokenDance and DeepSeek publish a balance endpoint, on the host their keys already go to", () => {
    // The descriptor is what puts a balance in a group's header, so the Web App never names a
    // group; each one names the reader for its vendor's response shape.
    const withBalance = MODEL_PROVIDERS.filter((p) => p.balance !== undefined).map((p) => [
      p.id,
      p.balance!.format,
    ]);
    expect(withBalance).toEqual([
      ["tokendance", "tokendance"],
      ["deepseek", "deepseek"],
    ]);
    // The server sends the group's stored key to this URL, so it is the vendor's own https
    // endpoint and nothing else.
    expect(providerInfo("tokendance")!.balance!.url).toBe(
      "https://tokendance.space/portal/api/v1/user/balance",
    );
    expect(providerInfo("deepseek")!.balance!.url).toBe("https://api.deepseek.com/user/balance");
  });

  it("prebuilds Penguin Go with fixed relay routes and list prices, leaving promotions to the platform", () => {
    const penguinGoModels = MODEL_CATALOG.filter((model) => model.provider === "penguin-go");
    // The DeepSeek rows follow DeepSeek's own lineup: V4.1 Flash and V4 Pro 0813. The two
    // retired V4 Flash ids are not resold.
    expect(penguinGoModels.map((model) => model.modelId)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.1-pro-preview",
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    expect(
      penguinGoModels.every((model) => model.baseUrl === "https://token.penguin.ooo/api"),
    ).toBe(true);
    expect(
      penguinGoModels.every(
        (model) => model.pricing !== undefined && model.pricing.unit === "usd_per_mtok",
      ),
    ).toBe(true);
    expect(
      penguinGoModels
        .filter((model) => model.modelId.startsWith("gemini-"))
        .every((model) => model.clientType === "google-genai"),
    ).toBe(true);
    expect(
      penguinGoModels
        .filter((model) => model.modelId.startsWith("deepseek-"))
        .every((model) => model.clientType === "deepseek-official"),
    ).toBe(true);
    expect(catalogEntryFor("penguin-go", "deepseek-flash")?.supportsVision).toBe(true);
    expect(catalogEntryFor("penguin-go", "deepseek-v4-pro")).toMatchObject({
      displayName: "DeepSeek V4 Pro 0813",
      supportsVision: false,
    });
    // No static promotion: the platform delivers whatever it runs at authorization and Sync,
    // so every row here is its list price and nothing else.
    expect(penguinGoModels.filter((model) => model.discount !== undefined)).toEqual([]);
    for (const modelId of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]) {
      expect(catalogEntryFor("penguin-go", modelId)!.pricing, modelId).toEqual({
        unit: "usd_per_mtok",
        cache_read: 0.075,
        cache_write: 0.75,
        output: 3.75,
      });
    }
    expect(catalogEntryFor("penguin-go", "deepseek-flash")).toMatchObject({
      pricing: {
        cache_read: 0.005714,
        cache_write: 0.285714,
        output: 1.142857,
      },
      offPeakDiscount: DEEPSEEK_OFF_PEAK,
    });
  });

  it("OpenCode Go: each model pins the protocol its endpoint table names, at the Go page's per-token rates", () => {
    const group = providerInfo("opencode-go")!;
    expect(group.label).toBe("OpenCode Go");
    expect(group.apiKeyUrl).toBe("https://opencode.ai/auth");
    expect(group.modelsUrl).toBe("https://opencode.ai/docs/go/");
    // The group's endpoint is the Chat Completions base most of its models use; it pins no
    // protocol, because its models sit on three (each row stores its own in a new Project).
    expect(group.gatewayBaseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(providerClientType("opencode-go")).toBeUndefined();
    // No per-model pages: every model links to the Go docs page, which lists them all.
    expect(modelHomepageUrl("opencode-go", "kimi-k3")).toBe("https://opencode.ai/docs/go/");

    const go = MODEL_CATALOG.filter((m) => m.provider === "opencode-go");
    const CHAT = ["openai-chat", "https://opencode.ai/zen/go/v1"];
    const RESPONSES = ["openai-responses", "https://opencode.ai/zen/go/v1"];
    // The Anthropic SDK appends /v1/messages itself, so the Messages base carries no /v1.
    const MESSAGES = ["ant-messages", "https://opencode.ai/zen/go"];
    // Dictionary order, newer versions of a series first. Protocols from the docs page's
    // endpoint table; context windows and modalities from models.dev; vision checked live.
    expect(
      go.map((m) => [m.modelId, m.clientType, m.baseUrl, m.contextWindow, m.supportsVision]),
    ).toEqual([
      ["deepseek-v4.1-flash", ...CHAT, 1000000, true],
      ["deepseek-v4-flash", ...CHAT, 1000000, false],
      ["deepseek-v4-flash-vision-exp", ...CHAT, 1000000, true],
      ["deepseek-v4-pro", ...CHAT, 1000000, false],
      ["glm-5.3", ...CHAT, 1000000, false],
      ["glm-5.3-flash", ...CHAT, 1000000, true],
      ["glm-5.2", ...CHAT, 1000000, false],
      ["glm-5.1", ...CHAT, 202752, false],
      ["gpt-5.6-luna", ...RESPONSES, 1050000, true],
      ["grok-4.6", ...RESPONSES, 500000, true],
      ["hy4-preview", ...CHAT, 1024000, false],
      ["hy3", ...CHAT, 192000, false],
      ["kimi-k3", ...CHAT, 1048576, true],
      ["kimi-k2.7-code", ...CHAT, 262144, true],
      ["kimi-k2.6", ...CHAT, 262144, true],
      ["longcat-2.0", ...CHAT, 1000000, false],
      ["mimo-v2.5", ...CHAT, 1000000, true],
      ["mimo-v2.5-pro", ...CHAT, 1048576, false],
      ["minimax-m3", ...MESSAGES, 1000000, true],
      ["minimax-m2.7", ...MESSAGES, 204800, false],
      ["muse-spark-1.3-contributor", ...RESPONSES, 1048576, true],
      ["muse-spark-1.2-contributor", ...RESPONSES, 1048576, true],
      ["qwen3.8-flash", ...MESSAGES, 1000000, true],
      ["qwen3.8-max", ...MESSAGES, 1000000, true],
      ["qwen3.7-max", ...MESSAGES, 1000000, false],
      ["qwen3.7-plus", ...MESSAGES, 1000000, true],
      ["qwen3.6-plus", ...MESSAGES, 1000000, true],
    ]);

    // The Go page's rates in the catalog's (cache_read, cache_write, output) order. cache_write
    // is the published cached-write rate where the page lists one and the input rate where it
    // does not; tiered rows keep their base tier and the DeepSeek rows their peak rate.
    expect(
      Object.fromEntries(
        go.map((m) => [
          m.modelId,
          [m.pricing!.cache_read, m.pricing!.cache_write, m.pricing!.output],
        ]),
      ),
    ).toEqual({
      "deepseek-v4.1-flash": [0.006, 0.3, 1.2],
      "deepseek-v4-flash": [0.006, 0.3, 1.2],
      "deepseek-v4-flash-vision-exp": [0.006, 0.3, 1.2],
      "deepseek-v4-pro": [0.044, 1.32, 3.96],
      "glm-5.3": [0.26, 1.4, 4.4],
      "glm-5.3-flash": [0.03, 0.15, 0.5],
      "glm-5.2": [0.26, 1.4, 4.4],
      "glm-5.1": [0.26, 1.4, 4.4],
      "gpt-5.6-luna": [0.02, 0.25, 1.2],
      "grok-4.6": [0.5, 2, 6],
      "hy4-preview": [0.042, 0.834, 2.501],
      hy3: [0.035, 0.14, 0.58],
      "kimi-k3": [0.3, 3, 15],
      "kimi-k2.7-code": [0.19, 0.95, 4],
      "kimi-k2.6": [0.16, 0.95, 4],
      "longcat-2.0": [0.006, 0.3, 1.2],
      "mimo-v2.5": [0.0028, 0.14, 0.28],
      "mimo-v2.5-pro": [0.003625, 0.435, 0.87],
      "minimax-m3": [0.06, 0.3, 1.2],
      "minimax-m2.7": [0.06, 0.375, 1.2],
      "muse-spark-1.3-contributor": [0.002, 0.1, 0.2],
      "muse-spark-1.2-contributor": [0.002, 0.1, 0.2],
      "qwen3.8-flash": [0.016, 0.2, 0.47],
      "qwen3.8-max": [0.25, 2.5, 6],
      "qwen3.7-max": [0.5, 3.125, 7.5],
      "qwen3.7-plus": [0.04, 0.5, 1.6],
      "qwen3.6-plus": [0.05, 0.625, 3],
    });

    // The DeepSeek rows are the only ones on a schedule, DeepSeek's own, and off-peak they bill
    // exactly the Go page's Off-Peak figures. 2026-09-19 is a Saturday: off-peak all day.
    const scheduled = go.filter((m) => m.offPeakDiscount !== undefined);
    expect(scheduled.map((m) => m.modelId)).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ]);
    const saturday = new Date("2026-09-19T10:00:00+08:00");
    for (const m of scheduled) {
      expect(m.offPeakDiscount, m.modelId).toBe(DEEPSEEK_OFF_PEAK);
      const off = effectivePricing(m, saturday)!;
      expect([off.cache_read, off.cache_write, off.output], m.modelId).toEqual(
        m.modelId === "deepseek-v4-pro" ? [0.022, 0.66, 1.98] : [0.003, 0.15, 0.6],
      );
    }
    // No promotion is on a rate: the running "4x" offer raises an allowance, not a price.
    expect(go.filter((m) => m.discount !== undefined)).toEqual([]);

    // A model the catalog already carries elsewhere keeps its display name here.
    for (const [provider, modelId, goId] of [
      ["zhipu", "glm-5.3-flash", "glm-5.3-flash"],
      ["openai", "gpt-5.6-luna", "gpt-5.6-luna"],
      ["openrouter", "x-ai/grok-4.6", "grok-4.6"],
      ["moonshot", "kimi-k3", "kimi-k3"],
      ["fireworks", "accounts/fireworks/models/kimi-k2p7-code", "kimi-k2.7-code"],
      ["siliconflow", "meituan-longcat/LongCat-2.0", "longcat-2.0"],
      ["minimax", "MiniMax-M3", "minimax-m3"],
      ["tokendance", "hy4-preview", "hy4-preview"],
      ["qwen-pay-as-you-go", "qwen3.8-max", "qwen3.8-max"],
    ] as const) {
      expect(catalogEntryFor("opencode-go", goId)!.displayName, goId).toBe(
        catalogEntryFor(provider, modelId)!.displayName,
      );
    }
  });

  it("the app URL a minted key is stamped with is the same one attribution headers carry", () => {
    expect(APP_URL).toBe("https://penguin.ooo/");
    expect(attributionHeaders("https://tokendance.space/gateway/v1")).toEqual({
      "X-App-URL": APP_URL,
    });
  });

  it("every entry is priced or deliberately unpriced; context_window is a positive integer", () => {
    // An absent `pricing` is a supported state — the model card leaves the row unbadged and the
    // cost center reports the usage as uncosted, which is what "nobody has read this vendor's
    // price" should look like. This list is what keeps it deliberate: a row belongs here only
    // when the vendor publishes no read-able rate, never as a way to skip looking.
    const UNPRICED = new Set([
      // ModelScope bills for api-inference but its model pages are client-rendered and carry
      // no rate. Recording $0 instead would have isFreeModel badge a billed gateway "Free".
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "Qwen/Qwen3.8-27B",
      "Qwen/Qwen3.8-Flash-Next",
    ]);
    for (const m of MODEL_CATALOG) {
      if (m.pricing === undefined) {
        expect(UNPRICED.has(m.modelId), m.modelId).toBe(true);
      } else if (
        m.provider === "vllm" ||
        m.modelId.endsWith(":free") ||
        m.modelId === "openrouter/free" ||
        m.modelId === "Atria-Dawn-Preview" ||
        m.modelId === "dots-3-note-preview"
      ) {
        // Self-hosted vLLM and the free-tier gateway rows share one treatment: a genuine $0
        // price (not "unknown"), so costs compute to 0 and the free badge shows. Nobody bills
        // per token for either — a vLLM deployment costs its operator hardware, which no
        // catalog rate expresses. Atria Dawn Preview has no published price yet and is
        // recorded at $0 until the vendor prices it; TokenDance's dots-3-note-preview is the
        // one free row of its group.
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

  it("custom: the group pins nothing, and its one preset carries its own endpoint and protocol", () => {
    // The custom group holds user-defined models, so the group itself implies no endpoint and
    // no protocol (see the MODEL_PROVIDERS test above). A preset filed there is complete on its
    // own row: Atria Dawn Preview at api.atria-asi.ai, Anthropic Messages API (the client
    // appends /v1/messages, so the base carries no /v1), 256K window, text only.
    expect(providerClientType("custom")).toBeUndefined();
    expect(providerInfo("custom")!.gatewayBaseUrl).toBeUndefined();
    const custom = MODEL_CATALOG.filter((m) => m.provider === "custom");
    expect(
      custom.map((m) => [m.modelId, m.clientType, m.baseUrl, m.contextWindow, m.supportsVision]),
    ).toEqual([["Atria-Dawn-Preview", "ant-messages", "https://api.atria-asi.ai", 262144, false]]);
    // The custom group is last, and so is its row: the catalog is laid out group by group.
    expect(MODEL_CATALOG.at(-1)!.modelId).toBe("Atria-Dawn-Preview");
    expect(catalogEntryFor("custom", "Atria-Dawn-Preview")?.displayName).toBe("Atria Dawn Preview");
    // Ids are case-sensitive at the vendor, so the lookup is too.
    expect(catalogEntryFor("custom", "atria-dawn-preview")).toBeUndefined();
    // custom has no group table in a new Project, so the preset row carries both itself and
    // reaches them from the file alone, whatever custom's table later says.
    const preset = presetModelEntries().find((e) => e.provider === "custom")!;
    expect(preset).toEqual({
      provider: "custom",
      model_id: "Atria-Dawn-Preview",
      context_window: 262144,
      client_type: "ant-messages",
      pricing: { unit: "usd_per_mtok", cache_read: 0, cache_write: 0, output: 0 },
      vision: false,
      base_url: "https://api.atria-asi.ai",
    });
    expect(presetProviderTable().custom).toBeUndefined();
    expect(
      storedConnection(preset, {
        custom: { base_url: "http://127.0.0.1:11434/v1", client_type: "openai-chat" },
      }),
    ).toMatchObject({
      baseUrl: "https://api.atria-asi.ai",
      baseUrlSource: "model",
      clientType: "ant-messages",
      clientTypeSource: "model",
    });
    expect(modelHomepageUrl("custom", "Atria-Dawn-Preview")).toBeUndefined();
  });

  it("vLLM (self-hosted): the group pins openai-chat-vllm-adapter, prices at zero and carries no endpoint", () => {
    const vllm = MODEL_CATALOG.filter((m) => m.provider === "vllm");
    // Dictionary order by upstream id, case-insensitive (as in siliconflow): deepseek-ai/
    // before Qwen/, and the flash revision before the vision revision it prefixes.
    expect(vllm.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["deepseek-ai/DeepSeek-V4-Flash", 1000000, false],
      ["deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", 1000000, true],
      ["deepseek-ai/DeepSeek-V4-Pro", 1000000, false],
      ["Qwen/Qwen3.5-0.8B", 262144, true],
      ["Qwen/Qwen3.5-9B", 262144, true],
      ["Qwen/Qwen3.6-35B-A3B", 262144, true],
      ["Qwen/Qwen3.8-27B", 262144, true],
      ["Qwen/Qwen3.8-Flash-Next", 262144, true],
    ]);
    for (const m of vllm) {
      // The pin is load-bearing on every row: Qwen/* begins with no family AutoLLMClient
      // knows and would be rejected, and deepseek-ai/DeepSeek-V4-* begins with "deepseek-",
      // which would reach DeepSeek's official Responses client pointed at a vLLM server.
      expect(m.clientType, m.modelId).toBe("openai-chat-vllm-adapter");
      // Nobody bills per token and there is no shared endpoint: the user runs the server and
      // supplies its URL. Zero is a real rate here, not a missing one — see the pricing test.
      expect([m.pricing?.cache_read, m.pricing?.cache_write, m.pricing?.output], m.modelId).toEqual(
        [0, 0, 0],
      );
      expect(m.pricing!.unit, m.modelId).toBe("usd_per_mtok");
      expect(m.baseUrl, m.modelId).toBeUndefined();
      // Chat Completions on the wire, so the credential fallback is the OPENAI_* pair.
      expect(resolveModelEnv(m.modelId, m.clientType)?.envKey, m.modelId).toBe("OPENAI_API_KEY");
    }
    // The upstream id survives verbatim, capitals and all — it is what the vLLM server was
    // started with, and MMSP's per-model thinking table lowercases it on its own side.
    expect(catalogEntryFor("vllm", "Qwen/Qwen3.8-27B")?.displayName).toBe("Qwen 3.8 27B");
    expect(catalogEntryFor("vllm", "qwen/qwen3.8-27b")).toBeUndefined();
    // The same upstream ids are resold by SiliconFlow, and the pair lookup keeps the two
    // apart: same id, different group, different protocol and endpoint.
    expect(catalogEntryFor("siliconflow", "deepseek-ai/DeepSeek-V4-Pro")?.clientType).toBe(
      "openai-chat",
    );
    // The group pin, read the one way every call site reads it.
    expect(providerClientType("vllm")).toBe("openai-chat-vllm-adapter");
    expect(providerInfo("vllm")!.gatewayBaseUrl).toBeUndefined();
    // A model added by hand stores no protocol and follows its group's table, so in a new
    // Project every built-in group that takes such models — custom aside, which leaves the
    // protocol to detection — resolves one for an id its catalog does not list, and on an
    // endpoint: the group's own (vLLM's is the user's, typed on the row).
    for (const group of MODEL_PROVIDERS.filter((p) => p.addable && p.id !== "custom")) {
      const added = storedConnection({ provider: group.id, model_id: "someone/added-by-hand" });
      expect(added.clientType, group.id).toBe(providerClientType(group.id));
      expect(added.clientType, group.id).toBeDefined();
      expect(added.baseUrl, group.id).toBe(group.gatewayBaseUrl);
    }
    expect(providerClientType("openrouter")).toBe("openai-responses");
    expect(providerClientType("custom")).toBeUndefined();
    expect(providerClientType("my-own-group")).toBeUndefined();
    // Presets reach a Project with the pin (on the group's table) and the zero rate, and
    // without an endpoint: what a self-hosted deployment bills per token is nothing, and the
    // Project stores that as a rate rather than as a gap (see the pricing test).
    const preset = presetModelEntries().filter((e) => e.provider === "vllm");
    expect(preset).toHaveLength(8);
    for (const e of preset) {
      const effective = storedConnection(e);
      expect(effective.clientType, e.model_id).toBe("openai-chat-vllm-adapter");
      expect(
        [e.pricing?.cache_read, e.pricing?.cache_write, e.pricing?.output],
        e.model_id,
      ).toEqual([0, 0, 0]);
      expect(effective.baseUrl, e.model_id).toBeUndefined();
    }
    // Each preset id has a recipe page; an id the user serves themselves has none, so it
    // falls back to the recipe index.
    expect(modelHomepageUrl("vllm", "Qwen/Qwen3.8-27B")).toBe(
      "https://recipes.vllm.ai/Qwen/Qwen3.8-27B",
    );
    expect(modelHomepageUrl("vllm", "my-own-finetune")).toBe("https://recipes.vllm.ai/");
    // Fast mode rides on the client, and the vLLM client inherits openai_chat's mapping.
    expect(fastModeProtocol("Qwen/Qwen3.8-27B", "openai-chat-vllm-adapter")).toBe("openai");
  });

  it("providerInfo matches by id; unknown ids return undefined", () => {
    expect(providerInfo("moonshot")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(providerInfo("nonexistent")).toBeUndefined();
  });

  it("catalogEntryFor is the sole lookup and always takes the (provider, model_id) pair", () => {
    // It matches on (group, upstream id) pairs, so an identically named upstream id never
    // matches across the wrong group. There is no bare-id lookup at all: a gateway reselling a
    // vendor model keeps the vendor's upstream id, so a bare id names no single catalog entry
    // and the catalog never offers to pick one (`qwen3.7-plus` and `deepseek-v4-pro-0813` each
    // appear under two groups; `glm-5.3`, `qwen3.8-max` and `deepseek-v4.1-flash` under three).
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
    // The bare resold id never leaks into the vendor's own group: DeepSeek sells the 0813 Pro
    // release under its undated `deepseek-v4-pro` name, and the dated spelling is a reseller's.
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro-0813")).toBeUndefined();
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro")?.provider).toBe("deepseek");
    expect(catalogEntryFor("qwen-token-plan", "deepseek-v4-pro-0813")?.provider).toBe(
      "qwen-token-plan",
    );
    expect(catalogEntryFor("zhipu", "glm-5.3")?.contextWindow).toBe(1000000);
    expect(catalogEntryFor("qwen-token-plan", "glm-5.3")?.contextWindow).toBe(1048576);
    // The direct group presets exactly the two names DeepSeek's pricing page lists, V4.1 Flash
    // first: the vendor names it without a version segment. The bare V4 Flash names it no longer
    // lists stay as retired rows, and the dotted V4.1 spelling is a RESOLD id only — TokenDance,
    // both Qwen groups and OpenRouter sell it that way.
    expect(MODEL_CATALOG.filter((m) => m.provider === "deepseek").map((m) => m.modelId)).toEqual([
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ]);
    expect(
      presetModelEntries()
        .filter((e) => e.provider === "deepseek")
        .map((e) => e.model_id),
    ).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(catalogEntryFor("deepseek", "deepseek-v4.1-flash")).toBeUndefined();
    expect(catalogEntryFor("tokendance", "deepseek-v4.1-flash")?.provider).toBe("tokendance");
    expect(catalogEntryFor("openrouter", "deepseek/deepseek-v4.1-flash")?.provider).toBe(
      "openrouter",
    );
    // Vision is a per-row flag, not a property of the id's spelling: it tracks what the client
    // routing the row actually carries. MMSP's DeepSeek client denies image parts to ids
    // matching /^deepseek-v4-(flash|pro)(-\d{4})?$/, which covers deepseek-v4-pro but not the
    // bare deepseek-flash; OpenRouter's vision-exp listing goes through the generic Responses
    // client instead.
    expect(catalogEntryFor("deepseek", "deepseek-flash")?.supportsVision).toBe(true);
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro")?.supportsVision).toBe(false);
    expect(
      catalogEntryFor("openrouter", "deepseek/deepseek-v4-flash-vision-exp")?.supportsVision,
    ).toBe(true);
    expect(catalogEntryFor("minimax", "MiniMax-M3")?.displayName).toBe("MiniMax M3");
  });

  it("presetModelEntries: provider and bare upstream model_id are separate fields; a row stores a protocol or endpoint only where it differs from its group's", () => {
    const entries = presetModelEntries();
    const table = presetProviderTable();
    const presets = MODEL_CATALOG.filter((m) => m.retired !== true);
    expect(entries).toHaveLength(presets.length);
    for (const [i, entry] of entries.entries()) {
      const cat = presets[i]!;
      expect(entry.provider).toBe(cat.provider);
      expect(entry.model_id).toBe(cat.modelId);
      expect(entry.context_window).toBe(cat.contextWindow);
      // A Project stores the catalog's LIST price (a scheduled row's PEAK price), never a
      // discounted one: a promotion is seeded beside it as a fraction (presetPromotions), and
      // baking either rate in would make the number on disk depend on which promotion was
      // live, or which hour it was, when the Project was created or re-synced.
      expect(entry.pricing, entry.model_id).toEqual(cat.pricing);
      expect(entry.vision).toBe(cat.supportsVision ? undefined : false);
      // A value the group's table already carries is not repeated on the row: the row follows
      // the table, and a value stored on it is one the row really differs by.
      const group = table[entry.provider];
      if (entry.client_type !== undefined && group?.client_type !== undefined) {
        expect(entry.client_type, entry.model_id).not.toBe(group.client_type);
      }
      if (entry.base_url !== undefined && group?.base_url !== undefined) {
        expect(sameEndpoint(entry.base_url, group.base_url), entry.model_id).toBe(false);
      }
      // No entry carries credentials.
      expect(entry.api_key).toBeUndefined();
      // The concatenated storage id and request_model_id have been removed and no longer appear.
      expect(Object.hasOwn(entry, "request_model_id")).toBe(false);
    }
    // The rows that differ from their group: the two protocols of Penguin Go, the three of
    // OpenCode Go and its Messages base, and custom's Atria, which has no group table at all.
    const differing = entries.filter(
      (e) => e.client_type !== undefined || e.base_url !== undefined,
    );
    expect([...new Set(differing.map((e) => e.provider))]).toEqual([
      "penguin-go",
      "opencode-go",
      "custom",
    ]);
    expect(
      differing.filter((e) => e.base_url !== undefined).map((e) => [e.provider, e.base_url]),
    ).toEqual([
      ...Array.from({ length: 7 }, () => ["opencode-go", "https://opencode.ai/zen/go"]),
      ["custom", "https://api.atria-asi.ai"],
    ]);
  });

  it("the seed is honest: under a new Project's group tables, every catalog row resolves to its catalog protocol and endpoint from the file alone", () => {
    // presetModelEntries and catalogModelEntries (what "Restore defaults" writes, retired rows
    // included) beside presetProviderTable are the only place the catalog's connection values
    // enter a Project; after that nothing reads the catalog. So the file must say exactly
    // what the catalog says — a row resolving to anything else would run on another endpoint
    // or protocol than its catalog entry names.
    const table = presetProviderTable();
    for (const entry of catalogModelEntries()) {
      const cat = catalogEntryFor(entry.provider, entry.model_id)!;
      const ref = `${entry.provider}/${entry.model_id}`;
      const effective = storedConnection(entry, table);
      expect(effective.clientType, ref).toBe(canonicalClientType(cat.clientType));
      expect(effective.baseUrl, ref).toBe(cat.baseUrl);
    }
  });

  it("presetProviderTable: what a new Project stores per group — endpoint and protocol where every row shares them, nothing for first-party vendors and custom", () => {
    const table = presetProviderTable();
    const fields = Object.fromEntries(
      Object.entries(table).map(([id, connection]) => [id, Object.keys(connection).sort()]),
    );
    const BOTH = ["base_url", "client_type"];
    expect(fields).toEqual({
      tokendance: BOTH,
      // Two protocols across its rows: the relay endpoint they all share goes on the group,
      // the protocols stay on the rows.
      "penguin-go": ["base_url"],
      // Three protocols and two bases: the group takes its gateway endpoint only.
      "opencode-go": ["base_url"],
      openrouter: BOTH,
      fireworks: BOTH,
      siliconflow: BOTH,
      "qwen-pay-as-you-go": BOTH,
      "qwen-token-plan": BOTH,
      modelscope: BOTH,
      // The user's own server: the protocol, and no endpoint to preset.
      vllm: ["client_type"],
    });
    // A group with no gateway endpoint or group pin takes the one its rows all carry.
    expect(table["penguin-go"]!.base_url).toBe(PENGUIN_GO_BASE_URL);
    expect(table.fireworks!.client_type).toBe("openai-chat");
    expect(table.modelscope!.client_type).toBe("openai-responses");
    // First-party vendors route by id to their official clients' own endpoints: no table.
    for (const id of [
      "deepseek",
      "google",
      "openai",
      "anthropic",
      "zhipu",
      "moonshot",
      "minimax",
    ]) {
      expect(catalogGroupConnection(id), id).toBeUndefined();
    }
    expect(catalogGroupConnection("custom")).toBeUndefined();
    expect(catalogGroupConnection("my-own-group")).toBeUndefined();
    // A fresh object every time: a caller writing into one never changes the next.
    table.tokendance!.base_url = "https://proxy.example/v1";
    expect(presetProviderTable().tokendance!.base_url).toBe(
      providerInfo("tokendance")!.gatewayBaseUrl,
    );
  });

  it("presetModelEntries beside the file's own table: an added row stores what its catalog connection differs by, so it runs where the catalog says whatever the group was set to", () => {
    // "Add new models" on a Project whose OpenRouter group goes through a proxy and whose
    // TokenDance table was cleared: the rows it adds still reach their catalog endpoints.
    const file: ProviderTable = {
      openrouter: {
        base_url: "https://proxy.example/openrouter/v1",
        client_type: "openai-responses",
      },
      "penguin-go": { base_url: PENGUIN_GO_BASE_URL },
    };
    const rows = presetModelEntries(file);
    for (const entry of rows) {
      const cat = catalogEntryFor(entry.provider, entry.model_id)!;
      const ref = `${entry.provider}/${entry.model_id}`;
      const effective = storedConnection(entry, file);
      expect(effective.clientType, ref).toBe(canonicalClientType(cat.clientType));
      expect(effective.baseUrl, ref).toBe(cat.baseUrl);
    }
    const openrouter = rows.find((e) => e.provider === "openrouter")!;
    expect(openrouter.base_url).toBe("https://openrouter.ai/api/v1");
    expect(openrouter.client_type).toBeUndefined();
    const tokendance = rows.find((e) => e.provider === "tokendance")!;
    expect([tokendance.client_type, tokendance.base_url]).toEqual([
      "openai-chat",
      "https://tokendance.space/gateway/v1",
    ]);
    expect(rows.find((e) => e.provider === "penguin-go")!.base_url).toBeUndefined();
  });

  it("presetPromotions: a promoted row is seeded with its fraction, a Penguin Go row never is", () => {
    const promotions = presetPromotions();
    expect(promotions).toContainEqual({
      provider: "tokendance",
      modelId: "glm-5.3-flash",
      discount: 0.1,
    });
    // Penguin Go's promotions are the platform's to deliver, at authorization and Sync.
    expect(promotions.filter((p) => p.provider === "penguin-go")).toEqual([]);
  });

  it("gateway models pin explicit protocols and preset base URLs; env fallback stays OPENAI_API_KEY", () => {
    const or = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
    // Dictionary order, newer versions of a series first (gpt-6-* before gpt-5.6-*,
    // gpt-5.6-* before gpt-5.5, opus-4.8 before 4.7) — precomputed in the catalog, no
    // runtime sorting.
    expect(or.map((m) => m.modelId)).toEqual([
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-5",
      "anthropic/claude-opus-4.8",
      "anthropic/claude-opus-4.7",
      "anthropic/claude-sonnet-5",
      "deepseek/deepseek-v4.1-flash",
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-flash-vision-exp",
      "deepseek/deepseek-v4-pro-0813",
      "deepseek/deepseek-v4-pro",
      "google/gemini-3.8-flash",
      "google/gemini-3.7-flash",
      "google/gemini-3.6-flash",
      "google/gemini-3.5-flash",
      "google/gemini-3.5-flash-lite",
      "minimax/minimax-m3",
      "moonshotai/kimi-k3",
      "moonshotai/kimi-k2.6",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "openai/gpt-6-astra",
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
      "qwen/qwen3.8-27b",
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
      // Every gateway row pins a client type — never left to MMSP's family routing, which
      // would throw outright on every owner-prefixed id (openai/gpt-5.6-*, anthropic/claude-*)
      // and send deepseek-ai/* to DeepSeek's client. Whatever the upstream, OpenRouter serves the
      // Responses API at {base}/responses, so the whole group pins it.
      expect(m.clientType, m.modelId).toBe("openai-responses");
      expect(m.baseUrl).toBe("https://openrouter.ai/api/v1");
    }
    // The Responses client reads the same OPENAI_* pair as the Chat Completions one the other
    // gateways pin, so the env-fallback hint is the same across every gateway group.
    for (const m of or) {
      expect(resolveModelEnv(m.modelId, m.clientType)?.envKey, m.modelId).toBe("OPENAI_API_KEY");
    }
    const fw = MODEL_CATALOG.filter((m) => m.provider === "fireworks");
    // Fireworks spells a version's dot as `p` (deepseek-v4p1-flash, glm-5p3); newer versions of
    // a series still come first, whatever that spelling does to plain dictionary order.
    expect(fw.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["accounts/fireworks/models/deepseek-v4p1-flash", 1048576, true],
      ["accounts/fireworks/models/deepseek-v4-flash-0731", 1000000, false],
      ["accounts/fireworks/models/deepseek-v4-flash", 1000000, false],
      ["accounts/fireworks/models/deepseek-v4-pro-0813", 1048576, false],
      ["accounts/fireworks/models/deepseek-v4-pro", 1000000, false],
      ["accounts/fireworks/models/glm-5p3", 1048576, false],
      ["accounts/fireworks/models/glm-5p3-flash", 1048576, true],
      ["accounts/fireworks/models/glm-5p2", 1000000, false],
      ["accounts/fireworks/models/inkling", 1000000, true],
      ["accounts/fireworks/models/kimi-k3", 1000000, true],
      ["accounts/fireworks/models/kimi-k2p7-code", 262144, true],
      ["accounts/fireworks/models/minimax-m3", 524288, true],
      ["accounts/fireworks/models/qwen3p8-max", 1000000, true],
    ]);
    for (const m of fw) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://api.fireworks.ai/inference/v1");
    }
    const sf = MODEL_CATALOG.filter((m) => m.provider === "siliconflow");
    // Dictionary order is case-insensitive (as in qwen-pay-as-you-go, where ZHIPU/GLM-5.3-Flash
    // sorts last): Pro/ and Qwen/ fall between moonshotai/ and tencent/, and GLM-5.3 comes before
    // GLM-5.2 as the newer version.
    expect(sf.map((m) => m.modelId)).toEqual([
      "deepseek-ai/DeepSeek-V4-Flash",
      "deepseek-ai/DeepSeek-V4-Pro",
      "meituan-longcat/LongCat-2.0",
      "moonshotai/Kimi-K2.7-Code",
      "Pro/moonshotai/Kimi-K2.6",
      "Qwen/Qwen3.6-35B-A3B",
      "tencent/Hy4-preview",
      "zai-org/GLM-5.3",
      "zai-org/GLM-5.2",
    ]);
    for (const m of sf) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://api.siliconflow.cn/v1");
    }
    const qtp = MODEL_CATALOG.filter((m) => m.provider === "qwen-token-plan");
    expect(qtp.map((m) => m.modelId)).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-v4-pro-0813",
      "glm-5.3",
      "qwen3.8-flash",
      "qwen3.8-max",
      "qwen3.7-plus",
    ]);
    for (const m of qtp) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
    }
    // Vision flags per the plan's supported-model table and the model pages: V4.1 Flash and
    // the three Qwen rows see images, the V4 Pro 0813 and GLM-5.3 rows are text only.
    expect(qtp.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["deepseek-v4.1-flash", 1000000, true],
      ["deepseek-v4-pro-0813", 1000000, false],
      ["glm-5.3", 1048576, false],
      ["qwen3.8-flash", 1000000, true],
      ["qwen3.8-max", 1000000, true],
      ["qwen3.7-plus", 1000000, true],
    ]);
    const td = MODEL_CATALOG.filter((m) => m.provider === "tokendance");
    // Dictionary order by upstream id; vision flags and context windows from TokenDance's
    // public catalog API.
    expect(td.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["deepseek-v4-flash-0731", 1048576, false],
      ["deepseek-v4-flash-vision-exp", 1000000, true],
      ["deepseek-v4-pro-0813", 1000000, false],
      ["deepseek-v4.1-flash", 1000000, true],
      ["dots-3-note-preview", 512000, true],
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
      ["glm-5.3-flash", 0.1, [0.72, 2.52, 0.207]],
      ["glm-5.3", 0.1, [7.2, 25.2, 1.8]],
      ["deepseek-v4-pro-0813", 0.1, [4.05, 12.15, 0.405]],
      ["deepseek-v4-flash-0731", 0.1, [1.35, 4.05, 0.135]],
      ["kimi-k3", 0.4, [12, 60, 0.96]],
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
    // Exactly those nine carry a flat discount; every other row bills its list price
    // unchanged. One of those others declares DeepSeek's peak/off-peak schedule instead, so
    // the rows are compared at a PEAK instant — 2026-09-10 is a Thursday, and 10:00 Beijing is
    // inside the morning window — because effectivePricing halves it off-peak by design.
    expect(
      td
        .filter((m) => m.discount !== undefined)
        .map((m) => m.modelId)
        .sort(),
    ).toEqual(discounted.map(([id]) => id).sort());
    const peakInstant = new Date("2026-09-10T10:00:00+08:00");
    for (const m of td.filter((x) => x.discount === undefined)) {
      expect(effectivePricing(m, peakInstant), m.modelId).toEqual(m.pricing);
    }
    // The rows that follow the vendor's schedule instead of a gateway promotion (one of them
    // retired), at the same peak tier the direct deepseek-flash row stores: CNY 0.04 / 2 / 8.
    const tdScheduled = td.filter((m) => m.offPeakDiscount !== undefined).map((m) => m.modelId);
    expect(tdScheduled).toEqual(["deepseek-v4-flash-vision-exp", "deepseek-v4.1-flash"]);
    for (const id of tdScheduled) {
      const row = td.find((m) => m.modelId === id)!;
      expect(row.offPeakDiscount, id).toBe(DEEPSEEK_OFF_PEAK);
      expect(row.discount, id).toBeUndefined();
      expect([row.pricing!.cache_read, row.pricing!.cache_write, row.pricing!.output], id).toEqual([
        0.005714, 0.285714, 1.142857,
      ]);
    }
    // The one free row of the group: CNY 0 on every bucket, no discount decoration, a 512K
    // window, and the seller's own words for the name, its "Free" tag included, as the
    // OpenRouter "(free)" rows keep theirs — in ASCII parentheses, not the listing's full-width
    // ones.
    const dots = td.find((m) => m.modelId === "dots-3-note-preview")!;
    expect(dots.displayName).toBe("Dots3-Note Preview (Free)");
    expect(dots.contextWindow).toBe(512000);
    expect(dots.discount).toBeUndefined();
    expect([dots.pricing!.cache_read, dots.pricing!.cache_write, dots.pricing!.output]).toEqual([
      0, 0, 0,
    ]);
    expect(dots.supportsVision).toBe(true);
    // Display names are the seller's own spelling, not a prettified one.
    expect(td.filter((m) => m.modelId.startsWith("seed-")).map((m) => m.displayName)).toEqual([
      "Seed-2.1-Pro",
      "Seed-2.1-Turbo",
      "Seed-Evolving",
    ]);
    // The stored list prices themselves, in the catalog's own argument order.
    const tdQwen = td.find((m) => m.modelId === "qwen3.8-max")!.pricing!;
    expect([tdQwen.cache_read, tdQwen.cache_write, tdQwen.output]).toEqual([
      0.214286, 1.714286, 5.142857,
    ]);
    const tdFlash = td.find((m) => m.modelId === "glm-5.3-flash")!.pricing!;
    expect([tdFlash.cache_read, tdFlash.cache_write, tdFlash.output]).toEqual([
      0.032857, 0.114286, 0.4,
    ]);
    // qwen3.8-flash at 0.1 / 0.8 / 2.7 CNY, undiscounted: TokenDance's own figures. The same id
    // also sits in both Qwen groups at Qwen's direct list price, pinned separately further down;
    // the two sellers happen to charge the same since Qwen's 2026-09-16 re-pricing.
    const tdQwenFlash = td.find((m) => m.modelId === "qwen3.8-flash")!.pricing!;
    expect([tdQwenFlash.cache_read, tdQwenFlash.cache_write, tdQwenFlash.output]).toEqual([
      0.014286, 0.114286, 0.385714,
    ]);
    // hy4-preview is the same upstream model as OpenRouter's tencent/hy4-preview, sold twice.
    // Each row carries its own seller's price and its own published context window, so the two
    // stay apart rather than converge on one number.
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
    // Case-insensitive dictionary order with newer versions first: kimi-k3 before kimi-k2.8.
    expect(qpayg.map((m) => [m.modelId, m.contextWindow, m.supportsVision])).toEqual([
      ["deepseek-v4.1-flash", 1000000, true],
      ["kimi/kimi-k3", 1048576, true],
      ["kimi/kimi-k2.8-preview", 1048576, true],
      ["qwen3.8-flash", 1000000, true],
      ["qwen3.8-max", 1000000, true],
      ["qwen3.7-plus", 1000000, true],
      ["ZHIPU/GLM-5.3-Flash", 1000000, true],
    ]);
    for (const m of qpayg) {
      expect(m.clientType).toBe("openai-chat");
      expect(m.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    }
    const ms = MODEL_CATALOG.filter((m) => m.provider === "modelscope");
    // Preset rows keep ModelScope's upstream ids and pin the Responses protocol served by its
    // api-inference endpoint, while the group credential remains ModelScope's token. Pricing is
    // deliberately absent (see UNPRICED above); the windows and vision flags repeat what other
    // rows of the same models record.
    expect(
      ms.map((m) => [m.modelId, m.contextWindow, m.supportsVision, m.clientType, m.baseUrl]),
    ).toEqual([
      [
        "deepseek-ai/DeepSeek-V4.1-Flash",
        1000000,
        true,
        "openai-responses",
        "https://api-inference.modelscope.cn/v1",
      ],
      [
        "Qwen/Qwen3.8-27B",
        262144,
        true,
        "openai-responses",
        "https://api-inference.modelscope.cn/v1",
      ],
      [
        "Qwen/Qwen3.8-Flash-Next",
        262144,
        true,
        "openai-responses",
        "https://api-inference.modelscope.cn/v1",
      ],
    ]);
    expect(ms.every((m) => m.pricing === undefined)).toBe(true);
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
        undefined,
        undefined,
        // Standard tier at <=512K input: cache read 0.06, input 0.30, output 1.20 USD/Mtok.
        { unit: "usd_per_mtok", cache_read: 0.06, cache_write: 0.3, output: 1.2 },
      ],
    ]);
    expect(providerInfo("minimax")!.envBaseUrlKey).toBe("MINIMAX_BASE_URL");
    expect(providerInfo("minimax")!.gatewayBaseUrl).toBeUndefined();
    // Routed through MMSP's OpenAI client -> when the credential is left blank it reads OPENAI_API_KEY (not the provider's own env var name).
    for (const id of [
      "openrouter",
      "fireworks",
      "siliconflow",
      "tokendance",
      "opencode-go",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
      "modelscope",
      "vllm",
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
    expect(providerInfo("modelscope")!.gatewayBaseUrl).toBe(
      "https://api-inference.modelscope.cn/v1",
    );
    const GATEWAYS = [
      "openrouter",
      "fireworks",
      "siliconflow",
      "tokendance",
      "opencode-go",
      "qwen-token-plan",
      "qwen-pay-as-you-go",
      "modelscope",
    ];
    for (const p of MODEL_PROVIDERS) {
      if (!GATEWAYS.includes(p.id)) {
        expect(p.gatewayBaseUrl, p.id).toBeUndefined();
      }
    }
    const gateway = [...or, ...fw, ...sf, ...td, ...qtp, ...qpayg, ...ms];
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
    // stores the real cache-hit price (not the input price) — cache_read is its own billing
    // bucket in the cost center. cache_write repeats input (no per-token cache-write fee).
    // What the 3.6 row stores is the LIST price; the launch discount it also declares, and
    // the halved rate it bills today, are asserted with the rest of the 3.x Flash rows below.
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
    // direct-vendor row for that model (and as MMSP's registry): 1048576, not 1000000.
    expect(catalogEntryFor("openrouter", "google/gemini-3.5-flash")!.contextWindow).toBe(1048576);
    expect(catalogEntryFor("google", "gemini-3.5-flash")!.contextWindow).toBe(1048576);

    // In a new Project every gateway preset resolves to a base URL, and so does the custom
    // group's preset, whose group implies no endpoint at all; direct rows never do.
    const vendors = ["deepseek", "google", "openai", "anthropic", "zhipu", "moonshot", "minimax"];
    expect(MODEL_CATALOG.filter((m) => vendors.includes(m.provider) && m.baseUrl)).toEqual([]);
    const customPresets = MODEL_CATALOG.filter((m) => m.provider === "custom");
    const withBaseUrl = presetModelEntries().filter(
      (e) => storedConnection(e).baseUrl !== undefined,
    );
    expect(withBaseUrl.map((e) => [e.provider, e.model_id]).sort()).toEqual(
      [
        ...gateway,
        ...customPresets,
        ...MODEL_CATALOG.filter((m) => m.provider === "penguin-go"),
        ...MODEL_CATALOG.filter((m) => m.provider === "opencode-go"),
      ]
        // A retired gateway row keeps its pin in the catalog but is not a preset.
        .filter((m) => m.retired !== true)
        .map((m) => [m.provider, m.modelId])
        .sort(),
    );
  });

  it("direct-vendor groups: auto-routed (no client_type / base_url), newest series first", () => {
    // These groups' ids are auto-routed by MMSP (each begins with its vendor's family), so
    // they carry neither client_type nor a preset base URL — the opposite of the gateway
    // groups above.
    for (const id of ["google", "anthropic", "zhipu", "moonshot", "minimax", "deepseek"]) {
      for (const m of MODEL_CATALOG.filter((e) => e.provider === id)) {
        expect(m.clientType, m.modelId).toBeUndefined();
        expect(m.baseUrl, m.modelId).toBeUndefined();
      }
    }
    // Dictionary order by tier with newer versions of a tier first (same rule the OpenRouter
    // block follows for the identical Claude line-up).
    expect(MODEL_CATALOG.filter((m) => m.provider === "google").map((m) => m.modelId)).toEqual([
      "gemini-3.8-flash",
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
    // Gemini 3.6 / 3.7 / 3.8 Flash: Google halves all three of them through 2026-12-31, and
    // all six of their rows — direct and on OpenRouter — store Google's list price and
    // declare that launch discount in `discount`, so the list survives the promotion and
    // effectivePricing yields the 0.075/0.75/3.75 either seller bills today.
    for (const [provider, modelId] of [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.7-flash"],
      ["google", "gemini-3.6-flash"],
      ["openrouter", "google/gemini-3.8-flash"],
      ["openrouter", "google/gemini-3.7-flash"],
      ["openrouter", "google/gemini-3.6-flash"],
    ] as const) {
      const row = catalogEntryFor(provider, modelId)!;
      expect([row.contextWindow, row.supportsVision, row.discount], modelId).toEqual([
        1048576,
        true,
        0.5,
      ]);
      expect(
        [row.pricing!.cache_read, row.pricing!.cache_write, row.pricing!.output],
        modelId,
      ).toEqual([0.15, 1.5, 7.5]);
      const billed = effectivePricing(row)!;
      expect([billed.cache_read, billed.cache_write, billed.output], modelId).toEqual([
        0.075, 0.75, 3.75,
      ]);
    }
    // No other Gemini row carries a launch discount: Google's pricing page marks one on the
    // 3.6 / 3.7 / 3.8 Flash generations and on nothing else in this catalog, so these rows
    // bill exactly the list price they store. The numbers are pinned because none of them is
    // the Flash list price above and each is a genuine other tier, not a hidden promotion —
    // re-read 2026-09-09: 3.5 Flash $1.50 / $9.00 / $0.15 cache hit, 3.5 Flash-Lite
    // $0.30 / $2.50 / $0.03, 3.1 Flash-Lite $0.25 / $1.50 / $0.025, 3.1 Pro Preview ≤200K
    // $2 / $12 / $0.20, the legacy 3 Flash Preview $0.50 / $3 / $0.05, and OpenRouter's default
    // endpoints billing the 3.5 pair at exactly that list with `discount: 0`.
    for (const [provider, modelId, list] of [
      ["google", "gemini-3.5-flash", [0.15, 1.5, 9]],
      ["google", "gemini-3.5-flash-lite", [0.03, 0.3, 2.5]],
      ["google", "gemini-3.1-flash-lite", [0.025, 0.25, 1.5]],
      ["google", "gemini-3.1-pro-preview", [0.2, 2, 12]],
      ["google", "gemini-3-flash-preview", [0.05, 0.5, 3]],
      ["openrouter", "google/gemini-3.5-flash", [0.15, 1.5, 9]],
      ["openrouter", "google/gemini-3.5-flash-lite", [0.03, 0.3, 2.5]],
    ] as const) {
      const row = catalogEntryFor(provider, modelId)!;
      expect(row.discount, modelId).toBeUndefined();
      expect(
        [row.pricing!.cache_read, row.pricing!.cache_write, row.pricing!.output],
        modelId,
      ).toEqual(list);
      expect(effectivePricing(row), modelId).toEqual(row.pricing);
    }
    // GLM-5.3 is listed both directly and on OpenRouter; the gateway runs no discount, so
    // the two rows agree on price and differ only in context window and protocol pin.
    const glm53or = catalogEntryFor("openrouter", "z-ai/glm-5.3")!;
    expect([glm53or.contextWindow, glm53or.supportsVision]).toEqual([1048576, false]);
    expect([
      glm53or.pricing!.cache_read,
      glm53or.pricing!.cache_write,
      glm53or.pricing!.output,
    ]).toEqual([0.26, 1.4, 4.4]);
    // GLM-5.3: text-only, 1M context, and Z.AI's
    // published USD price — identical to glm-5.2.
    const glm53 = catalogEntryFor("zhipu", "glm-5.3")!;
    expect([glm53.contextWindow, glm53.supportsVision]).toEqual([1000000, false]);
    expect(glm53.pricing).toEqual(catalogEntryFor("zhipu", "glm-5.2")!.pricing);
    // GLM-5.3 Flash is listed both directly and on OpenRouter, and the two rows deliberately
    // disagree on price: the direct row keeps Z.AI's list price while the gateway row stores
    // the 50%-off rate OpenRouter's default endpoint (DeepInfra) bills, so the gateway figures
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
    // Vision agrees on both routes: the direct row's MMSP GLM client forwards image_url
    // parts for this one id, and the gateway row's generic Responses client carries them for
    // any id. It is the only vision-capable row in the direct Z.AI group.
    expect(glm53f.clientType).toBeUndefined();
    expect(glm53for.clientType).toBe("openai-responses");
    for (const m of MODEL_CATALOG.filter((m) => m.provider === "zhipu")) {
      expect(m.supportsVision, m.modelId).toBe(m.modelId === "glm-5.3-flash");
    }
    // Both rows share one display name, as the other dual-listed models do.
    expect(glm53f.displayName).toBe("GLM-5.3 Flash");
    expect(glm53for.displayName).toBe("GLM-5.3 Flash");
    // Qwen 3.8 Flash in both Qwen groups: official CNY list price (0.8 input / 0.1 cache hit /
    // 2.7 output per MTok since the 2026-09-16 re-read) at the catalog's 7:1 display rate, 1M
    // context, vision through the groups' openai-chat client.
    for (const provider of ["qwen-pay-as-you-go", "qwen-token-plan"]) {
      const q38f = catalogEntryFor(provider, "qwen3.8-flash")!;
      expect([q38f.contextWindow, q38f.supportsVision, q38f.displayName], provider).toEqual([
        1000000,
        true,
        "Qwen 3.8 Flash",
      ]);
      expect(
        [q38f.pricing!.cache_read, q38f.pricing!.cache_write, q38f.pricing!.output],
        provider,
      ).toEqual([0.014286, 0.114286, 0.385714]);
    }
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
    // that codename too rather than leaving the variant unnamed; likewise DeepSeek's undated
    // `deepseek-v4-pro` is the 0813 release the gateways date, and says so.
    for (const [directProvider, directId, gatewayProvider, gatewayId] of [
      ["deepseek", "deepseek-flash", "openrouter", "deepseek/deepseek-v4.1-flash"],
      ["deepseek", "deepseek-flash", "fireworks", "accounts/fireworks/models/deepseek-v4p1-flash"],
      ["deepseek", "deepseek-v4-pro", "openrouter", "deepseek/deepseek-v4-pro-0813"],
      ["deepseek", "deepseek-v4-pro", "qwen-token-plan", "deepseek-v4-pro-0813"],
      ["openai", "gpt-6-astra", "openrouter", "openai/gpt-6-astra"],
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
    // DeepSeek rows carry the official PEAK tier; the off-peak tier is exactly half, and is
    // applied from the row's schedule rather than stored (see the off-peak schedules block
    // below). Both were re-read 2026-09-16: V4.1 Flash at CNY 0.04 / 2 / 8, and V4 Pro — the
    // 0813 release, its display name now says — unchanged at 0.30 / 9 / 27.
    const flash = catalogEntryFor("deepseek", "deepseek-flash")!.pricing!;
    expect([cnyOf(flash.cache_read), cnyOf(flash.cache_write), cnyOf(flash.output)]).toEqual([
      0.04, 2, 8,
    ]);
    const proRow = catalogEntryFor("deepseek", "deepseek-v4-pro")!;
    expect(proRow.displayName).toBe("DeepSeek V4 Pro 0813");
    const pro = proRow.pricing!;
    expect([cnyOf(pro.cache_read), cnyOf(pro.cache_write), cnyOf(pro.output)]).toEqual([
      0.3, 9, 27,
    ]);
    const k3 = MODEL_CATALOG.find(
      (m) => m.provider === "moonshot" && m.modelId === "kimi-k3",
    )!.pricing!;
    expect([cnyOf(k3.cache_read), cnyOf(k3.cache_write), cnyOf(k3.output)]).toEqual([2, 20, 100]);
    const k26 = MODEL_CATALOG.find(
      (m) => m.provider === "moonshot" && m.modelId === "kimi-k2.6",
    )!.pricing!;
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
    // The V4.1 Flash listing (added 2026-09-10) is the one OpenRouter DeepSeek row on a
    // schedule: its base price is the PEAK tier and `pricing.overrides` bill exactly half in
    // DeepSeek's own off-peak windows, so the row stores the peak figures and declares the
    // shared schedule rather than a flat gateway discount.
    const flash41 = catalogEntryFor("openrouter", "deepseek/deepseek-v4.1-flash")!;
    expect([flash41.contextWindow, flash41.supportsVision]).toEqual([1048576, true]);
    expect([
      flash41.pricing!.cache_read,
      flash41.pricing!.cache_write,
      flash41.pricing!.output,
    ]).toEqual([0.006, 0.3, 1.2]);
    expect(flash41.offPeakDiscount).toBe(DEEPSEEK_OFF_PEAK);
    expect(flash41.discount).toBeUndefined();
  });

  it("the OpenAI line-up is listed both directly and on OpenRouter, and only the gateway rows speak Responses", () => {
    // Every direct OpenAI model has an OpenRouter counterpart and vice versa: `openai/<id>`
    // is exactly the gateway spelling, so the two groups must stay in lockstep when either
    // gains a model.
    const direct = MODEL_CATALOG.filter((m) => m.provider === "openai").map((m) => m.modelId);
    expect(direct).toEqual([
      "gpt-6-astra",
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
    // Direct rows are auto-routed by id (the gpt- family names OpenAI's official client); only
    // the gateway rows pin a protocol, and they pin Responses.
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
    // GPT-6 Astra's cache_write bucket carries OpenAI's published $12.5 cache-write price
    // rather than the $10 input rate: the buckets have no slot for input that is never
    // written to cache.
    expect(price("openai", "gpt-6-astra")).toEqual([1, 12.5, 50]);
    expect(price("openai", "gpt-5.6")).toEqual([0.5, 5, 30]);
    expect(price("openai", "gpt-5.6-terra")).toEqual([0.2, 2, 12]);
    expect(price("openai", "gpt-5.6-luna")).toEqual([0.02, 0.2, 1.2]);
    // Gateway rows store what OpenRouter bills, so they diverge from the list price wherever
    // a promotion is running: sol is at `discount: 0.5`, terra and luna are back at full rate
    // after theirs lapsed (the 2x drift this re-read corrected).
    expect(price("openrouter", "openai/gpt-5.6-sol")).toEqual([0.25, 3.125, 15]);
    expect(price("openrouter", "openai/gpt-5.6-terra")).toEqual([0.2, 2.5, 12]);
    expect(price("openrouter", "openai/gpt-5.6-luna")).toEqual([0.02, 0.25, 1.2]);
    // GPT-6 Astra runs no promotion (`discount: 0`) and its default endpoint is OpenAI's own,
    // so every bucket matches the direct row.
    expect(price("openrouter", "openai/gpt-6-astra")).toEqual([1, 12.5, 50]);
    expect(catalogEntryFor("openrouter", "openai/gpt-6-astra")!.contextWindow).toBe(1050000);
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
    // Case/whitespace-insensitive match (MMSP lowercases client types before routing).
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

describe("resolveModelEnv (PRN-021: env fallback resolved by MMSP's routing rule)", () => {
  it("keeps Penguin Go relay credentials separate from both vendor protocols", () => {
    expect(resolveProviderModelEnv("penguin-go", "gemini-3.8-flash")?.envKey).toBe(
      "PENGUIN_GO_API_KEY",
    );
    expect(resolveProviderModelEnv("penguin-go", "deepseek-flash", "openai-chat")?.envKey).toBe(
      "PENGUIN_GO_API_KEY",
    );
    expect(
      resolveProviderModelEnv("modelscope", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-official")
        ?.envKey,
    ).toBe("OPENAI_API_KEY");
    expect(resolveProviderModelEnv("deepseek", "deepseek-v4-pro")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveProviderModelEnv("openrouter", "any-model", "openai-chat")?.envKey).toBe(
      "OPENAI_API_KEY",
    );
  });

  it("routedClientType: a pinned client type wins, else the family the id begins with names the official client, and an unknown pin routes nowhere", () => {
    expect(routedClientType("deepseek-flash")).toBe("deepseek-official");
    expect(routedClientType("DeepSeek-V4-Pro")).toBe("deepseek-official"); // case-insensitive
    expect(routedClientType("claude-opus-4-8")).toBe("anthropic-official");
    expect(routedClientType("gemini-3.8-flash")).toBe("gemini-official");
    expect(routedClientType("gemini-embedding-001")).toBe("gemini-official");
    expect(routedClientType("gpt-6-astra")).toBe("openai-official");
    // OpenAI's official client hands its embedding ids to the Embeddings client, pinned or not.
    expect(routedClientType("text-embedding-3-large")).toBe("openai-embedding");
    expect(routedClientType("text-embedding-3-large", "openai-official")).toBe("openai-embedding");
    expect(routedClientType("glm-5.3-flash")).toBe("zai-official");
    expect(routedClientType("kimi-k3")).toBe("moonshot-official");
    expect(routedClientType("MiniMax-M3")).toBe("minimax-official");
    // A pin wins over the id, lowercased as MMSP lowercases it; the bare openai alias is canonicalized.
    expect(routedClientType("deepseek-v4-pro", "openai-chat")).toBe("openai-chat");
    expect(routedClientType("deepseek-v4-pro", " OpenAI-Responses ")).toBe("openai-responses");
    expect(routedClientType("deepseek-v4-pro", "openai")).toBe("openai-chat");
    expect(routedClientType("deepseek-v4-pro", "")).toBe("deepseek-official");
    // A pin MMSP does not have is refused, never routed by the id instead.
    expect(routedClientType("deepseek-flash", "deepseek-v4")).toBeUndefined();
    expect(routedClientType("deepseek-flash", "constructor")).toBeUndefined();
    // A family is a PREFIX: a gateway spelling that merely contains one routes nowhere...
    expect(routedClientType("anthropic/claude-fable-5")).toBeUndefined();
    expect(routedClientType("moonshotai/kimi-k3")).toBeUndefined();
    expect(routedClientType("totally-unknown-model")).toBeUndefined();
    // ...while an owner prefix that IS a family still routes: `deepseek-ai/…` reaches DeepSeek's
    // official client, which is why the vLLM / SiliconFlow / ModelScope rows pin their protocol.
    expect(routedClientType("deepseek-ai/DeepSeek-V4.1-Flash")).toBe("deepseek-official");
  });

  it("first-party model ids route to the official client's env var", () => {
    expect(resolveModelEnv("deepseek-v4-pro")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("deepseek-v4.1-flash")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("deepseek-v4.1-flash")?.envBaseUrlKey).toBe("DEEPSEEK_BASE_URL");
    // The released direct id begins with the family, so it routes on its own — no pin needed.
    expect(resolveModelEnv("deepseek-flash")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("deepseek-flash", "deepseek-official")?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelEnv("claude-opus-4-8")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-4-6")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gpt-5.5-pro")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("gpt-5.6-luna")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("gpt-6-astra")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("gpt-6-astra")?.envBaseUrlKey).toBe("OPENAI_BASE_URL");
    expect(resolveModelEnv("glm-5.2")?.envKey).toBe("ZAI_API_KEY");
    expect(resolveModelEnv("glm-5.3")?.envKey).toBe("ZAI_API_KEY");
    expect(resolveModelEnv("glm-5.3-flash")?.envKey).toBe("ZAI_API_KEY");
    expect(resolveModelEnv("glm-5.3-flash")?.envBaseUrlKey).toBe("ZAI_BASE_URL");
    expect(resolveModelEnv("kimi-k2.6")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    expect(resolveModelEnv("kimi-k3")?.envKey).toBe("MOONSHOT_API_KEY");
    expect(resolveModelEnv("kimi-k3")?.envBaseUrlKey).toBe("MOONSHOT_BASE_URL");
    expect(resolveModelEnv("gemini-3.6-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gemini-3.7-flash")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("gemini-3.5-flash-lite")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("claude-fable-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-opus-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("claude-sonnet-5")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("MiniMax-M3")?.envKey).toBe("MINIMAX_API_KEY");
    expect(resolveModelEnv("MiniMax-M3")?.envBaseUrlKey).toBe("MINIMAX_BASE_URL");
    // A whole family, not a generation: ids released later inherit the answer.
    expect(resolveModelEnv("MiniMax-M4")?.envKey).toBe("MINIMAX_API_KEY");
    expect(resolveModelEnv("minimax-m3-preview")?.envKey).toBe("MINIMAX_API_KEY");
  });

  it("an explicit client_type selects the client, whatever the model id", () => {
    expect(resolveModelEnv("deepseek-v4-pro", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("zai-org/GLM-5.2", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    // The deprecated bare "openai" alias (pre-0.4.2 configs) still resolves the same pair.
    expect(resolveModelEnv("deepseek-v4-pro", "openai")?.envKey).toBe("OPENAI_API_KEY");
    // The generic protocol clients read the pair of the vendor whose protocol they speak.
    expect(resolveModelEnv("deepseek-v4-pro", "openai-responses")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("deepseek-v4-pro", "ant-messages")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("deepseek-v4-pro", "ant-messages")?.envBaseUrlKey).toBe(
      "ANTHROPIC_BASE_URL",
    );
    expect(resolveModelEnv("any-model", "google-genai")?.envKey).toBe("GEMINI_API_KEY");
    // MMSP 0.5.1 keeps google-genai's 0.5.0 name as an alias.
    expect(resolveModelEnv("any-model", "gemini-generate-content")?.envKey).toBe("GEMINI_API_KEY");
    expect(resolveModelEnv("any-model", "openai-embedding")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("Qwen/Qwen3.8", "openai-chat-vllm-adapter")?.envKey).toBe(
      "OPENAI_API_KEY",
    );
    // An official client pinned by name serves any id the endpoint answers for.
    expect(resolveModelEnv("custom-model", "minimax-official")?.envBaseUrlKey).toBe(
      "MINIMAX_BASE_URL",
    );
    expect(resolveModelEnv("custom-model", "Anthropic-Official")?.envKey).toBe("ANTHROPIC_API_KEY");
  });

  it("generic protocol client types resolve regardless of the model id: ant-messages reads ANTHROPIC_*, openai-responses / openai-chat read OPENAI_*", () => {
    expect(resolveModelEnv("any-model", "ant-messages")?.envKey).toBe("ANTHROPIC_API_KEY");
    expect(resolveModelEnv("any-model", "ant-messages")?.envBaseUrlKey).toBe("ANTHROPIC_BASE_URL");
    expect(resolveModelEnv("any-model", "openai-responses")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("any-model", "openai-chat")?.envKey).toBe("OPENAI_API_KEY");
    expect(resolveModelEnv("any-model", "openai-chat")?.envBaseUrlKey).toBe("OPENAI_BASE_URL");
  });

  it("unroutable entries return undefined (MMSP would refuse them): an id of no known family, or a client type MMSP does not have", () => {
    expect(resolveModelEnv("totally-unknown-model")).toBeUndefined();
    expect(resolveModelEnv("xiaomi/mimo-v2.5")).toBeUndefined();
    expect(resolveModelEnv("anthropic/claude-opus-4.8")).toBeUndefined();
    // The vendor client types of MMSP 0.4 (MMSP) name no client any more.
    expect(resolveModelEnv("MiniMax-M3", "minimax-m3")).toBeUndefined();
    expect(resolveModelEnv("deepseek-flash", "deepseek-v4")).toBeUndefined();
    expect(resolveModelEnv("gemini-3.8-flash", "gemini-3.8")).toBeUndefined();
  });

  it("catalog invariant: each model's resolved client uses its provider's documented environment variables", () => {
    for (const m of MODEL_CATALOG) {
      const env = resolveModelEnv(m.modelId, m.clientType);
      const provider = providerInfo(m.provider)!;
      expect(env, `${m.provider}/${m.modelId}`).toBeDefined();
      if (m.provider === "penguin-go" || m.provider === "modelscope") {
        // Aggregate groups mix routed clients behind one group credential, so their
        // provider-scoped environment name intentionally differs from some client variables.
        expect(resolveProviderModelEnv(m.provider, m.modelId, m.clientType)).toEqual({
          envKey: provider.envKey,
          envBaseUrlKey: provider.envBaseUrlKey,
        });
        continue;
      }
      if (m.provider === "custom") {
        // The custom group's pair is the fallback for its OpenAI-protocol default; an entry
        // pinned to another generic protocol reads that protocol's pair instead, exactly as a
        // user-added custom model on ant-messages does. The one preset here is on Messages.
        expect(env!.envKey, m.modelId).toBe("ANTHROPIC_API_KEY");
        expect(env!.envBaseUrlKey, m.modelId).toBe("ANTHROPIC_BASE_URL");
        continue;
      }
      if (m.provider === "opencode-go" && m.clientType === "ant-messages") {
        // OpenCode Go's group pair is the OPENAI_* one its Chat Completions and Responses rows
        // read; its Messages rows read the Anthropic client's pair, the same split as custom.
        expect(env!.envKey, m.modelId).toBe("ANTHROPIC_API_KEY");
        expect(env!.envBaseUrlKey, m.modelId).toBe("ANTHROPIC_BASE_URL");
        continue;
      }
      expect(env!.envKey, m.modelId).toBe(provider.envKey);
      expect(env!.envBaseUrlKey, m.modelId).toBe(provider.envBaseUrlKey);
    }
  });

  it("catalog invariant: every built-in row in a vendor group is routable, by its pinned protocol or by its id", () => {
    const vendorRows = MODEL_CATALOG.filter((m) => isVendorGroup(m.provider));
    // A guard is only a guard if it is looking at something: the vendor groups are where
    // ids alone decide routing, and they hold a large part of the catalog.
    expect(vendorRows.length).toBeGreaterThan(20);
    for (const m of vendorRows) {
      expect(
        unroutableVendorModel(m.provider, m.modelId, m.clientType),
        `${m.provider}/${m.modelId}`,
      ).toBe(false);
    }
  });

  it("unroutableVendorModel judges only the groups that route by id, and only once an id is typed", () => {
    // A vendor group: nothing carries a protocol, so the id has to be one MMSP places.
    expect(unroutableVendorModel("deepseek", "qwen/qwen3.8-flash-next")).toBe(true);
    expect(unroutableVendorModel("deepseek", "deepseek-v4-pro")).toBe(false);
    expect(unroutableVendorModel("deepseek", "deepseek-flash")).toBe(false);
    // An id of another family becomes routable the moment the entry pins the protocol itself;
    // a pin MMSP does not know makes the entry unroutable whatever the id.
    expect(unroutableVendorModel("deepseek", "qwen/qwen3.8-flash-next", "openai-chat")).toBe(false);
    expect(unroutableVendorModel("deepseek", "deepseek-flash", "deepseek-v4")).toBe(true);
    // Every other group decides the protocol without consulting the id.
    expect(unroutableVendorModel("custom", "qwen/qwen3.8-flash-next")).toBe(false);
    expect(unroutableVendorModel("openrouter", "qwen/qwen3.8-flash-next")).toBe(false);
    expect(unroutableVendorModel("tokendance", "qwen/qwen3.8-flash-next")).toBe(false);
    expect(unroutableVendorModel("vllm", "qwen/qwen3.8-flash-next")).toBe(false);
    expect(unroutableVendorModel("my-own-group", "qwen/qwen3.8-flash-next")).toBe(false);
    // An entry still being typed is not a routing failure.
    expect(unroutableVendorModel("deepseek", "")).toBe(false);
    expect(unroutableVendorModel("deepseek", "   ")).toBe(false);
  });

  it("isVendorGroup: catalog-known, not custom, no gateway endpoint and no group-level protocol pin", () => {
    const vendors = ["deepseek", "google", "openai", "anthropic", "zhipu", "moonshot", "minimax"];
    for (const id of vendors) {
      expect(isVendorGroup(id), id).toBe(true);
    }
    // The Penguin Go relay pins its protocol per row rather than per group, so a model added
    // there by hand would be routed by its id exactly as in any other vendor group.
    expect(isVendorGroup("penguin-go")).toBe(true);
    // Gateways carry an endpoint, two groups pin a protocol, and custom / user-defined
    // groups exist precisely so the protocol can be chosen.
    for (const id of ["tokendance", "openrouter", "fireworks", "siliconflow", "vllm", "custom"]) {
      expect(isVendorGroup(id), id).toBe(false);
    }
    expect(isVendorGroup("my-own-group")).toBe(false);
  });

  it("isAddableGroup: custom, vLLM, OpenRouter, TokenDance, SiliconFlow and user-defined groups take hand-added models, no other built-in group does", () => {
    const open = ["custom", "vllm", "openrouter", "tokendance", "siliconflow"];
    for (const id of [...open, "my-own-group"]) {
      expect(isAddableGroup(id), id).toBe(true);
    }
    // Every first-party vendor and every other gateway, the relays included.
    const closed = MODEL_PROVIDERS.map((p) => p.id).filter((id) => !open.includes(id));
    expect(closed).toContain("fireworks");
    expect(closed).toContain("penguin-go");
    expect(closed).toContain("deepseek");
    for (const id of closed) {
      expect(isAddableGroup(id), id).toBe(false);
    }
  });

  it("unaddableModel: a closed group still takes its own presets, an addable group takes anything", () => {
    expect(unaddableModel("fireworks", "accounts/someone/models/new-model")).toBe(true);
    // Routable is not enough: the DeepSeek client would place this id, but it is no preset.
    expect(unaddableModel("deepseek", "deepseek-v4-pro-next")).toBe(true);
    // The pair is the key: DeepSeek's own id is not one of Fireworks' presets.
    expect(unaddableModel("fireworks", "deepseek-flash")).toBe(true);
    // Every catalog row may be written back into its own group — that is what "Sync presets"
    // does for a row the Project deleted.
    for (const m of MODEL_CATALOG) {
      expect(unaddableModel(m.provider, m.modelId), `${m.provider}/${m.modelId}`).toBe(false);
    }
    for (const id of [
      "custom",
      "vllm",
      "openrouter",
      "tokendance",
      "siliconflow",
      "my-own-group",
    ]) {
      expect(unaddableModel(id, "someone/new-model"), id).toBe(false);
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
    expect(modelHomepageUrl("qwen-pay-as-you-go", "ZHIPU/GLM-5.3-Flash")).toBe(
      "https://www.qianwenai.com/models/ZHIPU%2FGLM-5.3-Flash",
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

describe("fastModeProtocol (which models may be offered MMSP's fast_mode, and on which protocol)", () => {
  it("clients that send service_tier carry it as `openai`: the OpenAI protocols, OpenAI, Gemini and MiniMax", () => {
    // Bare "openai" is the alias the web pins on custom, user-defined and gateway rows.
    expect(fastModeProtocol("anything-at-all", "openai")).toBe("openai");
    expect(fastModeProtocol("local-qwen", "openai-responses")).toBe("openai");
    expect(fastModeProtocol("Qwen/Qwen3.8", "openai-chat-vllm-adapter")).toBe("openai");
    expect(fastModeProtocol("MiniMax-M3")).toBe("openai");
    expect(fastModeProtocol("MiniMax-M3", "minimax-official")).toBe("openai");
    expect(fastModeProtocol("gpt-5.5-pro")).toBe("openai");
    expect(fastModeProtocol("gpt-5.4-mini")).toBe("openai");
    expect(fastModeProtocol("gpt-5.6")).toBe("openai");
    expect(fastModeProtocol("gpt-6-astra")).toBe("openai");
    // Google's Interactions API takes the priority tier too.
    expect(fastModeProtocol("gemini-3.5-flash")).toBe("openai");
    expect(fastModeProtocol("gemini-3.8-flash", "gemini-official")).toBe("openai");
  });

  it("Anthropic-protocol clients carry it as speed=fast", () => {
    expect(fastModeProtocol("claude-fable-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-opus-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-sonnet-5")).toBe("anthropic");
    expect(fastModeProtocol("claude-opus-4-8")).toBe("anthropic");
    expect(fastModeProtocol("some-proxy-id", "ant-messages")).toBe("anthropic");
    expect(fastModeProtocol("some-proxy-id", "anthropic-official")).toBe("anthropic");
    // Outside the research preview's Opus allowlist the client still sends it and Anthropic
    // answers 429 — a warning before enabling, not a reason to withhold the setting.
    expect(fastModeProtocol("claude-opus-4-7")).toBe("anthropic");
  });

  it("clients that reject the parameter get no toggle: GLM, Kimi, DeepSeek, generateContent, embeddings", () => {
    expect(fastModeProtocol("glm-5.2")).toBeUndefined();
    expect(fastModeProtocol("kimi-k3")).toBeUndefined();
    expect(fastModeProtocol("kimi-k2.6")).toBeUndefined();
    expect(fastModeProtocol("kimi-k2.5")).toBeUndefined();
    expect(fastModeProtocol("deepseek-v4-pro")).toBeUndefined();
    expect(fastModeProtocol("deepseek-flash", "deepseek-official")).toBeUndefined();
    expect(fastModeProtocol("gemini-3.8-flash", "google-genai")).toBeUndefined();
    expect(fastModeProtocol("text-embedding-3-large", "openai-embedding")).toBeUndefined();
    // OpenAI's embedding ids route to its Embeddings API even without a pin.
    expect(fastModeProtocol("text-embedding-3-large")).toBeUndefined();
    // A future first-party generation inherits the verdict from its family, so a catalog row
    // added later needs no change here.
    expect(fastModeProtocol("glm-5.3")).toBeUndefined();
    expect(fastModeProtocol("kimi-k4")).toBeUndefined();
  });

  it("the Anthropic carve-outs are tested against the model id and base URL, not the routing token", () => {
    // The generations that reject the speed parameter are refused by name, whatever routes them.
    expect(fastModeProtocol("claude-sonnet-4-6")).toBeUndefined();
    expect(fastModeProtocol("claude-sonnet-5-5")).toBeUndefined();
    expect(fastModeProtocol("claude-fable-5-1")).toBeUndefined();
    expect(fastModeProtocol("my-claude-sonnet-4-6-proxy", "anthropic-official")).toBeUndefined();
    // ...and conversely a served model id keeps fast mode under the same pin.
    expect(fastModeProtocol("claude-sonnet-5", "anthropic-official")).toBe("anthropic");
    // Bedrock has no fast tier; the prefix lives in the base URL, which is why the rule needs it.
    expect(fastModeProtocol("claude-fable-5", undefined, "bedrock://us-east-1")).toBeUndefined();
    expect(fastModeProtocol("claude-fable-5", undefined, "https://api.anthropic.com")).toBe(
      "anthropic",
    );
  });

  it("an id MMSP cannot route gets no toggle either (no client, so no fast tier)", () => {
    // AutoLLMClient throws for an id of no known family — there is no openai_chat fallback.
    expect(fastModeProtocol("totally-unknown-model")).toBeUndefined();
    // A gateway spelling merely contains a family; it begins with none.
    expect(fastModeProtocol("anthropic/claude-opus-4.8")).toBeUndefined();
    expect(fastModeProtocol("anthropic/claude-fable-5")).toBeUndefined();
    // The same rows as the catalog ships them — client_type pinned — are served over the
    // OpenAI protocol.
    expect(fastModeProtocol("anthropic/claude-opus-4.8", "openai")).toBe("openai");
    expect(fastModeProtocol("anthropic/claude-fable-5", "openai-responses")).toBe("openai");
    // So does a client type MMSP does not have.
    expect(fastModeProtocol("MiniMax-M3", "minimax-m3")).toBeUndefined();
  });

  it("catalog invariant: every built-in row's verdict follows its client family", () => {
    for (const m of MODEL_CATALOG) {
      const verdict = fastModeProtocol(m.modelId, m.clientType, m.baseUrl);
      if (m.clientType === "openai-chat" || m.clientType === "openai-responses") {
        // Every gateway row pins an OpenAI protocol, which always carries service_tier.
        expect(verdict, `${m.provider}/${m.modelId}`).toBe("openai");
      } else if (["zhipu", "moonshot", "deepseek"].includes(m.provider)) {
        // These groups' official clients have no fast tier at all: rows added to them later
        // (a new GLM generation) stay excluded without touching this rule.
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
    expect(verdictOf("google", "gemini-3.8-flash")).toBe("openai");
    // The relay's Gemini rows speak generateContent, which has no priority tier.
    expect(verdictOf("penguin-go", "gemini-3.8-flash")).toBeUndefined();
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

  it("OpenCode always gets the session header: the Session's id, or a fresh random one", () => {
    const sessionId = "session-2026-09-14-10-30-00-a1b2c3d4";
    expect(attributionHeaders("https://opencode.ai/zen/v1", sessionId)).toEqual({
      "x-opencode-session": sessionId,
    });
    // Same suffix-anchored host rule as the other two: a subdomain is the same gateway.
    expect(attributionHeaders("https://api.opencode.ai/v1", sessionId)).toEqual({
      "x-opencode-session": sessionId,
    });
    // No id — a connectivity test, a vision probe — still names a conversation, since the
    // gateway refuses a request that names none: a fresh random id each time, never one
    // constant that would file every such request under a single session.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const first = attributionHeaders("https://opencode.ai/zen/v1")?.["x-opencode-session"];
    const second = attributionHeaders("https://opencode.ai/zen/v1", "")?.["x-opencode-session"];
    expect(first).toMatch(uuid);
    expect(second).toMatch(uuid);
    expect(first).not.toBe(second);
    // A host outside the scheme gets nothing, whatever path it serves: third-party mirrors of
    // a gateway are not part of the built-in attribution, and naming one here would put it in
    // the repository just as surely as listing it would.
    expect(attributionHeaders("https://gateway.example.com/zen/go", sessionId)).toBeUndefined();
  });

  it("a session id leaves the app-attribution gateways exactly as they were", () => {
    const sessionId = "session-2026-09-14-10-30-00-a1b2c3d4";
    expect(attributionHeaders("https://openrouter.ai/api/v1", sessionId)).toEqual({
      "HTTP-Referer": "https://penguin.ooo/",
      "X-OpenRouter-Title": "PenguinHarness",
      "X-OpenRouter-Categories": "cli-agent,personal-agent",
    });
    expect(attributionHeaders("https://tokendance.space/gateway/v1", sessionId)).toEqual({
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
    const sessionId = "session-2026-09-17-10-30-00-a1b2c3d4";
    for (const m of MODEL_CATALOG) {
      const headers = attributionHeaders(m.baseUrl);
      if (m.provider === "openrouter") {
        expect(headers?.["HTTP-Referer"], m.modelId).toBe("https://penguin.ooo/");
      } else if (m.provider === "tokendance") {
        expect(headers?.["X-App-URL"], m.modelId).toBe("https://penguin.ooo/");
      } else if (m.provider === "opencode-go") {
        // Both OpenCode Go bases, Messages included, name the Session they are serving, and
        // name a conversation of their own outside one.
        expect(attributionHeaders(m.baseUrl, sessionId), m.modelId).toEqual({
          "x-opencode-session": sessionId,
        });
        expect(headers?.["x-opencode-session"], m.modelId).toBeTruthy();
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
    // Every direct row, plus the resold rows whose sellers pass DeepSeek's own windows through:
    // two on Penguin Go, four on OpenCode Go, two on TokenDance and one on OpenRouter. The
    // retired rows keep the schedule too. A gateway row on the schedule carries no flat
    // `discount` — the two are mutually exclusive, pinned by the last case here.
    const rows = MODEL_CATALOG.filter((m) => m.offPeakDiscount === S);
    expect(rows.map((m) => `${m.provider}/${m.modelId}`)).toEqual([
      "deepseek/deepseek-flash",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-flash-vision-exp",
      "deepseek/deepseek-v4-pro",
      "openrouter/deepseek/deepseek-v4.1-flash",
      "tokendance/deepseek-v4-flash-vision-exp",
      "tokendance/deepseek-v4.1-flash",
      "penguin-go/deepseek-flash",
      "penguin-go/deepseek-v4-pro",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/deepseek-v4-flash",
      "opencode-go/deepseek-v4-flash-vision-exp",
      "opencode-go/deepseek-v4-pro",
    ]);
    for (const m of rows) {
      // Peak is exactly double the off-peak tier DeepSeek publishes. Compared at 1e-5: both
      // sides round to six decimals independently, so the last digit can differ by one.
      expect(effectivePricing(m, beijing("2026-08-31T22:00"))!.output * 2).toBeCloseTo(
        m.pricing!.output,
        5,
      );
    }
    // The published peak figures themselves: CNY 0.04 / 2 / 8 per million, at the catalog's 7:1
    // display convention, which is DeepSeek's off-peak 0.02 / 1 / 4 doubled.
    const flash = catalogEntryFor("deepseek", "deepseek-flash")!.pricing!;
    expect([flash.cache_read, flash.cache_write, flash.output]).toEqual([
      0.005714, 0.285714, 1.142857,
    ]);
  });

  it("a retired row is never a preset, but a sync still compares it and it still prices a Project's usage on its schedule", () => {
    const retired = MODEL_CATALOG.filter((m) => m.retired === true);
    const refs = retired.map((m) => `${m.provider}/${m.modelId}`);
    expect(refs).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-flash-vision-exp",
      "tokendance/deepseek-v4-flash-vision-exp",
    ]);
    const presets = new Set(presetModelEntries().map((e) => `${e.provider}/${e.model_id}`));
    // "Sync presets" compares a Project's table against the whole catalog, retired rows
    // included, so it keeps updating a retired row the Project carries; the presets a new
    // Project gets are that same list without them.
    const all = catalogModelEntries();
    expect(all.map((e) => `${e.provider}/${e.model_id}`)).toEqual(
      MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`),
    );
    expect(presetModelEntries()).toEqual(
      all.filter((e) => !refs.includes(`${e.provider}/${e.model_id}`)),
    );
    const scheduled = new Set(
      offPeakScheduledRefs().flatMap((g) => g.refs.map((r) => `${r.provider}/${r.modelId}`)),
    );
    for (const m of retired) {
      const ref = `${m.provider}/${m.modelId}`;
      expect(presets.has(ref), ref).toBe(false);
      // What a Project still carrying the row reads from the catalog: its name and schedule.
      expect(catalogEntryFor(m.provider, m.modelId)?.displayName, ref).toBe(m.displayName);
      expect(scheduled.has(ref), ref).toBe(true);
      expect(effectivePricing(m, beijing("2026-08-31T22:00"))!.output * 2, ref).toBeCloseTo(
        m.pricing!.output,
        5,
      );
    }
  });

  it("the Qwen DeepSeek rows store the peak price and declare Qwen's own schedule", () => {
    // Qwen bills the DeepSeek models it sells by its own clock, not DeepSeek's: the model pages
    // list a peak and an off-peak price, the latter exactly half.
    const rows = MODEL_CATALOG.filter((m) => m.offPeakDiscount === QWEN_OFF_PEAK);
    expect(rows.map((m) => `${m.provider}/${m.modelId}`)).toEqual([
      "qwen-token-plan/deepseek-v4.1-flash",
      "qwen-token-plan/deepseek-v4-pro-0813",
      "qwen-pay-as-you-go/deepseek-v4.1-flash",
    ]);
    // input / output / cache hit, in CNY per million — the order the model page lists them in.
    const cnyOf = (usdV: number): number => Math.round(usdV * 7 * 1000) / 1000;
    const tiers = (m: (typeof rows)[number], at: Date): number[] => {
      const p = effectivePricing(m, at)!;
      return [cnyOf(p.cache_write), cnyOf(p.output), cnyOf(p.cache_read)];
    };
    const peak = beijing("2026-08-31T10:00");
    const offPeak = beijing("2026-08-31T23:00");
    for (const m of rows) {
      expect(m.discount, m.modelId).toBeUndefined();
      expect(tiers(m, peak), m.modelId).toEqual(
        m.modelId === "deepseek-v4-pro-0813" ? [9, 27, 0.9] : [2, 8, 0.2],
      );
      expect(tiers(m, offPeak), m.modelId).toEqual(
        m.modelId === "deepseek-v4-pro-0813" ? [4.5, 13.5, 0.45] : [1, 4, 0.1],
      );
    }
    // The cost center splits its aggregations once per schedule, and these are the only two:
    // each reference lands under its own schedule, never under the other vendor's windows.
    const grouped = offPeakScheduledRefs();
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.schedule).toBe(S);
    expect(grouped[1]!.schedule).toBe(QWEN_OFF_PEAK);
    expect(grouped[1]!.refs.map((r) => `${r.provider}/${r.modelId}`)).toEqual(
      rows.map((m) => `${m.provider}/${m.modelId}`),
    );
    expect(grouped[0]!.refs.map((r) => `${r.provider}/${r.modelId}`)).toEqual(
      MODEL_CATALOG.filter((m) => m.offPeakDiscount === S).map((m) => `${m.provider}/${m.modelId}`),
    );
  });

  it("Qwen's peak is 08:00-22:00 Beijing on every day of the week", () => {
    const Q = QWEN_OFF_PEAK;
    // 2026-08-31 is a Monday: the window ends are exclusive, so 22:00 is already off-peak.
    expect(offPeakAt(Q, beijing("2026-08-31T08:00"))).toBe(false);
    expect(offPeakAt(Q, beijing("2026-08-31T21:59"))).toBe(false);
    expect(offPeakAt(Q, beijing("2026-08-31T07:59"))).toBe(true);
    expect(offPeakAt(Q, beijing("2026-08-31T22:00"))).toBe(true);
    expect(offPeakAt(Q, beijing("2026-08-31T03:00"))).toBe(true);
    // Where the two schedules part: DeepSeek's lunch gap and its weekends are Qwen's peak.
    expect(offPeakAt(Q, beijing("2026-08-31T13:00"))).toBe(false);
    expect(offPeakAt(S, beijing("2026-08-31T13:00"))).toBe(true);
    expect(offPeakAt(Q, beijing("2026-09-06T10:00"))).toBe(false);
    expect(offPeakAt(S, beijing("2026-09-06T10:00"))).toBe(true);
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
    // effectivePricing silently prefers the schedule, while the cost center would apply the
    // seeded promotion on top of it, so a row declaring both would be shown at one rate and
    // billed at another with nothing failing. The rule is stated in the field's doc; this is
    // what makes it true.
    const both = MODEL_CATALOG.filter(
      (m) => m.discount !== undefined && m.offPeakDiscount !== undefined,
    ).map((m) => `${m.provider}/${m.modelId}`);
    expect(both).toEqual([]);
  });

  it("every schedule is written in Beijing time, the one zone the badge's tooltip names", () => {
    // Both dictionaries say Beijing time outright rather than spelling out an offset, so a
    // schedule written in any other zone fails here instead of reaching the tooltip mislabelled.
    for (const { schedule, refs } of offPeakScheduledRefs()) {
      expect(schedule.utcOffsetMinutes, `${refs[0]!.provider}/${refs[0]!.modelId}`).toBe(480);
    }
  });
});

describe("modelEnvFallback / resolveModelCredential (a vendor key from the environment goes only to the vendor)", () => {
  const VENDOR_ENV = {
    OPENAI_API_KEY: "sk-openai-env",
    ANTHROPIC_API_KEY: "sk-anthropic-env",
    GEMINI_API_KEY: "sk-gemini-env",
    DEEPSEEK_API_KEY: "sk-deepseek-env",
  };
  const shapeOf = (m: (typeof MODEL_CATALOG)[number]) => ({
    provider: m.provider,
    modelId: m.modelId,
    clientType: m.clientType,
    baseUrl: m.baseUrl,
  });

  it("refuses every keyless row of every gateway group, whatever vendor variables are set", () => {
    const gateways = MODEL_PROVIDERS.filter((p) => p.gatewayBaseUrl !== undefined).map((p) => p.id);
    expect(gateways).toContain("tokendance");
    expect(gateways).toContain("openrouter");
    const rows = MODEL_CATALOG.filter((m) => gateways.includes(m.provider));
    expect(rows.length).toBeGreaterThan(20);
    for (const m of rows) {
      expect(modelEnvFallback(shapeOf(m)), `${m.provider}/${m.modelId}`).toBeUndefined();
      expect(
        () => resolveModelCredential(shapeOf(m), VENDOR_ENV),
        `${m.provider}/${m.modelId}`,
      ).toThrow(ModelCredentialError);
    }
    // The message says "API key", which is what hosts classify a missing credential by.
    expect(() =>
      resolveModelCredential(shapeOf(catalogEntryFor("tokendance", "glm-5.3")!), VENDOR_ENV),
    ).toThrow(/has no API key/);
  });

  it("leaves a first-party vendor row on its client's own variable, handing the client no key", () => {
    // No base URL: the client's default endpoint is the vendor's own.
    const sonnet = shapeOf(catalogEntryFor("anthropic", "claude-sonnet-4-6")!);
    expect(modelEnvFallback(sonnet)).toEqual({
      envKey: "ANTHROPIC_API_KEY",
      envBaseUrlKey: "ANTHROPIC_BASE_URL",
      readByClient: true,
    });
    expect(resolveModelCredential(sonnet, VENDOR_ENV)).toEqual({});
    // A row naming the vendor's own endpoint itself is allowed the variable too, but the
    // value travels explicitly: MMSP refuses a base URL without a key rather than lend the
    // vendor's variable to whatever endpoint was typed.
    const flash = {
      ...shapeOf(catalogEntryFor("deepseek", "deepseek-flash")!),
      baseUrl: "https://api.deepseek.com",
    };
    expect(modelEnvFallback(flash)?.envKey).toBe("DEEPSEEK_API_KEY");
    expect(resolveModelCredential(flash, VENDOR_ENV)).toEqual({
      apiKey: "sk-deepseek-env",
      baseUrl: "https://api.deepseek.com",
    });
    expect(() => resolveModelCredential(flash, {})).toThrow(/DEEPSEEK_API_KEY/);
    // The variable being unset is the client's business, not ours: still handed nothing
    // (a Bedrock ANTHROPIC_BASE_URL with no ANTHROPIC_API_KEY stays valid).
    expect(resolveModelCredential(sonnet, {})).toEqual({});
    // An inline key always wins, on any row.
    expect(resolveModelCredential({ ...sonnet, apiKey: "sk-inline" }, VENDOR_ENV)).toEqual({
      apiKey: "sk-inline",
    });
    expect(
      resolveModelCredential(
        { ...shapeOf(catalogEntryFor("openrouter", "openai/gpt-5.5")!), apiKey: "sk-or" },
        VENDOR_ENV,
      ),
    ).toMatchObject({ apiKey: "sk-or" });
  });

  it("reads the Penguin Go relay's own variable itself and never a vendor's", () => {
    const relayRows = MODEL_CATALOG.filter((m) => m.provider === "penguin-go");
    expect(relayRows.length).toBeGreaterThan(0);
    for (const m of relayRows) {
      expect(modelEnvFallback(shapeOf(m)), m.modelId).toEqual({
        envKey: "PENGUIN_GO_API_KEY",
        envBaseUrlKey: "PENGUIN_GO_BASE_URL",
        readByClient: false,
      });
      // Vendor variables set, relay variable unset: refused, not GEMINI_API_KEY.
      expect(() => resolveModelCredential(shapeOf(m), VENDOR_ENV), m.modelId).toThrow(
        /PENGUIN_GO_API_KEY/,
      );
      expect(
        resolveModelCredential(shapeOf(m), { ...VENDOR_ENV, PENGUIN_GO_API_KEY: " pg-key " }),
        m.modelId,
      ).toEqual({ apiKey: "pg-key", baseUrl: PENGUIN_GO_BASE_URL });
    }
    // The relay key belongs to the relay endpoint: a row with no base URL is refused even
    // with a key, so the key cannot travel to the vendor's default endpoint.
    expect(() =>
      resolveModelCredential(
        {
          provider: "penguin-go",
          modelId: "gemini-3.8-flash",
          clientType: "google-genai",
          apiKey: "pg",
        },
        VENDOR_ENV,
      ),
    ).toThrow(/has no base URL/);
  });

  it("judges custom, vLLM and user-defined rows by their endpoint, not their group", () => {
    // A private server: refused.
    const local = {
      provider: "custom",
      modelId: "local-model",
      clientType: "openai-chat",
      baseUrl: "http://127.0.0.1:8000/v1",
    };
    expect(modelEnvFallback(local)).toBeUndefined();
    expect(() => resolveModelCredential(local, VENDOR_ENV)).toThrow(ModelCredentialError);
    const vllm = shapeOf(MODEL_CATALOG.find((m) => m.provider === "vllm")!);
    expect(modelEnvFallback({ ...vllm, baseUrl: "http://gpu-box:8000/v1" })).toBeUndefined();
    // The vendor's own endpoint typed into a custom row: the OpenAI key goes to OpenAI.
    expect(modelEnvFallback({ ...local, baseUrl: "https://api.openai.com/v1/" })?.envKey).toBe(
      "OPENAI_API_KEY",
    );
    // OPENAI_BASE_URL naming the very same server earns no exception (environment keys are
    // for official endpoints only): the key goes on the row.
    const paired = { ...VENDOR_ENV, OPENAI_BASE_URL: "http://127.0.0.1:8000/v1/" };
    expect(() => resolveModelCredential(local, paired)).toThrow(ModelCredentialError);
    // A user-defined group with no base URL auto-routes to the vendor: allowed, like before.
    expect(modelEnvFallback({ provider: "myproxy", modelId: "claude-sonnet-4-6" })?.envKey).toBe(
      "ANTHROPIC_API_KEY",
    );
    // A vendor row re-pointed at a proxy: refused.
    expect(
      modelEnvFallback({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        baseUrl: "https://proxy.example/anthropic",
      }),
    ).toBeUndefined();
    // An id nothing routes has no client and so no variable.
    expect(modelEnvFallback({ provider: "custom", modelId: "opaque" })).toBeUndefined();
  });

  it("endpointEnvApiKey lends a bare endpoint the protocol's key on the same terms", () => {
    expect(
      endpointEnvApiKey("openai-chat", "https://gw.example.com/v1", VENDOR_ENV),
    ).toBeUndefined();
    expect(endpointEnvApiKey("ant-messages", "https://gw.example.com", VENDOR_ENV)).toBeUndefined();
    expect(endpointEnvApiKey("openai-chat", "https://api.openai.com/v1", VENDOR_ENV)).toBe(
      "sk-openai-env",
    );
    expect(endpointEnvApiKey("ant-messages", "https://api.anthropic.com/", VENDOR_ENV)).toBe(
      "sk-anthropic-env",
    );
    expect(endpointEnvApiKey("openai-responses", undefined, VENDOR_ENV)).toBe("sk-openai-env");
    // Not even when OPENAI_BASE_URL names that very URL.
    expect(
      endpointEnvApiKey("openai-chat", "https://gw.example.com/v1", {
        ...VENDOR_ENV,
        OPENAI_BASE_URL: "https://gw.example.com/v1",
      }),
    ).toBeUndefined();
    expect(
      endpointEnvApiKey("openai-chat", "https://api.openai.com/v1", { OPENAI_API_KEY: "  " }),
    ).toBeUndefined();
  });

  it("providerEnvFallbackKey names the group-level fallback only for first-party groups, judged on the group's own table", () => {
    // As a new Project stores them: the vendors have no table, Penguin Go names its relay.
    const table = presetProviderTable();
    const fallbackOf = (id: string, group: ProviderConnection | undefined) =>
      providerEnvFallbackKey(id, providerConnectionShape(group));
    expect(fallbackOf("anthropic", table.anthropic)).toBe("ANTHROPIC_API_KEY");
    expect(fallbackOf("deepseek", table.deepseek)).toBe("DEEPSEEK_API_KEY");
    expect(fallbackOf("penguin-go", table["penguin-go"])).toBe("PENGUIN_GO_API_KEY");
    // Gateways, vLLM, custom and user-defined groups never, whatever their table says.
    for (const id of [
      "tokendance",
      "openrouter",
      "fireworks",
      "siliconflow",
      "qwen-token-plan",
      "vllm",
      "custom",
      "my-group",
    ]) {
      expect(fallbackOf(id, table[id]), id).toBeUndefined();
      expect(fallbackOf(id, undefined), id).toBeUndefined();
    }
    // The file decides the destination: a vendor group pointed at a proxy, or at another
    // vendor's client, lends nothing; pointed at the vendor's own endpoint, it still does.
    expect(fallbackOf("deepseek", { base_url: "https://proxy.example/deepseek" })).toBeUndefined();
    expect(fallbackOf("deepseek", { base_url: "https://api.deepseek.com/" })).toBe(
      "DEEPSEEK_API_KEY",
    );
    expect(fallbackOf("deepseek", { client_type: "openai-chat" })).toBeUndefined();
    expect(fallbackOf("deepseek", { client_type: "deepseek-official" })).toBe("DEEPSEEK_API_KEY");
    // The relay key goes only with the relay's endpoint: a Penguin Go table without one
    // lends nothing.
    expect(fallbackOf("penguin-go", undefined)).toBeUndefined();
  });

  it("sameEndpoint ignores case in the host and trailing slashes, and nothing else", () => {
    expect(sameEndpoint("https://API.OpenAI.com/v1/", "https://api.openai.com/v1")).toBe(true);
    expect(sameEndpoint("https://api.openai.com/v1", "https://api.openai.com/v2")).toBe(false);
    expect(sameEndpoint("https://api.openai.com/v1", "https://api.openai.com")).toBe(false);
    expect(sameEndpoint("http://host:8000/v1", "http://host:8001/v1")).toBe(false);
    expect(sameEndpoint("not a url", "not a url")).toBe(false);
    // The cases that make this a security check — a string-prefix "simplification" would pass
    // each of them, and each would carry the OpenAI key somewhere else.
    const openai = "https://api.openai.com/v1";
    expect(sameEndpoint(openai, "https://api.openai.com.evil.example/v1")).toBe(false);
    expect(sameEndpoint(openai, "https://api.openai.com@evil.example/v1")).toBe(false);
    expect(sameEndpoint(openai, "http://api.openai.com/v1")).toBe(false);
    for (const lookalike of [
      "https://api.openai.com.evil.example/v1",
      "https://api.openai.com@evil.example/v1",
      "http://api.openai.com/v1",
    ]) {
      expect(
        modelEnvFallback({
          provider: "custom",
          modelId: "x",
          clientType: "openai-chat",
          baseUrl: lookalike,
        }),
        lookalike,
      ).toBeUndefined();
    }
  });

  it("refuses a keyless Bedrock row with a message that names the way out, not 'not the vendor's own'", () => {
    expect(() =>
      resolveModelCredential(
        { provider: "anthropic", modelId: "claude-sonnet-5", baseUrl: "bedrock://us-east-1" },
        { ANTHROPIC_API_KEY: "sk-ant" },
      ),
    ).toThrow(/Bedrock endpoint.*ANTHROPIC_BASE_URL=bedrock:\/\/us-east-1/);
    // Rule 1 keeps Bedrock reachable: no base URL on the row, the region in the environment.
    expect(
      resolveModelCredential(
        { provider: "anthropic", modelId: "claude-sonnet-5" },
        { ANTHROPIC_BASE_URL: "bedrock://us-east-1" },
      ),
    ).toEqual({});
  });

  it("modelEnvPreviewKey presents a fallback as covering the row only where that is not a misconfiguration", () => {
    // The eight vLLM presets ship with no base URL: they fall back under the rule, but must not
    // read as "key configured" — that would run a self-hosted id against api.openai.com.
    for (const m of MODEL_CATALOG.filter((v) => v.provider === "vllm")) {
      const shape = { provider: m.provider, modelId: m.modelId, clientType: m.clientType };
      expect(modelEnvFallback(shape)?.envKey, m.modelId).toBe("OPENAI_API_KEY");
      expect(modelEnvPreviewKey(shape), m.modelId).toBeUndefined();
    }
    // A custom row saved without a base URL: same.
    expect(
      modelEnvPreviewKey({ provider: "custom", modelId: "m", clientType: "openai-chat" }),
    ).toBeUndefined();
    // A custom row that names the vendor's endpoint itself: previewed.
    expect(
      modelEnvPreviewKey({
        provider: "custom",
        modelId: "m",
        clientType: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toBe("OPENAI_API_KEY");
    // Vendor groups and the relay: previewed, as on main.
    expect(modelEnvPreviewKey({ provider: "anthropic", modelId: "claude-sonnet-4-6" })).toBe(
      "ANTHROPIC_API_KEY",
    );
    expect(modelEnvPreviewKey(shapeOf(catalogEntryFor("deepseek", "deepseek-flash")!))).toBe(
      "DEEPSEEK_API_KEY",
    );
    expect(modelEnvPreviewKey(shapeOf(catalogEntryFor("minimax", "MiniMax-M3")!))).toBe(
      "MINIMAX_API_KEY",
    );
    expect(modelEnvPreviewKey(shapeOf(catalogEntryFor("penguin-go", "gemini-3.8-flash")!))).toBe(
      "PENGUIN_GO_API_KEY",
    );
    // A vendor row pinned to the official client its id routes to anyway (what the MMSP
    // rename writes on an old DeepSeek row) is the same request: previewed.
    expect(
      modelEnvPreviewKey({
        provider: "deepseek",
        modelId: "deepseek-flash",
        clientType: "deepseek-official",
      }),
    ).toBe("DEEPSEEK_API_KEY");
    // Nothing to preview where the file names no endpoint for a protocol the id would not
    // route to: a vendor row on a generic protocol, the relay's rows without the relay's
    // endpoint (refused outright), a user-defined group that sets nothing.
    expect(
      modelEnvPreviewKey({
        provider: "deepseek",
        modelId: "deepseek-flash",
        clientType: "openai-chat",
      }),
    ).toBeUndefined();
    expect(
      modelEnvPreviewKey({
        provider: "penguin-go",
        modelId: "gemini-3.8-flash",
        clientType: "google-genai",
      }),
    ).toBeUndefined();
    expect(
      modelEnvPreviewKey({ provider: "myproxy", modelId: "claude-sonnet-4-6" }),
    ).toBeUndefined();
    // Refused rows are never previewed.
    expect(modelEnvPreviewKey(shapeOf(catalogEntryFor("tokendance", "glm-5.3")!))).toBeUndefined();
    expect(
      modelEnvPreviewKey({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        baseUrl: "https://proxy.example/anthropic",
      }),
    ).toBeUndefined();
  });
});

/**
 * Group-level connections, as every request is built: effectiveConnection resolves a row's
 * base URL, protocol and key from the file alone; resolveEntryCredential builds the client's
 * credential on that effective shape.
 *
 * - Per field, a row's own base URL / protocol wins over its group's table; blank counts as
 *   absent at every level; with neither, the row has none (the client's default) — a catalog
 *   pair whose group has no table resolves to nothing, whatever the catalog says.
 * - A row's own protocol wins over a group protocol, so Penguin Go's rows keep the protocol
 *   each stores while the group sets another.
 * - A group's key follows its endpoint (groupKeyReaches): it reaches a row with no base URL of
 *   its own, or one on the group's origin, and nothing else.
 * - The destination rule judges the effective endpoint: a DeepSeek group pointed at a proxy is
 *   lent no DEEPSEEK_API_KEY, one pointed at DeepSeek's own endpoint is.
 * - A group key wins over the environment and loses to the row's own key; a gateway row with
 *   neither is still refused.
 * - Session creation's explicit pair sits above the row; a blank one is no override.
 * - Custom's Atria carries its own endpoint and protocol, so custom's group connection (a local
 *   Ollama endpoint and its key) never redirects it, and the key — issued for another host —
 *   never reaches it, while a model the user typed into custom follows the group in all three.
 */
describe("effectiveConnection / resolveEntryCredential (a row follows its group's table, then nothing)", () => {
  const TD_ROW = { provider: "tokendance", modelId: "glm-5.3" };
  const GROUP = { baseUrl: "https://group.example/v1", clientType: "openai-responses" };

  it.each([
    [
      "the row's own value wins",
      { baseUrl: "https://row.example/v1", clientType: "ant-messages" },
      GROUP,
      "https://row.example/v1",
      "ant-messages",
      "model",
    ],
    [
      "the group's wins where the row has none",
      {},
      GROUP,
      GROUP.baseUrl,
      GROUP.clientType,
      "provider",
    ],
    // The catalog names an endpoint and a protocol for this pair; with no table they are not
    // used — the file holds nothing, so the client's defaults apply.
    [
      "nothing is used where neither has one, the catalog's included",
      {},
      undefined,
      undefined,
      undefined,
      "none",
    ],
    [
      "nothing is used where both are blank",
      { baseUrl: " ", clientType: "" },
      { baseUrl: "", clientType: "  " },
      undefined,
      undefined,
      "none",
    ],
  ] as const)("base URL and protocol: %s", (_, row, group, baseUrl, clientType, source) => {
    const effective = effectiveConnection({ ...TD_ROW, ...row }, group);
    expect(effective.baseUrl).toBe(baseUrl);
    expect(effective.clientType).toBe(clientType);
    expect([effective.baseUrlSource, effective.clientTypeSource]).toEqual([source, source]);
  });

  it("a row nothing covers has no base URL or protocol, and a group table is all it needs", () => {
    expect(
      effectiveConnection({ provider: "my-ollama", modelId: "qwen-local" }, undefined),
    ).toEqual({ baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" });
    // A user-defined group's table covers its rows; the deprecated spelling converges.
    const group = providerConnectionShape({
      base_url: "http://127.0.0.1:11434/v1",
      client_type: "openai",
    });
    expect(effectiveConnection({ provider: "my-ollama", modelId: "qwen-local" }, group)).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      baseUrlSource: "provider",
      clientType: "openai-chat",
      clientTypeSource: "provider",
      apiKeySource: "none",
    });
    expect(providerConnectionShape(undefined)).toBeUndefined();
  });

  it("a row's own protocol wins over a group protocol: Penguin Go's rows keep theirs while the group sets another", () => {
    const table: ProviderTable = {
      "penguin-go": { base_url: PENGUIN_GO_BASE_URL, client_type: "openai-chat", api_key: "pg" },
    };
    const rows = presetModelEntries().filter((e) => e.provider === "penguin-go");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const effective = storedConnection(row, table);
      expect(effective.clientType, row.model_id).toBe(
        catalogEntryFor("penguin-go", row.model_id)!.clientType,
      );
      expect(effective.clientTypeSource, row.model_id).toBe("model");
      expect(effective, row.model_id).toMatchObject({ apiKey: "pg", apiKeySource: "provider" });
    }
    // A model the group's protocol does reach: one that stores none.
    expect(
      storedConnection({ provider: "penguin-go", model_id: "added-later" }, table),
    ).toMatchObject({ clientType: "openai-chat", clientTypeSource: "provider" });
  });

  it.each([
    [
      "Atria in custom, custom on a local Ollama endpoint",
      "https://api.atria-asi.ai",
      "http://127.0.0.1:11434/v1",
      false,
    ],
    ["Atria in custom, custom with no endpoint", "https://api.atria-asi.ai", undefined, false],
    [
      "a row with no base URL of its own, the group on a relay",
      undefined,
      PENGUIN_GO_BASE_URL,
      true,
    ],
    ["a row with no base URL of its own, the group on none either", undefined, undefined, true],
    [
      "a blank base URL of its own, the group on a gateway",
      "  ",
      "https://openrouter.ai/api/v1",
      true,
    ],
    [
      "an OpenCode Go Messages row: another path on the group's host",
      "https://opencode.ai/zen/go",
      "https://opencode.ai/zen/go/v1",
      true,
    ],
    [
      "host case and the scheme's default port are the same origin",
      "https://OpenCode.ai:443/zen/go",
      "https://opencode.ai/zen/go/v1",
      true,
    ],
    [
      "one OpenRouter row re-pointed at another host",
      "https://proxy.example/openrouter/v1",
      "https://openrouter.ai/api/v1",
      false,
    ],
    ["the same host on another port", "http://gpu-box:8001/v1", "http://gpu-box:8000/v1", false],
    [
      "the same host on another scheme",
      "http://openrouter.ai/api/v1",
      "https://openrouter.ai/api/v1",
      false,
    ],
    ["a base URL that does not parse", "not a url", "not a url", false],
  ] as const)("groupKeyReaches: %s", (_, row, group, reaches) => {
    expect(groupKeyReaches(row, group)).toBe(reaches);
    // effectiveConnection applies it: the group's key is the row's only where it reaches.
    expect(
      effectiveConnection(
        { provider: "x", modelId: "m", baseUrl: row },
        { baseUrl: group, apiKey: "sk-group" },
      ).apiKeySource,
    ).toBe(reaches ? "provider" : "none");
  });

  it("the environment lends a vendor key only to the vendor's own endpoint, as the group sets it", () => {
    const row = { provider: "deepseek", model_id: "deepseek-flash" };
    const env = { DEEPSEEK_API_KEY: "sk-deepseek-env" };
    // The group pointed at a proxy: the DeepSeek key is not sent there.
    expect(() =>
      resolveEntryCredential(row, { baseUrl: "https://proxy.example/deepseek" }, {}, env),
    ).toThrow(ModelCredentialError);
    // The group pointed at DeepSeek's own endpoint: the variable travels with it, explicitly.
    expect(resolveEntryCredential(row, { baseUrl: "https://api.deepseek.com/" }, {}, env)).toEqual({
      apiKey: "sk-deepseek-env",
      baseUrl: "https://api.deepseek.com/",
    });
    // No endpoint anywhere: the client reads its own variable.
    expect(resolveEntryCredential(row, undefined, {}, env)).toEqual({});
  });

  it("a group key wins over the environment and loses to the row's own key", () => {
    const env = { DEEPSEEK_API_KEY: "sk-env", OPENAI_API_KEY: "sk-openai-env" };
    const group = providerConnectionShape({ api_key: "sk-group" });
    const row = { provider: "deepseek", model_id: "deepseek-flash" };
    expect(resolveEntryCredential(row, group, {}, env)).toEqual({ apiKey: "sk-group" });
    expect(
      effectiveConnection({ provider: "deepseek", modelId: "deepseek-flash" }, group),
    ).toMatchObject({ apiKey: "sk-group", apiKeySource: "provider" });
    expect(resolveEntryCredential({ ...row, api_key: "sk-row" }, group, {}, env)).toEqual({
      apiKey: "sk-row",
    });
    // A gateway row with no key of its own runs on the group's, at the endpoint and on the
    // protocol a new Project's table names; with no key anywhere it is refused, the user's
    // OpenAI key notwithstanding.
    const gateway = { provider: "tokendance", model_id: "glm-5.3" };
    const td = presetProviderTable().tokendance!;
    expect(
      resolveEntryCredential(
        gateway,
        providerConnectionShape({ ...td, api_key: "td-key" }),
        {},
        env,
      ),
    ).toEqual({ apiKey: "td-key", baseUrl: td.base_url, clientType: "openai-chat" });
    expect(() =>
      resolveEntryCredential(gateway, { ...providerConnectionShape(td), apiKey: "  " }, {}, env),
    ).toThrow(/has no API key/);
  });

  it("Session creation's explicit pair sits above the row; a blank one is no override", () => {
    const row = {
      provider: "custom",
      model_id: "my-model",
      client_type: "openai-chat",
      base_url: "https://row.example/v1",
      api_key: "sk-row",
    };
    expect(
      resolveEntryCredential(
        row,
        undefined,
        { apiKey: "sk-explicit", baseUrl: "https://explicit.example/v1" },
        {},
      ),
    ).toEqual({
      apiKey: "sk-explicit",
      baseUrl: "https://explicit.example/v1",
      clientType: "openai-chat",
    });
    expect(resolveEntryCredential(row, undefined, { apiKey: "", baseUrl: " " }, {})).toEqual({
      apiKey: "sk-row",
      baseUrl: "https://row.example/v1",
      clientType: "openai-chat",
    });
  });

  it("custom's group connection never redirects Atria or lends it a key, while a model the user typed there follows it", () => {
    const atria = presetModelEntries().find((e) => e.provider === "custom")!;
    const cat = catalogEntryFor("custom", atria.model_id)!;
    const ollama = {
      base_url: "http://127.0.0.1:11434/v1",
      client_type: "openai-chat",
      api_key: "sk-ollama",
    };
    // The preset as a new Project stores it: its own endpoint and protocol, and no key —
    // custom's was issued for another host.
    expect(storedConnection(atria, { custom: ollama })).toEqual({
      baseUrl: cat.baseUrl,
      baseUrlSource: "model",
      clientType: cat.clientType,
      clientTypeSource: "model",
      apiKeySource: "none",
    });
    // So a Session on it is refused for want of a key rather than sent anywhere with Ollama's.
    expect(() =>
      resolveEntryCredential(
        atria,
        providerConnectionShape(ollama),
        {},
        {
          ANTHROPIC_API_KEY: "sk-anthropic-env",
        },
      ),
    ).toThrow(ModelCredentialError);
    // A key of the preset's own still works, on the preset's endpoint and protocol.
    expect(
      resolveEntryCredential(
        { ...atria, api_key: "sk-atria" },
        providerConnectionShape(ollama),
        {},
        {},
      ),
    ).toEqual({ apiKey: "sk-atria", baseUrl: cat.baseUrl, clientType: cat.clientType });
    // A model the user typed into custom follows the group in all three fields.
    expect(
      resolveEntryCredential(
        { provider: "custom", model_id: "qwen3.8-27b-local" },
        providerConnectionShape(ollama),
        {},
        {},
      ),
    ).toEqual({
      apiKey: "sk-ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      clientType: "openai-chat",
    });
  });
});

describe("listEndpointModels credential gate (the add-group import)", () => {
  it("refuses a keyless listing of a gateway or private endpoint before any client exists, whatever the environment holds", async () => {
    const env = { OPENAI_API_KEY: "sk-openai-env", ANTHROPIC_API_KEY: "sk-anthropic-env" };
    await expect(
      listEndpointModels({ clientType: "openai-chat", baseUrl: "https://gw.example.com/v1", env }),
    ).rejects.toThrow(ModelCredentialError);
    await expect(
      listEndpointModels({ clientType: "ant-messages", baseUrl: "http://127.0.0.1:8000", env }),
    ).rejects.toThrow(/enter the endpoint's API key/);
    // With the SDK's own variable unset and the endpoint the vendor's own, the refusal is ours
    // too (no client is constructed to read an unset variable and throw its own error).
    await expect(
      listEndpointModels({
        clientType: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        env: {},
      }),
    ).rejects.toThrow(ModelCredentialError);
  });
});
