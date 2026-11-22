/**
 * The administrator's server-wide plugin verbs (05 「插件库」 「安装模型」), whatever Projects they
 * belong to:
 *
 *   GET    /api/admin/plugins/holders?package=…   who would lose it (the confirm's list)
 *   DELETE /api/admin/plugins?package=…           uninstall it from every Agent here, then from
 *                                                 this server (services/plugin-server-uninstall.ts)
 *
 * Both take a person's sign-in: the local API token every Agent's shell holds may not uninstall a
 * plugin from every other Agent.
 */
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { ProjectConfigStore } from "@prismshadow/penguin-library-project";
import { MachinesRepo } from "@prismshadow/penguin-library-machine/machine";
import type { PluginHoldersResponse, PluginServerUninstallResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { requireHuman } from "../../auth/middleware.js";
import type { Config, Db, Hmr, Log, Reassembly } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { PluginPackages } from "../../mechanisms/plugins.js";
import type { Workbenches } from "../../mechanisms/workbenches.js";
import type { PluginLibrary } from "../../plugin/library-module.js";
import { PACKAGE_NAME, pluginBases, readPluginClosure } from "../../plugin/loader.js";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import { PluginServerUninstall } from "../../services/plugin-server-uninstall.js";
import { HttpError } from "../errors.js";

export function adminPluginRoutes(service: PluginServerUninstall): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });
  const packageOf = (value: string | undefined): string => {
    const name = (value ?? "").trim();
    if (!PACKAGE_NAME.test(name)) {
      throw new HttpError(400, "bad_request", "package must be an npm package name.");
    }
    return name;
  };
  app.get("/holders", async (c) => {
    requireHuman(c);
    return c.json(
      (await service.holders(packageOf(c.req.query("package")))) satisfies PluginHoldersResponse,
    );
  });
  app.delete("/", async (c) => {
    requireHuman(c);
    const pkg = packageOf(c.req.query("package"));
    return c.json(
      (await service.uninstall(pkg, c.var.user.userId)) satisfies PluginServerUninstallResponse,
    );
  });
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "AdminPluginRoutes.routes",
        prefix: "/api/admin/plugins",
        auth: "user",
        order: 47,
      },
    ],
  },
})
export class AdminPluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly db!: Db;
  @Use() private readonly log!: Log;
  @Use() private readonly reassembly!: Reassembly;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly library!: PluginLibrary;
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly packages!: PluginPackages;
  @Bind("AdminPluginRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const root = this.config.root;
    const machineId = new MachinesRepo(this.db as unknown as DatabaseSync).ownId();
    const hmr = this.hmr;
    const projectConfig = this.projectConfig;
    const agentConfig = this.agentConfig;
    const manager = this.manager;
    const log = this.log;
    this.routes = adminPluginRoutes(
      new PluginServerUninstall({
        root,
        machineId,
        bases: () => pluginBases(root, hmr.assetsDir()),
        library: this.library,
        workbenches: this.workbenches,
        projectConfig: {
          getPluginTables: (projectId) => projectConfig.getPluginTables(projectId),
          setPluginTables: async (projectId, tables) => {
            await projectConfig.setPluginTables(projectId, tables);
          },
          getName: (projectId) => projectConfig.getName(projectId),
        },
        agentName: async (projectId, agentId) =>
          (await agentConfig.readCardMeta(projectId, agentId)).name,
        apply: (change) => this.reassembly.reassemble(change),
        closure: () => readPluginClosure(root, machineId),
        removePackage: (name) => this.packages.remove(root, name),
        invalidate: (projectId, agentId) => manager.invalidateAgentRuntimes(projectId, agentId),
        log: (line) => log.line(line),
      }),
    );
  }
}
