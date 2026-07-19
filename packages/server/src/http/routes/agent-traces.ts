/**
 * Agent-level Trace browsing routes:
 *   - GET /api/projects/:p/agents/:a/traces — drills down Agent -> date -> Session -> index (reverse order);
 *   - GET /api/projects/:p/agents/:a/traces/:sessionId/:index (including /analysis) —
 *     read-only Trace detail endpoints (FD-3): locate the Trace file directly by
 *     (projectId, agentId, sessionId), without depending on the sessions table for
 *     tracking — any entry visible in the directory tree (subagent child Sessions,
 *     CLI-created Sessions) can be opened and read; access is enforced by requireProjectAccess.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { paginationQuery, positiveIntParam, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function agentTracesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.traceService.agentTraces(projectId, agentId));
  });

  app.get("/:sessionId/:index", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    const { offset, limit } = paginationQuery(c);
    return c.json(
      await deps.traceService.readEvents(projectId, agentId, sessionId, index, offset, limit),
    );
  });

  app.get("/:sessionId/:index/analysis", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const sessionId = requireValidId(c, "sessionId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const index = positiveIntParam(c, "index");
    return c.json(await deps.traceService.analyze(projectId, agentId, sessionId, index));
  });

  return app;
}
