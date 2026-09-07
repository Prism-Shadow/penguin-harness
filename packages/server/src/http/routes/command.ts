/**
 * Host commands: native actions the process hosting this server can run on the page's
 * behalf, under `/api/command`. Today they come from the desktop shell — install the bundled
 * `penguin` command, check for a desktop update — and reach it over the same utilityProcess
 * port the update relay uses. A plain server offers none, and says so with an empty list
 * rather than a 404, so the page needs no separate way of asking whether it is in a shell.
 *
 * GET  /            — what this host offers: `offers`, each with the words to show, plus
 *                     `commands` — the same list narrowed to ids this build has its own
 *                     words for, which is all a page older than `offers` can safely read.
 * POST /:command    — run one; 202 once handed to the host, 409 when this host does not
 *                     offer it, 503 when the host is not listening. The id is the HOST's
 *                     word, never checked against a list this server keeps.
 *
 * Admin only: a command acts on the machine the server runs on, which is an owner's call.
 * Any admin session will do — a browser signed into the same server is as entitled as the
 * shell's own window, since the action is the host's, not the window's.
 *
 * PLATFORM code, deliberately (hmr/README.md). What a host can do, what it is called and who
 * may run it is policy, and this surface is what proved the point: while it was mounted above
 * the hot seam, a change to its shape could not reach a running installation at all. What
 * stays in the runtime is the port itself — transport — published as `runtime:shell-frames`,
 * whose frames are interpreted HERE.
 */
import { Hono } from "hono";
import { Component, Bind, Use } from "@prismshadow/penguin-core/kernel";
import type { HostCommand, HostCommandOffer, HostCommandsResponse } from "../../api/types.js";
import { HOST_COMMANDS } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { Desktop } from "../../hmr/capabilities.js";
import type { ShellFrames } from "../../hmr/capabilities.js";
import { parseHostCommandsMessage } from "../../services/desktop-update-port.js";

/** What this route group reaches: the host's port as state, read fresh on every request. */
export interface CommandRouteDeps {
  shell: () => ShellFrames;
}

export function commandRoutes(deps: CommandRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can run a host command.");
    }
    await next();
  });

  /** What the host last announced, read here rather than stored: the frame is the state. */
  const offers = (): HostCommandOffer[] =>
    parseHostCommandsMessage(deps.shell().hostCommands) ?? [];

  app.get("/", (c) =>
    c.json({
      commands: offers()
        .map((offer) => offer.command)
        .filter((command): command is HostCommand =>
          (HOST_COMMANDS as readonly string[]).includes(command),
        ),
      offers: offers(),
    } satisfies HostCommandsResponse),
  );

  /**
   * The only question asked of the id is whether the host offered it. There is no list of
   * known commands to check it against — the host writes that list, and a server refusing an
   * id it had not been taught would stand between a shell and a page that both understand it.
   */
  app.post("/:command", (c) => {
    const command = c.req.param("command");
    const shell = deps.shell();
    if (!offers().some((offer) => offer.command === command)) {
      throw new HttpError(409, "command_unavailable", "This host does not offer that command.");
    }
    if (shell.post === null) {
      throw new HttpError(503, "shell_unreachable", "The host is not listening.");
    }
    shell.post({ type: "host-command", command });
    return c.body(null, 202);
  });

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
        id: "CommandRoutes.routes",
        prefix: "/api/command",
        auth: "user",
        order: 10,
      },
    ],
  },
})
export class CommandRoutes {
  @Use() private readonly desktop!: Desktop;
  @Bind("CommandRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = commandRoutes({ shell: () => this.desktop.shell() });
  }
}
