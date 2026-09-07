/**
 * The bot's status route, `GET /api/discord-bot` — admin only, and read-only: the bot is
 * configured in the Project's config file and nowhere else. Reading the status runs a
 * config pass first, so it is also how an operator applies an edit without waiting for the
 * next interval. Mounted by the harness's HTTP module through the `HttpModule.routes` slot
 * behind its cookie gate, so `c.get("user")` is the signed-in user.
 */
import { Hono } from "hono";
import type { DiscordBots } from "./manager.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "discord-bot.routes";

export function discordBotRoutes(bots: DiscordBots): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const user = c.get("user" as never) as { isAdmin?: boolean } | undefined;
    if (user?.isAdmin !== true) {
      return c.json(
        {
          error: {
            code: "admin_required",
            message: "Only an admin can read the Discord bot's status.",
          },
        },
        403,
      );
    }
    await next();
  });
  app.get("/", async (c) => {
    await bots.reconcile();
    return c.json(bots.list());
  });
  return app;
}
