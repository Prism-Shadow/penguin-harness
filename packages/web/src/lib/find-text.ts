/**
 * Find-in-page: the matching itself, with no DOM in sight (node-testable; the find bar drives
 * it through the index in lib/find-dom.ts).
 *
 * What a search is, is decided here and only here: a plain substring, no regular expressions,
 * no fuzzy folding. Someone pressing Ctrl+F in a long conversation is looking for the words
 * they remember writing, and every "helpful" transformation on the way (case folding beyond
 * the trivial, accent stripping, word-splitting) is a way for the hit they are staring at to
 * be reported as a miss.
 *
 * Offsets are the currency: a match is a [start, end) pair into the exact string that was
 * searched. The DOM layer maps those back onto text nodes, which is only possible while the
 * offsets line up — hence the one sharp edge in here, the folding of a string that does not
 * survive `toLowerCase()` at constant length (see `fold`).
 */

/** One match, as offsets into the searched string. */
export interface TextMatch {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface FindQuery {
  /** The literal text searched for; empty means "no search". */
  text: string;
  caseSensitive: boolean;
}

/** Matches of `query.text` in `haystack`, in order and non-overlapping. */
export function findMatches(haystack: string, query: FindQuery): TextMatch[] {
  if (query.text === "") return [];
  const hay = fold(haystack, query.caseSensitive);
  const needle = fold(query.text, query.caseSensitive);
  const matches: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return matches;
    matches.push({ start: at, end: at + needle.length });
    // Non-overlapping: "aa" in "aaa" is one hit, not two.
    from = at + needle.length;
  }
}

/**
 * Case-folded text, and **only when that keeps every offset where it was**. A handful of
 * characters (Turkish İ, the German ß under some locales) change length when lowercased, and
 * a folded string one character longer than its source would shift every offset that follows
 * it — the index would then highlight the wrong passage rather than miss it. When the lengths
 * disagree the comparison is done by walking the haystack instead, which is slower but cannot
 * lie.
 */
function fold(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase();
}

/** Whether folding is offset-safe for this pair (see `fold`). */
function foldSafe(haystack: string, query: FindQuery): boolean {
  return query.caseSensitive || haystack.toLowerCase().length === haystack.length;
}

/**
 * Matches for the one case `findMatches` cannot handle by indexOf: a haystack whose lowercase
 * form is a different length. Kept separate so the common path stays a single indexOf loop.
 */
function findMatchesUnsafe(haystack: string, query: FindQuery): TextMatch[] {
  const needle = query.text.toLowerCase();
  const matches: TextMatch[] = [];
  for (let i = 0; i + needle.length <= haystack.length;) {
    const candidate = haystack.slice(i, i + needle.length).toLowerCase();
    if (candidate === needle) {
      matches.push({ start: i, end: i + needle.length });
      i += needle.length;
    } else {
      i += 1;
    }
  }
  return matches;
}

/**
 * All matches of `query` in `haystack`, offset-accurate for any input (`findMatches` plus the
 * offset-shifting fallback).
 */
export function matchAll(haystack: string, query: FindQuery): TextMatch[] {
  return foldSafe(haystack, query)
    ? findMatches(haystack, query)
    : findMatchesUnsafe(haystack, query);
}

/**
 * The index `delta` steps away from `current`, wrapping at both ends — the shape every
 * find-in-page has (Enter at the last hit starts over at the first). `current` may be -1
 * ("nothing selected yet"): forward then means the first match, backward the last.
 */
export function stepMatchIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** A match with its surroundings, for one line of a result list. */
export interface MatchSnippet {
  /** Text before the hit; starts with an ellipsis when it was cut. */
  before: string;
  /** The hit itself, as it appears in the source (never the query's own casing). */
  hit: string;
  /** Text after the hit; ends with an ellipsis when it was cut. */
  after: string;
}

/**
 * One line of context around a match: `radius` characters on each side, cut at the nearest
 * whitespace when there is one to cut at, newlines flattened (a result row is a single line).
 */
export function matchSnippet(text: string, match: TextMatch, radius: number): MatchSnippet {
  const flat = (s: string): string => s.replace(/\s+/g, " ");
  const cutStart = match.start - radius > 0;
  const cutEnd = match.end + radius < text.length;
  let before = text.slice(cutStart ? match.start - radius : 0, match.start);
  let after = text.slice(match.end, cutEnd ? match.end + radius : text.length);
  // A cut that lands inside a word drops that partial word rather than showing half of it —
  // a row starting "…tion of the" reads as a typo. Text without spaces (CJK) keeps the cut.
  if (cutStart) before = before.replace(/^\S*\s/, "");
  if (cutEnd) after = after.replace(/\s\S*$/, "");
  return {
    before: (cutStart ? "…" : "") + flat(before),
    hit: flat(text.slice(match.start, match.end)),
    after: flat(after) + (cutEnd ? "…" : ""),
  };
}
