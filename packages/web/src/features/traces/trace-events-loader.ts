/**
 * Sequential pager for a Trace file's events (pure — unit-tested in test/trace-events-loader.test.ts).
 *
 * The events endpoint is paginated and its `limit` is capped server-side, while the analysis
 * beside it describes the WHOLE file: every round carries a `messageFrom`/`messageTo` index
 * range, so a view that fetched one page only had nothing to show for any round whose range
 * started past that page — the last rounds of a long file, the compaction round among them.
 * The walk here is what closes that gap: it keeps asking for the next page until the file is
 * covered, reporting each page as it arrives so the first one is on screen while the rest load.
 *
 * Pages are fetched one at a time rather than in parallel: the file is read from disk in order,
 * the next offset is only known from the page before it (a page may come back short), and a
 * reader looking at round one does not benefit from round nine's page racing it.
 */
import type { TraceEventsResponse } from "@prismshadow/penguin-server/api";

/**
 * Hard stop on the number of requests one walk may make. With the endpoint's 1000-event page
 * this covers a 500,000-event file, far past any Trace a Session produces (files rotate on
 * compaction), so the cap is only ever reached by a server that stops making progress — a page
 * that reports a `total` it never delivers would otherwise loop for as long as the view is open.
 */
export const MAX_TRACE_EVENT_PAGES = 500;

/**
 * Events per request: the largest `limit` the events endpoint accepts (it rejects anything
 * above 1000), so a file is covered in the fewest round trips the server allows.
 */
export const TRACE_EVENT_PAGE_SIZE = 1000;

/** Cancellation handed to a walk by its caller; flipped by a React effect's cleanup. */
export interface TraceEventsSignal {
  cancelled: boolean;
}

export interface LoadTraceEventPagesOptions {
  /** Events per request. The endpoint rejects a `limit` above its own maximum, so pass TRACE_EVENT_PAGE_SIZE. */
  pageSize: number;
  /** Called once per fetched page, in file order, for the caller to render. */
  onPage: (page: TraceEventsResponse) => void;
  /** When its `cancelled` turns true the walk stops and reports nothing further. */
  signal?: TraceEventsSignal;
}

/**
 * Walk a Trace file's events from its start, reporting every page through `onPage`.
 *
 * The next offset is the end of what has actually been delivered (`offset + events.length`),
 * never `offset + pageSize`: the last page of a file is short, and any page the server answers
 * with fewer events than were asked for must not leave a hole behind it either. The walk ends
 * when that offset reaches the LATEST page's `total` — read per page, so a file appended to
 * while the walk runs is followed to its new end rather than cut at the length it had when the
 * first page was served.
 *
 * A page carrying no events also ends the walk, whatever its `total` claims: a file truncated
 * under the reader cannot be paged any further, and continuing would re-request the same offset
 * forever. Cancellation is checked on both sides of every await — after one, so a page that
 * arrives for a view that is gone is not rendered into it; before the next, so no further
 * request is issued once the caller has stopped caring about the answer.
 *
 * Rejections are not caught: the caller decides what a failed page means for what is already on
 * screen. Pages reported before it stand.
 *
 * Resolves with the `total` of the LAST page it reported — the walk's final word on how long the
 * file is, which a caller holding pages from an earlier walk uses to drop whatever sits past the
 * end. A walk that reported no page at all (cancelled before its first) resolves with 0, so the
 * caller must consult its own cancellation before acting on the number.
 */
export async function loadTraceEventPages(
  fetchPage: (offset: number, limit: number) => Promise<TraceEventsResponse>,
  opts: LoadTraceEventPagesOptions,
): Promise<number> {
  let offset = 0;
  let total = 0;
  // Read through a call, not inline: the flag flips while a page is in flight, and an inline
  // check narrows it to `false` for the rest of the loop body, so the post-await check would
  // compare a type the checker believes cannot be `true`.
  const cancelled = (): boolean => opts.signal?.cancelled === true;
  for (let page = 0; page < MAX_TRACE_EVENT_PAGES; page++) {
    if (cancelled()) return total;
    const res = await fetchPage(offset, opts.pageSize);
    if (cancelled()) return total;
    opts.onPage(res);
    total = res.total;
    if (res.events.length === 0) return total;
    offset += res.events.length;
    if (offset >= res.total) return total;
  }
  return total;
}
