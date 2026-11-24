/**
 * The tree assembled from seeds: machine → user → app → session → process.
 *
 * - A session a page opened goes under that page's app; a session nobody's page opened — a
 *   person's, a CLI run's, one with no source at all — shows beside the apps under its Project's
 *   owner, never dropped.
 * - A session of a Project the caller cannot open is not theirs to see.
 * - A session's Tokens are its usage rows summed, whatever model it ran; a price the account could
 *   not give leaves the total's `cost` null rather than a lower bound.
 * - An app's Tokens are its sessions summed, a user's are all of theirs, and the machine's are
 *   every session's.
 * - A process row is a tool call (running, or pending while it waits for its approval) or a
 *   background command (running or exited), carrying the figures the caller measured for its pid —
 *   and nulls when there is none. A session's own figures sum its processes'.
 * - The order is the monitor's: sessions that work first, then the recently active; processes
 *   running first, then pending, then exited.
 */
import { describe, expect, it } from "vitest";
import { taskRoutes, type TaskRouteDeps } from "../src/server/routes.js";
import { buildTree, pageKey, tokensBySession, type TreeInput } from "../src/server/tree.js";
import {
  formatCost,
  formatCpu,
  formatMemory,
  formatTokens,
  touchesTaskTree,
} from "../src/web/task-format.js";

const AT = new Date("2026-11-23T15:31:02.114Z");

/** One page's seed, as the workbench listing gives it. */
function page(pageId: string, workbenchName = "Tickets", agentName = "Docs") {
  return {
    pageId,
    workbenchId: workbenchName.toLowerCase(),
    workbenchName,
    projectId: "demo",
    agentId: "docs",
    agentName,
  };
}

/** One Session's seed, opened by `source` (a page id, or a kind when it names no page). */
function session(
  sessionId: string,
  source: string | undefined,
  opts: { lastActiveAt?: string; status?: "idle" | "running" | "compacting" } = {},
) {
  return {
    sessionId,
    projectId: "demo",
    agentId: "docs",
    agentName: "Docs",
    title: sessionId,
    status: opts.status ?? ("running" as const),
    createdAt: "2026-11-23T10:00:00.000Z",
    lastActiveAt: opts.lastActiveAt ?? "2026-11-23T15:00:00.000Z",
    ...(source !== undefined ? { source } : {}),
  };
}

/** A tree with nothing in it, which each case adds to what it is about. */
function input(over: Partial<TreeInput> = {}): TreeInput {
  return {
    now: AT,
    machine: "host-a",
    projects: [{ projectId: "demo", name: "Demo", ownerUserId: "u-1" }],
    pages: [],
    sessions: [],
    toolCalls: new Map(),
    processes: new Map(),
    usage: new Map(),
    tokens: [],
    costs: new Map(),
    ...over,
  };
}

describe("buildTree", () => {
  it("puts a Session under the page whose id it records, and keeps a page no Session opened out", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a"), page("page-b")],
        sessions: [session("s-1", "page-a"), session("s-2", "page-b"), session("s-3", "page-a")],
      }),
    );
    expect(tree.users).toHaveLength(1);
    expect(
      tree.users[0]!.apps.map((app) => [app.pageId, app.sessions.map((s) => s.sessionId)]),
    ).toEqual([
      ["page-a", ["s-1", "s-3"]],
      ["page-b", ["s-2"]],
    ]);
    expect(tree.users[0]!.sessions).toEqual([]);
  });

  it("shows a Session no page opened beside the apps, under its Project's owner, whoever opened it", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [
          session("s-app", "page-a"),
          session("s-user", "user", { lastActiveAt: "2026-11-23T15:00:00.000Z" }),
          session("s-cli", "cli", { lastActiveAt: "2026-11-23T14:00:00.000Z" }),
          session("s-plain", undefined, { lastActiveAt: "2026-11-23T13:00:00.000Z" }),
        ],
      }),
    );
    const user = tree.users[0]!;
    expect(user.userId).toBe("u-1");
    expect(user.apps.map((app) => app.pageId)).toEqual(["page-a"]);
    // The person's, the CLI run's and the sourceless one: none is a page's, none is dropped.
    expect(user.sessions.map((s) => s.sessionId)).toEqual(["s-user", "s-cli", "s-plain"]);
    expect(user.sessions.map((s) => s.source)).toEqual(["user", "cli", "user"]);
  });

  it("leaves out a Session of a Project the caller cannot open, and totals the levels it shows", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [
          session("s-1", "page-a"),
          session("s-2", "user"),
          { ...session("s-3", "user"), projectId: "elsewhere" },
        ],
        projects: [
          { projectId: "demo", name: "Demo", ownerUserId: "u-1" },
          // `elsewhere` belongs to nobody the caller can see.
        ],
        tokens: [
          { sessionId: "s-1", cacheRead: 0, cacheWrite: 0, output: 10, total: 10, requests: 1 },
          { sessionId: "s-2", cacheRead: 0, cacheWrite: 0, output: 20, total: 20, requests: 1 },
        ],
        costs: new Map([
          ["s-1", 0.5],
          ["s-2", 0.25],
        ]),
      }),
    );
    expect(tree.users).toHaveLength(1);
    expect(tree.users[0]!.sessions.map((s) => s.sessionId)).toEqual(["s-2"]);
    expect(tree.users[0]!.tokens.total).toBe(30);
    expect(tree.tokens).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      output: 30,
      total: 30,
      requests: 2,
      cost: 0.75,
    });
    expect(tree.machine).toBe("host-a");
    expect(tree.at).toBe(AT.toISOString());
  });

  it("names each app by its workbench, Project and Agent, and groups two Projects with the same page id apart", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a"), { ...page("page-a"), projectId: "other", agentId: "docs" }],
        sessions: [session("s-1", "page-a"), { ...session("s-2", "page-a"), projectId: "other" }],
        projects: [
          { projectId: "demo", name: "Demo", ownerUserId: "u-1" },
          { projectId: "other", name: "Other", ownerUserId: "u-1" },
        ],
      }),
    );
    // A page's key pairs the Project with the page id, so one id in two Projects is two apps.
    expect(pageKey("demo", "page-a")).not.toBe(pageKey("other", "page-a"));
    expect(
      tree.users[0]!.apps.map((app) => [app.projectName, app.sessions.map((s) => s.sessionId)]),
    ).toEqual([
      ["Demo", ["s-1"]],
      ["Other", ["s-2"]],
    ]);
  });

  it("sums a Session's usage rows over the models it ran, and carries the price the account gave", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [session("s-1", "page-a"), session("s-2", "page-a")],
        tokens: [
          { sessionId: "s-1", cacheRead: 10, cacheWrite: 2, output: 30, total: 42, requests: 1 },
          { sessionId: "s-1", cacheRead: 5, cacheWrite: 0, output: 13, total: 18, requests: 2 },
          { sessionId: "s-2", cacheRead: 0, cacheWrite: 0, output: 20, total: 20, requests: 1 },
        ],
        costs: new Map([["s-1", 0.5]]),
      }),
    );
    const [first, second] = tree.users[0]!.apps[0]!.sessions;
    expect(first!.tokens).toEqual({
      cacheRead: 15,
      cacheWrite: 2,
      output: 43,
      total: 60,
      requests: 3,
      cost: 0.5,
    });
    // s-2 ran a model with no price: the account can price neither it nor the app nor the tree.
    expect(second!.tokens.cost).toBeNull();
    expect(tree.users[0]!.apps[0]!.tokens.cost).toBeNull();
    expect(tree.tokens.cost).toBeNull();
    expect(tree.tokens.total).toBe(80);
  });

  it("carries tool calls, pending approvals and background commands as process rows", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [session("s-1", "page-a")],
        toolCalls: new Map([
          [
            "s-1",
            [
              {
                toolCallId: "tc-1",
                name: "sleep",
                startedAtMs: Date.parse("2026-11-23T15:30:00.000Z"),
              },
              { toolCallId: "tc-2", name: "write_file", startedAtMs: null },
            ],
          ],
        ]),
        processes: new Map([
          [
            "s-1",
            [
              {
                processId: "p-1",
                pid: 4821,
                cmd: "npm run dev",
                cwd: "/w",
                startedAt: Date.parse("2026-11-23T15:00:00.000Z"),
                running: true,
                serviceUrl: "http://localhost:5173",
              },
            ],
          ],
        ]),
        usage: new Map([[4821, { cpu: 12.5, memory: 183500800 }]]),
      }),
    );
    const processes = tree.users[0]!.apps[0]!.sessions[0]!.processes;
    // Running first, then the one waiting for its approval.
    expect(processes.map((p) => [p.kind, p.id, p.status])).toEqual([
      ["background", "p-1", "running"],
      ["tool", "tc-1", "running"],
      ["tool", "tc-2", "pending"],
    ]);
    expect(processes[0]).toMatchObject({
      name: "npm run dev",
      pid: 4821,
      startedAt: "2026-11-23T15:00:00.000Z",
      serviceUrl: "http://localhost:5173",
      cpu: 12.5,
      memory: 183500800,
    });
    // A tool call has no pid of its own, and nothing measures it — nulls, not zeros.
    expect(processes[1]).toMatchObject({
      name: "sleep",
      startedAt: "2026-11-23T15:30:00.000Z",
      pid: null,
      cpu: null,
      memory: null,
    });
    expect(processes[2]!.startedAt).toBeNull();
    // The session's own figures are its processes' sum — of the one that was measured.
    expect(tree.users[0]!.apps[0]!.sessions[0]).toMatchObject({ cpu: 12.5, memory: 183500800 });
  });

  it("carries detail, description, pid and measured CPU/memory for a foreground exec_command tool call", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [session("s-1", "page-a")],
        toolCalls: new Map([
          [
            "s-1",
            [
              {
                toolCallId: "tc-exec",
                name: "exec_command",
                startedAtMs: Date.parse("2026-11-23T15:30:00.000Z"),
                detail: "pnpm test",
                description: "Run test suite",
                pid: 5102,
              },
            ],
          ],
        ]),
        usage: new Map([[5102, { cpu: 37.5, memory: 96 * 1024 * 1024 }]]),
      }),
    );
    const sessionRow = tree.users[0]!.apps[0]!.sessions[0]!;
    expect(sessionRow.processes).toEqual([
      {
        kind: "tool",
        id: "tc-exec",
        name: "exec_command",
        detail: "pnpm test",
        description: "Run test suite",
        status: "running",
        startedAt: "2026-11-23T15:30:00.000Z",
        pid: 5102,
        cpu: 37.5,
        memory: 96 * 1024 * 1024,
      },
    ]);
    expect(sessionRow.cpu).toBe(37.5);
    expect(sessionRow.memory).toBe(96 * 1024 * 1024);
  });

  it("carries subagentSessionId on a run_subagent tool call process row", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [session("s-parent", "page-a")],
        toolCalls: new Map([
          [
            "s-parent",
            [
              {
                toolCallId: "tc-sub-1",
                name: "run_subagent",
                startedAtMs: Date.parse("2026-11-23T15:30:00.000Z"),
                description: "Subagent #1",
                subagentSessionId: "s-sub-1",
              },
            ],
          ],
        ]),
      }),
    );
    const sessionRow = tree.users[0]!.apps[0]!.sessions[0]!;
    expect(sessionRow.processes).toEqual([
      {
        kind: "tool",
        id: "tc-sub-1",
        name: "run_subagent",
        description: "Subagent #1",
        status: "running",
        startedAt: "2026-11-23T15:30:00.000Z",
        pid: null,
        subagentSessionId: "s-sub-1",
        cpu: null,
        memory: null,
      },
    ]);
  });

  it("leaves a session with no process at null figures, not zeros", () => {
    const tree = buildTree(
      input({ pages: [page("page-a")], sessions: [session("s-1", "page-a")] }),
    );
    const row = tree.users[0]!.apps[0]!.sessions[0]!;
    expect(row.cpu).toBeNull();
    expect(row.memory).toBeNull();
    expect(row.processes).toEqual([]);
  });

  it("orders sessions by their work first and their recent activity, users by id", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        sessions: [
          session("s-idle", "page-a", { status: "idle", lastActiveAt: "2026-11-23T15:10:00.000Z" }),
          session("s-late", "page-a", { status: "idle", lastActiveAt: "2026-11-23T15:20:00.000Z" }),
          session("s-work", "page-a", {
            status: "running",
            lastActiveAt: "2026-11-23T14:00:00.000Z",
          }),
          session("s-fold", "page-a", {
            status: "compacting",
            lastActiveAt: "2026-11-23T15:30:00.000Z",
          }),
          { ...session("s-other", "user"), projectId: "elsewhere" },
        ],
        projects: [
          { projectId: "demo", name: "Demo", ownerUserId: "u-2" },
          { projectId: "elsewhere", name: "Elsewhere", ownerUserId: "u-1" },
        ],
      }),
    );
    expect(tree.users.map((u) => u.userId)).toEqual(["u-1", "u-2"]);
    // The working session first, then the compacting one, then the idle ones by their last activity.
    expect(tree.users[1]!.apps[0]!.sessions.map((s) => s.sessionId)).toEqual([
      "s-work",
      "s-fold",
      "s-late",
      "s-idle",
    ]);
    expect(tree.idleTotal).toBe(2);
  });

  it("caps idle sessions to idleLimit (most recently active first) while keeping all active sessions and reporting idleTotal", () => {
    const tree = buildTree(
      input({
        pages: [page("page-a")],
        idleLimit: 1,
        sessions: [
          session("s-idle-old", "page-a", {
            status: "idle",
            lastActiveAt: "2026-11-23T15:10:00.000Z",
          }),
          session("s-idle-new", "user", {
            status: "idle",
            lastActiveAt: "2026-11-23T15:20:00.000Z",
          }),
          session("s-run", "page-a", {
            status: "running",
            lastActiveAt: "2026-11-23T14:00:00.000Z",
          }),
        ],
      }),
    );
    expect(tree.idleTotal).toBe(2);
    expect(tree.users[0]!.apps[0]!.sessions.map((s) => s.sessionId)).toEqual(["s-run"]);
    expect(tree.users[0]!.sessions.map((s) => s.sessionId)).toEqual(["s-idle-new"]);
  });
});

describe("tokensBySession", () => {
  it("sums the rows of one Session and keeps the others apart", () => {
    const sums = tokensBySession([
      { sessionId: "s-1", cacheRead: 1, cacheWrite: 2, output: 3, total: 6, requests: 1 },
      { sessionId: "s-2", cacheRead: 0, cacheWrite: 0, output: 4, total: 4, requests: 1 },
      { sessionId: "s-1", cacheRead: 10, cacheWrite: 0, output: 0, total: 10, requests: 2 },
    ]);
    expect(sums.get("s-1")).toMatchObject({ cacheRead: 11, cacheWrite: 2, output: 3, total: 16 });
    expect(sums.get("s-2")).toMatchObject({ total: 4, requests: 1 });
  });
});

describe("task-format and stream event filter", () => {
  it("formats Tokens, CPU, memory and cost, and shows the fallback when unmeasured", () => {
    expect([formatTokens(0), formatTokens(950), formatTokens(1_000), formatTokens(1_250)]).toEqual([
      "0",
      "950",
      "1k",
      "1.3k",
    ]);
    expect([formatTokens(1_000_000), formatTokens(2_400_000)]).toEqual(["1M", "2.4M"]);
    expect([formatCpu(null, "—"), formatCpu(12.34, "—")]).toEqual(["—", "12.3%"]);
    expect([
      formatMemory(null, (b) => `${b} B`, "—"),
      formatMemory(512, (b) => `${b} B`, "—"),
    ]).toEqual(["—", "512 B"]);
    expect([
      formatCost(null, "—"),
      formatCost(0, "—"),
      formatCost(0.0025, "—"),
      formatCost(1.5, "—"),
    ]).toEqual(["—", "$0.00", "$0.0025", "$1.50"]);
  });

  it("matches direct and machine-wrapped user events that move the task tree", () => {
    expect(touchesTaskTree({ type: "session_state" })).toBe(true);
    expect(touchesTaskTree({ type: "machine_event", event: { type: "session_background" } })).toBe(
      true,
    );
    expect(touchesTaskTree({ type: "machine_event", event: { type: "workbench_updated" } })).toBe(
      true,
    );
    expect(touchesTaskTree({ type: "resync_required" })).toBe(true);
    expect(touchesTaskTree({ type: "heartbeat" })).toBe(false);
    expect(touchesTaskTree({ type: "machine_event", event: { type: "other" } })).toBe(false);
  });
});

describe("taskRoutes actions (kill session & signal process)", () => {
  function makeDeps(over: Partial<TaskRouteDeps> = {}): TaskRouteDeps {
    return {
      projectsOf: async () => [],
      agentsOf: async () => [],
      pagesOf: async () => [],
      sessionsOf: async () => [],
      toolCallsOf: () => [],
      pendingOf: () => [],
      processesOf: () => [],
      usage: {
        tokensOf: () => [],
        costsOf: async () => new Map(),
      },
      userIdOf: () => "u-1",
      now: () => AT,
      ...over,
    };
  }

  it("kills and archives a session via POST /sessions/:sessionId/kill", async () => {
    const killed: Array<{ userId: string; sessionId: string }> = [];
    const app = taskRoutes(
      makeDeps({
        killSession: (userId, sessionId) => {
          if (sessionId !== "s-1") return false;
          killed.push({ userId, sessionId });
          return true;
        },
      }),
    );

    const okRes = await app.request("/sessions/s-1/kill", { method: "POST" });
    expect(okRes.status).toBe(204);
    expect(killed).toEqual([{ userId: "u-1", sessionId: "s-1" }]);

    const notFound = await app.request("/sessions/s-missing/kill", { method: "POST" });
    expect(notFound.status).toBe(404);
  });

  it("signals background processes, running tool calls and pending approvals via POST /sessions/:sessionId/processes/:processId/signal", async () => {
    const signals: Array<{ pid: number; signal: string }> = [];
    const killedProcs: Array<{ sessionId: string; processId: string }> = [];
    const removedProcs: Array<{ sessionId: string; processId: string }> = [];
    const abortedSessions: string[] = [];
    const deniedApprovals: Array<{ sessionId: string; toolCallId: string }> = [];

    const app = taskRoutes(
      makeDeps({
        canAccessSession: (_u, sessionId) => sessionId === "s-1",
        processesOf: () => [
          {
            processId: "proc-run",
            pid: 4100,
            cmd: "sleep 60",
            cwd: "/tmp",
            startedAt: AT.getTime(),
            running: true,
          },
          {
            processId: "proc-exit",
            pid: 4101,
            cmd: "echo done",
            cwd: "/tmp",
            startedAt: AT.getTime(),
            running: false,
          },
        ],
        toolCallsOf: () => [
          {
            toolCallId: "tc-pid",
            name: "exec_command",
            startedAtMs: AT.getTime(),
            detail: "sleep 30",
            pid: 5100,
          },
          {
            toolCallId: "tc-nopid",
            name: "read_file",
            startedAtMs: AT.getTime(),
            detail: "README.md",
          },
          {
            toolCallId: "tc-sub",
            name: "run_subagent",
            startedAtMs: AT.getTime(),
            description: "Subagent #1",
            subagentSessionId: "s-child-1",
          },
        ],
        pendingOf: () => [
          {
            toolCall: {
              type: "model_msg",
              timestamp: AT.toISOString(),
              payload: {
                type: "tool_call",
                role: "assistant",
                tool_call_id: "tc-pending",
                name: "exec_command",
                arguments: '{"cmd":"rm -f tmp"}',
              },
            },
          },
        ],
        signalPid: (pid, signal) => {
          signals.push({ pid, signal });
          return true;
        },
        killProcess: (sessionId, processId) => {
          killedProcs.push({ sessionId, processId });
          return true;
        },
        removeProcess: (sessionId, processId) => {
          removedProcs.push({ sessionId, processId });
          return "removed";
        },
        abortSession: (sessionId) => {
          abortedSessions.push(sessionId);
          return true;
        },
        denyApproval: (sessionId, toolCallId) => {
          deniedApprovals.push({ sessionId, toolCallId });
          return true;
        },
      }),
    );

    const postSignal = (sessionId: string, processId: string, signal: unknown) =>
      app.request(`/sessions/${sessionId}/processes/${processId}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signal }),
      });

    // SIGINT on running background process sends signal to its pid without reaping the entry.
    expect((await postSignal("s-1", "proc-run", "SIGINT")).status).toBe(204);
    expect(signals).toEqual([{ pid: 4100, signal: "SIGINT" }]);
    expect(killedProcs).toEqual([]);

    // SIGTERM on running background process calls killProcess.
    expect((await postSignal("s-1", "proc-run", "SIGTERM")).status).toBe(204);
    expect(killedProcs).toEqual([{ sessionId: "s-1", processId: "proc-run" }]);

    // SIGKILL on running background process sends SIGKILL and calls killProcess.
    expect((await postSignal("s-1", "proc-run", "SIGKILL")).status).toBe(204);
    expect(signals).toEqual([
      { pid: 4100, signal: "SIGINT" },
      { pid: 4100, signal: "SIGKILL" },
    ]);
    expect(killedProcs).toHaveLength(2);

    // Signaling an exited background process removes its entry.
    expect((await postSignal("s-1", "proc-exit", "SIGTERM")).status).toBe(204);
    expect(removedProcs).toEqual([{ sessionId: "s-1", processId: "proc-exit" }]);

    // Signaling a foreground tool call with a spawned pid signals that pid.
    expect((await postSignal("s-1", "tc-pid", "SIGHUP")).status).toBe(204);
    expect(signals.at(-1)).toEqual({ pid: 5100, signal: "SIGHUP" });

    // Signaling a tool call without a pid aborts the session turn.
    expect((await postSignal("s-1", "tc-nopid", "SIGTERM")).status).toBe(204);
    expect(abortedSessions).toEqual(["s-1"]);

    // Signaling a subagent tool call aborts the target subagent session instead of the parent session.
    expect((await postSignal("s-1", "tc-sub", "SIGTERM")).status).toBe(204);
    expect(abortedSessions).toEqual(["s-1", "s-child-1"]);

    // Signaling a pending approval denies it.
    expect((await postSignal("s-1", "tc-pending", "SIGTERM")).status).toBe(204);
    expect(deniedApprovals).toEqual([{ sessionId: "s-1", toolCallId: "tc-pending" }]);

    // Invalid signal, unknown process, or inaccessible session.
    expect((await postSignal("s-1", "proc-run", "SIGUSR99")).status).toBe(400);
    expect((await postSignal("s-1", "proc-unknown", "SIGTERM")).status).toBe(404);
    expect((await postSignal("s-forbidden", "proc-run", "SIGTERM")).status).toBe(404);
  });

  it("propagates subagentSessionId on GET / and attributes child pending approvals only to the child session", async () => {
    const app = taskRoutes(
      makeDeps({
        projectsOf: async () => [{ projectId: "demo", name: "Demo", ownerUserId: "u-1" }],
        agentsOf: async () => [{ agentId: "docs", name: "Docs" }],
        sessionsOf: async () => [
          session("s-parent", "user", { status: "running" }),
          session("s-child", "subagent", { status: "running" }),
        ],
        toolCallsOf: (sessionId) =>
          sessionId === "s-parent"
            ? [
                {
                  toolCallId: "tc-run-sub",
                  name: "run_subagent",
                  startedAtMs: AT.getTime(),
                  description: "Subagent #1",
                  subagentSessionId: "s-child",
                },
              ]
            : [
                {
                  toolCallId: "tc-child-exec",
                  name: "exec_command",
                  startedAtMs: AT.getTime(),
                  detail: "sleep 15",
                  pid: 6200,
                },
              ],
        pendingOf: () => [
          {
            origin: ["s-parent", "s-child"],
            toolCall: {
              type: "model_msg",
              timestamp: AT.toISOString(),
              payload: {
                type: "tool_call",
                role: "assistant",
                tool_call_id: "tc-child-pending",
                name: "write_file",
                arguments: '{"file_path":"out.txt"}',
              },
            },
          },
        ],
      }),
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{
        sessions: Array<{
          sessionId: string;
          status: string;
          processes: Array<{ id: string; name: string; subagentSessionId?: string }>;
        }>;
      }>;
    };
    const sessionsById = new Map(
      body.users[0]!.sessions.map((s) => [s.sessionId, s]),
    );
    expect(sessionsById.get("s-parent")?.processes).toMatchObject([
      {
        id: "tc-run-sub",
        name: "run_subagent",
        subagentSessionId: "s-child",
      },
    ]);
    expect(sessionsById.get("s-child")?.status).toBe("running");
    expect(sessionsById.get("s-child")?.processes.map((p) => p.id)).toEqual([
      "tc-child-exec",
      "tc-child-pending",
    ]);
  });

  it("filters out idle archived or subagent sessions while keeping running CLI/subagent and page sessions", async () => {
    const app = taskRoutes(
      makeDeps({
        projectsOf: async () => [{ projectId: "demo", name: "Demo", ownerUserId: "u-1" }],
        agentsOf: async () => [{ agentId: "docs", name: "Docs" }],
        pagesOf: async () => [page("page-a")],
        sessionsOf: async () => [
          { ...session("s-page-idle", "page-a", { status: "idle" }), archived: true },
          { ...session("s-user-idle", "user", { status: "idle" }), archived: false },
          { ...session("s-cli-idle", "cli", { status: "idle" }), archived: true },
          { ...session("s-cli-running", "cli", { status: "running" }), archived: true },
          { ...session("s-sub-idle", "subagent", { status: "idle" }), archived: false },
          { ...session("s-sub-running", "subagent", { status: "running" }), archived: false },
          { ...session("s-user-archived", "user", { status: "idle" }), archived: true },
        ],
      }),
    );

    const res = await app.request("/?idleLimit=50");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{
        apps: Array<{ pageId: string; sessions: Array<{ sessionId: string }> }>;
        sessions: Array<{ sessionId: string }>;
      }>;
    };
    expect(body.users[0]!.apps[0]!.sessions.map((s) => s.sessionId)).toEqual(["s-page-idle"]);
    expect(body.users[0]!.sessions.map((s) => s.sessionId)).toEqual([
      "s-cli-running",
      "s-sub-running",
      "s-user-idle",
    ]);
  });
});
