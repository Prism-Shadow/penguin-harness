/**
 * The history stream routes every server serves for its own Sessions: the factories moved to
 * the trace library package (@prismshadow/penguin-library-trace/routes, services+http+cli
 * restack S9e) — this file keeps the assembly: the component binds the group's deps to the
 * server's capabilities.
 *
 *   GET /api/sessions/:sessionId/history-lines   the machine leg: a hub reads a Session on
 *                                                this server through it
 *   GET /api/sessions/:sessionId/trace-body?ref=  one value a history window folded, whole
 *
 * A Session of a machine never reaches here on the hub: the Session forward ahead of this
 * group (machines/session-forward.ts) takes it.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { Access } from "@prismshadow/penguin-library-project";
import type { Traces } from "@prismshadow/penguin-library-trace";
import { historyLinesRoutes } from "@prismshadow/penguin-library-trace/routes";
import type { Sessions } from "../../runtime/session-manager.js";
import type { Channels, Log } from "../../hmr/capabilities.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "HistoryLinesRoutes.routes",
        // After the Session forward (268), which takes a machine's Sessions; beside the Session
        // routes (session-api.sessions, 270), whose paths these are not.
        prefix: "/api/sessions",
        auth: "user",
        order: 272,
      },
    ],
  },
})
export class HistoryLinesRoutes {
  @Use() private readonly traces!: Traces;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly access!: Access;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly channels!: Channels;
  @Use() private readonly log!: Log;
  @Bind("HistoryLinesRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = historyLinesRoutes({
      traces: this.traces,
      sessions: this.sessionsRepo,
      access: this.access,
      manager: this.manager,
      channels: this.channels,
      log: (line) => this.log.line(line),
    });
  }
}
