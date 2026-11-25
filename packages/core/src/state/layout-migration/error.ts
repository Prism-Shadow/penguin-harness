/**
 * Why the data root's layout migration stopped. The message is the sentence a person reads —
 * the server prints it as its start failure, which the desktop app's start dialog and a
 * machine's start-failure state show — so it says what is wrong, that nothing was overwritten,
 * and what to do.
 */
export type LayoutMigrationCode =
  /** A Project is called `projects`, the name of the folder the new layout keeps its Projects in. */
  | "projects_id_collision"
  /** A Project's folder is both at its old place and under `projects/`. */
  | "project_folder_conflict"
  /** `<root>/projects` is a file. */
  | "projects_not_a_folder"
  /** The data root named is the Projects folder of another data root. */
  | "nested_data_root"
  /** A server holds the data root, and its layout is the old one: only it may move the folders. */
  | "server_holds_root"
  /** Another process is migrating the same data root. */
  | "migration_busy"
  /** The journal of an earlier run cannot be read. */
  | "journal_unreadable"
  /** Windows would not move a Project folder: a program has it, or a file in it, open. */
  | "folder_in_use"
  /** A step could not finish: a folder could not be moved or linked, a file not rewritten. */
  | "step_failed";

export class LayoutMigrationError extends Error {
  override readonly name = "LayoutMigrationError";
  constructor(
    readonly code: LayoutMigrationCode,
    message: string,
  ) {
    super(message);
  }
}
