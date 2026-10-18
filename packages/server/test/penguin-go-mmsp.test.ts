/**
 * Penguin Go migration through real config stores and the real MMSP HTTP client.
 * - Overlapping and MMSP-only deliveries use MMSP and retain detailed metadata.
 * - New authorization, reauthorization and sync use MMSP with the existing device flow.
 * - Old projects migrate on the server's read, including model overrides, and repeated reads do
 *   not rewrite; a load through the SDK alone leaves them as written (the migration needs the
 *   server's catalog) — unless the App's start has swept every Project's file first, an
 *   unparseable one left for its own read to report.
 * - Config migration needs no network requests, keys or current-catalog membership.
 * - Other groups and redirected Go rows keep their keys, settings and routes.
 * - The Go protocol is fixed: the group route and the whole-table PUT refuse another one, while
 *   a redirected row's stored protocol saves back unchanged.
 * - One inference POST carries done history, base64 media and tools, and returns thinking/usage.
 * - HTTP/SSE errors, missing stop and cancellation produce outcomes without protocol retries.
 */
import fs from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GenerativeModel,
  loadProjectConfig,
  projectConfigPath,
  userText,
  assistantText,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  inlineData,
} from "@prismshadow/penguin-core";
import type { LLMOutcome, OmniMessage } from "@prismshadow/penguin-core";
import type { ErrorBody, ModelsResponse } from "../src/api/types.js";
import { PlatformAuthService, platformConnection } from "../src/services/platform-auth-service.js";
import { migratePenguinGoRoutes } from "../src/services/project-config-migrations.js";
import { fakeFetch, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { createTestApp, provisionUser, apiClient } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const base = "https://go.penguin.ooo/api/v1";
const mmspRoute = { protocol: "mmsp", endpoint: "mmsp" };
const model = (provider = "deepseek", modelId = "deepseek-flash") => ({
  provider,
  modelId,
  displayName: modelId,
  contextWindow: 1000000,
  supportsVision: true,
  pricing: { unit: "usd_per_mtok", cacheRead: 0.1, cacheWrite: 1, output: 3 },
  recommendedRoute:
    provider === "google"
      ? { protocol: "google-generative-language", endpoint: "google" }
      : { protocol: "deepseek-responses", endpoint: "openai" },
});
function catalog(state: "overlap" | "mmsp") {
  const models = [model(), model("google", "gemini-3.8-flash")].map((m) => ({
    ...m,
    ...(state === "mmsp"
      ? { recommendedRoute: mmspRoute, supportedRoutes: [mmspRoute] }
      : state === "overlap"
        ? { supportedRoutes: [m.recommendedRoute, mmspRoute] }
        : {}),
  }));
  return {
    schemaVersion: 1,
    catalogVersion: "migration-test",
    endpoints:
      state === "mmsp"
        ? { mmsp: base }
        : {
            openai: "https://token.penguin.ooo/api",
            google: "https://token.penguin.ooo/api",
            ...(state === "overlap" ? { mmsp: base } : {}),
          },
    models,
  };
}
function delivery(state: "overlap" | "mmsp", key = "ep_delivered") {
  return {
    status: "claimed",
    client: { id: "penguin-harness" },
    mmspBaseURL: base,
    user: { id: 7, username: "retained-account" },
    connection: { ...catalog(state), apiKey: key },
  };
}
function oldConfig(key: string) {
  return {
    default_model: { provider: "penguin-go", model_id: "deepseek-flash" },
    vision_model: { provider: "penguin-go", model_id: "gemini-3.8-flash" },
    account_note: "keep-account-metadata",
    providers: {
      "penguin-go": {
        api_key: key,
        base_url: "https://token.penguin.ooo/api",
        created_at: "2026-09-01",
      },
    },
    models: [
      {
        provider: "penguin-go",
        model_id: "deepseek-flash",
        client_type: "deepseek-official",
        base_url: "https://token.penguin.ooo/api",
        fast_mode: true,
        max_tokens: 1234,
        context_window: 456789,
        display_name: "My model",
        vision: false,
        pricing: { unit: "usd_per_mtok", cache_read: 0.01, cache_write: 0.2, output: 0.3 },
      },
      {
        provider: "penguin-go",
        model_id: "gemini-3.8-flash",
        client_type: "google-genai",
        api_key: "ep_own_model",
      },
      {
        provider: "penguin-go",
        model_id: "user-proxy",
        base_url: "https://user.example/v1",
        client_type: "openai-chat",
        api_key: "user-key",
      },
      {
        provider: "custom",
        model_id: "deepseek-flash",
        client_type: "openai-chat",
        base_url: "https://token.penguin.ooo/api",
        api_key: "custom-key",
      },
      {
        provider: "google",
        model_id: "gemini-3.8-flash",
        client_type: "google-genai",
        api_key: "vendor-key",
      },
    ],
  };
}

describe("Penguin Go routes", () => {
  it.each(["overlap", "mmsp"] as const)(
    "%s delivery uses MMSP and keeps detailed metadata",
    (state) => {
      const result = platformConnection(delivery(state));
      expect(result.apiKey).toBe("ep_delivered");
      expect(result.catalog.models).toHaveLength(2);
      expect(result.catalog.models[0]).toMatchObject({
        clientType: "mmsp",
        baseUrl: base,
        contextWindow: 1000000,
        supportsVision: true,
        pricing: { unit: "usd_per_mtok", cacheRead: 0.1, cacheWrite: 1, output: 3 },
      });
    },
  );
  it.each(["https://go.penguin.ooo/api", `${base}/stream`, `${base}/v1/stream`])(
    "rejects an MMSP base that would append the wrong stream path: %s",
    (endpoint) => {
      const body = delivery("mmsp");
      body.connection.endpoints = { mmsp: endpoint };
      expect(() => platformConnection(body)).toThrow("invalid endpoint");
    },
  );
  it("keeps list prices and the promotion when old endpoints are absent", () => {
    const body = delivery("mmsp");
    Object.assign(body.connection.models[0]!, {
      listPricing: { unit: "usd_per_mtok", cacheRead: 0.2, cacheWrite: 2, output: 6 },
      discount: 0.5,
    });
    expect(platformConnection(body).catalog.models[0]).toMatchObject({
      clientType: "mmsp",
      discount: 0.5,
      pricing: { cacheRead: 0.2, cacheWrite: 2, output: 6 },
    });
  });
});

describe("Penguin Go stored projects", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let sequence = 0;
  beforeAll(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "mmsp_owner");
    owner = apiClient(t.app, user.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  async function project() {
    const projectId = `mmsp_owner-project_${++sequence}`;
    expect((await owner.post("/api/projects", { projectId })).status).toBe(201);
    return projectId;
  }
  function auth(fetchImpl: typeof fetch) {
    return new PlatformAuthService({
      origin: "https://go.penguin.ooo",
      fetchImpl,
      getKey: (id) => t.deps.projectConfigService.getGroupApiKey(id, "penguin-go"),
      applyCatalog: (id, c, key, applyKey) =>
        t.deps.projectConfigService.mergePlatformModels(id, "penguin-go", c, key, applyKey),
    });
  }
  it.each(["overlap", "mmsp"] as const)(
    "new authorization and reauthorization accept %s without new key issuance",
    async (state) => {
      const id = await project();
      // No automatic discovery is needed by this explicit device flow.
      const fake = fakeFetch((call) =>
        call.url.endsWith("/start")
          ? jsonResponse({ expiresAt: new Date(Date.now() + 600000).toISOString() }, 201)
          : jsonResponse(delivery(state, "saved-device-key")),
      );
      const service = auth(fake.fetch);
      for (let i = 0; i < 2; i++) {
        const start = await service.start({ projectId: id, userId: "mmsp_owner" });
        expect(
          await service.status({ projectId: id, userId: "mmsp_owner", flowId: start.flowId }),
        ).toMatchObject({ status: "completed" });
      }
      const rows = (await t.deps.projectConfigService.loadConfig(id)).models.filter(
        (m) => m.provider === "penguin-go",
      );
      const go = rows.find((m) => m.model_id === "deepseek-flash")!;
      const config = await t.deps.projectConfigService.readRaw(id);
      expect(
        go.client_type ??
          (config.providers as Record<string, Record<string, unknown>>)["penguin-go"]!.client_type,
      ).toBe("mmsp");
      expect(await t.deps.projectConfigService.getGroupApiKey(id, "penguin-go")).toBe(
        "saved-device-key",
      );
      expect(fake.calls).toHaveLength(4);
      expect(
        fake.calls
          .filter((c) => c.url.endsWith("/poll"))
          .every((c) => c.headers.get("x-penguin-protocol") === "mmsp"),
      ).toBe(true);
    },
  );
  it("sync changes both group and row routes while retaining keys, selections, promotions and custom settings", async () => {
    const id = await project();
    const deliveredBase = "https://token.penguin.ooo/api/v1";
    const original = oldConfig("saved-device-key");
    await t.deps.projectConfigService.writeRaw(id, original);
    t.deps.db
      .prepare(
        "INSERT INTO model_promotions(project_id,provider,model_id,discount,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(id, "penguin-go", "deepseek-flash", 0.4, new Date().toISOString());
    const fake = fakeFetch((call) => {
      expect(call.url).toBe("https://go.penguin.ooo/api/client/models");
      expect(call.headers.get("x-penguin-protocol")).toBe("mmsp");
      expect(call.headers.get("authorization")).toBe("Bearer saved-device-key");
      const body = catalog("overlap");
      body.endpoints.mmsp = deliveredBase;
      return jsonResponse(body);
    });
    expect(await auth(fake.fetch).sync(id)).toMatchObject({ added: 0, updated: 2 });
    expect(await auth(fake.fetch).sync(id)).toMatchObject({ added: 0, updated: 0 });
    const raw = await t.deps.projectConfigService.readRaw(id);
    const rows = raw.models as Record<string, unknown>[];
    expect(rows[0]).toEqual({
      ...original.models[0],
      client_type: "mmsp",
      base_url: deliveredBase,
    });
    expect(rows[1]).toEqual({
      ...original.models[1],
      client_type: "mmsp",
      base_url: deliveredBase,
    });
    expect(rows.slice(2)).toEqual(original.models.slice(2));
    expect(raw.default_model).toEqual(original.default_model);
    expect(raw.vision_model).toEqual(original.vision_model);
    expect(raw.account_note).toBe(original.account_note);
    expect(await t.deps.projectConfigService.getGroupApiKey(id, "penguin-go")).toBe(
      "saved-device-key",
    );
    expect(
      t.deps.db
        .prepare(
          "SELECT discount FROM model_promotions WHERE project_id=? AND provider='penguin-go'",
        )
        .get(id),
    ).toMatchObject({ discount: 0.4 });
    expect(fake.calls).toHaveLength(2);
  });
  it("server loads migrate multiple old projects and do not rewrite a second time; an SDK load leaves them as written", async () => {
    const ids = [await project(), await project()];
    const fake = stubFetch(() => {
      throw new Error("Migration must not access the network");
    });
    for (const id of ids) {
      await t.deps.projectConfigService.writeRaw(id, oldConfig(`ep_auto_${id}`));
      // The SDK alone has no catalog to migrate with: the old route stays as written.
      const file = projectConfigPath(t.root, id);
      const written = await fs.readFile(file, "utf8");
      expect((await loadProjectConfig(t.root, id)).models[0]?.client_type).not.toBe("mmsp");
      expect(await fs.readFile(file, "utf8")).toBe(written);
      const config = await t.deps.projectConfigService.loadConfig(id);
      expect(config.models[0]).toMatchObject({
        model_id: "deepseek-flash",
        client_type: "mmsp",
        base_url: base,
        max_tokens: 1234,
        fast_mode: true,
      });
      const first = await fs.readFile(file, "utf8");
      await loadProjectConfig(t.root, id);
      await t.deps.projectConfigService.loadConfig(id);
      expect(await fs.readFile(file, "utf8")).toBe(first);
    }
    expect(fake.calls).toHaveLength(0);
  });
  it("the App's start migrates every Project's stored routes before anything opens one, so an SDK load reads them migrated", async () => {
    const ids = [await project(), await project()];
    for (const id of ids) {
      await t.deps.projectConfigService.writeRaw(id, oldConfig(`ep_sweep_${id}`));
    }
    // A file that does not parse is left for the read that needs it to report.
    const broken = projectConfigPath(t.root, await project());
    await fs.writeFile(broken, "this is = = not toml", "utf8");
    const fake = stubFetch(() => {
      throw new Error("Migration must not access the network");
    });
    try {
      await t.deps.projectConfigService.migrateStoredConfigs();
      for (const id of ids) {
        expect((await loadProjectConfig(t.root, id)).models[0], id).toMatchObject({
          model_id: "deepseek-flash",
          client_type: "mmsp",
          base_url: base,
        });
      }
      expect(await fs.readFile(broken, "utf8")).toBe("this is = = not toml");
      expect(fake.calls).toHaveLength(0);
    } finally {
      await fs.rm(broken, { force: true });
    }
  });
  it("legacy row overrides migrate even when the group's defaults already use MMSP", async () => {
    const id = await project();
    const raw = oldConfig(`ep_override_${id}`);
    Object.assign(raw.providers["penguin-go"], { base_url: base, client_type: "mmsp" });
    await t.deps.projectConfigService.writeRaw(id, raw);
    const fake = stubFetch(() => {
      throw new Error("Migration must not access the network");
    });
    const migrated = await t.deps.projectConfigService.loadConfig(id);
    expect(migrated.models[0]).toMatchObject({ client_type: "mmsp", base_url: base });
    await t.deps.projectConfigService.loadConfig(id);
    expect(fake.calls).toHaveLength(0);
  });
  it("migration includes retired model ids and needs no saved key", () => {
    const raw = oldConfig("");
    raw.models[0]!.model_id = "retired-go-model";
    expect(migratePenguinGoRoutes(raw)).toBe(2);
    expect(raw.models[0]).toMatchObject({
      model_id: "retired-go-model",
      client_type: "mmsp",
      base_url: base,
    });
    expect(migratePenguinGoRoutes(raw)).toBe(0);
  });
  it("a redirected row keeps the protocol it previously inherited from the Go group", () => {
    const raw = oldConfig("ep_inherited");
    Object.assign(raw.providers["penguin-go"], { client_type: "openai-chat" });
    delete (raw.models[2] as Record<string, unknown>).client_type;
    const before = structuredClone(raw.models[2]);
    migratePenguinGoRoutes(raw);
    expect(raw.models[2]).toEqual({ ...before, client_type: "openai-chat" });
    expect(migratePenguinGoRoutes(raw)).toBe(0);
  });
  it("refuses another protocol on the Go group and its rows, and saves a redirected row's stored one back", async () => {
    const id = await project();
    const url = `/api/projects/${id}/models`;
    const refused = async (res: Response) => {
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("penguin_go_protocol_fixed");
    };
    await refused(await owner.put(`${url}/providers/penguin-go`, { clientType: "openai-chat" }));
    await refused(await owner.put(`${url}/providers/penguin-go`, { clientType: null }));
    expect((await owner.put(`${url}/providers/penguin-go`, { clientType: "mmsp" })).status).toBe(
      200,
    );

    // `user-proxy` points at the user's own server on Chat Completions, as stored before.
    await t.deps.projectConfigService.writeRaw(id, oldConfig("ep_fixed"));
    const table = (await (await owner.get(url)).json()) as ModelsResponse;
    const entries = table.models.map((m) => ({
      provider: m.provider,
      modelId: m.modelId,
      ...(m.clientType !== undefined ? { clientType: m.clientType } : {}),
    }));
    expect((await owner.put(url, { models: entries })).status).toBe(200);
    const withClient = (modelId: string, clientType: string) =>
      entries.map((e) =>
        e.provider === "penguin-go" && e.modelId === modelId ? { ...e, clientType } : e,
      );
    await refused(await owner.put(url, { models: withClient("user-proxy", "google-genai") }));
    const rowRefused = await owner.put(url, {
      models: withClient("deepseek-flash", "openai-chat"),
    });
    expect(rowRefused.status).toBe(400);
    // A refused row names itself, so a machine's config sync skips that row, not the table.
    expect(((await rowRefused.json()) as { error: Record<string, unknown> }).error).toMatchObject({
      code: "penguin_go_protocol_fixed",
      details: { provider: "penguin-go", modelId: "deepseek-flash" },
    });
    const rows = (await t.deps.projectConfigService.readRaw(id)).models as Record<
      string,
      unknown
    >[];
    expect(rows.find((m) => m.model_id === "user-proxy")).toMatchObject({
      client_type: "openai-chat",
      base_url: "https://user.example/v1",
    });
  });
  it("a redirected Go group and all other groups stay unchanged", () => {
    const raw = oldConfig("ep_scope");
    raw.providers["penguin-go"].base_url = "https://user.example/v1";
    raw.models[0]!.base_url = "https://user.example/v1";
    const before = structuredClone(raw);
    expect(migratePenguinGoRoutes(raw)).toBe(0);
    expect(raw).toEqual(before);
  });
});

async function drain(stream: AsyncGenerator<OmniMessage, LLMOutcome>) {
  const messages: OmniMessage[] = [];
  for (;;) {
    const step = await stream.next();
    if (step.done) return { messages, outcome: step.value };
    messages.push(step.value);
  }
}
const stop = {
  role: "assistant",
  event_type: "stop",
  content_items: [],
  usage_metadata: { cached_tokens: 10, prompt_tokens: 20, thoughts_tokens: 3, response_tokens: 7 },
  finish_reason: "stop",
};
const delta = (item: unknown) => ({
  role: "assistant",
  event_type: "delta",
  content_items: [item],
  usage_metadata: null,
  finish_reason: null,
});
function sse(events: unknown[]) {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
function llm(provider = "penguin-go") {
  return new GenerativeModel({
    modelId: "deepseek-flash",
    clientType: "mmsp",
    baseUrl: provider === "penguin-go" ? base : "https://other.example/v1",
    apiKey: "ep_existing",
    fastMode: true,
    sessionId: "local-trace-preserved",
    tools: [
      { name: "lookup", description: "Lookup", parameters: { type: "object", properties: {} } },
    ],
  });
}
describe("Penguin Go MMSP HTTP transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("posts once to /api/v1/stream, preserves done history and media, and translates thinking, tools and usage", async () => {
    const fake = stubFetch(() =>
      sse([
        delta({ type: "thinking.delta", thinking: "Think" }),
        delta({ type: "thinking.done", thinking: "Think", fidelity: { signature: "signed" } }),
        delta({ type: "tool_call.delta", name: "lookup", arguments: "{}", tool_call_id: "call-1" }),
        delta({ type: "tool_call.done", name: "lookup", arguments: {}, tool_call_id: "call-1" }),
        { ...stop, finish_reason: "tool_call" },
      ]),
    );
    const client = llm();
    client.setHistory([
      userText("previous"),
      thinkingMessage("saved", "completed", { signature: "history-signature" }),
      assistantText("past"),
      toolCall({ name: "lookup", arguments: "{}", toolCallId: "old-call" }),
      toolCallOutput({ toolCallId: "old-call", output: "result" }),
    ]);
    const result = await drain(
      client.streamGenerate({
        newMessages: [userText("now"), inlineData("user", "aGVsbG8=", "image/png")],
      }),
    );
    expect(result.outcome).toEqual({ status: "completed" });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.url).toBe(`${base}/stream`);
    expect(call.headers.get("authorization")).toBe("Bearer ep_existing");
    const body = JSON.parse(call.body);
    expect(Object.keys(body).sort()).toEqual(["config", "messages", "model"]);
    expect(body.config.fast_mode).toBe(true);
    expect(body.config).not.toHaveProperty("trace_id");
    expect(body.config.tools[0].name).toBe("lookup");
    const items = body.messages.flatMap((m: { content_items: unknown[] }) => m.content_items);
    expect(items).toContainEqual({
      type: "inline_data.done",
      data: "aGVsbG8=",
      mime_type: "image/png",
    });
    expect(items).toContainEqual({
      type: "thinking.done",
      thinking: "saved",
      fidelity: { signature: "history-signature" },
    });
    expect(items.every((i: { type: string }) => i.type.endsWith(".done"))).toBe(true);
    expect(result.messages.map((m) => m.payload)).toContainEqual(
      expect.objectContaining({
        type: "thinking",
        thinking: "Think",
        fidelity: { signature: "signed" },
      }),
    );
    expect(result.messages.map((m) => m.payload)).toContainEqual(
      expect.objectContaining({ type: "tool_call", name: "lookup" }),
    );
    expect(result.messages.map((m) => m.payload)).toContainEqual(
      expect.objectContaining({
        type: "token_usage",
        request: { cache_read: 10, cache_write: 20, output: 10, total: 40 },
      }),
    );
  });
  it("another MMSP model group still receives its premium serving setting", async () => {
    const fake = stubFetch(() => sse([delta({ type: "text.done", text: "ok" }), stop]));
    await drain(llm("custom").streamGenerate({ newMessages: [userText("now")] }));
    expect(JSON.parse(fake.calls[0]!.body).config.fast_mode).toBe(true);
  });
  it.each(["http", "sse", "missing-stop"])(
    "%s failure ends without a protocol fallback or a second request",
    async (kind) => {
      const fake = stubFetch(() =>
        kind === "http"
          ? jsonResponse({ error: { type: "invalid_request", message: "bad request" } }, 400)
          : kind === "sse"
            ? sse([{ error: { type: "upstream_error", message: "upstream failed", status: 502 } }])
            : sse([delta({ type: "text.delta", text: "partial" })]),
      );
      const result = await drain(llm().streamGenerate({ newMessages: [userText("now")] }));
      expect(result.outcome.status).toBe(kind === "http" ? "fatal" : "retryable");
      expect(
        result.messages.some((m) => "type" in m.payload && m.payload.type === "token_usage"),
      ).toBe(false);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.url).toBe(`${base}/stream`);
    },
  );
  it("cancellation reaches the SDK request and sends no replacement inference", async () => {
    const controller = new AbortController();
    let issued!: () => void;
    const ready = new Promise<void>((resolve) => {
      issued = resolve;
    });
    const fake = stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          issued();
        }),
    );
    const result = drain(
      llm().streamGenerate({ newMessages: [userText("now")], signal: controller.signal }),
    );
    await ready;
    controller.abort();
    expect((await result).outcome).toEqual({ status: "aborted" });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.init!.signal!.aborted).toBe(true);
  });
});
