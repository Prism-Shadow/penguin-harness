/**
 * Admin plugin-configuration routes (admin only, 403 for non-admins):
 * GET /api/admin/plugin-config — every declared settings group, its schema and its values
 * (secrets masked); PUT /api/admin/plugin-config { name, values } — one group's update,
 * validated against its schema (see plugin/config.ts applyUpdate), stored, and handed to the
 * declaring module's watchers so it applies without a restart; POST
 * /api/admin/plugin-config/action { name, action } — runs one group's action (what a deployment
 * must DO on the machine, like creating the Windows sandbox's local accounts) and answers what
 * happened, together with the groups as they stand afterwards.
 */
import { Hono } from "hono";
import type { PluginConfigActionResponse, PluginConfigResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { PluginConfigError } from "../../plugin/config.js";
import type { PluginConfigAdmin } from "../../plugin/config.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString } from "../validate.js";

export function adminPluginConfigRoutes(store: PluginConfigAdmin): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    await next();
  });

  app.get("/", (c) => c.json({ plugins: store.describe() } satisfies PluginConfigResponse));

  app.put("/", async (c) => {
    const body = await readJson(c);
    const name = requireString(body, "name", { minLen: 1, maxLen: 214 });
    const values = (body as { values?: unknown }).values;
    if (values === null || typeof values !== "object" || Array.isArray(values)) {
      throw badRequest("values must be an object of fields.");
    }
    try {
      await store.set(name, values as Record<string, unknown>);
    } catch (err) {
      if (err instanceof PluginConfigError) {
        if (err.field === null) throw new HttpError(404, "plugin_config_unknown", err.message);
        throw new HttpError(400, "plugin_config_invalid", err.message);
      }
      throw err;
    }
    return c.json({ plugins: store.describe() } satisfies PluginConfigResponse);
  });

  app.post("/action", async (c) => {
    const body = await readJson(c);
    const name = requireString(body, "name", { minLen: 1, maxLen: 214 });
    const action = requireString(body, "action", { minLen: 1, maxLen: 214 });
    try {
      const result = await store.run(name, action);
      return c.json({ ...result, plugins: store.describe() } satisfies PluginConfigActionResponse);
    } catch (err) {
      if (err instanceof PluginConfigError) {
        throw new HttpError(404, "plugin_config_unknown", err.message);
      }
      throw err;
    }
  });

  return app;
}
