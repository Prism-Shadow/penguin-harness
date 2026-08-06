/**
 * Admin server-settings routes (admin only, 403 for non-admins):
 * GET|PUT /api/admin/settings — the server-global settings stored in server_settings
 * (currently the "use system HTTP proxy" switch, design § "出网与系统代理").
 * A PUT applies immediately: the persisted value is written first, then the process
 * dispatcher is rebuilt so new outbound connections follow the toggle without a restart.
 */
import { Hono } from "hono";
import type { ServerSettingsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import { optionalBoolean, readJson } from "../validate.js";
import type { AppDeps } from "../../app.js";
import { setUseSystemProxy } from "../../net/proxy.js";

export function adminSettingsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  const settings = (): ServerSettingsResponse => ({
    settings: { useSystemProxy: deps.serverSettingsRepo.getUseSystemProxy() },
  });

  app.get("/", (c) => c.json(settings()));

  app.put("/", async (c) => {
    const body = await readJson(c);
    const useSystemProxy = optionalBoolean(body, "useSystemProxy");
    if (useSystemProxy !== undefined) {
      deps.serverSettingsRepo.setUseSystemProxy(useSystemProxy);
      // Mirror into the process: rebuilds the global fetch dispatcher (live toggle).
      setUseSystemProxy(useSystemProxy);
    }
    return c.json(settings());
  });

  return app;
}
