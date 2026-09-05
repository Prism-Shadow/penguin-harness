/**
 * User-level server event stream: GET /api/events (SSE user channel).
 * Carries cross-Session notifications (reserved for automated tasks); sends a `hello` handshake event on connect.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { sseEndpoint } from "../sse.js";
import type { ChannelHub } from "../../runtime/channel.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Channels } from "../../runtime/channel.js";
import { RuntimeModule } from "../../hmr/capabilities.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface EventsRouteDeps {
  channels: ChannelHub;
}

/** The user channel's key in ChannelHub. */
export function userChannelKey(userId: string): string {
  return `user:${userId}`;
}

export function eventsRoutes(deps: EventsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const channel = deps.channels.get(userChannelKey(c.var.user.userId));
    return sseEndpoint(c, channel, { initialEvents: [{ type: "hello" }] });
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "EventsRoutes.routes",
        prefix: "/api/events",
        auth: "user",
        order: 60,
      },
    ],
  },
})
export class EventsRoutes {
  @Use(RuntimeModule) private readonly channels!: Channels;
  @Bind("EventsRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = eventsRoutes({ channels: this.channels as ChannelHub });
  }
}
