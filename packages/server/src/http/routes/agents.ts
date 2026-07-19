/**
 * Agent routes:
 * GET|POST /api/projects/:p/agents, DELETE /:agentId (owner only).
 * The list is the union of DB entries and directory scan results, including active
 * Session count, total Session count, and config last-modified time.
 */
import { Hono } from "hono";
import type { AgentCreateResponse, AgentsResponse, AgentSummary } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { settleWithin } from "../settle.js";
import { optionalString, readJson, requireString, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

/** Window size in days for the card's activity sparkline (last 30 days, including today). */
const ACTIVITY_DAYS = 30;

export function agentsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation (FD-4): don't rely on the implicit invariant that requireProjectAccess always runs before path construction.
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const items = await deps.agentService.listAgents(projectId);
    const agents: AgentSummary[] = await Promise.all(
      items.map(async (item) => {
        const stats = await deps.sessionService.sessionStats(
          projectId,
          item.agentId,
          ACTIVITY_DAYS,
        );
        return {
          ...item,
          activeSessionCount: deps.manager.activeCountForAgent(projectId, item.agentId),
          sessionCount: stats.sessionCount,
          sessionActivity: stats.activity,
        };
      }),
    );
    return c.json({ agents } satisfies AgentsResponse);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const agentId = requireString(body, "agentId", { label: "agentId" });
    const name = optionalString(body, "name", { minLen: 1, maxLen: 100, label: "name" });
    const description = optionalString(body, "description", {
      maxLen: 2000,
      label: "description",
    });
    const item = await deps.agentService.createAgent(projectId, agentId, name, description);
    const agent: AgentSummary = {
      ...item,
      activeSessionCount: 0,
      sessionCount: 0,
      sessionActivity: Array.from({ length: ACTIVITY_DAYS }, () => 0),
    };
    return c.json({ agent } satisfies AgentCreateResponse, 201);
  });

  app.delete("/:agentId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    // Deletion is a Project-level management operation: owner only.
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    // Mark as deleting and converge active runs (beginAgentDeletion): any new Task during
    // this window gets 409, preventing the race where a new task recreates the directory
    // and revives the Agent between abort and rm. Abort cleanup writes the Trace
    // asynchronously; wait for it to finish before removing the directory, and clear the
    // deleting flag once deletion completes (success or failure).
    const runnings = deps.manager.beginAgentDeletion(projectId, agentId);
    try {
      await settleWithin(runnings, 5000);
      await deps.agentService.deleteAgent(projectId, agentId);
      deps.sessionsRepo.deleteByAgent(projectId, agentId);
    } finally {
      deps.manager.endAgentDeletion(projectId, agentId);
    }
    return c.body(null, 204);
  });

  return app;
}
