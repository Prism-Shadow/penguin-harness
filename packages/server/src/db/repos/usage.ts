/**
 * usage_records table repo:
 * one row per token_usage (per-request bucket). Stores Token counts only, not cost —
 * cost is computed on the fly by usage-service against current pricing at query time,
 * so every aggregation is broken down by the `(provider, model_id)` pair and returns
 * raw Token sums (a model_id shared across providers is aggregated separately; never concatenated).
 */
import type { DatabaseSync } from "node:sqlite";
import type { UsageGroupBy } from "../../api/types.js";

export interface UsageRecordInsert {
  ts: string;
  date: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  originSessionId: string | null;
  /** Provider group (pairs with modelId to form the attribution key). */
  provider: string;
  /** Upstream model id (pairs with provider). */
  modelId: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  /** Request outcome; defaults to completed (success, carries tokens). Failed requests are stored with 0 tokens + status, for success-rate calculations. */
  status?: string;
}

/** Generic filter: date range + agent / model dimensions (cost center top bar switches by agent/model). */
export interface UsageFilter {
  from?: string;
  to?: string;
  /** Timestamp window bounds (ISO UTC, compared as strings against the row's `ts`): refine the date range down to instants for the trailing minute/hour windows. */
  fromTs?: string;
  toTs?: string;
  agentId?: string;
  /** Provider filter paired with modelId (the frontend dropdown always sends them together). */
  provider?: string;
  modelId?: string;
  /** Restrict to these sessions (company mode attributes cost by the sessions an organization owns); an empty list matches nothing. */
  sessionIds?: readonly string[];
}

/** Raw Token sums for a single Model (paired reference) — the smallest unit for cost conversion. */
export interface UsageModelSums {
  provider: string;
  modelId: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  requests: number;
  /**
   * Which tier of a time-based price these Tokens ran in, decided from each record's own `ts`.
   *
   * A model with no schedule has one price and every row reports `true`. A scheduled one is
   * summed into two rows per reference, so a week that straddles the boundary is priced at the
   * rate each request actually ran at — rather than at whichever tier happens to be in force
   * when someone opens the page, which would move a finished week's cost twice a day.
   */
  peak: boolean;
}

/** A time-based price to split an aggregation by: which references carry it, and when it is peak. */
export interface PeakTier {
  refs: ReadonlyArray<{ provider: string; modelId: string }>;
  /** Minutes east of UTC the schedule's local hours are written in. */
  utcOffsetMinutes: number;
  /** ISO weekday numbers the windows apply to; a day not listed is off-peak throughout. */
  peakDays: readonly number[];
  /** `[startHour, endHour)` in the schedule's own local hours. */
  peakHours: readonly (readonly [number, number])[];
}

/** Raw Token sums by group key x Model. */
export interface UsageGroupModelSums extends UsageModelSums {
  key: string;
}

/** Time-series bucket x Model sums, with the success-rate counts folded in. */
export interface UsageSeriesModelSums extends UsageGroupModelSums {
  /** Successful requests in the bucket. */
  completed: number;
  /**
   * Success-rate denominator: all requests in the bucket minus aborted. The user
   * clicking "stop" is not a model failure, and counting it would drop the success
   * rate every time stop is pressed. Every success-rate denominator in this repo
   * follows this rule.
   */
  denominator: number;
}

/** Per-Agent counts per time bucket (the requests chart's series data). */
export interface UsageAgentBucketCount {
  key: string;
  agentId: string;
  requests: number;
  /** Successful requests in the bucket. */
  completed: number;
  /** Success-rate denominator: all requests minus aborted, same rule as UsageSeriesModelSums. */
  denominator: number;
}

/** Time-series precision (mirrors the API's UsageGranularity). */
export type UsageSeriesGranularity = "minute" | "hour" | "day" | "week" | "month";

/**
 * Bucket-key SQL per granularity. Keys must agree byte-for-byte with
 * internal/dates.ts's enumerateBuckets / enumerateTsBuckets, which zero-fill
 * the same series: minute/hour buckets come from `ts` converted to the
 * server's local clock (the same timezone `date` was recorded in), the rest
 * derive from the `date` column — `date(date, '-6 days', 'weekday 1')` is the
 * ISO week's Monday.
 */
const BUCKET_EXPRS: Record<UsageSeriesGranularity, string> = {
  minute: `strftime('%Y-%m-%dT%H:%M', ts, 'localtime')`,
  hour: `strftime('%Y-%m-%dT%H:00', ts, 'localtime')`,
  day: "date",
  week: `date(date, '-6 days', 'weekday 1')`,
  month: "substr(date, 1, 7)",
};

/** groupBy dimension -> column name allowlist (prevents injection; only these four columns can be group keys). */
const GROUP_COLUMNS: Record<UsageGroupBy, string> = {
  date: "date",
  agent: "agent_id",
  model: "model_id",
  session: "session_id",
};

/**
 * A `1`/`0` expression naming the tier a row's own `ts` fell in, for the references that have
 * one; every other row is `1`, the single price it has.
 *
 * Written from the schedule rather than hardcoded so a second vendor's windows cost one more
 * entry and no more SQL. The hours compare as integers because a window boundary is a whole
 * hour in every schedule the catalog can express; a half-hour boundary would need the minutes.
 * Literals only — the numbers come from the catalog and the references are bound.
 */
function peakExpr(tiers: readonly PeakTier[]): { sql: string; params: Record<string, string> } {
  if (tiers.length === 0) return { sql: "1", params: {} };
  const params: Record<string, string> = {};
  const branches: string[] = [];
  tiers.forEach((tier, ti) => {
    if (tier.refs.length === 0 || tier.peakDays.length === 0) return;
    const shift = `'${tier.utcOffsetMinutes >= 0 ? "+" : "-"}${Math.abs(tier.utcOffsetMinutes)} minutes'`;
    const refs = tier.refs.map((ref, ri) => {
      const p = `t${ti}p${ri}`;
      const m = `t${ti}m${ri}`;
      params[p] = ref.provider;
      params[m] = ref.modelId;
      return `(provider = :${p} AND model_id = :${m})`;
    });
    // `%w` is 0=Sunday; the schedule counts ISO days, so Sunday maps to 7.
    const day = `CASE CAST(strftime('%w', ts, ${shift}) AS INTEGER) WHEN 0 THEN 7 ELSE CAST(strftime('%w', ts, ${shift}) AS INTEGER) END`;
    const hour = `CAST(strftime('%H', ts, ${shift}) AS INTEGER)`;
    const windows = tier.peakHours.map(([from, to]) => `(${hour} >= ${from} AND ${hour} < ${to})`);
    branches.push(
      `WHEN (${refs.join(" OR ")}) THEN (CASE WHEN ${day} IN (${tier.peakDays.join(", ")}) AND (${windows.join(" OR ")}) THEN 1 ELSE 0 END)`,
    );
  });
  if (branches.length === 0) return { sql: "1", params: {} };
  return { sql: `CASE ${branches.join(" ")} ELSE 1 END`, params };
}

const SUM_COLUMNS = `COALESCE(SUM(cache_read), 0) AS cache_read,
                COALESCE(SUM(cache_write), 0) AS cache_write,
                COALESCE(SUM(output), 0) AS output,
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS requests`;

function toSums(r: Record<string, unknown>): UsageModelSums {
  return {
    provider: r.provider as string,
    modelId: r.model_id as string,
    peak: r.peak !== 0,
    cacheRead: r.cache_read as number,
    cacheWrite: r.cache_write as number,
    output: r.output as number,
    total: r.total as number,
    requests: r.requests as number,
  };
}

export class UsageRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(r: UsageRecordInsert): void {
    this.db
      .prepare(
        `INSERT INTO usage_records
           (ts, date, project_id, agent_id, session_id, origin_session_id, provider, model_id,
            cache_read, cache_write, output, total, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.ts,
        r.date,
        r.projectId,
        r.agentId,
        r.sessionId,
        r.originSessionId,
        r.provider,
        r.modelId,
        r.cacheRead,
        r.cacheWrite,
        r.output,
        r.total,
        r.status ?? "completed",
      );
  }

  /** WHERE fragment (project + optional date/agent/model) plus named params. */
  private conds(
    projectId: string,
    f: UsageFilter,
  ): { where: string; params: Record<string, string> } {
    const conds = ["project_id = :pid"];
    const params: Record<string, string> = { pid: projectId };
    if (f.from !== undefined) {
      conds.push("date >= :from");
      params.from = f.from;
    }
    if (f.to !== undefined) {
      conds.push("date <= :to");
      params.to = f.to;
    }
    if (f.fromTs !== undefined) {
      conds.push("ts >= :fromTs");
      params.fromTs = f.fromTs;
    }
    if (f.toTs !== undefined) {
      conds.push("ts <= :toTs");
      params.toTs = f.toTs;
    }
    if (f.agentId !== undefined) {
      conds.push("agent_id = :agentId");
      params.agentId = f.agentId;
    }
    if (f.provider !== undefined) {
      conds.push("provider = :provider");
      params.provider = f.provider;
    }
    if (f.modelId !== undefined) {
      conds.push("model_id = :modelId");
      params.modelId = f.modelId;
    }
    if (f.sessionIds !== undefined) {
      if (f.sessionIds.length === 0) {
        conds.push("0");
      } else {
        const keys = f.sessionIds.map((id, i) => {
          params[`s${i}`] = id;
          return `:s${i}`;
        });
        conds.push(`session_id IN (${keys.join(", ")})`);
      }
    }
    return { where: conds.join(" AND "), params };
  }

  /**
   * Sums (broken down by paired reference, and by price tier where one applies): date range +
   * optional agent/model filter.
   */
  bucketByModel(
    projectId: string,
    f: UsageFilter = {},
    tiers: readonly PeakTier[] = [],
  ): UsageModelSums[] {
    const { where, params } = this.conds(projectId, f);
    const peak = peakExpr(tiers);
    const rows = this.db
      .prepare(
        `SELECT provider, model_id, ${peak.sql} AS peak, ${SUM_COLUMNS}
         FROM usage_records WHERE ${where}
         GROUP BY provider, model_id, peak`,
      )
      .all({ ...params, ...peak.params });
    return rows.map(toSums);
  }

  /** Grouped aggregation (group key x paired reference breakdown): date range + optional agent/model filter. */
  groupsByModel(
    projectId: string,
    groupBy: UsageGroupBy,
    f: UsageFilter = {},
    tiers: readonly PeakTier[] = [],
  ): UsageGroupModelSums[] {
    const col = GROUP_COLUMNS[groupBy];
    const { where, params } = this.conds(projectId, f);
    const peak = peakExpr(tiers);
    const rows = this.db
      .prepare(
        `SELECT ${col} AS key, provider, model_id, ${peak.sql} AS peak, ${SUM_COLUMNS}
         FROM usage_records WHERE ${where}
         GROUP BY ${col}, provider, model_id, peak`,
      )
      .all({ ...params, ...peak.params });
    return rows.map((r) => ({ key: r.key as string, ...toSums(r) }));
  }

  /**
   * Time-series sums (bucket key x paired reference breakdown) with per-bucket
   * success-rate counts riding along: powers the cost center's time-series charts
   * (requests / success rate / Token / cost) at the requested precision. The
   * denominator excludes aborted.
   */
  seriesByModel(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f: UsageFilter = {},
    tiers: readonly PeakTier[] = [],
  ): UsageSeriesModelSums[] {
    const expr = BUCKET_EXPRS[granularity];
    const { where, params } = this.conds(projectId, f);
    const peak = peakExpr(tiers);
    const rows = this.db
      .prepare(
        `SELECT ${expr} AS key, provider, model_id, ${peak.sql} AS peak, ${SUM_COLUMNS},
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
                COALESCE(SUM(CASE WHEN status <> 'aborted' THEN 1 ELSE 0 END), 0) AS denominator
         FROM usage_records WHERE ${where}
         GROUP BY key, provider, model_id, peak`,
      )
      .all({ ...params, ...peak.params });
    return rows.map((r) => ({
      key: r.key as string,
      ...toSums(r),
      completed: r.completed as number,
      denominator: r.denominator as number,
    }));
  }

  /** Per-Agent counts per time bucket (the by-Agent requests chart's series; the denominator excludes aborted). */
  agentSeries(
    projectId: string,
    granularity: UsageSeriesGranularity,
    f: UsageFilter = {},
  ): UsageAgentBucketCount[] {
    const expr = BUCKET_EXPRS[granularity];
    const { where, params } = this.conds(projectId, f);
    const rows = this.db
      .prepare(
        `SELECT ${expr} AS key, agent_id, COUNT(*) AS requests,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
                COALESCE(SUM(CASE WHEN status <> 'aborted' THEN 1 ELSE 0 END), 0) AS denominator
         FROM usage_records WHERE ${where}
         GROUP BY key, agent_id`,
      )
      .all(params);
    return rows.map((r) => ({
      key: r.key as string,
      agentId: r.agent_id as string,
      requests: r.requests as number,
      completed: r.completed as number,
      denominator: r.denominator as number,
    }));
  }

  /** Distinct agent_id values seen for this Project (for filter dropdowns). */
  distinctAgentIds(projectId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT agent_id AS v FROM usage_records WHERE project_id = ? ORDER BY agent_id",
      )
      .all(projectId);
    return rows.map((r) => r.v as string);
  }

  /** Distinct Model paired references seen for this Project (for filter dropdowns). */
  distinctModels(projectId: string): Array<{ provider: string; modelId: string }> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT provider, model_id FROM usage_records
         WHERE project_id = ? ORDER BY provider, model_id`,
      )
      .all(projectId);
    return rows.map((r) => ({ provider: r.provider as string, modelId: r.model_id as string }));
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM usage_records WHERE project_id = ?").run(projectId);
  }
}
