import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTHOR,
  comparePosts,
  formatAuthors,
  formatPostDate,
  getPost,
  parseAuthors,
  postsFor,
} from "../src/lib/blog";

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

  it("formats zh dates as 年月日", () => {
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

  it("joins with a comma in English and 顿号 in Chinese", () => {
    expect(formatAuthors(["A", "B"], "en")).toBe("A, B");
    expect(formatAuthors(["甲", "乙"], "zh")).toBe("甲、乙");
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
      expect(posts.length).toBe(11);
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
      "natural-language-training-loop",
      "penguin-harness-self-improvement-with-amd-gpu",
      "local-agents-on-amd-gpus",
    ]);
  });

  it("filters by the news category, newest first", () => {
    expect(postsFor("en", "news").map((p) => p.slug)).toEqual([
      "introducing-penguinharness",
      "free-models-in-penguin-harness",
      "gemini-3-6-in-penguinharness",
      "fireworks-credits-amd",
    ]);
  });

  it("filters by the perspectives category", () => {
    expect(postsFor("en", "perspectives").map((p) => p.slug)).toEqual([
      // All three share 2026-07-22, so slug ascending is the tie-break.
      "ai-infrastructure-past-present-future",
      "easiest-way-to-build-ai-agents-2026",
      "simple-harness-is-all-you-need",
    ]);
  });
});
