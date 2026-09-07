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
 */
import { Hono } from "hono";
import type { HostCommandOffer, HostCommandsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { DesktopService } from "../../services/desktop-service.js";

/** What this route group reaches. The service is null under a plain server. */
export interface CommandRouteDeps {
  desktop: DesktopService | null;
}

/**
 * What the host offers, asked of the service the RUNTIME owns.
 *
 * That service can be older than this platform — a hot push replaces the platform, not the
 * program — so the call is optional and an older one falls back to its ids alone. Nothing is
 * lost there: a runtime that old is paired with a shell that only offers commands this build
 * already has words for.
 */
function offersOf(deps: CommandRouteDeps): HostCommandOffer[] {
  const desktop = deps.desktop;
  if (desktop === null) return [];
  const offers = desktop.getCommandOffers?.();
  if (offers !== undefined) return offers;
  return (desktop.getCommands?.() ?? []).map((command) => ({ command, label: "", labelZh: "" }));
}

export function commandRoutes(deps: CommandRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can run a host command.");
    }
    await next();
  });

  app.get("/", (c) =>
    c.json({
      commands: deps.desktop?.getCommands() ?? [],
      offers: offersOf(deps),
    } satisfies HostCommandsResponse),
  );

  /**
   * The only question asked of the id is whether the host offered it. There is no list of
   * known commands to check it against — the host writes that list, and a server refusing an
   * id it had not been taught would stand between a shell and a page that both understand it.
   */
  app.post("/:command", (c) => {
    const command = c.req.param("command");
    const offered = offersOf(deps).map((offer) => offer.command);
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
