/**
 * Repo for the project_members table: only member
 * authorization relationships — the owner is never in this table.
 */
import type { DatabaseSync } from "node:sqlite";

export interface MemberRow {
  projectId: string;
  userId: string;
  createdAt: string;
}

export class MembersRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: MemberRow): void {
    this.db
      .prepare("INSERT INTO project_members (project_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(row.projectId, row.userId, row.createdAt);
  }

  isMember(projectId: string, userId: string): boolean {
    const r = this.db
      .prepare("SELECT 1 AS x FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(projectId, userId);
    return r !== undefined;
  }

  list(projectId: string): MemberRow[] {
    const rows = this.db
      .prepare(
        "SELECT project_id, user_id, created_at FROM project_members WHERE project_id = ? ORDER BY created_at ASC",
      )
      .all(projectId);
    return rows.map((r) => ({
      projectId: r.project_id as string,
      userId: r.user_id as string,
      createdAt: r.created_at as string,
    }));
  }

  delete(projectId: string, userId: string): void {
    this.db
      .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .run(projectId, userId);
  }
}
