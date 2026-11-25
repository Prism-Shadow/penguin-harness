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
 *
 * The ports are structural: the rows, the listing view and the event are narrowed to what
 * archiving touches, so the caller hands in the sessions library's index, the session list's
 * row reader and the project library's event hub directly, without this package importing them.
 */
import { matchesWorkspaceGroup } from "./workspace-group.js";

/** A Session row narrowed to the fields archiving reads: its id, its Agent, its Workspace path. */
export interface ArchivableSessionRow {
  sessionId: string;
  agentId: string;
  workspace: string;
}

/**
 * Who is reading the rows, as far as the archive cares (the trace library's ListingView,
 * structurally): a server that adopted this one says when, and sees the Sessions held here
 * before then as CLI tasks.
 */
export interface WorkspaceListingView {
  adoptedAt?: string;
}

/**
 * The one event archiving announces, per archived Session, to the Project's users (the project
 * library's `session_archived` member, structurally).
 */
export interface SessionArchivedEvent {
  type: "session_archived";
  sessionId: string;
  projectId: string;
  agentId: string;
  archived: true;
}

/** What archiving a Workspace group reaches. */
export interface WorkspaceArchiveDeps {
  sessions: {
    listByProject(projectId: string): ArchivableSessionRow[];
    setListing(sessionIds: readonly string[], listing: "archived", at: string): void;
  };
  /** One Agent's active rows, classified as the Session list classifies them for `view`. */
  activeRows(
    projectId: string,
    agentId: string,
    view: WorkspaceListingView,
  ): Promise<ArchivableSessionRow[]>;
  notifyProjectUsers(projectId: string, event: SessionArchivedEvent): void;
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
  view: WorkspaceListingView,
): Promise<number> {
  const agentIds = new Set(deps.sessions.listByProject(projectId).map((row) => row.agentId));
  const matched: ArchivableSessionRow[] = [];
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
