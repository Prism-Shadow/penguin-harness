/**
 * ActionStore: the ActionRuns and the bindings of one organization, in its `company.db`
 * beside the proposals' and the roadmaps' tables (schema.ts). A run is two rows, each only ever
 * inserted: `action_runs` when it starts, `action_run_ends` when it ends — the triggers refuse
 * to rewrite or delete either, so the Activity is history no Action can bypass. A run without
 * an end row is running; one left so by a process that exited is recorded `abandoned` when the
 * store is next opened (only the runs started before this process, so a run another instance
 * of the plugin is finishing is never touched).
 *
 * The start row is written inside the run's first write transaction when it has one (the
 * plugins call the run's transaction hook, writeStart over their own connection), so the run
 * and the write it made commit together; otherwise in a transaction of its own.
 */
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { ActionOutcome, ActionVia } from "./action-model.js";
import { immediate, openCompanyDb } from "./schema.js";

const noRewrite = (table: string): string => `
CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
  BEGIN SELECT RAISE(ABORT, 'history_append_only'); END;`;

/** The registry's tables. */
export const ACTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS action_bindings (
  contribution TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  config       TEXT NOT NULL DEFAULT '{}',
  by           TEXT NOT NULL,
  at           TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS action_runs (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL,
  contribution TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject      TEXT NOT NULL,
  commit_sha   TEXT,
  params       TEXT NOT NULL,
  by           TEXT NOT NULL,
  via          TEXT NOT NULL CHECK (via IN ('web','cli','session','api')),
  session_id   TEXT,
  request_id   TEXT,
  started_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS action_runs_request ON action_runs (by, key, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS action_runs_by_time    ON action_runs (started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS action_runs_by_subject ON action_runs (subject, started_at DESC);
CREATE INDEX IF NOT EXISTS action_runs_by_actor   ON action_runs (by, started_at DESC);
CREATE INDEX IF NOT EXISTS action_runs_by_key     ON action_runs (key, started_at DESC);
${noRewrite("action_runs")}

CREATE TABLE IF NOT EXISTS action_run_ends (
  run_id      TEXT PRIMARY KEY REFERENCES action_runs(id),
  outcome     TEXT NOT NULL CHECK (outcome IN ('succeeded','refused','failed','aborted','abandoned')),
  status      INTEGER,
  code        TEXT,
  message     TEXT,
  result      TEXT,
  hook_errors TEXT NOT NULL DEFAULT '[]',
  ended_at    TEXT NOT NULL,
  output      TEXT
) WITHOUT ROWID;
${noRewrite("action_run_ends")}
`;

/** A run's start row. */
export interface RunStart {
  id: string;
  key: string;
  contribution: string;
  subjectKind: string;
  subject: string;
  commit: string | null;
  params: Record<string, unknown>;
  by: string;
  via: ActionVia;
  sessionId: string | null;
  requestId: string | null;
  startedAt: string;
}

/** A run's end row. */
export interface RunEnd {
  outcome: ActionOutcome;
  status: number | null;
  code: string | null;
  message: string | null;
  result: unknown;
  hookErrors: string[];
  endedAt: string;
  output: string | null;
}

/** A run as the Activity reads it: its start, and its end once it has one. */
export interface StoredRun extends RunStart {
  end: RunEnd | null;
}

/** One organization's binding of one contribution. */
export interface Binding {
  contribution: string;
  enabled: boolean;
  position: number;
  config: Record<string, unknown>;
  by: string;
  at: string;
}

/** What the Activity is filtered by; `before` is the cursor of the page before (`<startedAt>|<id>`). */
export interface RunFilter {
  subject?: string;
  by?: string;
  key?: string;
  before?: string;
  limit: number;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function json(text: unknown, fallback: unknown): unknown {
  if (typeof text !== "string") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function runOf(row: Row): StoredRun {
  return {
    id: String(row.id),
    key: String(row.key),
    contribution: String(row.contribution),
    subjectKind: String(row.subject_kind),
    subject: String(row.subject),
    commit: str(row.commit_sha),
    params: json(row.params, {}) as Record<string, unknown>,
    by: String(row.by),
    via: String(row.via) as ActionVia,
    sessionId: str(row.session_id),
    requestId: str(row.request_id),
    startedAt: String(row.started_at),
    end:
      row.outcome === null || row.outcome === undefined
        ? null
        : {
            outcome: String(row.outcome) as ActionOutcome,
            status: typeof row.status === "number" ? row.status : null,
            code: str(row.code),
            message: str(row.message),
            result: json(row.result, null),
            hookErrors: json(row.hook_errors, []) as string[],
            endedAt: String(row.ended_at),
            output: str(row.output),
          },
  };
}

const INSERT_START = `INSERT INTO action_runs
  (id, key, contribution, subject_kind, subject, commit_sha, params, by, via, session_id, request_id, started_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Writes a run's start row over `db` — the store's own connection, or a plugin's inside its write transaction. */
export function writeStart(db: DatabaseSync, s: RunStart): void {
  db.prepare(INSERT_START).run(
    s.id,
    s.key,
    s.contribution,
    s.subjectKind,
    s.subject,
    s.commit,
    JSON.stringify(s.params),
    s.by,
    s.via,
    s.sessionId,
    s.requestId,
    s.startedAt,
  );
}

const SELECT_RUN = `SELECT r.*, e.outcome, e.status, e.code, e.message, e.result, e.hook_errors, e.ended_at, e.output
  FROM action_runs r LEFT JOIN action_run_ends e ON e.run_id = r.id`;

/** The list query leaves the output out: it is the one large column, read only for one run. */
const LIST_RUNS = `SELECT r.*, e.outcome, e.status, e.code, e.message, e.result, e.hook_errors, e.ended_at, NULL AS output
  FROM action_runs r LEFT JOIN action_run_ends e ON e.run_id = r.id`;

export class ActionStore {
  private readonly cache = new Map<string, StatementSync>();

  constructor(
    readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens an organization's `company.db` with the registry's tables, and records the runs a past process left. */
  static open(file: string, processStartedAt: string, now?: () => number): ActionStore {
    const store = new ActionStore(openCompanyDb(file, ACTION_SCHEMA), now);
    store.abandonBefore(processStartedAt);
    return store;
  }

  close(): void {
    this.db.close();
  }

  private q(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private at(): string {
    return new Date(this.now()).toISOString();
  }

  /** Every run started before `before` and never ended: `abandoned`, by the store. */
  abandonBefore(before: string): number {
    return immediate(this.db, () => {
      const open = this.q(
        `SELECT r.id FROM action_runs r LEFT JOIN action_run_ends e ON e.run_id = r.id
          WHERE e.run_id IS NULL AND r.started_at < ?`,
      ).all(before) as Row[];
      const at = this.at();
      for (const row of open) {
        this.insertEnd(String(row.id), {
          outcome: "abandoned",
          status: null,
          code: "abandoned",
          message: "The server stopped before the run ended.",
          result: null,
          hookErrors: [],
          endedAt: at,
          output: null,
        });
      }
      return open.length;
    });
  }

  private insertEnd(runId: string, e: RunEnd): void {
    this.q(
      `INSERT INTO action_run_ends (run_id, outcome, status, code, message, result, hook_errors, ended_at, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      e.outcome,
      e.status,
      e.code,
      e.message,
      e.result === undefined || e.result === null ? null : JSON.stringify(e.result),
      JSON.stringify(e.hookErrors),
      e.endedAt,
      e.output,
    );
  }

  /** The start row in a transaction of its own. */
  start(s: RunStart): void {
    immediate(this.db, () => writeStart(this.db, s));
  }

  /** The end row; the start row first when the run never wrote one (refused before any write). */
  end(start: RunStart, e: RunEnd): void {
    immediate(this.db, () => {
      if (this.q(`SELECT 1 FROM action_runs WHERE id = ?`).get(start.id) === undefined) {
        writeStart(this.db, start);
      }
      this.insertEnd(start.id, e);
    });
  }

  get(id: string): StoredRun | null {
    const row = this.q(`${SELECT_RUN} WHERE r.id = ?`).get(id) as Row | undefined;
    return row === undefined ? null : runOf(row);
  }

  /** The run a caller already made with this request id, for a retry. */
  byRequest(by: string, key: string, requestId: string): StoredRun | null {
    const row = this.q(`${SELECT_RUN} WHERE r.by = ? AND r.key = ? AND r.request_id = ?`).get(
      by,
      key,
      requestId,
    ) as Row | undefined;
    return row === undefined ? null : runOf(row);
  }

  /** One page of the Activity, newest first; each filter is served by its own index. */
  list(filter: RunFilter): StoredRun[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.subject !== undefined) {
      where.push("r.subject = ?");
      args.push(filter.subject);
    }
    if (filter.by !== undefined) {
      where.push("r.by = ?");
      args.push(filter.by);
    }
    if (filter.key !== undefined) {
      where.push("r.key = ?");
      args.push(filter.key);
    }
    if (filter.before !== undefined) {
      const at = filter.before.lastIndexOf("|");
      where.push("(r.started_at < ? OR (r.started_at = ? AND r.id < ?))");
      const startedAt = at < 0 ? filter.before : filter.before.slice(0, at);
      const id = at < 0 ? "" : filter.before.slice(at + 1);
      args.push(startedAt, startedAt, id);
    }
    const sql = `${LIST_RUNS}${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.started_at DESC, r.id DESC LIMIT ?`;
    args.push(filter.limit);
    return (this.q(sql).all(...args) as Row[]).map(runOf);
  }

  bindings(): Binding[] {
    return (this.q(`SELECT * FROM action_bindings ORDER BY contribution`).all() as Row[]).map(
      (row) => ({
        contribution: String(row.contribution),
        enabled: Number(row.enabled) === 1,
        position: Number(row.position),
        config: json(row.config, {}) as Record<string, unknown>,
        by: String(row.by),
        at: String(row.at),
      }),
    );
  }

  /**
   * The current binding of a contribution, replaced, with the run that changed it — one
   * transaction, so the binding and its history commit together.
   */
  bind(b: Omit<Binding, "at">, run: RunStart, end: Omit<RunEnd, "endedAt">): void {
    immediate(this.db, () => {
      const at = this.at();
      this.q(
        `INSERT INTO action_bindings (contribution, enabled, position, config, by, at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (contribution) DO UPDATE SET enabled = excluded.enabled,
           position = excluded.position, config = excluded.config, by = excluded.by, at = excluded.at`,
      ).run(b.contribution, b.enabled ? 1 : 0, b.position, JSON.stringify(b.config), b.by, at);
      writeStart(this.db, run);
      this.insertEnd(run.id, { ...end, endedAt: at });
    });
  }
}
