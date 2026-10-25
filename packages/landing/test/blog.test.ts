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

describe("frontmatter mapping (author / pinned / category)", () => {
  it("defaults authors and pinned when the frontmatter omits them", () => {
    const post = getPost("july-2026-updates", "en");
    expect(post?.authors).toEqual([DEFAULT_AUTHOR]);
    expect(post?.pinned).toBe(false);
  });

  it("reads the explicit author list and the practice category", () => {
    const post = getPost("local-agents-on-amd-gpus", "en");
    expect(post?.authors).toEqual([
      "Ning Zhang (AMD)",
      "Yuyang Gao (AMD)",
      "Yaowei Zheng (PrismShadow)",
    ]);
    expect(post?.category).toBe("practice");
    expect(post?.pinned).toBe(false);
  });

  it("reads the pinned flag and sorts the pinned post first", () => {
    for (const locale of ["en", "zh"] as const) {
      const posts = postsFor(locale);
      // The launch post stays the single pinned post; newer posts sort under it by date.
      expect(posts.filter((p) => p.pinned).map((p) => p.slug)).toEqual([
        "introducing-penguinharness",
      ]);
      expect(posts[0]?.slug).toBe("introducing-penguinharness");
      // Pinning beats recency: the runner-up is strictly newer than the pinned post. Asserted
      // as a relation rather than a slug, because the newest date is shared by several posts
      // and the slug tie-break makes any single winner churn whenever a post is added.
      expect(posts[1]!.date > posts[0]!.date).toBe(true);
    }
  });

  it("filters by the practice category, newest first", () => {
    expect(postsFor("en", "practice").map((p) => p.slug)).toEqual([
      "testing-agent-harnesses",
      // Posts that share a date are ordered by slug, ascending.
      "build-agent-apps-with-workflows",
      "call-agents-with-the-agent-api",
      "let-agents-use-the-browser",
      "run-agents-on-remote-machines",
      "self-evolve-agents-with-rsi-toolkits",
      "connect-agents-to-feishu-qq-telegram-wechat",
      "create-evaluate-evolve-agents",
      "natural-language-training-loop",
      "penguin-harness-self-improvement-with-amd-gpu",
      "local-agents-on-amd-gpus",
    ]);
  });

  it("filters by the news category, newest first", () => {
    expect(postsFor("en", "news").map((p) => p.slug)).toEqual([
      "introducing-penguinharness",
      "penguinharness-0-2-17",
      "penguinharness-0-2-16",
      "tokendance-agent-challenge",
      "penguinharness-0-2-15",
      "penguinharness-0-2-13",
      "penguinharness-0-2-11",
      "penguinharness-0-2-6",
      "penguinharness-0-2-4",
      "penguinharness-0-2-3",
      "penguinharness-0-2-2",
      "penguinharness-0-2-1",
      "penguinharness-0-2-0",
      "penguinharness-0-1-5",
      "penguinharness-0-1-4",
      "free-models-in-penguin-harness",
      "gemini-3-6-in-penguinharness",
      "fireworks-credits-amd",
    ]);
  });

  it("filters by the perspectives category", () => {
    expect(postsFor("en", "perspectives").map((p) => p.slug)).toEqual([
      // The next four share 2026-10-19, so slug ascending is the tie-break.
      "context-slope",
      "from-a2ui-to-a2app",
      "personal-agents-need-a-computer",
      "rules-for-vibe-coding",
      "agent-company-mode",
      // The next three share 2026-07-22, so slug ascending is the tie-break.
      "ai-infrastructure-past-present-future",
      "easiest-way-to-build-ai-agents-2026",
      "simple-harness-is-all-you-need",
    ]);
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
 * - Given any post file, its index entry carries the title, date and excerpt its frontmatter
 *   states, in its own language.
 * - Given a post not opened yet, its body is not at hand; once loaded it is the file's text
 *   without the frontmatter, and is then at hand at once — each language its own text.
 */
describe("blog index and post bodies", () => {
  it("indexes every post file with the title, date and excerpt its frontmatter states", () => {
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
      });
    }
  });

  it("loads a post's body on demand, without its frontmatter, in each language", async () => {
    const slug = "introducing-penguinharness";
    for (const lang of ["en", "zh"] as const) {
      const post = getPost(slug, lang)!;
      expect(loadedPostBody(post)).toBeUndefined();
      const body = await loadPostBody(post);
      expect(body).toBe(fileOf(slug, lang).body);
      expect(loadedPostBody(post)).toBe(body);
    }
  });
});
