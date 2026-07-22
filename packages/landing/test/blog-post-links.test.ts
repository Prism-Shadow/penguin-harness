/**
 * Blog post link rendering contract, via react-dom/server static markup (node env, no DOM):
 * every link in a post body — explicit [text](url), bare autolinked URL (remark-gfm), relative
 * or #anchor — opens in a new tab (target="_blank" + rel="noreferrer"), and the optional
 * markdown link title survives the adapter's prop forwarding.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MdLink } from "../src/pages/blog-post";

const render = (markdown: string) =>
  renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], components: { a: MdLink } }, markdown),
  );

/** All rendered <a ...> opening tags. */
const anchors = (html: string) => html.match(/<a\b[^>]*>/g) ?? [];

const expectNewTab = (tag: string | undefined) => {
  expect(tag).toContain('target="_blank"');
  expect(tag).toContain('rel="noreferrer"');
};

describe("blog post links", () => {
  it("external markdown links open in a new tab", () => {
    const html = render("See [the source](https://blog.google/gemini) for the numbers.");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://blog.google/gemini"');
    expectNewTab(tags[0]);
    expect(html).toContain(">the source</a>");
  });

  it("internal links open in a new tab too (unconditional, per the owner's ask)", () => {
    const html = render("[practice post](/blog/natural-language-training-loop) and [top](#intro)");
    const tags = anchors(html);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain('href="/blog/natural-language-training-loop"');
    for (const tag of tags) expectNewTab(tag);
  });

  it("bare autolinked URLs in CJK prose open in a new tab", () => {
    const html = render("详见 https://example.com/a/very/long/path 的说明。");
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="https://example.com/a/very/long/path"');
    expectNewTab(tags[0]);
  });

  it('preserves the markdown link title from [text](url "title")', () => {
    const html = render('Read [docs](https://example.com "API docs") first.');
    const tags = anchors(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('title="API docs"');
    expectNewTab(tags[0]);
  });
});
