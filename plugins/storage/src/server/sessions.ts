/**
 * The Storage page's list of Sessions by size and age: what the user can delete to free the
 * space their Traces hold.
 *
 * The Sessions are those of the Projects the user can open that the listing rule puts in a list
 * (active or archived — a subagent or company Session is in none, and goes with its parent). A
 * Session's size is its Trace files' bytes as the Trace index records them (reconciled first,
 * the way the Session lists reconcile), plus its scratchpad's bytes as the last measurement saw
 * them. Deleting is not here: the page sends the ids it chose to the archive page's batch delete,
 * which is the single-Session DELETE's path.
 */
import type { StorageSessionRow, StorageSessionsQuery, StorageSessionsResponse } from "../types.js";
import type { ProjectSummary } from "@prismshadow/penguin-server/api";
import { HttpError } from "@prismshadow/penguin-server/plugin";
import type {
  ListingView,
  SessionCategory,
  SessionIndex,
  SessionRow,
  TraceIndex,
  TraceIndexStore,
} from "@prismshadow/penguin-server/plugin";

/** Rows one answer holds: a page's batch delete takes as many. */
export const SESSIONS_LIST_MAX = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the list reaches. */
export interface StorageSessionsDeps {
  /** The Projects the user can open, with their display names. */
  listProjects(userId: string): Promise<ProjectSummary[]>;
  sessions: Pick<SessionIndex, "listByProject">;
  /** The listing rule's answer for a row (SessionService.listingOf). */
  listingOf(row: SessionRow, view: ListingView): Promise<SessionCategory | null>;
  traceIndex: Pick<TraceIndex, "reconcileProject">;
  traceStore: Pick<TraceIndexStore, "listFilesByAgent" | "listSessionsByAgent">;
  /** Whether a Session is in use now (SessionActivity.sessionInUse): the page does not offer it. */
  sessionInUse(sessionId: string): boolean;
  /** An Agent's display name (its id when it has none). */
  agentName(projectId: string, agentId: string): Promise<string>;
  /** A Session's scratchpad bytes as the last measurement saw them. */
  scratchpadBytes(projectId: string, agentId: string, sessionId: string): number | undefined;
  /** Wall clock, ms. */
  now(): number;
}

export class StorageSessionsService {
  constructor(private readonly deps: StorageSessionsDeps) {}

  async list(
    userId: string,
    query: StorageSessionsQuery,
    view: ListingView,
  ): Promise<StorageSessionsResponse> {
    const projects = await this.deps.listProjects(userId);
    const inScope =
      query.projectId === undefined
        ? projects
        : projects.filter((p) => p.projectId === query.projectId);
    if (query.projectId !== undefined && inScope.length === 0) {
      throw new HttpError(
        404,
        "project_not_found",
        "Project does not exist or you do not have access.",
      );
    }
    const listing = query.listing ?? "all";
    const cutoff =
      query.olderThanDays === undefined ? null : this.deps.now() - query.olderThanDays * DAY_MS;
    const matched: StorageSessionRow[] = [];
    for (const project of inScope) {
      await this.deps.traceIndex.reconcileProject(project.projectId);
      const rows = this.deps.sessions
        .listByProject(project.projectId)
        .filter((row) => query.agentId === undefined || row.agentId === query.agentId);
      const byAgent = new Map<string, SessionRow[]>();
      for (const row of rows) {
        const list = byAgent.get(row.agentId) ?? [];
        list.push(row);
        byAgent.set(row.agentId, list);
      }
      for (const [agentId, agentRows] of byAgent) {
        const traceBytes = new Map<string, number>();
        for (const file of this.deps.traceStore.listFilesByAgent(project.projectId, agentId)) {
          traceBytes.set(file.sessionId, (traceBytes.get(file.sessionId) ?? 0) + file.sizeBytes);
        }
        let titles: Map<string, string | null> | null = null;
        const agentName = await this.deps.agentName(project.projectId, agentId);
        for (const row of agentRows) {
          if (cutoff !== null && !(Date.parse(row.lastActiveAt) < cutoff)) continue;
          const category = await this.deps.listingOf(row, view);
          if (category === null) continue;
          if (listing !== "all" && listing !== category) continue;
          if (row.title === null && titles === null) {
            titles = new Map(
              this.deps.traceStore
                .listSessionsByAgent(project.projectId, agentId)
                .map((facts) => [facts.sessionId, facts.title]),
            );
          }
          const scratchpadBytes = this.deps.scratchpadBytes(
            project.projectId,
            agentId,
            row.sessionId,
          );
          matched.push({
            sessionId: row.sessionId,
            projectId: project.projectId,
            projectName: project.name ?? project.projectId,
            agentId,
            agentName,
            title: row.title ?? titles?.get(row.sessionId) ?? null,
            createdAt: row.createdAt,
            lastActiveAt: row.lastActiveAt,
            archived: category === "archived",
            running: this.deps.sessionInUse(row.sessionId),
            traceBytes: traceBytes.get(row.sessionId) ?? 0,
            ...(scratchpadBytes !== undefined ? { scratchpadBytes } : {}),
          });
        }
      }
    }
    const size = (row: StorageSessionRow) => row.traceBytes + (row.scratchpadBytes ?? 0);
    matched.sort((a, b) =>
      query.sort === "age"
        ? Date.parse(a.lastActiveAt) - Date.parse(b.lastActiveAt) ||
          (a.sessionId < b.sessionId ? -1 : 1)
        : size(b) - size(a) || (a.sessionId < b.sessionId ? -1 : 1),
    );
    return {
      sessions: matched.slice(0, SESSIONS_LIST_MAX),
      total: matched.length,
      totalBytes: matched.reduce((sum, row) => sum + size(row), 0),
      truncated: matched.length > SESSIONS_LIST_MAX,
    };
  }
}
