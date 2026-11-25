/**
 * The Session forward moved to the machines domain package
 * (@prismshadow/penguin-library-machine/session-forward, machines restack S16) — it speaks
 * library vocabulary, and the revocation its streams are held against is this server's own.
 * This file keeps the assembly: the route component binds the forward to this server's
 * live-stream registry and auth, and re-exports the moved shapes for the server's own paths.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "@prismshadow/penguin-library-http/app-env";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import {
  sessionForwardRoutes,
  type MachineSessionForward,
} from "@prismshadow/penguin-library-machine/session-forward";
import type { LiveStreams } from "../auth/live-streams.js";
import { streamRevocation } from "../http/sse.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SessionForwardRoutes.routes",
        // Ahead of every group that serves `/api/sessions` (session-api.sessions, 270).
        prefix: "/api/sessions",
        auth: "user",
        order: 268,
      },
    ],
  },
})
export class SessionForwardRoutes {
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly sessionForward!: MachineSessionForward;
  @Use() private readonly liveStreams!: LiveStreams;
  @Use() private readonly auth!: Auth;
  @Bind("SessionForwardRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = sessionForwardRoutes({
      sessions: this.sessionsRepo,
      access: this.access,
      forward: this.sessionForward,
      revocation: (c) =>
        streamRevocation(c, c.var.user, { liveStreams: this.liveStreams, auth: this.auth }),
    });
  }
}

export * from "@prismshadow/penguin-library-machine/session-forward";
