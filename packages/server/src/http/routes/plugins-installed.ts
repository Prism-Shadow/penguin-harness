/**
 * The plugins a PROJECT asks for, and which of them this process is actually running:
 *
 *   GET    /                      this Project's list, joined with what loaded (any member)
 *   GET    /?shipped=1             …plus which plugins the build ships (a tag)
 *   POST   / { specifier }        npm-install the package if the build does not ship it,
 *                                 add it to this Project's list, and apply (admin)
 *   PUT    / { plugins }          rewrite this Project's list, and apply (admin)
 *   DELETE /?specifier=…          drop it from this Project's list, and apply (admin)
 *
 * WHERE THE LIST LIVES. In the Project's own config (`plugins` in `.project_config.toml`),
 * beside its models — because machines are lent to Projects, so a Project's list is what
 * says which machines a plugin has to reach (PRFC-0010). The data root's old `plugins.json`
 * is not read any more, deliberately without a migration: a deployment that had one starts
 * with no plugins until each Project asks again.
 *
 * WHAT ACTUALLY RUNS is the CLOSURE — the union over this root's Projects — because loading
 * is per process: there is one module tree. So a plugin any Project asks for is in the tree,
 * and what it contributes is visible to all of them. A row here is therefore "this Project
 * asked for it" joined with "the process has it", which are two different facts.
 *
 * APPLYING. A write re-reads the closure, rebuilds the plugin host, and asks the runtime to
 * re-assemble the App from the same bundle — no process restart, ptys and connections
 * delivered across it exactly as a push delivers them. A runtime too old to offer that
 * (`hmr.reload` absent) leaves the list written and `restartPending` true, which is the
 * behavior this route had before it could apply anything.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef, Resources } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { InstalledPlugin, InstalledPluginsResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { readJson, requireValidId } from "../validate.js";
import type { Config, Hmr } from "../../hmr/capabilities.js";
import {
  discoverBuiltinPlugins,
  loadPlugins,
  PLUGINS_FILE,
  pluginBases,
  readPluginClosure,
  readPluginDeclaration,
} from "../../plugin/loader.js";
import {
  installPluginPackage,
  PluginInstallError,
  removePluginPackage,
} from "../../plugin/install.js";
import { PluginHost, pluginHostFrom, PLUGINS_RESOURCE_ID } from "../../plugin/host.js";
import { Access, ProjectConfigStore } from "../../mechanisms/projects.js";
import type { Machines } from "../../machines/service.js";

export interface InstalledPluginsDeps {
  root: string;
  /** The current version's assets, where the builtin plugins a push carried live. */
  assetsDir: () => string | null;
  /** Every module the process's plugin host holds, by name. */
  loadedModules: () => ReadonlySet<string>;
  projectConfig: ProjectConfigStore;
  access: Access;
  /**
   * Re-reads the closure into a fresh plugin host and re-assembles the App. Answers whether
   * the running tree is the new one; false when the runtime cannot re-assemble at all.
   */
  apply: () => Promise<boolean>;
  /**
   * Hands this Project's list to the machines it uses, strict parity. Not awaited: the
   * person editing is not the one who should wait for a set of ssh tunnels — the same rule
   * the model config changes under.
   */
  syncFleet: (projectId: string) => void;
}

export function installedPluginRoutes(deps: InstalledPluginsDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const scope = (c: {
    req: { param(n: string): string | undefined };
    var: AppEnv["Variables"];
  }) => {
    const projectId = requireValidId(c as never, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return projectId;
  };

  const view = async (projectId: string): Promise<InstalledPluginsResponse> => {
    const listed = await deps.projectConfig.getPlugins(projectId).catch((err: unknown) => {
      // A Project whose config will not parse cannot be answered for — its models are just
      // as unreadable — and saying "no plugins" would read as a healthy empty deployment.
      throw new HttpError(
        400,
        "invalid_plugins_file",
        `${projectId}: ${PLUGINS_FILE} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    const loaded = deps.loadedModules();
    const bases = pluginBases(deps.root, deps.assetsDir());
    // Exactly what this Project lists: a plugin the build ships is not asked for until a
    // Project says so. `builtin` on a row is where the package CAME FROM, a tag, not a
    // second way of being asked for.
    const plugins: InstalledPlugin[] = [];
    for (const specifier of listed) {
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
        // asked for and contributes nothing, which is what the row then says.
        active: names.length > 0 && names.every((n) => loaded.has(n)),
        builtin: declared.builtin,
        modules: declared.modules,
        replaces: declared.replaces,
      });
    }
    return {
      plugins,
      // What the build ships, asked for or not: the catalogue marks these rows "built in",
      // and asking for one is a list edit rather than a download.
      shipped: await discoverBuiltinPlugins(bases),
      file: PLUGINS_FILE,
      // A listed plugin that is not active and did not fail to resolve is waiting for a
      // runtime that can re-assemble the App — otherwise applying already loaded it.
      restartPending: plugins.some((p) => !p.active && p.error === undefined),
    };
  };

  app.get("/", async (c) => c.json(await view(scope(c))));

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
    const projectId = scope(c);
    const specifier = specifierOf((await readJson(c)).specifier);
    // A plugin the build ships is already on the machine: asking for it is consent, not a
    // download. Everything else goes through npm — the package first, the list second, since
    // a listed plugin that is not on disk is exactly the state this route exists to avoid,
    // and npm failing must leave the deployment unchanged.
    const shipped = await discoverBuiltinPlugins(pluginBases(deps.root, deps.assetsDir()));
    if (!shipped.includes(specifier)) {
      try {
        await installPluginPackage(deps.root, specifier);
      } catch (err) {
        if (err instanceof PluginInstallError) {
          throw new HttpError(400, "plugin_install_failed", `npm: ${err.message}`);
        }
        throw err;
      }
    }
    // `pkg@1.2.3` installs that version but is LISTED by name: the list names what to load,
    // and a pinned range in it would be read as part of the package name at load time.
    const at = specifier.lastIndexOf("@");
    const name = at > 0 ? specifier.slice(0, at) : specifier;
    const listed = await deps.projectConfig.getPlugins(projectId);
    if (!listed.includes(name)) await deps.projectConfig.setPlugins(projectId, [...listed, name]);
    await deps.apply();
    deps.syncFleet(projectId);
    return c.json(await view(projectId));
  });

  app.delete("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const specifier = specifierOf(c.req.query("specifier"));
    const listed = await deps.projectConfig.getPlugins(projectId);
    await deps.projectConfig.setPlugins(
      projectId,
      listed.filter((s) => s !== specifier),
    );
    await deps.apply();
    deps.syncFleet(projectId);
    // The package goes too — but only once NO Project asks for it. The prefix is the
    // harness's to keep tidy; removing it while another Project still lists it would break
    // that Project at the next load.
    if (!(await readPluginClosure(deps.root)).includes(specifier)) {
      await removePluginPackage(deps.root, specifier);
    }
    return c.json(await view(projectId));
  });

  app.put("/", async (c) => {
    requireAdmin(c);
    const projectId = scope(c);
    const body = await readJson(c);
    const list = body.plugins;
    if (!Array.isArray(list) || list.some((s) => typeof s !== "string" || s.trim() === "")) {
      throw new HttpError(400, "bad_request", "plugins must be an array of package specifiers.");
    }
    await deps.projectConfig.setPlugins(projectId, [
      ...new Set((list as string[]).map((s) => s.trim())),
    ]);
    await deps.apply();
    return c.json(await view(projectId));
  });

  return app;
}

/**
 * Re-reads the closure into a fresh plugin host and asks the runtime to re-assemble the App.
 *
 * Two halves, and both are needed: the host is what the next tree claims (plugin/host.ts), so
 * it is registered before the re-assembly, which is what makes a tree out of it.
 *
 * A RE-ASSEMBLY THAT DOES NOT HAPPEN PUTS THE HOST BACK. The host is also where every
 * surface reads "which plugin modules does this process have" from, so leaving a rebuilt one
 * in place after a failed (or unsupported) reload would report plugins as active that no
 * running tree contains — the list would claim it applied and `restartPending` would say
 * false, on a deployment that needs exactly that restart. Found on a live runtime too old to
 * offer `reload`: the languages plugin read as active while the languages endpoint still
 * served none.
 */
export async function applyPluginClosure(root: string, hmr: Hmr): Promise<boolean> {
  const host = new PluginHost();
  const result = await loadPlugins(root);
  for (const entry of result.loaded) {
    try {
      host.use(entry);
    } catch (err) {
      result.failed.set(entry.specifier, err instanceof Error ? err.message : String(err));
    }
  }
  for (const [specifier, reason] of result.failed) {
    console.warn(`[plugins] skipped ${specifier}: ${reason}`);
  }
  const resources = hmr.resources as Resources;
  const previous = pluginHostFrom(resources);
  resources.register(PLUGINS_RESOURCE_ID, host);
  const applied = (await hmr.reload?.()) ?? false;
  if (!applied) resources.register(PLUGINS_RESOURCE_ID, previous);
  return applied;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "InstalledPluginRoutes.routes",
        prefix: "/api/projects/:projectId/plugins/installed",
        auth: "user",
        // Ahead of the catalogue group, whose "/" would otherwise answer here.
        order: 60,
      },
    ],
  },
})
export class InstalledPluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly access!: Access;
  @Use() private readonly machines!: Machines;
  @Bind("InstalledPluginRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    const hmr = this.hmr;
    const root = this.config.root;
    this.routes = installedPluginRoutes({
      root,
      assetsDir: () => hmr.assetsDir(),
      // Claimed per call rather than captured: the host belongs to the process, and a hot
      // swap hands the same one to the next platform.
      loadedModules: () =>
        new Set(
          pluginHostFrom(hmr.resources)
            .modules()
            .map((m: ModuleDef) => m.manifest.name),
        ),
      projectConfig: this.projectConfig,
      access: this.access,
      apply: () => applyPluginClosure(root, hmr),
      // The plugin list rides the same trip the model config takes to a Project's machines.
      syncFleet: (projectId) => void this.machines.syncModelsEverywhere(projectId),
    });
  }
}
