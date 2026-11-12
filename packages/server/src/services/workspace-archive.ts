/**
 * Archiving a whole Workspace group: the sidebar's "delete workspace"
 * (`POST /api/projects/:projectId/sessions/archive`).
 *
 * The group's rows are exactly the ones the sidebar lists under it — the Session list's
 * `category: "active"`, `excludeOrg` rows of every Agent of the Project, narrowed to one
 * Workspace group (workspace-group.ts) — loaded on a page or not. A subagent or company
 * Session, an organization's row and a row already archived are never among them.
 *
 * Each one is archived as `PATCH /api/sessions/:id {archived: true}` archives it: the archive
 * mark is written and the keep mark cleared, and the Project's users hear `session_archived`
 * for it. A running Session is archived and keeps running; nothing is aborted and no Trace is
 * written. The marks are one write on this server's index, so the call archives every row or,
 * failing, none.
 */
import type { ServerEvent } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { ListingView } from "../runtime/session-sources.js";
import { matchesWorkspaceGroup } from "./workspace-group.js";

/** What archiving a Workspace group reaches. */
export interface WorkspaceArchiveDeps {
  sessions: Pick<SessionIndex, "listByProject" | "setListing">;
  /** One Agent's active rows, classified as the Session list classifies them for `view`. */
  activeRows(projectId: string, agentId: string, view: ListingView): Promise<SessionRow[]>;
  notifyProjectUsers(projectId: string, event: ServerEvent): void;
  /** The clock the archive mark is read from (tests pin it). */
  now?: () => string;
}

/**
 * Archives every active Session of one Workspace group in a Project (`workspaceGroup` is a path,
 * or the merged temporary group's `temp`, as the list's filter takes it) and returns how many
 * it archived; 0 when none matched, with nothing written or announced.
 */
export async function archiveWorkspaceGroup(
  deps: WorkspaceArchiveDeps,
  projectId: string,
  workspaceGroup: string,
  view: ListingView,
): Promise<number> {
  const agentIds = new Set(deps.sessions.listByProject(projectId).map((row) => row.agentId));
  const matched: SessionRow[] = [];
  for (const agentId of agentIds) {
    for (const row of await deps.activeRows(projectId, agentId, view)) {
      if (matchesWorkspaceGroup(row.workspace, workspaceGroup)) matched.push(row);
    }
  }
  if (matched.length === 0) return 0;
  const at = deps.now?.() ?? new Date().toISOString();
  deps.sessions.setListing(
    matched.map((row) => row.sessionId),
    "archived",
    at,
  );
  for (const row of matched) {
    deps.notifyProjectUsers(projectId, {
      type: "session_archived",
      sessionId: row.sessionId,
      projectId,
      agentId: row.agentId,
      archived: true,
    });
  }
  return matched.length;
}
