/**
 * The extension's WebSocket on the wire: the real upgrade handler (extension-ws.ts) on an
 * ephemeral http.Server, the real `ws` client playing the PenguinHarness Browser extension, and
 * — for all but the liveness case — the gate of the real platform tree, paired through its
 * routes.
 *
 * - An upgrade from a web page's or another extension's origin is refused 403, one without a
 *   known token 401.
 * - A paired extension is greeted with `hello` on the `penguin-browser.1` subprotocol; its
 *   answer makes the user's Chrome available, and the user's windows hear it connected.
 * - Replies are matched to requests by id, whatever order they come back in.
 * - An extension answering hello with a protocol this server does not speak is closed 4005.
 * - A second Chrome of the same user takes over; the first is closed 4001.
 * - Revoking the connected Chrome closes it 4003, and its token is told the same on return.
 * - The admin's switch off closes the socket 4009 and turns the next one away with 4009; on
 *   again, the extension gets back in.
 * - An extension that answers its pings stays; one that stops, or never answers hello, is closed
 *   4008.
 */
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  BrowserExtensionPairResponse,
  BrowserExtensionPairingResponse,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  DesktopBrowserCommandMessage,
} from "../../src/api/types.js";
import { PENGUIN_EXTENSION_ID } from "../../src/builtin-browser/extension-origin.js";
import { ExtensionPairing } from "../../src/builtin-browser/extension-pairing.js";
import { attachExtensionWebSocket } from "../../src/builtin-browser/extension-ws.js";
import type { ExtensionGate } from "../../src/builtin-browser/extension-ws.js";
import { BuiltinBrowser } from "../../src/builtin-browser/service.js";
import { openDatabase } from "../../src/db/database.js";
import { BrowserExtensionsRepo } from "../../src/db/repos/browser-extensions.js";
import { userChannelKey } from "../../src/http/routes/events.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "../helpers.js";
import type { TestApp } from "../helpers.js";

const EXTENSION_ORIGIN = `chrome-extension://${PENGUIN_EXTENSION_ID}`;

/** The extension's side of one socket, as a test drives it. */
interface Extension {
  ws: WebSocket;
  /** Every command the server sent, in order. */
  commands: DesktopBrowserCommandMessage[];
  /** How the socket closed: the code the server gave. */
  closed: Promise<number>;
  /** Resolves with the next command of `op` (one already received counts). */
  next(op: string): Promise<DesktopBrowserCommandMessage>;
  reply(id: string, result: unknown): void;
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** An http.Server on an ephemeral port with only the extension upgrade attached. */
async function listen(gate: () => Promise<ExtensionGate | null>): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  attachExtensionWebSocket(server, { gate, log: () => {} });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

const wsUrl = (port: number) => `ws://127.0.0.1:${port}/api/builtin-browser/extension/ws`;

/** The status an upgrade was refused with. */
function refusal(port: number, token: string, origin = EXTENSION_ORIGIN): Promise<number> {
  const ws = new WebSocket(wsUrl(port), ["penguin-browser.1", `token.${token}`], { origin });
  sockets.push(ws);
  ws.on("error", () => {});
  return new Promise((resolve, reject) => {
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => reject(new Error("the upgrade was accepted")));
  });
}

/**
 * Opens a socket as the extension does. It answers hello (with `hello`), the tab list (none)
 * and, unless `pings` is false, the pings; everything else is the test's to answer.
 */
function extension(
  port: number,
  token: string,
  opts: { hello?: unknown; pings?: boolean } = {},
): Extension {
  const ws = new WebSocket(wsUrl(port), ["penguin-browser.1", `token.${token}`], {
    origin: EXTENSION_ORIGIN,
  });
  sockets.push(ws);
  ws.on("error", () => {});
  const commands: DesktopBrowserCommandMessage[] = [];
  const waiters: { op: string; resolve: (msg: DesktopBrowserCommandMessage) => void }[] = [];
  const reply = (id: string, result: unknown) =>
    ws.send(JSON.stringify({ type: "desktop-browser-reply", id, ok: true, result }));
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data)) as DesktopBrowserCommandMessage;
    commands.push(msg);
    const op = msg.command.op;
    if (op === "hello") {
      reply(
        msg.id,
        opts.hello ?? {
          version: 1,
          backend: "chrome",
          extension: { version: "0.2.13", chrome: "130", name: "Chrome 130 on Linux" },
        },
      );
    } else if (op === "tabs") reply(msg.id, { tabs: [] });
    else if (op === "ping" && opts.pings !== false) reply(msg.id, {});
    for (const waiter of waiters.filter((w) => w.op === op)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(msg);
    }
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return {
    ws,
    commands,
    closed,
    reply,
    next: (op) => {
      const seen = commands.find((c) => c.command.op === op);
      if (seen !== undefined) return Promise.resolve(seen);
      return new Promise((resolve) => waiters.push({ op, resolve }));
    },
  };
}

describe("the extension socket of the real platform", () => {
  let t: TestApp;
  let port: number;
  let alice: ReturnType<typeof apiClient>;
  let events: BuiltinBrowserServerEvent[];

  beforeEach(async () => {
    t = await createTestApp();
    port = await listen(async () =>
      t.deps.tree.api<ExtensionGate>("BuiltinBrowserModule", "BrowserExtensionGate"),
    );
    alice = apiClient(t.app, (await provisionUser(t.app, "alice")).cookie);
    events = [];
    t.deps.channels
      .get(userChannelKey("alice"))
      .subscribe((evt) => events.push(JSON.parse(evt.data) as BuiltinBrowserServerEvent));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** A Chrome paired to alice through the routes: its id and token. */
  async function pairChrome(): Promise<BrowserExtensionPairResponse> {
    const minted = await alice.post("/api/builtin-browser/extension/pairings");
    const { code } = (await minted.json()) as BrowserExtensionPairingResponse;
    const res = await t.app.request("/api/builtin-browser/extension/pair", {
      method: "POST",
      headers: { "content-type": "application/json", origin: EXTENSION_ORIGIN },
      body: JSON.stringify({ code, name: "Chrome 130 on Linux", version: "0.2.13" }),
    });
    return (await res.json()) as BrowserExtensionPairResponse;
  }

  const status = async () =>
    (await (await alice.get("/api/builtin-browser/status")).json()) as BuiltinBrowserStatus;

  it("refuses a web page's or another extension's origin with 403 and an unknown token with 401", async () => {
    const { token } = await pairChrome();
    expect(await refusal(port, token, "https://evil.example")).toBe(403);
    expect(await refusal(port, token, "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh")).toBe(
      403,
    );
    expect(await refusal(port, "x".repeat(43))).toBe(401);
  });

  it("greets a paired extension with hello, and its answer makes the user's Chrome available", async () => {
    const { token, extensionId } = await pairChrome();
    expect((await status()).reason).toBe("extension_disconnected");
    const chrome = extension(port, token);
    const hello = await chrome.next("hello");
    expect(hello).toEqual({
      type: "desktop-browser-command",
      id: expect.any(String),
      command: { op: "hello" },
    });
    expect(chrome.ws.protocol).toBe("penguin-browser.1");
    await waitFor(() =>
      events.some((e) => e.type === "builtin_browser_extension" && e.state === "connected"),
    );
    expect(await status()).toMatchObject({
      available: true,
      backend: "chrome",
      backends: [
        {
          backend: "chrome",
          available: true,
          extension: { id: extensionId, connected: true, version: "0.2.13" },
        },
      ],
    });
  });

  it("matches replies to requests by id, whatever order they come back in", async () => {
    const { token } = await pairChrome();
    const chrome = extension(port, token);
    await waitFor(() => events.some((e) => e.type === "builtin_browser_extension"));
    const shown = alice.post("/api/builtin-browser/tabs", { activate: true });
    const hidden = alice.post("/api/builtin-browser/tabs", { activate: false });
    await waitFor(() => chrome.commands.filter((c) => c.command.op === "open-tab").length === 2);
    const opens = chrome.commands.filter((c) => c.command.op === "open-tab");
    const tabOf = (id: number): BuiltinBrowserTab => ({
      id,
      url: "about:blank",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    // The later request is answered first.
    for (const msg of [...opens].reverse()) {
      const activate = (msg.command as { activate: boolean }).activate;
      chrome.reply(msg.id, { tab: tabOf(activate ? 1 : 2) });
    }
    expect(((await (await shown).json()) as { tab: BuiltinBrowserTab }).tab.id).toBe(1);
    expect(((await (await hidden).json()) as { tab: BuiltinBrowserTab }).tab.id).toBe(2);
  });

  it("closes an extension that answers hello with another protocol version, 4005", async () => {
    const { token } = await pairChrome();
    const chrome = extension(port, token, { hello: { version: 2, backend: "chrome" } });
    expect(await chrome.closed).toBe(4005);
  });

  it("lets a second Chrome of the user take over, closing the first 4001", async () => {
    const first = extension(port, (await pairChrome()).token);
    await waitFor(() => events.some((e) => e.type === "builtin_browser_extension"));
    const second = extension(port, (await pairChrome()).token);
    expect(await first.closed).toBe(4001);
    await second.next("hello");
    await waitFor(() => events.filter((e) => e.type === "builtin_browser_extension").length >= 3);
    expect((await status()).available).toBe(true);
  });

  it("closes a revoked Chrome 4003, and tells its token the same when it comes back", async () => {
    const { token, extensionId } = await pairChrome();
    const chrome = extension(port, token);
    await waitFor(() => events.some((e) => e.type === "builtin_browser_extension"));
    expect((await alice.delete(`/api/builtin-browser/extension/${extensionId}`)).status).toBe(204);
    expect(await chrome.closed).toBe(4003);
    expect(await extension(port, token).closed).toBe(4003);
    expect((await status()).reason).toBe("extension_not_paired");
  });

  it("closes every Chrome 4009 when the admin switches them off, and lets them back when on", async () => {
    const { token } = await pairChrome();
    const chrome = extension(port, token);
    await waitFor(() => events.some((e) => e.type === "builtin_browser_extension"));
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);

    await admin.put("/api/admin/settings", { browserExtensionsEnabled: false });
    expect(await chrome.closed).toBe(4009);
    expect(await extension(port, token).closed).toBe(4009);

    await admin.put("/api/admin/settings", { browserExtensionsEnabled: true });
    const back = extension(port, token);
    await back.next("hello");
    await waitFor(
      () =>
        events.filter((e) => e.type === "builtin_browser_extension" && e.state === "connected")
          .length === 2,
    );
    expect((await status()).available).toBe(true);
  });
});

describe("liveness", () => {
  let root: string;
  let db: ReturnType<typeof openDatabase>;
  let browser: BuiltinBrowser;
  let token: string;
  let port: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-link-"));
    db = openDatabase(":memory:");
    db.exec(
      "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('alice', 'h', 0, '2026-10-02T00:00:00.000Z')",
    );
    const store = new BrowserExtensionsRepo(db);
    browser = new BuiltinBrowser({
      port: null,
      root,
      publish: () => {},
      log: () => {},
      chrome: {
        store,
        enabled: () => true,
        publishTo: () => {},
        linkTiming: { pingIntervalMs: 30, helloTimeoutMs: 50 },
      },
    });
    const pairing = new ExtensionPairing({
      store,
      user: (userId) => ({ userId, displayName: null }),
      installId: () => null,
      serverVersion: "0.2.13",
      now: Date.now,
    });
    const { code } = pairing.mint("alice");
    token = pairing.pair({ code, name: "Chrome 130 on Linux", version: "0.2.13" }).token;
    port = await listen(async () => browser);
  });
  afterEach(async () => {
    browser.dispose();
    await browser.history.flush();
    db.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("keeps an extension that answers its pings, and closes one that stops with 4008", async () => {
    const lively = extension(port, token);
    await waitFor(() => lively.commands.filter((c) => c.command.op === "ping").length >= 4);
    expect(lively.ws.readyState).toBe(WebSocket.OPEN);
    lively.ws.terminate();

    const silent = extension(port, token, { pings: false });
    expect(await silent.closed).toBe(4008);
  });

  it("closes an extension that never answers hello with 4008", async () => {
    const ws = new WebSocket(wsUrl(port), ["penguin-browser.1", `token.${token}`], {
      origin: EXTENSION_ORIGIN,
    });
    sockets.push(ws);
    ws.on("error", () => {});
    const closed = await new Promise<[number, string]>((resolve) =>
      ws.on("close", (code, reason) => resolve([code, String(reason)])),
    );
    expect(closed).toEqual([4008, "hello_timeout"]);
  });
});
