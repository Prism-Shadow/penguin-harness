/**
 * session_search repo: the full-text index (FTS5) and its per-shard consumption ledger.
 *
 * Pure row access — what to index, when a shard is stale and how to answer a query are the
 * service's (services/session-search.ts). Statements are prepared lazily and cached: a search
 * box types faster than SQLite wants to re-parse SQL.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { SessionSearchStore } from "../../mechanisms/conversation-search.js";

/** One message as the index stores it. */
export interface SearchDocRow {
  projectId: string;
  agentId: string;
  sessionId: string;
  fileIndex: number;
  lineNo: number;
  role: string;
  at: string;
  /** The CJK-segmented projection FTS5 actually indexes. */
  body: string;
  /** The original text, kept unindexed for snippets. */
  raw: string;
}

/** One message a query matched, before snippets are cut. */
export interface SearchHitRow {
  sessionId: string;
  agentId: string;
  fileIndex: number;
  lineNo: number;
  role: string;
  at: string;
  raw: string;
  /** FTS5's bm25 score; more negative is a better match. */
  rank: number;
}

/** One Session a query matched, aggregated over its matched messages. */
export interface SearchSummaryRow {
  sessionId: string;
  agentId: string;
  /** How many of the Session's messages matched. */
  matchCount: number;
  /** The best (most negative) rank among them. */
  bestRank: number;
}

/** How much of one shard the indexer has consumed. */
export interface SearchShardRow {
  projectId: string;
  agentId: string;
  sessionId: string;
  fileIndex: number;
  indexedBytes: number;
  sizeBytes: number;
  /**
   * Records consumed so far — the LINE NUMBER the next record of this shard takes. Bytes
   * cannot serve as that base: offsetting line numbers by a byte count made a resumed
   * shard's rows collide with the ones already written (the line is part of the key).
   */
  messageCount: number;
}

/** A shard whose ledger row is missing or no longer matches the file on disk. */
export interface DirtyShardRow {
  projectId: string;
  agentId: string;
  sessionId: string;
  fileIndex: number;
  date: string;
  sizeBytes: number;
  /** 0 when the shard was never indexed, else the byte offset to resume from. */
  indexedBytes: number;
  /** Records consumed so far: the line number the next one takes (see SearchShardRow). */
  messageCount: number;
}

/** The filters a search carries beyond its query text. */
export interface SearchFilters {
  projectId: string;
  agentId?: string;
  from?: string;
  to?: string;
}

/** A Session that exists only as Traces: the facts the search can still answer with. */
/** The list-row facts a result carries back, so a hit opens as the same row the sidebar shows. */
export interface SearchSessionFact {
  sessionId: string;
  projectId: string;
  agentId: string;
  provider: string;
  modelId: string;
  workspace: string;
  title: string | null;
  createdAt: string;
  lastActiveAt: string;
  archived: boolean;
  forkCount: number;
  hasTrace: boolean;
  client: string | null;
}

export interface TraceSessionFact {
  sessionId: string;
  projectId: string;
  agentId: string;
  source: string | null;
  workspace: string;
  title: string | null;
  provider: string;
  modelId: string;
  firstTs: string | null;
}

/** LIKE's own wildcards, escaped so a search for "50%" is a literal "50%". */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Component()
export class SessionSearchRepo implements SessionSearchStore {
  @Use() private readonly db!: Db;

  private stmt: Map<string, ReturnType<Db["prepare"]>> = new Map();

  private prepared(sql: string): ReturnType<Db["prepare"]> {
    let s = this.stmt.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmt.set(sql, s);
    }
    return s;
  }

  /** How many messages the index holds, and how many shards it has consumed. */
  counts(): { docs: number; shards: number } {
    const docs = this.prepared("SELECT count(*) AS n FROM session_search").get() as { n: number };
    const shards = this.prepared("SELECT count(*) AS n FROM session_search_shards").get() as {
      n: number;
    };
    return { docs: docs.n, shards: shards.n };
  }

  /** Every Project id on this install — the passes iterate Projects, not files. */
  listProjectIds(): string[] {
    const rows = this.prepared("SELECT project_id FROM projects").all() as { project_id: string }[];
    return rows.map((r) => r.project_id);
  }

  /** How many shards of one Project exist on disk (the progress denominator's total half). */
  countShards(projectId: string): number {
    const row = this.prepared("SELECT count(*) AS n FROM trace_files WHERE project_id = ?").get(
      projectId,
    ) as { n: number };
    return row.n;
  }

  /** Shards whose ledger is missing, shorter than the file, or longer than the file. */
  listDirtyShards(projectId: string, limit: number): DirtyShardRow[] {
    const rows = this.prepared(
      `SELECT tf.project_id, tf.agent_id, tf.session_id, tf.file_index, tf.date, tf.size_bytes,
              COALESCE(ss.indexed_bytes, 0) AS indexed_bytes,
              COALESCE(ss.message_count, 0) AS message_count
         FROM trace_files tf
         LEFT JOIN session_search_shards ss
           ON ss.project_id = tf.project_id AND ss.agent_id = tf.agent_id
          AND ss.session_id = tf.session_id AND ss.file_index = tf.file_index
        WHERE tf.project_id = ?
          AND (
            ss.session_id IS NULL
            OR ss.size_bytes <> tf.size_bytes
            -- A pass reads at most one chunk: a shard it only got partway through is still
            -- owed work, and a matching size only says the file has not grown since.
            OR ss.indexed_bytes < tf.size_bytes
          )
        ORDER BY tf.date ASC, tf.session_id ASC, tf.file_index ASC
        LIMIT ?`,
    ).all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      sessionId: r.session_id as string,
      fileIndex: r.file_index as number,
      date: r.date as string,
      sizeBytes: r.size_bytes as number,
      indexedBytes: r.indexed_bytes as number,
      messageCount: r.message_count as number,
    }));
  }

  /** How many shards the indexer still owes this Project (the progress denominator). */
  pendingShards(projectId: string): number {
    const row = this.prepared(
      `SELECT count(*) AS n
         FROM trace_files tf
         LEFT JOIN session_search_shards ss
           ON ss.project_id = tf.project_id AND ss.agent_id = tf.agent_id
          AND ss.session_id = tf.session_id AND ss.file_index = tf.file_index
        WHERE tf.project_id = ?
          AND (ss.session_id IS NULL OR ss.size_bytes <> tf.size_bytes OR ss.indexed_bytes < tf.size_bytes)`,
    ).get(projectId) as { n: number };
    return row.n;
  }

  /** One shard's ledger row, or null when it was never indexed. */
  getShard(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): SearchShardRow | null {
    const r = this.prepared(
      `SELECT project_id, agent_id, session_id, file_index, indexed_bytes, size_bytes,
              message_count
         FROM session_search_shards
        WHERE project_id = ? AND agent_id = ? AND session_id = ? AND file_index = ?`,
    ).get(projectId, agentId, sessionId, fileIndex) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      sessionId: r.session_id as string,
      fileIndex: r.file_index as number,
      indexedBytes: r.indexed_bytes as number,
      sizeBytes: r.size_bytes as number,
      messageCount: r.message_count as number,
    };
  }

  /**
   * Writes one shard's messages and its ledger row in a single transaction.
   *
   * Re-indexing a shard from offset 0 first DELETEs its rows: the ledger's
   * `indexed_bytes` is what says which rows belong to which prefix, and a rewritten shard
   * would otherwise leave the tail of its old contents in the index.
   */
  replaceShardFrom(
    shard: SearchShardRow,
    docs: SearchDocRow[],
    options: { fromStart: boolean },
  ): void {
    this.db.exec("BEGIN");
    try {
      if (options.fromStart) {
        this.db
          .prepare(
            "DELETE FROM session_search WHERE project_id = ? AND agent_id = ? AND session_id = ? AND file_index = ?",
          )
          .run(shard.projectId, shard.agentId, shard.sessionId, shard.fileIndex);
      }
      const insert = this.prepared(
        `INSERT INTO session_search (project_id, agent_id, session_id, file_index, line_no, role, at, body, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of docs) {
        insert.run(
          d.projectId,
          d.agentId,
          d.sessionId,
          d.fileIndex,
          d.lineNo,
          d.role,
          d.at,
          d.body,
          d.raw,
        );
      }
      this.prepared(
        `INSERT INTO session_search_shards (project_id, agent_id, session_id, file_index, indexed_bytes, size_bytes, message_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, agent_id, session_id, file_index)
         DO UPDATE SET indexed_bytes = excluded.indexed_bytes,
                       size_bytes = excluded.size_bytes,
                       message_count = excluded.message_count`,
      ).run(
        shard.projectId,
        shard.agentId,
        shard.sessionId,
        shard.fileIndex,
        shard.indexedBytes,
        shard.sizeBytes,
        shard.messageCount,
      );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * The MATCH clause and its bound values for one query: the full-text predicate plus every
   * scope filter, in the order FTS5 sees them.
   */
  private matchClauses(
    expr: string,
    filters: SearchFilters,
  ): { clauses: string[]; params: Array<string | number> } {
    const clauses = ["session_search MATCH ?", "project_id = ?"];
    const params: Array<string | number> = [expr, filters.projectId];
    if (filters.agentId) {
      clauses.push("agent_id = ?");
      params.push(filters.agentId);
    }
    if (filters.from) {
      clauses.push(
        "(SELECT s.created_at FROM sessions s WHERE s.session_id = session_search.session_id) >= ?",
      );
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(
        "(SELECT s.created_at FROM sessions s WHERE s.session_id = session_search.session_id) <= ?",
      );
      params.push(filters.to);
    }
    return { clauses, params };
  }

  /**
   * The messages a query matched, best match first.
   *
   * `agentId` / date filters ride along as extra constraints on UNINDEXED columns, which FTS5
   * applies after the index has produced the matches; the date filter compares the Session's
   * own created_at through a subquery rather than the message timestamp, so "last week" means
   * the week the conversation happened, not the week any one of its messages was written.
   */
  search(expr: string, filters: SearchFilters, limit: number): SearchHitRow[] {
    const { clauses, params } = this.matchClauses(expr, filters);
    const rows = this.prepared(
      `SELECT session_id, agent_id, file_index, line_no, role, at, raw, rank
         FROM session_search
        WHERE ${clauses.join(" AND ")}
        ORDER BY rank
        LIMIT ?`,
    ).all(...params, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      agentId: r.agent_id as string,
      fileIndex: r.file_index as number,
      lineNo: r.line_no as number,
      role: r.role as string,
      at: r.at as string,
      raw: (r.raw as string) ?? "",
      rank: r.rank as number,
    }));
  }

  /**
   * The Sessions a query matched, one row each, with how many of their messages matched.
   *
   * This is deliberately an aggregate rather than "read the N best messages and group them":
   * ranking is per MESSAGE, so a window of the best N can be filled entirely by a handful of
   * chatty Sessions, and every other conversation that mentioned the word would then be
   * invisible — a search that hides results as it learns more is worse than a slow one.
   * Grouping asks SQLite for the whole answer, which is the same work either way, and the
   * hit TEXT is fetched afterwards for the page's Sessions only.
   */
  summarize(expr: string, filters: SearchFilters, limit: number): SearchSummaryRow[] {
    const { clauses, params } = this.matchClauses(expr, filters);
    const rows = this.prepared(
      `SELECT session_id, agent_id, count(*) AS match_count, min(rank) AS best_rank
         FROM session_search
        WHERE ${clauses.join(" AND ")}
        GROUP BY session_id
        ORDER BY match_count DESC, best_rank ASC
        LIMIT ?`,
    ).all(...params, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      agentId: r.agent_id as string,
      matchCount: r.match_count as number,
      bestRank: r.best_rank as number,
    }));
  }

  /**
   * The matched messages of a known set of Sessions — the page's worth, fetched after
   * {@link summarize} has decided which Sessions the page is.
   */
  hitsFor(
    expr: string,
    filters: SearchFilters,
    sessionIds: readonly string[],
    perSession: number,
  ): SearchHitRow[] {
    if (sessionIds.length === 0) return [];
    const { clauses, params } = this.matchClauses(expr, filters);
    const holes = sessionIds.map(() => "?").join(",");
    // The per-Session cap is a WINDOW, not a global LIMIT: one conversation that used the
    // word two hundred times would otherwise fill a global limit of its own and leave every
    // other result showing a match count with no excerpt beside it. Ranking inside each
    // Session's partition keeps the best excerpts while bounding the read.
    const rows = this.prepared(
      `SELECT session_id, agent_id, file_index, line_no, role, at, raw, rank FROM (
         SELECT session_id, agent_id, file_index, line_no, role, at, raw, rank,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY rank) AS rn
           FROM session_search
          WHERE ${clauses.join(" AND ")} AND session_id IN (${holes})
       ) WHERE rn <= ?`,
    ).all(...params, ...sessionIds, perSession) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      agentId: r.agent_id as string,
      fileIndex: r.file_index as number,
      lineNo: r.line_no as number,
      role: r.role as string,
      at: r.at as string,
      raw: (r.raw as string) ?? "",
      rank: r.rank as number,
    }));
  }

  /** How many messages a query matched, without reading any of their text. */
  countMatches(expr: string, filters: SearchFilters): number {
    const clauses = ["session_search MATCH ?", "project_id = ?"];
    const params: Array<string | number> = [expr, filters.projectId];
    if (filters.agentId) {
      clauses.push("agent_id = ?");
      params.push(filters.agentId);
    }
    const row = this.prepared(
      `SELECT count(*) AS n FROM session_search WHERE ${clauses.join(" AND ")}`,
    ).get(...params) as { n: number };
    return row.n;
  }

  /**
   * The Session rows a result set is about, in one query.
   *
   * A search names sessions by id and needs their list-row facts (workspace, timestamps,
   * archived, fork lineage) to answer with something clickable; one round trip beats a
   * `findById` per result.
   */
  loadSessionFacts(sessionIds: readonly string[]): SearchSessionFact[] {
    if (sessionIds.length === 0) return [];
    const holes = sessionIds.map(() => "?").join(",");
    const rows = this.prepared(
      `SELECT session_id, project_id, agent_id, provider, model_id, workspace, title,
              created_at, last_active_at, archived_at, fork_count, has_trace, client
         FROM sessions WHERE session_id IN (${holes})`,
    ).all(...sessionIds) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      provider: r.provider as string,
      modelId: r.model_id as string,
      workspace: r.workspace as string,
      title: (r.title as string | null) ?? null,
      createdAt: r.created_at as string,
      lastActiveAt: (r.last_active_at as string | null) ?? (r.created_at as string),
      archived: r.archived_at !== null && r.archived_at !== undefined,
      forkCount: (r.fork_count as number) ?? 0,
      hasTrace: (r.has_trace as number) === 1,
      client: (r.client as string | null) ?? null,
    }));
  }

  /**
   * The same facts for Sessions that exist only as Traces — a CLI-created conversation, or a
   * subagent's — and so are not (yet) in the `sessions` table.
   *
   * A hit on such a Session must still open: the conversation is real and on disk, and
   * refusing to show it because the index that adopts it has not run yet is exactly the
   * "I know we had that conversation, where is it" failure this surface exists to fix.
   * `lastActiveAt` falls back to the newest message the query matched, which is a lower
   * bound on the truth and the only one available here.
   */
  loadTraceSessionFacts(sessionIds: readonly string[]): TraceSessionFact[] {
    if (sessionIds.length === 0) return [];
    const holes = sessionIds.map(() => "?").join(",");
    const rows = this.prepared(
      `SELECT session_id, project_id, agent_id, source, workspace, title, provider, model_id, first_ts
         FROM trace_sessions WHERE session_id IN (${holes})`,
    ).all(...sessionIds) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      projectId: r.project_id as string,
      agentId: r.agent_id as string,
      source: r.source as string | null,
      workspace: (r.workspace as string | null) ?? "",
      title: (r.title as string | null) ?? null,
      provider: (r.provider as string | null) ?? "",
      modelId: (r.model_id as string | null) ?? "",
      firstTs: (r.first_ts as string | null) ?? null,
    }));
  }

  /**
   * Session ids whose TITLE contains any needle — the half of a search box's promise the
   * message index cannot keep on its own, since a title is the model's own words and never
   * appears in a message body. LIKE is right here and FTS5 wrong: the title is a short
   * human-facing string, and SQLite's LIKE is already case-insensitive for ASCII.
   */
  searchTitles(projectId: string, needles: readonly string[], limit: number): string[] {
    if (needles.length === 0) return [];
    const clauses = needles.map(() => "title LIKE ? ESCAPE '\\'");
    const params: Array<string | number> = needles.map((n) => `%${escapeLike(n)}%`);
    params.push(projectId, limit);
    const rows = this.prepared(
      `SELECT session_id FROM sessions
        WHERE (${clauses.join(" OR ")}) AND project_id = ?
        ORDER BY COALESCE(last_active_at, created_at) DESC
        LIMIT ?`,
    ).all(...params) as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }

  pruneOrphans(): number {
    const stillKnown = `session_id IN (SELECT session_id FROM sessions)
        OR session_id IN (SELECT session_id FROM trace_files)`;
    this.db.exec("BEGIN");
    try {
      const removed = this.db
        .prepare(`DELETE FROM session_search WHERE NOT (${stillKnown})`)
        .run() as { changes: number };
      this.db.prepare(`DELETE FROM session_search_shards WHERE NOT (${stillKnown})`).run();
      this.db.exec("COMMIT");
      return Number(removed.changes ?? 0);
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Drops every indexed message of one Session (its traces are gone). */
  deleteSession(sessionId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM session_search WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM session_search_shards WHERE session_id = ?").run(sessionId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Drops one Agent's (or, with no agent, one Project's) whole index. */
  deleteScope(scope: { projectId: string; agentId?: string }): void {
    this.db.exec("BEGIN");
    try {
      if (scope.agentId) {
        this.db
          .prepare("DELETE FROM session_search WHERE project_id = ? AND agent_id = ?")
          .run(scope.projectId, scope.agentId);
        this.db
          .prepare("DELETE FROM session_search_shards WHERE project_id = ? AND agent_id = ?")
          .run(scope.projectId, scope.agentId);
      } else {
        this.db.prepare("DELETE FROM session_search WHERE project_id = ?").run(scope.projectId);
        this.db
          .prepare("DELETE FROM session_search_shards WHERE project_id = ?")
          .run(scope.projectId);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
