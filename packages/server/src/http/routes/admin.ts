/**
 * Admin user-backend routes: only the built-in admin can use these (403 for non-admins),
 * and desktop mode rejects the whole surface (single-user; 403 `desktop_single_user`).
 * GET|POST /api/admin/users, POST /api/admin/users/:userId/password, DELETE /api/admin/users/:userId.
 */
import { Hono } from "hono";
import type { AdminUserCreateResponse, AdminUsersResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { rejectInDesktopMode } from "./desktop.js";
import type { DesktopService } from "../../services/desktop-service.js";
import type { AppEnv } from "../../auth/middleware.js";
import { pathParam, readJson, requireString } from "../validate.js";
import type { AdminService } from "../../services/admin-service.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Desktop } from "../../services/desktop-service.js";
import type { Proxy } from "../../net/proxy.js";
import type { ServerSettingsRepo } from "../../db/repos/server-settings.js";
import { adminSettingsRoutes } from "./admin-settings.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AdminRouteDeps {
  desktop: DesktopService | null;
  adminService: AdminService;
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
    "HttpModule.routes": [
      {
        id: "admin-api.users",
        prefix: "/api/admin/users",
        auth: "user",
        order: 30,
      },
      {
        id: "admin-api.settings",
        prefix: "/api/admin/settings",
        auth: "user",
        order: 40,
      },
    ],
  },
})
export class AdminRoutes {
  @Use() private readonly admin!: AdminService;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly proxy!: Proxy;
  @Use() private readonly settings!: ServerSettingsRepo;
  @Bind("admin-api.users") usersRoutes!: Hono<AppEnv>;
  @Bind("admin-api.settings") settingsRoutes!: Hono<AppEnv>;
  setup() {
    this.usersRoutes = adminUsersRoutes({
      adminService: this.admin,
      desktop: this.desktop.current() as DesktopService | null,
    });
    this.settingsRoutes = adminSettingsRoutes({
      proxyControl: (settings) => this.proxy.apply(settings),
      serverSettingsRepo: this.settings,
    });
  }
}
