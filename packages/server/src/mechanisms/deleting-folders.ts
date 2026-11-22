/**
 * Removing a folder of the data root the way an Agent deletion removes its Agent's: one rename
 * moves it aside, and its contents are removed from there in the background. Declared apart from
 * what implements it (services/deleting-folders.ts).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/**
 * Where a folder waits while its contents are removed: its Project's deleting folder
 * (`agents/.deleting/`, where a deleted Agent's folder waits too), or a deleting folder beside
 * the entries of a folder outside every Project (`<within>/.deleting/`).
 */
export type DeletingPlace = { projectId: string } | { within: string };

/** DeletingFolders: the mechanism DeletingFoldersService implements. */
@Interface()
export abstract class DeletingFolders {
  /**
   * Moves `abs` aside in one synchronous rename, under a unique name that starts with `label`
   * (kept to the id alphabet), and answers where it now is; null when nothing is at `abs`. Any
   * other failure throws, with nothing moved. Synchronous so that a caller can check that the
   * folder may go and move it in one step: no Task can start in between, and one that starts
   * afterwards finds the folder gone and never writes into a folder being removed.
   */
  abstract moveAside(abs: string, place: DeletingPlace, label: string): string | null;
  /**
   * Removes the moved folders' contents in the background, one after another, through the
   * server's filesystem throttle; resolves when all are done. What could not be removed is logged
   * and stays where it waits: a Project's deleting folder is removed again at every start, a
   * `within` one by {@link resume}.
   */
  abstract purge(moved: readonly string[]): Promise<void>;
  /** Removes what an earlier process left in `within`'s deleting folder. */
  abstract resume(within: string): Promise<void>;
  /** `within`'s deleting folder: an entry of it that is not one of its own. */
  abstract deletingDirIn(within: string): string;
}
