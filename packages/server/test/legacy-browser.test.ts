/**
 * What the runtime still does for the agent browser by name (hmr/legacy-browser.ts), against a
 * platform pushed before the generic seams: a stand-in generation whose HTTP surface names no
 * own-origin groups and serves no WebSocket endpoints, and whose browser module provides only the
 * gate the runtime used to look up by name.
 *
 * The pairing route's origin:
 * - The runtime's check in front of the seam lets a cross-origin write to the extension's pairing
 *   route through to the platform, and still refuses every other cross-origin write.
 *
 * The extension's socket, through the runtime's seam:
 * - A paired extension calling from its own origin is upgraded on `penguin-browser.1` and handed
 *   to the gate; frames flow both ways.
 * - A web page's origin is refused 403, an unknown or malformed token 401, and the gate is never
 *   handed the socket.
 * - A generation with no browser is refused 503.
 * - An upgrade to any other path is not the fallback's to take.
 */
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ModuleTree } from "@prismshadow/penguin-core/kernel";
import { createApp } from "../src/app.js";
import type { ServerBoot } from "../src/app.js";
import { legacyExtensionUpgrade } from "../src/hmr/legacy-browser.js";
import type { LegacyExtensionGate, LegacyExtensionSocket } from "../src/hmr/legacy-browser.js";
import type { ServerHmrHost } from "../src/hmr/platform.js";
import { attachUpgradeSeam } from "../src/hmr/upgrade-seam.js";
import { createTestApp, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const FOREIGN = "https://elsewhere.example";
/** The origin the PenguinHarness Browser extension calls from (its pinned id). */
const EXTENSION = "chrome-extension://dodgfhpcbmkjfcbgnoidablfgjjhhmgp";
const TOKEN = "t".repeat(43);

describe("the pairing route's origin on an older platform", () => {
  let t: TestApp;
  let runtime: ReturnType<typeof createApp>;
  beforeAll(async () => {
    t = await createTestApp();
    const tree = t.boot.tree;
    // Its HTTP surface predates `Http.ownOrigin`; whatever the runtime lets through is echoed.
    const older = {
      api: <T>(module: string, alias: string): T =>
        module === "ApiModule" && alias === "Http" ? ({} as T) : tree.api<T>(module, alias),
    } as unknown as ModuleTree;
    const control = {
      current: async () => ({
        api: {
          http: async (request: Request) =>
            Response.json({ reached: new URL(request.url).pathname }),
        },
      }),
    } as unknown as ServerBoot["control"];
    runtime = createApp({ ...t.boot, tree: older, control });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const crossOrigin = (path: string) =>
    runtime.request(path, {
      method: "POST",
      headers: { origin: FOREIGN, "content-type": "application/json" },
      body: "{}",
    });

  it("lets a cross-origin write to the pairing route through, and refuses the others", async () => {
    const pair = await crossOrigin("/api/builtin-browser/extension/pair");
    expect(pair.status).toBe(200);
    expect(await pair.json()).toEqual({ reached: "/api/builtin-browser/extension/pair" });

    const other = await crossOrigin("/api/builtin-browser/extension/pairings");
    expect(other.status).toBe(403);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
      "cross_origin_write",
    );
  });
});

describe("the extension's socket on an older platform", () => {
  /** What the older platform's gate was handed, and what came in over each socket. */
  let connected: LegacyExtensionSocket[] = [];
  const received: string[] = [];
  const gate: LegacyExtensionGate = {
    admit: (token) => (token === TOKEN ? "ok" : "unknown"),
    connect: (_token, socket) => {
      connected.push(socket);
      socket.onMessage((text) => received.push(text));
      socket.send("hello");
    },
  };
  let withBrowser = true;
  const tree = {
    has: (module: string) => withBrowser && module === "BuiltinBrowserModule",
    api: () => gate,
  };
  const hmr = { ensure: async () => ({ api: { business: () => tree } }) };

  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    const legacy = legacyExtensionUpgrade(hmr as unknown as ServerHmrHost, () => {});
    server = http.createServer((_req, res) => res.writeHead(404).end());
    attachUpgradeSeam(server, {
      // That generation's HTTP surface serves no endpoints.
      current: async () => ({}),
      reserved: () => false,
      fallback: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (legacy(request, socket, head)) return true;
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return true;
      },
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => {
    connected = [];
    withBrowser = true;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  type Outcome = { ws: WebSocket; first: string } | { status: number };
  const open = (path: string, protocols: string[], origin = EXTENSION) =>
    new Promise<Outcome>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { origin });
      ws.on("error", () => {});
      ws.once("message", (data) => resolve({ ws, first: String(data) }));
      ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
      ws.on("close", () => reject(new Error(`${path}: closed without an answer`)));
    });
  const SOCKET = "/api/builtin-browser/extension/ws";

  it("upgrades a paired extension from its own origin and hands it to the gate", async () => {
    const got = await open(SOCKET, ["penguin-browser.1", `token.${TOKEN}`]);
    if (!("ws" in got)) throw new Error(`refused ${got.status}`);
    expect(got.first).toBe("hello");
    expect(got.ws.protocol).toBe("penguin-browser.1");
    got.ws.send("hello back");
    await waitFor(() => received.includes("hello back"));
    got.ws.terminate();
  });

  it("refuses a web page's origin 403 and an unknown or malformed token 401, before the gate", async () => {
    expect(await open(SOCKET, ["penguin-browser.1", `token.${TOKEN}`], FOREIGN)).toEqual({
      status: 403,
    });
    expect(await open(SOCKET, ["penguin-browser.1", `token.${"u".repeat(43)}`])).toEqual({
      status: 401,
    });
    expect(await open(SOCKET, ["penguin-browser.1", "token.short"])).toEqual({ status: 401 });
    expect(connected).toEqual([]);
  });

  it("refuses 503 on a generation with no browser", async () => {
    withBrowser = false;
    expect(await open(SOCKET, ["penguin-browser.1", `token.${TOKEN}`])).toEqual({ status: 503 });
  });

  it("does not take an upgrade to another path", async () => {
    expect(await open("/api/elsewhere/ws", ["penguin-browser.1", `token.${TOKEN}`])).toEqual({
      status: 404,
    });
    expect(connected).toEqual([]);
  });
});
