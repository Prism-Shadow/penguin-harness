/**
 * Auth routes: POST /api/auth/login | logout, GET /api/auth/desktop-login (desktop mode).
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout deletes the server-side session and clears the cookie.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { SESSION_COOKIE, cookieOptions } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { optionalString, readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/login", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const password = requireString(body, "password", { label: "password" });
    const { user, token } = await deps.authService.login(userId, password);
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c));
    return c.json({ user } satisfies AuthResponse);
  });

  /**
   * Redeems this boot's owner token (auth/owner-token.ts) for a signed session — the local
   * bootstrap primitive behind `penguin auth token` and the machines controller.
   *
   * The TOKEN is the security boundary, not the caller's address: it lives in a 0600 file
   * inside the data root, so presenting it proves the ability to read that root — which is
   * what ownership of this server has always meant. An address check would only restate
   * that weaker (a reverse proxy or a tunnel legitimately moves the bytes), so there is
   * none; a caller without the file has nothing to present, from anywhere.
   */
  app.post("/owner", async (c) => {
    const body = await readJson(c);
    const ownerToken = requireString(body, "ownerToken", { label: "ownerToken", maxLen: 128 });
    const userId = optionalString(body, "userId", { label: "userId", maxLen: 64 }) ?? "admin";
    const ttl =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>).ttlSeconds
        : undefined;
    const ttlMs =
      typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 60 * 60_000;
    const outcome = deps.authService.redeemOwnerToken(ownerToken, userId, ttlMs);
    // One error shape for both refusals: distinguishing "wrong token" from "no such user"
    // would let a caller WITHOUT the token enumerate accounts.
    if (outcome === "bad_token" || outcome === "no_user") {
      throw new HttpError(401, "unauthorized", "The owner token was not accepted.");
    }
    return c.json(outcome);
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deps.authService.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  // Desktop-mode sign-in: the window's FIRST navigation redeems the shell's one-shot
  // token for a standard admin cookie session and lands on the app — the desktop user
  // never sees the login page. 404 outside desktop mode (the route "doesn't exist");
  // a wrong or already-used token is a plain 401 with no distinction, so a leaked URL
  // reveals nothing and cannot be replayed.
  app.get("/desktop-login", (c) => {
    const desktop = deps.desktop;
    if (!desktop) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    const token = c.req.query("token") ?? "";
    if (token === "" || !desktop.redeemLoginToken(token)) {
      throw new HttpError(401, "unauthorized", "Invalid or already-used desktop token.");
    }
    const { token: session } = deps.authService.loginDesktop();
    setCookie(c, SESSION_COOKIE, session, cookieOptions(c));
    return c.redirect("/", 302);
  });

  return app;
}
