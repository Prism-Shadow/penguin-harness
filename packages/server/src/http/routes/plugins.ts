/**
 * Plugins: the library this build ships, the registry a deployment lists, and what an
 * Agent has installed.
 *   GET    /api/plugins                                   # the built-in library by category (any logged-in user)
 *   GET    /api/plugins/:plugin/files                     # the files a library plugin ships, for the detail view's browser
 *   GET    /api/plugins/registry                          # the deployment's plugin index (plugins.json under the data root)
 *   GET    /api/plugins/registry/readme?name=…            # one indexed entry's long-form readme
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 *   GET    /api/projects/:p/agents/:a/hooks               # installed hook packages (any member)
 *   DELETE /api/projects/:p/agents/:a/hooks/:name         # uninstall one (any member)
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills keep their own routes (skills.ts).
 *
 * Library and registry are two views of one kind of thing — a package of skills and/or
 * hooks. The library is what this build carries; the registry is what the deployment can
 * fetch. Both are deployment-global (no Project check); only installing touches an Agent.
 *
 * The registry merges two sources: the index embedded in this package (the sandbox backends
 * the workspace ships) and the one published by the index repository. The published document
 * is cached, and a failure to reach it is reported alongside the entries rather than emptying
 * the page — see plugin/registry.ts for both rules.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import {
  hooksDir,
  installPlugin,
  listInstalledHooks,
  listInstalledSkills,
  removeHook,
  libraryPlugin,
  loadPluginGroups,
} from "@prismshadow/penguin-core";
import type {
  AgentHooksResponse,
  AgentPluginsInstallResponse,
  PluginFilesResponse,
  PluginIndexResponse,
  PluginLibraryResponse,
  PluginReadmeResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { Config } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import {
  BUILTIN_REGISTRY_SOURCE,
  builtinPluginRegistry,
  cachedRegistry,
  httpPluginRegistry,
  mergeIndexes,
  NIGHTLY_INDEX_URL,
} from "../../plugin/registry.js";
import type { PluginRegistry } from "../../plugin/registry.js";

/** What these route groups reach — bound by their component below. */
export interface PluginsRouteDeps {
  config: ServerConfig;
  access: Access;
  agentConfigService: AgentConfig;
  manager: ManagerIface;
}
import { HttpError } from "../errors.js";
import { badRequest, optionalStringArray, readJson, requireValidId } from "../validate.js";
import {
  pluginFiles,
  resolveLibraryPlugins,
  toHookItem,
  toPluginItem,
  toSkillItem,
} from "../../services/plugin-library.js";

/** Library listing: the files are the source of truth — read fresh on every request (small files, infrequent requests, no caching). */
function libraryResponse(): PluginLibraryResponse {
  return {
    groups: loadPluginGroups().map((group) => ({
      id: group.id,
      title: group.title,
      ...(group.titleZh !== undefined ? { titleZh: group.titleZh } : {}),
      plugins: group.plugins.map(toPluginItem),
    })),
  };
}

/** GET /api/plugins (any logged-in user; no Project check). */
export function pluginLibraryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(libraryResponse()));
  // Everything one plugin ships, as text keyed by path, for the library detail view's file
  // browser (the listing never carries bodies or scripts).
  app.get("/:plugin/files", (c) => {
    const pluginName = c.req.param("plugin");
    const plugin = libraryPlugin(pluginName);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    return c.json({ files: pluginFiles(plugin) } satisfies PluginFilesResponse);
  });
  return app;
}

/** /api/projects/:p/agents/:a/plugins: install is a Project-member operation. */
export function agentPluginsRoutes(deps: PluginsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const names = optionalStringArray(await readJson(c), "names") ?? [];
    if (names.length === 0) throw badRequest("names must be a non-empty array.");
    // Verify every name up front before writing anything: an unknown name rejects the whole
    // request rather than leaving a half-installed state.
    const plugins = resolveLibraryPlugins(names);
    for (const plugin of plugins) {
      await installPlugin(deps.config.root, projectId, agentId, plugin);
    }
    // Hook packages are bound when a core Session is built (skills are read from disk on
    // demand, hooks are not): a runtime cached for this Agent would keep running the old
    // set — or none — until it was evicted, so its next idle access re-resumes it.
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    const [skills, hooks] = await Promise.all([
      listInstalledSkills(deps.config.root, projectId, agentId),
      listInstalledHooks(deps.config.root, projectId, agentId),
    ]);
    return c.json(
      {
        skills: skills.map(toSkillItem),
        hooks: hooks.map(toHookItem),
      } satisfies AgentPluginsInstallResponse,
      201,
    );
  });

  return app;
}

/** /api/projects/:p/agents/:a/hooks: read and uninstall are Project-member operations. */
export function agentHooksRoutes(deps: PluginsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const hooks = await listInstalledHooks(deps.config.root, projectId, agentId);
    return c.json({ hooks: hooks.map(toHookItem) } satisfies AgentHooksResponse);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    // Installed-check uses the same criterion as listInstalledHooks: hooks/<name>/hooks.json exists.
    try {
      await fs.access(
        path.join(hooksDir(deps.config.root, projectId, agentId), name, "hooks.json"),
      );
    } catch {
      throw new HttpError(404, "not_found", `Hook package is not installed: ${name}`);
    }
    await removeHook(deps.config.root, projectId, agentId, name);
    deps.manager.invalidateAgentRuntimes(projectId, agentId);
    return c.body(null, 204);
  });

  return app;
}

/** The plugin library and the Agent-scoped install/uninstall groups, as one route component. */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "PluginRoutes.library", prefix: "/api/plugins", auth: "user", order: 70 },
      {
        id: "PluginRoutes.agent-plugins",
        prefix: "/api/projects/:projectId/agents/:agentId/plugins",
        auth: "user",
        order: 222,
      },
      {
        id: "PluginRoutes.agent-hooks",
        prefix: "/api/projects/:projectId/agents/:agentId/hooks",
        auth: "user",
        order: 224,
      },
    ],
  },
})
export class PluginRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly manager!: ManagerIface;
  @Bind("PluginRoutes.library") libraryRoutes!: Hono<AppEnv>;
  @Bind("PluginRoutes.agent-plugins") pluginRoutes!: Hono<AppEnv>;
  @Bind("PluginRoutes.agent-hooks") hookRoutes!: Hono<AppEnv>;
  setup() {
    const deps = {
      config: this.config,
      access: this.access,
      agentConfigService: this.agentConfig,
      manager: this.manager,
    };
    this.libraryRoutes = pluginLibraryRoutes();
    this.pluginRoutes = agentPluginsRoutes(deps);
    this.hookRoutes = agentHooksRoutes(deps);
  }
}

export interface PluginRoutesOptions {
  /**
   * The published index to read, or null for builtin entries only (see ServerConfig).
   * Undefined = unset, which reads the index repository's published document.
   */
  indexUrl?: string | null;
  /** Overrides the resolved source list entirely; tests pass registries directly. */
  registries?: readonly PluginRegistry[];
  fetchImpl?: typeof fetch;
}

export function pluginRegistryRoutes(options: PluginRoutesOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Built once per App, so the cache outlives a request rather than being rebuilt per page load.
  const registries = options.registries ?? resolveRegistries(options);

  app.get("/", async (c) => {
    const { entries, failures } = await mergeIndexes(registries);
    const body: PluginIndexResponse = { plugins: entries, failures };
    return c.json(body);
  });
  app.get("/readme", async (c) => {
    const name = c.req.query("name");
    if (name === undefined || name === "") {
      return c.json({ error: { code: "bad_request", message: "name is required" } }, 400);
    }
    // Only entries this deployment actually lists: answering for an unlisted name would make
    // the endpoint a probe of what exists.
    const { entries } = await mergeIndexes(registries);
    if (!entries.some((e) => e.name === name)) {
      return c.json({ error: { code: "not_found", message: "no such plugin" } }, 404);
    }
    // First source that has one. Only the builtin registry carries readmes today: the shared
    // index format has no readme location, so a remote source has none to offer.
    for (const registry of registries) {
      const readme = await registry.readme(name).catch(() => null);
      if (readme !== null) {
        const body: PluginReadmeResponse = { name, readme };
        return c.json(body);
      }
    }
    const body: PluginReadmeResponse = { name, readme: null };
    return c.json(body);
  });
  return app;
}

function resolveRegistries(options: PluginRoutesOptions): PluginRegistry[] {
  const builtin = builtinPluginRegistry();
  // Undefined and null part ways here: a runtime that predates the setting publishes nothing
  // and gets the default index, while `off` resolves to null and means builtin entries only.
  const url = options.indexUrl === undefined ? NIGHTLY_INDEX_URL : options.indexUrl;
  if (url === null) return [builtin];
  return [builtin, cachedRegistry(httpPluginRegistry(url, options.fetchImpl ?? fetch))];
}

/** The index the Plugins page reads: deployment-global, like the skill library. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PluginRegistryRoutes.routes",
        prefix: "/api/plugins/registry",
        auth: "user",
        order: 69,
      },
    ],
  },
})
export class PluginRegistryRoutes {
  @Use() private readonly config!: Config;
  @Bind("PluginRegistryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = pluginRegistryRoutes({ indexUrl: this.config.pluginIndexUrl });
  }
}
