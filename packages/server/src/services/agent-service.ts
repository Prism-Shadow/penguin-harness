/**
 * The Agent service moved to the agent domain package
 * (@prismshadow/penguin-library-agent/agent-service, services+http+cli restack S10) — it speaks
 * library vocabulary and structural ports. This file keeps the assembly: the provider binds the
 * service's paths port to the server's `Paths` capability and its plugin-library, plugin-modules,
 * workbenches and directory-skills ports to the server's own mechanisms, provides the
 * AgentLifecycle mechanism, and re-exports the moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { createAgent, installPlugin, McpServerNameTakenError } from "@prismshadow/penguin-core";
import type { LibraryPlugin } from "@prismshadow/penguin-core";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { AgentIndex } from "@prismshadow/penguin-library-project";
import type { PluginLibrary } from "../plugin/library-module.js";
import type { PluginModules } from "../mechanisms/plugins.js";
import { migrateWorkbenches } from "../workbenches/migrate.js";
import { HttpError } from "../http/errors.js";
import { resolveDirectorySkills } from "./directory-skills.js";
import { resolveLibraryPlugins, seedPluginNames } from "./plugin-library.js";
import type { AgentConfig, Snapshots, AgentLifecycle } from "../mechanisms/agents.js";
import { AgentService } from "@prismshadow/penguin-library-agent/agent-service";

export { AgentService } from "@prismshadow/penguin-library-agent/agent-service";
export type {
  AgentListItem,
  AgentCreation,
} from "@prismshadow/penguin-library-agent/agent-service";
export { refuseBuiltinDeletion } from "@prismshadow/penguin-library-agent/agent-service";
export { DELETING_DIR, deletingDir } from "@prismshadow/penguin-library-agent/agent-service";

/** The agent service assembly: binds the service's paths port and its server-mechanism ports. The node keeps the service's name (`AgentService`), the one plugins require and replace by. */
@Module({ name: "AgentService" })
export class AgentServiceProvider {
  @Use() private readonly paths!: Paths;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly snapshots!: Snapshots;
  @Use() private readonly pluginLibrary!: PluginLibrary;
  @Use() private readonly pluginModules!: PluginModules;
  @Provide() AgentLifecycle!: AgentLifecycle;
  @Provide() AgentService!: AgentService;

  async setup(ctx: ClassCtx) {
    // The service's ports are decorator-injected fields; the server binds them by hand here.
    const library = this.pluginLibrary;
    this.AgentService = Object.assign(new AgentService(), {
      paths: this.paths,
      agents: this.agents,
      agentConfig: this.agentConfig,
      snapshots: this.snapshots,
      library: {
        list: () => library.list(),
        get: (name: string) => library.get(name),
        defaultInstalled: () => library.defaultInstalled(),
        resolve: (names: readonly string[]) => resolveLibraryPlugins(library, names),
        seed: (picked: readonly string[], defaults: readonly { name: string }[]) =>
          seedPluginNames(picked, defaults),
      },
      pluginModules: {
        ensure: (
          projectId: string,
          plugins: readonly string[],
          actor: Parameters<PluginModules["ensure"]>[2],
          ask: Parameters<PluginModules["ensure"]>[3],
          agentId?: string,
        ) => this.pluginModules.ensure(projectId, plugins, actor, ask, agentId),
      },
      pluginInstaller: {
        // Core's installPlugin reads the plugin library through the host the server names
        // (useLibraryHost at boot), so the write runs here, on the server's own core copy —
        // a library package's copy of core is an injected snapshot whose host was never
        // named. Two plugins carrying an MCP server of the same name: the creator's choice
        // to change, answered as the plugin routes answer it — not an internal error.
        install: async (
          root: string,
          projectId: string,
          agentId: string,
          plugin: LibraryPlugin,
        ) => {
          try {
            await installPlugin(root, projectId, agentId, plugin);
          } catch (err) {
            if (err instanceof McpServerNameTakenError) {
              throw new HttpError(409, "mcp_server_name_taken", err.message);
            }
            throw err;
          }
        },
        installBare: async (
          root: string,
          projectId: string,
          agentId: string,
          plugin: LibraryPlugin,
        ) => installPlugin(root, projectId, agentId, plugin),
      },
      workbenches: {
        migrate: (agentDir: string) => migrateWorkbenches(agentDir),
      },
      directorySkills: {
        resolve: (dir: string, names: readonly string[]) => resolveDirectorySkills(dir, names),
      },
      hostCreateAgent: createAgent,
    });
    this.AgentLifecycle = this.AgentService;
    // The service's own setup ran on its node before the move; its dispose effect (ending the
    // generation's removals) rides this node's context now.
    await this.AgentService.setup(ctx);
  }
}
