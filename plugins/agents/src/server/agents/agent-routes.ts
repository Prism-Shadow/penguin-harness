import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Config, Desktop, Clock, Paths } from "@prismshadow/penguin-server/internal";
import type { AppEnv } from "@prismshadow/penguin-server/internal";
import type { Workbenches } from "@penguinharness/plugin-workbenches/server";
import { memoryRoutes } from "../memory.js";
import { benchmarksRoutes } from "@penguinharness/plugin-usage/server";
import { agentSkillsRoutes } from "../skills.js";
import { agentTransferRoutes } from "../agent-transfer.js";
import { agentTracesRoutes } from "@penguinharness/plugin-usage/server";
import { agentApiRoutes } from "../agent-api.js";

import type { AgentApi } from "@prismshadow/penguin-server/internal";
import type { AgentConfig, Benchmarks, Memory, Snapshots } from "@prismshadow/penguin-server/internal";
import type { Access, ProjectConfigStore } from "@prismshadow/penguin-server/internal";
import type { Settings } from "@prismshadow/penguin-server/internal";
import type { Traces } from "@prismshadow/penguin-server/internal";


/**
 * The Agent-scoped route groups: memory, skills, the API tab's settings and keys, transfer,
 * traces — and benchmarks, which are Project-level peers of an Agent but read through the same
 * services.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "agents.benchmarks",
        prefix: "/api/projects/:projectId/benchmarks",
        auth: "user",
        order: 165,
      },
      {
        id: "agents.memory",
        prefix: "/api/projects/:projectId/agents/:agentId/memory",
        auth: "user",
        order: 190,
      },
      {
        id: "agents.skills",
        prefix: "/api/projects/:projectId/agents/:agentId/skills",
        auth: "user",
        order: 220,
      },
      {
        id: "agents.api",
        prefix: "/api/projects/:projectId/agents/:agentId/api",
        auth: "user",
        order: 225,
      },
      {
        id: "agents.transfer",
        prefix: "/api/projects/:projectId/agents/:agentId",
        auth: "user",
        order: 230,
      },
      {
        id: "agents.traces",
        prefix: "/api/projects/:projectId/agents/:agentId/traces",
        auth: "user",
        order: 240,
      },
    ],
  },
})
export class AgentRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly paths!: Paths;
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly memory!: Memory;
  @Use() private readonly snapshots!: Snapshots;
  @Use() private readonly benchmarks!: Benchmarks;
  @Use() private readonly traces!: Traces;
  @Use() private readonly agentApi!: AgentApi;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly clock!: Clock;
  @Use() private readonly settings!: Settings;
  @Use() private readonly workbenches!: Workbenches;
  @Bind("agents.memory") memoryRoutes!: Hono<AppEnv>;
  @Bind("agents.benchmarks") benchmarksRoutes!: Hono<AppEnv>;
  @Bind("agents.skills") skillsRoutes!: Hono<AppEnv>;
  @Bind("agents.api") apiRoutes!: Hono<AppEnv>;
  @Bind("agents.transfer") transferRoutes!: Hono<AppEnv>;
  @Bind("agents.traces") tracesRoutes!: Hono<AppEnv>;

  setup() {
    const access = this.access;
    const agentConfigService = this.agentConfig;
    this.memoryRoutes = memoryRoutes({ memoryService: this.memory, access });
    this.benchmarksRoutes = benchmarksRoutes({ benchmarks: this.benchmarks, access });
    this.skillsRoutes = agentSkillsRoutes({ agentConfigService, config: this.config, access });
    const clock = this.clock;
    this.apiRoutes = agentApiRoutes({
      agentApi: this.agentApi,
      projectConfig: this.projectConfig,
      agentConfigService,
      access,
      settings: this.settings,
      now: () => clock.now(),
    });
    this.transferRoutes = agentTransferRoutes({
      root: this.paths.root,
      agentConfigService,
      access,
      snapshots: this.snapshots,
      workbenches: this.workbenches,
    });
    this.tracesRoutes = agentTracesRoutes({
      agentConfigService,
      access,
      traceService: this.traces,
    });
  }
}
