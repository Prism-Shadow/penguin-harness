/**
 * Host commands: native actions the process hosting this server can run on the page's
 * behalf, under `/api/command`. Today they come from the desktop shell — install the bundled
 * `penguin` command, check for a desktop update — and reach it over the same utilityProcess
 * port the update relay uses. A plain server offers none, and says so with an empty list
 * rather than a 404, so the page needs no separate way of asking whether it is in a shell.
 *
 * GET  /            — the commands this host offers.
 * POST /:command    — run one; 202 once handed to the host, 409 when this host does not
 *                     offer it, 503 when the host is not listening.
 *
 * Admin only: a command acts on the machine the server runs on, which is an owner's call.
 * Any admin session will do — a browser signed into the same server is as entitled as the
 * shell's own window, since the action is the host's, not the window's.
 */
import { Hono } from "hono";
import type { HostCommand, HostCommandsResponse } from "../../api/types.js";
import { HOST_COMMANDS } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { DesktopService } from "../../services/desktop-service.js";

/** What this route group reaches. The service is null under a plain server. */
export interface CommandRouteDeps {
  desktop: DesktopService | null;
}

const isHostCommand = (value: string): value is HostCommand =>
  (HOST_COMMANDS as readonly string[]).includes(value);

export function commandRoutes(deps: CommandRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can run a host command.");
    }
    await next();
  });

  app.get("/", (c) =>
    c.json({ commands: deps.desktop?.getCommands() ?? [] } satisfies HostCommandsResponse),
  );

  app.post("/:command", (c) => {
    const command = c.req.param("command");
    if (!isHostCommand(command)) {
      throw new HttpError(404, "unknown_command", "No such host command.");
    }
    const offered = deps.desktop?.getCommands() ?? [];
    if (!offered.includes(command)) {
      throw new HttpError(409, "command_unavailable", "This host does not offer that command.");
    }
    if (!deps.desktop!.requestCommand(command)) {
      throw new HttpError(503, "shell_unreachable", "The host is not listening.");
    }
    return c.body(null, 202);
  });

  return app;
}
