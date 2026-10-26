/**
 * The text a session search actually matches on: the CJK-segmented projection written into
 * `session_search.text`, the FTS5 expression a user's query becomes, and the snippet cut out
 * of a hit.
 *
 * Why a projection at all: FTS5's default `unicode61` tokenizer treats a run of CJK
 * characters as ONE token, so "软著提交" indexes as a single token and a two-character query
 * ("软著") matches nothing — the case this whole surface exists for. `trigram` would fix
 * that but cannot answer a query shorter than three characters, which is most Chinese words.
 * So the indexed text is rewritten into overlapping unigrams and bigrams of every CJK run
 * (`软著提交` → `软 · 软著 · 著 · 著提 · 提 · 提交 · 交`), and a CJK query becomes the matching
 * PHRASE of those same pieces: adjacent pieces mean adjacent characters, so `"软 软著 著"`
 * matches "软著" and nothing else.
 *
 * The projection is deliberately lossy — forming bigrams repeats characters — so it is not
 * an encoding of the text and cannot be decoded back. The original therefore travels beside
 * it in the FTS table's UNINDEXED `raw` column, which is what snippets are cut from. (FTS5's
 * own snippet() is unusable here for the same reason: it rebuilds text from tokens, and would
 * show every character of a CJK run twice.)
 */

const CJK = /[⺀-⻿　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/;

/**
 * The character the projection puts between two tokens; absent from every real message.
 *
 * Spelled as a code point rather than a literal: an actual U+0001 in a source file is
 * invisible, and any tool that normalizes source would quietly turn the projection back into
 * the very string it was built to differ from.
 */
export const SEGMENT_SEPARATOR = String.fromCharCode(1);

/** Longest message actually indexed: a runaway tool-shaped blob is truncated, not skipped. */
export const MAX_INDEXED_CHARS = 20_000;

/** How much of one hit's text a snippet shows, in characters, before and after the match. */
const SNIPPET_RADIUS = 90;

/** Longest query accepted, in characters. */
export const MAX_QUERY_CHARS = 200;

const isCjk = (ch: string): boolean => CJK.test(ch);

/**
 * The searchable projection of `text`: every CJK run expanded to its unigrams and bigrams,
 * separated by {@link SEGMENT_SEPARATOR}, everything else left alone.
 *
 * Latin runs are left in place but the separator is inserted at every CJK boundary, which is
 * what keeps "ERP软著" from indexing as the single token "erp软著" (unicode61 does not break
 * a token at a script change — both halves are letters).
 */
export function indexableProjection(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (!isCjk(text[i]!)) {
      out += text[i];
      i += 1;
      continue;
    }
    let end = i;
    while (end < text.length && isCjk(text[end]!)) end += 1;
    const chars = [...text.slice(i, end)];
    out += SEGMENT_SEPARATOR;
    for (let k = 0; k < chars.length; k += 1) {
      out += chars[k];
      if (k + 1 < chars.length) out += SEGMENT_SEPARATOR + chars[k] + chars[k + 1];
      out += SEGMENT_SEPARATOR;
    }
    i = end;
  }
  return out;
}

/** The token pieces a CJK run searches as, in order. */
function cjkPieces(chars: string[]): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    pieces.push(chars[i]!);
    if (i + 1 < chars.length) pieces.push(chars[i]! + chars[i + 1]!);
  }
  return pieces;
}

/** FTS5 string literal escaping: a double quote inside a phrase is doubled. */
const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * The FTS5 MATCH expression for a user's query, or `""` when the query holds nothing a token
 * can match (punctuation only) — the caller answers "no results" rather than matching all.
 *
 * Terms are whitespace-separated and ANDed, which is what people expect from a search box:
 * "软著 ERP" is the session that mentions both. One term may itself be mixed ("ERP软著"),
 * in which case each of its runs becomes its own ANDed clause.
 */
export function queryExpression(query: string): string {
  const clauses: string[] = [];
  for (const term of query.trim().split(/\s+/).slice(0, 16)) {
    if (!term) continue;
    let i = 0;
    while (i < term.length) {
      if (isCjk(term[i]!)) {
        let end = i;
        while (end < term.length && isCjk(term[end]!)) end += 1;
        const pieces = cjkPieces([...term.slice(i, end)]);
        if (pieces.length) clauses.push(quote(pieces.join(" ")));
        i = end;
      } else {
        let end = i;
        while (end < term.length && !isCjk(term[end]!)) end += 1;
        // Punctuation inside a term is not part of a token; keep only what unicode61 folds.
        const word = term.slice(i, end).replace(/[^\p{L}\p{N}_]+/gu, "");
        if (word) clauses.push(quote(word));
        i = end;
      }
    }
  }
  return clauses.join(" AND ");
}

/**
 * The literal strings a query searches for, used to MARK a hit. Same split as
 * {@link queryExpression}: a CJK run stays one needle, a Latin run loses its punctuation.
 */
export function queryNeedles(query: string): string[] {
  const needles: string[] = [];
  for (const term of query.trim().split(/\s+/).slice(0, 16)) {
    let i = 0;
    while (i < term.length) {
      if (isCjk(term[i]!)) {
        let end = i;
        while (end < term.length && isCjk(term[end]!)) end += 1;
        needles.push(term.slice(i, end));
        i = end;
      } else {
        let end = i;
        while (end < term.length && !isCjk(term[end]!)) end += 1;
        const word = term.slice(i, end).replace(/[^\p{L}\p{N}_]+/gu, "");
        if (word) needles.push(word);
        i = end;
      }
    }
  }
  return needles;
}

/** A snippet cut around the first needle occurrence, with the matched ranges marked. */
export interface SearchSnippet {
  /** The excerpt; `…` marks a cut at either end. */
  text: string;
  /** Matched ranges as [start, end) offsets INTO {@link text}, ascending and non-overlapping. */
  marks: Array<[number, number]>;
}

function firstIndex(haystack: string, needle: string, from: number): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/**
 * A snippet of `text` around the first match of any needle, marked for highlighting.
 *
 * Marking is done on the EXCERPT's own coordinates (not the full text's), so the caller
 * renders `text` and highlights `marks` without knowing where the window started. A hit with
 * no literal occurrence — FTS5 folds case and unicode, a needle may be a projection piece —
 * falls back to the head of the text, which is still a usable excerpt.
 */
export function snippetAround(
  text: string,
  needles: string[],
  radius = SNIPPET_RADIUS,
): SearchSnippet {
  const clean = text.replace(/\s+/g, " ").trim();
  let hit = -1;
  let hitNeedle = "";
  for (const needle of needles) {
    if (!needle) continue;
    const at = firstIndex(clean, needle, 0);
    if (at >= 0 && (hit < 0 || at < hit)) {
      hit = at;
      hitNeedle = needle;
    }
  }
  if (hit < 0) {
    const head = clean.slice(0, radius * 2);
    return { text: clean.length > head.length ? `${head}…` : head, marks: [] };
  }
  const start = Math.max(0, hit - radius);
  const end = Math.min(clean.length, hit + hitNeedle.length + radius);
  const excerpt = clean.slice(start, end);
  const offset = hit - start;
  const marks: Array<[number, number]> = [];
  // Every needle occurrence inside the window, so "软著 提交" marks both.
  for (const needle of needles) {
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = firstIndex(excerpt, needle, from);
      if (at < 0) break;
      marks.push([at, at + needle.length]);
      from = at + Math.max(1, needle.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [a, b] of marks) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return {
    text: `${start > 0 ? "…" : ""}${excerpt}${end < clean.length ? "…" : ""}`,
    marks: merged.map(
      ([a, b]) => [a + (start > 0 ? 1 : 0), b + (start > 0 ? 1 : 0)] as [number, number],
    ),
  };
}
