/**
 * The Task Manager's server module: the one route that answers the tree of what runs right now,
 * grouped the way a monitor reads it — machine → user → app → session → process — with each
 * level's Token total and each process's CPU and memory.
 *
 * It reaches the host only through the plugin face (`@prismshadow/penguin-server/plugin`) and
 * core's plugin subpath, both bundled into the plugin's dist (tsup.config.ts):
 * - the Agent listing, for each Project's Agents and the names they show;
 * - the Workbench listing, which carries each Workbench's page id (`WorkbenchInfo.pageId`) —
 *   the id its Sessions record as their `source`;
 * - the Session listing, every Session (whoever opened it) with its source and state, and the
 *   session runtime, for the tool calls it is executing, the approvals they wait for, and the
 *   background processes it started;
 * - the usage rows (`UsageStore`) and the priced totals (`UsageQueries`), for the Tokens and cost;
 * - the access rule, for which Projects the caller may see and who owns each.
 *
 * Nothing is kept between reads: the tree is what is running now, and a page that never opened a
 * Session costs one listing walk.
 */
import { Bind, Module, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx } from "@prismshadow/penguin-core/plugin";
import type { Hono } from "hono";
import {
  userChannelKey,
  type Access,
  type AgentLifecycle,
  type AppEnv,
  type Channels,
  type Clock,
  type Log,
  type SessionIndex,
  type SessionServiceIface,
  type Sessions,
  type UsageQueries,
  type UsageStore,
  type Workbenches,
} from "@prismshadow/penguin-server/plugin";
import { taskRoutes, type AgentSeed, type TaskRouteDeps } from "./routes.js";
import type { PageSeed, ProcessSeed, ProjectSeed, SessionSeed, UsageSeed } from "./tree.js";

/**
 * How far back the usage rows a page's total needs are read: a Session belongs to the page it
 * recorded as its source, and the usage table keeps every row it ever charged, so the window has to
 * cover any Session a page still lists — a year, longer than any Workbench has existed.
 */
const USAGE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The Task Manager page's server module, which the task-manager plugin adds to the platform tree:
 * it mounts `/api/me/tasks` and hands the route the host's own reads.
 */
@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "TaskManagerModule.routes",
        prefix: "/api/me/tasks",
        auth: "user",
        order: 278,
      },
    ],
  },
})
export class TaskManagerModule {
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly channels!: Channels;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly access!: Access;
  @Use() private readonly usageStore!: UsageStore;
  @Use() private readonly usageQueries!: UsageQueries;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Bind("TaskManagerModule.routes") routes!: Hono<AppEnv>;

  setup(_ctx: ClassCtx) {
    const log = this.log;
    const clock = this.clock;
    const workbenches = this.workbenches;
    const sessions = this.sessions;
    const sessionService = this.sessionService;
    const sessionsRepo = this.sessionsRepo;
    const channels = this.channels;
    const agents = this.agents;
    const access = this.access;
    const usageStore = this.usageStore;
    const usageQueries = this.usageQueries;

    /**
     * The name each Agent was last listed under, by `${projectId}/${agentId}`: the route lists a
     * Project's Agents before its pages and Sessions, so a page and a Session are named by the card
     * the same read gave. Empty until then, and the id stands in for it.
     */
    const names = new Map<string, string>();
    const nameOf = (projectId: string, agentId: string) =>
      names.get(`${projectId}/${agentId}`) ?? agentId;

    /**
     * One Project's Agents. A Project whose listing fails (an unreadable folder, a Project created
     * before anything else) contributes nothing rather than failing the whole tree: the task
     * manager is a view, and a view that hides one Project is better than none.
     */
    const agentsOf = async (projectId: string): Promise<AgentSeed[]> => {
      const listed = await agents.listAgents(projectId).catch((err: unknown) => {
        log.line(
          `[task-manager] ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      });
      return listed.map((row) => {
        names.set(`${projectId}/${row.agentId}`, row.name ?? row.agentId);
        return { agentId: row.agentId, name: row.name ?? row.agentId };
      });
    };

    const deps: TaskRouteDeps = {
      projectsOf: async (userId) =>
        (await access.listProjects(userId)).map((row): ProjectSeed => ({
          projectId: row.projectId,
          name: row.name ?? null,
          ownerUserId: row.ownerUserId,
        })),
      agentsOf,
      // Each workbench listed by the server carries its in-memory page id (`WorkbenchInfo.pageId`).
      pagesOf: async (projectId, agentId) => {
        const infos = await workbenches.list(projectId, agentId).catch((err: unknown) => {
          log.line(
            `[task-manager] ${projectId}/${agentId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        });
        const out: PageSeed[] = [];
        for (const info of infos) {
          if (info.pageId === undefined) continue;
          out.push({
            pageId: info.pageId,
            workbenchId: info.id,
            workbenchName: info.name,
            projectId,
            agentId,
            agentName: nameOf(projectId, agentId),
          });
        }
        return out;
      },
      // Every Session of the Agent, in any listing state: a page's Session stays the page's after
      // it is filed away, and its Tokens are still what the page cost. `listSessions` without a
      // category serves the whole list, each row with the source its Trace recorded.
      sessionsOf: async (projectId, agentId) => {
        const listed = await sessionService
          .listSessions(projectId, agentId, { order: "activity" })
          .catch((err: unknown) => {
            log.line(
              `[task-manager] ${projectId}/${agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
          });
        if (listed === null) return [];
        const archivedIds = new Set(
          sessionsRepo
            .listByAgent(projectId, agentId)
            .filter((row) => row.archivedAt !== null && row.archivedAt !== undefined)
            .map((row) => row.sessionId),
        );
        const out: SessionSeed[] = [];
        for (const info of listed.sessions) {
          if (archivedIds.has(info.sessionId)) continue;
          if (info.status === "idle") {
            if (info.source === "subagent") continue;
            if (
              info.archived &&
              !(info.source !== undefined && info.source.startsWith("page-"))
            ) {
              continue;
            }
          }
          out.push({
            sessionId: info.sessionId,
            projectId: info.projectId,
            agentId: info.agentId,
            agentName: nameOf(projectId, info.agentId),
            title: info.title ?? null,
            status: info.status,
            createdAt: info.createdAt,
            lastActiveAt: info.lastActiveAt,
            ...(info.source !== undefined ? { source: info.source } : {}),
            ...(info.archived ? { archived: true } : {}),
          });
        }
        return out;
      },
      toolCallsOf: (sessionId) => {
        const direct = sessions.listToolCalls(sessionId);
        const coveredSubagents = new Set(
          direct
            .map((c) => c.subagentSessionId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        );
        const bgSubagents = sessions
          .subagentsOf(sessionId)
          .filter((sub) => sub.running && !coveredSubagents.has(sub.sessionId))
          .map((sub) => {
            const subRow = sessionsRepo.findById(sub.sessionId);
            const handle = sub.subagentId ?? sub.sessionId;
            const parsedStart = subRow ? Date.parse(subRow.lastActiveAt) : Number.NaN;
            return {
              toolCallId: handle,
              name: "run_subagent",
              startedAtMs: Number.isFinite(parsedStart) ? parsedStart : clock.now().getTime(),
              detail: handle,
              ...(subRow?.title ? { description: subRow.title } : {}),
              subagentSessionId: sub.sessionId,
            };
          });
        return [...direct, ...bgSubagents];
      },
      pendingOf: (sessionId) => sessions.pendingApprovals(sessionId),
      processesOf: (sessionId) => sessions.listProcesses(sessionId) as ProcessSeed[],
      canAccessSession: (userId, sessionId) => {
        const row = sessionsRepo.findById(sessionId);
        return row !== null && access.canAccess(userId, row.projectId);
      },
      killSession: (userId, sessionId) => {
        const row = sessionsRepo.findById(sessionId);
        if (!row || !access.canAccess(userId, row.projectId)) return false;
        for (const pending of sessions.pendingApprovals(sessionId)) {
          sessions.decideApproval(sessionId, pending.toolCall.payload.tool_call_id, "deny");
        }
        sessions.abortTask(sessionId);
        for (const proc of sessions.listProcesses(sessionId)) {
          if (proc.running) sessions.killProcess(sessionId, proc.processId);
        }
        for (const sub of sessions.subagentsOf(sessionId)) {
          if (sub.running) sessions.abortSubagentRun(sessionId, sub.sessionId);
        }
        const at = clock.now().toISOString();
        sessionsRepo.setListing([sessionId], "archived", at);
        channels.get(userChannelKey(userId)).publish({
          type: "session_archived",
          sessionId: row.sessionId,
          projectId: row.projectId,
          agentId: row.agentId,
          archived: true,
        });
        return true;
      },
      killProcess: (sessionId, processId) => sessions.killProcess(sessionId, processId),
      removeProcess: (sessionId, processId) => sessions.removeProcess(sessionId, processId),
      abortSession: (sessionId) => sessions.abortTask(sessionId),
      denyApproval: (sessionId, toolCallId) =>
        sessions.decideApproval(sessionId, toolCallId, "deny"),
      usage: {
        tokensOf: (projectId, sessionIds, fromTs) => {
          if (sessionIds.length === 0) return [];
          return usageStore
            .groupsByModel(projectId, "session", {
              sessionIds,
              fromTs,
              toTs: clock.now().toISOString(),
            })
            .map((row): UsageSeed => ({
              sessionId: row.key,
              cacheRead: row.cacheRead,
              cacheWrite: row.cacheWrite,
              output: row.output,
              total: row.total,
              requests: row.requests,
            }));
        },
        costsOf: async (projectId, sessionIds) => {
          if (sessionIds.length === 0) return new Map<string, number>();
          const now = clock.now();
          const { bySession } = await usageQueries.costBySession(
            projectId,
            sessionIds,
            new Date(now.getTime() - USAGE_WINDOW_MS).toISOString(),
            now.toISOString(),
          );
          return bySession;
        },
      },
      userIdOf: (c) => c.var.user.userId,
      now: () => clock.now(),
    };
    this.routes = taskRoutes(deps);
  }
}
