/**
 * Desktop-mode routes: POST /api/desktop/shutdown, the client-update relay under
 * /api/desktop/update, plus the shared desktop-mode guard that turns off multi-user
 * surfaces (see rejectInDesktopMode).
 *
 * The shutdown route is authenticated by the shell's Bearer token, not the cookie
 * session (the shell holds no cookie), so it mounts OUTSIDE authMiddleware and only
 * when desktop mode is enabled. Responds 202 first, then triggers the graceful
 * shutdown a beat later so the response isn't cut off by the closing listener.
 * The update routes are called by the page instead, so they mount INSIDE authMiddleware
 * (see desktopUpdateRoutes).
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { Component, Bind, Use } from "@prismshadow/penguin-core/kernel";
import type { DesktopUpdateStatusResponse, DesktopUpdaterCommandMessage } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { Desktop } from "../../hmr/capabilities.js";
import type { DesktopApi, ShellFrames } from "../../hmr/capabilities.js";
import { parseUpdaterStatusMessage } from "../../services/desktop-update-port.js";
import type { DesktopService, UpdaterCommand } from "../../services/desktop-service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface DesktopRouteDeps {
  desktop: DesktopService | null;
}

/**
 * Guard for user-management surfaces (admin users, Project members): the desktop app is
 * single-user, so the whole surface answers 403 with a dedicated code rather than being
 * unmounted — a stray client gets a clear, localizable error instead of a 404. Existing
 * users and memberships in the data root are untouched; only the management routes are
 * closed while the server runs under the desktop shell.
 */
export function rejectInDesktopMode(deps: DesktopRouteDeps): MiddlewareHandler {
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

export function desktopRoutes(deps: DesktopRouteDeps): Hono {
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

/**
 * Client-update relay routes, at /api/desktop/update and only in desktop mode. Restricted to
 * the shell's own window (`sessionVia === "desktop"`, the same two-field rule as the
 * change-password gate, inverted): a browser signed into the same desktop-mode server must
 * not read the machine's updater state or restart its GUI app. Consent is collected by the
 * page's update modal before each POST: `download` fetches only the release the shell has
 * offered, and `install` restarts only into what its updater already downloaded and verified.
 *
 * PLATFORM code (hmr/README.md), like the host commands beside it: who may see an update,
 * what consent is required and what the surface looks like is policy, and policy ships by
 * push. The runtime carries the port and publishes the shell's frames unread; the parsing
 * and the gate are here. The shutdown route above stays runtime — a Bearer token and a
 * process's own death are mechanism.
 */
/** What the update relay reaches: desktop-ness, and the host's port as state. */
export interface DesktopUpdateRouteDeps {
  desktop: () => DesktopApi | null;
  shell: () => ShellFrames;
}

/** The shell's own window, or nothing: the gate every page→shell relay route stands behind. */
function requireShellSession(deps: DesktopUpdateRouteDeps, c: Context<AppEnv>): void {
  if (deps.desktop() === null)
    throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
  if (c.var.sessionVia !== "desktop") {
    throw new HttpError(
      403,
      "desktop_shell_only",
      "This is managed from the desktop app's own window.",
    );
  }
}

export function desktopUpdateRoutes(deps: DesktopUpdateRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Relays one command to the shell; 503 when this process has no port to send it down. */
  const relay = (action: UpdaterCommand, c: Context<AppEnv>) => {
    requireShellSession(deps, c);
    const post = deps.shell().post;
    if (post === null) {
      throw new HttpError(503, "shell_unreachable", "The desktop shell is not listening.");
    }
    post({ type: "desktop-updater-command", action } satisfies DesktopUpdaterCommandMessage);
    return c.body(null, 202);
  };

  app.get("/", (c) => {
    requireShellSession(deps, c);
    // The frame is the state: parsed on read, never stored parsed, so what a frame means
    // travels with the platform that reads it.
    const status = parseUpdaterStatusMessage(deps.shell().updaterStatus);
    return c.json({ status } satisfies DesktopUpdateStatusResponse);
  });

  app.post("/check", (c) => relay("check", c));
  app.post("/download", (c) => relay("download", c));
  app.post("/install", (c) => relay("install", c));

  return app;
}

/**
 * The platform's own copy, which is the one that serves. The runtime mounts these routes too,
 * but below the seam — that copy answers only for a platform old enough to decline the prefix.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "DesktopUpdateRoutes.routes",
        prefix: "/api/desktop/update",
        auth: "user",
        order: 10,
      },
    ],
  },
})
export class DesktopUpdateRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("DesktopUpdateRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = desktopUpdateRoutes({
      desktop: () => this.desktop.current(),
      shell: () => this.desktop.shell(),
    });
  }
}
