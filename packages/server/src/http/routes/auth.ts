/**
 * Auth routes: POST /api/auth/login | logout | owner, GET /api/auth/claim.
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout revokes it by jti and clears the cookie.
 *
 * `owner` and `claim` both hand out a session without a password, and are not
 * interchangeable: `owner` answers a PROGRAM (token in the body, any userId, proven by reading
 * the data root) while `claim` answers a BROWSER with no session yet (a Set-Cookie + redirect,
 * admin only, since only the server can set an HttpOnly cookie). The stronger proof — owner =
 * machine ownership, covering every account — yields the weaker `cli` session; the narrower
 * claim proofs yield the password-without-the-old-one allowance. See each handler for why.
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
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c, deps.authService.sessionTtlMs));
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
    if (outcome === null) {
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
    setCookie(c, SESSION_COOKIE, session, cookieOptions(c, deps.authService.sessionTtlMs));
    return c.redirect("/", 302);
  });

  return app;
}
