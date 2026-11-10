import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@prismshadow/penguin-ui/site";
import {
  DEFAULT_AUTHOR,
  comparePosts,
  formatAuthors,
  formatPostDate,
  getPost,
  latestPosts,
  loadedPostBody,
  loadPostBody,
  parseAuthors,
  postsFor,
  UPDATE_CATEGORIES,
} from "../src/lib/blog";

const contentDir = join(__dirname, "..", "content", "blog");

/** A post file as written: its frontmatter and its body. */
const fileOf = (slug: string, lang: "en" | "zh") =>
  parseFrontmatter(readFileSync(join(contentDir, `${slug}.${lang}.md`), "utf8"));

const entry = (pinned: boolean, date: string, slug: string) => ({ pinned, date, slug });

describe("comparePosts", () => {
  it("sorts pinned first, then date desc, then slug", () => {
    const sorted = [
      entry(false, "2026-07-20", "beta"),
      entry(false, "2026-07-21", "newest"),
      entry(true, "2026-07-01", "pinned-old"),
      entry(false, "2026-07-20", "alpha"),
    ].sort(comparePosts);
    expect(sorted.map((p) => p.slug)).toEqual(["pinned-old", "newest", "alpha", "beta"]);
  });

  it("orders two pinned posts by date desc", () => {
    const sorted = [entry(true, "2026-07-01", "old"), entry(true, "2026-07-20", "new")].sort(
      comparePosts,
    );
    expect(sorted.map((p) => p.slug)).toEqual(["new", "old"]);
  });
});

describe("formatPostDate", () => {
  it("formats en dates as long US dates", () => {
    expect(formatPostDate("2026-06-18", "en")).toBe("June 18, 2026");
    expect(formatPostDate("2026-07-20", "en")).toBe("July 20, 2026");
  });

  it("formats zh dates as year-month-day", () => {
    expect(formatPostDate("2026-06-18", "zh")).toBe("2026年6月18日");
    expect(formatPostDate("2026-07-20", "zh")).toBe("2026年7月20日");
  });

  it("interprets the date in UTC so the calendar day never shifts", () => {
    // 2026-01-01 rendered in a western timezone would show Dec 31 without UTC pinning.
    expect(formatPostDate("2026-01-01", "en")).toBe("January 1, 2026");
  });

  it("falls back to the raw string for unexpected input", () => {
    expect(formatPostDate("", "en")).toBe("");
    expect(formatPostDate("not-a-date", "zh")).toBe("not-a-date");
  });

  it("falls back to the raw string for impossible calendar dates", () => {
    expect(formatPostDate("2026-02-31", "en")).toBe("2026-02-31");
    expect(formatPostDate("2026-13-01", "en")).toBe("2026-13-01");
    expect(formatPostDate("2026-04-00", "zh")).toBe("2026-04-00");
  });
});

describe("parseAuthors / formatAuthors", () => {
  it("splits comma-class separators and trims", () => {
    expect(parseAuthors("A (AMD), B（X）、C ，D")).toEqual(["A (AMD)", "B（X）", "C", "D"]);
  });

  it("falls back to the default byline when absent or blank", () => {
    expect(parseAuthors(undefined)).toEqual([DEFAULT_AUTHOR]);
    expect(parseAuthors("  ")).toEqual([DEFAULT_AUTHOR]);
  });

  it("joins with a comma in English and an ideographic comma in Chinese", () => {
    expect(formatAuthors(["A", "B"], "en")).toBe("A, B");
    expect(formatAuthors(["A", "B"], "zh")).toBe("A、B");
    expect(formatAuthors(["A"], "en")).toBe("A");
  });
});

/**
 * The post lists, over whatever posts content/blog holds.
 *
 * - Given the blog in either language, each post is listed once, in that language, pinned posts
 *   first and the rest newest first.
 * - Given a category, the list holds exactly that category's posts, in the whole list's order.
 */
describe("the post lists", () => {
  it("list each post once, in the reader's language, pinned first and then newest", () => {
    for (const locale of ["en", "zh"] as const) {
      const posts = postsFor(locale);
      expect(posts.length).toBeGreaterThan(0);
      expect(new Set(posts.map((p) => p.slug)).size).toBe(posts.length);
      expect(posts.every((p) => p.lang === locale)).toBe(true);
      const pinned = posts.map((p) => p.pinned);
      expect(pinned).toEqual([...pinned].sort((a, b) => Number(b) - Number(a)));
      const dates = posts.filter((p) => !p.pinned).map((p) => p.date);
      expect(dates).toEqual([...dates].sort().reverse());
    }
  });

  it("filter by category, in the whole list's order", () => {
    for (const locale of ["en", "zh"] as const) {
      const all = postsFor(locale);
      for (const category of ["news", "practice", "perspectives", "changelog"] as const) {
        expect(postsFor(locale, category)).toEqual(all.filter((p) => p.category === category));
      }
    }
  });
});

describe("latestPosts", () => {
  it("is the newest news and practice posts by date alone, pinned or not", () => {
    for (const locale of ["en", "zh"] as const) {
      const latest = latestPosts(locale, 4);
      const updates = postsFor(locale).filter((p) => UPDATE_CATEGORIES.includes(p.category));
      expect(latest).toHaveLength(Math.min(4, updates.length));
      // Nothing newer was left out, and the four read newest first.
      const dates = latest.map((p) => p.date);
      expect(dates).toEqual([...dates].sort().reverse());
      const oldestShown = dates.at(-1)!;
      for (const post of updates) {
        if (!latest.includes(post)) expect(post.date <= oldestShown, post.slug).toBe(true);
      }
      expect(new Set(latest.map((p) => p.slug)).size).toBe(latest.length);
    }
  });
});

/**
 * The index and the bodies, which the site reads separately: the index in the main bundle, each
 * body on demand.
 *
 * - Given any post file, its index entry carries the title, date, excerpt, byline (the default
 *   one when it names none) and pin its frontmatter states, in its own language.
 * - Given a post not opened yet, its body is not at hand; once loaded it is the file's text
 *   without the frontmatter, and is then at hand at once — each language its own text.
 */
describe("blog index and post bodies", () => {
  it("indexes every post file with the title, date, excerpt, byline and pin its frontmatter states", () => {
    const files = readdirSync(contentDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const [, slug, lang] = /^(.+)\.(zh|en)\.md$/.exec(file)!;
      const { meta } = fileOf(slug!, lang as "en" | "zh");
      const post = getPost(slug!, lang as "en" | "zh");
      expect(post, file).toMatchObject({
        slug,
        lang,
        title: meta.title,
        date: meta.date,
        excerpt: meta.excerpt,
        authors: parseAuthors(meta.author),
        pinned: meta.pinned === "true",
      });
    }
  });

  it("loads a post's body on demand, without its frontmatter, in each language", async () => {
    const { slug } = postsFor("en")[0]!;
    for (const lang of ["en", "zh"] as const) {
      const post = getPost(slug, lang)!;
      expect(loadedPostBody(post)).toBeUndefined();
      const body = await loadPostBody(post);
      expect(body).toBe(fileOf(slug, lang).body);
      expect(loadedPostBody(post)).toBe(body);
    }
  });
});
