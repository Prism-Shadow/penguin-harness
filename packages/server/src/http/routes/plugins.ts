/**
 * GET /api/plugins: the plugin index served to the Web App's Plugins page (any
 * logged-in user; no Project check — like the Skill library, the index is
 * deployment-global, not Project data). The registry list is fixed to the builtin
 * one; when more sources arrive they merge here.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { PluginIndexResponse } from "../../api/types.js";
import { builtinPluginRegistry } from "../../plugins/registry.js";

export function pluginRegistryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = builtinPluginRegistry();
  app.get("/", async (c) => {
    const body: PluginIndexResponse = { plugins: await registry.index() };
    return c.json(body);
  });
  return app;
}
