/**
 * Which API sockets compress their frames (socket/compression.ts), over real handshakes.
 *
 * - Given this server dialling a machine, the dial offers permessage-deflate and a server that
 *   takes it negotiates it.
 * - Given a handshake with no Origin (another server) or from a browser on another computer,
 *   the runtime's upgrade answers with permessage-deflate.
 * - Given a handshake from a browser on this computer (a loopback Origin), it answers without.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import { MachineSocket } from "../src/machines/machine-sockets.js";
import { API_SOCKET_DEFLATE } from "../src/socket/compression.js";
import { apiSocketPath } from "../src/socket/ref.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

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
  attachTerminalWebSocket(server as unknown as http.Server, {
    hmr: t.deps.hmr,
    authService: t.deps.authService,
    log: () => undefined,
  });
});

afterAll(async () => {
  (server as unknown as http.Server).closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.cleanup();
});

/** The extensions a handshake with these headers negotiated (the client offers deflate). */
async function negotiated(host: string, origin?: string): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
    headers: { host, cookie, ...(origin !== undefined ? { origin } : {}) },
    perMessageDeflate: API_SOCKET_DEFLATE,
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("unexpected-response", (_req, res) => reject(new Error(`refused ${res.statusCode}`)));
    ws.once("error", reject);
  });
  const extensions = ws.extensions;
  ws.close();
  return extensions;
}

describe("API socket compression", () => {
  it("this server's dial to a machine negotiates permessage-deflate", async () => {
    const machine = new WebSocketServer({ port: 0, perMessageDeflate: API_SOCKET_DEFLATE });
    const accepted = new Promise<string>((resolve) =>
      machine.on("connection", (ws) => resolve(ws.extensions)),
    );
    await new Promise<void>((resolve) => machine.once("listening", () => resolve()));
    const agent = new http.Agent();
    const socket = await MachineSocket.open(
      { agent, port: (machine.address() as AddressInfo).port, cookie: "c=1", session: 1 },
      5_000,
    );
    expect(await accepted).toContain("permessage-deflate");
    socket.terminate();
    agent.destroy();
    await new Promise<void>((resolve) => machine.close(() => resolve()));
  });

  it("a handshake from another server or a browser on another computer is compressed", async () => {
    expect(await negotiated(`localhost:${port}`)).toContain("permessage-deflate");
    expect(await negotiated(`192.168.1.5:${port}`, `http://192.168.1.5:${port}`)).toContain(
      "permessage-deflate",
    );
  });

  it("a handshake from a browser on this computer is not", async () => {
    expect(await negotiated(`localhost:${port}`, `http://localhost:${port}`)).toBe("");
  });
});
