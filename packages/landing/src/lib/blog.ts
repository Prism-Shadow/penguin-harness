/**
 * Blog index: local Markdown posts read at build time via import.meta.glob.
 * File naming: content/blog/<slug>.<lang>.md — one file per post per language;
 * a post missing the active language falls back to the other one, so the list
 * is always complete in both locales.
 *
 * The index (every post's frontmatter) is part of the main bundle, so the list and the home
 * page's latest updates render at once. A post's body is a chunk of its own, fetched when the
 * post is opened (`loadPostBody`): the home page carries no post text.
 */
import { parseFrontmatter } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";

export type BlogCategory = "news" | "practice" | "perspectives" | "changelog";

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
}

/** Split `author` frontmatter on comma-class separators (`,` `，` `、`); default when empty. */
export function parseAuthors(raw: string | undefined): string[] {
  const authors = (raw ?? "")
    .split(/[,，、]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return authors.length > 0 ? authors : [DEFAULT_AUTHOR];
}

/** Join authors for display: an ideographic comma in Chinese, an ASCII comma otherwise. */
export function formatAuthors(authors: string[], locale: Locale): string {
  return authors.join(locale === "zh" ? "、" : ", ");
}

/** Each post file's frontmatter record, parsed at build time (scripts/frontmatter-plugin.ts). */
const frontmatter = import.meta.glob<Record<string, string>>("../../content/blog/*.md", {
  query: "?frontmatter",
  import: "default",
  eager: true,
});

/** Each post file's full text, as a chunk of its own; keyed like `frontmatter`. */
const sources = import.meta.glob<string>("../../content/blog/*.md", {
  query: "?raw",
  import: "default",
});

function toPost(path: string, meta: Record<string, string>): BlogPost | null {
  const file = path.split("/").pop() ?? "";
  const match = /^(.+)\.(zh|en)\.md$/.exec(file);
  if (!match) return null;
  const category: BlogCategory =
    meta.category === "changelog" ||
    meta.category === "practice" ||
    meta.category === "perspectives"
      ? meta.category
      : "news";
  return {
    slug: match[1]!,
    lang: match[2] as Locale,
    title: meta.title ?? match[1]!,
    date: meta.date ?? "",
    category,
    excerpt: meta.excerpt ?? "",
    authors: parseAuthors(meta.author),
    pinned: meta.pinned === "true",
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
 * Format a YYYY-MM-DD post date for display (e.g. "July 20, 2026" in English, the
 * year-month-day form in Chinese).
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

const ALL: BlogPost[] = Object.entries(frontmatter)
  .map(([path, meta]) => toPost(path, meta))
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

/** The categories the home page's latest updates draw from: what changed, and how to use it. */
export const UPDATE_CATEGORIES: readonly BlogCategory[] = ["news", "practice"];

/**
 * The home page's latest updates: the `count` newest posts of the update categories, by date
 * alone — a pinned post is pinned on the blog, not news here.
 */
export function latestPosts(locale: Locale, count: number): BlogPost[] {
  return postsFor(locale)
    .filter((post) => UPDATE_CATEGORIES.includes(post.category))
    .sort((a, b) => comparePosts({ ...a, pinned: false }, { ...b, pinned: false }))
    .slice(0, count);
}

export function getPost(slug: string, locale: Locale): BlogPost | undefined {
  const candidates = ALL.filter((p) => p.slug === slug);
  return candidates.find((p) => p.lang === locale) ?? candidates[0];
}

/** The glob key of a post's file. */
const sourceOf = (post: Pick<BlogPost, "slug" | "lang">) =>
  `../../content/blog/${post.slug}.${post.lang}.md`;

/** Bodies fetched so far, by file. A body never changes once loaded. */
const bodies = new Map<string, string>();

/** A post's Markdown body (the file without its frontmatter), fetched once and then kept. */
export async function loadPostBody(post: Pick<BlogPost, "slug" | "lang">): Promise<string> {
  const file = sourceOf(post);
  const known = bodies.get(file);
  if (known !== undefined) return known;
  const load = sources[file];
  if (!load) throw new Error(`No blog post file for ${post.slug} (${post.lang})`);
  const body = parseFrontmatter(await load()).body;
  bodies.set(file, body);
  return body;
}

/**
 * The body when `loadPostBody` has already fetched it, so a page can render the whole post in
 * its first frame; undefined otherwise.
 */
export function loadedPostBody(post: Pick<BlogPost, "slug" | "lang">): string | undefined {
  return bodies.get(sourceOf(post));
}
