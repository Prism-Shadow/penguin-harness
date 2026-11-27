/**
 * A machine's Session drives the person's browser on the hub, end to end over a real channel: the
 * hub's browser (a fake desktop shell under it, and its window claiming the pages it is asked
 * for), its relay (machine-relay.ts) dialling the machine over a real WebSocket, and the
 * machine's own browser module behind its hub endpoint (hub-ws.ts) and its routes, which the
 * machine's agents call. The only fakes are the shell and the dial's transport (plain TCP for
 * the ssh connection).
 *
 * - An agent on the machine opens a page: the hub's window creates it in the Session's Project
 *   partition, the page is held for that Session and machine, and the agent gets it back.
 * - The agent's action runs in the person's browser, and the hub's window shows it at work.
 * - The hub's panel opens a page for a machine's conversation once the machine vouches for the
 *   Session, and the machine's agents see it.
 * - The admin switching to their Chrome re-dials the channel; with no Chrome paired the machine's
 *   agents hear exactly that.
 * - A machine that asks for more than its own pages — another page, a Project it does not serve,
 *   the person's cookies, a cookie command — is refused, and the shell never hears it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BrowserBackend,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "@prismshadow/penguin-server/api";
import type { AppEnv, UpgradeCaller } from "@prismshadow/penguin-server/plugin";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { BrowserExtensionsRepo } from "@prismshadow/penguin-library-machine/browser-extensions";
import { hubUpgrade } from "../../src/server/hub-ws.js";
import { MachineRelays } from "../../src/server/machine-relay.js";
import { builtinBrowserRoutes } from "../../src/server/routes.js";
import { BuiltinBrowser } from "../../src/server/service.js";
import { handleError } from "./host.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";

const FAST = {
  helloTimeoutMs: 2_000,
  helloRetryMs: 60_000,
  settleMs: 0,
  reloadWaitMs: 200,
  loadWaitMs: 500,
  popupClaimMs: 200,
  clickGapMs: 0,
  openClaimMs: 2_000,
  closeWaitMs: 500,
  publishDelayMs: 0,
};
const MACHINE = "QS7J4YVgSovi-Z2c";
const ADMIN = { userId: "admin", isAdmin: true };
const MACHINE_COOKIE = "penguin_session=minted-on-the-machine";
const partitionOf = (projectId: string) =>
  `persist:penguin-browser-project-${createHash("sha256").update(projectId).digest("hex")}`;

let root: string;
const cleanups: (() => Promise<void> | void)[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-relay-"));
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function until(ready: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; reason?: string } }).error;

function routesApp(browser: BuiltinBrowser, deps: Parameters<typeof builtinBrowserRoutes>[1]) {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", ADMIN as UserRow);
    c.set("sessionVia", c.req.header("x-agent") === "1" ? "token" : "desktop");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser, deps));
  return (method: string, url: string, body?: unknown, agent = false) =>
    Promise.resolve(
      app.request(`/api/builtin-browser${url}`, {
        method,
        headers: {
          ...(agent ? { "x-agent": "1" } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
}

/** An http server whose upgrades go to `endpoint`, as the admin the cookie names. */
async function upgradeServer(
  upgrade: (
    req: http.IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
    caller: UpgradeCaller | null,
  ) => void,
): Promise<number> {
  const server = http.createServer();
  server.on("upgrade", (req, socket, head) => {
    const caller =
      req.headers.cookie === MACHINE_COOKIE
        ? ({
            user: { userId: "admin", isAdmin: true },
            sessionVia: "desktop",
          } as unknown as UpgradeCaller)
        : null;
    upgrade(req, socket, head, caller);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

interface Pair {
  shell: FakeShell;
  hub: BuiltinBrowser;
  /** What the hub's admin windows heard. */
  events: BuiltinBrowserServerEvent[];
  relays: MachineRelays;
  /** A call on the hub's own routes, from its window. */
  hubCall(method: string, url: string, body?: unknown): Promise<Response>;
  /** An agent's call on the machine. */
  agent(method: string, url: string, body?: unknown): Promise<Response>;
  claims: string[];
}

/**
 * The hub and one machine. The hub's window creates every page it is asked for (tab ids from
 * 21), and its shell answers every page as loaded, and a scan with "Orders".
 */
async function pair(opts: { machinePort?: number; chrome?: boolean } = {}): Promise<Pair> {
  const shell = new FakeShell();
  shell.cdp = (_tabId, method, params) => {
    const expression = expressionOf(params);
    if (method === "Runtime.evaluate" && expression.includes("return document.readyState;")) {
      return evaluated("complete");
    }
    return evaluated({ content: "<main>Orders</main>" });
  };
  const events: BuiltinBrowserServerEvent[] = [];
  let db: DatabaseSync | null = null;
  if (opts.chrome === true) {
    db = openDatabase(":memory:");
    cleanups.push(() => db?.close());
  }
  const chosen = new Map<string, BrowserBackend>();
  let windowClaim: ((event: BuiltinBrowserServerEvent) => void) | null = null;
  const hub = new BuiltinBrowser({
    port: shell.port,
    root: path.join(root, "hub"),
    publish: (event) => {
      events.push(event);
      windowClaim?.(event);
    },
    log: () => undefined,
    sleep: async () => undefined,
    timing: FAST,
    ...(db !== null
      ? {
          chrome: {
            store: new BrowserExtensionsRepo(db),
            enabled: () => true,
            publishTo: () => undefined,
          },
          prefs: {
            get: (userId: string) => chosen.get(userId) ?? null,
            set: (userId: string, backend: BrowserBackend) => void chosen.set(userId, backend),
          },
        }
      : {}),
  });
  cleanups.push(async () => {
    hub.dispose();
    await hub.history.flush();
  });
  // The hub holds its own Sessions (none here but `local-…`); a `work-…` one is the machine's.
  const hubCall = routesApp(hub, {
    resourceAccess: {
      access: { requireProjectAccess: () => undefined },
      sessions: {
        findById: (id: string) =>
          (id.startsWith("local-") ? { sessionId: id, projectId: "work" } : null) as ReturnType<
            import("@prismshadow/penguin-server/plugin").SessionIndex["findById"]
          >,
      },
    } as unknown as import("@prismshadow/penguin-server/plugin").SessionResourceAccess,
    sessionMachine: async (projectId, sessionId, named) =>
      projectId === "work" && sessionId.startsWith("work-") && (named ?? MACHINE) === MACHINE
        ? MACHINE
        : null,
  });
  // The hub's window: creates the guest a page is asked for — the shell reports it as it
  // attaches — and claims the request with it.
  let nextGuest = 21;
  /** The window's claims that the hub did not take, for a failure to say why. */
  const claims: string[] = [];
  windowClaim = (event) => {
    if (event.type !== "builtin_browser_open") return;
    const id = nextGuest++;
    setImmediate(() => {
      shell.show(tab(id, { url: event.url }));
      void hubCall("POST", "/tabs/claim", { requestId: event.requestId, tabId: id })
        .then(async (res) => {
          if (res.status !== 204) claims.push(`${res.status} ${await res.text()}`);
        })
        .catch((err: unknown) => claims.push(String(err)));
    });
  };

  let machinePort = opts.machinePort;
  let agent: Pair["agent"] = async () => new Response(null, { status: 500 });
  if (machinePort === undefined) {
    const machine = new BuiltinBrowser({
      port: null,
      root: path.join(root, "machine"),
      publish: () => undefined,
      projectOf: (sessionId) => (sessionId.startsWith("work-") ? "work" : null),
      log: () => undefined,
      sleep: async () => undefined,
      timing: FAST,
      hubLinkTiming: { helloTimeoutMs: 2_000 },
      machine: true,
    });
    cleanups.push(async () => {
      machine.dispose();
      await machine.history.flush();
    });
    const endpoint = hubUpgrade({ gate: () => machine, log: () => undefined });
    machinePort = await upgradeServer((req, socket, head, caller) =>
      endpoint.upgrade(req, socket, head, caller),
    );
    const call = routesApp(machine, {});
    agent = (method, url, body) => call(method, url, body, true);
  }
  const port = machinePort;
  const httpAgent = new http.Agent();
  cleanups.push(() => httpAgent.destroy());
  const relays = new MachineRelays({
    browser: hub,
    admin: ADMIN,
    projectIds: () => ["work"],
    machines: async () => [{ machineId: MACHINE, connected: true }],
    dial: async () => ({ agent: httpAgent, port, cookie: MACHINE_COOKIE }),
    log: () => undefined,
    sweepMs: 60_000,
  });
  cleanups.push(() => relays.dispose());
  await relays.sweep();
  return { shell, hub, events, relays, hubCall, agent, claims };
}

/** Waits until the machine's agents can drive the browser through the channel. */
async function linked(p: Pair): Promise<void> {
  await until(
    async () =>
      (await json<BuiltinBrowserStatus>(await p.agent("GET", "/status?sessionId=work-1")))
        .available,
    "the channel",
  );
}

describe("a machine's Session in the person's browser on the hub", () => {
  it("opens a page in its Session's Project, held for that Session and machine", async () => {
    const p = await pair();
    await linked(p);
    const opened = await p.agent("POST", "/tabs", {
      url: "https://shop.example/orders",
      sessionId: "work-1",
    });
    expect(opened.status, p.claims.join("; ")).toBe(200);
    const { tab: page } = await json<{ tab: BuiltinBrowserTab }>(opened);
    expect(page).toMatchObject({ id: 21, url: "https://shop.example/orders", sessionId: "work-1" });

    const asked = p.events.find((event) => event.type === "builtin_browser_open");
    expect(asked).toMatchObject({ sessionId: "work-1", partition: partitionOf("work") });
    expect(p.hub.tabs.get(21)).toMatchObject({ sessionId: "work-1", machineId: MACHINE });
    const status = await json<BuiltinBrowserStatus>(
      await p.agent("GET", "/status?sessionId=work-1"),
    );
    expect(status).toMatchObject({ backend: "builtin", activeTabId: 21 });
  });

  it("runs the agent's action in the person's browser, and the hub's window shows it at work", async () => {
    const p = await pair();
    await linked(p);
    await p.agent("POST", "/tabs", { url: "https://shop.example/", sessionId: "work-1" });
    p.shell.commands.length = 0;
    const scanned = await p.agent("POST", "/tabs/active/scan", { sessionId: "work-1" });
    expect(scanned.status).toBe(200);
    expect(await json<{ content: string }>(scanned)).toMatchObject({
      content: "<main>Orders</main>",
    });
    expect(
      p.shell.commands.some(
        (command) => command.op === "cdp" && expressionOf(command.params).includes("__penguinScan"),
      ),
    ).toBe(true);
    // The end of an action is told as it settles, without holding up its answer.
    await until(
      () => p.events.filter((event) => event.type === "builtin_browser_activity").length >= 2,
      "the action's end",
    );
    const activity = p.events.filter((event) => event.type === "builtin_browser_activity");
    expect(activity.map((event) => [event.tabId, event.busy, event.sessionId])).toEqual([
      [21, true, "work-1"],
      [21, false, "work-1"],
    ]);
  });

  it("opens a page from the hub's panel once the machine vouches for the Session", async () => {
    const p = await pair();
    await linked(p);
    const refused = await p.hubCall("POST", "/tabs", {
      sessionId: "elsewhere-1",
      projectId: "work",
      machineId: MACHINE,
    });
    expect(refused.status).toBe(404);
    const opened = await p.hubCall("POST", "/tabs", {
      url: "https://docs.example/",
      sessionId: "work-2",
      projectId: "work",
      machineId: MACHINE,
    });
    expect(opened.status).toBe(200);
    const { tab: page } = await json<{ tab: BuiltinBrowserTab }>(opened);
    expect(page).toMatchObject({ sessionId: "work-2", machineId: MACHINE });
    await until(
      async () =>
        (
          await json<BuiltinBrowserStatus>(await p.agent("GET", "/status?sessionId=work-2"))
        ).tabs.some((t) => t.id === page.id),
      "the machine to hear of the page",
    );
  });

  it("opens a link from a machine's conversation for that machine, found without being named", async () => {
    const p = await pair();
    await linked(p);
    const opened = await p.hubCall("POST", "/tabs", {
      url: "https://docs.example/a-link",
      sessionId: "work-3",
      projectId: "work",
    });
    expect(opened.status).toBe(200);
    expect((await json<{ tab: BuiltinBrowserTab }>(opened)).tab).toMatchObject({
      sessionId: "work-3",
      machineId: MACHINE,
    });
    const nowhere = await p.hubCall("POST", "/tabs", { sessionId: "gone-1", projectId: "work" });
    expect(nowhere.status).toBe(404);
    const cleared = await p.hubCall("POST", "/clear-data", {
      storages: ["cookies"],
      sessionId: "work-3",
      projectId: "work",
    });
    expect(cleared.status).toBe(204);
    expect(p.shell.commands.find((command) => command.op === "clear-data")).toMatchObject({
      partition: partitionOf("work"),
    });
  });

  it("follows the admin to their Chrome, and says when none is paired", async () => {
    const p = await pair({ chrome: true });
    await linked(p);
    p.hub.setBackend(ADMIN, "chrome");
    await until(
      async () =>
        (await json<BuiltinBrowserStatus>(await p.agent("GET", "/status?sessionId=work-1")))
          .backend === "chrome",
      "the machine to follow",
    );
    const opened = await p.agent("POST", "/tabs", {
      url: "https://shop.example/",
      sessionId: "work-1",
    });
    expect(opened.status).toBe(503);
    expect((await errorOf(opened)).reason).toBe("extension_not_paired");
  });
});

describe("what the hub refuses a machine", () => {
  it("carries out nothing beyond the machine's own pages, Projects and the page itself", async () => {
    // A machine that asks for more than it may: it speaks the channel by hand.
    const replies = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
    let channel: WebSocket | null = null;
    const wss = new WebSocketServer({ noServer: true });
    cleanups.push(() => wss.close());
    const port = await upgradeServer((req, socket, head, caller) => {
      if (caller === null) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => {
        channel = ws;
        ws.on("message", (data) => {
          const message = JSON.parse(String(data)) as { id: string; ok: boolean };
          replies.set(message.id, message);
        });
      });
    });
    const p = await pair({ machinePort: port });
    await until(() => channel !== null, "the hub to dial");
    let seq = 0;
    const ask = async (command: Record<string, unknown>) => {
      const id = `rogue-${++seq}`;
      channel!.send(JSON.stringify({ type: "desktop-browser-command", id, command }));
      await until(() => replies.has(id), `the answer to ${String(command.op)}`);
      return replies.get(id)!;
    };

    expect(await ask({ op: "hello" })).toMatchObject({
      ok: true,
      result: { version: 1, backend: "builtin", hub: true },
    });
    const mine = await ask({
      op: "open-tab",
      url: "https://shop.example/",
      activate: true,
      sessionId: "work-1",
      projectId: "work",
    });
    expect(mine, JSON.stringify(mine)).toMatchObject({ ok: true });
    const mineId = (mine.result as { tab: BuiltinBrowserTab }).tab.id;
    // A page of the hub's own conversation.
    const ownAnnounced = p.hubCall("POST", "/tabs", {
      url: "https://bank.example/",
      sessionId: "local-1",
    });
    await ownAnnounced;
    const local = [...p.shell.guests.keys()].find((id) => id !== mineId)!;
    p.shell.commands.length = 0;

    const refusals = await Promise.all([
      ask({ op: "cdp", tabId: local, method: "Runtime.evaluate", params: { expression: "1" } }),
      ask({ op: "close-tab", tabId: local }),
      ask({ op: "cdp", tabId: mineId, method: "Network.getAllCookies" }),
      ask({ op: "cdp", tabId: mineId, method: "Storage.getCookies" }),
      ask({
        op: "cdp",
        tabId: mineId,
        method: "Page.navigate",
        params: { url: "file:///etc/passwd" },
      }),
      ask({ op: "set-cookies", cookies: [] }),
      ask({ op: "clear-data", storages: ["cookies"] }),
      ask({
        op: "open-tab",
        url: "https://x.example/",
        activate: true,
        sessionId: "work-1",
        projectId: "other",
      }),
    ]);
    expect(refusals.map((reply) => reply.error)).toEqual([
      "no_such_tab",
      "no_such_tab",
      "cdp_refused",
      "cdp_refused",
      "bad_url",
      "unknown_op",
      "unknown_op",
      "no_such_session",
    ]);
    expect(p.shell.commands.filter((command) => command.op !== "throttle")).toEqual([]);
    const tabs = await ask({ op: "tabs" });
    expect((tabs.result as { tabs: BuiltinBrowserTab[] }).tabs.map((t) => t.id)).toEqual([mineId]);
  });
});
