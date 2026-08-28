/**
 * Usage statistics routes:
 * GET /api/projects/:p/usage?from&to&fromTs&toTs&groupBy&granularity&agentId&provider&modelId
 * (model filter is paired: provider and modelId are given together; granularity
 * sets the time-series precision, defaulting to day; fromTs/toTs bound a
 * trailing window down to instants — required for minute — and must be given
 * together);
 * GET /api/projects/:p/usage/errors?offset&limit&from&to&agentId&kind — one page of the error
 * detail table, for paging back past the first page the dashboard already returns;
 * GET /api/projects/:p/usage/model-totals — lifetime Token total per Model, unfiltered.
 */
import { Hono } from "hono";
import type { UsageErrorKind, UsageGranularity, UsageGroupBy } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalDateParam, paginationQuery, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

const GROUP_BYS: readonly UsageGroupBy[] = ["date", "agent", "model", "session"];

const GRANULARITIES: readonly UsageGranularity[] = ["minute", "hour", "day", "week", "month"];

/** The two categories `error_records.kind` is ever written with (ErrorRecorder's own vocabulary). */
const ERROR_KINDS: readonly UsageErrorKind[] = ["unexpected", "expected"];

/**
 * Parse an optional ISO-8601 timestamp parameter, normalized to the UTC ISO
 * form the usage rows record — string comparison against `usage_records.ts`
 * only works with both sides in that one spelling.
 */
function optionalTsParam(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${label} must be an ISO-8601 timestamp.`);
  return new Date(ms).toISOString();
}

export function usageRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation.
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const groupByRaw = c.req.query("groupBy") ?? "date";
    if (!(GROUP_BYS as readonly string[]).includes(groupByRaw)) {
      throw badRequest(`groupBy must be one of ${GROUP_BYS.join(" / ")}.`);
    }
    const granularityRaw = c.req.query("granularity") ?? "day";
    if (!(GRANULARITIES as readonly string[]).includes(granularityRaw)) {
      throw badRequest(`granularity must be one of ${GRANULARITIES.join(" / ")}.`);
    }
    const granularity = granularityRaw as UsageGranularity;
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    const fromTs = optionalTsParam(c.req.query("fromTs"), "fromTs");
    const toTs = optionalTsParam(c.req.query("toTs"), "toTs");
    if ((fromTs === undefined) !== (toTs === undefined)) {
      throw badRequest("fromTs and toTs must be given together.");
    }
    if (fromTs !== undefined && toTs !== undefined && fromTs > toTs) {
      throw badRequest("fromTs must not be after toTs.");
    }
    const agentId = c.req.query("agentId");
    const provider = c.req.query("provider");
    const modelId = c.req.query("modelId");
    return c.json(
      await deps.usageService.query(projectId, {
        groupBy: groupByRaw as UsageGroupBy,
        granularity,
        ...(fromTs !== undefined ? { fromTs } : {}),
        ...(toTs !== undefined ? { toTs } : {}),
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
  // Lifetime Token total per Model, for the models page's per-card figure. Takes no filters at
  // all: the number answers "how much has this model been used", which has no range, and the
  // page showing it offers none. One grouped scan, so it stays a cheap second request rather
  // than a reason to widen the models response with telemetry.
  app.get("/model-totals", (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(deps.usageService.modelTotals(projectId));
  });

  app.get("/errors", (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const { offset, limit } = paginationQuery(c);
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    const agentId = c.req.query("agentId");
    const kindRaw = c.req.query("kind");
    // `kind` narrows to one of the two categories the panel's stats already separate. It is
    // validated against that closed set rather than passed through, so a typo asks for
    // nothing instead of silently matching no rows and reading as "no errors".
    if (
      kindRaw !== undefined &&
      kindRaw !== "" &&
      !(ERROR_KINDS as readonly string[]).includes(kindRaw)
    ) {
      throw badRequest(`kind must be one of ${ERROR_KINDS.join(" / ")}.`);
    }
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
        ...(kindRaw !== undefined && kindRaw !== "" ? { kind: kindRaw } : {}),
      }),
    );
  });

  return app;
}
