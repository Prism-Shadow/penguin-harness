/**
 * The record of the one-time migrations of a Project's files this server has run: one row per
 * migration and Project, begun before the migration's first change to the Project's files and
 * finished after its last. A finished row is never run again, so what a user changes afterwards
 * stands; a row only begun is a run that stopped part-way, which the next boot resumes from what
 * it finds on disk. Kept with the migrations that write it, until 1.0.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** One migration's progress in one Project. */
export interface ProjectDataMigrationRow {
  begunAt: string;
  /** Null until the migration is done in this Project. */
  finishedAt: string | null;
}

/** ProjectDataMigrations: the mechanism ProjectDataMigrationsRepo implements. */
@Interface()
export abstract class ProjectDataMigrations {
  /** How far `name` got in `projectId`; null when it never began there. */
  abstract get(name: string, projectId: string): ProjectDataMigrationRow | null;
  /** Records that `name` began in `projectId`; a row already there keeps its time. */
  abstract begin(name: string, projectId: string, at: string): void;
  /** Records that `name` is done in `projectId`, beginning it first where it never began. */
  abstract finish(name: string, projectId: string, at: string): void;
}
