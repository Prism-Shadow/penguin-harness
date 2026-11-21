/**
 * The RFC index: the repository's rfcs/ surface and its `request-for-comments` GitHub PR statuses,
 * read at build time, one entry per PRFC document pair. Merged documents render as in-site pages;
 * open, draft, and closed RFCs link to the GitHub PRs carrying them.
 */
import { prs as rawPrRecords } from "virtual:penguin-rfc-prs";
import { slugifyHeading } from "@prismshadow/penguin-ui/site";
import type { SiteSearchRange } from "@prismshadow/penguin-ui/site";
import { REPO_URL } from "./links";

/** GitHub pull-request status of an RFC (`request-for-comments`). */
export type RfcStatus = "merged" | "open" | "draft" | "closed";

export interface RfcPrDocRef {
  id: string;
  number: string;
  title: string;
  titleZh?: string;
}

export interface RfcPrRecord {
  number: number;
  title: string;
  url: string;
  status: RfcStatus;
  baseRefName: string;
  headRefOid: string;
  rfcs: RfcPrDocRef[];
}

/** One language version of a document: the in-site page that renders it, and the raw document. */
export interface RfcDocument {
  /** The in-site route of this version, e.g. `/rfcs/PRFC-0001-module` for the English page. */
  href: string;
  /** The document's file name in the repository's RFC directory. */
  file: string;
  /** The raw Markdown, title and provenance marker included. */
  raw: string;
}

/** A landing page linking outside the site: an open design PR carrying a revision or a draft. */
export interface ExternalDocument {
  href: string;
}

export interface RfcEntry {
  /** The document pair's name, e.g. `PRFC-0001-module`. */
  id: string;
  /** The PRFC number, e.g. `PRFC-0001`. */
  number: string;
  title: string;
  titleZh?: string;
  status: RfcStatus;
  /** The GitHub PR number carrying this RFC, when known from PR status records. */
  prNumber?: number;
  /** The GitHub PR title carrying this RFC, when known from PR status records. */
  prTitle?: string;
  /** The GitHub PR carrying this RFC, when known from PR status records or provenance markers. */
  prHref?: string;
  /** The English and Chinese in-site pages; absent while unmerged in `rfcs/`. */
  en?: RfcDocument;
  zh?: RfcDocument;
  /** An open PR carrying a revision newer than this merged version, if any. */
  openRevision?: ExternalDocument;
}

export interface ParsedDocument {
  file: string;
  raw: string;
  id: string;
  zh: boolean;
  title: string;
  status: RfcStatus;
  prHref?: string;
  openRevisionHref?: string;
}

export interface RfcPagerItem {
  id: string;
  href: string;
  title: string;
}

export interface RfcSearchRecord {
  href: string;
  anchor: string;
  pageTitle: string;
  heading: string;
  text: string;
  normalizedTitle: string;
  normalizedHeading: string;
  normalizedText: string;
}

export interface RfcSearchHit {
  record: RfcSearchRecord;
  score: number;
  snippet: string;
}

/** A document is landed when its marker names where it landed, or says it is native to this repository. */
const LANDED = /\blanded\b|lands on the default branch|native to this repository|落地/;

/** The header a document's marker lives in: everything before its first `## ` section. */
function headerOf(raw: string): string {
  const body = raw.indexOf("\n## ");
  return body === -1 ? raw : raw.slice(0, body);
}

function pullHref(line: string): string | undefined {
  return line.match(/\((https:\/\/github\.com\/[^)\s]+\/pull\/\d+)\)/)?.[1];
}

/** Read one document file (PRFC-NNNN-slug.md or its .zh.md pair) into its index facts. */
export function parseRfcDocument(file: string, raw: string): ParsedDocument | null {
  if (!/^PRFC-\d+-.+\.md$/.test(file)) return null;
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) return null;
  const header = headerOf(raw);
  const lines = header.split("\n").filter((line) => line.trim().length > 0);
  const landed = lines.some((line) => LANDED.test(line));
  const prHref = lines.map(pullHref).find(Boolean);
  const openRevisionHref = lines
    .filter((line) => /Unmerged revision|未合并修订/.test(line))
    .map(pullHref)
    .find(Boolean);
  return {
    file,
    raw,
    id: file.replace(/\.zh\.md$|\.md$/, ""),
    zh: file.endsWith(".zh.md"),
    title,
    status: landed ? "merged" : prHref ? "open" : "draft",
    prHref,
    openRevisionHref,
  };
}

/** A document's copy in the repository, linked from its in-site page. */
export function repositoryHref(file: string): string {
  return `${REPO_URL}/blob/main/rfcs/${file}`;
}

/**
 * Build the index from the rfcs/ directory's raw documents and the `request-for-comments` GitHub PR
 * records: pairs merged, sorted by number. Each merged version's href names the in-site page that
 * renders it (`/rfcs/<id>` or `/rfcs/<id>.zh`); unmerged RFCs from PR records carry the PR's
 * GitHub status (`open`, `draft`, or `closed`) and link to that PR.
 */
export function buildRfcIndex(
  documents: Record<string, string>,
  prRecords: readonly RfcPrRecord[] = [],
): RfcEntry[] {
  const pairs = new Map<string, { en?: ParsedDocument; zh?: ParsedDocument }>();
  for (const [path, raw] of Object.entries(documents)) {
    const file = path.slice(path.lastIndexOf("/") + 1);
    const parsed = parseRfcDocument(file, raw);
    if (!parsed) continue;
    const pair = pairs.get(parsed.id) ?? {};
    pair[parsed.zh ? "zh" : "en"] = parsed;
    pairs.set(parsed.id, pair);
  }

  const mainPrs = prRecords
    .filter((pr) => !pr.baseRefName || pr.baseRefName === "main")
    .slice()
    .sort((a, b) => a.number - b.number);

  const prByRfcId = new Map<
    string,
    { pr: RfcPrRecord; ref: RfcPrDocRef; openRevisionHref?: string }
  >();
  for (const pr of mainPrs) {
    if (pr.status === "closed") continue;
    for (const ref of pr.rfcs ?? []) {
      const existing = prByRfcId.get(ref.id);
      if (!existing) {
        prByRfcId.set(ref.id, {
          pr,
          ref,
          openRevisionHref: pr.status === "open" ? pr.url : undefined,
        });
      } else if (existing.pr.status === "merged") {
        if (pr.status === "merged") {
          existing.pr = pr;
          existing.ref = ref;
        } else if (pr.status === "open") {
          existing.openRevisionHref = pr.url;
        }
      } else {
        existing.pr = pr;
        existing.ref = ref;
        if (pr.status === "open") existing.openRevisionHref = pr.url;
      }
    }
  }

  const entriesById = new Map<string, RfcEntry>();
  for (const [id, { en, zh }] of pairs) {
    const prInfo = prByRfcId.get(id);
    const docStatus = en?.status ?? zh?.status ?? "draft";
    const status: RfcStatus =
      docStatus === "merged" ? "merged" : (prInfo?.pr.status ?? docStatus);
    const linked = (doc?: ParsedDocument): RfcDocument | undefined => {
      if (!doc || status === "draft" || status === "closed") return undefined;
      if (status === "open") {
        const href = prInfo?.pr.url ?? doc.prHref;
        return href ? { href, file: doc.file, raw: doc.raw } : undefined;
      }
      return { href: inSiteHref(doc.id, doc.zh), file: doc.file, raw: doc.raw };
    };
    const openRevisionHref =
      (status === "merged" ? prInfo?.openRevisionHref : undefined) ??
      en?.openRevisionHref ??
      zh?.openRevisionHref;
    const prHref = prInfo?.pr.url ?? en?.prHref ?? zh?.prHref;
    entriesById.set(id, {
      id,
      number: id.match(/^PRFC-\d+/)?.[0] ?? id,
      title: en?.title ?? zh!.title,
      titleZh: zh?.title,
      status,
      ...(prInfo?.pr.number ? { prNumber: prInfo.pr.number } : {}),
      ...(prInfo?.pr.title ? { prTitle: prInfo.pr.title } : {}),
      ...(prHref ? { prHref } : {}),
      en: linked(en),
      zh: linked(zh),
      openRevision: openRevisionHref ? { href: openRevisionHref } : undefined,
    });
  }

  for (const [id, { pr, ref }] of prByRfcId) {
    if (entriesById.has(id) || pr.status === "closed") continue;
    entriesById.set(id, {
      id,
      number: ref.number || (id.match(/^PRFC-\d+/)?.[0] ?? id),
      title: ref.title,
      ...(ref.titleZh ? { titleZh: ref.titleZh } : {}),
      status: pr.status,
      prNumber: pr.number,
      prTitle: pr.title,
      prHref: pr.url,
    });
  }

  return [...entriesById.values()].sort(
    (a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id),
  );
}

function inSiteHref(id: string, zh: boolean): string {
  return zh ? `/rfcs/${id}.zh` : `/rfcs/${id}`;
}

/** The 4-digit number shown in the sidebar rail (e.g. `0001` from `PRFC-0001`). */
export function shortRfcNumber(number: string): string {
  return number.replace(/^PRFC-/, "");
}

/** An RFC's title without its leading `PRFC-NNNN` prefix or `: subtitle` (for sidebar and table rows). */
export function shortRfcTitle(title: string): string {
  const withoutNumber = title.replace(/^PRFC-\d+\s*[:：—–-]?\s*/, "").trim();
  const withoutSubtitle = withoutNumber.replace(/\s*[:：]\s*.+$/, "").trim();
  return withoutSubtitle || withoutNumber || title;
}

/** The full H1 title of an RFC entry in the active locale. */
export function rfcEntryTitle(entry: RfcEntry, locale: string): string {
  return locale === "zh" ? (entry.titleZh ?? entry.title) : entry.title;
}

/** The short title of an RFC entry in the active locale (without the `PRFC-NNNN ` prefix). */
export function rfcEntryShortTitle(entry: RfcEntry, locale: string): string {
  return shortRfcTitle(rfcEntryTitle(entry, locale));
}

/** The document version for the active locale, falling back when only one language exists. */
export function rfcDocForLocale(entry: RfcEntry, locale: string): RfcDocument | undefined {
  return locale === "zh" ? (entry.zh ?? entry.en) : (entry.en ?? entry.zh);
}

/**
 * Strip the leading `# H1` title and the `[中文版]` / `[English]` language-switch link from a
 * raw RFC Markdown file: the page header renders the H1, and the site bar switches languages.
 */
export function rfcBodyMarkdown(raw: string): string {
  return raw
    .replace(/^#\s+.+\n+/, "")
    .replace(/^\[(?:中文版|English)\]\([^)\n]+\.md\)\n+/m, "")
    .trimStart();
}

/** The rfcs/ directory's raw documents, read at build time. */
const documents = import.meta.glob("../../../../rfcs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The `request-for-comments` PR records, read at build time via `virtual:penguin-rfc-prs`. */
export const rfcPrRecords = (rawPrRecords as RfcPrRecord[] | undefined) ?? [];

/** Look up a `request-for-comments` PR record by its GitHub URL. */
export function rfcPrOfUrl(url: string): RfcPrRecord | undefined {
  return rfcPrRecords.find((pr) => pr.url === url);
}

/** The index the RFC pages render: every document pair and RFC PR, sorted by number. */
export const rfcEntries = buildRfcIndex(documents, rfcPrRecords);

/** Find an RFC entry by its route id (with or without the `.zh` suffix). */
export function rfcEntryOf(id: string): RfcEntry | undefined {
  const baseId = id.replace(/\.zh$/, "");
  return rfcEntries.find((entry) => entry.id === baseId);
}

/** Look up one language version's raw document by its in-site id (with or without the .zh suffix). */
export function rfcDocumentOf(id: string): { doc: ParsedDocument; raw: string } | null {
  const zh = id.endsWith(".zh");
  const file = `${zh ? id.slice(0, -3) : id}${zh ? ".zh.md" : ".md"}`;
  const raw = Object.entries(documents).find(
    ([path]) => path.slice(path.lastIndexOf("/") + 1) === file,
  )?.[1];
  if (raw === undefined) return null;
  const doc = parseRfcDocument(file, raw);
  return doc ? { doc, raw } : null;
}

/** Read `rfcs/README.md` or `rfcs/README.zh.md` into its intro paragraph and its `## ` sections. */
export function rfcReadmeParts(locale: string): { intro: string; tail: string } {
  const file = locale === "zh" ? "README.zh.md" : "README.md";
  const raw =
    Object.entries(documents).find(
      ([path]) => path.slice(path.lastIndexOf("/") + 1) === file,
    )?.[1] ?? "";
  const body = rfcBodyMarkdown(raw);
  const firstSection = body.indexOf("\n## ");
  if (firstSection === -1) return { intro: body.trim(), tail: "" };
  return {
    intro: body.slice(0, firstSection).trim(),
    tail: body.slice(firstSection + 1).trim(),
  };
}

/** Previous / next pagination across the RFC index and every merged RFC in sidebar order. */
export function rfcPagerFor(
  activeId: string,
  locale: string,
  indexLabel: string,
): { prev?: RfcPagerItem; next?: RfcPagerItem } {
  const baseId = activeId.replace(/\.zh$/, "");
  const pages: RfcPagerItem[] = [
    { id: "index", href: "/rfcs", title: indexLabel },
    ...rfcEntries
      .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
      .map((entry) => ({
        id: entry.id,
        href: `/rfcs/${entry.id}`,
        title: rfcEntryTitle(entry, locale),
      })),
  ];
  const idx = pages.findIndex((page) => page.id === baseId);
  if (idx === -1) return {};
  return { prev: pages[idx - 1], next: pages[idx + 1] };
}

// ---------- Section-level search over the RFC index and every landed RFC ----------

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeWithSourceMap(text: string): {
  value: string;
  starts: number[];
  ends: number[];
} {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: SiteSearchRange | null = null;
  const append = (ch: string, s: number, e: number) => {
    value += ch;
    for (let i = 0; i < ch.length; i += 1) {
      starts.push(s);
      ends.push(e);
    }
  };
  for (const { segment, index: s } of GRAPHEME_SEGMENTER.segment(text)) {
    const e = s + segment.length;
    for (const ch of segment.normalize("NFKC").toLowerCase()) {
      if (/\s/u.test(ch)) {
        if (value) {
          pendingSpace ??= { start: s, end: e };
          pendingSpace.end = e;
        }
        continue;
      }
      if (pendingSpace) {
        append(" ", pendingSpace.start, pendingSpace.end);
        pendingSpace = null;
      }
      append(ch, s, e);
    }
  }
  return { value, starts, ends };
}

export function findRfcSearchMatchRanges(text: string, rawQuery: string): SiteSearchRange[] {
  const terms = normalizeSearch(rawQuery).split(" ").filter(Boolean);
  if (terms.length === 0 || !text) return [];
  const { value, starts, ends } = normalizeWithSourceMap(text);
  const ranges: SiteSearchRange[] = [];
  for (const term of terms) {
    let from = 0;
    while (from < value.length) {
      const at = value.indexOf(term, from);
      if (at < 0) break;
      const start = starts[at];
      const end = ends[at + term.length - 1];
      if (start !== undefined && end !== undefined) ranges.push({ start, end });
      from = at + Math.max(1, term.length);
    }
  }
  return ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<SiteSearchRange[]>((merged, range) => {
      const prev = merged[merged.length - 1];
      if (prev && range.start <= prev.end) prev.end = Math.max(prev.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
}

function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|~~|__|\*|_)/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMarkdownSections(body: string): { heading: string; anchor: string; text: string }[] {
  const sections: { heading: string; anchor: string; lines: string[] }[] = [
    { heading: "", anchor: "", lines: [] },
  ];
  let current = sections[0]!;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
      if (match) {
        const heading = markdownToPlain(match[2]!);
        current = { heading, anchor: slugifyHeading(heading), lines: [] };
        sections.push(current);
        continue;
      }
    }
    if (!/^\[[^\]]+\]:\s*#/.test(line)) current.lines.push(line);
  }
  const introProse = sections[0]!.lines.filter(
    (line) => !/^\s*>/.test(line) && !/^\s*-\s+[^:\n]+:/.test(line),
  );
  const resolved = sections.map((s, idx) => ({
    heading: s.heading,
    anchor: s.anchor,
    text: markdownToPlain((idx === 0 ? introProse : s.lines).join("\n")),
  }));
  if (resolved[0] && !resolved[0].text && resolved[1]?.text) {
    resolved[0].text = resolved[1].text;
  }
  return resolved;
}

function createRfcSearchSnippet(text: string, query: string, maxLength = 140): string {
  if (text.length <= maxLength) return text;
  const { value: normalized, starts } = normalizeWithSourceMap(text);
  const terms = query.split(" ").filter(Boolean);
  let match = normalized.indexOf(query);
  if (match < 0) {
    for (const term of terms) {
      const idx = normalized.indexOf(term);
      if (idx >= 0 && (match < 0 || idx < match)) match = idx;
    }
  }
  const matchStart = match < 0 ? 0 : (starts[match] ?? 0);
  const start = Math.max(0, matchStart - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function buildRfcSearchRecords(
  locale: string,
  indexPage: { title: string; body: string },
): RfcSearchRecord[] {
  const pages = [
    { href: "/rfcs", title: indexPage.title, body: indexPage.body },
    ...rfcEntries
      .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
      .map((entry) => ({
        href: `/rfcs/${entry.id}`,
        title: rfcEntryTitle(entry, locale),
        body: rfcBodyMarkdown(rfcDocForLocale(entry, locale)!.raw),
      })),
  ];
  return pages.flatMap((page) =>
    splitMarkdownSections(page.body).map((sec) => ({
      href: page.href,
      anchor: sec.anchor,
      pageTitle: page.title,
      heading: sec.heading,
      text: sec.text,
      normalizedTitle: normalizeSearch(page.title),
      normalizedHeading: normalizeSearch(sec.heading),
      normalizedText: normalizeSearch(sec.text),
    })),
  );
}

export function searchRfcRecords(
  records: readonly RfcSearchRecord[],
  rawQuery: string,
  limit = 10,
): RfcSearchHit[] {
  const query = normalizeSearch(rawQuery);
  if (!query) return [];
  const terms = query.split(" ").filter(Boolean);
  const hits: (RfcSearchHit & { order: number })[] = [];
  records.forEach((rec, order) => {
    const combined = `${rec.normalizedTitle} ${rec.normalizedHeading} ${rec.normalizedText}`;
    if (!terms.every((t) => combined.includes(t))) return;
    const content = `${rec.normalizedHeading} ${rec.normalizedText}`;
    if (rec.heading && !terms.some((t) => content.includes(t))) return;
    let score = 0;
    const isPage = rec.heading === "";
    if (rec.normalizedTitle.includes(query)) score += isPage ? 120 : 20;
    if (rec.normalizedHeading.includes(query)) score += 100;
    if (rec.normalizedText.includes(query)) score += 45;
    for (const t of terms) {
      if (rec.normalizedTitle.includes(t)) score += isPage ? 20 : 5;
      if (rec.normalizedHeading.includes(t)) score += 25;
      if (rec.normalizedText.includes(t)) score += 8;
    }
    const snippet = createRfcSearchSnippet(rec.text, query);
    hits.push({ record: rec, score, snippet, order });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...hit }) => hit);
}
