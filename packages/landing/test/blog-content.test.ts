/**
 * Blog content integrity, the counterpart of packages/docs/test/content.test.ts for the blog:
 * content/blog is read from disk (no Vite glob), so the checks run under plain node. Three
 * things a post can get wrong today without anything failing:
 *
 * - A missing translation. src/lib/blog.ts documents a deliberate fallback ("a post missing the
 *   active language falls back to the other one"), so deleting a .zh.md serves the English text
 *   on the Chinese site and no test notices.
 * - Frontmatter that disagrees across the pair. `date`, `category` and `pinned` feed comparePosts,
 *   so a one-character divergence orders one language's list differently — and only that one's.
 * - A link to a docs page that does not exist. Posts send readers to
 *   https://penguin.ooo/docs/<slug>, and a renamed or dropped page leaves a 404 behind.
 *   packages/docs/src/lib/nav.ts is deliberately kept import.meta-free so a test can import
 *   DOC_SLUGS under plain node, which is what this one does.
 *
 * Deliberately not checked here: /blog-assets/<name>. Those bytes live in the separate
 * Prism-Shadow/penguin-harness-community repository, so this repository holds nothing to resolve
 * an asset name against; a typo'd name can only be caught where the files are.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOC_SLUGS } from "../../docs/src/lib/nav";
import { parseFrontmatter } from "../src/lib/frontmatter";

const contentDir = join(__dirname, "..", "content", "blog");
const LANGS = ["en", "zh"] as const;

/** The categories src/lib/blog.ts maps; anything else silently becomes "news". */
const CATEGORIES = new Set(["news", "practice", "perspectives", "changelog"]);

const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));

/** Post slugs in the directory, from the `<slug>.<lang>.md` file names. */
const slugs = [
  ...new Set(
    files
      .map((file) => /^(.+)\.(zh|en)\.md$/.exec(file)?.[1])
      .filter((slug): slug is string => slug !== undefined),
  ),
].sort();

const read = (slug: string, lang: string) =>
  parseFrontmatter(readFileSync(join(contentDir, `${slug}.${lang}.md`), "utf8"));

/**
 * Docs pages a post links to: every `https://penguin.ooo/docs/<slug>` occurrence, whether it sits
 * in a Markdown link, an autolink or bare prose. A trailing slash, an anchor and a query string
 * are all stripped — the router only ever sees the slug.
 */
function docsLinks(body: string): string[] {
  const slugs = [...body.matchAll(/https:\/\/penguin\.ooo\/docs\/([^)\s"'<>]*)/g)].map((match) =>
    match[1]!.split(/[#?]/)[0]!.replace(/\/+$/, ""),
  );
  // The bare docs root names no page, so it is always valid.
  return slugs.filter((slug) => slug !== "");
}

describe("blog content integrity", () => {
  it("names every content file <slug>.<zh|en>.md", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(/^(.+)\.(zh|en)\.md$/.test(file), `unparsable content file name ${file}`).toBe(true);
    }
  });

  it("provides zh and en files with a title, an excerpt and a body for every post", () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      for (const lang of LANGS) {
        const name = `${slug}.${lang}.md`;
        // A missing file is served by the other language's text, so presence is the whole check.
        expect(files, `missing content file ${name}`).toContain(name);
        const { meta, body } = read(slug, lang);
        expect(meta.title, `missing title in ${name}`).toBeTruthy();
        expect(meta.excerpt, `missing excerpt in ${name}`).toBeTruthy();
        expect(body.length, `empty body in ${name}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives both languages of a post the same date, category and pinned flag", () => {
    for (const slug of slugs) {
      const en = read(slug, "en").meta;
      const zh = read(slug, "zh").meta;
      expect(zh.date, `${slug}: date differs between en and zh`).toBe(en.date);
      expect(zh.category, `${slug}: category differs between en and zh`).toBe(en.category);
      // `pinned` is absent on an unpinned post, so the flag is compared, not the raw text.
      expect(zh.pinned === "true", `${slug}: pinned differs between en and zh`).toBe(
        en.pinned === "true",
      );
    }
  });

  it("gives every post a date and a known category", () => {
    for (const slug of slugs) {
      for (const lang of LANGS) {
        const { meta } = read(slug, lang);
        expect(meta.date, `malformed date in ${slug}.${lang}.md`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect([...CATEGORIES], `unknown category in ${slug}.${lang}.md`).toContain(meta.category);
      }
    }
  });

  it("links only to docs pages the docs site navigates", () => {
    for (const file of files) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const dangling = docsLinks(body).filter((slug) => !DOC_SLUGS.includes(slug));
      expect(dangling, `links to non-existent docs pages in ${file}`).toEqual([]);
    }
  });
});
