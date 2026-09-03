import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { PromptSection } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import type { Config } from "../config.js";
import type { ProjectAccess } from "./project-access.js";
import type { AgentConfigService } from "./agent-config-service.js";
import type { MemoryService } from "./memory-service.js";
import type { SnapshotService } from "./snapshot-service.js";
import type { BenchmarkService } from "./benchmark-service.js";
import type { TraceService } from "./trace-service.js";
import { memoryRoutes } from "../http/routes/memory.js";
import { benchmarksRoutes } from "../http/routes/benchmarks.js";
import { agentSkillsRoutes } from "../http/routes/skills.js";
import { agentTransferRoutes } from "../http/routes/agent-transfer.js";
import { agentTracesRoutes } from "../http/routes/agent-traces.js";

export interface HostAssemblySlots {
  /** A section appended to every Agent's system prompt. */
  promptSections: { title: string; text: string };
}

/**
 * What the host adds to every Session's assembly, built from this component's slots
 * (`HostAssembly.promptSections`) — plus the Agent-scoped route groups.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "agents.memory",
        prefix: "/api/projects/:projectId/agents/:agentId/memory",
        auth: "user",
        order: 190,
      },
      {
        id: "agents.benchmarks",
        prefix: "/api/projects/:projectId/agents/:agentId/benchmarks",
        auth: "user",
        order: 210,
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
export class HostAssembly {
  @Use() private readonly config!: Config;
  @Use() private readonly access!: ProjectAccess;
  @Use() private readonly agentConfig!: AgentConfigService;
  @Use() private readonly memory!: MemoryService;
  @Use() private readonly snapshots!: SnapshotService;
  @Use() private readonly benchmarks!: BenchmarkService;
  @Use() private readonly traces!: TraceService;
  @Bind("agents.memory") memoryRoutes!: Hono<AppEnv>;
  @Bind("agents.benchmarks") benchmarksRoutes!: Hono<AppEnv>;
  @Bind("agents.skills") skillsRoutes!: Hono<AppEnv>;
  @Bind("agents.transfer") transferRoutes!: Hono<AppEnv>;
  @Bind("agents.traces") tracesRoutes!: Hono<AppEnv>;
  private sections: PromptSection[] = [];

  /** Sections appended to every Agent's system prompt, under their own headings. */
  promptSections(): PromptSection[] {
    return this.sections;
  }

  setup({ contributions }: ClassCtx) {
    this.sections = (contributions.promptSections ?? []).map(
      (c) => c.data as unknown as PromptSection,
    );
    const access = this.access;
    const agentConfigService = this.agentConfig;
    this.memoryRoutes = memoryRoutes({ memoryService: this.memory, access });
    this.benchmarksRoutes = benchmarksRoutes({
      agentConfigService,
      benchmarks: this.benchmarks,
      access,
    });
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
