/**
 * Docs index: local Markdown pages imported at build time via import.meta.glob.
 * File naming: content/<slug>.<lang>.md — one file per page per language; a page
 * missing the active language falls back to the other one, so navigation is always
 * complete in both locales. Same architecture as the landing page blog.
 */
import { parseFrontmatter } from "./frontmatter";
import type { Locale } from "../state/locale";

export interface DocPage {
  slug: string;
  lang: Locale;
  title: string;
  /** One-line summary rendered under the title (optional). */
  description: string;
  body: string;
}

const files = import.meta.glob("../../content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function toDoc(path: string, raw: string): DocPage | null {
  const file = path.split("/").pop() ?? "";
  const match = /^(.+)\.(zh|en)\.md$/.exec(file);
  if (!match) return null;
  const { meta, body } = parseFrontmatter(raw);
  return {
    slug: match[1]!,
    lang: match[2] as Locale,
    title: meta.title ?? match[1]!,
    description: meta.description ?? "",
    body,
  };
}

const ALL: DocPage[] = Object.entries(files)
  .map(([path, raw]) => toDoc(path, raw))
  .filter((doc): doc is DocPage => doc !== null);

/** The locale's version of a page (fallback to the other language). */
export function getDoc(slug: string, locale: Locale): DocPage | undefined {
  const candidates = ALL.filter((doc) => doc.slug === slug);
  return candidates.find((doc) => doc.lang === locale) ?? candidates[0];
}

/** Localized page title for sidebar / pagination labels. */
export function docTitle(slug: string, locale: Locale): string {
  return getDoc(slug, locale)?.title ?? slug;
}

/**
 * The page as plain Markdown (title heading + body) — what the per-page
 * "Copy Markdown" button puts on the clipboard.
 */
export function docMarkdown(doc: DocPage): string {
  return `# ${doc.title}\n\n${doc.body}\n`;
}
