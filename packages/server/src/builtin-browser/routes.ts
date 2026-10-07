/**
 * The agent browser's HTTP API, mounted at /api/builtin-browser behind the cookie gate:
 *
 *   GET    /status                     the caller's backend: availability, tabs, active tab, and
 *                                      every backend offered to them (never 503)
 *   GET    /backend                    the caller's backend and the ones they may choose
 *   PUT    /backend                    choose one: {backend}; 409 action_in_flight while an agent acts
 *   GET    /tabs                       tabs and the active one
 *   POST   /tabs                       open a tab (built-in: a window creates it and claims it;
 *                                      chrome: the extension creates it); with no address it
 *                                      opens the homepage, or a blank page
 *   POST   /tabs/claim                 a window names the tab it created for a request (built-in)
 *   POST   /tabs/on-screen             a window names the tab it shows now, or none (built-in)
 *   POST   /tabs/:tab/activate         focus a tab (the user) or switch to it (the agent)
 *   DELETE /tabs/:tab                  close a tab
 *   POST   /tabs/:tab/navigate|scan|exec|click|type|screenshot|cdp   the agent's actions
 *   GET    /import/sources             system browser profiles that can be imported (built-in)
 *   POST   /import                     import cookies and / or history from one (built-in)
 *   GET    /settings                   the browser's settings (its homepage); admins
 *   PUT    /settings                   replace them: {homepage: address | null}; admins
 *   GET    /history?q=&limit=          search the history (built-in)
 *   DELETE /history                    forget it (built-in)
 *   POST   /clear-data                 clear the browser's cookies, cache or site storage (built-in)
 *   POST   /extension/pairings         a one-time pairing code for the signed-in user
 *   GET    /extension                  the caller's paired Chromes, the connected one, the switch
 *   DELETE /extension/:id              revoke one (its socket is closed 4003)
 *
 * And, outside the gate (extensionPairRoutes): POST /extension/pair, the extension trading a
 * code for its token. The WebSocket at /extension/ws is extension-ws.ts.
 *
 * `:tab` is a tab id or `active`. Who a call acts for is the signed-in user, except an agent's:
 * the admin API token with a `sessionId` (in the JSON body, or the query for a GET or DELETE)
 * acts for the human driving that session (runtime/session-drivers.ts), whose Chrome it is.
 * The built-in browser and its import, history and data are admins' (403 `admin_required`); on
 * chrome those answer 405 `not_supported`. Choosing a backend and minting a pairing code are the
 * signed-in person's own gestures: the API token gets 403 `human_required`. An unavailable
 * browser answers 503 `browser_unavailable` with a `reason` beside the code.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  BrowserBackend,
  BrowserBackendResponse,
  BrowserExtensionPairingResponse,
  BrowserExtensionPairResponse,
  BrowserExtensionsResponse,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserScreenshot,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
} from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError, errorBody } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import { isPenguinExtensionOrigin } from "./extension-origin.js";
import type { ExtensionPairing } from "./extension-pairing.js";
import { BrowserUnavailableError } from "./service.js";
import type { Actor, BuiltinBrowser } from "./service.js";

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

/** The same, from the query of a GET or DELETE. */
function sessionIdQuery(c: Context<AppEnv>): string | undefined {
  const id = c.req.query("sessionId");
  return id === undefined || id === "" ? undefined : id.slice(0, 200);
}

const STORAGES = new Set(["cookies", "cache", "storage"]);
const BACKENDS: readonly BrowserBackend[] = ["builtin", "chrome"];

/** What the routes need beside the browser. */
export interface BrowserRouteDeps {
  /** The human an agent's session acts for (runtime/session-drivers.ts); null when nobody is known. */
  driverOf?(sessionId: string): Actor | null;
  /** The extension pairing; absent, the server offers no chrome and the extension routes 404. */
  pairing?: ExtensionPairing;
}

const adminRequired = () =>
  new HttpError(403, "admin_required", "The built-in browser is for admins only.");

/** The signed-in person's own gesture: never the API token an agent holds. */
function requireHuman(c: Context<AppEnv>): void {
  if (c.var.sessionVia === "token") {
    throw new HttpError(
      403,
      "human_required",
      "Only the signed-in user can do this, in the app; an API token cannot.",
    );
  }
}

export function builtinBrowserRoutes(
  browser: BuiltinBrowser,
  deps: BrowserRouteDeps = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // The reason travels beside the code; every other error goes to the App's own handler.
  app.onError((err, c) => {
    if (err instanceof BrowserUnavailableError) {
      return c.json({ error: { code: err.code, message: err.message, reason: err.reason } }, 503);
    }
    throw err;
  });

  /**
   * Who the call acts for: the signed-in user, or — for the admin API token naming a session —
   * the human driving that session, so an agent drives its own user's Chrome.
   */
  const actorOf = (c: Context<AppEnv>, sessionId: string | undefined): Actor => {
    const own = { userId: c.var.user.userId, isAdmin: c.var.user.isAdmin };
    if (c.var.sessionVia !== "token" || sessionId === undefined) return own;
    return deps.driverOf?.(sessionId) ?? own;
  };
  const queryActor = (c: Context<AppEnv>) => actorOf(c, sessionIdQuery(c));
  const bodyActor = (c: Context<AppEnv>, body: Body) =>
    actorOf(c, sessionIdOf(body) ?? sessionIdQuery(c));
  const hub = () => {
    if (browser.extensions === null || deps.pairing === undefined) {
      throw new HttpError(404, "not_found", "This server does not offer driving your own Chrome.");
    }
    return { extensions: browser.extensions, pairing: deps.pairing };
  };

  app.get("/status", async (c) =>
    c.json((await browser.status(queryActor(c))) satisfies BuiltinBrowserStatus),
  );

  app.get("/backend", (c) =>
    c.json(browser.backendChoice(queryActor(c)) satisfies BrowserBackendResponse),
  );

  app.put("/backend", async (c) => {
    requireHuman(c);
    const body = await jsonBody(c);
    const backend = body.backend;
    if (typeof backend !== "string" || !BACKENDS.includes(backend as BrowserBackend)) {
      throw badRequest('backend is "builtin" or "chrome".');
    }
    const actor = { userId: c.var.user.userId, isAdmin: c.var.user.isAdmin };
    return c.json(
      browser.setBackend(actor, backend as BrowserBackend) satisfies BrowserBackendResponse,
    );
  });

  app.post("/extension/pairings", (c) => {
    requireHuman(c);
    const { extensions, pairing } = hub();
    const userId = c.var.user.userId;
    if (extensions.unavailability(userId) === "extension_disabled") {
      throw new BrowserUnavailableError("extension_disabled");
    }
    const minted = pairing.mint(userId);
    return c.json({
      ...minted,
      origin: c.req.header("origin") ?? null,
    } satisfies BrowserExtensionPairingResponse);
  });

  app.get("/extension", (c) =>
    c.json(hub().extensions.list(c.var.user.userId) satisfies BrowserExtensionsResponse),
  );

  app.delete("/extension/:id", (c) => {
    if (!hub().extensions.revoke(c.var.user.userId, c.req.param("id"))) {
      throw new HttpError(404, "not_found", "No Chrome with that id is paired to your account.");
    }
    return c.body(null, 204);
  });

  app.get("/tabs", async (c) => c.json(await browser.listTabs(queryActor(c))));

  app.post("/tabs", async (c) => {
    const body = await jsonBody(c);
    const url = optString(body, "url");
    const activate = optBool(body, "activate");
    const sessionId = sessionIdOf(body);
    const tab = await browser.openTab(bodyActor(c, body), {
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
    await browser.claim(actorOf(c, undefined), requestId, tabId);
    return c.body(null, 204);
  });

  app.post("/tabs/on-screen", async (c) => {
    const body = await jsonBody(c);
    const tabId = body.tabId;
    if (
      tabId !== null &&
      (typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId < 0)
    ) {
      throw badRequest("tabId is the tab on screen, or null for none.");
    }
    browser.setOnScreen(actorOf(c, undefined), tabId);
    return c.body(null, 204);
  });

  app.post("/tabs/:tab/activate", async (c) => {
    const body = await jsonBody(c);
    const tab = await browser.activate(bodyActor(c, body), c.req.param("tab"));
    return c.json({ tab } satisfies { tab: BuiltinBrowserTab });
  });

  app.delete("/tabs/:tab", async (c) => {
    await browser.close(queryActor(c), c.req.param("tab"));
    return c.body(null, 204);
  });

  app.post("/tabs/:tab/navigate", async (c) => {
    const body = await jsonBody(c);
    const tab = await browser.navigate(
      bodyActor(c, body),
      c.req.param("tab"),
      body.url,
      sessionIdOf(body),
    );
    return c.json({ tab } satisfies { tab: BuiltinBrowserTab });
  });

  app.post("/tabs/:tab/scan", async (c) => {
    const body = await jsonBody(c);
    const textOnly = optBool(body, "textOnly");
    const maxChars = optInt(body, "maxChars", 500, 2_000_000);
    const instruction = optString(body, "instruction");
    const result = await browser.scan(
      bodyActor(c, body),
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
    const acceptDialogs = optBool(body, "acceptDialogs");
    const result = await browser.exec(
      bodyActor(c, body),
      c.req.param("tab"),
      script,
      {
        ...(noMonitor !== undefined ? { noMonitor } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(acceptDialogs !== undefined ? { acceptDialogs } : {}),
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
    const acceptDialogs = optBool(body, "acceptDialogs");
    return c.json(
      await browser.click(
        bodyActor(c, body),
        c.req.param("tab"),
        target,
        acceptDialogs !== undefined ? { acceptDialogs } : {},
        sessionIdOf(body),
      ),
    );
  });

  app.post("/tabs/:tab/type", async (c) => {
    const body = await jsonBody(c);
    const text = requiredString(body, "text", true);
    const selector = optString(body, "selector");
    const submit = optBool(body, "submit");
    const acceptDialogs = optBool(body, "acceptDialogs");
    return c.json(
      await browser.type(
        bodyActor(c, body),
        c.req.param("tab"),
        {
          text,
          ...(selector !== undefined && selector.trim() !== "" ? { selector } : {}),
          ...(submit !== undefined ? { submit } : {}),
          ...(acceptDialogs !== undefined ? { acceptDialogs } : {}),
        },
        sessionIdOf(body),
      ),
    );
  });

  app.post("/tabs/:tab/screenshot", async (c) => {
    const body = await jsonBody(c);
    const fullPage = optBool(body, "fullPage");
    const shot = await browser.screenshot(
      bodyActor(c, body),
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
      bodyActor(c, body),
      c.req.param("tab"),
      method,
      params as Record<string, unknown> | undefined,
      sessionIdOf(body),
    );
    return c.json({ result });
  });

  app.get("/import/sources", (c) =>
    c.json({
      sources: browser.listImportSources(queryActor(c)),
    } satisfies BuiltinBrowserImportSourcesResponse),
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
    const result = await browser.importFrom(bodyActor(c, body), {
      sourceId,
      ...(cookies !== undefined ? { cookies } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(Array.isArray(domains)
        ? { domains: (domains as string[]).map((d) => d.trim()).filter((d) => d !== "") }
        : {}),
    });
    return c.json(result satisfies BuiltinBrowserImportResult);
  });

  app.get("/settings", async (c) => {
    if (!c.var.user.isAdmin) throw adminRequired();
    return c.json((await browser.getSettings()) satisfies BuiltinBrowserSettings);
  });

  app.put("/settings", async (c) => {
    if (!c.var.user.isAdmin) throw adminRequired();
    const body = await jsonBody(c);
    if (!("homepage" in body)) {
      throw badRequest("homepage is required: a web address, or null for none.");
    }
    const saved = await browser.updateSettings({ homepage: body.homepage });
    return c.json(saved satisfies BuiltinBrowserSettings);
  });

  app.get("/history", (c) => {
    const raw = c.req.query("limit");
    const limit = raw === undefined || raw === "" ? 20 : Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw badRequest("limit must be an integer from 1 to 500.");
    }
    const entries = browser.searchHistory(queryActor(c), c.req.query("q") ?? "", limit);
    return c.json({ entries } satisfies BuiltinBrowserHistoryResponse);
  });

  app.delete("/history", (c) => {
    browser.clearHistory(queryActor(c));
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
    await browser.clearData(bodyActor(c, body), storages as ("cookies" | "cache" | "storage")[]);
    return c.body(null, 204);
  });

  return app;
}

/**
 * POST /api/builtin-browser/extension/pair, mounted in front of the cookie gate: the extension's
 * options page trades the user's pairing code for its token. No cookie is read — the code is the
 * credential. The extension calls from its own origin (extension-origin.ts), so this one route
 * answers CORS for it — the preflight too, including Chrome's Private Network Access one for a
 * server on the loopback or the LAN; any other Origin is refused outright, and a request with
 * none (a tool, a test) is let through.
 */
export function extensionPairRoutes(pairing: ExtensionPairing | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  /** The extension's origin may read the answer; a web page's is refused, none is a tool. */
  const answer = (c: Context<AppEnv>, respond: () => Response | Promise<Response>) => {
    const origin = c.req.header("origin");
    if (origin !== undefined && !isPenguinExtensionOrigin(origin)) {
      return c.json(
        errorBody("forbidden_origin", "Only the PenguinHarness Browser extension pairs here."),
        403,
      );
    }
    if (origin !== undefined) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    return respond();
  };
  app.options("/", (c) =>
    answer(c, () => {
      c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "content-type");
      c.header("Access-Control-Max-Age", "600");
      if (c.req.header("access-control-request-private-network") === "true") {
        c.header("Access-Control-Allow-Private-Network", "true");
      }
      return c.body(null, 204);
    }),
  );
  app.post("/", (c) =>
    answer(c, async () => {
      try {
        if (pairing === null) {
          throw new HttpError(
            404,
            "not_found",
            "This server does not offer driving your own Chrome.",
          );
        }
        const body = await jsonBody(c);
        const paired = pairing.pair({
          code: requiredString(body, "code"),
          name: requiredString(body, "name"),
          version: requiredString(body, "version"),
        });
        return c.json(paired satisfies BrowserExtensionPairResponse);
      } catch (err) {
        // Answered here, with the CORS headers, so the extension can read why.
        if (err instanceof HttpError) {
          return c.json(errorBody(err.code, err.message), err.status as 400);
        }
        throw err;
      }
    }),
  );
  return app;
}
