/**
 * The CLI plugin commands' assembly, kept on the server: the provider's `@Use` ports are the
 * server's own capabilities (`Hmr`, `Db`), and the kernel does not inject `@Use` on a
 * hand-built shape. The contract, the slot, the routes and the run mechanics live in the plugin
 * library package (@prismshadow/penguin-library-plugin/cli-commands) and are re-exported here,
 * so the server's import paths and the plugin barrel are unchanged.
 */
import { Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandFiles,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import { effectivePluginTable } from "@prismshadow/penguin-core";
import type { DatabaseSync } from "node:sqlite";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import type { Access, ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { SessionDrivers, SessionIndex } from "@prismshadow/penguin-library-session";
import type { Users } from "@prismshadow/penguin-library-auth";
import type { Hono } from "hono";
import type { Db, Hmr } from "../hmr/capabilities.js";
import {
  type Collected,
  type PluginCliCommand,
  type PluginCliCommands,
  pluginCliCommandRoutes,
  runAsCaller,
  validPluginCommands,
} from "@prismshadow/penguin-library-plugin/cli-commands";
import { pluginHostFrom } from "@prismshadow/penguin-library-plugin/host";
import type { AppEnv } from "@prismshadow/penguin-library-auth/middleware";

export * from "@prismshadow/penguin-library-plugin/cli-commands";

/**
 * Owns the slot; serves it at /api/cli/commands. The contributions are read off the slot
 * at boot; each call attributes them to the packages of the plugin host as it is then.
 */
@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginCliCommandsProvider.routes",
        prefix: "/api/cli/commands",
        auth: "user",
        order: 66,
      },
    ],
  },
})
export class PluginCliCommandsProvider {
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly access!: Access;
  @Use() private readonly sessions!: SessionIndex;
  @Use() private readonly users!: Users;
  @Use() private readonly drivers!: SessionDrivers;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly db!: Db;
  @Provide() pluginCliCommands!: PluginCliCommands;
  @Bind("PluginCliCommandsProvider.routes") routes!: Hono<AppEnv>;

  setup({ contributions }: ClassCtx) {
    const machineId = new MachinesRepo(this.db as unknown as DatabaseSync).ownId();
    /** Whether the Project lists the package for this machine (its shared table or its own). */
    const listed = async (projectId: string, pkg: string): Promise<boolean> => {
      try {
        return (
          pkg in
          effectivePluginTable(await this.projectConfig.getPluginTables(projectId), machineId)
        );
      } catch {
        return false;
      }
    };
    // The kernel checked each entry against the slot's data type at boot, and resolved every
    // code half by its id.
    const collected: Collected[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      from: c.from,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      ...(c.data.access !== undefined ? { access: c.data.access as "admin" | "member" } : {}),
      ...(c.data.files !== undefined ? { files: c.data.files as unknown as CliCommandFiles } : {}),
      ...(c.data.requiresProjectListing === true ? { requiresProjectListing: true } : {}),
      ...(c.data.tokenCaller === "session-driver"
        ? { tokenCaller: "session-driver" as const }
        : {}),
      code: c.code as CliCommandCode,
    }));
    const list = (): PluginCliCommand[] => {
      // The host registers its plugins when the generation commits, after this tree booted,
      // so it is claimed per call — the same object across swaps, as the skills store does.
      const packageOf = new Map<string, string>();
      for (const entry of pluginHostFrom(this.hmr.resources).entries().values()) {
        for (const module of entry.modules) packageOf.set(module.manifest.name, entry.specifier);
      }
      return validPluginCommands(
        collected,
        (module) => packageOf.get(module),
        (line) => console.warn(line),
      );
    };
    const pluginCliCommands: PluginCliCommands = {
      list,
      run: async (request, caller) => {
        const own = list().filter((cmd) => cmd.package === request.package);
        return own.length === 0 ? null : runAsCaller(own, request, caller, listed);
      },
    };
    this.pluginCliCommands = pluginCliCommands;
    this.routes = pluginCliCommandRoutes({
      commands: pluginCliCommands,
      access: this.access,
      sessions: this.sessions,
      users: this.users,
      drivers: this.drivers,
    });
  }
}
