/**
 * The deployed site's public routes, derived from the same Markdown filenames the two
 * routers read (landing: content/blog/<slug>.<lang>.md, docs: content/<slug>.<lang>.md).
 *
 * Two consumers share this list, and they have to agree: the landing postbuild writes
 * one static shell per route (so GitHub Pages answers 200 instead of falling back to
 * 404.html), and build-site.mjs writes sitemap.xml for the assembled tree. A route that
 * gets a shell belongs in the sitemap, and a sitemap URL that has no shell is a 404.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Production origin, no trailing slash. Override for a staging deploy. */
export const SITE_ORIGIN = (process.env.SITE_ORIGIN ?? "https://penguin.ooo").replace(/\/+$/, "");

/** Deploy subpath, no trailing slash ("" at the domain root, "/repo" under a Pages subpath). */
export const BASE_PATH = (process.env.BASE_PATH ?? "/").replace(/\/+$/, "");

/** Absolute URL for a site-root-relative route path. */
export function absoluteUrl(route) {
  return `${SITE_ORIGIN}${BASE_PATH}${route}`;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(HERE, "..", "content", "blog");
const DOCS_DIR = join(HERE, "..", "..", "docs", "content");

/** `<slug>.<lang>.md` -> slug, deduplicated across the two languages, sorted. */
function slugsIn(dir) {
  const slugs = new Set();
  for (const file of readdirSync(dir)) {
    const slug = /^(.+)\.(zh|en)\.md$/.exec(file)?.[1];
    if (slug !== undefined) slugs.add(slug);
  }
  return [...slugs].sort();
}

/** Newest `date:` in a post's frontmatter across its language variants, if any. */
function newestDate(dir, slug) {
  let newest;
  for (const lang of ["en", "zh"]) {
    let raw;
    try {
      raw = readFileSync(join(dir, `${slug}.${lang}.md`), "utf8");
    } catch {
      continue; // A post exists in one language only; the other is a legitimate miss.
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? "";
    const date = /^date:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m.exec(frontmatter)?.[1];
    if (date !== undefined && (newest === undefined || date > newest)) newest = date;
  }
  return newest;
}

/**
 * Routes served by the landing SPA. Trailing slashes are deliberate: Pages serves
 * `<route>/index.html` and 301s the slashless form to it, so the slash form is the URL
 * that actually answers 200 — the one canonical tags and the sitemap should name.
 * The home page is excluded; Vite's own index.html already sits at the dist root.
 */
export function blogRoutes() {
  return [
    { route: "/blog/" },
    ...slugsIn(BLOG_DIR).map((slug) => ({
      route: `/blog/${slug}/`,
      lastmod: newestDate(BLOG_DIR, slug),
    })),
  ];
}

/** Routes served by the docs SPA, whose own postbuild already writes their shells. */
export function docsRoutes() {
  return [{ route: "/docs/" }, ...slugsIn(DOCS_DIR).map((slug) => ({ route: `/docs/${slug}/` }))];
}
