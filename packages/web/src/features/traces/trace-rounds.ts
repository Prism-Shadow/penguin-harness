/**
 * Which rounds the Trace file view draws and reads (pure — unit-tested in
 * test/trace-rounds.test.ts).
 *
 * The analysis describes the WHOLE file — every figure on the panel and every round's
 * `messageFrom`/`messageTo` index range — in one request. The events behind a round are read
 * only when that round is open, and only that round's range: a long Session's file is tens of
 * megabytes and thousands of rounds, and reading or drawing all of it at once is what stalled
 * the panel. Round cards are drawn a page at a time from the newest end, so the list itself
 * stays a bounded number of heads however long the file is.
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceEventsResponse } from "@prismshadow/penguin-server/api";

/** Round cards drawn per step: the panel opens on the newest this many, and each "earlier" click adds this many more. */
export const TRACE_ROUNDS_PAGE = 50;

/**
 * Events per request: the largest `limit` the events endpoint accepts (it rejects anything
 * above 1000), so a round is read in the fewest round trips the server allows.
 */
export const TRACE_EVENT_PAGE_SIZE = 1000;

/** A round as the analysis places it in the file: its inclusive event index range. */
export interface RoundRange {
  taskIndex: number;
  messageFrom: number;
  messageTo: number;
}

/** Cancellation handed to a read by its caller; flipped when the view moves to another file or unmounts. */
export interface TraceEventsSignal {
  cancelled: boolean;
}

/**
 * How many events a round's range holds. A round the analysis gave no message (its range left
 * at -1, or inverted) holds none and is never read.
 */
export function roundSpan(range: RoundRange): number {
  if (range.messageFrom < 0 || range.messageTo < range.messageFrom) return 0;
  return range.messageTo - range.messageFrom + 1;
}

/**
 * The rounds the panel draws: the newest `shown` of `tasks`, oldest first. The analysis lists
 * rounds in file order already; they are sorted here anyway, on a copy, so the card order never
 * depends on how the server happened to build the list.
 */
export function visibleRounds<T extends RoundRange>(tasks: readonly T[], shown: number): T[] {
  const sorted = [...tasks].sort((a, b) => a.taskIndex - b.taskIndex);
  return sorted.slice(Math.max(0, sorted.length - Math.max(0, shown)));
}

/**
 * Read one round's events, in file order, within `[messageFrom, messageTo]`, at most
 * TRACE_EVENT_PAGE_SIZE per request — `ceil(span / 1000)` requests for a round the server
 * answers in full, none for an empty round.
 *
 * The next offset is the end of what actually arrived, never `offset + limit`, so a page the
 * server answers short leaves no hole. The read stops early, with what it has, on a page that
 * carries no events or once it reaches the page's `total`: the analysis reads a record that is
 * still being appended a moment before the events endpoint counts it, and a range that runs
 * past the file's end must not loop asking for it. Events past `messageTo` in a page are
 * dropped, so the result never leaks into the next round.
 *
 * Cancellation is checked on both sides of every await, and a cancelled read resolves with
 * whatever it had: the caller checks its own signal before using the result. Rejections are not
 * caught — the caller decides what a failed round shows.
 */
export async function loadRoundEvents(
  fetchPage: (offset: number, limit: number) => Promise<TraceEventsResponse>,
  range: RoundRange,
  opts: { signal?: TraceEventsSignal } = {},
): Promise<OmniMessage[]> {
  const events: OmniMessage[] = [];
  if (roundSpan(range) === 0) return events;
  // Read through a call, not inline: the flag flips while a page is in flight, and an inline
  // check would narrow it to `false` for the rest of the loop body.
  const cancelled = (): boolean => opts.signal?.cancelled === true;
  let offset = range.messageFrom;
  while (offset <= range.messageTo) {
    if (cancelled()) return events;
    const limit = Math.min(TRACE_EVENT_PAGE_SIZE, range.messageTo - offset + 1);
    const page = await fetchPage(offset, limit);
    if (cancelled()) return events;
    const taken = page.events.slice(0, range.messageTo - offset + 1);
    if (taken.length === 0) return events;
    events.push(...taken);
    offset += taken.length;
    if (offset >= page.total) return events;
  }
  return events;
}

/**
 * The expanded rounds whose cached range no longer matches the fresh analysis — in practice the
 * round still running, which grows with every settled turn. Only these are re-read on a
 * refresh; a collapsed round keeps its cache untouched until it is opened again, and a round the
 * cache does not hold is a first read, not a stale one.
 */
export function staleRounds(
  cached: ReadonlyMap<number, RoundRange>,
  fresh: readonly RoundRange[],
  expanded: ReadonlySet<number>,
): number[] {
  const stale: number[] = [];
  for (const round of fresh) {
    if (!expanded.has(round.taskIndex)) continue;
    const held = cached.get(round.taskIndex);
    if (held === undefined) continue;
    if (held.messageFrom !== round.messageFrom || held.messageTo !== round.messageTo) {
      stale.push(round.taskIndex);
    }
  }
  return stale;
}

/**
 * The rounds to read now: of the drawn rounds, the open ones the cache does not hold yet and the
 * open ones whose cached range the analysis has since moved. A collapsed round is never read,
 * nor is an open one scrolled out of the drawn window — opening or revealing it is what reads it.
 */
export function roundsToRead<T extends RoundRange>(
  tasks: readonly T[],
  shown: number,
  expanded: ReadonlySet<number>,
  cached: ReadonlyMap<number, RoundRange>,
): T[] {
  const open = visibleRounds(tasks, shown).filter((t) => expanded.has(t.taskIndex));
  const stale = new Set(staleRounds(cached, open, expanded));
  return open.filter((t) => !cached.has(t.taskIndex) || stale.has(t.taskIndex));
}

/** The newest round's taskIndex, or null for a file with no round yet. */
function newestRound(rounds: readonly RoundRange[]): number | null {
  let newest: number | null = null;
  for (const r of rounds) if (newest === null || r.taskIndex > newest) newest = r.taskIndex;
  return newest;
}

/**
 * The expanded set once an analysis lands. A file seen for the first time (`previous` null, or
 * a file that had no round yet) opens on its newest round only. On a refresh the reader's
 * choices stand, and a round that appeared since arrives collapsed — unless the round that was
 * newest before it is open: a reader following the run keeps following it, so the new newest
 * round opens beside it.
 */
export function expandedAfterAnalysis(
  previous: readonly RoundRange[] | null,
  fresh: readonly RoundRange[],
  expanded: ReadonlySet<number>,
): ReadonlySet<number> {
  const freshNewest = newestRound(fresh);
  const previousNewest = previous === null ? null : newestRound(previous);
  if (previousNewest === null) return new Set(freshNewest === null ? [] : [freshNewest]);
  if (freshNewest === null || freshNewest === previousNewest || !expanded.has(previousNewest)) {
    return expanded;
  }
  return new Set([...expanded, freshNewest]);
}

/**
 * The round to scroll into view once an analysis lands: on the analysis that opens the file
 * (the same one expandedAfterAnalysis opens on its newest round), that newest round — the last
 * card drawn, below up to TRACE_ROUNDS_PAGE − 1 collapsed ones. Null on every refresh after it,
 * including one that opens a new round for a reader following the run: a settled turn never
 * moves the reader's scroll.
 */
export function revealAfterAnalysis(
  previous: readonly RoundRange[] | null,
  fresh: readonly RoundRange[],
): number | null {
  if (previous !== null && newestRound(previous) !== null) return null;
  return newestRound(fresh);
}
