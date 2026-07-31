/**
 * Workspace Memory routes (`agent_state/memory/`), all Project-member operations:
 *   GET    /api/projects/:p/agents/:a/memory                             # switch, index, Workspace groups
 *   GET|PUT /api/projects/:p/agents/:a/memory/index                      # the shared memory/AGENTS.md
 *   GET    /api/projects/:p/agents/:a/memory/workspaces/:key/files       # one Workspace's topic files
 *   GET|PUT|DELETE …/memory/workspaces/:key/files/:name                  # one topic file
 *   POST   …/memory/workspaces/:key/files/:name/rename                   # rename within the Workspace
 *
 * No route accepts an absolute path: a file is addressed by `agentId` + `workspaceKey` + a name
 * inside that Workspace, and MemoryService re-checks that the resolved path stayed inside the
 * Agent's Memory directory.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { pathParam, readJson, requireString, requireValidId } from "../validate.js";

export function memoryRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Shared preamble: id validation before any path construction (FD-4), then the Project membership check. */
  const scope = (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return { projectId, agentId };
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json(await deps.memoryService.overview(projectId, agentId));
  });

  app.get("/index", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json(await deps.memoryService.readIndex(projectId, agentId));
  });

  app.put("/index", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = await readJson(c);
    const content = requireString(body, "content", { minLen: 0, label: "content" });
    return c.json(await deps.memoryService.writeIndex(projectId, agentId, content));
  });

  app.get("/workspaces/:workspaceKey/files", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "workspaceKey");
    return c.json(await deps.memoryService.listFiles(projectId, agentId, key));
  });

  app.get("/workspaces/:workspaceKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "workspaceKey");
    const name = pathParam(c, "fileName");
    return c.json(await deps.memoryService.readFile(projectId, agentId, key, name));
  });

  app.put("/workspaces/:workspaceKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "workspaceKey");
    const name = pathParam(c, "fileName");
    const body = await readJson(c);
    const content = requireString(body, "content", { minLen: 0, label: "content" });
    return c.json(await deps.memoryService.writeFile(projectId, agentId, key, name, content));
  });

  app.post("/workspaces/:workspaceKey/files/:fileName/rename", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "workspaceKey");
    const name = pathParam(c, "fileName");
    const body = await readJson(c);
    const next = requireString(body, "name", { minLen: 1, maxLen: 200, label: "name" });
    return c.json(await deps.memoryService.renameFile(projectId, agentId, key, name, next));
  });

  app.delete("/workspaces/:workspaceKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "workspaceKey");
    const name = pathParam(c, "fileName");
    await deps.memoryService.deleteFile(projectId, agentId, key, name);
    return c.body(null, 204);
  });

  return app;
}
