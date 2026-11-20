/**
 * The RFC index: the repository's rfcs/ surface, read at build time, one entry per PRFC document
 * pair. Each document's status comes from the marker under its title — the Source block a landed
 * document carries, or the design PR a draft names. The index keeps no copy of the documents'
 * bodies; the page links into the repository instead, so it follows the directory without a
 * second list to maintain.
 */
import { REPO_URL } from "./links";

/** Where an RFC stands: landed in the repository, carried by an open design PR, or still a draft. */
export type RfcStatus = "landed" | "open" | "drafting";

/** One language version of a document, as the reader reaches it. */
export interface RfcDocument {
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
  /** The English and Chinese documents; absent while drafting (the row names it without a link). */
  en?: RfcDocument;
  zh?: RfcDocument;
  /** An open design PR carrying a revision newer than this landed version, if its marker names one. */
  openRevision?: RfcDocument;
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

function repositoryHref(file: string): string {
  return `${REPO_URL}/blob/main/rfcs/${file}`;
}

/** Build the index from the rfcs/ directory's raw documents: pairs merged, sorted by number. */
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
    const hrefFor = (doc?: ParsedDocument): RfcDocument | undefined => {
      if (!doc) return undefined;
      // A landed document links into the repository's own copy; a draft links to the PR carrying it.
      if (status === "landed") return { href: repositoryHref(doc.file) };
      return doc.prHref ? { href: doc.prHref } : undefined;
    };
    const openRevisionHref = en?.openRevisionHref ?? zh?.openRevisionHref;
    entries.push({
      id,
      number: id.match(/^PRFC-\d+/)?.[0] ?? id,
      title: en?.title ?? zh!.title,
      titleZh: zh?.title,
      status,
      en: hrefFor(en ?? (status === "landed" ? undefined : zh)),
      zh: hrefFor(zh ?? (status === "landed" ? undefined : en)),
      openRevision: openRevisionHref ? { href: openRevisionHref } : undefined,
    });
  }
  return entries.sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
}
