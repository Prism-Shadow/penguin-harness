/**
 * Dependency-free docs search. The Markdown is already bundled by Vite, so the
 * current content set is small enough to split into heading-sized records and scan
 * in memory. Keeping the index section-based lets a result deep-link to the relevant
 * heading instead of only opening the top of a long page.
 */
import type { DocPage } from "./docs";
import { slugifyHeading } from "./toc";

export interface SearchRecord {
  slug: string;
  anchor: string;
  pageTitle: string;
  heading: string;
  text: string;
  normalizedTitle: string;
  normalizedHeading: string;
  normalizedText: string;
}

export interface SearchResult {
  record: SearchRecord;
  score: number;
  snippet: string;
}

export interface SearchMatchRange {
  start: number;
  end: number;
}

interface NormalizedSourceMap {
  value: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

interface SearchSection {
  heading: string;
  anchor: string;
  lines: string[];
}

const SEARCH_GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Unicode-compatible normalization shared by indexing and querying. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Normalize text while retaining the source offsets for every normalized UTF-16
 * code unit. Segmenting by grapheme keeps compositions such as e + combining acute
 * together, and the pending-space handling mirrors normalizeSearchText exactly.
 */
function normalizeSearchTextWithSourceMap(text: string): NormalizedSourceMap {
  let value = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let pendingSpace: SearchMatchRange | null = null;
  const segments = SEARCH_GRAPHEME_SEGMENTER.segment(text);

  const append = (normalized: string, start: number, end: number) => {
    value += normalized;
    for (let index = 0; index < normalized.length; index += 1) {
      sourceStarts.push(start);
      sourceEnds.push(end);
    }
  };

  for (const { segment, index: sourceStart } of segments) {
    const sourceEnd = sourceStart + segment.length;
    const normalizedSegment = segment.normalize("NFKC").toLowerCase();

    for (const character of normalizedSegment) {
      if (/\s/u.test(character)) {
        if (value) {
          pendingSpace ??= { start: sourceStart, end: sourceEnd };
          pendingSpace.end = sourceEnd;
        }
        continue;
      }

      if (pendingSpace) {
        append(" ", pendingSpace.start, pendingSpace.end);
        pendingSpace = null;
      }
      append(character, sourceStart, sourceEnd);
    }
  }

  return { value, sourceStarts, sourceEnds };
}

/**
 * Remove only paired Markdown emphasis/strikethrough delimiters. Unmatched marker
 * characters can be part of documented identifiers or paths and must remain
 * searchable (for example partial_*, model.*, and ~/.penguin).
 */
function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/(\*\*|~~)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}])__(?=\S)([^\n]*?\S)__(?=$|[^\p{L}\p{N}])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}*_])([*_])(?=\S)([^*_\n]*?\S)\2(?=$|[^\p{L}\p{N}*_])/gu, "$1$3");
}

/** Flatten actual table rows without removing literal pipes from ordinary prose. */
function stripMarkdownTableSyntax(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return line;
      const cells = trimmed.slice(1, -1).split("|");
      if (cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))) return "";
      return cells.join(" ");
    })
    .join("\n");
}

/**
 * Locate normalized query terms in the original string while retaining source
 * offsets. A grapheme-aware map keeps highlights correct when NFKC changes width,
 * case, or combines multiple source code points into one displayed character.
 */
export function findSearchMatchRanges(text: string, rawQuery: string): SearchMatchRange[] {
  const terms = normalizeSearchText(rawQuery).split(" ").filter(Boolean);
  if (terms.length === 0 || !text) return [];

  const { value: normalized, sourceStarts, sourceEnds } = normalizeSearchTextWithSourceMap(text);

  const ranges: SearchMatchRange[] = [];
  for (const term of terms) {
    let from = 0;
    while (from < normalized.length) {
      const match = normalized.indexOf(term, from);
      if (match < 0) break;
      const start = sourceStarts[match];
      const end = sourceEnds[match + term.length - 1];
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      from = match + Math.max(1, term.length);
    }
  }

  return ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<SearchMatchRange[]>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

/**
 * Markdown -> readable search text. Link labels and code remain searchable, while
 * formatting punctuation, destinations, and fence markers are discarded.
 */
export function markdownToSearchText(markdown: string): string {
  const codeSegments: string[] = [];
  const protectCode = (code: string): string => {
    const index = codeSegments.push(code.replace(/\s+/g, " ").trim()) - 1;
    return `\uE000${index}\uE001`;
  };

  const lines = markdown.split("\n");
  const protectedLines: string[] = [];
  let fence = "";
  let fencedCode: string[] = [];
  let quotedFence = false;

  // A callout body is a blockquote, so its fences arrive as "> ```bash" and never match a
  // fence opener that anchors at the line start. The prefix therefore comes off before the
  // match, and off the body lines of a fence that opened quoted — otherwise the grammar name
  // and the "> " markers reach the index as prose. A fence that opened unquoted keeps its
  // lines verbatim, so a Markdown example quoting a blockquote is not rewritten.
  const unquote = (line: string): string => line.replace(/^\s{0,3}(?:>[ \t]?)+/, "");

  for (const raw of lines) {
    const line: string = !fence || quotedFence ? unquote(raw) : raw;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
    if (!fence && marker) {
      fence = marker;
      quotedFence = line !== raw;
      fencedCode = [];
      continue;
    }
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        protectedLines.push(` ${protectCode(fencedCode.join("\n"))} `);
        fence = "";
        fencedCode = [];
      } else {
        fencedCode.push(line);
      }
      continue;
    }
    protectedLines.push(line);
  }
  if (fence) protectedLines.push(` ${protectCode(fencedCode.join("\n"))} `);

  const visibleText = protectedLines
    .join("\n")
    .replace(/(`+)([\s\S]*?)\1/g, (_match, _ticks: string, code: string) => protectCode(code))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    // Callout marker (remark-callout): the type and collapse flag are chrome, but the
    // title following them is prose and stays indexed. Runs after the blockquote marker
    // above has already been peeled off the line.
    .replace(/^\[!\w+\][-+]?[ \t]*/gm, "");

  return stripMarkdownTableSyntax(stripMarkdownFormatting(visibleText))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_match, rawIndex: string) => {
      return codeSegments[Number(rawIndex)] ?? "";
    });
}

function splitSections(body: string): SearchSection[] {
  const sections: SearchSection[] = [{ heading: "", anchor: "", lines: [] }];
  let current = sections[0]!;
  let fenceMarker = "";

  for (const line of body.split("\n")) {
    const fence = /^\s*(```|~~~)/.exec(line)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence;
      else if (fence === fenceMarker) fenceMarker = "";
      current.lines.push(line);
      continue;
    }

    if (!fenceMarker) {
      const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
      if (heading) {
        const text = markdownToSearchText(heading[2]!);
        current = {
          heading: text,
          anchor: slugifyHeading(text),
          lines: [],
        };
        sections.push(current);
        continue;
      }
    }

    current.lines.push(line);
  }

  return sections;
}

export function buildSearchRecords(docs: readonly DocPage[]): SearchRecord[] {
  return docs.flatMap((doc) =>
    splitSections(doc.body)
      .map((section) => {
        const body = markdownToSearchText(section.lines.join("\n"));
        return {
          slug: doc.slug,
          anchor: section.anchor,
          pageTitle: doc.title,
          heading: section.heading,
          text: section.anchor === "" ? [doc.description, body].filter(Boolean).join(" ") : body,
        };
      })
      .map((section) => ({
        ...section,
        normalizedTitle: normalizeSearchText(section.pageTitle),
        normalizedHeading: normalizeSearchText(section.heading),
        normalizedText: normalizeSearchText(section.text),
      })),
  );
}

function firstMatchIndex(text: string, query: string, terms: readonly string[]): number {
  const phrase = text.indexOf(query);
  if (phrase >= 0) return phrase;
  let first = -1;
  for (const term of terms) {
    const index = text.indexOf(term);
    if (index >= 0 && (first < 0 || index < first)) first = index;
  }
  return first;
}

function graphemeBoundaryAtOrBefore(text: string, offset: number): number {
  let boundary = 0;
  for (const { index } of SEARCH_GRAPHEME_SEGMENTER.segment(text)) {
    if (index > offset) break;
    boundary = index;
  }
  return boundary;
}

function graphemeBoundaryAtSnippetEnd(text: string, start: number, maxLength: number): number {
  const limit = start + maxLength;
  let end = start;
  for (const { segment, index } of SEARCH_GRAPHEME_SEGMENTER.segment(text)) {
    if (index < start) continue;
    const next = index + segment.length;
    if (next > limit) return end === start ? next : end;
    end = next;
  }
  return text.length;
}

export function createSearchSnippet(text: string, query: string, maxLength = 150): string {
  if (text.length <= maxLength) return text;
  const { value: normalized, sourceStarts } = normalizeSearchTextWithSourceMap(text);
  const normalizedQuery = normalizeSearchText(query);
  const terms = normalizedQuery.split(" ").filter(Boolean);
  const match = firstMatchIndex(normalized, normalizedQuery, terms);
  const matchSourceStart = match < 0 ? 0 : (sourceStarts[match] ?? 0);
  const preferredStart = Math.max(0, matchSourceStart - Math.floor(maxLength / 3));
  const start = graphemeBoundaryAtOrBefore(text, preferredStart);
  const end = graphemeBoundaryAtSnippetEnd(text, start, maxLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function scoreRecord(record: SearchRecord, query: string, terms: readonly string[]): number | null {
  const combined = `${record.normalizedTitle} ${record.normalizedHeading} ${record.normalizedText}`;
  if (!terms.every((term) => combined.includes(term))) return null;

  const content = `${record.normalizedHeading} ${record.normalizedText}`;
  // A page-title-only query should yield the page result, not every section in it.
  if (record.heading && !terms.some((term) => content.includes(term))) return null;

  let score = 0;
  const isPageResult = record.heading === "";

  if (record.normalizedTitle === query) score += isPageResult ? 240 : 40;
  else if (record.normalizedTitle.startsWith(query)) score += isPageResult ? 150 : 25;
  else if (record.normalizedTitle.includes(query)) score += isPageResult ? 110 : 15;

  if (record.normalizedHeading === query) score += 200;
  else if (record.normalizedHeading.startsWith(query)) score += 130;
  else if (record.normalizedHeading.includes(query)) score += 90;

  if (record.normalizedText.includes(query)) score += 45;

  for (const term of terms) {
    if (record.normalizedTitle.includes(term)) score += isPageResult ? 24 : 6;
    if (record.normalizedHeading.includes(term)) score += 30;
    if (record.normalizedText.includes(term)) score += 8;
  }

  const firstContentMatch = firstMatchIndex(content, query, terms);
  if (firstContentMatch >= 0) score += Math.max(0, 12 - firstContentMatch / 100);
  return score;
}

export function searchRecords(
  records: readonly SearchRecord[],
  rawQuery: string,
  limit = 10,
): SearchResult[] {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];
  const terms = query.split(" ").filter(Boolean);

  return records
    .map((record, order) => {
      const score = scoreRecord(record, query, terms);
      if (score === null) return null;
      return {
        record,
        score,
        snippet: createSearchSnippet(record.text, query),
        order,
      };
    })
    .filter(
      (
        result,
      ): result is SearchResult & {
        order: number;
      } => result !== null,
    )
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...result }) => result);
}
