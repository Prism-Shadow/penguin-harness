/**
 * project_data_migrations table repo: the one-time migrations of a Project's files this server
 * has begun and finished, one row per migration and Project. When a migration begins or finishes
 * is the server's; this only stores and reads the rows. Built outside a tree too (`wire`): the
 * migrations run while a generation boots, before its module tree exists.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "@prismshadow/penguin-library-db";
import type { ProjectDataMigrationRow, ProjectDataMigrations } from "../project-data-migrations.js";

@Component()
export class ProjectDataMigrationsRepo implements ProjectDataMigrations {
  @Use() private readonly db!: Db;

  get(name: string, projectId: string): ProjectDataMigrationRow | null {
    const row = this.db
      .prepare(
        "SELECT begun_at, finished_at FROM project_data_migrations WHERE name = ? AND project_id = ?",
      )
      .get(name, projectId) as { begun_at: string; finished_at: string | null } | undefined;
    return row === undefined ? null : { begunAt: row.begun_at, finishedAt: row.finished_at };
  }

  begin(name: string, projectId: string, at: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO project_data_migrations (name, project_id, begun_at) VALUES (?, ?, ?)",
      )
      .run(name, projectId, at);
  }

  finish(name: string, projectId: string, at: string): void {
    this.begin(name, projectId, at);
    this.db
      .prepare(
        "UPDATE project_data_migrations SET finished_at = ? WHERE name = ? AND project_id = ? AND finished_at IS NULL",
      )
      .run(at, name, projectId);
  }
}
