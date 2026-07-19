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
  agentId?: string;
  /** Provider filter paired with modelId (the frontend dropdown always sends them together). */
  provider?: string;
  modelId?: string;
}

/**
 * Raw request success-rate counts for a single Model (paired reference).
 * `total` is **the success-rate denominator**: all requests minus aborted — the user
 * clicking "stop" is not a model failure, and counting it would make the success rate
 * drop every time stop is pressed. `aborted` is counted separately for display.
 */
export interface UsageStatusCount {
  provider: string;
  modelId: string;
  completed: number;
  total: number;
  aborted: number;
  failed: number;
  timeout: number;
  malformed: number;
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
}

/** Raw Token sums by group key x Model. */
export interface UsageGroupModelSums extends UsageModelSums {
  key: string;
}

/** groupBy dimension -> column name allowlist (prevents injection; only these four columns can be group keys). */
const GROUP_COLUMNS: Record<UsageGroupBy, string> = {
  date: "date",
  agent: "agent_id",
  model: "model_id",
  session: "session_id",
};

const SUM_COLUMNS = `COALESCE(SUM(cache_read), 0) AS cache_read,
                COALESCE(SUM(cache_write), 0) AS cache_write,
                COALESCE(SUM(output), 0) AS output,
                COALESCE(SUM(total), 0) AS total,
                COUNT(*) AS requests`;

function toSums(r: Record<string, unknown>): UsageModelSums {
  return {
    provider: r.provider as string,
    modelId: r.model_id as string,
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
    return { where: conds.join(" AND "), params };
  }

  /** Sums (broken down by paired reference): date range + optional agent/model filter. */
  bucketByModel(projectId: string, f: UsageFilter = {}): UsageModelSums[] {
    const { where, params } = this.conds(projectId, f);
    const rows = this.db
      .prepare(
        `SELECT provider, model_id, ${SUM_COLUMNS}
         FROM usage_records WHERE ${where}
         GROUP BY provider, model_id`,
      )
      .all(params);
    return rows.map(toSums);
  }

  /** Grouped aggregation (group key x paired reference breakdown): date range + optional agent/model filter. */
  groupsByModel(
    projectId: string,
    groupBy: UsageGroupBy,
    f: UsageFilter = {},
  ): UsageGroupModelSums[] {
    const col = GROUP_COLUMNS[groupBy];
    const { where, params } = this.conds(projectId, f);
    const rows = this.db
      .prepare(
        `SELECT ${col} AS key, provider, model_id, ${SUM_COLUMNS}
         FROM usage_records WHERE ${where}
         GROUP BY ${col}, provider, model_id`,
      )
      .all(params);
    return rows.map((r) => ({ key: r.key as string, ...toSums(r) }));
  }

  /**
   * Raw success-rate counts per Model (paired reference) (completed / non-aborted requests):
   * powers the cost center's "Model Success Rate" chart. The denominator excludes aborted
   * (user-initiated interruption); failure breakdowns (failed / timeout / malformed) are
   * also returned for hover display. Unknown statuses aren't broken out but still count
   * toward the denominator (conservative: anything non-completed counts as a failure).
   */
  statusByModel(projectId: string, f: UsageFilter = {}): UsageStatusCount[] {
    const { where, params } = this.conds(projectId, f);
    const count = (status: string) =>
      `COALESCE(SUM(CASE WHEN status = '${status}' THEN 1 ELSE 0 END), 0) AS ${status}`;
    const rows = this.db
      .prepare(
        `SELECT provider, model_id,
                ${count("completed")},
                ${count("aborted")},
                ${count("failed")},
                ${count("timeout")},
                ${count("malformed")},
                COALESCE(SUM(CASE WHEN status <> 'aborted' THEN 1 ELSE 0 END), 0) AS total
         FROM usage_records WHERE ${where} GROUP BY provider, model_id`,
      )
      .all(params);
    return rows.map((r) => ({
      provider: r.provider as string,
      modelId: r.model_id as string,
      completed: r.completed as number,
      total: r.total as number,
      aborted: r.aborted as number,
      failed: r.failed as number,
      timeout: r.timeout as number,
      malformed: r.malformed as number,
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
