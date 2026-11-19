/**
 * Built-in model catalog unit tests: unique ids, valid provider references, positive
 * three-bucket pricing, lookups, preset entry generation, and the price a model that was the
 * default of new Projects keeps for its usage after a Project drops its row.
 * Given a new Project, GPT-6 Luna sends a Responses tool request through core's GenerativeModel
 * and the installed MMSP, through OpenAI, OpenRouter and OpenCode Go.
 * Given OpenCode Go's group key, Gemini 4 Argon Contributor streams a tool call through
 * Go's generateContent endpoint with the group key and conversation header, never Google's API.
 */
import { describe, expect, it, vi } from "vitest";
import { CLIENT_CREDENTIALS } from "@prismshadow/mmsp/credentials";
import { stubFetch } from "./fixtures/fetch.js";
import {
  APP_URL,
  GenerativeModel,
  attributionHeaders,
  userText,
  canonicalClientType,
  effectiveConnection,
  providerConnectionShape,
  resolveEntryCredential,
  sameEndpoint,
} from "@prismshadow/penguin-core";
import type { ModelEntry, ProviderConnection, ProviderTable } from "@prismshadow/penguin-core";
import {
  CLIENT_PROTOCOLS,
  DEEPSEEK_OFF_PEAK,
  MODEL_CATALOG,
  MODEL_PROVIDERS,
  PENGUIN_GO_BASE_URL,
  PRESET_DEFAULT_MODEL,
  QWEN_OFF_PEAK,
  catalogEntryFor,
  catalogGroupConnection,
  catalogModelEntries,
  effectivePricing,
  fastModeProtocol,
  isAddableGroup,
  isVendorGroup,
  modelCalledKeyless,
  modelEnvPreviewKey,
  modelEnvironment,
  modelHomepageUrl,
  offPeakAt,
  offPeakScheduledRefs,
  presetModelEntries,
  presetPromotions,
  presetProviderTable,
  providerCalledKeyless,
  providerClientType,
  providerEnvFallbackKey,
  providerInfo,
  retainedCatalogPricing,
  routedClientType,
  unaddableModel,
  unroutableVendorModel,
  vendorClientType,
} from "../src/model-catalog/index.js";

/**
 * The band a billed rate lies in, USD per million tokens. Wide on purpose — no row's value is
 * restated — yet narrow enough that a per-token figure left unconverted (x1e-6) or a slipped
 * digit (x1000) leaves it.
 */
const MIN_RATE_USD_PER_MTOK = 1e-4;
const MAX_RATE_USD_PER_MTOK = 1000;
/** The smallest context window a catalog row may carry, in tokens. */
const MIN_CONTEXT_WINDOW = 32_768;

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

/** The variable MMSP's client for a catalog row reads its key from (MMSP's own table). */
function rowEnvKey(m: { modelId: string; clientType?: string }): string | undefined {
  const routed = routedClientType(m.modelId, m.clientType ?? null);
  return routed === null ? undefined : CLIENT_CREDENTIALS[routed]?.apiKeyEnv;
}

describe("model-catalog", () => {
  it("(provider, model_id) pairs are unique, and the one recommended group leads the default order with custom last", () => {
    // Bare model ids may repeat across providers (a gateway reselling a vendor model keeps the
    // vendor's upstream id) — uniqueness is the (provider, model_id) pair, matching the
    // catalog's sole lookup key (catalogEntryFor).
    const pairs = MODEL_CATALOG.map((m) => `${m.provider}\0${m.modelId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    // Group order is hand-curated; this is the page's DEFAULT only — a Project that has
    // reordered its groups keeps its own arrangement (web's model-group-order.ts). Exactly one
    // group is marked recommended, and it is the one that leads: the caption and the placement
    // are two statements of the same curation.
    expect(MODEL_PROVIDERS.filter((p) => p.recommended)).toEqual([MODEL_PROVIDERS[0]]);
    expect(MODEL_PROVIDERS.at(-1)!.id).toBe("custom");
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
        expect(p.modelsUrl).toMatch(/^https:\/\//);
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

  it("a key-minting flow's endpoints are both https", () => {
    const withOAuth = MODEL_PROVIDERS.filter((p) => p.oauth !== undefined);
    expect(withOAuth.length).toBeGreaterThan(0);
    for (const p of withOAuth) {
      expect(p.oauth!.authorizeUrl, p.id).toMatch(/^https:\/\//);
      expect(p.oauth!.exchangeUrl, p.id).toMatch(/^https:\/\//);
    }
  });

  it("no group publishes both a key-minting flow and a bridged authorization flow", () => {
    // A credential comes from one place.
    for (const p of MODEL_PROVIDERS) {
      expect(p.oauth === undefined || p.bridgeAuth === undefined, p.id).toBe(true);
    }
  });

  it("a published account balance endpoint is an https URL", () => {
    // The descriptor is what puts a balance in a group's header, so the Web App never names a
    // group. The server sends the group's stored key to this URL, so it is the vendor's own
    // https endpoint and nothing else.
    const withBalance = MODEL_PROVIDERS.filter((p) => p.balance !== undefined);
    expect(withBalance.length).toBeGreaterThan(0);
    for (const p of withBalance) expect(p.balance!.url, p.id).toMatch(/^https:\/\//);
  });

  it("prebuilds Penguin Go on the relay at list prices, leaving promotions to the platform", () => {
    const penguinGoModels = MODEL_CATALOG.filter((model) => model.provider === "penguin-go");
    expect(penguinGoModels.length).toBeGreaterThan(0);
    for (const model of penguinGoModels) {
      expect(model.baseUrl, model.modelId).toBe(PENGUIN_GO_BASE_URL);
      expect(model.clientType, model.modelId).toBeDefined();
      expect(model.pricing?.unit, model.modelId).toBe("usd_per_mtok");
      // No static promotion: the platform delivers whatever it runs at authorization and Sync,
      // so every row here is its list price and nothing else.
      expect(model.discount, model.modelId).toBeUndefined();
    }
  });

  const GET_NUMBER = {
    name: "get_number",
    description: "Read a number.",
    parameters: { type: "object", properties: {} },
  };
  /** Runs one request of `model` to its end, whatever the stubbed endpoint answers. */
  async function runOnce(model: GenerativeModel): Promise<void> {
    const stream = model.streamGenerate({ newMessages: [userText("Read a number.")] });
    while (!(await stream.next()).done) {
      // Drain: only the request the client sent matters here.
    }
  }

  it.each(["openai", "openrouter", "opencode-go"])(
    "a new Project's GPT-6 Luna row sends a Responses tool request through %s with the installed MMSP",
    async (provider) => {
      const modelId = provider === "openrouter" ? "openai/gpt-6-luna" : "gpt-6-luna";
      const entry = presetModelEntries().find(
        (row) => row.provider === provider && row.model_id === modelId,
      )!;
      expect(entry).toBeDefined();
      const connection = storedConnection(entry);
      const fake = stubFetch(
        () =>
          new Response(JSON.stringify({ error: { message: "test-reject" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      );
      try {
        await runOnce(
          new GenerativeModel({
            modelId: entry.model_id,
            apiKey: "test-key",
            ...(connection.clientType ? { clientType: connection.clientType } : {}),
            ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
            tools: [GET_NUMBER],
          }),
        );
        expect(fake.calls.length).toBeGreaterThan(0);
        const request = JSON.parse(fake.calls[0]!.body) as Record<string, unknown>;
        expect(fake.calls[0]!.url.endsWith("/responses")).toBe(true);
        expect(request.model).toBe(modelId);
        expect(request.tools).toEqual([
          expect.objectContaining({ type: "function", ...GET_NUMBER }),
        ]);
        expect(request.store).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("Go's Gemini preset streams tool calls with the group key and session through generateContent", async () => {
    const chunk = {
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
      candidates: [
        {
          content: { role: "model", parts: [{ functionCall: { name: "get_number", args: {} } }] },
          finishReason: "STOP",
        },
      ],
    };
    const fake = stubFetch(
      () =>
        new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    try {
      const entry = presetModelEntries().find(
        (row) => row.provider === "opencode-go" && row.model_id === "gemini-4-argon-contributor",
      )!;
      expect(entry).toBeDefined();
      const table = presetProviderTable();
      table[entry.provider]!.api_key = "sk-go-group";
      const connection = storedConnection(entry, table);
      const model = new GenerativeModel({
        modelId: entry.model_id,
        apiKey: connection.apiKey!,
        clientType: connection.clientType!,
        baseUrl: connection.baseUrl!,
        sessionId: "go-gemini-session",
        tools: [GET_NUMBER],
      });
      const stream = model.streamGenerate({ newMessages: [userText("Read a number.")] });
      const produced = [];
      for (let next = await stream.next(); !next.done; next = await stream.next()) {
        produced.push(next.value);
      }
      expect(fake.calls).toHaveLength(1);
      const call = fake.calls[0]!;
      expect(call.url).toBe(
        "https://opencode.ai/inference/go/google/v1beta/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse",
      );
      expect(call.headers.get("x-goog-api-key")).toBe("sk-go-group");
      expect(call.headers.get("x-opencode-session")).toBe("go-gemini-session");
      expect(JSON.parse(call.body)).toMatchObject({
        tools: [{ functionDeclarations: [{ name: "get_number" }] }],
      });
      expect(produced.map((m) => m.payload)).toContainEqual(
        expect.objectContaining({ type: "tool_call", name: "get_number" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the app URL a minted key is stamped with is the same one attribution headers carry", () => {
    expect(attributionHeaders("https://tokendance.space/gateway/v1")).toEqual({
      "X-App-URL": APP_URL,
    });
  });

  it("every entry is priced or deliberately unpriced, its buckets in order and plausible, and its context window at least 32K tokens", () => {
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
        m.modelId.endsWith("-free") ||
        m.modelId === "openrouter/free" ||
        m.modelId === "Atria-Dawn" ||
        m.modelId === "dots-3-note-preview"
      ) {
        // Self-hosted vLLM and the free-tier gateway rows share one treatment: a genuine $0
        // price (not "unknown"), so costs compute to 0 and the free badge shows. Nobody bills
        // per token for either — a vLLM deployment costs its operator hardware, which no
        // catalog rate expresses. Atria Dawn has no published price yet and is
        // recorded at $0 until the vendor prices it; TokenDance's dots-3-note-preview is the
        // one free row of its group.
        expect(m.pricing, m.modelId).toBeDefined();
        expect([m.pricing!.cache_read, m.pricing!.cache_write, m.pricing!.output]).toEqual([
          0, 0, 0,
        ]);
      } else {
        const ref = `${m.provider}/${m.modelId}`;
        expect(m.pricing, ref).toBeDefined();
        expect(m.pricing!.unit, ref).toBe("usd_per_mtok");
        const { cache_read, cache_write, output } = m.pricing!;
        // A cache hit never bills above a cache write, nor a write above the output: an
        // argument-order slip in a row's buckets (a seller's list is rarely in the catalog's
        // cache-read / cache-write / output order) fails here.
        expect(cache_read, ref).toBeLessThanOrEqual(cache_write);
        expect(cache_write, ref).toBeLessThanOrEqual(output);
        // Every billed bucket is a plausible USD-per-million-token rate: a per-token figure left
        // unconverted, or a slipped digit, falls outside the band.
        for (const rate of [cache_read, cache_write, output]) {
          expect(rate, ref).toBeGreaterThanOrEqual(MIN_RATE_USD_PER_MTOK);
          expect(rate, ref).toBeLessThanOrEqual(MAX_RATE_USD_PER_MTOK);
        }
      }
      // A context window is a whole number of tokens no model of the catalog's generation is
      // below: a dropped digit would compact a Session on every turn.
      expect(Number.isInteger(m.contextWindow), m.modelId).toBe(true);
      expect(m.contextWindow!, m.modelId).toBeGreaterThanOrEqual(MIN_CONTEXT_WINDOW);
    }
  });

  it("custom: the group pins nothing, and a preset there carries its own endpoint and protocol", () => {
    // The custom group holds user-defined models, so the group itself implies no endpoint and
    // no protocol (see the MODEL_PROVIDERS test above): a preset filed there is complete on its
    // own row, and reaches both from the file alone, whatever custom's table later says.
    expect(providerClientType("custom")).toBeUndefined();
    expect(providerInfo("custom")!.gatewayBaseUrl).toBeUndefined();
    expect(presetProviderTable().custom).toBeUndefined();
    const elsewhere: ProviderTable = {
      custom: { base_url: "http://127.0.0.1:11434/v1", client_type: "openai-chat" },
    };
    for (const m of MODEL_CATALOG.filter((row) => row.provider === "custom" && !row.retired)) {
      const preset = presetModelEntries().find(
        (e) => e.provider === "custom" && e.model_id === m.modelId,
      )!;
      expect([preset.client_type, preset.base_url], m.modelId).toEqual([m.clientType, m.baseUrl]);
      expect(storedConnection(preset, elsewhere), m.modelId).toMatchObject({
        baseUrl: m.baseUrl,
        baseUrlSource: "model",
        clientType: canonicalClientType(m.clientType),
        clientTypeSource: "model",
      });
      expect(modelHomepageUrl("custom", m.modelId), m.modelId).toBeUndefined();
    }
  });

  it("vLLM (self-hosted): the group pins openai-chat-vllm-adapter, prices at zero and points at the local vLLM server", () => {
    const vllm = MODEL_CATALOG.filter((m) => m.provider === "vllm");
    for (const m of vllm) {
      // The pin is load-bearing on every row: Qwen/* begins with no family AutoLLMClient
      // knows and would be rejected, and deepseek-ai/DeepSeek-V4-* begins with "deepseek-",
      // which would reach DeepSeek's official Responses client pointed at a vLLM server.
      expect(m.clientType, m.modelId).toBe("openai-chat-vllm-adapter");
      // Nobody bills per token: the user runs the server. Zero is a real rate here, not a
      // missing one — see the pricing test.
      expect([m.pricing?.cache_read, m.pricing?.cache_write, m.pricing?.output], m.modelId).toEqual(
        [0, 0, 0],
      );
      expect(m.pricing!.unit, m.modelId).toBe("usd_per_mtok");
      // Chat Completions on the wire, but vLLM's own credentials: the client never reads
      // OPENAI_*.
      expect(rowEnvKey(m), m.modelId).toBe("VLLM_API_KEY");
      // Each preset id has a recipe page.
      expect(modelHomepageUrl("vllm", m.modelId), m.modelId).toBe(
        `https://recipes.vllm.ai/${m.modelId}`,
      );
    }
    // The group pin, read the one way every call site reads it.
    expect(providerClientType("vllm")).toBe("openai-chat-vllm-adapter");
    expect(providerInfo("vllm")!.gatewayBaseUrl).toBeUndefined();
    // A model added by hand stores no protocol and follows its group's table, so in a new
    // Project every built-in group that takes such models — custom aside, which leaves the
    // protocol to detection — resolves one for an id its catalog does not list, and on an
    // endpoint: the gateway's, or for vLLM the address a local `vllm serve` answers on.
    for (const group of MODEL_PROVIDERS.filter((p) => p.addable && p.id !== "custom")) {
      const added = storedConnection({ provider: group.id, model_id: "someone/added-by-hand" });
      expect(added.clientType, group.id).toBe(providerClientType(group.id));
      expect(added.clientType, group.id).toBeDefined();
      expect(added.baseUrl, group.id).toBe(
        group.id === "vllm" ? "http://127.0.0.1:8000/v1" : group.gatewayBaseUrl,
      );
    }
    expect(providerClientType("custom")).toBeUndefined();
    expect(providerClientType("my-own-group")).toBeUndefined();
    // Presets reach a Project with the pin and the local server's address, both on the group's
    // table, and the zero rate: what a self-hosted deployment bills per token is nothing, and
    // the Project stores that as a rate rather than as a gap (see the pricing test). The rows
    // store neither connection field, so a server elsewhere is one change on the group.
    const preset = presetModelEntries().filter((e) => e.provider === "vllm");
    expect(preset).toHaveLength(vllm.filter((m) => m.retired !== true).length);
    for (const e of preset) {
      const effective = storedConnection(e);
      expect(effective.clientType, e.model_id).toBe("openai-chat-vllm-adapter");
      expect(
        [e.pricing?.cache_read, e.pricing?.cache_write, e.pricing?.output],
        e.model_id,
      ).toEqual([0, 0, 0]);
      expect(effective.baseUrl, e.model_id).toBe("http://127.0.0.1:8000/v1");
      expect([e.client_type, e.base_url], e.model_id).toEqual([undefined, undefined]);
    }
    // An id the user serves themselves has no recipe page, so it falls back to the index.
    expect(modelHomepageUrl("vllm", "my-own-finetune")).toBe("https://recipes.vllm.ai/");
    // Fast mode rides on the client, and the vLLM client inherits openai_chat's mapping.
    expect(fastModeProtocol("my-own-finetune", "openai-chat-vllm-adapter")).toBe("openai");
  });

  it("providerInfo matches by id; unknown ids return undefined", () => {
    for (const p of MODEL_PROVIDERS) expect(providerInfo(p.id), p.id).toEqual(p);
    expect(providerInfo("nonexistent")).toBeUndefined();
  });

  it("catalogEntryFor is the sole lookup and always takes the (provider, model_id) pair", () => {
    // It matches on (group, upstream id) pairs, so an identically named upstream id never
    // matches across the wrong group: a gateway reselling a vendor model keeps the vendor's
    // upstream id, so a bare id names no single catalog entry. The upstream id may contain `/`
    // (gateway models) and is never split apart, and ids are case-sensitive at the vendor.
    const groupsOf = new Map<string, Set<string>>();
    for (const m of MODEL_CATALOG) {
      const ref = `${m.provider}/${m.modelId}`;
      expect(catalogEntryFor(m.provider, m.modelId), ref).toEqual(m);
      const recased =
        m.modelId === m.modelId.toLowerCase() ? m.modelId.toUpperCase() : m.modelId.toLowerCase();
      if (!MODEL_CATALOG.some((o) => o.provider === m.provider && o.modelId === recased)) {
        expect(catalogEntryFor(m.provider, recased), ref).toBeUndefined();
      }
      groupsOf.set(m.modelId, (groupsOf.get(m.modelId) ?? new Set()).add(m.provider));
    }
    // Each group's entry for a resold id is reached only through that group.
    for (const [modelId, groups] of groupsOf) {
      for (const { id } of MODEL_PROVIDERS) {
        const entry = catalogEntryFor(id, modelId);
        if (groups.has(id)) expect(entry?.provider, `${id}/${modelId}`).toBe(id);
        else expect(entry, `${id}/${modelId}`).toBeUndefined();
      }
    }
    expect(catalogEntryFor("custom", "my-own")).toBeUndefined();
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
  });

  it("the seed is honest: under a new Project's group tables, every catalog row resolves to its catalog protocol and endpoint from the file alone", () => {
    // presetModelEntries and catalogModelEntries (retired rows included) beside
    // presetProviderTable are the only place the catalog's connection values
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

  it("presetProviderTable: nothing for first-party vendors, custom or an unknown group, and a fresh table each time", () => {
    // First-party vendors route by id to their official clients' own endpoints: no table.
    const vendors = MODEL_PROVIDERS.filter((p) => vendorClientType(p.id) !== undefined);
    expect(vendors.length).toBeGreaterThan(0);
    const table = presetProviderTable();
    for (const { id } of vendors) {
      expect(catalogGroupConnection(id), id).toBeUndefined();
      expect(table[id], id).toBeUndefined();
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
    // What a row stores is what the file's table lacks: OpenRouter's proxy endpoint is not the
    // row's, its protocol is; TokenDance has no table left; Penguin Go's is the catalog's.
    const stored = (provider: string) => {
      const entry = rows.find((e) => e.provider === provider)!;
      const cat = catalogEntryFor(entry.provider, entry.model_id)!;
      return { entry, clientType: canonicalClientType(cat.clientType), baseUrl: cat.baseUrl };
    };
    const openrouter = stored("openrouter");
    expect(openrouter.entry.base_url).toBe(openrouter.baseUrl);
    expect(openrouter.entry.client_type).toBeUndefined();
    const tokendance = stored("tokendance");
    expect([tokendance.entry.client_type, tokendance.entry.base_url]).toEqual([
      tokendance.clientType,
      tokendance.baseUrl,
    ]);
    expect(stored("penguin-go").entry.base_url).toBeUndefined();
  });

  it("presetPromotions: a promoted row is seeded with its fraction, a Penguin Go row never is", () => {
    const promotions = presetPromotions();
    const promoted = MODEL_CATALOG.filter(
      (m) => m.discount !== undefined && m.retired !== true && m.provider !== "penguin-go",
    );
    expect(promoted.length).toBeGreaterThan(0);
    for (const m of promoted) {
      expect(promotions).toContainEqual({
        provider: m.provider,
        modelId: m.modelId,
        discount: m.discount,
      });
    }
    // Penguin Go's promotions are the platform's to deliver, at authorization and Sync.
    expect(promotions.filter((p) => p.provider === "penguin-go")).toEqual([]);
  });

  it("a gateway row pins its protocol and an https endpoint, and every preset outside the first-party groups runs on an endpoint", () => {
    // Never left to MMSP's family routing, which would throw outright on an owner-prefixed id
    // (openai/gpt-*, anthropic/claude-*) and send deepseek-ai/* to DeepSeek's client.
    const gateways = MODEL_PROVIDERS.filter((p) => p.gatewayBaseUrl !== undefined).map((p) => p.id);
    expect(gateways.length).toBeGreaterThan(0);
    for (const m of MODEL_CATALOG.filter((row) => gateways.includes(row.provider))) {
      const ref = `${m.provider}/${m.modelId}`;
      expect(m.clientType, ref).toBeDefined();
      expect(m.baseUrl, ref).toMatch(/^https:\/\//);
    }
    // In a new Project every preset outside the first-party vendor groups resolves to an
    // endpoint (a gateway's, the relay's, the local vLLM server's, a custom preset's own), and
    // a first-party row never does.
    for (const entry of presetModelEntries()) {
      const ref = `${entry.provider}/${entry.model_id}`;
      const firstParty = vendorClientType(entry.provider) !== undefined;
      expect(storedConnection(entry).baseUrl !== undefined, ref).toBe(!firstParty);
    }
  });

  it("a promoted row stores its list price and bills it less the promotion; any other unscheduled row bills its list price", () => {
    // The billed rate is derived from the two, never pasted beside them: change the list price
    // or the discount alone and the billed rate follows.
    for (const m of MODEL_CATALOG.filter(
      (row) => row.offPeakDiscount === undefined && row.pricing,
    )) {
      const billed = effectivePricing(m)!;
      for (const k of ["cache_read", "cache_write", "output"] as const) {
        expect(billed[k], `${m.provider}/${m.modelId} ${k}`).toBeCloseTo(
          m.pricing![k] * (1 - (m.discount ?? 0)),
          5,
        );
      }
    }
  });

  it("first-party vendor rows are auto-routed: no client_type, no base_url", () => {
    // MMSP routes these groups' ids by family, so they carry neither — the opposite of the
    // gateway groups.
    const vendorRows = MODEL_CATALOG.filter((m) => vendorClientType(m.provider) !== undefined);
    expect(vendorRows.length).toBeGreaterThan(0);
    for (const m of vendorRows) {
      expect(m.clientType, `${m.provider}/${m.modelId}`).toBeUndefined();
      expect(m.baseUrl, `${m.provider}/${m.modelId}`).toBeUndefined();
    }
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

describe("MMSP's clients as the catalog reads them", () => {
  it("CLIENT_PROTOCOLS has a row for exactly the client types MMSP's credentials module knows", () => {
    // A new MMSP client has no path or fast-mode answer until it gets a row here, and a row MMSP
    // dropped would answer for a client that no longer exists.
    expect(Object.keys(CLIENT_PROTOCOLS).sort()).toEqual(Object.keys(CLIENT_CREDENTIALS).sort());
  });

  it("a stored gemini-official, google-official's earlier name, is used exactly as google-official would be", () => {
    // MMSP keeps the alias; the models page, the server and the CLI accept it alike, with
    // google-official's variable and fast tier.
    expect(unroutableVendorModel("google", "gemini-3.8-flash", "gemini-official")).toBe(false);
    expect(
      modelEnvPreviewKey(
        { provider: "google", modelId: "gemini-3.8-flash", clientType: "gemini-official" },
        undefined,
      ),
    ).toBe("GEMINI_API_KEY");
    expect(fastModeProtocol("gemini-3.8-flash", "gemini-official")).toBe("openai");
  });

  it("vendorClientType: a first-party vendor group's official client, and none for any other group", () => {
    // The group's client is one MMSP knows, and it is the client every row of the group is
    // routed to by its id.
    const vendors = MODEL_PROVIDERS.filter((p) => vendorClientType(p.id) !== undefined);
    expect(vendors.length).toBeGreaterThan(0);
    for (const { id } of vendors) {
      const official = vendorClientType(id)!;
      expect(CLIENT_CREDENTIALS[official], id).toBeDefined();
      for (const m of MODEL_CATALOG.filter((row) => row.provider === id)) {
        expect(routedClientType(m.modelId, null), `${id}/${m.modelId}`).toBe(official);
      }
    }
    for (const id of ["penguin-go", "tokendance", "openrouter", "vllm", "custom", "my-group"]) {
      expect(vendorClientType(id), id).toBeUndefined();
    }
  });

  it("catalog invariant: each model's resolved client uses its provider's documented environment variables", () => {
    for (const m of MODEL_CATALOG) {
      const routed = routedClientType(m.modelId, m.clientType ?? null);
      const credentials = routed === null ? undefined : CLIENT_CREDENTIALS[routed];
      const env = credentials && {
        envKey: credentials.apiKeyEnv,
        envBaseUrlKey: credentials.baseUrlEnv,
      };
      const provider = providerInfo(m.provider)!;
      expect(env, `${m.provider}/${m.modelId}`).toBeDefined();
      if (m.provider === "custom") {
        // The custom group's pair is the fallback for its OpenAI-protocol default; an entry
        // pinned to another generic protocol reads that protocol's pair instead, exactly as a
        // user-added custom model on ant-messages does. The one preset here is on Messages.
        expect(env!.envKey, m.modelId).toBe("ANTHROPIC_API_KEY");
        expect(env!.envBaseUrlKey, m.modelId).toBe("ANTHROPIC_BASE_URL");
        continue;
      }
      if (
        (m.provider === "opencode-go" || m.provider === "tokendance") &&
        m.clientType === "ant-messages"
      ) {
        // OpenCode Go's and TokenDance's group pair is the OPENAI_* one their Chat Completions
        // and Responses rows read; their Messages rows read the Anthropic client's pair, the
        // same split as custom.
        expect(env!.envKey, m.modelId).toBe("ANTHROPIC_API_KEY");
        expect(env!.envBaseUrlKey, m.modelId).toBe("ANTHROPIC_BASE_URL");
        continue;
      }
      if (m.provider === "opencode-go" && m.clientType === "google-genai") {
        expect(env!.envKey, m.modelId).toBe("GEMINI_API_KEY");
        expect(env!.envBaseUrlKey, m.modelId).toBe("GEMINI_BASE_URL");
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
    // The Penguin Go relay pins its protocol per row rather than per group, so a model added
    // there by hand is routed by its id exactly as in any other vendor group.
    for (const p of MODEL_PROVIDERS) {
      const vendor =
        p.id !== "custom" &&
        p.gatewayBaseUrl === undefined &&
        providerClientType(p.id) === undefined;
      expect(isVendorGroup(p.id), p.id).toBe(vendor);
    }
    expect(isVendorGroup("my-own-group")).toBe(false);
    // Both kinds exist among the built-in groups.
    expect(new Set(MODEL_PROVIDERS.map((p) => isVendorGroup(p.id))).size).toBe(2);
  });

  it("isAddableGroup: a built-in group takes hand-added models as its catalog entry says, and custom and a user-defined group always do", () => {
    for (const p of MODEL_PROVIDERS) expect(isAddableGroup(p.id), p.id).toBe(p.addable === true);
    expect(isAddableGroup("custom")).toBe(true);
    expect(isAddableGroup("my-own-group")).toBe(true);
    // Both kinds exist among the built-in groups.
    expect(new Set(MODEL_PROVIDERS.map((p) => isAddableGroup(p.id))).size).toBe(2);
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
      "atlascloud",
      "runcrate",
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
    expect(fastModeProtocol("gemini-3.8-flash", "google-official")).toBe("openai");
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
    // An MMSP server forwards it to whatever client its table names for the model: nothing the
    // harness could vouch for, so no toggle.
    expect(fastModeProtocol("gpt-5.6", "mmsp")).toBeUndefined();
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
    expect(fastModeProtocol("claude-haiku-5-5")).toBeUndefined();
    expect(fastModeProtocol("claude-fable-5-1")).toBeUndefined();
    // Opus 5.5 is the 5.5 model that keeps the fast tier.
    expect(fastModeProtocol("claude-opus-5-5")).toBe("anthropic");
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
    expect(verdictOf("anthropic", "claude-opus-5-5")).toBe("anthropic");
    // The Anthropic rows the client refuses by name.
    for (const id of [
      "claude-sonnet-4-6",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
    ]) {
      expect(verdictOf("anthropic", id), id).toBeUndefined();
    }
    expect(verdictOf("openai", "gpt-5.5")).toBe("openai");
    expect(verdictOf("openai", "gpt-5.4-pro")).toBe("openai");
    expect(verdictOf("minimax", "MiniMax-M3")).toBe("openai");
    expect(verdictOf("google", "gemini-3.8-flash")).toBe("openai");
    // The relay's Gemini rows speak generateContent, which has no priority tier.
    expect(verdictOf("penguin-go", "gemini-3.8-flash")).toBeUndefined();
  });
});

describe("attribution on the catalog's endpoints (core's attributionHeaders)", () => {
  it("catalog invariant: every gateway row whose host runs an attribution scheme carries it", () => {
    const sessionId = "session-2026-09-17-10-30-00-a1b2c3d4";
    for (const m of MODEL_CATALOG) {
      const headers = attributionHeaders(m.baseUrl);
      if (m.provider === "openrouter") {
        expect(headers?.["HTTP-Referer"], m.modelId).toBe(APP_URL);
      } else if (m.provider === "tokendance") {
        expect(headers?.["X-App-URL"], m.modelId).toBe(APP_URL);
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

  it("a scheduled row stores its peak price: off-peak it bills half, and the cost center files it under its own schedule alone", () => {
    // 2026-08-31 is a Monday: 10:00 Beijing is peak on both vendors' clocks, 23:00 off-peak on both.
    const peak = beijing("2026-08-31T10:00");
    const offPeak = beijing("2026-08-31T23:00");
    const ref = (r: { provider: string; modelId: string }) => `${r.provider}/${r.modelId}`;
    const grouped = offPeakScheduledRefs();
    for (const schedule of [S, QWEN_OFF_PEAK]) {
      const rows = MODEL_CATALOG.filter((m) => m.offPeakDiscount === schedule);
      expect(grouped.find((g) => g.schedule === schedule)?.refs.map(ref) ?? []).toEqual(
        rows.map(ref),
      );
      for (const m of rows) {
        const atPeak = effectivePricing(m, peak)!;
        const atOff = effectivePricing(m, offPeak)!;
        for (const k of ["cache_read", "cache_write", "output"] as const) {
          // A seller's promotion on top of the schedule comes off both tiers alike. Compared at
          // 1e-5: both sides round to six decimals independently.
          expect(atPeak[k], `${ref(m)} ${k}`).toBeCloseTo(
            m.pricing![k] * (1 - (m.discount ?? 0)),
            5,
          );
          expect(atOff[k] * 2, `${ref(m)} ${k}`).toBeCloseTo(atPeak[k], 5);
        }
      }
    }
    // No reference is filed under two schedules.
    const filed = grouped.flatMap((g) => g.refs.map(ref));
    expect(new Set(filed).size).toBe(filed.length);
  });

  it("a retired row is never a preset, but a sync still compares it and it still prices a Project's usage on its schedule", () => {
    const retired = MODEL_CATALOG.filter((m) => m.retired === true);
    const refs = retired.map((m) => `${m.provider}/${m.modelId}`);
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
      expect(scheduled.has(ref), ref).toBe(m.offPeakDiscount !== undefined);
      const output = effectivePricing(m, beijing("2026-08-31T22:00"))!.output;
      expect(output, ref).toBeCloseTo(
        m.pricing!.output * (m.offPeakDiscount === undefined ? 1 : 0.5),
        5,
      );
    }
  });

  it("usage on the default model of new Projects keeps a price once a Project drops its row, and so does every former default; any other model's does not", () => {
    const ref = PRESET_DEFAULT_MODEL;
    expect(retainedCatalogPricing(ref.provider, ref.model_id)).toEqual(
      catalogEntryFor(ref.provider, ref.model_id)!.pricing,
    );
    for (const m of MODEL_CATALOG.filter((e) => e.wasDefault === true)) {
      expect(retainedCatalogPricing(m.provider, m.modelId), m.modelId).toBeDefined();
    }
    expect(retainedCatalogPricing("tokendance", "glm-5.3-flash")).toBeUndefined();
    expect(retainedCatalogPricing("custom", "mine")).toBeUndefined();
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
    const m = MODEL_CATALOG.find((x) => x.offPeakDiscount === S && x.discount === undefined)!;
    expect(effectivePricing(m, beijing("2026-08-31T10:00"))).toEqual(m.pricing);
    const off = effectivePricing(m, beijing("2026-08-31T20:00"))!;
    for (const k of ["cache_read", "cache_write", "output"] as const) {
      expect(off[k], k).toBeCloseTo(m.pricing![k] / 2, 5);
    }
  });
  it("every schedule is written in Beijing time, the one zone the badge's tooltip names", () => {
    // Both dictionaries say Beijing time outright rather than spelling out an offset, so a
    // schedule written in any other zone fails here instead of reaching the tooltip mislabelled.
    for (const { schedule, refs } of offPeakScheduledRefs()) {
      expect(schedule.utcOffsetMinutes, `${refs[0]!.provider}/${refs[0]!.modelId}`).toBe(480);
    }
  });
});

/**
 * The catalog's side of PRN-021: the variable names the UI shows are what MMSP's routed client
 * reads (its credentials module decides; the catalog only asks it).
 *
 * - Given a new Project's tables, every first-party vendor preset reads its vendor's variable,
 *   and no gateway preset reads any.
 * - Given a group's settings, the group dialog's hint names what the group's client reads with
 *   no key: the protocol's client, else the vendor's own for a first-party group — with no base
 *   URL or the client's own default endpoint, and never with another base URL.
 * - Given a row, the preview names exactly the variable a Session's client would read (a
 *   custom-protocol row with no base URL anywhere included), and nothing for a row with a key or
 *   a base URL MMSP refuses; the endpoint's variable only with no base URL anywhere.
 */
describe("environment variable names (what MMSP's routed client reads)", () => {
  const VENDORS = ["deepseek", "google", "openai", "anthropic", "zhipu", "moonshot", "minimax"];

  it("under a new Project's tables, every vendor preset reads its vendor's variable and no gateway preset reads any", () => {
    const table = presetProviderTable();
    let vendorRows = 0;
    let gatewayRows = 0;
    for (const entry of presetModelEntries()) {
      const ref = `${entry.provider}/${entry.model_id}`;
      const own = {
        provider: entry.provider,
        modelId: entry.model_id,
        clientType: entry.client_type,
        baseUrl: entry.base_url,
      };
      const preview = modelEnvPreviewKey(own, providerConnectionShape(table[entry.provider]));
      if (VENDORS.includes(entry.provider)) {
        vendorRows++;
        expect(preview, ref).toBe(providerInfo(entry.provider)!.envKey);
      } else if (providerInfo(entry.provider)?.gatewayBaseUrl !== undefined) {
        gatewayRows++;
        expect(preview, ref).toBeUndefined();
      }
    }
    expect(vendorRows).toBeGreaterThan(20);
    expect(gatewayRows).toBeGreaterThan(20);
  });

  it("the group dialog's hint names a variable for no base URL or the client's default endpoint, and never another", () => {
    const table = presetProviderTable();
    const hint = (id: string, group: ProviderConnection | undefined) =>
      providerEnvFallbackKey(id, providerConnectionShape(group));
    for (const id of VENDORS) {
      expect(hint(id, table[id]), id).toBe(providerInfo(id)!.envKey);
      // Another endpoint written on the group: nothing.
      expect(hint(id, { base_url: "https://api.example.com/v1" }), id).toBeUndefined();
    }
    // The vendor's own default endpoint written on the group is no endpoint change.
    expect(hint("deepseek", { base_url: "https://api.deepseek.com" })).toBe("DEEPSEEK_API_KEY");
    expect(hint("minimax", { base_url: "https://api.minimax.io/v1/" })).toBe("MINIMAX_API_KEY");
    // Gateways and the third-party adapters carry a base URL; custom has no table.
    for (const id of ["tokendance", "openrouter", "penguin-go", "modelscope", "custom"]) {
      expect(hint(id, table[id]), id).toBeUndefined();
    }
    // vLLM's preset table names the local server, whose client takes no key from the
    // environment for it.
    expect(hint("vllm", table.vllm)).toBeUndefined();
    // A group with a protocol and no base URL: the protocol's variable, whoever the group is —
    // VLLM_API_KEY for vLLM's client, never OPENAI_API_KEY.
    expect(hint("vllm", { client_type: "openai-chat-vllm-adapter" })).toBe("VLLM_API_KEY");
    expect(hint("my-group", { client_type: "ant-messages" })).toBe("ANTHROPIC_API_KEY");
    expect(hint("zhipu", { client_type: "zai-official" })).toBe("ZAI_API_KEY");
    // A user group with neither names nothing: its rows route by id, which a group cannot know.
    expect(hint("my-group", undefined)).toBeUndefined();
  });

  it("the row preview names exactly the variable a Session's client would read, and nothing where MMSP refuses", () => {
    const table = presetProviderTable();
    const own = (entry: ModelEntry) => ({
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: entry.client_type,
      baseUrl: entry.base_url,
      apiKey: entry.api_key,
    });
    const preview = (entry: ModelEntry, group = table[entry.provider]) =>
      modelEnvPreviewKey(own(entry), providerConnectionShape(group));
    for (const entry of presetModelEntries()) {
      const ref = `${entry.provider}/${entry.model_id}`;
      if (VENDORS.includes(entry.provider)) {
        expect(preview(entry), ref).toBe(providerInfo(entry.provider)!.envKey);
      } else {
        // A gateway, a third-party adapter, custom's preset, or vLLM's local server on its
        // group's table: no variable.
        expect(preview(entry), ref).toBeUndefined();
      }
    }
    const flash = { provider: "deepseek", model_id: "deepseek-flash" };
    // A key in the file: nothing.
    expect(preview({ ...flash, api_key: "sk-row" })).toBeUndefined();
    expect(preview(flash, { api_key: "sk-group" })).toBeUndefined();
    // The client's own default endpoint, on the row or the group: still its variable.
    expect(preview({ ...flash, base_url: "https://api.deepseek.com" })).toBe("DEEPSEEK_API_KEY");
    expect(preview(flash, { base_url: "https://api.deepseek.com/" })).toBe("DEEPSEEK_API_KEY");
    // Any other base URL, a proxy or the vendor's second host: nothing.
    expect(preview({ ...flash, base_url: "https://proxy.example/deepseek" })).toBeUndefined();
    expect(
      preview({
        provider: "moonshot",
        model_id: "kimi-k3",
        base_url: "https://api.moonshot.ai/v1",
      }),
    ).toBeUndefined();
    // A row pinned to another vendor's client with no base URL: its client's own variable.
    const pinned = {
      provider: "openai",
      model_id: "claude-sonnet-5",
      client_type: "anthropic-official",
    };
    expect(preview(pinned)).toBe("ANTHROPIC_API_KEY");
    // A custom row on a protocol client with no base URL anywhere: that client's variable.
    expect(
      preview({ provider: "custom", model_id: "qwen-local", client_type: "openai-chat" }),
    ).toBe("OPENAI_API_KEY");
  });

  it("the endpoint's variable is named only where no base URL is set, key or not", () => {
    const row = { provider: "deepseek", modelId: "deepseek-flash" };
    // With no base URL, the endpoint the requests go to while the variable is unset as well.
    expect(modelEnvironment(row, undefined)).toEqual({
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrlEnv: "DEEPSEEK_BASE_URL",
      defaultBaseUrl: "https://api.deepseek.com",
    });
    expect(modelEnvironment({ ...row, apiKey: "sk-row" }, undefined)).toEqual({
      baseUrlEnv: "DEEPSEEK_BASE_URL",
      defaultBaseUrl: "https://api.deepseek.com",
    });
    expect(modelEnvironment(row, { baseUrl: "https://api.deepseek.com" })).toEqual({
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
    expect(
      modelEnvironment({ ...row, apiKey: "sk-row" }, { baseUrl: "https://gw.example/v1" }),
    ).toEqual({});
    // A vLLM row with no base URL anywhere reads vLLM's own pair and goes to the local
    // server; with a base URL and no key it is called keyless, so it reads nothing.
    const vllm = {
      provider: "vllm",
      modelId: "Qwen/Qwen3.8-27B",
      clientType: "openai-chat-vllm-adapter",
    };
    expect(modelEnvironment(vllm, undefined)).toEqual({
      apiKeyEnv: "VLLM_API_KEY",
      baseUrlEnv: "VLLM_BASE_URL",
      defaultBaseUrl: "http://127.0.0.1:8000/v1",
    });
    expect(modelEnvironment(vllm, { baseUrl: "http://gpu-box.lan:8000/v1" })).toEqual({});
    // An open MMSP server is called keyless; an id nothing routes reads nothing.
    expect(
      modelEnvironment(
        { provider: "penguin-go", modelId: "gemini-3.8-flash" },
        { baseUrl: PENGUIN_GO_BASE_URL, clientType: "mmsp" },
      ),
    ).toEqual({});
    expect(modelEnvironment({ provider: "deepseek", modelId: "qwen/qwen3.8" }, undefined)).toEqual(
      {},
    );
  });

  it("a blank key is sent as none only to an open server's client, never to a sign-in-keyed relay", () => {
    const vllm = { clientType: "openai-chat-vllm-adapter" };
    // vLLM handed a base URL, its own default included, or none (its variable unset); an MMSP
    // server.
    expect(providerCalledKeyless("vllm", { ...vllm, baseUrl: "http://127.0.0.1:8000/v1" })).toBe(
      true,
    );
    expect(providerCalledKeyless("vllm", { ...vllm, baseUrl: "http://gpu-box.lan:8000/v1" })).toBe(
      true,
    );
    expect(providerCalledKeyless("vllm", vllm)).toBe(true);
    expect(
      providerCalledKeyless("my-group", { clientType: "mmsp", baseUrl: "http://mmsp.lan/v1" }),
    ).toBe(true);
    // Penguin Go speaks MMSP too, but its relay takes the signed-in key only.
    expect(
      providerCalledKeyless("penguin-go", { clientType: "mmsp", baseUrl: PENGUIN_GO_BASE_URL }),
    ).toBe(false);
    // A vendor's client refuses a keyless call; a group with no one client cannot say.
    expect(providerCalledKeyless("deepseek", undefined)).toBe(false);
    expect(providerCalledKeyless("custom", undefined)).toBe(false);

    const row = { provider: "vllm", modelId: "Qwen/Qwen3.8-27B", ...vllm };
    expect(modelCalledKeyless(row, { baseUrl: "http://127.0.0.1:8000/v1" })).toBe(true);
    // A key of its own or its group's is sent, not none.
    expect(modelCalledKeyless({ ...row, apiKey: "sk-row" }, undefined)).toBe(false);
    expect(
      modelCalledKeyless(row, { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "sk-group" }),
    ).toBe(false);
    expect(
      modelCalledKeyless(
        { provider: "penguin-go", modelId: "gemini-3.8-flash" },
        { baseUrl: PENGUIN_GO_BASE_URL, clientType: "mmsp" },
      ),
    ).toBe(false);
    expect(modelCalledKeyless({ provider: "deepseek", modelId: "deepseek-flash" }, undefined)).toBe(
      false,
    );
  });
});

/**
 * Catalog presets under the connection rules: rows the catalog pins keep their own protocol
 * while the group sets another, and custom's preset keeps its own endpoint and needs its own
 * key.
 */
describe("catalog presets under the connection rules", () => {
  it("an explicitly pinned row keeps its own protocol while the group sets another", () => {
    const table: ProviderTable = {
      "penguin-go": { base_url: PENGUIN_GO_BASE_URL, client_type: "openai-chat", api_key: "pg" },
    };
    const rows = presetModelEntries()
      .filter((e) => e.provider === "penguin-go")
      .map((row) => ({ ...row, client_type: "mmsp" }));
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
    // So its client is handed its endpoint and no key — which MMSP refuses — rather than sent
    // anywhere with Ollama's.
    expect(resolveEntryCredential(atria, providerConnectionShape(ollama))).toEqual({
      baseUrl: cat.baseUrl,
      clientType: cat.clientType,
    });
    // A key of the preset's own still works, on the preset's endpoint and protocol.
    expect(
      resolveEntryCredential({ ...atria, api_key: "sk-atria" }, providerConnectionShape(ollama)),
    ).toEqual({ apiKey: "sk-atria", baseUrl: cat.baseUrl, clientType: cat.clientType });
    // A model the user typed into custom follows the group in all three fields.
    expect(
      resolveEntryCredential(
        { provider: "custom", model_id: "qwen3.8-27b-local" },
        providerConnectionShape(ollama),
      ),
    ).toEqual({
      apiKey: "sk-ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      clientType: "openai-chat",
    });
  });
});
