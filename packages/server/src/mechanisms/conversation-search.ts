/**
 * The conversation-search mechanisms: what a node may require, declared apart from what
 * implements it.
 *
 * One view over the Trace tree, rebuildable from disk:
 *   - {@link SessionSearchStore} — the index and its per-shard ledger (SessionSearchRepo);
 *   - {@link SessionSearch}      — index the tree, then answer a query (SessionSearchService).
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { SearchQuery, SearchResults } from "../api/types.js";
import type {
  DirtyShardRow,
  SearchDocRow,
  SearchFilters,
  SearchHitRow,
  SearchSessionFact,
  SearchSummaryRow,
  TraceSessionFact,
  SearchShardRow,
} from "../db/repos/session-search.js";

/** The full-text index and its per-shard consumption ledger. */
export abstract class SessionSearchStore extends Interface<{
  counts(): { docs: number; shards: number };
  listProjectIds(): string[];
  countShards(projectId: string): number;
  listDirtyShards(projectId: string, limit: number): DirtyShardRow[];
  pendingShards(projectId: string): number;
  getShard(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): SearchShardRow | null;
  replaceShardFrom(
    shard: SearchShardRow,
    docs: SearchDocRow[],
    options: { fromStart: boolean },
  ): void;
  search(expr: string, filters: SearchFilters, limit: number): SearchHitRow[];
  summarize(expr: string, filters: SearchFilters, limit: number): SearchSummaryRow[];
  /** The best `perSession` matched messages of each named Session. */
  hitsFor(
    expr: string,
    filters: SearchFilters,
    sessionIds: readonly string[],
    perSession: number,
  ): SearchHitRow[];
  countMatches(expr: string, filters: SearchFilters): number;
  loadSessionFacts(sessionIds: readonly string[]): SearchSessionFact[];
  loadTraceSessionFacts(sessionIds: readonly string[]): TraceSessionFact[];
  searchTitles(projectId: string, needles: readonly string[], limit: number): string[];
  deleteSession(sessionId: string): void;
  /** Forgets Sessions that no table claims any more; returns how many rows went. */
  pruneOrphans(): number;
  deleteScope(scope: { projectId: string; agentId?: string }): void;
}>() {}

/** Indexing and querying. */
export abstract class SessionSearch extends Interface<{
  /** Runs one indexing pass, stopping early once the budget is spent. */
  runPass(budgetMs?: number): Promise<void>;
  readonly isIndexing: boolean;
  search(query: SearchQuery): Promise<SearchResults>;
  status(): { state: "ready" | "building"; indexed: number; total: number };
}>() {}
