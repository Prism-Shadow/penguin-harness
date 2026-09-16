/**
 * Desktop-mode routes: POST /api/desktop/shutdown, the client-update relay under
 * /api/desktop/update, the tray-icon preference at /api/desktop/tray, plus the shared
 * desktop-mode guard that turns off multi-user surfaces (see rejectInDesktopMode).
 *
 * Platform code, all of it: what the shell's window may ask of the shell is policy. The
 * shutdown route is authenticated by the shell's Bearer token, not the cookie session (the
 * shell holds no cookie), so its group is unauthenticated and checks the token itself; it
 * answers 202 first, then triggers the graceful shutdown a beat later so the response is not
 * cut off by the closing listener. The update and tray routes are called by the page, so their
 * groups sit behind the cookie gate and are further restricted to the shell's own window.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type {
  DesktopTrayPatch,
  DesktopTrayStatusResponse,
  DesktopUpdateStatusResponse,
} from "../../api/types.js";
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
 * The shared gate for the two page-facing desktop surfaces: they exist only in desktop
 * mode, and only for the shell's own window (`sessionVia === "desktop"`, the same
 * two-field rule as the change-password gate, inverted). A browser signed into the same
 * desktop-mode server must not read the machine's updater state, restart its GUI app, or
 * reach into the chrome of a window it is not looking at.
 */
function shellSessionOf(deps: DesktopRouteDeps, c: Context<AppEnv>, refusal: string): DesktopApi {
  const desktop = deps.desktop;
  if (!desktop) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
  if (c.var.sessionVia !== "desktop") throw new HttpError(403, "desktop_shell_only", refusal);
  return desktop;
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

  const requireShellSession = (c: Context<AppEnv>): DesktopApi =>
    shellSessionOf(deps, c, "Client updates are managed from the desktop app's own window.");

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

/**
 * The tray-icon preference. GET reads what the shell last pushed — null until that first push,
 * which the page reads as on, the shell's own default. PUT relays a patch — the switch, the
 * page's UI language, or both; the shell applies it, persists it and pushes the new state
 * straight back, so the answer here is an acknowledgement and the GET is what tells the truth.
 * Like the update relay, the members are optional on a layer older than the tray icon.
 */
export function desktopTrayRoutes(deps: DesktopRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const refusal = "The tray icon is managed from the desktop app's own window.";

  app.get("/", (c) => {
    const desktop = shellSessionOf(deps, c, refusal);
    const status = desktop.getTrayStatus?.() ?? null;
    return c.json({ status } satisfies DesktopTrayStatusResponse);
  });

  app.put("/", async (c) => {
    const desktop = shellSessionOf(deps, c, refusal);
    const body = (await c.req.json().catch(() => null)) as {
      showTrayIcon?: unknown;
      locale?: unknown;
    } | null;
    const patch: DesktopTrayPatch = {};
    if (body?.showTrayIcon !== undefined) {
      if (typeof body.showTrayIcon !== "boolean") {
        throw new HttpError(400, "invalid_show_tray_icon", "showTrayIcon must be a boolean.");
      }
      patch.showTrayIcon = body.showTrayIcon;
    }
    if (body?.locale !== undefined) {
      if (body.locale !== "zh" && body.locale !== "en") {
        throw new HttpError(400, "invalid_locale", 'locale must be "zh" or "en".');
      }
      patch.locale = body.locale;
    }
    // An empty patch is a caller bug, not a no-op worth relaying to the shell.
    if (patch.showTrayIcon === undefined && patch.locale === undefined) {
      throw new HttpError(400, "empty_tray_patch", "Pass showTrayIcon, locale, or both.");
    }
    if (!desktop.requestTrayCommand?.(patch)) {
      throw new HttpError(503, "shell_unreachable", "The desktop shell is not listening.");
    }
    return c.body(null, 202);
  });

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

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "DesktopTrayRoutes.routes", prefix: "/api/desktop/tray", auth: "user", order: 10 },
    ],
  },
})
export class DesktopTrayRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("DesktopTrayRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = desktopTrayRoutes({ desktop: this.desktop.current() });
  }
}
