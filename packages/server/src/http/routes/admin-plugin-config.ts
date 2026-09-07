/**
 * Admin plugin-configuration routes (admin only, 403 for non-admins):
 * GET /api/admin/plugin-config — every loaded plugin that declares a configuration, its
 * schema and its values (secrets masked); PUT /api/admin/plugin-config { name, values } —
 * one package's update, validated against its schema (see plugin/config.ts applyUpdate),
 * stored, and handed to the plugin's watchers so it applies without a restart.
 */
import { Hono } from "hono";
import type { PluginConfigResponse } from "../../api/types.js";
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
      store.set(name, values as Record<string, unknown>);
    } catch (err) {
      if (err instanceof PluginConfigError) {
        if (err.field === null) throw new HttpError(404, "plugin_config_unknown", err.message);
        throw new HttpError(400, "plugin_config_invalid", err.message);
      }
      throw err;
    }
    return c.json({ plugins: store.describe() } satisfies PluginConfigResponse);
  });

  return app;
}
