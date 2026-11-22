/**
 * A library plugin's server module, asked for by hand, and the administrator's requests and
 * decisions (PRFC-0031):
 *
 *   POST /api/projects/:p/plugins/modules { plugin }       enable the plugin's server module, or ask the
 *                                                          administrator to — the rule an install applies,
 *                                                          pressed as a button (any member); 404
 *                                                          unknown_plugin, 400 no_server_module
 *   POST /api/projects/:p/plugins/modules                  a package not on this server yet, asked for by
 *        { package, agentId? }                             a member's 「安装到 Agent」: a request for the
 *                                                          administrator (409 plugin_on_server when it is)
 *   GET  /api/admin/plugin-modules                         every request and decision, with each module's
 *                                                          state on this server (administrator)
 *   POST /api/admin/plugin-modules/decide                  enable, or decline — which stops an enabled module
 *        { package, decision: "enable" | "decline" }       here (administrator); 404 unknown_request, 409
 *                                                          project_gone
 *
 * The administrator's two check that the caller IS the administrator and nothing else: there is one
 * administrator, who is not a member of every Project, and a request comes from a Project of its
 * own. The member route checks Project access. An enable may re-assemble the App inside the
 * request; what answers after it is the plugin-modules service, which only touches what survives
 * the swap.
 */
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Access } from "@prismshadow/penguin-library-project";
import type { PluginModuleAskResponse, PluginModuleRequestsResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ModuleActor, PluginModules } from "../../mechanisms/plugins.js";
import { PACKAGE_NAME } from "../../plugin/loader.js";
import type { PluginLibrary } from "../../plugin/library-module.js";
import { HttpError } from "../errors.js";
import { readJson, requireEnum, requireString, requireValidId } from "../validate.js";

export interface PluginModuleRoutesDeps {
  access: Access;
  library: PluginLibrary;
  modules: PluginModules;
}

const actorOf = (c: { var: AppEnv["Variables"] }): ModuleActor => ({
  userId: c.var.user.userId,
  isAdmin: c.var.user.isAdmin,
});

/** POST /api/projects/:p/plugins/modules (Project members). */
export function projectPluginModuleRoutes(deps: PluginModuleRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const actor = actorOf(c);
    // A package not on this server yet: the member's 「安装到 Agent」 becomes a request.
    if (typeof body.package === "string" && body.plugin === undefined) {
      const pkg = requireString(body, "package", { minLen: 1, maxLen: 214, pattern: PACKAGE_NAME });
      if (deps.library.list().some((p) => p.packageName === pkg)) {
        throw new HttpError(409, "plugin_on_server", `${pkg} is on this server already.`);
      }
      const agentId =
        typeof body.agentId === "string" && isValidId(body.agentId) ? body.agentId : null;
      const moduleActions = await deps.modules.askForPackage(projectId, pkg, actor, agentId);
      return c.json({
        modules: await deps.modules.status(projectId, actor),
        moduleActions,
      } satisfies PluginModuleAskResponse);
    }
    const name = requireString(body, "plugin", { minLen: 1, maxLen: 214 });
    const plugin = deps.library.get(name);
    if (plugin === undefined) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${name}`);
    }
    if (!plugin.modules) {
      throw new HttpError(400, "no_server_module", `Plugin ${name} ships no server module.`);
    }
    // Last, the way an install calls it: it may re-assemble the App.
    const moduleActions = await deps.modules.ensure(projectId, [name], actor, "explicit");
    return c.json({
      modules: await deps.modules.status(projectId, actor),
      moduleActions,
    } satisfies PluginModuleAskResponse);
  });
  return app;
}

/** /api/admin/plugin-modules (the administrator only, whatever Projects they belong to). */
export function adminPluginModuleRoutes(deps: PluginModuleRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const requireAdmin = (c: { var: AppEnv["Variables"] }) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
  };
  app.get("/", async (c) => {
    requireAdmin(c);
    return c.json((await deps.modules.requests()) satisfies PluginModuleRequestsResponse);
  });
  app.post("/decide", async (c) => {
    requireAdmin(c);
    const body = await readJson(c);
    const pkg = requireString(body, "package", { minLen: 1, maxLen: 214, pattern: PACKAGE_NAME });
    const decision = requireEnum(body, "decision", ["enable", "decline"] as const);
    return c.json(
      (await deps.modules.decide(pkg, decision, actorOf(c))) satisfies PluginModuleRequestsResponse,
    );
  });
  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginModuleRoutes.project",
        prefix: "/api/projects/:projectId/plugins/modules",
        auth: "user",
        // Ahead of the Projects group, whose `/:projectId/…` would otherwise answer here.
        order: 61,
      },
      {
        id: "PluginModuleRoutes.admin",
        prefix: "/api/admin/plugin-modules",
        auth: "user",
        order: 46,
      },
    ],
  },
})
export class PluginModuleRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly library!: PluginLibrary;
  @Use() private readonly modules!: PluginModules;
  @Bind("PluginModuleRoutes.project") projectRoutes!: Hono<AppEnv>;
  @Bind("PluginModuleRoutes.admin") adminRoutes!: Hono<AppEnv>;
  setup() {
    const deps = { access: this.access, library: this.library, modules: this.modules };
    this.projectRoutes = projectPluginModuleRoutes(deps);
    this.adminRoutes = adminPluginModuleRoutes(deps);
  }
}
