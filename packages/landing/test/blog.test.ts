import { describe, expect, it } from "vitest";
import { DEFAULT_AUTHOR, comparePosts, formatPostDate, getPost, postsFor } from "../src/lib/blog";

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

describe("frontmatter mapping (author / pinned / category)", () => {
  it("defaults author and pinned when the frontmatter omits them", () => {
    const post = getPost("july-2026-updates", "en");
    expect(post?.author).toBe(DEFAULT_AUTHOR);
    expect(post?.pinned).toBe(false);
  });

  it("reads the explicit author and the practice category", () => {
    const post = getPost("local-agents-on-amd-gpus", "en");
    expect(post?.author).toBe("Ning Zhang, Yuyang Gao (AMD) and Yaowei Zheng (PrismShadow)");
    expect(post?.category).toBe("practice");
    expect(post?.pinned).toBe(false);
  });

  it("reads the pinned flag and sorts the pinned post first", () => {
    for (const locale of ["en", "zh"] as const) {
      const posts = postsFor(locale);
      expect(posts[0]?.slug).toBe("introducing-penguinharness");
      expect(posts[0]?.pinned).toBe(true);
    }
  });

  it("filters by the practice category", () => {
    expect(postsFor("en", "practice").map((p) => p.slug)).toEqual(["local-agents-on-amd-gpus"]);
  });
});
