/**
 * Session search and session timeline routes.
 *
 *   - GET /api/projects/:p/sessions/search      — find a conversation by what was SAID in it
 *   - GET /api/projects/:p/sessions/search/status — how far the index has got
 *   - GET /api/sessions/:sessionId/turns        — that conversation's work process as a timeline
 *
 * The search route is Project-level rather than Agent-level on purpose: the thing people
 * cannot find is a conversation they remember the CONTENT of, and they do not remember which
 * Agent it was under. `agentId` narrows it when the sidebar's grouping is in play.
 */
import { Hono } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, requireValidId } from "../validate.js";
import type { Access } from "../../mechanisms/projects.js";
import type { SessionSearch } from "../../mechanisms/conversation-search.js";

/** Longest query accepted; anything longer is truncated rather than refused. */
const MAX_QUERY = 200;

/** Default and maximum rows one page of results carries. */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export interface SessionSearchRouteDeps {
  access: Access;
  search: SessionSearch;
}

/** yyyy-mm-dd, the date form the sidebar's time filters already use. */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date, not merely a well-shaped one: `2026-13-99` has the right shape and
 * no day, and a filter that silently matches nothing is worse than one that is refused.
 */
function optionalDate(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const m = DATE_RE.exec(value);
  if (m === null) throw badRequest(`${name} must be a yyyy-mm-dd date.`);
  const [, year, month, day] = m;
  const at = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(at.getTime()) ||
    at.getUTCFullYear() !== Number(year) ||
    at.getUTCMonth() + 1 !== Number(month) ||
    at.getUTCDate() !== Number(day)
  ) {
    throw badRequest(`${name} is not a real calendar date.`);
  }
  return value;
}

function intQuery(
  value: string | undefined,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw badRequest(`${name} must be a non-negative integer.`);
  const n = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be between ${min} and ${max}.`);
  }
  return n;
}

/** Project-level search entry: /api/projects/:projectId/sessions/search. */
export function sessionSearchRoutes(deps: SessionSearchRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Declared before the bare `/` so a `?q=`-less request is never read as a search for "".
  app.get("/search", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const q = (c.req.query("q") ?? "").trim();
    if (q === "") throw badRequest("q must not be empty.");
    const agentId = c.req.query("agentId");
    if (agentId !== undefined && agentId !== "" && !isValidId(agentId)) {
      // Same rule as a path parameter: an id is validated before it ever reaches a query.
      throw badRequest("agentId must be a valid id.");
    }
    const sort = c.req.query("sort") ?? "recent";
    if (sort !== "recent" && sort !== "relevance") {
      throw badRequest("sort must be one of recent / relevance.");
    }
    const results = await deps.search.search({
      projectId,
      q: q.slice(0, MAX_QUERY),
      ...(agentId ? { agentId } : {}),
      ...(c.req.query("from") !== undefined
        ? { from: optionalDate(c.req.query("from"), "from") }
        : {}),
      ...(c.req.query("to") !== undefined ? { to: optionalDate(c.req.query("to"), "to") } : {}),
      ...(c.req.query("workspace") ? { workspace: c.req.query("workspace") as string } : {}),
      ...(c.req.query("includeArchived") === "1" ? { includeArchived: true } : {}),
      ...(intQuery(c.req.query("limit"), "limit", 1, MAX_LIMIT) !== undefined
        ? { limit: intQuery(c.req.query("limit"), "limit", 1, MAX_LIMIT) as number }
        : { limit: DEFAULT_LIMIT }),
      ...(intQuery(c.req.query("offset"), "offset", 0, 1_000_000) !== undefined
        ? { offset: intQuery(c.req.query("offset"), "offset", 0, 1_000_000) as number }
        : {}),
      sort,
    });
    return c.json(results);
  });

  return app;
}
