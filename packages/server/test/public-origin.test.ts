/**
 * The public origin and the origin check behind a trusted proxy, in the two deployments that
 * trust one.
 *
 * A desktop reached through the Penguin Remote relay: the relay terminates TLS and forwards to the
 * server over plain HTTP, keeping `Host` and setting `X-Forwarded-Proto: https`.
 * - A key authorization started there, over HTTP or over the API socket, sends the provider's
 *   redirect back to the https address the browser is on, and a pairing code names that address.
 * - A write from that origin passes, and so does one whose `Origin` a relay rewrote to `http://`
 *   (the request's own origin, the desktop's transition); a write from another origin, or one the
 *   browser marks as not same-origin, is refused.
 *
 * A server behind a TLS-terminating proxy takes the public origin alone: `http://` on the public
 * host is refused on a write and on the API socket's handshake, a forwarded header that is not
 * one value fails the check, `X-Forwarded-Host` has no say in it, and neither does a page the
 * browser marks as not same-origin.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import type { BrowserExtensionPairingResponse, ModelOAuthStartResponse } from "../src/api/types.js";
import { apiSocketPath } from "../src/socket/ref.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { createDesktopApp, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HOST = "u634.go.penguin.ooo";
const PUBLIC = `https://${HOST}`;
const PLAIN = `http://${HOST}`;
const START = "/api/projects/default_project/model-oauth/start";
/** A start request's body: a key authorization with TokenDance. */
const KEY = { provider: "tokendance" };

/** One app per deployment, signed in as the admin. */
function deployment(create: () => Promise<TestApp>) {
  const d = { t: undefined as unknown as TestApp, cookie: "" };
  beforeAll(async () => {
    d.t = await create();
    d.cookie = (await loginAdmin(d.t.app)).cookie;
  });
  afterAll(async () => {
    await d.t.cleanup();
  });
  return d;
}

/** A write as a proxy hands it to the server: plain HTTP, the public Host, the forwarded scheme. */
const relayed = (
  d: { t: TestApp; cookie: string },
  path: string,
  origin: string,
  body: unknown = {},
  headers: Record<string, string> = {},
) =>
  d.t.app.request(`http://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "x-forwarded-proto": "https",
      origin,
      cookie: d.cookie,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

const callbackOf = (started: ModelOAuthStartResponse) =>
  new URL(new URL(started.authorizeUrl).searchParams.get("callback_url") ?? "");

/**
 * Listens on loopback with the upgrade seam attached as index.ts attaches it, opens the API
 * socket with `headers`, and runs `use` on it; resolves to the status a refused handshake got.
 */
async function onSocket(
  t: TestApp,
  rule: { trustProxy: boolean; acceptOwnOrigin: boolean },
  headers: Record<string, string>,
  use: (ws: WebSocket) => Promise<void> = async () => undefined,
): Promise<"open" | number> {
  let port = 0;
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve(s);
    });
  });
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: t.deps.hmr,
    authService: t.deps.authService,
    ...rule,
    log: () => undefined,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
    headers: { host: HOST, "x-forwarded-proto": "https", ...headers },
  });
  // Aborting a socket the server refused ends in an error event too; it is not the outcome.
  ws.on("error", () => undefined);
  try {
    const outcome = await new Promise<"open" | number>((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      ws.once("error", () => resolve(0));
    });
    if (outcome === "open") await use(ws);
    return outcome;
  } finally {
    ws.terminate();
    (server as unknown as HttpServer).closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("a desktop behind the relay", () => {
  const d = deployment(() => createDesktopApp({ config: { trustProxy: true } }));

  it("redirects a key authorization back to the https address the browser is on", async () => {
    const res = await relayed(d, START, PUBLIC, KEY);
    expect(res.status).toBe(200);
    const started = (await res.json()) as ModelOAuthStartResponse;
    expect(started.mode).toBe("callback");
    expect(callbackOf(started).origin).toBe(PUBLIC);
    expect(callbackOf(started).pathname).toBe("/api/projects/default_project/model-oauth/callback");
  });

  it("names that address on a pairing code, whatever the request's Origin says", async () => {
    // Minted through the relay's rewrite: the Origin header names http, the browser is on https.
    const res = await relayed(d, "/api/builtin-browser/extension/pairings", PLAIN);
    expect(res.status).toBe(200);
    expect(((await res.json()) as BrowserExtensionPairingResponse).origin).toBe(PUBLIC);
  });

  it("takes a write whose Origin the relay rewrote to http, and refuses another origin's", async () => {
    const sameOrigin = { "sec-fetch-site": "same-origin" };
    expect((await relayed(d, START, PLAIN, KEY, sameOrigin)).status).toBe(200);
    const foreign = await relayed(d, START, "https://u635.go.penguin.ooo", KEY);
    expect(foreign.status).toBe(403);
    expect(await codeOf(foreign)).toBe("cross_origin_write");
    // A page on http:// of the public host sends the same Origin, but its browser says where
    // the request really came from.
    const plainPage = await relayed(d, START, PLAIN, KEY, { "sec-fetch-site": "cross-site" });
    expect(plainPage.status).toBe(403);
    expect(await codeOf(plainPage)).toBe("cross_origin_write");
  });

  it("addresses the API socket's calls to the https address the browser is on", async () => {
    const outcome = await onSocket(
      d.t,
      { trustProxy: true, acceptOwnOrigin: true },
      { origin: PUBLIC, cookie: d.cookie },
      async (ws) => {
        const answer = new Promise<{ status: number; body: unknown }>((resolve) =>
          ws.once("message", (data) => resolve(JSON.parse(data.toString()))),
        );
        ws.send(
          JSON.stringify({
            id: 1,
            call: { method: "POST", path: START, body: KEY },
          }),
        );
        const frame = await answer;
        expect(frame.status).toBe(200);
        expect(callbackOf(frame.body as ModelOAuthStartResponse).origin).toBe(PUBLIC);
      },
    );
    expect(outcome).toBe("open");
  });
});

describe("a server behind a trusted proxy", () => {
  const d = deployment(() => createTestApp({ config: { trustProxy: true } }));
  const server = { trustProxy: true, acceptOwnOrigin: false };

  it("takes the public origin, and refuses http:// on the public host even with no body", async () => {
    expect((await relayed(d, START, PUBLIC, KEY)).status).toBe(200);
    // A `no-cors` POST from a page an on-path attacker serves on http://: no preflight, and no
    // body for the content-type rule to judge.
    const plain = await d.t.app.request(`http://${HOST}${START}`, {
      method: "POST",
      headers: { host: HOST, "x-forwarded-proto": "https", origin: PLAIN, cookie: d.cookie },
    });
    expect(plain.status).toBe(403);
    expect(await codeOf(plain)).toBe("cross_origin_write");
  });

  it("refuses the API socket's handshake from http:// on the public host", async () => {
    expect(await onSocket(d.t, server, { origin: PUBLIC, cookie: d.cookie })).toBe("open");
    expect(await onSocket(d.t, server, { origin: PLAIN, cookie: d.cookie })).toBe(403);
  });

  it("refuses a forwarded header that is not one value, and lets no forwarded host pick the origin", async () => {
    for (const proto of ["https, http", "https,https", "ftp", ""]) {
      for (const origin of [PUBLIC, PLAIN]) {
        const res = await relayed(d, START, origin, KEY, { "x-forwarded-proto": proto });
        expect(res.status, `${proto} ${origin}`).toBe(403);
        expect(await codeOf(res)).toBe("cross_origin_write");
      }
    }
    const listed = await relayed(d, START, PUBLIC, KEY, { "x-forwarded-host": `${HOST}, inner` });
    expect(listed.status).toBe(403);
    // A proxy that keeps Host may pass the client's X-Forwarded-Host through: the check reads Host.
    const chosen = { "x-forwarded-host": "evil.test" };
    expect((await relayed(d, START, "https://evil.test", KEY, chosen)).status).toBe(403);
    expect((await relayed(d, START, PUBLIC, KEY, chosen)).status).toBe(200);
  });

  it("refuses what the browser marks as not same-origin, on a write and on the handshake", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const res = await relayed(d, START, PUBLIC, KEY, { "sec-fetch-site": site });
      expect(res.status, site).toBe(403);
    }
    const sameOrigin = { "sec-fetch-site": "same-origin" };
    expect((await relayed(d, START, PUBLIC, KEY, sameOrigin)).status).toBe(200);
    expect(
      await onSocket(d.t, server, {
        origin: PUBLIC,
        cookie: d.cookie,
        "sec-fetch-site": "cross-site",
      }),
    ).toBe(403);
  });
});
