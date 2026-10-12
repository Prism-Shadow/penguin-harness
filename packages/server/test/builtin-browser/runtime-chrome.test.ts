/**
 * The chrome backend above the wire: a member's own Chrome, through the routes, over a fake
 * extension at the socket (fake-chrome.ts) and a real database.
 *
 * - Given a connected Chrome, when the agent opens a tab, the extension creates it (the
 *   server never asks a window to), the call waits for its page, and the user's windows hear
 *   the tab list, named as Chrome's; when it closes the tab, the extension closes it.
 * - Switching to a tab shows it in the user's Chrome; an action's own activation of its tab
 *   does not steal the user's focus.
 * - When the user takes a tab back while an action runs in it, the action answers 409
 *   `tab_released`, and so does every later call on that tab — the agent must not retry it.
 * - When Chrome goes away, the backend is `extension_disconnected` but the tab list stays;
 *   when it comes back, the list is replaced by what Chrome reports.
 * - Raw CDP that reaches the user's cookies, stores, the browser, other targets, the disk or the
 *   downloads is refused (403 `cdp_refused`) and never sent to Chrome, and so is a navigation
 *   to anything but a web page (400); a page-level method goes through.
 * - What the extension refuses with reaches the agent as the route's own answer: a tab gone 404,
 *   taken back 409, the extension paused 503, a refused command 403, a bad address 400, and
 *   Chrome's own CDP error 422.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserServerEvent,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "../../src/api/types.js";
import type { AppEnv } from "../../src/auth/middleware.js";
import { ExtensionPairing } from "../../src/builtin-browser/extension-pairing.js";
import { builtinBrowserRoutes } from "../../src/builtin-browser/routes.js";
import { BuiltinBrowser } from "../../src/builtin-browser/service.js";
import { openDatabase } from "../../src/db/database.js";
import { BrowserExtensionsRepo } from "../../src/db/repos/browser-extensions.js";
import type { UserRow } from "../../src/db/repos/users.js";
import { handleError } from "../../src/http/errors.js";
import { FakeChrome } from "./fake-chrome.js";
import { evaluated, expressionOf } from "./fake-shell.js";
import type { CdpHandler } from "./fake-shell.js";

const FAST = {
  settleMs: 0,
  reloadWaitMs: 200,
  loadWaitMs: 500,
  openClaimMs: 300,
  closeWaitMs: 200,
  publishDelayMs: 0,
};

let root: string;
let db: DatabaseSync;
const browsers: BuiltinBrowser[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-chrome-"));
  db = openDatabase(":memory:");
  db.exec(
    "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('alice', 'h', 0, '2026-10-02T00:00:00.000Z')",
  );
});
afterEach(async () => {
  for (const b of browsers.splice(0)) {
    b.dispose();
    await b.history.flush();
  }
  db.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface Harness {
  browser: BuiltinBrowser;
  /** What alice's windows heard. */
  events: BuiltinBrowserServerEvent[];
  call(method: string, url: string, body?: unknown): Promise<Response>;
  /** Pairs a Chrome to alice and connects it; resolves once it answered hello. */
  connect(chrome?: FakeChrome): Promise<FakeChrome>;
}

function mount(): Harness {
  const store = new BrowserExtensionsRepo(db);
  const events: BuiltinBrowserServerEvent[] = [];
  const browser = new BuiltinBrowser({
    port: null,
    root,
    publish: () => {},
    log: () => {},
    sleep: async () => {},
    timing: FAST,
    chrome: {
      store,
      enabled: () => true,
      publishTo: (userId, event) => {
        if (userId === "alice") events.push(event);
      },
    },
  });
  browsers.push(browser);
  const pairing = new ExtensionPairing({
    store,
    user: (userId) => ({ userId, displayName: null }),
    installId: () => "install-1",
    serverVersion: "0.2.13",
    now: Date.now,
  });
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", { userId: "alice", isAdmin: false } as UserRow);
    c.set("sessionVia", "password");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser, { pairing }));
  let token: string | null = null;
  return {
    browser,
    events,
    call: async (method, url, body) =>
      app.request(`/api/builtin-browser${url}`, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    connect: async (chrome = new FakeChrome()) => {
      if (token === null) {
        const { code } = pairing.mint("alice");
        token = pairing.pair({ code, name: "Chrome 130 on Linux", version: "0.2.13" }).token;
      }
      browser.connect(token, chrome);
      await until(() => browser.extensions?.unavailability("alice") === null, "the hello");
      return chrome;
    },
  };
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) =>
  (await res.json()) as { error: { code: string; message: string; reason?: string } };
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** A page in Chrome: loaded, and any other script reads it as a scan does. */
const page: CdpHandler = (_tabId, method, params) => {
  if (method !== "Runtime.evaluate") return {};
  if (expressionOf(params).includes("return document.readyState;")) return evaluated("complete");
  return evaluated({ content: "<p>hi</p>" });
};

describe("tabs in the user's Chrome", () => {
  it("opens a tab through the extension and waits for its page; closing it closes it there", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cdp = page;
    const res = await h.call("POST", "/tabs", { url: "example.test/start" });
    expect(res.status).toBe(200);
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(res);
    expect(chrome.commands).toContainEqual({
      op: "open-tab",
      url: "https://example.test/start",
      activate: true,
    });
    // The page was waited for, in the tab the extension made.
    expect(chrome.commands.some((c) => c.op === "cdp" && c.tabId === tab.id)).toBe(true);
    // No window was asked to create it.
    expect(h.events.some((e) => e.type === "builtin_browser_open")).toBe(false);
    await until(
      () =>
        h.events.some(
          (e) => e.type === "builtin_browser_tabs" && e.backend === "chrome" && e.tabs.length === 1,
        ),
      "the tab list",
    );

    expect((await h.call("DELETE", `/tabs/${tab.id}`)).status).toBe(204);
    expect(chrome.commands).toContainEqual({ op: "close-tab", tabId: tab.id });
    expect((await json<{ tabs: BuiltinBrowserTab[] }>(await h.call("GET", "/tabs"))).tabs).toEqual(
      [],
    );
  });

  it("shows a tab the agent switches to in the user's Chrome, but not one an action works in", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cdp = page;
    const first = (await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}))).tab;
    const second = (await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}))).tab;
    // A blank tab has no page to wait for.
    expect(chrome.commands.filter((c) => c.op === "cdp")).toEqual([]);

    expect((await h.call("POST", `/tabs/${first.id}/activate`, {})).status).toBe(200);
    expect(chrome.commands).toContainEqual({ op: "activate-tab", tabId: first.id });

    const scanned = await h.call("POST", `/tabs/${second.id}/scan`, {});
    expect(scanned.status).toBe(200);
    expect(chrome.commands).not.toContainEqual({ op: "activate-tab", tabId: second.id });
    expect(h.browser.extensions?.runtimeFor("alice")?.tabs.activeTabId).toBe(second.id);
  });
});

describe("a tab the user takes back", () => {
  it("ends the action running in it with tab_released, and every later call on it too", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cdp = page;
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}));
    // The agent's raw command hangs in the page until the user presses Cancel on the bar.
    chrome.cdp = () => new Promise(() => {});
    const running = h.call("POST", `/tabs/${tab.id}/cdp`, { method: "Page.reload" });
    await until(() => chrome.commands.some((c) => c.op === "cdp"), "the command reaching Chrome");
    chrome.release(tab.id, "user");

    const res = await running;
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error.code).toBe("tab_released");
    const later = await h.call("POST", `/tabs/${tab.id}/scan`, {});
    expect(later.status).toBe(409);
    expect((await errorOf(later)).error.code).toBe("tab_released");
    // It left the agent's tab list.
    expect((await json<{ tabs: BuiltinBrowserTab[] }>(await h.call("GET", "/tabs"))).tabs).toEqual(
      [],
    );
  });
});

describe("Chrome going away and coming back", () => {
  it("keeps the tab list while disconnected and takes Chrome's list when it reconnects", async () => {
    const h = mount();
    const chrome = await h.connect();
    const opened: number[] = [];
    for (let i = 0; i < 2; i++) {
      opened.push(
        (await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}))).tab.id,
      );
    }
    chrome.drop();

    const away = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(away).toMatchObject({ available: false, reason: "extension_disconnected" });
    expect(away.tabs.map((t) => t.id)).toEqual(opened);
    const refused = await h.call("POST", `/tabs/${opened[0]}/scan`, {});
    expect(refused.status).toBe(503);
    expect((await errorOf(refused)).error.reason).toBe("extension_disconnected");
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: "builtin_browser_extension", state: "disconnected" }),
    );

    // Back again: Chrome still has the second tab; the first was closed meanwhile.
    const back = new FakeChrome();
    back.guests.set(opened[1]!, { ...away.tabs[1]! });
    await h.connect(back);
    const status = await json<BuiltinBrowserStatus>(await h.call("GET", "/status"));
    expect(status).toMatchObject({ available: true, backend: "chrome" });
    expect(status.tabs.map((t) => t.id)).toEqual([opened[1]]);
  });
});

describe("raw CDP on the user's Chrome", () => {
  it.each([
    "Network.getAllCookies",
    "Network.getCookies",
    "Network.setCookie",
    "Network.clearBrowserCookies",
    "Network.setRequestInterception",
    "Storage.getCookies",
    "Fetch.enable",
    "Browser.close",
    "Target.createTarget",
    "Extensions.loadUnpacked",
    "Security.setIgnoreCertificateErrors",
    "DOM.setFileInputFiles",
    "Page.setDownloadBehavior",
  ])("refuses %s without sending it to Chrome", async (method) => {
    const h = mount();
    const chrome = await h.connect();
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}));
    const res = await h.call("POST", `/tabs/${tab.id}/cdp`, { method });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error.code).toBe("cdp_refused");
    expect(chrome.commands.some((c) => c.op === "cdp" && c.method === method)).toBe(false);
  });

  it("refuses a navigation to anything but a web page or about:blank", async () => {
    const h = mount();
    const chrome = await h.connect();
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}));
    const res = await h.call("POST", `/tabs/${tab.id}/cdp`, {
      method: "Page.navigate",
      params: { url: "file:///etc/passwd" },
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).error.code).toBe("invalid_url");
    expect(chrome.commands.some((c) => c.op === "cdp" && c.method === "Page.navigate")).toBe(false);
  });

  it.each([
    ["no_such_tab", 404, "no_such_tab"],
    ["tab_released", 409, "tab_released"],
    ["extension_paused", 503, "browser_unavailable"],
    ["cdp_refused", 403, "cdp_refused"],
    ["bad_url", 400, "invalid_url"],
    ["'Page.getLayoutMetrics' wasn't found", 422, "cdp_error"],
  ])("answers the extension's refusal %s with %i %s", async (refusal, status, code) => {
    const h = mount();
    const chrome = await h.connect();
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}));
    chrome.cdp = () => {
      throw new Error(refusal);
    };
    const res = await h.call("POST", `/tabs/${tab.id}/cdp`, { method: "Page.getLayoutMetrics" });
    expect(res.status).toBe(status);
    expect((await errorOf(res)).error.code).toBe(code);
  });

  it("passes a page-level method through", async () => {
    const h = mount();
    const chrome = await h.connect();
    const { tab } = await json<{ tab: BuiltinBrowserTab }>(await h.call("POST", "/tabs", {}));
    chrome.cdp = (_tabId, method) => (method === "Page.getLayoutMetrics" ? { ok: 1 } : {});
    const res = await h.call("POST", `/tabs/${tab.id}/cdp`, { method: "Page.getLayoutMetrics" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { ok: 1 } });
  });
});
