/**
 * GET /api/extensions: the extension index served to the Web App's Extensions page (any
 * logged-in user; no Project check — like the Skill library, the index is
 * deployment-global, not Project data). The registry list is fixed to the builtin
 * one; when more sources arrive they merge here.
 *
 * GET /api/extensions/readme?name=…: one entry's long-form documentation, fetched when a
 * extension is opened rather than shipped with the listing. The specifier is a query
 * parameter, not a path segment, because it is scoped (`@scope/name`) and would
 * otherwise have to survive two rounds of slash encoding.
 */
import { Hono } from "hono";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { ExtensionIndexResponse, ExtensionReadmeResponse } from "../../api/types.js";
import { builtinExtensionRegistry } from "../../extension/registry.js";

export function extensionRegistryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = builtinExtensionRegistry();
  app.get("/", async (c) => {
    const body: ExtensionIndexResponse = { extensions: await registry.index() };
    return c.json(body);
  });
  app.get("/readme", async (c) => {
    const name = c.req.query("name");
    if (name === undefined || name === "") {
      return c.json({ error: { code: "bad_request", message: "name is required" } }, 400);
    }
    // Only entries this deployment actually lists: the readme map is keyed by specifier,
    // and answering for an unlisted name would make the endpoint a probe of what exists.
    const listed = (await registry.index()).some((e) => e.name === name);
    if (!listed) {
      return c.json({ error: { code: "not_found", message: "no such extension" } }, 404);
    }
    const body: ExtensionReadmeResponse = { name, readme: await registry.readme(name) };
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
