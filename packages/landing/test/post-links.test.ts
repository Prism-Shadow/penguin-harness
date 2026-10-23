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
 * - Given an address of the page the reader is on with a fragment (a path or one of the site's
 *   hosts, with or without the trailing slash Pages adds), it is a jump within the page, named by
 *   its bare fragment; another post, the same page without a fragment, or another host's page
 *   with the same path is not.
 */
import { describe, expect, it } from "vitest";
import { SITE_HOSTS } from "../src/lib/links";
import { classifyPostHref, inPageHash } from "../src/lib/post-links";

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

  it.each([
    ["#fn-1", "/blog/context-slope", "#fn-1"],
    ["/blog/context-slope#fn-1", "/blog/context-slope", "#fn-1"],
    ["/blog/context-slope#fn-1", "/blog/context-slope/", "#fn-1"],
    ["https://penguin.ooo/blog/context-slope/#intercept", "/blog/context-slope", "#intercept"],
    ["https://www.penguin.ooo/blog/context-slope#fnref-2-3", "/blog/context-slope", "#fnref-2-3"],
  ])("%s on %s is a jump within the page to %s", (href, here, hash) => {
    expect(inPageHash(href, SITE_HOSTS, here)).toBe(hash);
  });

  it.each([
    ["/blog/another-post#fn-1", "/blog/context-slope"],
    ["/blog/context-slope", "/blog/context-slope"],
    ["https://example.com/blog/context-slope#fn-1", "/blog/context-slope"],
    ["mailto:a@b.example#x", "/blog/context-slope"],
  ])("%s on %s leads elsewhere", (href, here) => {
    expect(inPageHash(href, SITE_HOSTS, here)).toBeNull();
  });
});
