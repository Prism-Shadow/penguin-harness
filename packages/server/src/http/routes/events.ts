/**
 * User-level server event stream: GET /api/events (SSE user channel).
 * Carries cross-Session notifications (reserved for automated tasks); sends a `hello` handshake event on connect.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { sseEndpoint } from "../sse.js";
import type { AppDeps } from "../../app.js";

/** The user channel's key in ChannelHub. */
export function userChannelKey(userId: string): string {
  return `user:${userId}`;
}

export function eventsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const channel = deps.channels.get(userChannelKey(c.var.user.userId));
    return sseEndpoint(c, channel, { initialEvents: [{ type: "hello" }] });
  });

  return app;
}
