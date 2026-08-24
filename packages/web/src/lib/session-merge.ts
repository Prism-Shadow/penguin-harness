/**
 * Merging one page of Sessions from several machines into the one list the sidebar shows.
 *
 * Each machine answers about itself — its own Sessions, its own pagination — so the merge
 * happens here. Two things it must get right, because both fail quietly:
 *
 * - **Order.** Every source is already sorted newest-first, and the merged page has to stay
 *   that way or the sidebar's "recent" reads as arbitrary. Ties keep source order, which
 *   makes the result stable between refreshes instead of shuffling equal timestamps.
 * - **"There is more".** A page is `hasMore` if ANY source had more, or if the sources
 *   together overflowed the page. Losing that flag hides Sessions behind a button that
 *   never appears — the failure looks like the Sessions do not exist.
 *
 * Deduped by session id: the same Session cannot be on two machines, but a machine reached
 * through two routes could answer twice, and a duplicate row is worse than a missing one.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

/** One machine's answer: its page, and whether it had more beyond it. */
export interface SessionSource {
  /** The machine these came from; null is this one. */
  machineId: string | null;
  items: SessionInfo[];
  hasMore: boolean;
}

/** A merged page, plus where each Session came from. */
export interface MergedSessions {
  items: SessionInfo[];
  hasMore: boolean;
  /** sessionId → machine, for the routing map every later call about it uses. */
  owners: Array<{ sessionId: string; machineId: string | null }>;
}

/** Newest first, by the field the server's own index orders on. */
const newestFirst = (a: SessionInfo, b: SessionInfo): number =>
  b.createdAt.localeCompare(a.createdAt);

export function mergeSessionPages(sources: SessionSource[], pageSize: number): MergedSessions {
  const owners: Array<{ sessionId: string; machineId: string | null }> = [];
  const seen = new Set<string>();
  const all: SessionInfo[] = [];
  for (const source of sources) {
    for (const session of source.items) {
      if (seen.has(session.sessionId)) continue;
      seen.add(session.sessionId);
      all.push(session);
      owners.push({ sessionId: session.sessionId, machineId: source.machineId });
    }
  }
  // Stable sort: equal timestamps keep the order the sources were read in, so the list does
  // not reshuffle between refreshes.
  all.sort(newestFirst);
  const overflowed = all.length > pageSize;
  return {
    items: overflowed ? all.slice(0, pageSize) : all,
    hasMore: overflowed || sources.some((source) => source.hasMore),
    owners,
  };
}

/**
 * Sums the per-category counts each machine reported. Counts drive the folder badges, and a
 * badge that only counted this machine would contradict the rows right under it.
 */
export function mergeCounts<T extends Record<string, number>>(
  counts: Array<T | undefined>,
): T | undefined {
  const present = counts.filter((entry): entry is T => entry !== undefined);
  if (present.length === 0) return undefined;
  const out = {} as Record<string, number>;
  for (const entry of present) {
    for (const [key, value] of Object.entries(entry)) out[key] = (out[key] ?? 0) + value;
  }
  return out as T;
}
