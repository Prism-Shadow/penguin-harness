import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "@prismshadow/penguin-server/internal";
import type { Hono } from "hono";
import { Clock, AgentApi, AgentConfig, Benchmarks, Memory, Snapshots, Access, ProjectConfigStore, Settings, Traces } from "@prismshadow/penguin-server/internal";
import { memoryRoutes } from "../memory.js";
import { benchmarksRoutes, agentTracesRoutes } from "@penguinharness/plugin-usage/server";
import { agentSkillsRoutes } from "../skills.js";
import { agentApiRoutes } from "../agent-api.js";

/**
 * The Agent-scoped route groups: memory, skills, the API tab's settings and keys, the Agent's
 * own avatar, export and import, traces — and benchmarks, which are Project-level peers of an Agent but read through the same
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
        id: "agents.avatar",
        prefix: "/api/projects/:projectId/agents/:agentId/avatar",
        auth: "user",
        order: 228,
      },
      {
        id: "agents.archive",
        prefix: "/api/projects/:projectId/agents",
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
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;
  @Use() private readonly sessions!: SessionIndex;
  @Bind("agents.memory") memoryRoutes!: Hono<AppEnv>;
  @Bind("agents.benchmarks") benchmarksRoutes!: Hono<AppEnv>;
  @Bind("agents.skills") skillsRoutes!: Hono<AppEnv>;
  @Bind("agents.api") apiRoutes!: Hono<AppEnv>;
  @Bind("agents.avatar") avatarRoutes!: Hono<AppEnv>;
  @Bind("agents.archive") archiveRoutes!: Hono<AppEnv>;
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
    this.avatarRoutes = agentAvatarRoutes({
      root: this.paths.root,
      agentConfigService,
      access,
    });
    this.archiveRoutes = agentArchiveRoutes({
      root: this.paths.root,
      access,
      agentConfig: agentConfigService,
      agents: this.agents,
      snapshots: this.snapshots,
      traces: this.traces,
      workbenches: this.workbenches,
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      sessions: this.sessions,
      now: () => clock.now(),
    });
    this.tracesRoutes = agentTracesRoutes({
      agentConfigService,
      access,
      traceService: this.traces,
    });
  }
}
