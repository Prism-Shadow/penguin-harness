/**
 * The bot's settings API, `/api/discord-bot` — admin only. Mounted by the harness's HTTP
 * module through the `HttpModule.routes` slot behind its cookie gate, so `c.get("user")` is
 * the signed-in user; this file only asks whether that user is an admin.
 *
 * Refusals are answered as JSON directly rather than thrown: the harness maps ITS OWN
 * `HttpError` class to a response, and a class from this package is not it.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { BotError, type DiscordBot } from "./bot.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "discord-bot.routes";

interface JsonBody {
  botToken?: unknown;
  clearBotToken?: unknown;
  projectId?: unknown;
  agentId?: unknown;
  enabled?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function discordBotRoutes(bot: DiscordBot): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof BotError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    return c.json({ error: { code: "internal", message: err.message } }, 500);
  });
  app.use("*", async (c, next) => {
    const user = c.get("user" as never) as { isAdmin?: boolean } | undefined;
    if (user?.isAdmin !== true) {
      return c.json(
        {
          error: {
            code: "admin_required",
            message: "Only an admin can configure the Discord bot.",
          },
        },
        403,
      );
    }
    await next();
  });
  const body = async (c: Context): Promise<JsonBody> => {
    try {
      return (await c.req.json()) as JsonBody;
    } catch {
      throw new BotError(400, "bad_request", "Request body must be JSON.");
    }
  };

  app.get("/", (c) => c.json(bot.info()));
  app.put("/", async (c) => {
    const b = await body(c);
    return c.json(
      await bot.save({
        ...(str(b.botToken) !== undefined ? { botToken: str(b.botToken)! } : {}),
        ...(b.clearBotToken === true ? { clearBotToken: true } : {}),
        ...(str(b.projectId) !== undefined ? { projectId: str(b.projectId)! } : {}),
        ...(str(b.agentId) !== undefined ? { agentId: str(b.agentId)! } : {}),
      }),
    );
  });
  app.post("/state", async (c) => {
    const b = await body(c);
    if (typeof b.enabled !== "boolean")
      throw new BotError(400, "bad_request", "enabled must be a boolean.");
    return c.json(await bot.setEnabled(b.enabled));
  });
  app.post("/test", async (c) => {
    const b = await body(c);
    return c.json(await bot.test(str(b.botToken)));
  });
  return app;
}
