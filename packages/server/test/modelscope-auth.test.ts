import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The production bridge address, path prefix included: the prefix must survive into every call. */
const BRIDGE = "https://go.penguin.ooo/modelscope";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function started(expiresInMs = 60_000): Response {
  return json(201, {
    authorizeUrl: `${BRIDGE}/oauth/authorize?code=abc`,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });
}

function pathOf(input: string | URL | Request): string {
  return new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
}

/** What the bridge answers once the user has finished ModelScope's own consent screen. */
const delivery = {
  status: "completed",
  token: {
    accessToken: "ms-token-0001",
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
      applyKey: async (projectId, accessToken) => {
        applied.push({ projectId, token: accessToken });
        return 1;
      },
      fetchImpl: async (input, init) => {
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
        return polls === 1 ? json(200, { status: "pending" }) : json(200, delivery);
      },
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
      applyKey: async () => {
        applies += 1;
        if (applies === 1) throw new Error("disk busy");
        return 1;
      },
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/start")) return started();
        polls += 1;
        return json(200, delivery);
      },
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

  it("treats a group that swallowed the token as a failed write, not as success", async () => {
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyKey: async () => 0,
      fetchImpl: async (input) => (pathOf(input).endsWith("/start") ? started() : json(200, delivery)),
    });
    const flow = await service.start(owner);
    expect(await service.status({ ...owner, flowId: flow.flowId })).toMatchObject({
      status: "apply_failed",
    });
    // Still retryable: an empty group is an operator problem, not a reason to re-authorize.
    expect(await service.retryApply({ ...owner, flowId: flow.flowId })).toMatchObject({
      status: "apply_failed",
    });
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
        applyKey: async () => 1,
        fetchImpl: async (input) =>
          pathOf(input).endsWith("/start") ? started() : json(200, { status: reported }),
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
      applyKey: async () => 1,
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/start")) return started();
        polls += 1;
        return json(200, { status: "expired" });
      },
    });
    const flow = await service.start(owner);
    await service.status({ ...owner, flowId: flow.flowId });
    await service.status({ ...owner, flowId: flow.flowId });
    expect(polls).toBe(1);
  });

  it("reports an unreachable bridge and a rejected start as upstream failures", async () => {
    const unreachable = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyKey: async () => 1,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(unreachable.start(owner)).rejects.toMatchObject({
      status: 502,
      code: "modelscope_unreachable",
    });

    const refused = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyKey: async () => 1,
      fetchImpl: async () => json(409, { error: "flow_conflict" }),
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
        applyKey: async () => 1,
        fetchImpl: async () =>
          json(201, {
            authorizeUrl,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
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
      applyKey: async () => 1,
      fetchImpl: async () => json(429, { error: "rate_limited", retryAfterSeconds: 12 }),
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
      applyKey: async () => 1,
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/start")) {
          return json(201, {
            authorizeUrl: `${BRIDGE}/oauth/authorize?code=abc`,
            expiresAt: new Date(now + 60_000).toISOString(),
          });
        }
        polls += 1;
        return polls === 1
          ? json(429, { error: "rate_limited", retryAfterSeconds: 2 })
          : json(200, delivery);
      },
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

  it("cancels at the bridge as well as locally, and never applies the token", async () => {
    let cancelled = 0;
    let applied = 0;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      applyKey: async () => {
        applied += 1;
        return 1;
      },
      fetchImpl: async (input) => {
        if (pathOf(input).endsWith("/start")) return started();
        if (pathOf(input).endsWith("/cancel")) {
          cancelled += 1;
          return json(200, { ok: true });
        }
        return json(200, delivery);
      },
    });
    const flow = await service.start(owner);
    service.cancel({ ...owner, flowId: flow.flowId });
    // The local state is what the next status call reads; the bridge call is best effort.
    expect(await service.status({ ...owner, flowId: flow.flowId })).toEqual({ status: "cancelled" });
    expect(applied).toBe(0);
    await vi.waitFor(() => expect(cancelled).toBe(1));
  });

  it("hides a flow from another Project or user, and forgets an expired one", async () => {
    let now = 1_000;
    const service = new ModelScopeAuthService({
      bridgeUrl: BRIDGE,
      now: () => now,
      applyKey: async () => 1,
      fetchImpl: async () => started(600_000),
    });
    const flow = await service.start(owner);
    const gone = { status: 404, code: "modelscope_auth_flow_not_found" };
    await expect(service.status({ ...owner, flowId: flow.flowId, userId: "u2" })).rejects.toMatchObject(gone);
    await expect(service.status({ ...owner, flowId: flow.flowId, projectId: "p2" })).rejects.toMatchObject(gone);
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = pathOf(input);
        // Every call carries the bridge's path prefix; a lost prefix is a 404 at the bridge.
        if (path === "/modelscope/oauth/start") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          expect(body.client).toEqual({ id: "penguin-harness" });
          return started();
        }
        if (path === "/modelscope/oauth/poll") {
          pollCount += 1;
          return pollCount === 1 ? json(200, { status: "pending" }) : json(200, delivery);
        }
        throw new Error(`Unexpected bridge request: ${path}`);
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await t.cleanup();
  });

  it("writes the delivered token to the group's preset row and exposes no account state", async () => {
    const base = `/api/projects/${projectId}/modelscope-auth`;
    const before = (await (
      await ownerClient.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const preset = before.models.filter((model) => model.provider === "modelscope");
    expect(preset.map((model) => model.modelId)).toEqual([
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "Qwen/Qwen3.8-27B",
      "Qwen/Qwen3.8-Flash-Next",
    ]);
    expect(preset.every((model) => model.credential?.apiKeyMasked === undefined)).toBe(true);

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
    // The token is reported masked, never in the clear.
    expect(authorized.every((model) => model.credential?.apiKeyMasked)).toBe(true);

    const stored = (await t.deps.projectConfigService.readRaw(projectId)).models as Record<
      string,
      unknown
    >[];
    expect(
      stored
        .filter((model) => model.provider === "modelscope")
        .map((model) => model.api_key),
    ).toEqual(["ms-token-0001", "ms-token-0001", "ms-token-0001"]);
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
