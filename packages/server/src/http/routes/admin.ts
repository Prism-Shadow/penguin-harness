/**
 * Admin user-backend routes: only the built-in admin can use these (403 for non-admins),
 * and desktop mode rejects the whole surface (single-user; 403 `desktop_single_user`).
 * GET|POST /api/admin/users, POST /api/admin/users/:userId/password, DELETE /api/admin/users/:userId.
 */
import { Hono } from "hono";
import type { AdminUserCreateResponse, AdminUsersResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { endpointOf } from "../app.js";
import { rejectInDesktopMode } from "./desktop.js";
import type { DesktopService } from "../../services/desktop-service.js";
import type { AppEnv } from "../../auth/middleware.js";
import { pathParam, readJson, requireString } from "../validate.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Desktop, Proxy } from "../../hmr/capabilities.js";
import { adminSettingsRoutes } from "./admin-settings.js";
import { adminPluginConfigRoutes } from "./admin-plugin-config.js";
import { PluginConfigAdmin } from "../../plugin/config-page.js";
import { pluginHostFrom, pluginPackageDisplayOf } from "../../plugin/host.js";
import type { Admin } from "@prismshadow/penguin-library-auth";
import type { Settings } from "@prismshadow/penguin-library-setting";

/** What this route group reaches — bound by its module (src/modules). */
export interface AdminRouteDeps {
  desktop: DesktopService | null;
  adminService: Admin;
}

export function adminUsersRoutes(deps: AdminRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", rejectInDesktopMode(deps));
  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  app.get("/", (c) => {
    return c.json({ users: deps.adminService.listUsers() } satisfies AdminUsersResponse);
  });

  app.post("/", async (c) => {
    const body = await readJson(c);
    const userId = requireString(body, "userId", { label: "userId" });
    const password = requireString(body, "password", { label: "password" });
    const user = await deps.adminService.createUser(userId, password);
    return c.json({ user } satisfies AdminUserCreateResponse, 201);
  });

  app.post("/:userId/password", async (c) => {
    const body = await readJson(c);
    const password = requireString(body, "password", { label: "password" });
    await deps.adminService.resetPassword(pathParam(c, "userId"), password);
    return c.body(null, 204);
  });

  app.delete("/:userId", async (c) => {
    await deps.adminService.deleteUser(pathParam(c, "userId"));
    return c.body(null, 204);
  });

  return app;
}

@Component({
  contributes: {
    "AgentAuthPermissionProvider.roles": [
      { id: "role.admin.read" },
      { id: "role.admin.maintain", children: ["admin.read"] },
      { id: "role.admin.all", children: ["admin.maintain"], parents: ["admin"] },
    ],
    "HttpModule.routes": [
      {
        id: "admin.users.list",
        method: "GET",
        prefix: "/api/admin/users",
        auth: "user",
        role: "admin.read",
        order: 30,
      },
      {
        id: "admin.users.create",
        method: "POST",
        prefix: "/api/admin/users",
        auth: "user",
        role: "admin.all",
        order: 30,
      },
      {
        id: "admin.users.setPassword",
        method: "POST",
        prefix: "/api/admin/users/:userId/password",
        auth: "user",
        role: "admin.all",
        order: 30,
      },
      {
        id: "admin.users.delete",
        method: "DELETE",
        prefix: "/api/admin/users/:userId",
        auth: "user",
        role: "admin.all",
        order: 30,
      },
      {
        id: "admin.settings.get",
        method: "GET",
        prefix: "/api/admin/settings",
        auth: "user",
        role: "admin.read",
        order: 40,
      },
      {
        id: "admin.settings.update",
        method: "PUT",
        prefix: "/api/admin/settings",
        auth: "user",
        role: "admin.maintain",
        order: 40,
      },
      {
        id: "admin.settings.listProxyProbes",
        method: "GET",
        prefix: "/api/admin/settings/proxy-probe",
        auth: "user",
        role: "admin.read",
        order: 40,
      },
      {
        id: "admin.settings.runProxyProbe",
        method: "POST",
        prefix: "/api/admin/settings/proxy-probe/:provider",
        auth: "user",
        role: "admin.maintain",
        order: 40,
      },
      {
        id: "admin.pluginConfig.get",
        method: "GET",
        prefix: "/api/admin/plugin-config",
        auth: "user",
        role: "admin.read",
        order: 45,
      },
      {
        id: "admin.pluginConfig.getIcon",
        method: "GET",
        prefix: "/api/admin/plugin-config/icon",
        auth: "user",
        role: "admin.read",
        order: 45,
      },
      {
        id: "admin.pluginConfig.update",
        method: "PUT",
        prefix: "/api/admin/plugin-config",
        auth: "user",
        role: "admin.maintain",
        order: 45,
      },
      {
        id: "admin.pluginConfig.action",
        method: "POST",
        prefix: "/api/admin/plugin-config/action",
        auth: "user",
        role: "admin.maintain",
        order: 45,
      },
    ],
  },
})
export class AdminRoutes {
  @Use() private readonly admin!: Admin;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly proxy!: Proxy;
  @Use() private readonly settings!: Settings;
  @Use() private readonly pluginConfigAdmin!: PluginConfigAdmin;
  @Bind("admin.users.list") usersListRoute!: Hono<AppEnv>;
  @Bind("admin.users.create") usersCreateRoute!: Hono<AppEnv>;
  @Bind("admin.users.setPassword") usersSetPasswordRoute!: Hono<AppEnv>;
  @Bind("admin.users.delete") usersDeleteRoute!: Hono<AppEnv>;
  @Bind("admin.settings.get") settingsGetRoute!: Hono<AppEnv>;
  @Bind("admin.settings.update") settingsUpdateRoute!: Hono<AppEnv>;
  @Bind("admin.settings.listProxyProbes") settingsListProxyProbesRoute!: Hono<AppEnv>;
  @Bind("admin.settings.runProxyProbe") settingsRunProxyProbeRoute!: Hono<AppEnv>;
  @Bind("admin.pluginConfig.get") pluginConfigGetRoute!: Hono<AppEnv>;
  @Bind("admin.pluginConfig.getIcon") pluginConfigGetIconRoute!: Hono<AppEnv>;
  @Bind("admin.pluginConfig.update") pluginConfigUpdateRoute!: Hono<AppEnv>;
  @Bind("admin.pluginConfig.action") pluginConfigActionRoute!: Hono<AppEnv>;
  setup({ resources }: ClassCtx) {
    const pcGroup = adminPluginConfigRoutes(this.pluginConfigAdmin, {
      // The host is claimed per request: the plugins of this generation are recorded after setup.
      icon: (plugin) => pluginPackageDisplayOf(pluginHostFrom(resources), plugin).icon,
    });
    this.pluginConfigGetRoute = endpointOf(pcGroup, "GET", "/");
    this.pluginConfigGetIconRoute = endpointOf(pcGroup, "GET", "/icon");
    this.pluginConfigUpdateRoute = endpointOf(pcGroup, "PUT", "/");
    this.pluginConfigActionRoute = endpointOf(pcGroup, "POST", "/action");
    const uGroup = adminUsersRoutes({
      adminService: this.admin,
      desktop: this.desktop.current() as DesktopService | null,
    });
    this.usersListRoute = endpointOf(uGroup, "GET", "/");
    this.usersCreateRoute = endpointOf(uGroup, "POST", "/");
    this.usersSetPasswordRoute = endpointOf(uGroup, "POST", "/:userId/password");
    this.usersDeleteRoute = endpointOf(uGroup, "DELETE", "/:userId");
    const sGroup = adminSettingsRoutes({
      proxyControl: (settings) => this.proxy.apply(settings),
      serverSettingsRepo: this.settings,
    });
    this.settingsGetRoute = endpointOf(sGroup, "GET", "/");
    this.settingsUpdateRoute = endpointOf(sGroup, "PUT", "/");
    this.settingsListProxyProbesRoute = endpointOf(sGroup, "GET", "/proxy-probe");
    this.settingsRunProxyProbeRoute = endpointOf(sGroup, "POST", "/proxy-probe/:provider");
  }
}
