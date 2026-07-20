/**
 * Agent config routes (reads/writes system_config.yaml and AGENTS.md):
 * GET|PUT /api/projects/:p/agents/:a/config. Members can read and write (unrestricted).
 */
import { Hono } from "hono";
import type { AgentConfigResponse, AgentConfigUpdateRequest } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalString, readJson, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function agentConfigRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Id validation happens before any path construction (FD-4: prevents agentId path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  app.put("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const req: AgentConfigUpdateRequest = {};
    const agentsMd = optionalString(body, "agentsMd", { label: "agentsMd" });
    if (agentsMd !== undefined) req.agentsMd = agentsMd;
    if (body.config !== undefined) {
      if (body.config === null || typeof body.config !== "object" || Array.isArray(body.config)) {
        throw badRequest("config must be an object.");
      }
      req.config = body.config as AgentConfigUpdateRequest["config"];
    }
    // Fine-grained validation (numeric ranges / enums) is done inside agent-config-service.
    await deps.agentConfigService.updateConfig(projectId, agentId, req);
    const view = await deps.agentConfigService.getConfig(projectId, agentId);
    return c.json({
      ...view,
      activeSessionCount: deps.manager.activeCountForAgent(projectId, agentId),
    } satisfies AgentConfigResponse);
  });

  return app;
}
