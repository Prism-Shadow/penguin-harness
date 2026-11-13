/**
 * The API socket across the two kinds of swap. A re-assembly (a plugin change) replaces the
 * inner App under the platform shell: the socket is the shell's, its calls resolve the App
 * of the moment, so it stays open and its next call enters the new App. A push replaces the
 * shell itself: the sockets are handed to the successor as one registry handle, which
 * closes them (1012) once it is up, and the browser's client comes back to it. Left open
 * across a push, a socket kept dispatching into the replaced shell — local routes still
 * answered, every call through a machine hung without a word. The successor holds the
 * previous shell's sockets for a grace window before that close: a call landing inside it
 * meets a disposed App and answers the shell's 503 (PRFC-0011 §Upgrades).
 */
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { Hono } from "hono";
import type { Reassembly } from "../src/hmr/capabilities.js";
import type { AppEnv } from "../src/auth/middleware.js";
import type { ApiSocketRef } from "../src/socket/ref.js";
import { createTestApp, loginAdmin, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The little of `ws` the socket protocol touches, with the frames and the close recorded. */
function fakeSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    closed: null as { code: number; reason: string } | null,
    sent: [] as Record<string, unknown>[],
    on(event: string, fn: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return socket;
    },
    once(event: string, fn: (...args: unknown[]) => void) {
      return socket.on(event, fn);
    },
    send(data: string) {
      socket.sent.push(JSON.parse(data) as Record<string, unknown>);
    },
    ping() {},
    terminate() {},
    close(code: number, reason: string) {
      socket.closed = { code, reason };
      socket.readyState = 3;
      for (const fn of handlers.get("close") ?? []) fn(code, reason);
    },
    /** The browser's frame, as the server's `message` listener receives it. */
    call(id: number, path: string) {
      const data = Buffer.from(JSON.stringify({ id, call: { method: "GET", path } }));
      for (const fn of handlers.get("message") ?? []) fn(data, false);
    },
    /** A stream call's frame: the one header of the client's own that marks it (CALL_HEADERS). */
    callStream(id: number, path: string) {
      const data = Buffer.from(
        JSON.stringify({
          id,
          call: { method: "GET", path, headers: { accept: "text/event-stream" } },
        }),
      );
      for (const fn of handlers.get("message") ?? []) fn(data, false);
    },
  };
  return socket;
}

const REF: ApiSocketRef = { apiSocket: true, ownerUserId: "admin" };
const URL_ = new URL("http://localhost:7364/api/socket");

const MINIMAL_CLI = "export async function cli(argv) { return 0; }\n";
const MINIMAL_WEB = { "index.html": Buffer.from("<html>host</html>").toString("base64") };

/** The push a test makes: the same three-artifact bundle a real one carries. */
async function pushPlatform(app: Hono<AppEnv>, cookie: string, platform: string) {
  const gz = zlib.gzipSync(
    Buffer.from(JSON.stringify({ platform, cli: MINIMAL_CLI, web: { files: MINIMAL_WEB } })),
  );
  return app.request("/api/hmr/upgrade", {
    method: "POST",
    headers: { cookie, "content-type": "application/gzip" },
    body: gz,
  });
}

/**
 * A successor platform in the real shell's shape at the one seam this file is about: its
 * create claims the previous shell's socket handle — and holds it, unclosed, so the grace
 * window a real successor closes with 1012 only after RECONNECT_GRACE_MS stays open for
 * the whole test. The upgrade channel every generation must carry is served.
 */
function platformHoldingSockets(id: string): string {
  return `
const anySchema = {
  strictParse: (doc) => ({ ok: true, value: doc === undefined ? {} : doc }),
  describe: () => ({ kind: "any" }),
};
const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park", "info"],
  children: {},
  migrations: {},
};
const impl = {
  create(ctx, context) {
    const previous = ctx.resources.claim("apiSockets:open");
    return {
      park: () => context,
      info: () => ({ impl: ${JSON.stringify(id)}, holdsPreviousSockets: previous !== undefined }),
      http(request) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith("/api/hmr/")) return ctx.resources.claim("platform.hmrControl").endpoint(request);
        return null;
      },
    };
  },
};
export const hotPlatform = { id: ${JSON.stringify(id)}, iface, impl, context: {} };
`;
}

describe("the API socket across a swap", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("stays open through a re-assembly, and its next call enters the re-assembled App", async () => {
    t = await createTestApp();
    const platform = await t.deps.hmr.ensure();
    const ws = fakeSocket();
    platform.api.attachStream(ws as unknown as WebSocket, REF, URL_, () => undefined);
    ws.call(1, "/api/projects");
    await waitFor(() => ws.sent.some((f) => f.id === 1));
    expect(ws.sent.find((f) => f.id === 1)?.status).toBe(200);

    const before = platform.api.business();
    const ok = await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble();
    expect(ok).toBe(true);
    expect(platform.api.business()).not.toBe(before);
    expect(ws.closed).toBeNull();
    ws.call(2, "/api/projects");
    await waitFor(() => ws.sent.some((f) => f.id === 2));
    expect(ws.sent.find((f) => f.id === 2)?.status).toBe(200);
  });

  it("is handed to the successor as a registry handle that closes it with 1012", async () => {
    t = await createTestApp();
    const platform = await t.deps.hmr.ensure();
    const ws = fakeSocket();
    platform.api.attachStream(ws as unknown as WebSocket, REF, URL_, () => undefined);
    const handle = t.deps.hmr.resources.claim<{ close(): void }>("apiSockets:open");
    expect(handle).toBeDefined();
    handle!.close();
    expect(ws.closed).toEqual({ code: 1012, reason: "the harness was updated; reconnect" });
    // A closed socket is off the shell's list: closing again touches nothing.
    handle!.close();
  });

  it("answers a one-shot call in the grace window with 503 unavailable, not 500 internal", async () => {
    t = await createTestApp();
    const platform = await t.deps.hmr.ensure();
    const ws = fakeSocket();
    platform.api.attachStream(ws as unknown as WebSocket, REF, URL_, () => undefined);
    // No push, same socket and path: the App's own answer, so the 503 below is the
    // replaced-shell state's, never the idle one.
    ws.call(1, "/api/projects");
    await waitFor(() => ws.sent.some((f) => f.id === 1));
    expect(ws.sent.find((f) => f.id === 1)?.status).toBe(200);

    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushPlatform(t.app, cookie, platformHoldingSockets("grace"))).status).toBe(200);

    // The window: the push disposed this shell's App (business() answers, the module table
    // is empty, the http lookup throws) and the successor holds the sockets unclosed — the
    // call answers the shell's own "being replaced" (PRFC-0011 §Upgrades), not the 500 the
    // transport answers an internal error with.
    expect(ws.closed).toBeNull();
    ws.call(2, "/api/projects");
    await waitFor(() => ws.sent.some((f) => f.id === 2));
    const grace = ws.sent.find((f) => f.id === 2);
    expect(grace?.status).toBe(503);
    expect(grace?.body).toEqual({
      error: { code: "unavailable", message: "The App is being replaced." },
    });
  });

  it("answers a stream call in that window with the same 503 frame, for the client to re-issue", async () => {
    t = await createTestApp();
    const platform = await t.deps.hmr.ensure();
    const ws = fakeSocket();
    platform.api.attachStream(ws as unknown as WebSocket, REF, URL_, () => undefined);
    const cookie = (await loginAdmin(t.app)).cookie;
    expect((await pushPlatform(t.app, cookie, platformHoldingSockets("grace-stream"))).status).toBe(
      200,
    );

    // A stream call (accept: text/event-stream) rides fetchStream into the same entry, so
    // the window answers it as a frame like any call's — never a stream that cannot start.
    // The client treats 503 as retryable (its fatal set is 401/403/404) and re-issues the
    // stream on its own backoff carrying last-event-id, which lands on the successor after
    // the 1012 close: the reconnect path PRFC-0011 names, entered through the 503.
    expect(ws.closed).toBeNull();
    ws.callStream(3, "/api/events");
    await waitFor(() => ws.sent.some((f) => f.id === 3));
    const grace = ws.sent.find((f) => f.id === 3);
    expect(grace?.stream).toBeUndefined();
    expect(grace?.status).toBe(503);
    expect(grace?.body).toEqual({
      error: { code: "unavailable", message: "The App is being replaced." },
    });
  });
});
