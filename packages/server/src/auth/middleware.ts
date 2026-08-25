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
  c: { req: { header(name: string): string | undefined } },
  ttlMs: number,
) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
    // Add Secure when the reverse proxy declares https.
    ...(c.req.header("x-forwarded-proto") === "https" ? { secure: true } : {}),
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

export function authMiddleware(auth: AuthService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const authed = token ? auth.authenticateWithMeta(token) : null;
    if (!authed) {
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    // Sliding renewal, signed-token shape: a signature cannot be extended in place, so a
    // session nearing expiry rides out with a replacement cookie instead of a row update.
    if (authed.renewedToken !== undefined) {
      setCookie(c, SESSION_COOKIE, authed.renewedToken, cookieOptions(c, auth.sessionTtlMs));
    }
    c.set("user", authed.user);
    c.set("sessionVia", authed.via);
    await next();
  };
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Content-Types write requests may carry. application/json is the default
 * for the whole API; application/gzip and application/octet-stream are the
 * hot-update web push's binary artifact transport (packages/server/src/hmr) —
 * like application/json, neither is one of the three Content-Types an HTML
 * form can forge (application/x-www-form-urlencoded, multipart/form-data,
 * text/plain), so allowing them here does not reopen the CSRF gap below.
 */
const ALLOWED_WRITE_CONTENT_TYPES = [
  "application/json",
  "application/gzip",
  "application/octet-stream",
];

/**
 * Content-Type defense for write requests: a write request with a Content-Type
 * other than one of ALLOWED_WRITE_CONTENT_TYPES is rejected (a request with no
 * Content-Type and an empty body is let through — an HTML form always carries
 * a form-type Content-Type).
 */
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
