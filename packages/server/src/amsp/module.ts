/**
 * The Agent API's place in the platform tree: one group holding the per-Agent settings and keys
 * (AgentApiRepo, exported as the AgentApi mechanism for the Agent list, the API tab's routes and
 * the deletion cascades) and the public AMSP routes.
 *
 * The public group is contributed `auth: "none"` at order 5, with `/api/auth`, `/api/desktop`
 * and `/api/hmr`: ahead of the `/api/*` cookie gate, which `HttpModule` installs in front of the
 * first `auth: "user"` group (order 10 and up). The API tab's own routes are an ordinary
 * signed-in group, mounted beside the other Agent sub-groups (services/agent-routes.ts).
 */
import { Bind, Component, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { AgentApiRepo } from "../db/repos/agent-api.js";
import type { Channels, Clock, Log } from "../hmr/capabilities.js";
import { AgentApi } from "../mechanisms/agent-api.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import type { Errors } from "../mechanisms/observability.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { Settings } from "../mechanisms/settings.js";
import type { SessionManager, Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import type { SessionService } from "../services/session-service.js";
import { amspRoutes } from "./routes.js";

/** The public `/api/amsp/v1` group: the gate, CORS, the run stream and the Session routes. */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "AmspRoutes.routes", prefix: "/api/amsp/v1", auth: "none", order: 5 },
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
  @Bind("AmspRoutes.routes") routes!: Hono<AppEnv>;

  setup() {
    const clock = this.clock;
    this.routes = amspRoutes({
      settings: this.settings,
      agentApi: this.agentApi,
      sessions: this.sessions,
      manager: this.manager as SessionManager,
      sessionService: this.sessionService as SessionService,
      channels: this.channels,
      agentConfig: this.agentConfig,
      log: this.log,
      errors: this.errors,
      now: () => clock.now(),
    });
  }
}

/** The Agent API: per-Agent settings and keys in web.db, and the public AMSP routes. */
@Module({
  children: [AgentApiRepo, AmspRoutes],
  exports: [AgentApi],
})
export class AgentApiModule {}
