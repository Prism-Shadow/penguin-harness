/**
 * Auth routes: POST /api/auth/login | logout, GET /api/auth/claim.
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout deletes its row and clears the cookie.
 *
 * `claim` is the one password-free entry, and answers a browser with no session yet: only the
 * server can set an HttpOnly cookie, hence a GET that redirects rather than a call.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse } from "../../api/types.js";
import { SESSION_COOKIE, cookieOptions } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AuthService } from "../../auth/service.js";
import type { ServerConfig } from "../../config.js";
import type { DesktopService } from "../../services/desktop-service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AuthRouteDeps {
  authService: AuthService;
  config: ServerConfig;
  desktop: DesktopService | null;
}

export function authRoutes(deps: AuthRouteDeps): Hono<AppEnv> {
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
   * Two proofs, expiring differently: the desktop shell's token is spent on first use, while
   * the first-login link keeps working until a password exists — a link a mail client may
   * prefetch cannot afford to be one-shot, and until then the account protects nothing.
   * Both fail with the same redirect, so a caller learns nothing about which it got wrong.
   */
  app.get("/claim", (c) => {
    const token = c.req.query("token") ?? "";
    // Desktop first, and only it consumes on success: a first-login value handed to the
    // shell's redeemer is simply not its token, so nothing is spent looking.
    const session =
      token !== "" && deps.desktop?.redeemLoginToken(token) === true
        ? deps.authService.loginDesktop().token
        : deps.authService.redeemFirstLogin(token);
    // A browser is at the other end of this navigation, so the refusal answers a browser
    // too: an error body would leave the visitor staring at raw JSON with nothing to act
    // on. The login page takes it from here, form included. The advice it reads out of
    // `claimFailed` describes the DEPLOYMENT, never the token: a desktop shell mints a fresh
    // link on every start, so restarting the app is the way back in, while anywhere else the
    // link has to come from whoever runs the server and restarting helps nobody. Every token
    // a given server rejects yields the same value, so the refusal still says nothing about
    // which kind was presented — only that a shell is attached, which is a property of how
    // the server was started rather than of the credential.
    if (session === null)
      return c.redirect(`/login?claimFailed=${deps.desktop !== null ? "desktop" : "server"}`, 302);
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
