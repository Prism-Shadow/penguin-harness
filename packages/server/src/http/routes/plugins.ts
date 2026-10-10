/**
 * Plugins: the library this build ships, the registry a deployment lists, and what an
 * Agent has installed.
 *   GET    /api/plugins                                   # the built-in library by category (any logged-in user)
 *   GET    /api/plugins/:plugin/files                     # the files a library plugin ships, for the detail view's browser
 *   GET    /api/plugins/:plugin/readme                    # a library plugin's README.md, from its package root (404 without one)
 *   GET    /api/plugins/:plugin/archive                   # a library plugin's package as a zip, for another server to import
 *   GET    /api/plugins/registry                          # the merged plugin index: the builtin entries, the published ones, and the server modules an admin installed from a link or a zip
 *   GET    /api/plugins/registry/readme?name=…            # one listed entry's long-form readme
 *   GET    /api/plugins/registry/archive?name=…           # one listed package on this server, as a zip
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills and hook packages keep their own routes
 * (skills.ts, hooks.ts).
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
import { Hono } from "hono";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  installPlugin,
  listInstalledHooks,
  listInstalledSkills,
  libraryPlugin,
  libraryPluginPackage,
  libraryPluginReadme,
  loadPluginGroups,
  parsePluginPackage,
} from "@prismshadow/penguin-core";
import type { PluginPackageManifest } from "@prismshadow/penguin-core";
import type {
  AgentPluginsInstallResponse,
  PluginFilesResponse,
  PluginIndexEntry,
  PluginIndexResponse,
  PluginLibraryResponse,
  PluginReadmeResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { Config, Hmr } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import type { Sessions as ManagerIface } from "../../runtime/session-manager.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Json } from "@prismshadow/penguin-core/kernel";
import { agentHooksRoutes } from "./hooks.js";
import {
  BUILTIN_REGISTRY_SOURCE,
  builtinPluginRegistry,
  cachedRegistry,
  httpPluginRegistry,
  localPluginDisplay,
  mergeIndexes,
  withoutIcon,
  NIGHTLY_INDEX_URL,
} from "../../plugin/registry.js";
import type { CachedRegistry, IndexSnapshot, PluginRegistry } from "../../plugin/registry.js";
import { PACKAGE_NAME, pluginBases, resolvePluginPackage } from "../../plugin/loader.js";
import type { PluginBase } from "../../plugin/loader.js";
import { installedPackageDir, pluginsPrefix, prefixDependencies } from "../../plugin/install.js";
import {
  pluginArchiveResponse,
  unscopedName,
  zipPluginPackage,
} from "../../services/plugin-archive.js";

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
  // The package's own README.md, for the detail dialog's description section — the file npm
  // shipped with the package, never a copy. Separate from the files above, which are what an
  // install writes into an Agent; a readme is about the package, and none of it is installed.
  app.get("/:plugin/readme", (c) => {
    const pluginName = c.req.param("plugin");
    const readme = libraryPluginReadme(pluginName);
    if (readme === undefined) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    if (readme === null) {
      throw new HttpError(404, "readme_not_found", `Plugin ${pluginName} ships no README.md`);
    }
    return c.json({ name: pluginName, readme } satisfies PluginReadmeResponse);
  });
  // The package as a zip — its directory as npm has it, without node_modules — which another
  // server's admin imports as it is. Any member: it is what the library already shows.
  app.get("/:plugin/archive", async (c) => {
    const pluginName = c.req.param("plugin");
    const pkg = libraryPluginPackage(pluginName);
    if (pkg === undefined) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    const zip = await zipPluginPackage(pkg.dir, unscopedName(pkg.packageName));
    return pluginArchiveResponse(zip, pkg.packageName, pkg.version);
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
    // Core reads hook packages when a model context opens: a conversation that is running
    // would keep the old set — or none — until its next compaction. Rebuilding the runtime
    // re-reads them on its next idle access, so the plugin works from the next Task.
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
  /** Where packages are on this machine (plugin/loader.ts's pluginBases): for the builtin readmes, and for every listed package's own display fields (localPluginDisplay). */
  bases?: () => readonly PluginBase[];
  /** Overrides the resolved source list entirely; tests pass registries directly. */
  registries?: readonly PluginRegistry[];
  fetchImpl?: typeof fetch;
  /** The published index as the previous App last fetched it (see PluginRegistryRoutes.park). */
  seed?: IndexSnapshot | null;
  /** Receives the published index's cache, so its document can be parked. */
  onCache?: (cache: CachedRegistry) => void;
  /** This server's plugin prefix (`<root>/plugins`), whose server modules from a link or a zip the listing adds; none without it. */
  prefix?: () => string | null;
}

/**
 * The server modules an admin installed from a link or a zip: packages of the prefix carrying
 * an `ifaces.json` that no index lists. Their row is their own package.json's npm fields, read
 * by core's manifest reader; the listing then lets the package describe itself further (its
 * `penguin` block and its icon), as it does every package on this machine. A package.json that
 * will not read lists no row.
 */
async function prefixEntries(
  prefix: string | null,
  listed: ReadonlySet<string>,
): Promise<PluginIndexEntry[]> {
  if (prefix === null) return [];
  const entries: PluginIndexEntry[] = [];
  for (const name of Object.keys(await prefixDependencies(prefix)).sort()) {
    if (listed.has(name) || !PACKAGE_NAME.test(name)) continue;
    const dir = installedPackageDir(prefix, name);
    if (!existsSync(path.join(dir, "ifaces.json"))) continue;
    const file = path.join(dir, "package.json");
    let manifest: PluginPackageManifest;
    try {
      manifest = parsePluginPackage(JSON.parse(await fs.readFile(file, "utf8")), file).manifest;
    } catch {
      continue;
    }
    entries.push({
      name,
      version: manifest.version,
      description: manifest.description,
      authors: manifest.author === undefined ? [] : [manifest.author],
      license: manifest.license ?? "",
      ...(manifest.repository !== undefined ? { repository: manifest.repository } : {}),
      ...(manifest.homepage !== undefined ? { homepage: manifest.homepage } : {}),
      ...(manifest.keywords.length > 0 ? { keywords: manifest.keywords } : {}),
    });
  }
  return entries;
}

export function pluginRegistryRoutes(options: PluginRoutesOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // Built once per App, so the cache outlives a request rather than being rebuilt per page load.
  const registries = options.registries ?? resolveRegistries(options);
  const bases = options.bases ?? (() => []);
  const prefix = options.prefix ?? (() => null);

  /** Every entry this deployment lists: the indexes' and the prefix's own server modules. */
  const listing = async () => {
    const { entries, failures } = await mergeIndexes(registries);
    const own = await prefixEntries(prefix(), new Set(entries.map((e) => e.name)));
    return { entries: [...entries, ...own], failures };
  };

  app.get("/", async (c) => {
    const { entries, failures } = await listing();
    // A package on this machine describes itself: its own package.json `penguin` block and icon
    // win over what an index row says, so an installed package's card shows its icon and both
    // languages even where its index row carries neither.
    const here = bases();
    const plugins = await Promise.all(
      entries.map(async (entry) => ({ ...entry, ...(await localPluginDisplay(entry.name, here)) })),
    );
    const body: PluginIndexResponse = { plugins, failures };
    return c.json(body);
  });
  app.get("/readme", async (c) => {
    const name = c.req.query("name");
    if (name === undefined || name === "") {
      return c.json({ error: { code: "bad_request", message: "name is required" } }, 400);
    }
    // Only entries this deployment actually lists, by a package name (an index row's name is
    // not trusted to be one): answering for anything else would make the endpoint a probe of
    // what exists, or of what a path above a prefix holds.
    const { entries } = await listing();
    if (!PACKAGE_NAME.test(name) || !entries.some((e) => e.name === name)) {
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
  // A listed package on this server as a zip, for another server to import: the same listing
  // rule as the readme, and only what is here — the package as npm installed or shipped it.
  app.get("/archive", async (c) => {
    const name = c.req.query("name");
    if (name === undefined || name === "") {
      throw new HttpError(400, "bad_request", "name is required");
    }
    const { entries } = await listing();
    if (!PACKAGE_NAME.test(name) || !entries.some((e) => e.name === name)) {
      throw new HttpError(404, "not_found", "no such plugin");
    }
    const found = resolvePluginPackage(name, bases());
    if (found === null) {
      throw new HttpError(
        404,
        "plugin_not_here",
        `${name} is not on this server: install it to export it.`,
      );
    }
    let version = "";
    try {
      const raw = JSON.parse(await fs.readFile(found.manifest, "utf8")) as { version?: unknown };
      version = typeof raw.version === "string" ? raw.version : "";
    } catch {
      // A package.json that will not parse still zips; the file name goes without a version.
    }
    const zip = await zipPluginPackage(found.dir, unscopedName(name));
    return pluginArchiveResponse(zip, name, version);
  });
  return app;
}

function resolveRegistries(options: PluginRoutesOptions): PluginRegistry[] {
  const builtin = builtinPluginRegistry(options.bases);
  // Undefined and null part ways here: a runtime that predates the setting publishes nothing
  // and gets the default index, while `off` resolves to null and means builtin entries only.
  const url = options.indexUrl === undefined ? NIGHTLY_INDEX_URL : options.indexUrl;
  if (url === null) return [builtin];
  // The parked document goes through the remote rule too: it was fetched by a previous App,
  // which may not have dropped the icons.
  const seed = options.seed ?? null;
  const cache = cachedRegistry(httpPluginRegistry(url, { fetchImpl: options.fetchImpl ?? fetch }), {
    seed: seed === null ? null : { at: seed.at, entries: seed.entries.map(withoutIcon) },
  });
  options.onCache?.(cache);
  return [builtin, cache];
}

/**
 * The index the Plugins page reads: deployment-global, like the skill library. The published
 * document rides the swap: the successor's cache starts from what the last App fetched, so
 * a refresh that fails right after a push still lists what was known instead of reporting
 * the source unreachable.
 */
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
  context: {
    version: 1,
    schema: { "index?": { at: "number", entries: "unknown[]" } },
  },
})
export class PluginRegistryRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Bind("PluginRegistryRoutes.routes") routes!: Hono<AppEnv>;
  private cache: CachedRegistry | null = null;
  setup(_ctx: ClassCtx, context: Json) {
    const parked = (context as { index?: IndexSnapshot } | null)?.index;
    this.routes = pluginRegistryRoutes({
      indexUrl: this.config.pluginIndexUrl,
      // Read per request: a push moves the shipped prefix to a new assets directory.
      bases: () => pluginBases(this.config.root, this.hmr.assetsDir()),
      prefix: () => pluginsPrefix(this.config.root),
      seed: parked ?? null,
      onCache: (cache) => {
        this.cache = cache;
      },
    });
  }

  park(): Json {
    const index = this.cache?.snapshot() ?? null;
    return index === null ? null : ({ index } as unknown as Json);
  }
}
