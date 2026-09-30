/**
 * The built-in browser under load and failure, over a fake shell: a tab whose page crashed (and
 * one that crashes under an action), the shell's load measurements and the verdict the windows
 * hear, which tabs the shell is told to throttle, the tab list reaching the windows once per
 * burst, and shell traffic that fails without taking the server with it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserMetrics,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
} from "../../src/api/types.js";
import type { AppEnv } from "../../src/auth/middleware.js";
import type { UserRow } from "../../src/db/repos/users.js";
import { handleError } from "../../src/http/errors.js";
import { builtinBrowserRoutes } from "../../src/builtin-browser/routes.js";
import { BuiltinBrowser } from "../../src/builtin-browser/service.js";
import type { BrowserTiming } from "../../src/builtin-browser/service.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";

const GB = 1024 * 1024;

let root: string;
const browsers: BuiltinBrowser[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-resilience-"));
});
afterEach(async () => {
  for (const b of browsers.splice(0)) {
    b.dispose();
    await b.history.flush();
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface Harness {
  shell: FakeShell;
  browser: BuiltinBrowser;
  events: BuiltinBrowserServerEvent[];
  logs: string[];
  call(method: string, url: string, body?: unknown): Promise<Response>;
}

function mount(
  opts: {
    timing?: Partial<BrowserTiming>;
    publish?: (event: BuiltinBrowserServerEvent) => void;
    platform?: string;
    free?: number;
  } = {},
): Harness {
  const shell = new FakeShell();
  const events: BuiltinBrowserServerEvent[] = [];
  const logs: string[] = [];
  const browser = new BuiltinBrowser({
    port: shell.port,
    root,
    publish: opts.publish ?? ((event) => events.push(event)),
    log: (line) => logs.push(line),
    sleep: async () => {},
    timing: {
      helloTimeoutMs: 50,
      settleMs: 0,
      reloadWaitMs: 200,
      loadWaitMs: 300,
      openClaimMs: 300,
      publishDelayMs: 0,
      throttleGraceMs: 60_000,
      ...opts.timing,
    },
    platform: opts.platform ?? "linux",
    systemMemory: () => ({ freeBytes: opts.free ?? 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3 }),
  });
  browsers.push(browser);
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", { userId: "admin", isAdmin: true } as UserRow);
    c.set("sessionVia", "token");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser));
  return {
    shell,
    browser,
    events,
    logs,
    call: async (method, url, body) =>
      app.request(`/api/builtin-browser${url}`, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
  };
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) =>
  (await res.json()) as { error: { code: string; message: string } };
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}
/** Connected, with these tabs in the registry. */
async function connected(h: Harness, ...ids: number[]): Promise<void> {
  for (const id of ids) h.shell.guests.set(id, tab(id));
  await h.call("GET", "/status");
  await until(() => ids.every((id) => h.browser.tabs.has(id)), "the tabs");
}
const lastTabs = (h: Harness) =>
  h.events.filter((e) => e.type === "builtin_browser_tabs").at(-1) as
    Extract<BuiltinBrowserServerEvent, { type: "builtin_browser_tabs" }> | undefined;

describe("a crashed tab", () => {
  it("is marked with why, and an agent action on it answers tab_crashed at once", async () => {
    const h = mount();
    await connected(h, 3, 4);
    h.shell.crash(3, "oom");
    await until(() => lastTabs(h)?.tabs.some((t) => t.crashed === "oom") === true, "the crash");
    expect(h.logs).toContain("builtin browser: tab 3's page crashed (oom, exit code 9)");

    const cdpBefore = h.shell.commands.filter((c) => c.op === "cdp").length;
    for (const [action, body] of [
      ["exec", { script: "return 1" }],
      ["scan", {}],
      ["navigate", { url: "https://example.test/" }],
      ["screenshot", {}],
    ] as const) {
      const res = await h.call("POST", `/tabs/3/${action}`, body);
      expect(res.status).toBe(409);
      const { error } = await errorOf(res);
      expect(error.code).toBe("tab_crashed");
      expect(error.message).toContain("Tab 3's page crashed (oom)");
      expect(error.message).toContain("penguin browser close 3");
    }
    // Refused here: nothing went to the dead page.
    expect(h.shell.commands.filter((c) => c.op === "cdp").length).toBe(cdpBefore);
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status.tabs.find((t) => t.id === 3)?.crashed).toBe("oom");
  });

  it("turns whatever an action's crashing page left behind into tab_crashed", async () => {
    const h = mount();
    await connected(h, 5);
    h.shell.cdp = (tabId, method, params) => {
      if (method === "Runtime.evaluate" && expressionOf(params).includes("__crash_me__")) {
        h.shell.crash(tabId, "killed");
        throw new Error("target closed while handling command");
      }
      return method === "Runtime.evaluate" ? evaluated("complete") : {};
    };
    const res = await h.call("POST", "/tabs/5/exec", { script: "__crash_me__()", noMonitor: true });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error.message).toContain("Tab 5's page crashed (killed)");
  });

  it("works again once the shell reports the page reloaded", async () => {
    const h = mount();
    await connected(h, 6);
    h.shell.crash(6);
    await until(() => h.browser.tabs.get(6)?.crashed !== undefined, "the crash");
    h.shell.show(tab(6));
    await until(() => h.browser.tabs.get(6)?.crashed === undefined, "the reload");
    h.shell.cdp = (_tabId, method) =>
      method === "Runtime.evaluate" ? evaluated(JSON.stringify({ ok: true, data: 42 })) : {};
    const res = await h.call("POST", "/tabs/6/exec", { script: "return 42", noMonitor: true });
    expect(res.status).toBe(200);
    expect((await json<{ value: unknown }>(res)).value).toBe(42);
  });
});

describe("load", () => {
  it("judges each measurement, keeps it for the status, and sends it to the windows", async () => {
    const h = mount({ free: 1 * 1024 ** 3 });
    await connected(h, 1, 2);
    // Tab 9 closed after the shell measured it: it is left out.
    h.shell.measure([
      { tabId: 1, memoryKB: 1_200_000, cpuPercent: 12.5 },
      { tabId: 2, memoryKB: 500_000 },
      { tabId: 9, memoryKB: 100_000 },
    ]);
    await until(() => h.events.some((e) => e.type === "builtin_browser_metrics"), "the metrics");
    const sent = h.events.find((e) => e.type === "builtin_browser_metrics") as {
      metrics: BuiltinBrowserMetrics;
    };
    expect(sent.metrics).toMatchObject({
      tabs: [
        { tabId: 1, memoryKB: 1_200_000, cpuPercent: 12.5 },
        { tabId: 2, memoryKB: 500_000, cpuPercent: 0 },
      ],
      totalKB: 1_800_000,
      system: { freeKB: GB, totalKB: 16 * GB },
      warnings: ["memory", "low_system_memory"],
      heavyTabIds: [1, 2],
    });
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status.metrics).toEqual(sent.metrics);
  });

  it("leaves the system's memory out on macOS", async () => {
    const h = mount({ platform: "darwin", free: 10 * 1024 ** 2 });
    await connected(h, 1);
    h.shell.measure([{ tabId: 1, memoryKB: 200 * 1024 }]);
    await until(() => h.events.some((e) => e.type === "builtin_browser_metrics"), "the metrics");
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status.metrics?.system).toBeUndefined();
    expect(status.metrics?.warnings).toEqual([]);
  });

  it("ignores a measurement that is not one", async () => {
    const h = mount();
    await connected(h, 1);
    h.shell.port.emit({
      type: "desktop-browser-event",
      event: { kind: "metrics", tabs: [{ tabId: 1, memoryKB: -5, cpuPercent: 0 }], totalKB: 1 },
    });
    h.shell.port.emit({ type: "desktop-browser-event", event: { kind: "metrics", tabs: "all" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.events.some((e) => e.type === "builtin_browser_metrics")).toBe(false);
  });
});

describe("throttling", () => {
  it("lets the shell throttle every tab nobody is driving", async () => {
    const h = mount();
    await connected(h, 4, 7);
    await until(() => h.shell.throttled.at(-1)?.join() === "4,7", "the throttled tabs");
  });

  it("keeps the tab a window shows at full speed, and throttles the one it replaced", async () => {
    const h = mount();
    await connected(h, 4, 7);
    await until(() => h.shell.throttled.at(-1)?.join() === "4,7", "the throttled tabs");
    expect((await h.call("POST", "/tabs/on-screen", { tabId: 7 })).status).toBe(204);
    await until(() => h.shell.throttled.at(-1)?.join() === "4", "tab 7 on screen");
    await h.call("POST", "/tabs/on-screen", { tabId: 4 });
    await until(() => h.shell.throttled.at(-1)?.join() === "7", "tab 4 on screen");
    // None on screen (the panel closed, the window hidden): all of them.
    await h.call("POST", "/tabs/on-screen", { tabId: null });
    await until(() => h.shell.throttled.at(-1)?.join() === "4,7", "none on screen");
    for (const tabId of ["7", -1, 1.5, undefined]) {
      expect((await h.call("POST", "/tabs/on-screen", { tabId })).status).toBe(400);
    }
  });

  it("runs a tab at full speed before an agent's action reaches it, and for a grace after", async () => {
    const h = mount({ timing: { throttleGraceMs: 40 } });
    await connected(h, 4, 7);
    await until(() => h.shell.throttled.at(-1)?.join() === "4,7", "the throttled tabs");
    h.shell.cdp = (_tabId, method) =>
      method === "Runtime.evaluate" ? evaluated(JSON.stringify({ ok: true, data: 1 })) : {};
    const res = await h.call("POST", "/tabs/4/exec", { script: "return 1", noMonitor: true });
    expect(res.status).toBe(200);
    // The command that lifted tab 4's throttling went out before the action's first CDP command.
    const unthrottle = h.shell.commands.findIndex(
      (c) => c.op === "throttle" && c.tabIds.join() === "7",
    );
    const firstCdp = h.shell.commands.findIndex((c) => c.op === "cdp" && c.tabId === 4);
    expect(unthrottle).toBeGreaterThanOrEqual(0);
    expect(unthrottle).toBeLessThan(firstCdp);
    // Still at full speed right after, throttled again once the grace has passed.
    expect(h.shell.throttled.at(-1)?.join()).toBe("7");
    await until(() => h.shell.throttled.at(-1)?.join() === "4,7", "the grace to end");
  });

  it("gives a new tab the grace from the moment it appears", async () => {
    const h = mount();
    await connected(h, 1);
    const opening = h.call("POST", "/tabs", { url: "https://example.test/new" });
    await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the open");
    const open = h.events.find((e) => e.type === "builtin_browser_open") as { requestId: string };
    h.shell.cdp = (_tabId, method) => (method === "Runtime.evaluate" ? evaluated("complete") : {});
    h.shell.show(tab(8, { url: "https://example.test/new" }));
    await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 8 });
    expect((await opening).status).toBe(200);
    await until(() => h.shell.throttled.at(-1)?.join() === "1", "the new tab at full speed");
    // It was never throttled on its way in.
    expect(h.shell.throttled.some((list) => list.includes(8))).toBe(false);
  });

  it("stops asking a shell too old to throttle", async () => {
    const h = mount();
    h.shell.throttles = false;
    await connected(h, 1);
    await until(() => h.shell.commands.some((c) => c.op === "throttle"), "the first ask");
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.shell.show(tab(2));
    h.shell.close(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.shell.commands.filter((c) => c.op === "throttle")).toHaveLength(1);
  });
});

describe("the tab list to the windows", () => {
  it("goes once per burst of tab events, and not at all when nothing changed", async () => {
    const h = mount({ timing: { publishDelayMs: 20 } });
    await connected(h, 1);
    await until(() => lastTabs(h) !== undefined, "the first list");
    const before = h.events.filter((e) => e.type === "builtin_browser_tabs").length;
    for (let n = 0; n < 10; n++) h.shell.show(tab(1, { title: `Churn ${n}` }));
    await until(() => lastTabs(h)?.tabs[0]?.title === "Churn 9", "the burst");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.events.filter((e) => e.type === "builtin_browser_tabs").length).toBe(before + 1);
    // The same state again: nothing new to say.
    h.shell.show(tab(1, { title: "Churn 9" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.events.filter((e) => e.type === "builtin_browser_tabs").length).toBe(before + 1);
  });

  it("drops a data: favicon too large to ride every list", async () => {
    const h = mount();
    await connected(h, 1);
    const small = `data:image/png;base64,${"A".repeat(1_000)}`;
    const large = `data:image/png;base64,${"A".repeat(8_000)}`;
    h.shell.show(tab(1, { favicon: small }));
    await until(() => h.browser.tabs.get(1)?.favicon === small, "the small icon");
    h.shell.show(tab(1, { favicon: large }));
    await until(() => h.browser.tabs.get(1)?.favicon === undefined, "the large icon dropped");
  });
});

describe("shell traffic that fails", () => {
  it("never throws out of the port: a failing event is logged and the next one works", async () => {
    const h = mount();
    await connected(h, 1);
    const observe = h.browser.history.observe.bind(h.browser.history);
    h.browser.history.observe = () => {
      throw new Error("boom");
    };
    expect(() => h.shell.show(tab(1, { url: "https://example.test/next" }))).not.toThrow();
    expect(h.logs).toContain("builtin browser: the shell's 'tab' event failed: boom");
    h.browser.history.observe = observe;
    h.shell.show(tab(1, { title: "Fine again" }));
    expect(h.browser.tabs.get(1)?.title).toBe("Fine again");
  });

  it("keeps going when sending to the windows fails", async () => {
    let fail = true;
    const events: BuiltinBrowserServerEvent[] = [];
    const h = mount({
      timing: { publishDelayMs: 5 },
      publish: (event) => {
        if (fail) throw new Error("channel closed");
        events.push(event);
      },
    });
    await connected(h, 1);
    await until(
      () => h.logs.some((l) => l.includes("the tab list could not be sent: channel closed")),
      "the failure logged",
    );
    fail = false;
    h.shell.show(tab(1, { title: "Later" }));
    await until(() => events.some((e) => e.type === "builtin_browser_tabs"), "the next list");
  });
});
