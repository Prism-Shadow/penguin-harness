/**
 * Minting a provider key for a model on a REMOTE machine, through the hub's machine proxy.
 *
 * The browser talks to the hub; the hub forwards `/server/<machineId>/api/…` to the machine's
 * loopback, where the request reads `localhost:<machine port>`. The flow's callback has to name
 * the hub's origin under the machine's prefix instead, or the provider redirects the browser to
 * a page that never answers.
 *
 * - The machine believes `x-forwarded-*` only from a session minted over its data root (what
 *   the hub presents); a browser's own session gets the request's own origin, whatever it sends.
 * - A hub-minted session that names no browser host (an older hub) gets a manual flow, and the
 *   answer says so.
 * - Two real servers: a start through the hub names the hub's origin and the machine's prefix,
 *   the provider's redirect reaches the machine through the hub WITHOUT the hub's session, and
 *   the owner's poll through the hub lands the key on the machine. The exemption is exactly
 *   that path: its neighbours still need a session, and a HEAD is refused.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type {
  ModelOAuthStartResponse,
  ModelOAuthStatusResponse,
  ModelsResponse,
} from "../src/api/types.js";
import { AuthSessionsRepo } from "../src/db/repos/auth-sessions.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { jsonResponse, stubFetch } from "./fixtures/fetch.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The machine, by the id it minted; the hub's browser-facing origin (made-up names). */
const MACHINE = "Qm9hcmQtTWFjaGluZQ";
const HUB = "http://hub.example.test:53531";
const PROJECT = "default_project";
const START = `/api/projects/${PROJECT}/model-oauth/start`;

/** A session minted over the data root, as `penguin auth token` (and so the hub) gets one. */
function cliCookie(t: TestApp): string {
  const { token } = wire(AuthSessionsRepo, { db: t.deps.db }).issue({
    userId: "admin",
    via: "cli",
    now: new Date(),
    ttlMs: 60 * 60_000,
  });
  return `${SESSION_COOKIE}=${token}`;
}

const callbackOf = (res: ModelOAuthStartResponse): string | null =>
  new URL(res.authorizeUrl).searchParams.get("callback_url");

const startOn = (app: TestApp["app"], cookie: string, headers: Record<string, string> = {}) =>
  app.request(START, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...headers },
    body: JSON.stringify({ provider: "tokendance" }),
  });

describe("a machine's start, as the hub forwards it", () => {
  let machine: TestApp;
  beforeAll(async () => {
    machine = await createTestApp();
  });
  afterAll(async () => {
    await machine.cleanup();
  });

  const forwarded = {
    "x-forwarded-host": "hub.example.test:53531",
    "x-forwarded-proto": "http",
    "x-forwarded-prefix": `/server/${MACHINE}`,
  };

  it("names the hub's origin under the machine's prefix for the hub's own session", async () => {
    const res = await startOn(machine.app, cliCookie(machine), forwarded);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelOAuthStartResponse;
    expect(body.mode).toBe("callback");
    expect(callbackOf(body)).toBe(
      `${HUB}/server/${MACHINE}/api/projects/${PROJECT}/model-oauth/callback?flow=${encodeURIComponent(body.flowId)}`,
    );
  });

  it("ignores the same headers on a browser's own session", async () => {
    const { cookie } = await loginAdmin(machine.app);
    const body = (await (
      await startOn(machine.app, cookie, forwarded)
    ).json()) as ModelOAuthStartResponse;
    expect(body.mode).toBe("callback");
    expect(callbackOf(body)).toBe(
      `http://localhost/api/projects/${PROJECT}/model-oauth/callback?flow=${encodeURIComponent(body.flowId)}`,
    );
  });

  it("opens a manual flow, and says so, when the hub names no browser host", async () => {
    const body = (await (
      await startOn(machine.app, cliCookie(machine))
    ).json()) as ModelOAuthStartResponse;
    expect(body.mode).toBe("manual");
    expect(callbackOf(body)).toBeNull();
  });

  it("keeps a manual flow manual, and a browser's callback flow a callback", async () => {
    const res = await machine.app.request(START, {
      method: "POST",
      headers: { cookie: cliCookie(machine), "content-type": "application/json", ...forwarded },
      body: JSON.stringify({ provider: "tokendance", mode: "manual" }),
    });
    expect(((await res.json()) as ModelOAuthStartResponse).mode).toBe("manual");
    const { cookie } = await loginAdmin(machine.app);
    expect(
      ((await (await startOn(machine.app, cookie)).json()) as ModelOAuthStartResponse).mode,
    ).toBe("callback");
  });

  it("drops a forwarded prefix that is not plain path segments", async () => {
    const body = (await (
      await startOn(machine.app, cliCookie(machine), {
        ...forwarded,
        "x-forwarded-prefix": "//evil.example.test/x",
      })
    ).json()) as ModelOAuthStartResponse;
    expect(callbackOf(body)).toBe(
      `${HUB}/api/projects/${PROJECT}/model-oauth/callback?flow=${encodeURIComponent(body.flowId)}`,
    );
  });
});

describe("the whole flow through a hub, on two servers", () => {
  let hub: TestApp;
  let machine: TestApp;
  let server: ReturnType<typeof serve>;
  let port: number;
  let hubCookie: string;
  const agent = new http.Agent();

  beforeAll(async () => {
    machine = await createTestApp();
    hub = await createTestApp();
    await new Promise<void>((resolve) => {
      server = serve({ fetch: machine.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
        port = (info as AddressInfo).port;
        resolve();
      });
    });
    hubCookie = (await loginAdmin(hub.app)).cookie;
  });
  afterAll(async () => {
    agent.destroy();
    (server as unknown as http.Server).closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await hub.cleanup();
    await machine.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** The hub holds a connection to the machine: a dial to its port and the session minted there. */
  const connect = () =>
    vi.spyOn(hub.deps.machines, "proxyTarget").mockResolvedValue({
      agent,
      port,
      cookie: cliCookie(machine),
      session: 1,
    });

  const onHub = (path: string, init: RequestInit = {}) => hub.app.request(`${HUB}${path}`, init);
  const viaHub = (path: string) => `/server/${MACHINE}${path}`;

  it("completes: the redirect reaches the machine through the hub, the owner's poll lands the key", async () => {
    connect();
    const exchange = stubFetch(() => jsonResponse({ key: "sk-oauth-minted-key-4242" }));

    const started = await onHub(viaHub(START), {
      method: "POST",
      headers: { cookie: hubCookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "tokendance" }),
    });
    expect(started.status).toBe(200);
    const flow = (await started.json()) as ModelOAuthStartResponse;
    expect(flow.mode).toBe("callback");
    const callback = callbackOf(flow);
    expect(callback).toBe(
      `${HUB}${viaHub(`/api/projects/${PROJECT}/model-oauth/callback`)}?flow=${encodeURIComponent(flow.flowId)}`,
    );

    // The provider sends the browser back with the code; on the desktop that is the system
    // browser, which holds no session for the hub.
    const landed = await hub.app.request(`${callback}&code=auth-code-1`);
    expect(landed.status).toBe(200);
    expect(await landed.text()).toContain("Authorization received");
    expect(exchange.calls).toHaveLength(0);

    const poll = await onHub(viaHub(`/api/projects/${PROJECT}/model-oauth/${flow.flowId}`), {
      headers: { cookie: hubCookie },
    });
    expect(poll.status).toBe(200);
    expect(((await poll.json()) as ModelOAuthStatusResponse).status).toBe("done");
    expect(exchange.calls).toHaveLength(1);

    // The key is the machine's, not the hub's.
    const own = await machine.app.request(`/api/projects/${PROJECT}/models`, {
      headers: { cookie: cliCookie(machine) },
    });
    expect(((await own.json()) as ModelsResponse).providers.tokendance?.apiKeyMasked).toBeDefined();
    const hubs = await hub.app.request(`/api/projects/${PROJECT}/models`, {
      headers: { cookie: hubCookie },
    });
    expect(((await hubs.json()) as ModelsResponse).providers.tokendance?.apiKeyMasked).toBe(
      undefined,
    );
  });

  it("exempts exactly the callback: its neighbours through the proxy still need a session", async () => {
    const target = connect();
    expect((await onHub(viaHub(`/api/projects/${PROJECT}/models`))).status).toBe(401);
    expect((await onHub(viaHub(`/api/projects/${PROJECT}/model-oauth/callback/x`))).status).toBe(
      401,
    );
    expect(
      (
        await onHub(viaHub(`/api/projects/${PROJECT}/model-oauth/callback?flow=f&code=c`), {
          method: "POST",
        })
      ).status,
    ).not.toBe(200);
    // Refused at the hub, with no dial.
    const head = await onHub(
      viaHub(`/api/projects/${PROJECT}/model-oauth/callback?flow=f&code=c`),
      {
        method: "HEAD",
      },
    );
    expect(head.status).toBe(405);
    expect(target).not.toHaveBeenCalled();
  });

  it("answers the callback as not connected when the hub holds no connection to the machine", async () => {
    vi.spyOn(hub.deps.machines, "proxyTarget").mockResolvedValue(null);
    const res = await onHub(viaHub(`/api/projects/${PROJECT}/model-oauth/callback?flow=f&code=c`));
    expect(res.status).toBe(503);
  });
});
