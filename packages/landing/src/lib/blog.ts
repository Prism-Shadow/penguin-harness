/**
 * Blog index: local Markdown posts imported at build time via import.meta.glob.
 * File naming: content/blog/<slug>.<lang>.md — one file per post per language;
 * a post missing the active language falls back to the other one, so the list
 * is always complete in both locales.
 */
import { parseFrontmatter } from "./frontmatter";
import type { Locale } from "../state/locale";

export type BlogCategory = "news" | "practice" | "changelog";

/** Byline used when a post has no `author` frontmatter. */
export const DEFAULT_AUTHOR = "Yaowei Zheng (PrismShadow AI)";

export interface BlogPost {
  slug: string;
  lang: Locale;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  category: BlogCategory;
  excerpt: string;
  /** Author list from comma-separated `author` frontmatter (default byline when absent). */
  authors: string[];
  /** `pinned: true` in frontmatter: sorts before everything else, badge on the card. */
  pinned: boolean;
  body: string;
}

/** Split `author` frontmatter on comma-class separators (`,` `，` `、`); default when empty. */
export function parseAuthors(raw: string | undefined): string[] {
  const authors = (raw ?? "")
    .split(/[,，、]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return authors.length > 0 ? authors : [DEFAULT_AUTHOR];
}

/** Join authors for display: 顿号 in Chinese, comma otherwise. */
export function formatAuthors(authors: string[], locale: Locale): string {
  return authors.join(locale === "zh" ? "、" : ", ");
}

const files = import.meta.glob("../../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function toPost(path: string, raw: string): BlogPost | null {
  const file = path.split("/").pop() ?? "";
  const match = /^(.+)\.(zh|en)\.md$/.exec(file);
  if (!match) return null;
  const { meta, body } = parseFrontmatter(raw);
  const category: BlogCategory =
    meta.category === "changelog" || meta.category === "practice" ? meta.category : "news";
  return {
    slug: match[1]!,
    lang: match[2] as Locale,
    title: meta.title ?? match[1]!,
    date: meta.date ?? "",
    category,
    excerpt: meta.excerpt ?? "",
    authors: parseAuthors(meta.author),
    pinned: meta.pinned === "true",
    body,
  };
}

/** Sort order for post lists: pinned first, then newest date, then slug as tie-break. */
export function comparePosts(
  a: Pick<BlogPost, "pinned" | "date" | "slug">,
  b: Pick<BlogPost, "pinned" | "date" | "slug">,
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.slug.localeCompare(b.slug);
}

/**
 * Format a YYYY-MM-DD post date for display ("July 20, 2026" / "2026年7月20日").
 * Parsed as UTC and formatted in UTC so the calendar day never shifts with the
 * viewer's timezone; unexpected input falls back to the raw string.
 */
export function formatPostDate(date: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC silently normalizes impossible dates (2026-02-31 -> March 3): fall back
  // to the raw string when the components do not survive the round-trip.
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    return date;
  }
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(utc);
}

const ALL: BlogPost[] = Object.entries(files)
  .map(([path, raw]) => toPost(path, raw))
  .filter((p): p is BlogPost => p !== null);

/** Pick the locale's version of each slug (fallback to the other language), pinned/newest first. */
export function postsFor(locale: Locale, category?: BlogCategory): BlogPost[] {
  const bySlug = new Map<string, BlogPost>();
  for (const post of ALL) {
    const existing = bySlug.get(post.slug);
    if (!existing || (existing.lang !== locale && post.lang === locale)) {
      bySlug.set(post.slug, post);
    }
  }
  return [...bySlug.values()]
    .filter((p) => (category ? p.category === category : true))
    .sort(comparePosts);
}

export function getPost(slug: string, locale: Locale): BlogPost | undefined {
  const candidates = ALL.filter((p) => p.slug === slug);
  return candidates.find((p) => p.lang === locale) ?? candidates[0];
}
