/**
 * The archive page (Settings › Archived chats, `/api/me/archived-sessions*`): every archived
 * Session of every Project the user can open, grouped by Workspace under its Project, and the
 * two batches that act on them — unarchive, and delete.
 *
 * "Archived" is the listing rule's answer (runtime/session-sources.ts listCategory): a Session
 * the user archived, or one a program opened (`api` / `schedule` / `cli`) that the user has not
 * kept. Classification is the Session list's own (SessionService.archivedRows walks what
 * listSessions serves with `category: "archived"`), so the page and the sidebar can never
 * disagree about a row; an organization's rows are left out exactly as the sidebar leaves them
 * out (`excludeOrg`), and a `subagent` or `company` Session is in no list at all.
 *
 * The listing is computed on demand from the index rows the server already holds in SQLite and
 * the source registry; nothing is cached here, and a batch re-reads what it acts on. Filtering,
 * grouping and paging work on the classified rows, and only the rows a page returns become a
 * SessionInfo — a page of ten costs ten of those, however many Sessions are archived.
 */
import type {
  ArchivedSessionGroup,
  ArchivedSessionGroupsResponse,
  ArchivedSessionSource,
  ArchivedSessionsBatch,
  ArchivedSessionsBatchFilter,
  ArchivedSessionsBatchResponse,
  ArchivedSessionsQuery,
  ArchivedSessionsResponse,
  ProjectSummary,
  ServerEvent,
  SessionCategory,
  SessionInfo,
  SessionSource,
  SessionStatus,
} from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { HttpError } from "../http/errors.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndexStore } from "../mechanisms/traces.js";
import { compareActivityDesc } from "./session-service.js";
import type { ActivityCursor, ArchivedRow } from "./session-service.js";
import { TEMP_WORKSPACE_GROUP, isTempWorkspace, matchesWorkspaceGroup } from "./workspace-group.js";

/** What the archive page reaches. */
export interface ArchivedSessionsDeps {
  /** The Projects the user owns or is a member of, with their display names. */
  listProjects(userId: string): Promise<ProjectSummary[]>;
  /** Whether the user may open the Project (owner or member). */
  canAccess(userId: string, projectId: string): boolean;
  sessions: Pick<SessionIndex, "listByProject" | "findById" | "setListing">;
  sessionService: {
    /** One Agent's archived rows, classified as the Session list classifies them. */
    archivedRows(projectId: string, agentId: string): Promise<ArchivedRow[]>;
    /** One row as the Session list serves it: made only for the rows a page returns. */
    toInfo(row: SessionRow, hasTrace: boolean): Promise<SessionInfo>;
    listingOf(row: SessionRow): Promise<SessionCategory | null>;
  };
  /** The Trace index's per-Session facts: the first-prompt title of a row that has none. */
  traceStore: Pick<TraceIndexStore, "listSessionsByAgent">;
  /** Deletes one Session the way DELETE /api/sessions/:id does (children and events included). */
  deleteSession(row: SessionRow): Promise<void>;
  /** A Session's run status: a filter's delete leaves a running one alone. */
  statusOf(sessionId: string): SessionStatus;
  notifyProjectUsers(projectId: string, event: ServerEvent): void;
  /** The clock the keep mark and the groups' `asOf` are read from (tests pin it). */
  now?: () => string;
}

/** An archived Session as the page lists it: its row as classified, its title, and its group. */
interface ArchivedEntry extends ArchivedRow {
  /** The row's own title, else its Trace's first-prompt title; null when it has neither. */
  title: string | null;
  projectName: string;
  /** The group's Workspace: the path, or TEMP_WORKSPACE_GROUP for the merged temporary ones. */
  workspace: string;
}

/** The group a Workspace path falls in: itself, or the merged temporary group. */
function groupOf(workspace: string): string {
  return isTempWorkspace(workspace) ? TEMP_WORKSPACE_GROUP : workspace.trim();
}

/**
 * The archive page's source of a Session: `user` for a conversation archived by hand — a
 * person's, or one whose Trace has not been read yet, which lists as a person's — and the
 * program's source otherwise.
 */
function archivedSourceOf(source: SessionSource | undefined): ArchivedSessionSource {
  return source === "api" || source === "schedule" || source === "cli" || source === "workbench"
    ? source
    : "user";
}

/**
 * Whether a group's count taken at `until` saw this archived row, and nothing has happened to it
 * since: archived by then — by hand at `archivedAt`, or by the rule since it was created — and
 * not active after it. A Session archived, created or run after the snapshot is left alone.
 */
function countedBy(row: SessionRow, until: string): boolean {
  const at = Date.parse(until);
  return Date.parse(row.archivedAt ?? row.createdAt) <= at && Date.parse(row.lastActiveAt) <= at;
}

export class ArchivedSessionsService {
  constructor(private readonly deps: ArchivedSessionsDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  /** The groups holding archived Sessions that match, newest activity first, with their counts. */
  async groups(
    userId: string,
    query: ArchivedSessionsQuery,
  ): Promise<ArchivedSessionGroupsResponse> {
    // Read before the rows: every row the counts include was archived by this time.
    const asOf = this.now();
    const entries = await this.matching(userId, query);
    const byKey = new Map<string, ArchivedSessionGroup>();
    for (const { row, projectName, workspace } of entries) {
      const key = `${row.projectId}\0${workspace}`;
      const group = byKey.get(key);
      if (group === undefined) {
        byKey.set(key, {
          projectId: row.projectId,
          projectName,
          workspace,
          count: 1,
          latest: row.lastActiveAt,
        });
        continue;
      }
      group.count += 1;
      if (row.lastActiveAt > group.latest) group.latest = row.lastActiveAt;
    }
    const groups = [...byKey.values()].sort((a, b) => {
      if (a.latest !== b.latest) return a.latest > b.latest ? -1 : 1;
      if (a.projectId !== b.projectId) return a.projectId < b.projectId ? -1 : 1;
      return a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : 0;
    });
    return { groups, total: entries.length, asOf };
  }

  /**
   * One group's page, newest activity first (the Session list's activity order and cursor):
   * the rows strictly below `before`, at most `limit` of them — the only ones made into a
   * SessionInfo, with the Trace's first-prompt title on a row that has none of its own.
   */
  async rows(
    userId: string,
    query: ArchivedSessionsQuery & {
      projectId: string;
      workspace: string;
      limit: number;
      before?: ActivityCursor;
    },
  ): Promise<ArchivedSessionsResponse> {
    const { before, limit } = query;
    const sorted = (await this.matching(userId, query)).sort((a, b) =>
      compareActivityDesc(a.row, b.row),
    );
    const below =
      before === undefined ? sorted : sorted.filter((e) => compareActivityDesc(e.row, before) > 0);
    const sessions = await Promise.all(
      below.slice(0, limit).map(async (entry) => {
        const session = await this.deps.sessionService.toInfo(entry.row, entry.hasTrace);
        return session.title === undefined && entry.title !== null
          ? { ...session, title: entry.title }
          : session;
      }),
    );
    return { sessions, hasMore: below.length > limit };
  }

  /**
   * Unarchives what the target names: each one that is archived gets the keep mark (and loses
   * its archive mark), so it is listed among the user's conversations from now on, through
   * every later run. A named Session that is not archived is left alone and not counted.
   */
  async unarchive(
    userId: string,
    target: ArchivedSessionsBatch,
  ): Promise<ArchivedSessionsBatchResponse> {
    const { rows, missing } = await this.resolve(userId, target);
    const archived: SessionRow[] = [];
    for (const row of rows) {
      if ((await this.deps.sessionService.listingOf(row)) === "archived") archived.push(row);
    }
    if (archived.length > 0) {
      const at = this.now();
      this.deps.sessions.setListing(
        archived.map((row) => row.sessionId),
        "kept",
        at,
      );
    }
    for (const row of archived) {
      this.deps.notifyProjectUsers(row.projectId, {
        type: "session_archived",
        sessionId: row.sessionId,
        projectId: row.projectId,
        agentId: row.agentId,
        archived: false,
      });
    }
    return { done: archived.length, missing };
  }

  /**
   * Deletes what the target names, one Session after another down the single-Session path, so
   * its subagent children go with it. A Session named by id that is running is aborted first;
   * a filter — a whole group — leaves a running one alone, since nobody named it, and does not
   * count it. A named Session already deleted as another's child counts as done.
   */
  async delete(
    userId: string,
    target: ArchivedSessionsBatch,
  ): Promise<ArchivedSessionsBatchResponse> {
    const { rows, missing } = await this.resolve(userId, target);
    const named = "sessionIds" in target;
    let done = 0;
    for (const row of rows) {
      const current = this.deps.sessions.findById(row.sessionId);
      if (current !== null) {
        if (!named && this.deps.statusOf(current.sessionId) !== "idle") continue;
        await this.deps.deleteSession(current);
      }
      done += 1;
    }
    return { done, missing };
  }

  /**
   * The rows a batch acts on. The ids form looks each one up and keeps the ones the user can
   * open, reporting the rest as missing (an id never says whether a Session the user cannot
   * open exists). The filter form expands to the archived rows it matches, as the listing
   * shows them — as its `until` count saw them, without the ones it `exclude`s.
   */
  private async resolve(
    userId: string,
    target: ArchivedSessionsBatch,
  ): Promise<{ rows: SessionRow[]; missing: string[] }> {
    const rows: SessionRow[] = [];
    const missing: string[] = [];
    if ("sessionIds" in target) {
      for (const sessionId of new Set(target.sessionIds)) {
        const row = this.deps.sessions.findById(sessionId);
        if (row === null || !this.deps.canAccess(userId, row.projectId)) missing.push(sessionId);
        else rows.push(row);
      }
      return { rows, missing };
    }
    const { until } = target.filter;
    // Rows unticked after the group was chosen whole stay where they are.
    const excluded = new Set(target.filter.exclude);
    for (const { row: listed } of await this.matching(userId, target.filter)) {
      if (excluded.has(listed.sessionId)) continue;
      const row = this.deps.sessions.findById(listed.sessionId);
      if (row !== null && (until === undefined || countedBy(row, until))) rows.push(row);
    }
    return { rows, missing };
  }

  /** Every archived Session the query matches, across the Projects it covers. */
  private async matching(
    userId: string,
    query: ArchivedSessionsBatchFilter,
  ): Promise<ArchivedEntry[]> {
    const q = query.q?.trim().toLowerCase() ?? "";
    const out: ArchivedEntry[] = [];
    for (const project of await this.projectsFor(userId, query.projectId)) {
      const projectName = project.name ?? project.projectId;
      for (const entry of await this.archivedOf(project.projectId, projectName)) {
        if (query.source !== undefined && archivedSourceOf(entry.source) !== query.source) {
          continue;
        }
        if (q !== "" && !(entry.title ?? "").toLowerCase().includes(q)) continue;
        if (
          query.workspace !== undefined &&
          !matchesWorkspaceGroup(entry.row.workspace, query.workspace)
        ) {
          continue;
        }
        out.push(entry);
      }
    }
    return out;
  }

  /** The Projects a query covers: one the user can open (404 otherwise), or all of theirs. */
  private async projectsFor(
    userId: string,
    projectId: string | undefined,
  ): Promise<ProjectSummary[]> {
    const projects = await this.deps.listProjects(userId);
    if (projectId === undefined) return projects;
    const project = projects.find((p) => p.projectId === projectId);
    if (project === undefined) {
      throw new HttpError(
        404,
        "project_not_found",
        "Project does not exist or you do not have access.",
      );
    }
    return [project];
  }

  /**
   * One Project's archived Sessions, the user's own conversations only, each titled by its row
   * or, when the row has no title, by its Trace's first prompt (the Agent Traces listing's
   * fallback), so a search can find an untitled conversation by what it asked.
   */
  private async archivedOf(projectId: string, projectName: string): Promise<ArchivedEntry[]> {
    const agentIds = new Set(this.deps.sessions.listByProject(projectId).map((r) => r.agentId));
    const out: ArchivedEntry[] = [];
    for (const agentId of agentIds) {
      const archived = await this.deps.sessionService.archivedRows(projectId, agentId);
      if (archived.length === 0) continue;
      const titles = archived.some((a) => a.row.title === null)
        ? new Map(
            this.deps.traceStore
              .listSessionsByAgent(projectId, agentId)
              .map((facts) => [facts.sessionId, facts.title]),
          )
        : null;
      for (const entry of archived) {
        out.push({
          ...entry,
          title: entry.row.title ?? titles?.get(entry.row.sessionId) ?? null,
          projectName,
          workspace: groupOf(entry.row.workspace),
        });
      }
    }
    return out;
  }
}
