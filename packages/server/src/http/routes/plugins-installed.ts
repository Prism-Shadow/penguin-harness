/**
 * The plugins this deployment installs — what `<root>/plugins.json` lists, and which of them
 * the process actually holds:
 *
 *   GET /api/plugins/installed              the list, joined with what loaded (any logged-in user)
 *   PUT /api/plugins/installed { plugins }  rewrite the list (admin)
 *
 * Installed and ACTIVE are different facts, reported separately. The list is a file the
 * platform reads and writes at any time; loading happens once per process, in the RUNTIME
 * (index.ts `loadPlugins`), so a specifier added here is inert until the server restarts and
 * one removed here keeps serving until then. Saying so is the point of the surface — the
 * alternative is a page that looks like it applied a change that has not happened.
 *
 * Which loaded module belongs to which plugin is answered from the FILES, not from the host:
 * a package declares its module names in its own package.json, and the host (built by the
 * runtime, possibly an older one) offers only the modules themselves. So a listed plugin is
 * active when the modules its package declares are all present.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { InstalledPlugin, InstalledPluginsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { readJson } from "../validate.js";
import type { Config, Hmr } from "../../hmr/capabilities.js";
import {
  PLUGINS_FILE,
  readPluginDeclaration,
  readPluginList,
  writePluginList,
} from "../../plugin/loader.js";
import { pluginHostFrom } from "../../plugin/host.js";

export interface InstalledPluginsDeps {
  root: string;
  /** Every module the process's plugin host holds, by name. */
  loadedModules: () => ReadonlySet<string>;
}

export function installedPluginRoutes(deps: InstalledPluginsDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const view = async (): Promise<InstalledPluginsResponse> => {
    const listed = await readPluginList(deps.root).catch((err: unknown) => {
      throw new HttpError(
        400,
        "invalid_plugins_file",
        err instanceof Error ? err.message : String(err),
      );
    });
    const loaded = deps.loadedModules();
    const plugins: InstalledPlugin[] = [];
    for (const specifier of listed) {
      const declared = await readPluginDeclaration(specifier);
      if ("error" in declared) {
        plugins.push({
          specifier,
          active: false,
          modules: [],
          replaces: [],
          error: declared.error,
        });
        continue;
      }
      const names = [...declared.modules, ...declared.replaces];
      plugins.push({
        specifier,
        // A package that declares nothing cannot be shown as active by its modules; it is
        // installed and contributes nothing, which is what the row then says.
        active: names.length > 0 && names.every((n) => loaded.has(n)),
        modules: declared.modules,
        replaces: declared.replaces,
      });
    }
    return {
      plugins,
      file: PLUGINS_FILE,
      // A listed plugin that is not active loads at the next start; nothing here can load it.
      restartPending: plugins.some((p) => !p.active && p.error === undefined),
    };
  };

  app.get("/", async (c) => c.json(await view()));

  app.put("/", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    const body = await readJson(c);
    const list = body.plugins;
    if (!Array.isArray(list) || list.some((s) => typeof s !== "string" || s.trim() === "")) {
      throw new HttpError(400, "bad_request", "plugins must be an array of package specifiers.");
    }
    await writePluginList(deps.root, [...new Set((list as string[]).map((s) => s.trim()))]);
    return c.json(await view());
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "InstalledPluginRoutes.routes",
        prefix: "/api/plugins/installed",
        auth: "user",
        // Ahead of the catalogue group at /api/plugins, whose "/" would otherwise answer here.
        order: 60,
      },
    ],
  },
})
export class InstalledPluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Bind("InstalledPluginRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const hmr = this.hmr;
    this.routes = installedPluginRoutes({
      root: this.config.root,
      // Claimed per call rather than captured: the host belongs to the process, and a hot
      // swap hands the same one to the next platform.
      loadedModules: () =>
        new Set(
          pluginHostFrom(hmr.resources)
            .modules()
            .map((m: ModuleDef) => m.manifest.name),
        ),
    });
  }
}
