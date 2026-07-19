/**
 * agents table repo: Agent index; name/description live in system_config.yaml.
 */
import type { DatabaseSync } from "node:sqlite";

export interface AgentRow {
  projectId: string;
  agentId: string;
  createdAt: string;
}

export class AgentsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Idempotent insert: backfills an untracked Agent discovered via directory scan; shared with explicit creation. */
  insertOrIgnore(row: AgentRow): void {
    this.db
      .prepare("INSERT OR IGNORE INTO agents (project_id, agent_id, created_at) VALUES (?, ?, ?)")
      .run(row.projectId, row.agentId, row.createdAt);
  }

  exists(projectId: string, agentId: string): boolean {
    const r = this.db
      .prepare("SELECT 1 AS x FROM agents WHERE project_id = ? AND agent_id = ?")
      .get(projectId, agentId);
    return r !== undefined;
  }

  list(projectId: string): AgentRow[] {
    const rows = this.db
      .prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY created_at ASC, agent_id ASC")
      .all(projectId);
    return rows.map((r) => ({
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      createdAt: r.created_at as string,
    }));
  }

  delete(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM agents WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM agents WHERE project_id = ?").run(projectId);
  }
}
