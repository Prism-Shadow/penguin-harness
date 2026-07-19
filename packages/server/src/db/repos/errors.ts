/**
 * error_records table repo: one row per error the server catches.
 *
 * Key difference from usage_records: **all attribution columns are nullable** — errors
 * from the login/register endpoints have no Project, and process-level catch-alls
 * (uncaughtException) don't even have a request. These **unattributed errors are visible
 * only to admins** (`ErrorFilter.includeGlobal`, defaults to false): they represent other
 * users' login failures, misdirected Session access, and process crashes (the message may
 * contain internal paths and variable values), so surfacing them in any regular member's
 * statistics center would be a cross-tenant information leak — regular members see only
 * their own Project's errors. Admins still see the category that most needs visibility.
 *
 * **Row cap** (MAX_ROWS): errors often come in storms (an API scan producing a wall of
 * 404s, a tool failing repeatedly in a loop), and an uncapped table would blow up disk
 * usage. So the insert path enforces the cap: check capacity every PRUNE_EVERY inserts
 * (insertion sits on the error-handling path, so we avoid COUNT on every call), and when
 * over the limit, evict the oldest rows in ascending id order. The excess is computed via
 * an **exact COUNT**, not an approximation like `id <= MAX(id) - :max` — after
 * deleteByProject removes rows, id and row count diverge, and the approximation would
 * wrongly delete still-valid data within the cap. The first line of defense is
 * ErrorRecorder's short-window deduplication.
 */
import type { DatabaseSync } from "node:sqlite";

/** Row cap: once exceeded, oldest rows are evicted in ascending id order (see file header). */
export const MAX_ROWS = 20000;

/** Check capacity every N inserts (see file header: insertion sits on the error-handling path, so we avoid COUNT on every call). */
export const PRUNE_EVERY = 200;

/** Capacity parameters (default to the two constants above; tests inject small values to exercise the eviction path). */
export interface ErrorsRepoLimits {
  maxRows?: number;
  pruneEvery?: number;
}

export interface ErrorRecordInsert {
  ts: string;
  date: string;
  projectId: string | null;
  agentId: string | null;
  sessionId: string | null;
  source: string;
  /** expected (HttpError, business 4xx) | unexpected (500 / unforeseen runtime error). */
  kind: string;
  code: string;
  status: number | null;
  message: string;
}

/** Generic filter: date range + agent (errors have no Model dimension, so no model filter). */
export interface ErrorFilter {
  from?: string;
  to?: string;
  agentId?: string;
  /** Whether to include unattributed errors (`project_id IS NULL`): admins only, defaults to false (see file header). */
  includeGlobal?: boolean;
}

/** Total error count and how many are unexpected (stats for the statistics center's error panel). */
export interface ErrorSummary {
  total: number;
  unexpected: number;
}

/** Occurrence count for one source · code pair (the error panel's "most common" metric). */
export interface ErrorCodeCount {
  source: string;
  code: string;
  kind: string;
  count: number;
}

/** One error summary row (a row in the error panel's table). */
export interface ErrorItem {
  ts: string;
  source: string;
  code: string;
  kind: string;
  message: string;
}

export class ErrorsRepo {
  private readonly maxRows: number;
  private readonly pruneEvery: number;
  /** Insert count since the last capacity check (see file header: avoids COUNT on every call). */
  private sinceCheck = 0;

  constructor(
    private readonly db: DatabaseSync,
    limits: ErrorsRepoLimits = {},
  ) {
    this.maxRows = limits.maxRows ?? MAX_ROWS;
    this.pruneEvery = limits.pruneEvery ?? PRUNE_EVERY;
  }

  insert(r: ErrorRecordInsert): void {
    this.db
      .prepare(
        `INSERT INTO error_records
           (ts, date, project_id, agent_id, session_id, source, kind, code, status, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.ts,
        r.date,
        r.projectId,
        r.agentId,
        r.sessionId,
        r.source,
        r.kind,
        r.code,
        r.status,
        r.message,
      );
    if (++this.sinceCheck >= this.pruneEvery) {
      this.sinceCheck = 0;
      this.pruneOverflow();
    }
  }

  /** Capacity enforcement (see file header): compute the exact excess via COUNT, then delete the oldest rows in ascending id order. */
  private pruneOverflow(): void {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM error_records").get()!;
    const excess = (row.n as number) - this.maxRows;
    if (excess <= 0) return;
    this.db
      .prepare(
        `DELETE FROM error_records WHERE id IN (
           SELECT id FROM error_records ORDER BY id ASC LIMIT :excess
         )`,
      )
      .run({ excess });
  }

  /** WHERE fragment and named params: this Project (admins additionally get unattributed errors), plus optional date/agent filter. */
  private conds(
    projectId: string,
    f: ErrorFilter,
  ): { where: string; params: Record<string, string> } {
    // Unattributed errors (login failures, process crashes, ...) are visible only to admins; otherwise it's a cross-tenant leak — see file header.
    const conds = [
      f.includeGlobal === true ? "(project_id = :pid OR project_id IS NULL)" : "project_id = :pid",
    ];
    const params: Record<string, string> = { pid: projectId };
    if (f.from !== undefined) {
      conds.push("date >= :from");
      params.from = f.from;
    }
    if (f.to !== undefined) {
      conds.push("date <= :to");
      params.to = f.to;
    }
    if (f.agentId !== undefined) {
      // Filtering by Agent naturally leaves only that Agent's errors (HTTP / process-level errors have no agent_id).
      conds.push("agent_id = :agentId");
      params.agentId = f.agentId;
    }
    return { where: conds.join(" AND "), params };
  }

  /** Total count + how many are unexpected. */
  summary(projectId: string, f: ErrorFilter = {}): ErrorSummary {
    const { where, params } = this.conds(projectId, f);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN kind = 'unexpected' THEN 1 ELSE 0 END), 0) AS unexpected
         FROM error_records WHERE ${where}`,
      )
      .get(params)!;
    return { total: row.total as number, unexpected: row.unexpected as number };
  }

  /** The most frequent source · code (ties broken by code's lexicographic order); null if there are no errors. */
  topCode(projectId: string, f: ErrorFilter = {}): ErrorCodeCount | null {
    const { where, params } = this.conds(projectId, f);
    const row = this.db
      .prepare(
        `SELECT source, code, kind, COUNT(*) AS count
         FROM error_records WHERE ${where}
         GROUP BY source, code, kind
         ORDER BY count DESC, code ASC
         LIMIT 1`,
      )
      .get(params);
    if (!row) return null;
    return {
      source: row.source as string,
      code: row.code as string,
      kind: row.kind as string,
      count: row.count as number,
    };
  }

  /** The most recent `limit` entries (reverse chronological order). */
  recent(projectId: string, f: ErrorFilter = {}, limit = 20): ErrorItem[] {
    const { where, params } = this.conds(projectId, f);
    const rows = this.db
      .prepare(
        `SELECT ts, source, code, kind, message
         FROM error_records WHERE ${where}
         ORDER BY id DESC LIMIT :limit`,
      )
      .all({ ...params, limit });
    return rows.map((r) => ({
      ts: r.ts as string,
      source: r.source as string,
      code: r.code as string,
      kind: r.kind as string,
      message: r.message as string,
    }));
  }

  /** Cascading cleanup on Project deletion (unattributed errors belong to no Project and are unaffected). */
  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM error_records WHERE project_id = ?").run(projectId);
  }
}
