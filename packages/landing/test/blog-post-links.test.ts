/**
 * How a post's links open, through the page's whole pipeline (`PostBody`, react-dom/server static
 * markup, node env, no DOM):
 *
 * - Given a link to another site, written `[text](url "title")` or as a bare URL in CJK prose, it
 *   renders as the confirming link: a new-tab anchor with `noopener noreferrer`, its text and
 *   title intact.
 * - Given a link to a page of this site (a relative path, the docs under penguin.ooo), it opens in
 *   a new tab as before, without the confirmation.
 * - Given a `#` link, it stays on the page: no `target`, the href as written.
 * - Given any post, the page holds exactly one confirmation dialog, closed, in the reader's
 *   language, and outside the prose.
 *
 * The click itself (the dialog opens, Cancel keeps the reader on the page) is the shared
 * component's behaviour in a browser; it is checked there, not here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostBody } from "../src/pages/blog-post";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const render = (body: string) => renderToStaticMarkup(createElement(PostBody, { body }));

/** The rendered <a ...> opening tag whose href is `href`. */
const anchorTo = (html: string, href: string) =>
  (html.match(/<a\b[^>]*>/g) ?? []).find((tag) => tag.includes(`href="${href}"`));

afterEach(() => setActiveStrings(zh));

describe("a post's links", () => {
  it("renders a link to another site as the confirming new-tab link, text and title intact", () => {
    const html = render('See [the source](https://blog.google/gemini "Gemini") for the numbers.');
    const tag = anchorTo(html, "https://blog.google/gemini");
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer"');
    expect(tag).toContain('title="Gemini"');
    expect(html).toContain(">the source</a>");
  });

  it("renders a bare URL in CJK prose as the confirming link too", () => {
    const html = render("详见 https://example.com/a/very/long/path 的说明。");
    const tag = anchorTo(html, "https://example.com/a/very/long/path");
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer"');
  });

  it("opens a page of this site in a new tab, without the confirmation", () => {
    const html = render(
      "[practice post](/blog/natural-language-training-loop) and [the docs](https://penguin.ooo/docs/agent-loop)",
    );
    for (const href of [
      "/blog/natural-language-training-loop",
      "https://penguin.ooo/docs/agent-loop",
    ]) {
      const tag = anchorTo(html, href);
      expect(tag, href).toContain('target="_blank"');
      expect(tag, href).toContain('rel="noreferrer"');
      expect(tag, href).not.toContain("noopener");
    }
  });

  it("keeps a # link on the page", () => {
    const tag = anchorTo(render("## Intro\n\nBack to [the top](#intro)."), "#intro");
    expect(tag).toBeDefined();
    expect(tag).not.toContain("target=");
    expect(tag).not.toContain("rel=");
  });

  it.each([
    ["zh", zh],
    ["en", en],
  ] as const)("holds one closed confirmation in %s, outside the prose", (_lang, strings) => {
    setActiveStrings(strings);
    const html = render("[a](https://example.com) and [b](https://example.org)");
    const dialogs = html.match(/<dialog\b[^>]*>/g) ?? [];
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).not.toMatch(/\sopen[\s=>]/);
    expect(html.slice(html.indexOf("<dialog"))).toContain(`>${strings.hero.externalLink.open}<`);
    // The body is the prose followed by the dialog: the article's styles never reach it.
    expect(html.startsWith('<div class="site-prose')).toBe(true);
    expect(html.endsWith("</dialog>")).toBe(true);
  });
});
