/**
 * Workspace GROUPS of the session list — the unit the sidebar draws one folder per, and
 * the unit its paging runs in.
 *
 * There is no Workspace entity: a Session carries the plain filesystem path locked in at
 * creation, so a group is identified by that path. The one exception is the Sessions
 * created without an explicit Workspace: core auto-creates a single-use directory shaped
 * `<agentDir>/workspaces/tmp-<8hex>` for each of them (createTempWorkspace in
 * packages/core/src/internal/session-support.ts), so per-path groups would be one-session
 * noise — every such path belongs to ONE merged group, named by the sentinel below.
 */

/**
 * Query value naming the merged temporary-workspace group. Stored Workspaces are realpath
 * results and therefore absolute, so a bare word can never collide with one.
 */
export const TEMP_WORKSPACE_GROUP = "temp";

/** Auto-created temporary Workspace tail: `workspaces/tmp-<8hex>` (either separator — core supports win32). */
const TEMP_WORKSPACE_RE = /[/\\]workspaces[/\\]tmp-[0-9a-f]{8}$/;

/** Whether a Session's Workspace is one of core's auto-created temporary directories. */
export function isTempWorkspace(workspace: string): boolean {
  const path = workspace.trim();
  // An empty path counts as temporary: the resolved path is always backfilled, so this is
  // defensive only.
  return path === "" || TEMP_WORKSPACE_RE.test(path);
}

/** Whether a Session's Workspace belongs to the requested group (see TEMP_WORKSPACE_GROUP). */
export function matchesWorkspaceGroup(workspace: string, group: string): boolean {
  return group === TEMP_WORKSPACE_GROUP
    ? isTempWorkspace(workspace)
    : workspace.trim() === group.trim();
}
