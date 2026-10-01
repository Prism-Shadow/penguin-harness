/**
 * Plugins: the library this build ships, the user plugin directory an operator installs into,
 * the registry a deployment lists, and what an Agent has installed.
 *   GET    /api/plugins                                   # the built-in library by category (any logged-in user)
 *   GET    /api/plugins/directory                         # the user plugin directory (any logged-in user)
 *   POST   /api/plugins/upload                            # install a plugin from an uploaded zip (admin)
 *   POST   /api/plugins/download                          # install a plugin fetched from a URL (admin)
 *   GET    /api/plugins/:plugin/files                     # the files a library plugin ships, for the detail view's browser
 *   GET    /api/plugins/:plugin/archive                   # export a plugin as a zip (any logged-in user)
 *   DELETE /api/plugins/:plugin                           # uninstall a user plugin (admin)
 *   GET    /api/plugins/registry                          # the merged plugin index: the builtin entries and the published ones
 *   GET    /api/plugins/registry/readme?name=…            # one indexed entry's long-form readme
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 *
 * The import and delete routes write inside the user plugin directory, which is part of the
 * installation rather than of a Project — that is what makes them admin-only (machines.ts is
 * the same call) and what makes them take no projectId. They need no restart and no
 * invalidation of anything: the library is read from disk on every request (core's plugin
 * loader caches nothing), so an imported plugin is in the listing and installable the moment
 * the request returns. A name the build already ships is refused rather than shadowed — the
 * loader would go on serving the built-in — and `overwrite` is what says a same-named *user*
 * plugin may be replaced.
 *
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills and hook packages keep their own routes
 * (skills.ts, hooks.ts).
 *
 * Library and registry are two views of one kind of thing — a package of skills and/or
 * hooks. The library is what this build carries; the registry is what the deployment can
 * fetch. Both are deployment-global (no Project check); only installing touches an Agent.
 */
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  PLUGIN_NAME_PATTERN,
  installPlugin,
  installUserPlugin,
  libraryPlugin,
  listInstalledHooks,
  listInstalledSkills,
  loadPluginGroups,
  removeUserPlugin,
  userPluginInstalled,
  userPluginRoots,
  userPluginsDir,
} from "@prismshadow/penguin-core";
import type {
  AgentPluginsInstallResponse,
  PluginDirectoryResponse,
  PluginFilesResponse,
  PluginImportResponse,
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
import { agentHooksRoutes } from "./hooks.js";
import { builtinPluginRegistry } from "../../plugin/registry.js";
import { pluginBases } from "../../plugin/loader.js";
import type { PluginBase } from "../../plugin/loader.js";

/** What these route groups reach — bound by their component below. */
export interface PluginsRouteDeps {
  config: ServerConfig;
  access: Access;
  agentConfigService: AgentConfig;
  manager: ManagerIface;
}
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import {
  pluginArchiveFiles,
  pluginFiles,
  resolveLibraryPlugins,
  toHookItem,
  toPluginItem,
  toSkillItem,
} from "../../services/plugin-library.js";
import {
  fetchPluginArchive,
  normalizePluginUrl,
  pluginArchiveTooLarge,
} from "../../services/plugin-download.js";
import { assertSafeEntryPath, MAX_ARCHIVE_BYTES } from "./skills.js";
import { unzipBounded } from "../../services/skill-import-limits.js";

/** Library listing: the files are the source of truth — read fresh on every request (small files, infrequent requests, no caching). */
function libraryResponse(root: string): PluginLibraryResponse {
  return {
    groups: loadPluginGroups(root).map((group) => ({
      id: group.id,
      title: group.title,
      ...(group.titleZh !== undefined ? { titleZh: group.titleZh } : {}),
      plugins: group.plugins.map(toPluginItem),
    })),
  };
}

/**
 * The guard on everything that writes the user plugin directory. It is an installation-level
 * resource — every Project reads it, and an installed plugin's hook scripts run with the
 * server's own rights once an Agent runs them — so the capability is the admin's rather than a
 * Project owner's, the way installing to a machine is.
 */
function requireAdmin(c: Context<AppEnv>): void {
  if (!c.var.user.isAdmin) {
    throw new HttpError(403, "admin_required", "Only an admin can manage the plugin directory.");
  }
}

/** A plugin archive decoded and located: the name it installs under, and every file of the plugin root keyed by path relative to it. */
export interface ParsedPluginArchive {
  name: string;
  files: Record<string, Uint8Array>;
}

/**
 * Every entry name in an archive, in central-directory order, without inflating a byte: the
 * filter refuses each entry as it is offered, and fflate stops there. That is what makes the
 * two-pass read above cheap — locating the plugin root costs a directory scan, not an unpack.
 */
function entryNames(archive: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(archive, {
    filter: (entry) => {
      names.push(entry.name);
      return false;
    },
  });
  return names;
}

/** How deep a plugin root path is ("" is the archive root, i.e. depth 0). */
function pathDepth(dir: string): number {
  return dir === "" ? 0 : dir.split("/").length;
}

/**
 * The plugin root inside an archive: the shallowest directory carrying `plugin.json`, which has
 * to be the only directory at that depth — an archive holding two plugins is ambiguous and
 * refused rather than guessed at. `plugin.json` at the archive root is depth 0 and therefore
 * always wins, and everything outside the root is ignored (an archive may carry a README, a
 * LICENSE or a whole monorepo beside the plugin).
 *
 * `subdir` narrows the search to a directory at the end of that path, the way a GitHub tree URL
 * (`…/tree/<ref>/plugins/x`) names one: the archive's own top-level `<repo>-<ref>/` directory is
 * whatever the host wrapped it in, so the match is on the tail, not on the whole path.
 */
function pluginRootIn(paths: readonly string[], subdir: string): string {
  const dirs = new Set<string>();
  for (const filePath of paths) {
    if (filePath !== "plugin.json" && !filePath.endsWith("/plugin.json")) continue;
    const dir = filePath.slice(0, filePath.length - "plugin.json".length).replace(/\/$/, "");
    if (subdir !== "" && dir !== subdir && !dir.endsWith(`/${subdir}`)) continue;
    dirs.add(dir);
  }
  if (dirs.size === 0) {
    throw badRequest(
      subdir === ""
        ? "The archive carries no plugin.json — it is not a plugin."
        : `The archive carries no plugin.json under ${subdir}.`,
    );
  }
  const sorted = [...dirs].sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
  const root = sorted[0]!;
  if (sorted.length > 1 && pathDepth(sorted[1]!) === pathDepth(root)) {
    throw badRequest(
      `The archive carries more than one plugin (${sorted.filter((d) => pathDepth(d) === pathDepth(root)).join(", ")}).`,
    );
  }
  return root;
}

/**
 * Decodes an uploaded or downloaded archive into the files of one plugin. Everything a client
 * supplies is checked here, before a byte is written: the zip's declared sizes through
 * `unzipBounded` (which is where the caps have to be enforced — see that module), every entry
 * path against zip-slip, the plugin root's ambiguity, and the name against the plugin-name
 * rule. Directories the archive declares are skipped: the paths of the files recreate them.
 */
export function parsePluginArchive(
  archive: Buffer,
  options: { name?: string; subdir?: string } = {},
): ParsedPluginArchive {
  // Two passes, because an archive is not necessarily a plugin: a GitHub tree download is a
  // whole repository with one plugin somewhere inside it. The first pass reads the central
  // directory alone — every entry name, nothing inflated — to find the plugin root; the second
  // inflates that root's files only. So the caps bound the PLUGIN (200 files, 5MB each, 20MB
  // total, the same numbers an upload of a single plugin gets) instead of failing on the
  // repository that happens to be wrapped around it, and a hundred-megabyte checkout is never
  // expanded to serve a thirty-file plugin.
  const bytes = new Uint8Array(archive);
  let names: string[];
  try {
    names = entryNames(bytes);
  } catch {
    throw badRequest("The archive is not a valid zip file.");
  }
  if (names.length === 0) throw badRequest("The archive contains no files.");
  const root = pluginRootIn(names, options.subdir ?? "");
  const prefix = root === "" ? "" : `${root}/`;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(bytes, (name) => prefix === "" || name.startsWith(prefix));
  } catch (err) {
    // The caps arrive as 400s of their own; anything else means the bytes are not a zip.
    if (err instanceof HttpError) throw err;
    throw badRequest("The archive is not a valid zip file.");
  }
  const rootFiles: Record<string, Uint8Array> = {};
  for (const [entry, data] of Object.entries(entries)) {
    if (entry.endsWith("/")) continue;
    assertSafeEntryPath(entry);
    rootFiles[entry.slice(prefix.length)] = data;
  }
  // The archive's own layout names the plugin unless the request says otherwise; an archive
  // with plugin.json at its root has no directory to take a name from.
  const name = options.name ?? (root === "" ? undefined : path.basename(root));
  if (name === undefined) {
    throw badRequest("name is required when the archive carries plugin.json at its root.");
  }
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw new HttpError(400, "invalid_plugin", `Not a valid plugin name: ${name}`);
  }
  return { name, files: rootFiles };
}

/**
 * Installs a parsed archive into the user plugin directory and answers what the library now
 * carries. The two refusals come first, before anything is written: a built-in name (the loader
 * would go on serving the built-in, so the import would be invisible), and an existing user
 * plugin without `overwrite` (409 — replacing is an explicit decision, the user's copy may
 * carry local edits).
 *
 * The directory is `<config.root>/plugins`, the same one the library reads: the server's data
 * root and the library's user plugin root are one directory, both defined by PENGUIN_HOME.
 */
async function importPlugin(
  deps: PluginsRouteDeps,
  parsed: ParsedPluginArchive,
  overwrite: boolean,
): Promise<PluginImportResponse> {
  const root = deps.config.root;
  if (libraryPlugin(parsed.name, deps.config.root)?.source === "builtin") {
    throw new HttpError(
      409,
      "plugin_builtin",
      `${parsed.name} is a built-in plugin; it cannot be replaced (import it under another name).`,
    );
  }
  if (!overwrite && (await userPluginInstalled(root, parsed.name))) {
    throw new HttpError(
      409,
      "plugin_exists",
      `A user plugin named ${parsed.name} is already installed.`,
    );
  }
  let plugin;
  try {
    plugin = await installUserPlugin(root, parsed.name, parsed.files);
  } catch (err) {
    throw new HttpError(
      400,
      "invalid_plugin",
      `The plugin could not be installed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    plugin: toPluginItem(plugin),
    path: path.join(userPluginsDir(root), parsed.name),
  };
}

/** GET /api/plugins (any logged-in user; no Project check). */
export function pluginLibraryRoutes(deps: PluginsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(libraryResponse(deps.config.root)));

  // The user plugin directory itself: its absolute path and what is in it. Readable by anyone
  // logged in — the library listing shows the same plugins, and this only adds where they live
  // — because the management line on the plugins page is not an admin's screen.
  app.get("/directory", (c) =>
    c.json({
      path: userPluginsDir(deps.config.root),
      plugins: [...userPluginRoots(deps.config.root).keys()],
    } satisfies PluginDirectoryResponse),
  );

  // Install one plugin from an uploaded zip (admin). The body carries the archive base64 —
  // the same shape the skill and hook archive routes take — so the request stays JSON
  // throughout and needs no multipart handling.
  app.post("/upload", async (c) => {
    requireAdmin(c);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, label: "dataBase64" });
    const archive = Buffer.from(dataBase64, "base64");
    if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
    // The same answer the download path gives (413 `plugin_too_large`), at the cap the transport
    // allows: this one arrives as base64 inside a JSON body, so it is the skill/hook archive
    // limit — which is exactly what keeps the encoded request inside the body cap.
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw pluginArchiveTooLarge(MAX_ARCHIVE_BYTES);
    }
    const requestedName = optionalString(body, "name", { maxLen: 128 });
    const parsed = parsePluginArchive(archive, {
      ...(requestedName !== undefined ? { name: requestedName } : {}),
    });
    return c.json(
      await importPlugin(deps, parsed, optionalBoolean(body, "overwrite") ?? false),
      201,
    );
  });

  // Install one plugin from a URL the operator names (admin). The whole download runs
  // server-side: the server is what has the network position to reach it, and the archive is
  // validated by the same parser the upload route uses, whichever way the bytes arrived.
  app.post("/download", async (c) => {
    requireAdmin(c);
    const body = await readJson(c);
    const url = requireString(body, "url", { minLen: 1, maxLen: 2048 });
    const requestedName = optionalString(body, "name", { maxLen: 128 });
    const requestedSubdir = optionalString(body, "subdir", { maxLen: 512 });
    const source = normalizePluginUrl(url);
    const archive = await fetchPluginArchive(source);
    if (archive.byteLength === 0) throw badRequest("The download is empty.");
    // What the request says wins over what the URL suggests: a name is what the operator asked
    // for, a suggestion is what the host happened to call it.
    const name = requestedName ?? source.name;
    const parsed = parsePluginArchive(archive, {
      ...(name !== undefined ? { name } : {}),
      subdir: requestedSubdir ?? source.subdir,
    });
    return c.json(
      await importPlugin(deps, parsed, optionalBoolean(body, "overwrite") ?? false),
      201,
    );
  });

  // Everything one plugin ships, as text keyed by path, for the library detail view's file
  // browser (the listing never carries bodies or scripts).
  app.get("/:plugin/files", (c) => {
    const pluginName = c.req.param("plugin");
    const plugin = libraryPlugin(pluginName, deps.config.root);
    if (!plugin) {
      throw new HttpError(404, "unknown_plugin", `Plugin is not in the library: ${pluginName}`);
    }
    return c.json({ files: pluginFiles(plugin) } satisfies PluginFilesResponse);
  });

  // Export one plugin as a zip (any logged-in user — it is the content the detail view already
  // shows, packed for a round trip out). Built-in and user plugins export the same way: the
  // archive is rebuilt from the library's own view of the plugin, so what comes back in is what
  // went out.
  app.get("/:plugin/archive", (c) => {
    const plugin = libraryPlugin(c.req.param("plugin"), deps.config.root);
    if (!plugin) {
      throw new HttpError(
        404,
        "unknown_plugin",
        `Plugin is not in the library: ${c.req.param("plugin")}`,
      );
    }
    const archiveFiles: Record<string, Uint8Array> = {};
    for (const [rel, text] of Object.entries(pluginArchiveFiles(plugin))) {
      archiveFiles[rel] = strToU8(text);
    }
    const zip = zipSync(archiveFiles);
    // The name is the plugin name (validated on the way in, [A-Za-z0-9_-]+), so it is itself
    // when encoded; scripts.ts reads the file name off Content-Disposition.
    const fileName =
      plugin.version === "" ? `${plugin.name}.zip` : `${plugin.name}-v${plugin.version}.zip`;
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  // Uninstall one user plugin (admin): the directory is deleted from disk, so the library stops
  // listing it. A built-in is refused (409) — its files belong to the installation — and a name
  // that is not there at all is a 404 rather than a silent no-op.
  app.delete("/:plugin", async (c) => {
    requireAdmin(c);
    const pluginName = c.req.param("plugin");
    if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
      throw new HttpError(404, "unknown_plugin", `No such plugin: ${pluginName}`);
    }
    if (libraryPlugin(pluginName, deps.config.root)?.source === "builtin") {
      throw new HttpError(409, "plugin_builtin", `${pluginName} is a built-in plugin.`);
    }
    if (!(await removeUserPlugin(deps.config.root, pluginName))) {
      throw new HttpError(404, "unknown_plugin", `No user plugin named ${pluginName}`);
    }
    return c.body(null, 204);
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
    const plugins = resolveLibraryPlugins(names, deps.config.root);
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
    this.libraryRoutes = pluginLibraryRoutes(deps);
    this.pluginRoutes = agentPluginsRoutes(deps);
    this.hookRoutes = agentHooksRoutes(deps);
  }
}

export function pluginRegistryRoutes(bases: () => readonly PluginBase[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = builtinPluginRegistry(bases);
  app.get("/", async (c) => {
    const body: PluginIndexResponse = { plugins: await registry.index() };
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
      return c.json({ error: { code: "not_found", message: "no such plugin" } }, 404);
    }
    const body: PluginReadmeResponse = { name, readme: await registry.readme(name) };
    return c.json(body);
  });
  return app;
}

/**
 * The registry the Plugins page reads beside the built-in library: deployment-global, and
 * nested under /api/plugins/registry so both views answer under one prefix. The specifier
 * is a query parameter on `readme`, not a path segment, because it is scoped
 * (`@scope/name`) and would otherwise have to survive two rounds of slash encoding.
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
})
export class PluginRegistryRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly hmr!: Hmr;
  @Bind("PluginRegistryRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    // Read per request: a push moves the shipped prefix to a new assets directory.
    this.routes = pluginRegistryRoutes(() => pluginBases(this.config.root, this.hmr.assetsDir()));
  }
}
