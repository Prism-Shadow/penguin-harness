/**
 * The installed-skills read view moved to the agent domain package
 * (@prismshadow/penguin-library-agent/agent-skills, services+http+cli restack S10) — it speaks
 * library vocabulary and a structural paths port. This file keeps the assembly: the provider
 * binds the service's paths port to the server's `Paths` capability and provides the
 * AgentSkills mechanism, and re-exports the moved shapes for the server's own import paths.
 */
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { AgentConfig } from "../mechanisms/agents.js";
import { InstalledAgentSkills } from "@prismshadow/penguin-library-agent/agent-skills";

export { InstalledAgentSkills } from "@prismshadow/penguin-library-agent/agent-skills";

/** AgentSkills: what InstalledAgentSkills implements, and a server module reaches through the plugin face. */
@Interface()
export abstract class AgentSkills {
  /**
   * The names of the Skills installed on the Agent, sorted. 400 for an id that is not one plain
   * segment, 404 `agent_not_found` for an Agent the Project does not have. Callers check the
   * caller's access to the Project first; this does not.
   */
  abstract installedSkills(projectId: string, agentId: string): Promise<string[]>;
}

/** The installed-skills assembly: binds the service's paths port and its AgentConfig port. */
@Module()
export class InstalledAgentSkillsProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly agentConfig!: AgentConfig;
  @Provide() agentSkills!: AgentSkills;
  @Provide() service!: InstalledAgentSkills;

  setup() {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    this.service = Object.assign(new InstalledAgentSkills(), {
      paths: this.paths,
      agentConfig: this.agentConfig,
    });
    this.agentSkills = this.service;
  }
}
