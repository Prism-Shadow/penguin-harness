/**
 * `GET /api/sessions/:sessionId/history` for this server's own Sessions (spec 05, "History stream"):
 * the route factory moved to the trace library package (@prismshadow/penguin-library-trace/routes,
 * services+http+cli restack S9e) — this file keeps the assembly: the component binds the group's
 * deps to the server's capabilities, and hands the stream its revocation (http/sse.ts).
 *
 * A Session another machine holds never gets here: the hub answers it from its copy of that
 * machine's lines, in front of this group (machines/history-routes.ts, reached through the
 * Session forward at 268 and the `/server/<id>` proxy).
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { LiveStreams } from "../../auth/live-streams.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Auth } from "@prismshadow/penguin-library-auth";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { Traces } from "@prismshadow/penguin-library-trace";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import { historyRoutes } from "@prismshadow/penguin-library-trace/routes";
import type { Channels } from "../../hmr/capabilities.js";
import { streamRevocation } from "../sse.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "HistoryRoutes.routes",
        // After the Session forward (268), which answers a machine's Session first, and ahead
        // of the Session routes (session-api.sessions, 270).
        prefix: "/api/sessions",
        auth: "user",
        order: 269,
      },
    ],
  },
})
export class HistoryRoutes {
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly traces!: Traces;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly channels!: Channels;
  @Use() private readonly liveStreams!: LiveStreams;
  @Use() private readonly auth!: Auth;
  @Bind("HistoryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = historyRoutes({
      sessions: this.sessionsRepo,
      access: this.access,
      traces: this.traces,
      manager: this.manager,
      channels: this.channels,
      revocation:
        this.liveStreams !== undefined && this.auth !== undefined
          ? (c, user) =>
              streamRevocation(c, user, { liveStreams: this.liveStreams, auth: this.auth })
          : undefined,
    });
  }
}
