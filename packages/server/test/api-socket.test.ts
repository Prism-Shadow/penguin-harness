/**
 * The API socket transport (socket/ws.ts), over a real listening server — an Upgrade is
 * nothing app.request() can exercise. What is pinned: the handshake's gate (cookie, Bearer,
 * origin), that a call answers exactly as its HTTP twin, which paths never ride the socket,
 * that a stream endpoint arrives as frames and a cancel releases it, and that a malformed
 * frame closes the socket rather than being guessed at.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { Server as HttpServer } from "node:http";
import { WebSocket } from "ws";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { attachApiSocket } from "../src/socket/ws.js";
import { readApiToken } from "../src/auth/api-token.js";

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
  attachApiSocket(server as unknown as HttpServer, {
    fetch: async (request) => t.app.fetch(request),
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
async function open(headers: Record<string, string>): Promise<
  | {
      ws: WebSocket;
      next: () => Promise<Frame>;
      closed: () => Promise<{ code: number; reason: string }>;
    }
  | { refused: number }
> {
  // Canonical App host, as a browser targets it: 127.0.0.1 is the preview host, where /api
  // answers 401 over HTTP and therefore over the socket too.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/socket`, {
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

  it("accepts the local API token as Bearer", async () => {
    const token = readApiToken(t.root);
    expect(token).not.toBeNull();
    const s = await open({ authorization: `Bearer ${token}` });
    expect("ws" in s).toBe(true);
    if ("ws" in s) s.ws.close();
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

  it("re-authenticates every call: an expired session answers 401, not a dead socket", async () => {
    const other = await loginAdmin(t.app);
    const s = await open({ cookie: other.cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    await t.app.request("/api/auth/logout", { method: "POST", headers: { cookie: other.cookie } });
    send(s.ws, { id: 2, call: { method: "GET", path: "/api/me" } });
    expect((await s.next()).status).toBe(401);
    s.ws.close();
  });

  it("never carries the rescue channel or itself", async () => {
    const s = await open({ cookie });
    if (!("ws" in s)) throw new Error("handshake refused");
    send(s.ws, { id: 1, call: { method: "GET", path: "/api/hmr/status" } });
    expect((await s.next()).status).toBe(404);
    send(s.ws, { id: 2, call: { method: "GET", path: "/api/socket" } });
    expect((await s.next()).status).toBe(404);
    send(s.ws, { id: 3, call: { method: "GET", path: "/penguin-logo.svg" } });
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
