import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import type { Config } from "../hmr/capabilities.js";
import { memoryRoutes } from "../http/routes/memory.js";
import { benchmarksRoutes } from "../http/routes/benchmarks.js";
import { agentSkillsRoutes } from "../http/routes/skills.js";
import { agentTransferRoutes } from "../http/routes/agent-transfer.js";
import { agentTracesRoutes } from "../http/routes/agent-traces.js";
import type { AgentConfig, Benchmarks, Memory, Snapshots } from "../mechanisms/agents.js";
import type { Access } from "../mechanisms/projects.js";
import type { Traces } from "../mechanisms/traces.js";

/**
 * The Agent-scoped route groups: memory, skills, transfer, traces — and benchmarks, which
 * are Project-level peers of an Agent but read through the same services.
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
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly memory!: Memory;
  @Use() private readonly snapshots!: Snapshots;
  @Use() private readonly benchmarks!: Benchmarks;
  @Use() private readonly traces!: Traces;
  @Bind("agents.memory") memoryRoutes!: Hono<AppEnv>;
  @Bind("agents.benchmarks") benchmarksRoutes!: Hono<AppEnv>;
  @Bind("agents.skills") skillsRoutes!: Hono<AppEnv>;
  @Bind("agents.transfer") transferRoutes!: Hono<AppEnv>;
  @Bind("agents.traces") tracesRoutes!: Hono<AppEnv>;

  setup() {
    const access = this.access;
    const agentConfigService = this.agentConfig;
    this.memoryRoutes = memoryRoutes({ memoryService: this.memory, access });
    this.benchmarksRoutes = benchmarksRoutes({ benchmarks: this.benchmarks, access });
    this.skillsRoutes = agentSkillsRoutes({ agentConfigService, config: this.config, access });
    this.transferRoutes = agentTransferRoutes({
      agentConfigService,
      access,
      snapshots: this.snapshots,
    });
    this.tracesRoutes = agentTracesRoutes({
      agentConfigService,
      access,
      traceService: this.traces,
    });
  }
}
