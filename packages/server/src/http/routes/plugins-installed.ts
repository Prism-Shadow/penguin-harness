/**
 * The plugins this deployment installs — what `<root>/plugins.json` lists, and which of them
 * the process actually holds:
 *
 *   GET  /api/plugins/installed                 the list, joined with what loaded (any member)
 *   POST /api/plugins/installed { specifier }   npm-install the package, then list it (admin)
 *   PUT  /api/plugins/installed { plugins }     rewrite the list itself (admin)
 *   DELETE /api/plugins/installed?specifier=…   drop it from the list and from disk (admin)
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
  discoverBuiltinPlugins,
  PLUGINS_FILE,
  pluginBases,
  readPluginDeclaration,
  readPluginList,
  writePluginList,
} from "../../plugin/loader.js";
import {
  installPluginPackage,
  PluginInstallError,
  removePluginPackage,
} from "../../plugin/install.js";
import { pluginHostFrom } from "../../plugin/host.js";

export interface InstalledPluginsDeps {
  root: string;
  /** The current version's assets, where the builtin plugins a push carried live. */
  assetsDir: () => string | null;
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
    const bases = pluginBases(deps.root, deps.assetsDir());
    // Builtins first, then the listed ones — the same order the loader loads them in, and a
    // listed builtin appears once, as builtin.
    const builtin = await discoverBuiltinPlugins(bases);
    const plugins: InstalledPlugin[] = [];
    for (const specifier of [...new Set([...builtin, ...listed])]) {
      const declared = await readPluginDeclaration(specifier, bases);
      if ("error" in declared) {
        plugins.push({
          specifier,
          active: false,
          builtin: false,
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
        builtin: declared.builtin,
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

  const requireAdmin = (c: { var: AppEnv["Variables"] }) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
  };

  /** A package specifier, optionally with a version range — never a path or a URL. */
  const specifierOf = (value: unknown): string => {
    const s = typeof value === "string" ? value.trim() : "";
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s/]+)?$/.test(s)) {
      throw new HttpError(400, "bad_request", "specifier must be an npm package name.");
    }
    return s;
  };

  app.post("/", async (c) => {
    requireAdmin(c);
    const specifier = specifierOf((await readJson(c)).specifier);
    // The package first, the list second: a listed plugin that is not on disk is exactly the
    // state this route exists to avoid, and npm failing must leave the deployment unchanged.
    try {
      await installPluginPackage(deps.root, specifier);
    } catch (err) {
      if (err instanceof PluginInstallError) {
        throw new HttpError(400, "plugin_install_failed", `npm: ${err.message}`);
      }
      throw err;
    }
    // `pkg@1.2.3` installs that version but is LISTED by name: the list names what to load,
    // and a pinned range in it would be read as part of the package name at load time.
    const at = specifier.lastIndexOf("@");
    const name = at > 0 ? specifier.slice(0, at) : specifier;
    const listed = await readPluginList(deps.root);
    if (!listed.includes(name)) await writePluginList(deps.root, [...listed, name]);
    return c.json(await view());
  });

  app.delete("/", async (c) => {
    requireAdmin(c);
    const specifier = specifierOf(c.req.query("specifier"));
    const listed = await readPluginList(deps.root);
    await writePluginList(
      deps.root,
      listed.filter((s) => s !== specifier),
    );
    // The package goes too: leaving it on disk would keep a removed plugin loadable by a
    // hand-edited list, and the prefix is the harness's to keep tidy.
    await removePluginPackage(deps.root, specifier);
    return c.json(await view());
  });

  app.put("/", async (c) => {
    requireAdmin(c);
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
      assetsDir: () => hmr.assetsDir(),
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
