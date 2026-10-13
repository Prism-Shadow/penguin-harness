/**
 * Session search: the indexer that turns the Trace tree into something a search box can ask,
 * and the query that answers.
 *
 * Why this exists at all: the sidebar's search was a client-side filter over ONE page of
 * already-loaded rows, matching titles only (web/src/lib/session-grouping.ts
 * `matchesSessionQuery`). On an install with thousands of Sessions, "软著" could not find the
 * morning's conversation because that conversation was never in the page, and because the word
 * the user remembers was in a message body rather than in a title. The index here answers over
 * the WHOLE Project, over message bodies, and says which message matched.
 *
 * The index is a DERIVED CACHE, held to the same rules as trace_files: the Trace tree is the
 * single source of truth, every row is rebuildable, and no row is authority for absence — an
 * unindexed shard is simply scanned next pass, so a stale or missing index costs one pass,
 * never a false "no results". It is built in the background, never on the request path, and
 * only ever catches up: a search issued while the first pass is still running answers from
 * what exists and reports its own progress, and a later search finds the rest.
 *
 * Freshness of a RUNNING Session is the one case a size-gated pass cannot see alone: core
 * appends to the newest shard, `trace_files.size_bytes` is refreshed by the trace index's own
 * reconcile, and this service re-reads the tail whenever that size moves. The pass runs on a
 * short interval and on every search, so a conversation becomes findable seconds after it is
 * said rather than at the next restart.
 */
import fs from "node:fs/promises";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { Paths } from "../hmr/capabilities.js";
import type {
  SearchDocRow,
  SearchFilters,
  SearchHitRow,
  SearchSessionFact,
} from "../db/repos/session-search.js";
import type {
  SessionSearch as SessionSearchMechanism,
  SessionSearchStore,
} from "../mechanisms/conversation-search.js";
import { traceFilePath } from "./trace-index.js";
import type { TraceIndex, TraceIndexStore } from "../mechanisms/traces.js";
import {
  MAX_INDEXED_CHARS,
  indexableProjection,
  queryExpression,
  queryNeedles,
  snippetAround,
} from "./search-text.js";
import { classifyRecord } from "./trace-record-classify.js";
import type { SearchHit, SearchQuery, SearchResult, SearchResults } from "../api/types.js";

/** Bytes read per shard per pass; a bigger shard is resumed on the next one. */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** Shards taken per pass before yielding to the event loop. */
const SHARDS_PER_PASS = 8;

/** How long a search may spend catching the index up before answering anyway. */
const CATCH_UP_BUDGET_MS = 30;

/** How often the background pass looks for newly appended shards. */
const PASS_INTERVAL_MS = 20_000;

/**
 * How many matching Sessions one query considers. A ceiling rather than a page, because the
 * result set is sorted by recency (which lives in the sessions table, not the index) and then
 * paged; a personal install holds thousands of Sessions, so this is never reached in
 * practice, and `total` reports what was actually considered rather than pretending.
 */
const MAX_CANDIDATE_SESSIONS = 2000;

/** How many matched messages one result carries. */
const HITS_PER_RESULT = 3;

/** A tool call's arguments are worth searching, but not worth indexing whole. */
const TOOL_ARG_CHARS = 600;

/** Indexed role names, matching what the snippets render. */
type IndexedRole = "user" | "assistant" | "thinking" | "tool";

/** The indexer's own view of where it is, reported alongside every answer. */
export interface SearchIndexStatus {
  state: "ready" | "building";
  /** Shards already consumed. */
  indexed: number;
  /** Shards on disk (consumed + still owed). */
  total: number;
}

@Component()
export class SessionSearchService implements SessionSearchMechanism {
  @Use() private readonly paths!: Paths;
  @Use() private readonly repo!: SessionSearchStore;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Shards consumed since boot, for the progress numerator the ledger alone cannot give cheaply. */
  private readonly touched = new Set<string>();
  private lastStatus: SearchIndexStatus = { state: "ready", indexed: 0, total: 0 };

  /**
   * Starts the background pass, once per process. A server that never searches pays nothing:
   * the interval is created lazily on the first {@link search}, and unref'd so it can never
   * hold the process open.
   */
  private ensurePassing(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.runPass().catch(() => {
        /* A failed pass is retried on the next tick; the index is a cache, never authority. */
      });
    }, PASS_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Whether a pass is in flight (test observability, and the "building" state). */
  get isIndexing(): boolean {
    return this.running;
  }

  /**
   * One indexing pass: reconcile the Trace index so `trace_files` is current, then consume
   * dirty shards until the budget runs out. Returns as soon as there is nothing left to do.
   */
  async runPass(budgetMs = Number.POSITIVE_INFINITY): Promise<void> {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    try {
      for (const projectId of this.projectIds()) {
        await this.traceIndex.reconcileProject(projectId);
        for (;;) {
          const dirty = this.repo.listDirtyShards(projectId, SHARDS_PER_PASS);
          if (dirty.length === 0) break;
          for (const shard of dirty) {
            await this.consumeShard(shard);
            if (Date.now() - started > budgetMs) return;
          }
        }
      }
      // Conversations deleted since the last pass left rows behind; the index is a cache,
      // so a deleted conversation showing up in search is the one stale-index outcome that
      // is plainly wrong to a person, and it is cheap to rule out here.
      this.repo.pruneOrphans();
    } finally {
      this.running = false;
      this.refreshStatus();
    }
  }

  private projectIds(): string[] {
    // A Project with no traces is skipped by listDirtyShards anyway, so the table's own list
    // is the cheap superset — no need to walk anything.
    return this.repo.listProjectIds();
  }

  /** Indexes one shard's unread tail, advancing the ledger to the last complete record. */
  private async consumeShard(shard: {
    projectId: string;
    agentId: string;
    sessionId: string;
    fileIndex: number;
    date: string;
    sizeBytes: number;
    indexedBytes: number;
    /** Records already consumed: the line number this pass's first record takes. */
    messageCount: number;
  }): Promise<void> {
    const path = traceFilePath(this.paths.root, {
      projectId: shard.projectId,
      agentId: shard.agentId,
      sessionId: shard.sessionId,
      fileIndex: shard.fileIndex,
      date: shard.date,
      sizeBytes: shard.sizeBytes,
    });
    // A shrinking shard (compaction rewrite, external edit) is re-read whole: the rows its
    // ledger claims to have consumed no longer describe the file.
    const fromStart = shard.indexedBytes > shard.sizeBytes;
    const start = fromStart ? 0 : shard.indexedBytes;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(path, "r");
      const length = Math.max(0, shard.sizeBytes - start);
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, length || READ_CHUNK_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      const chunk = buffer.subarray(0, bytesRead).toString("utf8");
      // A record still being appended has no terminating newline; stop before it so the
      // ledger never claims a half-written line.
      const lastNewline = chunk.lastIndexOf("\n");
      const usable = lastNewline < 0 ? "" : chunk.slice(0, lastNewline);
      const consumed = start + Buffer.byteLength(usable, "utf8") + (lastNewline < 0 ? 0 : 1);
      // Line numbers continue where the ledger left off — by RECORDS, not bytes: a byte
      // offset as the base made a resumed shard's rows collide with the ones already written.
      const fromLine = start === 0 ? 0 : shard.messageCount;
      const { docs } = this.docsFromLines(usable, shard, fromLine);
      this.repo.replaceShardFrom(
        {
          projectId: shard.projectId,
          agentId: shard.agentId,
          sessionId: shard.sessionId,
          fileIndex: shard.fileIndex,
          indexedBytes: consumed,
          sizeBytes: shard.sizeBytes,
          messageCount: fromLine + docs.length,
        },
        docs,
        { fromStart: start === 0 },
      );
      this.touched.add(
        `${shard.projectId}\u0000${shard.agentId}\u0000${shard.sessionId}\u0000${shard.fileIndex}`,
      );
    } catch {
      // Unreadable shard (permissions, a rotation racing us): leave the ledger alone so the
      // next pass retries it. The index is a cache; refusing to index is never a wrong answer.
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  /** Parses one shard's text into the documents a search can be asked about. */
  private docsFromLines(
    text: string,
    shard: { projectId: string; agentId: string; sessionId: string; fileIndex: number },
    fromLine: number,
  ): { docs: SearchDocRow[] } {
    if (!text) return { docs: [] };
    const docs: SearchDocRow[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i]!;
      if (!text) continue;
      let record: OmniMessage;
      try {
        record = JSON.parse(text) as OmniMessage;
      } catch {
        continue; // A truncated or foreign line: skipped, never fatal.
      }
      const seen = classifyRecord(record);
      if (seen === null) continue;
      const lineNo = fromLine + i;
      docs.push({
        projectId: shard.projectId,
        agentId: shard.agentId,
        sessionId: shard.sessionId,
        fileIndex: shard.fileIndex,
        lineNo,
        role: seen.kind,
        at: seen.at,
        body: indexableProjection(seen.text.slice(0, MAX_INDEXED_CHARS)),
        raw: seen.text.slice(0, MAX_INDEXED_CHARS),
      });
    }
    return { docs };
  }

  private refreshStatus(): void {
    const projects = this.projectIds();
    let pending = 0;
    let total = 0;
    for (const projectId of projects) {
      pending += this.repo.pendingShards(projectId);
      total += this.totalShards(projectId);
    }
    this.lastStatus = {
      state: pending > 0 ? "building" : "ready",
      indexed: Math.max(0, total - pending),
      total,
    };
  }

  private totalShards(projectId: string): number {
    return this.repo.countShards(projectId);
  }

  /**
   * The answer to one search box keystroke, over the whole Project.
   *
   * Both halves of a search box's promise are answered here and nowhere else: the message
   * index (what was SAID) and a title match (what the conversation was CALLED), because a
   * title is the model's own summary and frequently words that appear in no message.
   */
  async search(query: SearchQuery): Promise<SearchResults> {
    const trimmed = query.q.trim().slice(0, 200);
    const expr = queryExpression(trimmed);
    if (expr === "") {
      return { query: trimmed, total: 0, results: [], index: this.status() };
    }
    this.ensurePassing();
    // Bounded catch-up on the request path: the contract (and tests) require a search
    // to see shards appended since the last background pass. Budget cut 120→30ms
    // (2026-10-12 perf); past the budget the answer is whatever exists and `index`
    // says so. Full removal is a contract change — not done here.
    await this.runPass(CATCH_UP_BUDGET_MS);

    const filters: SearchFilters = {
      projectId: query.projectId,
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    };
    // Which Sessions matched is decided by an AGGREGATE over every match, not by reading the
    // best N messages and grouping them: rank is per message, so a chatty Session can fill a
    // window of N on its own and hide every other conversation that said the same word — and
    // the more of the index that exists, the more results a search would LOSE. The hit text
    // is then fetched for the page's Sessions only.
    const summaries = this.repo.summarize(expr, filters, MAX_CANDIDATE_SESSIONS);
    const bySession = new Map<string, { hits: SearchHitRow[]; count: number; bestRank: number }>();
    for (const s of summaries) {
      bySession.set(s.sessionId, { hits: [], count: s.matchCount, bestRank: s.bestRank });
    }
    const pageIds = [...bySession.keys()];
    if (pageIds.length > 0) {
      for (const hit of this.repo.hitsFor(expr, filters, pageIds, HITS_PER_RESULT)) {
        const entry = bySession.get(hit.sessionId);
        if (entry !== undefined) entry.hits.push(hit);
      }
    }
    // Title-only hits join the same result set: a session nobody can find by its body text is
    // exactly the one a person remembers by what it was called.
    const titleIds = this.repo.searchTitles(
      query.projectId,
      queryNeedles(trimmed),
      MAX_CANDIDATE_SESSIONS,
    );
    for (const id of titleIds) {
      if (!bySession.has(id)) bySession.set(id, { hits: [], count: 0, bestRank: 0 });
    }

    const facts = this.repo.loadSessionFacts([...bySession.keys()]);
    // A conversation that exists only as Traces (CLI-created, or a subagent's) is real and on
    // disk; the index that adopts it into `sessions` may not have run yet, and refusing to
    // show it for that reason is the very failure this surface exists to fix.
    const known = new Set(facts.map((f) => f.sessionId));
    const missing = [...bySession.keys()].filter((id) => !known.has(id));
    const merged: SearchSessionFact[] = [
      ...facts,
      ...this.repo.loadTraceSessionFacts(missing).map((f) => ({
        sessionId: f.sessionId,
        projectId: f.projectId,
        agentId: f.agentId,
        provider: f.provider,
        modelId: f.modelId,
        workspace: f.workspace,
        title: f.title,
        createdAt: f.firstTs ?? "",
        lastActiveAt: f.firstTs ?? "",
        archived: false,
        forkCount: 0,
        hasTrace: true,
        client: null,
      })),
    ];
    const needles = queryNeedles(trimmed);
    const results: SearchResult[] = [];
    for (const fact of merged) {
      if (!this.passesFilters(fact, query)) continue;
      const entry = bySession.get(fact.sessionId)!;
      const snippetHits: SearchHit[] = entry.hits.map((h) => {
        const snip = snippetAround(h.raw, needles);
        return {
          role: h.role,
          at: h.at,
          fileIndex: h.fileIndex,
          lineNo: h.lineNo,
          snippet: snip.text,
          marks: snip.marks,
        };
      });
      results.push({
        sessionId: fact.sessionId,
        projectId: fact.projectId,
        agentId: fact.agentId,
        provider: fact.provider,
        modelId: fact.modelId,
        workspace: fact.workspace,
        ...(fact.title !== null ? { title: fact.title } : {}),
        createdAt: fact.createdAt,
        lastActiveAt: fact.lastActiveAt,
        archived: fact.archived,
        hasTrace: fact.hasTrace,
        // A title-only match is worth saying out loud: the body has nothing to show for it.
        matchedTitle: entry.count === 0,
        matchCount: entry.count,
        hits: snippetHits,
      });
    }
    results.sort((a, b) =>
      query.sort === "relevance"
        ? a.matchCount === b.matchCount
          ? b.lastActiveAt.localeCompare(a.lastActiveAt)
          : b.matchCount - a.matchCount
        : b.lastActiveAt.localeCompare(a.lastActiveAt) || a.sessionId.localeCompare(b.sessionId),
    );
    const total = results.length;
    const offset = Math.max(0, query.offset ?? 0);
    return {
      query: trimmed,
      total,
      results: results.slice(offset, offset + (query.limit ?? 30)),
      index: this.status(),
    };
  }

  private passesFilters(fact: SearchSessionFact, query: SearchQuery): boolean {
    if (query.workspace && !fact.workspace.includes(query.workspace)) return false;
    if (query.agentId && fact.agentId !== query.agentId) return false;
    if (query.includeArchived !== true && fact.archived) return false;
    return true;
  }

  /** How far along the index is, as the results panel shows it. */
  status(): SearchIndexStatus {
    if (this.running || this.lastStatus.state === "building") this.refreshStatus();
    return this.lastStatus;
  }
}
