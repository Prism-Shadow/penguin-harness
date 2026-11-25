/**
 * The plugin-modules service moved to the plugin library package
 * (@prismshadow/penguin-library-plugin/plugin-modules, services+http+cli restack) — it speaks
 * library vocabulary and structural ports. This file keeps the assembly: the Provider binds the
 * service's ports (the kernel does not inject @Use on a hand-built instance), composes the user
 * channel lookup over the server's channel hub and the user channel key, and re-exports the
 * moved shapes for the server's own import paths.
 */
import { Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Channels, Clock, Config, Db, Hmr, Log, Reassembly } from "../hmr/capabilities.js";
import { userChannelKey } from "../http/user-channel.js";
import type { PluginLibrary } from "@prismshadow/penguin-library-plugin/library-module";
import { PluginModulesService } from "@prismshadow/penguin-library-plugin/plugin-modules";
import type { PluginModules } from "@prismshadow/penguin-library-plugin/mechanisms";
import type { PluginModulePreinstalls, PluginModuleRequests } from "@prismshadow/penguin-library-setting";
import type { Members, ProjectConfigStore, Projects } from "@prismshadow/penguin-library-project";
import type { Users } from "@prismshadow/penguin-library-auth";

export * from "@prismshadow/penguin-library-plugin/plugin-modules";

/** The plugin-modules assembly: binds the service's ports by hand, then runs its setup. */
@Module()
export class PluginModulesServiceProvider {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly reassembly!: Reassembly;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly db!: Db;
  @Use() private readonly library!: PluginLibrary;
  @Use() private readonly ledger!: PluginModuleRequests;
  @Use() private readonly preinstalls!: PluginModulePreinstalls;
  @Use() private readonly projects!: Projects;
  @Use() private readonly members!: Members;
  @Use() private readonly users!: Users;
  @Use() private readonly channels!: Channels;
  @Use() private readonly log!: Log;
  @Use() private readonly clock!: Clock;
  @Provide() pluginModules!: PluginModules;

  setup() {
    const channels = this.channels;
    this.pluginModules = Object.assign(new PluginModulesService(), {
      config: this.config,
      hmr: this.hmr,
      reassembly: this.reassembly,
      projectConfig: this.projectConfig,
      db: this.db,
      library: this.library,
      ledger: this.ledger,
      preinstalls: this.preinstalls,
      projects: this.projects,
      members: this.members,
      users: this.users,
      channels: {
        peekUser: (userId: string) => channels.peek(userChannelKey(userId)),
      },
      log: this.log,
      clock: this.clock,
    });
    this.pluginModules.setup();
  }
}
