/**
 * Auth middleware: cookie -> auth_session ->
 * user injected into c.var.
 *
 * Accessing a protected API while logged out -> 401 `{error:{code:"unauthorized"}}`.
 * CSRF (MVP): SameSite=Lax cookie + write requests only accept
 * `Content-Type: application/json` (an HTML form can't forge that Content-Type),
 * see the README security notes.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HttpError } from "../http/errors.js";
import type { UserRow } from "../db/repos/users.js";
import type { AuthService } from "./service.js";

/** Session cookie name. */
export const SESSION_COOKIE = "penguin_session";

/** Hono env: variables injected by the auth middleware. */
export type AppEnv = {
  Variables: {
    user: UserRow;
  };
};

/** Gets the current user (available after authMiddleware). */
export function currentUser(c: { var: { user: UserRow } }): UserRow {
  return c.var.user;
}

export function authMiddleware(auth: AuthService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? auth.authenticate(token) : null;
    if (!user) {
      throw new HttpError(401, "unauthorized", "Not signed in or the sign-in has expired.");
    }
    c.set("user", user);
    await next();
  };
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Content-Type defense for write requests: a write request with a Content-Type
 * other than application/json is rejected (a request with no Content-Type and an
 * empty body is let through — an HTML form always carries a form-type Content-Type).
 */
export const jsonOnlyWrites: MiddlewareHandler = async (c, next) => {
  if (WRITE_METHODS.has(c.req.method)) {
    const contentType = c.req.header("content-type");
    if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
      throw new HttpError(
        415,
        "unsupported_media_type",
        "Write requests only accept application/json.",
      );
    }
  }
  await next();
};
