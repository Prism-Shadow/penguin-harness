/**
 * The sidebar's "delete workspace" on one Workspace group (a directory on a machine): its active
 * conversations are archived on the server that holds them, in one request, and the group's
 * registry entry goes with its name. The files on disk are never touched; unarchiving any of the
 * conversations brings the group back, under its directory name.
 *
 * A group with no active conversations asks no server: only its registry entry is dropped, so a
 * registered Workspace on a machine that is not connected can still be removed. A failed request
 * changes nothing here, the entry included.
 */
import { ApiError } from "../../api/client";
import { workspaceGroupQuery } from "../../lib/session-grouping";

export interface DeleteWorkspaceTarget {
  /** workspaceGroupKey(path, machineId). */
  key: string;
  path: string;
  machineId: string | null;
  /** Active conversations the confirm dialog announced. */
  count: number;
}

export interface DeleteWorkspaceDeps {
  /** POST …/sessions/archive on the group's server; resolves to `done`. */
  archive: (workspaceGroup: string, machineId: string | null) => Promise<number>;
  /** Leaves the open conversation for a new chat when it is one of this group's. */
  leaveIfOpenIn: (key: string) => void;
  /** The store's archiveGroup. */
  archiveGroup: (key: string) => void;
  /** Drops the registry entry (no-op when the pair is not registered). */
  unregister: (path: string, machineId: string | null) => void;
}

export type DeleteWorkspaceOutcome = { ok: true; archived: number } | { ok: false; error: unknown };

export async function deleteWorkspaceGroup(
  target: DeleteWorkspaceTarget,
  deps: DeleteWorkspaceDeps,
): Promise<DeleteWorkspaceOutcome> {
  let archived = 0;
  if (target.count > 0) {
    try {
      archived = await deps.archive(workspaceGroupQuery(target.key), target.machineId);
    } catch (error) {
      return { ok: false, error };
    }
    // Leave first, so the page never paints the stub of a row it is about to drop (the single
    // archive's rule).
    deps.leaveIfOpenIn(target.key);
    deps.archiveGroup(target.key);
  }
  deps.unregister(target.path, target.machineId);
  return { ok: true, archived };
}

/**
 * Whether a failed delete was refused by a machine whose build predates the route: its 404 is
 * an unknown route, told apart from the Project it cannot open (`project_not_found`), and this
 * server's own groups are never one.
 */
export function isOutdatedMachine(error: unknown, machineId: string | null): boolean {
  return (
    machineId !== null &&
    error instanceof ApiError &&
    error.status === 404 &&
    error.code !== "project_not_found"
  );
}
