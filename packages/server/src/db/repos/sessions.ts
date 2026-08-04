/**
 * sessions table repo:
 * Session index, approval mode, and auto-generated title; Session-level routes use this to look up project ownership.
 */
import type { DatabaseSync } from "node:sqlite";
import type { ApprovalMode } from "../../api/types.js";

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
  /** Auto-generated session title; NULL = not yet generated (frontend shows "New Conversation"). */
  title: string | null;
  /** Archive timestamp, ISO; NULL = not archived (omitting on insert defaults to NULL). */
  archivedAt?: string | null;
  /**
   * Creating client: "web" (created via the Web App/server) or "cli" (adopted from a Trace
   * the CLI left behind); NULL = legacy row from before the column existed, treated as web.
   * The schedule/subagent SOURCE is deliberately NOT a row field — core session_meta in the
   * Trace stays the single source of truth for it (runtime/session-sources.ts); `client` is
   * a separate, DB-only axis that meta never records.
   */
  client?: "web" | "cli" | null;
  /** Cache: a Trace record exists (set at task start / adoption / subagent registration; backfilled by list hydration). */
  hasTrace?: boolean;
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
    title: (r.title as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    client: (r.client as "web" | "cli" | null) ?? null,
    hasTrace: (r.has_trace as number) === 1,
    createdAt: r.created_at as string,
  };
}

export class SessionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, approval_mode, title, client, has_trace, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.createdAt,
      );
  }

  /** Idempotent insert: used when Trace directory discovery backfills a row (concurrent listing discovering the same Session no longer triggers a UNIQUE violation). */
  insertOrIgnore(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, approval_mode, title, client, has_trace, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.createdAt,
      );
  }

  /** Flip the has_trace cache once a Trace record exists (task start / discovery hydration); idempotent. */
  markHasTrace(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET has_trace = 1 WHERE session_id = ?").run(sessionId);
  }

  findById(sessionId: string): SessionRow | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
    return r ? mapRow(r) : null;
  }

  /**
   * Batched title lookup (the Trace listing resolves one page of Sessions per request):
   * a single IN query instead of per-session findById round trips; rows with a NULL
   * title (or no row at all — unmanaged CLI/subagent Sessions) are simply absent from
   * the map. Bounded by the pagination limit cap (1000), far below SQLite's variable cap.
   */
  titlesByIds(sessionIds: readonly string[]): Map<string, string> {
    if (sessionIds.length === 0) return new Map();
    const placeholders = sessionIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT session_id, title FROM sessions
         WHERE session_id IN (${placeholders}) AND title IS NOT NULL`,
      )
      .all(...sessionIds);
    return new Map(rows.map((r) => [r.session_id as string, r.title as string]));
  }

  /**
   * An Agent's rows, newest first (the list order the sidebar shows; served by
   * idx_sessions_agent_created). `webOnly` keeps only web-created rows — NULL counts as
   * web (legacy rows predate the column and the user chose to grandfather them as visible).
   */
  listByAgent(projectId: string, agentId: string, opts: { webOnly?: boolean } = {}): SessionRow[] {
    const filter = opts.webOnly ? " AND (client IS NULL OR client = 'web')" : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE project_id = ? AND agent_id = ?${filter}
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
