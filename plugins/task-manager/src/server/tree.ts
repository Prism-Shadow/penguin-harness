/**
 * The task tree, assembled from what the host already knows, grouped the way a monitor reads it:
 * machine → user → app → session → process. A session appears whoever opened it — a page's own
 * session under that page's app, a person's or a program's beside the apps — and a process is what
 * the session is doing right now: a tool call of its engine (executing, or waiting for its
 * approval), or a command it started and that outlived the call. Each level totals the Tokens of
 * the sessions under it, and each process carries the CPU and memory the platform measured.
 *
 * Nothing here reads a file or a database: the caller hands the seeds in (projects, pages,
 * sessions, tool calls, process lists, the usage rows and the priced totals) and gets the answer.
 * The suite pins the assembly with fixtures, and the route is the only place that knows where the
 * seeds come from.
 */
import type {
  TaskAppInfo,
  TaskProcessInfo,
  TaskProcessUsage,
  TaskSessionInfo,
  TaskTokens,
  TaskTreeResponse,
  TaskUserInfo,
} from "../types.js";
import { NO_TOKENS } from "../types.js";

/** One Project the caller can open, with the user that owns it. */
export interface ProjectSeed {
  projectId: string;
  /** The Project's display name, when it has one. */
  name: string | null;
  ownerUserId: string;
}

/** A page as the host's workbench listing gives it. */
export interface PageSeed {
  pageId: string;
  workbenchId: string;
  workbenchName: string;
  projectId: string;
  agentId: string;
  agentName: string;
}

/** One Session as the host's Session listing gives it — whoever opened it. */
export interface SessionSeed {
  sessionId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  title: string | null;
  status: "idle" | "running" | "compacting";
  createdAt: string;
  lastActiveAt: string;
  /** What opened it: a page's id (`page-…`), or the source's kind (`user`, `cli`, …). */
  source?: string;
  /** Whether the listing rule files this Session as archived (`SessionInfo.archived`). */
  archived?: boolean;
}

/** One tool call the Session's engine is executing right now. */
export interface ToolCallSeed {
  toolCallId: string;
  name: string;
  /** Epoch milliseconds, when the call entered execution; null while it only waits for approval. */
  startedAtMs: number | null;
  detail?: string;
  description?: string;
  pid?: number | null;
  subagentSessionId?: string | null;
}

/** One background process, as the session runtime lists it. */
export interface ProcessSeed {
  processId: string;
  pid: number | null;
  cmd: string;
  cwd: string;
  /** Epoch milliseconds. */
  startedAt: number;
  running: boolean;
  serviceUrl?: string;
}

/** One usage row's Tokens, by the Session it belongs to (an aggregated `@prismshadow/mmsp` sum). */
export interface UsageSeed {
  sessionId: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  requests: number;
}

/**
 * A running sum over the sessions of one level (app, user, or the whole tree): the Token fields add
 * up, and the price adds up too while every session summed so far has one — a level holding a
 * session the account could not price is unpriced as a whole, since its total would be a lower
 * bound.
 */
interface Sum {
  tokens: TaskTokens;
  /** Whether every session counted so far carries a price. */
  priced: boolean;
}

/** The sum of nothing: every field zero, and still priced — {@link Sum} decides the null. */
function emptySum(): Sum {
  return { tokens: { ...NO_TOKENS, cost: 0 }, priced: true };
}

/** One session's Tokens into the running sum. */
function add(sum: Sum, tokens: TaskTokens): Sum {
  return {
    tokens: addTokens(sum.tokens, { ...tokens, cost: tokens.cost ?? 0 }),
    priced: sum.priced && tokens.cost !== null,
  };
}

/** The sum as the answer states it: a level no session ran costs nothing, and reads as unpriced. */
function sumTokens(sum: Sum, counted: number): TaskTokens {
  return counted === 0 || !sum.priced ? { ...sum.tokens, cost: null } : sum.tokens;
}

/** Two Token totals, added field by field; a cost stays null unless both sides have one. */
export function addTokens(a: TaskTokens, b: TaskTokens): TaskTokens {
  return {
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    total: a.total + b.total,
    requests: a.requests + b.requests,
    cost: a.cost === null || b.cost === null ? null : a.cost + b.cost,
  };
}

/** The usage rows summed per Session: a Session that ran two models has one entry. */
export function tokensBySession(rows: readonly UsageSeed[]): Map<string, TaskTokens> {
  const out = new Map<string, TaskTokens>();
  for (const row of rows) {
    const current = out.get(row.sessionId) ?? NO_TOKENS;
    out.set(row.sessionId, {
      cacheRead: current.cacheRead + row.cacheRead,
      cacheWrite: current.cacheWrite + row.cacheWrite,
      output: current.output + row.output,
      total: current.total + row.total,
      requests: current.requests + row.requests,
      cost: current.cost,
    });
  }
  return out;
}

/** The key a page is told apart by: its folder's id lives in one Project's one Agent's State. */
export function pageKey(projectId: string, pageId: string): string {
  return `${projectId}\u0000${pageId}`;
}

/** A non-negative running total of the measured figures; null when none of them is one. */
function sumUsage(values: readonly (number | null)[]): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    any = true;
  }
  return any ? total : null;
}

/** What the tree is built from, as the route gathers it. */
export interface TreeInput {
  /** The clock, for the answer's own timestamp. */
  now: Date;
  /** The machine this server runs on. */
  machine: string;
  /** The Projects the caller can open, with their owners. */
  projects: readonly ProjectSeed[];
  pages: readonly PageSeed[];
  /** Every Session of those Projects, whoever opened it. */
  sessions: readonly SessionSeed[];
  /** The tool calls each Session is executing right now, by Session id. */
  toolCalls: ReadonlyMap<string, readonly ToolCallSeed[]>;
  /** The background processes each Session started, by Session id. */
  processes: ReadonlyMap<string, readonly ProcessSeed[]>;
  /** What each background process costs now, by pid. An absent pid has no figures. */
  usage: ReadonlyMap<number, TaskProcessUsage>;
  /** The Token rows of the Sessions above. */
  tokens: readonly UsageSeed[];
  /** The price of each Session, where the account can price its models. */
  costs: ReadonlyMap<string, number>;
  /** Maximum number of idle sessions to include (most recently active first); running/compacting sessions are always kept. */
  idleLimit?: number;
  /** Total number of idle sessions before pre-filtering, when the route capped them ahead of gathering usage. */
  idleTotal?: number;
}

const NO_USAGE: TaskProcessUsage = { cpu: null, memory: null };

/**
 * The order a monitor reads sessions in: the ones that work first (a session mid-turn, then one
 * compacting), the recently active before the older idle ones.
 */
function sessionOrder(a: TaskSessionInfo, b: TaskSessionInfo): number {
  const rank = (s: TaskSessionInfo): number =>
    s.status === "running" ? 0 : s.status === "compacting" ? 1 : 2;
  return (
    rank(a) - rank(b) ||
    b.lastActiveAt.localeCompare(a.lastActiveAt) ||
    a.sessionId.localeCompare(b.sessionId)
  );
}

/** One tool call as the answer carries it, with `/proc` readings when the call spawned a foreground pid. */
function toolCallInfo(seed: ToolCallSeed, usage: TaskProcessUsage): TaskProcessInfo {
  return {
    kind: "tool",
    id: seed.toolCallId,
    name: seed.name,
    ...(seed.detail !== undefined ? { detail: seed.detail } : {}),
    ...(seed.description !== undefined ? { description: seed.description } : {}),
    status: seed.startedAtMs === null ? "pending" : "running",
    startedAt: seed.startedAtMs === null ? null : new Date(seed.startedAtMs).toISOString(),
    pid: seed.pid ?? null,
    ...(seed.subagentSessionId !== undefined && seed.subagentSessionId !== null
      ? { subagentSessionId: seed.subagentSessionId }
      : {}),
    cpu: usage.cpu,
    memory: usage.memory,
  };
}

/** One background process as the answer carries it, with what `/proc` said about it when it could speak. */
function processInfo(seed: ProcessSeed, usage: TaskProcessUsage): TaskProcessInfo {
  return {
    kind: "background",
    id: seed.processId,
    name: seed.cmd,
    status: seed.running ? "running" : "exited",
    startedAt: new Date(seed.startedAt).toISOString(),
    pid: seed.pid,
    ...(seed.serviceUrl !== undefined ? { serviceUrl: seed.serviceUrl } : {}),
    cpu: usage.cpu,
    memory: usage.memory,
  };
}

/**
 * The tree: every session of the caller's Projects — a page's under that page's app, the rest
 * beside the apps under their Project's owner — each with the processes it is running, and the
 * Token totals of every level.
 */
export function buildTree(input: TreeInput): TaskTreeResponse {
  const tokens = tokensBySession(input.tokens);
  const ownerOf = new Map(input.projects.map((project) => [project.projectId, project]));

  const pageByKey = new Map<string, PageSeed & { projectName: string | null }>();
  for (const page of input.pages) {
    const project = ownerOf.get(page.projectId);
    pageByKey.set(pageKey(page.projectId, page.pageId), {
      ...page,
      projectName: project?.name ?? null,
    });
  }

  /** Per user: the sums, the page-backed apps, and the sessions no page opened. */
  const users = new Map<
    string,
    {
      info: TaskUserInfo;
      sum: Sum;
      counted: number;
      apps: Map<string, { app: TaskAppInfo; sum: Sum; counted: number }>;
    }
  >();
  const userOf = (userId: string) => {
    let user = users.get(userId);
    if (user === undefined) {
      user = {
        info: { userId, tokens: NO_TOKENS, apps: [], sessions: [] },
        sum: emptySum(),
        counted: 0,
        apps: new Map(),
      };
      users.set(userId, user);
    }
    return user;
  };

  const visibleSessions = input.sessions.filter((session) => ownerOf.has(session.projectId));
  const countedIdleTotal = visibleSessions.filter((session) => session.status === "idle").length;
  const idleTotal = input.idleTotal ?? countedIdleTotal;
  const sessionsToInclude =
    input.idleLimit === undefined
      ? visibleSessions
      : (() => {
          const active = visibleSessions.filter((session) => session.status !== "idle");
          const idle = visibleSessions
            .filter((session) => session.status === "idle")
            .sort(
              (a, b) =>
                b.lastActiveAt.localeCompare(a.lastActiveAt) ||
                a.sessionId.localeCompare(b.sessionId),
            )
            .slice(0, Math.max(0, input.idleLimit));
          return [...active, ...idle];
        })();

  for (const session of sessionsToInclude) {
    const project = ownerOf.get(session.projectId);
    if (project === undefined) continue; // A Project the caller cannot open is not theirs to see.
    const user = userOf(project.ownerUserId);

    const own = tokens.get(session.sessionId) ?? NO_TOKENS;
    const cost = input.costs.get(session.sessionId);
    const withCost: TaskTokens = cost === undefined ? own : { ...own, cost };

    const processes = [
      ...(input.toolCalls.get(session.sessionId) ?? []).map((seed) =>
        toolCallInfo(
          seed,
          (seed.pid !== undefined && seed.pid !== null ? input.usage.get(seed.pid) : undefined) ??
            NO_USAGE,
        ),
      ),
      ...(input.processes.get(session.sessionId) ?? []).map((seed) =>
        processInfo(seed, (seed.pid !== null ? input.usage.get(seed.pid) : undefined) ?? NO_USAGE),
      ),
    ];
    const statusRank = (p: TaskProcessInfo): number =>
      p.status === "running" ? 0 : p.status === "pending" ? 1 : 2;
    processes.sort(
      (a, b) =>
        statusRank(a) - statusRank(b) ||
        (a.startedAt ?? "").localeCompare(b.startedAt ?? "") ||
        a.id.localeCompare(b.id),
    );

    const info: TaskSessionInfo = {
      sessionId: session.sessionId,
      agentId: session.agentId,
      agentName: session.agentName,
      title: session.title,
      status: session.status,
      source: session.source ?? "user",
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      tokens: withCost,
      cpu: sumUsage(processes.map((p) => p.cpu)),
      memory: sumUsage(processes.map((p) => p.memory)),
      processes,
    };

    user.sum = add(user.sum, withCost);
    user.counted += 1;

    // A session one of the caller's pages opened goes under that page's app; the rest are the
    // user's own conversations and runs, kept beside the apps.
    const app = pageByKey.get(pageKey(session.projectId, info.source));
    if (app === undefined) {
      user.info.sessions.push(info);
      continue;
    }
    const appKey = pageKey(pageKey(session.agentId, session.projectId), app.pageId);
    let opened = user.apps.get(appKey);
    if (opened === undefined) {
      opened = {
        app: {
          projectId: app.projectId,
          projectName: app.projectName,
          agentId: app.agentId,
          agentName: app.agentName,
          pageId: app.pageId,
          workbenchId: app.workbenchId,
          workbenchName: app.workbenchName,
          tokens: NO_TOKENS,
          sessions: [],
        },
        sum: emptySum(),
        counted: 0,
      };
      user.apps.set(appKey, opened);
    }
    opened.app.sessions.push(info);
    opened.sum = add(opened.sum, withCost);
    opened.counted += 1;
  }

  const out: TaskUserInfo[] = [];
  let total = emptySum();
  let counted = 0;
  for (const user of [...users.values()].sort((a, b) =>
    a.info.userId.localeCompare(b.info.userId),
  )) {
    user.info.tokens = sumTokens(user.sum, user.counted);
    for (const opened of user.apps.values()) {
      opened.app.tokens = sumTokens(opened.sum, opened.counted);
      opened.app.sessions.sort(sessionOrder);
      user.info.apps.push(opened.app);
    }
    user.info.apps.sort(
      (a, b) =>
        (a.projectName ?? a.projectId).localeCompare(b.projectName ?? b.projectId) ||
        a.agentName.localeCompare(b.agentName) ||
        a.workbenchName.localeCompare(b.workbenchName) ||
        a.pageId.localeCompare(b.pageId),
    );
    user.info.sessions.sort(sessionOrder);
    out.push(user.info);
    total = add(total, user.info.tokens);
    counted += user.counted;
  }
  return {
    at: input.now.toISOString(),
    machine: input.machine,
    users: out,
    tokens: sumTokens(total, counted),
    idleTotal,
  };
}
