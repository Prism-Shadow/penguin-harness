/**
 * Auth middleware: `Authorization: Bearer <local API token>` -> the built-in admin, or
 * session cookie -> auth_sessions row -> user; either way the user is injected into c.var.
 *
 * The Bearer path authenticates the boot's local API token (`<root>/api-token`, see
 * auth/api-token.ts) as the admin — the CLI's and agents' machine-local credential; it
 * applies to every route behind this middleware, SSE endpoints included (the CLI
 * consumes SSE via fetch with headers). A Bearer header that does not match fails the
 * request rather than falling back to the cookie: silently downgrading a wrong explicit
 * credential would mask misconfiguration. A few writes refuse the token all the same and take a
 * person's sign-in (requireHuman).
 *
 * Accessing a protected API while logged out -> 401 `{error:{code:"unauthorized"}}`.
 * CSRF: SameSite=Lax plus a Content-Type an HTML form cannot forge (see jsonOnlyWrites).
 * That guard stays for Bearer requests too — the CLI always sends application/json.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { parse } from "hono/utils/cookie";
import { AMSP_PREFIX } from "../amsp/cors.js";
import { HttpError } from "../http/errors.js";
import { mediaType } from "../http/media-type.js";
import {
  NO_PROXY_RULE,
  acceptsOrigin,
  forwardedHeaders,
  publicOriginOf,
  sameOriginSite,
} from "../http/public-origin.js";
import type { OriginRule } from "../http/public-origin.js";
import type { UserRow } from "../db/repos/users.js";
import type { SessionVia } from "./service.js";
import type { Auth } from "../mechanisms/identity.js";

/**
 * The session cookie's name as every non-browser client spells it: the CLI, and a server
 * speaking to a machine it holds, each with a cookie jar of its own.
 */
export const SESSION_COOKIE = "penguin_session";

/** Browsers share cookies across ports; non-browser jars retain the legacy plain name. */
export function sessionCookieName(requestUrl: string | URL, browser: boolean): string {
  const port = browser ? new URL(requestUrl).port : "";
  return port ? `${SESSION_COOKIE}_${port}` : SESSION_COOKIE;
}

/** Prefer this request URL's port cookie, retaining the legacy plain-cookie fallback. */
export function sessionCookies(
  cookies: Record<string, string | undefined>,
  requestUrl: string | URL,
): { name: string; token: string }[] {
  const own = sessionCookieName(requestUrl, true);
  const names = own === SESSION_COOKIE ? [own] : [own, SESSION_COOKIE];
  return names.flatMap((name) => {
    const token = cookies[name];
    return token ? [{ name, token }] : [];
  });
}

/** Use the same public parser as hono/cookie: first duplicate wins, bad escapes never throw. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  return parse(header ?? "");
}

// The origin comparison lives with the public-origin rule (http/public-origin.ts); re-exported
// for the callers that reach it here.
export { isOwnOrigin } from "../http/public-origin.js";

/**
 * Session cookie attributes, shared by every path that sets one. `maxAge` comes from the
 * service that issues the sessions, never written here: the ROW carries the authoritative
 * expiry, and a cookie that expired first would log someone out mid-session.
 */
export function cookieOptions(
  c: { req: { url: string; header(name: string): string | undefined } },
  ttlMs: number,
  trustProxy: boolean,
) {
  // Secure when the public origin is https. `x-forwarded-proto` counts only when the deployment
  // trusts it (config.trustProxy — the same gate hmr/routes.ts uses, and for the same reason).
  // Trusting it on a plain-HTTP bind would let anyone reaching the port get a Secure cookie back,
  // which the browser then refuses to send over that connection: a sign-in that never takes.
  const secure = new URL(publicOriginOf(c, trustProxy)).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
    ...(secure ? { secure: true } : {}),
  };
}

/** Hono env: variables injected by the auth middleware. */
export type AppEnv = {
  Variables: {
    user: UserRow;
    /** How the current session was established — see {@link SessionVia}. */
    sessionVia: SessionVia;
  };
};

/** Gets the current user (available after authMiddleware). */
export function currentUser(c: { var: { user: UserRow } }): UserRow {
  return c.var.user;
}

export function authMiddleware(
  auth: Auth,
  trustProxy: boolean,
  options: { apiTokenOnly?: boolean } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Bearer first: an explicit credential on the request outranks ambient cookies, and
    // a wrong one is an error, never a silent fallback (see the module doc).
    const bearer = bearerToken(c.req.header("authorization"));
    if (bearer !== null) {
      const viaToken = auth.authenticateApiToken(bearer);
      if (!viaToken) {
        throw new HttpError(401, "unauthorized", "Invalid API token.");
      }
      c.set("user", viaToken.user);
      c.set("sessionVia", viaToken.via);
      await next();
      return;
    }
    const cookies = sessionCookies(getCookie(c), c.req.url);
    // Classify a refused cookie without renewing its session or setting a response cookie.
    if (options.apiTokenOnly) {
      if (cookies.some((cookie) => auth.sessionIsLive(cookie.token))) {
        throw new HttpError(
          403,
          "local_api_token_required",
          "Only the local API token may issue a remote browser session.",
        );
      }
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    let held: { name: string; token: string } | undefined;
    let authed: ReturnType<Auth["authenticateWithMeta"]> = null;
    for (const cookie of cookies) {
      authed = auth.authenticateWithMeta(cookie.token);
      if (authed) {
        held = cookie;
        break;
      }
    }
    if (!authed) {
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    // Sliding renewal: the session's expiry was topped up in place, so refresh the cookie's
    // own max-age to match. The token value is unchanged — same session, longer life.
    if (authed.renewed && held) {
      // Under the name it arrived under: a renewal is the same cookie, longer-lived.
      setCookie(c, held.name, held.token, cookieOptions(c, auth.sessionTtlMs, trustProxy));
    }
    c.set("user", authed.user);
    c.set("sessionVia", authed.via);
    await next();
  };
}

/** The token of an `Authorization: Bearer <token>` header (scheme matched case-insensitively); null for any other shape. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m === null ? null : m[1]!.trim();
}

/**
 * Refuses the local API token, presented as a Bearer header, on a write that only a person may
 * make: 403 `human_required`. Every cookie session passes as the person's sign-in — from the Web
 * App, `penguin auth login` or `penguin auth token`, and the Penguin Remote session exchanged
 * from the token itself. Every tool subprocess of a server-driven Session holds that token as
 * `PENGUIN_API_TOKEN`, so these are the writes an Agent must not make from its own shell:
 *
 * - who can reach an Agent from outside — its API switch, keyless access and approval mode, its
 *   keys, the API tab's Try it, and the admin's `agentApiEnabled` (http/routes/agent-api.ts,
 *   amsp/try-route.ts, http/routes/admin-settings.ts);
 * - the person's own browser — choosing the agent browser's backend, minting a pairing code
 *   (builtin-browser/routes.ts).
 *
 * This narrows the credential the harness hands an Agent; it is not a boundary. A process that
 * runs as the data root's OS user outside the sandbox can mint a sign-in of its own
 * (`penguin auth token`), or reset a password with the token and sign in; and an Agent holding
 * the token can exchange it for a Remote session (POST /api/remote/session) that passes here.
 * The sandbox is the boundary. A per-Session credential (design PR #235) is the structural fix:
 * when it lands, this check becomes "a Session's credential is refused, a person's login is
 * not", and the routes calling it do not change.
 */
export function requireHuman(c: { var: { sessionVia: SessionVia } }): void {
  if (c.var.sessionVia === "token") {
    throw new HttpError(
      403,
      "human_required",
      "This takes a person's sign-in; the local API token cannot do it.",
    );
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Writes that are cross-origin by design and judge their caller's origin themselves, so the
 * same-origin rule below is not theirs. POST /api/builtin-browser/extension/pair is the
 * PenguinHarness Browser extension calling from its `chrome-extension://` origin: it reads no
 * cookie (the pairing code is the credential) and admits only the extension's own origin,
 * refusing a web page's 403 (builtin-browser/routes.ts, extensionPairRoutes).
 */
const OWN_ORIGIN_RULE_PATHS = new Set(["/api/builtin-browser/extension/pair"]);

/**
 * The Agent API's writes are cross-origin by contract, and its own group is what judges them.
 * `/api/amsp/v1` answers a preflight from any origin and sends `Access-Control-Allow-Origin: *`
 * on a request that carries `Authorization` (amsp/cors.ts; the server-api page states it as the
 * public contract), so a program outside PenguinHarness calls it from a page of its own. The
 * credential there is the Agent's key as a Bearer, never this app's cookie: the group's gate
 * checks the key and a cookie falls through to its 401 (amsp/gate.ts). Hence the one exception
 * below — inside the exact prefix boundary and with a parseable Bearer — while a cookie-bearing
 * or credential-less write is still held to the same-origin rule.
 */
function isAmspKeyedWrite(c: Context): boolean {
  const path = c.req.path;
  if (path !== AMSP_PREFIX && !path.startsWith(`${AMSP_PREFIX}/`)) return false;
  return bearerToken(c.req.header("authorization")) !== null;
}

/**
 * CSRF defense, first line: a write a browser makes must come from a page of THIS origin. The
 * browser states the origin itself (`Origin` rides on every POST, PUT, PATCH and DELETE, and a
 * page cannot forge it), so this asks the question directly — where the content-type rule
 * below only asks what a cross-site form is able to send. Scheme, host AND port: cookies ignore
 * the port, so `SameSite` lets a page served by any other local server ride the session, and a
 * browser without schemeful SameSite hands the https cookie to a page on `http://` of the same
 * host. A browser that sends `Sec-Fetch-Site` must also say `same-origin` there. The browser
 * computes it, scheme included, so this refuses such a page even where the desktop's transition
 * (OriginRule.acceptOwnOrigin) lets its `Origin` through.
 */
export const sameOriginWrites =
  (rule: OriginRule = NO_PROXY_RULE): MiddlewareHandler =>
  async (c, next) => {
    if (
      WRITE_METHODS.has(c.req.method) &&
      !OWN_ORIGIN_RULE_PATHS.has(c.req.path.replace(/\/+$/, "")) &&
      !isAmspKeyedWrite(c) &&
      !(
        sameOriginSite(c.req.header("sec-fetch-site")) &&
        acceptsOrigin(c.req.header("origin"), c.req.url, forwardedHeaders(c), rule)
      )
    ) {
      throw new HttpError(
        403,
        "cross_origin_write",
        "A write must come from this app's own pages.",
      );
    }
    await next();
  };

/**
 * CSRF defense, second line: a write must carry one of these Content-Types, none of which an
 * HTML form can forge (a form is limited to x-www-form-urlencoded, multipart/form-data,
 * text/plain). json is the API default; gzip and octet-stream are the hot-update web push's
 * artifact transport (src/hmr). A write with no Content-Type is let through only when it has
 * no body either: a page can send a body with no type at all (`fetch` with an untyped Blob,
 * `mode: "no-cors"`), and the handlers parse JSON without asking what it was labelled.
 */
const ALLOWED_WRITE_CONTENT_TYPES = [
  "application/json",
  "application/gzip",
  "application/octet-stream",
];

/**
 * A workbench's own handler (`…/workbenches/:id/api/*`) takes any body — an upload, a form of a
 * program it relays — so there the content type cannot be the defense. What stands in for it
 * is the browser's own account of where the request came from, which a page cannot forge:
 * `Sec-Fetch-Site`, and `Origin` against `Host` for a browser that sends no fetch metadata.
 * A request with neither is not a browser's, and carries no ambient cookie to ride on.
 * A write there is covered by `sameOriginWrites` above; this is what stands in for the
 * content-type rule, and what guards the handler's reads.
 */
const WORKBENCH_API = /^\/api\/projects\/[^/]+\/agents\/[^/]+\/workbenches\/[^/]+\/api(\/|$)/;

function fromThisOrigin(c: Context, rule: OriginRule): boolean {
  const header = (name: string) => c.req.header(name);
  const site = header("sec-fetch-site");
  if (site !== undefined) return site === "same-origin";
  return acceptsOrigin(header("origin"), c.req.url, forwardedHeaders(c), rule);
}

const crossOrigin = () =>
  new HttpError(
    403,
    "cross_origin_write",
    "A request to a workbench's handler must come from this app's own pages.",
  );

export const jsonOnlyWrites =
  (rule: OriginRule = NO_PROXY_RULE): MiddlewareHandler =>
  async (c, next) => {
    // A workbench's handler answers every method, so its GET is whatever the workbench made it
    // — not the read every other route's GET is. A `SameSite=Lax` cookie rides along on a
    // cross-site top-level navigation, so `window.open` on another site would otherwise run
    // that handler as the signed-in user; the browser's own account of where the request came
    // from is what settles it, on every method rather than only on writes.
    if (!WRITE_METHODS.has(c.req.method) && WORKBENCH_API.test(c.req.path)) {
      if (!fromThisOrigin(c, rule)) throw crossOrigin();
    }
    if (WRITE_METHODS.has(c.req.method)) {
      const contentType = c.req.header("content-type");
      const type = mediaType(contentType);
      const forgeable =
        contentType !== undefined &&
        contentType !== "" &&
        !ALLOWED_WRITE_CONTENT_TYPES.includes(type?.essence ?? "");
      const hasBody =
        Number(c.req.header("content-length") ?? 0) > 0 ||
        c.req.header("transfer-encoding") !== undefined;
      // A workbench's own handler takes any body; the origin rule is its whole defense there.
      if (WORKBENCH_API.test(c.req.path)) {
        if (forgeable && !fromThisOrigin(c, rule)) throw crossOrigin();
      } else if (contentType ? forgeable : hasBody) {
        throw new HttpError(
          415,
          "unsupported_media_type",
          "Write requests only accept application/json (or, for the hot-update web push, a gzip artifact).",
        );
      }
    }
    await next();
  };
