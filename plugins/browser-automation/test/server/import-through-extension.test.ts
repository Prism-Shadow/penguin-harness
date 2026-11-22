/**
 * Importing cookies into the built-in browser through the user's connected Chrome extension, over
 * a fake shell and a fake extension link (the routes mounted directly, an injected importer for
 * the profiles on disk).
 *
 * - Given no paired Chrome, then one paired but not connected, the sources say why the extension
 *   is not listed; once it connects, it is listed as a cookies-only source named after its Chrome.
 * - Given the user allows it in Chrome, the cookies the extension hands over pass the rules a
 *   profile's cookies pass — the sites asked for only, host-only and domain cookies shaped for the
 *   shell, partitioned and expired ones left behind and counted — and land in the same Project
 *   storage a profile's import writes to.
 * - Given the user declines in Chrome, nothing is written and the import answers
 *   `import_declined`; an extension from before the command answers `extension_outdated`; a
 *   paired Chrome that is not connected answers `extension_disconnected`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSource,
  BuiltinBrowserImportSourcesResponse,
  ChromeExtensionCookie,
  DesktopBrowserCommand,
} from "@prismshadow/penguin-server/api";
import type { AppEnv } from "@prismshadow/penguin-server/plugin";
import { ExtensionPairing } from "../../src/server/extension-pairing.js";
import { builtinBrowserRoutes } from "../../src/server/routes.js";
import { BuiltinBrowser } from "../../src/server/service.js";
import type { Importer } from "../../src/server/service.js";
import { handleError } from "./host.js";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { BrowserExtensionsRepo } from "@prismshadow/penguin-library-machine/browser-extensions";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { FakeChrome } from "./fake-chrome.js";
import { FakeShell } from "./fake-shell.js";

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

const diskChrome: BuiltinBrowserImportSource = {
  id: "chrome:Default",
  browser: "chrome",
  browserName: "Chrome",
  profile: "Default",
  profileName: "Person 1",
  hasCookies: true,
  hasHistory: true,
};

/** The profile on disk: one cookie, as a profile import reads it. */
const importer: Importer = {
  listImportSources: async () => [diskChrome],
  readCookies: async () => ({
    cookies: [{ url: "https://a.test/", name: "disk", value: "d", path: "/" }],
    found: 1,
    skips: [],
    notes: [],
  }),
  readHistory: async () => ({ entries: [], notes: [] }),
};

let root: string;
let db: DatabaseSync;
const browsers: BuiltinBrowser[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-import-ext-"));
  db = openDatabase(":memory:");
  db.exec(
    "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('admin', 'h', 1, '2026-11-19T00:00:00.000Z')",
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

function mount() {
  const shell = new FakeShell();
  const store = new BrowserExtensionsRepo(db);
  const browser = new BuiltinBrowser({
    port: shell.port,
    root,
    publish: () => {},
    log: () => {},
    sleep: async () => {},
    timing: { settleMs: 0, publishDelayMs: 0 },
    importer,
    chrome: { store, enabled: () => true, publishTo: () => {} },
  });
  browsers.push(browser);
  const pairing = new ExtensionPairing({
    store,
    user: (userId) => ({ userId, displayName: null }),
    installId: () => "install-1",
    serverVersion: "0.2.18",
    now: Date.now,
  });
  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", { userId: "admin", isAdmin: true } as UserRow);
    c.set("sessionVia", "desktop");
    await next();
  });
  app.route("/api/builtin-browser", builtinBrowserRoutes(browser, { pairing }));
  let token: string | null = null;
  const pair = () => {
    if (token !== null) return token;
    const { code } = pairing.mint("admin");
    token = pairing.pair({ code, name: "Chrome 130 on Windows", version: "0.2.18" }).token;
    return token;
  };
  return {
    shell,
    pair,
    call: async (method: string, url: string, body?: unknown) =>
      app.request(`/api/builtin-browser${url}`, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    /** Pairs a Chrome and connects it; resolves once it answered hello. */
    connect: async (chrome = new FakeChrome()) => {
      browser.connect(pair(), chrome);
      await until(() => browser.extensions?.unavailability("admin") === null, "the hello");
      return chrome;
    },
  };
}

async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const errorOf = async (res: Response) =>
  (await res.json()) as { error: { code: string; reason?: string } };
const setCookies = (commands: DesktopBrowserCommand[]) =>
  commands.filter(
    (c): c is Extract<DesktopBrowserCommand, { op: "set-cookies" }> => c.op === "set-cookies",
  );

/** A cookie as chrome.cookies hands it over. */
function chromeCookie(over: Partial<ChromeExtensionCookie>): ChromeExtensionCookie {
  return {
    domain: ".amazon.com",
    hostOnly: false,
    name: "session-id",
    value: "v",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expirationDate: now() + 30 * DAY,
    ...over,
  };
}

describe("the extension as an import source", () => {
  it("says why it is not listed until a paired Chrome connects, then lists it for cookies only", async () => {
    const h = mount();
    const sources = async () =>
      json<BuiltinBrowserImportSourcesResponse>(await h.call("GET", "/import/sources"));

    expect(await sources()).toEqual({ sources: [diskChrome], extension: "extension_not_paired" });
    h.pair();
    expect(await sources()).toEqual({
      sources: [diskChrome],
      extension: "extension_disconnected",
    });
    await h.connect();
    const listed = await sources();
    expect(listed.extension).toBeUndefined();
    expect(listed.sources[0]).toEqual(diskChrome);
    expect(listed.sources[1]).toMatchObject({
      id: "chrome-extension",
      via: "extension",
      browser: "chrome",
      profileName: "Chrome 130 on Windows",
      hasCookies: true,
      hasHistory: false,
    });
  });
});

describe("importing through the extension", () => {
  it("writes what Chrome hands over through a profile's rules, into the same Project storage", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cookieJar = [
      chromeCookie({ name: "session-id" }),
      chromeCookie({ domain: "www.amazon.com", hostOnly: true, name: "host-only", path: "/gp" }),
      chromeCookie({ name: "session", expirationDate: undefined, httpOnly: false }),
      chromeCookie({ name: "none-insecure", secure: false, sameSite: "no_restriction" }),
      chromeCookie({ domain: ".widgets.amazon.com", name: "embedded", partitioned: true }),
      chromeCookie({ name: "stale", expirationDate: now() - DAY }),
      chromeCookie({ domain: ".ebay.com", name: "other-site" }),
    ];

    const res = await h.call("POST", "/import", {
      sourceId: "chrome-extension",
      cookies: true,
      domains: ["amazon.com"],
      projectId: "project-a",
    });
    expect(res.status).toBe(200);
    const result = await json<BuiltinBrowserImportResult>(res);
    expect(result).toEqual({
      sourceId: "chrome-extension",
      browserName: "Chrome",
      cookies: {
        found: 6,
        imported: 4,
        skipped: 2,
        failed: 0,
        skips: [
          { reason: "partitioned", count: 1 },
          { reason: "expired", count: 1 },
        ],
      },
      notes: [],
    });
    expect(chrome.commands.some((c) => c.op === "read-cookies")).toBe(true);

    const byName = new Map(h.shell.cookies.map((c) => [c.name, c]));
    expect([...byName.keys()]).toEqual(["session-id", "host-only", "session", "none-insecure"]);
    // A domain cookie keeps its domain; a host-only one gets none, which would widen it.
    expect(byName.get("session-id")).toMatchObject({
      url: "https://amazon.com/",
      domain: ".amazon.com",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(byName.get("host-only")).toMatchObject({
      url: "https://www.amazon.com/gp",
      path: "/gp",
    });
    expect(byName.get("host-only")).not.toHaveProperty("domain");
    // A session cookie stays one; SameSite=None without Secure falls back to the default.
    expect(byName.get("session")).not.toHaveProperty("expirationDate");
    expect(byName.get("none-insecure")).toMatchObject({
      url: "http://amazon.com/",
      sameSite: "unspecified",
    });

    // The disk profile's import into the same Project writes to the same storage.
    await h.call("POST", "/import", {
      sourceId: "chrome:Default",
      cookies: true,
      projectId: "project-a",
    });
    const [viaExtension, fromDisk] = setCookies(h.shell.commands);
    expect(viaExtension?.partition).toBe(fromDisk?.partition);
    expect(viaExtension?.partition).not.toBe("persist:penguin-browser");
  });

  it("brings no history, and says so when both are asked for", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cookieJar = [chromeCookie({})];
    const result = await json<BuiltinBrowserImportResult>(
      await h.call("POST", "/import", { sourceId: "chrome-extension" }),
    );
    expect(result.cookies?.imported).toBe(1);
    expect(result.history).toBeUndefined();
    expect(result.notes).toEqual([{ code: "no_history" }]);
  });

  it("writes nothing and answers import_declined when the user declines in Chrome", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.cookieJar = [chromeCookie({})];
    chrome.consent = "deny";
    const res = await h.call("POST", "/import", { sourceId: "chrome-extension", cookies: true });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).error.code).toBe("import_declined");
    expect(setCookies(h.shell.commands)).toEqual([]);
  });

  it("answers extension_outdated for an extension from before the command", async () => {
    const h = mount();
    const chrome = await h.connect();
    chrome.readsCookies = false;
    const res = await h.call("POST", "/import", { sourceId: "chrome-extension", cookies: true });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).error.code).toBe("extension_outdated");
  });

  it("answers extension_disconnected while the paired Chrome is not connected", async () => {
    const h = mount();
    h.pair();
    const res = await h.call("POST", "/import", { sourceId: "chrome-extension", cookies: true });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).error.reason).toBe("extension_disconnected");
  });
});
