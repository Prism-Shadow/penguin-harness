/**
 * Pure logic of the conversation search: the sidebar's quick box
 * (features/chat/session-search-panel.tsx) and the full search page (features/search/*) ask
 * the same endpoint and page through it the same way, so both read from here and share the
 * fetching hook (lib/use-conversation-search.ts).
 *
 * Kept out of the components because this package's vitest runs in a **node** environment —
 * no DOM, so nothing that renders can be tested — while everything that decides *what* the
 * search box shows can be: which query a set of filters asks for, which page of results the
 * "show more" row asks for next, how a paged answer is folded into the list already on
 * screen, and how a server excerpt is cut into the highlighted spans the row renders.
 */
import type { SearchHit, SearchQuery, SearchResult } from "@prismshadow/penguin-server/api";
import type { GroupMode } from "../components/ui/group-list";
import { localYmd } from "./format";

/**
 * Results per search request. Chosen over the sidebar's own page size (10) because a search
 * answers a different question: the user is looking for ONE remembered conversation, and a
 * short page makes "show more" the normal way to finish reading the answer.
 */
export const SEARCH_PAGE_SIZE = 30;

/**
 * The Agent a search is narrowed to, or undefined for the whole Project.
 *
 * Only Agent grouping narrows: there the list on screen is one Agent's, so results from
 * other Agents would answer a question the user did not ask. Workspace and time grouping span
 * every Agent by construction (a workspace holds several Agents' chats, the time buckets are
 * Project-wide), so those search everything — which is also the only way a search can find
 * the conversation whose Agent has no group of its own in view.
 */
export function searchAgentScope(
  mode: GroupMode,
  currentAgentId: string | null,
): string | undefined {
  return mode === "agent" ? (currentAgentId ?? undefined) : undefined;
}

/**
 * Folds the next page of results into the ones already on screen.
 *
 * Paging here is offset-based over a ranking the server recomputes per request, so a page can
 * repeat a row the previous one already showed (a newer conversation shifting the window
 * between two requests) — and a duplicate would render as two rows for one chat. The first
 * occurrence wins: the earlier page carried the earlier rank, and dropping the later copy is
 * what keeps a row from jumping while the reader is looking at it.
 *
 * Returns the SAME array when nothing was added, so a caller can skip the re-render.
 */
export function appendSearchPage(
  prev: readonly SearchResult[],
  next: readonly SearchResult[],
): readonly SearchResult[] {
  const seen = new Set(prev.map((r) => r.sessionId));
  const merged: SearchResult[] = [...prev];
  for (const r of next) {
    if (seen.has(r.sessionId)) continue;
    seen.add(r.sessionId);
    merged.push(r);
  }
  return merged.length === prev.length ? prev : merged;
}

/**
 * The offset the next page asks for. Driven by the offset the server last answered rather
 * than by the number of rows on screen: dedupe (see {@link appendSearchPage}) can leave the
 * list shorter than the window walked, and paging by what is rendered would then ask for a
 * window that overlaps the last one.
 */
export function nextSearchOffset(offset: number, limit: number = SEARCH_PAGE_SIZE): number {
  return offset + limit;
}

/** Whether a "show more" row is still owed: the server says more matches exist than are on screen. */
export function canLoadMoreSearch(loaded: number, total: number): boolean {
  return loaded < total;
}

/**
 * The excerpted messages one result row shows.
 *
 * A title-only match has no message to quote, and the caller draws a "title hit" line for it
 * instead — showing zero excerpts is what keeps that line and the excerpt block from both
 * claiming the row. At most three, which is the server's own cap.
 */
export function searchExcerpt(result: SearchResult): readonly SearchHit[] {
  return result.matchedTitle ? [] : result.hits.slice(0, 3);
}

/** One run of an excerpt: `marked` says whether it is inside a match range (drawn as a <mark>). */
export interface MarkedSegment {
  text: string;
  marked: boolean;
}

/**
 * Cuts an excerpt into the runs the row paints, marks aside: every offset the server reported
 * becomes one `marked` run, the text between them the plain ones.
 *
 * The ranges arrive as [start, end) offsets INTO the snippet, but they are treated as
 * untrusted input all the same: an empty or inverted range would otherwise slice the string
 * backwards and produce a duplicated tail, and one running past the end would silently drop
 * the matched word. So each range is clamped to the snippet, dropped when it covers nothing,
 * and overlapping neighbours are merged — two marks on one word are one mark, and a
 * half-overlapping pair must not render as two abutting ones.
 */
export function markedSegments(
  snippet: string,
  marks: readonly (readonly [number, number])[],
): MarkedSegment[] {
  const ranges: Array<[number, number]> = [];
  for (const [start, end] of marks) {
    const from = Math.max(0, Math.min(start, snippet.length));
    const to = Math.max(0, Math.min(end, snippet.length));
    if (to > from) ranges.push([from, to]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const segments: MarkedSegment[] = [];
  /** End of the run already emitted, i.e. where the next plain run starts. */
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (to <= cursor) continue; // already inside an emitted mark
    // A range that overlaps the previous one continues it rather than restarting inside it:
    // the part below `cursor` is already marked, so only the rest is cut.
    const start = Math.max(from, cursor);
    if (start > cursor) segments.push({ text: snippet.slice(cursor, start), marked: false });
    const last = segments[segments.length - 1];
    if (start === cursor && last?.marked) last.text += snippet.slice(start, to);
    else segments.push({ text: snippet.slice(start, to), marked: true });
    cursor = to;
  }
  if (cursor < snippet.length) segments.push({ text: snippet.slice(cursor), marked: false });
  return segments;
}

/**
 * The part of a tool label that is NOT the tool name.
 *
 * The server builds a label as `name` plus whatever argument best says what the call was for
 * (`read_file /path`, `exec_command git status`). The timeline already prints the name in its
 * own column, so the detail column takes what follows it — otherwise every row reads
 * "read_file read_file /path".
 */
export function toolDetail(name: string, label: string): string {
  return label.startsWith(`${name} `) ? label.slice(name.length + 1) : label;
}

// ---------------------------------------------------------------------------
// The full search page's filters
// ---------------------------------------------------------------------------

/**
 * The time window the search page offers. `all` asks for no window at all (the server treats
 * an absent bound as unbounded) rather than for some very old date, so a conversation from
 * before any window anyone would invent still answers.
 *
 * Note what the window really bounds: the server applies it to a conversation's CREATION
 * date, the same column its list filter uses. A chat opened this morning and still going
 * yesterday afternoon is a recent conversation by every other measure, so the page's label
 * says 「创建于」 rather than pretending the window is about when people talked.
 */
export type SearchRangePreset = "all" | "today" | "7d" | "30d";

/** Everything on the search page's filter bar except the query itself. */
export interface SearchFilters {
  /** Narrow to one Agent; undefined searches the whole Project. */
  agentId: string | undefined;
  /** Substring of the Workspace path; blank searches every Workspace. */
  workspace: string;
  range: SearchRangePreset;
  includeArchived: boolean;
  sort: "recent" | "relevance";
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  agentId: undefined,
  workspace: "",
  range: "all",
  includeArchived: false,
  sort: "relevance",
};

/** The `yyyy-mm-dd` bounds a window preset asks for (no bounds for `all`). */
export function searchRangeBounds(
  preset: SearchRangePreset,
  today: Date,
): { from?: string; to?: string } {
  if (preset === "all") return {};
  const to = localYmd(today);
  const from = new Date(today);
  from.setDate(from.getDate() - (preset === "today" ? 0 : preset === "7d" ? 6 : 29));
  return { from: localYmd(from), to };
}

/**
 * The request one search page state makes of the server: the query, the filters that are
 * actually set, and the page being asked for.
 *
 * Unset filters are dropped rather than sent empty, because the server reads an empty bound as
 * absent and the URL should say the same thing the state means — a Workspace field the user
 * typed spaces into is not a filter, it is an empty one.
 */
export function searchRequest(
  q: string,
  filters: SearchFilters,
  offset: number,
  limit: number = SEARCH_PAGE_SIZE,
): Omit<SearchQuery, "projectId"> {
  const bounds = searchRangeBounds(filters.range, new Date());
  const workspace = filters.workspace.trim();
  return {
    q: q.trim(),
    ...(filters.agentId !== undefined ? { agentId: filters.agentId } : {}),
    ...bounds,
    ...(workspace !== "" ? { workspace } : {}),
    ...(filters.includeArchived ? { includeArchived: true } : {}),
    limit,
    offset,
    sort: filters.sort,
  };
}

/**
 * A stable string for a filter set, so a caller can key an effect (or a memo) on "the filters
 * changed" without listing six fields — and without the object identity churn that would
 * re-run a search on every parent render.
 */
export function searchFilterKey(filters: SearchFilters): string {
  return [
    filters.agentId ?? "",
    filters.workspace.trim(),
    filters.range,
    filters.includeArchived ? "1" : "0",
    filters.sort,
  ].join("|");
}

/**
 * The full search page's route for a query — how the sidebar's quick box hands the query it is
 * holding over to the page that can filter it. A blank query asks for no `?q=` at all, which
 * is the page's own "type something" state rather than a request it would have to refuse.
 */
export function searchPagePath(query: string): string {
  const q = query.trim();
  return q === "" ? "/search" : `/search?q=${encodeURIComponent(q)}`;
}
