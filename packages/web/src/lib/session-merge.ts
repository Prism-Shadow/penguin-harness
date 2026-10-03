/**
 * Merging what several machines answered into the one list the sidebar shows.
 *
 * Each machine answers about itself — its own Sessions, its own pagination, its own counts —
 * so the merge happens here, and one thing about it fails quietly: a folder badge that only
 * counted one machine would contradict the rows right under it. Counts are therefore SUMMED
 * across the sources that answered; a source that could not answer contributes no count,
 * which is the truth — a count is a claim about what a server holds now.
 */
import { compareActivityDesc } from "./session-grouping";
import type { ActivityKey } from "./session-grouping";

/**
 * Most recently active first: the order the sidebar displays its rows in and the order every
 * server pages them in (`order=activity`), so the merged pool and each source's pages agree.
 * Ties by id, so the order is total and equal stamps do not reshuffle between refreshes.
 */
export function mostRecentFirst<T extends ActivityKey>(a: T, b: T): number {
  return compareActivityDesc(a, b);
}

/**
 * Sums the per-category counts each machine reported. Undefined when no source reported any —
 * a store must not turn "nobody counted" into a zero, which the folder would render as empty.
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
