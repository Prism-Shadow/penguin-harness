import type { DatabaseSync } from "node:sqlite";
import type { PromotionRunInfo, PromotionRunStatus } from "../../api/types.js";

export interface PromotionRunRow extends PromotionRunInfo {
  projectId: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  requestHash: string;
}

function mapRow(r: Record<string, unknown>): PromotionRunRow {
  return {
    optimizationSessionId: r.optimization_session_id as string,
    projectId: r.project_id as string,
    testAgentId: r.test_agent_id as string,
    developmentBenchmarkId: r.development_benchmark_id as string,
    promotionBenchmarkId: r.promotion_benchmark_id as string,
    productionReferenceVersion: Number(r.production_reference_version),
    candidateVersion: Number(r.candidate_version),
    provider: r.provider as string,
    modelId: r.model_id as string,
    thinkingLevel: r.thinking_level as string,
    requestHash: r.request_hash as string,
    status: r.status as PromotionRunStatus,
    ...((r.promotion_session_id as string | null) !== null
      ? { promotionSessionId: r.promotion_session_id as string }
      : {}),
    ...((r.error_code as string | null) !== null ? { errorCode: r.error_code as string } : {}),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export class PromotionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  find(optimizationSessionId: string): PromotionRunRow | null {
    const row = this.db
      .prepare("SELECT * FROM promotion_runs WHERE optimization_session_id = ?")
      .get(optimizationSessionId);
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  findByPromotionSession(sessionId: string): PromotionRunRow | null {
    const row = this.db
      .prepare("SELECT * FROM promotion_runs WHERE promotion_session_id = ?")
      .get(sessionId);
    return row ? mapRow(row as Record<string, unknown>) : null;
  }

  listByAgent(projectId: string, agentId: string): PromotionRunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM promotion_runs
         WHERE project_id = ? AND test_agent_id = ?
         ORDER BY updated_at DESC, optimization_session_id DESC`,
      )
      .all(projectId, agentId)
      .map((row) => mapRow(row as Record<string, unknown>));
  }

  listUnfinished(): PromotionRunRow[] {
    return this.db
      .prepare("SELECT * FROM promotion_runs WHERE status IN ('queued', 'running')")
      .all()
      .map((row) => mapRow(row as Record<string, unknown>));
  }

  insert(row: PromotionRunRow): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO promotion_runs
          (optimization_session_id, project_id, test_agent_id, development_benchmark_id,
           promotion_benchmark_id, production_reference_version, candidate_version,
           provider, model_id, thinking_level, request_hash, status,
           promotion_session_id, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.optimizationSessionId,
        row.projectId,
        row.testAgentId,
        row.developmentBenchmarkId,
        row.promotionBenchmarkId,
        row.productionReferenceVersion,
        row.candidateVersion,
        row.provider,
        row.modelId,
        row.thinkingLevel,
        row.requestHash,
        row.status,
        row.promotionSessionId ?? null,
        row.errorCode ?? null,
        row.createdAt,
        row.updatedAt,
      );
    return Number(result.changes) === 1;
  }

  markRunning(optimizationSessionId: string, sessionId: string, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE promotion_runs
         SET status = 'running', promotion_session_id = ?, error_code = NULL, updated_at = ?
         WHERE optimization_session_id = ? AND status = 'queued'`,
      )
      .run(sessionId, updatedAt, optimizationSessionId);
  }

  markTerminal(
    optimizationSessionId: string,
    status: Extract<PromotionRunStatus, "promoted" | "restored" | "failed">,
    updatedAt: string,
    errorCode?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE promotion_runs
         SET status = ?, error_code = ?, updated_at = ?
         WHERE optimization_session_id = ?`,
      )
      .run(status, errorCode ?? null, updatedAt, optimizationSessionId);
  }
}
