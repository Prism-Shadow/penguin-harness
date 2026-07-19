/**
 * Usage statistics routes:
 * GET /api/projects/:p/usage?from&to&groupBy&agentId&provider&modelId
 * (model filter is paired: provider and modelId are given together).
 */
import { Hono } from "hono";
import type { UsageGroupBy } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalDateParam, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

const GROUP_BYS: readonly UsageGroupBy[] = ["date", "agent", "model", "session"];

export function usageRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation (FD-4).
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const groupByRaw = c.req.query("groupBy") ?? "date";
    if (!(GROUP_BYS as readonly string[]).includes(groupByRaw)) {
      throw badRequest(`groupBy 必须是 ${GROUP_BYS.join(" / ")} 之一。`);
    }
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    const agentId = c.req.query("agentId");
    const provider = c.req.query("provider");
    const modelId = c.req.query("modelId");
    return c.json(
      await deps.usageService.query(projectId, {
        groupBy: groupByRaw as UsageGroupBy,
        // Unattributed errors (login failures, process crashes, etc. with no Project
        // context) are visible only to admins: requireProjectAccess only guarantees
        // "is a member of this Project" — a regular member seeing another tenant's errors
        // would be a cross-tenant information leak.
        includeGlobalErrors: c.var.user.isAdmin,
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(agentId !== undefined && agentId !== "" ? { agentId } : {}),
        ...(provider !== undefined && provider !== "" ? { provider } : {}),
        ...(modelId !== undefined && modelId !== "" ? { modelId } : {}),
      }),
    );
  });

  return app;
}
