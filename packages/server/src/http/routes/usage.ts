/**
 * Usage statistics routes:
 * GET /api/projects/:p/usage?from&to&groupBy&agentId&provider&modelId
 * (model filter is paired: provider and modelId are given together);
 * GET /api/projects/:p/usage/errors?offset&limit&from&to&agentId — one page of the error
 * detail table, for paging back past the first page the dashboard already returns.
 */
import { Hono } from "hono";
import type { UsageGroupBy } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalDateParam, paginationQuery, requireValidId } from "../validate.js";
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
      throw badRequest(`groupBy must be one of ${GROUP_BYS.join(" / ")}.`);
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

  // One page of the error detail table, newest first. The dashboard response above already
  // carries the first page; this serves "show me earlier ones" without refetching the whole
  // aggregate. Takes the date/agent filter only — the model filter never applied to errors
  // (HTTP and process errors have no Model dimension), so accepting it here would imply a
  // narrowing the summary above does not do.
  app.get("/errors", (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const { offset, limit } = paginationQuery(c);
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    const agentId = c.req.query("agentId");
    return c.json(
      deps.usageService.queryErrors(projectId, {
        offset,
        limit,
        // Same admin-only rule as the dashboard: a regular member seeing another tenant's
        // unattributed errors would be a cross-tenant leak.
        includeGlobalErrors: c.var.user.isAdmin,
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(agentId !== undefined && agentId !== "" ? { agentId } : {}),
      }),
    );
  });

  return app;
}
