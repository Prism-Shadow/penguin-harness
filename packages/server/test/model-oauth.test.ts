/**
 * Provider key-minting flow: PKCE derivation, authorize-URL construction, the flow store's
 * expiry and single-use rules, the exchange's error mapping, and the routes end to end —
 * owner-only, key written to every model of the group, `credentials_updated` published.
 *
 * The redirect receiver is the one route of the group that answers without a session, and
 * the last describe covers exactly that: what the flow id alone buys, and — case by case —
 * what it still does not.
 *
 * No test reaches the network: `exchangeCode` takes its fetch as an argument, and the route
 * cases stub the global one.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, providerInfo } from "@prismshadow/penguin-core/model-catalog";
import type {
  ModelOAuthCodeResponse,
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  ModelsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { HttpError } from "../src/http/errors.js";
import {
  buildAuthorizeUrl,
  codeChallenge,
  createVerifier,
  exchangeCode,
  FLOW_TTL_MS,
  ModelOAuthService,
} from "../src/services/model-oauth-service.js";
import { requestOrigin } from "../src/http/routes/model-oauth.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The catalog group under test; the flow exists only because this entry declares it. */
const TOKENDANCE = providerInfo("tokendance")!;

/** A JSON reply from the exchange endpoint, without touching the network. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PKCE derivation", () => {
  it("challenge is the unpadded base64url SHA-256 of the verifier (RFC 7636 vector)", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("challenge carries no base64 padding or non-url characters", () => {
    const challenge = codeChallenge(createVerifier());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("verifier is inside the spec's 43-128 window and alphabet, and is not reused", () => {
    const a = createVerifier();
    const b = createVerifier();
    expect(a).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(a.length).toBe(72);
    expect(a).not.toBe(b);
  });
});

describe("authorize URL", () => {
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  it("carries the callback URL, the app URL and the key name, all percent-encoded", () => {
    const url = buildAuthorizeUrl({
      oauth: TOKENDANCE.oauth!,
      challenge,
      callbackUrl: "http://127.0.0.1:8123/api/projects/p1/model-oauth/callback?flow=abc-_1",
    });
    expect(url.startsWith(`${TOKENDANCE.oauth!.authorizeUrl}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get("callback_url")).toBe(
      "http://127.0.0.1:8123/api/projects/p1/model-oauth/callback?flow=abc-_1",
    );
    expect(q.get("code_challenge")).toBe(challenge);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("app_url")).toBe(APP_URL);
    expect(q.get("key_name")).toBe("PenguinHarness");
    // The two URL-valued parameters travel escaped, never raw.
    expect(url).toContain("app_url=https%3A%2F%2Fpenguin.ooo%2F");
    expect(url).toContain("callback_url=http%3A%2F%2F127.0.0.1%3A8123%2F");
    expect(url).not.toContain("?flow=abc-_1&code_challenge");
  });

  it("app_url is the harness's own stable URL, not the callback's ephemeral port", () => {
    const url = buildAuthorizeUrl({
      oauth: TOKENDANCE.oauth!,
      challenge,
      callbackUrl: "http://127.0.0.1:51234/api/projects/p1/model-oauth/callback?flow=x",
    });
    expect(new URL(url).searchParams.get("app_url")).toBe(APP_URL);
    expect(new URL(url).searchParams.get("app_url")).not.toContain("51234");
  });

  it("manual mode omits the callback and still pins S256", () => {
    const q = new URL(buildAuthorizeUrl({ oauth: TOKENDANCE.oauth!, challenge })).searchParams;
    expect(q.has("callback_url")).toBe(false);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe(challenge);
  });
});

describe("code exchange", () => {
  const call = (impl: typeof fetch) =>
    exchangeCode({
      exchangeUrl: TOKENDANCE.oauth!.exchangeUrl,
      code: "the-code",
      verifier: "the-verifier",
      fetchImpl: impl,
    });

  it("posts the code, the verifier and the method as JSON, and returns the minted key", async () => {
    const seen: { url: string; body: unknown } = { url: "", body: null };
    const res = await call((async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      return jsonResponse(200, { key: "sk-minted" });
    }) as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, key: "sk-minted" });
    expect(seen.url).toBe(TOKENDANCE.oauth!.exchangeUrl);
    expect(seen.body).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });

  it("400 is a malformed authorization request; 403 is a rejected code", async () => {
    const fail = (status: number) =>
      call((async () => jsonResponse(status, { error: "no" })) as unknown as typeof fetch);
    expect(await fail(400)).toEqual({ ok: false, error: "invalid_request" });
    expect(await fail(403)).toEqual({ ok: false, error: "code_rejected" });
    expect(await fail(500)).toEqual({ ok: false, error: "upstream_failed" });
  });

  it("a 200 without a usable key is a failure, not a key", async () => {
    expect(
      await call((async () => jsonResponse(200, { key: "" })) as unknown as typeof fetch),
    ).toEqual({ ok: false, error: "upstream_failed" });
    expect(await call((async () => jsonResponse(200, {})) as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "upstream_failed",
    });
    expect(
      await call(
        (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "upstream_failed" });
  });

  it("a transport failure reports unreachable and carries no detail (the request holds the code)", async () => {
    const res = await call((async () => {
      throw new Error("connect ECONNREFUSED sk-leak");
    }) as unknown as typeof fetch);
    expect(res).toEqual({ ok: false, error: "unreachable" });
    expect(JSON.stringify(res)).not.toContain("sk-leak");
  });
});

describe("flow store", () => {
  let clock: number;
  let applied: { projectId: string; provider: string; apiKey: string }[];
  let service: ModelOAuthService;

  const start = () =>
    service.start({
      projectId: "p1",
      userId: "u1",
      provider: "tokendance",
      mode: "callback",
      callbackOrigin: "http://127.0.0.1:8123",
    });

  beforeEach(() => {
    clock = 1_700_000_000_000;
    applied = [];
    service = new ModelOAuthService({
      applyGroupKey: async (projectId, provider, apiKey) => {
        applied.push({ projectId, provider, apiKey });
        return 6;
      },
      fetchImpl: (async () => jsonResponse(200, { key: "sk-minted" })) as unknown as typeof fetch,
      now: () => clock,
    });
  });

  it("refuses a provider that declares no flow, and one that is not in the catalog at all", () => {
    for (const provider of ["deepseek", "custom", "not-a-provider"]) {
      expect(() =>
        service.start({
          projectId: "p1",
          userId: "u1",
          provider,
          mode: "callback",
          callbackOrigin: "http://127.0.0.1:8123",
        }),
      ).toThrow(HttpError);
    }
  });

  it("the callback URL keeps its query, so the flow id rides back with the code", () => {
    const { flowId, authorizeUrl } = start();
    expect(new URL(authorizeUrl).searchParams.get("callback_url")).toBe(
      `http://127.0.0.1:8123/api/projects/p1/model-oauth/callback?flow=${encodeURIComponent(flowId)}`,
    );
    // Opaque and unguessable: 32 random bytes, base64url.
    expect(flowId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("a flow belongs to one user in one Project; anyone else sees a 404", () => {
    const { flowId } = start();
    expect(service.status({ flowId, userId: "u1", projectId: "p1" }).status).toBe("pending");
    expect(() => service.status({ flowId, userId: "u2", projectId: "p1" })).toThrow(HttpError);
    expect(() => service.status({ flowId, userId: "u1", projectId: "p2" })).toThrow(HttpError);
    expect(() => service.status({ flowId: "nope", userId: "u1", projectId: "p1" })).toThrow(
      HttpError,
    );
  });

  it("expires after ten minutes, and the expired flow is gone rather than failed", async () => {
    const { flowId } = start();
    clock += 10 * 60 * 1000 - 1;
    expect(service.status({ flowId, userId: "u1", projectId: "p1" }).status).toBe("pending");
    clock += 1;
    expect(() => service.status({ flowId, userId: "u1", projectId: "p1" })).toThrow(HttpError);
    await expect(
      service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" }),
    ).rejects.toThrow(HttpError);
  });

  it("is single use: the second redemption is refused and the verifier is spent only once", async () => {
    const { flowId } = start();
    expect(await service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" })).toEqual({
      ok: true,
      applied: 6,
    });
    expect(applied).toEqual([{ projectId: "p1", provider: "tokendance", apiKey: "sk-minted" }]);
    expect(service.status({ flowId, userId: "u1", projectId: "p1" }).status).toBe("done");
    await expect(
      service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" }),
    ).rejects.toThrow(HttpError);
    expect(applied).toHaveLength(1);
  });

  it("a failed exchange ends the flow and reports the mapped reason", async () => {
    service = new ModelOAuthService({
      applyGroupKey: async () => 6,
      fetchImpl: (async () => jsonResponse(403, {})) as unknown as typeof fetch,
      now: () => clock,
    });
    const { flowId } = start();
    expect(await service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" })).toEqual({
      ok: false,
      error: "code_rejected",
    });
    const state = service.status({ flowId, userId: "u1", projectId: "p1" });
    expect(state).toEqual({ status: "error", provider: "tokendance", error: "code_rejected" });
  });

  it("a key that cannot be stored is reported as such, not as a success", async () => {
    service = new ModelOAuthService({
      applyGroupKey: async () => {
        throw new Error("disk full");
      },
      fetchImpl: (async () => jsonResponse(200, { key: "sk-minted" })) as unknown as typeof fetch,
      now: () => clock,
    });
    const { flowId } = start();
    expect(await service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" })).toEqual({
      ok: false,
      error: "apply_failed",
    });
    expect(service.status({ flowId, userId: "u1", projectId: "p1" }).error).toBe("apply_failed");
  });
});

describe("callback origin", () => {
  it("follows the request's own URL when no proxy is trusted", () => {
    expect(requestOrigin("http://192.168.1.4:7364/api/x", {}, false)).toBe(
      "http://192.168.1.4:7364",
    );
    // Untrusted headers are ignored outright, so a caller cannot choose where the redirect lands.
    expect(
      requestOrigin("http://192.168.1.4:7364/api/x", { proto: "https", host: "evil.test" }, false),
    ).toBe("http://192.168.1.4:7364");
  });

  it("honours the forwarded pair once the deployment trusts it, taking the client-facing hop", () => {
    expect(
      requestOrigin(
        "http://127.0.0.1:7364/api/x",
        { proto: "https, http", host: "penguin.example, inner" },
        true,
      ),
    ).toBe("https://penguin.example");
    // Trusted but absent: the request's own URL still answers.
    expect(requestOrigin("http://127.0.0.1:7364/api/x", {}, true)).toBe("http://127.0.0.1:7364");
  });
});

describe("model-oauth routes", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let exchanges: { url: string; body: Record<string, unknown> }[];

  const base = () => `/api/projects/${projectId}/model-oauth`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_o");
    const b = await provisionUser(t.app, "member_m");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_o-td", name: "TokenDance project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_m" })).status,
    ).toBe(201);

    exchanges = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        exchanges.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return jsonResponse(200, { key: "sk-oauth-minted-key-9911" });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await t.cleanup();
  });

  it("owner starts a flow; a member cannot, and neither can start one for a group with no flow", async () => {
    const res = await owner.post(`${base()}/start`, { provider: "tokendance" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelOAuthStartResponse;
    expect(body.flowId).toMatch(/^[A-Za-z0-9_-]+$/);
    const q = new URL(body.authorizeUrl).searchParams;
    expect(q.get("callback_url")).toBe(
      `http://localhost${base()}/callback?flow=${encodeURIComponent(body.flowId)}`,
    );
    expect(q.get("key_name")).toBe("PenguinHarness");
    expect(q.get("app_url")).toBe(APP_URL);

    expect((await member.post(`${base()}/start`, { provider: "tokendance" })).status).toBe(403);
    expect((await owner.post(`${base()}/start`, { provider: "deepseek" })).status).toBe(400);
  });

  it("the callback redeems the code, writes the key to every model of the group, and reports it back in HTML", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;

    // A subscribed tab of this Project must be told the credentials changed.
    t.deps.sessionsRepo.insert({
      sessionId: "td-live",
      projectId,
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: t.root,
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    const events: ChannelEvent[] = [];
    t.deps.channels.get("td-live").subscribe((e) => events.push(e));

    const cb = await owner.get(
      `${base()}/callback?flow=${encodeURIComponent(started.flowId)}&code=auth-code-1`,
    );
    expect(cb.status).toBe(200);
    expect(cb.headers.get("content-type")).toContain("text/html");
    const page = await cb.text();
    expect(page).toContain("API key created");
    // The page tells the user the outcome and nothing else.
    expect(page).not.toContain("sk-oauth-minted-key-9911");
    expect(page).not.toContain("auth-code-1");
    expect(page).not.toContain("http://");

    // The exchange spoke the documented protocol, with a verifier this side never published.
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.url).toBe(TOKENDANCE.oauth!.exchangeUrl);
    expect(exchanges[0]!.body.code).toBe("auth-code-1");
    expect(exchanges[0]!.body.code_challenge_method).toBe("S256");
    expect(String(exchanges[0]!.body.code_verifier)).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(started.authorizeUrl).not.toContain(String(exchanges[0]!.body.code_verifier));

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const group = models.models.filter((m) => m.provider === "tokendance");
    expect(group.length).toBeGreaterThan(0);
    for (const m of group) expect(m.credential?.apiKeyMasked).toBeTruthy();
    // Only that group, and never in plaintext.
    for (const m of models.models.filter((m) => m.provider !== "tokendance")) {
      expect(m.credential?.apiKeyMasked).toBeUndefined();
    }
    expect(JSON.stringify(models)).not.toContain("sk-oauth-minted-key-9911");

    const cfg = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(cfg).toContain("sk-oauth-minted-key-9911");

    expect(
      events
        .filter((e) => e.event === "server_event")
        .map((e) => (JSON.parse(e.data) as { type: string }).type),
    ).toContain("credentials_updated");

    const status = (await (
      await owner.get(`${base()}/${started.flowId}`)
    ).json()) as ModelOAuthStatusResponse;
    expect(status).toEqual({ status: "done", provider: "tokendance" });

    // Replaying the same callback cannot spend the flow twice.
    const replay = await owner.get(
      `${base()}/callback?flow=${encodeURIComponent(started.flowId)}&code=auth-code-1`,
    );
    expect(replay.status).toBe(400);
    expect(exchanges).toHaveLength(1);
  });

  it("a rejected code leaves the flow in error and never touches the models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { error: "invalid_code" })),
    );
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;
    const cb = await owner.get(`${base()}/callback?flow=${started.flowId}&code=stale`);
    expect(cb.status).toBe(400);
    expect(await cb.text()).toContain("no longer valid");

    const status = (await (
      await owner.get(`${base()}/${started.flowId}`)
    ).json()) as ModelOAuthStatusResponse;
    expect(status.status).toBe("error");
    expect(status.error).toBe("code_rejected");

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    for (const m of models.models) expect(m.credential?.apiKeyMasked).toBeUndefined();
  });

  it("a malformed callback link answers a page, not a stack trace", async () => {
    const res = await owner.get(`${base()}/callback?flow=&code=`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Authorization failed");
    expect(exchanges).toHaveLength(0);
  });

  it("manual mode drops the callback and redeems a pasted code instead", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance", mode: "manual" })
    ).json()) as ModelOAuthStartResponse;
    expect(new URL(started.authorizeUrl).searchParams.has("callback_url")).toBe(false);

    const res = await owner.post(`${base()}/${started.flowId}/code`, { code: "pasted-code" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelOAuthCodeResponse;
    expect(body.ok).toBe(true);
    expect(body.applied).toBeGreaterThan(0);
    expect(exchanges[0]!.body.code).toBe("pasted-code");

    // Single use here too.
    const again = await owner.post(`${base()}/${started.flowId}/code`, { code: "pasted-code" });
    expect(again.status).toBe(409);
  });

  it("polling and redeeming both refuse a member, and 404 an unknown flow", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;
    expect((await member.get(`${base()}/${started.flowId}`)).status).toBe(403);
    expect((await member.post(`${base()}/${started.flowId}/code`, { code: "x" })).status).toBe(403);
    expect((await owner.get(`${base()}/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(
      404,
    );
  });
});

/**
 * The redirect receiver's exemption from the session gate.
 *
 * This is the desktop's whole story: the shell hands every non-app URL to
 * `shell.openExternal`, so the authorization page opens in the *system* browser, and the
 * system browser is redirected back to `http://localhost:<port>` holding no
 * `penguin_session` cookie for it. Behind the gate that was a bare 401 on every desktop
 * authorization while the browser — whose popup is a tab of the session that opened it —
 * completed fine.
 *
 * So the flow id is the credential on this one route, and these cases pin the whole of what
 * it buys: one Project, one code, ten minutes, once. Everything below is asserted with NO
 * cookie unless the case is specifically about the signed-in browser still working.
 */
describe("model-oauth callback without a session", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let otherProjectId: string;
  let exchanges: number;

  const base = (p = projectId) => `/api/projects/${p}/model-oauth`;
  /** The system browser the provider redirected: a request carrying no cookie at all. */
  const noSession = (apiPath: string, init?: RequestInit) => t.app.request(apiPath, init);
  const startFlow = async (p = projectId): Promise<string> =>
    (
      (await (
        await owner.post(`${base(p)}/start`, { provider: "tokendance" })
      ).json()) as ModelOAuthStartResponse
    ).flowId;
  const callback = (flowId: string, code = "auth-code-1", p = projectId) =>
    `${base(p)}/callback?flow=${encodeURIComponent(flowId)}&code=${code}`;
  /**
   * Whether any model of the group ended up with a stored key. The group's entries always
   * carry a `credential` (it holds the catalog's base URL), so only `apiKeyMasked` answers
   * the question actually being asked.
   */
  const groupHasKey = async (p = projectId): Promise<boolean> => {
    const models = (await (await owner.get(`/api/projects/${p}/models`)).json()) as ModelsResponse;
    return models.models.some(
      (m) => m.provider === "tokendance" && m.credential?.apiKeyMasked !== undefined,
    );
  };

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_o");
    owner = apiClient(t.app, a.cookie);
    const create = async (id: string): Promise<string> =>
      (
        (await (
          await owner.post("/api/projects", { projectId: id, name: id })
        ).json()) as ProjectCreateResponse
      ).project.projectId;
    projectId = await create("owner_o-td");
    otherProjectId = await create("owner_o-td2");

    exchanges = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        exchanges += 1;
        return jsonResponse(200, { key: "sk-oauth-minted-key-9911" });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await t.cleanup();
  });

  it("completes for the system browser, which carries no cookie — and still for a signed-in tab", async () => {
    // The desktop path: nothing but the flow id in the URL.
    const desktop = await noSession(callback(await startFlow()));
    expect(desktop.status).toBe(200);
    expect(desktop.headers.get("content-type")).toContain("text/html");
    const page = await desktop.text();
    expect(page).toContain("API key created");
    // Still says nothing but the outcome, session or no session.
    expect(page).not.toContain("sk-oauth-minted-key-9911");
    expect(page).not.toContain("auth-code-1");

    // The browser path, on the very same route: a popup of the session that opened it. It
    // was never broken and must not become so — the cookie is simply not consulted here.
    const browser = await owner.get(callback(await startFlow(), "auth-code-2"));
    expect(browser.status).toBe(200);
    expect(await browser.text()).toContain("API key created");

    expect(exchanges).toBe(2);
    expect(await groupHasKey()).toBe(true);
  });

  it("buys nothing for a flow id that does not exist", async () => {
    const res = await noSession(callback("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    expect(res.status).toBe(400);
    // The same page an expired or foreign flow gets: a flow id is not a probe for what exists.
    expect(await res.text()).toContain("Authorization failed");
    expect(exchanges).toBe(0);
    expect(await groupHasKey()).toBe(false);
  });

  it("cannot be redirected at a Project the flow does not belong to", async () => {
    const flowId = await startFlow();
    const res = await noSession(callback(flowId, "auth-code-1", otherProjectId));
    expect(res.status).toBe(400);
    expect(exchanges).toBe(0);
    expect(await groupHasKey(otherProjectId)).toBe(false);
    // And the flow itself is untouched — the misdirected attempt did not spend it.
    expect((await noSession(callback(flowId))).status).toBe(200);
    expect(await groupHasKey()).toBe(true);
  });

  it("refuses a flow past its ten-minute TTL", async () => {
    const flowId = await startFlow();
    // The service reads the clock through `Date.now()` at call time, so moving it is enough.
    const expired = Date.now() + FLOW_TTL_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(expired);
    const res = await noSession(callback(flowId));
    expect(res.status).toBe(400);
    expect(exchanges).toBe(0);
    vi.restoreAllMocks();
    expect(await groupHasKey()).toBe(false);
  });

  it("is single use: the redirect cannot be replayed", async () => {
    const flowId = await startFlow();
    expect((await noSession(callback(flowId))).status).toBe(200);
    const replay = await noSession(callback(flowId));
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("Authorization failed");
    // One code redeemed, one verifier spent.
    expect(exchanges).toBe(1);
  });

  it("exempts exactly this literal path and this method, and nothing around it", async () => {
    const flowId = await startFlow();
    // GET on the literal path is the exemption — and it beats the `:flowId` status route,
    // which would otherwise match "callback" and answer JSON from behind the gate.
    const literal = await noSession(`${base()}/callback`);
    expect(literal.status).toBe(400);
    expect(literal.headers.get("content-type")).toContain("text/html");
    // Everything adjacent is still gated: a longer path, another method, the sibling routes.
    expect((await noSession(`${base()}/callback/extra`)).status).toBe(401);
    expect((await noSession(`${base()}/callback`, { method: "POST" })).status).toBe(401);
    expect((await noSession(`${base()}/start`, { method: "POST" })).status).toBe(401);
    expect((await noSession(`${base()}/${flowId}`)).status).toBe(401);
    expect((await noSession(`${base()}/${flowId}/code`, { method: "POST" })).status).toBe(401);
    expect(exchanges).toBe(0);
  });
});
