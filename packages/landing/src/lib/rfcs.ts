/**
 * The RFC index: the repository's rfcs/ surface, read at build time, one entry per PRFC document
 * pair. Each document's status comes from the marker under its title — the Source block a landed
 * document carries, or the design PR a draft names. The site renders each document as its own
 * page; the index links there and keeps no second copy of the documents' content.
 */
import { REPO_URL } from "./links";

/** Where an RFC stands: landed in the repository, carried by an open design PR, or still a draft. */
export type RfcStatus = "landed" | "open" | "drafting";

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
  /** The English and Chinese in-site pages; absent while drafting (the row names it without a link). */
  en?: RfcDocument;
  zh?: RfcDocument;
  /** An open design PR carrying a revision newer than this landed version, if its marker names one. */
  openRevision?: ExternalDocument;
}

interface ParsedDocument {
  file: string;
  id: string;
  zh: boolean;
  title: string;
  status: RfcStatus;
  prHref?: string;
  openRevisionHref?: string;
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
    id: file.replace(/\.zh\.md$|\.md$/, ""),
    zh: file.endsWith(".zh.md"),
    title,
    status: landed ? "landed" : prHref ? "open" : "drafting",
    prHref,
    openRevisionHref,
  };
}

/** A document's copy in the repository, linked from its in-site page. */
export function repositoryHref(file: string): string {
  return `${REPO_URL}/blob/main/rfcs/${file}`;
}

/**
 * Build the index from the rfcs/ directory's raw documents: pairs merged, sorted by number. Each
 * version's href names the in-site page that renders it — `/rfcs/<id>` for the English document,
 * `/rfcs/<id>.zh` for the Chinese one. A drafting document shows without a link; an open one
 * links to the design PR carrying it instead.
 */
export function buildRfcIndex(documents: Record<string, string>): RfcEntry[] {
  const pairs = new Map<string, { en?: ParsedDocument; zh?: ParsedDocument }>();
  for (const [path, raw] of Object.entries(documents)) {
    const file = path.slice(path.lastIndexOf("/") + 1);
    const parsed = parseRfcDocument(file, raw);
    if (!parsed) continue;
    const pair = pairs.get(parsed.id) ?? {};
    pair[parsed.zh ? "zh" : "en"] = parsed;
    pairs.set(parsed.id, pair);
  }
  const entries: RfcEntry[] = [];
  for (const [id, { en, zh }] of pairs) {
    const status = en?.status ?? zh?.status ?? "drafting";
    const linked = (doc?: ParsedDocument): RfcDocument | undefined => {
      if (!doc || status === "drafting") return undefined;
      if (status === "open") {
        return doc.prHref
          ? { href: doc.prHref, file: doc.file, raw: doc.raw }
          : undefined;
      }
      return { href: inSiteHref(doc.id, doc.zh), file: doc.file, raw: doc.raw };
    };
    const openRevisionHref = en?.openRevisionHref ?? zh?.openRevisionHref;
    entries.push({
      id,
      number: id.match(/^PRFC-\d+/)?.[0] ?? id,
      title: en?.title ?? zh!.title,
      titleZh: zh?.title,
      status,
      en: linked(en),
      zh: linked(zh),
      openRevision: openRevisionHref ? { href: openRevisionHref } : undefined,
    });
  }
  return entries.sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
}

function inSiteHref(id: string, zh: boolean): string {
  return zh ? `/rfcs/${id}.zh` : `/rfcs/${id}`;
}

/** The rfcs/ directory's raw documents, read at build time. */
const documents = import.meta.glob("../../../../rfcs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The index the RFC pages render: every document pair, sorted by number. */
export const rfcEntries = buildRfcIndex(documents);

/** Look up one language version's raw document by its in-site id (with or without the .zh suffix). */
export function rfcDocumentOf(
  id: string,
): { doc: ParsedDocument; raw: string } | null {
  const zh = id.endsWith(".zh");
  const file = `${zh ? id.slice(0, -3) : id}${zh ? ".zh.md" : ".md"}`;
  const raw = Object.entries(documents).find(
    ([path]) => path.slice(path.lastIndexOf("/") + 1) === file,
  )?.[1];
  if (raw === undefined) return null;
  const doc = parseRfcDocument(file, raw);
  return doc ? { doc, raw } : null;
}
