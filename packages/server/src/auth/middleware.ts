/**
 * Auth middleware: cookie -> signed-token verification -> user injected into c.var.
 *
 * Accessing a protected API while logged out -> 401 `{error:{code:"unauthorized"}}`.
 * CSRF (MVP): SameSite=Lax cookie + write requests only accept
 * `Content-Type: application/json` (an HTML form can't forge that Content-Type),
 * see the README security notes.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HttpError } from "../http/errors.js";
import type { UserRow } from "../db/repos/users.js";
import type { AuthService, SessionVia } from "./service.js";

/** Session cookie name. */
export const SESSION_COOKIE = "penguin_session";

/**
 * Session cookie attributes, shared by every path that sets one.
 *
 * `maxAge` is passed in rather than written here, and every caller takes it from the one
 * service that issues the sessions: the token carries the authoritative expiry, and a cookie
 * that expired FIRST would log someone out while their session was still valid — which is what
 * two independently written numbers eventually do.
 */
export function cookieOptions(
  c: { req: { url: string; header(name: string): string | undefined } },
  ttlMs: number,
  trustProxy: boolean,
) {
  // `x-forwarded-proto` is caller-supplied and untrusted unless the deployment opts in
  // (config.trustProxy — the same gate hmr/routes.ts uses, and for the same reason). Trusting
  // it on a plain-HTTP bind would let anyone reaching the port get a Secure cookie back, which
  // the browser then refuses to send over that connection: a sign-in that never takes.
  const proto = trustProxy
    ? (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", ""))
    : new URL(c.req.url).protocol.replace(":", "");
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
    ...(proto === "https" ? { secure: true } : {}),
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

export function authMiddleware(auth: AuthService, trustProxy: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const authed = token ? auth.authenticateWithMeta(token) : null;
    if (!authed) {
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    // Sliding renewal: the session's expiry was topped up in place, so refresh the cookie's
    // own max-age to match. The token value is unchanged — same session, longer life.
    if (authed.renewed && token) {
      setCookie(c, SESSION_COOKIE, token, cookieOptions(c, auth.sessionTtlMs, trustProxy));
    }
    c.set("user", authed.user);
    c.set("sessionVia", authed.via);
    await next();
  };
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense: a write must carry one of these Content-Types, none of which an HTML form can
 * forge (a form is limited to x-www-form-urlencoded, multipart/form-data, text/plain). json is
 * the API default; gzip and octet-stream are the hot-update web push's artifact transport
 * (src/hmr). A write with NO Content-Type and an empty body is let through — a form always
 * sends a form-type one.
 */
const ALLOWED_WRITE_CONTENT_TYPES = [
  "application/json",
  "application/gzip",
  "application/octet-stream",
];

export const jsonOnlyWrites: MiddlewareHandler = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type")?.toLowerCase();
    if (contentType && !ALLOWED_WRITE_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Write requests only accept application/json (or, for the hot-update web push, a gzip artifact).",
      );
    }
  }
  await next();
};
