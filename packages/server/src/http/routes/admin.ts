/**
 * Admin user-backend routes: only the built-in admin can use these (403 for non-admins).
 * GET|POST /api/admin/users, POST /api/admin/users/:userId/password, DELETE /api/admin/users/:userId.
 */
import { Hono } from "hono";
import type { AdminUserCreateResponse, AdminUsersResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { pathParam, readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function adminUsersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "该操作仅管理员可执行。");
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
