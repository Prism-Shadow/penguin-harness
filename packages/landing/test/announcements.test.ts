/**
 * Every announcement that links into the blog lands on a post that exists in both languages.
 * The link's type only promises a `/blog/…` path, so a mistyped slug still type-checks and the
 * slide opens the not-found page. getPost falls back to the other language when the requested
 * one is missing, so each result's `lang` is checked, not just its presence. Off-site links
 * (`href`) are not fetched.
 */
import { describe, expect, it } from "vitest";
import { ANNOUNCEMENTS, type Announcement } from "../src/lib/announcements";
import { getPost } from "../src/lib/blog";

describe("announcement blog links", () => {
  it("resolve to a post in both languages", () => {
    const announcements: readonly Announcement[] = ANNOUNCEMENTS;
    for (const { to } of announcements) {
      if (to === undefined) continue;
      const slug = to.slice("/blog/".length);
      for (const lang of ["en", "zh"] as const) {
        const post = getPost(slug, lang);
        expect(post, `${to} (${lang})`).toBeDefined();
        expect(post?.lang, `${to} (${lang})`).toBe(lang);
      }
    }
  });
});
