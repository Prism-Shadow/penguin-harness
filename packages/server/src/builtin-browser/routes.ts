/**
 * The built-in browser's HTTP API, mounted at /api/builtin-browser behind the cookie gate:
 *
 *   GET    /status                     availability, tabs, active tab (never 503)
 *   GET    /tabs                       tabs and the active one
 *   POST   /tabs                       open a tab (a window creates it and claims it)
 *   POST   /tabs/claim                 a window names the tab it created for a request
 *   POST   /tabs/:tab/activate         focus a tab (the user) or switch to it (the agent)
 *   DELETE /tabs/:tab                  close a tab
 *   POST   /tabs/:tab/navigate|scan|exec|click|type|screenshot|cdp   the agent's actions
 *   GET    /import/sources             system browser profiles that can be imported
 *   POST   /import                     import cookies and / or history from one
 *   GET    /history?q=&limit=          search the history
 *   DELETE /history                    forget it
 *   POST   /clear-data                 clear the browser's cookies, cache or site storage
 *
 * `:tab` is a tab id or `active`. Every route is an admin's: the desktop window signs in as
 * the admin, and an Agent's CLI calls with the admin's local API token. An unavailable browser
 * answers 503 `browser_unavailable` with a `reason` beside the code.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserScreenshot,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { BrowserUnavailableError } from "./service.js";
import type { BuiltinBrowser } from "./service.js";

type Body = Record<string, unknown>;

/** The request's JSON object; an empty body is an empty object. */
async function jsonBody(c: Context<AppEnv>): Promise<Body> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("The body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("The body must be a JSON object.");
  }
  return parsed as Body;
}

function optString(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`${key} must be a string.`);
  return value;
}

function requiredString(body: Body, key: string, allowEmpty = false): string {
  const value = optString(body, key);
  if (value === undefined || (!allowEmpty && value.trim() === "")) {
    throw badRequest(`${key} is required.`);
  }
  return value;
}

function optBool(body: Body, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} must be true or false.`);
  return value;
}

function optInt(body: Body, key: string, min: number, max: number): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw badRequest(`${key} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function optNumber(body: Body, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw badRequest(`${key} must be a number.`);
  return value;
}

/** The session an Agent's CLI names (PENGUIN_SESSION_ID), so the window can follow its work. */
function sessionIdOf(body: Body): string | undefined {
  const id = optString(body, "sessionId");
  return id === undefined || id === "" ? undefined : id.slice(0, 200);
}

const STORAGES = new Set(["cookies", "cache", "storage"]);

export function builtinBrowserRoutes(browser: BuiltinBrowser): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // The reason travels beside the code; every other error goes to the App's own handler.
  app.onError((err, c) => {
    if (err instanceof BrowserUnavailableError) {
      return c.json({ error: { code: err.code, message: err.message, reason: err.reason } }, 503);
    }
    throw err;
  });

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "The built-in browser is for admins only.");
    }
    await next();
  });

  app.get("/status", async (c) => c.json((await browser.status()) satisfies BuiltinBrowserStatus));

  app.get("/tabs", async (c) => c.json(await browser.listTabs()));

  app.post("/tabs", async (c) => {
    const body = await jsonBody(c);
    const url = optString(body, "url");
    const activate = optBool(body, "activate");
    const sessionId = sessionIdOf(body);
    const tab = await browser.openTab({
      ...(url !== undefined ? { url } : {}),
      ...(activate !== undefined ? { activate } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
    return c.json({ tab } satisfies { tab: BuiltinBrowserTab });
  });

  app.post("/tabs/claim", async (c) => {
    const body = await jsonBody(c);
    const requestId = requiredString(body, "requestId");
    const tabId = optInt(body, "tabId", 0, Number.MAX_SAFE_INTEGER);
    if (tabId === undefined) throw badRequest("tabId is required.");
    await browser.claim(requestId, tabId);
    return c.body(null, 204);
  });

  app.post("/tabs/:tab/activate", async (c) => {
    const tab = await browser.activate(c.req.param("tab"));
    return c.json({ tab } satisfies { tab: BuiltinBrowserTab });
  });

  app.delete("/tabs/:tab", async (c) => {
    await browser.close(c.req.param("tab"));
    return c.body(null, 204);
  });

  app.post("/tabs/:tab/navigate", async (c) => {
    const body = await jsonBody(c);
    const tab = await browser.navigate(c.req.param("tab"), body.url, sessionIdOf(body));
    return c.json({ tab } satisfies { tab: BuiltinBrowserTab });
  });

  app.post("/tabs/:tab/scan", async (c) => {
    const body = await jsonBody(c);
    const textOnly = optBool(body, "textOnly");
    const maxChars = optInt(body, "maxChars", 500, 2_000_000);
    const instruction = optString(body, "instruction");
    const result = await browser.scan(
      c.req.param("tab"),
      {
        ...(textOnly !== undefined ? { textOnly } : {}),
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(instruction !== undefined ? { instruction } : {}),
      },
      sessionIdOf(body),
    );
    return c.json(result);
  });

  app.post("/tabs/:tab/exec", async (c) => {
    const body = await jsonBody(c);
    const script = requiredString(body, "script");
    const noMonitor = optBool(body, "noMonitor");
    const timeoutMs = optInt(body, "timeoutMs", 1_000, 600_000);
    const result = await browser.exec(
      c.req.param("tab"),
      script,
      {
        ...(noMonitor !== undefined ? { noMonitor } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
      sessionIdOf(body),
    );
    return c.json(result);
  });

  app.post("/tabs/:tab/click", async (c) => {
    const body = await jsonBody(c);
    const selector = optString(body, "selector");
    const x = optNumber(body, "x");
    const y = optNumber(body, "y");
    let target: { selector: string; index?: number } | { x: number; y: number };
    if (selector !== undefined && selector.trim() !== "") {
      const index = optInt(body, "index", 0, 100_000);
      target = { selector, ...(index !== undefined ? { index } : {}) };
    } else if (x !== undefined && y !== undefined) {
      target = { x, y };
    } else {
      throw badRequest(
        "Name the element to click with selector (and index), or a point with x and y.",
      );
    }
    return c.json(await browser.click(c.req.param("tab"), target, sessionIdOf(body)));
  });

  app.post("/tabs/:tab/type", async (c) => {
    const body = await jsonBody(c);
    const text = requiredString(body, "text", true);
    const selector = optString(body, "selector");
    const submit = optBool(body, "submit");
    return c.json(
      await browser.type(
        c.req.param("tab"),
        {
          text,
          ...(selector !== undefined && selector.trim() !== "" ? { selector } : {}),
          ...(submit !== undefined ? { submit } : {}),
        },
        sessionIdOf(body),
      ),
    );
  });

  app.post("/tabs/:tab/screenshot", async (c) => {
    const body = await jsonBody(c);
    const fullPage = optBool(body, "fullPage");
    const shot = await browser.screenshot(
      c.req.param("tab"),
      fullPage !== undefined ? { fullPage } : {},
      sessionIdOf(body),
    );
    return c.json(shot satisfies BuiltinBrowserScreenshot);
  });

  app.post("/tabs/:tab/cdp", async (c) => {
    const body = await jsonBody(c);
    const method = requiredString(body, "method");
    if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) {
      throw badRequest("method is a CDP method name, Domain.method (e.g. Page.navigate).");
    }
    const params = body.params;
    if (
      params !== undefined &&
      (typeof params !== "object" || params === null || Array.isArray(params))
    ) {
      throw badRequest("params must be a JSON object.");
    }
    const result = await browser.cdp(
      c.req.param("tab"),
      method,
      params as Record<string, unknown> | undefined,
      sessionIdOf(body),
    );
    return c.json({ result });
  });

  app.get("/import/sources", (c) =>
    c.json({ sources: browser.listImportSources() } satisfies BuiltinBrowserImportSourcesResponse),
  );

  app.post("/import", async (c) => {
    const body = await jsonBody(c);
    const sourceId = requiredString(body, "sourceId");
    const cookies = optBool(body, "cookies");
    const history = optBool(body, "history");
    const domains = body.domains;
    if (
      domains !== undefined &&
      (!Array.isArray(domains) || !domains.every((d) => typeof d === "string"))
    ) {
      throw badRequest("domains must be a list of site names.");
    }
    const result = await browser.importFrom({
      sourceId,
      ...(cookies !== undefined ? { cookies } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(Array.isArray(domains)
        ? { domains: (domains as string[]).map((d) => d.trim()).filter((d) => d !== "") }
        : {}),
    });
    return c.json(result satisfies BuiltinBrowserImportResult);
  });

  app.get("/history", (c) => {
    const raw = c.req.query("limit");
    const limit = raw === undefined || raw === "" ? 20 : Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw badRequest("limit must be an integer from 1 to 500.");
    }
    const entries = browser.searchHistory(c.req.query("q") ?? "", limit);
    return c.json({ entries } satisfies BuiltinBrowserHistoryResponse);
  });

  app.delete("/history", (c) => {
    browser.clearHistory();
    return c.body(null, 204);
  });

  app.post("/clear-data", async (c) => {
    const body = await jsonBody(c);
    const storages = body.storages;
    if (
      !Array.isArray(storages) ||
      storages.length === 0 ||
      !storages.every((s) => typeof s === "string" && STORAGES.has(s))
    ) {
      throw badRequest('storages is a non-empty list of "cookies", "cache" and "storage".');
    }
    await browser.clearData(storages as ("cookies" | "cache" | "storage")[]);
    return c.body(null, 204);
  });

  return app;
}
