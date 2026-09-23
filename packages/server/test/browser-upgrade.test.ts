/**
 * A WebSocket through a Browser host: the runtime's upgrade seam offers the handshake to
 * the platform, the Browser tunnels it to the site, and frames flow both ways — with the
 * site seeing its own Host and Origin, and the App's terminal stream untouched by the seam.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { openDatabase } from "../src/db/database.js";
import { BrowserEgress } from "../src/browser/egress.js";
import { BrowserSitesRepo } from "../src/browser/sites.js";
import { browserHostUpgrade } from "../src/browser/upgrade.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("a WebSocket through a Browser host", () => {
  let db: ReturnType<typeof openDatabase>;
  let sites: BrowserSitesRepo;
  /** The site: a WebSocket server that echoes, and reports what the handshake carried. */
  let site: http.Server;
  let sitePort: number;
  let handshakes: Array<{ host?: string; origin?: string; url?: string }>;
  /** This server, with the runtime's upgrade handler over a platform that carries the Browser's tunnels. */
  let front: http.Server;
  let frontPort: number;
  let terminalUpgrades: number;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)",
    ).run("admin", "x", "2026-09-19T00:00:00.000Z");
    sites = new BrowserSitesRepo(db);
    handshakes = [];
    terminalUpgrades = 0;

    site = http.createServer((_req, res) => res.writeHead(426).end());
    const wss = new WebSocketServer({ server: site });
    wss.on("connection", (ws, req) => {
      handshakes.push({ host: req.headers.host, origin: req.headers.origin, url: req.url });
      ws.on("message", (data) => ws.send(`echo:${data.toString()}`));
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    sitePort = (site.address() as AddressInfo).port;

    const egress = new BrowserEgress({
      dialPort: async () => ({ ok: false, detail: "no machine here" }),
      ownPort: () => 1,
      proxied: () => false,
      fetch: async () => new Response("unused"),
    });
    const upgrade = browserHostUpgrade({ sites, egress });
    front = http.createServer((_req, res) => res.writeHead(404).end());
    attachTerminalWebSocket(front, {
      hmr: {
        ensure: async () => ({
          api: {
            upgrade,
            // The terminal path, reached only when the platform did not claim the socket.
            terminals: () => {
              terminalUpgrades++;
              return { get: () => undefined };
            },
          },
        }),
      } as never,
      authService: { authenticateWithMeta: () => ({ user: { userId: "admin" } }) } as never,
      log: () => {},
    });
    await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
    frontPort = (front.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => front.close(() => resolve()));
    await new Promise<void>((resolve) => site.close(() => resolve()));
    db.close();
  });

  /** Opens a socket to this server under a Browser host's name, and waits for the handshake to settle. */
  const connect = (host: string, path = "/live") =>
    new Promise<{ ws: WebSocket; status?: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${frontPort}${path}`, {
        headers: { host, origin: `http://${host}` },
      });
      ws.once("open", () => resolve({ ws }));
      ws.once("unexpected-response", (_req, res) => resolve({ ws, status: res.statusCode }));
      ws.once("error", () => resolve({ ws, status: 0 }));
    });

  it("tunnels the handshake and the frames, with the site's own Host and Origin", async () => {
    const minted = sites.obtain("admin", null, `http://localhost:${sitePort}`);
    const host = `${minted.label}.localhost:${frontPort}`;
    const { ws, status } = await connect(host, "/live?room=1");
    expect(status).toBeUndefined();
    const echoed = new Promise<string>((resolve) =>
      ws.once("message", (d) => resolve(d.toString())),
    );
    ws.send("hello");
    expect(await echoed).toBe("echo:hello");
    ws.close();
    expect(handshakes).toEqual([
      {
        host: `localhost:${sitePort}`,
        origin: `http://localhost:${sitePort}`,
        url: "/live?room=1",
      },
    ]);
    expect(terminalUpgrades).toBe(0);
  });

  it("answers an unknown label 404 and a site it cannot reach 502, and leaves other hosts to the terminal path", async () => {
    const unknown = await connect(`aaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:${frontPort}`);
    expect(unknown.status).toBe(404);
    const dead = sites.obtain("admin", "machine", "http://localhost:3000");
    const unreachable = await connect(`${dead.label}.localhost:${frontPort}`);
    expect(unreachable.status).toBe(502);
    expect(terminalUpgrades).toBe(0);

    // The App's own host: the platform declines, and the terminal path answers — its cookie
    // gate first, which this bare handshake does not pass.
    const app = await connect(`localhost:${frontPort}`, "/api/terminals/t1/stream");
    expect(app.status).toBe(401);
  });
});

describe("the App's /api guards on a Browser host", () => {
  let t: TestApp;
  let upstream: http.Server;
  let port: number;
  let seen: Array<{ url: string; type?: string; body: string }>;

  beforeEach(async () => {
    seen = [];
    upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", type: req.headers["content-type"], body });
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("let a site's own form post under /api/* through, and keep guarding the App's", async () => {
    const admin = (await loginAdmin(t.app)).cookie;
    const minted = await t.app.request("http://localhost/api/browser/sites", {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ machineId: null, url: `localhost:${port}` }),
    });
    const { origin } = (await minted.json()) as { origin: string };
    const form = await t.app.request(`${origin}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "user=a",
    });
    expect(form.status).toBe(200);
    expect(seen).toEqual([
      { url: "/api/login", type: "application/x-www-form-urlencoded", body: "user=a" },
    ]);
    // The App itself still refuses a form-typed write…
    const app = await t.app.request("http://localhost/api/me/password", {
      method: "PUT",
      headers: { cookie: admin, "content-type": "application/x-www-form-urlencoded" },
      body: "x=1",
    });
    expect(app.status).toBe(415);
    // …and so does the upgrade channel, on any host.
    const hmr = await t.app.request(`${origin}/api/hmr/upgrade`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "x=1",
    });
    expect(hmr.status).toBe(415);
  });
});
