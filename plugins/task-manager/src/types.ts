/**
 * The Task Manager's wire types (`/api/me/tasks`): the tree of what runs right now, grouped the
 * way a monitor reads it — machine → user → app → session → process — with each level's Token
 * total and each process's CPU and memory.
 *
 * The task-manager plugin's `./types` entry: its server and web halves and the component gallery's
 * mock speak them.
 */

/** Signals that can be sent to a process row from the Task Manager. */
export const TASK_PROCESS_SIGNALS = ["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"] as const;
export type TaskProcessSignal = (typeof TASK_PROCESS_SIGNALS)[number];

/** What a process costs at the moment it was read; absent where the platform does not tell. */
export interface TaskProcessUsage {
  /** Share of one CPU core, 0–100 (`100` is one core busy); null for a process already gone. */
  cpu: number | null;
  /** Resident memory in bytes; null for a process already gone. */
  memory: number | null;
}

/**
 * One process row: what the Session is doing right now. A `tool` row is a tool call of the
 * Session's engine (an executing one, or one waiting for its approval); a `background` row is a
 * command the Session started and that outlives the call — the kind the platform can measure.
 */
export interface TaskProcessInfo extends TaskProcessUsage {
  /** `tool` — a tool call; `background` — a started command. */
  kind: "tool" | "background";
  /** The tool call's id, or the background command's process id. */
  id: string;
  /** The tool's name, or the command line. */
  name: string;
  /** Primary target or command text from a tool call's arguments (e.g. `cmd`, `file_path`), when present. */
  detail?: string;
  /** Human-readable description of a tool call, when present. */
  description?: string;
  /** `pending` — waiting for its approval; `running` — executing; `exited` — a command that ended. */
  status: "pending" | "running" | "exited";
  /** ISO 8601 when the moment is known; a pending approval carries none. */
  startedAt: string | null;
  /** The operating system's pid, when the platform tracks one (background commands and foreground exec_command do). */
  pid: number | null;
  /** The subagent session id when this row represents a `run_subagent` / `input_subagent` tool call or background subagent. */
  subagentSessionId?: string | null;
  /** The service the command serves, when one was detected. */
  serviceUrl?: string;
}

/** The Tokens of nothing: a level that never ran. */
export const NO_TOKENS: TaskTokens = {
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  total: 0,
  requests: 0,
  cost: null,
};

/** What one Session of the tree costs: its Turns' Tokens, summed over every model it ran. */
export interface TaskTokens {
  cacheRead: number;
  cacheWrite: number;
  output: number;
  /** The Tokens the provider counted: what a price is computed from. */
  total: number;
  requests: number;
  /** The Session's price in the account's currency; null while any of its requests is unpriced. */
  cost: number | null;
}

/** One Session: the conversation a page opened, or a person's, or a program's. */
export interface TaskSessionInfo {
  sessionId: string;
  agentId: string;
  agentName: string;
  /** The Session's title; null while it has none yet. */
  title: string | null;
  /** `running` or `compacting` while the Session works, `idle` otherwise. */
  status: "idle" | "running" | "compacting";
  /** What opened it: the page's id (`page-…`) when a page did, else the source's kind (`user`, `cli`, …). */
  source: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601: the last activity this server drove for the Session. */
  lastActiveAt: string;
  tokens: TaskTokens;
  /** CPU and memory over the Session's processes: the sum of the measured ones, null when none is. */
  cpu: number | null;
  memory: number | null;
  processes: TaskProcessInfo[];
}

/** One app: an Agent Workbench page (its page id is what its Sessions record as their source), and the Sessions it opened. */
export interface TaskAppInfo {
  projectId: string;
  /** The Project's display name, when it has one. */
  projectName: string | null;
  agentId: string;
  agentName: string;
  /** The page id its Sessions record as their source (`page-…`). */
  pageId: string;
  /** The workbench the page belongs to. */
  workbenchId: string;
  /** The workbench's name, from its package.json (its folder id when it names none). */
  workbenchName: string;
  /** The app's Tokens: every Session under it, summed. */
  tokens: TaskTokens;
  sessions: TaskSessionInfo[];
}

/** One user: the owner of the Projects whose Sessions and apps hang under them. */
export interface TaskUserInfo {
  userId: string;
  /** The user's Tokens: every Session under them, summed. */
  tokens: TaskTokens;
  /** The page-backed apps with at least one Session. */
  apps: TaskAppInfo[];
  /** The Sessions no page opened — a person's conversation, a CLI run — kept beside the apps. */
  sessions: TaskSessionInfo[];
}

/** What runs right now, on one machine, user by user. */
export interface TaskTreeResponse {
  /** ISO 8601, this server's clock when the answer was assembled. */
  at: string;
  /** The machine this server runs on. */
  machine: string;
  users: TaskUserInfo[];
  /** Every Session's Tokens, summed. */
  tokens: TaskTokens;
  /** Total number of idle sessions across the caller's Projects (before any `idleLimit` cap). */
  idleTotal?: number;
}
