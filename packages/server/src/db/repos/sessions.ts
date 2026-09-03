/**
 * sessions table repo:
 * Session index, approval mode, and auto-generated title; Session-level routes use this to look up project ownership.
 */
import type { ThinkingLevelName } from "@prismshadow/penguin-core/interfaces";
import type { ApprovalMode } from "../../api/types.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../database.js";

export interface SessionRow {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** Provider group of the session's model (pairs with `modelId` to form the model reference). */
  provider: string;
  /** Upstream model_id of the session's model (sent as-is to AgentHub; never concatenated). */
  modelId: string;
  workspace: string;
  approvalMode: ApprovalMode;
  /**
   * Thinking level pinned for THIS session (PATCH /api/sessions/:id); NULL = not pinned,
   * so runs that carry no level of their own follow the Agent config as before. Sessions
   * are never inserted with one — pinning is an explicit act inside a live conversation.
   */
  thinkingLevel?: ThinkingLevelName | null;
  /** Auto-generated session title; NULL = not yet generated (frontend shows "New Conversation"). */
  title: string | null;
  /** Archive timestamp, ISO; NULL = not archived (omitting on insert defaults to NULL). */
  archivedAt?: string | null;
  /**
   * Creating client: "web" (created via the Web App), "cli" (created through the API by
   * the CLI, or adopted from a Trace a legacy CLI-direct run left behind); NULL = legacy
   * row from before the column existed, treated as web. Informational provenance only —
   * no list filters on it. The schedule/subagent SOURCE is deliberately NOT a row field —
   * core session_meta in the Trace stays the single source of truth for it
   * (runtime/session-sources.ts); `client` is a separate, DB-only axis that meta never
   * records.
   */
  client?: "web" | "cli" | null;
  /** Cache: a Trace record exists (set at task start / adoption / subagent registration; backfilled by list hydration). */
  hasTrace?: boolean;
  /**
   * Last activity this server drove for the session, ISO: stamped once when a run starts
   * and once when it ends (see SessionManager.drive — a goal run is ONE drive over all its
   * rounds, so it stamps twice, not per round). Set to createdAt at insert, and only ever
   * moves forward (markDriven/touchLastActive clamp with MAX, so a backwards clock step
   * cannot regress it). Rows this server never drives — CLI-adopted Sessions, subagent
   * rows (their activity is driven through the parent's entry) — keep createdAt.
   */
  lastActiveAt: string;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): SessionRow {
  return {
    sessionId: r.session_id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    provider: r.provider as string,
    modelId: r.model_id as string,
    workspace: r.workspace as string,
    approvalMode: r.approval_mode as ApprovalMode,
    thinkingLevel: (r.thinking_level as ThinkingLevelName | null) ?? null,
    title: (r.title as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    client: (r.client as "web" | "cli" | null) ?? null,
    hasTrace: (r.has_trace as number) === 1,
    // The open-time backfill leaves no NULLs; the coalesce only hardens against a row
    // somehow inserted as NULL (degrades to createdAt instead of surfacing undefined).
    lastActiveAt: (r.last_active_at as string | null) ?? (r.created_at as string),
    createdAt: r.created_at as string,
  };
}

@Component()
export class SessionsRepo {
  @Use() private readonly db!: Db;

  insert(row: SessionRow): void {
    this.runInsert("INSERT", row);
  }

  /** Idempotent insert: used when Trace directory discovery backfills a row (concurrent listing discovering the same Session no longer triggers a UNIQUE violation). */
  insertOrIgnore(row: SessionRow): void {
    this.runInsert("INSERT OR IGNORE", row);
  }

  /**
   * Allocate the source Session's next persistent fork number and insert its fork atomically.
   * Keeping both writes in one transaction prevents concurrent requests from sharing a number,
   * while retaining `fork_count` on the source means deleting an older fork never reuses it.
   */
  insertFork(sourceSessionId: string, row: SessionRow): SessionRow {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const source = this.db
        .prepare(
          `UPDATE sessions SET fork_count = fork_count + 1 WHERE session_id = ?
           RETURNING title, fork_count`,
        )
        .get(sourceSessionId) as { title: string | null; fork_count: number } | undefined;
      if (!source) throw new Error(`Source Session not found: ${sourceSessionId}`);

      const forkTitle = source.title
        ? `${source.title} (${source.fork_count})`
        : `(${source.fork_count})`;
      const forkRow = { ...row, title: forkTitle };
      this.runInsert("INSERT", forkRow);
      this.db.exec("COMMIT");
      return forkRow;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * The two inserts' shared column list and binding order (they differ only in conflict
   * handling). `last_active_at` defaults **in SQL** (`COALESCE(?, ?)` over the row's own
   * created_at, bound twice — SQLite forbids referencing a sibling column inside VALUES,
   * and a column added by ALTER TABLE cannot be given a DEFAULT): the column is nullable
   * for legacy reasons, so this is the one place that can guarantee it is never written
   * NULL, whatever a caller passes.
   */
  private runInsert(verb: "INSERT" | "INSERT OR IGNORE", row: SessionRow): void {
    this.db
      .prepare(
        `${verb} INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, approval_mode, title, client, has_trace, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ?), ?)`,
      )
      .run(
        row.sessionId,
        row.projectId,
        row.agentId,
        row.provider,
        row.modelId,
        row.workspace,
        row.approvalMode,
        row.title,
        row.client ?? null,
        row.hasTrace ? 1 : 0,
        row.lastActiveAt ?? null,
        row.createdAt,
        row.createdAt,
      );
  }

  /** Flip the has_trace cache once a Trace record exists (discovery hydration); idempotent. */
  markHasTrace(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET has_trace = 1 WHERE session_id = ?").run(sessionId);
  }

  /**
   * A driven run touched this Session: flip the has_trace cache and stamp last_active_at in
   * ONE statement (drive's run start — one WAL commit instead of two).
   * `MAX(COALESCE(...))` keeps the stamp monotonic: a backwards clock step (NTP, resume
   * from suspend) leaves the stored value alone rather than regressing the row.
   */
  markDriven(sessionId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE sessions SET has_trace = 1, last_active_at = MAX(COALESCE(last_active_at, ''), ?)
         WHERE session_id = ?`,
      )
      .run(at, sessionId);
  }

  /** Stamp last_active_at alone (drive's run end); monotonic like markDriven. */
  touchLastActive(sessionId: string, at: string): void {
    this.db
      .prepare(
        `UPDATE sessions SET last_active_at = MAX(COALESCE(last_active_at, ''), ?)
         WHERE session_id = ?`,
      )
      .run(at, sessionId);
  }

  findById(sessionId: string): SessionRow | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
    return r ? mapRow(r) : null;
  }

  /**
   * An Agent's rows, newest first (the list order the sidebar shows; served by
   * idx_sessions_agent_created). Never filtered by `client` — every row is listed
   * whichever client created it.
   */
  listByAgent(projectId: string, agentId: string): SessionRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE project_id = ? AND agent_id = ?
         ORDER BY created_at DESC, session_id DESC`,
      )
      .all(projectId, agentId);
    return rows.map(mapRow);
  }

  listByProject(projectId: string): SessionRow[] {
    const rows = this.db.prepare("SELECT * FROM sessions WHERE project_id = ?").all(projectId);
    return rows.map(mapRow);
  }

  updateApprovalMode(sessionId: string, mode: ApprovalMode): void {
    this.db
      .prepare("UPDATE sessions SET approval_mode = ? WHERE session_id = ?")
      .run(mode, sessionId);
  }

  /** Pin the session's thinking level (runs without one of their own then use it). */
  updateThinkingLevel(sessionId: string, level: ThinkingLevelName): void {
    this.db
      .prepare("UPDATE sessions SET thinking_level = ? WHERE session_id = ?")
      .run(level, sessionId);
  }

  updateTitle(sessionId: string, title: string): void {
    this.db.prepare("UPDATE sessions SET title = ? WHERE session_id = ?").run(title, sessionId);
  }

  /**
   * Writes only if the title is still NULL. Subagent-session registration and Trace
   * directory discovery backfill can race on the same row, and both are insert-only:
   * whichever inserts first determines the title. Discovery backfill can only supply NULL,
   * so this method fills the title back in without overwriting an existing one (including
   * a user rename or an already-generated title).
   */
  updateTitleIfNull(sessionId: string, title: string): void {
    this.db
      .prepare("UPDATE sessions SET title = ? WHERE session_id = ? AND title IS NULL")
      .run(title, sessionId);
  }

  /** Archive / unarchive (archivedAt = ISO or NULL). */
  setArchived(sessionId: string, archivedAt: string | null): void {
    this.db
      .prepare("UPDATE sessions SET archived_at = ? WHERE session_id = ?")
      .run(archivedAt, sessionId);
  }

  /** Self-healing: after rebuilding a broken Session with no Trace, update the primary key to the new id. */
  replaceId(oldSessionId: string, newSessionId: string): void {
    this.db
      .prepare("UPDATE sessions SET session_id = ? WHERE session_id = ?")
      .run(newSessionId, oldSessionId);
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM sessions WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE project_id = ?").run(projectId);
  }

  deleteById(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }
}
