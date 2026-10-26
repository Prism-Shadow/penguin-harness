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
 *
 * An admin's page also lists the machines the user's Projects use: each connected one is asked
 * the same question through its own API (carrying this server's adoption time, so the Sessions
 * it held before this server adopted it come back as CLI tasks), and its groups join this
 * server's, marked with the machine. A group's page and a batch on it go to the machine it is on.
 * A machine that should have been asked and could not be is named in the answer, never dropped
 * in silence.
 */
import type {
  ArchivedSessionGroup,
  ArchivedSessionGroupServers,
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
import { HttpError, badRequest } from "../http/errors.js";
import type { ListingView } from "../runtime/session-sources.js";
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
    /** One Agent's archived rows, classified as the Session list classifies them for `view`. */
    archivedRows(projectId: string, agentId: string, view: ListingView): Promise<ArchivedRow[]>;
    /** One row as the Session list serves it: made only for the rows a page returns. */
    toInfo(row: SessionRow, hasTrace: boolean, view: ListingView): Promise<SessionInfo>;
    listingOf(row: SessionRow, view: ListingView): Promise<SessionCategory | null>;
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
  /**
   * The machines a Project uses, as an admin's page asks them. Absent: this server lists its own
   * Sessions only.
   */
  machines?: (projectId: string) => Promise<ArchiveMachine[]>;
}

/** Who asks: the user, whether machines are theirs to read, and who reads the listing rule. */
export interface ArchiveCaller {
  userId: string;
  /** Machines are an admin's: only an admin's page lists theirs, or acts on them. */
  isAdmin: boolean;
  /** A server that adopted this one asks with its adoption time (session-sources.ts sourceSeenBy). */
  view: ListingView;
}

/** One machine a Project uses, for the archive page. */
export interface ArchiveMachine {
  /** The machine's own id. */
  machineId: string;
  /** Its ssh alias, which the page writes after a group's Workspace. */
  alias: string;
  /** A call to its own API, carrying this server's adoption time; null while it is not connected. */
  request:
    | ((
        method: "GET" | "POST",
        path: string,
        body?: unknown,
      ) => Promise<{ status: number; text: string }>)
    | null;
}

/** A machine's answer, as the archive routes pass it on: its body, or its own refusal. */
function machineAnswer<T>(alias: string, answer: { status: number; text: string }): T {
  let body: unknown = null;
  try {
    body = JSON.parse(answer.text);
  } catch {
    // Not JSON: no answer of its server's, said below.
  }
  if (answer.status >= 200 && answer.status < 300 && body !== null) return body as T;
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (typeof error?.code === "string" && typeof error.message === "string") {
    throw new HttpError(answer.status, error.code, error.message);
  }
  throw new HttpError(
    502,
    "machine_unanswered",
    `${alias} answered ${answer.status} without saying why.`,
  );
}

/** A query's filters as a query string's parameters: what this server forwards to a machine. */
function queryParams(query: ArchivedSessionsQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set("q", query.q);
  if (query.source !== undefined) params.set("source", query.source);
  if (query.projectId !== undefined) params.set("projectId", query.projectId);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
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

  /**
   * The groups holding archived Sessions that match, newest activity first, with their counts —
   * this server's, and for an admin those of every machine the Projects in scope use. `servers`
   * narrows the answer to this server's groups (no machine is asked) or to the machines'.
   */
  async groups(
    caller: ArchiveCaller,
    query: ArchivedSessionsQuery,
    servers?: ArchivedSessionGroupServers,
  ): Promise<ArchivedSessionGroupsResponse> {
    // Read before the rows: every row the counts include was archived by this time.
    const asOf = this.now();
    const entries = servers === "machines" ? [] : await this.matching(caller, query);
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
    const remote =
      servers === "here"
        ? { groups: [], unreachable: [] }
        : await this.machineGroups(caller, query);
    const groups = [...byKey.values(), ...remote.groups].sort((a, b) => {
      if (a.latest !== b.latest) return a.latest > b.latest ? -1 : 1;
      if (a.projectId !== b.projectId) return a.projectId < b.projectId ? -1 : 1;
      const am = a.machineId ?? "";
      const bm = b.machineId ?? "";
      if (am !== bm) return am < bm ? -1 : 1;
      return a.workspace < b.workspace ? -1 : a.workspace > b.workspace ? 1 : 0;
    });
    const total = entries.length + remote.groups.reduce((sum, group) => sum + group.count, 0);
    return {
      groups,
      total,
      asOf,
      ...(remote.unreachable.length > 0 ? { unreachable: remote.unreachable } : {}),
    };
  }

  /**
   * The machines' groups: each machine every Project in scope uses, asked the same question about
   * that Project, its groups marked with the machine and the time it counted them. Only an
   * admin's page asks. A machine not connected, or one that does not answer, is named once.
   */
  private async machineGroups(
    caller: ArchiveCaller,
    query: ArchivedSessionsQuery,
  ): Promise<{
    groups: ArchivedSessionGroup[];
    unreachable: Array<{ machineId: string; alias: string }>;
  }> {
    const machinesOf = this.deps.machines;
    if (!caller.isAdmin || machinesOf === undefined) return { groups: [], unreachable: [] };
    const groups: ArchivedSessionGroup[] = [];
    const unreachable = new Map<string, string>();
    for (const project of await this.projectsFor(caller.userId, query.projectId)) {
      for (const machine of await machinesOf(project.projectId)) {
        if (machine.request === null) {
          unreachable.set(machine.machineId, machine.alias);
          continue;
        }
        let answer: { status: number; text: string };
        try {
          answer = await machine.request(
            "GET",
            `/api/me/archived-sessions/groups?${queryParams({ ...query, projectId: project.projectId })}`,
          );
        } catch {
          unreachable.set(machine.machineId, machine.alias);
          continue;
        }
        // The Project not there yet is a machine with nothing archived in it.
        if (answer.status === 404) continue;
        let theirs: ArchivedSessionGroupsResponse;
        try {
          theirs = machineAnswer<ArchivedSessionGroupsResponse>(machine.alias, answer);
        } catch {
          unreachable.set(machine.machineId, machine.alias);
          continue;
        }
        for (const group of theirs.groups) {
          if (group.projectId !== project.projectId) continue;
          groups.push({
            projectId: group.projectId,
            projectName: project.name ?? project.projectId,
            workspace: group.workspace,
            count: group.count,
            latest: group.latest,
            machineId: machine.machineId,
            machineAlias: machine.alias,
            asOf: theirs.asOf,
          });
        }
      }
    }
    return {
      groups,
      unreachable: [...unreachable].map(([machineId, alias]) => ({ machineId, alias })),
    };
  }

  /**
   * The machine a request names, for an admin, among the machines the Project uses (or, with no
   * Project, any Project in the user's reach), connected: its call. 404 `unknown_machine` when
   * it is none of those, 503 `not_connected` when it is not connected.
   */
  private async machineFor(
    caller: ArchiveCaller,
    machineId: string,
    projectId: string | undefined,
  ): Promise<{ alias: string; request: NonNullable<ArchiveMachine["request"]> }> {
    const unknown = () =>
      new HttpError(404, "unknown_machine", "No such machine in the Projects you can open.");
    const machinesOf = this.deps.machines;
    if (!caller.isAdmin || machinesOf === undefined) throw unknown();
    for (const project of await this.projectsFor(caller.userId, projectId)) {
      const machine = (await machinesOf(project.projectId)).find((m) => m.machineId === machineId);
      if (machine === undefined) continue;
      if (machine.request === null) {
        throw new HttpError(503, "not_connected", `${machine.alias} is not connected.`);
      }
      return { alias: machine.alias, request: machine.request };
    }
    throw unknown();
  }

  /**
   * One group's page, newest activity first (the Session list's activity order and cursor):
   * the rows strictly below `before`, at most `limit` of them — the only ones made into a
   * SessionInfo, with the Trace's first-prompt title on a row that has none of its own.
   */
  async rows(
    caller: ArchiveCaller,
    query: ArchivedSessionsQuery & {
      projectId: string;
      workspace: string;
      limit: number;
      before?: ActivityCursor;
      machineId?: string;
    },
  ): Promise<ArchivedSessionsResponse> {
    const { before, limit } = query;
    if (query.machineId !== undefined) {
      const machine = await this.machineFor(caller, query.machineId, query.projectId);
      const extra: Record<string, string> = { workspace: query.workspace, limit: String(limit) };
      if (before !== undefined) extra.before = `${before.lastActiveAt},${before.sessionId}`;
      return machineAnswer<ArchivedSessionsResponse>(
        machine.alias,
        await machine.request("GET", `/api/me/archived-sessions?${queryParams(query, extra)}`),
      );
    }
    const sorted = (await this.matching(caller, query)).sort((a, b) =>
      compareActivityDesc(a.row, b.row),
    );
    const below =
      before === undefined ? sorted : sorted.filter((e) => compareActivityDesc(e.row, before) > 0);
    const sessions = await Promise.all(
      below.slice(0, limit).map(async (entry) => {
        const session = await this.deps.sessionService.toInfo(
          entry.row,
          entry.hasTrace,
          caller.view,
        );
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
    caller: ArchiveCaller,
    target: ArchivedSessionsBatch,
  ): Promise<ArchivedSessionsBatchResponse> {
    if (target.machineId !== undefined) return this.onMachine(caller, target, "unarchive");
    const { rows, missing } = await this.resolve(caller, target);
    const archived: SessionRow[] = [];
    for (const row of rows) {
      if ((await this.deps.sessionService.listingOf(row, caller.view)) === "archived") {
        archived.push(row);
      }
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
    caller: ArchiveCaller,
    target: ArchivedSessionsBatch,
  ): Promise<ArchivedSessionsBatchResponse> {
    if (target.machineId !== undefined) return this.onMachine(caller, target, "delete");
    const { rows, missing } = await this.resolve(caller, target);
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
   * A batch on a machine: handed to that machine's own batch, which acts on its Sessions as it
   * would for its own page. A filter names the Project it is about (the group's), so the machine
   * is checked against that Project; ids are checked against every Project in the user's reach.
   */
  private async onMachine(
    caller: ArchiveCaller,
    target: ArchivedSessionsBatch,
    action: "unarchive" | "delete",
  ): Promise<ArchivedSessionsBatchResponse> {
    const projectId = "filter" in target ? target.filter.projectId : undefined;
    if ("filter" in target && projectId === undefined) {
      throw badRequest("A batch on a machine names its Project.");
    }
    const machine = await this.machineFor(caller, target.machineId!, projectId);
    const body =
      "sessionIds" in target ? { sessionIds: target.sessionIds } : { filter: target.filter };
    return machineAnswer<ArchivedSessionsBatchResponse>(
      machine.alias,
      await machine.request("POST", `/api/me/archived-sessions/${action}`, body),
    );
  }

  /**
   * The rows a batch acts on. The ids form looks each one up and keeps the ones the user can
   * open, reporting the rest as missing (an id never says whether a Session the user cannot
   * open exists). The filter form expands to the archived rows it matches, as the listing
   * shows them — as its `until` count saw them, without the ones it `exclude`s.
   */
  private async resolve(
    caller: ArchiveCaller,
    target: ArchivedSessionsBatch,
  ): Promise<{ rows: SessionRow[]; missing: string[] }> {
    const rows: SessionRow[] = [];
    const missing: string[] = [];
    if ("sessionIds" in target) {
      for (const sessionId of new Set(target.sessionIds)) {
        const row = this.deps.sessions.findById(sessionId);
        if (row === null || !this.deps.canAccess(caller.userId, row.projectId)) {
          missing.push(sessionId);
        } else rows.push(row);
      }
      return { rows, missing };
    }
    const { until } = target.filter;
    // Rows unticked after the group was chosen whole stay where they are.
    const excluded = new Set(target.filter.exclude);
    for (const { row: listed } of await this.matching(caller, target.filter)) {
      if (excluded.has(listed.sessionId)) continue;
      const row = this.deps.sessions.findById(listed.sessionId);
      if (row !== null && (until === undefined || countedBy(row, until))) rows.push(row);
    }
    return { rows, missing };
  }

  /** Every archived Session the query matches, across the Projects it covers. */
  private async matching(
    caller: ArchiveCaller,
    query: ArchivedSessionsBatchFilter,
  ): Promise<ArchivedEntry[]> {
    const q = query.q?.trim().toLowerCase() ?? "";
    const out: ArchivedEntry[] = [];
    for (const project of await this.projectsFor(caller.userId, query.projectId)) {
      const projectName = project.name ?? project.projectId;
      for (const entry of await this.archivedOf(project.projectId, projectName, caller.view)) {
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
  private async archivedOf(
    projectId: string,
    projectName: string,
    view: ListingView,
  ): Promise<ArchivedEntry[]> {
    const agentIds = new Set(this.deps.sessions.listByProject(projectId).map((r) => r.agentId));
    const out: ArchivedEntry[] = [];
    for (const agentId of agentIds) {
      const archived = await this.deps.sessionService.archivedRows(projectId, agentId, view);
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
