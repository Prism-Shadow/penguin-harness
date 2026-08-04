/**
 * trace_files / trace_sessions repo: the Trace-tree derived cache (see schema.ts and
 * services/trace-index.ts for the cache rules). Pure row access — reconciliation
 * policy (mtime gates, head-reads) lives in the service.
 */
import type { DatabaseSync } from "node:sqlite";
import type { SessionSource } from "../../api/types.js";

/** One indexed Trace shard. */
export interface TraceFileRow {
  projectId: string;
  agentId: string;
  sessionId: string;
  fileIndex: number;
  date: string;
  sizeBytes: number;
}

/** One Session's registration-time facts (earliest shard's head). */
export interface TraceSessionRow {
  sessionId: string;
  projectId: string;
  agentId: string;
  source: SessionSource | null;
  workspace: string;
  title: string | null;
  provider: string | null;
  modelId: string | null;
  firstTs: string | null;
  metaRead: boolean;
}

function mapFile(r: Record<string, unknown>): TraceFileRow {
  return {
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    sessionId: r.session_id as string,
    fileIndex: r.file_index as number,
    date: r.date as string,
    sizeBytes: r.size_bytes as number,
  };
}

function mapSession(r: Record<string, unknown>): TraceSessionRow {
  const source = r.source as string | null;
  return {
    sessionId: r.session_id as string,
    projectId: r.project_id as string,
    agentId: r.agent_id as string,
    // Narrowed on read as well as write: junk in a hand-edited DB must not leak out as a source.
    source: source === "subagent" || source === "schedule" ? source : null,
    workspace: (r.workspace as string | null) ?? "",
    title: (r.title as string | null) ?? null,
    provider: (r.provider as string | null) ?? null,
    modelId: (r.model_id as string | null) ?? null,
    firstTs: (r.first_ts as string | null) ?? null,
    metaRead: (r.meta_read as number) === 1,
  };
}

export class TraceIndexRepo {
  constructor(private readonly db: DatabaseSync) {}

  upsertFile(row: TraceFileRow): void {
    this.db
      .prepare(
        `INSERT INTO trace_files (project_id, agent_id, session_id, file_index, date, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, agent_id, session_id, file_index)
         DO UPDATE SET date = excluded.date, size_bytes = excluded.size_bytes`,
      )
      .run(row.projectId, row.agentId, row.sessionId, row.fileIndex, row.date, row.sizeBytes);
  }

  /** Refreshes one shard's last-observed size (listings write back their page stats). */
  updateFileSize(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
  ): void {
    this.db
      .prepare(
        `UPDATE trace_files SET size_bytes = ?
         WHERE project_id = ? AND agent_id = ? AND session_id = ? AND file_index = ?`,
      )
      .run(sizeBytes, projectId, agentId, sessionId, fileIndex);
  }

  deleteFile(projectId: string, agentId: string, sessionId: string, fileIndex: number): void {
    this.db
      .prepare(
        `DELETE FROM trace_files
         WHERE project_id = ? AND agent_id = ? AND session_id = ? AND file_index = ?`,
      )
      .run(projectId, agentId, sessionId, fileIndex);
  }

  /** All indexed shards of one Agent (date desc, session desc, index asc — the listing's canonical order). */
  listFilesByAgent(projectId: string, agentId: string): TraceFileRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM trace_files WHERE project_id = ? AND agent_id = ?
         ORDER BY session_id DESC, file_index ASC`,
      )
      .all(projectId, agentId);
    return rows.map(mapFile);
  }

  /** One Session's shards, index ascending. */
  listFilesBySession(projectId: string, agentId: string, sessionId: string): TraceFileRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM trace_files
         WHERE project_id = ? AND agent_id = ? AND session_id = ?
         ORDER BY file_index ASC`,
      )
      .all(projectId, agentId, sessionId);
    return rows.map(mapFile);
  }

  /** Owning Agent of a Session's Trace within a Project (the subagent-pointer resolver); null when unindexed. */
  findAgentBySession(projectId: string, sessionId: string): string | null {
    const r = this.db
      .prepare(`SELECT agent_id FROM trace_files WHERE project_id = ? AND session_id = ? LIMIT 1`)
      .get(projectId, sessionId);
    return r ? (r.agent_id as string) : null;
  }

  upsertSession(row: TraceSessionRow): void {
    this.db
      .prepare(
        `INSERT INTO trace_sessions (session_id, project_id, agent_id, source, workspace, title, provider, model_id, first_ts, meta_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           project_id = excluded.project_id, agent_id = excluded.agent_id,
           source = excluded.source, workspace = excluded.workspace, title = excluded.title,
           provider = excluded.provider, model_id = excluded.model_id,
           first_ts = excluded.first_ts, meta_read = excluded.meta_read`,
      )
      .run(
        row.sessionId,
        row.projectId,
        row.agentId,
        row.source,
        row.workspace,
        row.title,
        row.provider,
        row.modelId,
        row.firstTs,
        row.metaRead ? 1 : 0,
      );
  }

  getSession(sessionId: string): TraceSessionRow | null {
    const r = this.db.prepare("SELECT * FROM trace_sessions WHERE session_id = ?").get(sessionId);
    return r ? mapSession(r) : null;
  }

  listSessionsByAgent(projectId: string, agentId: string): TraceSessionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM trace_sessions WHERE project_id = ? AND agent_id = ?")
      .all(projectId, agentId);
    return rows.map(mapSession);
  }

  /** Removes one Session's rows from both tables (Session delete keeps the cache coherent). */
  deleteBySession(sessionId: string): void {
    this.db.prepare("DELETE FROM trace_files WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM trace_sessions WHERE session_id = ?").run(sessionId);
  }

  deleteByAgent(projectId: string, agentId: string): void {
    this.db
      .prepare("DELETE FROM trace_files WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
    this.db
      .prepare("DELETE FROM trace_sessions WHERE project_id = ? AND agent_id = ?")
      .run(projectId, agentId);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare("DELETE FROM trace_files WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM trace_sessions WHERE project_id = ?").run(projectId);
  }
}
