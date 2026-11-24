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
import type { SessionVia, Auth } from "@prismshadow/penguin-library-auth";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { parse } from "hono/utils/cookie";
import { AMSP_PREFIX } from "../amsp/cors.js";
import { HttpError } from "../http/errors.js";
import { mediaType } from "@prismshadow/penguin-library-http/media-type";
import {
  NO_PROXY_RULE,
  acceptsOrigin,
  forwardedHeaders,
  publicOriginOf,
  sameOriginSite,
} from "@prismshadow/penguin-library-http/public-origin";
import type { OriginRule } from "@prismshadow/penguin-library-http/public-origin";
import type { OwnOrigin } from "../http/own-origin.js";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { SESSION_COOKIE } from "../api/types.js";
import type { AppEnv } from "@prismshadow/penguin-library-http/app-env";

/** The session cookie's name as every non-browser client spells it (declared in the API contract). */
export { SESSION_COOKIE };

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

// The origin comparison lives with the public-origin rule (@prismshadow/penguin-library-http/public-origin); re-exported
// for the callers that reach it here.
export { isOwnOrigin } from "@prismshadow/penguin-library-http/public-origin";

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

/**
 * Hono env: variables injected by the auth middleware. The shape moved to the http
 * vocabulary package (services+http+cli restack T0) — routes and middlewares on both
 * sides speak it, so it lives beside the pieces they share; the middleware that fills
 * these variables stays here.
 */
export type { AppEnv } from "@prismshadow/penguin-library-http/app-env";

/** Gets the current user (available after authMiddleware). */
export function currentUser(c: { var: { user: UserRow } }): UserRow {
  return c.var.user;
}

export interface AuthMiddlewareOptions {
  apiTokenOnly?: boolean;
  /**
   * Optional verifier for per-Session Bearer tokens (`auth/session-token.ts`). Only consulted
   * on `auth: "user"` routes when the Bearer is not the boot's local API token — never on
   * `apiTokenOnly` routes such as remote browser session exchange.
   */
  authenticateSessionToken?: (token: string) => { user: UserRow; via: SessionVia } | null;
}

export function authMiddleware(
  auth: Auth,
  trustProxy: boolean,
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Bearer first: an explicit credential on the request outranks ambient cookies, and
    // a wrong one is an error, never a silent fallback (see the module doc).
    const bearer = bearerToken(c.req.header("authorization"));
    if (bearer !== null) {
      const viaToken =
        auth.authenticateApiToken(bearer) ??
        (!options.apiTokenOnly && options.authenticateSessionToken
          ? options.authenticateSessionToken(bearer)
          : null);
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

// The refusal of the local API token on a person's own writes lives in its own module (code
// plugins reach it through the plugin face); re-exported for the routes that import it here.
export { requireHuman } from "./require-human.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
 *
 * `ownOrigin` names writes this copy of the check lets through to a later, exact one: the
 * runtime's copy in front of the seam (app.ts) passes the writes a route group declaring
 * `origin: "own"` may answer (http/own-origin.ts), and the platform — which mounts those groups
 * ahead of its own copy (http/app.ts) — decides them.
 */
export const sameOriginWrites =
  (rule: OriginRule = NO_PROXY_RULE, ownOrigin: OwnOrigin = () => false): MiddlewareHandler =>
  async (c, next) => {
    if (
      WRITE_METHODS.has(c.req.method) &&
      !ownOrigin(c.req.path) &&
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
