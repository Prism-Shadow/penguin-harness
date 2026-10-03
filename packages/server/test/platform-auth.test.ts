/**
 * Penguin Go key delivery: the platform's device authorization, as the models page drives it
 * through /api/projects/:p/platform-auth, and the catalog sync that follows.
 *
 * - A delivery is accepted only for this client with a connection API key; its models are
 *   normalized to their list price with the promotion stored beside it, and a delivery with a
 *   malformed model (no output length, a negative or non-USD price) is refused.
 * - Given a Project whose Penguin Go group has no key, the owner's authorization writes the
 *   delivered key once, as the group's key every model of the group uses, and adds the
 *   delivered models the group lacks with their list price, routing and promotion (a member is
 *   refused, and a sync before any key asks for reauthorization); a model the group already
 *   holds keeps its own price and promotion; nothing of the account or the key itself is ever
 *   answered back. In a group where no model uses the key yet (every one keyed on its own, and
 *   nothing new delivered), the key still lands and the flow completes with a count of 0.
 * - A later sync adds a newly listed model the same way, and never rewrites a model the group
 *   holds: a repricing or a new promotion of one changes nothing, and nothing is written.
 * - An added model stores its protocol and endpoint per field against the group's table as
 *   the file holds it (never the catalog's): a field the table holds is followed — a group
 *   pointed at a proxy takes the new model along, with its key — and one the table lacks is
 *   written on the model in full.
 * - Disconnect (clearing the group key) leaves every model in place, none using the key, and a
 *   sync asks for authorization again.
 * - The platform's start backoff reaches the caller as a 429 with Retry-After.
 * - A stored key the platform rejects asks for reauthorization and applies nothing.
 * - A failed write retries with the key already claimed, without polling the platform again.
 * - A rate-limited poll stays pending and polls again only after the platform's backoff.
 * - A flow the user cancels while a poll is in flight applies nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogEntryFor } from "@prismshadow/penguin-core";
import type {
  ModelsResponse,
  PlatformAuthFlowStatusResponse,
  PlatformAuthStartResponse,
  PlatformModelSyncResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { PlatformAuthService, platformConnection } from "../src/services/platform-auth-service.js";
import { fakeFetch, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const json = (status: number, body: unknown): Response => jsonResponse(body, status);

const deliveryBody = {
  status: "claimed",
  client: { id: "penguin-harness", displayName: "PenguinHarness" },
  user: { id: 7, username: "penguin-go-user", displayName: "Penguin Go User", avatarUrl: null },
  apiKey: "ignored-top-level-key",
  connection: {
    apiKey: "sk-penguin-go-secret-0001",
    endpoints: {
      openai: "https://token.penguin.ooo/api",
      google: "https://token.penguin.ooo/api",
      anthropic: "https://token.penguin.ooo/api/anthropic",
    },
    models: [
      {
        provider: "google",
        modelId: "gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
        supportsVision: true,
        pricing: {
          unit: "usd_per_mtok",
          cacheRead: 0,
          cacheWrite: 0.625,
          output: 5,
        },
        listPricing: {
          unit: "usd_per_mtok",
          cacheRead: 0,
          cacheWrite: 1.25,
          output: 10,
        },
        discount: 0.5,
        recommendedRoute: {
          protocol: "google-generative-language",
          endpoint: "google",
        },
      },
      {
        provider: "deepseek",
        modelId: "deepseek-future",
        displayName: "DeepSeek Future",
        contextWindow: 1_000_000,
        maxOutputTokens: 65_536,
        supportsVision: false,
        pricing: {
          unit: "usd_per_mtok",
          cacheRead: 0.03,
          cacheWrite: 0.15,
          output: 0.6,
        },
        recommendedRoute: {
          protocol: "deepseek-responses",
          endpoint: "openai",
        },
      },
    ],
  },
};

const syncCatalog = (models: unknown[] = deliveryBody.connection.models) => ({
  schemaVersion: 1,
  catalogVersion: "a".repeat(64),
  endpoints: deliveryBody.connection.endpoints,
  models,
});

describe("Penguin Go key delivery validation", () => {
  it("accepts only the expected client and connection API key", () => {
    const connection = platformConnection(deliveryBody);
    expect(connection).toMatchObject({
      apiKey: "sk-penguin-go-secret-0001",
      catalog: {
        models: [
          {
            modelId: "gemini-3.8-flash",
            clientType: "google-genai",
            // A promoted model normalizes to its list price, which is what a Project stores,
            // and the fraction off it; the billed price is only checked against the two.
            pricing: {
              unit: "usd_per_mtok",
              cacheRead: 0,
              cacheWrite: 1.25,
              output: 10,
            },
            discount: 0.5,
          },
          {
            modelId: "deepseek-future",
            clientType: "deepseek-official",
            pricing: { unit: "usd_per_mtok", cacheRead: 0.03, cacheWrite: 0.15, output: 0.6 },
          },
        ],
      },
    });
    expect(connection.catalog.models[0]).not.toHaveProperty("listPricing");
    expect(connection.catalog.models[1]).not.toHaveProperty("discount");
    expect(() => platformConnection({ ...deliveryBody, client: { id: "another-client" } })).toThrow(
      "another client",
    );
    expect(() =>
      platformConnection({
        ...deliveryBody,
        connection: { ...deliveryBody.connection, apiKey: "" },
      }),
    ).toThrow("invalid API key");
    expect(() =>
      platformConnection({
        ...deliveryBody,
        connection: {
          ...deliveryBody.connection,
          models: [{ ...deliveryBody.connection.models[0], maxOutputTokens: 0 }],
        },
      }),
    ).toThrow("maximum output length");
    expect(() =>
      platformConnection({
        ...deliveryBody,
        connection: {
          ...deliveryBody.connection,
          models: [
            {
              ...deliveryBody.connection.models[0]!,
              pricing: {
                ...deliveryBody.connection.models[0]!.pricing,
                output: -1,
              },
            },
          ],
        },
      }),
    ).toThrow("invalid effective output price");
    expect(() =>
      platformConnection({
        ...deliveryBody,
        connection: {
          ...deliveryBody.connection,
          models: [
            {
              ...deliveryBody.connection.models[0]!,
              pricing: {
                ...deliveryBody.connection.models[0]!.pricing,
                unit: "cny_per_mtok",
              },
            },
          ],
        },
      }),
    ).toThrow("unsupported effective pricing unit");
  });
});

describe("Penguin Go key authorization routes", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let pollCount: number;
  let currentCatalogModels: unknown[];
  /** The models the delivery lists (the connection's own, unless a scenario says otherwise). */
  let deliveredModels: unknown[];

  beforeEach(async () => {
    t = await createTestApp();
    const ownerUser = await provisionUser(t.app, "penguin_api_owner");
    owner = apiClient(t.app, ownerUser.cookie);
    const memberUser = await provisionUser(t.app, "penguin_api_member");
    member = apiClient(t.app, memberUser.cookie);
    projectId = (
      (await (
        await owner.post("/api/projects", {
          projectId: "penguin_api_owner-project",
          name: "Penguin Go Project",
        })
      ).json()) as ProjectCreateResponse
    ).project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "penguin_api_member" }))
        .status,
    ).toBe(201);

    pollCount = 0;
    currentCatalogModels = [...deliveryBody.connection.models];
    deliveredModels = [...deliveryBody.connection.models];
    stubFetch((call) => {
      const { pathname } = new URL(call.url);
      if (pathname === "/api/auth/desktop/start") {
        const body = JSON.parse(call.body) as Record<string, unknown>;
        expect(body.client).toEqual({ id: "penguin-harness" });
        expect(String(body.code)).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(String(body.deviceSecret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
        return json(201, { expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
      }
      if (pathname === "/api/auth/desktop/poll") {
        pollCount += 1;
        return pollCount === 1
          ? json(200, { status: "pending", expiresInSeconds: 500 })
          : json(200, {
              ...deliveryBody,
              connection: { ...deliveryBody.connection, models: deliveredModels },
            });
      }
      if (pathname === "/api/client/models") {
        expect(call.headers.get("authorization")).toBe("Bearer sk-penguin-go-secret-0001");
        return json(200, syncCatalog(currentCatalogModels));
      }
      throw new Error(`Unexpected platform request: ${pathname}`);
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await t.cleanup();
  });

  const base = () => `/api/projects/${projectId}/platform-auth`;
  const models = async (): Promise<ModelsResponse> =>
    (await (await owner.get(`/api/projects/${projectId}/models`)).json()) as ModelsResponse;
  /** The owner's authorization, polled to its end: pending once, then the delivery. */
  const authorize = async (): Promise<PlatformAuthFlowStatusResponse> => {
    const started = (await (
      await owner.post(`${base()}/start`, {})
    ).json()) as PlatformAuthStartResponse;
    await owner.get(`${base()}/${started.flowId}/status`);
    return (await (
      await owner.get(`${base()}/${started.flowId}/status`)
    ).json()) as PlatformAuthFlowStatusResponse;
  };
  const sync = async (): Promise<PlatformModelSyncResponse> =>
    (await (await owner.post(`${base()}/sync`, {})).json()) as PlatformModelSyncResponse;
  const promotionOf = (modelId: string) =>
    t.deps.db
      .prepare(
        "SELECT discount FROM model_promotions WHERE project_id = ? AND provider = ? AND model_id = ?",
      )
      .get(projectId, "penguin-go", modelId);

  it("writes the delivered key once, as the group's key, adds the models the group lacks, and exposes no account state", async () => {
    const initial = await models();
    const initialPenguinGoModels = initial.models.filter(
      (model) => model.provider === "penguin-go",
    );
    const gemini = catalogEntryFor("penguin-go", "gemini-3.8-flash")!;
    // The preset group is there before any authorization, keyless, on the platform's endpoint.
    // The delivery lands on top of it: the group ends up with the preset's models and the
    // delivered ones, whichever the preset already carried.
    const deliveredCount = new Set([
      ...initialPenguinGoModels.map((model) => model.modelId),
      ...deliveryBody.connection.models.map((model) => model.modelId),
    ]).size;
    expect(
      initialPenguinGoModels.every(
        (model) => model.effective.baseUrl === "https://token.penguin.ooo/api",
      ),
    ).toBe(true);
    expect(initial.providers["penguin-go"]).toEqual({ baseUrl: "https://token.penguin.ooo/api" });
    expect((await member.post(`${base()}/start`, {})).status).toBe(403);
    const unauthorizedSync = await owner.post(`${base()}/sync`, {});
    expect(unauthorizedSync.status).toBe(409);
    expect(await unauthorizedSync.json()).toMatchObject({
      error: { code: "platform_reauthorization_required" },
    });

    const startResponse = await owner.post(`${base()}/start`, {});
    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as PlatformAuthStartResponse;
    expect(started.authorizeUrl).toMatch(
      /^https:\/\/token\.penguin\.ooo\/desktop\/authorize\?code=/,
    );
    expect(JSON.stringify(started)).not.toContain("deviceSecret");

    const pending = (await (
      await owner.get(`${base()}/${started.flowId}/status`)
    ).json()) as PlatformAuthFlowStatusResponse;
    expect(pending).toEqual({ status: "pending" });

    const done = (await (
      await owner.get(`${base()}/${started.flowId}/status`)
    ).json()) as PlatformAuthFlowStatusResponse;
    // Every model of the group uses the key: the presets and the delivered ones alike.
    expect(done).toEqual({ status: "completed", applied: deliveredCount });
    expect(JSON.stringify(done)).not.toContain("sk-penguin");

    const after = await models();
    const penguinGoModels = after.models.filter((model) => model.provider === "penguin-go");
    expect(penguinGoModels).toHaveLength(deliveredCount);
    expect(after.providers["penguin-go"]?.apiKeyMasked).toBe("sk-p…0001");
    expect(
      penguinGoModels.every(
        (model) =>
          model.effective.apiKeySource === "provider" &&
          model.credential?.apiKeyMasked === undefined,
      ),
    ).toBe(true);
    // A model the built-in catalog does not know arrives with the platform's facts, and with
    // its routing where it differs from the group's table: the protocol (the group sets none),
    // not the relay endpoint the group's table already holds.
    const deepseekFuture = penguinGoModels.find((model) => model.modelId === "deepseek-future");
    expect(deepseekFuture).toMatchObject({
      displayName: "DeepSeek Future",
      contextWindow: 1_000_000,
      clientType: "deepseek-official",
      vision: false,
      pricing: { cacheRead: 0.03, cacheWrite: 0.15, output: 0.6 },
      effective: { baseUrl: "https://token.penguin.ooo/api", baseUrlSource: "provider" },
    });
    expect(deepseekFuture).not.toHaveProperty("credential");
    expect(deepseekFuture).not.toHaveProperty("maxTokens");
    expect(deepseekFuture).not.toHaveProperty("discount");
    // A model the preset already held is not rewritten: its price and promotion stay what
    // the Project had, whatever the platform lists.
    const heldGemini = penguinGoModels.find((model) => model.modelId === "gemini-3.8-flash");
    expect(heldGemini?.pricing).toEqual({
      cacheRead: gemini.pricing!.cache_read,
      cacheWrite: gemini.pricing!.cache_write,
      output: gemini.pricing!.output,
    });
    expect(heldGemini).not.toHaveProperty("discount");
    expect(promotionOf("gemini-3.8-flash")).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain("sk-penguin-go-secret-0001");
    // Stored once, for the group.
    const raw = await t.deps.projectConfigService.readRaw(projectId);
    expect(JSON.stringify(raw).match(/sk-penguin-go-secret-0001/g)).toHaveLength(1);

    expect((await owner.get(base())).status).toBe(404);
    expect((await owner.post(`${base()}/refresh`, {})).status).toBe(404);
    expect((await owner.post(`${base()}/logout`, {})).status).toBe(404);
  });

  it("in a group where every model has its own key and nothing new is delivered, the key still lands as the group key and the flow completes with 0", async () => {
    const held = (await models()).models.filter((model) => model.provider === "penguin-go");
    expect(held).not.toEqual([]);
    const own = held.map((model, i) => ({
      provider: "penguin-go",
      modelId: model.modelId,
      apiKey: `sk-own-key-000${i}`,
    }));
    expect((await owner.put(`/api/projects/${projectId}/models`, { models: own })).status).toBe(
      200,
    );
    deliveredModels = deliveryBody.connection.models.filter((model) =>
      held.some((h) => h.modelId === model.modelId),
    );

    expect(await authorize()).toEqual({ status: "completed", applied: 0 });
    const after = await models();
    expect(after.providers["penguin-go"]?.apiKeyMasked).toBe("sk-p…0001");
    expect(
      after.models
        .filter((model) => model.provider === "penguin-go")
        .map((model) => model.effective.apiKeySource),
    ).toEqual(own.map(() => "model"));
  });

  it("a later sync adds what the platform newly lists, with its price, routing and promotion, and never rewrites a model the group holds", async () => {
    expect((await authorize()).status).toBe("completed");
    const authorized = await models();

    // The platform reprices a model the group holds and deepens a promotion: nothing changes
    // here, and nothing is written.
    currentCatalogModels = currentCatalogModels.map((model) =>
      (model as { modelId?: unknown }).modelId === "deepseek-future"
        ? {
            ...(model as Record<string, unknown>),
            pricing: { unit: "usd_per_mtok", cacheRead: 0.045, cacheWrite: 0.225, output: 0.9 },
            listPricing: { unit: "usd_per_mtok", cacheRead: 0.06, cacheWrite: 0.3, output: 1.2 },
            discount: 0.25,
          }
        : model,
    );
    const repriced = await sync();
    expect(repriced).toMatchObject({ added: 0, updated: 0 });
    expect(repriced.updatedAt).toBe(authorized.updatedAt);
    expect(repriced.models.find((model) => model.modelId === "deepseek-future")).toMatchObject({
      pricing: { cacheRead: 0.03, cacheWrite: 0.15, output: 0.6 },
    });
    expect(promotionOf("deepseek-future")).toBeUndefined();

    currentCatalogModels.push({
      provider: "google",
      modelId: "gemini-future",
      displayName: "Gemini Future",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      pricing: {
        unit: "usd_per_mtok",
        cacheRead: 0.05,
        cacheWrite: 0.25,
        output: 1,
      },
      listPricing: {
        unit: "usd_per_mtok",
        cacheRead: 0.1,
        cacheWrite: 0.5,
        output: 2,
      },
      discount: 0.5,
      recommendedRoute: {
        protocol: "google-generative-language",
        endpoint: "google",
      },
    });
    const added = await sync();
    expect(added).toMatchObject({ added: 1, updated: 0 });
    const future = added.models.find((model) => model.modelId === "gemini-future");
    // The file takes the platform's LIST price, and the promotion is stored beside it.
    expect(future).toMatchObject({
      displayName: "Gemini Future",
      contextWindow: 1_048_576,
      clientType: "google-genai",
      vision: true,
      pricing: { cacheRead: 0.1, cacheWrite: 0.5, output: 2 },
      discount: 0.5,
      effective: {
        baseUrl: "https://token.penguin.ooo/api",
        baseUrlSource: "provider",
        apiKeySource: "provider",
        apiKeyMasked: "sk-p…0001",
      },
    });
    expect(future).not.toHaveProperty("credential");
    expect(future).not.toHaveProperty("maxTokens");
    expect(future).not.toHaveProperty("listPricing");
    // The model the group already held is still as it was.
    expect(promotionOf("deepseek-future")).toBeUndefined();
  });

  it("a platform model is stored against the group's table field by field: a group pointed at a proxy takes a new model along with its key, and a field the table lacks is written on the model", async () => {
    // The user pointed the group at a proxy.
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models/providers/penguin-go`, {
          baseUrl: "https://relay-proxy.example/api",
        })
      ).status,
    ).toBe(200);
    expect((await authorize()).status).toBe("completed");
    const future = (await models()).models.find((model) => model.modelId === "deepseek-future")!;
    // Stored bare of an endpoint, so it runs on the proxy with the group key; its protocol is
    // its own (the group sets none).
    expect(future.clientType).toBe("deepseek-official");
    expect(future).not.toHaveProperty("credential");
    expect(future.effective).toMatchObject({
      baseUrl: "https://relay-proxy.example/api",
      baseUrlSource: "provider",
      apiKeySource: "provider",
      apiKeyMasked: "sk-p…0001",
    });

    // The user cleared the group's endpoint: a model listed after that carries the
    // platform's own, instead of falling to the client's default endpoint.
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models/providers/penguin-go`, {
          baseUrl: null,
        })
      ).status,
    ).toBe(200);
    currentCatalogModels.push({
      provider: "google",
      modelId: "gemini-future",
      displayName: "Gemini Future",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      pricing: { unit: "usd_per_mtok", cacheRead: 0.05, cacheWrite: 0.25, output: 1 },
      recommendedRoute: { protocol: "google-generative-language", endpoint: "google" },
    });
    const synced = await sync();
    expect(synced.added).toBe(1);
    const gemini = synced.models.find((model) => model.modelId === "gemini-future")!;
    expect(gemini.clientType).toBe("google-genai");
    expect(gemini.credential).toEqual({ baseUrl: "https://token.penguin.ooo/api" });
    // The model the proxy took along is unchanged.
    expect(synced.models.find((model) => model.modelId === "deepseek-future")).not.toHaveProperty(
      "credential",
    );
  });

  it("Disconnect clears the group key: the group's models stop using it, a sync asks for authorization again, and every model stays", async () => {
    expect((await authorize()).status).toBe("completed");
    const authorized = await models();
    const res = await owner.put(`/api/projects/${projectId}/models/providers/penguin-go`, {
      clearApiKey: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.providers["penguin-go"]).toEqual({ baseUrl: "https://token.penguin.ooo/api" });
    const rows = body.models.filter((model) => model.provider === "penguin-go");
    expect(rows.map((model) => model.modelId)).toEqual(
      authorized.models.filter((m) => m.provider === "penguin-go").map((m) => m.modelId),
    );
    expect(rows.some((model) => model.effective.apiKeySource === "provider")).toBe(false);
    const syncAfter = await owner.post(`${base()}/sync`, {});
    expect(syncAfter.status).toBe(409);
    expect(await syncAfter.json()).toMatchObject({
      error: { code: "platform_reauthorization_required" },
    });
    const raw = await t.deps.projectConfigService.readRaw(projectId);
    expect(JSON.stringify(raw)).not.toContain("sk-penguin-go-secret-0001");
  });

  it("preserves the platform start backoff as HTTP 429 with Retry-After", async () => {
    stubFetch(() => json(429, { error: "rate_limited", retryAfterSeconds: 7 }));

    const response = await owner.post(`/api/projects/${projectId}/platform-auth/start`, {});
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toMatchObject({ error: { code: "platform_rate_limited" } });
  });
});

describe("single-delivery local retry", () => {
  it("requires reauthorization when the stored platform key is rejected", async () => {
    const applyCatalog = vi.fn();
    const service = new PlatformAuthService({
      origin: "https://token.penguin.ooo",
      getKey: async () => "revoked-key",
      applyCatalog,
      fetchImpl: fakeFetch(() => json(401, { error: "Invalid API key" })).fetch,
    });

    await expect(service.sync("p1")).rejects.toMatchObject({
      status: 409,
      code: "platform_reauthorization_required",
    });
    expect(applyCatalog).not.toHaveBeenCalled();
  });

  /** The platform's two device-flow endpoints: `start` succeeds, `poll` answers as told. */
  const platform = (poll: (n: number) => Response | Promise<Response>, now = () => Date.now()) => {
    let polls = 0;
    const fake = fakeFetch((call) => {
      if (new URL(call.url).pathname.endsWith("/start")) {
        return json(201, { expiresAt: new Date(now() + 60_000).toISOString() });
      }
      // The claim is read from the answer itself: a redirect must never be followed to it.
      expect(call.init?.redirect).toBe("manual");
      polls += 1;
      return poll(polls);
    });
    return { fetch: fake.fetch, polls: () => polls };
  };

  it("reuses the key after a failed write without polling the platform again", async () => {
    let applies = 0;
    const flow = platform(() => json(200, deliveryBody));
    const service = new PlatformAuthService({
      origin: "https://token.penguin.ooo",
      getKey: async () => undefined,
      applyCatalog: async () => {
        applies += 1;
        if (applies === 1) throw new Error("disk busy");
        return { added: 0, updated: 0, applied: 5 };
      },
      fetchImpl: flow.fetch,
    });
    const started = await service.start({ projectId: "p1", userId: "u1" });
    expect(
      await service.status({ flowId: started.flowId, projectId: "p1", userId: "u1" }),
    ).toMatchObject({ status: "apply_failed", error: "apply_failed" });
    expect(
      await service.retryApply({ flowId: started.flowId, projectId: "p1", userId: "u1" }),
    ).toMatchObject({ status: "completed", applied: 5, changed: true });
    expect(flow.polls()).toBe(1);
    expect(applies).toBe(2);
  });

  it("keeps a rate-limited poll pending and retries after the platform backoff", async () => {
    let now = 1_000;
    const flow = platform(
      (n) =>
        n === 1
          ? json(429, { error: "rate_limited", retryAfterSeconds: 2 })
          : json(200, deliveryBody),
      () => now,
    );
    const service = new PlatformAuthService({
      origin: "https://token.penguin.ooo",
      now: () => now,
      getKey: async () => undefined,
      applyCatalog: async () => ({ added: 0, updated: 0, applied: 5 }),
      fetchImpl: flow.fetch,
    });
    const started = await service.start({ projectId: "p1", userId: "u1" });

    expect(await service.status({ flowId: started.flowId, projectId: "p1", userId: "u1" })).toEqual(
      { status: "pending" },
    );
    now += 1_999;
    expect(await service.status({ flowId: started.flowId, projectId: "p1", userId: "u1" })).toEqual(
      { status: "pending" },
    );
    expect(flow.polls()).toBe(1);

    now += 1;
    expect(
      await service.status({ flowId: started.flowId, projectId: "p1", userId: "u1" }),
    ).toMatchObject({ status: "completed", applied: 5, changed: true });
    expect(flow.polls()).toBe(2);
  });

  it("does not apply a claimed key when the user cancels while polling", async () => {
    let releasePoll!: (response: Response) => void;
    let markPollStarted!: () => void;
    const pollStarted = new Promise<void>((resolve) => {
      markPollStarted = resolve;
    });
    const applyCatalog = vi.fn(async () => ({ added: 0, updated: 0, applied: 5 }));
    const service = new PlatformAuthService({
      origin: "https://token.penguin.ooo",
      getKey: async () => undefined,
      applyCatalog,
      fetchImpl: platform(() => {
        markPollStarted();
        return new Promise<Response>((resolve) => {
          releasePoll = resolve;
        });
      }).fetch,
    });
    const started = await service.start({ projectId: "p1", userId: "u1" });
    const status = service.status({ flowId: started.flowId, projectId: "p1", userId: "u1" });
    await pollStarted;

    service.cancel({ flowId: started.flowId, projectId: "p1", userId: "u1" });
    releasePoll(json(200, deliveryBody));

    await expect(status).resolves.toEqual({ status: "cancelled" });
    expect(applyCatalog).not.toHaveBeenCalled();
  });
});
