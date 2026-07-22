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
  // The Session origin (schedule / subagent) is deliberately NOT a row field: core
  // session_meta in the Trace is the single source of truth (runtime/session-sources.ts).
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
    createdAt: r.created_at as string,
  };
}

export class SessionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  insert(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, approval_mode, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.createdAt,
      );
  }

  /** Idempotent insert: used when Trace directory discovery backfills a row (concurrent listing discovering the same Session no longer triggers a UNIQUE violation). */
  insertOrIgnore(row: SessionRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, approval_mode, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.createdAt,
      );
  }

  findById(sessionId: string): SessionRow | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId);
    return r ? mapRow(r) : null;
  }

  listByAgent(projectId: string, agentId: string): SessionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE project_id = ? AND agent_id = ?")
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
