/**
 * Product tags on the Activities list: the counts the filter offers, the filter itself, and
 * the rules the server applies to a typed tag, mirrored here so the author hears about a bad
 * one before saving. The server stays the authority (`activities/tags.ts`).
 */

/** Mirrors the server's TAG_MAX and TAGS_MAX. */
export const TAG_MAX = 32;
export const TAGS_MAX = 20;

// C0 and C1 control characters that are not whitespace survive the collapse below.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Every tag the listed activities carry with how many carry it, A→Z ignoring case. Tags
 * that differ only in case (two products spelled one differently) count as one, under the
 * first spelling met.
 */
export function tagCounts(items: readonly { tags?: readonly string[] }[]): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const tag of item.tags ?? []) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (left, right) =>
      left.tag.localeCompare(right.tag, undefined, { sensitivity: "base" }) ||
      left.tag.localeCompare(right.tag),
  );
}

/** The activities carrying `tag` (ignoring case), or all of them when no tag is chosen. */
export function filterByTag<T extends { tags?: readonly string[] }>(
  items: readonly T[],
  tag: string | null,
): T[] {
  if (!tag) return [...items];
  const key = tag.toLowerCase();
  return items.filter((item) => (item.tags ?? []).some((entry) => entry.toLowerCase() === key));
}

export type TagProblem = "tooLong" | "tooMany" | "invalid";

/**
 * Add a typed tag to a product's tags the way the server would store it: trimmed, inner
 * whitespace collapsed, a duplicate (ignoring case) ignored. Returns the problem instead
 * when the server would refuse it; an empty entry changes nothing.
 */
export function normalizeTagInput(
  text: string,
  current: readonly string[],
): { tags: string[] } | { problem: TagProblem } {
  const tag = text.trim().replace(/\s+/g, " ");
  if (!tag) return { tags: [...current] };
  if (CONTROL.test(tag)) return { problem: "invalid" };
  if (tag.length > TAG_MAX) return { problem: "tooLong" };
  if (current.some((entry) => entry.toLowerCase() === tag.toLowerCase()))
    return { tags: [...current] };
  if (current.length >= TAGS_MAX) return { problem: "tooMany" };
  return { tags: [...current, tag] };
}
