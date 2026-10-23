/**
 * Where a post's link goes, which decides how it opens (src/lib/post-links.ts).
 *
 * - Given a `#` href (a citation, a back-link, a heading), it is an anchor: it stays on the page.
 * - Given a relative path, or an absolute address on one of the site's own hosts (the docs under
 *   penguin.ooo included), it is internal.
 * - Given an http(s) address on any other host, a scheme-relative `//host/…`, or another scheme
 *   that leaves the site (`mailto:`), it is external.
 * - Given the host the page is running on (a preview deployment), its addresses are internal.
 * - Given an href no browser would parse as a URL, it is internal: it renders as before.
 */
import { describe, expect, it } from "vitest";
import { SITE_HOSTS } from "../src/lib/links";
import { classifyPostHref } from "../src/lib/post-links";

describe("a post link's destination", () => {
  it.each(["#fn-1", "#fnref-1-2", "#%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5"])(
    "%s stays on the page",
    (href) => {
      expect(classifyPostHref(href, SITE_HOSTS)).toBe("anchor");
    },
  );

  it.each([
    "/blog/natural-language-training-loop",
    "./a",
    "https://penguin.ooo/docs/agent-loop",
    "https://www.penguin.ooo/",
  ])("%s is a page of this site", (href) => {
    expect(classifyPostHref(href, SITE_HOSTS)).toBe("internal");
  });

  it.each([
    "https://github.com/Prism-Shadow/penguin-harness/pull/722",
    "http://example.com/a",
    "//cdn.example.com/x",
    "mailto:a@b.example",
  ])("%s leaves the site", (href) => {
    expect(classifyPostHref(href, SITE_HOSTS)).toBe("external");
  });

  it("counts the host the page runs on as this site", () => {
    const href = "https://preview.example.dev/blog/x";
    expect(classifyPostHref(href, SITE_HOSTS)).toBe("external");
    expect(classifyPostHref(href, [...SITE_HOSTS, "preview.example.dev"])).toBe("internal");
  });

  it("leaves an href that is not a URL an ordinary link", () => {
    expect(classifyPostHref("http://[not-a-host", SITE_HOSTS)).toBe("internal");
  });
});
