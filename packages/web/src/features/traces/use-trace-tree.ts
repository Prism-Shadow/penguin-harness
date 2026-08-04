/**
 * Data layer of the Trace page's directory tree — the traces-endpoint twin of the
 * sessions store (state/sessions.tsx): paged per (Agent, category) against
 * GET .../traces with limit+1 pages (splitPage), pooling rows by sessionId. Later
 * fetches overwrite pooled rows: the server's bounded classification refines as its
 * head-read caches warm up, and an overwrite moves a row into its true category
 * bucket. Per-category totals and per-Workspace counts ride along on every paged
 * response (no separate counts request).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionCategory, SessionCategoryCounts } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { FOLDER_CATEGORIES, splitPage } from "../../lib/session-grouping";
import { TRACES_PAGE_SIZE, toSessionGroups } from "./trace-sessions";
import type { TraceSessionRow } from "./trace-sessions";

/** Page-state key of one (Agent, category) pair ("\0" never appears in Agent ids). */
const pairKey = (agentId: string, category: SessionCategory) => `${agentId}\0${category}`;

/** One pair's paging cursor (same convention as the sessions store: `fetched` counts rows consumed from the server's category stream). */
interface PagePosition {
  hasMore: boolean;
  fetched: number;
}

/** One fetched page, ready to merge. */
interface FetchedPage {
  agentId: string;
  category: SessionCategory;
  items: TraceSessionRow[];
  hasMore: boolean;
  counts?: SessionCategoryCounts;
  workspaceCounts?: Readonly<Record<string, SessionCategoryCounts>>;
}

export interface TraceTree {
  /** agentId → its pooled rows (every fetched category), newest first by sessionId. */
  rowsByAgent: ReadonlyMap<string, TraceSessionRow[]>;
  /** All pooled rows (workspace-mode grouping input). */
  allRows: TraceSessionRow[];
  /** agentId → per-category totals over ALL of the Agent's Trace session groups. */
  countsByAgent: ReadonlyMap<string, SessionCategoryCounts>;
  /** agentId → the same totals broken down by Workspace path (workspace-mode group headers). */
  workspaceCountsByAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>;
  /** agentId → active-first-page load failure (inline tree error, mirroring the load-state-with-content rule). */
  errorByAgent: ReadonlyMap<string, string>;
  isLoadedFor: (agentId: string, category: SessionCategory) => boolean;
  /** Whether the pair's active-first-page fetch is in flight (skeleton/loading states). */
  isPendingFor: (agentId: string, category: SessionCategory) => boolean;
  /** Whether the server still holds unfetched groups of a category — an unloaded pair answers from the counts. */
  hasMoreFor: (agentId: string, category: SessionCategory) => boolean;
  /** Fetches the active first page (+ counts) for each given Agent that has none yet (idempotent; safe to call from render effects). */
  ensureFirstFor: (agentIds: string[]) => void;
  /** Fetches a category's first page for each given unloaded Agent (skipped unless its counts hold anything) and the next page for each loaded one with more. */
  loadMoreFor: (agentIds: string[], category: SessionCategory) => Promise<void>;
  /** Drops and refetches one Agent's loaded pairs (post-import refresh), keeping open folders populated. */
  refreshAgent: (agentId: string) => Promise<void>;
}

/**
 * @param includeCli Mirror of the user's "show CLI sessions" preference: appended to
 * every paged fetch (`cli=1`); flipping it resets and refetches the whole tree under
 * the new filter, like the sessions store does.
 */
export function useTraceTree(projectId: string | null, includeCli = false): TraceTree {
  /** sessionId → pooled row (the newest fetch wins — see module doc). */
  const [rows, setRows] = useState<ReadonlyMap<string, TraceSessionRow>>(new Map());
  const [pageState, setPageState] = useState<ReadonlyMap<string, PagePosition>>(new Map());
  const [countsByAgent, setCountsByAgent] = useState<ReadonlyMap<string, SessionCategoryCounts>>(
    new Map(),
  );
  const [workspaceCountsByAgent, setWorkspaceCountsByAgent] = useState<
    ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>
  >(new Map());
  const [errorByAgent, setErrorByAgent] = useState<ReadonlyMap<string, string>>(new Map());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // Generation counter: a Project switch invalidates in-flight responses.
  const gen = useRef(0);
  // Synchronous in-flight guard: ensureFirstFor runs from render effects, which can
  // double-fire (StrictMode) before the async state update lands.
  const inflight = useRef(new Set<string>());
  const pageStateRef = useRef(pageState);
  pageStateRef.current = pageState;
  const countsRef = useRef(countsByAgent);
  countsRef.current = countsByAgent;

  // Project switch / CLI-preference flip: drop everything (rows / cursors / counts are
  // Project- and filter-scoped) — consumers' ensure effects then refetch under the new state.
  useEffect(() => {
    gen.current += 1;
    inflight.current.clear();
    const emptyPages = new Map<string, PagePosition>();
    pageStateRef.current = emptyPages;
    setRows(new Map());
    setPageState(emptyPages);
    setCountsByAgent(new Map());
    setWorkspaceCountsByAgent(new Map());
    setErrorByAgent(new Map());
    setPending(new Set());
  }, [projectId, includeCli]);

  const fetchPage = useCallback(
    async (
      pid: string,
      agentId: string,
      category: SessionCategory,
      offset: number,
    ): Promise<FetchedPage> => {
      const res = await api.getAgentTraces(pid, agentId, {
        offset,
        limit: TRACES_PAGE_SIZE + 1,
        category,
        ...(includeCli ? { cli: true } : {}),
      });
      const page = splitPage(toSessionGroups(res), TRACES_PAGE_SIZE);
      return {
        agentId,
        category,
        items: page.items.map((g) => ({ ...g, agentId })),
        hasMore: page.hasMore,
        ...(res.counts !== undefined ? { counts: res.counts } : {}),
        ...(res.workspaceCounts !== undefined ? { workspaceCounts: res.workspaceCounts } : {}),
      };
    },
    [includeCli],
  );

  /** Merges fetched pages: rows overwrite by sessionId, cursors advance, counts refresh to the newest response. */
  const applyPages = useCallback((pages: FetchedPage[], resetPairsOf?: string) => {
    setRows((prev) => {
      const next = new Map(prev);
      if (resetPairsOf !== undefined) {
        for (const [sid, row] of prev) if (row.agentId === resetPairsOf) next.delete(sid);
      }
      for (const p of pages) for (const row of p.items) next.set(row.sessionId, row);
      return next;
    });
    setPageState((prev) => {
      const next = new Map(prev);
      if (resetPairsOf !== undefined) {
        for (const key of prev.keys()) if (key.startsWith(`${resetPairsOf}\0`)) next.delete(key);
      }
      for (const p of pages) {
        const key = pairKey(p.agentId, p.category);
        next.set(key, {
          hasMore: p.hasMore,
          fetched:
            (resetPairsOf === undefined ? (prev.get(key)?.fetched ?? 0) : 0) + p.items.length,
        });
      }
      return next;
    });
    for (const p of pages) {
      if (p.counts) {
        setCountsByAgent((prev) => new Map(prev).set(p.agentId, p.counts!));
      }
      if (p.workspaceCounts) {
        setWorkspaceCountsByAgent((prev) => new Map(prev).set(p.agentId, p.workspaceCounts!));
      }
    }
  }, []);

  const ensureFirstFor = useCallback(
    (agentIds: string[]) => {
      if (!projectId) return;
      const targets = [...new Set(agentIds)].filter((agentId) => {
        const key = pairKey(agentId, "active");
        return !pageStateRef.current.has(key) && !inflight.current.has(key);
      });
      if (targets.length === 0) return;
      const g = gen.current;
      for (const agentId of targets) inflight.current.add(pairKey(agentId, "active"));
      setPending((prev) => {
        const next = new Set(prev);
        for (const agentId of targets) next.add(pairKey(agentId, "active"));
        return next;
      });
      setErrorByAgent((prev) => {
        if (!targets.some((id) => prev.has(id))) return prev;
        const next = new Map(prev);
        for (const id of targets) next.delete(id);
        return next;
      });
      void Promise.all(
        targets.map(async (agentId) => {
          try {
            return await fetchPage(projectId, agentId, "active", 0);
          } catch (e: unknown) {
            if (g === gen.current) {
              setErrorByAgent((prev) => new Map(prev).set(agentId, apiErrorText(e)));
            }
            return null;
          }
        }),
      ).then((results) => {
        for (const agentId of targets) inflight.current.delete(pairKey(agentId, "active"));
        setPending((prev) => {
          const next = new Set(prev);
          for (const agentId of targets) next.delete(pairKey(agentId, "active"));
          return next;
        });
        if (g !== gen.current) return;
        applyPages(results.filter((r) => r !== null));
      });
    },
    [projectId, fetchPage, applyPages],
  );

  const loadMoreFor = useCallback(
    async (agentIds: string[], category: SessionCategory) => {
      if (!projectId) return;
      const targets = [...new Set(agentIds)].filter((agentId) => {
        const position = pageStateRef.current.get(pairKey(agentId, category));
        if (position === undefined) return (countsRef.current.get(agentId)?.[category] ?? 0) > 0;
        return position.hasMore;
      });
      if (targets.length === 0) return;
      const g = gen.current;
      const results = await Promise.all(
        targets.map(async (agentId) => {
          const offset = pageStateRef.current.get(pairKey(agentId, category))?.fetched ?? 0;
          try {
            return await fetchPage(projectId, agentId, category, offset);
          } catch {
            // Transient failure: leave the pair's state untouched (still unloaded /
            // still has-more), so the affordance stays and the user can retry —
            // the sessions store's convention.
            return null;
          }
        }),
      );
      if (g !== gen.current) return;
      applyPages(results.filter((r) => r !== null));
    },
    [projectId, fetchPage, applyPages],
  );

  /** Post-import refresh: refetch the Agent's active first page plus every folder category already loaded (an open folder must not blank). */
  const refreshAgent = useCallback(
    async (agentId: string) => {
      if (!projectId) return;
      const categories: SessionCategory[] = [
        "active",
        ...FOLDER_CATEGORIES.filter((cat) => pageStateRef.current.has(pairKey(agentId, cat))),
      ];
      const g = gen.current;
      const results = await Promise.all(
        categories.map(async (category) => {
          try {
            return await fetchPage(projectId, agentId, category, 0);
          } catch {
            return null;
          }
        }),
      );
      if (g !== gen.current) return;
      applyPages(
        results.filter((r) => r !== null),
        agentId,
      );
    },
    [projectId, fetchPage, applyPages],
  );

  const isLoadedFor = useCallback(
    (agentId: string, category: SessionCategory) => pageState.has(pairKey(agentId, category)),
    [pageState],
  );

  const isPendingFor = useCallback(
    (agentId: string, category: SessionCategory) => pending.has(pairKey(agentId, category)),
    [pending],
  );

  const hasMoreFor = useCallback(
    (agentId: string, category: SessionCategory) => {
      const position = pageState.get(pairKey(agentId, category));
      if (position !== undefined) return position.hasMore;
      // Unloaded pair: anything the counts report is by definition still unfetched.
      return (countsByAgent.get(agentId)?.[category] ?? 0) > 0;
    },
    [pageState, countsByAgent],
  );

  return useMemo<TraceTree>(() => {
    const rowsByAgent = new Map<string, TraceSessionRow[]>();
    for (const row of rows.values()) {
      const list = rowsByAgent.get(row.agentId);
      if (list) list.push(row);
      else rowsByAgent.set(row.agentId, [row]);
    }
    // sessionId embeds the creation timestamp: sorting by it descending is the same
    // newest-first order the server pages with.
    for (const list of rowsByAgent.values()) {
      list.sort((a, b) => b.sessionId.localeCompare(a.sessionId));
    }
    const allRows = [...rowsByAgent.values()].flat();
    return {
      rowsByAgent,
      allRows,
      countsByAgent,
      workspaceCountsByAgent,
      errorByAgent,
      isLoadedFor,
      isPendingFor,
      hasMoreFor,
      ensureFirstFor,
      loadMoreFor,
      refreshAgent,
    };
  }, [
    rows,
    countsByAgent,
    workspaceCountsByAgent,
    errorByAgent,
    isLoadedFor,
    isPendingFor,
    hasMoreFor,
    ensureFirstFor,
    loadMoreFor,
    refreshAgent,
  ]);
}
