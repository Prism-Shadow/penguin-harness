/**
 * The two windows in which a client meets no App to answer it, over a real listener.
 *
 * Before the App is built — the port is bound first, and on a fresh root the admin seed
 * re-assembles the App before it is — every path answers "starting": a request the 503 that asks
 * for a retry, a WebSocket handshake a close with 1013, and nothing reaches the platform. The
 * listener is wired as index.ts wires it: the fetch handler falls back to the starting response,
 * and the starting upgrade answer stands aside once the App's own listeners are attached.
 *
 * While a swap has the running tree disposed, the entry's auth answers with the node it resolved
 * last (hmr/live-node.ts): the handshake of a browser reconnecting in that window used to throw
 * `no api 'Auth' on module 'IdentityModule'` and end the process.
 */
import http from "node:http";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";
import { describe, expect, it } from "vitest";
import type { Auth } from "@prismshadow/penguin-library-auth";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { answerStartingUpgrades, startingResponse, TRY_AGAIN_LATER } from "../src/hmr/starting.js";
import { liveNode } from "../src/hmr/live-node.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { apiSocketPath } from "../src/socket/ref.js";

/** A listener over `fetch`, on an ephemeral port; `close` ends it and its connections. */
async function listen(
  fetch: (request: Request) => Response | Promise<Response>,
): Promise<{ server: HttpServer; port: number; close: () => Promise<void> }> {
  let port = 0;
  const node = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve(s);
    });
  });
  const server = node as unknown as HttpServer;
  return {
    server,
    port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * How one API socket ends: served (a call made on it was answered), closed by the server before
 * any answer, or refused at the handshake with a status.
 */
function handshake(
  port: number,
  cookie: string,
): Promise<"served" | { closed: number; reason: string } | { refused: number }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
    headers: { host: `localhost:${port}`, cookie },
  });
  ws.on("error", () => undefined);
  return new Promise((resolve) => {
    ws.once("open", () =>
      ws.send(JSON.stringify({ id: 1, call: { method: "GET", path: "/api/me" } })),
    );
    ws.once("message", () => {
      resolve("served");
      ws.close();
    });
    ws.once("close", (code, reason) => resolve({ closed: code, reason: reason.toString() }));
    ws.once("unexpected-response", (req, res) => {
      resolve({ refused: res.statusCode ?? 0 });
      req.destroy();
    });
  });
}

/** One GET as a browser on the App's canonical host sends it. */
function get(
  port: number,
  path: string,
  cookie: string,
): Promise<{ status: number; retryAfter: string | undefined }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, headers: { host: `localhost:${port}`, cookie } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, retryAfter: res.headers["retry-after"] as string });
      })
      .on("error", reject);
  });
}

/** The App's upgrade listener as buildApp attaches it, its auth resolved as the entry resolves it. */
function attachApp(server: HttpServer, t: TestApp): void {
  const auth = liveNode<Auth>(t.boot, "IdentityModule", "Auth");
  attachTerminalWebSocket(server, {
    hmr: t.deps.hmr,
    get authService() {
      return auth();
    },
    log: () => undefined,
  });
}

describe("a client that arrives before the App is built", () => {
  it("is told the server is starting on every path, and is served once the App is", async () => {
    const t = await createTestApp();
    const { cookie } = await loginAdmin(t.app);
    let app: TestApp["app"] | undefined;
    const { server, port, close } = await listen(
      (request) => app?.fetch(request) ?? startingResponse(),
    );
    answerStartingUpgrades(server, () => app !== undefined);
    try {
      expect(await get(port, "/api/me", cookie)).toEqual({ status: 503, retryAfter: "1" });
      expect(await handshake(port, cookie)).toEqual({
        closed: TRY_AGAIN_LATER,
        reason: "penguin-server is starting",
      });

      app = t.app;
      attachApp(server, t);
      expect((await get(port, "/api/me", cookie)).status).toBe(200);
      expect(await handshake(port, cookie)).toBe("served");
    } finally {
      await close();
      await t.cleanup();
    }
  });
});

describe("a handshake while a swap has the running tree disposed", () => {
  it("is authenticated by the auth resolved last, and the process goes on", async () => {
    const t = await createTestApp();
    const { cookie } = await loginAdmin(t.app);
    const { server, port, close } = await listen(t.app.fetch);
    attachApp(server, t);
    try {
      expect(await handshake(port, cookie)).toBe("served");
      const reassembly = t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly");
      // What a swap does first: the running tree is disposed before its successor is built.
      (await t.deps.hmr.ensure()).api.business()!.dispose();
      expect(() => t.boot.tree.api("IdentityModule", "Auth")).toThrow(
        "no api 'Auth' on module 'IdentityModule'",
      );

      expect(await handshake(port, cookie)).toBe("served");
      expect(await handshake(port, "penguin_session=forged")).toEqual({ refused: 401 });

      expect(await reassembly.reassemble()).toBe(true);
      expect(await handshake(port, cookie)).toBe("served");
    } finally {
      await close();
      await t.cleanup();
    }
  });
});
