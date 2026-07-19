/**
 * Blog index: local Markdown posts imported at build time via import.meta.glob.
 * File naming: content/blog/<slug>.<lang>.md — one file per post per language;
 * a post missing the active language falls back to the other one, so the list
 * is always complete in both locales.
 */
import { parseFrontmatter } from "./frontmatter";
import type { Locale } from "../state/locale";

export type BlogCategory = "news" | "changelog";

export interface BlogPost {
  slug: string;
  lang: Locale;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  category: BlogCategory;
  excerpt: string;
  body: string;
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
  const category: BlogCategory = meta.category === "changelog" ? "changelog" : "news";
  return {
    slug: match[1]!,
    lang: match[2] as Locale,
    title: meta.title ?? match[1]!,
    date: meta.date ?? "",
    category,
    excerpt: meta.excerpt ?? "",
    body,
  };
}

const ALL: BlogPost[] = Object.entries(files)
  .map(([path, raw]) => toPost(path, raw))
  .filter((p): p is BlogPost => p !== null);

/** Pick the locale's version of each slug (fallback to the other language), newest first. */
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
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}

export function getPost(slug: string, locale: Locale): BlogPost | undefined {
  const candidates = ALL.filter((p) => p.slug === slug);
  return candidates.find((p) => p.lang === locale) ?? candidates[0];
}
