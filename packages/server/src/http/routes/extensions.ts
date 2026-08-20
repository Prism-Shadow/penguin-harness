/**
 * GET /api/extensions: the extension index served to the Web App's Extensions page (any
 * logged-in user; no Project check — like the Skill library, the index is
 * deployment-global, not Project data). The registry list is fixed to the builtin
 * one; when more sources arrive they merge here.
 */
import { Hono } from "hono";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { ExtensionIndexResponse } from "../../api/types.js";
import { builtinExtensionRegistry } from "../../extension/registry.js";

export function extensionRegistryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = builtinExtensionRegistry();
  app.get("/", async (c) => {
    const body: ExtensionIndexResponse = { extensions: await registry.index() };
    return c.json(body);
  });
  return app;
}

/** The index the Extensions page reads: deployment-global, like the skill library. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "ExtensionRegistryRoutes.routes",
        prefix: "/api/extensions",
        auth: "user",
        order: 70,
      },
    ],
  },
})
export class ExtensionRegistryRoutes {
  @Bind("ExtensionRegistryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = extensionRegistryRoutes();
  }
}
