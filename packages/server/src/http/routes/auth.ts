/**
 * Auth routes: POST /api/auth/login | logout | switch | park, GET /api/auth/sessions,
 * GET /api/auth/desktop-login (desktop mode).
 * No self-registration: users are created by an admin in the user backend (/api/admin/users).
 *
 * Sessions are a small JAR rather than a single cookie: the ACTIVE account's token lives in
 * `penguin_session` (the only cookie the auth middleware reads), and the tokens of other
 * accounts signed in on this browser sit PARKED in `penguin_parked_sessions`. Signing into a
 * second account parks the first instead of dropping it, and `switch` swaps the pointer — so
 * coming back is a click, with no password and no credential ever stored outside an HttpOnly
 * cookie. `switch` grants nothing new: it can only activate a token this browser already
 * holds, which is exactly what the middleware would have accepted as the active one.
 *
 * `park` is the "sign in as someone else" path: it moves the current session into the jar and
 * clears the active pointer, landing on the login page with the previous account still one
 * click away. `logout` is the opposite and deliberately total — it deletes every session in
 * the jar, server-side, so Sign out leaves nothing behind for the next person at the machine.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthResponse, AuthSessionsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { PARKED_SESSIONS_COOKIE, SESSION_COOKIE } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

/**
 * How many accounts may sit parked beside the active one. Six accounts on one browser is
 * already generous, and the cap bounds the cookie: tokens are 43-char base64url, so the
 * jar stays a few hundred bytes, far under the 4KB a cookie gets.
 */
const MAX_PARKED_SESSIONS = 5;

/** Jar separator: "." is outside base64url's alphabet, so it can never occur inside a token. */
const JAR_SEPARATOR = ".";

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

/** Request context of any route in this file (the jar helpers below read and write its cookies). */
type Ctx = Context<AppEnv>;

/** The parked tokens as stored (order = most recently parked first); no validation here. */
function readParked(c: Ctx): string[] {
  const raw = getCookie(c, PARKED_SESSIONS_COOKIE);
  if (!raw) return [];
  return raw.split(JAR_SEPARATOR).filter((t) => t !== "");
}

function writeParked(c: Ctx, tokens: string[]): void {
  if (tokens.length === 0) deleteCookie(c, PARKED_SESSIONS_COOKIE, { path: "/" });
  else setCookie(c, PARKED_SESSIONS_COOKIE, tokens.join(JAR_SEPARATOR), cookieOptions(c));
}

export function authRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Live parked tokens, newest first: dead ones are dropped, and at most one token per
   * account survives (a second sign-in as the same user supersedes the older session,
   * which is deleted rather than left dangling until its TTL). `exclude` drops an account
   * that is about to become active. Returns what the cookie should now hold, so every
   * caller both cleans and persists in one step.
   */
  const liveParked = (tokens: string[], exclude?: string): string[] => {
    const kept: string[] = [];
    const seen = new Set<string>(exclude ? [exclude] : []);
    for (const token of tokens) {
      const session = deps.authService.peekSession(token);
      if (!session) continue;
      if (seen.has(session.user.userId) || kept.length >= MAX_PARKED_SESSIONS) {
        deps.authService.logout(token);
        continue;
      }
      seen.add(session.user.userId);
      kept.push(token);
    }
    return kept;
  };

  /** Makes `token` the active session and parks whatever was active before it. */
  const activate = (c: Ctx, token: string, userId: string): void => {
    const previous = getCookie(c, SESSION_COOKIE);
    const parked = [
      ...(previous && previous !== token ? [previous] : []),
      ...readParked(c).filter((t) => t !== token),
    ];
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c));
    writeParked(c, liveParked(parked, userId));
  };

  app.post("/login", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const password = requireString(body, "password", { label: "password" });
    const { user, token } = await deps.authService.login(userId, password);
    // The account that was signed in stays signed in, parked beside the new one.
    activate(c, token, user.userId);
    return c.json({ user } satisfies AuthResponse);
  });

  /**
   * Every account signed in on this browser, active first — what the account menu and the
   * login page offer as passwordless entries. Reading the jar also prunes it (expired
   * sessions, deleted users, duplicates), so the answer and the cookie always agree.
   */
  app.get("/sessions", (c) => {
    const active = getCookie(c, SESSION_COOKIE);
    const activeSession = active ? deps.authService.peekSession(active) : null;
    if (active && !activeSession) deleteCookie(c, SESSION_COOKIE, { path: "/" });
    const parked = liveParked(readParked(c), activeSession?.user.userId);
    writeParked(c, parked);
    const sessions = [
      ...(activeSession ? [{ userId: activeSession.user.userId, active: true }] : []),
      ...parked.map((token) => ({
        // Already validated by liveParked; the second peek is one indexed row read.
        userId: deps.authService.peekSession(token)?.user.userId ?? "",
        active: false,
      })),
    ].filter((s) => s.userId !== "");
    return c.json({ sessions } satisfies AuthSessionsResponse);
  });

  /**
   * Switch to another account already signed in on this browser: no password, because the
   * credential — its session token — is already in this jar. An unknown or expired account
   * is a plain 404: nothing was granted, and the caller falls back to the login page.
   */
  app.post("/switch", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const target = readParked(c)
      .map((token) => ({ token, session: deps.authService.peekSession(token) }))
      .find((t) => t.session?.user.userId === userId);
    if (!target?.session) {
      throw new HttpError(404, "not_found", "That account is not signed in on this browser.");
    }
    activate(c, target.token, userId);
    return c.json({ user: target.session.user } satisfies AuthResponse);
  });

  /**
   * Park the current session and sign out of it locally: the token stays valid and joins
   * the jar, so the login page can offer it back with one click, but this browser is
   * unauthenticated until an account is chosen. No-op when nothing is active.
   */
  app.post("/park", (c) => {
    const active = getCookie(c, SESSION_COOKIE);
    if (active) {
      const parked = [active, ...readParked(c).filter((t) => t !== active)];
      writeParked(c, liveParked(parked));
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    }
    return c.body(null, 204);
  });

  /**
   * Sign out — total by design: the active session AND every parked one are deleted
   * server-side and both cookies are cleared, so nothing on this browser can be re-entered
   * without a password. "Switch account" (park) is the door for keeping a session alive.
   */
  app.post("/logout", (c) => {
    const active = getCookie(c, SESSION_COOKIE);
    if (active) deps.authService.logout(active);
    for (const token of readParked(c)) deps.authService.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    deleteCookie(c, PARKED_SESSIONS_COOKIE, { path: "/" });
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
    const { user, token: session } = deps.authService.loginDesktop();
    activate(c, session, user.userId);
    return c.redirect("/", 302);
  });

  return app;
}
