/**
 * A machine's Session stream, live, through this server, with nothing scripted on the way: the
 * browser's API socket asks this server for `/server/<machineId>/api/sessions/<id>/stream`, the
 * proxy relays it over the API socket this server holds to the machine, and the machine is a
 * real server whose runtime's upgrade seam is attached as index.ts attaches it. A record the
 * machine publishes on the Session's channel after the stream opened reaches the browser as a
 * frame of that stream.
 *
 * The same machine App behind a runtime whose upgrade listener predates `/api/socket` (what a hot
 * hand-over leaves running: a push replaces the platform, never the runtime that listens) answers
 * every HTTP request, while the socket the relay dials is never answered: the stream is refused
 * with the dial's reason and nothing of the Session reaches the browser.
 */
import http from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { ApiSocketRef } from "../src/socket/ref.js";
import { MachineSockets } from "../src/machines/machine-sockets.js";
import { machinesProxy } from "../src/machines/proxy.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { fakeMachinesNode } from "./fixtures/machines.js";
import { sessionRow } from "./fixtures/session.js";
import { createTestApp, loginAdmin, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const MACHINE = "QS7J4YVgSovi-Z2c";
const SID = "session-2026-10-26-09-00-00-00000001";
const ADMIN: ApiSocketRef = { apiSocket: true, ownerUserId: "admin" };

type Frame = Record<string, unknown>;

/** The browser's end of this server's API socket: its call frames in, every frame out recorded. */
function browserSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const sent: Frame[] = [];
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return socket;
    },
    once(event: string, fn: (...args: unknown[]) => void) {
      return socket.on(event, fn);
    },
    send(data: string) {
      sent.push(JSON.parse(data) as Frame);
    },
    ping() {},
    terminate() {},
    close() {
      socket.readyState = 3;
      for (const fn of handlers.get("close") ?? []) fn(1000, "");
    },
    /** A stream call, as api/socket.ts issues one. */
    stream(id: number, path: string) {
      const frame = { id, call: { method: "GET", path, headers: { accept: "text/event-stream" } } };
      for (const fn of handlers.get("message") ?? []) fn(Buffer.from(JSON.stringify(frame)), false);
    },
    framesOf: (id: number) => sent.filter((f) => f.id === id),
  };
  return socket;
}

let machine: TestApp;
let hub: TestApp;
let server: ReturnType<typeof serve>;
/** The same machine App behind a runtime from before `/api/socket`. */
let oldRuntime: ReturnType<typeof serve>;
let oldPort = 0;
let cookie = "";
/** Every connection the machine accepted, upgraded ones included: closeAllConnections skips those. */
const connections = new Set<Socket>();

/** Serves the machine App on a port of its own. */
function listen(app: TestApp): Promise<{ server: ReturnType<typeof serve>; port: number }> {
  return new Promise((resolve) => {
    const served = serve({ fetch: app.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve({ server: served, port: info.port }),
    );
    served.on("connection", (socket: Socket) => connections.add(socket));
  });
}

beforeAll(async () => {
  machine = await createTestApp();
  cookie = (await loginAdmin(machine.app)).cookie;
  machine.deps.sessionsRepo.insert(sessionRow(SID));
  const current = await listen(machine);
  server = current.server;
  const port = current.port;
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: machine.deps.hmr,
    authService: machine.deps.authService,
    log: () => undefined,
  });
  // The upgrade listener of 0.2.16's runtime: a terminal stream is its, and any other upgrade
  // is left alone — with a listener attached, node hands the socket over and nobody answers.
  const old = await listen(machine);
  oldRuntime = old.server;
  oldPort = old.port;
  oldRuntime.on("upgrade", (req: http.IncomingMessage, socket: Socket) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (/^\/api\/terminals\/[^/]+\/stream$/.test(pathname)) socket.destroy();
  });
  hub = await createTestApp({
    machines: fakeMachinesNode(
      () => [],
      (machineId) =>
        machineId === MACHINE
          ? { agent: new http.Agent(), port, cookie, adoptedAt: null, session: 1 }
          : null,
    ),
  });
});

afterAll(async () => {
  await hub?.cleanup();
  for (const socket of connections) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => oldRuntime.close(() => resolve()));
  await machine?.cleanup();
});

describe("a machine's Session stream", () => {
  it("carries a record the machine publishes after the stream opened to the browser's socket", async () => {
    const platform = await hub.deps.hmr.ensure();
    const ws = browserSocket();
    platform.api.attachStream(
      ws as unknown as WebSocket,
      ADMIN,
      new URL("http://localhost:7364/api/socket"),
      () => undefined,
    );
    try {
      ws.stream(1, `/server/${MACHINE}/api/sessions/${SID}/stream`);
      await waitFor(() => ws.framesOf(1).some((f) => f.event === "ping"), 5000);
      expect(ws.framesOf(1)[0]).toMatchObject({ status: 200, stream: true });

      const record = { role: "assistant", payload: { type: "text", text: "live" } };
      machine.deps.channels.get(SID).publish(record);
      await waitFor(() => ws.framesOf(1).some((f) => f.event === "message"), 5000);
      const live = ws.framesOf(1).find((f) => f.event === "message")!;
      expect(JSON.parse(live.data as string)).toEqual(record);
      expect(live.eventId).toEqual(expect.any(String));
    } finally {
      ws.close();
    }
  });

  it("is refused for a machine whose runtime predates the API socket, while its HTTP answers", async () => {
    const sockets = new MachineSockets(() => undefined, { dialTimeoutMs: 300 });
    const proxy = machinesProxy(
      async () => ({ agent: new http.Agent(), port: oldPort, cookie, adoptedAt: null, session: 1 }),
      undefined,
      () => undefined,
      { sockets },
    );
    try {
      const history = await proxy(
        new Request(`http://localhost/server/${MACHINE}/api/sessions/${SID}/messages`),
      );
      expect(history!.status).toBe(200);

      const stream = await proxy(
        new Request(`http://localhost/server/${MACHINE}/api/sessions/${SID}/stream`, {
          headers: { accept: "text/event-stream" },
        }),
      );
      expect(stream!.status).toBe(502);
      expect(await stream!.json()).toMatchObject({
        error: { code: "machine_socket_unavailable" },
      });
      expect(sockets.fact(MACHINE)).toMatchObject({ state: "failed" });
    } finally {
      sockets.close();
    }
  });
});
