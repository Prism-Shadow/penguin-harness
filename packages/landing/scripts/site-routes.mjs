/**
 * The deployed site's public routes, derived from the same Markdown filenames the two
 * routers read (landing: content/blog/<slug>.<lang>.md, docs: content/<slug>.<lang>.md).
 *
 * Two consumers share this list, and they have to agree: the landing postbuild writes
 * one static shell per route (so GitHub Pages answers 200 instead of falling back to
 * 404.html), and build-site.mjs writes sitemap.xml for the assembled tree. A route that
 * gets a shell belongs in the sitemap (the gallery's views excepted, see galleryRoutes),
 * and a sitemap URL that has no shell is a 404.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../../ui/src/components/site/markdown-text.ts";
import { en } from "../src/lib/strings-en.ts";
import { hubRoutes as hubRouteList, loadHub } from "./hub/hub.mjs";

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
const RFCS_DIR = join(HERE, "..", "..", "..", "rfcs");

/** `<slug>.<lang>.md` -> slug, deduplicated across the two languages, sorted. */
function slugsIn(dir) {
  const slugs = new Set();
  for (const file of readdirSync(dir)) {
    const slug = /^(.+)\.(zh|en)\.md$/.exec(file)?.[1];
    if (slug !== undefined) slugs.add(slug);
  }
  return [...slugs].sort();
}

/**
 * Routes served by the landing SPA. Trailing slashes are deliberate: Pages serves
 * `<route>/index.html` and 301s the slashless form to it, so the slash form is the URL
 * that actually answers 200 — the one canonical tags and the sitemap should name.
 * The home page is excluded; Vite's own index.html already sits at the dist root.
 */

/**
 * The AMSP page's name for crawlers and link unfurlers, in English like the rest of the static
 * shell (the page sets the reader's language at runtime). `image` is a file under public/,
 * rendered by `node scripts/capture-og-cover.mjs amsp`.
 */
const AMSP_META = {
  title: "AMSP: Agent Message Stream Protocol",
  description:
    "Stream, parse and store agent messages with one protocol: AMSP, the Session stream of a PenguinHarness agent.",
  image: "/og-amsp.png",
  imageAlt: "AMSP: Agent Message Stream Protocol",
};

const COMPANY_META = {
  title: "Company mode: the next draft",
  description:
    "A design draft for the next PenguinHarness company mode: a plugin app in the App Center, a lead that splits the work, execution kept apart from verification, and an inbox for exceptions only.",
  image: "/og-cover.png",
  imageAlt: "PenguinHarness",
};

/**
 * Non-blog landing SPA pages: the desktop download page, the AMSP page and the company mode draft. A page with `meta`
 * gets its own title, description and share card in its shell (route-shell.mjs).
 */
export function pageRoutes() {
  return [
    { route: "/download/" },
    { route: "/amsp/", meta: AMSP_META },
    { route: "/company/", meta: COMPANY_META },
  ];
}

/**
 * The Plugins, Benchmarks and Leaderboards pages: each list and one page per entry, read from the
 * same files the build read (the benchmark repository's clone the build just made, or
 * PENGUIN_BENCHMARK_REPO; the market document and plugin index it fetched, hub/published.mjs).
 * Each shell names its page; the share image is the site's own.
 */
export function hubRoutes() {
  return hubRouteList(loadHub()).map(({ route, title, description }) => ({
    route,
    meta: { title, description, image: "/og-cover.png", imageAlt: "PenguinHarness" },
  }));
}

/** Blog routes, one per post plus the list page. */
export function blogRoutes() {
  const card = { image: "/og-cover.png", imageAlt: en.siteName };
  return [
    {
      route: "/blog/",
      meta: { ...card, title: en.hub.pageTitle(en.blog.title), description: en.blog.subtitle },
    },
    ...slugsIn(BLOG_DIR).map((slug) => {
      const variants = ["en", "zh"].flatMap((lang) => {
        const file = join(BLOG_DIR, `${slug}.${lang}.md`);
        return existsSync(file) ? [parseFrontmatter(readFileSync(file, "utf8")).meta] : [];
      });
      // Static HTML uses the site's default language. Both translations share one canonical URL.
      const post = variants[0];
      return {
        route: `/blog/${slug}/`,
        lastmod: variants
          .map((variant) => variant.date)
          .filter(Boolean)
          .sort()
          .at(-1),
        meta: {
          ...card,
          title: en.hub.pageTitle(post.title),
          description: post.excerpt,
          type: "article",
        },
      };
    }),
  ];
}

/** RFC routes, the `/rfcs/` index plus one page per landed PRFC document in `rfcs/`. */
export function rfcRoutes() {
  const ids = new Set();
  if (existsSync(RFCS_DIR)) {
    for (const file of readdirSync(RFCS_DIR)) {
      if (!/^PRFC-\d+-.+\.md$/.test(file) || file.endsWith(".zh.md")) continue;
      const raw = readFileSync(join(RFCS_DIR, file), "utf8");
      const bodyIdx = raw.indexOf("\n## ");
      const header = bodyIdx === -1 ? raw : raw.slice(0, bodyIdx);
      if (/\blanded\b|lands on the default branch|native to this repository|落地/.test(header)) {
        ids.add(file.replace(/\.md$/, ""));
      }
    }
  }
  return [{ route: "/rfcs/" }, ...[...ids].sort().map((id) => ({ route: `/rfcs/${id}/` }))];
}

/** Routes served by the docs SPA, whose own postbuild already writes their shells. */
export function docsRoutes() {
  return [{ route: "/docs/" }, ...slugsIn(DOCS_DIR).map((slug) => ({ route: `/docs/${slug}/` }))];
}

/**
 * The component gallery's index. Its build writes a shell for each of its pages too, but those
 * are one tool's views, reached from the index with the reader's view settings in the query, so
 * the sitemap names only the entry point.
 */
export function galleryRoutes() {
  return [{ route: "/gallery/" }];
}
