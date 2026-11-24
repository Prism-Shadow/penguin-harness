/**
 * The Task Manager's route: one read of the tree of what runs right now, under the current user
 * (`/api/me/tasks`), so what it lists is by construction what this user may see — the Projects
 * they own or are a member of.
 *
 *   GET /   the tree: machine → user → app → session → process, with each level's Token total and
 *           each process's CPU and memory
 *
 * The seeds come from the host's own reads and nothing else: the Agent list, the Workbench listing
 * (a page's id and the names it shows), the Session listing (every Session, whoever opened it — a
 * person's conversation and a CLI run show beside the pages'), the session runtime's executing tool
 * calls and pending approvals and background processes, the usage rows and the priced totals. The
 * assembly itself is `./tree.ts`, which reads nothing — this module is where every read happens,
 * once per Project and Agent.
 */
import { hostname } from "node:os";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  errorBody,
  type AppEnv,
  type PendingApproval,
} from "@prismshadow/penguin-server/plugin";
import type { ToolCallListing } from "@prismshadow/penguin-core";
import {
  NO_TOKENS,
  TASK_PROCESS_SIGNALS,
  type TaskProcessSignal,
  type TaskTreeResponse,
} from "../types";
import { measureProcesses, type ProcReader } from "./proc.js";
import {
  buildTree,
  type PageSeed,
  type ProcessSeed,
  type ProjectSeed,
  type SessionSeed,
  type ToolCallSeed,
  type TreeInput,
  type UsageSeed,
} from "./tree.js";

/** One Agent as the listing names it. */
export interface AgentSeed {
  agentId: string;
  /** Its card's name, or its id when the card names none. */
  name: string;
}

/** What the route reads a Session's Tokens and price from. */
export interface TaskUsageReads {
  /** The Token rows of these Sessions, from `fromTs` on. */
  tokensOf(projectId: string, sessionIds: readonly string[], fromTs: string): UsageSeed[];
  /** Each Session's price; a Session the account cannot price is absent. */
  costsOf(projectId: string, sessionIds: readonly string[]): Promise<Map<string, number>>;
}

/** What the route group reaches. */
export interface TaskRouteDeps {
  /** The Projects the caller can open, with their owners. */
  projectsOf(userId: string): Promise<ProjectSeed[]>;
  /** One Project's Agents, as its own listing gives them. */
  agentsOf(projectId: string): Promise<AgentSeed[]>;
  /** One Agent's pages: each Workbench with a page id, named as its listing names it. */
  pagesOf(projectId: string, agentId: string): Promise<PageSeed[]>;
  /**
   * One Agent's Sessions, in any listing state (an archived page's Session is still the page's;
   * a person's own Session shows beside the pages').
   */
  sessionsOf(projectId: string, agentId: string): Promise<SessionSeed[]>;
  /** The tool calls one Session is executing right now. */
  toolCallsOf(sessionId: string): ToolCallListing[];
  /** The tool calls of one Session that wait for their approval. */
  pendingOf(sessionId: string): PendingApproval[];
  /** The background processes one Session started, as the session runtime lists them. */
  processesOf(sessionId: string): readonly ProcessSeed[];
  usage: TaskUsageReads;
  /** The caller of this request. */
  userIdOf(c: Context<AppEnv>): string;
  /** The clock, for the answer's timestamp. */
  now(): Date;
  /** The reader of `/proc`; the real one outside the tests. */
  readFile?: ProcReader;
  /** Whether the caller may act on a Session. */
  canAccessSession?(userId: string, sessionId: string): Promise<boolean> | boolean;
  /** Stops every running activity in a Session and archives it; false when unknown or forbidden. */
  killSession?(userId: string, sessionId: string): Promise<boolean> | boolean;
  /** Stops one background command (SIGTERM + SIGKILL escalation) and removes it from the registry. */
  killProcess?(sessionId: string, processId: string): boolean;
  /** Removes an already-exited background command from the registry. */
  removeProcess?(sessionId: string, processId: string): "removed" | "running" | "not_found";
  /** Aborts a Session's current running turn. */
  abortSession?(sessionId: string): boolean;
  /** Denies a pending tool approval. */
  denyApproval?(sessionId: string, toolCallId: string): boolean;
  /** Sends an OS signal to a spawned process group / pid; defaults to `sendProcessSignal`. */
  signalPid?(pid: number, signal: TaskProcessSignal): boolean;
}

/** Sends a POSIX signal to a command's process group (`-pid`), falling back to direct `pid`. */
export function sendProcessSignal(pid: number, signal: TaskProcessSignal): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Not a process-group leader or group already gone; fall through to direct PID.
    }
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * How far back a page's Token total reaches. A Session belongs to the page it recorded, and the
 * usage table keeps every row of every Session it ever charged, so the window has to cover any
 * Session a page still lists — a year of history is longer than any Workbench has existed.
 */
const USAGE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_LIMIT = 5;
const MAX_IDLE_LIMIT = 500;

/** The answer for a caller with no Project in reach: an empty tree, stamped now. */
export function emptyTree(now: Date, machine: string): TaskTreeResponse {
  return { at: now.toISOString(), machine, users: [], tokens: NO_TOKENS, idleTotal: 0 };
}

const DETAIL_ARG_KEYS = [
  "cmd",
  "command",
  "file_path",
  "path",
  "process_id",
  "subagent_id",
  "url",
  "query",
] as const;

/** A pending approval as a monitor's process row: waiting, no timestamp, no figures. */
function pendingSeed(approval: PendingApproval): ToolCallSeed {
  let detail: string | undefined;
  let description: string | undefined;
  try {
    const parsed: unknown = JSON.parse(approval.toolCall.payload.arguments);
    if (parsed !== null && typeof parsed === "object") {
      const args = parsed as Record<string, unknown>;
      for (const key of DETAIL_ARG_KEYS) {
        const val = args[key];
        if (typeof val === "string" && val.trim().length > 0) {
          detail = val.trim();
          break;
        }
      }
      const rawDesc = args["description"];
      if (typeof rawDesc === "string" && rawDesc.trim().length > 0) {
        description = rawDesc.trim();
      }
    }
  } catch {
    // Malformed arguments on a pending approval simply omit detail/description.
  }
  return {
    toolCallId: approval.toolCall.payload.tool_call_id,
    name: approval.toolCall.payload.name,
    startedAtMs: null,
    ...(detail !== undefined ? { detail } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

export function taskRoutes(deps: TaskRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const now = deps.now();
    const machine = hostname();
    const projects = await deps.projectsOf(deps.userIdOf(c));
    if (projects.length === 0) return c.json(emptyTree(now, machine));
    const fromTs = new Date(now.getTime() - USAGE_WINDOW_MS).toISOString();

    const rawIdleLimit = c.req.query("idleLimit");
    const parsedIdleLimit =
      rawIdleLimit !== undefined ? Number.parseInt(rawIdleLimit, 10) : Number.NaN;
    const idleLimit =
      Number.isFinite(parsedIdleLimit) && parsedIdleLimit >= 0
        ? Math.min(parsedIdleLimit, MAX_IDLE_LIMIT)
        : DEFAULT_IDLE_LIMIT;

    const pages: PageSeed[] = [];
    const allSessions: SessionSeed[] = [];
    const toolCalls = new Map<string, readonly ToolCallSeed[]>();
    const processes = new Map<string, readonly ProcessSeed[]>();
    const tokens: UsageSeed[] = [];
    const costs = new Map<string, number>();

    for (const project of projects) {
      for (const agent of await deps.agentsOf(project.projectId)) {
        const agentPages = await deps.pagesOf(project.projectId, agent.agentId);
        pages.push(...agentPages);
        const pageIds = new Set(agentPages.map((page) => page.pageId));
        // Every Session of the Agent, whoever opened it: a page's own goes under that page, a
        // person's or a program's shows beside the apps.
        const listed = await deps.sessionsOf(project.projectId, agent.agentId);
        const owned = listed.filter(
          (session) => session.source !== undefined && pageIds.has(session.source),
        );
        const mine = listed.filter(
          (session) =>
            !pageIds.has(session.source ?? "") &&
            !(
              session.status === "idle" &&
              (session.archived === true || session.source === "subagent")
            ),
        );
        allSessions.push(...owned, ...mine);
      }
    }

    // Cap idle sessions to `idleLimit` (most recently active first) before querying per-session
    // runtime state, tokens and costs so a server with many historical sessions stays fast.
    const activeSessions = allSessions.filter((session) => session.status !== "idle");
    const idleSessions = allSessions
      .filter((session) => session.status === "idle")
      .sort(
        (a, b) =>
          b.lastActiveAt.localeCompare(a.lastActiveAt) || a.sessionId.localeCompare(b.sessionId),
      );
    const idleTotal = idleSessions.length;
    const sessions = [...activeSessions, ...idleSessions.slice(0, idleLimit)];

    const idsByProject = new Map<string, string[]>();
    for (const session of sessions) {
      toolCalls.set(session.sessionId, [
        ...deps
          .pendingOf(session.sessionId)
          .filter((a) => !a.origin?.length || a.origin[a.origin.length - 1] === session.sessionId)
          .map(pendingSeed),
        ...deps.toolCallsOf(session.sessionId).map((call) => ({
          toolCallId: call.toolCallId,
          name: call.name,
          startedAtMs: call.startedAtMs,
          ...(call.detail !== undefined ? { detail: call.detail } : {}),
          ...(call.description !== undefined ? { description: call.description } : {}),
          ...(call.pid !== undefined ? { pid: call.pid } : {}),
          ...(call.subagentSessionId !== undefined
            ? { subagentSessionId: call.subagentSessionId }
            : {}),
        })),
      ]);
      processes.set(session.sessionId, deps.processesOf(session.sessionId));
      const list = idsByProject.get(session.projectId) ?? [];
      list.push(session.sessionId);
      idsByProject.set(session.projectId, list);
    }

    for (const [projectId, ids] of idsByProject) {
      tokens.push(...deps.usage.tokensOf(projectId, ids, fromTs));
      for (const [sessionId, cost] of await deps.usage.costsOf(projectId, ids)) {
        costs.set(sessionId, cost);
      }
    }

    const pids = [
      ...new Set([
        ...[...toolCalls.values()]
          .flat()
          .flatMap((call) => (call.pid === undefined || call.pid === null ? [] : [call.pid])),
        ...[...processes.values()]
          .flat()
          .flatMap((process) => (process.pid === null ? [] : [process.pid])),
      ]),
    ];
    const measured =
      pids.length === 0
        ? new Map()
        : await measureProcesses(pids, {
            ...(deps.readFile !== undefined ? { readFile: deps.readFile } : {}),
          });
    const input: TreeInput = {
      now,
      machine,
      projects,
      pages,
      sessions,
      toolCalls,
      processes,
      usage: measured,
      tokens,
      costs,
      idleLimit,
      idleTotal,
    };
    return c.json(buildTree(input));
  });

  routes.post("/sessions/:sessionId/kill", async (c) => {
    const sessionId = c.req.param("sessionId") ?? "";
    if (!deps.killSession || !(await deps.killSession(deps.userIdOf(c), sessionId))) {
      return c.json(
        errorBody("session_not_found", "Session does not exist or you do not have access."),
        404,
      );
    }
    return c.body(null, 204);
  });

  routes.post("/sessions/:sessionId/processes/:processId/signal", async (c) => {
    const sessionId = c.req.param("sessionId") ?? "";
    const processId = c.req.param("processId") ?? "";
    const parsed: unknown = await c.req.json().catch(() => null);
    const rawSignal =
      parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).signal
        : undefined;
    if (
      typeof rawSignal !== "string" ||
      !(TASK_PROCESS_SIGNALS as readonly string[]).includes(rawSignal)
    ) {
      return c.json(
        errorBody("bad_request", `signal must be one of ${TASK_PROCESS_SIGNALS.join(", ")}.`),
        400,
      );
    }
    const signal = rawSignal as TaskProcessSignal;

    if (deps.canAccessSession && !(await deps.canAccessSession(deps.userIdOf(c), sessionId))) {
      return c.json(
        errorBody("session_not_found", "Session does not exist or you do not have access."),
        404,
      );
    }

    const sendSignal = deps.signalPid ?? sendProcessSignal;

    // 1. Background command registered under this session.
    const bgProc = deps.processesOf(sessionId).find((proc) => proc.processId === processId);
    if (bgProc !== undefined) {
      if (!bgProc.running) {
        deps.removeProcess?.(sessionId, processId);
        return c.body(null, 204);
      }
      if (signal === "SIGTERM") {
        deps.killProcess?.(sessionId, processId);
        return c.body(null, 204);
      }
      if (signal === "SIGKILL") {
        if (bgProc.pid !== null) sendSignal(bgProc.pid, "SIGKILL");
        deps.killProcess?.(sessionId, processId);
        return c.body(null, 204);
      }
      // SIGINT / SIGHUP: deliver the signal to the process group without forcibly reaping the entry.
      if (bgProc.pid !== null) sendSignal(bgProc.pid, signal);
      return c.body(null, 204);
    }

    // 2. Executing tool call in this session.
    const call = deps.toolCallsOf(sessionId).find((tc) => tc.toolCallId === processId);
    if (call !== undefined) {
      if (call.pid !== undefined && call.pid !== null) {
        sendSignal(call.pid, signal);
      } else if (call.subagentSessionId !== undefined && call.subagentSessionId.length > 0) {
        deps.abortSession?.(call.subagentSessionId);
      } else {
        deps.abortSession?.(sessionId);
      }
      return c.body(null, 204);
    }

    // 3. Pending tool approval in this session.
    const pending = deps
      .pendingOf(sessionId)
      .find((app) => app.toolCall.payload.tool_call_id === processId);
    if (pending !== undefined) {
      deps.denyApproval?.(sessionId, processId);
      return c.body(null, 204);
    }

    return c.json(
      errorBody("process_not_found", "Process does not exist or has already exited."),
      404,
    );
  });

  return routes;
}
