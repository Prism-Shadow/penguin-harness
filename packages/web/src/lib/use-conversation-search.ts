/**
 * The conversation search's fetching, shared by the sidebar's quick box and the full search
 * page (both ask the same endpoint and page through it the same way).
 *
 * Three things every caller needs and neither should re-invent:
 *
 * - **Debounce.** One request per pause in typing, not one per keystroke — a nine-character
 *   query would otherwise cost nine round trips and nine discarded answers.
 * - **A serial number.** Answers carry the number of the request that asked for them, and an
 *   answer whose number is no longer the newest is dropped. Without it a slow answer for a
 *   query the user has already typed past lands on top of the newer results, and the list
 *   flickers back to a question nobody is asking any more. The number is also bumped on
 *   unmount, so an answer that arrives after the page is gone cannot write into state nobody
 *   reads.
 * - **Paging that accumulates.** "Show more" asks for the window after the one the server
 *   last answered with and folds it into the rows already on screen (appendSearchPage), rather
 *   than replacing them; a failed page leaves the rows already there.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchIndexState, SearchResult } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { apiErrorText } from "./api-error";
import {
  SEARCH_PAGE_SIZE,
  appendSearchPage,
  canLoadMoreSearch,
  nextSearchOffset,
  searchFilterKey,
  searchRequest,
} from "./session-search";
import type { SearchFilters } from "./session-search";

/** How long typing has to pause before the box asks the server. */
const DEBOUNCE_MS = 250;

export interface ConversationSearchState {
  /** The query these rows answer — a list is never drawn under another query's heading. */
  query: string;
  results: readonly SearchResult[];
  /** Project-wide match count, before limit/offset (the server's own number). */
  total: number;
  index: SearchIndexState;
  /** A first page is in flight and nothing has been drawn yet. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Whether a "show more" row is owed. */
  hasMore: boolean;
  loadMore: () => void;
}

const EMPTY_INDEX: SearchIndexState = { state: "ready", indexed: 0, total: 0 };

/**
 * Runs the search for `query` under `filters` and keeps the paged result list.
 *
 * A blank query asks for nothing at all: the server refuses one, and an idle box that fired
 * a request per focus would be noise. The rows already on screen stay until a new answer
 * replaces them, so a re-typed query does not collapse the list between keystrokes.
 */
export function useConversationSearch(
  projectId: string | null,
  query: string,
  filters: SearchFilters,
): ConversationSearchState {
  const [state, setState] = useState<{
    query: string;
    results: readonly SearchResult[];
    total: number;
    index: SearchIndexState;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    offset: number;
  }>({
    query: "",
    results: [],
    total: 0,
    index: EMPTY_INDEX,
    loading: false,
    loadingMore: false,
    error: null,
    offset: 0,
  });
  /** Serial number of the newest request. An answer carrying an older one is stale. */
  const seqRef = useRef(0);
  /** Latest state for the "show more" callback, which must not re-create itself per keystroke. */
  const stateRef = useRef(state);
  stateRef.current = state;
  /** The filter set as a stable key, so a re-created object does not re-run the search. */
  const filterKey = searchFilterKey(filters);

  useEffect(() => {
    // Taken before anything else, so the previous query's in-flight answer is stale from this
    // moment on — including while this query is still inside its debounce.
    const seq = ++seqRef.current;
    if (projectId === null) return;
    const q = query.trim();
    if (q === "") return;
    setState((s) => ({ ...s, loading: true, loadingMore: false, error: null }));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.searchSessions(projectId, searchRequest(q, filters, 0));
          if (seq !== seqRef.current) return;
          setState({
            query: q,
            results: res.results,
            total: res.total,
            index: res.index,
            loading: false,
            loadingMore: false,
            error: null,
            offset: 0,
          });
        } catch (e) {
          if (seq !== seqRef.current) return;
          // One failed search must not take the page down with it: the line is shown, whatever
          // is already on screen stays.
          setState((s) => ({ ...s, loading: false, error: apiErrorText(e) }));
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      seqRef.current += 1;
    };
    // `filterKey` is the filter set in a comparable form (see searchFilterKey's role).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, query, filterKey]);

  const loadMore = useCallback(() => {
    const cur = stateRef.current;
    if (projectId === null || cur.loading || cur.loadingMore) return;
    if (!canLoadMoreSearch(cur.results.length, cur.total)) return;
    const offset = nextSearchOffset(cur.offset);
    const seq = seqRef.current;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    void (async () => {
      try {
        const res = await api.searchSessions(projectId, searchRequest(cur.query, filters, offset));
        if (seq !== seqRef.current) return;
        setState((s) => ({
          ...s,
          results: appendSearchPage(s.results, res.results),
          total: res.total,
          index: res.index,
          offset,
          loadingMore: false,
        }));
      } catch (e) {
        if (seq !== seqRef.current) return;
        setState((s) => ({ ...s, loadingMore: false, error: apiErrorText(e) }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filterKey]);

  return {
    query: state.query,
    results: state.results,
    total: state.total,
    index: state.index,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    hasMore: canLoadMoreSearch(state.results.length, state.total),
    loadMore,
  };
}

/** Rows one "show more" reveals, exposed for the page's own paging (the sidebar shows 30 too). */
export const SEARCH_PAGE = SEARCH_PAGE_SIZE;
