/**
 * The public origin behind a trusted proxy, as a desktop reached through the Penguin Remote relay
 * sees it: the relay terminates TLS and forwards to the server over plain HTTP, keeping `Host` and
 * setting `X-Forwarded-Proto: https`.
 *
 * - A key authorization started there, over HTTP or over the API socket, sends the provider's
 *   redirect back to the https address the browser is on, and a pairing code names that address.
 * - A write from that origin passes, and so does one whose `Origin` a relay rewrote to `http://`
 *   (the request's own origin); a write from another origin is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import type { BrowserExtensionPairingResponse, ModelOAuthStartResponse } from "../src/api/types.js";
import { apiSocketPath } from "../src/socket/ref.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const HOST = "u634.go.penguin.ooo";
const PUBLIC = `https://${HOST}`;
const START = "/api/projects/default_project/model-oauth/start";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp({ config: { trustProxy: true } });
  cookie = (await loginAdmin(t.app)).cookie;
});
afterAll(async () => {
  await t.cleanup();
});

/** A write as the relay hands it to the server: plain HTTP, the public Host, the forwarded scheme. */
const relayed = (path: string, origin: string, body: unknown = {}) =>
  t.app.request(`http://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "x-forwarded-proto": "https",
      origin,
      cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

const callbackOf = (started: ModelOAuthStartResponse) =>
  new URL(new URL(started.authorizeUrl).searchParams.get("callback_url") ?? "");

describe("behind the relay", () => {
  it("redirects a key authorization back to the https address the browser is on", async () => {
    const res = await relayed(START, PUBLIC, { provider: "tokendance" });
    expect(res.status).toBe(200);
    const started = (await res.json()) as ModelOAuthStartResponse;
    expect(started.mode).toBe("callback");
    expect(callbackOf(started).origin).toBe(PUBLIC);
    expect(callbackOf(started).pathname).toBe("/api/projects/default_project/model-oauth/callback");
  });

  it("names that address on a pairing code, whatever the request's Origin says", async () => {
    // Minted through the relay's rewrite: the Origin header names http, the browser is on https.
    const res = await relayed("/api/builtin-browser/extension/pairings", `http://${HOST}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as BrowserExtensionPairingResponse).origin).toBe(PUBLIC);
  });

  it("takes a write whose Origin the relay rewrote to http, and refuses another origin's", async () => {
    expect((await relayed(START, `http://${HOST}`, { provider: "tokendance" })).status).toBe(200);
    const foreign = await relayed(START, "https://u635.go.penguin.ooo", { provider: "tokendance" });
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_write",
    );
  });

  it("addresses the API socket's calls to the https address the browser is on", async () => {
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
      trustProxy: true,
      log: () => undefined,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
      headers: { host: HOST, "x-forwarded-proto": "https", origin: PUBLIC, cookie },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("unexpected-response", (_req, res) => reject(new Error(`${res.statusCode}`)));
        ws.once("error", reject);
      });
      const answer = new Promise<{ status: number; body: unknown }>((resolve) =>
        ws.once("message", (data) => resolve(JSON.parse(data.toString()))),
      );
      ws.send(
        JSON.stringify({
          id: 1,
          call: { method: "POST", path: START, body: { provider: "tokendance" } },
        }),
      );
      const frame = await answer;
      expect(frame.status).toBe(200);
      expect(callbackOf(frame.body as ModelOAuthStartResponse).origin).toBe(PUBLIC);
    } finally {
      ws.close();
      (server as unknown as HttpServer).closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
