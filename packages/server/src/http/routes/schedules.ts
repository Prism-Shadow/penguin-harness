/**
 * The schedule routes moved to the session domain package
 * (@prismshadow/penguin-library-session/schedules, services+http+cli restack S7) — the
 * factories speak structural ports. This file keeps the server's component: it binds the
 * ports to the server's own mechanisms and declares the HTTP route contributions.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { Config } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access, ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { Schedules, Scheduling } from "@prismshadow/penguin-library-session";
import {
  projectScheduleRoutes,
  scheduleRoutes,
  type SchedulesRouteDeps,
} from "@prismshadow/penguin-library-session/schedules";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SchedulerRoutes.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/schedules",
        auth: "user",
        order: 200,
      },
      {
        id: "SchedulerRoutes.projectRoutes",
        prefix: "/api/projects/:projectId/schedules",
        auth: "user",
        order: 200,
      },
    ],
  },
})
export class SchedulerRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly scheduler!: Scheduling;
  @Use() private readonly schedulesRepo!: Schedules;
  @Bind("SchedulerRoutes.routes") routes!: Hono<AppEnv>;
  @Bind("SchedulerRoutes.projectRoutes") projectRoutes!: Hono<AppEnv>;
  setup() {
    const deps: SchedulesRouteDeps = {
      agentConfigService: this.agentConfig,
      config: this.config,
      projectConfigService: this.projectConfig,
      access: this.access,
      scheduler: this.scheduler,
      schedulesRepo: this.schedulesRepo,
    };
    this.routes = scheduleRoutes(deps);
    this.projectRoutes = projectScheduleRoutes(deps);
  }
}
