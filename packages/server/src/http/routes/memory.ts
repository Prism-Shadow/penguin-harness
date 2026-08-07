/**
 * Memory routes (`agent_state/memory/`), all Project-member operations:
 *   GET    /api/projects/:p/agents/:a/memory                        # switch + scope groups (user scope first)
 *   POST   /api/projects/:p/agents/:a/memory/template-section        # insert the default # Memory section into the template
 *   GET    /api/projects/:p/agents/:a/memory/scopes/:key/files      # one scope's topic files
 *   GET    …/memory/scopes/:key/files/:name                         # one topic file's content
 *   DELETE …/memory/scopes/:key/files/:name                         # delete + prune its index lines
 *
 * Deliberately read + delete only: content edits go through a chat Session where the model
 * maintains the files and their `MEMORY.md` index together. The `memory.enabled` switch is
 * Agent configuration and lives on PUT …/agents/:a/config.
 *
 * No route accepts an absolute path: a file is addressed by `agentId` + `scopeKey` + a name
 * inside that scope, and MemoryService re-checks that the resolved path stayed inside the
 * Agent's Memory directory.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { pathParam, requireValidId } from "../validate.js";

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

  // The explicit adoption path for a template that predates Memory (idempotent config write).
  app.post("/template-section", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json(await deps.memoryService.insertTemplateSection(projectId, agentId));
  });

  app.get("/scopes/:scopeKey/files", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    return c.json(await deps.memoryService.listFiles(projectId, agentId, key));
  });

  app.get("/scopes/:scopeKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const name = pathParam(c, "fileName");
    return c.json(await deps.memoryService.readFile(projectId, agentId, key, name));
  });

  app.delete("/scopes/:scopeKey/files/:fileName", async (c) => {
    const { projectId, agentId } = scope(c);
    const key = pathParam(c, "scopeKey");
    const name = pathParam(c, "fileName");
    await deps.memoryService.deleteFile(projectId, agentId, key, name);
    return c.body(null, 204);
  });

  return app;
}
