/**
 * The API socket (socket/serve.ts), over a real listening server — an Upgrade is nothing
 * app.request() can exercise. It arrives through the runtime's terminal-stream seam under
 * its reserved id (socket/ref.ts), so the seam is attached exactly as index.ts attaches it.
 * What is pinned: the handshake's gate (cookie, origin, the id's owner), that a call answers
 * exactly as its HTTP twin, which paths never ride the socket, that a stream endpoint arrives
 * as frames and a cancel releases it, and that a malformed frame closes the socket rather
 * than being guessed at.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { apiSocketPath } from "../src/socket/ref.js";

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
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: t.deps.hmr,
    authService: t.deps.authService,
    log: () => undefined,
  });
});

afterAll(async () => {
  (server as unknown as HttpServer).closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.cleanup();
});

type Frame = Record<string, unknown>;

/** An open socket with a frame queue, or the HTTP status the handshake was refused with. */
async function open(
  headers: Record<string, string>,
  path: string = apiSocketPath("admin"),
): Promise<
  | {
      ws: WebSocket;
      next: () => Promise<Frame>;
      closed: () => Promise<{ code: number; reason: string }>;
    }
  | { refused: number }
> {
  // Canonical App host, as a browser targets it: 127.0.0.1 is the preview host, where /api
  // answers 401 over HTTP and therefore over the socket too.
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: { host: `localhost:${port}`, ...headers },
  });
  const queue: Frame[] = [];
  const waiters: ((f: Frame) => void)[] = [];
  let closedWith: { code: number; reason: string } | null = null;
  const closeWaiters: ((c: { code: number; reason: string }) => void)[] = [];
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as Frame;
    const w = waiters.shift();
    if (w) w(frame);
    else queue.push(frame);
  });
  ws.on("close", (code, reason) => {
    closedWith = { code, reason: reason.toString() };
    for (const w of closeWaiters.splice(0)) w(closedWith);
  });
  const outcome = await new Promise<"open" | number>((resolve) => {
    ws.once("open", () => resolve("open"));
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    ws.once("error", () => resolve(0));
  });
  if (outcome !== "open") return { refused: outcome };
  return {
    ws,
    next: () =>
      new Promise<Frame>((resolve, reject) => {
        const q = queue.shift();
        if (q) return resolve(q);
        const timer = setTimeout(() => reject(new Error("no frame within 5s")), 5000);
        waiters.push((f) => {
          clearTimeout(timer);
          resolve(f);
        });
      }),
    closed: () =>
      new Promise((resolve) => {
        if (closedWith) return resolve(closedWith);
        closeWaiters.push(resolve);
      }),
  };
}

const send = (ws: WebSocket, frame: Frame) => ws.send(JSON.stringify(frame));

describe("handshake", () => {
  it("refuses without a credential", async () => {
    expect(await open({})).toEqual({ refused: 401 });
  });

  it("refuses a page from another origin even with the cookie", async () => {
    expect(await open({ cookie, origin: "http://evil.example" })).toEqual({ refused: 403 });
  });

  it("accepts the session cookie from the page's own origin", async () => {
    const s = await open({ cookie, origin: `http://localhost:${port}` });
    expect("ws" in s).toBe(true);
    if ("ws" in s) s.ws.close();
  });

  it("holds the reserved id's owner to the signed-in user", async () => {
    // The runtime's owner check: admin's cookie cannot open someone else's socket.
    expect(await open({ cookie }, apiSocketPath("someone-else"))).toEqual({ refused: 404 });
    // And an id that is not the reserved form names no terminal either.
    expect(await open({ cookie }, "/api/terminals/api-socket/stream")).toEqual({ refused: 404 });
  });
});

describe("calls", () => {
  it("answers a call exactly as HTTP answers the same request", async () => {
    const viaHttp = await t.app.request("/api/me", { headers: { cookie } });
    const expected = await viaHttp.json();
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 1, call: { method: "GET", path: "/api/me" } });
    const frame = await s.next();
    expect(frame.id).toBe(1);
    expect(frame.status).toBe(200);
    expect(frame.body).toEqual(expected);
    expect(typeof (frame.headers as Record<string, string>).date).toBe("string");
    s.ws.close();
  });

  it("carries the endpoint's own error shape", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 5, call: { method: "GET", path: "/api/projects/nope/agents" } });
    const frame = await s.next();
    expect(frame.status).toBe(404);
    expect((frame.body as { error: { code: string } }).error.code).toBeTypeOf("string");
    s.ws.close();
  });

  it("answers runtime-owned paths 421 — those are made over HTTP — and non-API paths 404", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 1, call: { method: "GET", path: "/api/hmr/status" } });
    const hmr = await s.next();
    expect(hmr.status).toBe(421);
    expect((hmr.body as { error: { code: string } }).error.code).toBe("not_on_socket");
    send(s.ws, { id: 2, call: { method: "POST", path: "/api/auth/logout", body: {} } });
    expect((await s.next()).status).toBe(421);
    send(s.ws, { id: 3, call: { method: "GET", path: apiSocketPath("admin") } });
    expect((await s.next()).status).toBe(404);
    send(s.ws, { id: 4, call: { method: "GET", path: "/penguin-logo.svg" } });
    expect((await s.next()).status).toBe(404);
    s.ws.close();
  });

  it("closes on a malformed frame rather than guessing", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    s.ws.send("not json");
    expect((await s.closed()).code).toBe(1002);
  });

  it("closes on a reused id", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 1, call: { method: "GET", path: "/api/events" } });
    expect((await s.next()).stream).toBe(true);
    send(s.ws, { id: 1, call: { method: "GET", path: "/api/me" } });
    expect((await s.closed()).code).toBe(1002);
  });
});

describe("streams", () => {
  it("frames a text/event-stream endpoint per event and ends on cancel", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 7, call: { method: "GET", path: "/api/events" } });
    const start = await s.next();
    expect(start).toMatchObject({ id: 7, status: 200, stream: true });
    const hello = await s.next();
    expect(hello).toMatchObject({ id: 7, event: "server_event" });
    expect(JSON.parse(hello.data as string)).toEqual({ type: "hello" });
    expect(typeof hello.eventId).toBe("string");
    // Cancel releases the subscription silently; a fresh call on the same socket works.
    send(s.ws, { id: 7, cancel: true });
    send(s.ws, { id: 8, call: { method: "GET", path: "/api/events" } });
    expect(await s.next()).toMatchObject({ id: 8, stream: true });
    s.ws.close();
  });

  it("passes last-event-id through so the endpoint replays or asks to resync", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, {
      id: 1,
      call: { method: "GET", path: "/api/events", headers: { "last-event-id": "0-999999" } },
    });
    expect(await s.next()).toMatchObject({ id: 1, stream: true });
    const first = await s.next();
    expect(first.event).toBe("server_event");
    expect(JSON.parse(first.data as string).type).toBe("resync_required");
    s.ws.close();
  });
});
