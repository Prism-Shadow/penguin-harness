/**
 * The archive page's routes, under the current user (`/api/me/archived-sessions`), so what they
 * list is by construction what this user may see: every archived Session of every Project they
 * own or are a member of (services/archived-sessions-service.ts).
 *
 *   GET  /groups      the groups (one Workspace of one Project each) with their counts;
 *                     `servers=here` or `servers=machines` answers one side alone
 *   GET  /            one group's page, newest activity first, by cursor
 *   POST /unarchive   unarchive explicit ids, or every archived row a filter matches
 *   POST /delete      delete them the same way
 *
 * A group chosen whole (Select all) is a filter carrying the snapshot its count was read at
 * (`until`, the groups response's `asOf`) and the rows unticked since (`exclude`), so it acts on
 * the rows the user saw counted and kept chosen, and on none that came after.
 *
 * An admin's groups include the machines their Projects use; a page or a batch naming a group's
 * `machineId` goes to that machine.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type {
  ArchivedSessionGroupServers,
  ArchivedSessionSource,
  ArchivedSessionsBatch,
  ArchivedSessionsQuery,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  ArchiveCaller,
  ArchivedSessionsService,
} from "../../services/archived-sessions-service.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  listingViewOfRequest,
  parseActivityCursor,
  parseNonNegativeInt,
  readJson,
} from "../validate.js";

/** What this route group reaches — bound by its module (routes/sessions.ts SessionApiRoutes). */
export interface ArchivedSessionsRouteDeps {
  service: ArchivedSessionsService;
}

/** The sources the archive page filters by. */
const ARCHIVED_SOURCES: readonly ArchivedSessionSource[] = [
  "user",
  "api",
  "schedule",
  "cli",
  "workbench",
];

/** Longest title query accepted. */
const QUERY_MAX = 200;

/** Ids one batch may name. */
const BATCH_MAX = 500;

/** Rows one page may hold. */
const PAGE_MAX = 100;

/** A Project the caller cannot name: the same answer a Project they cannot open gets. */
const projectNotFound = () =>
  new HttpError(404, "project_not_found", "Project does not exist or you do not have access.");

/**
 * The filter every archive query shares, read from an object (the query string or a batch's
 * `filter`): `q` (a title substring, at most 200 characters), `source` (one of the archive sources) and
 * `projectId` (a Project the user can open, checked by the service).
 */
function parseQuery(raw: Record<string, unknown>): ArchivedSessionsQuery {
  const query: ArchivedSessionsQuery = {};
  if (raw.q !== undefined) {
    if (typeof raw.q !== "string") throw badRequest("q must be a string.");
    if (raw.q.length > QUERY_MAX) throw badRequest(`q must be at most ${QUERY_MAX} characters.`);
    if (raw.q.trim() !== "") query.q = raw.q;
  }
  if (raw.source !== undefined) {
    if (!ARCHIVED_SOURCES.includes(raw.source as ArchivedSessionSource)) {
      throw badRequest(`source must be one of ${ARCHIVED_SOURCES.join(" / ")}.`);
    }
    query.source = raw.source as ArchivedSessionSource;
  }
  if (raw.projectId !== undefined) {
    if (typeof raw.projectId !== "string" || !isValidId(raw.projectId)) throw projectNotFound();
    query.projectId = raw.projectId;
  }
  return query;
}

/** A group's Workspace as a request names it: a non-empty path, or `temp`. */
function parseWorkspace(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "")
    throw badRequest("workspace must not be empty.");
  return raw;
}

/** A machine's own id as a request names it (base64url); anything else names no machine. */
function parseMachineId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw)) {
    throw new HttpError(404, "unknown_machine", "No such machine in the Projects you can open.");
  }
  return raw;
}

/** Who asks, as the service reads them. */
function callerOf(c: Context<AppEnv>): ArchiveCaller {
  return {
    userId: c.var.user.userId,
    isAdmin: c.var.user.isAdmin,
    view: listingViewOfRequest(c),
  };
}

/** The query string's parameters as one object. */
function queryOf(c: Context<AppEnv>): Record<string, unknown> {
  return c.req.query();
}

/** A filter's snapshot time: an ISO time, as the groups response's `asOf` gives it. */
function parseUntil(raw: unknown): string {
  if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw))) {
    throw badRequest("until must be an ISO time.");
  }
  return raw;
}

/** Session ids a filter leaves out: 1–500 of them. */
function parseExclude(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BATCH_MAX) {
    throw badRequest(`exclude must be an array of 1–${BATCH_MAX} Session ids.`);
  }
  if (!raw.every((id) => typeof id === "string" && isValidId(id))) {
    throw badRequest("exclude must hold Session ids.");
  }
  return raw as string[];
}

/** A batch's body: `{sessionIds}` (1–500 ids) or `{filter}`, exactly one of them, and an optional `machineId`. */
async function parseBatch(c: Context<AppEnv>): Promise<ArchivedSessionsBatch> {
  const body = await readJson(c);
  const machine = body.machineId === undefined ? {} : { machineId: parseMachineId(body.machineId) };
  return { ...parseTarget(body), ...machine };
}

/** A batch's target: `{sessionIds}` or `{filter}`, exactly one of them. */
function parseTarget(body: Record<string, unknown>): ArchivedSessionsBatch {
  const hasIds = body.sessionIds !== undefined;
  const hasFilter = body.filter !== undefined;
  if (hasIds === hasFilter) throw badRequest("Send either sessionIds or filter.");
  if (hasIds) {
    const ids = body.sessionIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_MAX) {
      throw badRequest(`sessionIds must be an array of 1–${BATCH_MAX} Session ids.`);
    }
    if (!ids.every((id) => typeof id === "string" && isValidId(id))) {
      throw badRequest("sessionIds must hold Session ids.");
    }
    return { sessionIds: ids as string[] };
  }
  const filter = body.filter;
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    throw badRequest("filter must be an object.");
  }
  const raw = filter as Record<string, unknown>;
  return {
    filter: {
      ...parseQuery(raw),
      ...(raw.workspace !== undefined ? { workspace: parseWorkspace(raw.workspace) } : {}),
      ...(raw.until !== undefined ? { until: parseUntil(raw.until) } : {}),
      ...(raw.exclude !== undefined ? { exclude: parseExclude(raw.exclude) } : {}),
    },
  };
}

export function archivedSessionsRoutes(deps: ArchivedSessionsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/groups", async (c) => {
    const raw = queryOf(c);
    if (raw.servers !== undefined && raw.servers !== "here" && raw.servers !== "machines") {
      throw badRequest("servers must be here or machines.");
    }
    return c.json(
      await deps.service.groups(
        callerOf(c),
        parseQuery(raw),
        raw.servers as ArchivedSessionGroupServers | undefined,
      ),
    );
  });

  app.get("/", async (c) => {
    const raw = queryOf(c);
    const query = parseQuery(raw);
    if (query.projectId === undefined) throw badRequest("projectId is required.");
    const limit = typeof raw.limit === "string" ? parseNonNegativeInt(raw.limit) : null;
    if (limit === null || limit < 1 || limit > PAGE_MAX) {
      throw badRequest(`limit must be an integer between 1 and ${PAGE_MAX}.`);
    }
    let before;
    if (raw.before !== undefined) {
      before = parseActivityCursor(String(raw.before));
      if (before === null) throw badRequest("before must be <lastActiveAt>,<sessionId>.");
    }
    return c.json(
      await deps.service.rows(callerOf(c), {
        ...query,
        projectId: query.projectId,
        workspace: parseWorkspace(raw.workspace),
        limit,
        ...(before ? { before } : {}),
        ...(raw.machineId !== undefined ? { machineId: parseMachineId(raw.machineId) } : {}),
      }),
    );
  });

  app.post("/unarchive", async (c) =>
    c.json(await deps.service.unarchive(callerOf(c), await parseBatch(c))),
  );

  app.post("/delete", async (c) =>
    c.json(await deps.service.delete(callerOf(c), await parseBatch(c))),
  );

  return app;
}
