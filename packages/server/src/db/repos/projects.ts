/**
 * Repo for the projects table: an index of ownership
 * relationships; the display name lives in project_config.toml.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ProjectRole } from "../../api/types.js";

export interface ProjectRow {
  projectId: string;
  ownerUserId: string;
  createdAt: string;
}

export interface AccessibleProjectRow extends ProjectRow {
  role: ProjectRole;
}

function mapRow(r: Record<string, unknown>): ProjectRow {
  return {
    projectId: r.project_id as string,
    ownerUserId: r.owner_user_id as string,
    createdAt: r.created_at as string,
  };
}

export class ProjectsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: ProjectRow): void {
    this.db
      .prepare("INSERT INTO projects (project_id, owner_user_id, created_at) VALUES (?, ?, ?)")
      .run(row.projectId, row.ownerUserId, row.createdAt);
  }

  findById(projectId: string): ProjectRow | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId);
    return r ? mapRow(r) : null;
  }

  /** All Projects (used by the scheduler's reconciliation scan), ascending by creation time. */
  listAll(): ProjectRow[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY created_at ASC, project_id ASC")
      .all();
    return rows.map((r) => mapRow(r as Record<string, unknown>));
  }

  /** Projects owned by or shared with the current user (including their role), ascending by creation time. */
  listAccessible(userId: string): AccessibleProjectRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.project_id, p.owner_user_id, p.created_at,
                CASE WHEN p.owner_user_id = :uid THEN 'owner' ELSE 'member' END AS role
         FROM projects p
         WHERE p.owner_user_id = :uid
            OR EXISTS (SELECT 1 FROM project_members m
                       WHERE m.project_id = p.project_id AND m.user_id = :uid)
         ORDER BY p.created_at ASC, p.project_id ASC`,
      )
      .all({ uid: userId });
    return rows.map((r) => ({
      ...mapRow(r),
      role: r.role as ProjectRole,
    }));
  }

  /** All Projects owned by a given user (used for cascading cleanup when an admin deletes a user). */
  listByOwner(userId: string): ProjectRow[] {
    const rows = this.db
      .prepare("SELECT * FROM projects WHERE owner_user_id = ? ORDER BY created_at ASC")
      .all(userId);
    return rows.map(mapRow);
  }

  delete(projectId: string): void {
    this.db.prepare("DELETE FROM projects WHERE project_id = ?").run(projectId);
  }
}
