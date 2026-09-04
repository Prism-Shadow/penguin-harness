/**
 * Plugin library & Agent-installed hook packages:
 *   GET    /api/plugins                                   # the library by category (any logged-in user)
 *   GET    /api/plugins/:plugin/files                     # the files a plugin ships, for the detail view's browser (any logged-in user)
 *   POST   /api/projects/:p/agents/:a/plugins             # install plugins from the library (any member)
 *   GET    /api/projects/:p/agents/:a/hooks               # installed hook packages (any member)
 *   DELETE /api/projects/:p/agents/:a/hooks/:name         # uninstall one (any member)
 * Installing a plugin writes each of its skills to agent_state/skills/<name>/ and its hook
 * package to agent_state/hooks/<plugin>/ (hooks.json + scripts); reinstalling overwrites with
 * library content (i.e. an update). Installed skills keep their own routes (skills.ts).
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
} from "@prismshadow/penguin-core";
import { libraryPlugin, loadPluginGroups } from "@prismshadow/penguin-core";
import type {
  AgentHooksResponse,
  AgentPluginsInstallResponse,
  PluginFilesResponse,
  PluginLibraryResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { assertNotPinned } from "../pinned.js";
import type { AppDeps } from "../../app.js";
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
export function agentPluginsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    assertNotPinned(deps);
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
export function agentHooksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const hooks = await listInstalledHooks(deps.config.root, projectId, agentId);
    return c.json({ hooks: hooks.map(toHookItem) } satisfies AgentHooksResponse);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    assertNotPinned(deps);
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
