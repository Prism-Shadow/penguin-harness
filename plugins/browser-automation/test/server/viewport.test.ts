/**
 * A built-in tab's page size through /api/builtin-browser/tabs/:tab/viewport, over the fake shell,
 * with the window played by the test: it lays the page out at the size the tab list it hears
 * gives the tab, and at the panel's own size (576 × 702) while the tab has none — as the browser
 * layer of the web half does.
 *
 * - Given a tab, when the size is fixed, the windows hear it with the tab and the answer waits
 *   until the page reports it; nothing is emulated over the page's real box, and an override an
 *   agent left with raw CDP is cleared.
 * - With a pixel ratio, only the ratio is overridden, and it is sent again before each later
 *   action, since a debugger attached again has lost it.
 * - Fitting the panel again takes the size off the tab and clears every override.
 * - A body with no size only reads what the page reports.
 * - Sizes out of range, half a size, and fit with a size are refused.
 * - An agent's resize is announced as its action; the user's own from the panel is not.
 * - A popup starts at its opener's size.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserServerEvent,
  BuiltinBrowserTab,
  BuiltinBrowserViewportResult,
} from "@prismshadow/penguin-server/api";
import type { AppEnv } from "@prismshadow/penguin-server/plugin";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { handleError } from "./host.js";
import { builtinBrowserRoutes } from "../../src/server/routes.js";
import { BuiltinBrowser } from "../../src/server/service.js";
import { FakeShell, evaluated, expressionOf, tab } from "./fake-shell.js";

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
  viewportSettleMs: 500,
};

/** The Browser panel's slot in the played window. */
const PANEL = { width: 576, height: 702 };

let root: string;
const browsers: BuiltinBrowser[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-viewport-"));
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
  events: BuiltinBrowserServerEvent[];
  /** The CDP methods the shell was sent, with their params, in order. */
  cdp: { method: string; params: Record<string, unknown> | undefined }[];
  call(method: string, url: string, body?: unknown): Promise<Response>;
}

function mount(): Harness {
  const shell = new FakeShell();
  const events: BuiltinBrowserServerEvent[] = [];
  /** The played window: each tab's page box, from the tab list it last heard. */
  const boxes = new Map<number, { width: number; height: number }>();
  let ratio: number | null = null;
  const browser = new BuiltinBrowser({
    port: shell.port,
    root,
    publish: (event) => {
      events.push(event);
      if (event.type === "builtin_browser_tabs") {
        for (const t of event.tabs) boxes.set(t.id, t.viewport ?? PANEL);
      }
    },
    log: () => {},
    sleep: async () => {},
    timing: FAST,
  });
  browsers.push(browser);
  const cdp: Harness["cdp"] = [];
  shell.cdp = (tabId, method, params) => {
    cdp.push({ method, params });
    if (method === "Emulation.setDeviceMetricsOverride") {
      ratio = (params as { deviceScaleFactor: number }).deviceScaleFactor || null;
      return {};
    }
    if (method === "Emulation.clearDeviceMetricsOverride") {
      ratio = null;
      return {};
    }
    if (method === "Page.captureScreenshot") return { data: "iVBORw0KGgo=" };
    const expression = expressionOf(params);
    if (expression.includes("innerWidth, innerHeight, devicePixelRatio")) {
      const box = boxes.get(tabId) ?? PANEL;
      return evaluated([box.width, box.height, ratio ?? 1]);
    }
    if (expression.includes("return document.readyState;")) return evaluated("complete");
    return evaluated(null);
  };
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", { userId: "admin", isAdmin: true } as UserRow);
    c.set("sessionVia", "token");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser, {}));
  return {
    shell,
    events,
    cdp,
    call: async (method, url, body) =>
      app.request(`/api/builtin-browser${url}`, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
  };
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;
const emulation = (h: Harness) => h.cdp.filter((c) => c.method.startsWith("Emulation."));
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A tab the shell hosts, once the browser has it listed. */
async function hosted(h: Harness, id: number): Promise<void> {
  h.shell.show(tab(id));
  await until(
    () =>
      h.events.some((e) => e.type === "builtin_browser_tabs" && e.tabs.some((t) => t.id === id)),
    "the tab list",
  );
}

/** A tab a session opened, through the same open and claim exchange as a real window. */
async function owned(h: Harness, id: number, sessionId: string): Promise<void> {
  const response = h.call("POST", "/tabs", { url: "about:blank", sessionId });
  await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the open request");
  const open = h.events.find((e) => e.type === "builtin_browser_open");
  if (open?.type !== "builtin_browser_open") throw new Error("no open event");
  h.shell.show(tab(id));
  expect(
    (await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: id })).status,
  ).toBe(204);
  expect((await response).status).toBe(200);
}

describe("a built-in tab's page size", () => {
  it("is laid out at the size fixed for it, which the windows hear with the tab", async () => {
    const h = mount();
    await hosted(h, 2);

    const res = await h.call("POST", "/tabs/2/viewport", { width: 1200, height: 660 });
    expect(res.status).toBe(200);
    const result = await json<BuiltinBrowserViewportResult>(res);
    expect(result).toMatchObject({ width: 1200, height: 660, scale: 1 });
    expect(result.tab.viewport).toEqual({ width: 1200, height: 660 });
    const heard = h.events.filter((e) => e.type === "builtin_browser_tabs").at(-1);
    expect(heard?.type === "builtin_browser_tabs" && heard.tabs[0]?.viewport).toEqual({
      width: 1200,
      height: 660,
    });
    // The page's own box is the size: nothing is emulated over it, and a leftover is cleared.
    expect(emulation(h)).toEqual([
      { method: "Emulation.clearDeviceMetricsOverride", params: undefined },
    ]);
    expect(
      (await json<{ tabs: BuiltinBrowserTab[] }>(await h.call("GET", "/tabs"))).tabs[0]?.viewport,
    ).toEqual({ width: 1200, height: 660 });
  });

  it("overrides only the pixel ratio, and sends it again before each later action", async () => {
    const h = mount();
    await owned(h, 2, "s-1");

    const res = await h.call("POST", "/tabs/2/viewport", { width: 1200, height: 660, scale: 2 });
    expect(await json<BuiltinBrowserViewportResult>(res)).toMatchObject({
      tab: { viewport: { width: 1200, height: 660, scale: 2 } },
      width: 1200,
      height: 660,
      scale: 2,
    });
    const ratioOnly = {
      method: "Emulation.setDeviceMetricsOverride",
      params: { width: 0, height: 0, deviceScaleFactor: 2, mobile: false },
    };
    expect(emulation(h)).toEqual([ratioOnly]);

    await h.call("POST", "/tabs/2/screenshot", { sessionId: "s-1" });
    const methods = h.cdp.map((c) => c.method);
    expect(methods.slice(-2)).toEqual([
      "Emulation.setDeviceMetricsOverride",
      "Page.captureScreenshot",
    ]);
    expect(emulation(h)).toEqual([ratioOnly, ratioOnly]);
  });

  it("fits the panel again: the size leaves the tab, and every override is cleared", async () => {
    const h = mount();
    await owned(h, 2, "s-1");
    await h.call("POST", "/tabs/2/viewport", { width: 1440, height: 900, scale: 2 });

    const res = await h.call("POST", "/tabs/2/viewport", { fit: true });
    const result = await json<BuiltinBrowserViewportResult>(res);
    expect(result.tab.viewport).toBeUndefined();
    expect(result).toMatchObject({ width: PANEL.width, height: PANEL.height, scale: 1 });
    expect(emulation(h).at(-1)?.method).toBe("Emulation.clearDeviceMetricsOverride");

    const before = h.cdp.length;
    await h.call("POST", "/tabs/2/screenshot", { sessionId: "s-1" });
    expect(h.cdp.slice(before).map((c) => c.method)).toEqual(["Page.captureScreenshot"]);
  });

  it("only reads what the page reports when the body names no size", async () => {
    const h = mount();
    await hosted(h, 2);

    const res = await h.call("POST", "/tabs/active/viewport", {});
    const result = await json<BuiltinBrowserViewportResult>(res);
    expect(result).toMatchObject({ width: PANEL.width, height: PANEL.height, scale: 1 });
    expect(result.tab.viewport).toBeUndefined();
    expect(emulation(h)).toEqual([]);
  });

  it("refuses sizes out of range, half a size, and fit with a size", async () => {
    const h = mount();
    await hosted(h, 2);
    for (const body of [
      { width: 100, height: 600 },
      { width: 1200, height: 5000 },
      { width: 1200 },
      { width: 1200, height: 660, scale: 8 },
      { scale: 2 },
      { fit: true, width: 1200, height: 660 },
      { width: 1200.5, height: 660 },
    ]) {
      const res = await h.call("POST", "/tabs/2/viewport", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(emulation(h)).toEqual([]);
  });

  it("announces an agent's resize as its action, and not the user's own from the panel", async () => {
    const h = mount();
    await owned(h, 2, "s-1");
    const activity = () =>
      h.events
        .filter((e) => e.type === "builtin_browser_activity")
        .map((e) => e.type === "builtin_browser_activity" && [e.action, e.busy]);

    await h.call("POST", "/tabs/2/viewport", { width: 1280, height: 800 });
    expect(activity()).toEqual([]);
    await h.call("POST", "/tabs/2/viewport", { width: 1440, height: 900, sessionId: "s-1" });
    expect(activity()).toEqual([
      ["resize", true],
      ["resize", false],
    ]);
  });

  it("answers no_such_tab for a tab that is not open", async () => {
    const h = mount();
    await hosted(h, 2);
    const res = await h.call("POST", "/tabs/9/viewport", { width: 1280, height: 800 });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("no_such_tab");
  });

  it("starts a popup at its opener's size", async () => {
    const h = mount();
    await hosted(h, 2);
    await h.call("POST", "/tabs/2/viewport", { width: 1200, height: 660 });

    h.shell.event({ kind: "open-request", openerTabId: 2, url: "https://example.test/popup" });
    await until(() => h.events.some((e) => e.type === "builtin_browser_open"), "the popup");
    const open = h.events.find((e) => e.type === "builtin_browser_open");
    if (open?.type !== "builtin_browser_open") throw new Error("no open event");
    h.shell.show(tab(3));
    expect(
      (await h.call("POST", "/tabs/claim", { requestId: open.requestId, tabId: 3 })).status,
    ).toBe(204);
    const tabs = (await json<{ tabs: BuiltinBrowserTab[] }>(await h.call("GET", "/tabs"))).tabs;
    expect(tabs.find((t) => t.id === 3)?.viewport).toEqual({ width: 1200, height: 660 });
  });
});
