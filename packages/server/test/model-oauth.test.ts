/**
 * Provider key minting (the OAuth-style flow a catalog group declares).
 *
 * - PKCE: the challenge is the unpadded base64url SHA-256 of a fresh, in-window verifier; the
 *   authorize URL carries the callback, the harness's own app URL and the key name, encoded,
 *   and manual mode omits the callback but still pins S256.
 * - The exchange posts code, verifier and method as JSON and returns the key; a 400, a 403, any
 *   other failure, a 200 without a usable key and an unreachable endpoint each map to their own
 *   reason, never carrying the request's detail.
 * - A flow belongs to one user in one Project, expires after ten minutes and is single use; a
 *   failed exchange or an unstorable key ends it with its reason. A redirect deposits the code
 *   once (a manual flow takes none) and only the owner's poll redeems it; an unpolled deposit
 *   expires with the flow. The callback origin follows the request unless a proxy is trusted.
 * - The routes: only the owner starts, polls and redeems; the key lands once, as the group's key
 *   every model of the group uses, and the Project's open Session channels hear
 *   credentials_updated; a rejected code reaches the dialog through the poll and touches no
 *   model; a malformed link answers a page. Disconnect (clearing the group key) is all it
 *   takes to undo it: no state of the flow outlives it, and models with their own key keep it.
 * - The redirect receiver answers without a session: the flow id buys a deposit and nothing
 *   more — not for another user, an unknown flow, another Project, a stale or replayed flow,
 *   a HEAD, or a manual flow — and the exemption covers exactly its literal path.
 *
 * No test reaches the network: the exchange endpoint is the suite's fetch fake, handed to
 * `exchangeCode` and the service, and standing in for the global fetch in the route cases. The
 * route describes share one app, every case in a Project of its own.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, presetModelEntries, providerInfo } from "@prismshadow/penguin-core/model-catalog";
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
import { fakeFetch, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import type { FetchFake } from "./fixtures/fetch.js";
import { sessionRow } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

/** The catalog group under test; the flow exists only because this entry declares it. */
const TOKENDANCE = providerInfo("tokendance")!;

/**
 * How many models the minted key lands on — derived from the catalog rather than pinned, so
 * adding a row to this group does not fail three assertions that are not about the count.
 */
const TOKENDANCE_MODELS = presetModelEntries().filter((m) => m.provider === "tokendance").length;

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
    const exchange = fakeFetch(() => jsonResponse({ key: "sk-minted" }));
    const res = await call(exchange.fetch);
    expect(res).toEqual({ ok: true, key: "sk-minted" });
    expect(exchange.calls.map((c) => c.url)).toEqual([TOKENDANCE.oauth!.exchangeUrl]);
    expect(JSON.parse(exchange.calls[0]!.body)).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });

  it("400 is a malformed authorization request; 403 is a rejected code", async () => {
    const fail = (status: number) =>
      call(fakeFetch(() => jsonResponse({ error: "no" }, status)).fetch);
    expect(await fail(400)).toEqual({ ok: false, error: "invalid_request" });
    expect(await fail(403)).toEqual({ ok: false, error: "code_rejected" });
    expect(await fail(500)).toEqual({ ok: false, error: "upstream_failed" });
  });

  it("a 200 without a usable key is a failure, not a key", async () => {
    const answered = (response: Response) => call(fakeFetch(() => response).fetch);
    expect(await answered(jsonResponse({ key: "" }))).toEqual({
      ok: false,
      error: "upstream_failed",
    });
    expect(await answered(jsonResponse({}))).toEqual({ ok: false, error: "upstream_failed" });
    expect(await answered(new Response("not json", { status: 200 }))).toEqual({
      ok: false,
      error: "upstream_failed",
    });
  });

  it("a transport failure reports unreachable and carries no detail (the request holds the code)", async () => {
    const res = await call(
      fakeFetch(() => {
        throw new Error("connect ECONNREFUSED sk-leak");
      }).fetch,
    );
    expect(res).toEqual({ ok: false, error: "unreachable" });
    expect(JSON.stringify(res)).not.toContain("sk-leak");
  });
});

describe("flow store", () => {
  let clock: number;
  let applied: { projectId: string; provider: string; apiKey: string }[];
  /** The provider's exchange endpoint. */
  let exchange: FetchFake;
  /** Codes the exchange endpoint was asked to redeem, in order. */
  const exchanged = () =>
    exchange.calls.map((call) => (JSON.parse(call.body) as { code: string }).code);
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
    exchange = fakeFetch(() => jsonResponse({ key: "sk-minted" }));
    service = wire(ModelOAuthService, {
      applyGroupKey: async (projectId: string, provider: string, apiKey: string) => {
        applied.push({ projectId, provider, apiKey });
        return 6;
      },
      fetchImpl: exchange.fetch,
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

  it("a flow belongs to one user in one Project; anyone else sees a 404", async () => {
    const { flowId } = start();
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).status).toBe("pending");
    await expect(service.poll({ flowId, userId: "u2", projectId: "p1" })).rejects.toThrow(
      HttpError,
    );
    await expect(service.poll({ flowId, userId: "u1", projectId: "p2" })).rejects.toThrow(
      HttpError,
    );
    await expect(service.poll({ flowId: "nope", userId: "u1", projectId: "p1" })).rejects.toThrow(
      HttpError,
    );
  });

  it("expires after ten minutes, and the expired flow is gone rather than failed", async () => {
    const { flowId } = start();
    clock += 10 * 60 * 1000 - 1;
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).status).toBe("pending");
    clock += 1;
    await expect(service.poll({ flowId, userId: "u1", projectId: "p1" })).rejects.toThrow(
      HttpError,
    );
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
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).status).toBe("done");
    await expect(
      service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" }),
    ).rejects.toThrow(HttpError);
    expect(applied).toHaveLength(1);
  });

  it("a failed exchange ends the flow and reports the mapped reason", async () => {
    service = wire(ModelOAuthService, {
      applyGroupKey: async () => 6,
      fetchImpl: fakeFetch(() => jsonResponse({}, 403)).fetch,
      now: () => clock,
    });
    const { flowId } = start();
    expect(await service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" })).toEqual({
      ok: false,
      error: "code_rejected",
    });
    const state = await service.poll({ flowId, userId: "u1", projectId: "p1" });
    expect(state).toEqual({ status: "error", provider: "tokendance", error: "code_rejected" });
  });

  it("a key that cannot be stored is reported as such, not as a success", async () => {
    service = wire(ModelOAuthService, {
      applyGroupKey: async () => {
        throw new Error("disk full");
      },
      fetchImpl: fakeFetch(() => jsonResponse({ key: "sk-minted" })).fetch,
      now: () => clock,
    });
    const { flowId } = start();
    expect(await service.complete({ flowId, userId: "u1", projectId: "p1", code: "c" })).toEqual({
      ok: false,
      error: "apply_failed",
    });
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).error).toBe(
      "apply_failed",
    );
  });

  it("a deposited code is redeemed by the owner's poll, not by the deposit itself", async () => {
    const { flowId } = start();
    service.deposit({ flowId, projectId: "p1", code: "redirected-code" });
    // The deposit alone reaches no provider and writes nothing.
    expect(applied).toEqual([]);
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).status).toBe("done");
    expect(applied).toEqual([{ projectId: "p1", provider: "tokendance", apiKey: "sk-minted" }]);
    // `applied` is set on the redeeming poll only, so the route publishes the change once.
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).applied).toBeUndefined();
    expect(applied).toHaveLength(1);
  });

  it("a manual flow has no redirect to receive, so it cannot be deposited into", () => {
    const { flowId } = service.start({
      projectId: "p1",
      userId: "u1",
      provider: "tokendance",
      mode: "manual",
      callbackOrigin: "http://127.0.0.1:8123",
    });
    expect(() => service.deposit({ flowId, projectId: "p1", code: "c" })).toThrow(HttpError);
  });

  it("the deposit slot holds one code: a second redirect neither overwrites it nor re-arms it", async () => {
    const { flowId } = start();
    service.deposit({ flowId, projectId: "p1", code: "first" });
    expect(() => service.deposit({ flowId, projectId: "p1", code: "second" })).toThrow(HttpError);
    expect((await service.poll({ flowId, userId: "u1", projectId: "p1" })).status).toBe("done");
    expect(exchanged()).toEqual(["first"]);
    // And once redeemed there is nothing left to deposit into either.
    expect(() => service.deposit({ flowId, projectId: "p1", code: "third" })).toThrow(HttpError);
    expect(exchanged()).toEqual(["first"]);
  });

  it("a deposited code that nobody polls for expires with the flow", async () => {
    const { flowId } = start();
    service.deposit({ flowId, projectId: "p1", code: "never-polled" });
    clock += FLOW_TTL_MS;
    await expect(service.poll({ flowId, userId: "u1", projectId: "p1" })).rejects.toThrow(
      HttpError,
    );
    expect(exchanged()).toEqual([]);
    expect(applied).toEqual([]);
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

/** The route describes' app and the owner of every Project in it. */
let t: TestApp;
let owner: ReturnType<typeof apiClient>;

beforeAll(async () => {
  t = await createTestApp();
  owner = apiClient(t.app, (await provisionUser(t.app, "owner_o")).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

describe("model-oauth routes", () => {
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  /** The provider's exchange endpoint, standing in for the global fetch. */
  let exchange: FetchFake;
  const exchanges = () =>
    exchange.calls.map((call) => ({
      url: call.url,
      body: JSON.parse(call.body) as Record<string, unknown>,
    }));

  const base = () => `/api/projects/${projectId}/model-oauth`;

  beforeAll(async () => {
    member = apiClient(t.app, (await provisionUser(t.app, "member_m")).cookie);
  });

  // Every case runs its flows against a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_o-td_${projects}`,
        name: "TokenDance project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_m" })).status,
    ).toBe(201);
    exchange = stubFetch(() => jsonResponse({ key: "sk-oauth-minted-key-9911" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("the callback deposits the code and the owner's poll redeems it, writing the group's key, which every model of the group uses", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;

    // A subscribed tab of this Project must be told the credentials changed.
    t.deps.sessionsRepo.insert(sessionRow("td-live", { projectId, workspace: t.root }));
    const events: ChannelEvent[] = [];
    t.deps.channels.get("td-live").subscribe((e) => events.push(e));

    const cb = await owner.get(
      `${base()}/callback?flow=${encodeURIComponent(started.flowId)}&code=auth-code-1`,
    );
    expect(cb.status).toBe(200);
    expect(cb.headers.get("content-type")).toContain("text/html");
    const page = await cb.text();
    expect(page).toContain("Authorization received");
    // The page tells the user where to look and nothing else.
    expect(page).not.toContain("sk-oauth-minted-key-9911");
    expect(page).not.toContain("auth-code-1");
    expect(page).not.toContain("http://");
    // The receiver only wrote the code onto the flow: no provider was called yet.
    expect(exchanges()).toHaveLength(0);

    // The owner's poll is what redeems it, and it reports the finished flow in the same tick.
    const status = (await (
      await owner.get(`${base()}/${started.flowId}`)
    ).json()) as ModelOAuthStatusResponse;
    expect(status).toEqual({ status: "done", provider: "tokendance", applied: TOKENDANCE_MODELS });

    // The exchange spoke the documented protocol, with a verifier this side never published.
    expect(exchanges()).toHaveLength(1);
    expect(exchanges()[0]!.url).toBe(TOKENDANCE.oauth!.exchangeUrl);
    expect(exchanges()[0]!.body.code).toBe("auth-code-1");
    expect(exchanges()[0]!.body.code_challenge_method).toBe("S256");
    expect(String(exchanges()[0]!.body.code_verifier)).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(started.authorizeUrl).not.toContain(String(exchanges()[0]!.body.code_verifier));

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    const group = models.models.filter((m) => m.provider === "tokendance");
    expect(group.length).toBeGreaterThan(0);
    expect(models.providers.tokendance?.apiKeyMasked).toBeTruthy();
    for (const m of group) expect(m.effective.apiKeySource).toBe("provider");
    // Only that group, and never in plaintext.
    expect(
      Object.entries(models.providers)
        .filter(([, connection]) => connection.apiKeyMasked !== undefined)
        .map(([id]) => id),
    ).toEqual(["tokendance"]);
    expect(JSON.stringify(models)).not.toContain("sk-oauth-minted-key-9911");

    // Stored once, for the group — not once per model.
    const cfg = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(cfg.match(/sk-oauth-minted-key-9911/g)).toHaveLength(1);

    expect(
      events
        .filter((e) => e.event === "server_event")
        .map((e) => (JSON.parse(e.data) as { type: string }).type),
    ).toContain("credentials_updated");
    // Published by the redeeming poll alone; the ones after it report a finished flow only.
    expect(await (await owner.get(`${base()}/${started.flowId}`)).json()).toEqual({
      status: "done",
      provider: "tokendance",
    });
    expect(
      events.filter(
        (e) =>
          e.event === "server_event" &&
          (JSON.parse(e.data) as { type: string }).type === "credentials_updated",
      ),
    ).toHaveLength(1);

    // Replaying the same callback cannot spend the flow twice.
    const replay = await owner.get(
      `${base()}/callback?flow=${encodeURIComponent(started.flowId)}&code=auth-code-1`,
    );
    expect(replay.status).toBe(400);
    expect(exchanges()).toHaveLength(1);
  });

  it("a rejected code leaves the flow in error, reaches the dialog through the poll, and never touches the models", async () => {
    exchange = stubFetch(() => jsonResponse({ error: "invalid_code" }, 403));
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;
    // The redirect cannot know the exchange will fail — it deposits and says so.
    const cb = await owner.get(`${base()}/callback?flow=${started.flowId}&code=stale`);
    expect(cb.status).toBe(200);
    expect(await cb.text()).toContain("Authorization received");

    // The failure surfaces where the dialog is looking, and the flow is left ended, not stuck.
    const status = (await (
      await owner.get(`${base()}/${started.flowId}`)
    ).json()) as ModelOAuthStatusResponse;
    expect(status.status).toBe("error");
    expect(status.error).toBe("code_rejected");
    expect(
      (await (await owner.get(`${base()}/${started.flowId}`)).json()) as ModelOAuthStatusResponse,
    ).toEqual({ status: "error", provider: "tokendance", error: "code_rejected" });

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    for (const connection of Object.values(models.providers)) {
      expect(connection.apiKeyMasked).toBeUndefined();
    }
    for (const m of models.models) expect(m.credential?.apiKeyMasked).toBeUndefined();
  });

  it("Disconnect clears the group key the flow wrote: the group's models stop using it, a model with its own key keeps it, and nothing else of the group changes", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance" })
    ).json()) as ModelOAuthStartResponse;
    await owner.get(`${base()}/callback?flow=${encodeURIComponent(started.flowId)}&code=c-1`);
    expect(
      ((await (await owner.get(`${base()}/${started.flowId}`)).json()) as ModelOAuthStatusResponse)
        .status,
    ).toBe("done");
    // One model keyed to an account of its own.
    const svc = t.deps.projectConfigService;
    const raw = await svc.readRaw(projectId);
    await svc.writeRaw(projectId, {
      ...raw,
      models: (raw.models as Array<Record<string, unknown>>).map((m) =>
        m.provider === "tokendance" && m.model_id === "glm-5.3"
          ? { ...m, api_key: "sk-td-own-row-0017" }
          : m,
      ),
    });
    const connected = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;

    const res = await owner.put(`/api/projects/${projectId}/models/providers/tokendance`, {
      clearApiKey: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelsResponse;
    const {
      apiKeyMasked: _key,
      createdAt: _createdAt,
      ...connection
    } = connected.providers.tokendance!;
    expect(body.providers.tokendance).toEqual(connection);
    for (const m of body.models.filter((row) => row.provider === "tokendance")) {
      expect(m.effective.apiKeySource, m.modelId).toBe(m.modelId === "glm-5.3" ? "model" : "none");
    }
    const cfg = await readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(cfg).not.toContain("sk-oauth-minted-key-9911");
    expect(cfg).toContain("sk-td-own-row-0017");
  });

  it("a malformed callback link answers a page, not a stack trace", async () => {
    const res = await owner.get(`${base()}/callback?flow=&code=`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Authorization failed");
    expect(exchanges()).toHaveLength(0);
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
    expect(exchanges()[0]!.body.code).toBe("pasted-code");

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
 * it buys. It is bounded twice over: depositing a code is all the route can do — no key
 * reaches a Project until that Project's owner polls — and the deposit itself is one
 * Project, one code, ten minutes, once, callback flows only, GET only. Everything below is
 * asserted with NO cookie unless the case is specifically about a signed-in browser.
 */
describe("model-oauth callback without a session", () => {
  /** A signed-in member of the flow's Project who is not its owner — the closest anyone gets. */
  let stranger: ReturnType<typeof apiClient>;
  let projectId: string;
  let otherProjectId: string;
  /** The provider's exchange endpoint, standing in for the global fetch. */
  let exchange: FetchFake;

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
  /** What the owner's dialog asks for every two seconds — and what redeems a deposited code. */
  const poll = async (flowId: string, p = projectId): Promise<ModelOAuthStatusResponse> =>
    (await (await owner.get(`${base(p)}/${flowId}`)).json()) as ModelOAuthStatusResponse;
  /** Whether the group ended up with a stored key (the group's own; its models follow it). */
  const groupHasKey = async (p = projectId): Promise<boolean> => {
    const models = (await (await owner.get(`/api/projects/${p}/models`)).json()) as ModelsResponse;
    return models.providers.tokendance?.apiKeyMasked !== undefined;
  };

  /** A Project of the owner's. */
  const create = async (id: string): Promise<string> =>
    (
      (await (
        await owner.post("/api/projects", { projectId: id, name: id })
      ).json()) as ProjectCreateResponse
    ).project.projectId;

  // The stranger, and another Project the owner also holds (a flow presented under it stores
  // nothing there, which no case changes), are the describe's; the flow's Project is per case.
  beforeAll(async () => {
    stranger = apiClient(t.app, (await provisionUser(t.app, "stranger_s")).cookie);
    otherProjectId = await create("owner_o-other");
  });

  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    projectId = await create(`owner_o-cb_${projects}`);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "stranger_s" })).status,
    ).toBe(201);
    exchange = stubFetch(() => jsonResponse({ key: "sk-oauth-minted-key-9911" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes the code from the system browser, which carries no cookie, and writes nothing until the owner polls", async () => {
    // The desktop path: nothing but the flow id in the URL.
    const flowId = await startFlow();
    const desktop = await noSession(callback(flowId));
    expect(desktop.status).toBe(200);
    expect(desktop.headers.get("content-type")).toContain("text/html");
    const page = await desktop.text();
    expect(page).toContain("Authorization received");
    // Says nothing but where to look, session or no session.
    expect(page).not.toContain("sk-oauth-minted-key-9911");
    expect(page).not.toContain("auth-code-1");

    // Nothing was redeemed and nothing was stored: the route has no such authority.
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey()).toBe(false);

    // The owner's own poll is what spends the code and lands the key.
    expect(await poll(flowId)).toEqual({
      status: "done",
      provider: "tokendance",
      applied: TOKENDANCE_MODELS,
    });
    expect(exchange.calls).toHaveLength(1);
    expect(await groupHasKey()).toBe(true);
  });

  it("still takes the redirect of a signed-in tab, which is the browser path", async () => {
    // The popup of the session that opened it was never broken and must not become so —
    // the cookie is simply not consulted here.
    const flowId = await startFlow();
    const browser = await owner.get(callback(flowId, "auth-code-2"));
    expect(browser.status).toBe(200);
    expect(await browser.text()).toContain("Authorization received");
    expect(await poll(flowId)).toEqual({
      status: "done",
      provider: "tokendance",
      applied: TOKENDANCE_MODELS,
    });
    expect(exchange.calls).toHaveLength(1);
    expect(await groupHasKey()).toBe(true);
  });

  it("lets another signed-in user deposit no more than a stranger, and land nothing", async () => {
    const flowId = await startFlow();
    // Their cookie is not consulted on this route, so their redirect is received like anyone's.
    expect((await stranger.get(callback(flowId))).status).toBe(200);
    // And that is the end of what it buys them: they cannot poll the flow, so they cannot
    // make the code they deposited become a key in someone else's Project.
    expect((await stranger.get(`${base()}/${flowId}`)).status).toBe(403);
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey()).toBe(false);
    // Only the owner's poll spends it.
    expect((await poll(flowId)).status).toBe("done");
    expect(await groupHasKey()).toBe(true);
  });

  it("buys nothing for a flow id that does not exist", async () => {
    const res = await noSession(callback("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    expect(res.status).toBe(400);
    // The same page an expired or foreign flow gets: a flow id is not a probe for what exists.
    expect(await res.text()).toContain("Authorization failed");
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey()).toBe(false);
  });

  it("cannot be redirected at a Project the flow does not belong to", async () => {
    const flowId = await startFlow();
    const res = await noSession(callback(flowId, "auth-code-1", otherProjectId));
    expect(res.status).toBe(400);
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey(otherProjectId)).toBe(false);
    // And the flow itself is untouched — the misdirected attempt did not spend it.
    expect((await noSession(callback(flowId))).status).toBe(200);
    expect((await poll(flowId)).status).toBe("done");
    expect(await groupHasKey()).toBe(true);
  });

  it("refuses a flow past its ten-minute TTL", async () => {
    const flowId = await startFlow();
    // The service reads the clock through `Date.now()` at call time, so moving it is enough.
    const expired = Date.now() + FLOW_TTL_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(expired);
    const res = await noSession(callback(flowId));
    expect(res.status).toBe(400);
    expect(exchange.calls).toHaveLength(0);
    vi.restoreAllMocks();
    expect(await groupHasKey()).toBe(false);
  });

  it("bounds a deposited code by the same TTL: an unpolled flow expires with it", async () => {
    const flowId = await startFlow();
    expect((await noSession(callback(flowId))).status).toBe(200);
    // The dialog was closed before its next tick; the code must not outlive the flow.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + FLOW_TTL_MS + 1);
    expect((await owner.get(`${base()}/${flowId}`)).status).toBe(404);
    vi.restoreAllMocks();
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey()).toBe(false);
  });

  it("is single use: the redirect cannot be replayed, before or after the exchange", async () => {
    const flowId = await startFlow();
    expect((await noSession(callback(flowId))).status).toBe(200);
    // A second redirect must not overwrite the deposited code nor re-arm the exchange.
    const replay = await noSession(callback(flowId, "auth-code-2"));
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("Authorization failed");

    expect((await poll(flowId)).status).toBe("done");
    expect((await noSession(callback(flowId))).status).toBe(400);
    // One code redeemed, one verifier spent — and it was the first code, not the replay's.
    expect(exchange.calls).toHaveLength(1);
  });

  it("deposits once when two redirects arrive together, and spends it once", async () => {
    const flowId = await startFlow();
    const both = await Promise.all([
      noSession(callback(flowId, "race-a")),
      noSession(callback(flowId, "race-b")),
    ]);
    // The deposit slot is claimed synchronously, so exactly one of them can take it.
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await poll(flowId)).status).toBe("done");
    expect(exchange.calls).toHaveLength(1);
  });

  it("redeems a deposited code once when two polls arrive together", async () => {
    // The single-use property lives in the exchange claim now: the verifier and the code are
    // both nulled before the first await, so overlapping polls cannot both mint a key.
    const flowId = await startFlow();
    expect((await noSession(callback(flowId))).status).toBe(200);
    const both = await Promise.all([poll(flowId), poll(flowId)]);
    expect(exchange.calls).toHaveLength(1);
    expect(both.map((r) => r.status)).toContain("done");
    for (const r of both) expect(r.status).not.toBe("error");
    expect(await groupHasKey()).toBe(true);
  });

  it("refuses the HEAD that Hono re-dispatches as a GET, leaving the flow unspent", async () => {
    const flowId = await startFlow();
    const head = await noSession(callback(flowId), { method: "HEAD" });
    expect(head.status).toBe(405);
    expect(await head.text()).toBe("");
    // A method HTTP requires to be safe changed nothing, so the real redirect still lands.
    expect((await noSession(callback(flowId))).status).toBe(200);
    expect((await poll(flowId)).status).toBe("done");
    expect(exchange.calls).toHaveLength(1);
    expect(await groupHasKey()).toBe(true);
  });

  it("has no redirect to receive for a flow that chose manual mode", async () => {
    const started = (await (
      await owner.post(`${base()}/start`, { provider: "tokendance", mode: "manual" })
    ).json()) as ModelOAuthStartResponse;
    // The deployment opted out: no callback URL was ever handed to the provider.
    expect(new URL(started.authorizeUrl).searchParams.has("callback_url")).toBe(false);

    const res = await noSession(callback(started.flowId));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Authorization failed");
    expect(exchange.calls).toHaveLength(0);
    expect(await groupHasKey()).toBe(false);

    // The paste box that mode did opt into still redeems it.
    expect((await owner.post(`${base()}/${started.flowId}/code`, { code: "pasted" })).status).toBe(
      200,
    );
    expect(exchange.calls).toHaveLength(1);
    expect(await groupHasKey()).toBe(true);
  });

  it("exempts exactly this literal path, and nothing around it", async () => {
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
    expect(exchange.calls).toHaveLength(0);
  });
});
