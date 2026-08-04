/**
 * Auth routes: POST /api/auth/login | logout, GET /api/auth/desktop-login (desktop mode).
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 * Login issues a cookie session; logout deletes the server-side session and clears the cookie.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { SESSION_COOKIE } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Session cookie attributes: HttpOnly, SameSite=Lax, 7 days. */
function cookieOptions(c: { req: { header(name: string): string | undefined } }) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
    // Add Secure when the reverse proxy declares https.
    ...(c.req.header("x-forwarded-proto") === "https" ? { secure: true } : {}),
  };
}

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
  // reveals nothing and cannot be replayed. See design § "桌面端原型 · 桌面登录".
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
