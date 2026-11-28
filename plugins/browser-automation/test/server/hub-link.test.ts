/**
 * A machine's end of the hub's channel: a real WebSocket into the hub endpoint (hub-ws.ts), the
 * routes the machine's agents call, and a fake hub at the far end of the socket — the server that
 * added the machine, which carries every command out in the person's browser.
 *
 * - Given a hub connected, an agent on the machine opens a page: the hub is asked for it with the
 *   Session and its Project, the page is the Session's, and the status names the hub's browser.
 *   Another Session of the machine sees none of it.
 * - An action is told to the hub before its first command and after its last (`activity`), and a
 *   closed page is closed by the hub.
 * - Raw CDP that reaches the person's cookies or stores is refused here and never sent.
 * - When the hub goes away the agents hear `hub_disconnected`; when it comes back driving the
 *   admin's Chrome instead, the status says so and the hub's tab list replaces the old one.
 * - The endpoint takes no browser page (an Origin), no member, and nothing on a desktop server.
 * - A plain server that was not started as a machine becomes one for its admin when a hub
 *   connects; its members keep their own Chrome.
 */
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  DesktopBrowserCommand,
  DesktopBrowserEvent,
} from "@prismshadow/penguin-server/api";
import type { AppEnv, UpgradeCaller } from "@prismshadow/penguin-server/plugin";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { BrowserExtensionsRepo } from "@prismshadow/penguin-library-machine/browser-extensions";
import { hubUpgrade } from "../../src/server/hub-ws.js";
import { builtinBrowserRoutes } from "../../src/server/routes.js";
import { BuiltinBrowser } from "../../src/server/service.js";
import { handleError } from "./host.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";

const FAST = {
  settleMs: 0,
  reloadWaitMs: 200,
  loadWaitMs: 500,
  openClaimMs: 1_000,
  closeWaitMs: 500,
  publishDelayMs: 0,
};

let root: string;
const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-hub-"));
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** The server that added the machine, as the machine meets it: the far end of the channel. */
class FakeHub {
  readonly commands: DesktopBrowserCommand[] = [];
  readonly tabs = new Map<number, BuiltinBrowserTab>();
  private nextId = 100;

  constructor(
    readonly socket: WebSocket,
    public backend: "builtin" | "chrome" = "builtin",
    tabs: readonly BuiltinBrowserTab[] = [],
  ) {
    for (const held of tabs) this.tabs.set(held.id, held);
    socket.on("message", (data) => this.receive(JSON.parse(String(data)) as never));
  }

  /** The commands of one kind the hub was sent, oldest first. */
  sent<Op extends DesktopBrowserCommand["op"]>(op: Op) {
    return this.commands.filter(
      (command): command is Extract<DesktopBrowserCommand, { op: Op }> => command.op === op,
    );
  }

  emit(event: DesktopBrowserEvent): void {
    this.socket.send(JSON.stringify({ type: "desktop-browser-event", event }));
  }

  private receive(message: { type: string; id: string; command: DesktopBrowserCommand }): void {
    if (message.type !== "desktop-browser-command") return;
    const command = message.command;
    this.commands.push(command);
    const reply = (ok: boolean, result?: unknown, error?: string) =>
      this.socket.send(
        JSON.stringify({ type: "desktop-browser-reply", id: message.id, ok, result, error }),
      );
    switch (command.op) {
      case "hello":
        return reply(true, { version: 1, backend: this.backend, hub: true });
      case "tabs":
        return reply(true, { tabs: [...this.tabs.values()] });
      case "open-tab": {
        const opened = tab(this.nextId++, {
          url: command.url,
          ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
        });
        this.tabs.set(opened.id, opened);
        reply(true, { tab: opened });
        return this.emit({ kind: "tab", tab: opened });
      }
      case "close-tab":
        this.tabs.delete(command.tabId);
        reply(true, {});
        return this.emit({ kind: "tab-closed", tabId: command.tabId });
      case "activate-tab":
      case "activity":
      case "ping":
        return reply(true, {});
      case "cdp": {
        const expression = expressionOf(command.params);
        if (expression.includes("return document.readyState;")) {
          return reply(true, evaluated("complete"));
        }
        return reply(true, evaluated({ content: "<main>Orders</main>" }));
      }
      default:
        return reply(false, undefined, "unknown_op");
    }
  }
}

interface Machine {
  browser: BuiltinBrowser;
  /** An agent's call on the machine: the local API token, acting for the admin. */
  agent(method: string, url: string, body?: unknown): Promise<Response>;
  /** A signed-in member's call. */
  member(method: string, url: string, body?: unknown): Promise<Response>;
  /** Opens the hub's channel the way the hub does; resolves once the machine said hello. */
  connectHub(backend?: "builtin" | "chrome", tabs?: readonly BuiltinBrowserTab[]): Promise<FakeHub>;
  /** Opens a socket to the endpoint with the given headers, for the refusals. */
  handshake(headers: Record<string, string>): Promise<number>;
}

async function machine(
  opts: { flagged?: boolean; shell?: FakeShell; db?: DatabaseSync } = {},
): Promise<Machine> {
  const store = opts.db === undefined ? undefined : new BrowserExtensionsRepo(opts.db);
  const browser = new BuiltinBrowser({
    port: opts.shell?.port ?? null,
    root,
    publish: () => undefined,
    projectOf: (sessionId) => (sessionId.startsWith("work-") ? "work" : null),
    log: () => undefined,
    sleep: async () => undefined,
    timing: FAST,
    hubLinkTiming: { helloTimeoutMs: 2_000 },
    ...(opts.flagged !== false ? { machine: true } : {}),
    ...(store !== undefined
      ? { chrome: { store, enabled: () => true, publishTo: () => undefined } }
      : {}),
  });
  cleanups.push(async () => {
    browser.dispose();
    await browser.history.flush();
  });
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    const admin = c.req.header("x-test-user") !== "bob";
    c.set("user", { userId: admin ? "admin" : "bob", isAdmin: admin } as UserRow);
    c.set("sessionVia", admin ? "token" : "desktop");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser, {}));
  // The host checks the session cookie before the endpoint runs (`auth: "user"`); here the
  // caller is named by a header instead.
  const endpoint = hubUpgrade({ gate: () => browser, log: () => undefined });
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    const who = req.headers["x-test-user"];
    const caller =
      who === undefined
        ? null
        : ({
            user: { userId: who, isAdmin: who === "admin" },
            sessionVia: "desktop",
          } as unknown as UpgradeCaller);
    endpoint.upgrade(req, socket, head, caller);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const sockets: WebSocket[] = [];
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.terminate();
        server.close(() => resolve());
      }),
  );
  const request = (user: string) => async (method: string, url: string, body?: unknown) =>
    app.request(`/api/builtin-browser${url}`, {
      method,
      headers: {
        "x-test-user": user,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const url = `ws://127.0.0.1:${port}/api/builtin-browser/hub/ws`;
  return {
    browser,
    agent: request("admin"),
    member: request("bob"),
    async connectHub(backend = "builtin", tabs = []) {
      const socket = new WebSocket(url, { headers: { "x-test-user": "admin" } });
      sockets.push(socket);
      const hub = new FakeHub(socket, backend, tabs);
      await until(() => hub.sent("tabs").length > 0, "the machine's hello and tab list");
      return hub;
    },
    handshake(headers) {
      return new Promise((resolve) => {
        const socket = new WebSocket(url, { headers });
        sockets.push(socket);
        socket.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        socket.on("open", () => resolve(101));
        socket.on("error", () => undefined);
      });
    },
  };
}

async function until(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const reasonOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; reason?: string } }).error;

describe("a machine's agents drive the person's browser through the hub", () => {
  it("opens a page for the Session in its Project, and only that Session sees it", async () => {
    const m = await machine();
    const hub = await m.connectHub();
    const opened = await m.agent("POST", "/tabs", {
      url: "https://shop.example/orders",
      sessionId: "work-1",
    });
    expect(opened.status).toBe(200);
    const { tab: page } = await json<{ tab: BuiltinBrowserTab }>(opened);
    expect(page).toMatchObject({ url: "https://shop.example/orders", sessionId: "work-1" });
    expect(hub.sent("open-tab")).toEqual([
      {
        op: "open-tab",
        url: "https://shop.example/orders",
        activate: true,
        sessionId: "work-1",
        projectId: "work",
      },
    ]);

    const own = await json<BuiltinBrowserStatus>(await m.agent("GET", "/status?sessionId=work-1"));
    expect(own).toMatchObject({ available: true, backend: "builtin", activeTabId: page.id });
    expect(own.tabs.map((t) => t.id)).toEqual([page.id]);
    expect(own.backends).toEqual([{ backend: "builtin", available: true }]);
    const other = await json<BuiltinBrowserStatus>(
      await m.agent("GET", "/status?sessionId=work-2"),
    );
    expect(other.tabs).toEqual([]);
    const foreign = await m.agent("POST", `/tabs/${page.id}/scan`, { sessionId: "work-2" });
    expect((await reasonOf(foreign)).code).toBe("no_such_tab");
  });

  it("tells the hub when an action starts and ends, and has the hub close the page", async () => {
    const m = await machine();
    const hub = await m.connectHub();
    const { tab: page } = await json<{ tab: BuiltinBrowserTab }>(
      await m.agent("POST", "/tabs", { url: "https://shop.example/", sessionId: "work-1" }),
    );
    hub.commands.length = 0;
    const scanned = await m.agent("POST", "/tabs/active/scan", { sessionId: "work-1" });
    expect(scanned.status).toBe(200);
    // The end is told as the action settles, without holding up its answer.
    await until(() => hub.sent("activity").some((command) => !command.busy), "the action's end");
    const ops = hub.commands.map((command) =>
      command.op === "activity" ? `activity:${command.busy}` : command.op,
    );
    expect(ops[0]).toBe("activity:true");
    expect(ops.at(-1)).toBe("activity:false");
    expect(ops.slice(1, -1).every((op) => op === "cdp")).toBe(true);
    expect(hub.sent("activity")[0]).toMatchObject({
      tabId: page.id,
      action: "scan",
      sessionId: "work-1",
    });

    const closed = await m.agent("DELETE", `/tabs/${page.id}?sessionId=work-1`);
    expect(closed.status).toBe(204);
    expect(hub.sent("close-tab")).toEqual([{ op: "close-tab", tabId: page.id }]);
  });

  it("refuses raw CDP that reaches the person's cookies, and never sends it", async () => {
    const m = await machine();
    const hub = await m.connectHub();
    const { tab: page } = await json<{ tab: BuiltinBrowserTab }>(
      await m.agent("POST", "/tabs", { url: "https://shop.example/", sessionId: "work-1" }),
    );
    for (const method of ["Network.getAllCookies", "Storage.getCookies", "Target.createTarget"]) {
      const res = await m.agent("POST", `/tabs/${page.id}/cdp`, { method, sessionId: "work-1" });
      expect(res.status).toBe(403);
      expect((await reasonOf(res)).code).toBe("cdp_refused");
    }
    expect(hub.sent("cdp").map((command) => command.method)).not.toContain("Network.getAllCookies");
  });

  it("says the hub is gone while it is, and follows the browser it drives when it is back", async () => {
    const m = await machine();
    const hub = await m.connectHub();
    await m.agent("POST", "/tabs", { url: "https://shop.example/", sessionId: "work-1" });
    hub.socket.close();
    const statusOf = async () =>
      json<BuiltinBrowserStatus>(await m.agent("GET", "/status?sessionId=work-1"));
    await until(async () => (await statusOf()).reason === "hub_disconnected", "hub_disconnected");
    const refused = await m.agent("POST", "/tabs/active/scan", { sessionId: "work-1" });
    expect((await reasonOf(refused)).reason).toBe("hub_disconnected");

    // Back driving the admin's Chrome, with the pages it holds there for this machine.
    await m.connectHub("chrome", [tab(7, { sessionId: "work-1" })]);
    const back = await statusOf();
    expect(back).toMatchObject({ available: true, backend: "chrome", activeTabId: 7 });
    expect(back.tabs.map((t) => [t.id, t.sessionId])).toEqual([[7, "work-1"]]);
  });
});

describe("the hub's endpoint", () => {
  it("takes no browser page, no member and no anonymous caller", async () => {
    const m = await machine();
    expect(await m.handshake({ "x-test-user": "admin", origin: "https://evil.example" })).toBe(403);
    expect(await m.handshake({ "x-test-user": "bob" })).toBe(403);
    expect(await m.handshake({})).toBe(403);
    expect(await m.handshake({ "x-test-user": "admin" })).toBe(101);
  });

  it("is not served by a server inside the desktop app", async () => {
    const m = await machine({ shell: new FakeShell(), flagged: false });
    expect(await m.handshake({ "x-test-user": "admin" })).toBe(404);
  });
});

describe("a plain server a hub connects to", () => {
  it("becomes a machine for its admin, and its members keep their own Chrome", async () => {
    const db = openDatabase(":memory:");
    cleanups.push(() => db.close());
    const m = await machine({ flagged: false, db });
    const before = await json<BuiltinBrowserStatus>(await m.agent("GET", "/status"));
    expect(before).toMatchObject({ backend: "chrome", reason: "extension_not_paired" });
    await m.connectHub();
    const after = await json<BuiltinBrowserStatus>(await m.agent("GET", "/status"));
    expect(after).toMatchObject({ available: true, backend: "builtin" });
    const member = await json<BuiltinBrowserStatus>(await m.member("GET", "/status"));
    expect(member).toMatchObject({ backend: "chrome", reason: "extension_not_paired" });
  });
});
