/**
 * Desktop-mode routes: POST /api/desktop/shutdown, the client-update relay under
 * /api/desktop/update, plus the shared desktop-mode guard that turns off multi-user
 * surfaces (see rejectInDesktopMode).
 *
 * Platform code, all of it: what the shell's window may ask of the shell is policy. The
 * shutdown route is authenticated by the shell's Bearer token, not the cookie session (the
 * shell holds no cookie), so its group is unauthenticated and checks the token itself; it
 * answers 202 first, then triggers the graceful shutdown a beat later so the response is not
 * cut off by the closing listener. The update routes are called by the page, so their group
 * sits behind the cookie gate and is further restricted to the shell's own window.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { DesktopUpdateStatusResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { Desktop } from "../../hmr/capabilities.js";
import type { DesktopApi } from "../../hmr/capabilities.js";

/** The shell's service as the platform sees it; null outside desktop mode. */
export interface DesktopRouteDeps {
  desktop: DesktopApi | null;
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
 * Client-update relay routes. Restricted to the shell's own window (`sessionVia ===
 * "desktop"`, the same two-field rule as the change-password gate, inverted): a browser
 * signed into the same desktop-mode server must not read the machine's updater state or
 * restart its GUI app. Consent is collected by the page's update modal before each POST:
 * `download` fetches only the release the shell has offered, and `install` restarts only
 * into what its updater already downloaded and verified.
 *
 * The relay members are optional on the service: a layer older than the update modal has
 * none, and this platform still runs on it — with no status and a 503 for every command.
 */
export function desktopUpdateRoutes(deps: DesktopRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const requireShellSession = (c: Context<AppEnv>): DesktopApi => {
    const desktop = deps.desktop;
    if (!desktop) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    if (c.var.sessionVia !== "desktop") {
      throw new HttpError(
        403,
        "desktop_shell_only",
        "Client updates are managed from the desktop app's own window.",
      );
    }
    return desktop;
  };

  const relay = (action: "check" | "download" | "install", c: Context<AppEnv>) => {
    const desktop = requireShellSession(c);
    if (!desktop.requestUpdateCommand?.(action)) {
      throw new HttpError(503, "shell_unreachable", "The desktop shell is not listening.");
    }
    return c.body(null, 202);
  };

  app.get("/", (c) => {
    const desktop = requireShellSession(c);
    const status = desktop.getUpdateStatus?.() ?? null;
    return c.json({ status } satisfies DesktopUpdateStatusResponse);
  });
  app.post("/check", (c) => relay("check", c));
  app.post("/download", (c) => relay("download", c));
  app.post("/install", (c) => relay("install", c));

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "DesktopRoutes.routes", prefix: "/api/desktop", auth: "none", order: 5 },
    ],
  },
})
export class DesktopRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("DesktopRoutes.routes") routes!: Hono;
  setup() {
    this.routes = desktopRoutes({ desktop: this.desktop.current() });
  }
}

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "DesktopUpdateRoutes.routes", prefix: "/api/desktop/update", auth: "user", order: 10 },
    ],
  },
})
export class DesktopUpdateRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("DesktopUpdateRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = desktopUpdateRoutes({ desktop: this.desktop.current() });
  }
}
