/**
 * The server seams a code plugin reaches the host through, exercised by a plugin module booted
 * into the real platform tree (the way the loader adds one): a route group, an own-origin route
 * group, a WebSocket endpoint and an owned ui_prefs key, all contributed by one module.
 *
 * HttpError across copies:
 * - Given a route that throws an HttpError from its own copy of the errors module (as a bundled
 *   plugin does), the caller gets that status, code, message and details — with Retry-After when
 *   it carries one — and the error log records it as expected under its code.
 * - Given an error that only calls itself HttpError (no brand), the caller gets 500 `internal`
 *   and nothing of its claimed status or code.
 *
 * Own-origin route groups:
 * - Given a group declaring `origin: "own"`, a cross-origin write reaches its handler.
 * - Given a group without it, the same write is refused 403 `cross_origin_write` — also one
 *   mounted below the own-origin prefix, which is not the own-origin group's.
 * - Given a generation that cannot name its own-origin groups (a platform pushed before the
 *   field), the runtime's check in front of the seam still lets the extension pair, and still
 *   refuses every other cross-origin write.
 *
 * Owned ui_prefs keys:
 * - Given a key a module owns, a prefs write naming it is refused 400 with the module's message,
 *   and nothing of that write is stored; a write without it merges as before.
 * - The agent browser's own key, `browserBackend`, is refused the same way.
 *
 * WebSocket endpoints (the runtime's upgrade seam on a real listener):
 * - An upgrade under the endpoint's prefix reaches the endpoint, which owns the handshake.
 * - An upgrade no endpoint covers is not taken by one: the seam's fallback gets it.
 * - The runtime's own upgrade paths (a terminal's stream, the API socket) are never offered to
 *   the generation, even under a prefix an endpoint declares.
 */
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import WebSocket, { WebSocketServer } from "ws";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef, ModuleTree } from "@prismshadow/penguin-core/kernel";
import { createApp } from "../src/app.js";
import { PluginHost } from "../src/plugin/host.js";
import { HttpError } from "../src/http/errors.js";
import { attachUpgradeSeam } from "../src/hmr/upgrade-seam.js";
import type { UpgradeSurface } from "../src/hmr/upgrade-seam.js";
import { isRuntimeUpgradePath } from "../src/terminal/ws.js";
import { PENGUIN_EXTENSION_ID } from "../src/builtin-browser/extension-origin.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/**
 * The errors module as a plugin bundles it: a second copy, its classes distinct from the host's.
 * The query makes it another module instance; held in a variable so the compiler, which knows no
 * such path, does not resolve it.
 */
const copySpecifier = "../src/http/errors.js?plugin-copy";
const copy = (await import(copySpecifier)) as typeof import("../src/http/errors.js");

const FOREIGN = "https://elsewhere.example";
const ACME_PREF_MESSAGE = "acmeChoice is set by PUT /api/acme/choice, not the prefs.";

/** What the plugin's WebSocket endpoint was handed, by path. */
const upgraded: string[] = [];

function seamsPlugin(): ModuleDef {
  const manifest = parseManifest({
    name: "AcmeSeams",
    requires: {},
    provides: {},
    contributes: {
      "HttpModule.routes": [
        { id: "acme.routes", prefix: "/api/acme", auth: "none", order: 300 },
        { id: "acme.hook", prefix: "/api/acme/hook", auth: "none", order: 8, origin: "own" },
        { id: "acme.hookAdmin", prefix: "/api/acme/hook/admin", auth: "none", order: 8 },
      ],
      "HttpModule.upgrades": [
        { id: "acme.socket", prefix: "/api/acme/ws" },
        // Covers the runtime's own terminal streams: the seam must still never offer them.
        { id: "acme.terminals", prefix: "/api/terminals" },
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
  const hook = new Hono();
  hook.post("/", (c) => c.json({ judged: c.req.header("origin") ?? null }));
  const hookAdmin = new Hono();
  hookAdmin.post("/", (c) => c.json({ wrote: true }));
  const wss = new WebSocketServer({ noServer: true });
  const endpoint = {
    upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      upgraded.push(path);
      wss.handleUpgrade(request, socket, head, (ws) => ws.send(`hello ${path}`));
    },
  };
  return {
    manifest,
    create: () => ({
      api: {},
      bind: {
        "acme.routes": routes,
        "acme.hook": hook,
        "acme.hookAdmin": hookAdmin,
        "acme.socket": endpoint,
        "acme.terminals": endpoint,
      },
    }),
  };
}

let t: TestApp;
let admin: ReturnType<typeof apiClient>;

beforeAll(async () => {
  const host = new PluginHost();
  host.use({ specifier: "@acme/seams", modules: [seamsPlugin()], replaces: [] });
  t = await createTestApp({ plugins: host });
  admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
});
afterAll(async () => {
  await t.cleanup();
});

const crossOriginPost = (app: TestApp["app"], path: string, origin = FOREIGN) =>
  app.request(path, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
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

  it("is not mistaken for an error that only calls itself HttpError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await admin.get("/api/acme/look-alike");
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "Internal server error." });
  });
});

describe("a route group that judges its callers' origin itself", () => {
  it("takes a cross-origin write to its own handler", async () => {
    const res = await crossOriginPost(t.app, "/api/acme/hook");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ judged: FOREIGN });
  });

  it("leaves every other group, one mounted below its prefix included, to the same-origin rule", async () => {
    for (const path of ["/api/acme/write", "/api/acme/hook/admin"]) {
      const res = await crossOriginPost(t.app, path);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("cross_origin_write");
    }
  });

  it("on a generation that cannot name such groups, the runtime still lets the extension pair and refuses the rest", async () => {
    // A platform pushed before `Http.ownOrigin`: its HTTP surface has no such member.
    const tree = t.boot.tree;
    const olderTree = {
      api: <T>(module: string, alias: string): T =>
        module === "ApiModule" && alias === "Http" ? ({} as T) : tree.api<T>(module, alias),
    } as unknown as ModuleTree;
    const runtime = createApp({ ...t.boot, tree: olderTree });

    const pair = await crossOriginPost(
      runtime,
      "/api/builtin-browser/extension/pair",
      `chrome-extension://${PENGUIN_EXTENSION_ID}`,
    );
    // Past the origin check: the pairing route itself turns the empty body away.
    expect(pair.status).toBe(400);
    expect((await errorOf(pair)).code).toBe("bad_request");

    // The plugin's own-origin group is the generation's to name, which this one cannot.
    for (const path of ["/api/acme/hook", "/api/acme/write"]) {
      const res = await crossOriginPost(runtime, path);
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

  it("refuses the agent browser's backend choice the same way", async () => {
    const res = await admin.put("/api/me/prefs", { browserBackend: "chrome" });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("bad_request");
  });
});

describe("a contributed WebSocket endpoint", () => {
  let server: http.Server;
  let port: number;
  /** The upgrades the generation took nothing for, by path. */
  const fellBack: string[] = [];

  /** Answers 404, as the runtime's other listeners do for what they own. */
  const answer404 = (socket: Duplex) => {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  };

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.writeHead(404).end());
    attachUpgradeSeam(server, {
      current: async () => t.boot.tree.api<UpgradeSurface>("ApiModule", "Http"),
      reserved: isRuntimeUpgradePath,
      fallback: (request, socket) => {
        fellBack.push(new URL(request.url ?? "/", "http://localhost").pathname);
        answer404(socket);
        return true;
      },
      log: () => {},
    });
    // Stands in for the terminal's listener, which serves the runtime's own paths.
    server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
      if (isRuntimeUpgradePath(new URL(request.url ?? "/", "http://localhost").pathname)) {
        answer404(socket);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Opens a socket to `path`: the first message, or the status the upgrade was refused with. */
  const open = (path: string) =>
    new Promise<{ message: string } | { status: number }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      ws.on("error", () => {});
      ws.on("message", (data) => {
        resolve({ message: String(data) });
        ws.terminate();
      });
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on("close", () => reject(new Error(`${path}: closed without an answer`)));
    });

  it("is handed an upgrade under its prefix, and owns the handshake", async () => {
    expect(await open("/api/acme/ws/room-1")).toEqual({ message: "hello /api/acme/ws/room-1" });
    expect(upgraded).toContain("/api/acme/ws/room-1");
  });

  it("is not handed an upgrade it does not cover: the fallback gets it", async () => {
    expect(await open("/api/acme/websocket")).toEqual({ status: 404 });
    expect(fellBack).toContain("/api/acme/websocket");
    expect(upgraded).not.toContain("/api/acme/websocket");
  });

  it("is never offered the runtime's own upgrades, even under its prefix", async () => {
    for (const path of ["/api/terminals/t1/stream", "/api/socket"]) {
      expect(await open(path)).toEqual({ status: 404 });
    }
    expect(upgraded.filter((p) => p.startsWith("/api/terminals"))).toEqual([]);
    expect(fellBack).not.toContain("/api/terminals/t1/stream");
    expect(fellBack).not.toContain("/api/socket");
  });
});
