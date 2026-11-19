/**
 * The agent-config service moved to the agent domain package
 * (@prismshadow/penguin-library-agent/agent-config-service, services+http+cli restack S3) —
 * it speaks library vocabulary and a structural paths port. This file keeps the assembly:
 * the provider binds the service's paths port to the server's `Paths` capability and provides
 * the AgentConfig mechanism, and re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import { AgentConfig } from "@prismshadow/penguin-library-agent/contract";
import { AgentConfigService } from "@prismshadow/penguin-library-agent/agent-config-service";

export { AgentConfigService } from "@prismshadow/penguin-library-agent/agent-config-service";
export type { AgentConfigView } from "@prismshadow/penguin-library-agent/types";

/** The agent-config assembly: binds the service's paths port. */
@Module()
export class AgentConfigServiceProvider {
  @Use() private readonly paths!: Paths;
  @Provide() agentConfig!: AgentConfig;
  @Provide() service!: AgentConfigService;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new AgentConfigService(), { paths: this.paths });
    this.agentConfig = this.service;
  }
}
