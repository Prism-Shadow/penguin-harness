/**
 * ModelScope key authorization: the harness starts a flow at the Penguin bridge, polls it, and
 * writes the delivered token to the ModelScope group; later it refreshes that token.
 *
 * - The flow: the bridge's own authorize URL is passed through (never one a tab must not open),
 *   the delivered token is written, a failed write keeps the token for a retry without polling
 *   again, every terminal status maps onto the flow's own states and ends the
 *   polling, an unreachable bridge or a rejected start is an upstream failure, the bridge's
 *   rate limit surfaces with its Retry-After on start and backs a poll off, cancelling reaches
 *   the bridge and applies nothing, a flow is hidden from another Project or user and forgotten
 *   once expired, and a delivery is validated rather than trusted.
 * - Refresh: a token about to expire is refreshed silently, dropped if the stored refresh token
 *   changed meanwhile, kept usable when a proactive refresh fails, and re-authorization is asked
 *   for when an expired token cannot be refreshed or after three failures (a changed refresh
 *   token resets the count).
 * - The routes: only the owner starts; the token lands once, as the group's key, which the
 *   group's preset rows use, and no account state is exposed; in a group where no model uses
 *   it yet (every one keyed on its own), it still lands and the flow completes with a count of
 *   0; Disconnect (clearing the group key) ends the authorization, its refresh token
 *   included, so nothing brings the key back; an unknown or foreign flow has its own
 *   not-found code.
 * - A request: a model on the group key refreshes a token about to expire, and the refreshed
 *   token lands on the group and goes out with that very request; a model with a key of its
 *   own sends it and asks for no refresh.
 *
 * No test reaches the network: the bridge is the suite's fetch fake, handed to the service or
 * standing in for the global fetch in the route cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetModelEntries } from "@prismshadow/penguin-core/model-catalog";
import type {
  ModelScopeAuthFlowStatusResponse,
  ModelScopeAuthStartResponse,
  ModelsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import {
  ModelScopeAuthService,
  modelscopeAccessToken,
} from "../src/services/modelscope-auth-service.js";
import { fakeFetch, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The production bridge address, path prefix included: the prefix must survive into every call. */
const BRIDGE = "https://go.penguin.ooo/modelscope";

function started(expiresInMs = 60_000): Response {
  return jsonResponse(
    {
      authorizeUrl: `${BRIDGE}/oauth/authorize?code=abc`,
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    },
    201,
  );
}

function pathOf(input: string | URL | Request): string {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
}

/** What the bridge answers once the user has finished ModelScope's own consent screen. */
const delivery = {
  status: "completed",
  token: {
    accessToken: "ms-token-0001",
    refreshToken: "ms-refresh-0001",
    tokenType: "Bearer",
    scope: "openid profile api-inference",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  },
  userinfo: { sub: "42", name: "ModelScope User" },
  api: {
    baseUrl: "https://api-inference.modelscope.cn/v1",
    defaultModel: "Qwen/Qwen3.8-Flash-Next",
    clientType: "openai-chat",
  },
};

const owner = { projectId: "p1", userId: "u1" };

describe("ModelScope key authorization service", () => {
  it("carries the bridge's own authorize URL through and writes the delivered token", async () => {
    const applied: { projectId: string; token: string }[] = [];
    let polls = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async (projectId, credential) => {
        applied.push({ projectId, token: credential.accessToken });
        return 1;
      },
      fetchImpl: fakeFetch(async ({ url: input, init }) => {
        if (pathOf(input) === "/modelscope/oauth/start") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(body.client).toEqual({ id: "penguin-harness" });
          // The bridge rejects anything that is not base64url decoding to 16+ bytes.
          expect(String(body.code)).toMatch(/^[A-Za-z0-9_-]{43}$/);
          expect(String(body.deviceSecret)).toMatch(/^[A-Za-z0-9_-]{43}$/);
          return started();
        }
        expect(init?.redirect).toBe("manual");
        polls += 1;
        return polls === 1 ? jsonResponse({ status: "pending" }) : jsonResponse(delivery);
      }).fetch,
    });

    const flow = await service.start(owner);
    // The bridge builds this URL itself — it knows the redirect URI and its own public prefix —
    // so the harness passes it through untouched.
    expect(flow.authorizeUrl).toBe(`${BRIDGE}/oauth/authorize?code=abc`);
    expect(JSON.stringify(flow)).not.toContain("deviceSecret");

    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({ status: "pending" });
    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({
      status: "completed",
      applied: 1,
      changed: true,
    });
    expect(applied).toEqual([{ projectId: "p1", token: "ms-token-0001" }]);
    expect(polls).toBe(2);
  });

  it("keeps the token on the flow after a failed write and retries it without polling again", async () => {
    let applies = 0;
    let polls = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => {
        applies += 1;
        if (applies === 1) throw new Error("disk busy");
        return 1;
      },
      fetchImpl: fakeFetch(async ({ url: input }) => {
        if (pathOf(input).endsWith("/start")) return started();
        polls += 1;
        return jsonResponse(delivery);
      }).fetch,
    });
    const flow = await service.start(owner);
    expect(await service.status({ ...owner, flowId: flow.flowId })).toMatchObject({
      status: "apply_failed",
      error: "apply_failed",
    });
    // The bridge clears its own copy on delivery, so this retry is the only way the token can
    // still reach the group.
    expect(await service.retryApply({ ...owner, flowId: flow.flowId })).toMatchObject({
      status: "completed",
      applied: 1,
      changed: true,
    });
    expect(polls).toBe(1);
    expect(applies).toBe(2);
  });

  it("maps every terminal status the bridge can report onto the flow's own states", async () => {
    // `delivered` is the one that matters most: it means somebody else already collected this
    // token, so the flow must end rather than keep polling for a token that is gone.
    const cases: Array<[string, ModelScopeAuthFlowStatusResponse]> = [
      ["expired", { status: "error", error: "expired" }],
      ["locked", { status: "error", error: "locked" }],
      ["delivered", { status: "error", error: "already_delivered" }],
      ["cancelled", { status: "cancelled" }],
      // A status this build has never heard of is an upstream change, not a reason to keep a
      // flow alive.
      ["something-else", { status: "error", error: "upstream_failed" }],
    ];
    for (const [reported, expected] of cases) {
      const service = new ModelScopeAuthService({
        bridgeUrl: BRIDGE,
        applyCredential: async () => 1,
        fetchImpl: fakeFetch(async ({ url: input }) =>
          pathOf(input).endsWith("/start") ? started() : jsonResponse({ status: reported }),
        ).fetch,
      });
      const flow = await service.start(owner);
      const result = await service.status({ ...owner, flowId: flow.flowId });
      expect(result, reported).toEqual(expected);
      // Nothing was applied, and a cancelled flow is what a second poll sees.
      expect(await service.status({ ...owner, flowId: flow.flowId }), reported).toEqual(expected);
    }
  });

  it("stops polling once the bridge reports a terminal status", async () => {
    let polls = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async ({ url: input }) => {
        if (pathOf(input).endsWith("/start")) return started();
        polls += 1;
        return jsonResponse({ status: "expired" });
      }).fetch,
    });
    const flow = await service.start(owner);
    await service.status({ ...owner, flowId: flow.flowId });
    await service.status({ ...owner, flowId: flow.flowId });
    expect(polls).toBe(1);
  });

  it("reports an unreachable bridge and a rejected start as upstream failures", async () => {
    const unreachable = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () => {
        throw new Error("ECONNREFUSED");
      }).fetch,
    });
    await expect(unreachable.start(owner)).rejects.toMatchObject({
      status: 502,
      code: "modelscope_unreachable",
    });

    const refused = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () => jsonResponse({ error: "flow_conflict" }, 409)).fetch,
    });
    await expect(refused.start(owner)).rejects.toMatchObject({
      status: 502,
      code: "modelscope_start_failed",
    });
  });

  it("refuses an authorize URL that is not an address a browser tab may be sent to", async () => {
    for (const authorizeUrl of ["javascript:alert(1)", "https://user:pw@token.penguin.ooo/x", ""]) {
      const service = new ModelScopeAuthService({
        bridgeUrl: BRIDGE,
        applyCredential: async () => 1,
        fetchImpl: fakeFetch(async () =>
          jsonResponse(
            {
              authorizeUrl,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
            201,
          ),
        ).fetch,
      });
      await expect(service.start(owner)).rejects.toMatchObject({
        status: 502,
        code: "modelscope_start_failed",
      });
    }
  });

  it("surfaces the bridge's rate limit on start with its own Retry-After", async () => {
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () =>
        jsonResponse({ error: "rate_limited", retryAfterSeconds: 12 }, 429),
      ).fetch,
    });
    await expect(service.start(owner)).rejects.toMatchObject({
      status: 429,
      code: "modelscope_rate_limited",
      retryAfterSeconds: 12,
    });
  });

  it("keeps a rate-limited poll pending and retries it after the bridge's backoff", async () => {
    let now = 1_000;
    let polls = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async ({ url: input }) => {
        if (pathOf(input).endsWith("/start")) {
          return jsonResponse(
            {
              authorizeUrl: `${BRIDGE}/oauth/authorize?code=abc`,
              expiresAt: new Date(now + 60_000).toISOString(),
            },
            201,
          );
        }
        polls += 1;
        return polls === 1
          ? jsonResponse({ error: "rate_limited", retryAfterSeconds: 2 }, 429)
          : jsonResponse(delivery);
      }).fetch,
    });
    const flow = await service.start(owner);
    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({ status: "pending" });
    now += 1_999;
    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({ status: "pending" });
    expect(polls).toBe(1);
    now += 1;
    expect(await service.status({ ...owner, flowId: flow.flowId })).toMatchObject({
      status: "completed",
      applied: 1,
    });
    expect(polls).toBe(2);
  });

  it("silently refreshes a stored token that is about to expire", async () => {
    let now = 1_000;
    const applied: string[] = [];
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(now + 10_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
      applyCredential: async (_projectId, credential) => {
        applied.push(credential.accessToken);
        expect(credential.refreshToken).toBe("new-refresh");
        return 3;
      },
      fetchImpl: fakeFetch(async ({ url: input, init }) => {
        expect(pathOf(input)).toBe("/modelscope/oauth/refresh");
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "old-refresh" });
        return jsonResponse({
          token: {
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresAt: new Date(now + 3_600_000).toISOString(),
          },
        });
      }).fetch,
    });
    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: true },
    );
    expect(applied).toEqual(["new-access"]);
  });

  it("drops a refreshed token when the stored refresh token changed before apply", async () => {
    let now = 1_000;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(now + 10_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
      applyCredential: async (_projectId, credential, options) => {
        expect(credential.accessToken).toBe("new-access");
        expect(options).toEqual({ expectedRefreshToken: "old-refresh" });
        return 0;
      },
      fetchImpl: fakeFetch(async () =>
        jsonResponse({
          token: {
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresAt: new Date(now + 3_600_000).toISOString(),
          },
        }),
      ).fetch,
    });
    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: false },
    );
  });

  it("keeps a nearly expired token usable when a proactive refresh fails", async () => {
    let now = 1_000;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(now + 10_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
      applyCredential: async () => {
        throw new Error("must not apply");
      },
      fetchImpl: fakeFetch(async () => jsonResponse({ error: "bridge_down" }, 502)).fetch,
    });
    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: false },
    );
  });

  it("asks for re-authorization when an expired token cannot be refreshed", async () => {
    let now = 1_000;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(now - 1).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () => jsonResponse({ error: "invalid_grant" }, 401)).fetch,
    });
    await expect(
      service.ensureFresh({ projectId: "p1", provider: "modelscope" }),
    ).rejects.toMatchObject({ status: 409, code: "modelscope_refresh_failed" });
  });

  it("prompts for re-authorization after three proactive refresh failures", async () => {
    let now = 1_000;
    let attempts = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken: "old-refresh",
        accessTokenExpiresAt: new Date(241_000).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }),
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () => {
        attempts += 1;
        return jsonResponse({ error: "bridge_down" }, 502);
      }).fetch,
    });

    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: false },
    );
    now += 30_000;
    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: false },
    );
    now += 60_000;
    await expect(
      service.ensureFresh({ projectId: "p1", provider: "modelscope" }),
    ).rejects.toMatchObject({ status: 409, code: "modelscope_refresh_failed" });
    await expect(
      service.ensureFresh({ projectId: "p1", provider: "modelscope" }),
    ).rejects.toMatchObject({ status: 409, code: "modelscope_refresh_failed" });
    expect(attempts).toBe(3);
  });

  it("forgets an old failure ceiling after the stored refresh token changes", async () => {
    let now = 1_000;
    let refreshToken = "old-refresh";
    let attempts = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      readStoredCredential: () => ({
        provider: "modelscope",
        refreshToken,
        accessTokenExpiresAt: new Date(now + 10_000).toISOString(),
        updatedAt: new Date(now - 1_000).toISOString(),
      }),
      applyCredential: async () => 3,
      fetchImpl: fakeFetch(async () => {
        attempts += 1;
        if (refreshToken === "old-refresh") return jsonResponse({ error: "bridge_down" }, 502);
        return jsonResponse({
          token: {
            accessToken: "reauthorized-access",
            refreshToken,
            expiresAt: new Date(now + 3_600_000).toISOString(),
          },
        });
      }).fetch,
    });

    await service.ensureFresh({ projectId: "p1", provider: "modelscope" });
    now += 30_000;
    await service.ensureFresh({ projectId: "p1", provider: "modelscope" });
    now += 60_000;
    await expect(
      service.ensureFresh({ projectId: "p1", provider: "modelscope" }),
    ).rejects.toMatchObject({ status: 409, code: "modelscope_refresh_failed" });

    refreshToken = "reauthorized-refresh";
    await expect(service.ensureFresh({ projectId: "p1", provider: "modelscope" })).resolves.toEqual(
      { changed: true },
    );
    expect(attempts).toBe(4);
  });

  it("cancels at the bridge as well as locally, and never applies the token", async () => {
    let cancelled = 0;
    let applied = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyCredential: async () => {
        applied += 1;
        return 1;
      },
      fetchImpl: fakeFetch(async ({ url: input }) => {
        if (pathOf(input).endsWith("/start")) return started();
        if (pathOf(input).endsWith("/cancel")) {
          cancelled += 1;
          return jsonResponse({ ok: true });
        }
        return jsonResponse(delivery);
      }).fetch,
    });
    const flow = await service.start(owner);
    service.cancel({ ...owner, flowId: flow.flowId });
    // The local state is what the next status call reads; the bridge call is best effort.
    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({
      status: "cancelled",
    });
    expect(applied).toBe(0);
    await vi.waitFor(() => expect(cancelled).toBe(1));
  });

  it("hides a flow from another Project or user, and forgets an expired one", async () => {
    let now = 1_000;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      applyCredential: async () => 1,
      fetchImpl: fakeFetch(async () => started(600_000)).fetch,
    });
    const flow = await service.start(owner);
    const gone = { status: 404, code: "modelscope_auth_flow_not_found" };
    await expect(
      service.status({ ...owner, flowId: flow.flowId, userId: "u2" }),
    ).rejects.toMatchObject(gone);
    await expect(
      service.status({ ...owner, flowId: flow.flowId, projectId: "p2" }),
    ).rejects.toMatchObject(gone);
    await expect(service.status({ ...owner, flowId: "nope" })).rejects.toMatchObject(gone);
    now += 10 * 60 * 1000 + 1;
    await expect(service.status({ ...owner, flowId: flow.flowId })).rejects.toMatchObject(gone);
  });

  it("validates the delivery rather than trusting it", () => {
    expect(modelscopeAccessToken(delivery)).toBe("ms-token-0001");
    expect(() => modelscopeAccessToken({ ...delivery, status: "pending" })).toThrow(
      "another status",
    );
    expect(() => modelscopeAccessToken({ status: "completed", token: {} })).toThrow(
      "invalid access token",
    );
    expect(() =>
      modelscopeAccessToken({ status: "completed", token: { accessToken: 42 } }),
    ).toThrow("invalid access token");
  });
});

describe("ModelScope key authorization routes", () => {
  let t: TestApp;
  let ownerClient: ReturnType<typeof apiClient>;
  let memberClient: ReturnType<typeof apiClient>;
  let projectId: string;
  let pollCount: number;

  beforeEach(async () => {
    t = await createTestApp();
    const ownerUser = await provisionUser(t.app, "modelscope_api_owner");
    ownerClient = apiClient(t.app, ownerUser.cookie);
    const memberUser = await provisionUser(t.app, "modelscope_api_member");
    memberClient = apiClient(t.app, memberUser.cookie);
    projectId = (
      (await (
        await ownerClient.post("/api/projects", {
          projectId: "modelscope_api_owner-project",
          name: "ModelScope Project",
        })
      ).json()) as ProjectCreateResponse
    ).project.projectId;
    expect(
      (
        await ownerClient.post(`/api/projects/${projectId}/members`, {
          userId: "modelscope_api_member",
        })
      ).status,
    ).toBe(201);

    pollCount = 0;
    stubFetch(({ url, init }) => {
      const path = pathOf(url);
      // Every call carries the bridge's path prefix; a lost prefix is a 404 at the bridge.
      if (path === "/modelscope/oauth/start") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.client).toEqual({ id: "penguin-harness" });
        return started();
      }
      if (path === "/modelscope/oauth/poll") {
        pollCount += 1;
        return pollCount === 1 ? jsonResponse({ status: "pending" }) : jsonResponse(delivery);
      }
      throw new Error(`Unexpected bridge request: ${path}`);
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await t.cleanup();
  });

  it("writes the delivered token as the group's key, which the preset rows use, and exposes no account state", async () => {
    const base = `/api/projects/${projectId}/modelscope-auth`;
    const before = (await (
      await ownerClient.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const preset = before.models.filter((model) => model.provider === "modelscope");
    // The group's rows are the catalog's ModelScope presets.
    expect(preset).not.toEqual([]);
    expect(preset.map((model) => model.modelId).sort()).toEqual(
      presetModelEntries()
        .filter((entry) => entry.provider === "modelscope")
        .map((entry) => entry.model_id)
        .sort(),
    );
    expect(preset.every((model) => model.effective.clientType === "openai-responses")).toBe(true);
    expect(before.providers.modelscope?.apiKeyMasked).toBeUndefined();

    expect((await memberClient.post(`${base}/start`, {})).status).toBe(403);

    const startResponse = await ownerClient.post(`${base}/start`, {});
    expect(startResponse.status).toBe(201);
    const flow = (await startResponse.json()) as ModelScopeAuthStartResponse;
    expect(flow.authorizeUrl).toBe(`${BRIDGE}/oauth/authorize?code=abc`);
    expect(JSON.stringify(flow)).not.toContain("deviceSecret");

    const pending = (await (
      await ownerClient.get(`${base}/${flow.flowId}/status`)
    ).json()) as ModelScopeAuthFlowStatusResponse;
    expect(pending).toEqual({ status: "pending" });

    const done = (await (
      await ownerClient.get(`${base}/${flow.flowId}/status`)
    ).json()) as ModelScopeAuthFlowStatusResponse;
    expect(done).toEqual({ status: "completed", applied: 3 });
    expect(JSON.stringify(done)).not.toContain("ms-token");

    const after = (await (
      await ownerClient.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const authorized = after.models.filter((model) => model.provider === "modelscope");
    expect(authorized).toHaveLength(3);
    // The token is reported masked, never in the clear, and every preset row uses it.
    expect(after.providers.modelscope?.apiKeyMasked).toBeTruthy();
    expect(
      authorized.every(
        (model) =>
          model.effective.apiKeySource === "provider" &&
          model.effective.apiKeyMasked === after.providers.modelscope?.apiKeyMasked,
      ),
    ).toBe(true);

    // Stored once, as the group's key; no row holds a copy.
    const raw = await t.deps.projectConfigService.readRaw(projectId);
    expect((raw.providers as Record<string, Record<string, unknown>>).modelscope?.api_key).toBe(
      "ms-token-0001",
    );
    const stored = raw.models as Record<string, unknown>[];
    expect(
      stored.filter((model) => model.provider === "modelscope" && model.api_key !== undefined),
    ).toEqual([]);
    const tokenRow = t.deps.db
      .prepare(
        `SELECT refresh_token, access_token_expires_at
         FROM model_provider_auth_tokens
         WHERE project_id = ? AND provider = ?`,
      )
      .get(projectId, "modelscope") as
      { refresh_token: string; access_token_expires_at: string } | undefined;
    expect(tokenRow).toMatchObject({ refresh_token: "ms-refresh-0001" });
    expect(Date.parse(tokenRow?.access_token_expires_at ?? "")).toBeGreaterThan(Date.now());
  });

  it("in a group where every model has its own key, the token still lands as the group key and the flow completes with 0", async () => {
    const base = `/api/projects/${projectId}/modelscope-auth`;
    const models = `/api/projects/${projectId}/models`;
    const own = presetModelEntries()
      .filter((entry) => entry.provider === "modelscope")
      .map((entry, i) => ({
        provider: "modelscope",
        modelId: entry.model_id,
        apiKey: `ms-own-key-000${i}`,
      }));
    expect((await ownerClient.put(models, { models: own })).status).toBe(200);

    const flow = (await (
      await ownerClient.post(`${base}/start`, {})
    ).json()) as ModelScopeAuthStartResponse;
    await ownerClient.get(`${base}/${flow.flowId}/status`);
    const done = (await (
      await ownerClient.get(`${base}/${flow.flowId}/status`)
    ).json()) as ModelScopeAuthFlowStatusResponse;
    expect(done).toEqual({ status: "completed", applied: 0 });

    const after = (await (await ownerClient.get(models)).json()) as ModelsResponse;
    expect(after.providers.modelscope?.apiKeyMasked).toBeTruthy();
    // Every model keeps the key it was given.
    expect(
      after.models
        .filter((model) => model.provider === "modelscope")
        .map((model) => model.effective.apiKeySource),
    ).toEqual(own.map(() => "model"));
  });

  it("a model on the group key sends the token refreshed into the group; a model with its own key sends that and asks for no refresh", async () => {
    const [following, owning] = presetModelEntries()
      .filter((entry) => entry.provider === "modelscope")
      .map((entry) => entry.model_id);
    const models = `/api/projects/${projectId}/models`;
    await ownerClient.put(models, {
      models: [
        { provider: "modelscope", modelId: following },
        { provider: "modelscope", modelId: owning, apiKey: "ms-own-row-key-0002" },
      ],
    });
    await ownerClient.put(`${models}/providers/modelscope`, { apiKey: "ms-old-access-0001" });
    // Authorized a while ago: the group's token expires within the refresh window.
    t.deps.db
      .prepare(
        `INSERT INTO model_provider_auth_tokens
           (project_id, provider, refresh_token, access_token_expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        "modelscope",
        "ms-refresh-0001",
        new Date(Date.now() + 60_000).toISOString(),
        new Date().toISOString(),
      );
    const network = stubFetch(({ url }) =>
      pathOf(url).endsWith("/oauth/refresh")
        ? jsonResponse({
            token: {
              accessToken: "ms-new-access-0003",
              refreshToken: "ms-refresh-0004",
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
          })
        : jsonResponse({ error: { message: "Incorrect API key provided." } }, 401),
    );
    const refreshes = () => network.calls.filter((c) => pathOf(c.url).endsWith("/oauth/refresh"));
    const sentKeys = () =>
      network.calls
        .filter((c) => !pathOf(c.url).endsWith("/oauth/refresh"))
        .map((c) => c.headers.get("authorization"));

    await ownerClient.post(`${models}/test`, { provider: "modelscope", modelId: owning! });
    expect(refreshes()).toEqual([]);
    expect(new Set(sentKeys())).toEqual(new Set(["Bearer ms-own-row-key-0002"]));

    network.calls.length = 0;
    await ownerClient.post(`${models}/test`, { provider: "modelscope", modelId: following! });
    expect(refreshes()).toHaveLength(1);
    expect(new Set(sentKeys())).toEqual(new Set(["Bearer ms-new-access-0003"]));
    const raw = await t.deps.projectConfigService.readRaw(projectId);
    expect((raw.providers as Record<string, Record<string, unknown>>).modelscope?.api_key).toBe(
      "ms-new-access-0003",
    );
  });

  it("a ModelScope group key typed by hand replaces the authorization: its refresh token goes with the old key", async () => {
    const tokens = () =>
      t.deps.db
        .prepare("SELECT refresh_token FROM model_provider_auth_tokens WHERE project_id = ?")
        .all(projectId);
    const insertToken = () =>
      t.deps.db
        .prepare(
          `INSERT INTO model_provider_auth_tokens
             (project_id, provider, refresh_token, access_token_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(projectId, "modelscope", "ms-refresh-0005", null, new Date().toISOString());
    const group = `/api/projects/${projectId}/models/providers/modelscope`;
    insertToken();
    // The group's endpoint is not its key: the authorization stands.
    await ownerClient.put(group, { baseUrl: "https://ms-proxy.example/v1" });
    expect(tokens()).toHaveLength(1);
    await ownerClient.put(group, { apiKey: "ms-typed-key-0006" });
    expect(tokens()).toEqual([]);
    insertToken();
    await ownerClient.put(`/api/projects/${projectId}/models`, {
      providers: { modelscope: { clearApiKey: true } },
      models: [],
    });
    expect(tokens()).toEqual([]);
  });

  it("Disconnect ends the authorization: the group key and its refresh token both go, and a later request neither refreshes nor brings the key back", async () => {
    const base = `/api/projects/${projectId}/modelscope-auth`;
    const flow = (await (
      await ownerClient.post(`${base}/start`, {})
    ).json()) as ModelScopeAuthStartResponse;
    await ownerClient.get(`${base}/${flow.flowId}/status`);
    const done = (await (
      await ownerClient.get(`${base}/${flow.flowId}/status`)
    ).json()) as ModelScopeAuthFlowStatusResponse;
    expect(done.status).toBe("completed");
    const tokens = () =>
      t.deps.db
        .prepare("SELECT refresh_token FROM model_provider_auth_tokens WHERE project_id = ?")
        .all(projectId);
    expect(tokens()).toHaveLength(1);

    const res = await ownerClient.put(`/api/projects/${projectId}/models/providers/modelscope`, {
      clearApiKey: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    expect(body.providers.modelscope?.apiKeyMasked).toBeUndefined();
    const rows = body.models.filter((model) => model.provider === "modelscope");
    expect(rows.every((model) => model.effective.apiKeySource === "none")).toBe(true);
    expect(tokens()).toEqual([]);

    const probe = (await (
      await ownerClient.post(`/api/projects/${projectId}/models/test`, {
        provider: "modelscope",
        modelId: rows[0]!.modelId,
      })
    ).json()) as { ok: boolean; message?: string };
    expect(probe.ok).toBe(false);
    expect(probe.message).toMatch(/has no API key/);
    expect(await t.deps.projectConfigService.getGroupApiKey(projectId, "modelscope")).toBe(
      undefined,
    );
  });

  it("answers an unknown or foreign flow with its own not-found code", async () => {
    const base = `/api/projects/${projectId}/modelscope-auth`;
    const missing = await ownerClient.get(`${base}/not-a-flow/status`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "modelscope_auth_flow_not_found" },
    });
    // A path-invalid id never reaches the service but reports the same way, so the dialog has
    // one condition to branch on.
    const invalid = await ownerClient.get(`${base}/has%2Fslash/status`);
    expect(invalid.status).toBe(404);
    expect(await invalid.json()).toMatchObject({
      error: { code: "modelscope_auth_flow_not_found" },
    });
  });
});
