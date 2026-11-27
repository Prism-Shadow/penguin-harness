/**
 * A request-time failure is the request's, never the process's. A throw out of an `upgrade`
 * listener, or out of a socket's frame handler or beat, is uncaught — Node emits those events
 * where nothing catches them — and it ended the server: a browser reconnecting while a swap had
 * the tree disposed took the process down with `no api 'Auth' on module 'IdentityModule'`, and
 * so did a single upgrade request whose target `new URL` cannot read. Each case runs over a real
 * listener with the runtime's listeners attached as index.ts attaches them, and each must be
 * answered while the listener goes on serving the next handshake.
 */
import { once } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "@prismshadow/penguin-library-auth";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { attachUpgradeSeam, platformUpgradeDeps } from "../src/hmr/upgrade-seam.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { apiSocketPath } from "../src/socket/ref.js";
import { serveApiSocket } from "../src/socket/serve.js";

let t: TestApp;
let port: number;
let server: ReturnType<typeof serve>;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await loginAdmin(t.app)).cookie;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
  const log = () => undefined;
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: t.deps.hmr,
    // The lookup the entry made per handshake: the tree of the moment, with no fallback.
    get authService() {
      return t.boot.tree.api<Auth>("IdentityModule", "Auth");
    },
    log,
  });
  attachUpgradeSeam(server as unknown as HttpServer, platformUpgradeDeps(t.deps.hmr, log));
});

afterAll(async () => {
  (server as unknown as HttpServer).closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.cleanup();
});

/** How one API socket handshake ends: open, or the status it was refused with. */
function handshake(): Promise<"open" | number> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
    headers: { host: `localhost:${port}`, cookie },
  });
  ws.on("error", () => undefined);
  return new Promise((resolve) => {
    ws.once("open", () => {
      resolve("open");
      ws.close();
    });
    ws.once("unexpected-response", (req, res) => {
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
  });
}

/** The status line one raw upgrade request for `target` is answered with. */
async function rawUpgrade(target: string): Promise<string> {
  const socket = net.connect(port, "127.0.0.1");
  await once(socket, "connect");
  let answer = "";
  socket.on("data", (chunk: Buffer) => (answer += chunk.toString("latin1")));
  socket.write(
    `GET ${target} HTTP/1.1\r\nHost: localhost:${port}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  );
  await once(socket, "close");
  return answer.split("\r\n")[0] ?? "";
}

describe("an upgrade the runtime cannot handle", () => {
  it("is refused with a 500 when its auth cannot be resolved, and the next handshake is served", async () => {
    expect(await handshake()).toBe("open");
    const reassembly = t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly");
    // What a swap does first: the running tree is disposed before its successor is built.
    (await t.deps.hmr.ensure()).api.business()!.dispose();
    expect(await handshake()).toBe(500);
    expect(await reassembly.reassemble()).toBe(true);
    expect(await handshake()).toBe("open");
  });

  it("is refused with a 400 when its target is not a URL, and the next handshake is served", async () => {
    expect(await rawUpgrade("http://[")).toBe("HTTP/1.1 400 Bad Request");
    expect(await handshake()).toBe("open");
  });
});

describe("an API socket whose login cannot be checked", () => {
  it("is closed as an internal error, not as a revocation, and the process goes on", async () => {
    let check = (): boolean => true;
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(wss, "listening");
    wss.on("connection", (ws) =>
      serveApiSocket(ws, {
        sessionIsLive: () => check(),
        fetch: async () => Response.json({ ok: true }),
        fetchStream: async () => Response.json({ ok: true }),
        origin: "http://localhost",
        log: () => undefined,
      }),
    );
    try {
      const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
      await once(client, "open");
      const answered = once(client, "message");
      client.send(JSON.stringify({ id: 1, call: { method: "GET", path: "/api/me" } }));
      expect(JSON.parse(String((await answered)[0]))).toMatchObject({ id: 1, status: 200 });
      // The check now throws, as a lookup in a disposed tree did.
      check = () => {
        throw new Error("no api 'Auth' on module 'IdentityModule'");
      };
      const closed = once(client, "close");
      client.send(JSON.stringify({ id: 2, call: { method: "GET", path: "/api/me" } }));
      expect((await closed)[0]).toBe(1011);
    } finally {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});
