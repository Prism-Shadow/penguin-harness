/**
 * Usage statistics routes:
 * GET /api/projects/:p/usage?from&to&fromTs&toTs&groupBy&granularity&agentId&provider&modelId
 * (model filter is paired: provider and modelId are given together; granularity
 * sets the time-series precision, defaulting to day; fromTs/toTs bound a
 * trailing window down to instants — required for minute — and must be given
 * together);
 * GET /api/projects/:p/usage/errors?offset&limit&from&to&fromTs&toTs&agentId&kind — one page
 * of the error detail table, for paging back past the first page the dashboard already
 * returns (both reads also take `utcOffsetMinutes`, the viewer's offset from UTC, whose
 * calendar day the table folds a day's repeats by);
 * DELETE /api/projects/:p/usage/errors?from&to&fromTs&toTs&agentId — empties that table for
 * the filter the panel is showing (owner only; `from`/`to` are required, unlike on the reads;
 * an admin's clear also takes the unattributed rows an admin's read shows);
 * GET /api/projects/:p/usage/model-totals — lifetime Token total per Model, unfiltered.
 *
 * The dashboard read above is the expensive one (grouped scans, several per request) and the
 * panel asks for it repeatedly, so its responses are reused for a few seconds, keyed by the
 * whole request shape — an admin's answer is never served to a member (see usageCacheKey).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  UsageErrorKind,
  UsageErrorsClearResponse,
  UsageGranularity,
  UsageGroupBy,
  UsageResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, optionalDateParam, paginationQuery, requireValidId } from "../validate.js";
import type { UsageQueries } from "../../mechanisms/observability.js";
import type { Access } from "../../mechanisms/projects.js";
import type { UsageQuery } from "../../services/usage-service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface UsageRouteDeps {
  access: Access;
  usageService: UsageQueries;
}

const GROUP_BYS: readonly UsageGroupBy[] = ["date", "agent", "model", "session"];

const GRANULARITIES: readonly UsageGranularity[] = ["minute", "hour", "day", "week", "month"];

/** The two categories `error_records.kind` is ever written with (ErrorRecorder's own vocabulary). */
const ERROR_KINDS: readonly UsageErrorKind[] = ["unexpected", "expected"];

/**
 * Parse an optional ISO-8601 timestamp parameter, normalized to the UTC ISO
 * form the rows record — string comparison against `usage_records.ts` and
 * `error_records.ts` only works with both sides in that one spelling.
 */
function optionalTsParam(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`${label} must be an ISO-8601 timestamp.`);
  return new Date(ms).toISOString();
}

/** The widest offset from UTC a clock actually uses (UTC+14), which bounds `utcOffsetMinutes`. */
const UTC_OFFSET_MAX_MINUTES = 14 * 60;

/**
 * The optional viewer offset east of UTC, in minutes: whose calendar day the error table folds
 * a day's repeats by (see ErrorsRepo.recent). A signed whole number within the offsets clocks
 * use, and nothing else — a typo is a 400 rather than a quietly different day.
 */
function utcOffsetQuery(c: Context<AppEnv>): number | undefined {
  const raw = c.req.query("utcOffsetMinutes");
  if (raw === undefined || raw === "") return undefined;
  const minutes = /^-?\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(Math.abs(minutes) <= UTC_OFFSET_MAX_MINUTES)) {
    throw badRequest(
      `utcOffsetMinutes must be a whole number of minutes between -${UTC_OFFSET_MAX_MINUTES} and ${UTC_OFFSET_MAX_MINUTES}.`,
    );
  }
  return minutes;
}

/**
 * The optional trailing-window pair, normalized: both or neither, and in order. One parser
 * for the dashboard and the two error routes, so a window means the same thing to all three.
 */
function tsWindowQuery(c: Context<AppEnv>): { fromTs?: string; toTs?: string } {
  const fromTs = optionalTsParam(c.req.query("fromTs"), "fromTs");
  const toTs = optionalTsParam(c.req.query("toTs"), "toTs");
  if ((fromTs === undefined) !== (toTs === undefined)) {
    throw badRequest("fromTs and toTs must be given together.");
  }
  if (fromTs !== undefined && toTs !== undefined && fromTs > toTs) {
    throw badRequest("fromTs must not be after toTs.");
  }
  return { ...(fromTs !== undefined ? { fromTs } : {}), ...(toTs !== undefined ? { toTs } : {}) };
}

/**
 * How long a dashboard response may be served again. The cost center's panel asks for the same
 * aggregates repeatedly — once per panel, and again on every poll of its rolling window — while
 * a miss is a handful of grouped scans over the whole `usage_records` table. A few seconds of
 * staleness is invisible on an analytics chart.
 *
 * Aligned with {@link USAGE_KEY_BUCKET_MS}: the key is quantized to those buckets, so a shorter
 * TTL would re-run the same bucket's aggregate several times for one answer. At most one run
 * per bucket per shape, and the staleness a reader sees is the one the quantized key already
 * accepts.
 */
const USAGE_CACHE_TTL_MS = 30_000;

/**
 * The bucket a window bound in a cache key is folded to. The dashboard recomputes its rolling
 * `fromTs`/`toTs` from the clock on every poll, so an exact key would miss every time while
 * describing the same window; the served window then differs from the asked one by less than
 * this bucket — invisible on the chart. In the KEY only, never in the query.
 */
const USAGE_KEY_BUCKET_MS = 30_000;

/** Responses one route instance keeps; past it the map is emptied rather than evicted in order. */
const USAGE_CACHE_MAX_ENTRIES = 200;

/** Fold an ISO instant to its {@link USAGE_KEY_BUCKET_MS} bucket (anything unparseable stays as it is). */
function bucketTs(ts: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return ts;
  return new Date(Math.floor(ms / USAGE_KEY_BUCKET_MS) * USAGE_KEY_BUCKET_MS).toISOString();
}

/**
 * The cache key of one dashboard read: the Project plus every field of the query, so two
 * requests share an entry only when they would be answered the same way. `includeGlobalErrors`
 * is part of it, which is what keeps an admin's unattributed error rows from ever reaching a
 * member through the cache.
 */
function usageCacheKey(projectId: string, q: UsageQuery): string {
  const key = {
    ...q,
    ...(q.fromTs !== undefined ? { fromTs: bucketTs(q.fromTs) } : {}),
    ...(q.toTs !== undefined ? { toTs: bucketTs(q.toTs) } : {}),
  };
  return `${projectId}::${JSON.stringify(key)}`;
}

export function usageRoutes(deps: UsageRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // One cache per app instance, so a second instance in this process — every test's app —
  // never reads another's responses.
  const responses = new Map<string, { at: number; body: UsageResponse }>();
  const inFlight = new Map<string, Promise<UsageResponse>>();

  app.get("/", async (c) => {
    // Defensive id validation.
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
    const window = tsWindowQuery(c);
    const utcOffsetMinutes = utcOffsetQuery(c);
    const agentId = c.req.query("agentId");
    const provider = c.req.query("provider");
    const modelId = c.req.query("modelId");
    const usageQuery: UsageQuery = {
      groupBy: groupByRaw as UsageGroupBy,
      granularity,
      ...window,
      ...(utcOffsetMinutes !== undefined ? { utcOffsetMinutes } : {}),
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
    };
    const key = usageCacheKey(projectId, usageQuery);
    const hit = responses.get(key);
    if (hit !== undefined && Date.now() - hit.at < USAGE_CACHE_TTL_MS) return c.json(hit.body);
    // Concurrent identical reads — a dashboard fires several panels' worth at once — await the
    // query already running rather than starting a second. A failed one leaves nothing behind:
    // the slot is cleared when it settles and only a resolution is ever stored.
    let pending = inFlight.get(key);
    if (pending === undefined) {
      pending = deps.usageService.query(projectId, usageQuery).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const body = await pending;
    if (responses.size > USAGE_CACHE_MAX_ENTRIES) responses.clear();
    responses.set(key, { at: Date.now(), body });
    return c.json(body);
  });

  // Lifetime Token total per Model, for the models page's per-card figure. Takes no filters at
  // all: the number answers "how much has this model been used", which has no range, and the
  // page showing it offers none. One grouped scan, so it stays a cheap second request rather
  // than a reason to widen the models response with telemetry.
  app.get("/model-totals", (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(deps.usageService.modelTotals(projectId));
  });

  // One page of the error detail table, newest first. The dashboard response above already
  // carries the first page; this serves "show me earlier ones" without refetching the whole
  // aggregate. Takes the date/agent filter only — the model filter never applied to errors
  // (HTTP and process errors have no Model dimension), so accepting it here would imply a
  // narrowing the summary above does not do.
  app.get("/errors", (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const { offset, limit } = paginationQuery(c);
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    const window = tsWindowQuery(c);
    const utcOffsetMinutes = utcOffsetQuery(c);
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
        ...window,
        ...(utcOffsetMinutes !== undefined ? { utcOffsetMinutes } : {}),
        ...(agentId !== undefined && agentId !== "" ? { agentId } : {}),
        ...(kindRaw !== undefined && kindRaw !== "" ? { kind: kindRaw } : {}),
      }),
    );
  });

  // Empties the error table for the filter the panel is showing. Takes the same date, window
  // and agent filter as the two reads above and no other: a clear removes exactly the rows the
  // caller was looking at, never the Project's whole history behind a narrowed view — the date
  // range is required for that reason, where the reads leave it optional. `kind` is not
  // accepted — the panel has no control for it, so a clear can offer no narrowing its reader
  // could have seen on screen.
  app.delete("/errors", (c) => {
    const projectId = requireValidId(c, "projectId");
    // Owner only, the rule Agent deletion applies to error rows already (it cascade-deletes
    // them): membership is enough to READ the panel, but these rows are the Project's shared
    // history and one member emptying them takes them from everyone.
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const from = optionalDateParam(c.req.query("from"), "from");
    const to = optionalDateParam(c.req.query("to"), "to");
    // Both bounds are required here, unlike on the two reads: a missing bound reads as
    // unbounded on that side, and an unbounded clear is the Project's entire history — for an
    // admin, every unattributed row in the instance along with it, rows that sit in every
    // other Project's admin panel. The panel already withholds the action while either date
    // input is blank (see clearableFilter); this is that same rule where it can be enforced,
    // rather than a promise only the caller who uses the UI keeps.
    if (from === undefined || to === undefined) {
      throw badRequest("from and to are both required.");
    }
    const window = tsWindowQuery(c);
    const agentId = c.req.query("agentId");
    // The same admin visibility the reads above carry, so a clear takes exactly the rows the
    // caller's panel showed. An admin's panel shows the unattributed rows (login failures,
    // process crashes) and so an admin's clear takes them; a member's never shows them, so a
    // clear can never become a way to remove a row its caller was not allowed to see.
    const deleted = deps.usageService.clearErrors(projectId, {
      includeGlobalErrors: c.var.user.isAdmin,
      from,
      to,
      ...window,
      ...(agentId !== undefined && agentId !== "" ? { agentId } : {}),
    });
    return c.json({ deleted } satisfies UsageErrorsClearResponse);
  });

  return app;
}
