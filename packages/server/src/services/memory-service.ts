/**
 * The memory service moved to the agent domain package
 * (@prismshadow/penguin-library-agent/memory-service, services+http+cli restack S3) — it
 * speaks library vocabulary and structural ports (the paths port and the AgentConfig
 * mechanism). This file keeps the assembly: the provider binds the service's ports and
 * provides the Memory mechanism, and re-exports the moved shapes for the server's own
 * import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import { AgentConfig } from "../mechanisms/agents.js";
import { Memory } from "@prismshadow/penguin-library-agent/contract";
import { MemoryService } from "@prismshadow/penguin-library-agent/memory-service";

export { MemoryService } from "@prismshadow/penguin-library-agent/memory-service";

/** The memory assembly: binds the service's paths port and its AgentConfig port. */
@Module()
export class MemoryServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly agentConfig!: AgentConfig;
  @Provide() memory!: Memory;
  @Provide() service!: MemoryService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new MemoryService(), {
      paths: this.paths,
      agentConfigService: this.agentConfig,
    });
    this.memory = this.service;
  }
}
