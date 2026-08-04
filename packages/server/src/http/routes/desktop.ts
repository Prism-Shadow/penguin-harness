/**
 * Desktop-mode routes: POST /api/desktop/shutdown.
 *
 * Authenticated by the shell's Bearer token, not the cookie session (the shell holds no
 * cookie), so this mounts OUTSIDE authMiddleware and only when desktop mode is enabled.
 * Responds 202 first, then triggers the graceful shutdown a beat later so the response
 * isn't cut off by the closing listener.
 */
import { Hono } from "hono";
import { HttpError } from "../errors.js";
import type { AppDeps } from "../../app.js";

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
