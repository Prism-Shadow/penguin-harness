/**
 * Workspace GROUPS of the session list — the unit the sidebar draws one folder per, and
 * the unit its paging runs in.
 *
 * There is no Workspace entity: a Session carries the plain filesystem path locked in at
 * creation, so a group is identified by that path. The one exception is the directories the
 * system makes for itself under an Agent's own `workspaces/`: the single-use
 * `<agentDir>/workspaces/tmp-<8hex>` core auto-creates for a Session started without an
 * explicit Workspace (createTempWorkspace in packages/core/src/internal/session-support.ts),
 * and the isolated Test Workspace the evaluation Skill creates there for every Case × Run,
 * which only ever holds that run's Test Session. Per-path groups for either would be
 * one-session noise — every such path belongs to ONE merged group, named by the sentinel
 * below. A directory the user picks lives elsewhere; only paths directly under an Agent's
 * `workspaces/` fold.
 */

/**
 * Query value naming the merged temporary-workspace group. Stored Workspaces are realpath
 * results and therefore absolute, so a bare word can never collide with one.
 */
export const TEMP_WORKSPACE_GROUP = "temp";

/** Auto-created temporary Workspace tail: `workspaces/tmp-<8hex>` (either separator — core supports win32). */
const TEMP_WORKSPACE_RE = /[/\\]workspaces[/\\]tmp-[0-9a-f]{8}$/;

/**
 * Any directory directly under an Agent's own `workspaces/` — `agents/<agent>/workspaces/<name>`
 * — which is where the evaluation Skill creates its isolated Test Workspaces (their names are
 * the Skill's own, so the parent is the rule, not a prefix). A directory below one of them is
 * not itself such a Workspace.
 */
const AGENT_WORKSPACES_RE = /[/\\]agents[/\\][^/\\]+[/\\]workspaces[/\\][^/\\]+$/;

/**
 * Whether a Session's Workspace is one the system made for itself: core's auto-created
 * temporary directory, or any directory directly under an Agent's `workspaces/` (the
 * evaluation Skill's Test Workspaces). Both fold into the merged temp group.
 */
export function isTempWorkspace(workspace: string): boolean {
  const path = workspace.trim();
  // An empty path counts as temporary: the resolved path is always backfilled, so this is
  // defensive only.
  return path === "" || TEMP_WORKSPACE_RE.test(path) || AGENT_WORKSPACES_RE.test(path);
}

/** Whether a Session's Workspace belongs to the requested group (see TEMP_WORKSPACE_GROUP). */
export function matchesWorkspaceGroup(workspace: string, group: string): boolean {
  return group === TEMP_WORKSPACE_GROUP
    ? isTempWorkspace(workspace)
    : workspace.trim() === group.trim();
}
