/**
 * /api/builtin-browser over a fake shell, with the browser mounted directly (short timings,
 * an injected importer): availability and its 503 reasons, the admin gate, opening a tab
 * through a window's claim, and the shape of what each agent action answers.
 *
 * module.test.ts covers the same routes assembled in the real platform tree.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserExecResult,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserScanResult,
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "../../src/api/types.js";
import type { AppEnv } from "../../src/auth/middleware.js";
import type { UserRow } from "../../src/db/repos/users.js";
import { handleError } from "../../src/http/errors.js";
import { builtinBrowserRoutes } from "../../src/builtin-browser/routes.js";
import { BuiltinBrowser, browserUrl } from "../../src/builtin-browser/service.js";
import type { Importer } from "../../src/builtin-browser/service.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";
import type { CdpHandler } from "./fake-shell.js";

const FAST = {
  helloTimeoutMs: 50,
  helloRetryMs: 60_000,
  settleMs: 0,
  reloadWaitMs: 200,
  loadWaitMs: 500,
  popupClaimMs: 200,
  clickGapMs: 0,
  openClaimMs: 300,
  closeWaitMs: 200,
  publishDelayMs: 0,
};

let root: string;
const browsers: BuiltinBrowser[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-routes-"));
});
afterEach(async () => {
  for (const b of browsers.splice(0)) {
    b.dispose();
    // The history's last write is under way; the directory goes after it.
    await b.history.flush();
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface Harness {
  shell: FakeShell;
  browser: BuiltinBrowser;
  events: BuiltinBrowserServerEvent[];
  call(method: string, url: string, body?: unknown): Promise<Response>;
}

function mount(
  opts: {
    shell?: FakeShell | null;
    admin?: boolean;
    importer?: Importer;
    now?: () => number;
    log?: (line: string) => void;
  } = {},
): Harness {
  const shell = opts.shell === undefined ? new FakeShell() : opts.shell;
  const events: BuiltinBrowserServerEvent[] = [];
  const browser = new BuiltinBrowser({
    port: shell?.port ?? null,
    root,
    publish: (event) => events.push(event),
    log: opts.log ?? (() => {}),
    sleep: async () => {},
    timing: FAST,
    ...(opts.importer ? { importer: opts.importer } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  browsers.push(browser);
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    const isAdmin = opts.admin !== false;
    c.set("user", { userId: isAdmin ? "admin" : "bob", isAdmin } as UserRow);
    c.set("sessionVia", "token");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser));
  return {
    shell: shell ?? new FakeShell(),
    browser,
    events,
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
  (await res.json()) as { error: { code: string; message: string; reason?: string } };
const flush = () => new Promise((resolve) => setImmediate(resolve));
/** Lets the fake shell's replies and the browser's timers run until `ready()` holds. */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}
function openEvent(events: BuiltinBrowserServerEvent[]) {
  const open = events.find((e) => e.type === "builtin_browser_open");
  if (open?.type !== "builtin_browser_open") throw new Error("no open event");
  return open;
}

/**
 * A page for the fake shell: answers readyState, the monitor's begin and end, and hands the
 * exec script (and anything else) to `rest`.
 */
function page(
  rest: CdpHandler,
  monitor: { transients?: string[]; changed?: number; topChange?: string; lost?: boolean } = {},
): CdpHandler {
  return (tabId, method, params) => {
    const expression = expressionOf(params);
    if (method === "Runtime.evaluate") {
      if (expression.includes("return document.readyState;")) return evaluated("complete");
      if (expression.includes("startStrMonitor(450);")) return evaluated(true);
      if (expression.includes("findChangedElements(snap,")) {
        return evaluated(
          monitor.lost
            ? { lost: true }
            : {
                transients: monitor.transients ?? [],
                changed: monitor.changed ?? 0,
                ...(monitor.topChange ? { topChange: monitor.topChange } : {}),
              },
        );
      }
    }
    return rest(tabId, method, params);
  };
}

describe("availability", () => {
  it("is not_desktop without a shell port, and says so with a reason on every action", async () => {
    const h = mount({ shell: null });
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status).toEqual({
      available: false,
      reason: "not_desktop",
      tabs: [],
      activeTabId: null,
    });
    const res = await h.call("POST", "/tabs/active/scan", {});
    expect(res.status).toBe(503);
    expect((await errorOf(res)).error).toMatchObject({
      code: "browser_unavailable",
      reason: "not_desktop",
    });
  });

  it("is shell_unsupported when the shell never answers hello", async () => {
    const shell = new FakeShell();
    shell.speaksBrowser = false;
    const h = mount({ shell });
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status).toMatchObject({ available: false, reason: "shell_unsupported" });
    const res = await h.call("GET", "/tabs");
    expect(res.status).toBe(503);
    expect((await errorOf(res)).error.reason).toBe("shell_unsupported");
  });

  it("is available once the shell answers, with the tabs it already hosts", async () => {
    const shell = new FakeShell();
    shell.guests.set(4, tab(4));
    shell.guests.set(7, tab(7));
    const h = mount({ shell });
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status).toEqual({ available: true, tabs: [tab(4), tab(7)], activeTabId: 7 });
  });

  it("is for admins only, status included", async () => {
    const h = mount({ admin: false });
    for (const [method, url] of [
      ["GET", "/status"],
      ["GET", "/history"],
      ["POST", "/tabs/active/exec"],
    ] as const) {
      const res = await h.call(method, url, method === "POST" ? { script: "1" } : undefined);
      expect(res.status).toBe(403);
      expect((await errorOf(res)).error.code).toBe("admin_required");
    }
  });
});

describe("tabs", () => {
  it("opens a tab through a window's claim, then waits for the page to load", async () => {
    const h = mount();
    h.shell.cdp = page(() => ({}));
    const opening = h.call("POST", "/tabs", { url: "example.test/start", sessionId: "s1" });
    await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the open event");
    const open = openEvent(h.events);
    expect(open).toMatchObject({
      url: "https://example.test/start",
      activate: true,
      sessionId: "s1",
    });
    // The window creates the <webview>, the shell reports it, the window claims it.
    h.shell.show(tab(21, { url: "https://example.test/start", title: "Start" }));
    const claim = await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 21 });
    expect(claim.status).toBe(204);
    // A second window's claim of the same request is a duplicate it should remove.
    const again = await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 22 });
    expect(again.status).toBe(409);
    expect((await errorOf(again)).error.code).toBe("already_claimed");
    const res = await opening;
    expect(res.status).toBe(200);
    expect((await json<{ tab: BuiltinBrowserTab }>(res)).tab).toMatchObject({
      id: 21,
      title: "Start",
    });
    expect(h.browser.tabs.activeTabId).toBe(21);
    await until(
      () => h.events.some((e) => e.type === "builtin_browser_tabs" && e.activeTabId === 21),
      "the tabs event",
    );
  });

  it("answers no_window when no window claims the tab", async () => {
    const h = mount();
    const res = await h.call("POST", "/tabs", {});
    expect(res.status).toBe(503);
    expect((await errorOf(res)).error).toMatchObject({
      code: "browser_unavailable",
      reason: "no_window",
    });
    const open = h.events.find((e) => e.type === "builtin_browser_open");
    expect(open).toMatchObject({ url: "about:blank" });
    const late = await h.call("POST", "/tabs/claim", { requestId: "gone", tabId: 3 });
    expect((await errorOf(late)).error.code).toBe("unknown_request");
  });

  it("refuses a page the browser cannot open", async () => {
    const h = mount();
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "mailto:a@b.test"]) {
      const res = await h.call("POST", "/tabs", { url });
      expect(res.status).toBe(400);
      expect((await errorOf(res)).error.code).toBe("invalid_url");
    }
  });

  it("lets a page open at most 3 tabs in 5 seconds, and drops the rest", async () => {
    let clock = 1_000_000;
    const logs: string[] = [];
    const h = mount({ now: () => clock, log: (line) => logs.push(line) });
    h.shell.show(tab(2));
    const popup = (n: number) =>
      h.shell.event({ kind: "open-request", url: `https://popup.test/${n}`, openerTabId: 2 });
    const opens = () => h.events.filter((e) => e.type === "builtin_browser_open").length;
    for (let n = 0; n < 5; n++) popup(n);
    await flush();
    expect(opens()).toBe(3);
    expect(logs.filter((line) => line.includes("dropped a popup of tab 2"))).toHaveLength(2);
    clock += 5_000;
    popup(5);
    await flush();
    expect(opens()).toBe(4);
  });

  it("holds at most 30 tabs: an agent's new tab is refused, a page's popup dropped", async () => {
    const h = mount();
    for (let id = 1; id <= 30; id++) h.shell.show(tab(id));
    const res = await h.call("POST", "/tabs", { url: "https://example.test/" });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error.code).toBe("too_many_tabs");
    h.shell.event({ kind: "open-request", url: "https://popup.test/", openerTabId: 1 });
    await flush();
    expect(h.events.some((e) => e.type === "builtin_browser_open")).toBe(false);
  });

  it("activates, closes through the window, and resolves `active`", async () => {
    const h = mount();
    h.shell.show(tab(1));
    h.shell.show(tab(2));
    await flush();
    const activated = await h.call("POST", "/tabs/1/activate");
    expect((await json<{ tab: BuiltinBrowserTab }>(activated)).tab.id).toBe(1);
    expect((await json<{ activeTabId: number }>(await h.call("GET", "/tabs"))).activeTabId).toBe(1);

    const closing = h.call("DELETE", "/tabs/active");
    await until(() => h.events.some((e) => e.type === "builtin_browser_close"), "the close event");
    expect(h.events).toContainEqual({ type: "builtin_browser_close", tabId: 1 });
    h.shell.close(1);
    expect((await closing).status).toBe(204);
    expect(h.browser.tabs.ids()).toEqual([2]);

    // A window that does not remove the tab leaves it open: no_window.
    const stuck = await h.call("DELETE", "/tabs/2");
    expect((await errorOf(stuck)).error.reason).toBe("no_window");
    expect((await errorOf(await h.call("POST", "/tabs/99/activate"))).error.code).toBe(
      "no_such_tab",
    );
  });

  it("answers no_tab for `active` when nothing is open", async () => {
    const h = mount();
    const res = await h.call("POST", "/tabs/active/scan", {});
    expect(res.status).toBe(404);
    expect((await errorOf(res)).error.code).toBe("no_tab");
  });
});

describe("agent actions", () => {
  it("navigates an open tab and returns it loaded", async () => {
    const h = mount();
    h.shell.show(tab(3, { url: "https://before.test/" }));
    h.shell.cdp = page((tabId, method, params) => {
      if (method === "Page.navigate") {
        h.shell.show(tab(tabId, { url: String(params?.url), title: "After" }));
        return { frameId: "f" };
      }
      return {};
    });
    const res = await h.call("POST", "/tabs/3/navigate", {
      url: "https://after.test/x",
      sessionId: "s9",
    });
    expect(res.status).toBe(200);
    expect((await json<{ tab: BuiltinBrowserTab }>(res)).tab).toMatchObject({
      id: 3,
      url: "https://after.test/x",
    });
    const activity = h.events.filter((e) => e.type === "builtin_browser_activity");
    expect(activity).toEqual([
      {
        type: "builtin_browser_activity",
        tabId: 3,
        busy: true,
        action: "navigate",
        sessionId: "s9",
      },
      {
        type: "builtin_browser_activity",
        tabId: 3,
        busy: false,
        action: "navigate",
        sessionId: "s9",
      },
    ]);
  });

  it("reports a page that cannot be reached", async () => {
    const h = mount();
    h.shell.show(tab(3));
    h.shell.cdp = page(() => ({ frameId: "f", errorText: "net::ERR_NAME_NOT_RESOLVED" }));
    const res = await h.call("POST", "/tabs/3/navigate", { url: "https://nowhere.invalid/" });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).error.code).toBe("navigation_failed");
  });

  it("opens a tab to navigate `active` when none is open", async () => {
    const h = mount();
    h.shell.cdp = page(() => ({}));
    const pending = h.call("POST", "/tabs/active/navigate", { url: "https://first.test/" });
    await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the open event");
    const open = openEvent(h.events);
    h.shell.show(tab(8, { url: "https://first.test/" }));
    await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 8 });
    expect((await json<{ tab: BuiltinBrowserTab }>(await pending)).tab.id).toBe(8);
  });

  it("scans with the tab list beside the content", async () => {
    const h = mount();
    h.shell.show(tab(5));
    h.shell.show(tab(6));
    let expression = "";
    h.shell.cdp = (_tabId, _method, params) => {
      expression = expressionOf(params);
      return evaluated({ content: "<main>hi</main>", truncated: true });
    };
    const res = await h.call("POST", "/tabs/5/scan", {
      textOnly: false,
      maxChars: 1000,
      instruction: "Order",
    });
    const scan = await json<BuiltinBrowserScanResult>(res);
    expect(scan).toEqual({
      tab: tab(5),
      tabs: [tab(5), tab(6)],
      activeTabId: 5,
      content: "<main>hi</main>",
      truncated: true,
    });
    expect(expression).toContain(
      '__penguinScan({"textOnly":false,"maxChars":1000,"instruction":"Order"})',
    );
  });

  it("gives the text scan a third of the budget, as GenericAgent's web_scan does", async () => {
    const h = mount();
    h.shell.show(tab(5));
    const seen: string[] = [];
    h.shell.cdp = (_t, _m, params) => {
      seen.push(expressionOf(params));
      return evaluated({ content: "text", truncated: false });
    };
    await h.call("POST", "/tabs/5/scan", { textOnly: true });
    await h.call("POST", "/tabs/5/scan", { textOnly: true, maxChars: 5000 });
    expect(seen[0]).toContain('"maxChars":11666');
    expect(seen[1]).toContain('"maxChars":1666');
  });

  it("answers exec with the value, the transients and the diff", async () => {
    const h = mount();
    h.shell.show(tab(2));
    let script = "";
    h.shell.cdp = page(
      (_t, method, params) => {
        if (method === "Runtime.evaluate") script = expressionOf(params);
        return evaluated({ ok: true, data: { rows: 3 } });
      },
      { transients: ["Added to cart"], changed: 14, topChange: "<div>Cart (1)</div>" },
    );
    const res = await h.call("POST", "/tabs/2/exec", {
      script: "return {rows: 3}",
      sessionId: "s1",
    });
    const result = await json<BuiltinBrowserExecResult>(res);
    expect(result).toEqual({
      status: "success",
      tabId: 2,
      value: { rows: 3 },
      transients: ["Added to cart"],
      diff: { changed: 14, topChange: "<div>Cart (1)</div>" },
    });
    // The script travels to the page inside GenericAgent's executor, as a JSON string.
    expect(script).toContain('const jsCode = "return {rows: 3}".trim();');
  });

  /** The shell relaying a dialog the page opened; the page is blocked until it is answered. */
  async function openDialog(
    h: Harness,
    answers: unknown[],
    params: { type: string; message: string; defaultPrompt?: string },
  ): Promise<void> {
    const count = answers.length;
    h.shell.event({
      kind: "cdp-event",
      tabId: 2,
      method: "Page.javascriptDialogOpening",
      params: { url: "https://example.test/2", hasBrowserHandler: true, ...params },
    });
    await until(() => answers.length > count, `the ${params.type} answered`);
  }

  it("answers the page's dialogs during an action: alerts accepted, the rest dismissed", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const answers: unknown[] = [];
    h.shell.cdp = page(async (_t, method, params) => {
      if (method === "Page.handleJavaScriptDialog") {
        answers.push(params);
        return {};
      }
      if (method !== "Runtime.evaluate") return {};
      await openDialog(h, answers, { type: "alert", message: "Saved" });
      await openDialog(h, answers, { type: "confirm", message: "Delete this item?" });
      return evaluated({ ok: true, data: "done" });
    });
    const result = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/exec", { script: "go()" }),
    );
    expect(result.value).toBe("done");
    expect(result.dialogs).toEqual([
      { type: "alert", message: "Saved", accepted: true },
      { type: "confirm", message: "Delete this item?", accepted: false },
    ]);
    expect(answers).toEqual([{ accept: true }, { accept: false }]);
    // Page events are on for the span of the action, the dialog's relayed, and off again after.
    const switches = h.shell.commands.filter(
      (c) => c.op === "cdp" && (c.method === "Page.enable" || c.method === "Page.disable"),
    );
    expect(switches).toEqual([
      {
        op: "cdp",
        tabId: 2,
        method: "Page.enable",
        params: {},
        events: ["Page.javascriptDialogOpening"],
      },
      { op: "cdp", tabId: 2, method: "Page.disable", params: {}, events: [] },
    ]);
  });

  it("accepts every dialog with acceptDialogs, a prompt with its default text", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const answers: unknown[] = [];
    h.shell.cdp = page(async (_t, method, params) => {
      if (method === "Page.handleJavaScriptDialog") {
        answers.push(params);
        return {};
      }
      if (expressionOf(params).includes("document.querySelectorAll(sel)")) {
        return evaluated({ x: 10, y: 10, tag: "button", text: "Ask" });
      }
      if (method === "Input.dispatchMouseEvent" && params?.type === "mouseReleased") {
        await openDialog(h, answers, { type: "prompt", message: "How many?", defaultPrompt: "3" });
      }
      return {};
    });
    const result = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/click", { selector: "#ask", acceptDialogs: true }),
    );
    expect(result.dialogs).toEqual([{ type: "prompt", message: "How many?", accepted: true }]);
    expect(answers).toEqual([{ accept: true, promptText: "3" }]);
  });

  it("runs one action at a time on a tab, so their measurements never overlap", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    h.shell.cdp = async (_t, method, params) => {
      const expression = expressionOf(params);
      if (method !== "Runtime.evaluate") return {};
      if (expression.includes("startStrMonitor(450);")) {
        order.push("begin");
        return evaluated(true);
      }
      if (expression.includes("findChangedElements(snap,")) {
        order.push("end");
        return evaluated({ transients: [], changed: 0 });
      }
      if (expression.includes("'first'")) {
        order.push("first");
        await gate;
        return evaluated({ ok: true, data: 1 });
      }
      if (expression.includes("'second'")) {
        order.push("second");
        return evaluated({ ok: true, data: 2 });
      }
      return evaluated("complete");
    };
    const first = h.call("POST", "/tabs/2/exec", { script: "return 'first'" });
    await until(() => order.includes("first"), "the first script");
    const second = h.call("POST", "/tabs/2/exec", { script: "return 'second'" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["begin", "first"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["begin", "first", "end", "begin", "second", "end"]);
  });

  it("keeps the keys of a returned object in the order the page built them", async () => {
    const h = mount();
    h.shell.show(tab(2));
    // The page's executor answers with JSON text, which crosses the shell unsorted.
    h.shell.cdp = page(() =>
      evaluated(JSON.stringify({ ok: true, data: { total: "$19.99", date: "2026-09-20" } })),
    );
    const res = await h.call("POST", "/tabs/2/exec", { script: "return row", noMonitor: true });
    expect(await res.text()).toContain('"value":{"total":"$19.99","date":"2026-09-20"}');
  });

  it("notes when nothing visible happened, and skips measuring with noMonitor", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const methods: string[] = [];
    h.shell.cdp = page((_t, method) => {
      methods.push(method);
      return evaluated({ ok: true, data: "x" });
    });
    const quiet = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/exec", { script: "1" }),
    );
    expect(quiet).toMatchObject({
      status: "success",
      diff: { changed: 0 },
      transients: [],
      suggestion: "No visible change on the page.",
    });
    const bare = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/exec", { script: "document.title", noMonitor: true }),
    );
    expect(bare).toEqual({ status: "success", tabId: 2, value: "x" });
  });

  it("reports the script's own failure in band", async () => {
    const h = mount();
    h.shell.show(tab(2));
    h.shell.cdp = page(() =>
      evaluated({ ok: false, error: { name: "TypeError", message: "x is not a function" } }),
    );
    const result = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/exec", { script: "x()" }),
    );
    expect(result).toMatchObject({
      status: "failed",
      tabId: 2,
      error: "TypeError: x is not a function",
    });
  });

  it("reports a navigation the script caused as reloaded", async () => {
    const h = mount();
    h.shell.show(tab(2));
    h.shell.cdp = page(() => {
      throw new Error("Inspected target navigated or closed");
    });
    const result = await json<BuiltinBrowserExecResult>(
      await h.call("POST", "/tabs/2/exec", { script: "location.href = 'https://next.test/'" }),
    );
    expect(result).toEqual({ status: "success", tabId: 2, reloaded: true });

    // A navigation the page started after the script returned is found by the end measure.
    const late = mount();
    late.shell.show(tab(2));
    late.shell.cdp = page(() => evaluated({ ok: true }), { lost: true });
    const after = await json<BuiltinBrowserExecResult>(
      await late.call("POST", "/tabs/2/exec", { script: "go()" }),
    );
    expect(after).toEqual({ status: "success", tabId: 2, reloaded: true });
  });

  it("lists the popup a script opened as a new tab", async () => {
    const h = mount();
    h.shell.show(tab(2));
    h.shell.cdp = page(() => {
      // The page calls window.open: the shell denies it and asks for a tab instead.
      h.shell.event({ kind: "open-request", url: "https://popup.test/", openerTabId: 2 });
      return evaluated({ ok: true });
    });
    const exec = h.call("POST", "/tabs/2/exec", {
      script: "window.open('https://popup.test/')",
      sessionId: "s4",
    });
    // The window creates the popup's tab and claims it.
    await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the open event");
    const open = openEvent(h.events);
    expect(open).toMatchObject({
      url: "https://popup.test/",
      openerTabId: 2,
      activate: true,
      sessionId: "s4",
    });
    h.shell.show(tab(30, { url: "https://popup.test/" }));
    await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 30 });
    const result = await json<BuiltinBrowserExecResult>(await exec);
    expect(result.newTabs).toEqual([{ id: 30, url: "https://popup.test/" }]);
    expect(result.diff).toBeUndefined();
    expect(result.suggestion).toMatch(/New tabs opened/);
  });

  it("clicks with the full trusted mouse sequence at the element's centre", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const mouse: unknown[] = [];
    h.shell.cdp = page(
      (_t, method, params) => {
        if (method === "Input.dispatchMouseEvent") {
          mouse.push(params);
          return {};
        }
        if (expressionOf(params).includes("document.querySelectorAll(sel)")) {
          return evaluated({ x: 120, y: 48, tag: "button", text: "Search" });
        }
        return {};
      },
      { changed: 3 },
    );
    const res = await h.call("POST", "/tabs/2/click", { selector: "button.go", index: 0 });
    const result = await json<BuiltinBrowserExecResult>(res);
    expect(result).toMatchObject({
      status: "success",
      clicked: { x: 120, y: 48, tag: "button", text: "Search" },
      diff: { changed: 3 },
    });
    expect(mouse.map((p) => (p as { type: string }).type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
    expect(mouse[1]).toMatchObject({ x: 120, y: 48, button: "left", clickCount: 1 });
  });

  it("answers script_error when the element is not there", async () => {
    const h = mount();
    h.shell.show(tab(2));
    h.shell.cdp = page(() => ({
      result: { type: "object" },
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "Error: No element matches #nope" },
      },
    }));
    const res = await h.call("POST", "/tabs/2/click", { selector: "#nope" });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).error).toEqual({
      code: "script_error",
      message: "Error: No element matches #nope",
    });
    const bad = await h.call("POST", "/tabs/2/click", {});
    expect(bad.status).toBe(400);
  });

  it("types by insertText, fires input and change, and submits with Enter", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const calls: string[] = [];
    h.shell.cdp = page((_t, method, params) => {
      const expression = expressionOf(params);
      if (expression.includes("document.querySelector(sel)")) calls.push("focus");
      else if (expression.includes("new Event('input'")) calls.push("events");
      else if (method === "Input.insertText") calls.push(`insert:${String(params?.text)}`);
      else if (method === "Input.dispatchKeyEvent")
        calls.push(`key:${String(params?.type)}:${String(params?.key)}`);
      return evaluated(true);
    });
    const res = await h.call("POST", "/tabs/2/type", {
      text: "headphones",
      selector: "#search",
      submit: true,
    });
    expect((await json<BuiltinBrowserExecResult>(res)).status).toBe("success");
    expect(calls).toEqual([
      "focus",
      "insert:headphones",
      "events",
      "key:keyDown:Enter",
      "key:keyUp:Enter",
    ]);
  });

  it("takes a screenshot, of the viewport or the whole page", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const shots: unknown[] = [];
    h.shell.cdp = (_t, method, params) => {
      if (method === "Page.getLayoutMetrics")
        return { cssContentSize: { width: 1280.4, height: 4000 } };
      shots.push(params);
      return { data: "iVBORw0KGgo=" };
    };
    const view = await h.call("POST", "/tabs/2/screenshot", {});
    expect(await view.json()).toEqual({ mime: "image/png", data: "iVBORw0KGgo=" });
    await h.call("POST", "/tabs/2/screenshot", { fullPage: true });
    expect(shots).toEqual([
      { format: "png" },
      {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 1281, height: 4000, scale: 1 },
      },
    ]);
  });

  it("passes raw CDP through", async () => {
    const h = mount();
    h.shell.show(tab(2));
    h.shell.cdp = (_t, method, params) => ({ method, params });
    const res = await h.call("POST", "/tabs/2/cdp", {
      method: "DOM.getDocument",
      params: { depth: 1 },
    });
    expect(await res.json()).toEqual({
      result: { method: "DOM.getDocument", params: { depth: 1 } },
    });
    const bad = await h.call("POST", "/tabs/2/cdp", { method: "not a method" });
    expect(bad.status).toBe(400);
  });

  it("keeps raw CDP within the browser: no Target domain, no navigation off the web", async () => {
    const h = mount();
    h.shell.show(tab(2));
    const sent: string[] = [];
    h.shell.cdp = (_t, method) => {
      sent.push(method);
      return {};
    };
    const target = await h.call("POST", "/tabs/2/cdp", {
      method: "Target.createTarget",
      params: { url: "https://example.test/" },
    });
    expect(target.status).toBe(403);
    expect((await errorOf(target)).error.code).toBe("cdp_refused");
    for (const url of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)"]) {
      const res = await h.call("POST", "/tabs/2/cdp", { method: "Page.navigate", params: { url } });
      expect(res.status).toBe(400);
      expect((await errorOf(res)).error.code).toBe("invalid_url");
    }
    const web = await h.call("POST", "/tabs/2/cdp", {
      method: "Page.navigate",
      params: { url: "https://example.test/next" },
    });
    expect(web.status).toBe(200);
    expect(sent).toEqual(["Page.navigate"]);
  });

  it("drops a tab the shell no longer has", async () => {
    const h = mount();
    h.shell.show(tab(2));
    await flush();
    h.shell.guests.delete(2);
    const res = await h.call("POST", "/tabs/2/screenshot", {});
    expect(res.status).toBe(404);
    expect((await errorOf(res)).error.code).toBe("no_such_tab");
    expect(h.browser.tabs.has(2)).toBe(false);
  });
});

describe("import, history and data", () => {
  const chrome: BuiltinBrowserImportSource = {
    id: "chrome:Default",
    browser: "chrome",
    browserName: "Google Chrome",
    profile: "Default",
    profileName: "Person 1",
    hasCookies: true,
    hasHistory: true,
  };
  const importer: Importer = {
    listImportSources: () => [chrome],
    readCookies: async (_source, opts) => ({
      cookies: [
        {
          url: "https://www.amazon.com/",
          name: "session-id",
          value: "v",
          domain: ".amazon.com",
          secure: true,
        },
      ],
      found: 5,
      skipped: 4,
      warnings: [`filtered to ${(opts.domains ?? []).join(",")}`],
    }),
    readHistory: async () => ({
      entries: [
        {
          url: "https://www.amazon.com/",
          title: "Amazon",
          visitCount: 3,
          lastVisitAt: 5,
          source: "chrome",
        },
      ],
      warnings: [],
    }),
  };

  it("imports cookies through the shell and history into the store", async () => {
    const h = mount({ importer });
    const sources = await json<{ sources: BuiltinBrowserImportSource[] }>(
      await h.call("GET", "/import/sources"),
    );
    expect(sources.sources).toEqual([chrome]);
    const res = await h.call("POST", "/import", { sourceId: "chrome", domains: ["amazon.com"] });
    const result = await json<BuiltinBrowserImportResult>(res);
    expect(result).toEqual({
      sourceId: "chrome:Default",
      cookies: { found: 5, imported: 1, skipped: 4, failed: 0 },
      history: { found: 1, imported: 1 },
      warnings: ["filtered to amazon.com"],
    });
    expect(h.shell.cookies.map((c) => c.name)).toEqual(["session-id"]);
    const history = await json<{ entries: unknown[] }>(
      await h.call("GET", "/history?q=amazon&limit=5"),
    );
    expect(history.entries).toEqual([
      {
        url: "https://www.amazon.com/",
        title: "Amazon",
        visitCount: 3,
        lastVisitAt: 5,
        source: "chrome",
      },
    ]);
    expect((await h.call("DELETE", "/history")).status).toBe(204);
    expect((await json<{ entries: unknown[] }>(await h.call("GET", "/history"))).entries).toEqual(
      [],
    );
  });

  it("imports only what is asked for, and names a missing source", async () => {
    const h = mount({ importer });
    const history = await json<BuiltinBrowserImportResult>(
      await h.call("POST", "/import", { sourceId: "chrome:Default", history: true }),
    );
    expect(history.cookies).toBeUndefined();
    expect(history.history).toEqual({ found: 1, imported: 1 });
    const missing = await h.call("POST", "/import", { sourceId: "firefox" });
    expect(missing.status).toBe(404);
    expect((await errorOf(missing)).error.code).toBe("source_not_found");
    const failing = mount({
      importer: {
        ...importer,
        readCookies: async () => Promise.reject(new Error("keychain denied")),
      },
    });
    const failed = await failing.call("POST", "/import", { sourceId: "chrome", cookies: true });
    expect(failed.status).toBe(422);
    expect((await errorOf(failed)).error).toMatchObject({ code: "import_failed" });
  });

  it("clears the browser's data through the shell", async () => {
    const h = mount();
    expect((await h.call("POST", "/clear-data", { storages: ["cookies", "cache"] })).status).toBe(
      204,
    );
    expect(h.shell.commands.at(-1)).toEqual({ op: "clear-data", storages: ["cookies", "cache"] });
    expect((await h.call("POST", "/clear-data", { storages: ["everything"] })).status).toBe(400);
  });

  it("records the pages tabs visit", async () => {
    const h = mount();
    h.shell.show(
      tab(1, { url: "https://www.amazon.com/your-orders/orders", title: "Your Orders" }),
    );
    const res = await h.call("GET", "/history?q=orders");
    expect((await json<{ entries: { url: string }[] }>(res)).entries.map((e) => e.url)).toEqual([
      "https://www.amazon.com/your-orders/orders",
    ]);
  });
});

describe("browserUrl", () => {
  it("gives a bare host a scheme and refuses anything that is not a web page", () => {
    expect(browserUrl("amazon.com/orders", false)).toBe("https://amazon.com/orders");
    expect(browserUrl("localhost:5173", false)).toBe("http://localhost:5173/");
    expect(browserUrl(" https://A.test/x ", false)).toBe("https://a.test/x");
    expect(browserUrl("http:example.test", false)).toBe("http://example.test/");
    expect(browserUrl(undefined, true)).toBe("about:blank");
    expect(browserUrl("about:blank", false)).toBe("about:blank");
    for (const bad of [
      undefined,
      "",
      "file:///x",
      "chrome://gpu",
      "ftp://a.test/",
      "javascript:alert(1)",
      "mailto:a@b.test",
      "data:text/html,x",
      42,
    ]) {
      expect(() => browserUrl(bad, false)).toThrow(/not a web address/);
    }
  });
});
