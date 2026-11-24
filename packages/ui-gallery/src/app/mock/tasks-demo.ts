/**
 * The Task Manager page's demo (`/api/me/tasks`): a fixed tree of what runs in the demo's Project —
 * machine → user → app → session → process — with two page-backed apps, a person's own session
 * beside them, and processes of every kind (a running tool call, a pending one, a measured command,
 * an exited one, one the platform measured nothing for), so the page draws every part of itself.
 *
 * The demo store records no page sources and prices no Session, so the tree is a demonstration of
 * the page's shape rather than a reading of the store: the Titles are the store's own words where
 * the Session is one of its, and every price the page shows here is one it could show for real.
 */
import type {
  TaskAppInfo,
  TaskProcessInfo,
  TaskSessionInfo,
  TaskTokens,
  TaskTreeResponse,
  TaskUserInfo,
} from "@penguinharness/task-manager/types";
import type { DemoStore } from "./store";

/** A Session's Tokens: a provider's count, its cache, its requests, and the price they add up to. */
function tokens(
  total: number,
  requests: number,
  cacheRead: number,
  output: number,
  cost: number | null,
): TaskTokens {
  return { total, requests, cacheRead, cacheWrite: 0, output, cost };
}

/** A tool call of the Session's engine, as the demo shows it. */
function toolCall(
  id: string,
  name: string,
  status: "pending" | "running",
  startedAt: string | null,
  detail?: string,
  description?: string,
): TaskProcessInfo {
  return {
    kind: "tool",
    id,
    name,
    ...(detail !== undefined ? { detail } : {}),
    ...(description !== undefined ? { description } : {}),
    status,
    startedAt,
    pid: null,
    cpu: null,
    memory: null,
  };
}

/** A command the Session started, with the figures `/proc` measured for its pid. */
function command(
  id: string,
  cmd: string,
  startedAt: string,
  pid: number,
  cpu: number | null,
  memory: number | null,
): TaskProcessInfo {
  return {
    kind: "background",
    id,
    name: cmd,
    status: cpu === null ? "exited" : "running",
    startedAt,
    pid,
    cpu,
    memory,
  };
}

/** The words of a Session the store holds, when it holds it. */
function titleOf(store: DemoStore, sessionId: string): string | null {
  return store.session(sessionId)?.title ?? null;
}

/** GET /api/me/tasks: the demo's demonstration tree, read against the demo's clock and Project. */
export function taskTree(store: DemoStore, now: Date = new Date()): TaskTreeResponse {
  const at = now.toISOString();
  const projectId = store.f.project.projectId;
  const started = new Date(now.getTime() - 12 * 60_000).toISOString();

  const session = (
    sessionId: string,
    source: string,
    total: number,
    requests: number,
    cacheRead: number,
    output: number,
    cost: number | null,
    processes: TaskProcessInfo[],
    status: TaskSessionInfo["status"] = "running",
  ): TaskSessionInfo => ({
    sessionId,
    agentId: "docs-expert",
    agentName: "Docs Expert",
    title: titleOf(store, sessionId) ?? sessionId,
    status,
    source,
    createdAt: started,
    lastActiveAt: at,
    tokens: tokens(total, requests, cacheRead, output, cost),
    cpu: processes.reduce((sum, p) => (p.cpu === null ? sum : sum + p.cpu), 0) || null,
    memory: processes.reduce((sum, p) => (p.memory === null ? sum : sum + p.memory), 0) || null,
    processes,
  });

  const sessions: TaskSessionInfo[] = [
    session("s-publish", "page-support-notes", 58_480, 12, 51_840, 1_240, 0.0175, [
      command(
        "proc-links",
        "node scripts/check-links.mjs --all",
        started,
        48_112,
        42.6,
        182 * 1024 ** 2,
      ),
      toolCall(
        "tc-index",
        "write_file",
        "pending",
        null,
        "docs/release-notes.md",
        "Write draft release notes",
      ),
    ]),
    session("s-release-plan", "page-support-notes", 27_280, 6, 22_400, 860, 0.0092, []),
    // The platform measured nothing for this one: the page says so instead of drawing a figure.
    session(
      "s-hooks-index",
      "page-support-index",
      31_200,
      9,
      29_440,
      3_120,
      0.0121,
      [
        command("proc-grep", "rg --files docs | head -40", started, 47_902, null, null),
        toolCall("tc-grep", "read_file", "running", started, "docs/hooks.md"),
      ],
      "idle",
    ),
    // A person's own conversation, no page behind it: it shows beside the apps.
    session("s-notes", "user", 12_600, 4, 9_800, 620, 0.0041, [
      command("proc-dev", "pnpm dev", started, 48_201, 8.1, 96 * 1024 ** 2),
    ]),
  ];

  const sumTokens = (sessions: readonly TaskSessionInfo[]): TaskTokens => ({
    total: sessions.reduce((sum, s) => sum + s.tokens.total, 0),
    requests: sessions.reduce((sum, s) => sum + s.tokens.requests, 0),
    cacheRead: sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0),
    cacheWrite: 0,
    output: sessions.reduce((sum, s) => sum + s.tokens.output, 0),
    cost: sessions.every((s) => s.tokens.cost !== null)
      ? sessions.reduce((sum, s) => sum + (s.tokens.cost ?? 0), 0)
      : null,
  });

  const app = (
    pageId: string,
    workbenchName: string,
    sessions: TaskSessionInfo[],
  ): TaskAppInfo => ({
    projectId,
    projectName: "Docs",
    agentId: "docs-expert",
    agentName: "Docs Expert",
    pageId,
    workbenchId: "support",
    workbenchName,
    tokens: sumTokens(sessions),
    sessions,
  });

  const user: TaskUserInfo = {
    userId: "demo",
    tokens: sumTokens(sessions),
    apps: [
      app("page-support-notes", "penguin-support-workbench", sessions.slice(0, 2)),
      app("page-support-index", "penguin-support-workbench", sessions.slice(2, 3)),
    ],
    sessions: sessions.slice(3),
  };

  return {
    at,
    machine: "demo",
    users: [user],
    tokens: user.tokens,
    idleTotal: sessions.filter((s) => s.status === "idle").length,
  };
}
