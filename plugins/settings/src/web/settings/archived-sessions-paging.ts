/**
 * A group's pages on the archive page (Settings › Archived chats): the rows held from the
 * group's top down to the furthest page read, the page cut out of them, and the read that
 * extends them.
 *
 * Page k is held rows 10k to 10k+9. A page past the rows held is read below the last row held
 * (the listing's `before` cursor), so page k+1 starts where page k ends, and a page already held
 * costs no request. The held rows run from the group's top with no gap, so a page's place agrees
 * with the group's count, and the pager can count pages from it.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { SIDEBAR_PAGE_SIZE } from "../../lib/session-grouping";

/** Rows a group shows per page. */
export const ARCHIVE_ROW_PAGE = SIDEBAR_PAGE_SIZE;

/** A run of a group's rows from its top, and whether the server holds more below the last one. */
export interface HeldRows {
  sessions: SessionInfo[];
  hasMore: boolean;
}

/** One read of a group: up to `limit` rows below `before` (from the top when absent). */
export type ReadRows = (limit: number, before?: SessionInfo) => Promise<HeldRows>;

/** Nothing read yet: the group's top, with everything below it. */
const FROM_TOP: HeldRows = { sessions: [], hasMore: true };

/** The rows of `page` (0-based) among those held. */
export const pageRows = (sessions: readonly SessionInfo[], page: number): SessionInfo[] =>
  sessions.slice(page * ARCHIVE_ROW_PAGE, (page + 1) * ARCHIVE_ROW_PAGE);

/** How many rows must be held for `page` to be whole. */
export const rowsThrough = (page: number): number => (page + 1) * ARCHIVE_ROW_PAGE;

/**
 * Where a group stands once its rows changed: on `page` while the server may hold rows for it,
 * else on the last page that still has rows (the first, when none has).
 */
export function settlePage(page: number, held: HeldRows): number {
  if (held.hasMore) return page;
  return Math.min(page, Math.max(0, Math.ceil(held.sessions.length / ARCHIVE_ROW_PAGE) - 1));
}

/** The pager's page count: the pages the group's count fills, and never fewer than the page shown. */
export const pageCountOf = (count: number, page: number): number =>
  Math.max(1, Math.ceil(count / ARCHIVE_ROW_PAGE), page + 1);

/** `rows` with `below` after them, a row already there kept once (it moved while being read). */
export function joinBelow(
  rows: readonly SessionInfo[],
  below: readonly SessionInfo[],
): SessionInfo[] {
  const seen = new Set(rows.map((s) => s.sessionId));
  return [...rows, ...below.filter((s) => !seen.has(s.sessionId))];
}

/**
 * Extends `held` until it holds `need` rows or the group has none below: each read continues
 * below the last row held, at most `max` rows at a time. A read that adds nothing ends the run,
 * so a server that says "more" and sends none cannot keep it going.
 */
export async function readThrough(
  read: ReadRows,
  need: number,
  max: number,
  held: HeldRows = FROM_TOP,
): Promise<HeldRows> {
  let { sessions, hasMore } = held;
  while (hasMore && sessions.length < need) {
    const page = await read(Math.min(need - sessions.length, max), sessions.at(-1));
    const joined = joinBelow(sessions, page.sessions);
    hasMore = page.hasMore && joined.length > sessions.length;
    sessions = joined;
  }
  return { sessions, hasMore };
}
