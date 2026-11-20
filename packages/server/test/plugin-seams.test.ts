/**
 * The server seams a code plugin reaches the host through, exercised by a plugin module booted
 * into the real platform tree (the way the loader adds one): route groups — some built with a
 * second copy of Hono, as a bundled plugin builds them — own-origin groups, WebSocket endpoints
 * and an owned ui_prefs key, all contributed by one module.
 *
 * HttpError across copies:
 * - Given a route that throws an HttpError from its own copy of the errors module, the caller
 *   gets that status, code, message and details — with Retry-After when it carries one — and the
 *   error log records it as expected under its code.
 * - The same holds for a group built with the plugin's own copy of Hono that set no error
 *   handler of its own; one that did set a handler answers with it.
 * - Given an error that only calls itself HttpError (no brand), the caller gets 500 `internal`.
 *
 * Own-origin route groups:
 * - Given a group declaring `origin: "own"` — with a `:param` in its prefix too — a cross-origin
 *   write it answers reaches its handler.
 * - A cross-origin write under its prefix that it does not answer (another method) is refused
 *   403 `cross_origin_write`, as is one to a group mounted below its prefix and to any other group.
 *
 * Owned ui_prefs keys:
 * - Given a key a module owns, a prefs write naming it is refused 400 with the module's message,
 *   and nothing of that write is stored; a write without it merges as before.
 *
 * WebSocket endpoints (the runtime's upgrade seam on a real listener):
 * - An `auth: "none"` endpoint is handed an upgrade under its prefix (a `:param` prefix
 *   included) as it came, whatever its Origin, with no caller.
 * - An `auth: "user"` endpoint is handed only a signed-in, same-origin handshake, with the user:
 *   no session cookie is 401, a foreign Origin or a cross-site `Sec-Fetch-Site` is 403.
 * - An upgrade no endpoint covers is not taken by one: the seam's fallback gets it. So is one to
 *   an endpoint whose prefix has a pattern only Hono could read (it is not served).
 * - The runtime's own upgrade paths are never offered to the generation, even under a prefix an
 *   endpoint declares.
 * - Wired as the runtime wires it, the seam follows the current generation: after a
 *   re-assembly the old generation's socket is closed 1012 and a new one reaches the successor.
 */
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import WebSocket, { WebSocketServer } from "ws";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { Reassembly } from "../src/hmr/capabilities.js";
import { PluginHost } from "../src/plugin/host.js";
import { HttpError } from "../src/http/errors.js";
import type { UpgradeCaller } from "../src/http/upgrade-endpoints.js";
import { attachUpgradeSeam, platformUpgradeDeps } from "../src/hmr/upgrade-seam.js";
import type { UpgradeSeamDeps, UpgradeSurface } from "../src/hmr/upgrade-seam.js";
import { isRuntimeUpgradePath } from "../src/terminal/ws.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { foreignHono } from "./helpers/foreign-hono.js";

/**
 * The errors module as a plugin bundles it: a second copy, its classes distinct from the host's.
 * The query makes it another module instance; held in a variable so the compiler, which knows no
 * such path, does not resolve it.
 */
const copySpecifier = "../src/http/errors.js?plugin-copy";
const copy = (await import(copySpecifier)) as typeof import("../src/http/errors.js");

const FOREIGN = "https://elsewhere.example";
const ACME_PREF_MESSAGE = "acmeChoice is set by PUT /api/acme/choice, not the prefs.";

/** What the plugin's WebSocket endpoints were handed: path, and the user it came with. */
const upgraded: { path: string; userId: string | null }[] = [];
/** Which App the plugin module was created in, counted from 1. */
let generation = 0;

function seamsPlugin(ForeignHono: typeof Hono): ModuleDef {
  const manifest = parseManifest({
    name: "AcmeSeams",
    requires: {},
    provides: {},
    contributes: {
      "HttpModule.routes": [
        { id: "acme.routes", prefix: "/api/acme", auth: "none", order: 300 },
        { id: "acme.bundled", prefix: "/api/acme-bundled", auth: "none", order: 300 },
        { id: "acme.bundledOwn", prefix: "/api/acme-bundled-own", auth: "none", order: 300 },
        { id: "acme.hook", prefix: "/api/acme/hook", auth: "none", order: 8, origin: "own" },
        { id: "acme.hookAdmin", prefix: "/api/acme/hook/admin", auth: "none", order: 8 },
        {
          id: "acme.roomHook",
          prefix: "/api/acme/rooms/:room/hook",
          auth: "none",
          order: 8,
          origin: "own",
        },
      ],
      "HttpModule.upgrades": [
        { id: "acme.socket", prefix: "/api/acme/ws", auth: "none" },
        { id: "acme.room", prefix: "/api/acme/rooms/:room/ws", auth: "none" },
        { id: "acme.mine", prefix: "/api/acme/me/ws", auth: "user" },
        { id: "acme.digits", prefix: "/api/acme/digits/:id{[0-9]+}", auth: "none" },
        // Covers the runtime's own terminal streams: the seam must still never offer them.
        { id: "acme.terminals", prefix: "/api/terminals", auth: "none" },
      ],
      "MeRoutes.ownedPrefs": [{ id: "acme.pref", key: "acmeChoice", message: ACME_PREF_MESSAGE }],
    },
    children: [],
  });
  const routes = new Hono();
  routes.get("/missing", () => {
    throw new copy.HttpError(404, "acme_missing", "No such acme.", undefined, { acmeId: "a1" });
  });
  routes.get("/busy", () => {
    throw new copy.HttpError(503, "acme_busy", "Acme is busy.", 7);
  });
  routes.get("/look-alike", () => {
    throw Object.assign(new Error("I am a teapot."), {
      name: "HttpError",
      status: 418,
      code: "teapot",
    });
  });
  routes.post("/write", (c) => c.json({ wrote: true }));
  const bundled = new ForeignHono();
  bundled.get("/missing", () => {
    throw new copy.HttpError(404, "acme_missing", "No such acme.");
  });
  const bundledOwn = new ForeignHono();
  bundledOwn.onError((_err, c) => c.json({ handledBy: "the group" }, 418));
  bundledOwn.get("/missing", () => {
    throw new copy.HttpError(404, "acme_missing", "No such acme.");
  });
  const hook = new Hono();
  hook.post("/", (c) => c.json({ judged: c.req.header("origin") ?? null }));
  const hookAdmin = new Hono();
  hookAdmin.post("/", (c) => c.json({ wrote: true }));
  const roomHook = new Hono();
  roomHook.post("/", (c) => c.json({ judged: c.req.header("origin") ?? null }));
  return {
    manifest,
    create: (ctx) => {
      const mine = ++generation;
      const wss = new WebSocketServer({ noServer: true });
      ctx.effect(() => {
        for (const ws of wss.clients) ws.close(1012, "service restart");
      });
      const endpoint = {
        upgrade: (
          request: IncomingMessage,
          socket: Duplex,
          head: Buffer,
          caller: UpgradeCaller | null,
        ) => {
          const path = new URL(request.url ?? "/", "http://localhost").pathname;
          const userId = caller?.user.userId ?? null;
          upgraded.push({ path, userId });
          wss.handleUpgrade(request, socket, head, (ws) =>
            ws.send(`gen ${mine} ${path} ${userId ?? "anonymous"}`),
          );
        },
      };
      return {
        api: {},
        bind: {
          "acme.routes": routes,
          "acme.bundled": bundled,
          "acme.bundledOwn": bundledOwn,
          "acme.hook": hook,
          "acme.hookAdmin": hookAdmin,
          "acme.roomHook": roomHook,
          "acme.socket": endpoint,
          "acme.room": endpoint,
          "acme.mine": endpoint,
          "acme.digits": endpoint,
          "acme.terminals": endpoint,
        },
      };
    },
  };
}

let t: TestApp;
let admin: ReturnType<typeof apiClient>;
let adminCookie: string;
let ForeignHono: typeof Hono;

beforeAll(async () => {
  ForeignHono = (await foreignHono(await makeTempRoot())).Hono;
  const host = new PluginHost();
  host.use({ specifier: "@acme/seams", modules: [seamsPlugin(ForeignHono)], replaces: [] });
  t = await createTestApp({ plugins: host });
  adminCookie = (await loginAdmin(t.app)).cookie;
  admin = apiClient(t.app, adminCookie);
});
afterAll(async () => {
  await t.cleanup();
});

const crossOrigin = (path: string, method = "POST") =>
  t.app.request(path, {
    method,
    headers: { origin: FOREIGN, "content-type": "application/json" },
    body: "{}",
  });

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string; details?: unknown } }).error;

describe("an HttpError from a plugin's own copy of the class", () => {
  it("is answered with its status, code, message and details, and logged as expected", async () => {
    // The precondition the scenario stands on: the copy really is another class.
    expect(new copy.HttpError(400, "x", "y")).not.toBeInstanceOf(HttpError);

    const res = await admin.get("/api/acme/missing");
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({
      code: "acme_missing",
      message: "No such acme.",
      details: { acmeId: "a1" },
    });
    const logged = t.deps.errorsRepo
      .recent("default_project", { includeGlobal: true })
      .find((e) => e.code === "acme_missing");
    expect(logged).toMatchObject({ source: "http", kind: "expected" });
  });

  it("carries its Retry-After", async () => {
    const res = await admin.get("/api/acme/busy");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("7");
    expect((await errorOf(res)).code).toBe("acme_busy");
  });

  it("reaches the App's handler from a group built with the plugin's own Hono", async () => {
    expect(new ForeignHono()).not.toBeInstanceOf(Hono);
    const res = await admin.get("/api/acme-bundled/missing");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await errorOf(res)).code).toBe("acme_missing");
  });

  it("is left to the error handler such a group set itself", async () => {
    const res = await admin.get("/api/acme-bundled-own/missing");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ handledBy: "the group" });
  });

  it("is not mistaken for an error that only calls itself HttpError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await admin.get("/api/acme/look-alike");
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "Internal server error." });
  });
});

describe("a route group that judges its callers' origin itself", () => {
  it("takes a cross-origin write it answers to its own handler, a :param prefix's too", async () => {
    for (const path of ["/api/acme/hook", "/api/acme/rooms/r1/hook"]) {
      const res = await crossOrigin(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ judged: FOREIGN });
    }
  });

  it("leaves what it does not answer, and every other group, to the same-origin rule", async () => {
    for (const [method, path] of [
      ["DELETE", "/api/acme/hook"],
      ["POST", "/api/acme/hook/admin"],
      ["POST", "/api/acme/write"],
    ] as const) {
      const res = await crossOrigin(path, method);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("cross_origin_write");
    }
  });
});

describe("a ui_prefs key a module owns", () => {
  it("refuses a prefs write naming it with the module's message, and stores nothing of that write", async () => {
    const res = await admin.put("/api/me/prefs", { acmeChoice: "x", lang: "en" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({ code: "bad_request", message: ACME_PREF_MESSAGE });
    const prefs = ((await (await admin.get("/api/me/prefs")).json()) as { prefs: object }).prefs;
    expect(prefs).not.toHaveProperty("acmeChoice");
    expect(prefs).not.toHaveProperty("lang");
  });

  it("merges a write that does not name it, as before", async () => {
    const res = await admin.put("/api/me/prefs", { lang: "en" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prefs: object }).prefs).toMatchObject({ lang: "en" });
  });
});

describe("a contributed WebSocket endpoint", () => {
  const servers: http.Server[] = [];
  /** The upgrades the generation took nothing for, by path. */
  const fellBack: string[] = [];

  /** Answers 404, as the runtime's other listeners do for what they own. */
  const answer404 = (socket: Duplex) => {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  };

  const listen = async (deps: UpgradeSeamDeps): Promise<number> => {
    const server = http.createServer((_req, res) => res.writeHead(404).end());
    attachUpgradeSeam(server, deps);
    // Stands in for the terminal's listener, which serves the runtime's own paths.
    server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
      if (isRuntimeUpgradePath(new URL(request.url ?? "/", "http://localhost").pathname)) {
        answer404(socket);
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  };

  let port: number;
  beforeAll(async () => {
    port = await listen({
      current: async () => t.boot.tree.api<UpgradeSurface>("ApiModule", "Http"),
      reserved: isRuntimeUpgradePath,
      fallback: (request, socket) => {
        fellBack.push(new URL(request.url ?? "/", "http://localhost").pathname);
        answer404(socket);
        return true;
      },
      log: () => {},
    });
  });
  afterAll(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  type Outcome = { message: string; ws: WebSocket } | { status: number };
  /** Opens a socket to `path`: its first message, or the status the upgrade was refused with. */
  const open = (path: string, headers: Record<string, string> = {}, to = port) =>
    new Promise<Outcome>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${to}${path}`, { headers });
      ws.on("error", () => {});
      ws.once("message", (data) => resolve({ message: String(data), ws }));
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on("close", () => reject(new Error(`${path}: closed without an answer`)));
    });
  const messageOf = async (outcome: Promise<Outcome>): Promise<string> => {
    const got = await outcome;
    if (!("message" in got)) throw new Error(`refused ${got.status}`);
    got.ws.terminate();
    return got.message;
  };

  it("hands an auth-none endpoint the upgrade as it came, whatever its Origin, with no caller", async () => {
    expect(await messageOf(open("/api/acme/ws/room-1", { origin: FOREIGN }))).toMatch(
      / \/api\/acme\/ws\/room-1 anonymous$/,
    );
    expect(await messageOf(open("/api/acme/rooms/r7/ws"))).toMatch(
      / \/api\/acme\/rooms\/r7\/ws anonymous$/,
    );
  });

  it("hands an auth-user endpoint only a signed-in, same-origin handshake, with the user", async () => {
    const own = `http://127.0.0.1:${port}`;
    expect(await open("/api/acme/me/ws", { origin: own })).toEqual({ status: 401 });
    expect(await open("/api/acme/me/ws", { origin: FOREIGN, cookie: adminCookie })).toEqual({
      status: 403,
    });
    expect(
      await open("/api/acme/me/ws", {
        origin: own,
        cookie: adminCookie,
        "sec-fetch-site": "cross-site",
      }),
    ).toEqual({ status: 403 });
    expect(upgraded.filter((u) => u.path === "/api/acme/me/ws")).toEqual([]);

    expect(await messageOf(open("/api/acme/me/ws", { origin: own, cookie: adminCookie }))).toMatch(
      / \/api\/acme\/me\/ws admin$/,
    );
  });

  it("is not handed an upgrade it does not cover, nor one only a Hono pattern would read", async () => {
    for (const path of ["/api/acme/websocket", "/api/acme/digits/42"]) {
      expect(await open(path)).toEqual({ status: 404 });
      expect(fellBack).toContain(path);
    }
    expect(upgraded.map((u) => u.path)).not.toContain("/api/acme/websocket");
    expect(upgraded.map((u) => u.path)).not.toContain("/api/acme/digits/42");
  });

  it("is never offered the runtime's own upgrades, even under its prefix", async () => {
    for (const path of ["/api/terminals/t1/stream", "/api/socket"]) {
      expect(await open(path)).toEqual({ status: 404 });
    }
    expect(upgraded.filter((u) => u.path.startsWith("/api/terminals"))).toEqual([]);
    expect(fellBack).not.toContain("/api/terminals/t1/stream");
    expect(fellBack).not.toContain("/api/socket");
  });

  it("wired as the runtime wires it, follows the current generation across a re-assembly", async () => {
    const wired = await listen(platformUpgradeDeps(t.deps.hmr, () => {}));
    const before = await open("/api/acme/ws/live", {}, wired);
    if (!("message" in before)) throw new Error(`refused ${before.status}`);
    const was = Number(before.message.split(" ")[1]);
    const closed = new Promise<number>((resolve) => before.ws.on("close", (code) => resolve(code)));

    expect(await t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble()).toBe(
      true,
    );
    expect(await closed).toBe(1012);
    const after = await messageOf(open("/api/acme/ws/live", {}, wired));
    expect(Number(after.split(" ")[1])).toBeGreaterThan(was);
  });
});
