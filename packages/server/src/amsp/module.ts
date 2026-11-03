import type { Traces } from "../mechanisms/traces.js";
import type { SessionManager, Sessions, SessionServiceIface } from "@penguinharness/plugin-sessions/server";

import type { SessionService } from "../services/session-service.js";
import { amspRoutes } from "./routes.js";
import { agentApiTryRoutes } from "./try-route.js";

/**
 * The public `/api/amsp/v1` group: the gate, CORS, the run stream, the Session stream and the
 * Session routes (history, approvals, tasks); and
 * the API tab's Try it, the same run for the owner's sign-in.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "AmspRoutes.routes", prefix: "/api/amsp/v1", auth: "none", order: 5 },
      {
        id: "AmspRoutes.try",
        prefix: "/api/projects/:projectId/agents/:agentId/api/try",
        auth: "user",
        order: 224,
      },
    ],
  },
})
export class AmspRoutes {
  @Use() private readonly settings!: Settings;
  @Use() private readonly agentApi!: AgentApi;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly channels!: Channels;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly log!: Log;
  @Use() private readonly errors!: Errors;
  @Use() private readonly clock!: Clock;
  @Use() private readonly access!: Access;
  @Use() private readonly traces!: Traces;
  @Bind("AmspRoutes.routes") routes!: Hono<AppEnv>;
  @Bind("AmspRoutes.try") tryRoutes!: Hono<AppEnv>;

  setup() {
    const clock = this.clock;
    const deps = {
      settings: this.settings,
      agentApi: this.agentApi,
      sessions: this.sessions,
      manager: this.manager as SessionManager,
      sessionService: this.sessionService as SessionService,
      channels: this.channels,
      agentConfig: this.agentConfig,
      log: this.log,
      errors: this.errors,
      traceService: this.traces,
      now: () => clock.now(),
    };
    this.routes = amspRoutes(deps);
    this.tryRoutes = agentApiTryRoutes({ ...deps, access: this.access });
  }
}

/** The Agent API: per-Agent settings and keys in web.db, and the public AMSP routes. */
@Module({
  children: [AgentApiRepo, AmspRoutes],
  exports: [AgentApi],
})
export class AgentApiModule {}
