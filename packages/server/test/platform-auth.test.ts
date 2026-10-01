/**
 * Penguin Go key delivery: the platform's device authorization, as the models page drives it
 * through /api/projects/:p/platform-auth, and the catalog sync that follows.
 *
 * - A delivery is accepted only for this client with a connection API key; its models are
 *   normalized to their list price with the promotion stored beside it, and a delivery with a
 *   malformed model (no output length, a negative or non-USD price) is refused.
 * - Given a Project whose Penguin Go group has no key, the owner's authorization writes the
 *   delivered key and catalog into it (a member is refused, and a sync before any key asks for
 *   reauthorization); nothing of the account or the key itself is ever answered back.
 * - A later sync applies the platform's repricing, a promotion-only change (web.db alone), and
 *   a newly listed model, reporting what it added and updated.
 * - The platform's start backoff reaches the caller as a 429 with Retry-After.
 * - A stored key the platform rejects asks for reauthorization and applies nothing.
 * - A failed write retries with the key already claimed, without polling the platform again.
 * - A rate-limited poll stays pending and polls again only after the platform's backoff.
 * - A flow the user cancels while a poll is in flight applies nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
            clientType: "gemini-generate-content",
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
          : json(200, deliveryBody);
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

  it("writes the delivered key to the prebuilt group and exposes no account state", async () => {
    const base = `/api/projects/${projectId}/platform-auth`;
    const initial = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const initialPenguinGoModels = initial.models.filter(
      (model) => model.provider === "penguin-go",
    );
    // The preset group is there before any authorization, keyless, on the platform's endpoint.
    // The delivery lands on top of it: the group ends up with the preset's models and the
    // delivered ones, whichever the preset already carried.
    const deliveredCount = new Set([
      ...initialPenguinGoModels.map((model) => model.modelId),
      ...deliveryBody.connection.models.map((model) => model.modelId),
    ]).size;
    expect(
      initialPenguinGoModels.every(
        (model) => model.credential?.baseUrl === "https://token.penguin.ooo/api",
      ),
    ).toBe(true);
    expect(
      initialPenguinGoModels.every((model) => model.credential?.apiKeyMasked === undefined),
    ).toBe(true);
    expect((await member.post(`${base}/start`, {})).status).toBe(403);
    const unauthorizedSync = await owner.post(`${base}/sync`, {});
    expect(unauthorizedSync.status).toBe(409);
    expect(await unauthorizedSync.json()).toMatchObject({
      error: { code: "platform_reauthorization_required" },
    });

    const startResponse = await owner.post(`${base}/start`, {});
    expect(startResponse.status).toBe(201);
    const started = (await startResponse.json()) as PlatformAuthStartResponse;
    expect(started.authorizeUrl).toMatch(
      /^https:\/\/token\.penguin\.ooo\/desktop\/authorize\?code=/,
    );
    expect(JSON.stringify(started)).not.toContain("deviceSecret");

    const pending = (await (
      await owner.get(`${base}/${started.flowId}/status`)
    ).json()) as PlatformAuthFlowStatusResponse;
    expect(pending).toEqual({ status: "pending" });

    const done = (await (
      await owner.get(`${base}/${started.flowId}/status`)
    ).json()) as PlatformAuthFlowStatusResponse;
    expect(done).toEqual({ status: "completed", applied: deliveredCount });
    expect(JSON.stringify(done)).not.toContain("sk-penguin");

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const penguinGoModels = models.models.filter((model) => model.provider === "penguin-go");
    expect(penguinGoModels).toHaveLength(deliveredCount);
    const deepseekFuture = penguinGoModels.find((model) => model.modelId === "deepseek-future");
    expect(deepseekFuture).toMatchObject({
      displayName: "DeepSeek Future",
      contextWindow: 1_000_000,
      clientType: "deepseek-official",
      vision: false,
      pricing: { cacheRead: 0.03, cacheWrite: 0.15, output: 0.6 },
      credential: { baseUrl: "https://token.penguin.ooo/api" },
    });
    expect(deepseekFuture).not.toHaveProperty("maxTokens");
    expect(deepseekFuture).not.toHaveProperty("discount");
    // The promoted model: the file takes the platform's LIST price, and the fraction is stored
    // beside it in web.db.
    const gemini = penguinGoModels.find((model) => model.modelId === "gemini-3.8-flash");
    expect(gemini).toMatchObject({
      clientType: "gemini-generate-content",
      pricing: { cacheRead: 0, cacheWrite: 1.25, output: 10 },
      discount: 0.5,
    });
    expect(gemini).not.toHaveProperty("listPricing");
    const stored = (await t.deps.projectConfigService.readRaw(projectId)).models as Record<
      string,
      unknown
    >[];
    const storedGemini = stored.find(
      (model) => model.provider === "penguin-go" && model.model_id === "gemini-3.8-flash",
    );
    expect(storedGemini).toMatchObject({
      pricing: { unit: "usd_per_mtok", cache_read: 0, cache_write: 1.25, output: 10 },
    });
    expect(storedGemini).not.toHaveProperty("discount");
    const promotionOf = (modelId: string) =>
      t.deps.db
        .prepare(
          "SELECT discount FROM model_promotions WHERE project_id = ? AND provider = ? AND model_id = ?",
        )
        .get(projectId, "penguin-go", modelId);
    expect(promotionOf("gemini-3.8-flash")).toEqual({ discount: 0.5 });
    expect(penguinGoModels.every((model) => model.credential?.apiKeyMasked !== undefined)).toBe(
      true,
    );
    expect(
      penguinGoModels.every(
        (model) => model.credential?.baseUrl === "https://token.penguin.ooo/api",
      ),
    ).toBe(true);
    expect(JSON.stringify(models)).not.toContain("sk-penguin-go-secret-0001");

    const synced = (await (
      await owner.post(`${base}/sync`, {})
    ).json()) as PlatformModelSyncResponse;
    expect(synced).toMatchObject({ added: 0, updated: 0 });
    expect(synced.updatedAt).toBe(models.updatedAt);
    expect(synced.models.filter((model) => model.provider === "penguin-go")).toHaveLength(
      deliveredCount,
    );

    const patchGemini = (patch: Record<string, unknown>) => {
      currentCatalogModels = currentCatalogModels.map((model) =>
        (model as { modelId?: unknown }).modelId === "gemini-3.8-flash"
          ? { ...(model as Record<string, unknown>), ...patch }
          : model,
      );
    };
    patchGemini({
      pricing: { unit: "usd_per_mtok", cacheRead: 0, cacheWrite: 0.75, output: 6 },
      listPricing: { unit: "usd_per_mtok", cacheRead: 0, cacheWrite: 1.5, output: 12 },
    });
    const repriced = (await (
      await owner.post(`${base}/sync`, {})
    ).json()) as PlatformModelSyncResponse;
    expect(repriced).toMatchObject({ added: 0, updated: 1 });
    expect(repriced.models.find((model) => model.modelId === "gemini-3.8-flash")).toMatchObject({
      pricing: { cacheRead: 0, cacheWrite: 1.5, output: 12 },
      discount: 0.5,
    });

    // Same list price, deeper promotion: an update all the same, landing in web.db alone —
    // the file is not rewritten and keeps the list price.
    patchGemini({
      pricing: { unit: "usd_per_mtok", cacheRead: 0, cacheWrite: 1.125, output: 9 },
      discount: 0.25,
    });
    const promotionOnly = (await (
      await owner.post(`${base}/sync`, {})
    ).json()) as PlatformModelSyncResponse;
    expect(promotionOnly).toMatchObject({ added: 0, updated: 1 });
    expect(promotionOnly.updatedAt).toBe(repriced.updatedAt);
    expect(
      promotionOnly.models.find((model) => model.modelId === "gemini-3.8-flash"),
    ).toMatchObject({
      pricing: { cacheRead: 0, cacheWrite: 1.5, output: 12 },
      discount: 0.25,
    });
    expect(promotionOf("gemini-3.8-flash")).toEqual({ discount: 0.25 });

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
    const added = (await (
      await owner.post(`${base}/sync`, {})
    ).json()) as PlatformModelSyncResponse;
    expect(added).toMatchObject({ added: 1, updated: 0 });
    expect(added.models.find((model) => model.modelId === "gemini-future")).toMatchObject({
      displayName: "Gemini Future",
      contextWindow: 1_048_576,
      clientType: "gemini-generate-content",
      vision: true,
      pricing: { cacheRead: 0.1, cacheWrite: 0.5, output: 2 },
      discount: 0.5,
      credential: {
        apiKeyMasked: "sk-p…0001",
        baseUrl: "https://token.penguin.ooo/api",
      },
    });
    expect(added.models.find((model) => model.modelId === "gemini-future")).not.toHaveProperty(
      "maxTokens",
    );
    expect((await owner.get(base)).status).toBe(404);
    expect((await owner.post(`${base}/refresh`, {})).status).toBe(404);
    expect((await owner.post(`${base}/logout`, {})).status).toBe(404);
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
