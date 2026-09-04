import type { Opaque, Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  BuiltinToolFactory,
  PromptSection,
  ToolDefinitionConfig,
} from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import type { Config } from "../hmr/capabilities.js";
import { memoryRoutes } from "../http/routes/memory.js";
import { benchmarksRoutes } from "../http/routes/benchmarks.js";
import { agentSkillsRoutes } from "../http/routes/skills.js";
import { agentTransferRoutes } from "../http/routes/agent-transfer.js";
import { agentTracesRoutes } from "../http/routes/agent-traces.js";
import type { AgentConfig, Assembly, Benchmarks, Memory, Snapshots } from "../mechanisms/agents.js";
import type { Access } from "../mechanisms/projects.js";
import type { Traces } from "../mechanisms/traces.js";

/** A tool factory, as a contributor binds it: the built-in factory shape. */
export type ToolFactory = Opaque<"BuiltinToolFactory", BuiltinToolFactory>;

export interface HostAssemblySlots {
  /** A section appended to every Agent's system prompt. */
  promptSections: { title: string; text: string };
  /**
   * A tool an Agent may list in its `tools.builtin` config: the name, and the default
   * definition the config entry overrides field by field. The code half is the factory.
   */
  tools: Slot<{ name: string; definition: ToolDefinitionConfig }, ToolFactory>;
}

/**
 * What the host adds to every Session's assembly, built from this component's slots
 * (`HostAssembly.promptSections`, `HostAssembly.tools`) — plus the Agent-scoped route groups.
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
export class HostAssembly implements Assembly {
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
  private sections: PromptSection[] = [];
  private factories: Record<string, ToolFactory> = {};

  /** Sections appended to every Agent's system prompt, under their own headings. */
  promptSections(): PromptSection[] {
    return this.sections;
  }
  /** Tool factories an Agent's config may opt into by name, consulted before the built-in registry. */
  toolFactories(): Record<string, ToolFactory> {
    return this.factories;
  }

  setup({ contributions }: ClassCtx) {
    this.sections = (contributions.promptSections ?? []).map(
      (c) => c.data as unknown as PromptSection,
    );
    for (const c of contributions.tools ?? [])
      this.factories[c.data.name as string] = c.code as ToolFactory;
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
