/**
 * Auth routes: POST /api/auth/login | logout, GET /api/auth/claim.
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout deletes its row and clears the cookie.
 *
 * `claim` is the one password-free entry: it answers a BROWSER with no session yet — the only
 * way to give one of those a session is for the server to set an HttpOnly cookie — and proves
 * either that someone read this boot's console (first-login) or that they are the desktop
 * shell's own window. See the handler for why it is admin-only and not single-use.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { SESSION_COOKIE, cookieOptions } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const password = requireString(body, "password", { label: "password" });
    const { user, token } = await deps.authService.login(userId, password);
    setCookie(
      c,
      SESSION_COOKIE,
      token,
      cookieOptions(c, deps.authService.sessionTtlMs, deps.config.trustProxy),
    );
    return c.json({ user } satisfies AuthResponse);
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deps.authService.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  /**
   * Claims a session from a sign-in link — the only way to sign a window in when it has none,
   * since the session cookie is HttpOnly and nothing but the server can set one.
   *
   * Two proofs arrive here, asserting different facts and expiring differently. The desktop
   * shell's token says this window belongs to the shell that owns the server process, and is
   * spent on first use. The first-login link says someone read the console of a server that
   * has never had a password, and keeps working until one exists: a link that a mail client
   * or a browser may prefetch cannot afford to be one-shot, and the window it stays open is
   * exactly the window in which the account protects nothing yet. Redeeming it twice returns
   * the same session, not two.
   *
   * Both answer failure with the same 401, so a caller learns nothing about which of the two
   * it got wrong — nor whether the server offers that kind at all.
   */
  app.get("/claim", (c) => {
    const token = c.req.query("token") ?? "";
    // Desktop first, and only it consumes on success: a first-login value handed to the
    // shell's redeemer is simply not its token, so nothing is spent looking.
    const session =
      token !== "" && deps.desktop?.redeemLoginToken(token) === true
        ? deps.authService.loginDesktop().token
        : deps.authService.redeemFirstLogin(token);
    if (session === null) {
      throw new HttpError(401, "unauthorized", "Invalid or already-used sign-in link.");
    }
    setCookie(
      c,
      SESSION_COOKIE,
      session,
      cookieOptions(c, deps.authService.sessionTtlMs, deps.config.trustProxy),
    );
    return c.redirect("/", 302);
  });

  return app;
}
