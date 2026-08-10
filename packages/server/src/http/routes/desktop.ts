/**
 * Desktop-mode routes: POST /api/desktop/shutdown, plus the shared desktop-mode guard
 * that turns off multi-user surfaces (see rejectInDesktopMode).
 *
 * The shutdown route is authenticated by the shell's Bearer token, not the cookie
 * session (the shell holds no cookie), so it mounts OUTSIDE authMiddleware and only
 * when desktop mode is enabled. Responds 202 first, then triggers the graceful
 * shutdown a beat later so the response isn't cut off by the closing listener.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "../errors.js";
import type { AppDeps } from "../../app.js";

/**
 * Guard for user-management surfaces (admin users, Project members): the desktop app is
 * single-user, so the whole surface answers 403 with a dedicated code rather than being
 * unmounted — a stray client gets a clear, localizable error instead of a 404. Existing
 * users and memberships in the data root are untouched; only the management routes are
 * closed while the server runs under the desktop shell.
 */
export function rejectInDesktopMode(deps: AppDeps): MiddlewareHandler {
  return async (_c, next) => {
    if (deps.desktop !== null) {
      throw new HttpError(
        403,
        "desktop_single_user",
        "User management is disabled in the desktop app (single-user mode).",
      );
    }
    await next();
  };
}

/** Delay between answering 202 and starting shutdown: lets the response flush. */
const SHUTDOWN_DELAY_MS = 50;

export function desktopRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/shutdown", (c) => {
    const desktop = deps.desktop;
    if (!desktop) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (token === "" || !desktop.verifyToken(token)) {
      throw new HttpError(401, "unauthorized", "Invalid desktop token.");
    }
    setTimeout(() => desktop.requestShutdown(), SHUTDOWN_DELAY_MS).unref();
    return c.body(null, 202);
  });

  return app;
}
